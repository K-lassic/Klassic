# deploy (담당: 팀장 @majoongcheon)

DB · Nginx 경로 나누기(`nginx/`) · 외부 공개 · 운영 설정.

## 외부 공개 — Tailscale Funnel

```
인터넷 ──HTTPS──▶ Tailscale Funnel (klassic.tailafa5c2.ts.net)
                     └─▶ 127.0.0.1:9603 Nginx(frontend 이미지) ─┬─ /api/v1/*      ─▶ model-api
                                                               ├─ /api/* · /soundfonts/* ─▶ backend(web)
                                                               └─ 그 밖           ─▶ 화면 정적 파일
관리자 ──▶ 127.0.0.1:26201 Nginx 관리자 server ─┬─ /admin/* ─▶ backend(admin)       (외부 비공개)
                                               └─ admin.html
```

- 입구는 **Nginx 하나**다 (2026-10-30 2안 확정 — Node gateway 없음). 경로 나누기는 `deploy/nginx/proxy.conf`(사용자 server) · `deploy/nginx/admin/admin.conf`(관리자 server, 팀장), 화면 서빙은 `services/frontend/nginx/default.conf`(황송해) → [api/README.md](../README.md) 「Nginx 설정 나누기」

### Nginx 경로 시험 결과 (#22, 2026-10-30)

#21 의 `default.conf` + 같은 이미지(`nginx-unprivileged:1.28.0` · 읽기 전용 · `/tmp` tmpfs)에, web · model-api · admin 자리에 받은 경로 · 머리글을 돌려주는 가짜 서버를 붙여 시험했다.

| 확인 | 결과 |
|---|---|
| 백엔드 · model-api 가 **없어도** Nginx 기동 · 화면 200 | ✅ 그 경로만 502 `WEB_UNAVAILABLE` JSON |
| `/api/*` · `/soundfonts/*` → web (쿼리 유지) | ✅ |
| `/api/v1` · `/api/v1/*` → model-api, 앞의 `/api` 를 떼고 `/v1/...` | ✅ |
| `/api/v1/internal*` · 사용자 쪽 `/admin/*` · `/admin.html` | ✅ 404 |
| 관리자 server `/admin/*` → admin · `/api/*` 는 404 | ✅ |
| 실제 접속 주소 — `X-Forwarded-For` 를 믿을 대역에서만 받고 하나만 넘김 (앞에 가짜 주소를 붙여도 무시) · `X-Forwarded-Proto: https` 전달 | ✅ |
| 25MB 업로드 통과 · 215MB 는 413 `UPLOAD_TOO_LARGE` JSON (상한 210m) · Nginx 메모리 5.6MB(업로드를 쌓아 두지 않음) | ✅ |
| web 을 끄면 `/api/*` 만 502, `/api/v1/*` 는 그대로 | ✅ |

