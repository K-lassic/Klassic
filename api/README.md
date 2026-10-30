# K-lassic api — 재구성 서비스

`proto_type/`(v0.1.1, 기존 API)을 참고해 **이슈 단위로 새로 작성하는** 서비스 코드를 모으는 폴더다.
`proto_type/` 은 참고용으로 그대로 두고 고치지 않는다.

## 목표

- 이 PC(Windows · Docker Desktop · WSL2)를 서버로 구동해 **외부에서 웹 화면과 외부 API(`/api/v1`)** 를 쓸 수 있게 한다.
- 소스는 GitHub, 이미지는 Docker Hub 에서 버전별로 관리한다.

## 정해진 사항

| 항목 | 결정 |
|---|---|
| 외부 공개 방식 | **Tailscale Funnel** (도메인 없음 → `*.ts.net` 주소 · HTTPS 자동 · 공유기 포트 개방 없음) |
| 외부에 여는 것 | 입구(Nginx) 하나 — 웹 화면 + `/api/*` + `/api/v1` |
| 외부에 열지 않는 것 | 관리자 화면·API (이 PC의 `127.0.0.1` 에서만) · DB · model-api 직접 접속 |
| 1차 API 계약 | v0.1.1 과 같게 만든다. 바꾸는 내용은 계약 변경 이슈로 따로 올린다 |
| 입구 구조 (2026-10-30) | **Nginx 하나**가 화면 정적 파일과 경로 나누기를 모두 맡는다 (Node gateway 없음). 설정은 두 파일로 나눈다 → 아래 「Nginx 설정 나누기」 |
| 호스트 포트 | 입구 `9603` · 관리자 `26201`(127.0.0.1 만) — proto_type(9503 · 26101) +100, `.env.example` 의 `API_PUBLIC_PORT` · `API_ADMIN_PORT` |
| 관리자 | 별도 서비스로 나누지 않는다 (조정안 B 안 함). v0.1.1 처럼 같은 백엔드 코드를 `--role=admin` 으로 · 화면은 `admin.html` 진입점 |

## 폴더와 담당

| 폴더 | 담당 | 내용 |
|---|---|---|
| [contracts/](contracts/) | 팀장 · 예은 | API 계약 (OpenAPI) — `web-api.yaml`(팀장) · `model-api.yaml`(예은) |
| [services/backend/](services/backend/) | 팀장 (@majoongcheon) | 사용자 API · 관리자 API · 인식 작업자 |
| [services/model-api/](services/model-api/) | 예은 (@yeeun5364) | 인식 엔진 · 렌더링 · 추천 · 외부 API |
| [services/frontend/](services/frontend/) | 황송해 (@SonghaeHwang) | 사용자 화면 · 관리자 화면 · 정적 파일 서빙(Nginx) |
| [packages/score-core/](packages/score-core/) | 황송해 (리뷰 팀장) | 악보 문서 파싱 · 편집 연산 · MIDI/MusicXML 내보내기 (백엔드·프론트 공용) — 조정안 A |
| [shared/](shared/) | 팀장 | 오류 코드 · 업로드 규칙 · 악기 목록 (세 서비스 공용) |
| [db/](db/) | 팀장 | DB 마이그레이션 · 초기 데이터 |
| [deploy/](deploy/) | 팀장 | DB compose · Nginx 경로 나누기(`deploy/nginx/`) · 외부 공개(Tailscale Funnel) · 운영 설정 |
| [compose.yaml](compose.yaml) | 팀장 | 서비스별 compose 를 묶기만 한다 |

담당 폴더 밖의 파일을 고치면 `.github/CODEOWNERS` 에 따라 그 폴더 담당자가 리뷰어로 지정된다.

## 같은 파일을 함께 고치지 않기 위한 규칙

