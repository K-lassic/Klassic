# model-api (담당: 예은 @yeeun5364)

## 외부 API 예시 홈페이지·공유 악보 — #93

구조에서의 위치: 브라우저 `/demo/` → 외부 키를 보관한 별도 예시 서버 → model-api 공유 악보·MP3 API → DB 공개 뷰·backend 공유 저장소·기존 렌더러다. `proto_type/`·인식 엔진·가중치는 수정하지 않는다. #128(0.2.1)이 병합된 최신 main의 사진 제한·임시 폴더 정리·4GiB 한도를 유지하고, 공유 악보·데모를 추가하는 이번 서비스 버전 후보는 0.2.2다.

- `GET /v1/shared-scores`는 계약의 정렬·1~50개 페이지·offset·has_more를 제공한다. 목록과 `GET /v1/shared-scores/{share_no}/score`는 키·UC12·기존 한도를 적용하며 작성자·원 요청·파일 위치는 반환하지 않는다.
- backend `storage`의 `shared/` 하위만 `volume.subpath: shared`로 `/shared-scores`에 읽기 전용 연결한다. `SHARED_SCORES_DIR`로 경로를 재정의할 수 있으며 DB URI `shared/<공유 번호>/score.musicxml`는 유지하고 파일은 마운트 루트의 `<공유 번호>/score.musicxml`에서 읽는다. 사용자 원본이 있는 형제 폴더는 마운트하지 않는다. 다른 요청 경로·절대 경로·링크·없는 파일은 404다. 거둠·관리자 내림·만료·정리된 악보도 제외한다.
- 등록은 `api/`에서 `docker compose --profile tools run --rm shared-seed --confirm-rights`로 명시 실행한다. 등록 도구도 `shared/` 하위에만 쓰며 사용자 원본 폴더는 마운트하지 않는다. 이용 조건을 확인한 MusicXML만 manifest로 지정하며 기본 후보는 프로젝트에서 만든 아리랑 한 곡이다. 출처 미확인 사진·국립국악원 PDF를 자동 등록하지 않는다. 서버 시작 시 자동 공개하지 않는다.
- `shared-storage-init`은 subpath가 아직 없는 빈 볼륨을 위해 일반 사용자(UID 1000)로 `shared/` 폴더만 준비하고 종료한다. 이 일회성 작업만 저장소 루트를 마운트하며 네트워크·DB·키를 사용하지 않고 기존 파일·권한을 바꾸지 않는다. API·등록 도구는 준비 작업 성공 후 제한된 하위 경로를 마운트한다.
- 기존 예시는 건너뛰고 내림·거둠·파일 유실 상태를 자동 복구해 재공개하지 않는다. DB 실패 시 이번에 만든 폴더를 되돌린다. 기존 2037-12-31 예시 보관 방식과 DB 파일 위치 기록을 유지한다.
- `--profile demo` 서버는 Node 내장 기능만 쓰고 외부 키는 서버 환경변수로만 받는다. 실행·Nginx 연결 요구·장애 대응은 [demo/README.md](demo/README.md)를 따른다. Nginx 설정은 팀장 담당으로 수정하지 않았다.

`tests/run_demo_live.ps1`는 `klassic_issue93` DB·`/storage/issue93`·`klassic_issue93_shared_test` 볼륨을 요구한다. 시험에서 임시 외부 키·공유 악보와 DB 제약을 만족하는 비활성 운영자를 사용해 MP3 허용·보류를 모의하고 원래 값으로 복원한다. 운영의 실제 라이선스 승인을 대신하지 않는다.

최초 제출 당시 로컬 Linux 검증: model-api 전체 **308개 통과·건너뜀 0·Ruff 통과**, 데모 Node HTTP 시험 **8개 통과**, 두 검토용 이미지 빌드·Compose 검사 통과다. #128 병합 이후 최신 main을 이번 브랜치에 반영했으며, 아래 수치는 최초 제출 당시 기록이다. 통합 검증 결과는 별도로 기록한다. 기존 Starlette 사용 중단 예고 경고 1건이 있다. 실제 격리 DB에서 외부 키의 목록·MusicXML·공유 숨김 4종·공유 볼륨 쓰기 거부·키 없는 브라우저 응답·실제 FluidSynth MP3(741040B, 30.8초, RMS 455.39)·정책 변경 후 보류·공유 거둠 차단을 확인했다. 시드 도구는 첫 실행 1개 등록·재실행 1개 건너뜀을 확인했다. 시험 정책·키·운영자·공유 파일은 정리하고 기존 #45 시험 컨테이너 healthy를 복원했다. 실제 Nginx·Funnel·브라우저 재생·동시 렌더링 최대 메모리는 미검증이며 #91·#98·팀장 Nginx 연결 후 별도 확인한다. 데모 컨테이너의 완료 직후 단일 관측 메모리 29.55MiB는 최대 사용량이 아니므로 자원 한도 근거로 사용하지 않는다.

### 1차 main 통합 검증 — 2026-11-03

PR #128·#130과 공개 예시 정리가 포함된 `origin/main`(`7a5e933`)을 통합했다. 서비스·Compose·lock 버전은 0.2.2로 유지하고 #128의 사진 접수 기준·임시 폴더 정리·4GiB 한도와 #93 공유 악보·데모 기능을 함께 보존했다. Linux에서 model-api 전체 **324개 통과·건너뜀 0**, 데모 **10개 통과**, `uv lock --check`·Ruff·Compose config·전체 서비스 이미지 빌드를 통과했다. 기존 Starlette 사용 중단 예고 경고 1건은 남아 있다.

별도 로컬 프로젝트에서 `docker compose --profile demo up -d --wait`로 DB·web·admin·model-api·frontend·demo 준비 상태와 마이그레이션 종료를 확인했다. 실행한 model-api 이미지 ID가 빌드 이미지와 같고 버전 0.2.2·4GiB 한도가 적용됨을 확인했다. 실제 브라우저에서 로그인 화면·체험하기 이동·API활용 화면·엔드포인트 목록을 확인했으며 웹·모델 health는 200, 키 없는 공유 악보 요청은 401이었다. 내부 demo 목록 연결도 200(공유 악보 0개·선율 악기 6개)이었다. 이 로컬 프로젝트에서 악보 인식·MP3 재생 전체 흐름을 재시험한 것은 아니며 공개 Nginx `/demo` 연결·Funnel과 공유 볼륨 범위 축소 리뷰는 별도 작업이다. 검증 후 동일 프로젝트를 `docker compose down`으로 정리하고 데이터 볼륨은 보존한다.

### 리뷰 반영·최종 통합 검증 — 2026-11-03

팀장 추가 지시에 따라 `volume.subpath: shared`를 model-api(읽기 전용)와 예시 등록 도구(읽기·쓰기)에 적용했다. DB의 `shared/<번호>/score.musicxml` URI는 유지하고 컨테이너 경로만 `<번호>/score.musicxml`로 맞췄다. 일반 사용자·네트워크 없는 일회성 준비 작업을 추가해 새 빈 볼륨에서도 shared/를 먼저 만들며, 실제 새 시험 볼륨에서 첫 실행·정리를 확인했다. 기존 데이터·권한을 임의 변경하지 않는다.

팀장의 Nginx `/demo` 연결·라이선스 확인 도구가 포함된 최신 `origin/main`(`d0a7ed0`)도 반영했다. 최종 Linux 검증은 model-api **329개 통과·건너뜀 0**, 데모 **10개 통과**, lock·Ruff·Compose config 통과다. 실제 Compose에서 전체 서비스 healthy, 하위 공유 폴더 가시성·사용자 파일 비노출·읽기 전용 쓰기 거부·예시 1개 등록/반복 건너뜀을 확인했다. Nginx 경유 `/demo/` 화면에 아리랑·선율 악기 6종이 표시되고 외부 MP3 정책 미확인 시 보류 안내가 나오는 것을 브라우저로 확인했다. 정책은 임의 승인하지 않았다. 공유 파일 읽기와 내부 서비스 키 MP3 생성은 실제 200(741040B)을 확인했다. Funnel·실제 운영 키/정책 적용·최종 외부 재생과 청감은 #49 연동에서 확인한다. 이전 격리 시험의 외부 키 실제 MP3·정책 변경·공유 거둠 검증은 최초 제출 기록을 따른다.

검증 후 `docker compose down`으로 로컬 프로젝트를 정리했고 `docker ps -a`가 비어 있음을 확인했다. DB·사용자 파일·엔진 볼륨은 보존했으며 빈 볼륨 초기화 시험에서만 새로 만든 데이터 없는 임시 볼륨은 시험 종료 후 제거했다.

### 외부 키·Nginx·브라우저 실제 재생 검증 — 2026-11-03

PR 브랜치 `9904125`를 별도 `klassic-api-issue93` 프로젝트·DB·파일 볼륨으로 기동하고 최신 Nginx `/demo/` → 데모 서버 → Nginx `/api/v1/*` → model-api 흐름을 검증했다. 시험 도구는 DB `klassic_issue93`·저장소 `/storage/issue93` 경계를 확인한 뒤 임시 외부 키를 발급했다. 실제 운영의 이용 허가를 변경하지 않고 격리 DB에서만 정책 허용·보류를 모의했다.

외부 키의 공유 목록·MusicXML·MP3 생성, 공유 숨김 4종, 정책 재확인·공유 거둠 뒤 차단, 공유 볼륨 쓰기 거부, 브라우저 응답의 키 비노출을 통과했다. 생성 MP3는 741040B·약 30.8초·RMS 314.82였으며 파일 길이는 요청 처리 시간이 아니다. 브라우저에서는 자동 재생하지 않는 것과 사용자 재생 버튼 후 가야금·대금 각각 재생 시간이 진행되고 readyState=4·오디오 오류 없음까지 확인했다. 같은 곡의 가야금 741040B·대금 736025B 파일 해시가 달라 악기 선택에 따른 오디오 변경도 확인했다. 이 검증은 음색의 주관적 품질 평가를 대신하지 않는다.

시험 정책을 원래 상태로 복구하고 임시 키·운영자·공유 파일·기록을 정리했다. `docker compose down`으로 컨테이너·네트워크를 정리하고 데이터 볼륨은 보존했다. 실제 운영 서버의 키·정책 적용, Funnel/LTE 경유 확인과 최종 청감은 #49에서 남는다. 이번 추가 작업은 검증 기록이며 구현 코드는 변경하지 않았다.

