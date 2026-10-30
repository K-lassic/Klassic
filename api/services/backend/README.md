# backend (담당: 팀장 @majoongcheon)

사용자 API(`/api/*`, web) · 관리자 API(`/admin/*`, admin) · 인식 작업자 · 렌더링 대기열 · 주기 작업.

- 참고 코드: `proto_type/src/app/backend` (Node.js 22 · Express · TypeScript, 약 4,500줄 · 테스트 29개 파일 — helpers 포함)
- 계약: [../../contracts/web-api.yaml](../../contracts/web-api.yaml) (화면 쪽) · [../../contracts/model-api.yaml](../../contracts/model-api.yaml) (부르는 쪽)

## 재구성 시 바꿀 점

- 수신 주소 `0.0.0.0`, model-api 는 서비스 이름(`http://model-api:<포트>`)으로 호출 — `MODEL_API_URL` 환경변수
- 외부 공개(HTTPS 프록시 뒤): `trust proxy` 로 실제 접속 주소 읽기 · 세션 쿠키 `Secure` · 요청 한도
- 관리자(admin)는 외부에 열지 않는다 (호스트 `127.0.0.1` 에만 공개)

## 이 폴더에 둘 파일

`src/` · `tests/` · `package.json` · `package-lock.json` · `Dockerfile` · `.dockerignore` · `compose.yaml` · `.env.example` · 이 README(Runbook: 기동 · 확인 · 장애 조치)

---

## v0.1.1 기능 목록 (#5)

> 재구성 이슈(2단계 이후)의 범위와 완료 기준으로 쓴다. 우선순위: **P1** 발표 필수 · **P2** 여유 있으면 · **P3** 발표 이후.
> 참고 경로는 `proto_type/src/app/backend/src/` 기준. 테스트는 `proto_type/src/app/backend/tests/`.

### 1. 유스케이스(UC)별 기능

권한은 **경로 → UC** 대응표(`auth/permissions.ts`)와 DB `role_permission`(역할 → UC)으로 판정한다. 로그인 없이 쓰는 UC 는 UC11 · UC16 뿐이다.

| UC | 기능 | 사용자 API | 참고 | 테스트 | 우선 |
|---|---|---|---|---|---|
| UC16 | 익명 세션 · 가입 · 로그인 · 로그아웃 · 내 정보 · 세션 끝내기 | `/api/auth/*` · `/api/session/end` | `web/session.ts` · `auth/accounts.ts` | `login_single` · `rbac` | **P1** |
| UC1 | 악보 올리기(사진 여러 장 · PDF 1개) · 예시로 올리기 · 상태 · 결과 악보 · 종류 확인 답 · 화면 이벤트 · 엔진 상태 | `/api/requests*` · `/api/examples*` · `/api/models/status` | `web/requests.ts` · `uploadCheck.ts` · `examples.ts` · `services/requestWorker.ts` | `us1_upload_to_result` · `us3_us4_upload` · `examples` · `validity_items` · `upload_rules`(contract) | **P1** |
| UC2 | 대체 결과 요청 | `POST /api/requests/:no/fallback` | `services/fallback.ts` | `us2_fallback` | **P1** |
| UC6 | 편집 기록(연산 목록) 저장 — 편집 자체는 브라우저 IndexedDB | `PUT /api/requests/:no/edits` | `web/edits.ts` | `us7_us8` | **P1** |
| UC7 | 내보내기(MusicXML · MIDI · MP3 · PDF) · 상태 · 내려받기 · 원본 결과 내려받기 | `/api/requests/:no/exports*` · `/original/:format` | `web/exports.ts` · `services/renderQueue.ts` | `us7_us8` · `midi_available` · `tempo_export` | **P1** |
| UC7 | 내가 만든 악보 목록 · 지우기 | `/api/my-scores*` | `web/myScores.ts` | `my_scores` | P2 |
| UC5 | 국악기 조합 추천 · 악기 고르기 · 악기 목록 | `/api/requests/:no/recommendation` · `/instrument-choice` · `/api/instruments` | `web/recommendation.ts` · `services/placedEnsemble.ts` | `instrument_selection` | P2 |
| UC18 | 악보 공유 · 거두기 · 공유 게시판 · 듣기 · 좋아요 · 공유 악보로 시작하기 | `/api/requests/:no/share` · `/api/shared-scores*` | `web/shared.ts` | `shared_scores` · `shared_use` | P2 |
| UC11 | API 활용 안내 (model-api `openapi.json` 을 가져와 보여 줌) | `GET /api/api-docs` | `web/apiDocs.ts` | – | P2 |
| UC15 | 외부 API 키 신청 | `POST /api/key-applications` | `web/keyApplications.ts` | `us10_keys` | P2 |
| (관리) | 운영자 로그인 · 계정 · 권한 · 접근 키 · **서비스 키 발급** · 키 신청 · 라이선스 · 처리 설정 · 모델 등록부 · 운영 현황 · 작업 · 감사 · 평가 · 공유 악보 관리 | `/admin/*` (외부 비공개) | `admin/*` | `us9_admin` · `admin_accounts` · `us10_keys` | P3 ※ |

