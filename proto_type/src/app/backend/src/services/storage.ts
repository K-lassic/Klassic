// 파일 저장 (tasks T027): storage/<request_no>/original.<ext>, 결과물, 안전한 삭제
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { env, APP_ROOT } from '../config/env.js';

const ROOT = resolve(env.STORAGE_DIR);

function safe(p: string): string {
  const abs = resolve(ROOT, p);
  const rel = relative(ROOT, abs);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`path escapes storage: ${p}`);
  return abs;
}

/** 저장 위치 문자열(DB 의 *_uri)은 storage 기준 상대 경로 */
export async function saveFile(relPath: string, data: Uint8Array | string): Promise<string> {
  const abs = safe(relPath);
  await mkdir(resolve(abs, '..'), { recursive: true });
  await writeFile(abs, data);
  return relPath;
}

export async function readStored(uri: string): Promise<Buffer> {
  // 대체 템플릿은 app/assets 아래에 있다(uri 가 assets/ 로 시작)
  if (uri.startsWith('assets/')) return readFile(resolve(APP_ROOT, uri));
  return readFile(safe(uri));
}

export async function removeRequestDir(requestNo: string): Promise<void> {
  await rm(safe(requestNo), { recursive: true, force: true });
}

export async function removeStored(uri: string): Promise<void> {
  if (uri.startsWith('assets/')) return;
  await rm(safe(uri), { force: true, recursive: true });
}

export function storagePath(relPath: string): string {
  return safe(relPath);
}
