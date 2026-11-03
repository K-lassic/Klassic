# 예시 악보 출처 (#34)

이 폴더는 **서버 전용**이다. 이미지 안에만 있고 정적 공개 경로가 없다. 서버가 `examples.json` 의 id 로만 접수하고, 미리보기(`thumbs/`, 짧은 변 200px)는 로그인한 사용자에게 API 로 보인다. 원본 기록은 `proto_type/src/app/assets/examples/SOURCES.md`.

| id · 파일 | 종류 | 곡 | 출처 |
|---|---|---|---|
| `arirang-semachi-staff` · `arirang-semachi-staff.png` | 오선보 | 아리랑(공개 영역 민요, 세마치 9/8) | 박예은 국악 검수 악보를 music21 → Verovio 로 그림 |
| `minuet-staff` · `minuet-staff.png` | 오선보(피아노 2단) | Minuet in G, BWV Anh. 114(Christian Petzold, 공개 영역 곡) 앞 16마디 | 팀이 music21 → model-api PDF 렌더링(Verovio)으로 A4 한 쪽에 그림 (2026-11-03, #98). 음은 [Mutopia 판](https://www.mutopiaproject.org/ftp/BachJS/BWVAnh114/anna-magdalena-04/anna-magdalena-04-a4.pdf)(조판자가 public domain 으로 공개)을 따르고 꾸밈음은 뺐다 |
| `taryeong-gayageum-jeongganbo` · `taryeong-gayageum-jeongganbo.pdf` | 정간보(PDF 2쪽) | 평조회상 「타령」 | 국립국악원 「2021 가야금정악보」(2015, © 국립국악원) 96~97쪽, 박예은 제공. v0.1.1 파일 이름은 `2021 가야금정악보.pdf` |

**뺀 예시 (#98, 2026-11-03):** `arirang-98-staff`(아리랑 9/8 가사 오선보)와 이전 `minuet-staff-1000.jpg` 는 인터넷에서 찾은 사진이라 판면 출처 · 이용 조건을 확인할 수 없어 뺐다. 같은 곡은 팀이 그린 `arirang-semachi-staff` · `minuet-staff` 로 시연한다.

**시험 (2026-11-03, 임시 프로젝트 · model-api 0.2.0):** 새 `minuet-staff.png` 는 오선보 인식이 대체 없이 `trust`(23.5초) · 16마디 · 음표 100개(위 65 · 아래 35)의 음높이와 길이가 그린 악보와 모두 같았다. MP3 생성도 확인했다.

## 공개 시연 판단 (#98, 2026-11-03 사용자 결정)

| id | 판단 | 근거 |
|---|---|---|
| `arirang-semachi-staff` | 사용 | 공개 영역 민요를 팀이 직접 그린 악보 |
| `minuet-staff` | 사용 | 공개 영역 곡을 팀이 직접 그린 악보 (#134 에서 교체) |
| `taryeong-gayageum-jeongganbo` | 사용 (그대로) | 사용자(팀장) 결정: 이 서비스 시연에서는 악보 이용 조건을 따지지 않는다. 국립국악원 「2021 가야금정악보」 96~97쪽임을 출처로 밝혀 둔다 |

- 상용 서비스나 예시 파일을 외부에 배포하게 되면 이 판단을 다시 본다. 예시 파일은 서버 전용이라 지금은 내려받는 공개 경로가 없다.

`../templates/` 는 인식이 안 될 때 주는 대체 악보로, DB `fallback_template` 의 `assets/templates/...` 가 가리킨다.
