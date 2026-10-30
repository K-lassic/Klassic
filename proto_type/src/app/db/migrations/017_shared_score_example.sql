-- 017 예시 공유 악보 (2026-09-30 조성기 — design/UC_18 BR-SHR-08 · SD_01 9.9 · SD_03 §11B · gugak_ddl.sql)
--
-- S1 예시 악보를 서비스로 변환한 결과를 공유 악보로 넣는다(npm run shared:seed-examples).
-- 예시 행은 올린 사람 · 요청이 없고 expires_at 을 2037-12-31 로 두어 3일 정리에서 빠진다. 다시 실행해도 된다.
SET NAMES utf8mb4;

ALTER TABLE shared_score ADD COLUMN IF NOT EXISTS example_id VARCHAR(64) NULL AFTER owner_account_id;
CREATE UNIQUE INDEX IF NOT EXISTS uq_shared_score_example ON shared_score (example_id);

CREATE OR REPLACE VIEW v_shared_score_list AS
SELECT s.share_id, s.share_no, s.title, s.score_type, s.shared_at, s.expires_at,
       (s.example_id IS NOT NULL) AS is_example,
       (SELECT COUNT(*) FROM score_like l WHERE l.share_id = s.share_id) AS like_count
  FROM shared_score s
 WHERE s.unshared_at IS NULL AND s.taken_down_at IS NULL AND s.musicxml_uri IS NOT NULL
   AND s.expires_at > CURRENT_TIMESTAMP(3);
