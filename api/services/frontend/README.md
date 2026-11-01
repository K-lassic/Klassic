# frontend (담당: 황송해 @SonghaeHwang)

사용자 화면(올리기 · 결과 · 편집 · 연주 · 내려받기 · API 안내) · 관리자 화면 · 정적 파일 서빙(Nginx).

- 참고 코드: `proto_type/src/app/frontend` (Vue · Vite · TypeScript, 약 10,900줄 — 사용자 약 6,900줄 · 관리자 약 4,000줄 · 테스트 44개 파일)
- 계약: [../../contracts/web-api.yaml](../../contracts/web-api.yaml)
- 공용 패키지: [../../packages/score-core/](../../packages/score-core/) (편집 · 연주에서 사용)

## 재구성 시 바꿀 점

- API 주소 · 공개 주소는 빌드 시 환경변수로 받는다 (하드코딩 금지)
- v0.1.1 은 백엔드가 화면 파일을 함께 내줬다 → 프론트 이미지(Nginx)가 직접 내준다
- 관리자 화면은 사용자 화면과 다른 경로 · 다른 포트로 내주고, 외부에는 열지 않는다

## 화면 목록 (v0.1.1 기준, #8)

`proto_type/src/app/frontend/src` 를 읽고 정리한 초안. 경로 앞의 `/api` · `/admin` 은 같은 출처(쿠키 인증)로 부른다.
발표 범위는 [API 진행계획 §3](../../../docs/API_진행계획.md) 기준 — `P1` 발표 필수 · `P2` 여유 있으면 · `P3` 발표 이후.

### 사용자 화면 (`index.html`, history 라우터)

| 화면 | 주소 | 로그인 | 범위 |
|---|---|---|---|
| S0Login 로그인 · 가입 | `/login` · `/signup`(= `/login?tab=signup`) | — (로그인돼 있으면 `/` 로) | P1 |
| S1Home 올리기 ↔ 결과 | `/` · `/?r=<요청번호>` | 필요 | P1 |
| └ S1Upload 올리기 | (S1Home 안, 요청 없을 때) | 필요 | P1 · 목록은 P2 |
| └ S1Result 결과 · 악기 고르기 | (S1Home 안, 요청 있을 때) | 필요 | P1 |
| S2Edit 듣기와 편집 | `/r/:requestNo/listen` | 필요 | P1 |
| S3Download 내려받기 · 공유 | `/r/:requestNo/download` | 필요 | P1 · 공유는 P2 |
| S1Tour 체험하기 | `/tour` | 없음 | P2 |
| S4A API 안내 · 키 신청 | `/api-guide` | 없음 (키 신청 칸은 로그인했을 때만) | P2 |
| S4C API 활용 예시 | `/api-guide/examples` | 없음 | P2 |

모든 화면 공통(App.vue · 라우터 가드): `GET /api/auth/me` (화면 이동 때 한 번 확인) · `POST /api/auth/logout` (머리 메뉴).
401 `AUTH_LOGIN_REQUIRED` 를 받으면 `/login?next=<지금 주소>` 로 보낸다 (`api/client.ts`).

### 사용자 화면별 호출 API