※ 관리자 API 가 늦어지면 **서비스 키 발급만 명령줄 도구로** 먼저 만든다 (backend → model-api 호출에 꼭 필요). 운영자 계정도 v0.1.1 처럼 명령줄(`admin/createOperator.ts`)로 만든다.

### 2. 화면에 드러나지 않는 동작 (빠뜨리기 쉬운 것)

| # | 동작 | 내용 | 참고 | 우선 |
|---|---|---|---|---|
| H1 | 설정 검증 후 시작 | `.env` 를 zod 로 검증 — 필수 값이 없으면 **시작하지 않는다** (`SESSION_SECRET` 32자 이상 등) | `config/env.ts` | **P1** |
| H2 | 처리 설정 "판본" | 시간 제한 · 동시 처리 수 · 한도 · 로그인 잠금 등은 `.env` 가 아니라 DB `processing_setting_version` 의 **현재 판본**을 읽는다 | `config/settings.ts` | **P1** |
| H3 | 업로드 규칙 일치 확인 | 시작할 때 `shared/upload-rules.json` 과 DB 판본의 파일 크기 상한이 같은지 확인 · 로그 | `server.ts` `startupCheck()` | P2 |
| H4 | 세션 서명 쿠키 | `gugak_sid = 세션ID.HMAC서명` · HttpOnly · SameSite=Lax · 없으면 익명 세션 새로 발급 · 2시간 무활동이면 종료 | `web/session.ts` · `jobs/purgeSessions.ts` | **P1** |
| H5 | 로그인 시 세션 재발급 | 세션 고정 공격 방지 — 로그인 성공하면 **새 세션 ID** 로 바꾼다 | `web/session.ts` `rotateSession()` | **P1** |
| H6 | 로그인 실패 잠금 | 실패 5번이면 10분 잠금(설정 판본 값) · `LOGIN_LOCKED` + 다시 시도 시각 | `auth/accounts.ts` | **P1** |
| H7 | 한 계정 한 곳 로그인 | 다른 곳에서 이미 로그인 중이면 `LOGIN_ALREADY_ACTIVE` | `auth/accounts.ts` | P2 |
| H8 | 가입 한도 | 같은 접속 주소에서 시간당 5번(`SIGNUP_HOURLY_CAP`) | `auth/accounts.ts` | P2 |
| H9 | 권한 숨김 | 대응표에 없는 경로는 **404** (권한 존재를 드러내지 않음) · 권한표 60초 캐시 | `auth/authz.ts` · `auth/permissions.ts` | **P1** |
| H10 | 소유 확인 | 요청 번호 경로는 "이 계정 · 세션의 요청인가"를 한 번 더 확인 · 보관 기간 지나면 `RESULT_EXPIRED` | `web/ownership.ts` | **P1** |
| H11 | 사용자 요청 한도 (G12) | 계정 · 접속 주소별 **처리 중 1건** + 시간당 상한 → `429` + `Retry-After` | `web/webLimit.ts` | P2 |
| H12 | 업로드 검사 | 형식 · 손상 · 용량 · 쪽 수 · 사진 짧은 변 순서로 검사 · **PDF 는 model-api 에 맡김**(같은 판정기) · 닿지 않으면 `UPLOAD_CHECK_UNAVAILABLE` | `web/uploadCheck.ts` · `services/uploadInspect.ts` | **P1** |
| H13 | 저장 경로 보호 | 파일은 `storage/<요청번호>/…` 상대 경로로 저장 · `safe()` 가 storage 밖 접근을 막음 | `services/storage.ts` | **P1** |
| H14 | 인식 대기열 · 동시 처리 | 메모리 대기열 + 동시 상한(기본 2) · `X-Deadline` 으로 마감 시각 전달 | `services/requestWorker.ts` | **P1** |
| H15 | 마감 두 개 | **대기 상한**(접수 + 제한 × 쪽 수) · **처리 마감**(시작 + 제한 × 쪽 수), 기본 제한 180초 | `services/requestWorker.ts` | **P1** |
| H16 | watchdog | 1초마다 마감 넘긴 요청을 **대체 결과로 끝냄** | `services/requestWorker.ts` `watchdogTick()` | **P1** |
| H17 | 대체 결과 | 실패 · 시간 초과 · model-api 멈춤 · 구조 불합격 · 불신 판정 → 악보 종류별 템플릿(아리랑 · 미뉴에트 · 타령) · 없으면 `service_down` | `services/fallback.ts` | **P1** |
| H18 | 악보 종류 확인 | 오선보로 올렸는데 정간보처럼 보이면 `awaiting_type_answer` 로 사용자에게 묻는다 | `web/requests.ts` | P2 |
| H19 | 재시작 복구 — 인식 | web 이 다시 뜨면 끝나지 않은 요청을 DB 에서 읽어 **대기열에 다시 넣는다** | `services/requestWorker.ts` `startWorker()` | **P1** |
| H20 | 재시작 복구 — 렌더링 | 하다 만 MP3 · PDF 렌더링은 **실패로 정리** (다시 요청해야 함) | `services/renderQueue.ts` `recoverRenders()` | **P1** |
| H21 | 렌더링 대기열 | MP3 · PDF 는 동시 상한(`max_concurrency_render`) 대기열로 model-api 호출 · MIDI · MusicXML 은 백엔드가 바로 만듦(score-core) | `services/renderQueue.ts` · `web/exports.ts` | **P1** |
| H22 | 편집은 연산 목록 | 원본 결과를 덮어쓰지 않고 연산(ops)을 저장 → 내보낼 때 원본 + 악기 지정 + `applyOps` | `web/edits.ts` · `web/exports.ts` | **P1** |
| H23 | MP3 악기 지정 | 성부마다 악기를 `{"mode":"custom","tracks":[…]}` 로 넘김 · 안 넘기면 기본(가야금 · 장구) | `web/exports.ts` · `services/placedEnsemble.ts` | **P1** |
| H24 | 최초 악기 선택 기록 | 결과가 나오면 기본 편성을 선택 기록으로 남긴다 (타악 성부가 없으면 장구는 연주 안 됨) | `services/placedEnsemble.ts` `recordInitialSelection()` | P2 |
| H25 | 게이트 기록 | 막힌 사건(G2 키 · G12 한도 · G13 권한 등)을 `gate_event` 에 남긴다 | `services/gateEvents.ts` | P2 |
| H26 | 오류 응답 한 모양 | `{error:{code,message,fix,gate,retry_after,details},api_version}` · 코드 · 문구 · HTTP 상태는 `shared/error-codes.json`(70개) · `retry_after` 면 `Retry-After` 머리글 | `web/errors.ts` | **P1** |
| H27 | 로그 마스킹 | pino JSON → stdout · DB 오류는 SQL 본문 · 값을 지우고 코드만 | `lib/logger.ts` | **P1** |
| H28 | model-api 호출 규칙 | `X-API-Key`(서비스 키) · 마감 있으면 남은 시간, 없으면 15초 타임아웃 · 실패는 `ModelApiDown(unreachable/timeout/http)` 하나로 | `services/modelApiClient.ts` | **P1** |
| H29 | 엔진 상태 캐시 · 순서 | model-api `/v1/models` 상태를 캐시하고 설정 판본의 엔진 순서로 첫 사용 가능 엔진을 고른다 | `services/modelStatus.ts` | **P1** |
| H30 | 공유 악보로 시작 | 공유 악보를 "쓰기" 하면 새 요청을 만든다 (`request_from_share`) | `web/shared.ts` | P2 |

