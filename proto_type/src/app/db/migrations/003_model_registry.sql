-- 003_model_registry.sql
-- 모델을 바꾸거나 더할 수 있게 하는 등록부와 불러오기(로딩) 기록.
-- 근거: 2026-09-28 박예은 팀장 지시("모델은 가상환경(uvicorn)이나 ollama server에서 로드", "모델은 변경되거나 추가할 수 있다",
--       "모델 추가·로딩 소요 시간을 고려한 사용자·관리자 화면"), OLLAMA 설정 참조.md §7·§8
--
-- 규칙
--   * 설정의 엔진 호출 순서(setting_engine_order.engine_name)는 이 등록부의 model_name 을 가리킨다.
--     등록부에 없거나 꺼진 이름은 설정에 넣을 수 없다(G6 SETTINGS_UNKNOWN_ENGINE — 앱이 판정).
--   * provider: venv(엔진별 Python 가상환경 — 모델 API 서버가 하위 프로세스로 부름)
--               ollama(공유 Ollama 서버 — 서비스 코드는 pull·create·rm·stop 을 부르지 않는다. 모델 준비는 사람이 한 번)
--               builtin(모델 API 서버 안의 규칙표 등)
--   * 불러오기 상태(지금 올라와 있는지)는 모델 API 서버 메모리가 가진다. DB 에는 소요 시간 기록만 남겨
--     "예상 준비 시간"을 계산한다(v_model_load_estimate).
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS model_registry (
  model_name      VARCHAR(40)    NOT NULL,     -- 설정·기록에 쓰는 이름(예: homr, jeongganbo-omr, rules, llm-gemma3-4b)
  kind            VARCHAR(16)    NOT NULL,     -- 맡는 기능
  provider        VARCHAR(8)     NOT NULL,
  display_name    VARCHAR(100)   NOT NULL,
  provider_ref    VARCHAR(300)   NULL,         -- venv: 가상환경 폴더 · ollama: 모델 태그(예: gemma3:4b) · builtin: NULL
  config_json     LONGTEXT       NULL,         -- 어댑터 설정(명령·옵션). JSON
  enabled         BOOLEAN        NOT NULL DEFAULT TRUE,
  registered_by   BIGINT         NULL,         -- 시드로 넣은 기본 모델은 NULL
  registered_at   TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  notes           VARCHAR(500)   NULL,
  CONSTRAINT pk_model_registry PRIMARY KEY (model_name),
  CONSTRAINT fk_model_registered_by FOREIGN KEY (registered_by) REFERENCES operator_account (operator_id),
  CONSTRAINT chk_model_kind CHECK (kind IN ('omr_staff','omr_jeongganbo','recommend')),
  CONSTRAINT chk_model_provider CHECK (provider IN ('venv','ollama','builtin')),
  CONSTRAINT chk_model_name CHECK (model_name REGEXP '^[a-z0-9][a-z0-9._-]{1,39}$'),
  CONSTRAINT chk_model_ref CHECK ((provider = 'builtin') OR (provider_ref IS NOT NULL AND TRIM(provider_ref) <> '')),
  -- OLLAMA 설정 참조 §7.3: ':cloud' 모델은 쓰지 않는다
  CONSTRAINT chk_model_no_cloud CHECK (provider <> 'ollama' OR provider_ref NOT LIKE '%:cloud%' AND provider_ref NOT LIKE '%-cloud'),
  CONSTRAINT chk_model_config_json CHECK (config_json IS NULL OR JSON_VALID(config_json))
);