### prototype 없이 실행하기 위한 조건·검증 — 2026-11-03

기본 `api/compose.yaml`과 `demo` 프로필은 `proto_type/` 소스·프로토타입 컨테이너·v0.1.1 런타임 이미지를 사용하지 않는다. 기본 실행에는 `deploy/compose.standin.yaml`을 추가하지 않는다. #25의 선택적 `engine-selftest` 도구는 과거 런타임 이미지를 쓰는 별도 검사이며 데모 기동 경로에 포함되지 않는다.

필수 실행 자원은 별개다. `api/.env`의 DB·키 설정, Git LFS에서 받은 `api/shared/soundfonts`의 실제 SF2 파일, 설치된 homr·정간보·가중치가 있는 외부 엔진 볼륨(기본 `klassic_engines`)이 필요하다. 엔진 볼륨은 읽기 전용으로 재사용하며 기존 Python 절대 경로 때문에 `/opt/gugak-engines`를 유지한다. 현재 model-api 이미지는 엔진·가중치를 포함하지 않으므로 엔진이 없는 새 PC에 소스만 복사하면 바로 실행되는 배포물은 아니다. 새 환경에는 엔진 볼륨 준비·이관 절차가 별도로 필요하다.

main `7df7745`에서 **api/만 추출한 별도 폴더**를 만들고 실제 SF2 파일을 그 api/shared에 복사했다. prototype 폴더가 없고 모든 호스트 bind mount가 api/ 내부이며, 활성 서비스에 과거 런타임 이미지가 없는지 확인했다. 이 사본에서 backend·frontend·model-api·demo를 별도 시험 태그로 빌드했다. 새 DB·파일 볼륨과 기존 읽기 전용 엔진 볼륨으로 DB·Nginx·model-api·demo를 기동해 health=ok, DB=ok, 모델 3종 준비를 확인했다. Nginx 경유 외부 키·실제 MP3 생성(741040B)과 브라우저 재생 시간 진행·오디오 오류 없음까지 통과했다. 운영의 라이선스 승인 대신 격리 DB에서만 정책을 모의하고 종료 시 복원했다.

현재 데모 실행을 위해 수정해야 할 코드 문제는 발견하지 못했다. 시험 데이터·정책·컨테이너를 정리하고 시험 전용 이미지도 제거했다. 기존 로컬 실행 이미지·되돌리기용 이미지·DB/업로드/엔진 볼륨은 보존했다. 이 검증은 빈 PC의 엔진 최초 설치나 운영 서버의 Funnel 접속까지 검증한 것은 아니다.

## #33 리뷰 후속 보완 — 사진 접수 기준·임시 폴더 정리

서비스 버전은 확정된 `v0.2.0` 이후 업데이트인 **0.2.1**로 올린다. 기존 Git 태그·이미지를 덮어쓰지 않으며 계약 문서 판본 0.1.1과 API 버전 `v1`은 유지한다. 아래는 후속 PR의 로컬 구현·검증 기록이며 운영 배포 완료를 뜻하지 않는다.

`STORAGE_DIR/tmp`에서 1시간이 지난 일반 파일뿐 아니라 비정상 종료로 남은 인식·렌더링 임시 폴더도 정리한다. 폴더 안에 최근 수정된 파일·하위 폴더가 있으면 보존하며 심볼릭 링크 대상은 순회·삭제하지 않는다. 항목 하나의 삭제가 실패하면 오류 종류만 기록하고 나머지를 계속 정리하며 다음 주기에 재시도한다. 기존 `tmp_files` 집계는 삭제한 최상위 임시 항목 수(파일 또는 폴더)를 뜻한다.

Linux 시험은 오래된 중첩 폴더 제거, 새 하위 파일 보존, 외부 폴더를 가리키는 링크 보호, 반복 실행, 개별 삭제 실패 후 다른 항목 정리를 확인한다. 운영 저장소 정리를 직접 실행하는 시험은 아니다.

PR #122 당시 웹은 받아 준 사진을 model-api가 화소 상한으로 거절해 대체 악보로 처리할 수 있었다. 사용자와 확인해 **기존 4000만 화소·긴 변 10000px 상한을 유지**하고 `shared/upload-rules.json`의 `kinds.image.max_pixels`·`max_edge_px`로 옮겨 웹 접수와 model-api가 같은 기준을 읽도록 수정했다. 기존 작은 사진 자동 확대 후 크기까지 검사하며 20MiB·최대 10장·원본 보존·인식 방식은 유지하고 자동 축소는 추가하지 않는다.

웹은 사진 머리에서 크기를 확인해 파일 저장·요청 생성·인식 접수 전에 `413 UPLOAD_TOO_LARGE`로 안내한다. 오류 `details.reason=image_pixels`이면 「사진의 해상도가 너무 높습니다. 한 장당 4000만 화소 이하, 긴 변 10000px 이하만 가능합니다.」를 반환하며, 여러 장은 `details.page`를 포함한다. 작은 사진 확대 후 상한을 넘는 긴 사진은 쪽별로 나누도록 안내한다. 용량 초과 안내는 그대로다. 화면은 서버가 보낸 message·fix를 사용하므로 frontend 코드는 수정하지 않았다. backend·shared 담당 경로의 수정 범위는 PR #122 댓글로 먼저 공유했다.

숫자를 높이거나 모든 운영 부하에서 안전함을 확정한 수정은 아니다. 실제 고화소 촬영본·10장·운영 자원에서 동시 인식의 추가 검증은 남는다. 공통 규칙을 이미지에 포함하므로 배포 시 backend와 model-api 이미지를 함께 다시 빌드해야 한다.

최종 로컬 Linux 검증은 model-api 전체 **311개 통과·건너뜀 0·Ruff 통과**, backend 빌드와 단위 시험 **79개 통과**다. 화소·긴 변 경계값, 작은 사진 확대 후 상한, 공통 규칙 값 변경 반영, 여러 장의 반려 쪽·용량과 다른 안내를 포함한다. 실제 웹 multipart 경로에서 413·계약 응답을 확인하고 파일 저장·DB 요청 생성·인식 접수가 호출되지 않는지 검증했다. model-api의 오선보·정간보·외부 연주·내부 검사 경로도 정상 권한의 ASGI 시험에서 요청 생성 전 413을 확인했다. DB 의존 동작은 시험 대역이며 실제 브라우저 전체 경로와 변경 이미지 배포는 이번 검증에 포함하지 않는다. 기존 Starlette 사용 중단 예고 경고 1건은 남아 있다.

### 메모리 한도·고화소 사진 시험 — 2026-11-03

팀장이 전달한 main `0303bca` 임시 프로젝트 측정은 대기 약 0.7GiB, 인식·렌더링 순차 최대 2.29GiB, 렌더링 6건 동시 최대 3.35GiB(18.3초, 전부 성공)다. 최대값에 여유를 둔 `mem_limit: 4g`를 Compose에 반영했다. 4GiB는 예약 메모리가 아닌 컨테이너 상한이며 사진 전처리·엔진·작업자 등 컨테이너 전체에 적용된다. 실제 서버 기본판은 재구성 model-api로 전환했고 예시·내려받기·외부 키 흐름을 재검증했다는 팀장 전달을 받았다. 해당 서버 점검을 이 PC에서 다시 수행한 것은 아니다.

고화소 사진 대응은 사용자와 협의해 **20MiB와 기존 처리 방식을 유지하며 실제 처리 가능성을 먼저 시험**했다. 아래 시험 뒤 현행 화소 상한을 유지하고 웹 접수 기준을 맞추기로 확인받았다. 자동 축소를 서비스에 추가하지 않았다. 기존 실제 HTTP 시험에서는 한도 1인 임시 외부 키의 동시 호출 결과 200·429, `RATE_LIMIT_EXCEEDED`·`Retry-After`, 집계 시간을 61분 전으로 옮긴 후 재접수 200을 확인했다. `SERVER_BUSY` 검사는 별도다(`tests/container_limits_smoke.py`).

이 PC는 Docker 6코어·메모리 3.826GiB로 서버 PC의 4코어·16GB와 다르다. 다른 서비스를 보호하기 위해 임시 #45 컨테이너를 3코어·2.5GiB로 제한하고, 시험 컨테이너에만 화소 검사 우회 사본을 읽기 전용으로 붙여 기존 엔진의 전체 HTTP 경로를 확인했다. 공개 악보를 확대한 JPG이므로 실제 고해상도 촬영 품질이나 인식 정확도 일반화를 검증하지 않는다. 조건별 각 1회이며 최대 메모리는 25ms 간격 cgroup 측정에서 `memory.current - inactive_file` 값이다. 클라이언트도 동일 컨테이너에서 실행돼 그 비용이 포함된다.

| 오선보 입력 | HTTP·결과 | 전체 요청 시간 | 컨테이너 최대 메모리 |
|---|---|---|---|
| 1654×2339 (약 387만 화소), JPG 195592B | 200, 실제 인식, 84음표 | 42.99초 | 2053.20MiB |
| 4119×5825 (약 2399만 화소), JPG 798709B | 200, 실제 인식, 기준과 음표 순서 동일 | 46.00초 | 2426.84MiB |

두 호출의 시작 메모리는 각각 1013.90·1486.63MiB로 달라 표의 차이를 사진 크기만의 비용으로 해석할 수 없다. 두 번째 호출의 총 메모리는 2483MiB로 시험 한도에 가까워져 4800만 화소는 시험하지 않았다. 이어 수행한 정간보 기준 입력(2200×3091)도 총 메모리가 2560MiB에 도달하고 대체 응답이 나와 그 엔진의 추가 시험을 중단했다. 이는 2.5GiB 시험 조건의 결과이며 운영 4GiB에서의 실패나 고화소 사진 자체의 결함을 뜻하지 않는다. 다중 사진·동시 인식·4800만 화소·실제 고화소 촬영본은 아직 미검증이다.

이어 다른 서비스를 보호하며 3GiB 한도로 추가 시험했다. 같은 오선보 기준 입력은 37.66초·최대 1998.15MiB, 약 4800만 화소 JPG(5826×8238, 1407463B)는 43.53초·최대 2767.16MiB로 실제 인식에 성공하고 84개 음표 순서가 같았다. 같은 4800만 화소 입력 두 건 동시 접수에서 Docker `oom` 이벤트가 발생해 시험 실행이 중단됐다. 동시 요청 성공 시간·정확한 최대 메모리는 얻지 못했다. 이를 운영 4GiB에서의 실패로 해석하지 않는다. 이 PC의 실제 RAM은 약 8GB라 서버 PC의 16GB 조건과도 다르다.

