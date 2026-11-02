# backend (담당: 팀장 @majoongcheon)

사용자 API(`/api/*`, web) · 관리자 API(`/admin/*`, admin) · 인식 작업자 · 렌더링 대기열 · 주기 작업.

- 참고 코드: `proto_type/src/app/backend` (Node.js 22 · Express · TypeScript, 약 4,500줄 · 테스트 29개 파일 — helpers 포함)
- 계약: [../../contracts/web-api.yaml](../../contracts/web-api.yaml) (화면 쪽) · [../../contracts/model-api.yaml](../../contracts/model-api.yaml) (부르는 쪽)

## 재구성 시 바꿀 점

- 수신 주소 `0.0.0.0`, model-api 는 서비스 이름(`http://model-api:<포트>`)으로 호출 — `MODEL_API_URL` 환경변수
- 외부 공개(HTTPS 프록시 뒤): `trust proxy` 로 실제 접속 주소 읽기 · 세션 쿠키 `Secure` · 요청 한도
- 관리자(admin)는 외부에 열지 않는다 (호스트 `127.0.0.1` 에만 공개)

## 이 폴더에 둘 파일

`src/` · `tests/` · `package.json` · `package-lock.json` · `Dockerfile` · `.dockerignore` · `compose.yaml` · 이 README(Runbook: 기동 · 확인 · 장애 조치). 설정 형식은 `api/.env.example`.

---

## Runbook (#23 골격)

### 구조에서의 위치

```
Nginx 사용자 server ─ /api/*   ─▶ web   (node dist/server.js --role=web,   컨테이너 안 9523)
Nginx 관리자 server ─ /admin/* ─▶ admin (node dist/server.js --role=admin, 컨테이너 안 26101)
web · admin ─▶ MariaDB(db) — 계정 · 요청 · 결과 · 설정 판본 (파일 본체는 저장소 볼륨, DB 에는 위치만 — #34)
web ─▶ 볼륨 storage(/storage) — 원본 · 결과 파일. 뿌리 파일시스템은 읽기 전용이라 쓸 수 있는 곳은 여기뿐 (#34)
web ─▶ model-api (MODEL_API_URL, 서비스 키 SERVICE_API_KEY)
```

