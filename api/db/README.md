# db (담당: 팀장 @majoongcheon)

MariaDB 스키마 마이그레이션과 초기 데이터. 백엔드와 model-api 가 같은 DB 를 쓴다.

- 참고: `proto_type/src/app/db/migrations` (001~020) · `db/seeds/001_initial.sql`
- DB 컨테이너 · 실행 구성은 [../deploy/compose.yaml](../deploy/compose.yaml) (#20)

## 들어 있는 파일 (#17)

| 파일 | 내용 |
|---|---|
| [migrate.sh](migrate.sh) | 마이그레이션 실행기 — `migrations/*.sql` 을 이름 순서대로 한 번씩 적용, `schema_migration` 에 기록 |
| `migrations/20261030_1700_baseline_schema_v0.1.1.sql` | **기준 스키마** — v0.1.1 최종 스키마 (테이블 44 · 뷰 41 · 트리거 7) |
| `migrations/20261030_1701_baseline_seed_v0.1.1.sql` | **초기 데이터** — 역할 · 권한표 · 악기 · 기본 편성 · 대체 템플릿 · 라이선스 · 모델 등록부 · 처리 설정 판본 1 · 엔진 순서 · 시스템 운영자(로그인 불가) |

기준 파일은 손으로 옮겨 쓰지 않고, 빈 MariaDB 12.0.2 에 v0.1.1 마이그레이션 001~020 + 시드를 적용한 뒤 `mariadb-dump` 로 뽑았다.
2026-10-30 비교 결과: 이 두 파일로 만든 DB 와 v0.1.1 방식으로 만든 DB 의 **스키마 · 초기 데이터 차이 0줄**.
(proto_type 의 실제 DB 와는 트리거의 `sql_mode` 표기 `IGNORE_SPACE` 만 다르다 — v0.1.1 은 Node 클라이언트로 적용해서 붙은 값이고 동작은 같다.)

## 실행

```bash
cd api
docker compose up -d db            # MariaDB (healthy 까지 약 10~20초)
docker compose run --rm migrate    # 마이그레이션 — 이미 적용한 파일은 건너뛴다 (여러 번 실행해도 안전)
```

- 백엔드 · model-api 는 #23 · #24 에서 `migrate` 가 끝난 뒤(`service_completed_successfully`) 뜨게 묶는다.
- 적용 기록 없이 스키마만 있는 DB(손으로 만든 DB)를 만나면 실행기가 멈춘다 — 엉뚱한 DB 에 기준 파일을 다시 돌리지 않게.

## 파일 이름 규칙

```
migrations/YYYYMMDD_HHMM_<짧은_설명>.sql
예) 20261102_1400_model_registry_index.sql
```

- 번호(`021_`) 대신 날짜 · 시각으로 지어서, 두 사람이 동시에 파일을 만들어도 겹치지 않게 한다. 규칙에 맞지 않는 이름은 실행기가 거부한다.
- **새 파일만 추가하고, 이미 병합된 파일은 고치지 않는다.** (기준 파일 두 개도 마찬가지)
- SQL 파일은 줄 끝 LF (`.gitattributes`) — 트리거의 `DELIMITER` 줄에 CR 이 붙으면 적용이 깨진다.
- model-api 가 쓰는 테이블(`access_key` · `model_registry` · `processing_setting_version` 등)은 예은이 직접 파일을 추가할 수 있다. 리뷰는 팀장.

## 주의 — 백업

이미 데이터가 쌓인 DB 에 새 마이그레이션을 적용하기 전에는 백업을 먼저 받는다 (DDL 은 되돌릴 수 없다).
