// 예시 공유 악보 넣기 (2026-09-30 조성기 — design/UC_18 BR-SHR-08 · SD_01 9.9 · SD_03 §11B)
// S1 [예시 파일 고르기] 목록(examples.json)의 악보를 모델 API 로 인식해, 결과 MusicXML 을 공유 악보로 넣는다.
// 예시 행은 올린 사람 · 요청이 없고 expires_at 2037-12-31(3일 정리 제외). 이미 넣은 예시는 건너뛴다. 대체로 끝난 예시는 넣지 않는다.
// 실행: npm run shared:seed-examples (app/backend 에서)
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { exec, one, closePool } from '../db/pool.js';
import { EXAMPLES_DIR, exampleList } from '../web/examples.js';
import { modelJson, blobOf } from '../services/modelApiClient.js';
import { saveFile } from '../services/storage.js';
import { newShareNo } from '../lib/ids.js';

const EXAMPLE_EXPIRES = '2037-12-31 23:59:59';
const TIMEOUT_MS = 10 * 60_000;

interface Recognition { fallback: boolean; fallback_reason: string | null; validity_grade: string | null; musicxml: string | null }

async function main(): Promise<void> {
  let added = 0;
  for (const e of exampleList()) {
    const had = await one<{ share_no: string }>('SELECT share_no FROM shared_score WHERE example_id = ?', [e.id]);
    if (had) { console.log(`건너뜀 ${e.id} — 이미 있음(${had.share_no})`); continue; }
    const data = await readFile(resolve(EXAMPLES_DIR, e.file));
    const form = new FormData();
    form.append('image', blobOf(data), e.file);
    const started = Date.now();
    const r = await modelJson<Recognition>('POST', `/v1/omr/${e.score_type}`, form, { timeoutMs: TIMEOUT_MS });
    const sec = ((Date.now() - started) / 1000).toFixed(1);
    if (r.fallback || !r.musicxml) { console.log(`넣지 않음 ${e.id} — 대체(${r.fallback_reason ?? '결과 없음'}), ${sec}초`); continue; }
    const shareNo = newShareNo();
    const uri = await saveFile(`shared/${shareNo}/score.musicxml`, r.musicxml);
    await exec(
      `INSERT INTO shared_score (share_no, source_request_id, owner_account_id, example_id, title, score_type, musicxml_uri, expires_at)
       VALUES (?, NULL, NULL, ?, ?, ?, ?, ?)`,
      [shareNo, e.id, e.title, e.score_type, uri, EXAMPLE_EXPIRES]);
    added += 1;
    console.log(`넣음 ${e.id} → ${shareNo} (등급 ${r.validity_grade ?? '-'}, ${sec}초)`);
  }
  console.log(`끝 — 새로 넣은 예시 ${added}개`);
}

main().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => { void closePool(); });
