# frontend (담당: 황송해 @SonghaeHwang)

사용자 화면(올리기 · 결과 · 편집 · 연주 · 내려받기 · API 안내) · 관리자 화면 · 정적 파일 서빙(Nginx).

- 참고 코드: `proto_type/src/app/frontend` (Vue · Vite · TypeScript, 약 10,900줄 — 사용자 약 6,900줄 · 관리자 약 4,000줄 · 테스트 44개 파일)
- 계약: [../../contracts/web-api.yaml](../../contracts/web-api.yaml)
- 공용 패키지: [../../packages/score-core/](../../packages/score-core/) (편집 · 연주에서 사용)

## 재구성 시 바꿀 점

- API 주소 · 공개 주소는 빌드 시 환경변수로 받는다 (하드코딩 금지)
- v0.1.1 은 백엔드가 화면 파일을 함께 내줬다 → 프론트 이미지(Nginx)가 직접 내준다
- 관리자 화면은 사용자 화면과 다른 경로 · 다른 포트로 내주고, 외부에는 열지 않는다

## 이 폴더에 둘 파일

`src/` · `tests/` · `package.json` · `package-lock.json` · `nginx.conf` · `Dockerfile` · `.dockerignore` · `compose.yaml` · `.env.example` · 이 README(Runbook)
