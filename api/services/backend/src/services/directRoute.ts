// #90 직행 경로 — 인식 없이 MusicXML 을 바로 결과로 만든다 ([이 악보로 작업하기])
//
//   구조에서의 위치: web/shared.ts → 이 파일 → 볼륨 storage(<요청 번호>/result.*) · DB score_result · ensemble.
//     model-api 를 부르지 않는다. 원래 악기 이름은 ensemble('original') 에 남겨 결과 화면이 보여 준다.
//   v0.1.1 services/directRoute.ts 에서 달라진 점: 재구성판은 MIDI · MusicXML 업로드를 받지 않으므로 MusicXML 만 다룬다.
//     문서를 먼저 읽은 쪽(shared.ts)에서 받아, 읽지 못하는 파일이 저장소에 남지 않게 한다.
import { toMidi, type ScoreDoc } from '@gugak/score-core';
import { tx } from '../db/pool.js';
import { saveFile } from './storage.js';

export async function completeDirect(requestId: number, requestNo: string, doc: ScoreDoc, musicxml: string): Promise<void> {
  const xmlUri = await saveFile(`${requestNo}/result.musicxml`, musicxml);
  const midUri = await saveFile(`${requestNo}/result.mid`, toMidi(doc));
  const originals = doc.parts.filter((p) => p.sourceInstrument?.name);
  await tx(async (conn) => {
    let ensembleId: number | null = null;
    if (originals.length > 0) {
      const [ins] = await conn.query("INSERT INTO ensemble (ensemble_kind) VALUES ('original')");
      ensembleId = (ins as { insertId: number }).insertId;
      for (const [i, p] of originals.entries()) {
        const src = p.sourceInstrument!;
        await conn.query(
          `INSERT INTO ensemble_member (ensemble_id, part_no, part_role, original_instrument_name, original_midi_program)
           VALUES (?, ?, ?, ?, ?)`,
          [ensembleId, i + 1, p.isPercussion ? 'percussion' : 'melody', src.name!.slice(0, 100),
           src.program != null && src.program >= 0 && src.program <= 127 ? src.program : null]);
      }
    }
    await conn.query(
      "INSERT INTO score_result (request_id, origin, musicxml_uri, midi_uri, original_ensemble_id) VALUES (?, 'direct', ?, ?, ?)",
      [requestId, xmlUri, midUri, ensembleId]);
    await conn.query("UPDATE score_request SET status = 'completed', completed_at = CURRENT_TIMESTAMP(3) WHERE request_id = ?", [requestId]);
  });
}
