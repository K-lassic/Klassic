"""#93 구조에서의 위치: 공유 악보 API·등록 도구 → backend 공유 저장소의 제한된 경로.

API는 backend storage의 shared/ 하위만 마운트해 <공유 번호>/score.musicxml을 읽는다.
DB의 shared/ 접두사는 유지하며 작성자·원 요청은 노출하지 않는다.
"""
from pathlib import Path
import re

SHARE_NO = re.compile(r'S-\d{4}-[A-Z0-9]{8}\Z')
MAX_SCORE_BYTES = 5 * 1024 * 1024


def shared_path(root: Path, share_no: str, uri: str) -> Path:
    if not SHARE_NO.fullmatch(share_no) or uri != f'shared/{share_no}/score.musicxml':
        raise ValueError('공유 악보 경로가 아닙니다')
    path = root
    if root.is_symlink():
        raise ValueError('공유 저장소 링크 금지')
    # DB URI는 backend 기준이다. 마운트 루트 자체가 shared/이므로 접두사를 한 번만 뺀다.
    for part in (share_no, 'score.musicxml'):
        path = path / part
        if path.is_symlink():
            raise ValueError('공유 악보 링크 금지')
    if path.resolve().parent != (root.resolve() / share_no):
        raise ValueError('공유 악보 폴더 밖 접근 금지')
    return path


def read_shared(root: Path, share_no: str, uri: str) -> str:
    path = shared_path(root, share_no, uri)
    with path.open('rb') as source:
        data = source.read(MAX_SCORE_BYTES + 1)
    if not data or len(data) > MAX_SCORE_BYTES:
        raise ValueError('공유 악보 용량 범위 초과')
    return data.decode('utf-8')