시험 전용 DB 기록·키·파일을 정리하고 우회 마운트·시험 한도를 제거했다. OOM으로 정리가 중단된 비활성 시험 계정 1개·키 1개·API 요청 4개도 별도로 정리했다. 정상 소스·4GiB Compose로 시험 컨테이너 healthy를 확인했다. 상한 완화·제거는 운영 자원 조건의 후속 시험 후 결정한다.

## 계약·장애 시험과 준비 실패 결과 보존 — #45

구조에서의 위치: 엔진 없는 ASGI 계약 검사 → 읽기 전용 `api/contracts/model-api.yaml` 대조, 별도 실제 시험 → 임시 DB·저장소·설치 엔진과 HTTP 경로다. 운영에 오류 주입 API를 추가하지 않는다.

- 계약·회귀 **295개 통과**, 건너뜀 0개, Ruff 통과다. 이 중 계약 YAML의 응답 코드·JSON Schema·헤더를 직접 대조하는 행렬은 57개이며, 나머지는 기존 기능·최소권한·한도·파일 경계·장애 회귀다. TestClient 사용 중단 예고 경고 1건은 유지된다.
- CI용 검사는 외부 엔진·DB 없이 실행한다. `uv sync --frozen`, `uv run ruff check app tests`, `uv run pytest -q`로 수행한다. 계약 경로는 저장소 상대 위치가 기본이며 특수 마운트 환경은 `CONTRACT_TEST_PATH`, 공통 fixture는 `SHARED_TEST_DIR`로 지정한다.
- 계약 검사에는 상태·모델·악기 목록, 접수 202, 인식·렌더링 정상 응답, 키 401/403, 필수값·자료형 422, 크기 413·형식 415, 처리 중 425·소유권 404·만료 410, 한도 429와 재시도 헤더, 엔진 미설치·시간 초과·변환 실패, 렌더러 502/504를 포함한다.
- PR #114의 검토에서 지적한 준비 실패를 8가지 경우로 먼저 재현했다. 수정 전에는 `service_down`으로 끝나 주소가 비었고, 수정 후에는 저장된 원본 MusicXML·가능한 MIDI를 다운로드 항목에 등록하고 완료 상태와 기존 인식/대체 사유를 유지한다. MP3만 실패와 사유를 표시한다. 이때 원본에는 악기·조옮김 등 준비 단계의 설정이 적용되지 않을 수 있다.
- 개발용 `PyYAML 6.0.3`·`jsonschema 4.26.0`과 하위 의존성을 lock에 고정했다. 최종 실행 이미지에는 개발 검사 패키지를 설치하지 않는다.

실제 검사는 `tests/run_live.ps1`로 분리했다. 별도 `klassic_issue45` DB·`/storage/issue45` 저장 경로에서 아래 5종을 모두 통과했다. 임시 키·요청·호출 기록·파일·세션은 각 시험 뒤 정리하며 공개 예제만 입력한다.

| 실제 시험 | 확인 결과 |
|---|---|
| 기반·키 | healthy·모델 준비, 키 없음/잘못된 키 401, 서비스 키 설정 조회, 외부 키 내부 경로 403 |
| 오선보 | 실제 homr 사진·PDF 인식·MIDI·쪽별 DB 기록, 부분 성공·서버 대체·웹 결과 파일 경계·마감 초과 |
| 정간보 | 실제 사진·PDF 인식·정간보 변환·MIDI·타당성 및 단계 기록, 양방향 종류 불일치·마감 초과 |
| 렌더링 | 국악·GM·혼합 MP3, 타악기 포함 MIDI·MXL 입력, 한글 PDF 1쪽·여러 쪽, 외부 MP3 정책 |
| 준비 실패 | 임시 DB·실제 결과/파일 API에서 대기·준비 시간 초과·준비 오류·예상 밖 오류의 원본 다운로드 보존 9가지 통과. 이 오류 주입 시험의 인식 단계는 유효한 고정 악보로 대체하며 실제 인식 검사는 위 두 항목에서 따로 수행 |

실제 시험 예시(서비스 폴더 기준):

```powershell
./tests/run_live.ps1 -EnvFile <시험 env 절대 경로> -OverrideFile <시험 Compose 덮어쓰기 절대 경로> -StaffImage <공개 오선보 예제> -JeongganboPdf <공개 정간보 PDF> -ReportDirectory <로컬 결과 폴더>
```

시험 환경은 `DB_NAME=klassic_issue45`, `STORAGE_DIR=/storage/issue45`, `TMPDIR=/storage/issue45/tmp`여야 한다. 준비된 시험 컨테이너·엔진 읽기 전용 볼륨·실제 LFS 음원이 필요하다. 스크립트는 기존 시험의 #24 가드를 이 실행에서만 #45 DB와 저장 경로로 더 좁혀 사용한다. 실제 시험은 일반 pytest에 자동 포함·건너뜀 처리하지 않는다.

Funnel을 통한 외부 회선·브라우저 전체 흐름·동시 사용 자원 측정은 #49의 별도 검증이다. 이번 결과는 임시 Linux/amd64·Python 3.11 환경의 기능·장애 검증이며 운영 배포 완료를 뜻하지 않는다.

## 공개 호출 상한·API 파일 정리 — #33

구조에서의 위치: Nginx → Uvicorn의 프록시 정보 처리 → 인증·한도·본문 보호 → 기존 인식/렌더링 API다. 별도 주기 작업은 DB의 만료 API 요청만 찾아 API 전용 파일·DB 위치를 정리한다. 웹 파일은 #85가 맡는다.

- `v_key_quota`와 같은 최근 1시간의 `accepted POST` 횟수를 센다. 키 행을 잠근 트랜잭션 안에서 검사·호출 기록 예약을 함께 수행하므로 같은 키의 동시 요청도 남은 횟수 이상 접수되지 않는다. 응답 때 같은 기록을 최종 결과로 갱신하며 입력 반려는 횟수를 소비하지 않는다. 기본 서비스 키의 NULL 한도는 유지한다.
- 한도 초과는 `429 RATE_LIMIT_EXCEEDED`, 외부 접수 자리 부족은 `429 SERVER_BUSY`와 `Retry-After`·`error.retry_after`로 반환한다. 업로드 중인 외부 호출도 처리 자리의 두 배까지 접수 예약에 포함하며, 비동기 연주는 작업 종료·취소 때 예약을 반환한다. 상태·결과·서명 다운로드는 횟수를 소비하지 않는다. 악기 목록은 기존 기준판처럼 남은 한도를 확인한다.
- multipart 파서가 본문을 읽기 전에 인증·한도를 검사한다. 본문 전체는 기본 210MiB, 읽기 시간은 300초로 제한하고, 큰 본문과 multipart 임시 사본은 디스크 볼륨의 임시 파일로 받는다. 파일도 나누어 읽어 사진·PDF 20MiB, 악보 파일은 공통 규칙 기본 5MiB 또는 DB 설정, 인식 최대 10개·렌더링 1개를 제한한다. 크기 초과 413, 잘못된 본문 길이·읽기 시간 초과는 공통 400과 구체적 사유를 준다. 임시 본문은 요청 종료 시 정리한다.
- 픽셀을 풀기 전에 확대 사본까지 고려해 사진 긴 변 10000px·4000만 픽셀 상한을 검사한다. PDF 렌더링도 4000만 픽셀로 제한하며 MXL은 압축 내부 100개·합계 20MiB를 넘으면 거절한다. 파일·픽셀 상한 아래의 형식 검사는 스레드에서, 인식·렌더링은 기존 별도 프로세스에서 처리한다.
- DB 인식 제한 시간은 `RECOGNITION_TIMEOUT_MAX_SECONDS`(기본 쪽당 180초)보다 커지지 않는다. `X-Deadline`은 더 이른 마감만 지정할 수 있고, 렌더링의 기본 120초 제한·시간 초과 프로세스 종료는 유지한다.
- PR #114 검토에서 요청한 `--proxy-headers --forwarded-allow-ips '*'`로 Nginx가 넘긴 실제 주소·HTTPS 정보를 반영한다. #114가 수정 커밋보다 먼저 병합돼 해당 수정은 #33에 포함한다. 이는 model-api 포트를 호스트에 공개하지 않고 신뢰하는 내부 컨테이너만 접근하는 현재 Compose 구성의 전제다. 외부에 9543 포트를 직접 공개하면 안 된다. 실제 Nginx 경유 HTTPS 다운로드 주소와 Uvicorn의 실제 주소 반영을 확인했다.

### API 만료 파일 주기 정리

- `PURGE_INTERVAL_SECONDS` 기본 600초마다 DB `v_purge_due_requests`에서 `channel='api'`만 조회한다. 보관 기간은 DB 뷰의 24시간을 따른다. `/storage/api/<request_no>`를 삭제한 뒤 `upload_file`·`score_result`·`derived_file`의 위치·삭제 시각을 한 트랜잭션으로 갱신하고 `purged_at`을 마지막에 기록한다.
- 파일 삭제 실패는 무시하지 않으며 DB 기록을 남겨 다음 주기에 재시도한다. 파일만 지운 뒤 DB 반영 전에 중단돼도, 재시작 후 DB 뷰를 다시 읽어 마무리한다. 한 요청의 실패는 다른 요청 정리를 막지 않는다. DB 잠금으로 여러 인스턴스의 정리 중복을 막는다.
- DB에 없는 요청 모양의 API 폴더는 기본 24시간이 지난 것만, `STORAGE_DIR/tmp`의 일반 임시 파일은 1시간이 지난 것만 정리한다. 삭제 직전 DB를 다시 확인하며 새 폴더·현재 연주 작업·웹 요청을 보존한다. API 루트 밖 경로·심볼릭 링크는 따라가지 않는다.
- 추가 설정은 서비스 `.env.example`에 있으며 실행 시 주입한다. 정리 대상은 엔진·가중치·음원·템플릿·웹 저장소를 포함하지 않는다.

### 검증

Linux/amd64·Python 3.11에서 전체 테스트 **230개 통과**, 건너뜀 0개, Ruff 통과다. 기존 기능 회귀와 한도·접수·본문 길이·스트리밍·읽기 시간·픽셀·압축·마감 제한, 웹 보존·경로 보호·삭제 실패·재시도를 포함한다. TestClient 사용 중단 예고 경고 1건은 유지된다.

