"""#93 구조에서의 위치: 운영자 CLI → 검토한 MusicXML → shared_score·공유 저장소.

출처 미확인 사진을 자동 인식·공개하지 않는다. 이용 조건을 검토한 뒤 --confirm-rights로 명시 실행한다.
기존 예시·관리자가 내린 예시는 그대로 두고, DB 저장 실패 시 이번에 만든 폴더만 지운다.
"""
import argparse
import asyncio
import json
from pathlib import Path
import shutil

from app.checks.upload import musicxml_structure
from app.config import load_config
from app.db import Database
from app.services.requests import new_request_no
from app.services.shared_scores import MAX_SCORE_BYTES, shared_path


def load_examples(cfg, manifest):
    document = json.loads(manifest.read_text(encoding='utf-8'))
    items, seen = [], set()
    for item in document['examples']:
        identifier = item['id']
        if not isinstance(identifier, str) or not 1 <= len(identifier) <= 64 or identifier in seen:
            raise ValueError('예시 id가 비었거나 중복됐습니다')
        if not isinstance(item['title'], str) or not 1 <= len(item['title'].strip()) <= 60:
            raise ValueError('예시 제목은 1~60자여야 합니다')
        if item['score_type'] not in ('staff', 'jeongganbo'):
            raise ValueError('악보 종류를 확인하십시오')
        relative = Path(item['file'])
        if relative.is_absolute() or '..' in relative.parts:
            raise ValueError('이미지 안 assets 파일만 등록할 수 있습니다')
        path = cfg.assets_dir / relative
        cursor = cfg.assets_dir
        for part in relative.parts:
            cursor /= part
            if cursor.is_symlink():
                raise ValueError('예시 파일 링크 금지')
        if not path.resolve().is_relative_to(cfg.assets_dir.resolve()):
            raise ValueError('예시 파일 경로 범위 초과')
        with path.open('rb') as source:
            data = source.read(MAX_SCORE_BYTES + 1)
        shape = musicxml_structure(data) if len(data) <= MAX_SCORE_BYTES else None
        if not shape or shape['notes'] < 1:
            raise ValueError('유효한 MusicXML 악보가 아닙니다')
        items.append((item, data))
        seen.add(identifier)
    return items


async def seed_examples(db, cfg, items):
    report = {'added': 0, 'skipped': 0}
    async with db.advisory_lock('klassic_shared_example_seed') as acquired:
        if not acquired:
            raise RuntimeError('다른 예시 등록 작업이 실행 중입니다')
        for item, data in items:
            if await db.fetch_one('SELECT share_no FROM shared_score WHERE example_id=%s', (item['id'],)):
                report['skipped'] += 1
                continue
            no = 'S-' + new_request_no()[2:]
            uri = f'shared/{no}/score.musicxml'
            path = shared_path(cfg.shared_scores_dir, no, uri)
            path.parent.mkdir(parents=True, exist_ok=False)
            try:
                with path.open('xb') as target:
                    target.write(data)
                await db.execute(
                    'INSERT INTO shared_score(share_no,source_request_id,owner_account_id,example_id,title,score_type,'
                    "musicxml_uri,expires_at) VALUES(%s,NULL,NULL,%s,%s,%s,%s,'2037-12-31 23:59:59')",
                    (no, item['id'], item['title'].strip(), item['score_type'], uri))
            except BaseException:
                # shared_path로 확인한 이번 작업의 새 폴더만 되돌린다.
                shutil.rmtree(path.parent)
                raise
            report['added'] += 1
    return report


async def main():
    parser = argparse.ArgumentParser(description='이용 조건을 확인한 MusicXML만 공유 예시로 등록합니다')
    parser.add_argument('--confirm-rights', action='store_true', help='등록할 악보의 이용 조건 확인을 완료했습니다')
    parser.add_argument('--manifest', type=Path)
    args = parser.parse_args()
    if not args.confirm_rights:
        parser.error('이용 조건을 확인한 뒤 --confirm-rights를 지정하십시오')
    cfg = load_config()
    items = load_examples(cfg, args.manifest or cfg.assets_dir / 'shared-examples.json')
    db = await Database.connect(cfg)
    try:
        print(json.dumps(await seed_examples(db, cfg, items), ensure_ascii=False))
    finally:
        await db.close()


if __name__ == '__main__':
    asyncio.run(main())