| 화면 · 부품 | 메서드 · 경로 | 언제 | 범위 |
|---|---|---|---|
| **S0Login** | `POST /api/auth/login` `{email, password}` | [로그인] — 실패 시 `LOGIN_FAILED` · `LOGIN_LOCKED`(retry_after) | P1 |
| | `POST /api/auth/signup` `{email, password, name}` | [가입] — 성공하면 바로 로그인 상태 | P1 |
| **S1Upload** | `POST /api/requests` (multipart, `file` 여러 개 · `score_type`) | 사진 · PDF 올리기. 여러 장은 올린 순서대로 | P1 |
| | `GET /api/examples` · `GET /api/examples/:id/thumb` (img) | [예시 파일 고르기] 펼칠 때 | P1 (시연용) |
| | `POST /api/requests/example` `{example_id, score_type}` | 예시 악보로 올리기 | P1 (시연용) |
| | `GET /api/models/status` | 화면 열 때 — 엔진 상태 안내 (실패해도 화면은 그대로) | P2 |
| └ MyScoresList | `GET /api/my-scores` · `DELETE /api/my-scores/:no` | 내가 만든 악보 목록 · 지우기 (+ C6 내려받기 재사용) | P2 |
| └ SharedScoreList | `GET /api/shared-scores?sort=likes\|recent&limit&offset` | 공유 게시판 목록 · 페이지 | P2 |
| | `GET /api/shared-scores/:shareNo/score` | [듣기] — 브라우저에서 바로 연주 | P2 |
| | `POST /api/shared-scores/:shareNo/like` | [좋아요] | P2 |
| | `POST /api/shared-scores/:shareNo/use` | [이 악보로 작업하기] → 내 새 요청(바로 completed) | P2 |
| **S1Result** | `GET /api/requests/:no` | **1초 폴링** — `completed` · `service_down` · `expired` 에서 멈춤 | P1 |
| | `GET /api/requests/:no/score` | `completed` 가 되면 결과 악보(MusicXML) 받기 | P1 |
| | `POST /api/requests/:no/type-confirmation` `{change_to}` | 상태 `awaiting_type_answer` 일 때 악보 종류 답 | P1 |
| | `POST /api/requests/:no/fallback` | [대체 템플릿 받기] | P1 |
| | `POST /api/requests/:no/events` `{event: result_shown\|first_played}` | 요청마다 한 번씩 기록 (실패 무시) | P2 |
| | `GET /api/instruments` | 악기 목록 (store 에 한 번 캐시, S2 · S3 · 공유 목록도 같이 씀) | P1 |
| └ SaveWorkButton | `PUT /api/requests/:no/edits` `{summary, ops, finished:false}` | [작업 저장] (S1Result · S2Edit 둘 다) | P1 |
| **S2Edit** | `GET /api/requests/:no` · `/score` | 새로 고침 · 직접 들어올 때 이어 보기 (`req.load`) | P1 |
| | `PUT /api/requests/:no/edits` `{summary, ops}` | [편집 마치기] | P1 |
| **S3Download** | `GET /api/requests/:no` · `/score` | 이어 보기 | P1 |
| └ C6DownloadCard | `GET /api/requests/:no/original/musicxml\|midi` | 편집이 없으면 MusicXML · MIDI 를 바로 받음 | P1 |
| | `POST /api/requests/:no/exports` `{format, edit_ops, instruments?}` | MP3 · PDF (또는 편집 있는 MIDI · MusicXML) 만들기 | P1 |
| | `GET /api/requests/:no/exports/:id` | **1초 폴링** — `queued` · `rendering` → `ready` · `failed` | P1 |
| | `GET /api/requests/:no/exports/:id/file` (또는 응답의 `download_url`) | `ready` 가 되면 `<a download>` 로 받기 | P1 |
| └ SharePanel | `GET` · `PUT {title}` · `DELETE /api/requests/:no/share` | 공유 상태 · 공유하기 · 거두기 | P2 |
| **S4A** | `GET /api/api-docs` | 화면 열 때 — API 안내 내용 | P2 |
| | `POST /api/key-applications` | [API 키 신청] | P2 |
| **S1Tour** · **S4C** | 없음 | 문구 · 예시 코드만 (S4C 예시는 `/api/v1/*` model-api 를 부르는 코드) | P2 |

### 관리자 화면 (`admin.html#/…`, hash 라우터) — 모두 P3

| 화면 | 주소 | 호출 API |
|---|---|---|
| SALogin | `#/login` | `GET /admin/me` · `POST /admin/login` `{login_id, password}` (403 이면 잠금 표시) · `POST /admin/logout` |
| S6Ops 운영 | `#/ops/:tab` | 공통: `GET /admin/model-api-status` (ServerStatusLine) |
| └ metrics | | `GET /admin/metrics` |
| └ jobs | | `GET /admin/jobs?limit&offset&channel&route&reason&missing` · `GET /admin/jobs/:no` (상세 서랍) |
| └ evaluation | | `GET /admin/evaluation` · `POST /admin/evaluation/run` |
| └ settings | | `GET` · `PUT /admin/settings` · `GET /admin/models` |
| └ models | | `GET` · `POST /admin/models` · `PUT` · `DELETE /admin/models/:name` · `POST /admin/models/:name/load` · `GET /admin/models/ollama-available` · `GET` · `PUT /admin/settings` |
| └ audit | | `GET /admin/audit?target_type&limit` |
| S4BKeys API 키 | `#/keys` | `GET /admin/keys` · `POST /admin/keys/:id/revoke` · `PUT /admin/keys/:id/limit` · `POST /admin/service-key` · `GET /admin/applications` · `POST /admin/applications/:no/archive` · `GET` · `PUT /admin/license` · `GET /admin/audit` |
| S7Accounts 계정 · 권한 | `#/accounts` | `GET /admin/accounts?q&role&status&page` · `GET /admin/accounts/:id` · `POST …/reveal-email` · `PUT …/roles` · `POST …/unlock` · `…/disable` · `…/enable` · `GET /admin/permissions` · `GET /admin/auth-events` |
| S8SharedScores 공유 악보 | `#/shared` | `GET /admin/shared-scores?status` · `POST …/:shareNo/take-down` `{reason}` · `POST …/:shareNo/restore` |

