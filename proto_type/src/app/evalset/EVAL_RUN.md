# 평가셋 일괄 실행 결과 (tasks T147 · T148)

- 평가셋: **HSH_조합B 대체(임시)** — 오선보 14장(MusicXML 5곡을 그려 만든 합성 이미지, 정답 음높이 `answers.json`) + 가짜 악보 20장. 정간보·손악보·실제 사진은 없다. **이 결과는 임시 기준선이다.** 인식 품질 최종 판정은 팀원이 준비할 진짜 평가셋 15종으로 다시 한다.
- 서버: pm2(web 26100 · admin 26101 · model-api 26110) · DB: 개인 개발 DB `app/.devdb`(gugak_dev). 팀 DB 아님.
- 실행: `GUGAK_OPERATOR=<개발 DB 운영자> GUGAK_OPERATOR_PW=… uv run --project ../model-api python run.py --all --timeout 900` → `score_pitch.py --markdown`, `compare_web_api.py --key <외부 키>`
  - 모든 요청이 127.0.0.1 한 주소에서 나가 시간당 접수 상한(FR-062, 10건)에 걸리므로, 실행하는 동안만 상한을 1000으로 올렸다가 끝에 10으로 되돌렸다(개발 DB 운영자 `hsh-eval`). 키 신청 빈도 제한(G11)도 키 1개를 받는 동안만 올렸다가 3으로 되돌렸다.
- 음높이 일치율: 결과 MusicXML 의 음높이(MIDI 번호) 순서와 정답의 difflib 유사도. 리듬은 보지 않는다. 정상 변환 = 경로 recognize + 일치율 80% 이상.

## 1차 — 2026-09-29 오전 (구조 확인 보완 T153 전 코드)

| 지표 | 결과 | 기준 |
|---|---|---|
| SC-001 결과 없이 끝난 요청 | **0** | 0 |
| SC-004 기록이 빠진 요청 | **0** | 0 |
| SC-012 정간보 정상 변환 비율 | 측정 못 함(정간보 이미지 없음) | |
| SC-015 웹·API 결과 차이(오선보 14장) | **0건** | 0 |
| SC-016 가짜 악보가 '신뢰'로 나간 수 | **0 / 20** | 0 |
| 가짜 악보가 구조 확인에서 걸러진 수 | 19 / 20 — F10(빈 오선지+마디줄)은 구조 확인을 통과해 엔진이 180초 제한에 걸린 뒤 대체(TIMEOUT) | |
| SC-017 진짜 악보 오차단 | **5 / 14 (36%)** — 기울임·원근·흐림·혼합·어려움 사진 S06·S08·S09·S10·S13 이 구조 확인 점수 0 으로 대체 | |
| 오선보 정상 변환 | **9 / 14** — 인식된 9장은 모두 homr, 음높이 100% 일치 | |

`v_eval_metrics` 의 SC-017 값(0.375)은 한도에 걸린 첫 실행 10건까지 합친 값이라 쓰지 않았다. 위 표는 항목마다 가장 최근 실행만 셌다.

| 파일 | 경로 | 대체 이유 | 등급 | 엔진 | 음 수(인식/정답) | 일치율 | 정상 |
|---|---|---|---|---|---|---:|:--:|
| S01_clean_arirang.png | recognize | - | trust | homr | 84/84 | 100% | O |
| S02_clean_doraji.png | recognize | - | trust | homr | 76/76 | 100% | O |
| S03_clean_ongheya.png | recognize | - | trust | homr | 68/68 | 100% | O |
| S04_clean_bach66.png | recognize | - | trust | homr | 35/35 | 100% | O |
| S05_clean_bach7.png | recognize | - | trust | homr | 52/52 | 100% | O |
| S06_photo_rot3_arirang.jpg | fallback | no_structure | - | - | 0/84 | - | X |
| S07_photo_shadow_doraji.jpg | recognize | - | trust | homr | 76/76 | 100% | O |
| S08_photo_persp_ongheya.jpg | fallback | no_structure | - | - | 0/68 | - | X |
| S09_photo_blur_bach66.jpg | fallback | no_structure | - | - | 0/35 | - | X |
| S10_photo_mix_bach7.jpg | fallback | no_structure | - | - | 0/52 | - | X |
| S11_lowres_arirang.jpg | recognize | - | trust | homr | 84/84 | 100% | O |
| S12_lowres_doraji.jpg | recognize | - | trust | homr | 76/76 | 100% | O |
| S13_hard_ongheya.jpg | fallback | no_structure | - | - | 0/68 | - | X |
| S14_single_line_arirang.png | recognize | - | trust | homr | 21/21 | 100% | O |

