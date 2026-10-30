# model-api (담당: 예은 @yeeun5364)

악보 인식(오선보 · 정간보) · MP3/PDF 렌더링 · 국악기 추천 · 외부 API(`/api/v1`, API 키).

- 참고 코드: `proto_type/src/app/model-api` (Python 3.11 · FastAPI · uv, 약 8,800줄 · 테스트 36개 파일)
- 엔진 설치 참고: `proto_type/src/app/ops/engines` · `proto_type/docker/engines-installer.Dockerfile`
- 계약: [../../contracts/model-api.yaml](../../contracts/model-api.yaml)

## 재구성 시 바꿀 점

- 수신 주소 `0.0.0.0`, 경로(엔진 · 모델 · 음원 · 저장소)는 환경변수로 주입
- `/health` 는 엔진 · 사운드폰트 로딩이 끝났을 때만 200
- Audiveris 는 macOS 앱 구조 전제 → Linux 설치 방식으로 전환
- 외부 공개: API 키별 사용량 제한 · 업로드 크기와 처리 시간 상한 (외부 요청이 엔진을 무한정 쓰지 못하게)

## 이 폴더에 둘 파일

`app/` · `tests/` · `pyproject.toml` · `uv.lock` · `Dockerfile` · `.dockerignore` · `compose.yaml` · `.env.example` · 이 README(Runbook)
