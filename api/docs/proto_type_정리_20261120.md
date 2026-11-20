# proto_type · v0.1.1 대역 정리 (#145, 2026-11-20)

> 사용자의 결정과 지시에 따라 Claude 가 조사 · 수정 · 시험하고 이 문서를 정리했다.
> 이 PR 은 1단계(막는 것 정리)다. `proto_type/` 폴더 삭제와 이미지 삭제는 이 PR 이 병합된 뒤에 한다 (5절).

## 1. 결정 (사용자, 2026-11-20)

- **v0.1.1 이미지는 남기지 않는다.** 이미지를 만들 코드가 모두 있고 구축 방법이 정리돼 있으면 이미지를 보관할 필요가 없다.
- **`proto_type/` 은 0.1.1 이미지를 다시 빌드할 수 있을 만큼만 보존한다.** 빌드에 필요한 파일을 폴더째 압축해 보관하고, 저장소에서는 지운다.
- **인터넷에서 다시 받을 수 있는 파일은 압축본에서 뺀다.** 이전 제출용 소스코드 압축과 같은 기준이다.
- 압축본 위치: `D:\[Back-up]\[Mini_Project]\Klassic` (이 PC 의 백업 드라이브, 저장소 밖).
- 평가셋 이미지는 `api/` 안으로 옮긴다.
- 대역 전환 시험(E-8)은 하지 않는다. 대역 자체를 없앤다.

## 2. 조사 결과 — 지우기 전에 걸리는 것