기존 DB와 분리한 임시 `klassic_issue33`, 임시 저장 경로 `/storage/issue33`에서 `tests/container_limits_smoke.py`를 수행했다. 실제 같은 키 동시 호출 중 한 건만 접수, 1시간 창 복구, 접수 초과 429, Content-Length·chunked 상한 413, 읽기 시간 초과 400을 확인했다. 시험에서는 본문 1MiB·읽기 2초·정리 주기 2초로 낮춰 확인했으며 일반 기본값을 바꾸지 않았다.

파일 삭제 뒤 DB 갱신을 의도적으로 실패시키고 정리 잠금을 유지한 상태에서 **실제 시험 컨테이너를 재시작**했다. 다음 주기에서 `purged_at`·세 종류의 DB 파일 위치 정리가 끝났고, 웹·만료 전 API·새 고아 폴더·새 임시 파일은 보존되며 오래된 고아·임시 파일만 지워졌다. 검증 후 시험용 키·요청·파일·세션을 정리했다. 운영 서비스와 기존 시험 DB는 건드리지 않았다.

재현은 임시 DB·저장소에서만 가능하다. `container_limits_smoke.py`를 `python - prepare`로 stdin 실행해 `ready_for_restart=true`를 확인하고 시험 컨테이너를 재시작한 뒤 같은 스크립트를 `python - verify`로 실행한다. prepare는 재시작할 때까지 의도적으로 잠금을 유지하므로 운영에서 실행하지 않는다.

추천은 #88(P3), 공유 악보 API는 #93(P2) 후속 범위다. PR #114 리뷰의 렌더링 준비 실패 시 원본 인식 결과 제공 개선은 #45에서 장애 시험과 함께 다룬다. 공개 입구 전체·동시 사용 자원 측정은 #49에서 확인한다.

## 외부 연주·다운로드 API — #32

구조에서의 위치: 외부 API 키 호출자 → 접수·상태·결과 라우터 → 기존 쪽별 인식 → 별도 악기 배정·렌더링 작업자 → API 전용 저장소와 DB다. 웹 요청은 수정하지 않는다. `GET /v1/instruments`는 별도 목록 라우터로 분리해 후속 공유 악보 경로를 추가할 수 있게 했다.

- `POST /v1/performances`: `score`를 반복하는 사진 여러 장 또는 PDF 한 개와 `score_type`을 받아 202·요청 번호를 반환한다. MIDI·MusicXML은 접수하지 않는다. 악기 JSON, 조옮김 -12~12, 음량 0~2를 검사하며 반려된 입력에는 요청 행을 만들지 않는다.
- `GET /v1/performances/{request_no}`·`/result`: 접수한 외부 키와 같은 키만 조회한다. 다른 키·웹 요청은 404, 처리 중 결과는 425, 대체 완료는 `completed_fallback`, 보관 만료 상태 조회는 `expired`, 만료 결과는 410이다. 기본 권한표의 서비스 키에는 UC13을 허용하지 않는다(403).
- 기존 쪽별 인식과 DB 기록을 재사용한다. 성공한 쪽만 이어 붙이고 부분 실패를 안내한다. 모두 실패하면 서버 보유 템플릿을 실제 결과 파일로 제공하며 템플릿도 없으면 `service_down`으로 끝낸다.
- `default`·`custom`·`original`과 조옮김·음량을 적용한다. 사진·PDF의 `original`에는 원래 악기 정보가 없으므로 기본 구성으로 대체하고 `original_instruments_unavailable`을 알린다. `recommend`는 현재 추천 서비스 미연결로 기본 구성과 `recommend_failed=true`를 반환한다. 추천 연동은 #88(P3, 발표 이후 — `docs/API_업데이트_후보.md`)에서 한다.
- 결과 MusicXML을 기준으로 MIDI를 만들며 오류·시간 초과는 별도 작업자에서 격리한다. MIDI 변환·MP3 합성이 실패해도 생성된 MusicXML은 유지한다. 실제 배치한 악기 편성과 파생 파일 위치는 `performance_option`·`instrument_selection`·`derived_file`에 기록한다. 종료·예상 밖 실패는 요청을 `service_down`으로 마감한다.
- 결과는 `STORAGE_DIR/api/<request_no>/`에 저장하고 DB에는 상대 위치를 기록한다. URL에는 서버 파일 경로를 넣지 않는다. 외부 MP3 제공 정책을 결과 조회·다운로드 시 다시 확인한다. 정책 미확인이면 MP3 URL은 null이며, 해당 URL 직접 접근도 404다. 정책 자체는 변경하지 않는다.
- `GET /v1/files/{token}`은 API 키 대신 짧은 HMAC 서명 주소를 사용한다. `FILE_TOKEN_TTL_SECONDS` 기본 900초, 범위 1~3600초다. 서명 변조·잘못된 형식은 404, URL·보관 만료·파일 없음은 410이다. 다른 요청 폴더·저장소 밖·심볼릭 링크를 통한 탈출은 거절한다. 다운로드 응답은 `private, no-store`이며 로그에서 토큰을 가린다.
- `FILE_TOKEN_SECRET`은 DB 비밀번호·API 키와 별개인 32바이트 이상의 실행 환경 비밀값이다. 미설정 시 프로세스마다 안전한 난수를 만들므로 재시작하면 이전 URL은 무효가 되고 결과 재조회로 새 URL을 받는다. 재시작·여러 인스턴스 사이에 기존 URL을 유지하려면 동일한 비밀값을 실행 환경에 주입한다. 이미지·코드에는 넣지 않는다.
- `GET /v1/instruments`는 UC12 권한을 가진 외부·서비스 키로 DB의 활성 악기 17개와 음역을 읽는다. `shared-scores`는 #32 최신 댓글의 후속 범위이므로 경로를 미리 구현하지 않는다.

### 검증과 남은 범위

Linux/amd64·Python 3.11 컨테이너에서 전체 **201개 통과**, 건너뜀 0개, Ruff 통과다. 기존 인식·렌더링 회귀와 키 소유권·서명·만료·다른 요청 및 저장소 밖 파일 차단·작업 종료·MP3 실패 시 악보 유지·템플릿 누락을 검증했다. TestClient 사용 중단 예고 경고 1건은 유지된다.

격리 `klassic_issue24` DB에서 임시 외부 키로 실제 homr 인식·대체·부분 성공을 확인했다. 접수→상태→결과→서명 MusicXML/MIDI 받기, 대금·조옮김·음량, 실제 MP3 파일 생성, 다른 키 404, 보관 만료 파일 410을 통과했다. 예제 한 곡의 전체 처리 시간은 인식 약 64.8초, 대체 약 4.2초, 두 장 중 한 장 성공 약 66.2초였다(각 1회, 로컬 시험이므로 운영 성능 기준이 아님). 시험 요청·키·호출 기록·파일과 시험에서 새로 만든 편성은 정리한다.

최종 이미지에서 대체 결과를 만든 뒤 시험 컨테이너를 재시작해 완료 상태·MusicXML·MIDI·MP3의 보존을 확인했다. 서명 비밀값 미설정 상태에서 이전 URL은 404로 거절하고, 결과 재조회로 받은 새 URL은 200으로 다운로드했다. 시험용 키와 요청·파일은 검증 후 정리했다.

`tests/container_performance_smoke.py`의 `__SAMPLE_BASE64__`에 저장소 공개 오선보 예제의 base64를 주입해 Compose `exec -T model-api python -`으로 실행한다. 반환 URL은 공개 입구 기준 `/api/v1/files/...`다. 시험은 내부 주소로 직접 호출하므로 공개 입구가 제거하는 `/api`를 시험에서도 제거한다. 실제 공개 입구·HTTPS·브라우저 흐름은 #49에서 확인한다.

키별 한도·업로드/처리 상한·신뢰할 프록시 설정은 #33, 추가 장애·동시성 계약 시험은 #45 범위다. 논리적 보관 만료는 DB 뷰를 따르며 API 저장 파일의 주기 삭제는 #33에서 연결한다. 운영에서는 고정 FILE_TOKEN_SECRET을 실행 환경에 주입한다. 두 후속 방향은 사용자 확인을 받았으며 이번 변경에서 운영 설정·실제 주기 삭제는 수행하지 않았다. #31(PR #112) 병합을 확인했고 제출 전 최신 main을 대조한다.

## MP3·PDF 렌더링 — #31

구조에서의 위치: backend·API 호출자 → `POST /v1/render/mp3` 또는 `/v1/render/pdf` → 검사·정책·처리 자리 → 별도 렌더링 작업자 → FluidSynth·LAME 또는 Verovio·svglib·ReportLab → 결과 바이너리다. 인식 작업과 분리하며 렌더링 요청·중간 작업 행·결과 파일을 영속 저장하지 않는다. 인증 호출 기록은 기존 방식으로 DB에 남긴다.

### 입력·악기·음원

- multipart `score`로 MIDI·MusicXML·MXL 한 개를 받는다. MP3에는 선택적 `instruments` JSON을 받으며 생략하면 기본 가야금·장구 구성이다. 원래 악보에 타악 성부가 없으면 새 장단을 만들어 넣지 않는다.
- `default`, `custom`, `original` 악기 배정을 지원한다. `custom`의 성부 번호는 0부터다. `recommend`는 추천 서비스 연결 전 기본 구성으로 대체하며 실제 추천 연동은 #88(P3)에서 한다. `sf2_ref`에는 기본 음원 이름만 허용한다.
- 요청의 실제 성부를 국악/GM 묶음으로 나눠 국악은 `gugak.sf2`만, GM은 `FluidR3_GM.sf2`만 읽는다. 혼합이면 각 음원으로 따로 합성한 WAV를 섞고 LAME으로 인코딩한다. 필요한 음원 누락은 `RENDERER_MISSING`으로 반환한다. 이 선택 기준은 **렌더링 요청의 음원 로딩**에 적용하며 #24의 기동 준비 검사와 읽기 전용 마운트는 유지한다.
- 공유 악기 목록의 bank/program을 사용한다. 국악 선율은 bank 1, 장구·북은 타악 채널 10의 bank 128/program 1이다. MusicXML의 음표별 instrument ID·midi-unpitched와 MIDI 타악기 정보를 보존해 장구의 36·38·42 음번호가 기본값 60으로 바뀌지 않게 했다.
- 청감 피드백에 따라 서버 MP3의 국악 선율 잔향 보내기(CC91)는 72, 타악은 60으로 설정했다. 입력 MIDI의 CC91이 이를 다시 덮지 않도록 한다. 브라우저 연주기 파일은 수정하지 않았다.
- 사용자 비교 청취에서 선택한 장구 울림 보존을 적용했다. MP3 합성용 MIDI의 국악 타악 세트(128/1)에서만 note-off를 생략해 샘플이 자연스럽게 끝나게 하며, 타격 시점과 전체 트랙 길이는 유지한다. 원본 MIDI·MusicXML과 GM 타악의 음표 종료는 바꾸지 않는다.

