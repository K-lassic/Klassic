// #34 저장 경로 보호 — 저장소 · assets 밖으로 나갈 수 없다. 마감 계산은 화면(deadline_at)과 감시(#35)가 같이 쓴다.
import '../helpers/env.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkStorage, readStored, removeRequestDir, saveFile } from '../../src/services/storage.js';
import { DEADLINE_GRACE_MS, requestDeadlineMs } from '../../src/services/requestWorker.js';
import { newRequestNo } from '../../src/lib/ids.js';

describe('저장소', () => {
  it('저장 → 읽기 → 요청 폴더 지우기, DB 에는 상대 경로만 남긴다', async () => {
    await checkStorage();
    expect(await saveFile('R-1/original.png', 'x')).toBe('R-1/original.png');
    expect((await readStored('R-1/original.png')).toString()).toBe('x');
    await removeRequestDir('R-1');
    expect(existsSync(join(process.env.STORAGE_DIR!, 'R-1'))).toBe(false);
  });

  it.each(['../evil.txt', '/etc/passwd', 'a/../../evil.txt'])('저장소 밖 경로 %s 는 막는다', async (p) => {
    await expect(saveFile(p, 'x')).rejects.toThrow('저장소 밖 경로');
    await expect(readStored(p)).rejects.toThrow('저장소 밖 경로');
  });

  it('저장소 폴더 자체를 지우는 값은 막는다', async () => {
    await expect(removeRequestDir('.')).rejects.toThrow('저장소 밖 경로');
    await expect(removeRequestDir('')).rejects.toThrow('저장소 밖 경로');
  });

  it('assets/ 경로는 이미지 안 대체 악보 — 밖으로는 못 나간다', async () => {
    expect((await readStored('assets/templates/minuet-g-v1.musicxml')).toString()).toContain('score-partwise');
    await expect(readStored('assets/../../package.json')).rejects.toThrow('저장소 밖 경로');
  });
});

describe('요청 번호 · 마감', () => {
  it('요청 번호 모양 — score_request.request_no(20자) 안', () => {
    const no = newRequestNo(new Date('2026-11-01T00:00:00Z'));
    expect(no).toMatch(/^R-1101-[A-HJ-NP-Z2-9]{8}$/);
    expect(no.length).toBeLessThanOrEqual(20);
  });

  const received = new Date('2026-09-30T06:00:00Z');
  it('대기 중이면 접수 + 제한 × 쪽 수', () => {
    expect(requestDeadlineMs(received, null, 180, 2)).toBe(received.getTime() + 360_000);
  });
  it('처리를 시작했으면 시작 시각부터 — 줄에서 기다린 시간은 깎지 않는다', () => {
    const started = new Date(received.getTime() + 300_000);
    expect(requestDeadlineMs(received, started, 180, 1)).toBe(started.getTime() + 180_000 + DEADLINE_GRACE_MS);
    expect(requestDeadlineMs(received, started, 180, 1, false)).toBe(started.getTime() + 180_000);
  });
  it('제한이 없으면 180초, 쪽 수는 최소 1', () => {
    expect(requestDeadlineMs(received, null, null, 0)).toBe(received.getTime() + 180_000);
  });
});
