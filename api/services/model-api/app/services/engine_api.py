"""인식 판정과 어댑터 경계. 시험에서는 이 함수를 교체해 장애를 재현한다."""
from app.checks.upload import check_upload
from app.engines.registry import build_adapter

__all__ = ["check_upload", "build_adapter", "check_structure", "check_validity"]


def check_structure(image_bytes, chosen_type, threshold):
    from app.checks.structure import check_structure as check
    return check(image_bytes, chosen_type, threshold)


def check_validity(musicxml, score_type, **kwargs):
    from app.checks.validity import check_validity as check
    return check(musicxml, score_type, **kwargs)
