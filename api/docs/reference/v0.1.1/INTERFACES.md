# 구현 인터페이스 약속 (app/ 공통)

> 작성: 박예은 팀장 세션 `/speckit.implement` · 2026-09-28
> 이 문서는 **구현이 서로 맞물리는 지점**만 적는다. 요구의 근거는 `specs/001-gugak-score-conversion/`(spec·plan·research·tasks)와 `design/`(UC·SD_01·SD_02·SD_03)에 있다.
> 계약 문서(`contracts/*.yaml`)와 이름이 다른 곳은 **이 문서가 우선**이다(tasks.md 기준 1: DB 는 SD_03 이름). 계약 문서 갱신은 T140.
> **2026-09-29 변경(황송해, 사진·PDF 입력)**: 사용자가 올리는 파일은 **사진(PNG·JPG(JPEG)·WEBP) 또는 PDF 한 개 — 웹·연주 API·`/v1/omr` 같음**(`shared/upload-rules.json` `user_upload_kinds`). MIDI·MusicXML 은 어디서든 415 `UPLOAD_UNSUPPORTED_TYPE`(G1, 직행 없음). PDF 는 모델 API 가 첫 쪽을 300dpi PNG 로 바꿔(pypdfium2) 사진과 같은 흐름으로 처리하고, 여러 쪽이면 응답 `notice`(`PDF_FIRST_PAGE_ONLY` "PDF 첫 쪽만 변환했어요 (전체 N쪽)")를 준다. 손상·암호 PDF 는 422 `UPLOAD_CORRUPTED`. DB migration 007.

> **2026-09-29 변경(황송해, 여러 쪽 · PDF 확인 불가)**: 한 요청 = 악보 한 곡 — **PDF 한 개(모든 쪽을 300dpi PNG 로) 또는 사진 여러 장(올린 순서), 최대 10쪽**(웹·연주 API·`/v1/omr` 같음). PDF 여러 개·PDF+사진 섞기는 400 `UPLOAD_TOO_MANY_FILES`, 11장·11쪽 이상은 400 `UPLOAD_TOO_MANY_PAGES`(G1). 쪽마다 구조 확인 → 엔진 → 타당성(처리 시간 제한은 쪽마다, 전체 마감 = 쪽 수 × 제한), 성공한 쪽을 순서대로 이어 붙여 MusicXML/MIDI 하나로. 일부 쪽 실패면 `notice`(`PAGES_PARTIAL` "N쪽 중 M쪽 변환했어요 (못 읽은 쪽: 3·7쪽)"), 모두 실패면 대체. 'PDF 첫 쪽만'(`PDF_FIRST_PAGE_ONLY`)은 더 내지 않는다. 웹이 모델 API 에 닿지 않아 PDF 를 검사하지 못하면 503 `UPLOAD_CHECK_UNAVAILABLE`(요청 행 없음). DB migration 010_multi_page(`request_page` · `upload_file.file_no` · `engine_attempt.page_no` · `stage_timing.page_no`).
> **2026-09-29 변경(황송해)**: 사용자 음원(.sf2, spec US8) 기능 제거 — `sf2Ref`·`assign_sf2`·`/api/sf2*`·`/v1/internal/sf2*`·`sf2_files`·악기 목록 `custom` 묶음·SF2_* 코드·게이트 G8 없음(DB `user_soundfont`·`edited_track.soundfont_id` 는 남기되 쓰지 않음). 오선보 엔진 homr → Audiveris(oemer 제거). 추천 LLM 답 규칙 완화(§6). 타악 성부가 없으면 타악 파트를 새로 만들지 않음. 악기 선택 기록은 실제로 놓인 악기만(§4).

## 0. 기준

| 항목 | 값 |
|---|---|
| DB | MariaDB. 스키마 = `app/db/migrations/001~003` (SD_03 + 보완 + 모델 등록부). 시각은 UTC(`SET time_zone='+00:00'`) |
| 개발 DB | `bash ops/devdb.sh start` → `127.0.0.1:26133`, 사용자 `gugak_dev`/`gugak_dev`, DB `gugak_dev`(개발)·`gugak_test`(시험). **팀 DB 에는 사람이 명시적으로 `npm run db:migrate` 할 때만 적용** |
| 포트 | 교수님 배정: 프런트엔드 9503(외부 공개 입구 `ops/gateway.mjs`) · 백엔드 9523(웹, 127.0.0.1) · API 서버 9543(모델 API, 127.0.0.1). 내부 포트: 관리자 26101(127.0.0.1) — 외부 주소 `https://p3.sumzip.com`(화면), `https://p3.sumzip.com/api/v1/...`(모델 API) (research R14, 2026-09-29 · 2026-09-30 배정 포트) |
| 스타일 | `design/style-guide/`(Mastercard 판) **만** 쓴다: `스타일가이드_mastercard.html` 의 `:root` 토큰 → `frontend/src/styles/tokens.css`, 컴포넌트·상태 칩 규칙은 `스타일가이드_매뉴얼_mastercard.md`(§6-1 완료 먹 칩 · 대체 파란 테두리 칩 · 반려 갈색 칩 · 주의 주황 점). 새 색·새 글꼴을 만들지 않는다. 사용자·관리자 화면 모두 같은 토큰 |
| 언어 | 화면 문구 한국어(쉬운 말). 코드·키 이름 영어 |
| 공유 파일 | `shared/upload-rules.json` · `shared/error-codes.json` · `shared/instruments.json` — 두 언어가 같은 파일을 읽는다 |

