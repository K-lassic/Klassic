-- 019 내가 만든 악보 지우기 (2026-09-30 황송해 176번 — design/UC_07 A10 · SD_01 3.9 · SD_03 · gugak_ddl.sql)
--
-- 사용자가 "내가 만든 악보" [제거]로 지운 시각. 지울 때 P0 0.1 과 같은 삭제를 바로 하고 purged_at 도 적는다(G4 뷰는 그대로).
-- 다시 실행해도 된다.
SET NAMES utf8mb4;

ALTER TABLE score_request ADD COLUMN IF NOT EXISTS owner_deleted_at TIMESTAMP(3) NULL AFTER purged_at;
