// 직행 경로 (tasks T083, FR-004·FR-056): MIDI·MusicXML 은 인식 없이 악보로. 원래 악기 정보는 ensemble('original')에 보존한다.
import { parseMidi, parseMusicXml, toMidi, toMusicXml, type ScoreDoc } from '@gugak/score-core';
import { tx } from '../db/pool.js';
import { saveFile } from './storage.js';

export interface DirectResult { noteCount: number; hasOriginal: boolean }

export function parseScoreFile(kind: 'midi' | 'musicxml', data: Buffer, musicxmlText?: string): ScoreDoc {
  return kind === 'midi' ? parseMidi(new Uint8Array(data)) : parseMusicXml(musicxmlText ?? new Uint8Array(data));
}

export async function completeDirect(
  requestId: number, requestNo: string, kind: 'midi' | 'musicxml', data: Buffer, musicxmlText?: string,
): Promise<DirectResult> {
  const doc = parseScoreFile(kind, data, musicxmlText);
  const musicxml = kind === 'musicxml' && musicxmlText ? musicxmlText : toMusicXml(doc);
  const midi = kind === 'midi' ? new Uint8Array(data) : toMidi(doc);
  const xmlUri = await saveFile(`${requestNo}/result.musicxml`, musicxml);
  const midUri = await saveFile(`${requestNo}/result.mid`, midi);
  const originals = doc.parts.filter((p) => p.sourceInstrument?.name);
  const noteCount = doc.parts.reduce((n, p) => n + p.notes.length, 0);
  await tx(async (conn) => {
    let ensembleId: number | null = null;
    if (originals.length > 0) {
      const [ins] = await conn.query("INSERT INTO ensemble (ensemble_kind) VALUES ('original')");
      ensembleId = (ins as { insertId: number }).insertId;
      let partNo = 1;
      for (const p of doc.parts) {
        const src = p.sourceInstrument;
        if (!src?.name) continue;
        await conn.query(
          `INSERT INTO ensemble_member (ensemble_id, part_no, part_role, original_instrument_name, original_midi_program)
           VALUES (?, ?, ?, ?, ?)`,
          [ensembleId, partNo++, p.isPercussion ? 'percussion' : 'melody', src.name.slice(0, 100),
           src.program != null && src.program >= 0 && src.program <= 127 ? src.program : null]);
      }
    }
    await conn.query(
      `INSERT INTO score_result (request_id, origin, musicxml_uri, midi_uri, original_ensemble_id) VALUES (?, 'direct', ?, ?, ?)`,
      [requestId, xmlUri, midUri, ensembleId]);
    await conn.query(
      "UPDATE score_request SET status = 'completed', completed_at = CURRENT_TIMESTAMP(3) WHERE request_id = ?", [requestId]);
  });
  return { noteCount, hasOriginal: originals.length > 0 };
}