### 응답·보안·시간 기록

- UC12 키 권한을 검사한다. 누락·잘못된 키 401, 폐기 키 403 기준을 유지한다. 서비스 키는 내부 렌더링에 사용하며, 외부 키는 DB `v_mp3_license`에서 정책 미확인 시 오디오 대신 200 `Mp3Withheld` JSON을 반환한다. 이 JSON에는 `X-Renderer`가 없다. 정책은 이 작업에서 변경하지 않는다.
- MP3 성공은 `audio/mpeg`, PDF는 `application/pdf`다. 바이너리 응답에는 `X-Renderer`, 모든 응답에는 `X-Request-ID`를 제공한다. 렌더러 실패·누락은 502, 기한 초과는 504다. `/v1/versions`의 기존 `engines` 배열에도 렌더러 버전·설치 상태를 추가한다.
- `RENDER_TIMEOUT_SECONDS` 기본값은 120초(환경 설정 범위 1~600초)다. 서비스·외부 호출을 합친 렌더링 동시 처리 상한을 적용한다. 별도 작업자와 자식 CLI는 같은 프로세스 묶음에서 실행해 기한 초과·취소·서버 종료 시 정리한다. Compose `init: true`로 종료된 자식 프로세스도 회수한다. CLI와 작업자에는 DB 비밀번호·서버 API 키를 전달하지 않는다.
- 원본·중간 SVG/MIDI/WAV는 임시 폴더에서 처리·정리하고 결과를 메모리로 반환한다. SVG의 외부 이미지·참조는 제거한다. 일반 사용자, 읽기 전용 루트·엔진·음원, 권한 제거를 유지한다.
- 요청 ID와 함께 `midi`, `fluidsynth_gugak`, `fluidsynth_gm`, `mix`, `lame`, `score_prepare`, `pdf`, 전체 시간과 선택한 음원 이름을 완료 로그 한 줄에 기록한다. 적용되지 않는 단계는 생략하거나 0으로 기록한다.
- PDF에는 NotoSerifKR·Leipzig와 OFL 문서를 이미지에 포함한다. 한글·한자·음악 기호와 여러 쪽 배치를 검증했다. 타악기 MIDI를 MusicXML로 내보낼 때 음표에만 남은 악기도 part-list에 등록한다.

### 검증·재현

추가 Python 의존성은 `mido 1.3.3`, `verovio 5.7.0`, `svglib 2.3.2`, `reportlab 4.5.1`이며 transitive 의존성까지 uv.lock에 고정했다. FluidSynth·LAME은 Dockerfile에서 설치하며 호스트 Python·운영 서비스는 변경하지 않는다. 글꼴 원본은 기준판에서 읽어 서비스 소유 `assets/fonts`에 라이선스와 함께 복사했다. `proto_type/`은 수정하지 않는다.

```powershell
# 서비스 폴더, Linux Python 3.11
uv sync --frozen
uv run ruff check app tests
uv run pytest -q
# 격리 시험 DB 전용: 실제 생성 파일·시간·정책·행 수 확인
Get-Content -Raw tests/container_render_smoke.py | docker compose --env-file <시험 env 절대 경로> -f ../../compose.yaml -p klassic-api-issue24 exec -T model-api python -
```

Windows Docker Desktop의 Linux/amd64·Debian 12·Python 3.11 컨테이너에서 테스트 **172개 통과**, 건너뜀 0개, Ruff 통과다. Starlette TestClient의 httpx 사용 중단 예고 경고 1건은 유지된다. 자동 검사에는 기존 인식 회귀, 렌더링 계약·정책·음원 선택·악기 배정·장구 타법·잔향·취소 시 자식 CLI 종료·여러 쪽 PDF·글꼴을 포함한다. 실제 HTTP에서는 국악/GM/혼합 MP3, 타악기 포함 MIDI·MXL 입력, PDF 1쪽·3쪽 생성, 외부 정책 미확인 안내와 기존 요청·작업 행 수 유지까지 확인한다. Poppler로 PDF를 이미지화해 페이지 전체를 검토했다. 시험 키·운영자와 해당 호출 기록은 정리하며 소리·PDF 검토 파일만 임시 폴더에 남긴다.

다운로드 완료 시간은 서버의 localhost에서 측정하며 파일을 받은 뒤의 오디오 장치 초기화·실제 브라우저 재생 시작·외부 회선은 포함하지 않는다. 준비된 작업자에서 약 30.8초·0.74MB MP3는 국악 1.08초, GM 1.84초, 혼합 1.92초, MusicXML PDF 1쪽은 0.86초였다(잔향 조정 전 각 1회). 최초 작업자 시작·라이브러리 로딩은 추가 시간이 걸릴 수 있다. 통계적 평균이나 실제 배포 서버 성능으로 해석하지 않는다.

가야금 음색과 비교 음원의 쿵·덩은 사용자 청감 확인을 받았고, 장구는 비교 청취에서 울림 보존 방식을 선택했다. 이 선택을 최종 MP3 합성에 반영했다. 실제 추천 연결은 #88(P3), 전체 한도·입력 상한은 #33, 브라우저 재생 비교·외부 전체 흐름은 #49에서 확인한다. #29(PR #106)·#30(PR #109) 커밋을 포함한 별도 #31 브랜치에서 시작했으므로 제출 전 선행 병합 상태와 최신 main을 다시 확인한다.

## 정간보 인식·변환 — #30

구조에서의 위치: backend·API 호출자 → `POST /v1/omr/jeongganbo` → 공통 검사·인식 처리 → 기존 정간보 작업자 → 별도 변환 작업자 → MusicXML/MIDI다. `omr_common`으로 #29의 인증·업로드·쪽별 처리·DB 기록·웹/외부 저장 경계를 재사용한다. 오선보 주소와 요청 필드는 유지한다.

- `image` 반복 필드, `request_no`와 호환 필드 `request_id`, `X-Deadline`을 받는다. 서비스·외부 키는 DB UC12 권한에 따르며 키 누락·잘못된 키 401, 폐기 키 403을 유지한다. 두 인식 경로의 OpenAPI에도 키 필요 여부를 명시했다.
- DB의 `jeongganbo` 어댑터를 기존 읽기 전용 설치 경로로 연결하고 #24의 상주 작업자를 재사용한다. DB에 남은 macOS `mps` 설정과 관계없이 현재 검증 환경은 CPU로 실행한다. 작업자가 바쁘면 마감 안에서 기다리며 추가 모델을 중복 실행하지 않는다.
- 기준판의 자체 작성 `jeongganbo_convert`를 옮겨 율명·옥타브·정간 안 자리·쉼표·이음·여러 성부를 MusicXML/MIDI로 변환한다. `OR` 후보는 첫 후보만 사용하고 범위 밖 자리 번호는 변환 실패로 처리한다. SejongMusic 코드는 가져오지 않는다.
- 변환은 별도 프로세스로 실행한다. 기한 초과·취소 시 변환 프로세스도 종료할 수 있으며, 서버 종료 시 모델 등록부가 사용한 어댑터·변환 작업자를 정리한다. 서버 DB 비밀번호·API 키는 작업자 환경에 넘기지 않는다.
- 오선보·정간보 점수를 함께 검사해 잘못 고른 종류를 `type_mismatch`·`detected_type`으로 반환한다. 구조 불통과 시 엔진을 호출하지 않으며 웹 대체 응답에는 파일을 넣거나 저장하지 않는다.
- `request_page`, `engine_attempt`, `processing_job`, `validity_check_item`, `stage_timing`에 판정과 처리 시간을 남긴다. 정간보의 율명 인식 비율과 `jg_convert` 단계 시간도 포함한다. 여러 쪽 병합·부분 실패·원본 보존·방향/색상 사본 처리는 #29와 같은 흐름을 쓴다.

### 검증 결과 — 2026-11-02

Linux/amd64·Debian 12·Python 3.11 컨테이너에서 **139개 테스트 통과**, 건너뜀 0개, Ruff 통과다. 율명·길이·박자·성부·OR 후보·잘못된 인코딩, 실제 별도 변환 프로세스, 중복 모델 실행 방지, 변환 시간 초과, 인증·종류 불일치와 #24·#28·#29 회귀를 포함한다. Starlette TestClient의 httpx 사용 중단 예고 경고 1건은 유지된다. 새 의존성이나 lock 변경은 없다.

공개 `taryeong-gayageum-jeongganbo.pdf`로 실제 엔진을 검증했다. 사진은 이 PDF 첫 쪽을 300dpi PNG로 만든 입력이다.

| 입력 | 실인식 결과 | 인식 시간 | 변환 시간 | DB 기록 |
|---|---|---:|---:|---|
| 정간보 사진 1장 | fallback=false · trust · 율명 비율 1.0 · MusicXML/MIDI 생성 | 약 19.5초 | 약 1.7초 | 쪽 1 · 엔진 시도 1 · 작업 1 · 타당성 5 · 단계 시간 5행 |
| 정간보 PDF 2쪽 | fallback=false · trust · 율명 비율 1.0 · MusicXML/MIDI 생성 | 약 24.6초 | 약 0.6초 | 쪽 2 · 엔진 시도 2 · 작업 1 · 타당성 5 · 단계 시간 8행 |

오선보를 정간보로, 정간보를 오선보로 보낸 실제 입력 모두 종류 불일치를 감지했다. 웹 응답의 결과 파일 없음·엔진 시도 없음, 기한 초과 `TIMEOUT`, 키 없음 401, 저장 파일과 DB 위치 일치, 정간보 설치·누락 진단을 확인했다. 격리된 `klassic_issue24` DB에서 생성한 시험 키·운영자·요청·파일만 정리했다. 일반 사용자·읽기 전용 루트/엔진/음원·권한 제거 상태와 healthy도 확인했다.