### 3. 주기 작업 (web 에서만, `node-cron`)

| 주기 | 작업 | 참고 | 우선 |
|---|---|---|---|
| 10분 | 결과 만료 — 접수 24시간 지난 요청의 파일 · 편집 기록 지움 (기록 행은 지표용으로 남김) | `jobs/purgeResults.ts` | P2 |
| 10분 | 공유 악보 정리 — 공유 3일 지나면 복사본 · 좋아요 지움 | `jobs/purgeSharedScores.ts` | P2 |
| 10분 | 식별값 삭제 — 24시간 지난 요청의 세션 ID · 접속 주소 해시 · 게이트 대상 값 지움 | `jobs/purgeIdentity.ts` | P2 |
| 10분 | 무활동 세션 종료 (2시간) | `jobs/purgeSessions.ts` | **P1** (H4) |
| 10분 | 점검 쿼리 P1 · P2 · Q1~Q9 — 0행이 아니면 경고 로그 | `jobs/index.ts` `CHECK_QUERIES` | P3 |
| 매시 7분 | 키 신청 기록 7일 지나면 지움 | `jobs/purgeApplications.ts` | P3 |

### 4. 재구성 때 바꿀 점

| # | v0.1.1 | 재구성 | 관련 이슈 |
|---|---|---|---|
| C1 | web · admin 이 `127.0.0.1` 수신, gateway 가 `127.0.0.1` 고정 호출 | `0.0.0.0` 수신 · `MODEL_API_URL` 등 서비스 이름으로 호출 | 백엔드 골격 · gateway |
| C2 | `/api/health` 가 DB 확인 없이 항상 200 | DB · 설정 판본을 읽을 수 있을 때만 200 | 백엔드 골격 |
| C3 | DB 연결 재시도 없음 | 시작 시 재시도 후 포기 (예: 5회 · 2초) | 백엔드 골격 |
| C4 | 화면 정적 파일을 백엔드가 내줌 | 프론트 이미지(Nginx)가 내준다 — 백엔드는 API 만 | 프론트 골격 |
| C5 | 외부 공개 고려 없음 | `trust proxy`(실제 접속 주소) · 쿠키 `Secure` · `PUBLIC_API_URL` 을 Funnel 주소로 | #9 결과 → 외부 공개 대응 |
| C6 | 인식 대기열이 프로세스 메모리 → web 1개만 가능 | 1차는 그대로(1개) · 재시작 복구(H19)로 보완 | – (P3: 대기열 외부화) |
| C7 | web · admin 이 같은 이미지 · 실행 인자만 다름 | 1차는 그대로 (역할 인자) | – |

### 5. 테스트 대응

v0.1.1 테스트 22개 파일(unit 2 · integration 19 · contract 1, 그 밖에 helpers 7개)을 재구성 완료 기준으로 쓴다. 위 표의 "테스트" 칸이 대응 관계다.

| 묶음 | 파일 |
|---|---|
| unit | `permissions` · `requestDeadline` |
| integration — P1 | `us1_upload_to_result` · `us2_fallback` · `us3_us4_upload` · `us7_us8` · `midi_available` · `tempo_export` · `login_single` · `rbac` · `validity_items` · `examples` · `migrate` |
| integration — P2 | `my_scores` · `instrument_selection` · `shared_scores` · `shared_use` · `jobs` · `us10_keys` |
| integration — P3 | `us9_admin` · `admin_accounts` |
| contract | `upload_rules` |
