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
- Tailscale 인증 키는 비밀값이다 — `.env` 로만 주입하고 저장소에 넣지 않는다.
- Funnel 은 대역폭 제한이 있으므로 시연 · 소규모 사용 기준으로 본다.

## 이 PC 서버 운영 체크

- 절전 · 최대 절전 끄기, 로그인 시 Docker Desktop 자동 시작
- 모든 서비스 `restart: unless-stopped`, Windows 업데이트 재부팅 뒤 자동 복구 확인
- `.wslconfig` 로 WSL 메모리 상한 지정
- DB · 업로드 파일 정기 백업과 복원 시험

## 참고

- `proto_type/src/app/ops/gateway.mjs` (127.0.0.1 고정 호출 → 서비스 이름 호출로 바꾼다)
- `proto_type/docker-compose.yml` 의 `db` · `gateway`
