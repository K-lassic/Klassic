// #44 시험 파일이 끝날 때 계약 대조 결과를 확인한다 — vitest setupFiles 로 불러 모든 시험 파일에 걸린다.
//   serve.ts 는 beforeAll 안에서 import 되어 거기서 등록한 afterAll 은 돌지 않는다. 그래서 검사를 여기에 둔다.
import { afterAll, expect } from 'vitest';
import { violations } from './contract.js';

afterAll(() => {
  expect([...violations].sort(), '응답이 계약(web-api.yaml)과 다르다').toEqual([]);
});
