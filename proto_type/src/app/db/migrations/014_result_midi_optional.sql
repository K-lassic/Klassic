-- 014 MIDI 없는 결과 허용 (2026-09-30 조성기 — MIDI 안전 변환, design/SD_03 #27 · SD_04 §8-1 · gugak_ddl.sql)
--
-- 엔진이 만든 MusicXML 에서 MIDI 를 만들지 못하면(반복 기호 오류 등) MIDI 없이 MusicXML 만 준다.
-- 지우기 전에는 MusicXML 위치만 반드시 있고(MIDI 는 없을 수 있음), 지운 뒤에는 둘 다 없다(BR-RET-01). 다시 실행해도 된다.
SET NAMES utf8mb4;

ALTER TABLE score_result DROP CONSTRAINT IF EXISTS chk_result_deleted;
ALTER TABLE score_result ADD CONSTRAINT chk_result_deleted CHECK ((deleted_at IS NULL AND musicxml_uri IS NOT NULL)
                                                                OR (deleted_at IS NOT NULL AND musicxml_uri IS NULL AND midi_uri IS NULL));
