// #34 예시 악보 — 시연 때 파일 없이 [예시 파일 고르기]로 올린다. 브라우저는 파일이 아니라 예시 id 만 보낸다.
//
//   구조에서의 위치: 화면 → Nginx → web(이 파일) → 이미지 안 assets/examples/ (정적 공개 폴더가 아니라 외부 주소로 받을 수 없다).
//     서버가 examples.json 목록에 있는 id 의 파일로 보통 올리기와 같게 접수한다 (같은 검사 · 같은 한도).
//   v0.1.1 web/examples.ts 와 같은 동작.
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { Router, type RequestHandler } from 'express';
import { env } from '../config/env.js';
import { ApiError, wrap } from './errors.js';

export interface ExampleEntry { id: string; title: string; score_type: 'staff' | 'jeongganbo'; file: string }

const examplesDir = () => resolve(env().ASSETS_DIR, 'examples');

let cache: ExampleEntry[] | null = null;
/** 목록(examples.json) — 한 번 읽어 둔다 */
export function exampleList(): ExampleEntry[] {
  if (cache) return cache;
  const raw = JSON.parse(readFileSync(resolve(examplesDir(), 'examples.json'), 'utf8')) as { items: ExampleEntry[] };
  cache = raw.items.filter((e) => /^[a-z0-9-]+$/.test(e.id) && !/[\\/]|\.\./.test(e.file));
  return cache;
}

/** 목록에 있는 id 만 — 없는 id · 경로 문자(../ 등)는 404 */
function findExample(id: unknown): ExampleEntry {
  if (typeof id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(id)) throw new ApiError('REQUEST_NOT_FOUND');
  const e = exampleList().find((x) => x.id === id);
  if (!e) throw new ApiError('REQUEST_NOT_FOUND');
  return e;
}

function inside(path: string): string {
  const p = resolve(examplesDir(), path);
  if (!p.startsWith(examplesDir() + sep)) throw new ApiError('REQUEST_NOT_FOUND');
  return p;
}

export const examplesRouter = Router();

examplesRouter.get('/examples', (_req, res) => {
  res.json({ items: exampleList().map(({ id, title, score_type }) => ({ id, title, score_type })) });
});

// 미리보기 — 짧은 변 200px JPEG(thumbs/<id>.jpg). 권한표에서 UC1(로그인 사용자)만
examplesRouter.get('/examples/:id/thumb', wrap(async (req, res) => {
  const e = findExample(req.params.id);
  const data = await readFile(inside(`thumbs/${e.id}.jpg`)).catch(() => { throw new ApiError('REQUEST_NOT_FOUND'); });
  res.set('Cache-Control', 'private, max-age=3600').type('image/jpeg').send(data);
}));

/** POST /requests/example — 예시 파일을 multer 가 받은 파일처럼 req.files 에 넣어 올리기 처리로 넘긴다 */
export const receiveExample: RequestHandler = wrap(async (req, res, next) => {
  const e = findExample(req.body?.example_id);
  const buffer = await readFile(inside(e.file)).catch(() => { throw new ApiError('REQUEST_NOT_FOUND'); });
  req.files = [{ originalname: e.file, size: buffer.length, buffer } as Express.Multer.File];
  // 예시로 올린 요청임을 남긴다 — createRequest 가 score_request.example_id 에 적는다
  res.locals.exampleId = e.id;
  const t = req.body?.score_type;
  req.body = { score_type: t === 'staff' || t === 'jeongganbo' ? t : e.score_type };
  next();
});
