-- 002_sd03_amendments.sql
-- SD_03 기준 DDL(001) 위에 명세 변경분과 계획 결정값을 더한다.
-- 근거: JSG/JSG_DB설계검증_SD03.md §2·§3 (S-1~S-11, V-2·V-3·V-5), tasks.md T015
-- 원본 design/gugak_ddl.sql 은 고치지 않는다(tasks.md 결정 대기 Q5).
-- 다시 실행해도 실패하지 않는다(IF [NOT] EXISTS · OR REPLACE).
SET NAMES utf8mb4;

-- ---------------------------------------------------------------------
-- 처리 설정 판본: 새 설정 컬럼 (S-1 FR-062 · S-7 동시 처리 · S-11)
-- ---------------------------------------------------------------------
ALTER TABLE processing_setting_version
  ADD COLUMN IF NOT EXISTS web_max_active_per_client INT NULL,        -- FR-062 ① 세션·주소별 처리 중·대기 중 요청 수
  ADD COLUMN IF NOT EXISTS web_hourly_request_cap    INT NULL,        -- FR-062 ② 세션·주소별 시간당 접수 상한
  ADD COLUMN IF NOT EXISTS max_concurrency_recognize INT NULL,        -- FR-017 인식 동시 처리
  ADD COLUMN IF NOT EXISTS max_concurrency_render    INT NULL,        -- FR-017 렌더링 동시 처리
  ADD COLUMN IF NOT EXISTS web_concurrency_share     INT NULL,        -- 인식 상한 중 웹 몫(research R17)
  ADD COLUMN IF NOT EXISTS score_file_max_bytes      BIGINT NULL,     -- MIDI·MusicXML 용량 상한(spec 5MB 시작)
  ADD COLUMN IF NOT EXISTS recommend_timeout_ms      INT NULL,        -- 추천 응답 제한(research R17)
  ADD COLUMN IF NOT EXISTS login_max_failures        INT NULL,        -- 관리자 로그인 잠금(R13)
  ADD COLUMN IF NOT EXISTS login_lock_minutes        INT NULL;

ALTER TABLE processing_setting_version DROP CONSTRAINT IF EXISTS chk_g6_web_active;
ALTER TABLE processing_setting_version ADD CONSTRAINT chk_g6_web_active CHECK (web_max_active_per_client >= 1);
ALTER TABLE processing_setting_version DROP CONSTRAINT IF EXISTS chk_g6_web_hourly;
ALTER TABLE processing_setting_version ADD CONSTRAINT chk_g6_web_hourly CHECK (web_hourly_request_cap >= 1);
ALTER TABLE processing_setting_version DROP CONSTRAINT IF EXISTS chk_g6_conc_split;
ALTER TABLE processing_setting_version ADD CONSTRAINT chk_g6_conc_split
  CHECK (max_concurrency_recognize >= 1 AND max_concurrency_render >= 1
         AND web_concurrency_share >= 1 AND web_concurrency_share <= max_concurrency_recognize);
ALTER TABLE processing_setting_version DROP CONSTRAINT IF EXISTS chk_g6_file_bytes;
ALTER TABLE processing_setting_version ADD CONSTRAINT chk_g6_file_bytes CHECK (score_file_max_bytes >= 1);
ALTER TABLE processing_setting_version DROP CONSTRAINT IF EXISTS chk_g6_recommend_ms;
ALTER TABLE processing_setting_version ADD CONSTRAINT chk_g6_recommend_ms CHECK (recommend_timeout_ms >= 1);
ALTER TABLE processing_setting_version DROP CONSTRAINT IF EXISTS chk_g6_login;
ALTER TABLE processing_setting_version ADD CONSTRAINT chk_g6_login CHECK (login_max_failures >= 1 AND login_lock_minutes >= 1);
-- V-3: 등급 경계는 둘 다 있거나 둘 다 없다
ALTER TABLE processing_setting_version DROP CONSTRAINT IF EXISTS chk_g6_grade_pair;
ALTER TABLE processing_setting_version ADD CONSTRAINT chk_g6_grade_pair
  CHECK ((grade_caution_boundary IS NULL) = (grade_distrust_boundary IS NULL));

-- ---------------------------------------------------------------------
-- S-6 [결정 대기 Q1 → 임시안: 시간당] 호출 한도 단위를 시간당으로
-- ---------------------------------------------------------------------
ALTER TABLE processing_setting_version DROP CONSTRAINT IF EXISTS chk_g6_default_limit;
ALTER TABLE processing_setting_version
  CHANGE COLUMN IF EXISTS default_call_limit_per_day default_call_limit_per_hour INT NULL;