| 항목 | 상태 | 이 PR 에서 |
|---|---|---|
| model-api 평가셋 도구(`evalset/run.py` · `augment.py`)의 기본 경로가 `proto_type/src/app/evalset` | 11/18 에 추가된 실제 의존 · 이슈 없음 | **이미지 옮기고 기본 경로 변경** |
| 대역 구성(`deploy/compose.standin.yaml` · `model-standin.env`) · CI 의 대역 검사 · `.env.example` 주석 | v0.1.1 이미지에 의존 | **삭제** |
| Runbook 의 예비 시연(9503) 절차 · 대역 절 | proto_type 이 있어야 동작 | **폐지 기록으로 바꿈** |
| #139 funnel 기본 포트 9603 | 이미 반영됨(`de568cc`) · 이슈만 열림 | 주석만 정리 |
| #140 근거 스냅샷 · `check_errors.py` 기본 경로 | 이미 반영됨(PR #151) · 이슈만 열림 | 없음 |
| 계약 · 마이그레이션 · README 의 `proto_type` 언급 | 근거를 밝히는 주석 · 문서 (실행 경로 아님, #144 에서 0건 확인) | 그대로 둠 (원본은 태그 `v0.1.1`) |

## 3. 바꾼 것

| 파일 | 내용 |
|---|---|
| `api/services/model-api/evalset/data/real/` · `fake/` | v0.1.1 평가셋 이미지 56개(약 29MB)를 그대로 복사 (원본과 `diff -r` 같음). model-api 이미지에는 들어가지 않는다 (Dockerfile 은 `app` · `assets` 만 복사) |
| `api/services/model-api/evalset/run.py` · `augment.py` | 기본 경로를 `evalset/data` 로 |
| `api/services/model-api/tests/test_evalset*.py` | 건너뛸 때의 안내 문구 |
| `api/services/model-api/evalset/README.md` | 이미지 위치 설명 |
| `api/deploy/compose.standin.yaml` · `model-standin.env` | 삭제 |
| `.github/workflows/compose.yml` | 대역 구성 검사 단계 삭제 (기본 · demo 는 그대로) |
| `api/.env.example` | 대역 주석 3줄 삭제 |
| `api/deploy/README.md` | 「model-api 대역」 → 「v0.1.1 대역 · 예비 시연 폐지 (#145)」, 공개 포트 · 전환 · 재부팅 절차의 9503 부분을 폐지 기록으로, 참고 경로를 태그 `v0.1.1` 기준으로 |
| `api/deploy/funnel.ps1` | 머리 주석의 9503 예시 삭제 (코드는 그대로, 기본 9603) |

## 4. 확인한 것

- 평가셋 시험: `uv run --frozen pytest tests/test_evalset.py tests/test_evalset_augment.py` → **48 passed**. 이미지가 있어야 도는 두 시험(이미지 경로 · 실제 악보로 변형 생성)도 건너뛰지 않고 통과.
- Compose: `api/.env.example` 로 만든 자리 표시 `.env` 로 `docker compose -f compose.yaml config --quiet`(기본) · `--profile demo` 통과. 수정한 워크플로 YAML 이 읽힌다.
- `funnel.ps1` 이 PowerShell 파서로 오류 없이 읽힌다 (공개를 켜지는 않음).
- `proto_type/` 작업 폴더 = 태그 `v0.1.1` (`git diff v0.1.1 HEAD -- proto_type` 차이 없음). 태그 안 `proto_type/` 파일 567개.
- **압축본** `Klassic_proto_type_v0.1.1_빌드용_20261120.zip`: Git 이 추적하는 `proto_type/` 파일 572개 + `복원방법.md`, 약 85MB. 뺀 것은 `FluidR3_GM.sf2`(공개 배포처에서 다시 받음, 148MB)와 비밀값 `.env` · `.env.bak-*`. 팀이 만든 `gugak.sf2` 와 가공한 폰트는 넣었다.
- **압축본만으로 다시 빌드:** 임시 폴더에 풀고 `복원방법.md` 대로 FluidR3 를 인터넷에서 받아(해시 일치) 다른 이름(`protoverify/*:0.1.1-verify`)으로 빌드했다. 결과는 아래 표.

| 이미지 | 결과 |
|---|---|
| klassic-model-api | 빌드 성공 (319초, 1.96GB) |
| klassic-app (migrate 서비스가 빌드) | 빌드 성공 (990MB). 이미지 안에 백엔드 · 화면 빌드 결과가 있다 |
| 확인 | model-api 이미지 안에 사운드폰트 2개(크기 일치), `import app.main` 성공 |

- 압축본 SHA-256: `79df0304e2d103f010a3b92d3607c8b8f15a5f0ea59531a1ee29ad45fe02300f` (84,579,642 바이트). 같은 폴더에 `Klassic_proto_type_v0.1.1_복원방법.md` 도 따로 두었다.
- 시험용 이미지(`protoverify/*`)와 임시 폴더는 확인 뒤 지웠다.

## 5. 다음 단계 (이 PR 병합 뒤)

1. `proto_type/` 삭제 PR — `git rm -r proto_type`, 프로젝트 `CLAUDE.md` · 루트 `README.md` · `api/README.md` 의 「기준판 proto_type/」 표기를 태그 `v0.1.1` · 보관본 기준으로 고친다. 로컬의 비밀값 파일(`proto_type/.env` · `.env.bak-20261030`)은 압축본에 넣지 않았고 폴더와 함께 지운다.
2. 이미지 삭제 (로컬, 약 5GB): `klassic/klassic-app:0.1.1` · `klassic/klassic-model-api:0.1.1` · `klassic/klassic-engines-installer:0.1.0` · `:local`. 엔진 볼륨 `klassic_engines` 는 재구성판이 쓰므로 지우지 않는다.
3. #139 · #140 은 이미 반영된 상태라 닫을지 담당자(팀장)가 정한다.

## 6. 확인하지 못한 것

- 압축본으로 만든 이미지를 실제로 띄워 인식까지 해 보지는 않았다 (빌드까지만). 엔진은 `engines-installer` 가 인터넷에서 받으므로, 배포처가 바뀌면 그때는 받지 못할 수 있다 (추정).
- `vite.config.ts`(frontend, 담당자 파일)의 9503 주석은 고치지 않았다.