```powershell
# 서비스 폴더, Linux Python 3.11
uv run ruff check app tests
uv run pytest -q
python -m app.engines.selftest --engine jeongganbo
```

실제 HTTP 검사는 `tests/container_jeongganbo_smoke.py`에 공개 예제의 base64를 넣어 시험 컨테이너의 `python -`로 전달한다. 운영 DB에서는 실행을 거부한다. 위 수치는 Windows Docker Desktop의 Linux 컨테이너 실측이며 별도 Linux 서버·브라우저 전체 흐름·실제 사진 촬영 조건별 정확도 검증은 #49·#45에서 이어간다. 시작 시 #29 브랜치의 커밋 `bf0ce5a`를 포함했으며 제출 전 선행 PR 병합 상태와 최신 main을 다시 확인한다.

## 오선보 인식·모델 상태 — #29

구조에서의 위치: backend → `model-api:9543/v1/omr/staff` → 업로드·구조 검사 → 기존 homr 작업자 → 타당성 검사 → MusicXML/MIDI 응답이다. 모델·가중치는 #25의 읽기 전용 엔진 볼륨을 쓰며, #24에서 올린 작업자를 재사용한다. `GET /v1/models`는 키 없이 설치·준비 상태와 예상 로딩 시간을 반환한다. 정간보 인식 경로는 #30, MP3/PDF 렌더링은 #31에서 연결한다.

### 호출·결과·저장 경계

- multipart `image`를 사진 순서대로 반복하거나 PDF 한 개를 보낸다. 최대 10쪽이며 PDF는 모든 쪽을 300dpi PNG로 만든다. 인증은 `X-API-Key`와 DB의 UC12 권한을 따른다. 기존 키 누락·잘못된 키 401, 폐기 키 403 기준을 유지한다.
- 서비스 키와 `request_no`가 있으면 기존 웹 요청에 판정만 기록한다. 호환 필드 `request_id`도 받을 수 있다. 없는 웹 요청은 404이며 새 API 요청으로 바꾸지 않는다. 성공 결과 파일은 응답으로 보내 backend가 저장한다. 웹 대체 응답에는 MusicXML·MIDI를 넣거나 별도 결과 파일을 저장하지 않는다.
- `request_no` 없는 호출은 API 요청·원본을 만들고 결과 위치를 DB에 기록한다. 파일은 전용 `model-storage` 볼륨의 `/storage/api/<request_no>`에 저장한다. 엔진용 사본·중간 산출물은 `/tmp`에서 처리 후 제거한다. API 인식 실패에는 이미지에 포함한 api_server 대체 템플릿을 쓸 수 있으며, 템플릿 누락은 `service_down=true`다. 파일 보관 한도·정리 작업은 후속 범위다.
- 쪽마다 구조 → 설정된 엔진 순서 → 타당성을 검사하고 `request_page`, `engine_attempt`, `processing_job`, `validity_check_item`, `stage_timing`에 기록한다. 구조가 없으면 엔진을 호출하지 않는다. 타당성 항목은 요청 전체로 합치며 음 개수는 합, 나머지는 가장 낮은 값이다.
- 읽은 쪽을 올린 순서대로 이어 MusicXML/MIDI 한 곡으로 만든다. 일부 쪽 실패는 `PAGES_PARTIAL`과 실패한 쪽 번호를 제공한다. 전부 실패하면 `fallback=true`와 사유를 반환한다. HTTP 200만으로 실인식 성공을 판정하지 않는다.
- `X-Deadline`의 ISO 시각과 쪽별 제한을 함께 적용한다. 구조 검사·엔진·타당성 검사 대기를 제한하고 엔진 시간 초과·취소 시 프로세스 묶음을 끝낸다. MIDI 변환은 별도 작업자로 제한 시간을 두고 수행하며, 변환 실패 시 MusicXML만 반환할 수 있다.
- 인식용 사진 사본에만 EXIF 방향을 적용하고 투명 배경을 흰색으로 합성한다. 16비트 PNG는 0~65535 명암을 0~255로 변환한다. 그 뒤 작은 사진을 확대한다. 원본과 #28 검사 API의 판정·확대 생략은 유지한다. 긴 변·읽기 단계의 상한 강화는 #33 범위다.
- DB `model_registry`를 읽고 미설치·비활성 엔진은 건너뛴다. 모델 상태에는 `unavailable/cold/loading/ready/failed`, 설치 버전, 로딩 시작·소요·예상 시간을 제공한다. 예상값은 최근 성공 기록 `v_model_load_estimate`를 우선하며 없으면 설정의 힌트를 쓴다. 시작 시 `model_load_event`에 로딩 결과를 남긴다.
- non-root, 읽기 전용 루트·엔진·음원, 권한 제거를 유지한다. 영속 저장을 위한 `/storage`만 추가로 쓰며, 엔진·MIDI 작업자에는 DB 비밀번호·서버 키를 넘기지 않는다. 다른 담당 서비스와 `proto_type/`은 수정하지 않는다.

### 검증·재현

2026-11-02 Linux/amd64·Debian 12·Python 3.11 컨테이너에서 테스트 **104개**와 Ruff 검사를 통과했다. #24·#28 회귀, 실제 이미지 색·방향 처리, 인증, 여러 쪽·부분 실패, 엔진 누락, 기한, 웹 파일 경계, 작업자 시작 중 취소·종료를 포함하며 건너뛴 테스트는 없다. Starlette TestClient의 httpx 사용 중단 예고 경고 1건은 남아 있다.

```powershell
# 서비스 폴더, Linux Python 3.11
uv sync --frozen
uv run ruff check app tests
uv run pytest -q
# 엔진 설치 진단 (서버에 모델을 중복 로딩하지 않는 probe 전용)
python -m app.engines.selftest
```

`tests/container_recognition_smoke.py`는 `klassic_issue24` 별도 시험 DB에서만 실행한다. 저장소의 공개 `arirang-semachi-staff.png`를 `SAMPLE_BASE64` 자리에 넣어 컨테이너의 `python -`로 전달한다. 시험 키·운영자·요청을 만들고 실제 사진·PDF 인식, MusicXML·MIDI, 쪽별 DB 기록, 대체 파일·기한을 확인한 뒤 시험 자료를 정리한다. 키 원문과 인식 응답 원문은 출력하지 않는다. 실제 파일 결과와 DB를 함께 보며 웹 화면 전체·다중 사용자·별도 Linux 서버 검증은 #49에 남긴다.

실제 Docker 검증 결과: 악보+빈 사진 두 장은 2쪽 중 1쪽을 `trust`로 변환하고 2쪽 실패 안내를 반환했다(`fallback=false`, homr 인식 약 24.1초). DB에는 쪽 2행·엔진 시도 1행·작업 1행·타당성 항목 3행·단계 시간 5행이 남았고 MusicXML/MIDI 파일 위치도 일치했다. 동일 악보 PDF는 약 30.8초에 `fallback=false`·MIDI 생성에 성공했다. API 대체 템플릿 제공, 웹 대체 파일·엔진 호출 없음, 기한 초과 `TIMEOUT`, 키 없음 401, 공개 모델 준비 상태도 확인했다. 시험 자료는 검사 후 정리했다. 시간은 Windows Docker Desktop의 Linux 컨테이너 실측이며 별도 Linux 서버 성능으로 보지 않는다.

## 업로드 검사 — #28

`POST /v1/internal/upload-check`는 backend가 PDF 검사를 맡기는 서비스 키 전용 경로다. multipart 필드는 `file`(여러 파일이면 같은 이름 반복), `score_type`(`staff` 또는 `jeongganbo`)이며 기존 계약을 유지한다. 외부 키는 403, 키 누락·잘못된 키는 401이다. 검사 결과만 반환하며 요청·쪽별 처리·작업 행이나 원본 파일을 만들지 않는다. 인증 호출 기록은 기존 방식으로 DB에 남긴다.

### 검사와 결과

- 기준판의 업로드·PDF 검사 코드를 가져와 앱별 `SHARED_DIR/upload-rules.json`을 사용하도록 분리했다. 다른 앱·호출의 규칙이 섞이지 않게 ContextVar로 적용·해제한다.
- 순서: 파일 개수 → 확장자·실제 파일 형식 → PDF 혼합 여부 → 손상·암호·PDF 쪽 수 → 파일 용량 → 쪽별 사진 크기 → 악보 종류. 여러 문제가 있으면 계약에 맞게 먼저 검사한 사유를 반환한다.
- 사진은 PNG·JPEG·WEBP, PDF는 한 개만 허용한다. 사진 최대 10장 또는 PDF 최대 10쪽, 기본 파일당 20MiB다. MIDI·MusicXML은 이 사용자 업로드 경로에서 거절한다.
- 사진은 짧은 변 300px 미만을 거절한다. 검사 API에서는 확대 사본을 만들지 않는다. 인식 경로에서만 300~649px를 원본 bytes를 유지한 채 1000px PNG 사본으로 만든다. `PageImage.image`에 사본, `short_edge_px`에 원래 크기, `upscaled_short_side_px`에 사본 크기를 남긴다. API 응답 필드는 기존 계약 그대로이며 사본 데이터는 보내지 않는다.
- 검사 API는 PDF를 그림으로 만들지 않고 모든 쪽의 크기를 300dpi 기준으로 계산한다. 인식 단계가 사용할 공통 helper에서는 명시적으로 `render_pdf=True`인 경우만 페이지 렌더링·확대 사본을 생성한다.
- PDFium 호출은 lock으로 직렬화하고 검사는 작업 스레드로 보내 HTTP 이벤트 루프를 막지 않는다. 사용한 UploadFile은 성공·오류 모두 닫는다. 외부 프로세스 실행이나 별도 파일 저장은 없다.
- 성공 응답: `ok`, `kind`, `short_edge_px`, `pdf_page_count`, `page_count`, `pages`(page_no·file_no·source·short_edge_px). 사진 순서를 유지하며, 크기 오류에는 해당 쪽 번호를 포함한다.
- 오류 예: 형식 415 `UPLOAD_UNSUPPORTED_TYPE`, 용량 413 `UPLOAD_TOO_LARGE`, 손상·암호 422 `UPLOAD_CORRUPTED`, 11쪽 422 `UPLOAD_TOO_MANY_PAGES`, 작은 사진 422 `UPLOAD_RESOLUTION_TOO_LOW`, 종류 누락·잘못된 값 422 `UPLOAD_SCORE_TYPE_REQUIRED`. 빈 파일·누락·알 수 없는 폼 필드는 422 `VALIDATION_ERROR`다.