## 1. 식별자와 값 이름 (SD_03)

- **요청 번호** `request_no`: `R-MMDD-` + 무작위 8자(대문자·숫자, 헷갈리는 0/O/1/I 제외). 예 `R-0928-7KQ4M2XZ`. 화면·API 경로의 `{id}` 는 이것이다. 웹은 **같은 세션만** 볼 수 있다(아니면 `REQUEST_NOT_FOUND`).
- **신청 번호** `application_no`: `A-` + 무작위 10자.
- **접근 키**: `gk_` + base62 43자(32바이트). DB 에는 SHA-256 hex(64) + 앞 8글자(`gk_` 포함). 머리글 `X-API-Key`.
- **요청 상태** `score_request.status`: `received · queued · converting · awaiting_type_answer · rendering(API만) · completed · service_down`. 만료는 저장하지 않고 `v_request_retention.is_expired` 로 계산 → 응답에서 `status:"expired"` 로 덮어쓴다.
- **경로** `route`: `recognize · direct · fallback`.
- **대체 이유**: DB 소문자 6종(`recognition_failed · timeout · engine_stopped · user_request · no_structure · distrust`). **응답·화면은 대문자 코드**(`shared/error-codes.json` `fallback_reasons`): `RECOGNITION_FAILED · TIMEOUT · ENGINE_DOWN · NO_NOTES · NO_SCORE_STRUCTURE · UNTRUSTED_RESULT · USER_REQUEST`. `NO_NOTES` = `recognition_failed` 이면서 마지막 `engine_attempt.outcome='no_notes'`.
- **구조 판정** `pass · ambiguous · fail`, **타당성 등급** `trust · caution · distrust`, **결과 띠** `trust · caution · fallback · direct`(`v_request_stage_label.result_band`).
- **악기 코드**: `shared/instruments.json` 의 `code`(gayageum, janggu …). DB `instrument.code`.
- **악기 번호(2026-09-29 결정, 황송해)**: 서비스 안 연주(화면 재생·MP3)는 일반 악기 = 표준 GM bank 0(피아노 0, 마림바 12, 기타 24, 바이올린 40, 첼로 42, 하프 46, 현악 48, 클라리넷 71, 플루트 73), 국악기 = 전용 **bank 1**(가야금 0, 거문고 1, 대금 2, 해금 3, 피리 4, 아쟁 5), 장구·북 = 타악 bank 128 **program 1**(국악 타악 세트; GM 표준 드럼은 program 0). 그래서 첼로(0:42)와 아쟁(1:5)이 겹치지 않는다. 내려받는 MIDI·MusicXML 은 다른 프로그램을 위해 GM 호환 번호(`gm_program`) + 한글 트랙 이름을 유지한다(research R11).

## 2. 오류 형식 (모든 서버 같음, FR-048)

```json
{ "error": { "code": "UPLOAD_TOO_LARGE", "message": "…", "fix": "…", "gate": "G1", "retry_after": null, "details": {} }, "api_version": "v1" }
```
`code`·`http`·`gate`·`message`·`fix` 는 `shared/error-codes.json` `gate_codes` 에서 온다. 웹 서비스(`/api`)는 `web_fix` 가 있으면 그것을 `fix` 로 보낸다(2026-09-29 사진·PDF 입력 뒤로는 웹·API 가 같은 파일을 받아 `web_fix` 를 쓰는 코드가 없다). 모델 API 는 `fix` 그대로. 429 는 `Retry-After`(초) 머리글도 보낸다.

## 3. ScoreDoc (packages/score-core — 브라우저·웹 서비스 공용)

```ts
export interface ScoreDoc {
  version: 1;
  title?: string;
  ppq: number;                                  // 4분음표당 틱 (480)
  tempoBpm: number;                             // 첫 빠르기
  timeSignature: { beats: number; beatType: number };
  keyFifths: number;                            // 조표(5도권, -7..7). 조옮김하면 바뀐다
  parts: Part[];                                // parts[0] = 원래 선율(첫 성부, BR-EDT-07)
}
export interface Part {
  id: string;                                   // "P1", "P2" … (추가 트랙은 "P{n}")
  name: string;                                 // 표시 이름(한글 악기 이름)
  instrument: string;                           // 악기 코드 (shared/instruments.json)
  sourceInstrument?: { name: string; program: number | null } | null;  // 올린 파일에 있던 원래 악기(FR-056)
  isPercussion: boolean;
  volume: number;                               // 트랙 음량 0..127 (기본 100)
  origin: 'original' | 'melody_copy';
  notes: Note[];
}
export interface Note {
  id: string;                                   // 파트 안에서 유일("P1-n12")
  startTick: number;
  durationTicks: number;
  pitch: number;                                // MIDI 음번호
  velocity: number;                             // 1..127
}
```
연산(EditOp, `part` 는 0부터 센 파트 번호):
`{op:'add_instrument', instrument}` (parts[0] 음표 복사 새 파트) · `{op:'remove_track', part}` (2026-09-30 황송해: 추가한 트랙(origin melody_copy)만 지운다, 원래 트랙이면 건너뜀 · validateOps 오류, UC_06 BR-EDT-08) · `{op:'change_instrument', part, instrument}`(2026-09-30 145번: 타악기는 타악 성부에만 · 선율 악기는 선율 성부에만 — 어긋나면 applyOps 가 건너뛰고 validateOps 오류, 성부의 isPercussion 은 악기로 바뀌지 않음) · `{op:'transpose', semitones}` (누적, 음표+keyFifths) · `{op:'set_track_volume', part, velocity}` · `{op:'set_note_volume', note_id, velocity}` · `{op:'set_tempo', bpm}`(2026-09-30 황송해 161번 — 곡 전체 빠르기, 20~300 BPM, 4분음표 기준. 2026-09-29 T164 에서 뺐던 연산을 되살림. 1.0배(100)면 두지 않음) · `{op:'set_note_pitch', note_id, midi_pitch}`(2026-09-30 131번: 음 하나만 — 화음이면 그 음만 바뀌고 같은 자리의 다른 음은 그대로). (`assign_sf2` 는 2026-09-29 사용자 음원 제거로 없앴다 — 기기에 남은 옛 편집의 `assign_sf2` 는 `applyOps` 가 건너뛴다)
공개 함수: `parseMusicXml(text|Uint8Array)→ScoreDoc`, `parseMidi(Uint8Array)→ScoreDoc`, `toMusicXml(doc)→string`, `toMidi(doc)→Uint8Array`, `applyOps(doc, ops)→ScoreDoc`, `applyInstrumentMode(doc, mode, opts)→ScoreDoc`(default/original/custom), `rangeWarnings(doc, instruments)→{part,noteId}[]`, `summarizeOps(ops)→EditSummary`.