401 `ADMIN_LOGIN_REQUIRED` 를 받으면 로그인 화면으로 돌린다 (`admin/api.ts`). 프론트가 부르는 관리자 경로와 `backend/src/admin` 라우트는 빠짐없이 일치한다.

### 화면이 직접 쓰는 기능 (서버 API 아님)

| 기능 | 쓰는 곳 | 내용 | 범위 |
|---|---|---|---|
| score-core (`@gugak/score-core`) | `lib/scoreCore.ts` 하나로만 들여옴 | MusicXML 읽기 · 쓰기 · MIDI 만들기 · 편집 연산 적용 · 음역 검사 | P1 |
| 악보 그리기 | `ScoreView` | OpenSheetMusicDisplay | P1 |
| 연주기 | `player/player.ts` · `C5PlayerBar` | spessasynth_lib(Web Audio). 음원 `GET /soundfonts/FluidR3_GM.sf2` · `/soundfonts/gugak.sf2` (정적 파일). 없으면 연주만 안 됨 | P1 |
| 편집 자동 저장 | `stores/autosaveBackend.ts` | IndexedDB `gugak-editor` / `autosave` (요청번호별 ops · listen_mode). 서버로 보내는 건 [작업 저장] 때만 | P1 |
| 기타 브라우저 저장 | `ScoreView` · `player` · `S1Tour` · `lib/judgment` · `lib/workSaved` | localStorage(확대 · 음량 · 체험하기 차분한 보기 · 결과 판정 [그래도 계속] 누름), sessionStorage(저장 표시) | P2 |
| 공용 JSON | `shared/instruments.json` · `shared/error-codes.json` | 빌드 때 묶음 — `api/shared/` 로 옮겨야 함 | P1 |

### 대조 중 발견한 점 (#4 리뷰 때 확인)

- 백엔드에 있지만 **화면이 부르지 않는** 경로 3개 → 계약에 넣을지 결정 필요
  - `GET /api/requests/:no/recommendation` · `PUT /api/requests/:no/instrument-choice` — 2026-09-30 결정(93번)으로 화면에서 추천 조합 고르기를 뺐다 (`S2Edit.vue` 머리말). `C4InstrumentPicker` · `lib/ensemble.ts` 에 추천 표시 코드는 남아 있다. 백엔드 통합 테스트(`instrument_selection.test.ts`)는 아직 이 경로를 쓴다 → P2 국악기 추천을 되살릴지 함께 정한다
  - `POST /api/session/end` — `POST /api/auth/logout` 과 같은 `endSession` 을 부른다. 화면은 logout 만 쓰므로 계약에서 빼도 된다
- 폴링 두 군데(요청 상태 · 내보내기)가 모두 **1초 간격** — 외부 공개(Funnel) 응답 시간과 요청 한도에 영향
- 내려받기는 `<a download>` 로 같은 출처 쿠키를 그대로 쓴다 → 프론트(Nginx)와 백엔드를 다른 출처로 나누면 깨진다. Nginx 에서 `/api` · `/admin` · `/soundfonts` 를 백엔드로 넘기는 구성이 맞다
- S4A · S4C 는 예시 주소를 `window.location.origin + /api/v1` 로 만든다 → gateway 가 `/api/v1` 을 model-api 로 넘겨야 예시가 맞음

## 이 폴더의 파일 (#21 골격)

`src/` · `tests/` · `public/` · `index.html` · `admin.html` · `package.json` · `package-lock.json` · `vite.config.ts` · `nginx/default.conf` · `Dockerfile` · `.dockerignore` · `compose.yaml` · 이 README(Runbook)

