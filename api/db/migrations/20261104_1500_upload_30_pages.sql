-- =============================================================================
-- #168 업로드 상한 10 → 30 (사진 30장 · PDF 30쪽) — 쪽 번호 · 파일 번호 · PDF 쪽 수 CHECK 제약을 1~30 으로
--
--   기준판 스키마(20261030_1700)는 v0.1.1 상한 10 을 제약으로 들고 있어, shared/upload-rules.json 만 30 으로 바꾸면
--   11쪽부터 INSERT 가 CHECK 위반(errno 4025)으로 500 이 된다. 제약 이름 · 다른 조건은 그대로 두고 숫자만 바꾼다.
-- =============================================================================

ALTER TABLE `upload_file`
  DROP CONSTRAINT `chk_upload_file_no`,
  ADD CONSTRAINT `chk_upload_file_no` CHECK (`file_no` between 1 and 30),
  DROP CONSTRAINT `chk_upload_pdf_pages`,
  ADD CONSTRAINT `chk_upload_pdf_pages` CHECK ((`pdf_page_count` is null or `pdf_page_count` between 1 and 30) and (`pdf_converted_page` is null or `pdf_converted_page` = 1));

ALTER TABLE `request_page`
  DROP CONSTRAINT `chk_page_no`,
  ADD CONSTRAINT `chk_page_no` CHECK (`page_no` between 1 and 30);

ALTER TABLE `engine_attempt`
  DROP CONSTRAINT `chk_attempt_page`,
  ADD CONSTRAINT `chk_attempt_page` CHECK (`page_no` between 1 and 30);

ALTER TABLE `stage_timing`
  DROP CONSTRAINT `chk_stage_page`,
  ADD CONSTRAINT `chk_stage_page` CHECK (`page_no` between 0 and 30);
