# model-api (담당: 예은 @yeeun5364)

악보 인식(오선보 · 정간보) · MP3/PDF 렌더링 · 국악기 추천 · 외부 API(`/api/v1`, API 키).

- 참고 코드: `proto_type/src/app/model-api` (Python 3.11 · FastAPI · uv, 약 8,800줄 · 테스트 36개 파일)
- 엔진 설치 참고: `proto_type/src/app/ops/engines` · `proto_type/docker/engines-installer.Dockerfile`
- 계약: [../../contracts/model-api.yaml](../../contracts/model-api.yaml)

## 재구성 시 바꿀 점

- 수신 주소 `0.0.0.0`, 경로(엔진 · 모델 · 음원 · 저장소)는 환경변수로 주입
- `/health` 는 엔진 · 사운드폰트 로딩이 끝났을 때만 200
- Audiveris 는 macOS 앱 구조 전제 → Linux 설치 방식으로 전환 (아래 조사 기준 발표 필수 범위에서는 제외)
- 외부 공개: API 키별 사용량 제한 · 업로드 크기와 처리 시간 상한 (외부 요청이 엔진을 무한정 쓰지 못하게)

## 이 폴더에 둘 파일

`app/` · `tests/` · `pyproject.toml` · `uv.lock` · `Dockerfile` · `.dockerignore` · `compose.yaml` · `.env.example` · 이 README(Runbook)

## 엔진 볼륨 구성·검사 — 이슈 #25

### 무엇을 구성했나

**기존 설치가 끝난 `klassic_engines` 볼륨을 읽기 전용으로 재사용한다.** #7 조사를 바탕으로 #25가 우선 검토하도록 지정한 방식이다. 6GB가량의 엔진을 다시 받거나 복사하지 않고, 기존 프로토타입의 파일·컨테이너·설치 상태를 유지한다.

| 항목 | 구성 |
|---|---|
| 엔진 제공 | Docker 외부 볼륨 `klassic_engines`, `external: true` |
| 소비 경로 | `ENGINES_DIR=/opt/gugak-engines`, 마운트 `read_only: true`, `nocopy: true` |
| 아키텍처 | `linux/amd64` 고정. ARM64용으로 검증하지 않음 |
| 검사 런타임 | 로컬의 `klassic/klassic-model-api:0.1.1`, Python 3.11.18·Debian bookworm 계열 |
| 이번 검증 이미지 ID | `sha256:908e979868cd0c2275932488668757efe7b7f8459cae2d262a7678b8fabff749` |
| 이미지 배포 상태 | 기존 로컬 이미지 사용. 이번 작업에서 Docker Hub에 게시하지 않음 |
| 검사 실행 | `engine-selftest`, `tools` 프로필의 일회성 도구. uid/gid 1000, 네트워크 차단, 호스트 포트 없음 |
| 쓰기 위치 | 임시 캐시만 컨테이너의 `/tmp` tmpfs에 기록. 루트 파일시스템과 엔진 볼륨은 읽기 전용 |

`compose.yaml`의 `x-engine-runtime`은 이후 model-api가 사용할 환경변수·아키텍처·엔진 마운트의 공통 정의다. 이번 `engine-selftest`가 그 정의를 실제로 사용한다. YAML anchor는 같은 파일에서만 사용할 수 있다. **#24에서 HTTP용 `model-api` 서비스를 추가할 때 이 정의를 병합하고 `engine-volume` 마운트를 함께 재사용한다.** 서비스에서 `environment`나 `volumes`를 새로 선언하면 해당 매핑/목록은 덮어써지므로 환경 매핑은 `<<: *engine-environment`, 엔진 마운트는 `- *engine-volume`을 명시적으로 포함해야 한다.

현재 `api/`에는 #24의 HTTP 서비스·Dockerfile이 아직 없다. #25는 기존 이미지의 엔진 어댑터를 사용한 **엔진 소비·영속성 검사**이며, 새 API의 인증·DB·`/health`·실인식 완료 보고가 아니다. 엔진 공통 구현과 실제 사진 인식은 #29·#30에서 검증한다. 검사 도구에는 기존 이미지의 API healthcheck를 적용하지 않는다.

**이미지 포함 배포는 최종 목표로 유지한다.** 다만 #25에서는 기존 볼륨 재사용으로 발표 준비 시간을 줄인다. 새 볼륨+설치 컨테이너는 기존 설치 결과가 없는 PC의 대안이며, 현재 방식에서는 빈 볼륨을 자동 생성하거나 설치를 시작하지 않는다. CPU 전용 의존성 검증·엔진 포함 이미지 빌드·Docker Hub 버전 배포는 별도 후속 작업이다. 이미지 포함 방식으로 전환할 때는 엔진 볼륨이 이미지 속 파일을 가리지 않게 해야 한다.

### 준비와 설정

아래 명령은 **이 이슈 worktree의 `api/` 폴더**에서 PowerShell로 실행한다. 프로토타입 폴더에서 실행하지 않는다.

```powershell
# worktree 루트에서
Set-Location api

# 실제 설치 볼륨명·이미지·아키텍처를 확인한다.
docker volume inspect klassic_engines --format '{{.Name}}'
docker image inspect klassic/klassic-model-api:0.1.1 --format '{{.Id}} {{.Os}}/{{.Architecture}}'

docker compose -p klassic-api-issue25 --profile tools config --quiet
docker compose -p klassic-api-issue25 --profile tools run --rm engine-selftest
if ($LASTEXITCODE -ne 0) { throw '엔진 selftest 실패: 출력 JSON의 error 확인' }
```

이 도구는 새 설치를 수행하지 않는다. 기존 엔진 설치가 끝난 볼륨과 Linux 이미지가 선행 조건이며, 서버 키·DB·프로토타입 `.env` 복사는 필요 없다. `pull_policy: never`라서 로컬 이미지가 없으면 명확하게 실패한다. 검사 때문에 비공개 이미지를 원격에서 내려받거나 새 이미지를 자동 빌드하지 않는다.