악보 올리기 흐름 (#34): 화면 → Nginx → `POST /api/requests` → 검사(사진은 web, PDF 는 model-api) → 한도 → 볼륨에 저장 → DB 에 위치 기록 → `queued` → 작업자(#35)가 인식 → 화면은 1초마다 `GET /api/requests/{no}`.

같은 이미지(`klassic/backend`)를 실행 인자만 바꿔 띄운다. 호스트 포트는 열지 않는다 — Nginx 만 서비스 이름으로 부른다.

### 파일

| 파일 | 하는 일 |
|---|---|
| `src/server.ts` | 시작점 — 설정 검증 → 공용 설정 → DB 기다리기(5회 · 2초) → 설정 판본 확인 → 수신 · SIGTERM 정리 |
| `src/app.ts` | Express 앱 두 개 — `createWebApp` · `createAdminApp`. `/api` 순서: health → 세션 → 권한 → 라우터 → 404 |
| `src/web/session.ts` | (#27) 세션 쿠키 `gugak_sid`(서명 · HttpOnly · SameSite=Lax) · 로그인 때 재발급 · `/api/session/end` |
| `src/auth/accounts.ts` | (#27) `/api/auth/signup` · `login` · `logout` · `me` — argon2id · 잠금 · 한 계정 한 곳 · 가입 한도 |
| `src/auth/permissions.ts` · `authz.ts` | (#27) 경로 → UC 대응표 + DB `role_permission` → 401 · 403 · 대응표 밖 404 |
| `src/web/ownership.ts` | (#27) 요청 번호가 이 계정 것인지 (`/api/requests/{no}/…` 라우터가 #34 부터 쓴다) |
| `src/lib/ids.ts` · `src/services/gateEvents.ts` | (#27) 쿠키 서명 · 접속 주소 해시 · 요청 번호(#34) / 막힌 사건 `gate_event` (G1 · G12 · G13 · G14 · G15) |
| `src/web/requests.ts` | (#34) `/api/requests` 올리기 · 상태 · `/score` · `/type-confirmation` · `/fallback` |
| `src/web/uploadCheck.ts` · `webLimit.ts` | (#34) 업로드 검사 G1 · 사용자 한도 G12 |
| `src/web/examples.ts` | (#34) `/api/examples` · 미리보기 · `/api/requests/example` — 파일은 `assets/examples/` |
| `src/services/storage.ts` | (#34) 볼륨 읽기 · 쓰기 — 저장소 · assets 밖 경로를 막는다 |
| `src/services/requestStatus.ts` | (#34) `RequestStatus` 응답 만들기 |
| `src/services/requestWorker.ts` | (#34 · #35) 인식 작업자 — 대기열 · 동시 상한 · 마감 두 개 · 1초 감시 · 종류 확인 · 재시작 복구 |
| `src/web/models.ts` | (#35) `/api/models/status` |
| `src/web/edits.ts` | (#36) `/api/requests/{no}/edits` — 편집 연산 기록 |
| `src/web/exports.ts` | (#36) `/exports` · `/file` · `/original/{format}` — MIDI · MusicXML 은 바로, MP3 · PDF 는 대기열 |
| `src/services/renderQueue.ts` | (#36) 렌더링 대기열 · 동시 상한 · 재시작 때 실패로 정리 |
| `src/web/instruments.ts` | (#36) `/api/instruments` · 시작할 때 음원 확인 |
| `src/services/placedEnsemble.ts` | (#36) 실제로 놓인 악기만 첫 선택으로 기록 (`/events`) |
| `src/web/edits.ts` | (#36) `/api/requests/{no}/edits` — 편집 연산 기록 |
| `src/web/exports.ts` | (#36) `/exports` · `/file` · `/original/{format}` — MIDI · MusicXML 은 바로, MP3 · PDF 는 대기열 |
| `src/services/renderQueue.ts` | (#36) 렌더링 대기열 · 동시 상한 · 재시작 때 실패로 정리 |
| `src/web/instruments.ts` | (#36) `/api/instruments` · 시작할 때 음원 확인 |
| `src/services/placedEnsemble.ts` | (#36) 실제로 놓인 악기만 첫 선택으로 기록 (`/events`) |
| `src/services/fallback.ts` | (#34) 대체 결과 — `assets/templates/` · 없으면 `service_down` |
| `src/services/modelApiClient.ts` · `modelStatus.ts` · `uploadInspect.ts` | (#34) model-api 호출 · 모델 상태 캐시 · PDF 검사 위임 |
| `assets/` | (#34) 이미지에 굽는 예시 악보 · 대체 악보. 출처는 `assets/examples/SOURCES.md` |
| `src/config/env.ts` | 환경변수 zod 검증 — 빠진 키 이름만 알리고 값은 출력하지 않음 |
| `src/config/shared.ts` | `api/shared` 읽기 — 오류 파일 세 개를 합침 (중복이면 시작 안 함) |
| `src/config/settings.ts` | 처리 설정 판본(DB) — 5초 캐시 |
| `src/db/pool.ts` | mysql2 풀 · `waitForDb` 재시도 · `query` · `one` · `exec` · `tx` |
| `src/web/errors.ts` | 공통 오류 응답 `ApiError` · `errorHandler` · `wrap` |
| `src/lib/logger.ts` | pino JSON → stdout · DB 오류의 SQL 본문 지움 |
| `Dockerfile` | 2단계 빌드 · score-core 먼저 빌드 · shared · score-core 를 이미지에 구움 · `node` 사용자 · exec 형식 |
| `tests/unit/skeleton.test.ts` | DB 없이 도는 시험 8개 — score-core `file:` 설치 · 설정 검증 · 오류 합치기 · 응답 모양 · DB 없을 때 503 |

### 기동 · 확인

```bash
cd api
docker compose up -d --build web admin     # db · migrate 가 먼저 끝난 뒤 뜬다 (depends_on)
docker compose ps                          # web · admin 이 (healthy)
curl http://127.0.0.1:9603/api/health      # Nginx 경유 → {"status":"ok","role":"web","setting_version":1}
curl http://127.0.0.1:26201/admin/health   # 관리자 server 경유 → {"status":"ok","role":"admin",...}
docker compose logs -f web                 # JSON 한 줄 로그
```

- `/api/health` · `/admin/health` 는 **DB 에 닿고 처리 설정 판본을 읽을 수 있을 때만 200**, 아니면 503 `SERVICE_NOT_READY` (`details.reason` = `db` · `settings`).

### 시험 (컨테이너 안에서)

score-core 를 먼저 빌드해야 `file:` 로 가져올 수 있다. 계약 대조에 `contracts/web-api.yaml` 도 필요하다. 음원(164MB)은 복사하지 않는다.

```bash
docker run --rm -v "$PWD/api:/src:ro" node:22.21.1-bookworm-slim sh -c '
  mkdir -p /w/packages /w/services /w/shared && cp -r /src/packages/score-core /w/packages/ && cp -r /src/contracts /w/ && cp -r /src/shared/errors /src/shared/fixtures /src/shared/*.json /w/shared/ && cp -r /src/services/backend /w/services/
  cd /w/packages/score-core && npm ci && npm run build
  cd /w/services/backend && npm ci && npm run build && SHARED_DIR=/w/shared npm test'
```

위처럼 돌리면 DB 가 필요한 `tests/integration/*` 는 건너뛴다. **통합 시험(#27~)** 은 시험용 DB 프로젝트를 따로 띄워 그 네트워크에서 돌린다 — 실제 `api/` DB 에는 시험 데이터를 넣지 않는다.

```bash
cd api
docker compose -p klassic-api-test up -d --wait db && docker compose -p klassic-api-test run --rm migrate
set -a; . ./.env; set +a            # DB 계정 값을 셸에만 읽는다 (화면에 출력하지 않음)
docker run --rm --network klassic-api-test_default \
  -e TEST_DB_HOST=db -e TEST_DB_USER="$DB_USER" -e TEST_DB_PASSWORD="$DB_PASSWORD" -e TEST_DB_NAME="$DB_NAME" \
  -v "$PWD:/src:ro" node:22.21.1-bookworm-slim sh -c '…위와 같은 복사 · 빌드… && SHARED_DIR=/w/shared npm test'
docker compose -p klassic-api-test down -v   # 시험용 프로젝트만 지운다 (이름 확인!)
```

- **계약 대조 (#44):** `tests/helpers/serve.ts` 가 시험 서버 앞에 `contract.ts` 를 끼워, 통합 시험의 모든 JSON 응답을 `contracts/web-api.yaml` 과 맞춰 본다. 어긋나면 시험 파일이 실패한다 (`contractCheck.ts`). 경로 · 응답을 바꾸면 계약도 같이 고친다.
- **경로 확인:** `CONTRACT_LOG=/tmp/routes.log` 를 주면 시험이 지나간 경로 · 상태가 남는다.
- **공유 시험 파일:** `api/shared/fixtures/upload` — model-api 검사기(#28)도 같은 파일로 시험한다.
- 시험 DB 첫 초기화에서 migrate 가 `1130 Host ... not allowed` 로 실패하면 시험용 프로젝트를 지우고 다시 띄운다 — WSL2 시계가 거꾸로 움직여 초기화가 끊긴 경우다 (로그 `certificate is not yet valid`, 2026-11-01).
- `tests/integration/requests.test.ts` 는 작업자를 켜지 않고 완료 상태를 `tests/helpers/db.ts` 로 DB 에 직접 만든다. 인식까지 잇는 시험은 `worker.test.ts`. model-api 는 둘 다 `tests/helpers/fakeModelApi.ts`.
- Windows `curl` 로 손시험할 때 명령줄에 한글을 쓰면 UTF-8 이 아닌 cp949 로 보내져 깨진 글자(`EFBFBD`)로 저장된다 — 본문을 UTF-8 파일로 만들어 `--data-binary @파일` 로 보낸다 (서버 문제 아님, 2026-10-30 확인).

### 시험 결과 (#44, 2026-11-01)

단위 + 통합 155개 통과 · 건너뜀 없음 · 응답 계약 대조 통과 · 마이그레이션 두 번째 실행 `이번에 적용 0 개`.

| v0.1.1 시험 | 여기 시험 |
|---|---|
| `us1_upload_to_result` | `worker.test.ts` · `requests.test.ts` |
| `us2_fallback` | `worker.test.ts` · `requests.test.ts` |
| `us3_us4_upload` · `contract/upload_rules` | `requests.test.ts` · `uploadCheck.test.ts` · `uploadFixtures.test.ts` |
| `us7_us8` · `midi_available` · `tempo_export` | `exports.test.ts` |
| `login_single` · `rbac` | `auth.test.ts` · `requests.test.ts` · `permissions.test.ts` · `contractRoutes.test.ts` |
| `validity_items` · `examples` | `requests.test.ts` |
| `migrate` | `migrate.test.ts` |
| `unit/requestDeadline` | `storage.test.ts` |

옮기지 않은 것 (P2 · P3 — 그 기능을 만들 때 옮긴다): `rbac` 의 키 신청 · 관리자 로그인, `us7_us8` 의 세션 2시간 정리, `admin_accounts` · `jobs` · `my_scores` · `shared_*` · `us9_admin` · `us10_keys` · `instrument_selection`.

계약의 `POST /admin/service-key`(P1)는 API 가 아니라 명령줄 도구로 대신한다 (#26). 인식 · 렌더링을 실제 엔진으로 확인한 결과는 PR #73 · #74.

### 운영 명령줄 도구 (#26)

관리자 API(P3)가 생기기 전까지, 운영자 계정과 서비스 키는 서버 PC 에서 명령줄로 만든다. 웹 · 외부에서는 부를 수 없다.

```bash
cd api
# 1) 운영자 계정 — 비밀번호(12자 이상)를 화면에 안 보이게 두 번 묻는다 (-it 필요)
docker compose run --rm -it web node dist/tools/createOperator.js --login <아이디> --name <이름>

# 2) 서비스 키 — 이전 서비스 키는 폐기되고 새 키 원문이 한 번만 나온다
docker compose run --rm web node dist/tools/issueServiceKey.js --operator <운영자 아이디>
#    → api/.env 의 SERVICE_API_KEY= 뒤에 붙여 넣고
docker compose up -d web          # web 을 다시 만들어야 새 값을 읽는다
```

| 도구 | 파일 | DB 에 남는 것 |
|---|---|---|
| 운영자 만들기 | `src/tools/createOperator.ts` | `account`(argon2id 해시) · `operator_account` · `account_role`(operator · user). 이미 가입한 계정이면 operator 역할만 더함 |
| 서비스 키 발급 | `src/tools/issueServiceKey.ts` → `src/services/accessKeys.ts` | `access_key`(SHA-256 해시 + 앞 8글자, 원문 없음) · 이전 서비스 키 `revoked` · `change_history`(누가 발급 · 폐기했는지) |

- 키 원문은 **표준 출력에만** 나오고, 안내는 표준 오류로 나온다 — `> 파일` 로 받으면 키만 남는다. 로그 · DB 에는 원문이 없다.
- 비밀번호는 명령줄 인자로 받지 않는다(셸 기록 · 프로세스 목록에 남으므로). 자동화할 때만 환경변수 `ADMIN_PASSWORD`.
- 외부 키 발급(예시 홈페이지 · 키 신청, P2)은 `services/accessKeys.ts` 에 `issueExternalKey` 로 더한다 (시간당 호출 한도 필수 — DB 제약).

### 장애 조치 (증상 → 근거 → 조치)

| 증상 | 근거 | 조치 |
|---|---|---|
| web · admin 이 시작하자마자 꺼짐 | `docker compose logs web` 에 `설정이 빠졌거나 잘못됐습니다: <키>` | `api/.env` 에 그 키를 채운다 (`api/.env.example` 참고) |
| 로그에 `DB 연결 실패 — 다시 시도` 5번 뒤 `시작 실패` | db 가 healthy 가 아님 | `docker compose ps db` · `logs db` 확인 → 볼륨 · 비밀번호 |
| `처리 설정 판본이 없습니다` | 마이그레이션(초기 데이터)이 안 됨 | `docker compose run --rm migrate` |
| `오류 코드 중복` 으로 시작 안 함 | `api/shared/errors/*.json` 에 같은 코드 | `python api/shared/check_errors.py` 로 찾아 한쪽에서 지운다 |
| `/api/health` 503 `reason: db` | 운영 중 DB 끊김 | DB 가 돌아오면 자동 회복 (2026-10-30 시험: 다시 켠 뒤 약 6초) |
| 도구가 `터미널이 없어 비밀번호를 물을 수 없습니다` | `docker compose run` 에 `-it` 가 없음 | `-it` 를 붙여 다시 실행 |
| model-api 호출이 401 · 403 | 401 은 `SERVICE_API_KEY` 가 비었거나 틀린 키, 403 `AUTH_KEY_REVOKED` 는 폐기된 키 | `issueServiceKey` 로 새로 발급 → `.env` → `docker compose up -d web` |
| web 이 `EACCES` · `EROFS` 로 `시작 실패` | 볼륨 storage 가 없거나 쓸 수 없음 (시작할 때 `/storage` 쓰기를 확인한다) | `docker compose exec web ls -ld /storage` — 소유자가 `node` 인지 |
| PDF 만 503 `UPLOAD_CHECK_UNAVAILABLE` · 사진은 됨 | model-api 가 꺼졌거나 서비스 키 오류 (로그 `PDF 검사 불가`) | `docker compose ps model-api` · 위의 401 조치 |
| 재생해도 소리가 안 남 · `/soundfonts/*` 404 또는 아주 작은 파일 | 로그 `음원 파일이 없거나 LFS 포인터뿐` | `git lfs pull` 후 `docker compose up -d web` — 파일은 `api/shared/soundfonts`, 읽기 전용 마운트 |
| MP3 · PDF 만 `failed` · MIDI · MusicXML 은 됨 | model-api 렌더링 문제. `failure_reason` 이 `ENGINE_DOWN`(닿지 않음) · `RENDERER_MISSING` · `RENDER_TIMEOUT`(10분) | `docker compose logs model-api`. web 재시작으로 `RENDER_FAILED` 가 됐다면 다시 내보내면 된다 |
| 재생해도 소리가 안 남 · `/soundfonts/*` 404 또는 아주 작은 파일 | 로그 `음원 파일이 없거나 LFS 포인터뿐` | `git lfs pull` 후 `docker compose up -d web` — 파일은 `api/shared/soundfonts`, 읽기 전용 마운트 |
| MP3 · PDF 만 `failed` · MIDI · MusicXML 은 됨 | model-api 렌더링 문제. `failure_reason` 이 `ENGINE_DOWN`(닿지 않음) · `RENDERER_MISSING` · `RENDER_TIMEOUT`(10분) | `docker compose logs model-api`. web 재시작으로 `RENDER_FAILED` 가 됐다면 다시 내보내면 된다 |
| 인식이 모두 `ENGINE_DOWN` 대체로 끝남 | model-api 가 꺼졌거나 500 (대체 이유가 `ENGINE_DOWN`) | `docker compose ps model-api` · `logs model-api` |
| 인식이 모두 `RECOGNITION_FAILED` 대체로 끝남 | model-api 가 4xx — 대개 서비스 키 오류 | 위의 401 조치 |
| 요청이 한동안 `queued` | 동시 처리 상한(`web_concurrency_share`)만큼 앞 요청을 처리 중. 마감을 넘기면 `TIMEOUT` 대체로 끝난다 | 설정 판본 확인 · `docker compose logs web` |
| `/score` 410 인데 보관 기간 안 · 로그 `DB 에 있는 결과 파일이 저장소에 없음` | DB 와 볼륨이 어긋남 | 볼륨 `klassic-api_storage` 가 붙어 있는지 · 지워지지 않았는지 |
| 로그 `주기 정리 — 확인 필요` | `missing_files` = DB 에 있는데 파일이 없음 · `orphan_files` = DB 에 없는 파일(10분 넘은 것) · `purge_failed` · `failed_steps` = 정리 실패. 고아 파일은 보고만 하고 지우지 않는다 | 로그의 `missing_sample` · `orphan_sample` 로 경로를 확인. 정리 실패는 다음 주기에 다시 처리되며, 계속되면 `logs web` 의 오류를 본다 |
| 큰 업로드가 수십 초 걸리거나 web 이 `Exited (137)` | 업로드는 검사가 끝날 때까지 메모리에 있다. 측정: 190MB 3건 동시 677MB · 15초 (`mem_limit` 1g) | `docker stats` 로 확인 후 한도 조정 (#49) |
| 로그인 · 가입이 가끔 500, 로그에 `sqlState 23000 · errno 4025` | DB CHECK 제약 위반 (mysql2 가 코드 이름을 `AUTOEXTEND_SIZE` 로 잘못 붙임) — `chk_session_time` 이면 서버 PC 시계가 뒤로 보정된 것 | #27 에서 `ended_at = GREATEST(현재, started_at)` 로 막았다. 다른 제약이면 `SHOW CREATE TABLE` 로 확인 |
| 로그인하면 `LOGIN_ALREADY_ACTIVE` | 같은 계정이 다른 브라우저에서 10분 안에 활동 중 (한 계정 한 곳) | 그 브라우저에서 로그아웃하거나 10분 기다린다 |

### 2026-10-30 확인 결과

- 이미지 빌드 · web/admin healthy · 사용자 `node`(uid 1000) · 수신 `0.0.0.0` · 메모리 각 약 25MB (한도 512m · 256m)
- Nginx(9603) → web `/api/health` 200 · 26201 → admin 200 · 9603 의 `/admin/*` 404 — #22 경로를 실제 백엔드로 다시 확인
- DB 정지 → 503 `SERVICE_NOT_READY` → DB 다시 켜면 약 6초 뒤 200
- `docker compose stop web` 1초 (SIGTERM 받아 정리)
- 남은 것: `/api/v1/*` 는 model-api(#24) 뒤 확인 · 실제 접속 주소(trust proxy)는 #37

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

### 3. 주기 작업 (web 에서만)

> #85 구현: `src/services/periodicJobs.ts`. 아래 표의 P1 항목 · 공유 악보 3일 정리(#90) · DB ↔ 파일 일치 확인까지 들어갔고, 점검 쿼리 · 키 신청은 아직 없다.
> 간격은 `PERIODIC_JOB_SECONDS`(기본 21600초 = 6시간)이고 web 이 켜질 때 바로 한 번 돈다. 만료된 파일은 정리 전에도 접근이 막히므로 실제 삭제는 만료 뒤 최대 6시간 늦을 수 있다. 결과는 로그 `주기 정리` 한 줄로 남는다. `node-cron` 은 쓰지 않는다.


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