ALTER TABLE processing_setting_version ADD CONSTRAINT chk_g6_default_limit CHECK (default_call_limit_per_hour >= 1);

ALTER TABLE access_key DROP CONSTRAINT IF EXISTS chk_key_limit;
ALTER TABLE access_key DROP CONSTRAINT IF EXISTS chk_key_limit_required;
ALTER TABLE access_key CHANGE COLUMN IF EXISTS call_limit_per_day call_limit_per_hour INT NULL;
ALTER TABLE access_key ADD CONSTRAINT chk_key_limit CHECK (call_limit_per_hour >= 1);
ALTER TABLE access_key ADD CONSTRAINT chk_key_limit_required CHECK (key_kind = 'service' OR call_limit_per_hour IS NOT NULL);

ALTER TABLE change_history DROP CONSTRAINT IF EXISTS chk_history_field;
ALTER TABLE change_history ADD CONSTRAINT chk_history_field
  CHECK (field_name IN ('issued','status','call_limit_per_hour','retained','confirmed'));

-- ---------------------------------------------------------------------
-- S-10 키 해시 SHA-256(64자) · 앞 8글자 · 로그인 잠금
-- ---------------------------------------------------------------------
ALTER TABLE access_key MODIFY COLUMN key_hash CHAR(64) NOT NULL;
ALTER TABLE access_key DROP CONSTRAINT IF EXISTS chk_key_prefix_len;
ALTER TABLE access_key ADD CONSTRAINT chk_key_prefix_len CHECK (CHAR_LENGTH(key_prefix) = 8);

ALTER TABLE operator_account
  ADD COLUMN IF NOT EXISTS failed_login_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP(3) NULL;

-- ---------------------------------------------------------------------
-- S-1 FR-062 웹 사용자 요청 한도 (새 게이트 G12)
-- ---------------------------------------------------------------------
ALTER TABLE score_request ADD COLUMN IF NOT EXISTS client_addr_hash CHAR(64) NULL;   -- 원문 주소는 저장하지 않는다(FR-063)
CREATE INDEX IF NOT EXISTS ix_request_session_time ON score_request (session_id, received_at);
CREATE INDEX IF NOT EXISTS ix_request_addr_time    ON score_request (client_addr_hash, received_at);

ALTER TABLE gate_event DROP CONSTRAINT IF EXISTS chk_gate_code;
ALTER TABLE gate_event ADD CONSTRAINT chk_gate_code
  CHECK (gate_code IN ('G1','G2','G3','G4','G5','G6','G7','G8','G10','G11','G12'));

-- ---------------------------------------------------------------------
-- S-2 FR-063 식별값(세션 ID·접속 주소 해시)은 24시간 뒤 지운다. 기록 행은 남긴다.
-- ---------------------------------------------------------------------
ALTER TABLE score_request ADD COLUMN IF NOT EXISTS identity_purged_at TIMESTAMP(3) NULL;
ALTER TABLE score_request DROP CONSTRAINT IF EXISTS chk_request_owner;
ALTER TABLE score_request ADD CONSTRAINT chk_request_owner
  CHECK ((channel = 'web' AND access_key_id IS NULL
          AND (session_id IS NOT NULL OR identity_purged_at IS NOT NULL))
      OR (channel = 'api' AND session_id IS NULL AND access_key_id IS NOT NULL));
ALTER TABLE score_request DROP CONSTRAINT IF EXISTS chk_request_identity_purged;
ALTER TABLE score_request ADD CONSTRAINT chk_request_identity_purged
  CHECK (identity_purged_at IS NULL OR (session_id IS NULL AND client_addr_hash IS NULL));
-- fk_request_session 은 이미 NULL 을 허용한다(session_id NULL 가능 컬럼) — 다시 만들 필요 없음.

-- ---------------------------------------------------------------------
-- S-3 신청 접속 주소도 해시로 (FR-063 "접속 주소는 원문으로 저장하지 않는다")
-- ---------------------------------------------------------------------
ALTER TABLE key_application CHANGE COLUMN IF EXISTS client_address client_addr_hash CHAR(64) NOT NULL;

