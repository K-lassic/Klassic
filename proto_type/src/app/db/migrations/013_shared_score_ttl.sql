-- 013_shared_score_ttl.sql (2026-09-30 황송해) — 공유 악보를 공유한 때부터 3일 보관. 다시 실행해도 된다.
SET NAMES utf8mb4;

-- 공유 악보 3일 보관 (2026-09-30 황송해 결정 — design/UC_18 BR-SHR-02 · SD_01 9.7 · SD_03 §11B · §16-1)
ALTER TABLE shared_score ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP(3) NULL AFTER shared_at;     -- 공유 시각 + 3일(다시 공유하면 새로)
ALTER TABLE shared_score ADD COLUMN IF NOT EXISTS purged_at  TIMESTAMP(3) NULL AFTER expires_at;    -- P0 가 복사본 · 좋아요를 정리한 시각
UPDATE shared_score SET expires_at = shared_at + INTERVAL 3 DAY WHERE expires_at IS NULL;
ALTER TABLE shared_score MODIFY COLUMN expires_at TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3) + INTERVAL 3 DAY);
CREATE INDEX IF NOT EXISTS ix_shared_score_expires ON shared_score (expires_at, purged_at);

-- 보이는 공유 악보: 거둠 · 내림 · 3일 지남 빼고
CREATE OR REPLACE VIEW v_shared_score_list AS
SELECT s.share_id, s.share_no, s.title, s.score_type, s.shared_at, s.expires_at,
       (SELECT COUNT(*) FROM score_like l WHERE l.share_id = s.share_id) AS like_count
  FROM shared_score s
 WHERE s.unshared_at IS NULL AND s.taken_down_at IS NULL AND s.musicxml_uri IS NOT NULL
   AND s.expires_at > CURRENT_TIMESTAMP(3);

-- 정리할 공유 악보(상태와 상관없이 3일 지남, 아직 정리 안 함)
CREATE OR REPLACE VIEW v_shared_purge_due AS
SELECT s.share_id, s.share_no, s.musicxml_uri
  FROM shared_score s
 WHERE s.expires_at <= CURRENT_TIMESTAMP(3) AND s.purged_at IS NULL;
