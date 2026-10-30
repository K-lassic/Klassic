"""모델 API 권한 판정(FR-068, design/UC_00 §4-1) — 경로 → 유스케이스, 역할 허용."""
from app.auth.rbac import allowed, uc_of


def test_uc_of_keyed_paths():
    assert uc_of("/v1/omr/staff") == "UC12"
    assert uc_of("/v1/omr/jeongganbo") == "UC12"
    assert uc_of("/v1/recommend") == "UC12"
    assert uc_of("/v1/render/mp3") == "UC12"
    assert uc_of("/v1/render/pdf") == "UC12"
    assert uc_of("/v1/performances") == "UC13"
    assert uc_of("/v1/performances/R-0929-AAAA1111") == "UC13"
    assert uc_of("/v1/performances/R-0929-AAAA1111/result") == "UC13"
    assert uc_of("/v1/internal/upload-check") == "UC3"
    assert uc_of("/v1/internal/settings/reload") == "UC10"
    assert uc_of("/v1/internal/models/reload") == "UC14"
    assert uc_of("/v1/internal/models/homr/load") == "UC14"
    assert uc_of("/v1/internal/ollama/available") == "UC14"
    assert uc_of("/api/v1/omr/staff") == "UC12"  # 외부 주소(root_path /api)로 들어온 경로
    assert uc_of("/v1/nope") is None


def test_allowed():
    table = {"api_caller": {"UC11", "UC12", "UC13"}, "service": {"UC3", "UC10", "UC12", "UC14"}}
    assert allowed("api_caller", "UC13", table)
    assert not allowed("api_caller", "UC10", table)
    assert allowed("service", "UC10", table)
    assert not allowed("service", "UC13", table)
    assert not allowed("user", "UC12", table)
