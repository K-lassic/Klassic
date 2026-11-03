// #91 API 활용 안내 (UC11) — model-api 명세를 그대로 읽어 목록을 만들고, 서버가 멈추면 마지막 확인본을 보인다.
//
//   구조에서의 위치: 화면 /api-guide → Nginx(/api/*) → web(이 파일) → model-api /v1/health · /v1/versions · /v1/openapi.json.
//     1분에 한 번 DB api_spec_snapshot · api_endpoint · snapshot_engine_version 에 확인본을 저장한다.
//     안내에 보이는 외부 주소는 `PUBLIC_API_URL`. 내부 경로(/internal/)는 싣지 않는다.
//   v0.1.1 web/apiDocs.ts 에서 달라진 점: 예시의 경로 변수를 이름과 상관없이 바꾸고 (재구성판 경로는 {request_no}),
//     파일 칸 이름을 경로에 맞춘다 (인식은 image · 연주와 렌더링은 score).
import { Router } from 'express';
import { env } from '../config/env.js';
import { currentSettings } from '../config/settings.js';
import { shared } from '../config/shared.js';
import { one, query, tx } from '../db/pool.js';
import { ModelApiDown, modelJson } from '../services/modelApiClient.js';
import { wrap } from './errors.js';

export const apiDocsRouter = Router();

const publicApi = (): string => env().PUBLIC_API_URL.replace(/\/$/, '');

interface Endpoint { method: string; path: string; feature: string; input: string; response: string; example: string; engine: string | null }

function endpointsFromOpenApi(spec: any): Endpoint[] {
  const out: Endpoint[] = [];
  for (const [path, ops] of Object.entries<any>(spec.paths ?? {})) {
    if (path.includes('/internal/')) continue; // 내부용은 싣지 않는다
    for (const [method, op] of Object.entries<any>(ops)) {
      if (!['get', 'post'].includes(method)) continue;
      const body = op.requestBody?.content ? Object.keys(op.requestBody.content).join(', ') : '없음';
      const resp = Object.entries<any>(op.responses ?? {}).map(([code, r]) => `${code} ${r.description ?? ''}`.trim()).join(' · ');
      const isForm = body.includes('multipart');
      const url = `${publicApi()}${path.replace(/\{[^}]+\}/g, 'R-0928-XXXXXXXX')}`;
      const example = `curl -X ${method.toUpperCase()} "${url}" \\\n  -H "X-API-Key: <발급받은 키>"${isForm ? ` \\\n  -F "${path.includes('/omr/') ? 'image' : 'score'}=@악보.png"` : ''}`;
      out.push({ method: method.toUpperCase(), path, feature: op.summary ?? path, input: body, response: resp.slice(0, 500), example, engine: null });
    }
  }
  return out;
}

