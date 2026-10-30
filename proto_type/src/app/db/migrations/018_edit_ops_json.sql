-- 018 내가 만든 악보 — 편집 기록 서버 보관 (2026-09-30 황송해 160번 — design/UC_07 A9 · SD_01 3.8 · SD_03 · gugak_ddl.sql)
--
-- 편집 연산 목록(JSON)을 서버에 남겨 다른 기기의 "내가 만든 악보" 목록에서도 편집 반영 파일을 만든다. 되돌린 뒤 마치면 NULL. 다시 실행해도 된다.
SET NAMES utf8mb4;

ALTER TABLE edited_score ADD COLUMN IF NOT EXISTS ops_json LONGTEXT NULL AFTER transpose_semitones;
