# 외부 API 예시 홈페이지 — #93

구조에서의 위치: 브라우저 `/demo/` → 예시 서버 → 외부 키로 model-api의 공유 악보·악기 목록·MP3 API를 호출한다. 키는 서버 환경변수에만 두고 브라우저·로그로 내보내지 않는다. Node 내장 모듈만 사용하며 npm 의존성·DB·파일 볼륨은 없다.

## 실행·설정

`api/.env`에 `DEMO_API_KEY`를 설정한다. **외부 키**를 사용하며 서비스 키로 대체하지 않는다. 발급은 backend #91 절차를 따른다. `DEMO_API_BASE`는 기본 `http://model-api:9543`이며 공개 API로 시험하려면 `https://<공개주소>/api`로 지정한다. 주소에 키·사용자명·비밀번호·쿼리를 넣지 않는다.

`api/`에서 실행한다.

```powershell
docker compose --profile demo build model-api demo
docker compose --profile demo up -d model-api demo
```

공유할 악보와 음원 이용 조건은 #98에서 확인해야 한다. 데모가 정책을 바꾸지는 않는다. `api_mp3_allowed=0`이면 목록은 보여도 재생은 `409 MP3_WITHHELD`로 안내한다. 음악이 준비돼도 자동 재생하지 않고 사용자가 재생 버튼을 누른 뒤 듣는다.

## Nginx 연결 — 팀장 담당

서버는 `0.0.0.0:26102`에서 **`/demo` 접두사를 유지한 요청**을 받는다. Nginx의 `/demo`·`/demo/*`를 `http://demo:26102`로 넘기되 접두사를 제거하면 안 된다. `/demo`는 `/demo/`로 이동하며 `GET /health`는 내부 준비 확인용이다. 프로필이 꺼져 있을 때 Nginx가 실패하지 않게 연결 방식도 고려해야 한다. `deploy/nginx/`는 수정하지 않았다.

코드 작업 PC에서만 화면을 열려면 다음 로컬 override를 사용한다.

```powershell
docker compose -f compose.yaml -f services/model-api/demo/compose.local.yaml --profile demo up -d model-api demo
```

주소는 `http://127.0.0.1:9733/demo/`이며 외부에 포트를 열지 않는다. 실제 서버 적용은 Nginx 연결·외부 키·이용 조건을 담당자와 맞춘 뒤 진행한다.

## 동작·보호

- `/demo/api/music`: 곡·선율 국악기 목록을 1분 캐시한다. 타악기는 선택에서 제외하고 빈 목록·API 장애를 안내한다.
- `/demo/api/bgm?share=<번호>&inst=<악기 코드>`: 목록의 선택만 허용한다. 공유 악보를 매번 조회해 거둠·만료를 확인하고 외부 키의 렌더링 호출로 MP3 정책을 검사한다.
- 완성 MP3는 장기 캐시하지 않는다. 동일한 진행 중 요청만 합치고 서로 다른 작업은 최대 2개로 제한한다. 초과 시 429·`Retry-After: 5`를 반환하며 upstream 429도 재시도 시간을 전달한다.
- API JSON은 최대 6MiB, MP3는 최대 20MiB로 읽기 크기와 시간을 제한한다. API 리다이렉트는 따라가지 않아 다른 호스트로 키를 전달하지 않는다.
- 정적 파일은 지정된 세 파일만 제공하고 동적 제목은 브라우저에서 `textContent`로 표시한다. 서버 오류 원문을 브라우저로 전달하지 않는다.
- 일반 사용자·읽기 전용 루트·권한 제거로 실행한다. `/health`는 프로세스 확인이며 키 유효성·API 준비·음원 정책은 목록·재생 요청으로 별도 확인한다.

## 검증·운영

```powershell
docker run --rm -v "${PWD}/services/model-api/demo:/app:ro" -w /app node:22.21.1-bookworm-slim node --test tests/server.test.mjs
```

실제 검사는 model-api의 `tests/run_demo_live.ps1`를 격리 `klassic_issue93` DB·시험 볼륨에서만 실행한다. 임시 외부 키·시험 운영자 기록으로 정책을 모의하며 이후 원래 정책과 파일·키를 정리한다. 운영 이용 허가를 대신하는 절차가 아니다.

| 증상 | 확인·조치 |
|---|---|
| 시작 실패 | 키 누락·주소 형식·포트 충돌을 확인한다. 키 값을 출력하지 않는다. |
| 빈 목록 | 공개 가능한 공유 악보·읽기 전용 저장소 연결·등록 도구 결과를 확인한다. |
| MP3 보류 | #98의 이용 조건과 정책을 담당자가 확인한다. 재생을 위해 임의로 승인하지 않는다. |
| 429 | 안내 시간 뒤 재시도하고 키별 한도·동시 처리 상태를 확인한다. |
| 502 | 서버에서 API 주소·health·키 상태를 확인한다. 브라우저에 키를 넣어 우회하지 않는다. |

되돌리려면 데모만 중지하고 Nginx 연결을 담당자와 조정한다. 기존 이미지·엔진·사용자 볼륨은 삭제하지 않는다. 실제 Nginx·Funnel·브라우저 연결은 팀장 연동 후 별도 검증한다.
