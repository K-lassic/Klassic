# score-core (담당: 황송해 @SonghaeHwang · 리뷰: 팀장 @majoongcheon)

> 2026-10-30 조정안 A 로 팀장 → 황송해. 이전 작업: #18

악보 문서(ScoreDoc) 파싱 · 편집 연산(`applyOps`) · MIDI/MusicXML 내보내기. 백엔드(내보내기)와 프론트(편집 · 연주)가 함께 쓴다.

- 참고 코드: `proto_type/src/app/packages/score-core` (약 1,400줄 · 시험 7개 파일) — v0.1.1 소스를 그대로 옮겼다 (#18)
- 담당은 #18 조정안 A 로 황송해. 공개 함수 · 타입을 바꾸면 백엔드와 프론트를 함께 깨뜨리므로 PR 에 팀장(@majoongcheon)을 리뷰어로 넣는다 (`.github/CODEOWNERS`).

## 무엇

| 항목 | 값 |
|---|---|
| 패키지 이름 | `@gugak/score-core` (private · ESM) |
| 산출물 | `dist/index.js` · `dist/index.d.ts` (`npm run build`) |
| 런타임 의존성 | `@tonejs/midi` 2.0.28 · `fast-xml-parser` 5.11.1 · `fflate` 0.8.3 (v0.1.1 과 같은 판, `package-lock.json` 으로 고정) |
| Node | 22 (`node:22-bookworm-slim` 에서 확인) |

공개 함수 (v0.1.1 `INTERFACES.md` §3 과 같음): `parseMusicXml` · `parseMidi` · `toMusicXml` · `toMidi` · `applyOps` · `applyInstrumentMode` · `rangeWarnings` · `summarizeOps` · `validateOps` 외 — 전체 목록은 `src/index.ts`.

## 쓰는 쪽에서 연결하기

서비스의 `package.json` 에 `file:` 경로로 넣는다 (npm workspaces 로 lock 하나를 같이 쓰지 않는다 — `api/README.md` 규칙 3).

```json
"dependencies": {
  "@gugak/score-core": "file:../../packages/score-core"
}
```

- `file:` 는 폴더를 링크만 하고 **빌드는 하지 않는다**. 쓰는 쪽 `npm ci` 전에 이 폴더에서 `npm ci && npm run build` 를 먼저 한다.
- Docker 이미지로 빌드할 때도 같다 — 빌드 단계에서 `api/packages/score-core` 를 복사해 `npm ci && npm run build` 한 뒤 서비스 의존성을 설치한다. 그래서 서비스 이미지는 `api/` 를 빌드 컨텍스트로 잡아야 한다.

## 어떻게 — 빌드 · 시험

```bash
cd api/packages/score-core
npm ci
npm run build   # dist/
npm test        # vitest — 7개 파일 62개 시험
npm run lint
```

Node 가 없는 PC 에서는 컨테이너로 돌린다 (`api/` 를 통째로 마운트해야 `api/shared` 경로가 맞는다).

```bash
# api/ 의 부모 폴더(저장소 루트)에서
docker run --rm -v "$PWD/api:/api" -w /api/packages/score-core node:22-bookworm-slim sh -c "npm ci && npm run build && npm test"
```

### 시험 자료

| 자료 | 위치 | 이유 |
|---|---|---|
| MusicXML · MIDI · MXL 예제 | `tests/fixtures/` | v0.1.1 그대로 |
| 대체 템플릿 `gutgeori-v1.*` · `manifest.json` | `tests/fixtures/templates/` | v0.1.1 `assets/templates` 에서 복사. 바뀌지 않는 옛 판본이라 시험 자료로 둔다 |
| 악기 목록 `instruments.json` | `api/shared/instruments.json` (복사하지 않음) | score-core 안의 기본 악기 목록이 공용 파일과 같은지 맞춰 보는 시험이라 실제 파일을 읽는다. **파일이 없으면 그 시험 2개만 건너뛴다** — `shared` 이전(#19)이 끝나면 저절로 돈다 |

### 보조 스크립트 (`scripts/`)

v0.1.1 에서 시험 자료 · 대체 템플릿을 다시 만들 때 쓰던 도구다. 평소 빌드 · 시험에는 필요 없다.

- `make-fixtures.ts` — `tests/fixtures/` 의 `waltz.mxl` · `piano.mid` 를 다시 만든다
- `make-template.ts` — 대체 템플릿을 만든다. 기본 출력 경로(`api/assets/templates`)가 재구성 구조에 없으므로 **`TEMPLATE_OUT_DIR` 을 꼭 준다**
- 실행: `npx --yes tsx@4.19.2 scripts/<파일>.ts` (`tsx` 는 devDependencies 에 넣지 않았다)

## 만약에

| 증상 | 근거 | 조치 |
|---|---|---|
| 쓰는 쪽에서 `Cannot find module '@gugak/score-core'` 또는 `dist/index.js` 없음 | `file:` 는 빌드를 하지 않음 | 이 폴더에서 `npm ci && npm run build` 후 쓰는 쪽에서 다시 설치 |
| 시험 결과에 `2 skipped` | `api/shared/instruments.json` 이 아직 없음 | 정상 (#19 이전). 생긴 뒤에도 건너뛰면 경로 확인 |
| 악기 목록 시험 실패 | `src/` 의 기본 악기 목록과 `api/shared/instruments.json` 이 다름 | 둘 중 바뀐 쪽을 맞추고, 공개 값이 바뀌면 팀장 리뷰 |
