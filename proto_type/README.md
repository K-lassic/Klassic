# K-lassic proto_type — v0.1.0

국악보(오선보·정간보) 사진을 올리면 악보로 인식하고, 국악기로 연주(MP3)하고, 편집해서 PDF·MIDI·MusicXML 로 내려받는 서비스.
기존에 만든 API(`src/`)를 **코드 수정 없이** Docker Compose 로 실행하도록 묶은 기준판이며, 이후 재구성의 출발점이다.

- 버전: [`VERSION`](VERSION) = `0.1.0` · Git 태그 `v0.1.0` · 이미지 태그 `APP_TAG=0.1.0`
- 원본 코드 출처: [`SOURCE.md`](SOURCE.md)

## 구성

```
브라우저 ─▶ 127.0.0.1:9503 gateway ─┬─ /api/v1/* ─▶ model-api (Python · FastAPI · 인식 엔진 · 렌더러)
                                     └─ 그 밖     ─▶ web       (Node · Express · Vue 화면)
관리자    ─▶ 127.0.0.1:26101 admin   (내 컴퓨터에서만 접속)
web · admin · model-api ─▶ db (MariaDB 12, 내부 네트워크 전용)
```

| 경로 | 내용 |
|---|---|
| `docker-compose.yml` | 서비스 7개: db · migrate · web · admin · gateway · model-api · (demo · engines-installer 는 필요할 때만) |
| `.env.example` | 설정 템플릿 — 복사해서 `.env` 로 쓴다 (`.env` 는 Git 에 올리지 않음) |
| `docker/app.Dockerfile` | web · admin · gateway 이미지 (Node 22) |
| `docker/model-api.Dockerfile` | model-api 이미지 (Python 3.11 · uv · FluidSynth · LAME) |
| `docker/engines-installer.Dockerfile` | 인식 엔진(homr · jeongganbo) 설치용 일회성 이미지 |
| `docker/scripts/reset-operator-password.mjs` | 관리자 비밀번호 바꾸기 |
| `src/` | 기존 API 코드 (원본 그대로) |

## 준비

| 항목 | 내용 |
|---|---|
| Docker Desktop | Windows 는 WSL2 방식. macOS · Linux 도 가능 |
| Git · **Git LFS** | 사운드폰트(`*.sf2`, 약 170MB)를 받는 데 필요 — 없으면 MP3 가 만들어지지 않는다 |
| 디스크 | 여유 20GB 이상 (이미지 약 4GB · 인식 엔진 약 4.5GB · 빌드 캐시) |
| 포트 | 9503(서비스) · 26101(관리자) 이 비어 있어야 한다 |

## 실행

아래 명령은 모두 **`proto_type` 폴더에서** 실행한다.

### 1. 받기

```bash
git lfs install
git clone git@github.com:K-lassic/Klassic.git
cd Klassic
git checkout v0.1.0
cd proto_type
```

사운드폰트 크기 확인 — `FluidR3_GM.sf2` 148,398,306 B · `gugak.sf2` 22,279,570 B 여야 한다. 작으면 `git lfs pull`.

```bash
ls -l src/app/assets/soundfonts/
```

### 2. 설정

```bash
cp .env.example .env
```

`.env` 에서 아래 4개를 **각자 무작위 값**으로 채운다. `SERVICE_API_KEY` 는 5단계에서 넣는다.

- `DB_PASSWORD` · `DB_ROOT_PASSWORD` · `SESSION_SECRET` · `ADDR_HASH_SALT`

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

### 3. 빌드 · 실행

처음에는 10분 안팎 걸린다. DB 마이그레이션(migrate)은 자동으로 실행된다.

```bash
docker compose up -d --build
```

### 4. 인식 엔진 설치 (처음 한 번)

homr(오선보) · jeongganbo(정간보)를 `engines` 볼륨에 설치한다. 약 4.5GB 를 받아 10분 이상 걸린다.

```bash
docker compose --profile tools run --rm engines-installer
docker compose restart model-api
```

### 5. 운영자 계정 · 서비스 키

```bash
docker compose exec -it web node backend/dist/admin/createOperator.js --login admin --name 관리자
```

1. http://localhost:26101 에 로그인 → **키 관리** → **서비스 전용 키** → 발급 (키는 한 번만 보인다)
2. 받은 키를 `.env` 의 `SERVICE_API_KEY=` 뒤에 넣는다
3. web 과 web 의 네트워크를 함께 쓰는 서비스를 순서대로 다시 만든다

```bash
docker compose up -d --force-recreate web gateway admin model-api
```

> `docker compose restart web gateway admin model-api` 는 쓰지 않는다. 넷을 한꺼번에 다시 시작하면 gateway · admin 이 아직 꺼져 있는 web 의 네트워크에 붙지 못해 멈춘다 (`cannot join network namespace of a non running container`). `up --force-recreate` 는 web 을 먼저 띄운 뒤 나머지를 붙인다.

### 6. 확인

```bash
docker compose ps
```

- db · web · model-api 가 `healthy`, admin · gateway 가 `Up` 이면 정상
- http://localhost:9503 → 가입 → 악보 올리기(예시 파일) → 악기 바꾸기 → 음 옮기기 → 저장(MP3 · PDF · MIDI · MusicXML)

## 운영 명령

| 할 일 | 명령 |
|---|---|
| 상태 · 로그 | `docker compose ps` · `docker compose logs -f web` |
| 멈추기 (데이터 남음) | `docker compose down` |
| 데이터까지 모두 지우기 | `docker compose down -v` — DB · 업로드 · 인식 엔진이 모두 지워진다 |
| 관리자 비밀번호 바꾸기 | `docker compose run --rm -it -v ./docker/scripts:/scripts:ro web node /scripts/reset-operator-password.mjs --login admin` |

## 원본과 달라진 실행 방식

원본은 macOS(Apple silicon) · pm2 · Homebrew 기준이었다. 코드는 그대로 두고 실행 구성만 바꿨다.

| 항목 | 원본 | v0.1.0 |
|---|---|---|
| 실행 | pm2 · 직접 설치 | Docker Compose |
| 서로 부르는 주소 | 모두 `127.0.0.1` | 코드를 고치지 않으려고 admin · model-api · gateway 가 web 의 네트워크를 함께 쓴다 (`network_mode: service:web`) |
| DB | 팀 공용 MariaDB | PC 마다 로컬 MariaDB 컨테이너 (시험 데이터 분리) |
| 인식 엔진 위치 | `~/gugak-engines` | `engines` 볼륨 `/opt/gugak-engines` (`ENGINES_DIR` 환경변수로 지정) |
| 엔진 실행 라이브러리 | macOS 기본 제공 | model-api 이미지에 `libgl1` 추가 (jeongganbo 의 OpenCV) |

## 알려진 제한

- **audiveris**(오선보 대안 엔진)는 macOS 판만 있어 설치하지 않는다. 오선보 인식은 homr 이 맡는다.
- **LLM 추천**(Ollama · gemma3)은 꺼져 있다. 악기 추천은 규칙(rules) 기반으로 동작한다.
- jeongganbo 는 원저자 잠금 파일대로 설치해서 CPU 로 실행하는데도 CUDA 꾸러미까지 받는다 (약 4GB).
- 계정 · 악보 데이터는 PC 마다 따로이며 공유되지 않는다.