## 4. 웹 서비스 API (`/api`, 포트 9523(127.0.0.1), 익명 세션 쿠키 `gugak_sid`)

| 메서드·경로 | 요청 | 응답 |
|---|---|---|
| POST `/api/requests` | multipart `file` — **PDF 한 개 또는 PNG·JPG(JPEG)·WEBP 사진 여러 장(올린 순서 = 쪽 순서, 최대 10장)**(2026-09-29 황송해 결정 — 여러 쪽), `score_type`(staff/jeongganbo, 필수 — PDF 도) | 202 `RequestStatus` · 4xx 오류(G1, G12). MIDI·MusicXML 등은 415 `UPLOAD_UNSUPPORTED_TYPE`(G1, `details.allowed:['image','pdf']`). PDF 는 웹이 형식(`%PDF`)·용량·종류를 보고, 열기(손상·암호 → 422 `UPLOAD_CORRUPTED`)·쪽수(11쪽 이상 → 400 `UPLOAD_TOO_MANY_PAGES`)·쪽마다 300dpi 사진 크기는 모델 API `POST /v1/internal/upload-check` 에 맡긴다. ~~닿지 않으면 웹 판정으로 접수~~ (2026-09-29) 닿지 않으면 503 `UPLOAD_CHECK_UNAVAILABLE`(접수 안 함, 사진은 영향 없음). 원본(PDF 한 개 또는 사진 여러 장, `upload_file.file_no` 1~10)을 저장해 인식 때 그대로(사진은 올린 순서대로) `/v1/omr/*` 에 보낸다. `route` 는 늘 `recognize`(또는 `fallback`) — 직행 없음 |
| POST `/api/requests/example` (2026-09-30 황송해) | JSON `{example_id, score_type?}` — 예시 id(`app/assets/examples/examples.json` 목록에 있는 것만) | 202 `RequestStatus` — 서버가 서버 전용 폴더의 파일로 `POST /api/requests` 와 같은 검사 · 접수. 목록 밖 id · 경로 문자는 404 `REQUEST_NOT_FOUND` |
| GET `/api/examples` · GET `/api/examples/:id/thumb` (2026-09-30 황송해) | — | `{items:[{id,title,score_type}]}` · 짧은 변 200px JPEG(로그인 사용자, UC1). 예시 원본 파일 주소는 없다(`/examples/*` 정적 파일 없음) |
| POST `/api/shared-scores/:shareNo/use` (2026-09-30 황송해 109번) | — | 202 `RequestStatus` — 공유 복사본 MusicXML 로 내 새 요청(`route=direct`, 인식 없음, 바로 completed). 거둠 · 내림 · 3일 지남은 404 |
| GET `/api/my-scores` (2026-09-30 황송해 160번) | — | `{items:[{id, title, file_name, score_type, created_at, expires_at, remaining_seconds, edited, edit_ops, midi_available, fallback}]}` — 이 계정의 완료 · 보관 기간 안 웹 요청(최근 50). 편집 기록은 `edited_score.ops_json`(PUT `/edits` · 편집 반영 받기 때 저장) (190번) 공유 악보에서 [이 악보로 작업하기]로 만든 요청(`from_share_id`)은 빼고 준다(`from_shared` 는 늘 false). (192번) 예시로 올린 요청은 `title` 이 예시 이름(examples.json 원래 이름, 화면이 괄호를 뗌)이고 `from_example: true`. |
| DELETE `/api/my-scores/:no` (2026-09-30 황송해 176번) | — | 204 — 이 계정의 완료된 웹 요청을 바로 지움(P0 0.1 과 같은 삭제 + `score_request.purged_at` · `owner_deleted_at`, `edited_score.ops_json` 비움). 이미 지웠으면 204. 없음 · 다른 계정 · 미완료는 404 REQUEST_NOT_FOUND. 공유 복사본은 남음 (180번) 공유 악보로 만든 요청(`from_share_id`)은 403 `MY_SCORE_FROM_SHARED`. 목록(GET)에는 `from_shared` 가 붙는다. |
| GET `/api/requests/:no` | — | `RequestStatus` (1초 폴링) |
| POST `/api/requests/:no/type-confirmation` | `{change_to: 'staff'|'jeongganbo'|null}` | 202 `RequestStatus` |
| GET `/api/requests/:no/score` | — | `{scoredoc, musicxml, has_original_instruments, fallback, fallback_reason, fallback_message, retry_hint}` |
| POST `/api/requests/:no/fallback` | — | `RequestStatus` (route fallback, `USER_REQUEST`) |
| POST `/api/requests/:no/events` | `{event:'result_shown'|'first_played'}` | 204 |
| GET `/api/requests/:no/recommendation` | — | `Recommendation` |
| PUT `/api/requests/:no/instrument-choice` | `{mode:'default'|'recommend'|'original'|'custom', recommendation_index?, tracks?:[{part,instrument}]}` | 204 — 기록(`instrument_selection`)은 **실제로 놓인 악기만**: 기본 구성이라도 타악 성부가 없어 장구가 안 놓이면 빼고, 놓인 악기만 담은 `ensemble`(kind='custom') 행을 찾거나 만들어 쓴다. 첫 기록은 이미지 요청이면 결과 표시(`result_shown`) 때, 직행이면 완료 직후(올리기 때의 `initial_default` 없음, 2026-09-29) |
| GET `/api/requests/:no/original/:format` | format = musicxml·midi | 파일 |
| PUT `/api/requests/:no/edits` | `{summary: EditSummary, ops: EditOp[], finished?: boolean}` — (2026-10-01 202번) `finished:false` 는 [작업 저장하기](편집 마침으로 치지 않음, 기본 true) | 204 |
| POST `/api/requests/:no/exports` | `{format:'mp3'|'pdf'|'midi'|'musicxml', edit_ops: EditOp[], instruments?: {mode, tracks?}}` | 202 `ExportTask` |
| GET `/api/requests/:no/exports/:fileId` | — | `ExportTask` |
| GET `/api/requests/:no/exports/:fileId/file` | — | 파일 |
| GET `/api/instruments` | — | `{default_set:['gayageum','janggu'], gugak:[Instrument], others:[Instrument]}` (`custom` 묶음은 2026-09-29 제거) |
| POST `/api/session/end` | — | 204 ([나가기] — 세션만 끝낸다. `/api/sf2*` 는 2026-09-29 제거, 404) |
| GET `/api/models/status` | — | `ModelStatusPublic` (사용자 화면의 "모델 준비" 안내) |
| GET `/api/api-docs` | — | `{server_status, spec_source, checked_at, endpoints[], guideline{}, manual{}}` |
| POST `/api/key-applications` | `{name, organization, contact_email, purpose, consent:true}` | 201 `{application_no, api_key, key_prefix, call_limit_per_hour}` |
| GET `/api/health` | — | `{status:'ok'}` |

