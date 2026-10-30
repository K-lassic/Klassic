# shared (담당: 팀장 @majoongcheon)

세 서비스가 함께 읽는 설정 파일.

| 파일 (예정) | 내용 | 참고 |
|---|---|---|
| `errors/common.json` | 공통 오류 코드 | `proto_type/src/app/shared/error-codes.json` |
| `errors/web.json` | 백엔드 · 화면 오류 코드 (팀장) | 〃 |
| `errors/model.json` | model-api 오류 코드 (예은) | 〃 |
| `upload-rules.json` | 업로드 형식 · 크기 · 사진 짧은 변 | `shared/upload-rules.json` |
| `instruments.json` | 악기 목록 | `shared/instruments.json` |

- 오류 코드를 **영역별 파일**로 나눠서, 각자 자기 파일에만 코드를 추가한다.
- 코드 이름은 영역 접두어로 겹치지 않게 한다 (예: `WEB_…`, `MODEL_…`).
