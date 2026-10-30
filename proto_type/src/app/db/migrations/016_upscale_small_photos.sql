-- 016 작은 사진 자동 확대 (2026-09-30 황송해 119번 — design/UC_03 BR-UPL-03 · SD_01 1.2b · SD_03 · gugak_ddl.sql)
--
-- 짧은 변 300~649px 사진 · PDF 쪽은 반려하지 않고 1000px 로 늘려 읽는다. 반려 기준(하한)은 300px.
-- 늘려 읽은 쪽은 request_page.upscaled_short_side_px 에 늘린 짧은 변을 적는다. 다시 실행해도 된다.
SET NAMES utf8mb4;

ALTER TABLE upload_file DROP CONSTRAINT IF EXISTS chk_g1_image_limits;
ALTER TABLE upload_file ADD CONSTRAINT chk_g1_image_limits CHECK (image_short_side_px IS NULL
                                     OR (image_short_side_px >= 300 AND size_bytes <= 20971520));
ALTER TABLE request_page DROP CONSTRAINT IF EXISTS chk_page_short_side;
ALTER TABLE request_page ADD CONSTRAINT chk_page_short_side CHECK (image_short_side_px IS NULL OR image_short_side_px >= 300);
ALTER TABLE request_page ADD COLUMN IF NOT EXISTS upscaled_short_side_px INT NULL AFTER image_short_side_px;