-- 불러오기 기록 — 워밍업(관리자 [불러오기]·서버 시작·설정 반영)과 요청 중 처음 부를 때
CREATE TABLE IF NOT EXISTS model_load_event (
  load_id        BIGINT         NOT NULL AUTO_INCREMENT,
  model_name     VARCHAR(40)    NOT NULL,
  trigger_kind   VARCHAR(10)    NOT NULL,
  operator_id    BIGINT         NULL,
  started_at     TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at    TIMESTAMP(3)   NULL,
  outcome        VARCHAR(10)    NOT NULL DEFAULT 'running',
  error_text     VARCHAR(500)   NULL,
  duration_ms    BIGINT GENERATED ALWAYS AS (TIMESTAMPDIFF(MICROSECOND, started_at, finished_at) DIV 1000) STORED,
  CONSTRAINT pk_model_load_event PRIMARY KEY (load_id),
  CONSTRAINT fk_load_model FOREIGN KEY (model_name) REFERENCES model_registry (model_name) ON DELETE CASCADE,
  CONSTRAINT fk_load_operator FOREIGN KEY (operator_id) REFERENCES operator_account (operator_id),
  CONSTRAINT chk_load_trigger CHECK (trigger_kind IN ('admin','startup','reload','request')),
  CONSTRAINT chk_load_outcome CHECK (outcome IN ('running','ok','failed','timeout')),
  CONSTRAINT chk_load_finished CHECK ((outcome = 'running' AND finished_at IS NULL)
                                   OR (outcome <> 'running' AND finished_at IS NOT NULL)),
  CONSTRAINT chk_load_error CHECK (outcome NOT IN ('failed','timeout') OR error_text IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_load_model_time ON model_load_event (model_name, started_at);

-- 예상 준비 시간 = 최근 성공 5번의 평균·최대 (화면의 "모델 준비 중 — 약 N초")
CREATE OR REPLACE VIEW v_model_load_estimate AS
WITH ok_ranked AS (
  SELECT e.model_name, e.duration_ms, e.finished_at,
         ROW_NUMBER() OVER (PARTITION BY e.model_name ORDER BY e.load_id DESC) AS rn
    FROM model_load_event e
   WHERE e.outcome = 'ok'
), last_any AS (
  SELECT e.model_name, e.outcome, e.error_text,
         ROW_NUMBER() OVER (PARTITION BY e.model_name ORDER BY e.load_id DESC) AS rn
    FROM model_load_event e
)
SELECT m.model_name,
       AVG(r.duration_ms)  AS avg_load_ms,
       MAX(r.duration_ms)  AS max_load_ms,
       MAX(r.finished_at)  AS last_ok_at,
       MAX(l.outcome)      AS last_outcome,
       MAX(l.error_text)   AS last_error
  FROM model_registry m
  LEFT JOIN ok_ranked r ON r.model_name = m.model_name AND r.rn <= 5
  LEFT JOIN last_any  l ON l.model_name = m.model_name AND l.rn = 1
 GROUP BY m.model_name;

-- 추천 모델도 엔진 호출 순서로 정한다(예: llm-gemma3-4b → rules). 규칙표(rules)는 항상 마지막 안전판이다.
ALTER TABLE setting_engine_order DROP CONSTRAINT IF EXISTS chk_engine_order_type;
ALTER TABLE setting_engine_order ADD CONSTRAINT chk_engine_order_type
  CHECK (score_type IN ('staff','jeongganbo','recommend'));

-- LLM 추천은 공유 Ollama 서버에서 줄을 설 수 있어 규칙표보다 긴 제한 시간을 따로 둔다
ALTER TABLE processing_setting_version
  ADD COLUMN IF NOT EXISTS llm_recommend_timeout_ms INT NULL;
ALTER TABLE processing_setting_version DROP CONSTRAINT IF EXISTS chk_g6_llm_ms;
ALTER TABLE processing_setting_version ADD CONSTRAINT chk_g6_llm_ms CHECK (llm_recommend_timeout_ms >= 1);

-- 운영자 조치 이력에 모델 등록부 조치를 더한다(FR-052)
ALTER TABLE change_history DROP CONSTRAINT IF EXISTS chk_history_target;
ALTER TABLE change_history ADD CONSTRAINT chk_history_target
  CHECK (target_type IN ('access_key','key_application','license_policy','model'));
ALTER TABLE change_history DROP CONSTRAINT IF EXISTS chk_history_field;
ALTER TABLE change_history ADD CONSTRAINT chk_history_field
  CHECK (field_name IN ('issued','status','call_limit_per_hour','retained','confirmed',
                        'registered','enabled','provider_ref','config','load','unregistered'));

-- 컬럼을 더했으므로 SELECT * 뷰를 다시 만든다
CREATE OR REPLACE VIEW v_current_setting AS
SELECT s.*
  FROM processing_setting_version s
 WHERE s.setting_version_id = (SELECT MAX(setting_version_id) FROM processing_setting_version);

-- 설정 변경 이력에 추천 순서·LLM 제한 시간을 더한다
CREATE OR REPLACE VIEW v_setting_change_history AS
WITH v AS (
  SELECT s.*,
         (SELECT GROUP_CONCAT(o.engine_name ORDER BY o.seq SEPARATOR '>') FROM setting_engine_order o
           WHERE o.setting_version_id = s.setting_version_id AND o.score_type = 'staff')      AS staff_order,
         (SELECT GROUP_CONCAT(o.engine_name ORDER BY o.seq SEPARATOR '>') FROM setting_engine_order o
           WHERE o.setting_version_id = s.setting_version_id AND o.score_type = 'jeongganbo') AS jeongganbo_order,
         (SELECT GROUP_CONCAT(o.engine_name ORDER BY o.seq SEPARATOR '>') FROM setting_engine_order o
           WHERE o.setting_version_id = s.setting_version_id AND o.score_type = 'recommend')  AS recommend_order,
         LAG(s.setting_version_id) OVER (ORDER BY s.setting_version_id) AS prev_id
    FROM processing_setting_version s
), pair AS (
  SELECT cur.setting_version_id, cur.created_by, cur.created_at,
         cur.staff_order AS c_staff, prv.staff_order AS p_staff,
         cur.jeongganbo_order AS c_jg, prv.jeongganbo_order AS p_jg,
         cur.recommend_order AS c_ro, prv.recommend_order AS p_ro,
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
         cur.recommend_timeout_ms AS c_rt, prv.recommend_timeout_ms AS p_rt,
         cur.llm_recommend_timeout_ms AS c_lt, prv.llm_recommend_timeout_ms AS p_lt
    FROM v cur LEFT JOIN v prv ON prv.setting_version_id = cur.prev_id
)
SELECT setting_version_id, created_by AS operator_id, created_at AS changed_at, field_name,
       before_value, after_value
  FROM (
    SELECT setting_version_id, created_by, created_at, 'staff_engine_order' AS field_name, p_staff AS before_value, c_staff AS after_value FROM pair WHERE NOT (c_staff <=> p_staff)
    UNION ALL SELECT setting_version_id, created_by, created_at, 'jeongganbo_engine_order', p_jg, c_jg FROM pair WHERE NOT (c_jg <=> p_jg)
    UNION ALL SELECT setting_version_id, created_by, created_at, 'recommend_engine_order', p_ro, c_ro FROM pair WHERE NOT (c_ro <=> p_ro)
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
    UNION ALL SELECT setting_version_id, created_by, created_at, 'llm_recommend_timeout_ms', CAST(p_lt AS CHAR), CAST(c_lt AS CHAR) FROM pair WHERE NOT (c_lt <=> p_lt)
  ) diff;

CREATE OR REPLACE VIEW v_change_history_all AS
SELECT 'setting' AS target_type, CAST(setting_version_id AS CHAR) AS target_ref, operator_id, changed_at,
       field_name, before_value, after_value
  FROM v_setting_change_history
UNION ALL
SELECT target_type, target_ref, operator_id, changed_at, field_name, before_value, after_value
  FROM change_history;
