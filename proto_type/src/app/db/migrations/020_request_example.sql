-- 020 예시로 올린 요청 (2026-09-30 황송해 192번 — design/SD_03 · SD_01 3.8 · UC_07 A9 · gugak_ddl.sql)
--
-- 1단계 [예시 파일 고르기]로 올린 요청의 예시 id(examples.json 의 id). "내가 만든 악보" 제목에 예시 이름을 쓴다.
-- 사용자 파일 · 공유 · API 요청은 NULL. 다시 실행해도 된다.
SET NAMES utf8mb4;

ALTER TABLE score_request ADD COLUMN IF NOT EXISTS example_id VARCHAR(64) NULL AFTER from_share_id;