### 검증·기동

73개 테스트가 통과했다(#24의 20개 포함). 공용 `fixtures/upload/expected.json`의 모든 항목을 공통 검사기와 ASGI API에 대조했다. 저장소에 없는 25MiB PNG는 시험 중 메모리에서 생성한다. 쪽 수 10/11, 사진 299/300/649/650px, 원본·사본, 규칙 격리, 서비스 키 전용 접근, 요청 DB 쓰기 없음과 입력 오류를 추가로 확인했다. 정적 검사도 통과했다.

추가 의존성은 Pillow 12.3.0·pypdfium2 5.14.0이며 uv.lock에 고정했다. pytest의 프로젝트 경로를 지정해 `uv run pytest`와 `python -m pytest`에서 같은 앱을 찾도록 했다. 시험 파일은 공유 폴더에서만 읽고 runtime 이미지에는 포함하지 않는다.

```powershell
# 서비스 폴더, Linux Python 3.11
uv sync --frozen
uv run ruff check app tests
uv run pytest -q
```

실제 컨테이너 검사는 `tests/container_upload_smoke.py`로 수행한다. #24에서 사용한 격리 프로젝트 `klassic-api-issue24`와 DB `klassic_issue24`를 재사용하며 운영 DB에서는 실행을 거부한다. 시험용 키를 생성해 HTTP를 호출하고, `score_request`·`request_page`·`processing_job`·`engine_attempt`·`validity_check_item` 행 수가 바뀌지 않는지 확인한 뒤 시험 키·운영자·관련 호출 기록을 정리한다.

```powershell
# 서비스 폴더에서 별도 시험 env 파일 경로 지정
Get-Content -Raw tests/container_upload_smoke.py | docker compose --env-file <시험 env 절대 경로> -f ../../compose.yaml -p klassic-api-issue24 exec -T model-api python -
```

2026-11-02 실제 검증도 통과했다. Windows Docker Desktop 위의 **Linux/amd64·Debian GNU/Linux 12(bookworm)·Python 3.11.18 컨테이너**에서 실행했으며 별도 Linux 서버에서의 검증은 아직 수행하지 않았다. `klassic/model-api:issue28-local` 빌드·재생성 후 DB·model-api healthy, migrate 종료 코드 0을 확인했다. 직접 HTTP 검사 10건에서 정상 사진·작은 사진·2쪽 PDF 200, 키 없음 401, 형식 415, 용량 413, 손상 PDF·11쪽·작은 사진·종류 누락 422를 확인했다. 요청·쪽·작업·엔진 시도·타당성 테이블의 행 수는 모두 유지됐고 시험 키·운영자·관련 기록을 정리했다. 공통 오류 70개 검사와 `git diff --check`도 통과했다. 로컬 이미지 ID는 `sha256:c89b25cf470a2274712647539735fcc66bdbe5919fbfcd22653d7f7b24b19543`, 크기 584,048,953 bytes이며 registry 게시 digest가 아니다.

#24 PR #79가 아직 병합되지 않은 시점에 #24 커밋을 포함한 `feat/28-upload-check-yeeun`에서 시작했으며 제출 전 최신 main과 선행 PR 병합 상태를 다시 확인한다. 이번 검증은 검사기·API·실제 DB/HTTP까지이며 웹 화면 전체 흐름은 #49에서 확인한다. 인식 API·쪽별 DB 결과 기록은 #29·#30, 전체 한도·시간 상한은 #33에서 이어진다.

## 기반 서비스 — #24

Python 3.11·FastAPI 기반의 설정·로그·MariaDB 연결·API 키 인증과 준비 상태를 구성한다.
업로드 검사·인식·렌더링·외부 연주 API 전체 구현은 #28~#33에서 이어진다.

### 구조와 경계

- Nginx가 외부 `/api/v1/*`에서 `/api`를 제거해 `model-api:9543/v1/*`로 전달한다. backend는 내부 서비스 DNS로 호출한다. 서버는 `0.0.0.0:9543`, Uvicorn `--root-path /api`로 실행한다. model-api는 호스트 포트를 공개하지 않는다.
- `additional_contexts.shared`로 `api/shared`를 최종 이미지의 `/app/shared`에 포함한다. `SHARED_DIR`로 재정의할 수 있고 호스트 shared 마운트는 필요 없다. 세 오류 파일은 분류별로 합치며, 같은 분류의 중복 코드는 기동 실패로 처리한다. 서로 다른 분류에 같은 이름이 있는 기존 코드(예: `ENGINE_DOWN`)는 유지한다.
- DB의 `access_key`에서 SHA-256 해시로 키를 조회하고 `role_permission`으로 권한을 판정한다. 서비스 키도 허용된 유스케이스만 통과한다. 운영 키 발급은 #26에서 수행하며 환경변수에 고정 우회 키를 두지 않는다.
- 기존 `klassic_engines`는 읽기 전용 외부 볼륨으로 소비한다. #25의 별도 검사 도구와 목적이 다르며, #24에서는 새 HTTP 서비스의 실제 기동·재생성을 확인한다. `resources/worker.py`와 두 runner는 기준판에서 가져온 기동 로딩 기반이며, 인식 HTTP 경로와 결과 변환은 #29·#30에서 연결한다. homr runner의 AGPL 표기를 유지한다.
- 기준 DB의 `~/gugak-engines`를 `ENGINES_DIR` 아래로 해석한다. 정간보는 DB의 macOS `mps` 설정을 바꾸지 않고 `JEONGGANBO_DEVICE=cpu`로 실행한다. Audiveris·Ollama는 이번 기동 구현에서 사용 가능으로 표시하지 않는다.
- 11/02 팀 지시에 따라 음원은 `api/shared/soundfonts`를 `/app/shared/soundfonts`에 읽기 전용으로 마운트한다. 이미지에는 공통 오류·업로드 규칙·악기 목록만 복사하고 음원·시험 fixture는 포함하지 않는다. 기준판 파일에 빌드 의존하지 않는다. 호스트에는 Git LFS의 실제 SF2 파일을 준비해야 하며 경로 누락 시 빈 폴더를 자동 생성하지 않는다. backend의 음원 서빙 설정은 변경하지 않는다. 렌더링·필요 음원 선택은 #31에서 이어서 구현한다.
- 서버는 UID/GID 1000, 읽기 전용 루트·엔진 볼륨, `cap_drop: ALL`, `no-new-privileges`로 실행한다. 쓰기는 `/tmp` tmpfs에 제한한다. 엔진 하위 프로세스에는 실행에 필요한 환경변수만 넘기고 DB 비밀번호·서버 API 키는 전달하지 않는다. 별도 데이터 파일 저장은 아직 없으며, 인증 호출 기록은 DB에 남긴다.

### health 계약과 Docker 준비 판정

기존 계약을 유지한다: `/v1/health`는 기동 로딩 중 `503 loading`, 인식 종류 누락 시 `503 unavailable`, DB 정상 시 `200 ok`, 기동 후 DB 단절 시 `200 degraded`다. 공개 응답만으로 사운드폰트·렌더러를 보장하지 않는다.

Docker healthcheck는 `/health`의 `status=ok`·`db=ok`와 **실제 FluidSynth 음원 로딩 완료 표시**를 함께 확인한다. 엔진 작업자가 죽으면 `/health`도 다시 unavailable로 판정한다. 음원 실패 시 공개 계약은 유지하지만 컨테이너는 healthy가 되지 않는다. #24 본문의 "음원 준비 전 503" 요구와 현재 계약의 차이를 이렇게 분리했으며, 공개 계약 강화는 별도 계약 변경·리뷰가 필요하다.

`/v1/versions`에는 DB 등록 모델의 실제 설치·상태와 활성 대체 템플릿의 버전, 기준 규칙표 해시를 반환한다. renderer 버전·처리 큐는 #31 및 후속 작업에서 연결하며 현재 큐 값은 0이다.

### 설정과 기동

설정 키는 [.env.example](.env.example)에 있다. 전체 Compose는 `api/.env`를 읽으므로 서비스 폴더의 예시를 자동 적용하지 않는다. 기존 `.env`를 덮어쓰지 말고 필요한 항목만 반영한다.

| 키 | 기본값 / 용도 |
|---|---|
| `DB_HOST` · `DB_PORT` | `db` · `3306`, Compose 내부 DNS |
| `DB_NAME` · `DB_USER` · `DB_PASSWORD` | 전체 Compose에서 필수, 실행 시 주입 |
| `DB_CONNECT_ATTEMPTS` · `DB_RETRY_SECONDS` | 5회·2초, 소진 시 시작 실패 |
| `SHARED_DIR` | `/app/shared` |
| `ENGINES_DIR` · `ENGINES_VOLUME_NAME` | `/opt/gugak-engines` · `klassic_engines` (기존 venv 절대 경로 유지) |
| `SOUNDFONTS_DIR` | `/app/shared/soundfonts` |
| `JEONGGANBO_DEVICE` | `cpu` (현재 검증 범위) |
| `MODEL_LOAD_TIMEOUT_SECONDS` | 엔진별 120초, 최대 600초 |
| `MODEL_API_IMAGE` | 기본 후보 `klassic/model-api:0.2.2`. 기존 0.2.0·0.2.1 및 검증한 이전 이미지는 되돌리기용으로 보존 |

아래는 `api/`에서 실행한다. 새 프로젝트를 쓴다면 DB 초기화 대상·볼륨을 먼저 확인한다.

```powershell
docker compose config --quiet
docker compose build model-api
docker compose up -d --wait --wait-timeout 300 model-api
docker compose ps -a
docker compose exec -T model-api python -m app.healthcheck
docker compose exec -T model-api id
docker compose logs --tail 50 model-api
```

DB healthy와 migrate 종료 코드 0을 기다린 뒤 HTTP 서버가 시작된다. 로그는 stdout에 요청 ID·가린 경로·상태·구간별 소요 시간을 남긴다. 키·본문·쿼리·서명 파일 토큰·예외 원문은 기록하지 않는다. 응답의 `X-Request-ID`로 요청 로그를 찾는다. 모든 API 오류는 `error`·`api_version` 형식이며, 미선언 폼 필드도 공통 422로 거절한다.

### 시험 방법

Linux Python 3.11 환경에서 서비스 폴더에 진입해 실행한다. `uv==0.11.1`로 생성한 lock을 사용한다.

```powershell
uv sync --frozen
uv run ruff check app tests
uv run pytest -q
```

분리된 시험 DB 이름을 `klassic_issue24`로 지정한 경우에만 다음 실제 인증 검사를 수행할 수 있다. 임시 비활성 운영자·서비스/외부 키를 생성해 확인 후 정리한다. 키 원문은 출력하지 않는다. 일반 운영 DB에서는 실행을 거부한다.

```powershell
# 서비스 폴더에서, 프로젝트·env 파일은 자신의 별도 시험 환경을 지정
Get-Content -Raw tests/container_smoke.py | docker compose -f ../../compose.yaml -p klassic-api-issue24 exec -T model-api python -
```

### 장애·정지·롤백

| 증상 | 근거와 조치 |
|---|---|
| 시작 실패 | `logs`에서 `db_connect_failed`·설정 오류 확인. 비밀값을 출력하지 말고 DB DNS·설정·마이그레이션 상태 확인 후 재생성 |
| `503 loading` 지속 | 모델별 `duration_ms`·`engine_failed`·로딩 제한 확인. 기존 엔진 볼륨 경로·amd64·Python 런타임 호환성을 점검 |
| `503 unavailable` | DB enabled 모델과 실제 설치·작업자 상태 확인. Audiveris·Ollama 설치를 성공으로 간주하지 않음 |
| HTTP 200인데 unhealthy | DB degraded 여부와 `soundfonts_failed`·실제 SF2/LFS 파일 확인. 공개 health와 Docker 준비 기준의 차이 |
| 내부 경로 401/403 | 키 해시·활성 상태·종류·권한표 확인. 서비스 키로 권한을 우회하지 않음 |

정지는 `docker compose stop model-api`로 한다. 엔진·DB 볼륨은 보존하며 `down -v`·prune은 실행하지 않는다. 롤백은 이전 `MODEL_API_IMAGE` 태그/digest를 선택해 `up -d --no-build model-api` 후 준비·인증을 재검사한다. 이번 이미지는 로컬 검증용이며 Docker Hub 게시·배포 완료를 의미하지 않는다.

### 검증 기록

**11/02 검증:** 최신 main `f7bbcce`와 병합된 #25 도구를 보존해 통합했다. 팀장 지시대로 음원을 읽기 전용 마운트로 변경한 최종 이미지를 다시 빌드·기동했다. 아래 10/30 기록과 구분한다.

- 최신 shared 기준 단위·ASGI·자원 시험 20개, 정적 검사, 공통 오류 70개 검사를 재통과했다. 공개 health 계약과 AUTH_KEY_REVOKED 응답 코드는 변경하지 않았다.
- 전체 Compose tools 프로필 설정 검사 통과. HTTP 서비스와 #25 검사 도구가 같은 읽기 전용 엔진 볼륨을 사용하고, 음원 bind 마운트도 RW=false임을 실제 컨테이너에서 확인했다. 공통 설정은 이미지에서 읽고 시험 fixture는 이미지에서 제외했다.
- 새 음원 마운트 구성으로 컨테이너 재생성 후 DB·model-api healthy, migrate 종료 코드 0 확인. 일반 사용자 1000:1000·읽기 전용 루트·cap_drop ALL·no-new-privileges·호스트 포트 없음도 확인했다.
- `tests/service_key_tools.ps1`로 #26의 실제 `createOperator.js`·`issueServiceKey.js`를 별도 시험 DB에서 실행했다. 첫 키 200 → 재발급 새 키 200 → 이전 키 403 AUTH_KEY_REVOKED를 확인하고 시험 운영자·계정·키·관련 이력·호출 기록을 정리했다. 키 원문은 출력하거나 파일에 저장하지 않았다.
- **확인 완료 — 폐기 키 403:** 2026-11-02 승인된 기준에 따라, 재발급으로 폐기된 이전 키는 403 `AUTH_KEY_REVOKED`를 반환한다. #24의 이전 댓글에 적힌 401 대신 확정된 403 기준으로 실제 도구 연동 검사를 통과했다. 키 누락·잘못된 키의 401 응답은 유지한다.
- 검사 재현: 서비스 폴더에서 `./tests/service_key_tools.ps1 -EnvFile <별도 시험 env 파일의 절대 경로>`. `klassic-api-issue24` 프로젝트·`klassic_issue24` DB 및 기존 활성 서비스 키가 없는 경우에만 실행한다. backend 이미지는 먼저 `docker compose build web`으로 준비한다.
- 최종 로컬 이미지 ID는 `sha256:50b55feb4fdedbe1ecdd37045c91bb184e96811dfb7006c690ef8c3dde6491f1`, 크기 544,351,623 bytes다. Docker Client/Server 29.9.1에서 검증했으며 registry 게시 digest가 아니다.

- 2026-10-30: 최신 main `ff815fe` 기반 `feat/24-model-api-yeeun`에서 수행. 기존 main worktree를 재사용했으며 폴더명과 브랜치명은 다르다.
- 새 `klassic-api-issue24` 프로젝트와 별도 DB 볼륨에서 마이그레이션 종료 코드 0, model-api healthy 확인.
- 첫 기동 로그: 정간보 21.019초·homr 15.244초·음원 8.748초. 로딩 중 HTTP 503, 완료 후 200 확인. 이 시간은 현재 PC의 한 번의 관측값이며 자원 상한의 근거로 일반화하지 않는다.
- 단위·ASGI·자원 장애 시험 20개 통과, `ruff check app tests` 통과. TestClient의 httpx 사용에 관한 라이브러리 폐기 예정 경고 1개가 남으며 시험 실패·생략은 없다.
- 최종 이미지를 다시 빌드하고 HTTP 컨테이너 재생성 후 healthy, 별도 DB 마이그레이션 재실행 종료 코드 0 확인.
- 실제 DB·HTTP 인증: 키 없음/잘못된 키 401, 서비스 키 설정 갱신 200, 외부 키 내부 경로 접근 403. 임시 키·운영자 행 정리 완료.
- 컨테이너 실제 설정: UID/GID 1000:1000, 루트 read-only, cap_drop ALL, no-new-privileges, 호스트 포트 바인딩 없음, `klassic_engines` RW=false. shared 호스트 마운트 없이 오류 항목 51·7·12개 로딩 확인. 최종 이미지에 `.env`·pytest 실행 파일 없음 확인.
- 최종 이미지 ID `sha256:40c620c5d186da8f19ae952ea6c866ee60e204c2c92acbdcb23a9ceb42c3a612` (Linux/amd64, 검증 시 867,747,766 bytes). 이는 로컬 이미지 ID이며 배포 registry digest가 아니다. 두 모델·음원을 유지한 정상 대기 메모리 관측값은 958.3MiB다. 최대 사용량은 측정하지 않아 메모리 상한은 아직 지정하지 않았다.
- 엔진 환경변수 제한 보강 후 이미지를 재생성하고 healthy·실제 DB 인증을 재확인했다. 최종 Compose 설정 검사·`git diff --check`·`python api/shared/check_errors.py`(70개) 통과. Docker Hub 게시, 실제 사진 인식·MP3/PDF 출력·외부 연주·처리 한도 시험은 이번 범위에서 수행하지 않았다.


악보 인식(오선보 · 정간보) · MP3/PDF 렌더링 · 국악기 추천 · 외부 API(`/api/v1`, API 키).

- 참고 코드: `proto_type/src/app/model-api` (Python 3.11 · FastAPI · uv, 약 8,800줄 · 테스트 36개 파일)
- 엔진 설치 참고: `proto_type/src/app/ops/engines` · `proto_type/docker/engines-installer.Dockerfile`
- 계약: [../../contracts/model-api.yaml](../../contracts/model-api.yaml)

## 재구성 시 바꿀 점

- 수신 주소 `0.0.0.0`, 경로(엔진 · 모델 · 음원 · 저장소)는 환경변수로 주입
- `/health` 공개 계약과 Docker의 엔진·사운드폰트 준비 판정은 위 #24 절처럼 분리한다
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

`compose.yaml`의 `x-engine-runtime`은 환경변수·아키텍처·엔진 마운트의 공통 정의다. `engine-selftest`와 #24의 HTTP용 `model-api`가 같은 정의를 사용한다. YAML anchor는 같은 파일에서만 사용할 수 있다. 서비스에서 `environment`나 `volumes`를 새로 선언하면 해당 매핑/목록은 덮어써지므로 환경 매핑은 `<<: *engine-environment`, 엔진 마운트는 `- *engine-volume`을 명시적으로 포함한다.

#25 수행 당시에는 새 HTTP 서비스·Dockerfile이 없었다. #25 기록은 기존 이미지의 엔진 어댑터를 사용한 **엔진 소비·영속성 검사**이며, #24에서 추가한 HTTP 서비스·인증·DB·준비 판정 결과와 구분한다. 엔진 공통 구현과 실제 사진 인식은 #29·#30에서 검증한다. 검사 도구에는 기존 이미지의 API healthcheck를 적용하지 않는다.

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
| 발표 포함 — 담당 작업 기준 결정 | **인식 엔진 homr·정간보 2종**, Verovio PDF + FluidSynth/LAME MP3 | 현재 amd64 컨테이너에서 실인식·출력 성공. 발표 전 같은 입력으로 다시 확인 |
| 배포 후속 우선 | 정간보 CPU 전용 의존성 → 엔진 포함 이미지 → 빈 환경 검증 → 버전 태그 게시 | 이슈 #7의 조사 다음 단계. 새 설치 및 이미지 제작·게시 작업은 별도 구현 범위 |
| P3 — 발표 제외 | Audiveris Linux 통합 | **11/5 발표 기본 엔진에서 제외한다.** Linux 배포물은 있으나 설치기·어댑터 전환, headless 인식, 기존 엔진 실패 시 전환, 출력 형식·timeout·메모리 검증이 남음. 현재 어댑터의 Java 선택지는 `-Xmx4G`여서 전체 Docker 메모리 약 3.83GiB 환경과도 함께 조정 필요 |
| P3 — 발표 제외 | 국악기 추천(rules · Ollama) `/v1/recommend` | 2026-11-02 화면 추천을 빼면서 #88 · #89 를 P3 로 내렸다. 지금 `recommend` 요청은 기본 구성 + `recommend_failed=true` |
| 선택/후순위 | MuseScore 출력 · ARM64 이미지 | 발표 기본 흐름에 필요하지 않음. 각각 별도 리소스·호환성 검증 필요 |

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
