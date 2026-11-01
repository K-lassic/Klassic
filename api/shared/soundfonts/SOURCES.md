# 음원(.sf2) 출처 — tasks T052 · research R10

웹 서비스가 이 폴더를 `/soundfonts/` 로 내보내고, 브라우저 연주기(`frontend/src/player/player.ts`, spessasynth_lib)가
`FluidR3_GM.sf2` 를 바탕으로 싣고 그 위에 `gugak.sf2` 를 얹는다. MP3 렌더러(모델 API 서버, FluidSynth)도 같은 파일을 쓴다(R19: 화면 소리 = MP3 소리).

**소리 번호(결정 C11, 2026-09-29 황송해)** — 국악기와 일반 악기의 번호가 겹치지 않는다(`shared/instruments.json` 의 `bank`·`program`):

| 구분 | 음원 | bank | program |
|---|---|---|---|
| 일반 악기 | FluidR3_GM.sf2 | 0 (표준 GM) | 피아노 0 · 마림바 12 · 기타 24 · 바이올린 40 · 첼로 42 · 하프 46 · 현악 48 · 클라리넷 71 · 플루트 73 |
| 국악기 | gugak.sf2 | **1** (국악기 전용) | 가야금 0 · 거문고 1 · 대금 2 · 해금 3 · 피리 4 · 아쟁 5 |
| 장구·북 | gugak.sf2 | 128 (타악) | **1** (국악 타악 세트 `gugak_kit`) — GM 표준 드럼 세트는 128 · 0 그대로(FluidR3_GM) |

화면 연주는 score-core `toMidi(doc, { soundNumbers: 'service' })` 로 성부마다 이 번호(bank select CC0 + program change)를 적어
부르고, MP3 는 모델 API 가 렌더링 직전에 국악기 성부의 번호를 이렇게 바꾼다. 예전(9-28 판)에는 국악기를 GM 번호 자리(bank 0,
아쟁 = 첼로 42)에 두어서 두 음원을 겹쳐 실은 화면 연주에서 첼로가 아쟁 소리로 났다.
내려받는 MIDI·MusicXML 에는 다른 프로그램이 읽을 수 있게 GM 호환 번호(`gm_program`, bank 0)를 그대로 적는다(bank 1 은 다른 신시사이저에 없음).

## 1. FluidR3_GM.sf2 — 받아 둠 (2026-09-28)

| 항목 | 값 |
|---|---|
| 파일 | `FluidR3_GM.sf2` (148,398,306 바이트) |
| SHA-256 | `74594e8f4250680adf590507a306655a299935343583256f3b722c48a1bc1cb0` |
| 받은 곳 | https://github.com/pianobooster/fluid-soundfont/releases/download/v3.1/FluidR3_GM.sf2 (PianoBooster 프로젝트가 올려 둔 fluid-soundfont 3.1 사본) |
| 다른 사본 | https://ftp.osuosl.org/pub/musescore/soundfont/fluid-soundfont.tar.gz (MuseScore 배포본) · Debian `fluid-soundfont-gm` 3.1 |
| 만든 사람 | Frank Wen (Fluid R3 General MIDI SoundFont) |
| 라이선스 | **MIT** — 저작권 고지와 허가 문구를 함께 두면 복제·수정·배포·상업 이용 가능 |
| 확인 | 머리 12바이트 `RIFF....sfbk` (SoundFont 2) |

출처 표시 문구(화면 하단 · API 가이드라인):

> 그 밖의 악기 음원: FluidR3_GM (Frank Wen, MIT 라이선스)

MIT 고지 원문: 같은 폴더의 `FluidR3_GM.COPYING.txt`(원본 COPYING 그대로 — "Copyright (c) 2000-2002, 2008 Frank Wen <getfrank@gmail.com>"). 파일을 배포할 때 함께 둔다.

## 2. gugak.sf2 — 만들어 둠 (2026-09-28, 박예은 팀장 세션)