```ts
type RequestStatus = {
  id: string;                        // request_no
  file_kind: 'image'|'pdf'|'midi'|'musicxml';   // 2026-09-29 부터 새 요청은 'image' 또는 'pdf'(midi·musicxml 은 이전 행만)
  score_type: 'staff'|'jeongganbo'|null;
  status: 'received'|'queued'|'converting'|'awaiting_type_answer'|'completed'|'service_down'|'expired';
  status_label: string;              // v_request_stage_label.stage_label (접수·대기·변환 중·종류 확인·완료·대체·서비스 중단)
  queue_position: number|null;
  route: 'recognize'|'direct'|'fallback';
  result_band: 'trust'|'caution'|'fallback'|'direct'|null;
  fallback: boolean;
  fallback_reason: string|null;      // 대문자 코드
  fallback_message: string|null;
  retry_hint: string|null;
  type_mismatch: boolean;
  detected_type: 'staff'|'jeongganbo'|null;
  validity_grade: 'trust'|'caution'|'distrust'|null;
  engine: {name: string; version: string}|null;
  received_at: string; expires_at: string; remaining_seconds: number;
  deadline_at: string;               // received_at + timeout_seconds (SC-003)
  model_wait: null | {               // 모델이 아직 올라오지 않아 기다리는 중(3회 폴링마다 갱신)
    model: string; display_name: string; state: 'cold'|'loading';
    expected_seconds: number|null;   // v_model_load_estimate 평균(없으면 config cold_start_hint_s)
    elapsed_seconds: number|null;
  };
  has_original_instruments: boolean;
  pdf_page_count: number|null;       // PDF 면 전체 쪽수(upload_file.pdf_page_count)
  validity_items: null | { note_count?: number; beat_sum?: number; range_leap?: number; yulmyeong_ratio?: number; engine_confidence?: number };  // 2026-09-30 130번: 타당성 점검 항목 값(validity_check_item) — 1단계 판별 사유 문장용
  from_shared: boolean;              // 2026-09-30 황송해 109번: 공유 악보로 작업하기로 만든 요청(인식 없음). 공유자 정보는 없다
  midi_available: boolean|null;      // 2026-09-30 황송해 74번: 지금 결과에 원본 MIDI 가 있는가(score_result.midi_uri). 결과 전이면 null. false 면 C6 의 MIDI 칸 비활성
  page_count: number;                // 2026-09-29 여러 쪽: 쪽 수(PDF 쪽수 또는 사진 장수)
  pages: PageStatus[];               // 쪽별 상태(request_page, 쪽 순서) — 인식 전이면 []
  notice: null | { code: 'PAGES_PARTIAL'; message: string; pages: number; converted: number; failed_pages: number[] };  // 일부 쪽만 실패
  // ~~notice PDF_FIRST_PAGE_ONLY~~ (2026-09-29 여러 쪽 결정으로 더 내지 않음)
};
type PageStatus = { page_no: number; file_no: number; source: 'file'|'pdf_page';
  outcome: 'pending'|'converted'|'failed'; fallback_reason: string|null;   // 대문자 코드(쪽 실패 사유)
  fallback_message: string|null; validity_grade: 'trust'|'caution'|'distrust'|null;
  short_edge_px: number|null; upscaled_short_side_px: number|null };   // 2026-09-30 황송해 119번: 사진 크기 · 작은 사진을 늘려 읽었으면 늘린 짧은 변
type Recommendation = { available: boolean; reason: string|null; pending: boolean;   // pending: LLM 모델 준비 중이라 규칙표 결과만 먼저 줌
  combinations: {label: string; instruments: string[]; reason?: string}[];
  model: {name: string; version: string; provider: string}|null;
  features: {tempo: string; bpm: number|null; mode: string; range: string; density: number|null}|null };
type Instrument = { id: string; name: string; group: 'gugak'|'other'|'original';   // 'custom'(사용자 음원)은 2026-09-29 제거
   gm_program: number|null; bank?: number; program?: number;   // bank·program: 서비스 안 연주 번호(2026-09-29, 위 '악기 번호'), gm_program: 내려받기용 GM 호환 번호
   percussion: boolean; range_low: number|null; range_high: number|null; soundfont: string|null };
type ExportTask = { id: string; format: 'mp3'|'pdf'|'midi'|'musicxml'; basis: 'original'|'edited';
  status: 'queued'|'rendering'|'ready'|'failed'; queue_position: number|null;
  failure_reason: 'RENDER_FAILED'|'RENDER_TIMEOUT'|'RENDERER_MISSING'|'ENGINE_DOWN'|null;
  notices: string[]; download_url: string|null; renderer: string|null };
type ModelStatusPublic = { checked_at: string; model_api: 'running'|'stopped';
  models: {name: string; display_name: string; kind: 'omr_staff'|'omr_jeongganbo'|'recommend'; provider: 'venv'|'ollama'|'builtin';
           state: 'ready'|'cold'|'loading'|'failed'|'unavailable'; expected_seconds: number|null}[] };
```