이미지가 없으면 기존 프로젝트의 model-api 이미지 빌드 절차를 따른다. 명시적으로 재빌드하려면 저장소 루트에서 다음 명령을 사용할 수 있다. 실행할 서비스는 없으며, 엔진 볼륨을 변경하지 않는다. 빌드에는 네트워크와 의존성 다운로드가 필요하고, 기존 태그 덮어쓰기를 피하도록 별도 로컬 태그를 쓴다.

```powershell
# 저장소/worktree 루트에서 (필요한 PC에서만 수행)
docker build -f proto_type/docker/model-api.Dockerfile -t klassic/klassic-model-api:issue25-check proto_type/src/app
# 이후 api/에서 검사할 때 사용할 로컬 태그 선택
$env:ENGINE_CHECK_IMAGE = 'klassic/klassic-model-api:issue25-check'
```

설정 형식은 이 폴더의 [.env.example](.env.example)에 있다. `api/`의 전체 compose로 실행할 때 이 파일이 자동으로 읽히는 것은 아니므로, 필요한 항목을 **`api/.env`에 추가하거나 현재 셸의 환경변수로 지정**한다. 기존 `.env` 파일을 덮어쓰지 않는다.

| 설정 키 | 기본값 | 주의 |
|---|---|---|
| `ENGINES_VOLUME_NAME` | `klassic_engines` | Docker에서 확인한 실제 설치 완료 볼륨명. 없는 볼륨은 자동 생성하지 않음 |
| `ENGINES_DIR` | `/opt/gugak-engines` | 엔진 가상환경의 절대 경로와 Python 심볼릭 링크 때문에 기존 볼륨 재사용 시 유지 |
| `ENGINE_CHECK_IMAGE` | `klassic/klassic-model-api:0.1.1` | 로컬 Linux/amd64 model-api 이미지. 검증 이미지 ID와 비교하거나 별도 태그를 선택 |

homr의 Python은 이미지 내부 `/usr/local/bin/python3.11`을 사용한다. 정간보의 Python 3.8.20은 볼륨 안 `.uv-python/cpython-3.8.20-linux-x86_64-gnu/`를 가리킨다. 엔진 폴더만 떼어 다른 위치에 마운트하거나 다른 Python·OS 이미지에 붙이면 실행 파일이 있어도 불러오지 못할 수 있다. Debian bookworm 계열의 기존 model-api 이미지로 검증했으며, 다른 런타임은 다시 selftest해야 한다.

### selftest의 성공 기준

[scripts/engine_selftest.py](scripts/engine_selftest.py)는 다음을 검사하고 마지막 줄에 상세 JSON을 출력한다. **파일이 있다는 사실만으로 성공 처리하지 않는다.**

1. amd64·non-root·`ENGINES_DIR` 절대 경로·볼륨의 실제 읽기 전용 상태 확인
2. 두 엔진의 기존 어댑터 `probe()`: 실행 파일·VERSION 확인
3. homr의 핵심 ONNX·OCR 모델, 정간보의 가중치·설정·tokenizer와 설치 lock의 크기·SHA-256 기록
4. 기존 어댑터의 `warmup()`으로 작업자를 기동해 homr 전사 모델·OCR 및 정간보 CPU 모델을 실제 로딩하고 `ready: true` 확인
5. 엔진을 하나씩 로딩·종료해 동시 메모리 사용을 줄이고, 둘 다 성공해야 종료 코드 0 반환

segnet ONNX는 존재·크기·해시를 검사한다. homr warmup은 실제 인식 시 사용하는 분할 모델의 추론까지 수행하지 않는다. 사진→MusicXML/MIDI의 정확성과 새 HTTP 서비스 준비 완료는 별도 검증 대상이다. 모델 로딩 제한은 엔진별 기본 120초이며, 필요한 경우 `run --rm engine-selftest --timeout 180`처럼 지정한다(최대 600초).

### 컨테이너 재생성 후 보존 확인

아래 명령을 두 번 실행한다. 성공한 검사 컨테이너도 종료되므로 `Exited (0)`이 정상이다. 매번 검사 컨테이너 ID가 달라지고 같은 볼륨에서 두 엔진이 모두 성공해야 한다.

```powershell
# api/에서. proto_type과 구별되는 Compose 프로젝트명 사용
docker compose -p klassic-api-issue25 --profile tools up --force-recreate --abort-on-container-exit --exit-code-from engine-selftest
if ($LASTEXITCODE -ne 0) { throw '엔진 selftest 실패' }
docker compose -p klassic-api-issue25 --profile tools ps -a
docker compose -p klassic-api-issue25 --profile tools logs --no-color --no-log-prefix engine-selftest
```

첫 실행의 마지막 JSON을 기록하고, 다음 실행 JSON의 두 `engines[].manifest`와 비교한다. 경로별 `bytes`·`sha256`이 모두 같아야 한다. 호스트에서 마운트 상태도 확인할 수 있다.

```powershell
$containerId = docker compose -p klassic-api-issue25 --profile tools ps -aq engine-selftest
docker inspect $containerId --format '{{.Id}} {{.State.ExitCode}} {{json .Mounts}}'
# engines의 Name=klassic_engines, RW=false와 종료 코드 0 확인

# 검사 컨테이너만 정리. 외부 엔진 볼륨은 보존한다.
docker compose -p klassic-api-issue25 --profile tools rm -f engine-selftest
```

`docker compose down -v`·볼륨 삭제·prune은 사용하지 않는다. 두 서비스가 같은 볼륨을 읽는 동안 프로토타입 설치기를 다시 실행하거나 가중치를 갱신하지 않는다. 새 엔진 판본을 시험할 때는 별도 볼륨/이미지를 준비하고 이름을 명시해 검증한다.

