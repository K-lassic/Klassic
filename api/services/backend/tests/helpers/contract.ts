// #44 계약 대조 — 시험 서버가 내보내는 모든 JSON 응답을 api/contracts/web-api.yaml 과 맞춰 본다.
//   serve() 가 앱 앞에 끼운다. 시험을 따로 쓰지 않아도 기존 통합 시험의 정상 · 오류 응답이 모두 대조 대상이 된다.
//   어긋난 응답은 모아 두었다가 시험 파일이 끝날 때 실패로 알린다. CONTRACT_LOG 를 주면 지나간 경로를 파일에 남긴다(어느 P1 경로를 시험했는지 확인용).
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';
import type { NextFunction, Request, Response } from 'express';

const here = dirname(fileURLToPath(import.meta.url));
const CONTRACT = process.env.CONTRACT_FILE ?? join(here, '..', '..', '..', '..', 'contracts', 'web-api.yaml');

interface ResponseDef { $ref?: string; content?: Record<string, { schema?: unknown }> }
interface Operation { responses: Record<string, ResponseDef>; 'x-priority'?: string; 'x-uc'?: string }
export type ContractDoc = { paths: Record<string, Record<string, Operation>>; components: { responses: Record<string, ResponseDef> } };

export const contract = parse(readFileSync(CONTRACT, 'utf8')) as ContractDoc;

const ajv = new Ajv2020({ strict: false, allErrors: true, allowUnionTypes: true });
(addFormats as unknown as (a: Ajv2020) => void)(ajv);
ajv.addSchema(contract as never, 'contract');

/** 경로 틀 → 정규식. 변수가 적은 경로가 먼저 — /api/requests/example 이 /api/requests/{no} 보다 앞 */
const routes = Object.keys(contract.paths)
  .sort((a, b) => a.split('{').length - b.split('{').length)
  .map((template) => ({ template, re: new RegExp(`^${template.replace(/\{[^}]+\}/g, '[^/]+')}$`) }));

const pointer = (...parts: string[]) => `contract#/${parts.map((p) => p.replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}`;

/** 어긋난 내용. 맞으면 null */
export function checkResponse(method: string, template: string, status: number, body: unknown): string | null {
  const op = contract.paths[template]?.[method.toLowerCase()];
  if (!op) return `계약에 없는 메서드: ${method} ${template}`;
  // 아직 만들지 않은 P2 · P3 경로의 404 는 정상 (대응표에 있어도 라우터가 없다)
  if (status === 404 && op['x-priority'] !== 'P1') return null;
  // 역할 판정(authz)은 모든 경로에 공통이라 경로마다 적지 않았다 — 오류 응답 모양만 본다
  const def = op.responses[String(status)] ?? (status === 403 ? { $ref: '#/components/responses/Error' } : undefined);
  if (!def) return `${method} ${template} — 계약에 없는 상태 ${status}: ${JSON.stringify(body).slice(0, 160)}`;
  const named = def.$ref?.replace('#/components/responses/', '');
  const content = named ? contract.components.responses[named].content : def.content;
  if (!content?.['application/json']?.schema) return null;
  const at = named
    ? pointer('components', 'responses', named, 'content', 'application/json', 'schema')
    : pointer('paths', template, method.toLowerCase(), 'responses', String(status), 'content', 'application/json', 'schema');
  const validate = ajv.compile({ $ref: at });
  if (validate(body)) return null;
  const why = (validate.errors ?? []).slice(0, 4).map((e) => `${e.instancePath || '/'} ${e.message}`).join(' · ');
  return `${method} ${template} ${status} — ${why}`;
}

export const violations = new Set<string>();

/** 앱 앞에 끼우는 미들웨어 — JSON 응답을 대조하고, 끝난 응답의 경로를 기록한다 */
export function contractRecorder(req: Request, res: Response, next: NextFunction): void {
  const path = req.originalUrl.split('?')[0];
  const template = routes.find((r) => r.re.test(path))?.template;
  if (!template) { next(); return; }
  const json = res.json.bind(res);
  res.json = (body: unknown) => {
    const problem = checkResponse(req.method, template, res.statusCode, body);
    if (problem) violations.add(problem);
    return json(body);
  };
  res.on('finish', () => {
    if (process.env.CONTRACT_LOG) appendFileSync(process.env.CONTRACT_LOG, `${req.method} ${template} ${res.statusCode}\n`);
  });
  next();
}