### 4-A. 공유 악보 · 좋아요 (2026-09-30 황송해 결정 — design/UC_18 UC18 · SD_01 §9C P9)

| 경로 | 몸 | 응답 |
|---|---|---|
| GET `/api/requests/:no/share` | — | `{shared:false}` 또는 `{shared:true, share_no, title, shared_at, expires_at, taken_down}` (올린 사람만) |
| PUT `/api/requests/:no/share` | `{title}` (1~60자) | 같은 모양. 결과 MusicXML 을 `storage/shared/<share_no>/score.musicxml` 로 복사(24시간 정리 밖). 이미 있으면 제목만 바꿈 |
| DELETE `/api/requests/:no/share` | — | `{shared:false}` (복사본 삭제) |
| GET `/api/shared-scores?sort=likes|recent&limit&offset` | — | `{sort, items:[{share_no, title, score_type, shared_at, expires_at, likes, liked_by_me}], has_more}` — 올린 사람 · 요청 번호 없음. (2026-09-30) 공유한 때부터 3일(`expires_at`) 지나면 빠진다 |
| GET `/api/shared-scores/:shareNo/score` | — | `{share_no, title, score_type, musicxml}` (내림 · 거둠이면 404 REQUEST_NOT_FOUND) |
| POST `/api/shared-scores/:shareNo/like` | — | `{share_no, liked, likes}` — 다시 누르면 취소 |

권한표: 모두 `UC18`(user). 관리자(§5): GET `/admin/shared-scores?status=all|visible|taken_down|unshared|expired`(행에 `expires_at`, 상태 `expired` · `purged` 더함) · POST `/admin/shared-scores/:shareNo/take-down` `{reason?}` · POST `/admin/shared-scores/:shareNo/restore` (UC19, 변경 이력 `shared_score` · `taken_down` / `restored`).

## 5. 관리자 API (`/admin`, 포트 26101(127.0.0.1, 내부 포트) + 운영자 세션 쿠키 `gugak_admin`)

