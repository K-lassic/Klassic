"""#93 공유 악보 계약·권한·숨김·경로 경계와 예시 등록의 실패 복구를 검증한다."""
from contextlib import asynccontextmanager
from dataclasses import replace
from datetime import timedelta
import json

import pytest

from app.db import utcnow
from app.services.shared_scores import read_shared, shared_path
from app.tools.init_shared_storage import prepare_shared
from app.tools.seed_shared_examples import load_examples, seed_examples
from test_contract_matrix import check, contract as contract
from test_performances import client as client

NO = 'S-1103-ABCDEFGH'
XML = '<score-partwise><part-list/><part id="P1"><measure><note><rest/><duration>1</duration></note></measure></part></score-partwise>'
HEADERS = {'X-API-Key': 'external-secret'}


def install(client, monkeypatch):
    api, app, db, _ = client
    cfg = replace(app.state.config, shared_scores_dir=app.state.config.storage_dir / 'shared-volume')
    app.state.config = cfg
    path = cfg.shared_scores_dir / f'{NO}/score.musicxml'
    path.parent.mkdir(parents=True)
    path.write_text(XML)
    row = dict(share_no=NO, title='예시 곡', score_type='staff', like_count=4, is_example=1,
               shared_at=utcnow()-timedelta(days=1), musicxml_uri=f'shared/{NO}/score.musicxml',
               owner_account_id=99, source_request_id=1234)
    old_all, old_one = db.fetch_all, db.fetch_one
    async def all_rows(sql, args=None):
        if 'v_shared_score_list' in sql:
            assert 's.purged_at IS NULL' in sql
            assert args[0] == 2 and args[1] == 0
            return [row, {**row, 'share_no': 'S-1103-BCDEFGHJ'}]
        return await old_all(sql, args)
    async def one_row(sql, args=None):
        if 'v_shared_score_list' in sql:
            assert 's.purged_at IS NULL' in sql
            return row if args[0] == NO else None
        return await old_one(sql, args)
    monkeypatch.setattr(db, 'fetch_all', all_rows)
    monkeypatch.setattr(db, 'fetch_one', one_row)
    return api, app, row, path


@pytest.mark.parametrize('sort', ['likes', 'recent'])
def test_list_contract_pagination_no_owner_or_request(client, monkeypatch, contract, sort):
    api, app, _, _ = install(client, monkeypatch)
    response = api.get(f'/v1/shared-scores?limit=1&sort={sort}', headers=HEADERS)
    body = check(contract, '/v1/shared-scores', 'get', response, 200).json()
    assert body['has_more'] and len(body['items']) == 1
    assert set(body['items'][0]) == {'share_no', 'title', 'score_type', 'likes', 'example', 'shared_at'}
    security = api.get('/v1/openapi.json').json()['paths']['/v1/shared-scores']['get']['security']
    assert security == [{'ApiKey': []}]


def test_score_contract_and_hidden_or_missing(client, monkeypatch, contract):
    api, _, row, path = install(client, monkeypatch)
    url = f'/v1/shared-scores/{NO}/score'
    response = api.get(url, headers=HEADERS)
    body = check(contract, '/v1/shared-scores/{share_no}/score', 'get', response, 200).json()
    assert body['musicxml'] == XML and 'musicxml_uri' not in body and 'owner_account_id' not in body
    path.unlink()
    assert api.get(url, headers=HEADERS).status_code == 404
    assert api.get('/v1/shared-scores/S-1103-BCDEFGHJ/score', headers=HEADERS).status_code == 404
    row['musicxml_uri'] = '/etc/passwd'
    assert api.get(url, headers=HEADERS).status_code == 404


@pytest.mark.parametrize('key,status', [(None, 401), ('wrong', 401), ('revoked-secret', 403)])
def test_auth_on_both_paths(client, key, status):
    api, _, _, _ = client
    for url in ['/v1/shared-scores', f'/v1/shared-scores/{NO}/score']:
        assert api.get(url, headers={'X-API-Key': key} if key else {}).status_code == status


@pytest.mark.parametrize('query', ['sort=bad', 'limit=0', 'limit=51', 'offset=-1'])
def test_query_bounds(client, query):
    api, _, _, _ = client
    assert api.get('/v1/shared-scores?'+query, headers=HEADERS).status_code == 422


