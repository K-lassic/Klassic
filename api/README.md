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
| 외부에 여는 것 | gateway 하나 (웹 화면 + `/api/v1`) |
| 외부에 열지 않는 것 | 관리자 화면·API (이 PC의 `127.0.0.1` 에서만) · DB · model-api 직접 접속 |
| 1차 API 계약 | v0.1.1 과 같게 만든다. 바꾸는 내용은 계약 변경 이슈로 따로 올린다 |

## 폴더와 담당

| 폴더 | 담당 | 내용 |
|---|---|---|
| [contracts/](contracts/) | 팀장 · 예은 | API 계약 (OpenAPI) — `web-api.yaml`(팀장) · `model-api.yaml`(예은) |
| [services/backend/](services/backend/) | 팀장 (@majoongcheon) | 사용자 API · 관리자 API · 인식 작업자 |
| [services/model-api/](services/model-api/) | 예은 (@yeeun5364) | 인식 엔진 · 렌더링 · 추천 · 외부 API |
| [services/frontend/](services/frontend/) | 황송해 (@SonghaeHwang) | 사용자 화면 · 관리자 화면 · 정적 파일 서빙(Nginx) |
| [packages/score-core/](packages/score-core/) | 팀장 | 악보 문서 파싱 · 편집 연산 · MIDI/MusicXML 내보내기 (백엔드·프론트 공용) |
| [shared/](shared/) | 팀장 | 오류 코드 · 업로드 규칙 · 악기 목록 (세 서비스 공용) |
| [db/](db/) | 팀장 | DB 마이그레이션 · 초기 데이터 |
| [deploy/](deploy/) | 팀장 | gateway · 외부 공개(Tailscale Funnel) · 운영 설정 |
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

## 작업 규칙

- 코드 작성 규칙: 팀에 공유한 「API 재구성 작성규칙」을 따른다 (`0.0.0.0` 수신 · 서비스 이름으로 호출 · `/health` 는 준비 완료 기준 · 로그는 stdout · 비밀값은 실행 시 주입 · non-root · `latest` 미사용).
- 작업 흐름: 이슈 → 브랜치(`<type>/<이슈번호>-<짧은 설명>`, 예: `feat/12-auth-session`) → PR(`Closes #12`) → 리뷰 → 병합.
- 커밋 메시지: Conventional Commits (`feat(backend): ...`, `build(model-api): ...`).
- 비밀값(`.env`, 키, 토큰)은 저장소·이미지·로그에 넣지 않는다. 형식은 `.env.example` 로만 공유한다.

## 실행

0단계(골격)라서 아직 실행할 서비스가 없다. 설정 확인만 할 수 있다.

```bash
cd api
docker compose config
```