1. **서비스 정의는 각 서비스 폴더의 `compose.yaml`** 에 둔다. 루트 `compose.yaml` 은 `include` 만 한다.
2. 서비스마다 자기 폴더 안에 `Dockerfile` · `.dockerignore` · `compose.yaml` · `.env.example` · `README.md`(Runbook) 를 둔다.
3. 서비스마다 **lock 파일을 따로** 둔다 (npm workspaces 로 lock 하나를 같이 쓰지 않는다). score-core 는 `file:` 경로로 연결한다.
4. DB 마이그레이션은 **날짜·시각 이름**으로 새 파일만 추가한다 → [db/README.md](db/README.md)
5. 오류 코드는 영역별 파일로 나눈다 → [shared/README.md](shared/README.md)
6. CI 는 서비스별 워크플로 파일로 나누고 바뀐 폴더만 검사한다.
7. 계약(`contracts/`)을 바꿀 때는 PR 로 올리고 상대 쪽 담당자가 리뷰한다.
8. Nginx 설정은 두 파일로 나눈다 → 아래 「Nginx 설정 나누기」

## Nginx 설정 나누기 (#21 · #22)

```
services/frontend/nginx/default.conf   황송해 — 화면 정적 파일 · 새로고침 시 화면 유지 · 캐시
   ├ 사용자 server (8080 → 호스트 9603)  끝에 include /etc/nginx/klassic/*.conf;
   └ 관리자 server (8081 → 127.0.0.1:26201) 끝에 include /etc/nginx/klassic/admin/*.conf;
deploy/nginx/proxy.conf                팀장 — 사용자 server: /api → web · /api/v1 → model-api · /soundfonts ·
                                        /api/v1/internal · /admin 404 · 실제 접속 주소 · 업로드 크기 · 대기 시간
deploy/nginx/admin/admin.conf          팀장 — 관리자 server: /admin/* → admin
```

- 프론트 이미지는 `default.conf` 로 굽고, `deploy/nginx/` 는 실행할 때 `/etc/nginx/klassic:ro` 로 붙인다.
- 둘이 맞물리는 곳은 `services/frontend/compose.yaml` 의 볼륨 한 줄뿐이다 (처음 한 번 황송해가 쓰고 바꾸지 않는다).
- 관리자 경로는 `admin/` 폴더에만 둔다 — 사용자 server 의 `*.conf` 는 하위 폴더를 읽지 않으므로, 관리자 API 가 외부 공개 쪽에 실수로 들어가지 않는다 (2026-10-30 황송해 제안).
- model-api 경로는 계약(`model-api.yaml`)으로 약속하고, 예은은 Nginx 파일을 고치지 않는다.
- **서비스 이름 · 컨테이너 안 포트 약속** (#22 ↔ #23 · #24 compose): `web` 9523 · `admin` 26101 · `model-api` 9543. Nginx 는 이 이름을 요청 때마다 Docker DNS 로 찾으므로, 서비스가 아직 없어도 뜨고 그 경로만 502 JSON 을 돌려준다.

## 작업 규칙

- 코드 작성 규칙: [docs/API_재구성_작성규칙.md](../docs/API_재구성_작성규칙.md) 를 따른다 (`0.0.0.0` 수신 · 서비스 이름으로 호출 · `/health` 는 준비 완료 기준 · 로그는 stdout · 비밀값은 실행 시 주입 · non-root · `latest` 미사용).
- 작업 흐름: 이슈 → 브랜치(`<type>/<이슈번호>-<짧은 설명>`, 예: `feat/12-auth-session`) → PR(`Closes #12`) → 리뷰 → 병합.
- **push 전에 항상 pull**: 작업 시작 전 `git switch main && git pull`, push 전 `git fetch` 로 원격 `main` 을 확인해 내 브랜치에 합친 뒤 push 한다 (강제 push 금지) → [진행계획 §7](../docs/API_진행계획.md)
- 커밋 메시지: Conventional Commits (`feat(backend): ...`, `build(model-api): ...`).
- 비밀값(`.env`, 키, 토큰)은 저장소·이미지·로그에 넣지 않는다. 형식은 `.env.example` 로만 공유한다.

## 실행

0단계(골격)라서 아직 실행할 서비스가 없다. 설정 확인만 할 수 있다.

```bash
cd api
docker compose config
```
