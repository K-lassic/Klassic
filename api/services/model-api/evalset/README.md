# 인식 평가 도구 (evalset/)

엔진 판을 올리거나 전처리 · 검사 기준을 바꾼 뒤 **"전보다 나빠지지 않았는가"**를 숫자로 확인한다.
v0.1.1 의 `proto_type/src/app/evalset`(run.py · score_pitch.py)을 `api/` 기준으로 옮긴 것이다.

> **구조에서의 위치** — 서비스가 아니다. 이미지에 들어가지 않는다 (`Dockerfile` 은 `app/` · `assets/` 만 복사한다).
> `run.py` 만 model-api 를 HTTP 로 부르고(`POST /v1/omr/{staff|jeongganbo}`), 나머지는 그 응답을 저장한 파일만 읽는다.
> DB 를 직접 읽지 않는다.

## v0.1.1 과 달라진 것

| | v0.1.1 | 여기 |
|---|---|---|
| 보내는 곳 | 웹(`/api/requests`) → 끝날 때까지 상태를 물어봄 | model-api `/v1/omr/*` 한 번 (응답에 결과가 다 온다) |
| 결과를 읽는 곳 | DB (`eval_item` · `eval_run_result` · `v_eval_metrics`) | `run.py` 가 남긴 JSON 파일 |
| 채점 | 일치율(difflib) 하나 | 일치율 + 빠짐 · 지어냄 · 틀림 · 옥타브 오류 · 전체 밀림 |
| 예전 결과와 견주기 | 문서(EVAL_RUN.md)를 눈으로 | `--baseline` — 나빠지면 종료 코드 1 |
| 다시 채점 | 다시 돌려야 함 | 저장된 응답으로 언제든 (엔진 없는 PC 에서도) |

일치율의 정의(difflib 시퀀스 유사도)와 정상 변환 기준(80%)은 **그대로 두었다** — 바꾸면 예전 결과와 견줄 수 없다.
웹을 거치지 않으므로 v0.1.1 의 SC-001(결과 없이 끝난 요청) · SC-004(기록 빠짐) · SC-015(웹 · API 차이)는 여기서 재지 않는다.

## 쓰는 법

```bash
cd api/services/model-api

# 1) 보내기 — 실제 인식이 돈다 (54장, 몇 분 ~ 십몇 분). 키는 환경변수로만.
EVAL_API_KEY=<서비스 키> uv run python -m evalset.run \
    --base-url http://127.0.0.1:9543/api --out evalset/results/2026-11-18

# 2) 채점 — REPORT.md · summary.json 을 결과 폴더에 남긴다
uv run python -m evalset.report evalset/results/2026-11-18

# 3) 예전 결과와 견주기 — 지표가 나빠졌거나 정상이던 악보가 빠지면 종료 코드 1
uv run python -m evalset.report evalset/results/2026-11-25 \
    --baseline evalset/results/2026-11-18/summary.json

# 4) 타당성 판정(신뢰 · 주의 · 불신)의 경계 · 가중치가 맞는지 — 제안만 한다, 아무것도 안 고친다
uv run python -m evalset.calibrate evalset/results/2026-11-18
```

- **운영 DB 말고 시험용 프로젝트에서 돌릴 것.** model-api 가 요청마다 API 요청 기록을 남긴다.
- 외부 키는 시간당 한도에 걸린다. 서비스 키로 돌리거나 한도를 잠시 올린다.
- `run.py` 는 이미 결과가 있는 항목을 건너뛴다. 중간에 끊겨도 다시 실행하면 이어서 한다 (`--force` 로 처음부터).
- `evalset/results/` 는 저장소에 올리지 않는다 (응답의 MusicXML 이 들어 있어 크다). 견줄 기준으로 남기려면 `summary.json` 만 따로 둔다.

## 평가셋

| | 장수 | 무엇 |
|---|---|---|
| 진짜 (`real`) | 14 | MusicXML 5곡(아리랑 · 도라지 · 옹헤야 · 바흐 2곡)을 그려 만든 **합성 오선보** — 깨끗한 것 · 기울임 · 그림자 · 원근 · 흐림 · 저해상도 |
| 가짜 (`fake`) | 40 | 합성 20(백지 · 공책 · 원고지 · 표 · 문서 …) + 실제 사진 20 |

