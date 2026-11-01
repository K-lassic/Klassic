// #23 백엔드 시작점 — node dist/server.js --role=web | --role=admin
//
//   구조에서의 위치: 같은 이미지를 실행 인자만 바꿔 web · admin 두 컨테이너로 띄운다 (v0.1.1 과 같음 · 조정안 B 안 함).
//   시작 순서: 설정 검증(H1) → 공용 설정 읽기(api/shared) → DB 준비 기다리기(재시도) → 설정 판본 확인
//     → web 만: 저장소 쓰기 · 예시 목록 확인(#34) · 인식 작업자 시작(#35) → 수신(0.0.0.0)
//   종료: Docker 가 보내는 SIGTERM 을 받아 새 연결을 멈추고 DB 풀을 닫는다 (Dockerfile 은 exec 형식이라 node 가 PID 1)
import type { Server } from 'node:http';
import { env } from './config/env.js';
import { shared } from './config/shared.js';
import { currentSettings } from './config/settings.js';
import { closePool, waitForDb } from './db/pool.js';
import { createAdminApp, createWebApp } from './app.js';
import { checkStorage } from './services/storage.js';
import { startWorker, stopWorker } from './services/requestWorker.js';
import { recoverRenders } from './services/renderQueue.js';
import { checkSoundfonts } from './web/instruments.js';
import { exampleList } from './web/examples.js';
import { logger } from './lib/logger.js';

type Role = 'web' | 'admin';

function roleFromArgs(): Role {
  const role = process.argv.find((a) => a.startsWith('--role='))?.split('=')[1];
  if (role !== 'web' && role !== 'admin') throw new Error('--role=web 또는 --role=admin 이 필요합니다');
  return role;
}

async function main(): Promise<void> {
  const role = roleFromArgs();
  const e = env();
  const s = shared();
  logger.info({ role, shared_dir: e.SHARED_DIR, rules_version: s.uploadRules.version, rules_hash: s.uploadRulesHash,
    error_codes: Object.keys(s.errorCodes.gate_codes).length }, '공용 설정 읽음');

  await waitForDb();
  const settings = await currentSettings();
  // 업로드 규칙 파일과 설정 판본의 MIDI · MusicXML 상한이 다르면 알린다 — 설정 판본 값이 우선 (기능 목록 H3)
  const ruleBytes = s.uploadRules.kinds.midi?.max_bytes;
  if (ruleBytes != null && settings.score_file_max_bytes !== ruleBytes) {
    logger.warn({ settings: settings.score_file_max_bytes, rules: ruleBytes }, 'score_file_max_bytes 가 upload-rules.json 과 다름 — 설정 판본 값을 쓴다');
  }

  // #34 받을 준비를 시작할 때 확인한다 — 첫 업로드에서야 터지지 않게 (작성규칙 1-1 · 진단 가능한 실패)
  if (role === 'web') {
    await checkStorage();
    logger.info({ storage_dir: e.STORAGE_DIR, examples: exampleList().length }, '저장소 · 예시 목록 확인');
    checkSoundfonts();
  }

  // 인식 작업자는 web 에서만 — 끝나지 않은 요청을 DB 에서 다시 줄 세운다 (#35). 렌더링 복구는 #36. 주기 작업도 여기에 붙인다 (주기 작업 이슈)
  if (role === 'web') {
    await startWorker();
    await recoverRenders();
  }

  const server: Server = role === 'web'
    ? createWebApp().listen(e.WEB_PORT, e.WEB_HOST, () => logger.info({ host: e.WEB_HOST, port: e.WEB_PORT, setting_version: settings.setting_version_id }, 'web 수신 시작'))
    : createAdminApp().listen(e.ADMIN_PORT, e.ADMIN_HOST, () => logger.info({ host: e.ADMIN_HOST, port: e.ADMIN_PORT, setting_version: settings.setting_version_id }, 'admin 수신 시작'));

  const stop = (signal: string) => {
    logger.info({ signal }, '종료 신호 — 새 연결을 멈춘다');
    stopWorker();
    server.close(() => { void closePool().finally(() => process.exit(0)); });
    // 오래 걸리는 연결이 있어도 10초 뒤에는 끝낸다 (Docker 기본 stop 대기 10초)
    setTimeout(() => process.exit(0), 9000).unref();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, '시작 실패');
  process.exit(1);
});