### 2026-10-30 실행 결과

기준 main `1c4192a`를 pull한 뒤 만든 `build/25-engine-volume-yeeun`에서 실행했다. Docker Compose v5.6.0, Linux/amd64, uid 1000, 네트워크 없음, 엔진 볼륨 `RW=false` 환경이다.

| 검사 | 첫 성공 실행 | 컨테이너 재생성 후 | 판정 |
|---|---:|---:|---|
| homr 0.7.0 모델·OCR warmup | 7.616초 | 3.939초 | 두 번 모두 준비 신호 확인 |
| 정간보 `e95045f`·checkpoint v1.0.0 CPU warmup | 9.744초 | 6.727초 | 두 번 모두 `ready=true`, `device=cpu` |
| 전체 selftest | 17.360초 | 10.667초 | 두 번 모두 종료 코드 0 |
| 컨테이너 ID 앞 12자리 | `6c049ba5968e` | `a1cdc0ae03a4` | 새 컨테이너로 교체됨 |
| 두 엔진의 가중치·VERSION·lock | SHA-256 기록 | 모든 manifest 값 동일 | 기존 설치 결과 유지 |
| 없는 엔진 경로 | `ENGINES_DIR=/missing-engines` | 종료 코드 1·`FileNotFoundError` | 원인을 구분해 실패 |
| 없는 외부 볼륨 | 존재하지 않는 검사 전용 이름 | Compose 종료 코드 1·볼륨 미생성 | 빈 설치를 정상으로 오인하지 않음 |
| homr 누락 | homr 경로에 빈 테스트 폴더를 읽기 전용으로 겹쳐 마운트 | homr 설치 오류·정간보 성공·전체 종료 코드 1 | 실제 볼륨을 바꾸지 않고 엔진별 오류 구분 |
| 쓰기 가능한 잘못된 경로 | `ENGINES_DIR=/tmp` | 종료 코드 1·읽기 전용 마운트 필요 안내 | 공유 엔진 쓰기 방지 조건 확인 |

첫 성공 전에 검사 스크립트의 Python 모듈 경로 누락으로 두 엔진이 `ModuleNotFoundError`를 보고했다. 검사 서비스에 `PYTHONPATH=/app/model-api`를 명시한 뒤 위 두 번의 검증을 통과했다. 엔진이나 프로토타입을 수정해 해결한 것이 아니다.

원본 증거는 제출 대상 밖의 로컬 `.scratch/issue25/before-recreate.json`, `after-recreate.json`, `after-recreate.log`, `missing-path.log`, `missing-volume.log`에 보관했다. 실제 엔진 API 호출 결과는 아래 #7 조사 기록과 구분한다. 검사 뒤에도 기존 db·web·model-api는 healthy, gateway·admin은 실행 상태였다.

추가 오류 검사 증거는 같은 폴더의 `missing-homr.log`, `writable-path.log`다. 전체 `api/compose.yaml`의 기본 설정·tools 프로필과 서비스 단독 compose 설정 검사, `git diff --check`를 통과했다. API 경로·요청·응답·DB 변경은 없으며 새 HTTP 서비스 빌드는 이번 범위에 해당하지 않는다.

### 장애·복구와 완료 범위

| 증상 | 확인 근거 | 조치 |
|---|---|---|
| `external volume ... not found` | `docker volume inspect`에 실제 이름 없음 | 설치 완료 볼륨의 이름으로 `ENGINES_VOLUME_NAME` 수정. 새 설치는 별도 빈 볼륨에서 프로젝트 설치 절차로 수행 |
| 이미지 없음·아키텍처 불일치 | `docker image inspect`의 ID·OS·Architecture | 검증된 로컬 amd64 런타임 선택/빌드 후 재검사 |
| `probe` 실패·가중치 누락/빈 파일·Python 없음 | JSON의 엔진별 `error`·`probe`, venv의 절대 링크 | 설치가 완료된 이전 볼륨/이미지로 되돌림. 공유 중인 볼륨을 즉석에서 덮어쓰지 않음 |
| 모델 로딩 실패·시간 초과 | JSON 엔진별 `error`, 제한 시간 | 캐시/의존성/가중치·Docker 가용 메모리 확인. 엔진은 순차 로딩하며 제한 시간을 감으로 늘려 성공 처리하지 않음 |
| 읽기 전용 검사 실패 | JSON `read_only`, Docker `Mounts[].RW` | Compose 마운트의 `read_only: true` 확인 후 검사 컨테이너 재생성 |

롤백 시 설치 결과는 수정하지 않고 이전 `ENGINES_VOLUME_NAME`·`ENGINE_CHECK_IMAGE`를 다시 선택해 selftest한다. 최초 재사용 시점의 볼륨은 보존한다. 이후 엔진 포함 이미지를 배포하면 원본 볼륨을 유지한 채 마운트 제거 여부를 별도 검증한다.

| #25 요구사항 | 결과 |
|---|---|
| 제공 방식 결정 | 기존 볼륨 read-only 재사용, 새 볼륨 설치 대안과 최종 이미지 배포 방향 기록 |
| 경로 환경변수·amd64 | Compose 공통 정의·설정 형식·절대 경로 호환 조건 명시 |
| 엔진별 selftest 문서화 | 실행·성공 판단·오류·복구·정리 절차 제공 |
| 재생성 시 엔진 유지·homr/정간보 selftest | 동일 model-api 런타임을 쓰는 검사 컨테이너를 두 번 생성해 성공·해시 일치 확인. HTTP용 새 model-api 서비스 연결과 재생성 확인은 #24에서 이어서 수행 |

변경은 담당 폴더의 Compose·README·설정 형식·검사 스크립트에 한정한다. 새 API 계약·인증·DB·렌더링을 변경하지 않았으며, add·커밋·푸시 전 예은님이 결과를 확인하는 단계다.

