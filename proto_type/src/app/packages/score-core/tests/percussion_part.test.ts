// (2026-09-30 황송해 145번) 타악기는 타악 성부에만 · 선율 악기는 선율 성부에만 — 성부 종류는 악기로 바뀌지 않는다
import { describe, expect, it } from 'vitest';
import { applyOps, parseMusicXml, validateOps } from '../src/index.js';
import { fixtureText } from './helpers.js';

describe('change_instrument 성부 종류', () => {
  const doc = () => parseMusicXml(fixtureText('two-parts.musicxml'));
  it('선율 성부에 북을 놓으면 건너뛰고(성부는 선율 그대로) 오류로 알린다 · 그 뒤 선율 악기는 그대로 바뀐다', () => {
    const d = doc();
    const melody = d.parts.findIndex((p) => !p.isPercussion);
    expect(melody).toBeGreaterThanOrEqual(0);
    const before = d.parts[melody].instrument;
    const out = applyOps(d, [{ op: 'change_instrument', part: melody, instrument: 'buk' }]);
    expect(out.parts[melody].isPercussion).toBe(false);
    expect(out.parts[melody].instrument).toBe(before);
    expect(validateOps(d, [{ op: 'change_instrument', part: melody, instrument: 'buk' }])[0]).toContain('타악기는 타악 성부에만');
    const out2 = applyOps(d, [{ op: 'change_instrument', part: melody, instrument: 'buk' }, { op: 'change_instrument', part: melody, instrument: 'daegeum' }]);
    expect(out2.parts[melody].instrument).toBe('daegeum');
    expect(out2.parts[melody].isPercussion).toBe(false);
  });
});
