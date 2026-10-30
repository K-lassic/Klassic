# 사이트 글꼴 (2026-09-30 황송해 결정 — 스타일가이드 §3-4, 예스 명조 대신)

| 파일 | 원본 | 라이선스 | 고친 것 |
|---|---|---|---|
| `GugakBuri-Regular.core.woff2` · `GugakBuri-Regular.rest.woff2` | 네이버 **마루 부리**(MaruBuri) Regular — 네이버 한글한글 아름답게 공식 웹폰트 `https://hangeul.pstatic.net/hangeul_static/webfont/MaruBuri/MaruBuri-Regular.ttf` | SIL OFL 1.1 (`OFL-MaruBuri.txt`, © NAVER Corp. · NAVER Cultural Foundation) — 상업 · 웹 임베딩 · 수정 · 재배포 허용(글꼴 단독 판매 금지) | fontTools 로 둘로 나눔: **core** = 라틴 · 문장부호 · 기호(■ ▶ ♥ 등) · 한글 자모 · 자주 쓰는 한글 2,350자(KS X 1001), **rest** = 나머지 한글 8,822자. 화면에 나온 글자에 따라 브라우저가 필요한 파일만 받는다(`unicode-range`). 고친 판이라 글꼴 이름을 `GugakBuri` 로 바꿨다 |
| `GugakBuri-Bold.core.woff2` · `GugakBuri-Bold.rest.woff2` | 같은 곳 `MaruBuri-Bold.ttf` | 같음 | 같음 |

- 첫 화면에서 보통 받는 양: Regular core 약 167KB + Bold core 약 179KB(굵은 글자가 있을 때). 드문 한글이 나오면 rest(약 130~144KB)를 더 받는다. 전(예스 명조)은 7.5MB + 8.2MB 였다.
- 한자는 마루 부리에 없어 Noto Serif KR · 시스템 글꼴로 이어 보인다.

## 로고 글자 (2026-10-01 황송해 203번 — 스타일가이드 §5)

| 파일 | 원본 | 라이선스 | 고친 것 |
|---|---|---|---|
| `KlassicWordmark.woff2` (약 2.6KB) | 네이버 **나눔명조**(Nanum Myeongjo) Regular `NanumMyeongjo-Regular.ttf` | SIL OFL 1.1 (`OFL-NanumMyeongjo.txt`, © NAVER Corp.) | fontTools `pyftsubset --text=Klassic` 로 7글자(K l a s i c)만 남기고 woff2 로. 고친 판이라 글꼴 이름을 `KlassicWordmark` 로 쓴다. 로고 글자에만 쓴다 |