남은 확인: 실제 model-api 로 `/api/v1/*` 다시 (#24 뒤). 실제 web · Funnel 외부 주소는 확인함 (#47 · #48).

### `/demo` 연결 (#93, 2026-11-03)

외부 API 예시 홈페이지(`demo` 프로필, PR #131)를 사용자 server 의 `/demo/` 에 붙였다. 접두사를 떼지 않고 `demo:26102` 로 넘긴다. 실제 `frontend:dev` 이미지(읽기 전용 · `/tmp` tmpfs)에 받은 경로를 돌려주는 가짜 `demo` 서버를 붙여 시험했다.

| 확인 | 결과 |
|---|---|
| demo 가 **없어도** Nginx 기동 · 화면 200 | ✅ `/demo/` 만 503 안내 화면(HTML) |
| `/demo` → `/demo/` | ✅ 301, `Location: /demo/` (상대 주소 — Funnel 뒤에서 내부 포트로 튀지 않음) |
| `/demo/` · `/demo/api/bgm?share=3&inst=gayageum` · `/demo/app.js` | ✅ 접두사 · 쿼리 그대로, `X-Forwarded-Proto: https` 전달 |
| 25MiB 응답(MP3 상한 20MiB) | ✅ 끝까지 받음, 임시 파일 오류 없음 |
| demo 가 스스로 보낸 502 | ✅ 안내 화면으로 바꾸지 않고 그대로 전달 |
| `/demox` | ✅ demo 로 가지 않음 (화면) |
| demo 를 끄면 | ✅ 10초 안에 다시 503 안내 화면 |

켜기 · 끄기는 PR #131 병합 뒤 `api/` 에서 `docker compose --profile demo up -d demo` · `docker compose stop demo`. Nginx 는 다시 띄우지 않아도 된다. 남은 확인: 실제 demo 서버 · 외부 키 · Funnel 브라우저 재생 (#49).

- 도메인 없이 `*.ts.net` 주소와 HTTPS 인증서를 받는다. 공유기 포트를 열지 않는다.
- **Tailscale 은 Windows 앱(서비스)으로 돌린다** (#9 결정). 컨테이너로 돌리지 않으므로 인증 키(`TS_AUTHKEY`)가 필요 없다 — 로그인은 앱에서 사람이 한다.
- 켜기 · 끄기는 [funnel.ps1](funnel.ps1). 공개하는 포트는 입구 하나(proto_type 9503 또는 api/ 9603)이고, 관리자 · 내부 포트(26101 · 26201 · 9523 · 9543 · 3306)는 스크립트가 거부한다.
- Funnel 은 대역폭 제한이 있으므로 시연 · 소규모 사용 기준으로 본다.

### 켜기 · 끄기 (#9)

```powershell
pwsh api/deploy/funnel.ps1 status             # 로그인 상태 · 공개 주소
pwsh api/deploy/funnel.ps1 start              # 재구성: api/ 입구(9603) 공개 — 기본값 (#139)
pwsh api/deploy/funnel.ps1 start -Port 9503   # 예비 시연: proto_type gateway(9503) 공개 (proto_type 이 있을 때만)
pwsh api/deploy/funnel.ps1 stop               # 공개 끄기
```

### api/ 로 전환 · 되돌리기 (#48)

전환은 **사람이 실행한다.** 외부 공개를 바꾸는 명령이라 Claude 는 실행하지 않는다.

```powershell
# 0. 되돌릴 곳 살리기 — 9503 이 응답하지 않으면 (재부팅 뒤 네트워크 분리)
cd proto_type; docker compose up -d --force-recreate web gateway admin model-api; cd ..

# 1. 공개 금지 포트가 거부되는지 (빨간 오류가 나와야 정상)
pwsh api/deploy/funnel.ps1 start -Port 26201

# 2. api/ 로 전환 → 외부 점검
pwsh api/deploy/funnel.ps1 start -Port 9603
pwsh api/deploy/check-public.ps1

# 3. 되돌리기 · 다시 전환 — 시간을 잰다 (완료 기준 1분 안)
pwsh api/deploy/funnel.ps1 start -Port 9503
pwsh api/deploy/funnel.ps1 start -Port 9603

# 4. 평소에는 끈다
pwsh api/deploy/funnel.ps1 stop
```

- [check-public.ps1](check-public.ps1) 은 화면 · 상태 · 음원 · 로그인 필요 경로 · 내부 API · 관리자 · 예시 원본 · 쿠키 속성을 본다. 계정을 만들지 않고 값은 출력하지 않는다.
- model-api 가 없으면 `/api/v1/health` 줄만 실패한다 (502).
- 서버 PC 와 다른 네트워크(휴대폰 LTE · 다른 집 PC)에서 화면이 열리는지는 사람이 본다.

### #48 시험 결과 — api/ 외부 공개 (2026-11-01)

공개 주소 **https://klassic.tailafa5c2.ts.net** → 127.0.0.1:9603 (Nginx). 시험 뒤 공개를 끈다.

| 확인 | 결과 |
|---|---|
| 공개 금지 포트 26201 | ✅ `funnel.ps1` 이 거부 |
| 인터넷 경로로 화면 · `/api/health` · 음원 | ✅ 200 |
| 방문자의 `/api/instruments` | ✅ 401 |
| 내부 API · 관리자 API · 관리자 화면 | ✅ 404 |
| 예시 원본 | ✅ 나오지 않음 |
| 세션 쿠키 HttpOnly · SameSite=Lax · **Secure** | ✅ 외부 HTTPS 에서 확인 (#37) |
| 다른 네트워크의 PC 에서 화면 접속 | ✅ 사용자 확인 |
| 9603 → 9503 → 9603 전환 | ✅ 두 명령을 이어서 실행해 바로 끝남 (초 단위 계측은 안 함) |
| `/api/v1/health` | ⏳ 502 — model-api(#24) 뒤 다시 확인 (#22 · #49) |

### 처음 한 번 (서버 PC)

1. `winget install --id Tailscale.Tailscale -e` → 작업 표시줄 Tailscale 앱에서 로그인
2. 처음 `start` 할 때 Funnel 허용 안내 주소가 나오면 브라우저에서 허용한다 (tailnet 관리 화면)
3. Tailscale 앱 설정에서 **Windows 시작 시 실행**을 켠다 (재부팅 뒤 자동 공개)

### #9 시험 결과 — v0.1.1(proto_type) 공개 (2026-10-30)

공개 주소 **https://klassic.tailafa5c2.ts.net** → 127.0.0.1:9503 (proto_type gateway)

| 확인 | 결과 |
|---|---|
| 인터넷 경로(공용 DNS → Tailscale 중계 103.84.155.153)로 화면 · `/api/health` · `/api/v1/health` | ✅ 200 (응답 약 2~3초, 첫 화면은 처음 한 번 더 걸림) |
| 관리자 API 외부 접속 | ✅ 불가 — 26101 은 공개하지 않음, `/admin/*` 경로는 사용자 화면 HTML 이 응답(관리자 API 아님), `/admin.html` 404 |
| 내부 API `/api/v1/internal/*` | ✅ gateway 가 404 로 막음 |
| HTTPS · 세션 쿠키 | ✅ Funnel 이 HTTPS 를 맡음 — v0.1.1 쿠키(`secure:false`)도 HTTPS 에서 그대로 동작 |
| **실제 접속 주소** | ⚠️ → ✅ 아래 문제 1 |
| 휴대폰(LTE)에서 화면 접속 · 로그인 → 올리기 → 결과 → 내려받기 | ✅ 사용자 확인 (2026-10-30) |
| 외부 API 키로 `/api/v1` 호출 | ⏳ 키 신청 화면에서 받은 키로 확인 (model-api 외부 API 이슈에서 함께) |

**문제 1 — 외부 사용자 전원이 같은 주소로 보임 (해결)**

- 증상: 백엔드가 모든 외부 요청을 `172.30.0.1`(Docker 네트워크 게이트웨이)에서 온 것으로 기록 → 접속 주소별 한도(G12 처리 중 1건 · 가입 시간당 5건)를 **외부 사용자 전원이 나눠 씀**.
- 근거: 실패 로그인의 `gate_event.subject_ref`(주소 해시)를 후보 주소 해시와 대조 → `172.30.0.1` 과 일치.
- 원인: Docker Desktop 포트 전달로 들어온 연결의 출발 주소가 `172.30.0.1` 이고, gateway 는 `GATEWAY_TRUSTED_PROXIES`(기본 `127.0.0.1,::1,192.168.0.19`)에서 온 요청의 `X-Forwarded-For` 만 믿는다.
- 조치(코드 수정 없음): proto_type `.env` 에 `GATEWAY_TRUSTED_PROXIES=127.0.0.1,::1,172.30.0.1` → `docker compose up -d --force-recreate gateway` → 다시 대조하니 실제 공인 IP 와 일치.
  호스트 포트를 `127.0.0.1` 에만 공개하므로 `172.30.0.1` 로 들어오는 것은 이 PC 안(Tailscale · 로컬 브라우저)뿐이다.
- **재구성(api/) 반영**: Nginx `set_real_ip_from`(#22) · backend 신뢰 프록시(#37) 를 설정값으로 두고 compose 네트워크 게이트웨이 주소를 넣는다.

**문제 2 — 로그아웃하면 공개가 끊김 (해결, 2026-11-01)**

- Tailscale 서비스는 자동 시작(Automatic)이지만 **"Run unattended"** 가 꺼져 있으면 Windows 사용자가 로그아웃할 때 연결이 끊긴다.
- 조치: 작업 표시줄 Tailscale 아이콘 → Preferences → **Run unattended** 켜기 (#47). 재부팅 시험은 하지 않았다 — 발표는 켜 둔 채 진행한다.

### 예비 시연 ↔ 재구성 전환

- proto_type(v0.1.1)은 9503 · 26101 을 쓴다. `api/` 는 **9603 · 26201**(`API_PUBLIC_PORT` · `API_ADMIN_PORT`)로 띄워서 둘이 같이 떠 있게 한다 (#20).
- 발표에 쓸 쪽을 정하면 `start -Port <포트>` 로 Funnel 이 가리키는 곳만 바꾼다. 컨테이너는 끄지 않는다.

## 엔진 자가 검사 — 재구성 이미지 사용 (#142)

구조에서의 위치: 운영자의 `tools` 명령 → api model-api 이미지 → 읽기 전용 엔진 볼륨.
필요한 것은 `api/`에서 빌드한 model-api 이미지와 설치 완료된 엔진 볼륨이다.
`ENGINE_CHECK_IMAGE`가 비어 있으면 `MODEL_API_IMAGE`를 사용하고, 둘 다 없으면
`klassic/model-api:0.2.2`를 선택한다. 기준판 이미지나 실행 중인 DB·서비스 키는 검사에 필요하지 않다.

`api/`에서 Git Bash/Linux 셸로 실행한다. 임시 프로젝트·임시 볼륨 이름을 명시한다.

```bash
export ENGINES_VOLUME_NAME=klassic_issue138_fresh
docker compose -p klassic-api-issue142 --env-file .env -f compose.yaml build model-api
docker compose -p klassic-api-issue142 --env-file .env -f compose.yaml --profile tools config -q
docker compose -p klassic-api-issue142 --env-file .env -f compose.yaml --profile tools run --rm --no-deps engine-selftest
docker compose -p klassic-api-issue142 --env-file .env -f compose.yaml down
unset ENGINES_VOLUME_NAME
```

Compose 전체를 해석하기 위한 로컬 `.env`는 필요하지만, 검사 컨테이너에는 DB 비밀번호·키를 전달하지 않는다.
네트워크는 차단하고 엔진·루트 파일시스템은 읽기 전용이며, 임시 파일만 `/tmp`에 기록한다.
마지막 JSON의 `ok=true`, 각 엔진의 `ok=true`, 종료 코드 0을 확인한다.
`ENGINE_CHECK_IMAGE`에 별도 태그를 지정하려면 해당 재구성 이미지가 로컬에 먼저 있어야 한다.
기존 `klassic/klassic-model-api:0.1.1` 이미지는 아래 예비 시연·롤백용으로 보존하며 삭제하지 않는다 (#145).

2026-11-03 임시 프로젝트 `klassic-api-issue142`에서 `api/`로 빌드한 model-api 이미지와
임시 엔진 볼륨 `klassic_issue138_fresh`로 확인했다. homr 약 3.5초, 정간보 약 14.6초,
전체 약 18.1초에 모두 `ok=true`, 종료 코드 0이었다. UID 1000·읽기 전용 엔진 마운트를 확인했고,
검사 이미지 명시 → 서비스 이미지 → 기본 이미지 순서의 설정 선택도 확인했다.
전체 Compose를 `up -d --build --wait`로 실행해 상시 서비스 healthy와 브라우저 API활용 화면 표시를
확인한 뒤 같은 프로젝트·환경 파일로 `down`했다. 잔여 컨테이너는 없고 엔진·DB 볼륨과 롤백 이미지는 보존했다.

## model-api 대역 (#49)

재구성 model-api(#24 · #28~#31)가 발표까지 갖춰지지 않을 때를 대비해, **v0.1.1 이미지를 `model-api` 이름으로 `api/` 에 붙인다.** 코드는 고치지 않는다. 파일은 [compose.standin.yaml](compose.standin.yaml) · [model-standin.env](model-standin.env)(키 이름만) 두 개다.

```
web ──┐
      ├─▶ model-api:9543 (klassic/klassic-model-api:0.1.1) ─▶ db · 엔진 볼륨 klassic_engines(읽기 전용)
Nginx ┘
```

대역을 선택할 때만 필요한 것: 이미지 `klassic/klassic-model-api:0.1.1` · 볼륨 `klassic_engines` · `api/.env` 의 `SERVICE_API_KEY`.
위 #142의 재구성 엔진 자가 검사에는 이 이미지가 필요하지 않다. proto_type 컨테이너는 떠 있지 않아도 된다.

**처음 한 번 — 서비스 키 만들기** (서버 PC · Git Bash · `api/` 폴더)

```bash
cd /c/project/Klassic/api
# 1) 운영자 만들기 — 비밀번호를 두 번 묻는다 (12자 이상, 화면에 안 보임)
docker compose run --rm -it web node dist/tools/createOperator.js --login <아이디> --name <이름>
# 2) 서비스 키를 발급해 .env 에 넣는다 — 화면에 키가 나오지 않는다
KEY=$(docker compose run --rm -T web node dist/tools/issueServiceKey.js --operator <아이디> 2>/dev/null | tail -1)
sed -i '/^SERVICE_API_KEY=/d' .env; printf '\nSERVICE_API_KEY=%s\n' "$KEY" >> .env; unset KEY
grep -c '^SERVICE_API_KEY=gk_' .env   # 1 이 나오면 정상
```

**대역을 기본으로 되돌릴 때만 (서버 PC, #86)** — 2026-11-03 부터 기본은 재구성판이고 이 두 줄은 지웠다. `api/.env` 에 두 줄을 더하면 `api/` 폴더에서 `-f` 없이 써도 대역이 유지된다. 비밀값이 아니다.

```bash
cd /c/project/Klassic/api
printf '\nCOMPOSE_PATH_SEPARATOR=:\nCOMPOSE_FILE=compose.yaml:deploy/compose.standin.yaml\n' >> .env
docker compose config --services    # 목록에 model-api 가 있고
docker compose config | grep 'image: klassic/klassic-model-api'    # 이 줄이 나오면 정상
```

**켜기 · 확인 · 끄기**

```bash
cd /c/project/Klassic/api
docker compose up -d --wait                                     # model-api 가 Healthy
pwsh deploy/check-public.ps1 -Url http://127.0.0.1:9603 -Local  # 모두 통과 (PowerShell 7 필요)
docker compose stop model-api                                   # 끄기
```

- `web` 까지 다시 만들어야 새 서비스 키를 읽는다 — 위 `up -d` 가 함께 처리한다.
- **대역을 쓰려면 `-f compose.yaml -f deploy/compose.standin.yaml` 을 붙인다.** 안 붙이면 재구성판이 뜬다. `COMPOSE_FILE` 은 `api/` 폴더에서만 읽힌다.
- 이 실수는 `check-public.ps1` 의 「인식 · 렌더링 경로」 줄이 잡는다. 재구성판도 `/api/v1/health` 200 · 엔진 `ready` 라서 상태만으로는 알 수 없다.
- 대역은 재구성판 서비스 정의 위에 합쳐진다. 재구성판 값이 섞이지 않게 `!reset` · `!override` 를 쓴다 (Docker Compose 2.24 이상).
- **재구성 model-api 로 교체:** #29 · #30 · #31 이 끝난 뒤 `api/.env` 의 두 줄을 지우고 `docker compose up -d --build model-api`. 서비스 이름 · 포트가 같아 backend · Nginx 는 고칠 것이 없다.

**시험 결과 (2026-11-02, 임시 프로젝트)**

| 확인 | 결과 |
|---|---|
| non-root · 뿌리 읽기 전용 · 엔진 볼륨 읽기 전용 | ✅ |
| 기동 | ✅ 약 20초 뒤 healthy |
| 미뉴에트 오선보 | ✅ homr 31초 · 신뢰 등급 |
| 타령 정간보 PDF 2쪽 | ✅ PDF 검사 통과 · jeongganbo-omr 23초 · 신뢰 등급 |
| 편집 후 MIDI · PDF · MP3 | ✅ MP3 최대 7.3초 · PDF 3.2초 |
| `/api/v1/health` (Nginx 경유) · 공개 점검 | ✅ 모두 통과 |
| 메모리 | 최대 2.24GiB (`mem_limit` 4g) |

추천(LLM) 모델과 audiveris 는 이 구성에서 `unavailable` 이다 — 발표 흐름에는 쓰지 않는다.


## 재구성 model-api 전환 시험 (#87, 2026-11-02)

임시 프로젝트(`-p klassic-api-test`)에서 main 으로 빌드한 재구성판을 띄워 확인했다. **실제 서비스는 아직 대역이다.** 시연 판본은 #49 리허설에서 정한다.

| 시험 | 결과 |
|---|---|
| 공개 점검 · `/api/v1/health` · `/api/v1/internal/*` | 모두 통과 · 200 · 404 |
| 예시 4개 (PNG · JPG · 정간보 PDF) | 모두 실제 인식, 22.9~28.0초 |
| 4형식 내려받기 (예시 2개) | MIDI · MusicXML 0.1초, PDF 3.1~6.2초, MP3 6.1~9.4초 |
| 공용 시험 사진 · 사진 두 장 | 인식 성공, 쪽별 DB 기록 |
| 빈 쪽이 든 PDF | 읽은 쪽만 결과, `PAGES_PARTIAL` 안내 |
| 빈 사진 | 대체 악보 `NO_SCORE_STRUCTURE` |
| 종류 불일치 | 질문 → 그대로면 대체, 바꾸면 다시 인식해 성공 |
| 손상 · 암호 · 낮은 해상도 · 다른 형식 | 422 · 415 반려 |
| 전조 · 악기 변경 내보내기 | 편집과 악기가 파일에 반영됨 |
| 서비스 키 | 폐기 403 `AUTH_KEY_REVOKED` · 틀림 · 없음 401 |
| 대역으로 되돌리기 | **21초** |

- 메모리: 인식 · 렌더링 순차 최대 2.29GiB, 렌더링 6건 요청을 동시에 넣으면 최대 3.35GiB (대기 때 약 0.7GiB). 재구성판에는 아직 `mem_limit` 이 없다. 측정값 + 여유로 4g 를 권장한다.
- 대역과 비교: 예시 4개의 마디 수 · 음표 수 · 음높이 순서가 모두 같다. 인식 시간도 비슷하다 (재구성 22.8~28.0초 · 대역 17.9~25.1초).
- 동시 사용: 웹 인식은 `web_concurrency_share` = 1 이라 한 건씩 처리한다. 3건 67.5초 · 6건 135.5초, 모두 대체 없이 완료. 대기 상한은 쪽당 180초라 한 건 약 22초면 9건째부터 시간 초과로 대체될 수 있다 (추정).
- 같은 접속 주소 한도: 동시 1건 · 시간당 10건 (`web_max_active_per_client` · `web_hourly_request_cap`). 같은 공용 주소를 쓰는 사람들은 이 값을 함께 쓴다. 측정은 주소를 나눠서 했다.
- 2026-11-02 실제 서버에서 재구성판으로 인식 · 편집 · 4형식 · 공유 · 소리를 확인했다. 2026-11-03 main `0303bca` (#122 · #124 포함) 로 재시험해 통과했고 실제 서버 기본으로 올렸다.
- 외부 키 흐름: 접수 → 상태 → 결과 → 파일 2개 성공, 다른 키 404 · 키 없음 401. 렌더링 동시 6건 18.3초. 대역 복귀 14초.
- 재배포 확인: 이미지를 다시 빌드해도 `up -d` 가 web · admin · frontend 를 다시 만들지 않은 일이 두 번 있었다 (원인 미조사). `docker inspect <컨테이너> --format '{{.Image}}'` 를 이미지 Id 와 대조하고, 다르면 `docker compose up -d --force-recreate --no-deps --wait <서비스>`.
- 시험하지 않은 것: 최신 이미지의 브라우저 화면 · 소리, 사진 예시 밖의 품질 비교, 시간당 호출 한도 응답(혼잡 응답이 먼저 나옴), 외부 Funnel.
- 임시 프로젝트 주의: `compose.standin.yaml` 까지 붙여 `down -v` 하면 `model-storage` 볼륨이 남는다. 시험이 끝나면 `-f compose.yaml` 로 지운다.

## v0.2.1 배포 (2026-11-03)

main `45cb4af` (#128 · #130 · #134 포함)로 model-api · web · admin · frontend 를 다시 빌드해 실제 서버에 올렸다. DB 마이그레이션이 없어 백업은 하지 않았다.

- 이미지: `klassic/model-api:0.2.1` · `0.2.1-g45cb4af`, `klassic/backend:dev` · `klassic/frontend:dev`. 네 컨테이너 모두 이미지 Id 일치
- 확인: model-api `version` 0.2.1 · `/v1/health` 200, 입구 `/` · `/api/v1/health` · `/api-docs` 200, 내부 경로 404, 예시 3개(아리랑 세마치 · 미뉴에트 · 타령), model-api `mem_limit` 4GiB (대기 721MiB)
- 시험하지 않은 것: 브라우저 화면 · 인식 · 소리 (실제 DB 에 시험 데이터를 넣지 않으려고 #49 리허설에서 본다)

**되돌리기** (서버 PC · Git Bash · `api/` 폴더) — 이전 이미지는 `model-api:0.2.0` · `backend:before-021` · `frontend:before-021` 에 남겨 두었다.

```bash
docker tag klassic/backend:before-021 klassic/backend:dev
```

```bash
docker tag klassic/frontend:before-021 klassic/frontend:dev
```

```bash
MODEL_API_IMAGE=klassic/model-api:0.2.0 docker compose up -d --force-recreate --no-deps --wait model-api web admin frontend
```

모든 서비스가 Healthy 면 정상이다. 끝나면 이미지 Id 를 대조한다.

## CPU 전용 엔진 볼륨 시험 (2026-11-02)

model-api 는 정간보를 CPU 로만 돌리는데, 고정 목록에 GPU 패키지가 들어 있어 엔진 볼륨이 크다. [build-cpu-engines.sh](build-cpu-engines.sh) 로 GPU 패키지를 뺀 새 볼륨을 만들어 기존 볼륨과 비교했다. `services/model-api/README.md` 「CPU 전용 정간보 환경」 순서를 따랐다.

**시험용이다. 서비스 기본값은 그대로 `klassic_engines` 다.** 발표에는 검증을 마친 기존 볼륨을 쓰고, 채택은 #96 이미지 작업 때 판단한다.

| 항목 | 기존 `klassic_engines` | 새 `klassic_engines_cpu` |
|---|---|---|
| 볼륨 전체 | 6,077,483,140 B | **2,471,021,198 B** |
| 정간보 폴더 | 5,326MB | **1,881MB** |
| torch | 2.0.1+cu117 | 2.0.1+cpu |
| `nvidia` · `triton` | 있음 | 없음 |
| 쪽당 인식 (3장 · 2회씩) | 3.9~4.9초 | 4.0~4.8초 |
| 인식 프로세스 최대 메모리 | 1,891~1,894MiB | 1,807~1,819MiB |
| 모델 불러오기 | 2.8~4.2초 | 6.2~6.3초 |

- 측정 환경: 코드 작업용 PC, Docker 6코어 · 메모리 31GiB, torch 스레드 3개. 서버 PC 측정값이 아니다.
- 패키지 101개, `uv pip check` 통과. homr · 저장소 파일은 기존과 차이가 없다.
- 지금 스크립트로 다시 만들면 2,484,213,201 B 였다. 표의 값과 약 13MB 차이가 나며 원인은 조사하지 않았다.
- 입력 3장(`ok_jeongganbo.png` · 타령 PDF 2쪽): 인식 문자열 · 신뢰도 · 칸 수가 모두 같다.
- 임시 프로젝트 기동: 약 30초 healthy · `models_ready` 3 · 볼륨 읽기 전용.
- 서비스 경로 `/v1/omr/*` 예시 4개: 모두 200 · 실제 엔진 사용 · 대체 없음.
- MusicXML: 오선보 3개는 완전히 같다. 타령 PDF 는 2,866줄 중 파트 ID 2줄만 다르다. 이 값은 music21 이 매번 새로 만들어서 같은 볼륨을 반복해도 달라진다. 빼고 비교하면 4회 모두 같다.
- 모델 불러오기가 늘어난 원인은 조사하지 않았다. 시작할 때 한 번만 든다.
- 시험하지 않은 것: 예시 밖 입력 · 전체 화면 흐름 · MP3 · PDF 내려받기 · 동시 인식 메모리 · 패키지 해시 고정 · 엔진 포함 이미지 크기.

**다시 만들기** (Git Bash · `api/` 폴더) — 이미지 `klassic/klassic-engines-installer:0.1.1` 과 기존 볼륨 `klassic_engines` 가 있어야 한다. 대상 볼륨이 비어 있지 않으면 끝 코드 2 로 멈춘다. 약 1분 뒤 마지막 줄이 `DONE` 이면 정상이다.

```bash
docker volume create klassic_engines_cpu
MSYS_NO_PATHCONV=1 docker run --rm -v klassic_engines:/src:ro -v klassic_engines_cpu:/opt/gugak-engines -v "$(pwd -W)/deploy:/job:ro" klassic/klassic-engines-installer:0.1.1 bash /job/build-cpu-engines.sh
```

**쓰기 · 되돌리기** — 값을 빼고 다시 실행하면 기존 볼륨으로 돌아간다. 대역 구성에서는 쓰지 않는다.

```bash
ENGINES_VOLUME_NAME=klassic_engines_cpu docker compose up -d model-api
docker compose up -d model-api
```

### 서버 PC 전체 흐름 시험 계획 (시간이 남을 때)

**목표:** 서버 PC 에서 CPU 전용 엔진을 다시 만들어 재구성판 전체 흐름을 임시 프로젝트로 돌려 본다. 결과가 좋으면 발표에서 **"업데이트 계획이며, 업데이트 전에 시험해 보았다"** 로 소개한다.

**전제**
- 발표 판본 결정(#49)과 리허설을 먼저 끝낸다. 이 시험은 그 뒤 시간이 남을 때만 하고, 발표 당일에는 하지 않는다.
- 실제 서비스는 건드리지 않는다. 임시 프로젝트로 띄우고 포트는 9703 · 26301 을 쓴다. `klassic_engines` 와 실제 DB · storage 볼륨은 그대로다.
- 서버 PC 의 `api/.env` 에서 `COMPOSE_FILE` 을 지웠지만, 다시 넣었을 때도 대역이 뜨지 않게 `-f compose.yaml` 을 붙인다.
- 시험 중에는 model-api 가 2개 돌아 서버 PC 메모리를 더 쓴다. 실제 서비스를 쓰는 시간과 겹치지 않게 한다.

**실행** (서버 PC · Git Bash · `api/` 폴더) — 코드 작업용 PC 에서 같은 순서로 기동 · 키 발급 · 공개 점검까지 확인했다. 전체 화면 흐름은 아직 해 보지 않았다.

1) `docs/engine-cpu-test` 가 병합된 main 을 받고 준비물을 확인한다. 이미지 한 줄과 볼륨 한 줄이 보여야 한다. 하나라도 없으면 여기서 멈춘다.

```bash
docker images klassic/klassic-engines-installer:0.1.1
docker volume ls --filter name=klassic_engines
```

2) 위 「다시 만들기」로 `klassic_engines_cpu` 를 만든다. 마지막 줄이 `DONE` 이어야 한다.

3) 임시 프로젝트를 띄운다. 모든 서비스가 Healthy 로 끝나야 한다.

```bash
export ENGINES_VOLUME_NAME=klassic_engines_cpu API_PUBLIC_PORT=9703 API_ADMIN_PORT=26301
docker compose -p klassic-cpu-test -f compose.yaml up -d --wait
```

4) 시험 DB 에 운영자와 서비스 키를 만든다. 키는 이 터미널 변수에만 두고 `api/.env` 에 쓰지 않는다. 운영자 비밀번호를 두 번 묻는다. `key ok` 가 나오면 정상이고, `key bad` 면 멈춘다.

```bash
docker compose -p klassic-cpu-test -f compose.yaml run --rm -it web node dist/tools/createOperator.js --login cputest --name cputest
export SERVICE_API_KEY=$(docker compose -p klassic-cpu-test -f compose.yaml run --rm -T web node dist/tools/issueServiceKey.js --operator cputest 2>/dev/null | tail -1 | tr -d '\r')
case "$SERVICE_API_KEY" in gk_*) echo "key ok";; *) echo "key bad";; esac
docker compose -p klassic-cpu-test -f compose.yaml up -d --wait web
```

5) 공개 점검을 돌린다. 모두 통과해야 한다.

```bash
pwsh deploy/check-public.ps1 -Url http://127.0.0.1:9703 -Local
```

6) 브라우저로 `http://127.0.0.1:9703` 에 접속해 확인하고, 인식 중 `docker stats` 로 메모리를 잰다.

| 확인 | 통과 기준 |
|---|---|
| 가입 · 로그인 | 시험 계정으로 들어감 |
| 예시 4개 인식 | 대체 악보 없이 실제 엔진 결과 |
| 사진 · PDF 직접 올리기 | 예시 밖 입력 1개 이상 인식 |
| 편집 · 연주 | 고친 내용이 소리와 저장에 반영됨 |
| 4형식 내려받기 | MP3 · PDF · MIDI · MusicXML 파일이 열림 |
| model-api 메모리 | 최대값 기록 (대역 2.24GiB · 재구성판 2.29GiB 와 비교) |

7) 정리한다. 목록에 `klassic-cpu-test_` 로 시작하는 볼륨만 있는지 보고 지운다. 이름 없는 빈 볼륨이 하나 남을 수 있는데, 사용 중이 아니고 비어 있는지 확인한 뒤 지운다. `klassic_engines_cpu` 는 남긴다.

```bash
docker compose -p klassic-cpu-test -f compose.yaml down
docker volume ls -q | grep '^klassic-cpu-test_'
docker volume ls -q | grep '^klassic-cpu-test_' | xargs docker volume rm
unset ENGINES_VOLUME_NAME API_PUBLIC_PORT API_ADMIN_PORT SERVICE_API_KEY
```

**발표 반영**
- 위 표를 모두 통과하면 업데이트 계획에 넣는다. 예: "정간보 엔진을 CPU 전용으로 바꾸는 업데이트를 계획하고 있고, 업데이트 전에 임시 환경에서 시험했다. 엔진 볼륨은 6.08GB 에서 2.47GB 로 줄었고, 시험한 예시의 인식 결과는 같았다."
- 서버 PC 측정값이 나오면 크기 · 메모리를 그 값으로 바꾼다.
- 실제 서비스는 여전히 기존 엔진으로 돈다고 함께 말한다. 적용을 마친 기능으로 소개하지 않는다.
- 시험을 못 했거나 실패하면 코드 작업용 PC 결과만 말하거나 빼고, 시험하지 못한 항목을 그대로 밝힌다.

## api 코드만으로 엔진 새로 설치 (#138)

구조에서의 위치: 운영자의 `tools` 작업 → model-api의 `installer/` 이미지 → 외부 엔진 볼륨.
설치기는 `/scripts/`에서 실행하며, 서비스 실행 중에는 같은 볼륨을 읽기 전용으로 사용한다.
Audiveris는 이 설치기에 포함하지 않는다 (#102).

### 빈 시험 볼륨에서 먼저 확인

**운영 볼륨 이름을 쓰지 않는다. 설치기는 볼륨 이름 미지정과 `klassic_engines` 지정을 거부한다.**

아래는 `api/`에서 Git Bash 또는 Linux 셸로 실행한다. Docker Compose와 인터넷 연결이 필요하고,
`api/.env.example` 형식으로 작성한 로컬 `.env`가 있어야 한다. 음원은 Git LFS로 실제 파일을 받는다.
**기존 `klassic_engines`에 시험 설치하지 않는다.** 프로젝트 이름만 바꾸어도 외부 엔진 볼륨은 분리되지 않으므로,
`ENGINES_VOLUME_NAME`도 반드시 별도로 지정한다.

```bash
export ENGINES_VOLUME_NAME=klassic_issue138_fresh
docker volume create "$ENGINES_VOLUME_NAME"
docker compose -p klassic-api-issue138 --env-file .env -f compose.yaml --profile tools build engines-installer
docker compose -p klassic-api-issue138 --env-file .env -f compose.yaml --profile tools run --rm --no-deps engines-installer

# 두 엔진을 연결한 서비스와 사이트를 띄운다. 기존 서비스와 포트가 겹치면 먼저 별도로 지정한다.
docker compose -p klassic-api-issue138 --env-file .env -f compose.yaml up -d --build --wait
```

사이트에서 오선보·정간보 예제를 각각 인식하고, 대체 악보가 아닌 실제 결과인지 확인한다.
API 결과 기준은 `route=recognize`, `fallback=false`다. 검증이 끝나면 같은 명령 조건으로 정리한다.
새 DB에는 서비스 키도 기존 「서비스 키 발급」 절차로 등록하고 `.env`의 `SERVICE_API_KEY`와 맞춘다.
이 설치기는 엔진만 설치하며 DB 사용자·서비스 키를 만들지 않는다.
`down -v`는 사용하지 않는다. 시험용 엔진 볼륨도 별도 확인 전에는 보존한다.

```bash
docker compose -p klassic-api-issue138 --env-file .env -f compose.yaml down
unset ENGINES_VOLUME_NAME
```

새 PC의 정식 설치도 같은 순서이며, 검증 후 사용할 **빈** 엔진 볼륨 이름을 명시한다.
기존 설치를 새 버전으로 덮어쓰거나 자동 교체하는 명령은 아니다. 컨테이너 내부 엔진 경로는 기본
`/opt/gugak-engines`를 유지한다. 정간보 Python도 볼륨의 `.uv-python`에 설치하므로,
설치할 때와 실행할 때 이 마운트 경로가 같아야 한다. 설치 결과 `homr/`, `jeongganbo/`는
각 어댑터가 찾는 폴더 이름과 일치한다.

### 고정 항목과 실패 처리

- homr 0.7.0: `installer/locks/homr/uv.lock`을 `uv sync --frozen`으로 설치하고, ONNX 6개 파일의 크기·SHA-256을 검사한다.
- 정간보: `e95045fce5ab151fc4b87d5be86c4ac5f7621f4c` 커밋, Python 3.8.20,
  `Pipfile.lock`에서 옮긴 버전·해시가 있는 `requirements.lock.txt`를 사용한다.
- 정간보 체크포인트 v1.0.0 압축 파일 SHA-256:
  `f0e0d44a7ad54b7389b02f871e825d3ae439c5dda1a8f189916c727795a251bb`.
  압축 해시를 확인한 다음 지정된 모델·설정·토크나이저 3개만 꺼내 개별 해시도 검사한다.
- 각 엔진의 의존성 검사와 모델 로딩·해시 검사가 끝나야 `INSTALL_MANIFEST.json`을 기록한다.
  재실행하면 잠금·버전·가중치를 확인하고 기존 설치를 유지한다. 같은 엔진의 동시 설치는 파일 잠금으로 거부한다.
- 완료 표식이 없는 기존/부분 설치는 자동으로 건너뛰거나 덮어쓰지 않고 실패한다.
  로그에서 원인을 확인한 뒤 **새 시험 볼륨 이름으로 다시 시도**한다. 운영 볼륨을 삭제해서 해결하지 않는다.
- 설치기는 UID 1000, 읽기 전용 루트, 추가 권한 없이 실행하며 DB 비밀번호·API 키를 받지 않는다.
  쓰기 범위는 엔진 볼륨과 일회성 `/tmp` 볼륨이다. 큰 패키지 다운로드가 RAM을 차지하지 않도록
  `/tmp`는 tmpfs 대신 디스크 볼륨이며, `run --rm` 종료 때 해당 익명 볼륨을 정리한다.

### 시간 · 디스크 기준

2026-11-03 로컬 Docker Desktop/Linux amd64에서 빈 볼륨 설치는 **약 8분 31초**였다
(이미지 빌드 제외, 네트워크 속도에 따라 달라짐). 설치 후 볼륨은 **6,001,166,154바이트, 약 5.59GiB**였다.
기존에 검증된 의존성을 재현하므로 정간보는 CPU로 실행해도 CUDA 관련 패키지가 포함된다.
CPU 전용 경량화는 별도 검증 대상이며 이 설치기에서 임의로 바꾸지 않았다.
설치 중에는 이미지·다운로드 캐시 공간도 필요하다. 최종 볼륨 크기만큼만 남겨 두면 부족할 수 있으므로
작업 전 최소 20GB의 여유 공간을 권장한다 (설치 중 최대 디스크 사용량은 별도 미측정).

같은 임시 볼륨으로 전체 Compose를 빌드·실행해 healthy를 확인했다. 외부 API에서 오선보 1쪽(약 71초),
정간보 PDF 2쪽(약 89초)이 모두 `route=recognize`, `fallback=false`로 완료됐다
(로컬 환경의 접수부터 결과 생성까지, 서버 성능 보장값 아님).
브라우저에서도 로그인 → 예시 선택 → 실제 결과 악보 표시 → 재생 시간 증가를 확인했다.
설치기 재실행은 기존 설치를 유지했고, 아래 회귀 시험 7개도 통과했다. 실제 서버 볼륨은 변경하지 않았다.

설치기의 손상 다운로드·링크 파일·부분 설치·잠금 변경 회귀 시험은 `api/`에서 실행한다.
시험 컨테이너는 실제 엔진 볼륨이나 네트워크에 연결하지 않는다.

```bash
docker run --rm --network none --read-only --tmpfs /tmp \
  -v "$(pwd)/services/model-api/installer/tests:/tests:ro" \
  --entrypoint python klassic/engines-installer:0.2.2 \
  -B -m unittest discover -s /tests -v
```

## proto_type 없는 새 환경 시험 (#144, 2026-11-04)

새로 클론한 저장소에서 `proto_type/` 을 지운 뒤 `api/` 만으로 빌드 · 기동 · 엔진 설치 · 인식 · 내보내기 · 공유 · 외부 키까지 돌렸다. **원본 폴더와 실제 서비스 볼륨은 건드리지 않았다.**

**구성**

| 항목 | 값 |
|---|---|
| 코드 | main `4a74780` (#150 ~ #153 병합 후) 새 클론, 사본에서만 `proto_type/` 삭제 |
| PC | 코드 작업용 PC (Ryzen 5 7500F · Docker 6코어 · 31GiB · amd64 · GPU 없음). **서버 PC 측정값이 아니다** |
| 프로젝트 · 포트 | `-p klassic-standalone-test -f compose.yaml` · 9713 · 26311 |
| `.env` | 임시 값으로 새로 만듦 (비밀값은 무작위 생성, 시험 뒤 삭제) · 이미지 태그 `issue144` 로 분리 |
| 엔진 | 빈 볼륨 `klassic_issue144_engines` 에 #138 설치기로 새로 설치 |
| DB | 새 볼륨 — 마이그레이션 → 운영자 · 서비스 키 · 외부 키 · 라이선스 승인 모두 이 임시 DB 에서만 |

**결과 — 모두 통과**

| 확인 | 결과 |
|---|---|
| 런타임 경로의 `proto_type` | **0건** — `api/` 안 59건은 모두 주석 · 문서 · 시험 주석 (compose 머리 주석, `vite.config.ts` 주석, 마이그레이션 머리말 등) |
| 이미지 빌드 | backend · frontend · model-api · api-demo · engines-installer 5개 성공 (빌드 캐시 재사용, 25초 · 27초) |
| 엔진 설치 (#138) | 3분 6초 · homr 23초 · 정간보 160초 · 두 엔진 `INSTALL_MANIFEST.json` 생성 · 볼륨 6,001,168,548 B (#138 기록과 2,394 B 차이) |
| 기동 | 23초 뒤 db · web · admin · model-api · frontend 모두 Healthy |
| 공개 점검 `check-public.ps1 -Local` | 15개 모두 통과 (인식 · 렌더링 경로가 재구성판임을 확인) |
| 예시 3개 인식 | 아리랑 세마치 9.2초 · 미뉴에트 8.1초 · 타령 PDF 2쪽 8.1초 — 모두 `route=recognize` · `fallback=false` · `trust` (homr 0.7.0 · `jeongganbo-omr@e95045f+ckpt-v1.0.0`) |
| 직접 올리기 (타령 PDF) | upload-check 통과 → 7.1초 · `recognize` · 대체 아님 |
| 4형식 (오선보 · 정간보, 전조 +2 편집) | MIDI · MusicXML 바로, PDF 1.2~2.2초 (`verovio 5.7.0-7135340`), MP3 2.6~3.1초 (`fluidsynth 2.3.1+lame3.100`) — 파일 머리 확인 |
| 라이선스 승인 전 MP3 | 웹 내보내기에 「팀 내부 시연용」 안내가 붙음 · 도구 상태 「외부 키 MP3 보류」 |
| 공유 | 공유하기 200 → 다른 계정의 공유 목록에 1건 · 공유 악보 받기 200 |
| 외부 키 (승인 후) | 키 없음 401 · 접수 202 → 7.3초 완료 · `recognize` · 대체 아님 · MusicXML · MIDI · MP3 파일 3개 받음 · 다른 키로 상태 조회 404 · `/api/v1/shared-scores` 200 |
| model-api 메모리 | 웹 흐름 중 최대 1.958GiB (`mem_limit` 4g, 2초 간격 `docker stats`) |

**발견한 것**

- **외부 키 결과의 파일 주소에 포트가 빠진다.** `http://127.0.0.1/api/v1/files/<token>` 처럼 나온다 (입구가 9713 인데 포트 없음). Nginx 가 `proxy_set_header Host $host` 로 넘겨 포트가 떨어지고, model-api 가 `request.url_for` 로 주소를 만든다. 공개 주소(Funnel HTTPS 443)는 기본 포트라 영향이 없을 것으로 보지만 (추정), 로컬 · 임시 프로젝트 · 9603 직접 접속에서는 주소를 그대로 열 수 없다. `$http_host` 로 바꾸는 방안을 별도 이슈로 검토한다. 이번 시험은 주소의 경로만 떼어 받았다.
- Git Bash 에서 임시 폴더(`AppData\Local\Temp\...`) 아래 사본을 빌드하면 Compose 5.6 의 bake 가 `--allow=fs.read=...` 권한을 요구하며 멈췄다. 같은 명령이 PowerShell 에서는 되고, 원래 저장소 경로에서는 Git Bash 로도 된다. 경로 문제로 보이며 프로젝트 코드와는 관계없다 (추정).
- `compose run` 뒤에 이름 없는 빈 볼륨 2개가 남았다 (위 「CPU 전용 엔진 볼륨 시험」 7번과 같은 현상).

**선행 이슈 상태:** #138 · #139 · #140 · #143 완료(병합). **#141 (엔진 볼륨 백업) · #142 (engine-selftest 이미지) 는 열린 채로 시험했다.** `engine-selftest` 는 아직 v0.1.1 이미지(`klassic/klassic-model-api:0.1.1`, `pull_policy: never`)를 쓰므로 그 이미지가 없는 PC 에서는 실행되지 않는다 (추정 — 이 PC 에는 이미지가 있어 확인하지 못함). 기본 서비스 · 설치기와는 관계없다.

**시험하지 않은 것:** 브라우저 화면 · 소리 (#49 범위), 외부 Funnel, 동시 사용, 빌드 캐시 없는 빌드 시간, 엔진 볼륨 백업 · 복원 (#141).

**정리:** 컨테이너 · 네트워크와 `klassic-standalone-test_*` 볼륨 3개는 지웠다. 남은 것 — 빈 익명 볼륨 2개, 이미지 `*:issue144` 5개, 새로 설치한 엔진 볼륨 `klassic_issue144_engines` (6.0GB, 서버 전환이나 #141 시험에 다시 쓸 수 있어 남김).

## 백업 · 복원 (#97)

**자동으로 돌지 않는다.** 사람이 정한 때 실행한다. 권장 시점: 발표 리허설 전 · 발표 직전 · 마이그레이션이나 큰 변경 전.

- 담는 것: DB(`db.sql.gz`) · `storage` · `model-storage` · `MANIFEST.txt`(해시 · 커밋 · 행 수)
- `-e` 를 주면 엔진 볼륨도 담는다 (#141): `engines.tar.gz` · `engines.sha256`(파일 해시 목록) · `engines.links`(링크 목록). `MANIFEST.txt` 에 두 목록의 해시와 볼륨 이름 · 파일 수 · 설치 기록(`INSTALL_MANIFEST.json`) 유무가 들어간다. 약 2.8GB · 6분이라 기본으로는 담지 않는다.
- 담지 않는 것: `api/.env` 는 따로 보관한다. 음원은 저장소에 있다.
- 비밀번호는 컨테이너 안 환경변수로만 쓴다. 명령줄 · 파일 이름 · 출력에 나오지 않는다.

**백업** (서버 PC · Git Bash · `api/` 폴더) — 서비스를 멈추지 않는다. 기본 위치 `D:\klassic-backup\<시각>\`. 끝에 `완료:` 가 나오면 정상이다. 중간에 실패하면 `.incomplete` 폴더만 남고, 복원은 이 폴더를 거부한다.

```bash
bash deploy/backup.sh
```

**복원 시험** — 새 프로젝트에 되살린다. 실제 서비스 이름(`klassic-api`)과 이미 볼륨이 있는 프로젝트는 스크립트가 거부한다. 끝에 `완료:` 가 나오면 정상이다.

```bash
bash deploy/restore.sh -p klassic-api-restore -i /d/klassic-backup/<시각>
```

**복원한 프로젝트 띄우기** — 실제 서비스와 포트가 겹치지 않게 바꾼다. 모든 서비스가 Healthy 면 정상이다.

```bash
API_PUBLIC_PORT=9623 API_ADMIN_PORT=26221 docker compose -p klassic-api-restore -f compose.yaml up -d --wait
```

**시험 결과 (2026-11-03, 임시 프로젝트):** 인식 · 내보내기 · 공유까지 만든 프로젝트를 백업해 다른 프로젝트에 복원했다. 행 수 일치, 같은 계정 로그인, 내 악보 · 결과 악보 · 내려받기 · 공유 악보 모두 200, DB 와 파일 일치. 틀린 비밀번호는 401. 덤프 · 기록에 비밀번호 없음.

**시험하지 않은 것 (#97):** 실제 서비스 볼륨을 되돌리는 절차, 다른 PC 에서 복원. 큰 볼륨(엔진 6GB)의 소요 시간은 #141 에서 쟀다.

### 엔진 볼륨 백업 · 복원 (#141)

엔진 볼륨은 프로젝트 밖의 외부 볼륨이라 이름으로 고른다 (`-E`, 기본 `klassic_engines`). 백업은 볼륨을 **읽기 전용**으로만 연다.

**백업** (서버 PC · Git Bash · `api/` 폴더) — 끝에 `완료:` 가 나오고, 그 위에 `엔진: 파일 <수> · 링크 <수>` 가 보이면 정상이다.

```bash
bash deploy/backup.sh -e
```

**엔진만 복원** — 실제 서비스(`klassic-api`)의 엔진을 잃었을 때 쓴다. **새 이름**의 볼륨에만 풀고, 파일 해시 · 링크 목록이 백업과 같아야 `완료:` 가 나온다. 이미 있는 볼륨(실제 `klassic_engines` 포함)은 거부한다.

```bash
bash deploy/restore.sh -i /d/klassic-backup/<시각> -E klassic_engines_restored
```

복원한 볼륨을 붙인다. model-api 가 Healthy 면 정상이다. 되돌리려면 같은 명령을 `ENGINES_VOLUME_NAME=` 없이 실행한다.

```bash
ENGINES_VOLUME_NAME=klassic_engines_restored docker compose up -d --wait model-api
```

- 새 프로젝트에 DB · 파일과 함께 복원할 때는 `-p <새 프로젝트>` 와 `-E <새 볼륨>` 을 같이 준다.
- 해시가 다르면 `엔진 파일 해시가 백업과 다르다` 로 멈춘다. 그 볼륨은 쓰지 않고 이름을 확인한 뒤 지운다. 다시 할 때는 새 이름을 쓴다.
- 엔진 백업이 없으면 #138 설치기로 새로 설치한다 (위 「api 코드만으로 엔진 새로 설치」).

### 엔진 볼륨이 없을 때

| 증상 | 근거 | 조치 |
|---|---|---|
| `docker compose up -d` 가 바로 `external volume "klassic_engines" not found` 로 끝난다 (끝 코드 1) | model-api 의 `engines` 볼륨이 `external: true` 라 Compose 가 새로 만들지 않는다. **컨테이너 · 네트워크를 하나도 만들지 않고** 멈춘다 | ① 엔진 백업이 있으면 「엔진만 복원」 → `ENGINES_VOLUME_NAME` 로 붙인다 ② 없으면 #138 설치기로 새 볼륨에 설치 |

- `docker compose config` 는 볼륨이 있는지 검사하지 않아 통과한다. 이 증상은 `up` 에서만 보인다.
- 엔진을 쓰지 않는 서비스만 이름을 지정해 띄우면(`up -d db`) 뜬다. 화면 · 인식은 model-api 가 있어야 한다.
- 이름이 틀린 경우도 같은 문구다 (`ENGINES_VOLUME_NAME` 오타). 먼저 `docker volume ls` 로 이름을 본다.

### #141 시험 결과 (2026-11-04, 코드 작업용 PC · 임시 프로젝트)

| 확인 | 결과 |
|---|---|
| 엔진 없음 | `ENGINES_VOLUME_NAME=klassic_issue141_missing` 로 `up -d --wait` → `external volume "klassic_issue141_missing" not found` · 끝 코드 1 · 만든 것 없음. `up -d db` 는 뜸 · `config --quiet` 는 통과 |
| 백업 `-e` | 시험 엔진 볼륨(`klassic_issue144_engines`, #144 에서 설치) — **6분 23초 · 2.8GB** (엔진 2.99GB 압축) · 파일 41,794 · 링크 1,057 · 두 엔진 설치 기록 있음 |
| 복원 `-p` + `-E` | **4분 41초** · 엔진 파일 해시 · 링크 목록이 백업과 같음 · DB 행 수 일치 (계정 3 · 요청 4 · 업로드 4 · 공유 1) |
| 복원한 엔진으로 기동 | 13초 뒤 모두 Healthy · 엔진 볼륨 읽기 전용 · 공개 점검 15개 통과 · 예시 3개와 PDF 직접 올리기 모두 `recognize` · 대체 아님 (9.2~10.3초) |
| 거부 | 이미 있는 볼륨(`klassic_engines`) · 실제 서비스 프로젝트 · 엔진 없는 백업 · 인자 없음 — 모두 아무것도 만들지 않고 멈춤 |
| 검사기가 불일치를 잡는가 | 해시를 일부러 틀린 작은 가짜 백업 → `엔진 파일 해시가 백업과 다르다` · 끝 코드 1. 맞는 해시로는 통과 |

- 실제 `klassic_engines` 는 거부 시험에서 이름만 대조했고 열지 않았다.
- 시험하지 않은 것: 실제 서비스 볼륨 백업 실행(필요한 시점에 사람이 정한다), 다른 PC 로 옮겨 복원, 서버 PC(노트북)에서의 소요 시간.

## 서버 PC 운영 (#47)

서버 PC = 팀장 노트북(Windows · Docker Desktop · WSL2). 코드 작업은 다른 PC 에서 하므로, **서버 PC 설정을 바꾸면 이 표에 남긴다.**

발표 때는 `api/` 서비스를 켠 상태로 시연한다 (2026-11-01 결정) → 목표는 **켜 둔 채 꺼지지 않게** 하는 것이고, 재부팅 자동 복구는 범위 밖이다.

### 변경 기록

| 날짜 | 항목 | 이전 | 지금 | 되돌리기 |
|---|---|---|---|---|
| 2026-11-01 | 전원 연결 시 절전 | 5시간 뒤 | **안 함** | 설정 → 시스템 → 전원 → 화면 및 절전 |
| 2026-11-01 | 덮개 닫기(전원 연결) | 절전 | **아무것도 안 함** | 제어판 → 전원 옵션 → 덮개를 닫으면 |
| 2026-11-02 | `api/.env` `COMPOSE_FILE` | 없음 | **대역을 기본 구성으로** (#86) | `api/.env` 의 두 줄 삭제 |
| 2026-11-03 | `api/.env` `COMPOSE_FILE` | 대역이 기본 | **두 줄 삭제 — 재구성판이 기본** (#87) | 「model-api 대역」 절차로 두 줄을 다시 넣는다 |
| 2026-11-01 | Windows 업데이트 | 중지 안 함 | **11/05 까지 일시 중지** | 설정 → Windows 업데이트 → 업데이트 재개 |
| 2026-11-01 | Tailscale Run unattended | 꺼짐 | **켜짐** (`ForceDaemon: true` 확인) | 작업 표시줄 Tailscale 앱 Preferences |

- 배터리 사용 시 설정은 바꾸지 않았다 (절전 2시간 · 덮개 닫으면 절전). **발표 때는 충전기를 꽂아 둔다.**
- 그대로 둔 것: Docker Desktop 로그인 시 자동 시작(켜짐) · Docker 배정 4코어 · 16GB(`.wslconfig`) · 네트워크 Wi-Fi

### 재부팅했을 때

재부팅은 자동 복구하지 않는다. 다시 켜면 Windows 로그인 뒤 사람이 띄운다.

```bash
# api/ — 시연 서비스 (Docker Desktop 이 뜨면 restart 정책으로 돌아온다. 안 돌아온 것만 띄운다)
# 재구성 model-api 가 함께 뜬다 (#87). 대역은 「model-api 대역」 참고
cd api && docker compose up -d

# proto_type — 예비 시연 · 코드 작업 중 필요할 때만
cd proto_type && docker compose up -d --force-recreate web gateway admin model-api
```

proto_type 은 `network_mode: service:web` 구조라 재부팅 뒤 web 과 gateway · model-api 의 네트워크가 갈라져 9503 이 응답하지 않는다 (2026-11-01 확인). `docker compose restart` 로는 풀리지 않고 위 명령이 필요하다. 볼륨은 건드리지 않는다.

### 자원 측정

인식 중 `docker stats` 측정과 `api/` · proto_type 동시 실행 영향은 **#49** 에서 본다 — `api/` model-api(#24 · #29)가 있어야 잴 수 있다.

## 참고

- `proto_type/src/app/ops/gateway.mjs` — 경로 규칙 · 내부 API 차단 · 대기 시간을 Nginx `proxy.conf` 로 옮긴다 (127.0.0.1 고정 호출 → 서비스 이름)
- `proto_type/docker-compose.yml` 의 `db`
