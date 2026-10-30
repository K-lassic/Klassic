# K-lassic API 재구성 진행계획

> 작성일: 2026-10-30 · 대상: 팀 전원 · 결과물 폴더: [`api/`](../api/)
> 기준판: `proto_type/` (v0.1.1, 참고용 — 고치지 않음)

---

## 1. 일정

**발표: 2026-11-05 (목) · 발표자: 팀장(SeongGi Jo)** — 마감은 그 전날인 마일스톤 [Limit day](https://github.com/K-lassic/Klassic/milestone/1) (11/04 수).

**목표:** 가능하면 **전부 재구성해서 11/04 에 `api/` 로 서비스가 돌아가게** 한다. 늦어지면 발표는 **예비 시연(현재 proto_type v0.1.1)** 으로 한다.

| 마일스톤 | 기한 | 끝나는 기준 |
|---|---|---|
| [1단계 분석·계약](https://github.com/K-lassic/Klassic/milestone/2) | **10/31 (토)** | 계약 2종 병합 · 분석 3종 정리 · v0.1.1 외부 공개 시험 |
| [2단계 공통 기반](https://github.com/K-lassic/Klassic/milestone/3) | **11/01 (일)** | shared · DB · score-core 준비 · 세 서비스 골격이 compose 로 기동 |
| [3단계 핵심 기능](https://github.com/K-lassic/Klassic/milestone/4) | **11/03 (화)** | 발표 범위(P1) 기능 구현 — v0.1.1 컨테이너를 상대 서비스 대역으로 써서 각자 시험 |
| [Limit day](https://github.com/K-lassic/Klassic/milestone/1) | **11/04 (수)** | `api/` 만으로 통합 · Tailscale Funnel 외부 공개 · 발표 리허설 |
| 발표 | 11/05 (목) | – |

- 남은 기간은 5일이고 재구성 후보는 약 59개 이슈다. 전부를 목표로 하되 **P1 → P2 → P3 순서**로 만들어서, 어느 시점에 멈춰도 핵심 흐름은 돌아가게 한다 → 3절
- **2단계 이슈는 1단계 결과를 보고 10/31 에 정한다.**

## 2. 정해진 사항

| 항목 | 결정 |
|---|---|
| 재구성 방식 | v0.1.1 을 참고해 같은 기능 또는 일부 고친 기능을 **이슈 단위로 새로 작성** |
| 서버 | 팀장 PC(Windows · Docker Desktop · WSL2)를 서버로 구동 |
| 외부 공개 | **Tailscale Funnel** (도메인 없음 → `*.ts.net` 주소 · HTTPS 자동 · 공유기 포트 개방 없음) |
| 외부 공개 범위 | gateway 하나 — 웹 화면 + 외부 API(`/api/v1`) |
| 외부 비공개 | **관리자 화면 · API**(서버 PC 에서만) · DB · model-api 직접 접속 |
| 1차 API 계약 | v0.1.1 과 같게 — 바꾸는 내용은 `contract` 라벨 이슈로 따로 |
| 우선순위 라벨 | `P1` 발표 필수 · `P2` 여유 있으면 · `P3` 발표 이후 |

## 3. 구현 순서 (제안 — 1단계 결과로 확정)

목표는 전부지만, 시간이 모자랄 때 먼저 빠지는 것이 뒤쪽이 되도록 우선순위를 붙인다.

| 우선 | 범위 |
|---|---|
| **P1** | 세션 · 가입/로그인 → 악보 올리기(사진 · PDF) → 인식(오선보 homr · 정간보) → 결과 → 편집 → 연주 → 내려받기(MusicXML · MIDI · MP3 · PDF) · 외부 API(키로 악보 올리기 → 결과 받기) · **외부 공개** |
| P2 | 국악기 추천 · 공유 게시판 · 내 악보 · API 안내 화면 · 요청 한도 · CI · Docker Hub 이미지 게시 |
| P3 | 관리자 화면 · 관리자 API(늦어지면 서비스 키는 명령줄 · 초기 데이터로 발급) · Audiveris · 평가 · demo · 롤백 시험 |

### 예비 시연 (proto_type v0.1.1)

- #9 에서 v0.1.1 을 Funnel 로 공개해 두고, **발표 전까지 언제든 켤 수 있는 상태로 유지**한다.
- 11/04 리허설에서 `api/` 와 proto_type 중 **발표에 쓸 쪽을 정한다.** 전환은 Funnel 이 가리키는 gateway 를 바꾸는 것으로 한다.
- `api/` 와 proto_type 은 같은 PC 에서 돌아가므로 **호스트 포트 · 컨테이너 이름 · 볼륨이 겹치지 않게** 한다 (proto_type 은 9503 · 26101 사용 중).
- proto_type 의 컨테이너 · 볼륨(DB · 엔진 · 업로드)은 지우지 않는다 (`docker compose down -v` 금지).

## 4. 팀과 담당 폴더

| 이름 | GitHub | 역할 | 담당 폴더 |
|---|---|---|---|
| SeongGi Jo | @majoongcheon | 팀장 · 백엔드 · 공통 · 배포 | `api/services/backend` · `api/packages/score-core` · `api/shared` · `api/db` · `api/deploy` · `api/compose.yaml` · `.github` |
| 예은 | @yeeun5364 | 모델 | `api/services/model-api` · `api/contracts/model-api.yaml` |
| 황송해 | @SonghaeHwang | 프론트엔드 | `api/services/frontend` |

- 담당은 `.github/CODEOWNERS` 에 있다 — 남의 폴더를 바꾼 PR 에는 그 담당자가 자동으로 리뷰어로 붙는다.
- 각자 자기 서비스의 `Dockerfile` · `compose.yaml` · `.env.example` · CI 워크플로 · README(Runbook)를 직접 쓴다.
- 업무량은 팀장 쪽이 많다. 1단계 뒤 분량을 보고 담당을 다시 나눌 수 있다 (score-core → 황송해, 백업 · CI 템플릿 → 예은 등).

## 5. 1단계 이슈 (등록 완료)

| 이슈 | 제목 | 담당 | 우선 |
|---|---|---|---|
| ~~#2~~ | [골격] api 폴더 구조 · CODEOWNERS · 이슈/PR 템플릿 — ✅ PR #3 병합 | 팀장 | P1 |
| #4 | [계약] web-api.yaml 작성 (`/api/*` · `/admin/*`) — 리뷰: 황송해 | 팀장 | P1 |
| #5 | [분석] 백엔드 기능 목록 · 숨은 동작 정리 | 팀장 | P1 |
| #6 | [계약] model-api.yaml 작성 (`/v1/*`) — v0.1.1 `openapi.json` 에서 출발 · 리뷰: 팀장 | 예은 | P1 |
| #7 | [분석] 엔진 · 외부 의존성 Linux 전환 조사 — Audiveris 발표 포함 여부 판단 | 예은 | P1 |
| #8 | [분석] 화면 목록 · 화면별 호출 API 정리 — #4 리뷰 근거 | 황송해 | P1 |
| #9 | [공개] v0.1.1 로 Tailscale Funnel 외부 공개 시험 | 팀장 | P1 |

모든 분석 결과에 **P1 / P2 / P3 표시**를 붙인다. 2단계 이슈는 이 표시를 기준으로 정한다.

## 6. 2단계 이후 이슈 후보 (미등록 — 1단계 결과로 조정)

| 담당 | 후보 |
|---|---|
| 팀장 · 공통 | shared 설정 이전(오류 코드 영역별 분리) · DB 기준 파일 · score-core 이전 · db compose |
| 팀장 · 백엔드 | 골격 · 인증/세션/권한 · 올리기/상태 · 인식 작업자 · 추천 · 편집/내보내기 · 공유 · API 안내 · 관리자 API 3개 · 주기 작업 · 외부 공개 대응 · 테스트 |
| 예은 · 모델 | 골격(인증 · health) · 업로드 검사 · 엔진 공통 + homr · 정간보 · Audiveris · 렌더링 · 추천 · 외부 API · 내부 API · 엔진 볼륨 · 외부 공개 대응 · 테스트 · CI |
| 황송해 · 프론트 | 골격(Vite · Nginx) · 공통 컴포넌트 · 로그인/홈 · 올리기/결과 · 편집 · 연주기 · 내려받기/공유 · API 안내 · 관리자 화면 2개 · 화면 분리 서빙 · 테스트 · CI |
| 팀장 · 배포 | gateway 재작성 · Funnel 구성 · 서버 PC 운영 설정 · 백업 · CI/릴리스 · 통합 검증 |

## 7. 작업 규칙

1. **이슈 → 브랜치 → PR → 리뷰 → 병합.** 브랜치 이름은 `<type>/<이슈번호>-<짧은 설명>` (예: `feat/12-auth-session`), PR 본문에 `Closes #12`.
2. 커밋 메시지는 Conventional Commits (`feat(backend): …` · `build(model-api): …` · `docs(contracts): …`).
3. 같은 파일을 함께 고치지 않는다:
   - 서비스 정의는 각 서비스 폴더의 `compose.yaml` (루트는 `include` 만)
   - 서비스마다 lock 파일 따로 · score-core 는 `file:` 경로로 연결
   - DB 마이그레이션은 `YYYYMMDD_HHMM_<설명>.sql` 로 **새 파일만 추가**
   - 오류 코드는 `shared/errors/{common,web,model}.json` 영역별 파일
4. 계약(`api/contracts/`)을 바꾸려면 `contract` 라벨 PR → 상대 담당 리뷰 → 병합 후 구현.
5. 코드 작성 규칙은 [API_재구성_작성규칙.md](API_재구성_작성규칙.md) 를 따른다 (`0.0.0.0` 수신 · 서비스 이름으로 호출 · `/health` 는 준비 완료 기준 · 로그는 stdout · non-root · `latest` 미사용).
6. 비밀값(`.env` · 키 · 토큰 · Tailscale 인증 키)은 저장소 · 이미지 · 로그 · 이슈에 넣지 않는다. 형식은 `.env.example` 로만 공유한다.
7. 막히면 `blocked` 라벨과 원인 · 필요한 도움을 이슈에 적는다. 결정 사항은 채팅에만 남기지 말고 이슈에 기록한다.
