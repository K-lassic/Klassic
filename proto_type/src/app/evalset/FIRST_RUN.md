# 첫 활동 확인 결과 (T042 · research R22 · SC-012)

- 날짜: 2026-09-28
- 실행: `cd app/model-api && uv run python -m app.engines.selftest ../shared/fixtures/upload/ok_staff.png ../shared/fixtures/upload/ok_jeongganbo.png --timeout 900 --json`
- 서버: 팀 Mac(arm64), 엔진 폴더 `~/gugak-engines/<이름>` (설치 스크립트 `app/ops/engines/install_*.sh`)
- **주의: 진짜 평가 이미지(평가셋 15종)는 아직 `app/evalset/real/` 에 없다.** 아래는 합성 시험 그림 2장(업로드 공용 시험 파일)으로 "엔진이 끝까지 도는지"만 본 결과이며, 인식 품질 판정(정상 변환 비율)은 평가셋이 들어온 뒤 `evalset/run.py` 로 다시 해야 한다.

## 1. 설치 상태

| 엔진 | 폴더 | 판(VERSION) | 설치 | 불러오기(warmup) | 비고 |
|---|---|---|---|---|---|
| homr | `~/gugak-engines/homr` | 0.7.0 | 이 작업에서 설치(`install_homr.sh`, Python 3.11, uv.lock, 가중치 `--init`) | 0.5초 | 0.7.0 에는 `--no-title` 선택지가 없어 쓰지 않는다 |
| oemer | `~/gugak-engines/oemer` | 0.1.8 | **다른 팀원이 먼저 설치**(16:01, VERSION 도장 없음 → pip 메타데이터로 판 읽음). 이 작업은 건드리지 않고 확인만 | 0.2초 | 체크포인트(onnx) 있음 |
| audiveris | `~/gugak-engines/audiveris` | 5.11.0 | 이 작업에서 설치(`install_audiveris.sh`, macOS DMG 의 Audiveris.app) | 0.4초 | 5.11 은 Java 25 빌드(class 69) → **PATH 밖 Java 21 로는 실행 불가**. 앱에 든 Java 25.0.3 런타임으로 실행 |
| jeongganbo-omr | `~/gugak-engines/jeongganbo` | jeongganbo-omr@e95045f+ckpt-v1.0.0 | 이 작업에서 설치(`install_jeongganbo.sh`, Python 3.8.20, 저자 Pipfile.lock 핀 그대로, 가중치 v1.0.0) | 2.0초 | MPS(Mac GPU)로 추론, 안 되면 CPU 로 되돌아감 |

렌더러(참고): Verovio 6.3.0(PDF, 동작), MuseScore 없음, FluidSynth 2.4.8(`~/gugak-engines/render/bin` — 팀원이 받아 둔 conda 판) + lame 3.100(`/opt/homebrew/bin`) + 음원 `~/gugak-engines/soundfonts/FluidR3Mono_GM.sf3` 로 MP3 실제 생성 확인. `app/assets/soundfonts/gugak.sf2` 는 아직 없다.

## 2. 합성 시험 그림 결과

| 엔진 | 입력 | 결과(outcome) | 음 개수 | 걸린 시간 | 구조 확인 | 타당성 |
|---|---|---|---|---|---|---|
| homr | ok_staff.png (Verovio 로 그린 3/4 선율 16마디, 2126×3008) | **success** | 42 / 42, 음높이 42개 모두 원본과 같음 | 8.4초 | pass (staff 1.0) | trust (1.0) |
| oemer | ok_staff.png | **error** `ENGINE_EXIT_1` | 0 | 158.7초 | pass | - |
| audiveris | ok_staff.png | **success** | 42 / 42, 음높이 모두 같음 | 8.3초 | pass | trust (1.0) |
| jeongganbo-omr | ok_jeongganbo.png (합성 정간 240칸, 컴퓨터 글꼴 율명, 2200×3091) | **success** (끝까지 돎) | 167 | 4.2초 | pass (jeongganbo 1.0) | **caution** (0.59, yulmyeong_ratio 0.39) |

- **oemer**: 쪽 전체(여백 많은 A4)에서 오선 추출 단계 assert 로 멈췄다(`staffline_extraction.py: assert line.label == LineLabel(lid)`). 악보 부분만 잘라(2126×752) 직접 돌리면 2분 48초 걸려 음 40개를 냈다. → 느리고 입력에 민감하다. 2순위 유지는 가능하지만 제한 시간 안에 끝나기 어렵다.
- **jeongganbo-omr**: 칸 찾기(240칸 모두)와 인식·변환은 끝까지 돌았다. 그러나 합성 그림의 율명은 컴퓨터 글꼴(애플 SD 산돌고딕)로 그린 것이라 모델이 대부분 `리`·`퇴성` 같은 시김새로 읽었다(율명으로 읽힌 칸 39%). 이것은 모델이 국립국악원 인쇄본 글자로 학습했기 때문이며, **정간보 인식 품질은 이 결과로 판정할 수 없다** — 국립국악원 판형의 실제 정간보 쪽으로 다시 재야 한다. 타당성 확인이 이 결과를 `caution` 으로 낮춘 것은 의도대로다.
- 모든 엔진은 하위 프로세스로 부르고, 마감 시각에 프로세스 묶음째 끊는다(단위 시험으로 확인).

## 3. 첫 활동 판정(잠정)

