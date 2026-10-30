-- 005_min_short_edge_500.sql
-- 최소 해상도(BR-UPL-03, G4)를 짧은 변 800px → 500px 로 낮춘다 (2026-09-29 박예은 팀장 결정).
-- 앱 검사 기준은 shared/upload-rules.json min_short_edge_px 와 같아야 한다 — 이 제약은 G1 의 마지막 방어선이다.
SET NAMES utf8mb4;

ALTER TABLE upload_file DROP CONSTRAINT chk_g1_image_limits;
ALTER TABLE upload_file ADD CONSTRAINT chk_g1_image_limits CHECK (image_short_side_px IS NULL
                                     OR (image_short_side_px >= 500 AND size_bytes <= 20971520));
