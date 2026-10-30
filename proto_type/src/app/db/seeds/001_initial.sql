-- 001_initial.sql — 처음 한 번 넣는 기본 행 (tasks.md T017)
-- 다시 실행해도 같은 행을 두 번 넣지 않는다(NOT EXISTS 가드).
-- 숫자는 research R17 의 임시값(측정 전)이다. 관리자 화면 S6 에서 바꾼다.
SET NAMES utf8mb4;

-- 설정 판본은 운영자가 만든다(created_by NOT NULL). 운영자가 아직 없으면 로그인할 수 없는
-- 시스템 계정을 하나 만든다(비밀번호 해시 '!' 는 어떤 비밀번호와도 맞지 않는다, 사용 중지 상태).
INSERT INTO operator_account (login_id, password_hash, display_name, disabled_at)
SELECT 'system', '!', '시스템(초기 설정)', CURRENT_TIMESTAMP(3) FROM (SELECT 1) x
 WHERE NOT EXISTS (SELECT 1 FROM operator_account);

-- 설정 판본 1 (research R17 임시값)
INSERT INTO processing_setting_version
  (created_by, timeout_seconds, max_concurrency, fallback_enabled,
   default_call_limit_per_hour, apply_rate_limit_count, apply_rate_window_minutes,
   structure_threshold, grade_caution_boundary, grade_distrust_boundary,
   api_apply_status,
   web_max_active_per_client, web_hourly_request_cap,
   max_concurrency_recognize, max_concurrency_render, web_concurrency_share,
   score_file_max_bytes, recommend_timeout_ms, llm_recommend_timeout_ms,
   login_max_failures, login_lock_minutes)
SELECT (SELECT MIN(operator_id) FROM operator_account), 180, 2, TRUE,
       30, 3, 1440,
       0.5000, 0.7000, 0.4000,
       'pending',
       1, 10,
       2, 2, 1,
       5242880, 3000, 20000,
       5, 10
  FROM (SELECT 1) x
 WHERE NOT EXISTS (SELECT 1 FROM processing_setting_version);

-- 모델 등록부 기본 행 (003). 엔진 가상환경은 ops/engines/install_*.sh 가 ~/gugak-engines/<이름> 에 만든다.
INSERT INTO model_registry (model_name, kind, provider, display_name, provider_ref, config_json, enabled, notes)
SELECT * FROM (
  SELECT 'homr' AS model_name, 'omr_staff' AS kind, 'venv' AS provider, 'homr (오선보, AGPL-3.0)' AS display_name,
         '~/gugak-engines/homr' AS provider_ref, '{"adapter":"homr","cold_start_hint_s":40}' AS config_json, TRUE AS enabled,
         '1순위 오선보 인식(JSG_추천모델 2.1). 수정 없이 호출만' AS notes
  UNION ALL SELECT 'audiveris', 'omr_staff', 'venv', 'Audiveris (오선보, AGPL-3.0, Java)', '~/gugak-engines/audiveris',
         '{"adapter":"audiveris","java":"/opt/homebrew/opt/openjdk@21/bin/java","cold_start_hint_s":20}', TRUE, '인쇄 스캔 악보용 대안'
  UNION ALL SELECT 'jeongganbo-omr', 'omr_jeongganbo', 'venv', 'MALerLab jeongganbo-omr (정간보, MIT)', '~/gugak-engines/jeongganbo',
         '{"adapter":"jeongganbo","device":"mps","cold_start_hint_s":30}', TRUE, '정간보 유일 후보. 결과를 MusicXML 로 바꿔 돌려줌'
  UNION ALL SELECT 'rules', 'recommend', 'builtin', '규칙표 추천', NULL,
         '{"adapter":"rules","file":"app/recommend/rules.yaml"}', TRUE, '항상 마지막 안전판'
  UNION ALL SELECT 'llm-gemma3-4b', 'recommend', 'ollama', 'Ollama gemma3:4b 추천', 'gemma3:4b',
         '{"adapter":"ollama_recommend","num_ctx":4096,"keep_alive":"5m","think":false,"cold_start_hint_s":30}', TRUE,
         '공유 Ollama 서버(OLLAMA 설정 참조 §7.2 채팅 기본). 실패·지연 시 규칙표로 넘어감'
) seed
 WHERE NOT EXISTS (SELECT 1 FROM model_registry m WHERE m.model_name = seed.model_name);

