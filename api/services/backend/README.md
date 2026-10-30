# backend (담당: 팀장 @majoongcheon)

사용자 API(`/api/*`, web) · 관리자 API(`/admin/*`, admin) · 인식 작업자 · 렌더링 대기열 · 주기 작업.

- 참고 코드: `proto_type/src/app/backend` (Node.js 22 · Express · TypeScript, 약 4,500줄 · 테스트 29개 파일)
- 계약: [../../contracts/web-api.yaml](../../contracts/web-api.yaml) (화면 쪽) · [../../contracts/model-api.yaml](../../contracts/model-api.yaml) (부르는 쪽)

## 재구성 시 바꿀 점

- 수신 주소 `0.0.0.0`, model-api 는 서비스 이름(`http://model-api:<포트>`)으로 호출 — `MODEL_API_URL` 환경변수
- 외부 공개(HTTPS 프록시 뒤): `trust proxy` 로 실제 접속 주소 읽기 · 세션 쿠키 `Secure` · 요청 한도
- 관리자(admin)는 외부에 열지 않는다 (호스트 `127.0.0.1` 에만 공개)

## 이 폴더에 둘 파일

`src/` · `tests/` · `package.json` · `package-lock.json` · `Dockerfile` · `.dockerignore` · `compose.yaml` · `.env.example` · 이 README(Runbook: 기동 · 확인 · 장애 조치)
