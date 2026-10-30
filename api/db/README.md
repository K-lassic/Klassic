# db (담당: 팀장 @majoongcheon)

MariaDB 스키마 마이그레이션과 초기 데이터. 백엔드와 model-api 가 같은 DB 를 쓴다.

- 참고: `proto_type/src/app/db/migrations` (001~020, 테이블 44개) · `db/seeds`
- 첫 파일은 v0.1.1 의 최종 스키마를 합친 **기준 파일** 하나로 만든다. v0.1.1 데이터와 호환되어야 롤백을 검증할 수 있다.

## 파일 이름 규칙

```
migrations/YYYYMMDD_HHMM_<짧은_설명>.sql
예) 20261102_1400_model_registry_index.sql
```

- 번호(`021_`) 대신 날짜 · 시각으로 지어서, 두 사람이 동시에 파일을 만들어도 겹치지 않게 한다.
- **새 파일만 추가하고, 이미 병합된 파일은 고치지 않는다.**
- model-api 가 쓰는 테이블(`access_key` · `model_registry` · `processing_setting_version` 등)은 예은이 직접 파일을 추가할 수 있다. 리뷰는 팀장.