-- ---------------------------------------------------------------------
-- S-4 세션 종료 = 2시간 무활동 또는 [나가기] (spec Clarifications)
-- ---------------------------------------------------------------------
ALTER TABLE anon_session ADD COLUMN IF NOT EXISTS end_reason VARCHAR(8) NULL;
ALTER TABLE anon_session DROP CONSTRAINT IF EXISTS chk_session_end_reason;
ALTER TABLE anon_session ADD CONSTRAINT chk_session_end_reason
  CHECK ((ended_at IS NULL AND end_reason IS NULL)
      OR (ended_at IS NOT NULL AND end_reason IS NOT NULL AND end_reason IN ('exit','idle')));

-- ---------------------------------------------------------------------
-- S-8 대체 템플릿: MusicXML 위치와 버전 · S-9 악기 코드·타악·음원 파일
-- ---------------------------------------------------------------------
ALTER TABLE fallback_template
  ADD COLUMN IF NOT EXISTS musicxml_uri VARCHAR(500) NULL,
  ADD COLUMN IF NOT EXISTS version VARCHAR(20) NULL;

ALTER TABLE instrument
  ADD COLUMN IF NOT EXISTS code VARCHAR(40) NULL,
  ADD COLUMN IF NOT EXISTS is_percussion BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS soundfont_file VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS menu_order SMALLINT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_instrument_code ON instrument (code);


-- =====================================================================
-- 뷰 다시 만들기 (이름이 바뀐 컬럼 · 새 판정)
-- =====================================================================

-- 지금 설정 — SELECT * 는 만든 순간의 컬럼 목록으로 굳으므로 컬럼을 바꾼 뒤 다시 만든다
CREATE OR REPLACE VIEW v_current_setting AS
SELECT s.*
  FROM processing_setting_version s
 WHERE s.setting_version_id = (SELECT MAX(setting_version_id) FROM processing_setting_version);

-- S-4 세션 상태 — 단일 판정 지점. [나가기] 또는 마지막 활동 뒤 2시간 무활동이면 끝난 세션이다
CREATE OR REPLACE VIEW v_session_state AS
SELECT s.session_id, s.started_at, s.last_active_at, s.ended_at,
       CASE WHEN s.ended_at IS NOT NULL THEN s.end_reason
            WHEN s.last_active_at <= CURRENT_TIMESTAMP(3) - INTERVAL 2 HOUR THEN 'idle'
            ELSE NULL END                                                    AS end_reason,
       CASE WHEN s.ended_at IS NOT NULL
              OR s.last_active_at <= CURRENT_TIMESTAMP(3) - INTERVAL 2 HOUR THEN 1 ELSE 0 END AS is_ended
  FROM anon_session s;

-- P0 0.4·0.5: 세션이 끝났는데 남은 사용자 음원 (S-4: 무활동 종료 포함)
CREATE OR REPLACE VIEW v_purge_due_soundfonts AS
SELECT f.soundfont_id, f.session_id,
       CASE WHEN f.file_deleted_at IS NULL THEN 1 ELSE 0 END                             AS file_pending,
       CASE WHEN f.api_copy_sent_at IS NOT NULL AND f.api_copy_deleted_at IS NULL THEN 1 ELSE 0 END AS api_copy_pending
  FROM user_soundfont f
  JOIN v_session_state s ON s.session_id = f.session_id
 WHERE s.is_ended = 1
   AND (f.file_deleted_at IS NULL OR (f.api_copy_sent_at IS NOT NULL AND f.api_copy_deleted_at IS NULL));

-- G12 (FR-062) 웹 사용자 요청 한도 — 단일 판정 지점. 세션과 접속 주소 해시를 따로 센다
CREATE OR REPLACE VIEW v_web_request_limit AS
SELECT x.limit_key,
       SUM(CASE WHEN x.status IN ('received','queued','converting','awaiting_type_answer') THEN 1 ELSE 0 END) AS active_count,
       SUM(CASE WHEN x.received_at > CURRENT_TIMESTAMP(3) - INTERVAL 1 HOUR THEN 1 ELSE 0 END)                AS hourly_count,
       MIN(CASE WHEN x.received_at > CURRENT_TIMESTAMP(3) - INTERVAL 1 HOUR THEN x.received_at END)
         + INTERVAL 1 HOUR                                                                                   AS hourly_retry_at,
       s.web_max_active_per_client,
       s.web_hourly_request_cap
  FROM (SELECT CONCAT('session:', r.session_id) AS limit_key, r.status, r.received_at
          FROM score_request r
         WHERE r.channel = 'web' AND r.session_id IS NOT NULL
           AND r.received_at > CURRENT_TIMESTAMP(3) - INTERVAL 1 DAY
        UNION ALL
        SELECT CONCAT('addr:', r.client_addr_hash), r.status, r.received_at
          FROM score_request r
         WHERE r.channel = 'web' AND r.client_addr_hash IS NOT NULL
           AND r.received_at > CURRENT_TIMESTAMP(3) - INTERVAL 1 DAY) x
  CROSS JOIN v_current_setting s
 GROUP BY x.limit_key, s.web_max_active_per_client, s.web_hourly_request_cap;