async function saveSnapshot(health: 'ok' | 'unreachable', version: string | null, endpoints: Endpoint[], engines: { name: string; version: string }[]) {
  await tx(async (conn) => {
    const [s] = await conn.query('INSERT INTO api_spec_snapshot (health_status, api_version) VALUES (?, ?)', [health, version]);
    const id = (s as { insertId: number }).insertId;
    for (const e of endpoints) {
      await conn.query(
        `INSERT INTO api_endpoint (snapshot_id, http_method, path, feature_name, input_format, response_format, example_text, engine_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, e.method, e.path.slice(0, 100), e.feature.slice(0, 100), e.input.slice(0, 500), e.response.slice(0, 500), e.example.slice(0, 2000), e.engine]);
    }
    for (const g of engines) {
      await conn.query('INSERT INTO snapshot_engine_version (snapshot_id, engine_name, engine_version) VALUES (?, ?, ?)',
        [id, g.name.slice(0, 40), (g.version || 'unknown').slice(0, 40)]);
    }
  });
}

let lastCheck = 0;

apiDocsRouter.get('/api-docs', wrap(async (_req, res) => {
  let server_status: 'running' | 'stopped' = 'stopped';
  let spec_source: 'live' | 'last_known' | 'none' = 'none';
  let endpoints: Endpoint[] = [];
  let apiVersion: string | null = null;
  try {
    const [health, versions, spec] = await Promise.all([
      modelJson<any>('GET', '/v1/health', undefined, { timeoutMs: 3000 }),
      modelJson<any>('GET', '/v1/versions', undefined, { timeoutMs: 3000 }),
      modelJson<any>('GET', '/v1/openapi.json', undefined, { timeoutMs: 3000 }),
    ]);
    server_status = 'running';
    spec_source = 'live';
    apiVersion = health.api_version ?? versions.api_version ?? 'v1';
    endpoints = endpointsFromOpenApi(spec);
    if (Date.now() - lastCheck > 60_000) {
      lastCheck = Date.now();
      await saveSnapshot('ok', apiVersion, endpoints, (versions.engines ?? []).map((e: any) => ({ name: e.name, version: e.version ?? 'unknown' })));
    }
  } catch (e) {
    if (!(e instanceof ModelApiDown)) throw e;
    const snap = await one<{ snapshot_id: number; api_version: string }>(
      "SELECT snapshot_id, api_version FROM api_spec_snapshot WHERE health_status = 'ok' ORDER BY snapshot_id DESC LIMIT 1");
    if (snap) {
      spec_source = 'last_known';
      apiVersion = snap.api_version;
      endpoints = (await query<any>('SELECT * FROM v_endpoint_menu')).map((e) => ({
        method: e.http_method, path: e.path, feature: e.feature_name, input: e.input_format, response: e.response_format,
        example: e.example_text ?? '', engine: e.engine_name }));
    }
    if (Date.now() - lastCheck > 60_000) { lastCheck = Date.now(); await saveSnapshot('unreachable', null, [], []); }
  }
  const s = await currentSettings();
  const API = publicApi();
  const { errorCodes } = shared();
  const checked = await one<{ checked_at: Date }>('SELECT checked_at FROM api_spec_snapshot ORDER BY snapshot_id DESC LIMIT 1');
  res.json({
    server_status, spec_source, api_version: apiVersion, endpoints,
    checked_at: checked ? new Date(checked.checked_at).toISOString() : null,
    guideline: {
      access_key: '가입·로그인한 뒤 \'API활용\' 메뉴의 [접근 키 신청]에서 양식을 내면 곧바로 키를 받습니다. 키는 그 화면에서 한 번만 보입니다. 요청마다 X-API-Key 머리글에 넣습니다.',
      call_limit: `새 키는 시간당 ${s.default_call_limit_per_hour ?? 30}회까지 부를 수 있습니다. 넘으면 429 와 다시 시도할 시각(retry_after)을 받습니다.`,
      error_format: '모든 오류는 { error: { code, message, fix, gate, retry_after, details }, api_version } 모양입니다. 입력이 약속과 다르면(필수 누락·모르는 필드·형식·범위·빈 파일) 422 VALIDATION_ERROR 이고 details.errors 에 어느 칸(loc)이 왜(msg) 틀렸는지 있습니다. 대체 결과는 오류가 아니라 200 + fallback=true 입니다.',
      validity: '인식 결과에는 타당성 등급(validity_grade)이 붙습니다: trust(믿을 만함) · caution(주의 — 결과는 주지만 확인이 필요) · distrust(불신 — 결과 대신 대체 선율, fallback=true · fallback_reason=UNTRUSTED_RESULT). 모두 200 이며 오류가 아닙니다. MIDI 를 만들지 못한 결과는 midi_available=false 이고 MusicXML 만 옵니다.',
      request_id: '모든 응답 머리글에 X-Request-ID(요청 번호표)가 붙습니다. 문의할 때 이 값을 알려 주십시오.',
      calling_from: '자기 서버·앱·명령줄에서 부르십시오. 다른 사이트의 웹페이지(브라우저)에서 직접 부르면 브라우저가 막습니다(CORS 를 허용하지 않음). 접근 키를 브라우저 코드에 넣지 마십시오.',
      version_policy: '경로 앞의 /v1 이 버전입니다. 같은 버전 안에서는 입력·응답 모양을 바꾸지 않습니다.',
      retention: '올린 파일과 결과는 24시간 뒤 지워집니다. 지난 결과를 부르면 410 RESULT_EXPIRED 를 받습니다.',
      usage_limits: errorCodes.status_codes.LICENSE_UNCONFIRMED + ' 연주 결과에서 MP3 가 빠지고 mp3_withheld=true 가 붙습니다.',
      attribution: '국악기 음원: 국립국악원 국악기 디지털 음원(공공누리 제1유형, 출처 표시).',
      supported_scores: '오선보와 정간보를 읽습니다. ' + errorCodes.status_codes.STAFF_NOTE + ' ' + errorCodes.status_codes.JEONGGANBO_NOTE + ' ' + errorCodes.status_codes.JEONGGANBO_SCOPE + ' 오선보는 인쇄된 악보를 잘 읽습니다. 손으로 쓴 악보는 아직 확인하지 않았습니다.',
    },
    manual: {
      first_request: [
        '1. 가입·로그인한 뒤 아래 신청 양식으로 접근 키를 받습니다.',
        `2. 악보 이미지로 연주 요청을 보냅니다: curl -X POST ${API}/v1/performances -H "X-API-Key: <키>" -F "score=@악보.png" -F "score_type=staff"`,
        `3. 2단계 응답(202)의 id 가 요청 번호입니다. 그 번호로 상태를 봅니다(status 가 completed 또는 completed_fallback 이 될 때까지): curl ${API}/v1/performances/<요청 번호> -H "X-API-Key: <키>"`,
        `4. 완료되면 결과를 받습니다: curl ${API}/v1/performances/<요청 번호>/result -H "X-API-Key: <키>"`,
      ],
      status_values: [
        { value: 'received', label: '접수' }, { value: 'converting', label: '변환' }, { value: 'rendering', label: '연주 생성' },
        { value: 'completed', label: '완료' }, { value: 'completed_fallback', label: '대체 완료' }, { value: 'expired', label: '만료' },
      ],
      error_codes: Object.entries(errorCodes.gate_codes)
        .filter(([, v]) => v.gate !== 'G5' && v.gate !== 'G6' && v.gate !== 'G12')
        // HTTP 는 모델 API 기준(api_http 가 있으면 그 값)
        .map(([code, v]) => ({ code, http: v.api_http ?? v.http, gate: v.gate, message: v.message })),
      fallback_reasons: Object.entries(errorCodes.fallback_reasons).filter(([k]) => !k.startsWith('$'))
        .map(([code, v]) => ({ code, message: v.message })),
    },
  });
}));