- 옮기지 않은 화면은 빈 화면(`pages/Placeholder.vue`)이다. 경로는 v0.1.1 `router.ts` 와 같고, 화면 이슈(#39 · #40 · #41 · #43)에서 component 만 바꾼다.
- 의존성은 지금 쓰는 것만 넣었다. #40 에서 score-core · 악보 그리기(OSMD 1.9.9) · idb 8.0.3 을, #42 에서 연주기(spessasynth_lib · spessasynth_core 3.27.8 — lib 가 core 를 `latest` 로 받아서 core 판을 직접 고정)를 더했다. 판은 v0.1.1 lock 과 같게 고정한다.

### 공통 부품 · API 클라이언트 (#38)

| 위치 | 내용 (v0.1.1 에서 그대로 옮김) |
|---|---|
| `src/styles/` · `src/app.css` · `public/fonts/` | 스타일 토큰 · 스타일가이드 · 공통 배치 · 글꼴(마루 부리를 나눈 `GugakBuri` · 로고 글자 `KlassicWordmark`, 출처 · 라이선스는 `public/fonts/SOURCES.md`). 사용자 · 관리자 진입점이 함께 읽는다 |
| `src/components/` | `C9StepBar`(단계 표시) · `StepNav`([이전] [다음]) · `PageNav`(쪽 넘기기) · `GuardedButton`(막힌 이유를 글자로) · `HelpTip`([?] 도움말) · `LeaveConfirm`(나가기 확인 창) |
| `src/api/client.ts` | fetch 래퍼. 오류 응답(`ErrorResponse`)을 `GateError`(status · code · gate · retryAt)로, 연결 실패는 `NETWORK`, 401 `AUTH_LOGIN_REQUIRED` 면 `/login?next=<지금 주소>` 로 보낸다 |
| `src/types/api.ts` · `score.ts` | 응답 타입. 계약 `web-api.yaml` 스키마와 필드 이름을 대조해 모두 같음 (2026-10-30) |
| `src/composables/useLeaveGuard.ts` | 지금은 클라이언트가 쓰는 부분(만료 이동 · 한 번 건너뛰기 · 같은 흐름 판정)만. `useLeaveGuard()` 는 편집 기록 저장소와 함께 #40 · #41 에서 더한다 |
| `src/composables/useNow.ts` · `src/lib/time.ts` | 지금 시각 · 남은 시간 표시 |

- **오류 문구 (#19 뒤 옮김)**: `C2GateBlock`(반려 안내) · `i18n/gateMessages` · `i18n/fallbackReasons` 는 v0.1.1 그대로. 원본이던 `error-codes.json` 은 #19 에서 `api/shared/errors/common.json` · `web.json` · `model.json` 으로 나뉘었고, `i18n/errorCodes.ts` 가 세 파일의 `gate_codes` · `fallback_reasons` · `status_codes` 를 합쳐 v0.1.1 과 같은 모양으로 내준다. 빌드할 때 번들에 들어간다.
- 화면마다 쓰는 부품(C3 결과 띠 · C4 악기 고르기 · C5 연주 막대 · C6 내려받기 카드 · 악보 보기)은 그 화면 이슈에서 옮긴다.

### 로그인 · 가입 · 머리 메뉴 (#39)

- `stores/auth.ts` · `App.vue`(머리 메뉴 "○○ 님 · [로그아웃]" · 알림 · 바닥글) · `pages/S0Login.vue` 를 v0.1.1 그대로 옮겼다.
- 로그인 가드(`router.ts` 의 `loginGuard`): S1~S3 은 `GET /api/auth/me` 로 확인해 로그인 안 했으면 `/login?next=<주소>`, 로그인한 채 `/login` · `/signup` 은 `/` + "이미 로그인되어 있습니다." 알림. 시험에서 메모리 라우터에 붙이려고 함수로 따로 내보낸다.
- 로그인 실패 · 잠금은 `C2GateBlock` 으로 보인다 (사유는 서버 `message`, 제목 · 해제 주체 · 다음 행동은 공용 오류 코드). 잠금은 `retry_after` 가 지나면 버튼을 다시 연다.
- 확인 (2026-10-30): 이 판 이미지를 v0.1.1 백엔드(9503)에 붙여 브라우저(Playwright)로 가입 → 로그아웃 → 틀린 비밀번호 → 로그인 → 새로고침 유지 → 로그아웃까지 통과.

### 올리기 · 결과 (#40)

| 위치 | 내용 (v0.1.1 에서 그대로 옮김) |
|---|---|
| `pages/S1Home.vue` · `S1Upload.vue` · `S1Result.vue` | 한 화면이 올리기 → 처리 중 → 결과로 바뀐다. 요청 번호는 주소 `?r=` 에 둬 새로 고쳐도 이어 본다 |
| `stores/request.ts` | 올리기(사진 여러 장 · PDF · 예시) · 1초 폴링(`completed` · `service_down` · `expired` 에서 멈춤) · 종류 확인 답 · 대체 받기 |
| `stores/editor.ts` · `autosaveBackend.ts` | 편집 기록(연산 목록) + IndexedDB 자동 저장. S1 결과의 악기 바꾸기 · [작업 저장하기]가 쓴다 (편집 화면은 #41) |
| `stores/instruments.ts` · `lib/instruments.ts` · `lib/ensemble.ts` · `lib/gmNames.ts` | 악기 목록 `GET /api/instruments` 한 번 캐시 — 못 받으면 `api/shared/instruments.json` 으로 |
| `components/C3ResultBand.vue` · `C4InstrumentPicker.vue` · `SaveWorkButton.vue` · `ScoreView.vue` | 결과 띠 · 악기 고르기 · [작업 저장하기](`PUT /edits` `finished:false`) · 악보 그리기(OSMD, 필요할 때 불러옴) |
| `lib/uploadKind.ts` · `examples.ts` · `judgment.ts` · `workSaved.ts` · `scoreCheck.ts` · `noteMatch.ts` · `scoreCore.ts` | 올리기 규칙(`api/shared/upload-rules.json`) · 예시 · 결과 판별 · 저장 표시 · 그리기 전 확인 · 음표 찾기 · score-core 들여오기 |
| `composables/useLeaveGuard.ts` | #38 에서 미뤄 둔 `useLeaveGuard()`(결과가 나온 뒤 나가기 확인)를 더했다 |

- 옮기지 않은 것: 내가 만든 악보(`MyScoresList`) · 공유 악보 목록(`SharedScoreList`)은 P2. 연주 막대(`C5PlayerBar`) · 재생 빠르기는 연주기와 함께 #42 (`S1Result.vue` 에 자리 주석).
- 시험: v0.1.1 `requestStore` · `s1Upload` · `saveWork` · `workSaved` · `editorStore` · `leaveGuard` · `c4Picker` · `ensemble` 8개 파일을 옮겼다.

### 듣기와 편집 (#41)

| 위치 | 내용 (v0.1.1 에서 그대로 옮김) |
|---|---|
| `pages/S2Edit.vue` | 왼쪽 악보(편집본, 음역 벗어난 음은 빨간 머리) · 오른쪽 패널(음표 수정 · 전체 반음 옮기기 · 악기 음량). 열 때 지난 자동 저장본이 있으면 [이어서] · [처음부터]를 묻는다. [원본으로 되돌리기] · [작업 저장하기] · [다음]=편집 마치기(`PUT /edits` `{summary, ops}`) 뒤 내려받기 |
| `components/NoteInspector.vue` | 악보에서 누른 음표의 음 높이 ▲▼, 키보드 ← → (음표 옮기기) · ↑ ↓ + − (반음) |

- 편집 연산은 score-core `applyOps` 로 원본에 얹고(원본은 그대로), `rangeWarnings` · `fitToRangeOps` 로 음역을 본다. `validateOps` 는 v0.1.1 화면도 쓰지 않는다 (서버가 검사).
- 이슈 범위 중 v0.1.1 에서 이미 정리된 것: 악기 바꾸기는 2단계(S1 결과, #40)로 옮겨졌고, 트랙 추가 · 삭제는 화면에서 뺐다(연산은 score-core 에 호환용으로 남음).
- 연주 막대(`C5PlayerBar`) · 재생 빠르기(`set_tempo`) · 원래 악기로 듣기는 #42 에서 붙였다.
- 시험: v0.1.1 `stepsAndNotes` · `round13` 를 옮기고 `saveWork` 의 S2Edit 확인을 되살렸다. `round8` · `round14` 는 S3 · 연주 막대 · 관리자 화면도 함께 확인하므로 #46 에서 옮긴다.

### 연주기 · 사운드폰트 (#42)

| 위치 | 내용 |
|---|---|
| `player/player.ts` | 브라우저 연주기(spessasynth_lib 3.27.8) — ScoreDoc → MIDI(score-core `toMidi`) → Web Audio. 화면 전체에 하나 |
| `player/soundNumbers.ts` | 소리 번호(국악기 bank 1 · 장구 · 북 128/1) · **`fontsFor(doc)` — 그 악보에 필요한 음원** (`api/shared/instruments.json` 의 `soundfont` 칸) |
| `player/tempo.ts` · `components/C5PlayerBar.vue` | 재생 빠르기(4분음표 100 BPM 기준 배율) · 연주 막대(재생 · 멈춤 · 진행 · 빠르기 · 음량) — v0.1.1 그대로 |

**v0.1.1 과 다른 점 — 2026-10-30 팀장 피드백 "재생 지연" (#42 댓글)**

- 필요한 음원만 받는다: `gugak.sf2`(22MB)를 먼저 싣고, 일반 악기(`piano` 등) · 원래 악기를 쓰는 악보일 때만 `FluidR3_GM.sf2`(148MB)를 늦게 받아 뒤에 얹는다. 기본 편성(가야금 · 장구)은 FluidR3 를 받지 않는다. v0.1.1 은 첫 재생 전에 두 파일(약 170MB)을 모두 받았다.
  - 찾는 순서는 v0.1.1 과 같다 (gugak 먼저 → 국악기 번호, FluidR3 → GM 번호). `gugak.sf2` 를 못 받으면 FluidR3 만 싣고 GM 번호로 연주한다.
  - 연주 중에 일반 악기로 바꾸면 그때 FluidR3 를 받기 시작한다 — 받는 동안 그 악기는 대체 음색으로 난다.
- 구간별 시간: `player.timings` 에 음원 받기(`fetchGugakMs` · `fetchFluidMs`) · 싣기(`loadMs` · `loadFluidMs`) · MIDI 만들기(`midiMs`) · 첫 소리까지(`firstSoundMs`)를 남기고, 재생할 때 개발자 도구 콘솔에 `[player] timings {…}` 한 줄을 찍는다. 성능 탭 · `performance.getEntriesByType('measure')` 에서도 `klassic:player:*` 로 보인다.
- 사운드폰트 파일 이름: 아직 v0.1.1 이름(`/soundfonts/gugak.sf2` · `FluidR3_GM.sf2`) + ETag 확인. 판본 이름(`<이름>-v<판>.sf2`)으로 바꾸면 Nginx(#22)에서 1년 `immutable` 캐시 — 파일 이름은 #22 · #31 과 정하고 `SOUNDFONT_URLS` 두 줄만 바꾼다.
- 시험: v0.1.1 `playback207` · `playerRate` · `playerSound` · `preload204` · `round17` 을 옮기고(`preload204` 는 `preload(doc)` 로 바뀐 부분만 고침), `playerFonts` 를 새로 더했다.

### 내려받기 (#43)

| 위치 | 내용 (v0.1.1 에서 그대로 옮김) |
|---|---|
| `pages/S3Download.vue` | 4단계. 기준 악보(결과 + 기본 국악기 구성 + 기기의 편집 기록)로 받는다. MP3 는 성부별 악기(`instruments: {mode:'custom', tracks}`)로 |
| `components/C6DownloadCard.vue` | 형식(MP3 · PDF · MIDI · MusicXML)을 여러 개 골라 [악보 다운받기] 한 번. 형식끼리 서로 기다리지 않는다 |

- 편집이 없으면 MIDI · MusicXML 은 `GET /original/{format}` 을 `<a download>` 로 바로, 그 밖은 `POST /exports` `{format, edit_ops, instruments?}` → **1초 폴링** `GET /exports/:id` → `ready` 면 `download_url`(없으면 `/exports/:id/file`)을 받는다.
- MIDI 가 없는 결과(`midi_available: false`)는 MIDI 칸을 막고 사유를 보인다 (`MIDI_UNAVAILABLE`). 만들기 실패는 `failure_reason`(`RENDER_FAILED` · `RENDER_TIMEOUT` · `RENDERER_MISSING` · `ENGINE_DOWN`) 문구 + [다시 시도].
- 옮기지 않은 것: 모두에게 공유(`SharePanel`)는 P2.
- 시험: v0.1.1 `downloadCard` 를 옮겼다 (오류 문구는 `i18n/errorCodes` 로 읽음).

### 프론트 P1 시험 (#46)

v0.1.1 시험 44개(단위 시험 43개 파일 + 손으로 하는 점검표 1개) 가운데 P1 화면에 해당하는 것을 모두 옮겼다.

| v0.1.1 시험 | 개수 | 이 폴더에서 |
|---|---|---|
| `authGuard` · `loginGuard209` | 2 | `auth.test.ts` 에 합침 (#39) |
| `gateMessages` | 1 | 그대로 (#38) |
| `requestStore` · `s1Upload` · `saveWork` · `workSaved` · `editorStore` · `leaveGuard` · `c4Picker` · `ensemble` | 8 | 그대로 (#40) |
| `stepsAndNotes` · `round13` | 2 | 그대로 (#41) |
| `playback207` · `playerRate` · `playerSound` · `preload204` · `round17` | 5 | 그대로, `preload204` 는 `preload(doc)` 부분만 고침 (#42) |
| `downloadCard` | 1 | 그대로 (#43) |
| `centerTitles213` · `logo203` · `round8` · `round9` · `round10` · `round11` · `round12` · `round14` · `round15` · `round18` · `round19` · `themeAndScore` | 12 | P1 부분만 (#46) — 아래 |
| `sharedScores` · `round16` · `tour210` | 3 | 옮기지 않음 — 공유 악보 · 내가 만든 악보 · 체험하기 (P2) |
| `apiExamples` · `s4aEndpoints` · `s4aStart` | 3 | 옮기지 않음 — API 안내 · 예시 (P2) |
| `admin-*` 6개 | 6 | 옮기지 않음 — 관리자 화면 (P3) |
| `e2e/us6_restore.md` | 1 | 손으로 하는 브라우저 점검표 — 백엔드가 뜬 뒤 브라우저로 (아래 「확인하지 못한 것」) |

`#46` 에서 옮긴 12개 파일은 여러 화면을 한꺼번에 보는 시험이라, P2 · P3 부품을 읽는 줄만 빼고 그 자리에 `// #46:` 주석으로 무엇을 뺐는지 · 언제 되살릴지 적었다.

- P2 · P3 부품(`SharedScoreList` · `MyScoresList` · `SharePanel` · `S1Tour` · `S4AApiGuide` · `C7AdminBar`)을 읽는 줄 · 블록 — 그 화면을 옮길 때 v0.1.1 에서 되살린다
- `logo203` 스타일가이드 견본 HTML 확인 — 견본은 api/ 로 옮기지 않았다 (`proto_type/src/app/docs/reference/style-guide`)
- `themeAndScore` 서버 전용 예시 폴더 확인 — 예시 파일은 백엔드(#34)가 가진다. 화면 쪽 확인(공개 폴더에 없음 · 원본을 받지 않음)만 남겼다
- `round14` 파일 읽기에서 줄 끝을 LF 로 맞춘다 — Windows 에서 받으면(`core.autocrlf`) CRLF 라 `'\n'` 이 들어간 비교가 틀렸다

**결과 (2026-11-01, Windows 10 · Node 22.21.1)**: `npm test` 34개 파일 239개 통과 · 건너뜀 0 · `npm run lint` 오류 0(경고 10개는 옮긴 시험 파일의 `vue/one-component-per-file`) · `npm run build` 성공.

**확인하지 못한 것**: 브라우저에서 실제 흐름(올리기 → 결과 → 편집 → 연주 → 내려받기)과 `us6_restore.md` 점검표. 이 PC 에 Docker 가 없고 새 백엔드(#34 · #36) · 렌더링(#31)이 아직 없다. 그것들이 9603 에 뜨면 이 표에 결과를 더한다.

## Runbook

### 무엇

| 항목 | 값 |
|---|---|
| 이미지 | `${DOCKERHUB_NAMESPACE:-klassic}/frontend:${APP_TAG:-dev}` — 빌드 `node:22.21.1-bookworm-slim` → 실행 `nginxinc/nginx-unprivileged:1.28.0-bookworm` |
| 빌드에 넘기는 바깥 폴더 | compose `additional_contexts` — `shared` → `api/shared`(오류 코드 · 번들에 들어감), `score-core` → `api/packages/score-core`(#40 부터 — 빌드 단계에서 먼저 `npm ci && npm run build`). 이미지 안에서도 `/app/shared` · `/app/services/frontend` 로 저장소와 같은 상대 위치 |
| 실행 사용자 | uid 101 (nginx, non-root) · `read_only` · `/tmp` 만 tmpfs · `cap_drop: ALL` |
| 포트 (컨테이너 → 호스트) | 사용자 `8080` → `127.0.0.1:${API_PUBLIC_PORT}`(9603) · 관리자 `8081` → `127.0.0.1:${API_ADMIN_PORT}`(26201) |
| 환경변수 키 | 실행 시 없음 (화면은 같은 출처로 `/api` 를 부른다). 개발 서버만 `DEV_PUBLIC_TARGET` · `DEV_ADMIN_TARGET` |
| 붙이는 볼륨 | `api/deploy/nginx` → `/etc/nginx/klassic:ro` (팀장 경로 나누기 · #22) |
| 메모리 | 대기 상태 약 5MiB (2026-10-30 `docker stats`). 한도는 부하 측정 뒤 정한다 (#47) |

### Nginx 설정 — 두 server 와 include 지점

| server | 내주는 것 | 404 | include |
|---|---|---|---|
| 사용자 `8080` | `index.html` · `/assets/*` · `public/` 파일. 없는 경로는 `index.html` (history 라우터 새로고침 유지) | `/admin.html` · 없는 `/assets/*` | `deploy/nginx/proxy.conf` — `/api` → web · `/api/v1` → model-api · `/soundfonts`, `/admin/*` · `/api/v1/internal` 은 404 JSON |
| 관리자 `8081` | `/` → `admin.html` · `/assets/*` · `public/` 파일 | `/index.html` · 그 밖의 경로 | `deploy/nginx/admin/admin.conf` — `/admin/*` → admin |

- 캐시: `index.html` · `admin.html` 은 `no-cache`(새 배포가 바로 보이게), `/assets/*` 는 파일 이름에 해시가 있어 1년 `immutable`.
- `deploy/nginx` 가 비어 있으면 include 할 파일이 없어 화면만 내준다 (glob 은 맞는 파일이 없어도 오류가 아니다).
- #22 설정은 `resolver` + 변수로 서비스 주소를 찾으므로, 백엔드 · model-api 가 아직 없어도 Nginx 는 뜨고 그 경로만 502 JSON(`WEB_UNAVAILABLE`)을 준다. 화면의 API 클라이언트는 이것을 `GateError` 로 받는다.
- 서비스 이름 · 컨테이너 안 포트 약속(#22): `web` 9523 · `admin` 26101 · `model-api` 9543.
- 볼륨 경로가 호스트에 없으면 Docker 가 빈 `api/deploy/nginx/` 폴더를 만든다 — 빈 폴더라 Git 에는 올라가지 않는다.

### 어떻게 — 빌드 · 시험 · 기동

```bash
# 코드 시험 — api/shared 를 읽으므로 api/ 전체가 보여야 한다. 이 PC 에 Node 가 없으면 컨테이너에 api/ 를 붙여서:
#   docker run --rm -v "$PWD/api:/api" -w /api/services/frontend node:22.21.1-bookworm-slim sh -c "(cd ../../packages/score-core && npm ci && npm run build) && npm ci && npm test"
cd api/services/frontend
(cd ../../packages/score-core && npm ci && npm run build)   # file: 의존성은 빌드하지 않으므로 먼저 (score-core README)
npm ci
npm run lint
npm test          # vitest — 239개 (라우터 · 클라이언트 오류 처리 · 공통 부품 · 로그인 · 머리 메뉴 · 오류 문구 · 올리기 · 결과 · 편집 기록 · 나가기 확인 · 음표 수정 · 연주기 · 내려받기 · 화면 다듬기 소스 확인)
npm run build     # vue-tsc 타입 검사 + vite → dist/ (index.html · admin.html 두 진입점)

# 이미지로 기동 (api/ 에서)
cd api
cp .env.example .env              # 처음 한 번 — DB_* 값을 채운다 (#20 이후 compose 가 요구, Git 제외)
docker compose config --quiet
docker compose up -d --build frontend   # additional_contexts 때문에 이미지는 compose 로 빌드한다 (docker build 단독이면 --build-context shared=../../shared)
docker compose ps frontend            # (healthy) — 이미지 HEALTHCHECK 가 8080/index.html 을 부른다
docker compose exec frontend id       # uid=101(nginx)
```

확인 (2026-10-30 결과):

| 요청 | 기대 |
|---|---|
| `127.0.0.1:9603/` · `/r/12/listen` · `/api-guide/examples` | 200 `index.html` (새로고침 유지) |
| `127.0.0.1:9603/admin.html` | 404 |
| `127.0.0.1:26201/` · `/admin.html` | 200 `admin.html` |
| `127.0.0.1:26201/index.html` · `/r/12/listen` | 404 |
| LAN 주소(`192.168.x.x`)로 9603 · 26201 | 연결 안 됨 (127.0.0.1 에만 공개 — 외부는 Funnel 로만) |
| (#22 붙인 뒤) `9603/admin/x` · `9603/api/v1/internal/x` | 404 JSON `NOT_FOUND` |
| (#22 붙인 뒤, 백엔드 없음) `9603/api/me` · `26201/admin/me` | 502 JSON `WEB_UNAVAILABLE` |

개발 서버는 `npm run dev`(5173). `/api` · `/soundfonts` · `/admin/` 은 v0.1.1 대역(9503 · 26101)으로 넘긴다. api/ 로 붙이려면 `DEV_PUBLIC_TARGET=http://127.0.0.1:9603 DEV_ADMIN_TARGET=http://127.0.0.1:26201 npm run dev`.

### 만약에

| 증상 | 근거 | 조치 |
|---|---|---|
| 새로고침하면 404 | `default.conf` 의 `try_files … /index.html` 이 빠졌거나 다른 `location` 이 가로챔 | `docker compose exec frontend nginx -T` 로 합쳐진 설정 확인 |
| 컨테이너가 바로 종료 · `emerg` 로그 | `deploy/nginx/*.conf` 문법 오류 또는 upstream 이름(backend 등)을 못 찾음 | `docker compose logs frontend` → 해당 conf 담당(팀장)에게. 화면만 확인하려면 conf 를 잠시 빼고 기동 |
| 9603 `address already in use` | 다른 프로세스가 포트 사용 | `api/.env` 의 `API_PUBLIC_PORT` 확인 · `docker ps` 의 PORTS |
| 화면이 옛날 판 | 브라우저가 `index.html` 을 캐시 | 응답 헤더 `Cache-Control: no-cache` 확인 |

롤백: compose 의 `APP_TAG` 를 이전 태그로 바꾸고 `docker compose up -d frontend`. 이전 태그 이미지는 지우지 않는다.