-- FR-063 식별값 삭제 대상: 접수 24시간이 지났는데 세션 ID·주소 해시가 남은 웹 요청
CREATE OR REPLACE VIEW v_identity_purge_due AS
SELECT r.request_id, r.request_no
  FROM score_request r
 WHERE r.channel = 'web'
   AND r.identity_purged_at IS NULL
   AND CURRENT_TIMESTAMP(3) >= r.received_at + INTERVAL 24 HOUR;

-- G11 신청 빈도 제한 — 주소 해시 기준(S-3)
CREATE OR REPLACE VIEW v_apply_rate_window AS
SELECT x.rate_key,
       COUNT(*)                                                           AS recent_count,
       s.apply_rate_limit_count                                           AS limit_count,
       MIN(x.applied_at) + INTERVAL s.apply_rate_window_minutes MINUTE    AS next_allowed_at,
       CASE WHEN COUNT(*) >= s.apply_rate_limit_count THEN 1 ELSE 0 END   AS is_blocked
  FROM (SELECT CONCAT('email:', a.contact_email)    AS rate_key, a.applied_at FROM key_application a
        UNION ALL
        SELECT CONCAT('addr:', a.client_addr_hash) AS rate_key, a.applied_at FROM key_application a) x
  CROSS JOIN v_current_setting s
 WHERE s.apply_rate_limit_count IS NOT NULL
   AND s.apply_rate_window_minutes IS NOT NULL
   AND x.applied_at > CURRENT_TIMESTAMP(3) - INTERVAL s.apply_rate_window_minutes MINUTE
 GROUP BY x.rate_key, s.apply_rate_limit_count, s.apply_rate_window_minutes;

-- S-4B 키 목록 (시간당 한도)
CREATE OR REPLACE VIEW v_key_admin_list AS
SELECT k.key_id, k.key_kind, k.key_prefix, k.call_limit_per_hour, k.issued_at, k.status, k.application_no,
       CASE WHEN k.key_kind = 'external' AND a.key_id IS NULL THEN 1 ELSE 0 END AS application_purged
  FROM access_key k
  LEFT JOIN key_application a ON a.key_id = k.key_id;

-- G3 호출 한도 — 최근 1시간 창 (S-6). 다시 시도 시각 = 창 안 가장 오래된 호출 + 1시간
CREATE OR REPLACE VIEW v_key_quota AS
SELECT q.key_id, q.call_limit_per_hour, q.calls_last_hour,
       q.call_limit_per_hour - q.calls_last_hour           AS remaining_this_hour,
       CASE WHEN q.call_limit_per_hour IS NOT NULL AND q.calls_last_hour >= q.call_limit_per_hour
            THEN 1 ELSE 0 END                               AS is_exhausted,
       q.oldest_call_at + INTERVAL 1 HOUR                   AS retry_after_at
  FROM (SELECT k.key_id, k.call_limit_per_hour,
               (SELECT COUNT(*) FROM api_call_log c
                 WHERE c.access_key_id = k.key_id AND c.outcome = 'accepted'
                   AND c.called_at > CURRENT_TIMESTAMP(3) - INTERVAL 1 HOUR) AS calls_last_hour,
               (SELECT MIN(c.called_at) FROM api_call_log c
                 WHERE c.access_key_id = k.key_id AND c.outcome = 'accepted'
                   AND c.called_at > CURRENT_TIMESTAMP(3) - INTERVAL 1 HOUR) AS oldest_call_at
          FROM access_key k) q;

-- G3 동시 처리 수 (S-7): 인식(요청)과 렌더링(웹 MP3·PDF + API 연주 생성)을 따로 센다
CREATE OR REPLACE VIEW v_active_processing AS
SELECT (SELECT COUNT(*) FROM score_request r WHERE r.status = 'converting')                         AS recognize_active,
       (SELECT COUNT(*) FROM score_request r WHERE r.status = 'rendering')
     + (SELECT COUNT(*) FROM derived_file d WHERE d.render_status = 'rendering')                    AS render_active,
       (SELECT COUNT(*) FROM score_request r WHERE r.status IN ('converting','rendering'))
     + (SELECT COUNT(*) FROM derived_file d WHERE d.render_status = 'rendering')                    AS active_count;