def test_shared_paths_refuse_other_request_and_symlink(tmp_path):
    root, outside = tmp_path/'store', tmp_path/'secret'
    outside.write_text('private')
    for uri in ['../secret', '/secret', 'api/R-1103-ABCDEFGH/result.musicxml', f'shared/{NO}/../secret']:
        with pytest.raises(ValueError):
            shared_path(root, NO, uri)
    directory = root/NO
    directory.mkdir(parents=True)
    (directory/'score.musicxml').symlink_to(outside)
    with pytest.raises(ValueError):
        read_shared(root, NO, f'shared/{NO}/score.musicxml')


def test_shared_subpath_maps_backend_uri_without_exposing_siblings(tmp_path):
    root = tmp_path/'shared'
    path = shared_path(root, NO, f'shared/{NO}/score.musicxml')
    assert path == root/NO/'score.musicxml'
    assert 'shared/shared' not in str(path)
    with pytest.raises(ValueError):
        shared_path(root, NO, f'{NO}/score.musicxml')
    with pytest.raises(ValueError):
        shared_path(root, NO, 'requests/private/original.png')


def test_init_shared_empty_volume_repeat_and_preserve_private_files(tmp_path):
    private = tmp_path/'requests'/'private'
    private.mkdir(parents=True)
    (private/'original.png').write_bytes(b'private')
    shared = prepare_shared(tmp_path)
    assert shared == tmp_path/'shared' and shared.is_dir()
    (shared/'keep').write_text('keep')
    assert prepare_shared(tmp_path) == shared
    assert (private/'original.png').read_bytes() == b'private'
    assert (shared/'keep').read_text() == 'keep'


@pytest.mark.parametrize('kind', ['root_link', 'shared_link', 'shared_file'])
def test_init_shared_refuses_links_and_non_directory(tmp_path, kind):
    root, outside = tmp_path/'store', tmp_path/'outside'
    outside.mkdir()
    if kind == 'root_link':
        root.symlink_to(outside, target_is_directory=True)
    else:
        root.mkdir()
        if kind == 'shared_link':
            (root/'shared').symlink_to(outside, target_is_directory=True)
        else:
            (root/'shared').write_text('keep')
    with pytest.raises((ValueError, FileExistsError)):
        prepare_shared(root)
    assert list(outside.iterdir()) == []


class SeedDB:
    def __init__(self, *, fail=False):
        self.rows = {}
        self.fail = fail
    @asynccontextmanager
    async def advisory_lock(self, name):
        yield True
    async def fetch_one(self, sql, args):
        return self.rows.get(args[0])
    async def execute(self, sql, args):
        if self.fail:
            raise OSError('test-db-failure')
        assert 'source_request_id,owner_account_id' in sql and 'NULL,NULL' in sql
        self.rows[args[1]] = {'share_no': args[0]}


def test_seed_repeat_and_rollback(tmp_path):
    import asyncio
    from app.config import Config
    cfg = Config(assets_dir=tmp_path/'assets', shared_scores_dir=tmp_path/'shared-volume')
    cfg.assets_dir.mkdir()
    (cfg.assets_dir/'score.musicxml').write_text(XML)
    manifest = tmp_path/'examples.json'
    manifest.write_text(json.dumps({'examples': [{'id': 'test', 'title': '시험', 'score_type': 'staff', 'file': 'score.musicxml'}]}))
    items = load_examples(cfg, manifest)
    db = SeedDB()
    assert asyncio.run(seed_examples(db, cfg, items)) == {'added': 1, 'skipped': 0}
    assert asyncio.run(seed_examples(db, cfg, items)) == {'added': 0, 'skipped': 1}
    before = set(cfg.shared_scores_dir.rglob('score.musicxml'))
    items[0][0]['id'] = 'another'
    with pytest.raises(OSError):
        asyncio.run(seed_examples(SeedDB(fail=True), cfg, items))
    assert set(cfg.shared_scores_dir.rglob('score.musicxml')) == before


def test_seed_asset_path_guard(tmp_path):
    from app.config import Config
    manifest = tmp_path/'examples.json'
    manifest.write_text(json.dumps({'examples': [{'id': 'test', 'title': '시험', 'score_type': 'staff', 'file': '../secret.xml'}]}))
    with pytest.raises(ValueError):
        load_examples(Config(assets_dir=tmp_path), manifest)
