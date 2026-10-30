# PDF 악보 글꼴 (2026-09-30 황송해 — 모델 API PDF 렌더러 `model-api/app/render/pdf.py`)

Verovio SVG → svglib/reportlab 로 PDF 를 만들 때 쓴다. 이 글꼴이 없으면 한글·한자·SMuFL 글자(빠르기표 ♩ 등)가 검정 네모(■)로 깨진다.

| 파일 | 원본 | 라이선스 | 비고 |
|---|---|---|---|
| `NotoSerifKR-Regular.ttf` | google/fonts `ofl/notoserifkr/NotoSerifKR[wght].ttf` (Adobe · Google, noto-cjk) | SIL OFL 1.1 (`OFL-NotoSerifKR.txt`, 예약 이름 없음) | fontTools 로 wght=400 정적 인스턴스 + 라틴·문장부호·한글·한자(CJK 통합 한자 · 호환 한자) 부분집합(20,810자). 악보 글자(제목·악기 이름·빠르기말)용 |
| `Leipzig.ttf` | rism-digital/verovio `fonts/Leipzig/Leipzig.ttf` (v5.2.102, 고치지 않음) | SIL OFL 1.1 (`OFL-Leipzig.txt`, 예약 이름 "Leipzig") | Verovio 기본 SMuFL 음악 글꼴. 글자 속 음악 기호(빠르기표 음표 등)용 |