- **원천**: 국립국악원 국악기 디지털 음원 — 단음 (https://www.gugak.go.kr/digitaleum/front/monotone/list.do), **공공누리 제1유형(출처 표시)**.
- **내려받기 신고**: 사용 목적 `비상업용 / 교육용`, 기관명 `3팀 국악보 디지털 변환 서비스(교육 과정)` (2026-09-28 박예은 팀장 확인).
- **받은 파일 17개** (`source/` 에 둠, 저장소에는 올리지 않음):

  | 악기 | 국립국악원 분류 | 파일 (mntnSeq) |
  |---|---|---|
  | 가야금 | 정악가야금 기본음계 중 | jungak_gayageum_sus_mid_04_05.wav (2539) |
  | 거문고 | 정악거문고 기본음계(대현·유현) 중 | gumungo_D_scale_mid_80.wav (2590), gumungo_U_scale_mid_02.wav (2596) |
  | 대금 | 정악대금 기본음계 기본음 | jungak_deageum_scale_sus_25.wav (2557) |
  | 해금 | 해금 기본음계 중 | Haegeum_1.wav (2406) |
  | 피리 | 향피리 기본음계 기본음 | hyangpiri_scale_05_06.wav (2505) |
  | 아쟁 | 정악아쟁 기본음계 중 | Ajaeng_2.wav (2383) |
  | 장구 | 덩·기덕·쿵·더러러러 × 강·중 | Janggu_1_1~4_2.wav (2282~2292) |
  | 북 | 좌고 타격음 중·강 | Jwago_2.wav (2306), Jwago_1.wav (2305) |

- **만드는 법**: `cd app/model-api && uv run python ../ops/soundfonts/build_gugak_sf2.py` (Polyphone 대신 자동).
  음계 녹음에서 음마다 시작점·음높이(YIN)를 찾아 자르고, 지속음 악기(대금·피리·해금·아쟁)는 반복 구간을 잡는다.
  악기는 `shared/instruments.json` 의 `bank`·`program` 자리(국악기 bank 1 · program 0~5)에, 장구·좌고는 국악 타악 세트(bank 128 · program 1)에 둔다.
  (2026-09-29 C11: 같은 원천·같은 스크립트로 다시 만들어 샘플·악기 조각은 9-28 판과 바이트까지 같고 프리셋 머리(phdr)의 번호만 바뀌었다. 옛 파일은 `project2610/backup/원본_20260929_HSH_국악기번호/` 에 있다.)
  잘라 낸 음 목록은 `gugak.sf2.json` 에 남는다(검수용).
- **결과**: 22.3MB, 샘플 90개, 프리셋 7개 — 가야금 13음(39~75) · 거문고 16음(39~67) · 대금 18음(58~88) · 해금 13음(56~91) · 피리 13음(57~85) · 아쟁 8음(44~63).
- **검증**: FluidSynth 로 악기마다 3~4음을 연주해 음높이를 다시 재면 요청한 건반과 0.13반음 안으로 맞음. spessasynth(화면 재생기)도 읽음.
- **타악 건반**: 덩 36·35 · 기덕 38·40 · 쿵 42·37 · 더러러러 44·46 · 좌고(북) 41·43·45. 세기 0~95 = 중, 96~127 = 강.
- **(2026-09-30 박예은 국악 검수) 짧은 가야금 샘플 빼기**: 가야금 D#4(0.21초)·D#5(0.27초)·F3(0.27초)는 음 추적이 한 음을 옥타브 위로 잘못 읽어 잘린 조각이라 소리가 끊겼다. 빌드 스크립트의 `MIN_SAMPLE_S`(가야금 0.5초)보다 짧은 샘플은 건반 구역에 싣지 않고 이웃 샘플이 맡는다 — D4 는 C4 샘플(+2반음), C5 는 G#4 샘플(+4반음), F3 는 D#3 샘플(+2반음). 다시 만들면 샘플 87개, 가야금 10음(39~68, 67 이상은 모두 G#4 샘플). 다른 악기·장구 세트는 바이트까지 같다. `gugak.sf2.json` 에는 뺀 음이 `excluded` 로 남는다. 옛 파일: `project2610/backup/원본_20260930_PYE_가야금샘플_대체템플릿/`.
- **(2026-09-30 16:1x 서비스 반영, 박예은 팀장 결정)** 위의 짧은 가야금 샘플 빼기를 적용하고, **음역으로 제한하지 않도록** 모든 국악기의 맨 아래·맨 위 샘플이 건반 0~127 전체를 맡게 다시 만들었다(전에는 음역 ±12반음 밖은 소리가 나지 않았다 — 예: 가야금 27~93, 대금 46~100). 샘플 87개, 샘플 내용과 가운데 건반 구역·장구 세트는 전과 같다. 끝 음은 원본 샘플에서 멀리 늘여 음색이 달라질 수 있다. 옛 파일: `project2610/backup/원본_20260930_PYE_할일5종/app/assets/soundfonts/`.
- **알려진 한계**: 음계 녹음이라 반음이 빠진 자리는 가까운 음을 늘이거나 줄여 낸다. 시김새(농현·요성) 음은 넣지 않았다. 장구와 북은 같은 타악 세트를 쓴다(악기를 바꿔도 건반이 같으면 같은 소리). **국악 전공 팀원의 청취 검수가 필요하다.**
- **출처 표시 문구(화면·API활용 안내·MP3 설명에 넣는다)**: "이 서비스의 국악기 음색은 국립국악원 '국악기 디지털 음원'(공공누리 제1유형)을 이용해 만들었습니다."

## 3. gugak.sf2 가 없을 때 (파일을 지웠거나 다른 서버)

- 국악기는 **FluidR3_GM 의 가장 가까운 GM 소리**(`gm_program`, bank 0)로 연주한다(가야금 → Koto 107, 거문고 → Shamisen 106, 대금 → Shakuhachi 77, 해금 → Fiddle 110, 피리 → Shanai 111, 아쟁 → Cello 42, 장구·북 → GM 표준 드럼 세트 128 · 0). 화면 연주와 MP3 모두 gugak.sf2 가 없으면 bank 1 번호를 쓰지 않고 이 GM 번호로 부른다. 화면 연주 막대에 "국악기 전용 음원을 준비 중이라 가장 가까운 소리로 들려 드려요"가 뜬다.
- 두 파일이 모두 없으면 연주만 못 하고(안내 문구), 악보 보기·편집·내려받기는 그대로 된다(SD_02 U2).
- **개발 서버 주의**: `vite.config.ts` 의 proxy 에 `/soundfonts` 가 없다. `npm run dev` 로 화면만 띄우면 음원을 못 받으므로, proxy 에 `'/soundfonts': 'http://127.0.0.1:9523'` 을 더하거나 웹 서비스(9523)로 연다.
