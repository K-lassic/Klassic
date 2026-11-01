# shared (담당: 팀장 @majoongcheon)

세 서비스(backend · model-api · frontend)가 함께 읽는 설정 파일. v0.1.1 `proto_type/src/app/shared/` 를 옮겼다 (#19).

## 구조에서의 위치

```
                       ┌─ backend   — 오류 응답 · 업로드 검사 · 악기 목록 (실행할 때 읽음)
api/shared/ ── 이미지에 ┼─ model-api — 오류 응답 · 업로드 검사 · 악기 목록 (실행할 때 읽음)
             구워 넣음  └─ frontend  — 오류 문구 · 업로드 안내 · 악기 목록 (빌드할 때 화면 번들에 들어감)
```

## 파일

| 파일 | 내용 | 담당 | v0.1.1 |
|---|---|---|---|
| `errors/common.json` | 두 서비스가 함께 쓰는 오류 코드 26개 (업로드 형식 · 요청 없음 · 결과 만료 · 준비 중 · 대체 이유 · 렌더링 실패 등) + `api_version` | 팀장 (두 서비스 담당 함께 리뷰) | `error-codes.json` 에서 나눔 |
| `errors/web.json` | 백엔드만 쓰는 코드 35개 (가입 · 로그인 · 관리자 · 요청 한도 · 키 신청 등) | 팀장 | 〃 |
| `errors/model.json` | model-api 만 쓰는 코드 9개 (API 키 · 호출 한도 · 렌더러 등) | 예은 | 〃 |
| `upload-rules.json` | 업로드 형식 · 크기 · 쪽 수 · 사진 짧은 변 | 팀장 | 그대로 복사 |
| `instruments.json` | 악기 목록 · 기본 편성 | 팀장 | 그대로 복사 |
| `check_errors.py` | 세 오류 파일 점검 (중복 · 필드 · v0.1.1 비교) | 팀장 | 새로 작성 |

- 오류 코드는 v0.1.1 코드에서 **실제로 쓰는 곳**을 찾아 나눴다: 둘 다 쓰면 common, 백엔드만 쓰면 web, model-api 만 쓰면 model, 아무도 안 쓰면 common.
- 세 파일을 **합치면 v0.1.1 `error-codes.json` 과 같다** (70개 — gate_codes 51 · fallback_reasons 7 · status_codes 12). 2026-10-30 확인.
- 2026-10-30 #23: `SERVICE_NOT_READY` 를 model → common 으로 옮김 (백엔드 `/api/health` 도 쓰게 되어 — 아래 「바꿀 때」 규칙).
- 시험용 파일(v0.1.1 `shared/fixtures/upload/`, 27MB)은 옮기지 않았다 — 시험 이슈(#44 · #45)에서 필요한 것만 가져온다.

## 오류 파일 읽는 규칙 (backend · model-api · frontend 공통)

1. `errors/common.json` · `web.json` · `model.json` **세 파일을 모두 읽어** `gate_codes` · `fallback_reasons` · `status_codes` 를 각각 합친다.
2. `$` 로 시작하는 키는 설명이라 건너뛴다.
3. 같은 코드가 두 파일에 있으면 오류로 보고 시작하지 않는다 (`check_errors.py` 가 미리 잡는다).
4. 응답 모양은 그대로 — `{"error":{"code","message","fix","gate","retry_after","details"},"api_version":"v1"}` (INTERFACES §2).

## 이미지에 넣는 방법 — 서비스 담당이 각자 Dockerfile 에

각 서비스의 빌드 범위(`context: .`)는 자기 폴더라 `api/shared` · `api/packages/score-core` 가 보이지 않는다.
**compose 의 `additional_contexts` 로 넘겨 이미지에 굽는다** — 실행할 때 저장소 폴더를 붙이는 방식은 Docker Hub 이미지만 받는 서버에서 동작하지 않는다.

```yaml
# services/<서비스>/compose.yaml
services:
  <서비스>:
    build:
      context: .
      additional_contexts:
        shared: ../../shared
        score-core: ../../packages/score-core   # backend · frontend 만
```

```dockerfile
# services/<서비스>/Dockerfile — 저장소와 같은 상대 위치로 놓으면 file:../../packages/score-core 가 그대로 풀린다
WORKDIR /app/services/<서비스>
COPY --from=shared . /app/shared
COPY --from=score-core . /app/packages/score-core
```

- backend · model-api: 실행할 때 `/app/shared` 를 읽는다 (경로는 환경변수 `SHARED_DIR`, 기본 `/app/shared`).
- frontend: 빌드할 때 `import … from '../../../shared/…'` 로 번들에 넣는다 (v0.1.1 과 같은 상대 위치).

## 바꿀 때

- 코드를 더하거나 고치면 **자기 영역 파일만** 고치고, `python api/shared/check_errors.py` 를 돌린다 (통과해야 PR).
- 새 코드 이름은 영역 접두어 권장: `WEB_…` · `MODEL_…` (v0.1.1 코드 이름은 그대로 둔다 — 화면 · 시험이 이 이름을 쓴다).
- 두 서비스가 함께 쓰게 된 코드는 `common.json` 으로 옮긴다 (두 담당 리뷰).
- `upload-rules.json` 의 숫자 상한은 DB 처리 설정 판본이 있으면 그 값이 우선이다 (v0.1.1 과 같음). Nginx 업로드 상한(`deploy/nginx/proxy.conf` 210m)도 같이 본다.

## 업로드 공유 시험 파일 (`fixtures/upload/`, #44)

파일마다 나와야 할 코드를 `expected.json` 에 적었다. 웹 검사기(`tests/unit/uploadFixtures.test.ts`)와 model-api 검사기(#28)가 같은 파일로 시험해 판정이 같은지 확인한다. `big_25mb.png`(27MB)는 저장소에 넣지 않고 시험에서 만든다.

## 음원 (`soundfonts/`, #36)

`gugak.sf2`(22MB) · `FluidR3_GM.sf2`(142MB)는 Git LFS 로 관리하고, 크기가 커서 이미지에 굽지 않는다 — backend 는 `services/backend/compose.yaml` 에서 읽기 전용으로 붙여 `/soundfonts/*` 로 내준다. 파일을 받으려면 `git lfs pull`. 출처 · 이용 조건은 `soundfonts/SOURCES.md`.

## 음원 (`soundfonts/`, #36)

`gugak.sf2`(22MB) · `FluidR3_GM.sf2`(142MB)는 Git LFS 로 관리하고, 크기가 커서 이미지에 굽지 않는다 — backend 는 `services/backend/compose.yaml` 에서 읽기 전용으로 붙여 `/soundfonts/*` 로 내준다. 파일을 받으려면 `git lfs pull`. 출처 · 이용 조건은 `soundfonts/SOURCES.md`.
