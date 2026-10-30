# contracts — API 계약 (OpenAPI 3.1)

| 파일 | 경계 | 담당 | 리뷰 |
|---|---|---|---|
| [web-api.yaml](web-api.yaml) | 화면(frontend) ↔ backend `/api/*` | 팀장 @majoongcheon | 황송해 @SonghaeHwang |
| [model-api.yaml](model-api.yaml) | backend · 외부 사용자 ↔ model-api `/v1/*` | 예은 @yeeun5364 | 팀장 @majoongcheon |

- 1차 계약은 **v0.1.1 과 같은 내용**으로 쓴다. 그러면 새 서비스를 v0.1.1 컨테이너와 붙여서 혼자 시험할 수 있다.
- 바꾸는 내용은 계약 변경 이슈 → PR(상대 쪽 리뷰 필수)로 올린다. 구현보다 계약 PR 이 먼저 병합되어야 한다.
- 관리자 API(`/admin/*`)는 외부 비공개지만 화면과의 약속이므로 `web-api.yaml` 에 함께 적는다.
