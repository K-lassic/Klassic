-- 011_fallback_by_score_type.sql (2026-09-30 박예은 팀장 결정) — SD_03 §17-3 · UC_02 BR-FBK-09.
-- 대체 악보를 요청의 악보 종류별로 둔다: 오선보 = 아리랑(세마치장단) · 미뉴에트 G장조 중 무작위, 정간보 = 타령(가야금 정간보).
--   1) fallback_template.score_type 칸('staff' · 'jeongganbo' · NULL = 상관없음) + CHECK
--   2) 새 행 6개(web · api_server × 3곡) — 이미 있으면 넣지 않는다. 파일은 app/assets/templates/
--   3) 옛 「굿거리장단 기본」 행은 지우지 않고 끈다(전에 대체로 끝난 score_result 가 가리킴, 파일도 남김)
-- 쓰는 쪽: is_active = TRUE AND score_type = 요청 종류 가운데 무작위, 없으면 켜진 것 아무거나(backend services/fallback.ts · model-api fallback/template.py).
-- 몇 번을 다시 돌려도 된다.
SET NAMES utf8mb4;

ALTER TABLE fallback_template ADD COLUMN IF NOT EXISTS score_type VARCHAR(10) NULL AFTER is_active;
ALTER TABLE fallback_template DROP CONSTRAINT IF EXISTS chk_template_score_type;
ALTER TABLE fallback_template ADD CONSTRAINT chk_template_score_type CHECK (score_type IS NULL OR score_type IN ('staff','jeongganbo'));

INSERT INTO fallback_template (holder, name, midi_uri, musicxml_uri, version, score_type)
SELECT * FROM (
  SELECT 'web' AS holder, '아리랑 (세마치장단)' AS name, 'assets/templates/arirang-semachi-v1.mid' AS midi_uri,
         'assets/templates/arirang-semachi-v1.musicxml' AS musicxml_uri, 'v1' AS version, 'staff' AS score_type
  UNION ALL SELECT 'api_server', '아리랑 (세마치장단)', 'assets/templates/arirang-semachi-v1.mid', 'assets/templates/arirang-semachi-v1.musicxml', 'v1', 'staff'
  UNION ALL SELECT 'web', '미뉴에트 G장조', 'assets/templates/minuet-g-v1.mid', 'assets/templates/minuet-g-v1.musicxml', 'v1', 'staff'
  UNION ALL SELECT 'api_server', '미뉴에트 G장조', 'assets/templates/minuet-g-v1.mid', 'assets/templates/minuet-g-v1.musicxml', 'v1', 'staff'
  UNION ALL SELECT 'web', '타령 (가야금 정간보)', 'assets/templates/jeongganbo-taryeong-gayageum-v1.mid', 'assets/templates/jeongganbo-taryeong-gayageum-v1.musicxml', 'v1', 'jeongganbo'
  UNION ALL SELECT 'api_server', '타령 (가야금 정간보)', 'assets/templates/jeongganbo-taryeong-gayageum-v1.mid', 'assets/templates/jeongganbo-taryeong-gayageum-v1.musicxml', 'v1', 'jeongganbo'
) seed
 WHERE NOT EXISTS (SELECT 1 FROM fallback_template t WHERE t.holder = seed.holder AND t.name = seed.name);

UPDATE fallback_template SET is_active = FALSE WHERE name = '굿거리장단 기본' AND is_active = TRUE;
