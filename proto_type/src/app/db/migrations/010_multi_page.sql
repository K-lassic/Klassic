-- 010_multi_page.sql (2026-09-29 박예은: 009_account_admin 과 번호가 겹쳐 009 → 010 으로 바꿈)
-- 여러 쪽 (2026-09-29 황송해 결정) — SD_03 §17-2 · design/gugak_ddl.sql 과 같게.
-- 한 요청 = 악보 한 곡: PDF 한 개(모든 쪽, 300dpi) 또는 사진 여러 장(올린 순서), 최대 10쪽(UC1 A9 · BR-UPL-02 · BR-ENG-08 · BR-FBK-08).
--   1) upload_file.file_no + uq_upload_file_no(request_id, file_no) — uq_upload_one_per_request(request_id) 는 없앤다.
--      chk_upload_pdf_pages: 쪽수 1~10, pdf_converted_page 는 사용 안 함(NULL 또는 옛 값 1).
--   2) 새 표 request_page (쪽마다 구조 확인 → 엔진 → 타당성, '불신' 쪽은 실패)
--   3) engine_attempt.page_no · PK (request_id, page_no, attempt_no) · uq_engine_one_success (request_id, page_no, success_marker)
--   4) stage_timing.page_no(요청 단계 check·queue 는 0, 쪽 단계는 쪽 번호) · PK (request_id, stage_code, page_no)
--   5) 뷰 v_job_engine(가장 앞 쪽의 성공 시도) · v_request_log(쪽 단계 시간은 쪽 합계)
-- 기존 행은 file_no 1 · page_no 1/0 기본값으로 새 제약을 어기지 않는다.
-- 몇 번을 다시 돌려도 된다(IF [NOT] EXISTS · PK 는 information_schema 를 보고 바꿀 때만 바꾼다).
SET NAMES utf8mb4;

-- 1) 업로드 원본: 파일 번호(사진 올린 순서, PDF 는 1)
ALTER TABLE upload_file ADD COLUMN IF NOT EXISTS file_no SMALLINT NOT NULL DEFAULT 1 AFTER request_id;
--    새 UNIQUE 를 먼저 만들어야 옛 UNIQUE(request_id) 를 지울 수 있다(fk_upload_request 가 request_id 로 시작하는 색인을 쓴다)
ALTER TABLE upload_file ADD UNIQUE INDEX IF NOT EXISTS uq_upload_file_no (request_id, file_no);
ALTER TABLE upload_file DROP INDEX IF EXISTS uq_upload_one_per_request;
ALTER TABLE upload_file DROP CONSTRAINT IF EXISTS chk_upload_file_no;
ALTER TABLE upload_file ADD CONSTRAINT chk_upload_file_no CHECK (file_no BETWEEN 1 AND 10);
ALTER TABLE upload_file DROP CONSTRAINT IF EXISTS chk_upload_pdf_pages;
ALTER TABLE upload_file ADD CONSTRAINT chk_upload_pdf_pages CHECK ((pdf_page_count IS NULL OR pdf_page_count BETWEEN 1 AND 10)
                                      AND (pdf_converted_page IS NULL OR pdf_converted_page = 1));

-- 2) 요청 쪽 (B1a) — 쓰는 쪽: 모델 API 서버
CREATE TABLE IF NOT EXISTS request_page (
  request_id           BIGINT        NOT NULL,
  page_no              SMALLINT      NOT NULL,   -- 이어 붙이는 순서(1부터)
  file_no              SMALLINT      NOT NULL,   -- upload_file.file_no (사진이면 page_no 와 같고, PDF 면 1)
  source               VARCHAR(8)    NOT NULL,   -- 'file'(사진 한 장) · 'pdf_page'(PDF 의 한 쪽)
  image_short_side_px  INT           NULL,       -- 사진이면 그 사진, PDF 면 300dpi 로 바꾼 그림의 짧은 변
  structure_verdict    VARCHAR(10)   NULL,
  validity_grade       VARCHAR(10)   NULL,
  outcome              VARCHAR(10)   NOT NULL DEFAULT 'pending',
  fallback_reason      VARCHAR(20)   NULL,       -- 그 쪽의 실패 사유(요청 전체 대체 사유와 같은 값 목록)
  engine_name          VARCHAR(40)   NULL,
  engine_version       VARCHAR(40)   NULL,
  started_at           TIMESTAMP(3)  NULL,
  ended_at             TIMESTAMP(3)  NULL,
  duration_ms          BIGINT GENERATED ALWAYS AS (TIMESTAMPDIFF(MICROSECOND, started_at, ended_at) DIV 1000) STORED,
  CONSTRAINT pk_request_page PRIMARY KEY (request_id, page_no),
  CONSTRAINT fk_page_request FOREIGN KEY (request_id) REFERENCES score_request (request_id),
  CONSTRAINT fk_page_upload FOREIGN KEY (request_id, file_no) REFERENCES upload_file (request_id, file_no),
  CONSTRAINT chk_page_no CHECK (page_no BETWEEN 1 AND 10),
  CONSTRAINT chk_page_source CHECK (source IN ('file','pdf_page')),
  CONSTRAINT chk_page_short_side CHECK (image_short_side_px IS NULL OR image_short_side_px >= 650),
  CONSTRAINT chk_page_structure CHECK (structure_verdict IN ('pass','ambiguous','fail')),
  CONSTRAINT chk_page_grade CHECK (validity_grade IN ('trust','caution','distrust')),
  CONSTRAINT chk_page_outcome CHECK (outcome IN ('pending','converted','failed')),
  CONSTRAINT chk_page_failure CHECK ((outcome = 'failed' AND fallback_reason IS NOT NULL AND fallback_reason IN
                                      ('recognition_failed','timeout','engine_stopped','no_structure','distrust'))
                                  OR (outcome <> 'failed' AND fallback_reason IS NULL)),
  CONSTRAINT chk_page_converted CHECK (outcome <> 'converted' OR validity_grade IN ('trust','caution')),
  CONSTRAINT chk_page_time CHECK (ended_at IS NULL OR started_at IS NULL OR ended_at >= started_at)
);