목록은 `data/manifest.json`, 정답 음높이는 `data/answers.json`.
이미지는 `data/real` · `data/fake` 에 있다 (약 29MB). `proto_type` 을 치우면서 v0.1.1 의 `proto_type/src/app/evalset` 에서 그대로 옮겼다 (#145, 2026-11-20).
`run.py --images` 와 `augment.py --source` 의 기본값이 `data/` 다. 이미지는 model-api 이미지에 들어가지 않는다 (Dockerfile 은 `app` · `assets` 만 복사).

**이 평가셋은 임시다.** 정간보 · 손으로 쓴 악보 · 실제 휴대폰 촬영본이 없다. 그래서

- 정간보 엔진은 전혀 재지 못한다.
- 오선보 14장은 v0.1.1 에서 전부 100% 였다. 엔진이 조금 나빠져도 여기서는 안 보일 수 있다 — **어려운 악보를 더 모아야 회귀를 잡는 도구가 된다.**

## 어려운 평가셋 만들기 (`augment.py`)

지금 오선보는 다 맞는 시험지라 엔진이 조금 나빠져도 안 보인다. 정답이 있는 깨끗한 악보 6장(S01~S05 · S14)을
**세기를 올려 가며** 망가뜨려, 정답은 그대로 쓰면서 "어디서부터 못 읽는가"를 잰다.

```bash
uv run python -m evalset.augment --out evalset/results/aug            # 6장 → 132장 (7종류 × 세기 3 + 원본)
EVAL_API_KEY=… uv run python -m evalset.run --base-url …     --images evalset/results/aug --manifest evalset/results/aug/manifest.json --out evalset/results/aug-run
uv run python -m evalset.report evalset/results/aug-run --answers evalset/results/aug/answers.json
```

| 종류 | 세기 1 · 2 · 3 |
|---|---|
| `rotate` 기울임 | 1.5° · 3° · 6° |
| `persp` 원근 | 위쪽 모서리를 2% · 4% · 8% 안으로 |
| `blur` 흐림 | 반지름 1 · 2 · 3.5px |
| `noise` 잡음 | 표준편차 8 · 16 · 30 |
| `shadow` 그림자 | 한쪽이 25% · 45% · 65% 어두워짐 |
| `lowres` 저해상도 | 짧은 변 1000 · 800 · 600px |
| `jpeg` JPEG 압축 | 품질 50 · 30 · 15 |

`report.py` 가 「변형별 정상 변환」 표를 낸다 (`rotate1 6/6 · rotate2 5/6 · rotate3 1/6` 처럼).
같은 `--seed` 면 같은 그림이 나오므로 만든 그림은 저장소에 올리지 않는다. 132장을 다 돌리면 십몇 분 걸린다 —
`--kinds rotate lowres --levels 2 3` 처럼 줄여 돌릴 수 있다.

합성한 망가짐이라 실제 휴대폰 사진(구겨짐 · 반사 · 손가락)을 대신하지는 못한다.

## 보정 도구(`calibrate.py`)를 믿어도 되는가

지금 평가셋으로는 **아니다.** 타당성 판정까지 간 항목 중 '나쁜 결과'가 몇 건 안 된다 (가짜는 대부분 인식 전에 걸러진다).
좋음 · 나쁨이 각각 20건이 안 되면 도구가 `⚠ 표본이 적습니다` 를 찍는다. 그때의 제안은 방향만 참고한다.

쓸모 있게 만들려면 잘못 인식된 사례(일치율 80% 미만인 진짜 악보, 인식되어 버린 가짜)를 평가셋에 모아야 한다.
도구가 하는 계산(지금 가중치의 AUC, 경계 제안, 가중치 탐색과 한 건씩 빼는 검증)은 `tests/test_evalset.py` 가
가짜 자료로 확인한다 — 신호가 있으면 찾고, 없으면 "나아진다고 볼 근거가 없습니다"라고 말하는지.

## 확인된 것 / 안 된 것 (2026-11-18)

- `tests/test_evalset.py` · `tests/test_evalset_augment.py` 48개 통과 — 채점 · 일괄 실행(가짜 model-api) · 보고 · 보정 · 평가셋 만들기.
- **실제 model-api · 엔진으로는 한 번도 돌려 보지 못했다.** 작성한 PC 에 Docker · 엔진 볼륨이 없었다.
  `run.py` 의 요청 모양(`image` 파일 필드, `X-API-Key`)과 응답 필드는 `app/routers/omr_staff.py` · `app/schemas.py` 를 보고 맞췄다.
  처음 돌릴 때 확인할 것: 가짜 악보가 200 + `fallback` 으로 오는지 4xx 로 거절되는지 (둘 다 '걸러짐' 으로 세도록 해 두었다).
