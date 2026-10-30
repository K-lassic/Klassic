-- 007_pdf_input.sql
-- 사진·PDF 입력 (2026-09-29 황송해 결정) — SD_03 §17-1 · design/gugak_ddl.sql 과 같게.
-- 받는 파일은 사진(image)·PDF(pdf) 한 개, 웹·API 모두. MIDI·MusicXML 은 G1 형식 반려(직행 없음).
-- 'midi'·'musicxml' 값은 전에 접수한 행 때문에 값 목록에만 남긴다. 기존 행은 모두 image·midi·musicxml 이라 새 제약을 어기지 않는다.
-- 앱 검사 기준: shared/upload-rules.json kinds.pdf · user_upload_kinds.
SET NAMES utf8mb4;

-- 1) 요청 파일 종류에 'pdf' 추가
ALTER TABLE score_request DROP CONSTRAINT IF EXISTS chk_request_file_kind;
ALTER TABLE score_request ADD CONSTRAINT chk_request_file_kind CHECK (file_kind IN ('image','pdf','midi','musicxml'));

-- 2) BR-ENG-05: 사진·PDF 는 악보 종류를 반드시 고르고, MIDI·MusicXML 은 고르지 않는다
--    (NULL 이 IN (...) 을 만나면 UNKNOWN 이 되어 CHECK 를 통과하므로 IS NOT NULL 을 함께 건다)
ALTER TABLE score_request DROP CONSTRAINT IF EXISTS chk_request_score_type;
ALTER TABLE score_request ADD CONSTRAINT chk_request_score_type CHECK ((file_kind IN ('image','pdf') AND chosen_score_type IS NOT NULL
                                            AND chosen_score_type IN ('staff','jeongganbo'))
                                        OR (file_kind NOT IN ('image','pdf') AND chosen_score_type IS NULL));

--    BR-RTE-01·03: 사진·PDF 는 인식 변환 또는 대체, MIDI·MusicXML(이전 행)은 직행
ALTER TABLE score_request DROP CONSTRAINT IF EXISTS chk_request_route;
ALTER TABLE score_request ADD CONSTRAINT chk_request_route CHECK ((file_kind IN ('image','pdf') AND route IN ('recognize','fallback'))
                                   OR (file_kind NOT IN ('image','pdf') AND route = 'direct'));

-- 3) 업로드 원본: PDF 전체 쪽수 · 변환한 쪽 번호(첫 쪽만 → 1). image_short_side_px 는 PDF 면 300dpi 로 바꾼 그림의 짧은 변
ALTER TABLE upload_file ADD COLUMN IF NOT EXISTS pdf_page_count INT NULL AFTER image_short_side_px;
ALTER TABLE upload_file ADD COLUMN IF NOT EXISTS pdf_converted_page SMALLINT NULL AFTER pdf_page_count;
ALTER TABLE upload_file DROP CONSTRAINT IF EXISTS chk_upload_pdf_pages;
ALTER TABLE upload_file ADD CONSTRAINT chk_upload_pdf_pages CHECK ((pdf_page_count IS NULL AND pdf_converted_page IS NULL)
                                      OR (pdf_page_count >= 1 AND pdf_converted_page = 1));

-- 4) S6 지표: PDF 도 사진 경로(인식 변환 · 대체)로 센다
CREATE OR REPLACE VIEW v_metric_by_channel AS
SELECT scope,
       SUM(is_image)                                                        AS image_requests,
       SUM(is_first_pass)                                                   AS first_pass_trust,
       CASE WHEN SUM(is_image) = 0 THEN NULL ELSE SUM(is_first_pass) / SUM(is_image) END AS first_pass_rate,
       SUM(is_caution)                                                      AS caution_count,
       CASE WHEN SUM(is_image) = 0 THEN NULL ELSE SUM(is_fallback) / SUM(is_image) END   AS fallback_rate,
       CASE WHEN SUM(has_result) = 0 THEN NULL ELSE SUM(is_edited) / SUM(has_result) END AS edit_usage_rate,
       MAX(wait_ms)                                                         AS max_wait_ms,
       SUM(is_down)                                                         AS service_down_count
  FROM (
    SELECT sc.scope, x.*
      FROM (SELECT 'all' AS scope UNION ALL SELECT 'web' UNION ALL SELECT 'api') sc
      JOIN (
        SELECT r.channel,
               CASE WHEN r.file_kind IN ('image','pdf') THEN 1 ELSE 0 END AS is_image,
               CASE WHEN r.file_kind IN ('image','pdf') AND r.route = 'recognize' AND j.validity_grade = 'trust'
                         AND r.status = 'completed'
                         AND (r.channel = 'api' OR r.first_played_at IS NOT NULL) THEN 1 ELSE 0 END AS is_first_pass,
               CASE WHEN r.route = 'recognize' AND j.validity_grade = 'caution' THEN 1 ELSE 0 END AS is_caution,
               CASE WHEN r.file_kind IN ('image','pdf') AND r.route = 'fallback' THEN 1 ELSE 0 END AS is_fallback,
               CASE WHEN r.status = 'completed' THEN 1 ELSE 0 END AS has_result,
               CASE WHEN EXISTS (SELECT 1 FROM edited_score es WHERE es.request_id = r.request_id) THEN 1 ELSE 0 END AS is_edited,
               CASE WHEN r.channel = 'web' THEN TIMESTAMPDIFF(MICROSECOND, r.received_at, r.first_played_at) DIV 1000
                    ELSE TIMESTAMPDIFF(MICROSECOND, r.received_at, r.completed_at) DIV 1000 END AS wait_ms,
               CASE WHEN r.status = 'service_down' THEN 1 ELSE 0 END AS is_down
          FROM score_request r
          LEFT JOIN processing_job j ON j.request_id = r.request_id
      ) x ON sc.scope = 'all' OR sc.scope = x.channel
  ) m
 GROUP BY scope;
