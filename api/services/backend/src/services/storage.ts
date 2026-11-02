// #34 파일 저장 — 사용자 파일은 볼륨 storage 안 <요청 번호>/ 폴더에, 대체 악보는 이미지 안 assets/ 에서 읽는다.
//
//   구조에서의 위치: web(requests.ts · 이후 작업자 #35 · 내보내기 #36) → 이 파일 → 볼륨 storage(/storage)
//     컨테이너는 read_only 라 쓸 수 있는 곳은 이 볼륨뿐이다. 저장 위치(상대 경로)는 DB *_uri 에 남긴다
//     → 주기 정리 · DB ↔ 파일 일치 확인이 DB 만 보고 지울 파일을 찾을 수 있다 (이전 발표 피드백 · 주기 작업 이슈).
//   v0.1.1 services/storage.ts 에서 달라진 점: assets 경로도 폴더 밖으로 나갈 수 없게 막고, 시작할 때 쓰기를 확인한다.
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { env } from '../config/env.js';

const ASSETS_PREFIX = 'assets/';
const WRITE_CHECK = '.write-check';

/** base 안의 절대 경로. 밖으로 나가는 경로(../ · 절대 경로)와 base 자신은 오류 */
function inside(base: string, p: string): string {
  const root = resolve(base);
  const abs = resolve(root, p);
  const rel = relative(root, abs);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`저장소 밖 경로: ${p}`);
  return abs;
}

/** DB 의 *_uri 에 넣는 값(저장소 기준 상대 경로)을 돌려준다 */
export async function saveFile(relPath: string, data: Uint8Array | string): Promise<string> {
  const abs = inside(env().STORAGE_DIR, relPath);
  await mkdir(resolve(abs, '..'), { recursive: true });
  await writeFile(abs, data);
  return relPath;
}

/** uri 가 assets/ 로 시작하면 이미지 안 파일(대체 악보), 아니면 저장소 파일 */
export async function readStored(uri: string): Promise<Buffer> {
  if (uri.startsWith(ASSETS_PREFIX)) return readFile(inside(env().ASSETS_DIR, uri.slice(ASSETS_PREFIX.length)));
  return readFile(inside(env().STORAGE_DIR, uri));
}

export async function removeRequestDir(requestNo: string): Promise<void> {
  await rm(inside(env().STORAGE_DIR, requestNo), { recursive: true, force: true });
}

/** #85 대체 악보처럼 이미지 안에 있는 파일인가 — 볼륨 확인 대상이 아니다 */
export function isAssetUri(uri: string): boolean {
  return uri.startsWith(ASSETS_PREFIX);
}

export async function storedFileExists(uri: string): Promise<boolean> {
  return stat(inside(env().STORAGE_DIR, uri)).then((s) => s.isFile(), () => false);
}

/** #85 볼륨의 모든 파일 — path 는 DB *_uri 와 같은 형식(저장소 기준, / 구분) */
export async function listStoredFiles(): Promise<Array<{ path: string; mtimeMs: number }>> {
  const root = resolve(env().STORAGE_DIR);
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files = entries.filter((f) => f.isFile() && f.name !== WRITE_CHECK);
  return Promise.all(files.map(async (f) => {
    const abs = join(f.parentPath, f.name);
    return { path: relative(root, abs).split(sep).join('/'), mtimeMs: (await stat(abs)).mtimeMs };
  }));
}

/** 볼륨이 붙어 있고 쓸 수 있는지 — 안 되면 시작하지 않는다 */
export async function checkStorage(): Promise<void> {
  const probe = join(resolve(env().STORAGE_DIR), WRITE_CHECK);
  await writeFile(probe, '');
  await rm(probe, { force: true });
}
