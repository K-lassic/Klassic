-- 012_shared_score.sql (2026-09-30 황송해) — 공유 악보 · 좋아요. 다시 실행해도 된다. 011 은 박예은 팀장 아리랑 대체 템플릿.
SET NAMES utf8mb4;

-- 공유 악보 · 좋아요 (2026-09-30 황송해 결정 — design/UC_18 · SD_01 §9C P9 · SD_03 §11B)
-- 결과 악보를 모두에게 공유한 복사본과 좋아요. 원본 사진 · 요청 번호 · 올린 사람은 목록에 내지 않는다(BR-SHR-02·03).
CREATE TABLE IF NOT EXISTS shared_score (
  share_id          BIGINT        NOT NULL AUTO_INCREMENT,
  share_no          VARCHAR(20)   NOT NULL,          -- 화면에 쓰는 공유 번호(S-MMDD-XXXXXXXX)
  source_request_id BIGINT        NULL,              -- 공유한 요청(요청 행은 지우지 않지만 참조만)
  owner_account_id  BIGINT        NULL,              -- 올린 사람(소유 확인용 — 목록 응답에는 내지 않음)
  title             VARCHAR(60)   NOT NULL,
  score_type        VARCHAR(12)   NOT NULL,
  musicxml_uri      VARCHAR(255)  NULL,              -- shared/<share_no>/score.musicxml, 거두면 NULL
  shared_at         TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  unshared_at       TIMESTAMP(3)  NULL,              -- 올린 사람이 거둠
  taken_down_at     TIMESTAMP(3)  NULL,              -- 운영자가 내림(UC19)
  taken_down_by     BIGINT        NULL,
  take_down_reason  VARCHAR(200)  NULL,
  CONSTRAINT pk_shared_score PRIMARY KEY (share_id),
  CONSTRAINT uq_shared_score_no UNIQUE (share_no),
  CONSTRAINT uq_shared_score_request UNIQUE (source_request_id),
  CONSTRAINT fk_shared_score_request FOREIGN KEY (source_request_id) REFERENCES score_request (request_id) ON DELETE SET NULL,
  CONSTRAINT fk_shared_score_owner FOREIGN KEY (owner_account_id) REFERENCES account (account_id) ON DELETE SET NULL,
  CONSTRAINT fk_shared_score_op FOREIGN KEY (taken_down_by) REFERENCES operator_account (operator_id),
  CONSTRAINT chk_shared_score_type CHECK (score_type IN ('staff','jeongganbo')),
  CONSTRAINT chk_shared_score_title CHECK (CHAR_LENGTH(TRIM(title)) BETWEEN 1 AND 60)
);
CREATE INDEX IF NOT EXISTS ix_shared_score_visible ON shared_score (unshared_at, taken_down_at, shared_at);

CREATE TABLE IF NOT EXISTS score_like (
  share_id    BIGINT        NOT NULL,
  account_id  BIGINT        NOT NULL,
  liked_at    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT pk_score_like PRIMARY KEY (share_id, account_id),
  CONSTRAINT fk_score_like_share FOREIGN KEY (share_id) REFERENCES shared_score (share_id) ON DELETE CASCADE,
  CONSTRAINT fk_score_like_account FOREIGN KEY (account_id) REFERENCES account (account_id) ON DELETE CASCADE
);

-- 보이는 공유 악보 + 좋아요 수(올린 사람 칸 없음 — BR-SHR-03)
CREATE OR REPLACE VIEW v_shared_score_list AS
SELECT s.share_id, s.share_no, s.title, s.score_type, s.shared_at,
       (SELECT COUNT(*) FROM score_like l WHERE l.share_id = s.share_id) AS like_count
  FROM shared_score s
 WHERE s.unshared_at IS NULL AND s.taken_down_at IS NULL AND s.musicxml_uri IS NOT NULL;

-- 운영자 조치 이력(UC19, BR-SHR-06)
ALTER TABLE change_history DROP CONSTRAINT IF EXISTS chk_history_target;
ALTER TABLE change_history ADD CONSTRAINT chk_history_target
  CHECK (target_type IN ('access_key','key_application','license_policy','model','account','shared_score'));
ALTER TABLE change_history DROP CONSTRAINT IF EXISTS chk_history_field;
ALTER TABLE change_history ADD CONSTRAINT chk_history_field
  CHECK (field_name IN ('issued','status','call_limit_per_hour','retained','confirmed',
                        'registered','enabled','provider_ref','config','load','unregistered',
                        'role_granted','role_revoked','disabled','unlocked','email_revealed',
                        'taken_down','restored'));

-- 권한표(UC_00 §4-1): user → UC18 공유 · 듣기 · 좋아요, operator → UC19 내리기
INSERT IGNORE INTO role_permission (role_code, uc_code) VALUES ('user', 'UC18'), ('operator', 'UC19');
