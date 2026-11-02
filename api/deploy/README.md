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

- 도메인 없이 `*.ts.net` 주소와 HTTPS 인증서를 받는다. 공유기 포트를 열지 않는다.
- **Tailscale 은 Windows 앱(서비스)으로 돌린다** (#9 결정). 컨테이너로 돌리지 않으므로 인증 키(`TS_AUTHKEY`)가 필요 없다 — 로그인은 앱에서 사람이 한다.
- 켜기 · 끄기는 [funnel.ps1](funnel.ps1). 공개하는 포트는 입구 하나(proto_type 9503 또는 api/ 9603)이고, 관리자 · 내부 포트(26101 · 26201 · 9523 · 9543 · 3306)는 스크립트가 거부한다.
- Funnel 은 대역폭 제한이 있으므로 시연 · 소규모 사용 기준으로 본다.

### 켜기 · 끄기 (#9)

```powershell
pwsh api/deploy/funnel.ps1 status             # 로그인 상태 · 공개 주소
pwsh api/deploy/funnel.ps1 start              # 예비 시연: proto_type gateway(9503) 공개
pwsh api/deploy/funnel.ps1 start -Port 9603   # 재구성: api/ 입구(Nginx)로 전환 (#48)
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
pwsh api/deploy/funnel.ps1 start
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

## model-api 대역 (#49)

재구성 model-api(#24 · #28~#31)가 발표까지 갖춰지지 않을 때를 대비해, **v0.1.1 이미지를 `model-api` 이름으로 `api/` 에 붙인다.** 코드는 고치지 않는다. 파일은 [compose.standin.yaml](compose.standin.yaml) · [model-standin.env](model-standin.env)(키 이름만) 두 개다.

```
web ──┐
      ├─▶ model-api:9543 (klassic/klassic-model-api:0.1.1) ─▶ db · 엔진 볼륨 klassic_engines(읽기 전용)
Nginx ┘
```

필요한 것: 이미지 `klassic/klassic-model-api:0.1.1` · 볼륨 `klassic_engines` · `api/.env` 의 `SERVICE_API_KEY`. proto_type 컨테이너는 떠 있지 않아도 된다.

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

**기본 구성으로 만들기 (서버 PC, #86)** — `api/.env` 에 두 줄을 더하면 `api/` 폴더에서 `-f` 없이 써도 대역이 유지된다. 비밀값이 아니다.

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
- **`COMPOSE_FILE` 이 없는 PC 에서는 `-f compose.yaml -f deploy/compose.standin.yaml` 을 붙인다.** 안 붙이면 재구성판 model-api 가 대역을 밀어낸다. 재구성판은 #29 · #30 · #31 전까지 인식 · 렌더링이 없어서, 오류 없이 모든 악보가 대체 악보로 끝난다. `COMPOSE_FILE` 은 `api/` 폴더에서만 읽힌다.
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

- 메모리: 인식 · 렌더링 중 최대 2.29GiB (대기 때 약 0.7GiB). 재구성판에는 아직 `mem_limit` 이 없다. 렌더링 2건 동시 값을 재지 않았으므로 #49 에서 재고 정한다.
- 대역과 비교: 예시 4개의 마디 수 · 음표 수 · 음높이 순서가 모두 같다. 인식 시간도 비슷하다 (재구성 22.8~28.0초 · 대역 17.9~25.1초).
- 동시 사용: 웹 인식은 `web_concurrency_share` = 1 이라 한 건씩 처리한다. 3건 67.5초 · 6건 135.5초, 모두 대체 없이 완료. 대기 상한은 쪽당 180초라 한 건 약 22초면 9건째부터 시간 초과로 대체될 수 있다 (추정).
- 같은 접속 주소 한도: 동시 1건 · 시간당 10건 (`web_max_active_per_client` · `web_hourly_request_cap`). 같은 공용 주소를 쓰는 사람들은 이 값을 함께 쓴다. 측정은 주소를 나눠서 했다.
- 시험하지 않은 것: 재구성판의 브라우저 화면 · 소리, 사진 예시 밖의 품질 비교, 장애 시험(#45), 외부 Funnel.
- 임시 프로젝트 주의: `compose.standin.yaml` 까지 붙여 `down -v` 하면 `model-storage` 볼륨이 남는다. 시험이 끝나면 `-f compose.yaml` 로 지운다.

## 서버 PC 운영 (#47)

서버 PC = 팀장 노트북(Windows · Docker Desktop · WSL2). 코드 작업은 다른 PC 에서 하므로, **서버 PC 설정을 바꾸면 이 표에 남긴다.**

발표 때는 `api/` 서비스를 켠 상태로 시연한다 (2026-11-01 결정) → 목표는 **켜 둔 채 꺼지지 않게** 하는 것이고, 재부팅 자동 복구는 범위 밖이다.

### 변경 기록

| 날짜 | 항목 | 이전 | 지금 | 되돌리기 |
|---|---|---|---|---|
| 2026-11-01 | 전원 연결 시 절전 | 5시간 뒤 | **안 함** | 설정 → 시스템 → 전원 → 화면 및 절전 |
| 2026-11-01 | 덮개 닫기(전원 연결) | 절전 | **아무것도 안 함** | 제어판 → 전원 옵션 → 덮개를 닫으면 |
| 2026-11-02 | `api/.env` `COMPOSE_FILE` | 없음 | **대역을 기본 구성으로** (#86) | `api/.env` 의 두 줄 삭제 |
| 2026-11-01 | Windows 업데이트 | 중지 안 함 | **11/05 까지 일시 중지** | 설정 → Windows 업데이트 → 업데이트 재개 |
| 2026-11-01 | Tailscale Run unattended | 꺼짐 | **켜짐** (`ForceDaemon: true` 확인) | 작업 표시줄 Tailscale 앱 Preferences |

- 배터리 사용 시 설정은 바꾸지 않았다 (절전 2시간 · 덮개 닫으면 절전). **발표 때는 충전기를 꽂아 둔다.**
- 그대로 둔 것: Docker Desktop 로그인 시 자동 시작(켜짐) · Docker 배정 4코어 · 16GB(`.wslconfig`) · 네트워크 Wi-Fi

### 재부팅했을 때

재부팅은 자동 복구하지 않는다. 다시 켜면 Windows 로그인 뒤 사람이 띄운다.

```bash
# api/ — 시연 서비스 (Docker Desktop 이 뜨면 restart 정책으로 돌아온다. 안 돌아온 것만 띄운다)
# api/.env 의 COMPOSE_FILE 로 대역이 함께 뜬다 (#86 · 「model-api 대역」)
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
