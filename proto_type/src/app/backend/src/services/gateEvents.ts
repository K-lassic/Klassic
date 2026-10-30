// 게이트 이벤트 기록 (tasks T026): gate_event 에 G1~G15(G13 권한·G14 가입·G15 로그인 잠금은 2026-09-29 RBAC). 주소는 해시만(FR-063).
import { exec } from '../db/pool.js';
import { logger } from '../lib/logger.js';

export type GateCode = 'G1' | 'G2' | 'G3' | 'G4' | 'G5' | 'G6' | 'G7' | 'G8' | 'G10' | 'G11' | 'G12' | 'G13' | 'G14' | 'G15' | 'G16';
export type SubjectType = 'session' | 'access_key' | 'api_call' | 'request' | 'operator' | 'soundfont' | 'setting_version' | 'client' | 'account';

export async function recordGate(
  gate: GateCode, channel: 'web' | 'api' | 'admin', subjectType: SubjectType, subjectRef: string | null, reasonCode: string,
): Promise<void> {
  try {
    await exec(
      'INSERT INTO gate_event (gate_code, channel, subject_type, subject_ref, reason_code) VALUES (?, ?, ?, ?, ?)',
      [gate, channel, subjectType, subjectRef, reasonCode],
    );
  } catch (e) {
    // 기록 실패가 사용자 흐름을 막지 않게 한다
    logger.warn({ err: e, gate, reasonCode }, 'gate_event insert failed');
  }
}
