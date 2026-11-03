"""#93 임시 DB·공유 시험 볼륨·실제 HTTP·FluidSynth MP3를 연결한다.

prepare → 데모 컨테이너 기동 → verify → 데모 종료 → RW 도구에서 cleanup 순서다.
정책 변경은 klassic_issue93에서만 하며 원래 값으로 복원한다. 키 원문은 출력하지 않는다.
"""
import asyncio
import array
import hashlib
import json
import math
import secrets
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import uuid
import wave

from app.config import load_config
from app.db import Database


def call(path, *, key=None, base='http://127.0.0.1:9543'):
    request = urllib.request.Request(base+path, headers={'X-API-Key': key} if key else {})
    try:
        response = urllib.request.urlopen(request, timeout=150)
    except urllib.error.HTTPError as exc:
        response = exc
    with response:
        return response.status, dict(response.headers), response.read()


async def main():
    cfg = load_config()
    if cfg.db_name != 'klassic_issue93' or str(cfg.storage_dir) != '/storage/issue93':
        raise RuntimeError('격리된 #93 DB·저장소에서만 실행하십시오')
    db = await Database.connect(cfg)
    folder = cfg.storage_dir / 'tmp'
    folder.mkdir(parents=True, exist_ok=True)
    state_file, env_file = folder/'demo-state.json', folder/'demo-key.env'
    mode = sys.argv[1]
    try:
        if mode == 'preflight':
            existing = await db.fetch_one('SELECT COUNT(*) AS n FROM shared_score')
            if int(existing['n']):
                raise RuntimeError('공유 악보가 없는 격리 시험 DB에서만 실행하십시오')
            print(json.dumps({'isolated_preflight': True}))
            return
        if mode == 'prepare':
            if state_file.exists():
                raise RuntimeError('이전 시험 정리를 먼저 완료하십시오')
            policy = await db.fetch_one("SELECT confirmed,decided_by,decided_at FROM license_policy WHERE policy_code='sound_and_renderer'")
            row = await db.fetch_one("SELECT share_id,share_no,musicxml_uri FROM shared_score WHERE example_id='demo-arirang-semachi'")
            if not row:
                raise RuntimeError('시험 예시 등록 도구를 먼저 실행하십시오')
            operator = await db.execute('INSERT INTO operator_account(login_id,password_hash,display_name,disabled_at) '
                                        'VALUES(%s,%s,%s,UTC_TIMESTAMP(3))',
                                        ('demo93_'+uuid.uuid4().hex[:16], 'disabled-test-only', '데모 정책 시험'))
            raw = secrets.token_urlsafe(32)
            kid = await db.execute("INSERT INTO access_key(key_kind,key_hash,key_prefix,application_no,call_limit_per_hour) "
                                   "VALUES('external',%s,%s,%s,100)",
                                   (hashlib.sha256(raw.encode()).hexdigest(), raw[:8], 'T93-'+uuid.uuid4().hex[:16]))
            state_file.write_text(json.dumps(dict(key_id=kid, operator=operator, previous_policy=policy, share=row), default=str))
            env_file.write_text('DEMO_API_KEY='+raw+'\nDEMO_API_BASE=http://model-api:9543\n')
            env_file.chmod(0o600)
            await db.execute("UPDATE license_policy SET confirmed=0 WHERE policy_code='sound_and_renderer'")
            print(json.dumps({'prepared': True}))
            return
        state = json.loads(state_file.read_text())
        row = state['share']
        if mode == 'cleanup':
            policy = state['previous_policy']
            await db.execute("UPDATE license_policy SET confirmed=%s,decided_by=%s,decided_at=%s "
                             "WHERE policy_code='sound_and_renderer'", (policy['confirmed'], policy['decided_by'], policy['decided_at']))
            await db.execute('DELETE FROM api_call_log WHERE access_key_id=%s', (state['key_id'],))
            await db.execute('DELETE FROM access_key WHERE key_id=%s', (state['key_id'],))
            await db.execute('DELETE FROM operator_account WHERE operator_id=%s', (state['operator'],))
            await db.execute('DELETE FROM shared_score WHERE share_id=%s', (row['share_id'],))
            path = cfg.shared_scores_dir/'shared'/row['share_no']
            if path.resolve().parent != (cfg.shared_scores_dir.resolve()/'shared') or path.is_symlink():
                raise RuntimeError('시험 폴더 경로 범위 초과')
            if path.is_dir():
                shutil.rmtree(path)
            env_file.unlink(missing_ok=True)
            state_file.unlink()
            print(json.dumps({'cleaned': True, 'policy_restored': True}))
            return
        if mode != 'verify':
            raise ValueError('prepare·verify·cleanup 중 하나를 지정하십시오')
        key = next(s.split('=', 1)[1] for s in env_file.read_text().splitlines() if s.startswith('DEMO_API_KEY='))
        status, _, data = call('/v1/shared-scores')
        assert status == 401
        status, _, data = call('/v1/shared-scores', key=key)
        assert status == 200
        item = next(s for s in json.loads(data)['items'] if s['share_no'] == row['share_no'])
        assert item['example'] and 'owner_account_id' not in item and 'source_request_id' not in item
        score_path = f"/v1/shared-scores/{row['share_no']}/score"
        status, _, data = call(score_path, key=key)
        assert status == 200 and '<score-partwise' in json.loads(data)['musicxml']
        for field, value in [('unshared_at', 'UTC_TIMESTAMP(3)'), ('taken_down_at', 'UTC_TIMESTAMP(3)'),
                             ('purged_at', 'UTC_TIMESTAMP(3)'), ('expires_at', 'UTC_TIMESTAMP(3)-INTERVAL 1 DAY')]:
            await db.execute(f'UPDATE shared_score SET {field}={value} WHERE share_id=%s', (row['share_id'],))
            assert call(score_path, key=key)[0] == 404
            assert not json.loads(call('/v1/shared-scores', key=key)[2])['items']
            await db.execute(f'UPDATE shared_score SET {field}='+('NULL' if field != 'expires_at' else "'2037-12-31 23:59:59'")+' WHERE share_id=%s', (row['share_id'],))
        try:
            with (cfg.shared_scores_dir/'write-probe').open('xb'):
                pass
        except OSError as error:
            assert error.errno in (13, 30)
        else:
            (cfg.shared_scores_dir/'write-probe').unlink()
            raise AssertionError('공유 저장소는 읽기 전용이어야 합니다')
        base = 'http://issue93-demo:26102'
        for path in ['/demo/', '/demo/app.js', '/demo/style.css', '/demo/api/music']:
            status, _, data = call(path, base=base)
            assert status == 200 and key.encode() not in data
        selection = '/demo/api/bgm?'+urllib.parse.urlencode({'share': row['share_no'], 'inst': 'gayageum'})
        status, _, data = call(selection, base=base)
        assert status == 409 and json.loads(data)['error']['code'] == 'MP3_WITHHELD'
        await db.execute("UPDATE license_policy SET confirmed=1,decided_by=%s,decided_at=UTC_TIMESTAMP(3) "
                         "WHERE policy_code='sound_and_renderer'", (state['operator'],))
        status, headers, audio = call(selection, base=base)
        assert status == 200 and headers['Content-Type'] == 'audio/mpeg'
        with tempfile.TemporaryDirectory(prefix='issue93-audio-', dir=folder) as temp:
            from pathlib import Path
            mp3, wav = Path(temp)/'sample.mp3', Path(temp)/'sample.wav'
            mp3.write_bytes(audio)
            subprocess.run(['lame', '--quiet', '--decode', str(mp3), str(wav)],
                           capture_output=True, check=True, timeout=30)
            with wave.open(str(wav)) as decoded:
                rate, channels = decoded.getframerate(), decoded.getnchannels()
                frames = decoded.readframes(decoded.getnframes())
        samples = array.array('h', frames)
        rms = math.sqrt(sum(int(x)*int(x) for x in samples)/len(samples))
        assert rms > 10 and len(frames) > rate*channels*2
        await db.execute("UPDATE license_policy SET confirmed=0 WHERE policy_code='sound_and_renderer'")
        assert call(selection, base=base)[0] == 409  # 이전 MP3를 반환하는 캐시는 없다.
        await db.execute('UPDATE shared_score SET unshared_at=UTC_TIMESTAMP(3) WHERE share_id=%s', (row['share_id'],))
        assert call(selection, base=base)[0] == 404
        await db.execute('UPDATE shared_score SET unshared_at=NULL WHERE share_id=%s', (row['share_id'],))
        print(json.dumps({'external_key': True, 'list_and_score': True, 'hidden_states': 4, 'shared_volume_readonly': True,
                          'browser_responses_key_free': True, 'actual_mp3_bytes': len(audio),
                          'audio_seconds': round(len(frames)/(rate*channels*2), 2), 'audio_rms': round(rms, 2),
                          'policy_rechecked': True, 'withdrawal_rechecked': True}))
    finally:
        await db.close()


asyncio.run(main())
