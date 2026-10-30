import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ScoreDoc } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
export const fixture = (name: string) => new Uint8Array(readFileSync(join(here, 'fixtures', name)));
export const fixtureText = (name: string) => readFileSync(join(here, 'fixtures', name), 'utf8');
// 대체 템플릿 gutgeori-v1 은 바뀌지 않는 옛 판본이라 시험 자료로 복사해 둔다 (v0.1.1 assets/templates, #18)
export const templateFile = (name: string) => new Uint8Array(readFileSync(join(here, 'fixtures', 'templates', name)));
// 악기 목록은 복사본이 아니라 api/shared 의 실제 파일과 맞춰 본다. 파일이 아직 없으면(#19 이전) 그 시험만 건너뛴다
const sharedPath = (name: string) => join(here, '..', '..', '..', 'shared', name);
export const hasShared = (name: string) => existsSync(sharedPath(name));
export const sharedJson = (name: string) => JSON.parse(readFileSync(sharedPath(name), 'utf8'));

/** 음표 비교용 모양(시작+길이:음@세기) */
export const noteKey = (doc: ScoreDoc) =>
  doc.parts.map((p) => p.notes.map((n) => `${n.id}|${n.startTick}+${n.durationTicks}:${n.pitch}@${n.velocity}`));
export const partKey = (doc: ScoreDoc) =>
  doc.parts.map((p) => ({ id: p.id, name: p.name, instrument: p.instrument, isPercussion: p.isPercussion, sourceInstrument: p.sourceInstrument, volume: p.volume, origin: p.origin }));

export function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    Object.freeze(o);
    for (const v of Object.values(o as object)) deepFreeze(v);
  }
  return o;
}