| 메서드·경로 | 비고 |
|---|---|
| POST `/admin/login` `{login_id,password}` · POST `/admin/logout` · GET `/admin/me` | G5 (내부망 밖 403 · 실패 401 · 잠금 423) |
| GET `/admin/metrics` | `{scopes:{all,web,api:{image_requests,first_pass_trust,first_pass_rate,caution_count,fallback_rate,edit_usage_rate,max_wait_ms,service_down_count}}, fallback_by_reason:[{channel,reason,count}], missing_log_count}` |
| GET `/admin/jobs?limit&offset&channel&route` · GET `/admin/jobs/:no` | `v_request_log` 행 / 상세(+시도·점검 항목·단계 시간) |
| GET `/admin/evaluation` · POST `/admin/evaluation/run` | `v_eval_metrics` / `evalset/run.py` 실행 시작 |
| GET `/admin/model-api-status` | `{health, versions, snapshot_id, checked_at}` |
| GET `/admin/settings` · PUT `/admin/settings` | 현재 판본 + 엔진 순서 `{staff:[],jeongganbo:[],recommend:[]}` / 바뀐 값만 받아 이전 판본 복사 후 저장(Q4) → 모델 API reload |
| GET `/admin/audit` | `v_change_history_all` |
| GET `/admin/keys` · POST `/admin/keys/:id/revoke` · PUT `/admin/keys/:id/limit` · POST `/admin/service-key` | S4-B |
| GET `/admin/applications` · POST `/admin/applications/:no/archive` | 가린 값만(`v_key_application_masked`) |
| PUT `/admin/license` `{confirmed:boolean}` | G7 해제 기록 |
| **GET `/admin/models`** | 등록부 + 실시간 상태: `[{model_name, kind, provider, display_name, provider_ref, enabled, in_use_by:['staff#1',…], state, loaded_at, expected_seconds, avg_load_ms, max_load_ms, last_outcome, last_error, installed, version}]` |
| **POST `/admin/models`** | 모델 등록 `{model_name, kind, provider, display_name, provider_ref, config}` (Ollama 는 서버에 이미 있는 모델만 — 목록은 아래) |
| **PUT `/admin/models/:name`** | `{enabled?, display_name?, provider_ref?, config?}` |
| **DELETE `/admin/models/:name`** | 등록 해제(설정 순서에서 쓰는 중이면 422 `MODEL_INVALID`) |
| **POST `/admin/models/:name/load`** | 불러오기(워밍업) 시작 → 202 `{load_id, expected_seconds}`. 진행은 GET `/admin/models` 로 본다 |
| **GET `/admin/models/ollama-available`** | 공유 Ollama 서버의 모델 중 10GB 이하·`:cloud` 아님 `[{tag, size_gb, family, parameter_size, registered}]` + `{ollama:'ok'|'unreachable', version}` |

| **GET `/admin/accounts?q&role(user\|operator\|none)&status(active\|locked\|disabled)&page`** | S7 계정 목록(2026-09-29 RBAC 운영자 메뉴, FR-069 · UC17) `{items:[{account_id, login_id_masked, display_name, roles[], status, created_at, last_login_at, locked_until, disabled_at, failed_logins, requests_7d}], page, page_size:50, total}` — `v_account_admin` |
| **GET `/admin/accounts/:id`** | `{account, requests[20](번호·상태·경로·시각만), keys[](앞자리), history[](계정 변경 이력), events[20](G5·G13~G16)}` · 없으면 404 `ACCOUNT_NOT_FOUND` |
| **POST `/admin/accounts/:id/reveal-email`** | `{login_id}` 전체 이메일 — 조회를 이력(`email_revealed`)에 남김 |
| **PUT `/admin/accounts/:id/roles`** `{grant?:[], revoke?:[]}` | `user`·`operator` 만(그 밖 400 `ROLE_NOT_ASSIGNABLE`). 자기 operator 빼기 409 `ADMIN_SELF_PROTECTED` · 마지막 operator 409 `ADMIN_LAST_OPERATOR` (G16). 다음 요청부터 적용. 응답은 상세 |
| **POST `/admin/accounts/:id/unlock` · `/disable` · `/enable`** | 잠금 풀기(실패 수 0) / 사용 중지(열린 세션 모두 끝냄 — 즉시 로그아웃, 자기·마지막 operator 면 G16) / 다시 사용. 응답은 상세. **사유는 받지 않는다** |
| **GET `/admin/permissions`** | `{table:{role:[UC…]}, public:['UC11','UC16'], editable:false, design_source, design_differs:[role]}` — 읽기 전용, `design/UC_00 §4-1` 과 다른 역할을 알려 줌 |
| **GET `/admin/auth-events?gate&hours&account`** | G5·G13~G16 기록 최대 200줄 + `summary`(게이트별 24시간 건수) · `locked_accounts` |

모든 변경은 `change_history`(모델은 target_type `model`, 계정은 `account`)에 남는다.

> **2026-09-30 API 점검 개선(조성기)**: 모델 API 입력 계약 위반은 422 `VALIDATION_ERROR`(모르는 폼 필드 포함), 인식 응답은 선언 필드만(`app/schemas.py`), `/v1/health` 준비 전 503 `loading`·엔진 없음 503 `unavailable`, 모든 응답에 `X-Request-ID`. 자세한 규칙은 `design/SD_04` §8-1.

## 6. 모델 API 서버 (`/v1`, 포트 9543 · 외부 `https://p3.sumzip.com/api/v1`)

계약(`contracts/model-api.openapi.yaml`) 경로를 따르되 값 이름은 §1. 웹 서비스는 **서비스 전용 키**(`SERVICE_API_KEY`)로 부르고, 웹 요청이면 폼에 `request_no` 를 함께 보낸다(작업 기록 연결 — D-18: 인식 판정 표 `processing_job·engine_attempt·validity_check_item·stage_timing(structure·jg_convert·validity)` 는 **모델 API 서버가 쓴다**). 웹 요청의 `score_result`·`score_request` 상태는 **웹 서비스가 쓴다**. 머리글 `X-Deadline`(ISO, 접수+제한) 이 있으면 그 시각에 엔진을 끊는다.

