"""#93 구조에서의 위치: Compose 일회성 준비 작업 → backend storage/shared 생성.

subpath는 마운트 전에 있어야 한다. 일반 사용자로 폴더만 준비하고 기존 파일·권한은 변경하지 않는다.
네트워크·DB·키는 필요 없으며 API와 등록 도구는 준비 후 shared/ 하위만 마운트한다.
"""
from pathlib import Path


def prepare_shared(root: Path) -> Path:
    if root.is_symlink() or not root.is_dir():
        raise ValueError('저장소 루트가 디렉터리가 아닙니다')
    shared = root / 'shared'
    if shared.is_symlink():
        raise ValueError('공유 폴더 링크 금지')
    shared.mkdir(mode=0o755, exist_ok=True)
    if shared.is_symlink() or not shared.is_dir() or shared.resolve().parent != root.resolve():
        raise ValueError('공유 폴더 경로 범위 초과')
    return shared


if __name__ == '__main__':
    prepare_shared(Path('/storage'))
    print('shared 저장 폴더 준비 완료')
