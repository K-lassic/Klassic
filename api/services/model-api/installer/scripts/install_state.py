"""#138 구조에서의 위치: 설치 스크립트 → 고정 배포 정보·파일 해시 → 완료 표식.

다운로드 해시 불일치·변경된 잠금·부분 설치를 완료로 취급하지 않는다. tar에서는 고정 파일만 읽는다.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
from datetime import datetime, timezone

LOCKS = Path('/locks')


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def sources():
    return json.loads((LOCKS/'sources.json').read_text(encoding='utf-8-sig'))


def check_file(path, expected):
    if path.is_symlink() or path.stat().st_size != expected['bytes'] or digest(path) != expected['sha256']:
        raise ValueError(f'파일 해시·크기 불일치: {path.name}')


def input_hashes(engine):
    return {str(p.relative_to(LOCKS)): hashlib.sha256(p.read_bytes().replace(b'\r\n', b'\n')).hexdigest()
            for p in [LOCKS/'sources.json', *sorted((LOCKS/engine).iterdir())] if p.is_file()}


def validate(engine, root):
    folder = root/engine
    spec = sources()[engine]
    version = spec['version']
    if (folder/'VERSION').read_text().strip() != version or not (folder/'.venv/bin/python').exists():
        raise ValueError('버전 또는 Python 실행 파일 불일치')
    if engine == 'homr':
        weights = json.loads((LOCKS/'homr/weights.sha256.json').read_text(encoding='utf-8-sig'))
        for relative, expected in weights.items():
            check_file(folder/'.venv/lib/python3.11/site-packages'/relative, expected)
    else:
        actual = subprocess.check_output(['git', '-C', str(folder/'repo'), 'rev-parse', 'HEAD'], text=True).strip()
        if actual != spec['commit']:
            raise ValueError('정간보 Git 커밋 불일치')
        for relative, expected in spec['files'].items():
            check_file(folder/'repo'/relative, expected)
    return {'engine': engine, 'version': version, 'input_hashes': input_hashes(engine)}


def extract_checkpoint(root):
    spec = sources()['jeongganbo']
    folder = root/'jeongganbo'
    archive = folder/'checkpoints.tar.gz'
    if digest(archive) != spec['checkpoint_sha256']:
        raise ValueError('체크포인트 압축 파일 SHA-256 불일치')
    with tarfile.open(archive, 'r:gz') as source:
        for relative, expected in spec['files'].items():
            member = source.getmember(relative)
            if not member.isfile():
                raise ValueError('일반 체크포인트 파일만 허용합니다')
            path = folder/'repo'/relative
            if path.is_symlink() or not path.resolve().is_relative_to((folder/'repo').resolve()):
                raise ValueError('체크포인트 경로 범위 초과')
            path.parent.mkdir(parents=True, exist_ok=True)
            with source.extractfile(member) as stream, path.open('xb') as target:
                while chunk := stream.read(1024*1024):
                    target.write(chunk)
            check_file(path, expected)
    archive.unlink()


def main():
    command = sys.argv[1]
    if command == 'value':
        print(sources()[sys.argv[2]][sys.argv[3]])
        return
    root = Path(os.environ['ENGINES_DIR'])
    if command == 'extract-checkpoint':
        extract_checkpoint(root)
        return
    engine = sys.argv[2]
    result = validate(engine, root)
    marker = root/engine/'INSTALL_MANIFEST.json'
    if command == 'verify':
        previous = json.loads(marker.read_text())
        if any(previous.get(k) != v for k, v in result.items()):
            raise ValueError('설치 완료 표식과 현재 잠금 불일치')
    elif command == 'complete':
        result['installed_at'] = datetime.now(timezone.utc).isoformat()
        temporary = marker.with_suffix('.tmp')
        temporary.write_text(json.dumps(result, indent=2)+'\n')
        temporary.replace(marker)
    else:
        raise ValueError('지원하지 않는 검사 명령')


if __name__ == '__main__':
    main()