- `POST /v1/omr/staff`, `POST /v1/omr/jeongganbo` → `RecognitionResult`:
  `{api_version, request_no, fallback, fallback_reason, retry_hint, structure_verdict, type_mismatch, detected_type, validity_grade, validity_items:{note_count,beat_sum,range_leap,yulmyeong_ratio,engine_confidence}, musicxml, midi_base64, engine:{name,version,tried:[{name,outcome,failure_code,duration_ms}]}, timings_ms:{structure,recognize,jg_convert,validity}}`.
  대체일 때 외부 호출자에게는 서버 보유 템플릿의 `musicxml`·`midi_base64` 를 넣어 주고, 웹 요청(`request_no` 있음)에는 **파일을 넣지 않는다**(웹이 자기 템플릿을 씀, BR-FBK-02).
  (2026-09-29) `image` 는 사진 또는 PDF. 응답에 `file_kind`·`pdf_page_count`·`short_edge_px`·`notice` 를 더한다. MIDI·MusicXML 은 415.
  (2026-09-29 여러 쪽) `image` 를 올린 순서대로 여러 번(사진 최대 10장) 또는 PDF 한 개(최대 10쪽). 응답에 `page_count`·`converted_pages`·`pages:[{page_no,file_no,source,short_edge_px,outcome('converted'|'failed'),fallback_reason,fallback_message,structure_verdict,validity_grade,engine}]` 를 더하고, 일부 쪽 실패면 `notice`(`PAGES_PARTIAL`). 판정 기록에 `request_page` 와 `engine_attempt.page_no`·`stage_timing.page_no` 가 더해진다. 웹 요청의 `X-Deadline` 은 전체 마감(접수 + 쪽 수 × 제한).
- `POST /v1/internal/upload-check` (서비스 키 전용, 웹 PDF 검사 위임) → `{ok, kind, short_edge_px, pdf_page_count, page_count, pages:[{page_no,file_no,source,short_edge_px}]}` 또는 G1 오류. 요청을 만들지 않는다(2026-09-29 여러 쪽: 모든 쪽 검사, 그림은 그리지 않고 크기만).
- `POST /v1/recommend` (multipart `score`, 선택 `request_no`) → `{available, reason, pending, combinations:[{label, instruments, reason}], model:{name,version,provider}, features, tried:[{name, outcome, detail?, state?}]}`.
  조합 이름 `label` 은 모델이 짓지 않고 악기 이름을 이어 만든다(`"아쟁 · 대금 · 장구"`, T151). LLM 답은 조합마다 검사한다 — 악기 목록의 코드만, 중복 뺀 뒤 2~4개, 1~3조합(같은 조합은 한 번). **모르는 악기가 하나라도 있거나 조합이 어기거나 JSON 이 깨지면 답 전체를 버리고** 다음(규칙표 `rules.yaml`)으로 넘어가며 `tried[].outcome='invalid_answer'`, `detail` 에 까닭을 남긴다. (2026-09-29 황송해 결정) "국악기 1개 이상·선율 악기 1개 이상·타악 1개까지" 규칙은 없앴다 — 일반 악기만의 조합(피아노·바이올린), 타악만의 조합(장구·북)도 받는다. 타악만의 조합이면 선율 성부는 기본 선율 악기(가야금). 등록부의 추천 순서대로(예: `llm-gemma3-4b` → `rules`). LLM 모델이 **ready 가 아니면 기다리지 않고** 다음(규칙표)으로 넘어가며 `pending:true` 와 함께 백그라운드 불러오기를 시작한다. `recommendation`·`recommendation_option` 행은 `request_no` 가 있으면 모델 API 서버가 쓴다.
- `POST /v1/render/mp3` 성부별 음원(T150): 음원 묶음별(국악 `gugak.sf2` / 일반 `FluidR3_GM.sf2`)로 성부를 나눠 렌더링한 뒤 섞는다. `instruments.tracks[].sf2_ref` 는 기본 음원 이름(`gugak.sf2`·`FluidR3_GM.sf2`, 대소문자 무시, 줄임 `gugak`·`gm`)만 되고 그 성부를 그 음원으로 렌더링한다. 그 밖은 400 `BAD_REQUEST`(`details.field`·`details.allowed`). 웹 MP3 내보내기는 편집 반영 악보의 성부마다 `{mode:'custom', tracks:[{part, instrument}]}` 를 보낸다(악기 목록에 없는 원래 악기는 기본 구성 가야금·장구). `instruments` 를 안 보내면 기본 구성으로 덮어쓴다. 타악 성부가 없으면 타악 파트를 새로 만들지 않는다. (2026-09-29: `sf2_files`·`session_id`·세션 사본은 사용자 음원 제거로 없앴다)
- `POST /v1/render/pdf`, `POST /v1/performances`, `GET /v1/performances/{id}`, `GET /v1/performances/{id}/result`, `GET /v1/files/{token}` — 계약대로.
  (2026-09-29) `/v1/performances` 의 `score` 는 사진 또는 PDF 한 개, `score_type` 필수. MIDI·MusicXML 은 415(직행 없음). 상태·결과 응답에 `pdf_page_count`·`notice` 를 더한다.
  (2026-09-29 여러 쪽) `score` 는 PDF 한 개 또는 사진 여러 장(올린 순서, 최대 10장). 상태·결과 응답에 `page_count`·`pages`(쪽별 상태: 쪽 번호 · `outcome` pending/converted/failed · 사유)와 일부 쪽 실패면 `notice`(`PAGES_PARTIAL`)를 더한다. `/v1/recommend`·`/v1/render/*` 는 그대로 MIDI·MusicXML(생성된 결과)을 받는다.
