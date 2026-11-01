# 예시 악보 출처 (#34)

이 폴더는 **서버 전용**이다. 이미지 안에만 있고 정적 공개 경로가 없다. 서버가 `examples.json` 의 id 로만 접수하고, 미리보기(`thumbs/`, 짧은 변 200px)는 로그인한 사용자에게 API 로 보인다. 원본 기록은 `proto_type/src/app/assets/examples/SOURCES.md`.

| id · 파일 | 종류 | 곡 | 출처 |
|---|---|---|---|
| `arirang-semachi-staff` · `arirang-semachi-staff.png` | 오선보 | 아리랑(공개 영역 민요, 세마치 9/8) | 박예은 국악 검수 악보를 music21 → Verovio 로 그림 |
| `arirang-98-staff` · `arirang-98-staff-1000.jpg` | 오선보 | 아리랑(공개 영역 민요, 가사 있음) | 박예은 제공 사진을 늘린 사본. **판면 출처 · 이용 조건 확인 필요** |
| `minuet-staff` · `minuet-staff-1000.jpg` | 오선보 | Minuet in G(공개 영역 곡) | 박예은 제공 사진을 늘린 사본. **판면 출처 · 이용 조건 확인 필요** |
| `taryeong-gayageum-jeongganbo` · `taryeong-gayageum-jeongganbo.pdf` | 정간보(PDF 2쪽) | 평조회상 「타령」 | 국립국악원 「2021 가야금정악보」(2015, © 국립국악원) 96~97쪽, 박예은 제공. v0.1.1 파일 이름은 `2021 가야금정악보.pdf` |

`../templates/` 는 인식이 안 될 때 주는 대체 악보로, DB `fallback_template` 의 `assets/templates/...` 가 가리킨다.