정상 변환(recognize + 일치율 80% 이상): 9/14

## 2차 — 2026-09-29 11:30 무렵 (T149·T150·T151·T153·T154 + 임의석 님 웹 MP3 수정 반영, 웹 다시 빌드·서버 3개 재기동 뒤)

평가셋 변화: 조성기 님이 11:09에 실제 가짜 사진 20장(P01~P20, 짧은 변 1000px 확대본)을 추가해 **가짜 40장**(합성 F01~F20 + 실사진 P01~P20)으로 돌았다. 진짜 오선보 14장은 같다.

| 지표 | 1차 | **2차** | 기준 |
|---|---|---|---|
| SC-001 결과 없이 끝난 요청 | 0 | **0** | 0 |
| SC-004 기록이 빠진 요청 | 0 | **0** | 0 |
| SC-016 가짜 악보가 '신뢰'로 나간 수 | 0 / 20 | **0 / 40** | 0 |
| 가짜가 구조 확인에서 걸러진 수 | 19 / 20 | **38 / 40** — 나머지 2장(P11·P12 빈 오선지 사진)은 homr '음표 없음' 뒤 3초 남짓에 NO_NOTES 로 대체(T154). 전에는 다음 엔진으로 넘어가 180초 시간 초과였다 | |
| SC-017 진짜 악보 오차단 | 5 / 14 | **0 / 14** (T153) | |
| 오선보 정상 변환 | 9 / 14 | **14 / 14** — 모두 homr, 음높이 100% | |
| SC-012 정간보 | 측정 못 함 | 측정 못 함(정간보 이미지 없음) | |
| quickstart | 15 / 17 | **16 / 17** — Q16 이 평가 결과로 판정하게 고침. Q8(브라우저 편집 복원)만 남음 | |

| 파일 | 경로 | 대체 이유 | 등급 | 엔진 | 음 수(인식/정답) | 일치율 | 정상 |
|---|---|---|---|---|---|---:|:--:|
| S01_clean_arirang.png | recognize | - | trust | homr | 84/84 | 100% | O |
| S02_clean_doraji.png | recognize | - | trust | homr | 76/76 | 100% | O |
| S03_clean_ongheya.png | recognize | - | trust | homr | 68/68 | 100% | O |
| S04_clean_bach66.png | recognize | - | trust | homr | 35/35 | 100% | O |
| S05_clean_bach7.png | recognize | - | trust | homr | 52/52 | 100% | O |
| S06_photo_rot3_arirang.jpg | recognize | - | trust | homr | 84/84 | 100% | O |
| S07_photo_shadow_doraji.jpg | recognize | - | trust | homr | 76/76 | 100% | O |
| S08_photo_persp_ongheya.jpg | recognize | - | trust | homr | 68/68 | 100% | O |
| S09_photo_blur_bach66.jpg | recognize | - | trust | homr | 35/35 | 100% | O |
| S10_photo_mix_bach7.jpg | recognize | - | trust | homr | 52/52 | 100% | O |
| S11_lowres_arirang.jpg | recognize | - | trust | homr | 84/84 | 100% | O |
| S12_lowres_doraji.jpg | recognize | - | trust | homr | 76/76 | 100% | O |
| S13_hard_ongheya.jpg | recognize | - | trust | homr | 68/68 | 100% | O |
| S14_single_line_arirang.png | recognize | - | trust | homr | 21/21 | 100% | O |

정상 변환(recognize + 일치율 80% 이상): 14/14