-- 엔진 호출 순서(판본 1): 오선보 homr→audiveris, 정간보 jeongganbo-omr, 추천 llm → 규칙표
INSERT INTO setting_engine_order (setting_version_id, score_type, seq, engine_name)
SELECT v.setting_version_id, o.score_type, o.seq, o.engine_name
  FROM (SELECT MIN(setting_version_id) AS setting_version_id FROM processing_setting_version) v
  CROSS JOIN (
    SELECT 'staff' AS score_type, 1 AS seq, 'homr' AS engine_name
    UNION ALL SELECT 'staff', 2, 'audiveris'
    UNION ALL SELECT 'jeongganbo', 1, 'jeongganbo-omr'
    UNION ALL SELECT 'recommend', 1, 'llm-gemma3-4b'
    UNION ALL SELECT 'recommend', 2, 'rules'
  ) o
 WHERE NOT EXISTS (SELECT 1 FROM setting_engine_order e WHERE e.setting_version_id = v.setting_version_id);

-- 악기 (shared/instruments.json 과 같은 값 — 국악기 먼저)
INSERT INTO instrument (code, name, family, midi_program, is_percussion, soundfont_file, range_low, range_high, menu_order)
SELECT * FROM (
  SELECT 'gayageum' AS code, '가야금' AS name, 'gugak' AS family, 107 AS midi_program, FALSE AS is_percussion, 'gugak.sf2' AS soundfont_file, 43 AS range_low, 81 AS range_high, 1 AS menu_order
  UNION ALL SELECT 'geomungo', '거문고', 'gugak', 106, FALSE, 'gugak.sf2', 36, 72, 2
  UNION ALL SELECT 'daegeum',  '대금',   'gugak', 77,  FALSE, 'gugak.sf2', 58, 87, 3
  UNION ALL SELECT 'haegeum',  '해금',   'gugak', 110, FALSE, 'gugak.sf2', 55, 86, 4
  UNION ALL SELECT 'piri',     '피리',   'gugak', 111, FALSE, 'gugak.sf2', 58, 84, 5
  UNION ALL SELECT 'ajaeng',   '아쟁',   'gugak', 42,  FALSE, 'gugak.sf2', 38, 72, 6
  UNION ALL SELECT 'janggu',   '장구',   'gugak', NULL, TRUE, 'gugak.sf2', NULL, NULL, 7
  UNION ALL SELECT 'buk',      '북',     'gugak', NULL, TRUE, 'gugak.sf2', NULL, NULL, 8
  UNION ALL SELECT 'piano',    '피아노', 'other', 0,   FALSE, 'FluidR3_GM.sf2', 21, 108, 11
  UNION ALL SELECT 'acoustic_guitar', '어쿠스틱 기타', 'other', 24, FALSE, 'FluidR3_GM.sf2', 40, 88, 12
  UNION ALL SELECT 'violin',   '바이올린', 'other', 40, FALSE, 'FluidR3_GM.sf2', 55, 103, 13
  UNION ALL SELECT 'cello',    '첼로',   'other', 42,  FALSE, 'FluidR3_GM.sf2', 36, 76, 14
  UNION ALL SELECT 'harp',     '하프',   'other', 46,  FALSE, 'FluidR3_GM.sf2', 24, 103, 15
  UNION ALL SELECT 'flute',    '플루트', 'other', 73,  FALSE, 'FluidR3_GM.sf2', 60, 96, 16
  UNION ALL SELECT 'clarinet', '클라리넷', 'other', 71, FALSE, 'FluidR3_GM.sf2', 50, 94, 17
  UNION ALL SELECT 'strings',  '현악 합주', 'other', 48, FALSE, 'FluidR3_GM.sf2', 28, 96, 18
  UNION ALL SELECT 'marimba',  '마림바', 'other', 12,  FALSE, 'FluidR3_GM.sf2', 45, 96, 19
) seed
 WHERE NOT EXISTS (SELECT 1 FROM instrument i WHERE i.code = seed.code);

-- 기본 국악기 구성 = 선율 가야금 + 타악 장구 (BR-PLY-01, spec Assumptions)
INSERT INTO ensemble (ensemble_kind)
SELECT 'default' FROM (SELECT 1) x WHERE NOT EXISTS (SELECT 1 FROM ensemble WHERE ensemble_kind = 'default');
INSERT INTO ensemble_member (ensemble_id, part_no, part_role, instrument_id)
SELECT e.ensemble_id, m.part_no, m.part_role, i.instrument_id
  FROM ensemble e
  CROSS JOIN (SELECT 1 AS part_no, 'melody' AS part_role, 'gayageum' AS code
              UNION ALL SELECT 2, 'percussion', 'janggu') m
  JOIN instrument i ON i.code = m.code
 WHERE e.ensemble_kind = 'default'
   AND NOT EXISTS (SELECT 1 FROM ensemble_member em WHERE em.ensemble_id = e.ensemble_id);

-- 대체 템플릿: 웹 보유본·모델 API 서버 보유본 (BR-FBK-02·09, research R9) — 파일은 app/assets/templates
-- (2026-09-30 박예은 팀장 결정) 악보 종류별: 오선보 = 아리랑 세마치 · 미뉴에트(무작위), 정간보 = 타령(가야금). 이미 있는 DB 는 migration 011 이 바꾼다.
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
