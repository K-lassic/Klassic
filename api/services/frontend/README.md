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

- 화면은 아직 모두 빈 화면(`pages/Placeholder.vue`)이다. 경로는 v0.1.1 `router.ts` 와 같고, 화면 이슈(#39 · #40 · #41 · #43)에서 component 만 바꾼다.
- 의존성은 지금 쓰는 것만 넣었다 (vue · vue-router · pinia). score-core · 연주기(spessasynth) · 악보 그리기(OSMD) · idb 는 쓰는 이슈에서 넣는다. 판은 v0.1.1 lock 과 같게 고정한다.

### 공통 부품 · API 클라이언트 (#38)

| 위치 | 내용 (v0.1.1 에서 그대로 옮김) |
|---|---|
| `src/styles/` · `src/app.css` · `public/fonts/` | 스타일 토큰 · 스타일가이드 · 공통 배치 · 글꼴(마루 부리를 나눈 `GugakBuri` · 로고 글자 `KlassicWordmark`, 출처 · 라이선스는 `public/fonts/SOURCES.md`). 사용자 · 관리자 진입점이 함께 읽는다 |
| `src/components/` | `C9StepBar`(단계 표시) · `StepNav`([이전] [다음]) · `PageNav`(쪽 넘기기) · `GuardedButton`(막힌 이유를 글자로) · `HelpTip`([?] 도움말) · `LeaveConfirm`(나가기 확인 창) |
| `src/api/client.ts` | fetch 래퍼. 오류 응답(`ErrorResponse`)을 `GateError`(status · code · gate · retryAt)로, 연결 실패는 `NETWORK`, 401 `AUTH_LOGIN_REQUIRED` 면 `/login?next=<지금 주소>` 로 보낸다 |
| `src/types/api.ts` · `score.ts` | 응답 타입. 계약 `web-api.yaml` 스키마와 필드 이름을 대조해 모두 같음 (2026-10-30) |
| `src/composables/useLeaveGuard.ts` | 지금은 클라이언트가 쓰는 부분(만료 이동 · 한 번 건너뛰기 · 같은 흐름 판정)만. `useLeaveGuard()` 는 편집 기록 저장소와 함께 #40 · #41 에서 더한다 |
| `src/composables/useNow.ts` · `src/lib/time.ts` | 지금 시각 · 남은 시간 표시 |

- **#19 뒤로 미룬 것**: `C2GateBlock`(반려 안내) · `i18n/gateMessages` · `i18n/fallbackReasons` — v0.1.1 `shared/error-codes.json` 을 읽는데, #19 에서 `shared/errors/*.json` 으로 나뉘므로 그 모양이 정해진 뒤 옮긴다.
- 화면마다 쓰는 부품(C3 결과 띠 · C4 악기 고르기 · C5 연주 막대 · C6 내려받기 카드 · 악보 보기)은 그 화면 이슈에서 옮긴다.

## Runbook

### 무엇

| 항목 | 값 |
|---|---|
| 이미지 | `${DOCKERHUB_NAMESPACE:-klassic}/frontend:${APP_TAG:-dev}` — 빌드 `node:22.21.1-bookworm-slim` → 실행 `nginxinc/nginx-unprivileged:1.28.0-bookworm` |
| 실행 사용자 | uid 101 (nginx, non-root) · `read_only` · `/tmp` 만 tmpfs · `cap_drop: ALL` |
| 포트 (컨테이너 → 호스트) | 사용자 `8080` → `127.0.0.1:${API_PUBLIC_PORT}`(9603) · 관리자 `8081` → `127.0.0.1:${API_ADMIN_PORT}`(26201) |
| 환경변수 키 | 실행 시 없음 (화면은 같은 출처로 `/api` 를 부른다). 개발 서버만 `DEV_PUBLIC_TARGET` · `DEV_ADMIN_TARGET` |
| 붙이는 볼륨 | `api/deploy/nginx` → `/etc/nginx/klassic:ro` (팀장 경로 나누기 · #22) |
| 메모리 | 대기 상태 약 5MiB (2026-10-30 `docker stats`). 한도는 부하 측정 뒤 정한다 (#47) |

### Nginx 설정 — 두 server 와 include 지점

| server | 내주는 것 | 404 | include |
|---|---|---|---|
| 사용자 `8080` | `index.html` · `/assets/*` · `public/` 파일. 없는 경로는 `index.html` (history 라우터 새로고침 유지) | `/admin.html` · 없는 `/assets/*` | `/etc/nginx/klassic/*.conf` — `/api` · `/api/v1` · `/soundfonts` 등 |
| 관리자 `8081` | `/` → `admin.html` · `/assets/*` · `public/` 파일 | `/index.html` · 그 밖의 경로 | `/etc/nginx/klassic/admin/*.conf` — `/admin/*` → backend(admin) |

- 캐시: `index.html` · `admin.html` 은 `no-cache`(새 배포가 바로 보이게), `/assets/*` 는 파일 이름에 해시가 있어 1년 `immutable`.
- `deploy/nginx` 가 비어 있으면 include 할 파일이 없어 화면만 내준다 (glob 은 맞는 파일이 없어도 오류가 아니다).
- 볼륨 경로가 호스트에 없으면 Docker 가 빈 `api/deploy/nginx/` 폴더를 만든다 — 빈 폴더라 Git 에는 올라가지 않는다.

### 어떻게 — 빌드 · 시험 · 기동

```bash
# 코드 시험 (이 PC 에 Node 가 없으면 node:22-bookworm-slim 컨테이너 안에서)
cd api/services/frontend
npm ci
npm run lint
npm test          # vitest — 라우터 10 · 클라이언트 오류 처리 10 · 공통 부품 8
npm run build     # vue-tsc 타입 검사 + vite → dist/ (index.html · admin.html 두 진입점)

# 이미지로 기동 (api/ 에서)
cd api
docker compose config --quiet
docker compose up -d --build frontend
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

개발 서버는 `npm run dev`(5173). `/api` · `/soundfonts` · `/admin/` 은 v0.1.1 대역(9503 · 26101)으로 넘긴다. api/ 로 붙이려면 `DEV_PUBLIC_TARGET=http://127.0.0.1:9603 DEV_ADMIN_TARGET=http://127.0.0.1:26201 npm run dev`.

### 만약에

| 증상 | 근거 | 조치 |
|---|---|---|
| 새로고침하면 404 | `default.conf` 의 `try_files … /index.html` 이 빠졌거나 다른 `location` 이 가로챔 | `docker compose exec frontend nginx -T` 로 합쳐진 설정 확인 |
| 컨테이너가 바로 종료 · `emerg` 로그 | `deploy/nginx/*.conf` 문법 오류 또는 upstream 이름(backend 등)을 못 찾음 | `docker compose logs frontend` → 해당 conf 담당(팀장)에게. 화면만 확인하려면 conf 를 잠시 빼고 기동 |
| 9603 `address already in use` | 다른 프로세스가 포트 사용 | `api/.env` 의 `API_PUBLIC_PORT` 확인 · `docker ps` 의 PORTS |
| 화면이 옛날 판 | 브라우저가 `index.html` 을 캐시 | 응답 헤더 `Cache-Control: no-cache` 확인 |

롤백: compose 의 `APP_TAG` 를 이전 태그로 바꾸고 `docker compose up -d frontend`. 이전 태그 이미지는 지우지 않는다.