-- 설정 변경 이력 (새 컬럼 포함, 시간당 한도 이름)
CREATE OR REPLACE VIEW v_setting_change_history AS
WITH v AS (
  SELECT s.*,
         (SELECT GROUP_CONCAT(o.engine_name ORDER BY o.seq SEPARATOR '>') FROM setting_engine_order o
           WHERE o.setting_version_id = s.setting_version_id AND o.score_type = 'staff')      AS staff_order,
         (SELECT GROUP_CONCAT(o.engine_name ORDER BY o.seq SEPARATOR '>') FROM setting_engine_order o
           WHERE o.setting_version_id = s.setting_version_id AND o.score_type = 'jeongganbo') AS jeongganbo_order,
         LAG(s.setting_version_id) OVER (ORDER BY s.setting_version_id) AS prev_id
    FROM processing_setting_version s
), pair AS (
  SELECT cur.setting_version_id, cur.created_by, cur.created_at,
         cur.staff_order AS c_staff, prv.staff_order AS p_staff,
         cur.jeongganbo_order AS c_jg, prv.jeongganbo_order AS p_jg,
         cur.timeout_seconds AS c_timeout, prv.timeout_seconds AS p_timeout,
         cur.max_concurrency_recognize AS c_cr, prv.max_concurrency_recognize AS p_cr,
         cur.max_concurrency_render AS c_cd, prv.max_concurrency_render AS p_cd,
         cur.web_concurrency_share AS c_ws, prv.web_concurrency_share AS p_ws,
         cur.fallback_enabled AS c_fb, prv.fallback_enabled AS p_fb,
         cur.default_call_limit_per_hour AS c_lim, prv.default_call_limit_per_hour AS p_lim,
         cur.apply_rate_limit_count AS c_rc, prv.apply_rate_limit_count AS p_rc,
         cur.apply_rate_window_minutes AS c_rw, prv.apply_rate_window_minutes AS p_rw,
         cur.structure_threshold AS c_st, prv.structure_threshold AS p_st,
         cur.grade_caution_boundary AS c_gc, prv.grade_caution_boundary AS p_gc,
         cur.grade_distrust_boundary AS c_gd, prv.grade_distrust_boundary AS p_gd,
         cur.web_max_active_per_client AS c_wa, prv.web_max_active_per_client AS p_wa,
         cur.web_hourly_request_cap AS c_wh, prv.web_hourly_request_cap AS p_wh,
         cur.score_file_max_bytes AS c_fm, prv.score_file_max_bytes AS p_fm,
         cur.recommend_timeout_ms AS c_rt, prv.recommend_timeout_ms AS p_rt
    FROM v cur LEFT JOIN v prv ON prv.setting_version_id = cur.prev_id
)
SELECT setting_version_id, created_by AS operator_id, created_at AS changed_at, field_name,
       before_value, after_value
  FROM (
    SELECT setting_version_id, created_by, created_at, 'staff_engine_order' AS field_name, p_staff AS before_value, c_staff AS after_value FROM pair WHERE NOT (c_staff <=> p_staff)
    UNION ALL SELECT setting_version_id, created_by, created_at, 'jeongganbo_engine_order', p_jg, c_jg FROM pair WHERE NOT (c_jg <=> p_jg)
    UNION ALL SELECT setting_version_id, created_by, created_at, 'timeout_seconds', CAST(p_timeout AS CHAR), CAST(c_timeout AS CHAR) FROM pair WHERE NOT (c_timeout <=> p_timeout)
    UNION ALL SELECT setting_version_id, created_by, created_at, 'max_concurrency_recognize', CAST(p_cr AS CHAR), CAST(c_cr AS CHAR) FROM pair WHERE NOT (c_cr <=> p_cr)
    UNION ALL SELECT setting_version_id, created_by, created_at, 'max_concurrency_render', CAST(p_cd AS CHAR), CAST(c_cd AS CHAR) FROM pair WHERE NOT (c_cd <=> p_cd)
    UNION ALL SELECT setting_version_id, created_by, created_at, 'web_concurrency_share', CAST(p_ws AS CHAR), CAST(c_ws AS CHAR) FROM pair WHERE NOT (c_ws <=> p_ws)
    UNION ALL SELECT setting_version_id, created_by, created_at, 'fallback_enabled', CAST(p_fb AS CHAR), CAST(c_fb AS CHAR) FROM pair WHERE NOT (c_fb <=> p_fb)
    UNION ALL SELECT setting_version_id, created_by, created_at, 'default_call_limit_per_hour', CAST(p_lim AS CHAR), CAST(c_lim AS CHAR) FROM pair WHERE NOT (c_lim <=> p_lim)
    UNION ALL SELECT setting_version_id, created_by, created_at, 'apply_rate_limit_count', CAST(p_rc AS CHAR), CAST(c_rc AS CHAR) FROM pair WHERE NOT (c_rc <=> p_rc)
    UNION ALL SELECT setting_version_id, created_by, created_at, 'apply_rate_window_minutes', CAST(p_rw AS CHAR), CAST(c_rw AS CHAR) FROM pair WHERE NOT (c_rw <=> p_rw)
    UNION ALL SELECT setting_version_id, created_by, created_at, 'structure_threshold', CAST(p_st AS CHAR), CAST(c_st AS CHAR) FROM pair WHERE NOT (c_st <=> p_st)
    UNION ALL SELECT setting_version_id, created_by, created_at, 'grade_caution_boundary', CAST(p_gc AS CHAR), CAST(c_gc AS CHAR) FROM pair WHERE NOT (c_gc <=> p_gc)
    UNION ALL SELECT setting_version_id, created_by, created_at, 'grade_distrust_boundary', CAST(p_gd AS CHAR), CAST(c_gd AS CHAR) FROM pair WHERE NOT (c_gd <=> p_gd)
    UNION ALL SELECT setting_version_id, created_by, created_at, 'web_max_active_per_client', CAST(p_wa AS CHAR), CAST(c_wa AS CHAR) FROM pair WHERE NOT (c_wa <=> p_wa)
    UNION ALL SELECT setting_version_id, created_by, created_at, 'web_hourly_request_cap', CAST(p_wh AS CHAR), CAST(c_wh AS CHAR) FROM pair WHERE NOT (c_wh <=> p_wh)
    UNION ALL SELECT setting_version_id, created_by, created_at, 'score_file_max_bytes', CAST(p_fm AS CHAR), CAST(c_fm AS CHAR) FROM pair WHERE NOT (c_fm <=> p_fm)
    UNION ALL SELECT setting_version_id, created_by, created_at, 'recommend_timeout_ms', CAST(p_rt AS CHAR), CAST(c_rt AS CHAR) FROM pair WHERE NOT (c_rt <=> p_rt)
  ) diff;

