# quickstart 동작 확인 결과 (tasks T144)

- 실행: 2026-09-29 16:34 ~ 16:35 · 서버: pm2(web 26100 · admin 26101 · model-api 9543 · 입구 9503) · DB: app/.env (gugak_dev)
- 평가셋 15종이 아직 없어 이미지는 shared/fixtures/upload 의 합성 이미지를 썼다. 인식 품질(정확도)은 이 결과로 판단하지 않는다.

| # | 시나리오 | 결과 | 내용 |
|---|---|---|---|
| Q1 | 오선보 이미지 → 악보 | 통과 | 경로 recognize · 등급 trust · 엔진 homr 0.7.0 · 대체 None · 파트 1개 |
| Q2 | 정간보 이미지 | 통과 | 경로 recognize · 등급 caution · 대체 None (합성 이미지 — 결과 품질 판단 불가) |
| Q3 | 모델 API 멈춤 | 미확인·실패 | --stop-model-api 없이 실행해 건너뜀 |
| Q4 | 공책 사진 → 대체 | 통과 | 대체 NO_SCORE_STRUCTURE · 안내 '악보 사진을 다시 올려 보세요.' |
| Q5 | 잘못된 파일 반려 | 통과 | {'text.txt': 'UPLOAD_UNSUPPORTED_TYPE', 'broken.png': 'UPLOAD_CORRUPTED', 'small_600.png': 'UPLOAD_RESOLUTION_TOO_LOW', 'big_25mb.png': 'UPLOAD_TOO_LARGE', '두 파일': 'UPLOAD_TOO_MANY_FILES'} |
| Q6 | 웹 MIDI·MusicXML 반려(사진·PDF 만 받음) | 통과 | .mid HTTP 415 · .musicxml HTTP 415 · UPLOAD_UNSUPPORTED_TYPE · '받을 수 없는 파일 형식이에요.' · 고치는 방법 'PNG·JPG(JPEG)·WEBP 악보 사진이나 PDF 한 개로 다시 올려 주세요. MIDI·MusicXML은 받지 않아요.' |
| Q7 | 추천 국악기 조합 | 통과 | 추천 있음 · 모델 rules · 대기 True · 조합 ['풍물 가락', '가야금 빠른 가락', '대금·장구'] · 선택 기록 204 |
| Q8 | 강제 종료 뒤 편집 복원 | 미확인·실패 | 브라우저가 필요 — frontend/tests/e2e/us6_restore.md 점검표로 사람이 확인 |
| Q9 | 편집 후 내려받기 | 통과 | midi ready(, 638B) · musicxml ready(, 8543B) · mp3 ready(fluidsynth 2.4.8+lame3.100, 625684B) · pdf ready(verovio 6.3.0-425dd7b, 9478B) |
| Q10 | 사용자 음원 — 제거됨(US8 삭제) | 통과 | .sf2 올리기 404(404 여야 함) · 악기 목록 custom 없음 · 나가기 204 |
| Q11 | 키 신청 → 연주 API(PDF) · MIDI 반려 | 통과 | 메뉴 서버 running/live 엔드포인트 12개 · 키 gk_py4yy… · .mid HTTP 415 UPLOAD_UNSUPPORTED_TYPE · PDF 요청 R-0929-QCH2MS4B completed · 안내 'PDF 첫 쪽만 변환했어요 (전체 2쪽)' · MP3 제외 True · MIDI 받기 200 · 4.7초 |
| Q12 | 신청 빈도 제한 | 통과 | 2~4번째 [429, 429, 429], 5번째 APPLICATION_RATE_LIMITED · 다시 신청 2026-09-29T08:47:12.561Z |
| Q13 | 키 없음·틀린 키 | 통과 | 키 없음 401 AUTH_KEY_MISSING · 틀린 키 401 AUTH_KEY_INVALID (폐기·한도 초과는 자동 시험 test_auth_limits 로 확인) |
| Q14 | 웹·API 결과 일치(시험 이미지 2장) | 통과 | 차이 0건 |
| Q15 | 관리자 로그인·설정 반영 | 통과 | 지표 전체 이미지 요청 258건 · 새 판본 61 반영 applied · 새 요청 R-0929-JV6KCT6D 기록됨 True · 모델 상태 {'jeongganbo-omr': 'ready', 'audiveris': 'ready', 'homr': 'ready', 'oemer': 'unavailable', 'llm-gemma3-4b': 'ready', 'rules': 'ready'} |
| Q16 | 평가셋 일괄 실행 | 통과 | manifest 54개 중 실행 결과 54개(진짜 14 · 가짜 40) · 결과 없음 0 · 기록 빠짐 0 · 가짜 '신뢰' 0 · 진짜 오차단 0/14 (평가는 run.py --all, 음높이는 score_pitch.py — EVAL_RUN.md) |
| Q17 | 24시간 만료 | 통과 | R-0929-EPHEC5A7 만료 판정 1 (화면 문구·410 은 자동 시험 jobs.test 로 확인) |
| Q18 | PDF 올리기(웹) — 첫 쪽만 변환 안내 · 암호 PDF 반려 | 통과 | 요청 R-0929-T3JHXEGS completed · 경로 recognize · 대체 None · 안내 'PDF 첫 쪽만 변환했어요 (전체 2쪽)' · 암호 PDF HTTP 422 UPLOAD_CORRUPTED |
