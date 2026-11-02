"""#28 공용 fixture·검사 순서·쪽 수·작은 사진 사본·서비스 키 API 회귀 검사."""
import io
import json
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image
import pypdfium2 as pdfium
import pytest

from app.checks.upload import check_upload, read_rules
from app.config import Config
from app.main import create_app
from test_foundation import FakeDB, FakeResources, SHARED

FIXTURES = SHARED / "fixtures/upload"
EXPECTED = json.loads((FIXTURES / "expected.json").read_text(encoding="utf-8"))
RULES = read_rules(SHARED)
CASES = [(name, code) for name, code in EXPECTED.items() if not name.startswith("$")]


def png(edge, height=None):
    output = io.BytesIO()
    Image.new("RGB", (edge, height or edge), "white").save(output, format="PNG")
    return output.getvalue()


def pdf(pages, size=72):
    document = pdfium.PdfDocument.new()
    try:
        for _ in range(pages):
            page = document.new_page(size, size)
            page.close()
        output = io.BytesIO()
        document.save(output)
        return output.getvalue()
    finally:
        document.close()


def fixture_data(name):
    if name == "big_25mb.png":
        data = (FIXTURES / "ok_staff.png").read_bytes()
        # 압축 해제 크기를 늘리지 않고 유효 PNG 뒤에 붙여 파일 크기 상한을 검사한다.
        return data + b"\0" * (25 * 1024 * 1024 - len(data))
    return (FIXTURES / name).read_bytes()


def check(files, **options):
    settings = {"score_type": "staff", "require_score_type": True,
                "allowed_kinds": ("image", "pdf"), "multi_page": True, "render_pdf": False}
    settings.update(options)
    return check_upload(files, rules=RULES, **settings)


@pytest.mark.parametrize("name,code", CASES)
def test_shared_expected_files(name, code):
    verdict = check([(name, fixture_data(name))])
    assert verdict.code == code
    assert verdict.ok is (code is None)
    if name in EXPECTED.get("$pdf_pages", {}):
        assert verdict.pdf_page_count == EXPECTED["$pdf_pages"][name]


def test_order_count_type_corruption_size_resolution_score_type():
    valid = png(700)
    assert check([("x.txt", b"text")] * 11).code == "UPLOAD_TOO_MANY_PAGES"
    assert check([("x.png", b"bad"), ("x.txt", b"text")]).code == "UPLOAD_UNSUPPORTED_TYPE"
    broken = bytes.fromhex("89504e470d0a1a0a") + b"broken"
    assert check([("x.png", broken)], image_max_bytes=1, score_type=None).code == "UPLOAD_CORRUPTED"
    assert check([("x.png", png(250))], image_max_bytes=1, score_type=None).code == "UPLOAD_TOO_LARGE"
    assert check([("x.png", png(250))], score_type=None).code == "UPLOAD_RESOLUTION_TOO_LOW"
    assert check([("x.png", valid)], score_type=None).code == "UPLOAD_SCORE_TYPE_REQUIRED"


@pytest.mark.parametrize("edge,accepted,upscaled", [(299, False, None), (300, True, 1000),
    (600, True, 1000), (649, True, 1000), (650, True, None)])
def test_image_boundary_and_original_preservation(edge, accepted, upscaled):
    original = png(edge)
    verdict = check([("source.png", original)])
    assert verdict.ok is accepted
    if accepted:
        assert verdict.files[0].data == original
        assert verdict.pages[0].short_edge_px == edge
        assert verdict.pages[0].upscaled_short_side_px == upscaled
        if upscaled:
            with Image.open(io.BytesIO(verdict.pages[0].image)) as image:
                assert min(image.size) == 1000


def test_many_photos_keep_input_order_and_report_failed_page():
    files = [("second.png", png(700)), ("first.png", png(800))]
    verdict = check(files)
    assert verdict.ok
    assert [f.name for f in verdict.files] == ["second.png", "first.png"]
    assert [(p.page_no, p.file_no, p.short_edge_px) for p in verdict.pages] == [(1, 1, 700), (2, 2, 800)]
    failed = check([files[0], ("small.png", png(250))])
    assert failed.code == "UPLOAD_RESOLUTION_TOO_LOW" and failed.details["page"] == 2
    assert check([files[0]] * 10).ok
    assert check([files[0]] * 11).code == "UPLOAD_TOO_MANY_PAGES"


def test_pdf_page_count_and_mixed_input():
    ten, eleven = pdf(10), pdf(11)
    assert check([("ten.pdf", ten)]).ok
    too_many = check([("eleven.pdf", eleven)])
    assert too_many.code == "UPLOAD_TOO_MANY_PAGES" and too_many.details["pdf_page_count"] == 11
    assert check([("a.pdf", ten), ("b.pdf", ten)]).code == "UPLOAD_TOO_MANY_FILES"
    assert check([("a.pdf", ten), ("a.png", png(700))]).code == "UPLOAD_TOO_MANY_FILES"