-- 3) 엔진 시도: 쪽마다(성공은 쪽마다 한 번)
ALTER TABLE engine_attempt ADD COLUMN IF NOT EXISTS page_no SMALLINT NOT NULL DEFAULT 1 AFTER request_id;
SET @m009_pk := (SELECT IF(COUNT(*) = 0,
                   'ALTER TABLE engine_attempt DROP PRIMARY KEY, ADD PRIMARY KEY (request_id, page_no, attempt_no)',
                   'DO 0')
                   FROM information_schema.key_column_usage
                  WHERE table_schema = DATABASE() AND table_name = 'engine_attempt'
                    AND constraint_name = 'PRIMARY' AND column_name = 'page_no');
PREPARE m009_stmt FROM @m009_pk;
EXECUTE m009_stmt;
DEALLOCATE PREPARE m009_stmt;
ALTER TABLE engine_attempt DROP INDEX IF EXISTS uq_engine_one_success;
ALTER TABLE engine_attempt ADD UNIQUE INDEX IF NOT EXISTS uq_engine_one_success (request_id, page_no, success_marker);
ALTER TABLE engine_attempt DROP CONSTRAINT IF EXISTS chk_attempt_page;
ALTER TABLE engine_attempt ADD CONSTRAINT chk_attempt_page CHECK (page_no BETWEEN 1 AND 10);

-- 4) 단계별 소요 시간: 요청 단계(check·queue)는 0, 쪽 단계(structure·jg_convert·validity)는 쪽 번호
ALTER TABLE stage_timing ADD COLUMN IF NOT EXISTS page_no SMALLINT NOT NULL DEFAULT 0 AFTER stage_code;
SET @m009_pk := (SELECT IF(COUNT(*) = 0,
                   'ALTER TABLE stage_timing DROP PRIMARY KEY, ADD PRIMARY KEY (request_id, stage_code, page_no)',
                   'DO 0')
                   FROM information_schema.key_column_usage
                  WHERE table_schema = DATABASE() AND table_name = 'stage_timing'
                    AND constraint_name = 'PRIMARY' AND column_name = 'page_no');
PREPARE m009_stmt FROM @m009_pk;
EXECUTE m009_stmt;
DEALLOCATE PREPARE m009_stmt;
ALTER TABLE stage_timing DROP CONSTRAINT IF EXISTS chk_stage_page;
ALTER TABLE stage_timing ADD CONSTRAINT chk_stage_page CHECK (page_no BETWEEN 0 AND 10);

-- 5) 뷰
-- 요청의 엔진 이름·버전 = 성공한 시도 (BR-ENG-01·04)
-- 여러 쪽: 쪽마다 성공 시도가 있을 수 있어 가장 앞 쪽의 성공 시도 하나로 대표한다(쪽별 엔진은 request_page)
CREATE OR REPLACE VIEW v_job_engine AS
SELECT a.request_id, a.engine_name, a.engine_version
  FROM engine_attempt a
 WHERE a.outcome = 'success'
   AND a.page_no = (SELECT MIN(b.page_no) FROM engine_attempt b WHERE b.request_id = a.request_id AND b.outcome = 'success');

-- 요청 기록 (S6 요청 기록 탭 · 6.4 · H4 · BR-OPS-03) — 쪽 단계 시간은 쪽 합계
CREATE OR REPLACE VIEW v_request_log AS
SELECT r.request_id, r.request_no, r.channel, r.route, r.status, r.fallback_reason,
       r.file_kind, r.chosen_score_type,
       j.confirmed_score_type, j.structure_verdict, j.type_mismatch, j.type_answer, j.validity_grade,
       e.engine_name, e.engine_version,
       (SELECT duration_ms FROM stage_timing t WHERE t.request_id = r.request_id AND t.stage_code = 'check')      AS check_ms,
       (SELECT duration_ms FROM stage_timing t WHERE t.request_id = r.request_id AND t.stage_code = 'queue')      AS queue_ms,
       (SELECT SUM(duration_ms) FROM stage_timing t WHERE t.request_id = r.request_id AND t.stage_code = 'structure')  AS structure_ms,
       (SELECT SUM(a.duration_ms) FROM engine_attempt a WHERE a.request_id = r.request_id)                       AS recognize_ms,
       (SELECT SUM(duration_ms) FROM stage_timing t WHERE t.request_id = r.request_id AND t.stage_code = 'jg_convert') AS jg_convert_ms,
       (SELECT SUM(duration_ms) FROM stage_timing t WHERE t.request_id = r.request_id AND t.stage_code = 'validity')   AS validity_ms,
       (SELECT MAX(c.duration_ms) FROM recommendation c WHERE c.request_id = r.request_id)                      AS recommend_ms,
       (SELECT MAX(d.render_ms) FROM derived_file d WHERE d.request_id = r.request_id)                          AS render_ms,
       r.received_at, r.completed_at
  FROM score_request r
  LEFT JOIN processing_job j ON j.request_id = r.request_id
  LEFT JOIN v_job_engine e   ON e.request_id = r.request_id;