- **오선보: 된다.** homr(1순위)·Audiveris 가 합성 오선보를 끝까지 정확히 변환했다. 오선보 엔진 순서는 homr → audiveris → oemer 를 권한다(oemer 는 느리고 위처럼 실패가 잦다 — 설정 변경은 팀장 결정).
- **정간보: 엔진은 돈다, 품질은 미판정.** 평가셋 정간보(국립국악원 인쇄본)로 정상 변환 비율을 재기 전까지 범위 재설정(정간보 → 대체 경로)은 보류한다.
- 다음 할 일: 평가셋 15종을 `app/evalset/real/` 에 넣고 `evalset/run.py` 로 엔진별 정상 변환 비율·장당 시간을 잰다(SC-012).

---

## 4. 2026-09-29 — T042 재판정: oemer (T149)

- 실행: `cd app/model-api && uv run python -m app.engines.selftest <오선보> <같은 그림> --only oemer --timeout 900` (음높이 일치율은 결과 MusicXML 을 `HSH_조합B/evalset/answers.json` 의 `staff` 정답과 difflib 로 비교 — `score_pitch.py` 와 같은 방식)
- 설치는 그대로(`~/gugak-engines/oemer`, oemer 0.1.8, onnxruntime 1.19.2). 설치 폴더는 건드리지 않았다.

### 원인

1. **9/28 의 `ENGINE_EXIT_1` 은 어댑터 탓이 아니라 입력 그림 탓이다.** 같은 `ok_staff.png` 를 팀원 시험 스크립트와 똑같이 `oemer -o <폴더> <그림>` 으로 바로 돌려도 158초 뒤 같은 `staffline_extraction.py:395 assert line.label == LineLabel(lid)` 로 멈췄다. 팀원 스크립트(`HSH_조합B/scripts/run_oemer_batch.py`)는 이 그림을 돌린 적이 없고, 그쪽에서도 오선 줄이 적은 S09(흐린 사진)·S14(한 줄 악보)는 같은 종류의 오류로 실패했다. 어댑터와 스크립트의 부르는 방식(같은 실행 파일·인자, 임시 폴더·`input.png` 이름·새 세션·파이프)은 결과에 영향이 없었다.
2. **서비스 안에서 실제로 막히는 것은 속도다.** oemer 0.1.8 은 macOS 에서 onnxruntime 을 늘 `CoreMLExecutionProvider` 로 연다(모델 노드 1577개 중 약 100개만 CoreML, 나머지는 CPU 로 오감). Mac GPU 를 다른 프로그램(Ollama llama-server 등)이 쓰는 동안에는 첫 단계만 7분이 넘어, 옛 어댑터로 S01 을 돌리니 **600초 제한에 `timeout`** 이 났다(팀원 일괄 실행 때는 GPU 가 한가해서 장당 2분).
   - 같은 부하에서 S04 를 나란히 잰 결과: CoreML 628.6초 / **CPU 만 235.5초**(결과 같음).

### 고친 것

- `app/model-api/app/engines/runners/oemer_runner.py`(새 파일): oemer 가상환경 파이썬으로 돌며 `onnxruntime.InferenceSession` 을 CPU 전용으로 바꿔 끼운 뒤 `oemer.ete.main()` 을 그대로 부른다.
- `app/model-api/app/engines/oemer.py`: `<venv>/bin/oemer` 대신 `<venv>/bin/python -B runners/oemer_runner.py --provider cpu <그림> -o <폴더>` 로 부른다. 설정 `config_json` 에 `"provider":"coreml"`(예전 방식)·`"threads":N`(스레드 수)을 줄 수 있다. 설치 확인·워밍업은 그대로.
- `tests/unit/test_engines.py`: 명령 구성 시험 1개 추가.
- 원본: `backup/원본_20260929_HSH_T149_oemer/`

### 결과 (고친 뒤, 서버 부하 평균 15~40 — 다른 평가·Ollama 가 같이 돎)

| 그림 | 결과(outcome) | 음 개수(인식/정답) | 음높이 일치율 | 걸린 시간 | 타당성 |
|---|---|---|---:|---:|---|
| S01_clean_arirang.png | **success** | 84/84 | 100.0% | 458.5초 | distrust |
| S02_clean_doraji.png | **success** | 76/76 | 100.0% | 413.1초 | distrust |
| S04_clean_bach66.png | **success** | 34/35 | 52.2% | 367.2초 | distrust |
| S08_photo_persp_ongheya.jpg | **success** | 67/68 | 90.4% | 371.0초 | distrust |
| ok_staff.png (합성, A4 에 악보 조금) | error `ENGINE_EXIT_1` | 0 | - | 154.0초 | - |

- 음높이는 팀원 일괄 실행 결과와 같다(S01·S02 100%, S04 52.2%, S08 90.4%). 즉 **서비스 어댑터로도 같은 인식 결과가 나온다.**
- ok_staff.png 는 oemer 자체의 한계(위 1). 여백을 잘라 넣으면 끝까지 돌지만(184초, 음 35개) 높은음자리표를 낮은음자리표로 읽어 음높이가 모두 틀렸다. S14 도 잘라 넣으면 돌지만 일치율 76.5%. → 자동 자르기는 넣지 않았다.
- 타당성 확인이 정답과 100% 같은 결과까지 `distrust` 로 매긴다 — oemer 가 신뢰도를 내지 않기 때문인지 따로 봐야 한다(이 작업 범위 밖).

### 판정

- **oemer: 돈다(어댑터 수정 후 서비스 경로에서 success, 음높이 팀원 결과와 같음).** 다만 장당 2분(한가할 때)~7분(부하 있을 때) 걸려 **처리 시간 제한 180초 안에는 끝나기 어렵다.** 오선보 순서에서 3순위(homr → audiveris → oemer) 또는 제한 시간 조정은 팀장 결정.
