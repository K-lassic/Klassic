-- =============================================================================
-- #17 초기 데이터 — proto_type v0.1.1 의 시드 + 마이그레이션이 넣는 기본 행 (테이블 11개)
--
--   역할 · 권한표(role · role_permission) · 악기 · 기본 편성 · 대체 템플릿 · 라이선스 · 모델 등록부 ·
--   처리 설정 판본 1 · 엔진 순서 · 시스템 운영자(로그인 불가: 비밀번호 칸 '!' · 사용 중지)
--
--   만든 방법: v0.1.1 마이그레이션 001~020 + seeds/001_initial.sql 을 적용한 DB 에서
--             mariadb-dump --no-create-info --skip-triggers --complete-insert 로 뽑았다.
--   비밀값    : 없음 (운영자 · 서비스 키는 #26 명령줄 도구로 따로 만든다)
--   규칙      : 병합된 뒤에는 이 파일을 고치지 않는다.
-- =============================================================================
--
-- ------------------------------------------------------

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*M!100616 SET @OLD_NOTE_VERBOSITY=@@NOTE_VERBOSITY, NOTE_VERBOSITY=0 */;

--
-- Dumping data for table `ensemble`
--

LOCK TABLES `ensemble` WRITE;
/*!40000 ALTER TABLE `ensemble` DISABLE KEYS */;
set autocommit=0;
INSERT INTO `ensemble` (`ensemble_id`, `ensemble_kind`, `created_at`, `default_marker`) VALUES (1,'default','2026-10-30 06:31:31.872',1);
/*!40000 ALTER TABLE `ensemble` ENABLE KEYS */;
UNLOCK TABLES;
commit;

--
-- Dumping data for table `ensemble_member`
--

LOCK TABLES `ensemble_member` WRITE;
/*!40000 ALTER TABLE `ensemble_member` DISABLE KEYS */;
set autocommit=0;
INSERT INTO `ensemble_member` (`ensemble_id`, `part_no`, `part_role`, `instrument_id`, `original_instrument_name`, `original_midi_program`) VALUES (1,1,'melody',1,NULL,NULL);
INSERT INTO `ensemble_member` (`ensemble_id`, `part_no`, `part_role`, `instrument_id`, `original_instrument_name`, `original_midi_program`) VALUES (1,2,'percussion',7,NULL,NULL);
/*!40000 ALTER TABLE `ensemble_member` ENABLE KEYS */;
UNLOCK TABLES;
commit;

--
-- Dumping data for table `fallback_template`
--

LOCK TABLES `fallback_template` WRITE;
/*!40000 ALTER TABLE `fallback_template` DISABLE KEYS */;
set autocommit=0;
INSERT INTO `fallback_template` (`template_id`, `holder`, `name`, `midi_uri`, `is_active`, `score_type`, `created_at`, `musicxml_uri`, `version`) VALUES (1,'web','아리랑 (세마치장단)','assets/templates/arirang-semachi-v1.mid',1,'staff','2026-10-30 06:31:30.315','assets/templates/arirang-semachi-v1.musicxml','v1');
INSERT INTO `fallback_template` (`template_id`, `holder`, `name`, `midi_uri`, `is_active`, `score_type`, `created_at`, `musicxml_uri`, `version`) VALUES (2,'api_server','아리랑 (세마치장단)','assets/templates/arirang-semachi-v1.mid',1,'staff','2026-10-30 06:31:30.315','assets/templates/arirang-semachi-v1.musicxml','v1');
INSERT INTO `fallback_template` (`template_id`, `holder`, `name`, `midi_uri`, `is_active`, `score_type`, `created_at`, `musicxml_uri`, `version`) VALUES (3,'web','미뉴에트 G장조','assets/templates/minuet-g-v1.mid',1,'staff','2026-10-30 06:31:30.315','assets/templates/minuet-g-v1.musicxml','v1');
INSERT INTO `fallback_template` (`template_id`, `holder`, `name`, `midi_uri`, `is_active`, `score_type`, `created_at`, `musicxml_uri`, `version`) VALUES (4,'api_server','미뉴에트 G장조','assets/templates/minuet-g-v1.mid',1,'staff','2026-10-30 06:31:30.315','assets/templates/minuet-g-v1.musicxml','v1');
INSERT INTO `fallback_template` (`template_id`, `holder`, `name`, `midi_uri`, `is_active`, `score_type`, `created_at`, `musicxml_uri`, `version`) VALUES (5,'web','타령 (가야금 정간보)','assets/templates/jeongganbo-taryeong-gayageum-v1.mid',1,'jeongganbo','2026-10-30 06:31:30.315','assets/templates/jeongganbo-taryeong-gayageum-v1.musicxml','v1');
INSERT INTO `fallback_template` (`template_id`, `holder`, `name`, `midi_uri`, `is_active`, `score_type`, `created_at`, `musicxml_uri`, `version`) VALUES (6,'api_server','타령 (가야금 정간보)','assets/templates/jeongganbo-taryeong-gayageum-v1.mid',1,'jeongganbo','2026-10-30 06:31:30.315','assets/templates/jeongganbo-taryeong-gayageum-v1.musicxml','v1');
/*!40000 ALTER TABLE `fallback_template` ENABLE KEYS */;
UNLOCK TABLES;
commit;

--
-- Dumping data for table `instrument`
--

LOCK TABLES `instrument` WRITE;
/*!40000 ALTER TABLE `instrument` DISABLE KEYS */;
set autocommit=0;
INSERT INTO `instrument` (`instrument_id`, `name`, `family`, `midi_program`, `range_low`, `range_high`, `is_active`, `code`, `is_percussion`, `soundfont_file`, `menu_order`) VALUES (1,'가야금','gugak',107,43,81,1,'gayageum',0,'gugak.sf2',1);
INSERT INTO `instrument` (`instrument_id`, `name`, `family`, `midi_program`, `range_low`, `range_high`, `is_active`, `code`, `is_percussion`, `soundfont_file`, `menu_order`) VALUES (2,'거문고','gugak',106,36,72,1,'geomungo',0,'gugak.sf2',2);
INSERT INTO `instrument` (`instrument_id`, `name`, `family`, `midi_program`, `range_low`, `range_high`, `is_active`, `code`, `is_percussion`, `soundfont_file`, `menu_order`) VALUES (3,'대금','gugak',77,58,87,1,'daegeum',0,'gugak.sf2',3);
INSERT INTO `instrument` (`instrument_id`, `name`, `family`, `midi_program`, `range_low`, `range_high`, `is_active`, `code`, `is_percussion`, `soundfont_file`, `menu_order`) VALUES (4,'해금','gugak',110,55,86,1,'haegeum',0,'gugak.sf2',4);
INSERT INTO `instrument` (`instrument_id`, `name`, `family`, `midi_program`, `range_low`, `range_high`, `is_active`, `code`, `is_percussion`, `soundfont_file`, `menu_order`) VALUES (5,'피리','gugak',111,58,84,1,'piri',0,'gugak.sf2',5);
INSERT INTO `instrument` (`instrument_id`, `name`, `family`, `midi_program`, `range_low`, `range_high`, `is_active`, `code`, `is_percussion`, `soundfont_file`, `menu_order`) VALUES (6,'아쟁','gugak',42,38,72,1,'ajaeng',0,'gugak.sf2',6);
INSERT INTO `instrument` (`instrument_id`, `name`, `family`, `midi_program`, `range_low`, `range_high`, `is_active`, `code`, `is_percussion`, `soundfont_file`, `menu_order`) VALUES (7,'장구','gugak',NULL,NULL,NULL,1,'janggu',1,'gugak.sf2',7);
INSERT INTO `instrument` (`instrument_id`, `name`, `family`, `midi_program`, `range_low`, `range_high`, `is_active`, `code`, `is_percussion`, `soundfont_file`, `menu_order`) VALUES (8,'북','gugak',NULL,NULL,NULL,1,'buk',1,'gugak.sf2',8);
INSERT INTO `instrument` (`instrument_id`, `name`, `family`, `midi_program`, `range_low`, `range_high`, `is_active`, `code`, `is_percussion`, `soundfont_file`, `menu_order`) VALUES (9,'피아노','other',0,21,108,1,'piano',0,'FluidR3_GM.sf2',11);
INSERT INTO `instrument` (`instrument_id`, `name`, `family`, `midi_program`, `range_low`, `range_high`, `is_active`, `code`, `is_percussion`, `soundfont_file`, `menu_order`) VALUES (10,'어쿠스틱 기타','other',24,40,88,1,'acoustic_guitar',0,'FluidR3_GM.sf2',12);
INSERT INTO `instrument` (`instrument_id`, `name`, `family`, `midi_program`, `range_low`, `range_high`, `is_active`, `code`, `is_percussion`, `soundfont_file`, `menu_order`) VALUES (11,'바이올린','other',40,55,103,1,'violin',0,'FluidR3_GM.sf2',13);
INSERT INTO `instrument` (`instrument_id`, `name`, `family`, `midi_program`, `range_low`, `range_high`, `is_active`, `code`, `is_percussion`, `soundfont_file`, `menu_order`) VALUES (12,'첼로','other',42,36,76,1,'cello',0,'FluidR3_GM.sf2',14);
INSERT INTO `instrument` (`instrument_id`, `name`, `family`, `midi_program`, `range_low`, `range_high`, `is_active`, `code`, `is_percussion`, `soundfont_file`, `menu_order`) VALUES (13,'하프','other',46,24,103,1,'harp',0,'FluidR3_GM.sf2',15);
INSERT INTO `instrument` (`instrument_id`, `name`, `family`, `midi_program`, `range_low`, `range_high`, `is_active`, `code`, `is_percussion`, `soundfont_file`, `menu_order`) VALUES (14,'플루트','other',73,60,96,1,'flute',0,'FluidR3_GM.sf2',16);
INSERT INTO `instrument` (`instrument_id`, `name`, `family`, `midi_program`, `range_low`, `range_high`, `is_active`, `code`, `is_percussion`, `soundfont_file`, `menu_order`) VALUES (15,'클라리넷','other',71,50,94,1,'clarinet',0,'FluidR3_GM.sf2',17);
INSERT INTO `instrument` (`instrument_id`, `name`, `family`, `midi_program`, `range_low`, `range_high`, `is_active`, `code`, `is_percussion`, `soundfont_file`, `menu_order`) VALUES (16,'현악 합주','other',48,28,96,1,'strings',0,'FluidR3_GM.sf2',18);
INSERT INTO `instrument` (`instrument_id`, `name`, `family`, `midi_program`, `range_low`, `range_high`, `is_active`, `code`, `is_percussion`, `soundfont_file`, `menu_order`) VALUES (17,'마림바','other',12,45,96,1,'marimba',0,'FluidR3_GM.sf2',19);
/*!40000 ALTER TABLE `instrument` ENABLE KEYS */;
UNLOCK TABLES;
commit;

--
-- Dumping data for table `license_policy`
--

LOCK TABLES `license_policy` WRITE;
/*!40000 ALTER TABLE `license_policy` DISABLE KEYS */;
set autocommit=0;
INSERT INTO `license_policy` (`policy_code`, `confirmed`, `decided_by`, `decided_at`) VALUES ('sound_and_renderer',0,NULL,NULL);
/*!40000 ALTER TABLE `license_policy` ENABLE KEYS */;
UNLOCK TABLES;
commit;

--
-- Dumping data for table `model_registry`
--

LOCK TABLES `model_registry` WRITE;
/*!40000 ALTER TABLE `model_registry` DISABLE KEYS */;
set autocommit=0;
INSERT INTO `model_registry` (`model_name`, `kind`, `provider`, `display_name`, `provider_ref`, `config_json`, `enabled`, `registered_by`, `registered_at`, `updated_at`, `notes`) VALUES ('audiveris','omr_staff','venv','Audiveris (오선보, AGPL-3.0, Java)','~/gugak-engines/audiveris','{\"adapter\":\"audiveris\",\"java\":\"/opt/homebrew/opt/openjdk@21/bin/java\",\"cold_start_hint_s\":20}',1,NULL,'2026-10-30 06:31:31.856','2026-10-30 06:31:31.856','인쇄 스캔 악보용 대안');
INSERT INTO `model_registry` (`model_name`, `kind`, `provider`, `display_name`, `provider_ref`, `config_json`, `enabled`, `registered_by`, `registered_at`, `updated_at`, `notes`) VALUES ('homr','omr_staff','venv','homr (오선보, AGPL-3.0)','~/gugak-engines/homr','{\"adapter\":\"homr\",\"cold_start_hint_s\":40}',1,NULL,'2026-10-30 06:31:31.856','2026-10-30 06:31:31.856','1순위 오선보 인식(JSG_추천모델 2.1). 수정 없이 호출만');
INSERT INTO `model_registry` (`model_name`, `kind`, `provider`, `display_name`, `provider_ref`, `config_json`, `enabled`, `registered_by`, `registered_at`, `updated_at`, `notes`) VALUES ('jeongganbo-omr','omr_jeongganbo','venv','MALerLab jeongganbo-omr (정간보, MIT)','~/gugak-engines/jeongganbo','{\"adapter\":\"jeongganbo\",\"device\":\"mps\",\"cold_start_hint_s\":30}',1,NULL,'2026-10-30 06:31:31.856','2026-10-30 06:31:31.856','정간보 유일 후보. 결과를 MusicXML 로 바꿔 돌려줌');
INSERT INTO `model_registry` (`model_name`, `kind`, `provider`, `display_name`, `provider_ref`, `config_json`, `enabled`, `registered_by`, `registered_at`, `updated_at`, `notes`) VALUES ('llm-gemma3-4b','recommend','ollama','Ollama gemma3:4b 추천','gemma3:4b','{\"adapter\":\"ollama_recommend\",\"num_ctx\":4096,\"keep_alive\":\"5m\",\"think\":false,\"cold_start_hint_s\":30}',1,NULL,'2026-10-30 06:31:31.856','2026-10-30 06:31:31.856','공유 Ollama 서버(OLLAMA 설정 참조 §7.2 채팅 기본). 실패·지연 시 규칙표로 넘어감');
INSERT INTO `model_registry` (`model_name`, `kind`, `provider`, `display_name`, `provider_ref`, `config_json`, `enabled`, `registered_by`, `registered_at`, `updated_at`, `notes`) VALUES ('rules','recommend','builtin','규칙표 추천',NULL,'{\"adapter\":\"rules\",\"file\":\"app/recommend/rules.yaml\"}',1,NULL,'2026-10-30 06:31:31.856','2026-10-30 06:31:31.856','항상 마지막 안전판');
/*!40000 ALTER TABLE `model_registry` ENABLE KEYS */;
UNLOCK TABLES;
commit;

--
-- Dumping data for table `operator_account`
--

LOCK TABLES `operator_account` WRITE;
/*!40000 ALTER TABLE `operator_account` DISABLE KEYS */;
set autocommit=0;
INSERT INTO `operator_account` (`operator_id`, `login_id`, `password_hash`, `display_name`, `created_at`, `disabled_at`, `failed_login_count`, `locked_until`, `account_id`) VALUES (1,'system','!','시스템(초기 설정)','2026-10-30 06:31:31.853','2026-10-30 06:31:31.853',0,NULL,NULL);
/*!40000 ALTER TABLE `operator_account` ENABLE KEYS */;
UNLOCK TABLES;
commit;

--
-- Dumping data for table `processing_setting_version`
--

LOCK TABLES `processing_setting_version` WRITE;
/*!40000 ALTER TABLE `processing_setting_version` DISABLE KEYS */;
set autocommit=0;
INSERT INTO `processing_setting_version` (`setting_version_id`, `created_at`, `created_by`, `timeout_seconds`, `max_concurrency`, `fallback_enabled`, `default_call_limit_per_hour`, `apply_rate_limit_count`, `apply_rate_window_minutes`, `structure_threshold`, `grade_caution_boundary`, `grade_distrust_boundary`, `api_apply_status`, `api_applied_at`, `web_max_active_per_client`, `web_hourly_request_cap`, `max_concurrency_recognize`, `max_concurrency_render`, `web_concurrency_share`, `score_file_max_bytes`, `recommend_timeout_ms`, `login_max_failures`, `login_lock_minutes`, `llm_recommend_timeout_ms`) VALUES (1,'2026-10-30 06:31:31.855',1,180,2,1,30,3,1440,0.5000,0.7000,0.4000,'pending',NULL,1,10,2,2,1,5242880,3000,5,10,20000);
/*!40000 ALTER TABLE `processing_setting_version` ENABLE KEYS */;
UNLOCK TABLES;
commit;

--
-- Dumping data for table `role`
--

LOCK TABLES `role` WRITE;
/*!40000 ALTER TABLE `role` DISABLE KEYS */;
set autocommit=0;
INSERT INTO `role` (`role_code`, `name_ko`, `description`) VALUES ('api_caller','API 호출자','접근 키(X-API-Key)로 들어온 호출. 모델 기능 API·연주 API');
INSERT INTO `role` (`role_code`, `name_ko`, `description`) VALUES ('operator','운영자','팀원 계정. 관리자 화면(내부망)의 지표·설정·키 관리');
INSERT INTO `role` (`role_code`, `name_ko`, `description`) VALUES ('service','웹 서비스','서비스 전용 키로 모델 API 를 부르는 웹 서비스(시스템)');
INSERT INTO `role` (`role_code`, `name_ko`, `description`) VALUES ('user','사용자','가입한 계정. 악보 올리기·듣기·편집·내려받기, 접근 키 신청');
/*!40000 ALTER TABLE `role` ENABLE KEYS */;
UNLOCK TABLES;
commit;

--
-- Dumping data for table `role_permission`
--

LOCK TABLES `role_permission` WRITE;
/*!40000 ALTER TABLE `role_permission` DISABLE KEYS */;
set autocommit=0;
INSERT INTO `role_permission` (`role_code`, `uc_code`) VALUES ('api_caller','UC11');
INSERT INTO `role_permission` (`role_code`, `uc_code`) VALUES ('api_caller','UC12');
INSERT INTO `role_permission` (`role_code`, `uc_code`) VALUES ('api_caller','UC13');
INSERT INTO `role_permission` (`role_code`, `uc_code`) VALUES ('operator','UC10');
INSERT INTO `role_permission` (`role_code`, `uc_code`) VALUES ('operator','UC11');
INSERT INTO `role_permission` (`role_code`, `uc_code`) VALUES ('operator','UC14');
INSERT INTO `role_permission` (`role_code`, `uc_code`) VALUES ('operator','UC16');
INSERT INTO `role_permission` (`role_code`, `uc_code`) VALUES ('operator','UC17');
INSERT INTO `role_permission` (`role_code`, `uc_code`) VALUES ('operator','UC19');
INSERT INTO `role_permission` (`role_code`, `uc_code`) VALUES ('operator','UC9');
INSERT INTO `role_permission` (`role_code`, `uc_code`) VALUES ('service','UC1');
INSERT INTO `role_permission` (`role_code`, `uc_code`) VALUES ('service','UC10');
INSERT INTO `role_permission` (`role_code`, `uc_code`) VALUES ('service','UC12');
INSERT INTO `role_permission` (`role_code`, `uc_code`) VALUES ('service','UC14');
INSERT INTO `role_permission` (`role_code`, `uc_code`) VALUES ('service','UC2');
INSERT INTO `role_permission` (`role_code`, `uc_code`) VALUES ('service','UC3');
INSERT INTO `role_permission` (`role_code`, `uc_code`) VALUES ('service','UC5');
INSERT INTO `role_permission` (`role_code`, `uc_code`) VALUES ('service','UC7');
INSERT INTO `role_permission` (`role_code`, `uc_code`) VALUES ('user','UC1');
INSERT INTO `role_permission` (`role_code`, `uc_code`) VALUES ('user','UC11');
INSERT INTO `role_permission` (`role_code`, `uc_code`) VALUES ('user','UC15');
INSERT INTO `role_permission` (`role_code`, `uc_code`) VALUES ('user','UC16');
INSERT INTO `role_permission` (`role_code`, `uc_code`) VALUES ('user','UC18');
INSERT INTO `role_permission` (`role_code`, `uc_code`) VALUES ('user','UC2');
INSERT INTO `role_permission` (`role_code`, `uc_code`) VALUES ('user','UC3');
INSERT INTO `role_permission` (`role_code`, `uc_code`) VALUES ('user','UC5');
INSERT INTO `role_permission` (`role_code`, `uc_code`) VALUES ('user','UC6');
INSERT INTO `role_permission` (`role_code`, `uc_code`) VALUES ('user','UC7');
/*!40000 ALTER TABLE `role_permission` ENABLE KEYS */;
UNLOCK TABLES;
commit;

--
-- Dumping data for table `setting_engine_order`
--

LOCK TABLES `setting_engine_order` WRITE;
/*!40000 ALTER TABLE `setting_engine_order` DISABLE KEYS */;
set autocommit=0;
INSERT INTO `setting_engine_order` (`setting_version_id`, `score_type`, `seq`, `engine_name`) VALUES (1,'jeongganbo',1,'jeongganbo-omr');
INSERT INTO `setting_engine_order` (`setting_version_id`, `score_type`, `seq`, `engine_name`) VALUES (1,'recommend',1,'llm-gemma3-4b');
INSERT INTO `setting_engine_order` (`setting_version_id`, `score_type`, `seq`, `engine_name`) VALUES (1,'recommend',2,'rules');
INSERT INTO `setting_engine_order` (`setting_version_id`, `score_type`, `seq`, `engine_name`) VALUES (1,'staff',2,'audiveris');
INSERT INTO `setting_engine_order` (`setting_version_id`, `score_type`, `seq`, `engine_name`) VALUES (1,'staff',1,'homr');
/*!40000 ALTER TABLE `setting_engine_order` ENABLE KEYS */;
UNLOCK TABLES;
commit;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*M!100616 SET NOTE_VERBOSITY=@OLD_NOTE_VERBOSITY */;

-- Dump completed