-- 변경 이력 탭 전체 (의존 뷰가 바뀌었으므로 다시 만든다)
CREATE OR REPLACE VIEW v_change_history_all AS
SELECT 'setting' AS target_type, CAST(setting_version_id AS CHAR) AS target_ref, operator_id, changed_at,
       field_name, before_value, after_value
  FROM v_setting_change_history
UNION ALL
SELECT target_type, target_ref, operator_id, changed_at, field_name, before_value, after_value
  FROM change_history;

-- C4 악기 목록 (코드·타악 포함, 국악기 먼저)
CREATE OR REPLACE VIEW v_instrument_menu AS
SELECT i.instrument_id, i.code, i.name, i.family, i.midi_program, i.is_percussion, i.soundfont_file,
       i.range_low, i.range_high,
       CASE i.family WHEN 'gugak' THEN 1 ELSE 2 END AS menu_group,
       i.menu_order
  FROM instrument i
 WHERE i.is_active = TRUE;


-- =====================================================================
-- 트리거
-- =====================================================================
DELIMITER //

-- G11 (S-3: 주소 해시)
CREATE OR REPLACE TRIGGER trg_g11_application_rate
BEFORE INSERT ON key_application
FOR EACH ROW
BEGIN
  IF EXISTS (SELECT 1 FROM v_apply_rate_window w
              WHERE w.rate_key IN (CONCAT('email:', NEW.contact_email), CONCAT('addr:', NEW.client_addr_hash))
                AND w.is_blocked = 1) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'G11: application rate limit exceeded';
  END IF;
END//

-- [결정 대기 Q3 → 임시안: 막는다] 폐기한 키는 되살리지 않는다(FR-054 "다시 신청") (V-5)
CREATE OR REPLACE TRIGGER trg_key_no_revive
BEFORE UPDATE ON access_key
FOR EACH ROW
BEGIN
  IF OLD.status = 'revoked' AND NEW.status <> 'revoked' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'BR-KEY-02: revoked key cannot be reactivated';
  END IF;
END//

DELIMITER ;
