import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ScoreDoc } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
export const fixture = (name: string) => new Uint8Array(readFileSync(join(here, 'fixtures', name)));
export const fixtureText = (name: string) => readFileSync(join(here, 'fixtures', name), 'utf8');
export const templateFile = (name: string) => new Uint8Array(readFileSync(join(here, '..', '..', '..', 'assets', 'templates', name)));
export const sharedJson = (name: string) => JSON.parse(readFileSync(join(here, '..', '..', '..', 'shared', name), 'utf8'));

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