def test_pdf_check_never_renders_pages():
    with patch("app.checks.pdf.render_pages", side_effect=AssertionError("검사에서 렌더링 금지")):
        verdict = check([("score.pdf", fixture_data("ok_staff_2p.pdf"))])
    assert verdict.ok and len(verdict.pages) == 2
    assert all(p.image is None for p in verdict.pages)


def test_pdf_render_helper_produces_upscaled_copy_only_when_requested():
    original = pdf(1, size=80)  # 300dpi 약 333px → 1000px 사본
    verdict = check([("small.pdf", original)], render_pdf=True)
    assert verdict.ok and verdict.files[0].data == original
    assert verdict.pages[0].upscaled_short_side_px == 1000


def test_rules_are_isolated_per_call():
    custom = json.loads(json.dumps(RULES))
    custom["kinds"]["image"]["min_short_edge_px"] = 800
    inputs = [("a.png", png(700))]
    strict = check_upload(inputs, rules=custom, score_type="staff", require_score_type=True,
                          allowed_kinds=("image", "pdf"), multi_page=True)
    assert strict.code == "UPLOAD_RESOLUTION_TOO_LOW"
    assert check(inputs).ok


class UploadDB(FakeDB):
    async def fetch_all(self, sql, args=None):
        rows = await super().fetch_all(sql, args)
        if "role_permission" in sql:
            rows.append({"role_code": "service", "uc_code": "UC3"})
        return rows


@pytest.fixture
def api():
    db = UploadDB()

    async def connect(cfg):
        return db

    app = create_app(Config(shared_dir=SHARED), db_factory=connect, resource_factory=FakeResources)
    with TestClient(app, root_path="/api") as client:
        yield client, db


@pytest.mark.parametrize("name,code", CASES)
def test_api_shared_expected_files(api, name, code):
    client, db = api
    response = client.post("/v1/internal/upload-check", files={"file": (name, fixture_data(name))},
                           data={"score_type": "staff"}, headers={"X-API-Key": "service-secret"})
    assert response.headers.get("X-Request-ID")
    if code:
        expected_http = {"UPLOAD_UNSUPPORTED_TYPE": 415, "UPLOAD_TOO_LARGE": 413}.get(code, 422)
        assert response.status_code == expected_http, response.text
        assert response.json()["error"]["code"] == code
    else:
        assert response.status_code == 200, response.text
        body = response.json()
        assert set(body) == {"ok", "kind", "short_edge_px", "pdf_page_count", "page_count", "pages"}
        assert body["ok"] and body["page_count"] == len(body["pages"])
    assert not any("INSERT INTO score_request" in sql or "INSERT INTO request_page" in sql for sql, _ in db.logs)


@pytest.mark.parametrize("key,status,code", [(None, 401, "AUTH_KEY_MISSING"),
    ("unknown-key", 401, "AUTH_KEY_INVALID"), ("external-secret", 403, "AUTH_SERVICE_KEY_REQUIRED"),
    ("revoked-secret", 403, "AUTH_KEY_REVOKED")])
def test_api_is_service_key_only(api, key, status, code):
    response = api[0].post("/v1/internal/upload-check", files={"file": ("x.png", png(700))},
                           data={"score_type": "staff"}, headers={"X-API-Key": key} if key else {})
    assert response.status_code == status and response.json()["error"]["code"] == code


@pytest.mark.parametrize("variant", ["no_file", "empty_file", "unknown_form_field", "missing_score_type", "wrong_score_type"])
def test_api_rejects_bad_input(api, variant):
    files = None if variant == "no_file" else {"file": ("x.png", b"" if variant == "empty_file" else png(700))}
    data = {} if variant == "missing_score_type" else {"score_type": "unknown" if variant == "wrong_score_type" else "staff"}
    if variant == "unknown_form_field":
        data["extra"] = "value"
    response = api[0].post("/v1/internal/upload-check", files=files, data=data,
                           headers={"X-API-Key": "service-secret"})
    assert response.status_code == 422
    expected = "UPLOAD_SCORE_TYPE_REQUIRED" if variant.endswith("score_type") else "VALIDATION_ERROR"
    assert response.json()["error"]["code"] == expected


def test_api_pdf_metadata_and_order(api):
    client, _ = api
    response = client.post("/v1/internal/upload-check", files={"file": ("eleven.pdf", pdf(11))},
                           data={"score_type": "staff"}, headers={"X-API-Key": "service-secret"})
    assert response.status_code == 422 and response.json()["error"]["code"] == "UPLOAD_TOO_MANY_PAGES"
    photos = [("file", ("b.png", png(700))), ("file", ("a.png", png(800)))]
    response = client.post("/v1/internal/upload-check", files=photos, data={"score_type": "staff"},
                           headers={"X-API-Key": "service-secret"})
    assert response.status_code == 200
    assert [p["short_edge_px"] for p in response.json()["pages"]] == [700, 800]
