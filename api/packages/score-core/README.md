# score-core (담당: 황송해 @SonghaeHwang · 리뷰: 팀장 @majoongcheon)

> 2026-10-30 조정안 A 로 팀장 → 황송해. 이전 작업: #18

악보 문서(ScoreDoc) 파싱 · 편집 연산(`applyOps`) · MIDI/MusicXML 내보내기. 백엔드(내보내기)와 프론트(편집 · 연주)가 함께 쓴다.

- 참고 코드: `proto_type/src/app/packages/score-core` (약 1,400줄 · 테스트 12개 파일)
- 쓰는 쪽은 `file:` 경로로 연결한다 (`"@gugak/score-core": "file:../../packages/score-core"`).
- 공개 함수 · 타입을 바꾸면 백엔드와 프론트를 함께 깨뜨리므로 PR 에 팀장(@majoongcheon)을 리뷰어로 넣는다.
