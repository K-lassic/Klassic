# deploy (담당: 팀장 @majoongcheon)

DB · gateway · 외부 공개 · 운영 설정.

## 외부 공개 — Tailscale Funnel

```
인터넷 ──HTTPS──▶ Tailscale Funnel (<기기이름>.<tailnet>.ts.net)
                     └─▶ gateway ─┬─ /api/v1/*  ─▶ model-api
                                  ├─ /api/*     ─▶ backend(web)
                                  └─ 그 밖      ─▶ frontend
관리자 ──▶ 127.0.0.1:<관리자 포트> ─▶ backend(admin) · 관리자 화면   (외부 비공개)
```

- 도메인 없이 `*.ts.net` 주소와 HTTPS 인증서를 받는다. 공유기 포트를 열지 않는다.
- **Tailscale 은 Windows 앱(서비스)으로 돌린다** (#9 결정). 컨테이너로 돌리지 않으므로 인증 키(`TS_AUTHKEY`)가 필요 없다 — 로그인은 앱에서 사람이 한다.
- 켜기 · 끄기는 [funnel.ps1](funnel.ps1). 공개하는 포트는 gateway 하나이고, 관리자 · 내부 포트(26101 · 9523 · 9543 · 3306)는 스크립트가 거부한다.
- Funnel 은 대역폭 제한이 있으므로 시연 · 소규모 사용 기준으로 본다.

### 켜기 · 끄기 (#9)

```powershell
pwsh api/deploy/funnel.ps1 status             # 로그인 상태 · 공개 주소
pwsh api/deploy/funnel.ps1 start              # 예비 시연: proto_type gateway(9503) 공개
pwsh api/deploy/funnel.ps1 start -Port <포트> # 재구성: api/ gateway 로 전환
pwsh api/deploy/funnel.ps1 stop               # 공개 끄기
```

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
| 휴대폰(LTE)에서 로그인 → 올리기 → 결과 → 내려받기 · 외부 API 키 호출 | ⏳ 사람이 확인 |

**문제 1 — 외부 사용자 전원이 같은 주소로 보임 (해결)**

- 증상: 백엔드가 모든 외부 요청을 `172.30.0.1`(Docker 네트워크 게이트웨이)에서 온 것으로 기록 → 접속 주소별 한도(G12 처리 중 1건 · 가입 시간당 5건)를 **외부 사용자 전원이 나눠 씀**.
- 근거: 실패 로그인의 `gate_event.subject_ref`(주소 해시)를 후보 주소 해시와 대조 → `172.30.0.1` 과 일치.
- 원인: Docker Desktop 포트 전달로 들어온 연결의 출발 주소가 `172.30.0.1` 이고, gateway 는 `GATEWAY_TRUSTED_PROXIES`(기본 `127.0.0.1,::1,192.168.0.19`)에서 온 요청의 `X-Forwarded-For` 만 믿는다.
- 조치(코드 수정 없음): proto_type `.env` 에 `GATEWAY_TRUSTED_PROXIES=127.0.0.1,::1,172.30.0.1` → `docker compose up -d --force-recreate gateway` → 다시 대조하니 실제 공인 IP 와 일치.
  호스트 포트를 `127.0.0.1` 에만 공개하므로 `172.30.0.1` 로 들어오는 것은 이 PC 안(Tailscale · 로컬 브라우저)뿐이다.
- **재구성(api/) 반영**: gateway · backend 의 신뢰 프록시를 설정값으로 두고, compose 네트워크 게이트웨이 주소를 넣는다 (백엔드 외부 공개 대응 이슈).

**문제 2 — 로그아웃하면 공개가 끊김 (설정 필요)**

- Tailscale 서비스는 자동 시작(Automatic)이지만 **"Run unattended"** 가 꺼져 있으면 Windows 사용자가 로그아웃할 때 연결이 끊긴다.
- 조치: 작업 표시줄 Tailscale 아이콘 → Preferences → **Run unattended** 켜기 (서버 PC 운영 설정 이슈에서 재부팅 시험).

### 예비 시연 ↔ 재구성 전환

- proto_type(v0.1.1)은 9503 을 쓴다. `api/` gateway 는 **다른 호스트 포트**로 띄워서 둘이 같이 떠 있게 한다.
- 발표에 쓸 쪽을 정하면 `start -Port <포트>` 로 Funnel 이 가리키는 곳만 바꾼다. 컨테이너는 끄지 않는다.

## 이 PC 서버 운영 체크

- 절전 · 최대 절전 끄기, 로그인 시 Docker Desktop 자동 시작
- 모든 서비스 `restart: unless-stopped`, Windows 업데이트 재부팅 뒤 자동 복구 확인
- `.wslconfig` 로 WSL 메모리 상한 지정
- DB · 업로드 파일 정기 백업과 복원 시험

## 참고

- `proto_type/src/app/ops/gateway.mjs` (127.0.0.1 고정 호출 → 서비스 이름 호출로 바꾼다)
- `proto_type/docker-compose.yml` 의 `db` · `gateway`
