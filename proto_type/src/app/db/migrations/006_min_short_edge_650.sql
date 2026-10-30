-- 006_min_short_edge_650.sql
-- 최소 해상도(BR-UPL-03, G4)를 짧은 변 650px 로 정한다 (2026-09-29 박예은 팀장 결정).
-- 005 에서 500px 로 낮췄으나, 500px 시험에서 오선보 구조 확인이 8장 모두 막아(PYE_해상도500_시험결과.md) 650px 로 올린다.
-- 앱 검사 기준 shared/upload-rules.json min_short_edge_px 와 같아야 한다.
SET NAMES utf8mb4;

ALTER TABLE upload_file DROP CONSTRAINT chk_g1_image_limits;
ALTER TABLE upload_file ADD CONSTRAINT chk_g1_image_limits CHECK (image_short_side_px IS NULL
                                     OR (image_short_side_px >= 650 AND size_bytes <= 20971520));
