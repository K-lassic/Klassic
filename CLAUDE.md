# K-lassic

국악보 변환·편집 서비스를 Linux·Docker 운영 구조로 재구성하는 저장소.

- 기준판: `proto_type/` (v0.1.x) — 참고만 하고 고치지 않는다
- 재구성 서비스: `api/` (v0.2.x) — 구조와 폴더 담당은 [api/README.md](api/README.md)
- 진행 계획: [docs/API_진행계획.md](docs/API_진행계획.md) · 운영 Runbook: [api/deploy/README.md](api/deploy/README.md)

## 작성 규칙 (필수)

API·Dockerfile·Compose·배포 코드를 쓰거나 고칠 때는 [docs/API_재구성_작성규칙.md](docs/API_재구성_작성규칙.md) 를 따른다.
아래는 핵심만 뽑은 것이다. 해당 작업을 할 때는 전체 문서의 그 절을 먼저 읽는다. 규칙과 다르게 해야 하면 이유를 설명하고 확인을 받는다.

**원칙**
1. 컨테이너는 프로세스, 이미지는 자산 — 환경은 이미지로 굽고 컨테이너는 갈아 끼운다
2. 사라지면 안 되는 것은 이름 있는 볼륨에 · `docker compose down -v` 금지
3. 같은 네트워크에서는 서비스 이름이 주소 — IP · `127.0.0.1` 고정 호출 금지, 서버는 `0.0.0.0` 수신
4. 비밀은 이미지 · 저장소 · 로그 · 소스에 넣지 않는다 — 실행 때 주입, 문서에는 키 이름만
5. 순서가 아니라 준비를 기다린다 — `/health` 는 처리 준비가 됐을 때만 200, `service_healthy`
6. 자원 한도는 측정 근거로 정한다 · 롤백은 배포 때 예약한다 (이전 이미지를 지우지 않는다)
7. 로그는 stdout, 비밀값은 로그에 쓰지 않는다

**작업 전 확인**
- 경로 · 주소 · 비밀값은 환경변수로 주입했는가
- Dockerfile: slim · 버전 고정 · 의존성 먼저 COPY · 멀티스테이지 · exec 형식 · non-root · `.dockerignore`(`.env` 포함)
- Compose: 필요한 포트만 `127.0.0.1` 에 공개 · `service_healthy` · 자원 한도 근거 · 읽기 전용 마운트는 `:ro` · `privileged` · Docker 소켓 마운트 금지
- 이미지 태그: 버전 명시, `latest` 금지, 릴리스 태그는 다시 쓰지 않는다
- 정상 · 오류 입력 시험을 하고 Runbook 을 갱신했는가

**이 저장소에서 정한 것**
- Compose 는 각 서비스 폴더의 `compose.yaml`, `api/compose.yaml` 은 `include` 만 한다. 병합 결과는 `docker compose config` 로 확인
- model-api 는 Python 3.11-slim · `uv sync --frozen`, Node 는 `npm ci`
- 버전은 `x.y.z` — x 는 정식 여부(지금 0), y 는 판(1 prototype · 2 재구성), z 는 업데이트 순번
- 커밋 · PR · 이슈 글은 한글, Conventional Commits 의 종류 · 범위만 영어
- 코드에 한국어 설명 주석과 `#이슈번호`, 파일 머리에 「구조에서의 위치」
- 배포 뒤에는 컨테이너 이미지 ID 를 이미지와 대조한다 (`up -d` 가 다시 만들지 않는 일이 있었다)