## 엔진 · 외부 의존성 Linux 전환 조사 — 이슈 #7

조사일: **2026-10-30 KST**. 아래는 [이슈 #7](https://github.com/K-lassic/Klassic/issues/7) 당시의 조사 기록이다. 현재 #25의 볼륨 구성·실행 결과는 위 절을 기준으로 한다. 이 조사 자체는 새 서비스 구현 완료 보고가 아니다.
작업 브랜치는 `main` (`1b28998`)을 pull한 뒤 만든 `docs/7-engine-linux-analysis-yeeun`이다. 문서 골격은 해당 main의 README를 유지했으며, 제출 전 `main`의 추가 진행 사항(`3de62c7`)을 pull해 반영했다.

실행 근거는 프로젝트 수행 전에 별도 폴더에서 검증한 `v0.1.1` (`1c943a4`) 프로토타입이다. **새 프로젝트의 `api/`는 현재 서비스 골격이며, 이 브랜치에서 새 model-api 서버를 구현하거나 실행한 것이 아니다.** 프로토타입 소스와 실행 환경은 그대로 둔다.

**결론: 발표 기본 엔진은 homr + 정간보, Audiveris는 P3로 분리한다. 배포 목표는 CPU 전용 의존성 검증 후 엔진·가중치를 model-api 이미지에 포함하는 방식이다.**
이슈 #7의 담당 작업 기준으로 발표 엔진은 **homr·정간보 2종으로 결정**하고 Audiveris는 P3로 내린다. 팀장 리뷰에서 변경 요청이 있으면 이 결정을 갱신한다. 이슈 #7의 제출물은 이 README이며, 기존 실행 소스나 설치된 엔진을 변경하지 않았다. Docker Hub 업로드는 수행하지 않았다.

### 1. 실측 환경과 판정 범위

| 항목 | 확인한 값 |
|---|---|
| 호스트/실행 환경 | Windows · Docker Desktop의 Linux/WSL2 컨테이너 |
| CPU 아키텍처 | `linux/amd64` (`x86_64`), CPU 6개 |
| Docker 가용 메모리 | 4,108,464,128 bytes, 약 3.83GiB |
| 모델 API | Python 3.11.18 · `klassic/klassic-model-api:0.1.1` |
| 이미지 ID | `sha256:908e979868cd0c2275932488668757efe7b7f8459cae2d262a7678b8fabff749` |
| 엔진 저장소 | named volume `klassic_engines` → `/opt/gugak-engines` |
| 인증 | 로컬 DB에서 발급한 서비스 키 사용. 키 값은 문서·증거에 포함하지 않음 |
| 검사 방식 | 준비된 서버에서 요청을 순차 1회씩 실행. 설치 시간·콜드 스타트·동시 부하·인식 정확도의 통계 측정은 아님 |

이 환경에서의 성공을 ARM64나 다른 PC의 성공으로 확대하지 않는다. Python 가상환경과 native wheel은 아키텍처별로 다시 빌드해야 한다.

### 2. 엔진별 설치·런타임·가중치·전환 위험

표의 MB/GB는 10진 단위다. 가중치 파일 크기, 설치 폴더 크기, 다운로드 크기는 서로 다르다.

| 엔진 | 현재 설치 방법 / Linux 전환 방법 | 필요한 런타임 | 가중치 / 설치 크기 | CPU 아키텍처와 현재 결과 | 남은 위험 |
|---|---|---|---|---|---|
| homr 0.7.0 | `install_homr.sh`: `uv lock` → `uv sync --frozen` → `homr --init`. 재구성 때 빌드 단계에서 설치하고 lock·가중치 해시 보관 | Python 3.11.18, ONNX Runtime 1.31.1, OpenCV, OCR. 현재 homr 환경에는 torch·CUDA 패키지 없음 | homr 주요 ONNX 3개 합계 **157,472,034 B**; OCR ONNX 3개 **31,749,509 B** 추가. 전체 설치 폴더 **531,356,608 B** | amd64 실제 인식 성공. ARM64 미검증 | 현재 스크립트는 설치 때마다 lock을 생성하므로 간접 의존성이 달라질 수 있음. 이미지 빌드에서 모델 다운로드까지 완료해야 첫 실행 때 다운로드하지 않음 |
| jeongganbo-omr `e95045f` + ckpt v1.0.0 | `install_jeongganbo.sh`: 고정 Git 커밋 + 릴리스 체크포인트 + 저자 `Pipfile.lock`에서 requirements 생성. CPU용 lock을 별도로 만들어 이미지에 설치하는 방식 제안 | 별도 Python **3.8.20**, torch **2.0.1+cu117**, torchvision **0.15.2**, EasyOCR 1.7.1, OpenCV, `libgl1`·`libglib2.0-0` | `repo/checkpoints/best/model.pt` **73,811,777 B**. 전체 설치 폴더 **5,483,127,857 B** | amd64 CPU 실제 인식 성공. `torch.cuda.is_available()=false`, runner 기본 `device=cpu`. ARM64 미검증 | CPU 계산에 불필요한 CUDA 패키지 포함. Python 3.8 의존성 호환성 유지 필요. API Python 3.11 환경과 합치지 말 것 |
| Audiveris 5.11.0 | 현재 스크립트는 `.dmg` + `hdiutil`, 어댑터는 `Audiveris.app/Contents/MacOS` 전제. Linux에서는 공식 `.deb`의 `/opt/audiveris/bin/Audiveris`를 사용하도록 설치·어댑터 모두 변경 필요 | 공식 Linux 패키지의 번들 Java **25.0.3** 확인. 소스 빌드는 JDK 25 필요. 패키지에 X11·ALSA 등 공유 라이브러리 의존성 있음 | Ubuntu 22.04 amd64 `.deb` **78,048,872 B**; 압축 해제 파일 합계 **189,654,854 B**. jar 안 `res/basic-classifier.zip` **396,100 B** (분류기 자원만, 전체 패키지와 구분) | 공식 Linux amd64 배포물 존재. 현재 컨테이너에는 미설치이며 어댑터도 미지원. 실행 시간 미측정. 이번 릴리스 Linux ARM64 설치 자산 없음 | Ubuntu용 패키지와 현재 Debian bookworm의 호환성, headless 실행, 출력 `.mxl`, timeout, 메모리 검증 필요. 설치 패키지 내용만 조사했으며 엔진 실행 성공으로 간주하지 않음 |

homr의 ONNX Runtime 예제 모델 903 B는 위 주요 모델 합계에서 제외했다. 정간보 모델과 Python 3.8 설치 방식은 [원본 저장소](https://github.com/MALerLab/jeongganbo-omr)와 현재 설치 스크립트를 함께 확인했다.

Audiveris 근거: [5.11.0 공식 릴리스](https://github.com/Audiveris/audiveris/releases/tag/5.11.0), [Linux 설치 안내](https://audiveris.github.io/audiveris/_pages/tutorials/install/binaries/), [JDK 요구사항](https://audiveris.github.io/audiveris/_pages/tutorials/install/sources/). 패키지의 `Architecture`, `Depends`, 번들 `runtime/release`, jar 자원을 직접 조회했다. 공식 Linux 지원과 우리 어댑터의 Linux 지원은 구분한다.

### 3. 외부 실행 도구

| 도구/기능 | v0.1.1 현재 상태 | Linux 전환 방법 | 위험·발표 판단 |
|---|---|---|---|
| FluidSynth 2.3.1 | `/usr/bin/fluidsynth`, 실제 MP3 생성 성공 | 이미지에 배포판 패키지 설치, `FLUIDSYNTH_BIN` 또는 PATH 사용 | 오디오 장치 없이 파일 렌더링. soundfont 누락·bank/program 매핑·출력 파일 검사 필요. 발표 포함 |
| LAME 3.100 | `/usr/bin/lame`, 실제 MP3 생성 성공 | 이미지에 배포판 패키지 설치, `LAME_BIN` 또는 PATH 사용 | FluidSynth WAV→MP3 단계. 외부 API의 라이선스 정책 분기는 별개이며 이번 검사는 서비스 키 사용. 발표 포함 |
| PDF 출력 | MuseScore 없음, **Verovio 6.3.0-425dd7b + svglib/reportlab** 경로로 PDF 1쪽 생성 성공 | Python 패키지 lock과 `NotoSerifKR-Regular.ttf`, `Leipzig.ttf`를 이미지에 포함 | MuseScore 추가 설치는 필수 아님. 글꼴·페이지 크기·한글/음표 렌더링 회귀 확인 필요. Verovio 경로 발표 포함 |
| PDF 입력 검사 | pypdfium2로 PDF 1쪽 검사·래스터화 및 정간보 인식 성공 | pypdfium2 wheel과 입력 검사를 유지 | 출력 PDF 렌더러와 다른 기능. web→model-api 서비스 키가 없으면 401이 G1 검사 불가로 표시됨 |
| 음원 | FluidR3_GM.sf2 **148,398,306 B**, gugak.sf2 **22,279,570 B** | Git LFS 원본을 빌드 전에 받고 파일 크기 확인; 재구성 시 경로를 설정으로 주입 | LFS 포인터를 실제 음원으로 오인하지 말 것. 컨테이너 안에 별도 배포판 기본 음원이 중복 설치되는지도 최적화 때 확인 |
| Ollama / gemma3:4b (선택) | 서버 연결 불가, `unavailable`; 모델 크기·추론 시간은 미측정 | 사용한다면 별도 서비스와 모델 볼륨, 서비스 DNS URL·리소스 제한 필요 | 현 환경 메모리에서 추가 상주 모델 동시 실행 검증 없음. 발표 필수 제외. rules 추천으로 대체 가능하며 실제 추천 성공 |

### 4. 실제 실행 결과

2026-10-30 14:40~14:42 KST에 준비된 v0.1.1 서버에서 서비스 키로 순차 실행했다. 시간은 HTTP 요청 시작부터 응답 완료까지이며, 각 1회 측정값이다.

| 검사 | 입력 | HTTP / 측정 시간 | 결과 |
|---|---|---|---|
| `/v1/omr/staff` | 저장소 `arirang-semachi-staff.png`, SHA-256 `8e05c10a9e31080c4962eb72f98e63bb3f23483207dd9c3a91fc3ae8556d625f` | **200 / 24.119초** | homr, `fallback=false`, `trust`, 1/1쪽 변환, MusicXML 20,365자, MIDI 생성. 요청 `R-1030-FU2PY49Y` |
| `/v1/omr/jeongganbo` | 국립국악원 거문고 타령 책 96쪽 PDF 1장, SHA-256 `a291f2fa70caf19869b5d1b14588507861deb55ca0f7fcc534fb2faf16813ea9` | **200 / 25.347초** | 정간보 엔진, `fallback=false`, `trust`, 1/1쪽 변환, 음표 검사 값 139, 신뢰도 0.9874, MusicXML 33,788자, MIDI 생성. 요청 `R-1030-R9PJCQTL` |
| `/v1/render/pdf` | 앞서 같은 타령 PDF에서 실제 인식한 MusicXML | **200 / 3.723초** | `application/pdf`, Verovio, `%PDF-` 서명, 1쪽, **31,416 B** |
| `/v1/render/mp3` | 같은 MusicXML | **200 / 2.630초** | `audio/mpeg`, `fluidsynth 2.3.1+lame3.100`, **2,512,142 B** |
| `/v1/recommend` | 같은 MusicXML | **200 / 0.130초** | `available=true`, `model=rules`; Ollama는 건너뛰고 악기 조합 3개 반환 |

렌더링·추천 입력 MusicXML의 SHA-256은 `9746737a7ba7e2533dd15bb867574c62217644c996d0e8b4e4c64f9243135599`이다. `trust`와 신뢰도는 서버 내부 판정이며 정답 대조 정확도가 아니다. PDF의 모든 글자·음표를 시각 검수하거나 MP3를 청취한 결과는 아니다.

마지막 상태 확인에서 db·web·model-api가 모두 `healthy`, gateway·admin이 실행 중이었다. `/v1/models` 기준 ready는 homr·정간보·rules 3개이며, Audiveris·Ollama는 unavailable이다. 선택 엔진 2개가 없다는 이유로 필수 인식 엔진의 성공을 실패로 판정하지 않는다.

현재 `/v1/health`는 기동 로딩과 인식 종류별 엔진 준비 여부, DB 연결을 판단한다. 사운드폰트 준비 완료까지 보장하는 검사는 아니므로, 재구성에서는 음원과 렌더러 readiness 검사를 추가해야 한다. 상태 API의 200만으로 실제 인식·출력까지 성공했다고 보고하지 않는다.

### 5. 이미지 포함 방식과 용량 축소 제안

**권장 배포 방식: 엔진·가중치를 포함한 버전별 model-api 이미지.** 개발 중에는 현재 볼륨 방식을 유지하고, CPU 전용 구성과 빈 환경 재실행을 통과한 이미지를 배포한다. 예시 태그 `0.2.0`은 아직 빌드·게시하지 않은 후보 버전이다.

| 실측 대상 | bytes | 의미 |
|---|---:|---|
| model-api 0.1.1 이미지 | 1,961,799,428 | `docker image inspect .Size` 보고값. 현재 엔진을 포함하지 않음 |
| engines 볼륨 전체 | 6,077,483,140 | `du -sb /opt/gugak-engines`; homr·정간보·별도 Python 포함 |
| 정간보의 NVIDIA 패키지 폴더 | 2,710,429,373 | CPU 실행에서 사용하지 않는 GPU 라이브러리 후보 |
| 정간보의 torch 폴더 | 1,355,661,216 | 현재 CUDA 빌드. CPU 빌드로 바꾼 뒤 다시 측정해야 함 |
| 정간보의 triton 폴더 | 192,258,381 | CPU 전용 의존성 재해석 시 제거 대상인지 확인 |

이미지와 현 엔진 볼륨의 수치 합은 약 **8.04GB**이지만, 통합 이미지 크기나 Docker Hub 전송량의 실측값은 아니다. 이미지 레이어·압축·중복 제거가 다르므로 단순 합계를 최종 배포 크기로 사용하지 않는다. NVIDIA 폴더 크기만큼이 그대로 줄어든다고 단정하지도 않는다.

#### CPU 전용 정간보 환경: 후속 구현 순서

1. 현재 엔진 볼륨을 수정하지 않고 별도 빌드 환경에서 Python 3.8용 의존성을 준비한다.
2. 현재 의미 버전인 **torch 2.0.1 / torchvision 0.15.2**를 유지하며 공식 CPU wheel을 지정한다. 최신 torch로 함께 업그레이드하는 작업과 분리한다.
3. CPU용 requirements/lock에서 기존 NVIDIA·CUDA·triton 직접 핀을 재검토하고, GPU 의존성이 다시 유입되지 않게 패키지 소스와 해시를 고정한다. 단순히 `nvidia/` 폴더를 삭제하지 않는다.
4. `torch.version.cuda is None`, `torch.cuda.is_available() is False`를 확인한다. 이 두 조건만으로 전체 의존성 검증을 대신하지 말고 패키지 목록과 일관성 검사도 수행한다.
5. 모델 import·CPU warmup·동일 타령 입력의 실제 인식·MusicXML/MIDI 생성·시간·메모리·결과 차이를 기존 환경과 비교한다.
6. 통과한 환경에서 설치 폴더와 최종 이미지 크기를 다시 측정해 절감량을 보고한다.

[PyTorch 공식 이전 버전 안내](https://docs.pytorch.org/get-started/previous-versions/)에 해당 버전의 CPU 설치 방식이 있으며, 공식 [torch CPU 목록](https://download.pytorch.org/whl/cpu/torch/)과 [torchvision CPU 목록](https://download.pytorch.org/whl/cpu/torchvision/)에서 Python 3.8/Linux x86_64 wheel을 확인했다. **CPU 전용 전환 가능 후보를 확인한 것이며 이번 조사에서 교체·성능 비교를 수행한 것은 아니다.**

#### 엔진 포함 이미지: 후속 구현 조건

- API(Python 3.11), homr(Python 3.11), 정간보(Python 3.8)의 환경을 분리한다. 가상환경의 Python 실행 경로와 공유 라이브러리가 최종 이미지에서도 유효해야 한다. 현재 정간보의 별도 Python 경로도 함께 복사할 필요가 있다.
- 빌드 단계에서 엔진과 가중치 다운로드·검증을 끝내고, 런타임에는 non-root 계정으로 읽을 수 있게 한다. 캐시·출력은 별도 쓰기 가능 경로로 분리한다.
- 현재 `engines:/opt/gugak-engines` 마운트를 배포 compose에서 그대로 유지하면 기존 볼륨이 새 이미지의 엔진 파일을 가릴 수 있다. **이미지 포함 방식에서는 그 엔진 경로의 볼륨 마운트를 제거**하고, storage·DB 볼륨만 유지하는 안을 우선 검토한다. 기존 볼륨은 삭제하지 않는다. [Docker 볼륨 문서](https://docs.docker.com/engine/storage/volumes/)
- 베이스 이미지 digest, 엔진 버전·커밋, 가중치 SHA-256, 의존성 lock, 빌드 대상 아키텍처를 기록한다. 각 버전에 새 태그를 사용하고 `latest`와 기존 태그 덮어쓰기를 피한다.
- `.env`, 서비스 키, 운영자 비밀번호, 사용자 업로드, 로컬 테스트 파일을 빌드 컨텍스트에서 제외한다. 엔진과 번들 자원의 라이선스 고지·출처도 배포물에 보관한다.
- 엔진 볼륨이 없는 새 환경에서 실행하고, 초기 준비 이후 모델 파일 추가 다운로드 없이 두 인식 요청과 PDF·MP3 출력을 확인한다. ARM64 지원은 별도 검증 이슈로 둔다.
- 받는 쪽은 이미지 게시 후 `docker compose pull`과 `docker compose up -d`를 사용한다. 초기 DB·운영자·서비스 키 설정은 여전히 필요하다. 새 배포 compose는 현재 `pull_policy: never/build`를 그대로 복사하지 말고 배포 이미지 pull 방식으로 작성해야 한다.

| 대안 | 평가 |
|---|---|
| 엔진 포함 이미지 | **최종 목표로 권장.** 서버 코드·런타임·모델을 한 버전으로 묶고 롤백하기 쉬움. CPU 전용 구성 검증과 실제 이미지 크기 측정이 선행됨 |
| 볼륨 tar 백업 | 긴급 복구·일회성 전달용. 현재 볼륨 논리 크기는 약 6.08GB, tar 전송 크기는 별도 측정 필요. 사용한다면 manifest·해시·아키텍처·런타임 버전도 기록해야 함 |
| 설치 스크립트 유지 | 개발·복구용 보조 수단. 현재 재현 가능한 실행 경로이지만 PC마다 다운로드·설치 필요. `.venv`가 있으면 초기화 실패 상태도 건너뛸 수 있어 VERSION·모델 로딩 검증을 설치 완료 기준으로 강화할 필요 있음 |

설치 시간은 기존 README의 안내가 10분 이상이며, 이번 조사에서 빈 볼륨 재설치 시간을 다시 측정하지 않았다. 기존 설치 완료 기록은 homr 13:22:24 KST, 정간보 13:27:09 KST지만 이 시각을 설치 소요 시간으로 오인하지 않는다.

### 6. 11월 5일 발표 범위와 후속 우선순위

| 우선순위 | 범위 | 판단/완료 조건 |
|---|---|---|
| 발표 포함 — 담당 작업 기준 결정 | **인식 엔진 homr·정간보 2종**, Verovio PDF + FluidSynth/LAME MP3 + rules 추천 | 현재 amd64 컨테이너에서 실인식·출력 성공. 발표 전 같은 입력으로 다시 확인 |
| 배포 후속 우선 | 정간보 CPU 전용 의존성 → 엔진 포함 이미지 → 빈 환경 검증 → 버전 태그 게시 | 이슈 #7의 조사 다음 단계. 새 설치 및 이미지 제작·게시 작업은 별도 구현 범위 |
| P3 — 발표 제외 | Audiveris Linux 통합 | **11/5 발표 기본 엔진에서 제외한다.** Linux 배포물은 있으나 설치기·어댑터 전환, headless 인식, 기존 엔진 실패 시 전환, 출력 형식·timeout·메모리 검증이 남음. 현재 어댑터의 Java 선택지는 `-Xmx4G`여서 전체 Docker 메모리 약 3.83GiB 환경과도 함께 조정 필요 |
| 선택/후순위 | Ollama 추천 · MuseScore 출력 · ARM64 이미지 | 발표 기본 흐름에 필요하지 않음. 각각 별도 리소스·호환성 검증 필요 |

Audiveris가 11/5 이전에 기술적으로 불가능하다는 결론은 아니다. 이미 동작하는 오선보 엔진이 있으므로 추가 JVM·어댑터 통합 위험을 필수 발표 경로에 넣지 않는 일정 판단이다. 도입을 앞당기려면 공식 amd64 패키지 설치, `-batch -export` 실인식, 컨테이너 재시작 후 readiness, 서비스 경유 fallback·메모리 상한 검사까지 통과해야 한다.

#### 다음 모델 구현 작업의 범위

이슈 #7은 전환 방법·위험을 조사해 이후 구현 범위를 정하는 이슈다. 아래는 조사에서 도출한 후속 범위이며 이번에 구현했다고 표시하지 않는다.

| 순서 | 구현 범위 | 완료 판단 |
|---|---|---|
| 1 | 새 프로젝트 model-api의 설정·엔진 경로·서비스 DNS 분리, 준비 상태 검사 | `0.0.0.0` 수신, backend는 서비스명으로 호출, non-root 실행, 모델·음원 준비 전 요청 차단, 준비 후 정상 응답 |
| 2 | 정간보 CPU 전용 의존성 lock 작성 | 별도 환경에서 CPU wheel 사용 및 패키지 일관성 확인, 기존 모델의 실제 인식·MusicXML/MIDI 생성 회귀 비교, 크기·시간·최대 메모리 측정 |
| 3 | homr·정간보·가중치·렌더러·음원을 포함한 이미지 작성 | 가중치 해시/lock/아키텍처 기록, 런타임 추가 다운로드 불필요, 캐시·비밀값 제외, 구 엔진 볼륨이 이미지 내용을 가리지 않음 |
| 4 | 버전별 배포 및 빈 환경 검증 | 새 태그와 digest 기록, 엔진 볼륨 없는 환경에서 pull/up, 인증 설정 후 두 인식·PDF·MP3·추천 확인. 검증 후 별도 승인 범위에서 게시 |
| P3 | Audiveris Linux 설치·어댑터·대체 엔진 통합 | 별도 브랜치/환경에서 공식 런처 연동, 샘플 인식 및 headless·메모리·실패 전환·재시작 검사 |

이슈 #7 조사 당시 새 프로젝트 `api/services/model-api/compose.yaml`은 `services: {}`인 골격이었다. 이슈 #7에서 실행 서비스를 추가하는 것은 요구되지 않았다. 이미지 제작이나 CPU 전용 교체를 조사 완료의 근거로 대신 기록하지 않는다.

### 7. 재확인 방법과 검토 상태

아래는 앞서 서버 검증에 사용한 **기존 프로토타입 환경**을 나중에 재확인하는 방법이다. 새 프로젝트의 기동 명령이 아니다. `$PrototypePath`에는 기존 검증 폴더의 `proto_type` 절대경로를 지정한다. 새 worktree의 `proto_type`에는 로컬 `.env`를 복사하거나 별도 서버를 띄우지 않았다.

```powershell
Set-Location $PrototypePath
docker compose ps
curl.exe --fail-with-body http://localhost:9503/api/v1/health
curl.exe --fail-with-body http://localhost:9503/api/v1/models
curl.exe --fail-with-body http://localhost:9503/api/v1/versions
docker compose exec -T model-api du -sb /opt/gugak-engines
docker image inspect klassic/klassic-model-api:0.1.1 --format '{{.Size}}'
```

실제 인식은 사이트에서 로그인하고 `arirang-semachi-staff.png`는 오선보, 타령 PDF는 정간보로 선택해 올린다. 상태 `completed`뿐 아니라 `route=recognize`, `fallback=false`, 사용 엔진과 쪽별 `converted`까지 확인한다. PDF·MP3 출력도 별도 요청으로 확인한다. 정상 상태만 확인하는 명령은 실인식 검사를 대신하지 않는다.

서버 사전 검증의 로컬 증거는 기존 검증 폴더의 `proto_type/issue7-probes.json`, `issue7-probes.log`, `issue7-render.pdf`, `issue7-render.mp3`에 남아 있다. 이 새 브랜치에는 복사하지 않았다. 위 표에 요청 번호·입력 해시·결과·시간을 함께 기록했으며, 이슈의 커밋 대상은 **이 README 하나**다. raw 응답·다운로드 원본·`.env`는 포함하지 않는다.

### 8. 이슈 #7 작업 범위·완료 기준 대조

| GitHub 이슈의 요구사항 | 수행 결과와 문서 위치 | 상태 |
|---|---|---|
| 작업 1: 엔진별 설치·런타임·가중치 크기·CPU 아키텍처·실행 시간 | §1·§2·§4. homr·정간보는 실측 시간, Audiveris는 현 환경 미설치/어댑터 미지원으로 시간 미측정 및 P3 판단 근거 명시 | 완료 |
| 작업 2: FluidSynth·LAME·PDF·선택 Ollama | §3. 설치·전환 방법과 위험, 실제 렌더링 성공 및 Ollama 미연결/rules 대체를 구분 | 완료 |
| 작업 3: v0.1.1에서 동작/미동작 구분 | §2~§4. 실제 API 5건의 HTTP 200, 인식 fallback 여부, 출력 파일과 엔진 버전 확인. Audiveris·MuseScore·Ollama 미사용 상태 명시 | 완료 |
| 작업 4: Audiveris 발표 전 가능성 판단 | §6. 공식 Linux 배포물은 존재하지만 현재 어댑터 미지원·통합/자원 검증 필요. 필수 발표 경로에서는 제외하고 P3로 결정 | 완료 |
| 작업 5: 엔진·가중치 이미지/볼륨 제안 | §5. CPU 최적화 검증 후 엔진 포함 이미지 권장. 기존 볼륨 백업·스크립트 대안 및 마운트에 의한 엔진 가림 위험 설명 | 완료 |
| 완료 기준 1: 엔진·도구 전환 방법과 위험이 표로 정리됨 | §2·§3·§5의 표와 구현 검증 조건 | 충족 |
| 완료 기준 2: 발표 범위에 넣을 엔진이 정해짐 | §6. 담당 작업 기준 **homr·정간보 포함 / Audiveris P3 / Ollama 선택 제외**, 렌더링·rules 지원 범위 결정 | 충족 |

Audiveris를 실행하지 않은 것은 P3 판단에 따른 범위 결정이며 성공 시간을 임의로 채우지 않았다. CPU 전용 교체·엔진 포함 이미지 구현·Docker Hub 게시·다중 아키텍처 검증은 이후 구현 작업이다.

참고한 프로젝트 파일:

- [엔진 설치 스크립트](../../../proto_type/src/app/ops/engines/) · [설치용 Dockerfile](../../../proto_type/docker/engines-installer.Dockerfile) · [모델 API Dockerfile](../../../proto_type/docker/model-api.Dockerfile)
- [엔진 어댑터](../../../proto_type/src/app/model-api/app/engines/) · [렌더러](../../../proto_type/src/app/model-api/app/render/) · [상태 API](../../../proto_type/src/app/model-api/app/routers/health.py)
- [프로젝트 작성규칙](../../../docs/API_재구성_작성규칙.md)

로컬 최종 검사: 사전 검증 응답 5건과 본문의 시간·성공·fallback 값을 대조했고, 참조 파일 존재 여부·`git diff --check`·`docker compose -f api/compose.yaml config --quiet`를 검사했다. Compose 검사 통과는 골격의 설정 유효성만 뜻한다.

- [x] 이슈 #7의 작업 범위 5항목 및 완료 기준 2항목 대조 완료
- [x] main pull 후 구별되는 이슈 전용 브랜치에서 README만 변경
- [x] 예은님 최종 결과 확인 및 GitHub 제출 승인

GitHub 이슈 본문·상태는 수정하지 않았다. 원격 이슈 종료와 팀장 리뷰는 제출 이후의 절차로 남겨 둔다.
