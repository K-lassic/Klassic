-- 015 공유 악보로 작업하기 (2026-09-30 황송해 109번 — design/UC_18 기본흐름 5 · SD_01 9.8 · SD_03 §11B · gugak_ddl.sql)
--
-- 공유 복사본 MusicXML 로 만든 내 새 요청(인식 없이 직행 완료)을 표시한다. 공유 행이 지워지면 NULL. 다시 실행해도 된다.
SET NAMES utf8mb4;

ALTER TABLE score_request ADD COLUMN IF NOT EXISTS from_share_id BIGINT NULL AFTER route;
ALTER TABLE score_request ADD CONSTRAINT fk_request_from_share FOREIGN KEY IF NOT EXISTS (from_share_id) REFERENCES shared_score (share_id) ON DELETE SET NULL;