- `GET /v1/health` → `{status, api_version, queue:{recognize_running, recognize_waiting, render_running}, settings_version, models_ready, models_total}`
- `GET /v1/versions` → `{api_version, openapi_url, engines:[{name, version, kind, provider, installed, state}], templates:[{id,version}], rules_hash}`
- **`GET /v1/models`** → `[{name, display_name, kind, provider, provider_ref, enabled, installed, version, state:'ready'|'cold'|'loading'|'failed'|'unavailable', loaded_at, last_load_ms, expected_seconds, error}]` (공개 — 키 필요 없음)
- **`POST /v1/internal/models/reload`** (서비스 키) → 등록부를 DB 에서 다시 읽는다(추가·변경·삭제 반영)
- **`POST /v1/internal/models/{name}/load`** (서비스 키, 선택 `operator_id`) → 202 `{load_id, expected_seconds}`. 끝나면 `model_load_event` 에 결과
- `POST /v1/internal/settings/reload` — 서비스 키 (`/v1/internal/sf2*` 는 2026-09-29 사용자 음원 제거로 없앴다)
- **`POST /v1/internal/upload-check`** (서비스 키, multipart `file` + `score_type`, 2026-09-29) → 200 `{ok:true, kind, short_edge_px, pdf_page_count, pdf_converted_page, notice}` 또는 G1 오류(`UPLOAD_*`). 웹이 PDF 를 접수하기 전에 부른다 — 연주 API·`/v1/omr` 과 같은 검사기(pypdfium2). 요청을 만들지 않는다

### 6-1. 모델 제공자(provider) 규칙

- **venv**: `provider_ref` = 가상환경 폴더(`~` 허용). 어댑터가 `<venv>/bin/python` 또는 설정의 명령으로 하위 프로세스를 띄운다. "불러오기" = 가벼운 시험 실행(import·가중치 확인)으로 디스크 캐시를 데운다. 설치 안 됨 = `installed:false`, `state:'unavailable'`.
- **ollama**: `provider_ref` = 공유 서버의 모델 태그. `OLLAMA_URL`(기본 `http://127.0.0.1:11434`). 규칙(OLLAMA 설정 참조 §7.3·§8): 동시 1건(세마포어) · `keep_alive:"5m"` · `num_ctx` 4096(최대 8192) · `think:false` · `format:"json"`(추천은 JSON 스키마 — 악기 코드 enum·조합 1~3·악기 2~4, T151) · 타임아웃 300초 · 연결 오류·시간 초과만 3초·6초 재시도 · **런타임 코드에서 pull/create/rm/stop/serve 금지**. 상태: `/api/ps` 에 있으면 ready, 없으면 cold. "불러오기" = 빈 프롬프트 `/api/generate`(`keep_alive:"5m"`) 한 번. 등록 가능 모델은 `/api/tags` 에서 10GB 이하·`:cloud` 아님만. 새 모델을 서버에 받는 일(`ollama pull`)은 관리자 화면이 **명령만 안내**하고 사람이 한다.
- **builtin**: 늘 ready.

## 7. 사용자·관리자 화면의 "모델 준비" 표시 (추가·불러오기 시간 고려)

- **사용자(S1 C1 진행 레일)** (2026-09-30 황송해 결정으로 C1 진행 레일을 없애 아래 표시는 지금 화면에 없다. 응답의 `model_wait` 는 그대로 내려감): `RequestStatus.model_wait` 가 있으면 처리 단계 아래에 "인식 모델을 준비하고 있어요 — 처음 한 번은 약 N초 걸려요(지금 M초)" 와 진행 막대(예상 대비). 예상이 없으면 "처음 한 번은 시간이 더 걸릴 수 있어요". 처리 시간 제한을 넘으면 기존처럼 대체 결과(결과 보장이 우선).
- **사용자(S2 추천)**: `Recommendation.pending` 이면 규칙표 추천을 먼저 보이고 "AI 추천 모델을 준비 중이에요 — 준비되면 [다시 추천받기]" 안내. 기본 연주는 막지 않는다(FR-008).
- **관리자(S6 '모델' 탭)**: 기능별(오선보·정간보·추천) 모델 표 — 상태 칩(준비됨·대기 중(콜드)·불러오는 중(경과/예상 초 + 진행 막대)·실패·설치 안 됨), 최근 불러오기 평균·최대, [불러오기] [켜기/끄기] [순서 올리기/내리기 → 설정 저장], [모델 추가] 대화상자(venv: 이름·종류·가상환경 폴더·어댑터 / ollama: 서버에 있는 10GB 이하 모델 목록에서 고르기 + 없는 모델은 `ollama pull <태그>` 안내), 추가 직후 "불러오기를 한 번 해 두면 첫 사용자가 기다리지 않아요" 권유. 불러오는 중에는 2초마다 새로 고침.
