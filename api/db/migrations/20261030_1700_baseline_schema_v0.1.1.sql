-- =============================================================================
-- #17 기준 스키마 — proto_type v0.1.1 의 최종 스키마 (테이블 44 · 뷰 41 · 트리거 7)
--
--   만든 방법: 빈 MariaDB 12.0.2 에 v0.1.1 마이그레이션 001~020 을 차례로 적용한 뒤
--             mariadb-dump --no-data --routines --triggers 로 뽑았다 (손으로 옮겨 쓰지 않음).
--             DEFINER 는 지웠다 — 적용하는 계정이 뷰 · 트리거의 주인이 된다.
--   원본    : proto_type/src/app/db/migrations/001_sd03_baseline.sql ~ 020_request_example.sql
--   규칙    : 병합된 뒤에는 이 파일을 고치지 않는다. 바꿀 것은 날짜 이름의 새 파일로 추가한다 (api/db/README.md)
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
-- Table structure for table `access_key`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `access_key` (
  `key_id` bigint(20) NOT NULL AUTO_INCREMENT,
  `key_kind` varchar(10) NOT NULL,
  `key_hash` char(64) NOT NULL,
  `key_prefix` varchar(16) NOT NULL,
  `application_no` varchar(20) DEFAULT NULL,
  `call_limit_per_hour` int(11) DEFAULT NULL,
  `issued_at` timestamp(3) NOT NULL DEFAULT current_timestamp(3),
  `issued_by` bigint(20) DEFAULT NULL,
  `status` varchar(8) NOT NULL DEFAULT 'active',
  `revoked_at` timestamp(3) NULL DEFAULT NULL,
  `revoked_by` bigint(20) DEFAULT NULL,
  PRIMARY KEY (`key_id`),
  UNIQUE KEY `uq_access_key_hash` (`key_hash`),
  UNIQUE KEY `uq_access_key_application` (`application_no`),
  KEY `fk_key_issued_by` (`issued_by`),
  KEY `fk_key_revoked_by` (`revoked_by`),
  CONSTRAINT `fk_key_issued_by` FOREIGN KEY (`issued_by`) REFERENCES `operator_account` (`operator_id`),
  CONSTRAINT `fk_key_revoked_by` FOREIGN KEY (`revoked_by`) REFERENCES `operator_account` (`operator_id`),
  CONSTRAINT `chk_key_kind` CHECK (`key_kind` in ('external','service')),
  CONSTRAINT `chk_key_origin` CHECK (`key_kind` = 'external' and `application_no` is not null and `issued_by` is null or `key_kind` = 'service' and `application_no` is null and `issued_by` is not null),
  CONSTRAINT `chk_key_status` CHECK (`status` = 'active' and `revoked_at` is null and `revoked_by` is null or `status` = 'revoked' and `revoked_at` is not null and `revoked_by` is not null),
  CONSTRAINT `chk_key_limit` CHECK (`call_limit_per_hour` >= 1),
  CONSTRAINT `chk_key_limit_required` CHECK (`key_kind` = 'service' or `call_limit_per_hour` is not null),
  CONSTRAINT `chk_key_prefix_len` CHECK (char_length(`key_prefix`) = 8)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_uca1400_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 */ /*!50003 TRIGGER trg_key_no_revive
BEFORE UPDATE ON access_key
FOR EACH ROW
BEGIN
  IF OLD.status = 'revoked' AND NEW.status <> 'revoked' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'BR-KEY-02: revoked key cannot be reactivated';
  END IF;
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;

--
-- Table structure for table `account`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `account` (
  `account_id` bigint(20) NOT NULL AUTO_INCREMENT,
  `login_id` varchar(254) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `display_name` varchar(100) NOT NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT current_timestamp(3),
  `disabled_at` timestamp(3) NULL DEFAULT NULL,
  `failed_logins` int(11) NOT NULL DEFAULT 0,
  `locked_until` timestamp(3) NULL DEFAULT NULL,
  `last_login_at` timestamp(3) NULL DEFAULT NULL,
  `signup_addr_hash` char(64) DEFAULT NULL,
  PRIMARY KEY (`account_id`),
  UNIQUE KEY `uq_account_login` (`login_id`),
  KEY `ix_account_signup_addr` (`signup_addr_hash`,`created_at`),
  CONSTRAINT `chk_account_nonempty` CHECK (trim(`login_id`) <> '' and trim(`password_hash`) <> '' and trim(`display_name`) <> ''),
  CONSTRAINT `chk_account_failed` CHECK (`failed_logins` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `account_role`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `account_role` (
  `account_id` bigint(20) NOT NULL,
  `role_code` varchar(16) NOT NULL,
  `granted_at` timestamp(3) NOT NULL DEFAULT current_timestamp(3),
  `granted_by` bigint(20) DEFAULT NULL,
  PRIMARY KEY (`account_id`,`role_code`),
  KEY `fk_account_role_role` (`role_code`),
  KEY `fk_account_role_by` (`granted_by`),
  CONSTRAINT `fk_account_role_account` FOREIGN KEY (`account_id`) REFERENCES `account` (`account_id`),
  CONSTRAINT `fk_account_role_by` FOREIGN KEY (`granted_by`) REFERENCES `account` (`account_id`),
  CONSTRAINT `fk_account_role_role` FOREIGN KEY (`role_code`) REFERENCES `role` (`role_code`),
  CONSTRAINT `chk_account_role_person` CHECK (`role_code` in ('user','operator'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `anon_session`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `anon_session` (
  `session_id` char(36) NOT NULL,
  `started_at` timestamp(3) NOT NULL DEFAULT current_timestamp(3),
  `last_active_at` timestamp(3) NOT NULL DEFAULT current_timestamp(3),
  `ended_at` timestamp(3) NULL DEFAULT NULL,
  `end_reason` varchar(8) DEFAULT NULL,
  `account_id` bigint(20) DEFAULT NULL,
  PRIMARY KEY (`session_id`),
  KEY `fk_session_account` (`account_id`),
  CONSTRAINT `fk_session_account` FOREIGN KEY (`account_id`) REFERENCES `account` (`account_id`),
  CONSTRAINT `chk_session_time` CHECK (`ended_at` is null or `ended_at` >= `started_at`),
  CONSTRAINT `chk_session_end_reason` CHECK (`ended_at` is null and `end_reason` is null or `ended_at` is not null and `end_reason` is not null and `end_reason` in ('exit','idle'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `api_call_log`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `api_call_log` (
  `call_id` bigint(20) NOT NULL AUTO_INCREMENT,
  `called_at` timestamp(3) NOT NULL DEFAULT current_timestamp(3),
  `endpoint` varchar(100) NOT NULL,
  `access_key_id` bigint(20) DEFAULT NULL,
  `outcome` varchar(22) NOT NULL,
  `reason_code` varchar(40) DEFAULT NULL,
  `retry_after_at` timestamp(3) NULL DEFAULT NULL,
  `request_id` bigint(20) DEFAULT NULL,
  PRIMARY KEY (`call_id`),
  KEY `fk_call_request` (`request_id`),
  KEY `ix_call_key_time` (`access_key_id`,`called_at`),
  CONSTRAINT `fk_call_key` FOREIGN KEY (`access_key_id`) REFERENCES `access_key` (`key_id`),
  CONSTRAINT `fk_call_request` FOREIGN KEY (`request_id`) REFERENCES `score_request` (`request_id`),
  CONSTRAINT `chk_call_outcome` CHECK (`outcome` in ('accepted','rejected_key','rejected_limit','rejected_concurrency','rejected_file','expired','not_found')),
  CONSTRAINT `chk_call_accepted_key` CHECK (`outcome` <> 'accepted' or `access_key_id` is not null),
  CONSTRAINT `chk_call_reason` CHECK (`outcome` = 'accepted' and `reason_code` is null or `outcome` <> 'accepted' and `reason_code` is not null),
  CONSTRAINT `chk_call_retry` CHECK (`outcome` in ('rejected_limit','rejected_concurrency') and `retry_after_at` is not null or `outcome` not in ('rejected_limit','rejected_concurrency') and `retry_after_at` is null),
  CONSTRAINT `chk_call_no_request_on_reject` CHECK (`outcome` not in ('rejected_key','rejected_limit','rejected_concurrency','rejected_file') or `request_id` is null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `api_endpoint`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `api_endpoint` (
  `snapshot_id` bigint(20) NOT NULL,
  `http_method` varchar(8) NOT NULL,
  `path` varchar(100) NOT NULL,
  `feature_name` varchar(100) NOT NULL,
  `input_format` varchar(500) NOT NULL,
  `response_format` varchar(500) NOT NULL,
  `example_text` varchar(2000) DEFAULT NULL,
  `engine_name` varchar(40) DEFAULT NULL,
  PRIMARY KEY (`snapshot_id`,`http_method`,`path`),
  CONSTRAINT `fk_endpoint_snapshot` FOREIGN KEY (`snapshot_id`) REFERENCES `api_spec_snapshot` (`snapshot_id`) ON DELETE CASCADE,
  CONSTRAINT `chk_endpoint_method` CHECK (`http_method` in ('GET','POST'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `api_spec_snapshot`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `api_spec_snapshot` (
  `snapshot_id` bigint(20) NOT NULL AUTO_INCREMENT,
  `checked_at` timestamp(3) NOT NULL DEFAULT current_timestamp(3),
  `health_status` varchar(12) NOT NULL,
  `api_version` varchar(20) DEFAULT NULL,
  `mismatch_with_menu` tinyint(1) DEFAULT NULL,
  PRIMARY KEY (`snapshot_id`),
  CONSTRAINT `chk_snapshot_health` CHECK (`health_status` in ('ok','stopped','unreachable')),
  CONSTRAINT `chk_snapshot_version` CHECK (`health_status` <> 'ok' or `api_version` is not null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `change_history`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `change_history` (
  `history_id` bigint(20) NOT NULL AUTO_INCREMENT,
  `operator_id` bigint(20) NOT NULL,
  `changed_at` timestamp(3) NOT NULL DEFAULT current_timestamp(3),
  `target_type` varchar(16) NOT NULL,
  `target_ref` varchar(40) NOT NULL,
  `field_name` varchar(40) NOT NULL,
  `before_value` varchar(500) DEFAULT NULL,
  `after_value` varchar(500) DEFAULT NULL,
  PRIMARY KEY (`history_id`),
  KEY `fk_history_operator` (`operator_id`),
  CONSTRAINT `fk_history_operator` FOREIGN KEY (`operator_id`) REFERENCES `operator_account` (`operator_id`),
  CONSTRAINT `chk_history_target` CHECK (`target_type` in ('access_key','key_application','license_policy','model','account','shared_score')),
  CONSTRAINT `chk_history_field` CHECK (`field_name` in ('issued','status','call_limit_per_hour','retained','confirmed','registered','enabled','provider_ref','config','load','unregistered','role_granted','role_revoked','disabled','unlocked','email_revealed','taken_down','restored'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `derived_file`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `derived_file` (
  `file_id` bigint(20) NOT NULL AUTO_INCREMENT,
  `request_id` bigint(20) NOT NULL,
  `format` varchar(8) NOT NULL,
  `basis` varchar(8) NOT NULL,
  `edit_id` bigint(20) DEFAULT NULL,
  `ensemble_id` bigint(20) DEFAULT NULL,
  `render_status` varchar(10) NOT NULL,
  `renderer_name` varchar(40) DEFAULT NULL,
  `renderer_version` varchar(40) DEFAULT NULL,
  `requested_at` timestamp(3) NOT NULL DEFAULT current_timestamp(3),
  `render_started_at` timestamp(3) NULL DEFAULT NULL,
  `render_finished_at` timestamp(3) NULL DEFAULT NULL,
  `failure_reason` varchar(60) DEFAULT NULL,
  `storage_uri` varchar(500) DEFAULT NULL,
  `deleted_at` timestamp(3) NULL DEFAULT NULL,
  `render_ms` bigint(20) GENERATED ALWAYS AS (timestampdiff(MICROSECOND,`render_started_at`,`render_finished_at`) DIV 1000) STORED,
  PRIMARY KEY (`file_id`),
  UNIQUE KEY `uq_derived_request` (`file_id`,`request_id`),
  KEY `fk_derived_request` (`request_id`),
  KEY `fk_derived_edit` (`edit_id`,`request_id`),
  KEY `fk_derived_ensemble` (`ensemble_id`),
  KEY `ix_derived_queue` (`render_status`,`requested_at`),
  CONSTRAINT `fk_derived_edit` FOREIGN KEY (`edit_id`, `request_id`) REFERENCES `edited_score` (`edit_id`, `request_id`),
  CONSTRAINT `fk_derived_ensemble` FOREIGN KEY (`ensemble_id`) REFERENCES `ensemble` (`ensemble_id`),
  CONSTRAINT `fk_derived_request` FOREIGN KEY (`request_id`) REFERENCES `score_request` (`request_id`),
  CONSTRAINT `chk_derived_format` CHECK (`format` in ('mp3','pdf','midi','musicxml')),
  CONSTRAINT `chk_derived_basis` CHECK (`basis` = 'edited' and `edit_id` is not null or `basis` = 'original' and `edit_id` is null),
  CONSTRAINT `chk_derived_status` CHECK (`render_status` in ('queued','rendering','ready','failed')),
  CONSTRAINT `chk_derived_direct_formats` CHECK (`format` in ('mp3','pdf') or `render_status` = 'ready' and `renderer_name` is null and `render_started_at` is null),
  CONSTRAINT `chk_derived_renderer` CHECK (`format` not in ('mp3','pdf') or `render_status` <> 'ready' or `renderer_name` is not null and `renderer_version` is not null and `render_finished_at` is not null),
  CONSTRAINT `chk_derived_failure` CHECK (`render_status` = 'failed' = (`failure_reason` is not null)),
  CONSTRAINT `chk_derived_uri` CHECK ((`render_status` = 'ready' and `deleted_at` is null) = (`storage_uri` is not null))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_uca1400_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 */ /*!50003 TRIGGER trg_g4_derived_file
BEFORE INSERT ON derived_file
FOR EACH ROW
BEGIN
  IF (SELECT is_expired FROM v_request_retention WHERE request_id = NEW.request_id) = 1 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'G4: retention period expired';
  END IF;
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;

--
-- Table structure for table `download_event`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `download_event` (
  `download_id` bigint(20) NOT NULL AUTO_INCREMENT,
  `request_id` bigint(20) NOT NULL,
  `format` varchar(8) NOT NULL,
  `result_id` bigint(20) DEFAULT NULL,
  `file_id` bigint(20) DEFAULT NULL,
  `downloaded_at` timestamp(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`download_id`),
  KEY `fk_download_result` (`result_id`,`request_id`),
  KEY `fk_download_file` (`file_id`,`request_id`),
  CONSTRAINT `fk_download_file` FOREIGN KEY (`file_id`, `request_id`) REFERENCES `derived_file` (`file_id`, `request_id`),
  CONSTRAINT `fk_download_result` FOREIGN KEY (`result_id`, `request_id`) REFERENCES `score_result` (`result_id`, `request_id`),
  CONSTRAINT `chk_download_format` CHECK (`format` in ('mp3','pdf','midi','musicxml')),
  CONSTRAINT `chk_download_one_source` CHECK (`result_id` is not null and `file_id` is null or `result_id` is null and `file_id` is not null),
  CONSTRAINT `chk_download_result_format` CHECK (`result_id` is null or `format` in ('midi','musicxml'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_uca1400_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 */ /*!50003 TRIGGER trg_g4_download
BEFORE INSERT ON download_event
FOR EACH ROW
BEGIN
  IF (SELECT is_expired FROM v_request_retention WHERE request_id = NEW.request_id) = 1 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'G4: retention period expired';
  END IF;
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;

--
-- Table structure for table `edited_score`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `edited_score` (
  `edit_id` bigint(20) NOT NULL AUTO_INCREMENT,
  `request_id` bigint(20) NOT NULL,
  `base_result_id` bigint(20) NOT NULL,
  `musicxml_uri` varchar(500) DEFAULT NULL,
  `transpose_semitones` smallint(6) NOT NULL DEFAULT 0,
  `ops_json` longtext DEFAULT NULL,
  `first_edited_at` timestamp(3) NOT NULL DEFAULT current_timestamp(3),
  `last_changed_at` timestamp(3) NOT NULL DEFAULT current_timestamp(3),
  `reverted_at` timestamp(3) NULL DEFAULT NULL,
  `finished_at` timestamp(3) NULL DEFAULT NULL,
  `deleted_at` timestamp(3) NULL DEFAULT NULL,
  PRIMARY KEY (`edit_id`),
  UNIQUE KEY `uq_edited_one_per_request` (`request_id`),
  UNIQUE KEY `uq_edited_request` (`edit_id`,`request_id`),
  KEY `fk_edited_base` (`base_result_id`,`request_id`),
  CONSTRAINT `fk_edited_base` FOREIGN KEY (`base_result_id`, `request_id`) REFERENCES `score_result` (`result_id`, `request_id`),
  CONSTRAINT `chk_edited_deleted` CHECK (`deleted_at` is null or `musicxml_uri` is null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `edited_track`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `edited_track` (
  `edit_id` bigint(20) NOT NULL,
  `track_no` smallint(6) NOT NULL,
  `part_origin` varchar(12) NOT NULL,
  `instrument_id` bigint(20) NOT NULL,
  `soundfont_id` bigint(20) DEFAULT NULL,
  `volume_level` smallint(6) DEFAULT NULL,
  PRIMARY KEY (`edit_id`,`track_no`),
  KEY `fk_track_instrument` (`instrument_id`),
  KEY `fk_track_soundfont` (`soundfont_id`),
  CONSTRAINT `fk_track_edit` FOREIGN KEY (`edit_id`) REFERENCES `edited_score` (`edit_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_track_instrument` FOREIGN KEY (`instrument_id`) REFERENCES `instrument` (`instrument_id`),
  CONSTRAINT `fk_track_soundfont` FOREIGN KEY (`soundfont_id`) REFERENCES `user_soundfont` (`soundfont_id`) ON DELETE SET NULL,
  CONSTRAINT `chk_track_no` CHECK (`track_no` >= 1),
  CONSTRAINT `chk_track_origin` CHECK (`part_origin` in ('original','melody_copy')),
  CONSTRAINT `chk_track_volume` CHECK (`volume_level` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `engine_attempt`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `engine_attempt` (
  `request_id` bigint(20) NOT NULL,
  `page_no` smallint(6) NOT NULL DEFAULT 1,
  `attempt_no` smallint(6) NOT NULL,
  `engine_name` varchar(40) NOT NULL,
  `engine_version` varchar(40) NOT NULL,
  `outcome` varchar(16) NOT NULL,
  `failure_code` varchar(40) DEFAULT NULL,
  `started_at` timestamp(3) NOT NULL,
  `ended_at` timestamp(3) NULL DEFAULT NULL,
  `duration_ms` bigint(20) GENERATED ALWAYS AS (timestampdiff(MICROSECOND,`started_at`,`ended_at`) DIV 1000) STORED,
  `success_marker` smallint(6) GENERATED ALWAYS AS (case when `outcome` = 'success' then 1 else NULL end) STORED,
  PRIMARY KEY (`request_id`,`page_no`,`attempt_no`),
  UNIQUE KEY `uq_engine_one_success` (`request_id`,`page_no`,`success_marker`),
  CONSTRAINT `fk_attempt_job` FOREIGN KEY (`request_id`) REFERENCES `processing_job` (`request_id`),
  CONSTRAINT `chk_attempt_no` CHECK (`attempt_no` >= 1),
  CONSTRAINT `chk_attempt_outcome` CHECK (`outcome` in ('success','error','timeout','stopped','no_notes','convert_failed')),
  CONSTRAINT `chk_attempt_failure` CHECK (`outcome` = 'success' and `failure_code` is null or `outcome` <> 'success' and `failure_code` is not null),
  CONSTRAINT `chk_attempt_time` CHECK (`ended_at` is null or `ended_at` >= `started_at`),
  CONSTRAINT `chk_attempt_page` CHECK (`page_no` between 1 and 10)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `ensemble`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `ensemble` (
  `ensemble_id` bigint(20) NOT NULL AUTO_INCREMENT,
  `ensemble_kind` varchar(12) NOT NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT current_timestamp(3),
  `default_marker` smallint(6) GENERATED ALWAYS AS (case when `ensemble_kind` = 'default' then 1 else NULL end) STORED,
  PRIMARY KEY (`ensemble_id`),
  UNIQUE KEY `uq_ensemble_single_default` (`default_marker`),
  CONSTRAINT `chk_ensemble_kind` CHECK (`ensemble_kind` in ('default','recommended','original','custom'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `ensemble_member`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `ensemble_member` (
  `ensemble_id` bigint(20) NOT NULL,
  `part_no` smallint(6) NOT NULL,
  `part_role` varchar(12) DEFAULT NULL,
  `instrument_id` bigint(20) DEFAULT NULL,
  `original_instrument_name` varchar(100) DEFAULT NULL,
  `original_midi_program` smallint(6) DEFAULT NULL,
  PRIMARY KEY (`ensemble_id`,`part_no`),
  KEY `fk_member_instrument` (`instrument_id`),
  CONSTRAINT `fk_member_ensemble` FOREIGN KEY (`ensemble_id`) REFERENCES `ensemble` (`ensemble_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_member_instrument` FOREIGN KEY (`instrument_id`) REFERENCES `instrument` (`instrument_id`),
  CONSTRAINT `chk_member_part` CHECK (`part_no` >= 1),
  CONSTRAINT `chk_member_role` CHECK (`part_role` in ('melody','percussion','other')),
  CONSTRAINT `chk_member_one_source` CHECK (`instrument_id` is not null and `original_instrument_name` is null or `instrument_id` is null and `original_instrument_name` is not null),
  CONSTRAINT `chk_member_program` CHECK (`original_midi_program` between 0 and 127)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `eval_item`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `eval_item` (
  `item_id` bigint(20) NOT NULL AUTO_INCREMENT,
  `set_kind` varchar(6) NOT NULL,
  `sheet_kind` varchar(12) DEFAULT NULL,
  `fake_label` varchar(40) DEFAULT NULL,
  `file_uri` varchar(500) NOT NULL,
  `registered_at` timestamp(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`item_id`),
  CONSTRAINT `chk_eval_set` CHECK (`set_kind` in ('real','fake')),
  CONSTRAINT `chk_eval_kind` CHECK (`set_kind` = 'real' and `sheet_kind` is not null and `sheet_kind` in ('jeongganbo','staff','handwritten') and `fake_label` is null or `set_kind` = 'fake' and `sheet_kind` is null and `fake_label` is not null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `eval_run_result`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `eval_run_result` (
  `run_id` bigint(20) NOT NULL AUTO_INCREMENT,
  `item_id` bigint(20) NOT NULL,
  `request_id` bigint(20) NOT NULL,
  `run_at` timestamp(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`run_id`),
  UNIQUE KEY `uq_eval_run_request` (`request_id`),
  KEY `fk_eval_run_item` (`item_id`),
  CONSTRAINT `fk_eval_run_item` FOREIGN KEY (`item_id`) REFERENCES `eval_item` (`item_id`),
  CONSTRAINT `fk_eval_run_request` FOREIGN KEY (`request_id`) REFERENCES `score_request` (`request_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `fallback_template`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `fallback_template` (
  `template_id` bigint(20) NOT NULL AUTO_INCREMENT,
  `holder` varchar(12) NOT NULL,
  `name` varchar(100) NOT NULL,
  `midi_uri` varchar(500) NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `score_type` varchar(10) DEFAULT NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT current_timestamp(3),
  `musicxml_uri` varchar(500) DEFAULT NULL,
  `version` varchar(20) DEFAULT NULL,
  PRIMARY KEY (`template_id`),
  UNIQUE KEY `uq_fallback_template` (`holder`,`name`),
  CONSTRAINT `chk_template_holder` CHECK (`holder` in ('web','api_server')),
  CONSTRAINT `chk_template_score_type` CHECK (`score_type` is null or `score_type` in ('staff','jeongganbo'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `gate_event`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `gate_event` (
  `event_id` bigint(20) NOT NULL AUTO_INCREMENT,
  `gate_code` varchar(3) NOT NULL,
  `occurred_at` timestamp(3) NOT NULL DEFAULT current_timestamp(3),
  `channel` varchar(5) NOT NULL,
  `subject_type` varchar(16) NOT NULL,
  `subject_ref` varchar(64) DEFAULT NULL,
  `reason_code` varchar(40) NOT NULL,
  `released_at` timestamp(3) NULL DEFAULT NULL,
  `release_action` varchar(40) DEFAULT NULL,
  PRIMARY KEY (`event_id`),
  KEY `ix_gate_code_time` (`gate_code`,`occurred_at`),
  CONSTRAINT `chk_gate_channel` CHECK (`channel` in ('web','api','admin')),
  CONSTRAINT `chk_gate_release` CHECK (`released_at` is null and `release_action` is null or `released_at` is not null and `release_action` is not null and `released_at` >= `occurred_at`),
  CONSTRAINT `chk_gate_subject` CHECK (`subject_type` in ('session','access_key','api_call','request','operator','soundfont','setting_version','client','account')),
  CONSTRAINT `chk_gate_code` CHECK (`gate_code` in ('G1','G2','G3','G4','G5','G6','G7','G8','G10','G11','G12','G13','G14','G15','G16'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `instrument`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `instrument` (
  `instrument_id` bigint(20) NOT NULL AUTO_INCREMENT,
  `name` varchar(60) NOT NULL,
  `family` varchar(10) NOT NULL,
  `midi_program` smallint(6) DEFAULT NULL,
  `range_low` smallint(6) DEFAULT NULL,
  `range_high` smallint(6) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `code` varchar(40) DEFAULT NULL,
  `is_percussion` tinyint(1) NOT NULL DEFAULT 0,
  `soundfont_file` varchar(100) DEFAULT NULL,
  `menu_order` smallint(6) DEFAULT NULL,
  PRIMARY KEY (`instrument_id`),
  UNIQUE KEY `uq_instrument_name` (`name`),
  UNIQUE KEY `uq_instrument_code` (`code`),
  CONSTRAINT `chk_instrument_family` CHECK (`family` in ('gugak','other')),
  CONSTRAINT `chk_instrument_program` CHECK (`midi_program` between 0 and 127),
  CONSTRAINT `chk_instrument_range` CHECK (`range_low` between 0 and 127 and `range_high` between 0 and 127 and `range_low` <= `range_high`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `instrument_selection`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `instrument_selection` (
  `selection_id` bigint(20) NOT NULL AUTO_INCREMENT,
  `request_id` bigint(20) NOT NULL,
  `ensemble_id` bigint(20) NOT NULL,
  `source` varchar(16) NOT NULL,
  `selected_at` timestamp(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`selection_id`),
  KEY `fk_selection_ensemble` (`ensemble_id`),
  KEY `ix_selection_request` (`request_id`,`selected_at`),
  CONSTRAINT `fk_selection_ensemble` FOREIGN KEY (`ensemble_id`) REFERENCES `ensemble` (`ensemble_id`),
  CONSTRAINT `fk_selection_request` FOREIGN KEY (`request_id`) REFERENCES `score_request` (`request_id`),
  CONSTRAINT `chk_selection_source` CHECK (`source` in ('initial_default','user_choice','api_option','revert_default'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `key_application`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `key_application` (
  `key_id` bigint(20) NOT NULL,
  `applicant_name` varchar(100) NOT NULL,
  `affiliation` varchar(200) NOT NULL,
  `contact_email` varchar(254) NOT NULL,
  `purpose` varchar(1000) NOT NULL,
  `applied_at` timestamp(3) NOT NULL DEFAULT current_timestamp(3),
  `consent_given` tinyint(1) NOT NULL,
  `client_addr_hash` char(64) NOT NULL,
  `retained_at` timestamp(3) NULL DEFAULT NULL,
  `retained_by` bigint(20) DEFAULT NULL,
  `account_id` bigint(20) DEFAULT NULL,
  PRIMARY KEY (`key_id`),
  KEY `fk_application_retained_by` (`retained_by`),
  KEY `ix_application_email` (`contact_email`,`applied_at`),
  KEY `ix_application_address` (`client_addr_hash`,`applied_at`),
  KEY `ix_application_applied` (`applied_at`),
  KEY `fk_application_account` (`account_id`),
  CONSTRAINT `fk_application_account` FOREIGN KEY (`account_id`) REFERENCES `account` (`account_id`),
  CONSTRAINT `fk_application_key` FOREIGN KEY (`key_id`) REFERENCES `access_key` (`key_id`),
  CONSTRAINT `fk_application_retained_by` FOREIGN KEY (`retained_by`) REFERENCES `operator_account` (`operator_id`),
  CONSTRAINT `chk_g10_required` CHECK (trim(`applicant_name`) <> '' and trim(`affiliation`) <> '' and trim(`contact_email`) <> '' and trim(`purpose`) <> ''),
  CONSTRAINT `chk_g10_consent` CHECK (`consent_given` = 1),
  CONSTRAINT `chk_application_retained` CHECK (`retained_at` is null and `retained_by` is null or `retained_at` is not null and `retained_by` is not null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_uca1400_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 */ /*!50003 TRIGGER trg_g11_application_rate
BEFORE INSERT ON key_application
FOR EACH ROW
BEGIN
  IF EXISTS (SELECT 1 FROM v_apply_rate_window w
              WHERE w.rate_key IN (CONCAT('email:', NEW.contact_email), CONCAT('addr:', NEW.client_addr_hash))
                AND w.is_blocked = 1) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'G11: application rate limit exceeded';
  END IF;
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;

--
-- Table structure for table `license_policy`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `license_policy` (
  `policy_code` varchar(40) NOT NULL,
  `confirmed` tinyint(1) NOT NULL DEFAULT 0,
  `decided_by` bigint(20) DEFAULT NULL,
  `decided_at` timestamp(3) NULL DEFAULT NULL,
  PRIMARY KEY (`policy_code`),
  KEY `fk_license_operator` (`decided_by`),
  CONSTRAINT `fk_license_operator` FOREIGN KEY (`decided_by`) REFERENCES `operator_account` (`operator_id`),
  CONSTRAINT `chk_license_code` CHECK (`policy_code` = 'sound_and_renderer'),
  CONSTRAINT `chk_license_decided` CHECK (`confirmed` = 0 or `decided_by` is not null and `decided_at` is not null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `model_load_event`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `model_load_event` (
  `load_id` bigint(20) NOT NULL AUTO_INCREMENT,
  `model_name` varchar(40) NOT NULL,
  `trigger_kind` varchar(10) NOT NULL,
  `operator_id` bigint(20) DEFAULT NULL,
  `started_at` timestamp(3) NOT NULL DEFAULT current_timestamp(3),
  `finished_at` timestamp(3) NULL DEFAULT NULL,
  `outcome` varchar(10) NOT NULL DEFAULT 'running',
  `error_text` varchar(500) DEFAULT NULL,
  `duration_ms` bigint(20) GENERATED ALWAYS AS (timestampdiff(MICROSECOND,`started_at`,`finished_at`) DIV 1000) STORED,
  PRIMARY KEY (`load_id`),
  KEY `fk_load_operator` (`operator_id`),
  KEY `ix_load_model_time` (`model_name`,`started_at`),
  CONSTRAINT `fk_load_model` FOREIGN KEY (`model_name`) REFERENCES `model_registry` (`model_name`) ON DELETE CASCADE,
  CONSTRAINT `fk_load_operator` FOREIGN KEY (`operator_id`) REFERENCES `operator_account` (`operator_id`),
  CONSTRAINT `chk_load_trigger` CHECK (`trigger_kind` in ('admin','startup','reload','request')),
  CONSTRAINT `chk_load_outcome` CHECK (`outcome` in ('running','ok','failed','timeout')),
  CONSTRAINT `chk_load_finished` CHECK (`outcome` = 'running' and `finished_at` is null or `outcome` <> 'running' and `finished_at` is not null),
  CONSTRAINT `chk_load_error` CHECK (`outcome` not in ('failed','timeout') or `error_text` is not null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `model_registry`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `model_registry` (
  `model_name` varchar(40) NOT NULL,
  `kind` varchar(16) NOT NULL,
  `provider` varchar(8) NOT NULL,
  `display_name` varchar(100) NOT NULL,
  `provider_ref` varchar(300) DEFAULT NULL,
  `config_json` longtext DEFAULT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT 1,
  `registered_by` bigint(20) DEFAULT NULL,
  `registered_at` timestamp(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` timestamp(3) NOT NULL DEFAULT current_timestamp(3),
  `notes` varchar(500) DEFAULT NULL,
  PRIMARY KEY (`model_name`),
  KEY `fk_model_registered_by` (`registered_by`),
  CONSTRAINT `fk_model_registered_by` FOREIGN KEY (`registered_by`) REFERENCES `operator_account` (`operator_id`),
  CONSTRAINT `chk_model_kind` CHECK (`kind` in ('omr_staff','omr_jeongganbo','recommend')),
  CONSTRAINT `chk_model_provider` CHECK (`provider` in ('venv','ollama','builtin')),
  CONSTRAINT `chk_model_name` CHECK (`model_name` regexp '^[a-z0-9][a-z0-9._-]{1,39}$'),
  CONSTRAINT `chk_model_ref` CHECK (`provider` = 'builtin' or `provider_ref` is not null and trim(`provider_ref`) <> ''),
  CONSTRAINT `chk_model_no_cloud` CHECK (`provider` <> 'ollama' or `provider_ref`  not like '%:cloud%' and `provider_ref`  not like '%-cloud'),
  CONSTRAINT `chk_model_config_json` CHECK (`config_json` is null or json_valid(`config_json`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `operator_account`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `operator_account` (
  `operator_id` bigint(20) NOT NULL AUTO_INCREMENT,
  `login_id` varchar(64) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `display_name` varchar(100) NOT NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT current_timestamp(3),
  `disabled_at` timestamp(3) NULL DEFAULT NULL,
  `failed_login_count` int(11) NOT NULL DEFAULT 0,
  `locked_until` timestamp(3) NULL DEFAULT NULL,
  `account_id` bigint(20) DEFAULT NULL,
  PRIMARY KEY (`operator_id`),
  UNIQUE KEY `uq_operator_login` (`login_id`),
  UNIQUE KEY `uq_operator_account` (`account_id`),
  CONSTRAINT `fk_operator_account` FOREIGN KEY (`account_id`) REFERENCES `account` (`account_id`),
  CONSTRAINT `chk_operator_nonempty` CHECK (trim(`login_id`) <> '' and trim(`password_hash`) <> '')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `performance_option`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `performance_option` (
  `request_id` bigint(20) NOT NULL,
  `instrument_mode` varchar(10) NOT NULL DEFAULT 'default',
  `ensemble_id` bigint(20) DEFAULT NULL,
  `transpose_semitones` smallint(6) NOT NULL DEFAULT 0,
  `volume_level` smallint(6) DEFAULT NULL,
  PRIMARY KEY (`request_id`),
  KEY `fk_perf_ensemble` (`ensemble_id`),
  CONSTRAINT `fk_perf_ensemble` FOREIGN KEY (`ensemble_id`) REFERENCES `ensemble` (`ensemble_id`),
  CONSTRAINT `fk_perf_request` FOREIGN KEY (`request_id`) REFERENCES `score_request` (`request_id`),
  CONSTRAINT `chk_perf_mode` CHECK (`instrument_mode` in ('default','explicit','recommend','original')),
  CONSTRAINT `chk_perf_explicit` CHECK (`instrument_mode` = 'explicit' and `ensemble_id` is not null or `instrument_mode` <> 'explicit' and `ensemble_id` is null),
  CONSTRAINT `chk_perf_volume` CHECK (`volume_level` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `processing_job`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `processing_job` (
  `request_id` bigint(20) NOT NULL,
  `confirmed_score_type` varchar(12) NOT NULL,
  `structure_verdict` varchar(10) NOT NULL,
  `type_mismatch` tinyint(1) NOT NULL DEFAULT 0,
  `type_answer` varchar(8) DEFAULT NULL,
  `validity_grade` varchar(10) DEFAULT NULL,
  `started_at` timestamp(3) NOT NULL DEFAULT current_timestamp(3),
  `finished_at` timestamp(3) NULL DEFAULT NULL,
  PRIMARY KEY (`request_id`),
  CONSTRAINT `fk_job_request` FOREIGN KEY (`request_id`) REFERENCES `score_request` (`request_id`),
  CONSTRAINT `chk_job_type` CHECK (`confirmed_score_type` in ('staff','jeongganbo')),
  CONSTRAINT `chk_job_structure` CHECK (`structure_verdict` in ('pass','ambiguous','fail')),
  CONSTRAINT `chk_job_grade` CHECK (`validity_grade` in ('trust','caution','distrust')),
  CONSTRAINT `chk_job_no_grade_on_fail` CHECK (`structure_verdict` <> 'fail' or `validity_grade` is null),
  CONSTRAINT `chk_job_answer` CHECK (`type_answer` is null or `type_mismatch` = 1 and `type_answer` in ('changed','kept'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `processing_setting_version`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `processing_setting_version` (
  `setting_version_id` bigint(20) NOT NULL AUTO_INCREMENT,
  `created_at` timestamp(3) NOT NULL DEFAULT current_timestamp(3),
  `created_by` bigint(20) NOT NULL,
  `timeout_seconds` int(11) DEFAULT NULL,
  `max_concurrency` int(11) DEFAULT NULL,
  `fallback_enabled` tinyint(1) NOT NULL DEFAULT 1,
  `default_call_limit_per_hour` int(11) DEFAULT NULL,
  `apply_rate_limit_count` int(11) DEFAULT NULL,
  `apply_rate_window_minutes` int(11) DEFAULT NULL,
  `structure_threshold` decimal(5,4) DEFAULT NULL,
  `grade_caution_boundary` decimal(5,4) DEFAULT NULL,
  `grade_distrust_boundary` decimal(5,4) DEFAULT NULL,
  `api_apply_status` varchar(12) NOT NULL DEFAULT 'pending',
  `api_applied_at` timestamp(3) NULL DEFAULT NULL,
  `web_max_active_per_client` int(11) DEFAULT NULL,
  `web_hourly_request_cap` int(11) DEFAULT NULL,
  `max_concurrency_recognize` int(11) DEFAULT NULL,
  `max_concurrency_render` int(11) DEFAULT NULL,
  `web_concurrency_share` int(11) DEFAULT NULL,
  `score_file_max_bytes` bigint(20) DEFAULT NULL,
  `recommend_timeout_ms` int(11) DEFAULT NULL,
  `login_max_failures` int(11) DEFAULT NULL,
  `login_lock_minutes` int(11) DEFAULT NULL,
  `llm_recommend_timeout_ms` int(11) DEFAULT NULL,
  PRIMARY KEY (`setting_version_id`),
  KEY `fk_setting_operator` (`created_by`),
  KEY `ix_setting_created` (`created_at`),
  CONSTRAINT `fk_setting_operator` FOREIGN KEY (`created_by`) REFERENCES `operator_account` (`operator_id`),
  CONSTRAINT `chk_g6_timeout` CHECK (`timeout_seconds` > 0),
  CONSTRAINT `chk_g6_concurrency` CHECK (`max_concurrency` >= 1),
  CONSTRAINT `chk_g6_rate_count` CHECK (`apply_rate_limit_count` >= 1),
  CONSTRAINT `chk_g6_rate_window` CHECK (`apply_rate_window_minutes` between 1 and 10080),
  CONSTRAINT `chk_g6_structure` CHECK (`structure_threshold` between 0 and 1),
  CONSTRAINT `chk_g6_grade_range` CHECK (`grade_caution_boundary` between 0 and 1 and `grade_distrust_boundary` between 0 and 1),
  CONSTRAINT `chk_g6_grade_order` CHECK (`grade_distrust_boundary` < `grade_caution_boundary`),
  CONSTRAINT `chk_setting_apply` CHECK (`api_apply_status` in ('pending','applied','unapplied')),
  CONSTRAINT `chk_setting_applied_at` CHECK (`api_apply_status` = 'applied' and `api_applied_at` is not null or `api_apply_status` <> 'applied' and `api_applied_at` is null),
  CONSTRAINT `chk_g6_web_active` CHECK (`web_max_active_per_client` >= 1),
  CONSTRAINT `chk_g6_web_hourly` CHECK (`web_hourly_request_cap` >= 1),
  CONSTRAINT `chk_g6_conc_split` CHECK (`max_concurrency_recognize` >= 1 and `max_concurrency_render` >= 1 and `web_concurrency_share` >= 1 and `web_concurrency_share` <= `max_concurrency_recognize`),
  CONSTRAINT `chk_g6_file_bytes` CHECK (`score_file_max_bytes` >= 1),
  CONSTRAINT `chk_g6_recommend_ms` CHECK (`recommend_timeout_ms` >= 1),
  CONSTRAINT `chk_g6_login` CHECK (`login_max_failures` >= 1 and `login_lock_minutes` >= 1),
  CONSTRAINT `chk_g6_grade_pair` CHECK (`grade_caution_boundary` is null = (`grade_distrust_boundary` is null)),
  CONSTRAINT `chk_g6_default_limit` CHECK (`default_call_limit_per_hour` >= 1),
  CONSTRAINT `chk_g6_llm_ms` CHECK (`llm_recommend_timeout_ms` >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `recommendation`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `recommendation` (
  `recommendation_id` bigint(20) NOT NULL AUTO_INCREMENT,
  `request_id` bigint(20) NOT NULL,
  `requested_at` timestamp(3) NOT NULL DEFAULT current_timestamp(3),
  `responded_at` timestamp(3) NULL DEFAULT NULL,
  `outcome` varchar(16) NOT NULL,
  `model_name` varchar(40) DEFAULT NULL,
  `model_version` varchar(40) DEFAULT NULL,
  `feature_tempo` varchar(20) DEFAULT NULL,
  `feature_mode` varchar(20) DEFAULT NULL,
  `feature_range` varchar(40) DEFAULT NULL,
  `feature_density` decimal(8,3) DEFAULT NULL,
  `duration_ms` bigint(20) GENERATED ALWAYS AS (timestampdiff(MICROSECOND,`requested_at`,`responded_at`) DIV 1000) STORED,
  PRIMARY KEY (`recommendation_id`),
  KEY `fk_recommendation_request` (`request_id`),
  CONSTRAINT `fk_recommendation_request` FOREIGN KEY (`request_id`) REFERENCES `score_request` (`request_id`),
  CONSTRAINT `chk_rec_outcome` CHECK (`outcome` in ('pending','ok','model_failed','no_response','api_down','feature_failed')),
  CONSTRAINT `chk_rec_model` CHECK (`outcome` <> 'ok' or `model_name` is not null and `model_version` is not null),
  CONSTRAINT `chk_rec_time` CHECK (`responded_at` is null or `responded_at` >= `requested_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `recommendation_option`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `recommendation_option` (
  `recommendation_id` bigint(20) NOT NULL,
  `rank_no` smallint(6) NOT NULL,
  `ensemble_id` bigint(20) NOT NULL,
  PRIMARY KEY (`recommendation_id`,`rank_no`),
  KEY `fk_option_ensemble` (`ensemble_id`),
  CONSTRAINT `fk_option_ensemble` FOREIGN KEY (`ensemble_id`) REFERENCES `ensemble` (`ensemble_id`),
  CONSTRAINT `fk_option_recommendation` FOREIGN KEY (`recommendation_id`) REFERENCES `recommendation` (`recommendation_id`) ON DELETE CASCADE,
  CONSTRAINT `chk_option_rank` CHECK (`rank_no` >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `request_page`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `request_page` (
  `request_id` bigint(20) NOT NULL,
  `page_no` smallint(6) NOT NULL,
  `file_no` smallint(6) NOT NULL,
  `source` varchar(8) NOT NULL,
  `image_short_side_px` int(11) DEFAULT NULL,
  `upscaled_short_side_px` int(11) DEFAULT NULL,
  `structure_verdict` varchar(10) DEFAULT NULL,
  `validity_grade` varchar(10) DEFAULT NULL,
  `outcome` varchar(10) NOT NULL DEFAULT 'pending',
  `fallback_reason` varchar(20) DEFAULT NULL,
  `engine_name` varchar(40) DEFAULT NULL,
  `engine_version` varchar(40) DEFAULT NULL,
  `started_at` timestamp(3) NULL DEFAULT NULL,
  `ended_at` timestamp(3) NULL DEFAULT NULL,
  `duration_ms` bigint(20) GENERATED ALWAYS AS (timestampdiff(MICROSECOND,`started_at`,`ended_at`) DIV 1000) STORED,
  PRIMARY KEY (`request_id`,`page_no`),
  KEY `fk_page_upload` (`request_id`,`file_no`),
  CONSTRAINT `fk_page_request` FOREIGN KEY (`request_id`) REFERENCES `score_request` (`request_id`),
  CONSTRAINT `fk_page_upload` FOREIGN KEY (`request_id`, `file_no`) REFERENCES `upload_file` (`request_id`, `file_no`),
  CONSTRAINT `chk_page_no` CHECK (`page_no` between 1 and 10),
  CONSTRAINT `chk_page_source` CHECK (`source` in ('file','pdf_page')),
  CONSTRAINT `chk_page_structure` CHECK (`structure_verdict` in ('pass','ambiguous','fail')),
  CONSTRAINT `chk_page_grade` CHECK (`validity_grade` in ('trust','caution','distrust')),
  CONSTRAINT `chk_page_outcome` CHECK (`outcome` in ('pending','converted','failed')),
  CONSTRAINT `chk_page_failure` CHECK (`outcome` = 'failed' and `fallback_reason` is not null and `fallback_reason` in ('recognition_failed','timeout','engine_stopped','no_structure','distrust') or `outcome` <> 'failed' and `fallback_reason` is null),
  CONSTRAINT `chk_page_converted` CHECK (`outcome` <> 'converted' or `validity_grade` in ('trust','caution')),
  CONSTRAINT `chk_page_time` CHECK (`ended_at` is null or `started_at` is null or `ended_at` >= `started_at`),
  CONSTRAINT `chk_page_short_side` CHECK (`image_short_side_px` is null or `image_short_side_px` >= 300)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `role`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `role` (
  `role_code` varchar(16) NOT NULL,
  `name_ko` varchar(40) NOT NULL,
  `description` varchar(200) NOT NULL,
  PRIMARY KEY (`role_code`),
  CONSTRAINT `chk_role_code` CHECK (`role_code` in ('user','operator','api_caller','service'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `role_permission`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `role_permission` (
  `role_code` varchar(16) NOT NULL,
  `uc_code` varchar(5) NOT NULL,
  PRIMARY KEY (`role_code`,`uc_code`),
  CONSTRAINT `fk_role_permission_role` FOREIGN KEY (`role_code`) REFERENCES `role` (`role_code`),
  CONSTRAINT `chk_role_permission_uc` CHECK (`uc_code` regexp '^UC([1-9]|1[0-9])$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `score_like`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `score_like` (
  `share_id` bigint(20) NOT NULL,
  `account_id` bigint(20) NOT NULL,
  `liked_at` timestamp(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`share_id`,`account_id`),
  KEY `fk_score_like_account` (`account_id`),
  CONSTRAINT `fk_score_like_account` FOREIGN KEY (`account_id`) REFERENCES `account` (`account_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_score_like_share` FOREIGN KEY (`share_id`) REFERENCES `shared_score` (`share_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `score_request`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `score_request` (
  `request_id` bigint(20) NOT NULL AUTO_INCREMENT,
  `request_no` varchar(20) NOT NULL,
  `channel` varchar(4) NOT NULL,
  `session_id` char(36) DEFAULT NULL,
  `access_key_id` bigint(20) DEFAULT NULL,
  `file_kind` varchar(10) NOT NULL,
  `chosen_score_type` varchar(12) DEFAULT NULL,
  `route` varchar(10) NOT NULL,
  `from_share_id` bigint(20) DEFAULT NULL,
  `example_id` varchar(64) DEFAULT NULL,
  `fallback_reason` varchar(20) DEFAULT NULL,
  `status` varchar(22) NOT NULL DEFAULT 'received',
  `setting_version_id` bigint(20) NOT NULL,
  `received_at` timestamp(3) NOT NULL DEFAULT current_timestamp(3),
  `completed_at` timestamp(3) NULL DEFAULT NULL,
  `result_shown_at` timestamp(3) NULL DEFAULT NULL,
  `first_played_at` timestamp(3) NULL DEFAULT NULL,
  `purged_at` timestamp(3) NULL DEFAULT NULL,
  `owner_deleted_at` timestamp(3) NULL DEFAULT NULL,
  `client_addr_hash` char(64) DEFAULT NULL,
  `identity_purged_at` timestamp(3) NULL DEFAULT NULL,
  `account_id` bigint(20) DEFAULT NULL,
  PRIMARY KEY (`request_id`),
  UNIQUE KEY `uq_request_no` (`request_no`),
  KEY `fk_request_key` (`access_key_id`),
  KEY `fk_request_setting` (`setting_version_id`),
  KEY `ix_request_received` (`received_at`),
  KEY `ix_request_channel_kind` (`channel`,`file_kind`,`route`),
  KEY `ix_request_status` (`status`),
  KEY `ix_request_session_time` (`session_id`,`received_at`),
  KEY `ix_request_addr_time` (`client_addr_hash`,`received_at`),
  KEY `ix_request_account_time` (`account_id`,`received_at`),
  KEY `fk_request_from_share` (`from_share_id`),
  CONSTRAINT `fk_request_account` FOREIGN KEY (`account_id`) REFERENCES `account` (`account_id`),
  CONSTRAINT `fk_request_from_share` FOREIGN KEY (`from_share_id`) REFERENCES `shared_score` (`share_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_request_key` FOREIGN KEY (`access_key_id`) REFERENCES `access_key` (`key_id`),
  CONSTRAINT `fk_request_session` FOREIGN KEY (`session_id`) REFERENCES `anon_session` (`session_id`),
  CONSTRAINT `fk_request_setting` FOREIGN KEY (`setting_version_id`) REFERENCES `processing_setting_version` (`setting_version_id`),
  CONSTRAINT `chk_request_channel` CHECK (`channel` in ('web','api')),
  CONSTRAINT `chk_request_fallback` CHECK (`route` = 'fallback' and `fallback_reason` is not null and `fallback_reason` in ('recognition_failed','timeout','engine_stopped','user_request','no_structure','distrust') or `route` <> 'fallback' and `fallback_reason` is null),
  CONSTRAINT `chk_request_status` CHECK (`status` in ('received','queued','converting','awaiting_type_answer','rendering','completed','service_down')),
  CONSTRAINT `chk_request_ask_web_only` CHECK (`status` <> 'awaiting_type_answer' or `channel` = 'web'),
  CONSTRAINT `chk_request_render_api_only` CHECK (`status` <> 'rendering' or `channel` = 'api'),
  CONSTRAINT `chk_request_service_down` CHECK (`status` <> 'service_down' or `route` = 'fallback'),
  CONSTRAINT `chk_request_completed` CHECK (`status` = 'completed' and `completed_at` is not null or `status` <> 'completed' and `completed_at` is null),
  CONSTRAINT `chk_request_web_times` CHECK (`channel` = 'web' or `result_shown_at` is null and `first_played_at` is null),
  CONSTRAINT `chk_request_owner` CHECK (`channel` = 'web' and `access_key_id` is null and (`session_id` is not null or `identity_purged_at` is not null) or `channel` = 'api' and `session_id` is null and `access_key_id` is not null),
  CONSTRAINT `chk_request_identity_purged` CHECK (`identity_purged_at` is null or `session_id` is null and `client_addr_hash` is null),
  CONSTRAINT `chk_request_file_kind` CHECK (`file_kind` in ('image','pdf','midi','musicxml')),
  CONSTRAINT `chk_request_score_type` CHECK (`file_kind` in ('image','pdf') and `chosen_score_type` is not null and `chosen_score_type` in ('staff','jeongganbo') or `file_kind` not in ('image','pdf') and `chosen_score_type` is null),
  CONSTRAINT `chk_request_route` CHECK (`file_kind` in ('image','pdf') and `route` in ('recognize','fallback') or `file_kind` not in ('image','pdf') and `route` = 'direct')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_uca1400_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 */ /*!50003 TRIGGER trg_request_terminal
BEFORE UPDATE ON score_request
FOR EACH ROW
BEGIN
  IF OLD.status IN ('completed','service_down') AND NEW.status <> OLD.status THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'request status is terminal';
  END IF;
  IF OLD.status = 'completed' AND OLD.route <> NEW.route
     AND NOT (NEW.route = 'fallback' AND NEW.fallback_reason = 'user_request') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'only user_request fallback may change a completed route';
  END IF;
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;

--
-- Table structure for table `score_result`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `score_result` (
  `result_id` bigint(20) NOT NULL AUTO_INCREMENT,
  `request_id` bigint(20) NOT NULL,
  `origin` varchar(10) NOT NULL,
  `musicxml_uri` varchar(500) DEFAULT NULL,
  `midi_uri` varchar(500) DEFAULT NULL,
  `fallback_template_id` bigint(20) DEFAULT NULL,
  `original_ensemble_id` bigint(20) DEFAULT NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT current_timestamp(3),
  `deleted_at` timestamp(3) NULL DEFAULT NULL,
  PRIMARY KEY (`result_id`),
  UNIQUE KEY `uq_result_origin` (`request_id`,`origin`),
  UNIQUE KEY `uq_result_request` (`result_id`,`request_id`),
  KEY `fk_result_template` (`fallback_template_id`),
  KEY `fk_result_original` (`original_ensemble_id`),
  CONSTRAINT `fk_result_original` FOREIGN KEY (`original_ensemble_id`) REFERENCES `ensemble` (`ensemble_id`),
  CONSTRAINT `fk_result_request` FOREIGN KEY (`request_id`) REFERENCES `score_request` (`request_id`),
  CONSTRAINT `fk_result_template` FOREIGN KEY (`fallback_template_id`) REFERENCES `fallback_template` (`template_id`),
  CONSTRAINT `chk_result_origin` CHECK (`origin` in ('recognized','direct','fallback')),
  CONSTRAINT `chk_result_template` CHECK (`origin` = 'fallback' and `fallback_template_id` is not null or `origin` <> 'fallback' and `fallback_template_id` is null),
  CONSTRAINT `chk_result_original` CHECK (`original_ensemble_id` is null or `origin` = 'direct'),
  CONSTRAINT `chk_result_deleted` CHECK (`deleted_at` is null and `musicxml_uri` is not null or `deleted_at` is not null and `musicxml_uri` is null and `midi_uri` is null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_uca1400_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 */ /*!50003 TRIGGER trg_score_result_insert
BEFORE INSERT ON score_result
FOR EACH ROW
BEGIN
  DECLARE v_channel VARCHAR(4);
  DECLARE v_route VARCHAR(10);
  DECLARE v_reason VARCHAR(20);
  DECLARE v_holder VARCHAR(12);
  SELECT channel, route, fallback_reason INTO v_channel, v_route, v_reason
    FROM score_request WHERE request_id = NEW.request_id;
  IF NEW.origin = 'fallback' THEN
    SELECT holder INTO v_holder FROM fallback_template WHERE template_id = NEW.fallback_template_id;
    IF (v_channel = 'web' AND v_holder <> 'web') OR (v_channel = 'api' AND v_holder <> 'api_server') THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'BR-FBK-02: template holder must match request channel';
    END IF;
  END IF;
  IF NEW.origin = 'recognized' AND v_route = 'fallback' AND v_reason IN ('timeout','engine_stopped') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'UC2-E4: late recognition result ignored';
  END IF;
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;

--
-- Table structure for table `setting_engine_order`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `setting_engine_order` (
  `setting_version_id` bigint(20) NOT NULL,
  `score_type` varchar(12) NOT NULL,
  `seq` smallint(6) NOT NULL,
  `engine_name` varchar(40) NOT NULL,
  PRIMARY KEY (`setting_version_id`,`score_type`,`seq`),
  UNIQUE KEY `uq_setting_engine_once` (`setting_version_id`,`score_type`,`engine_name`),
  CONSTRAINT `fk_engine_order_version` FOREIGN KEY (`setting_version_id`) REFERENCES `processing_setting_version` (`setting_version_id`) ON DELETE CASCADE,
  CONSTRAINT `chk_engine_order_seq` CHECK (`seq` >= 1),
  CONSTRAINT `chk_engine_order_type` CHECK (`score_type` in ('staff','jeongganbo','recommend'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `shared_score`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `shared_score` (
  `share_id` bigint(20) NOT NULL AUTO_INCREMENT,
  `share_no` varchar(20) NOT NULL,
  `source_request_id` bigint(20) DEFAULT NULL,
  `owner_account_id` bigint(20) DEFAULT NULL,
  `example_id` varchar(64) DEFAULT NULL,
  `title` varchar(60) NOT NULL,
  `score_type` varchar(12) NOT NULL,
  `musicxml_uri` varchar(255) DEFAULT NULL,
  `shared_at` timestamp(3) NOT NULL DEFAULT current_timestamp(3),
  `expires_at` timestamp(3) NOT NULL DEFAULT (current_timestamp(3) + interval 3 day),
  `purged_at` timestamp(3) NULL DEFAULT NULL,
  `unshared_at` timestamp(3) NULL DEFAULT NULL,
  `taken_down_at` timestamp(3) NULL DEFAULT NULL,
  `taken_down_by` bigint(20) DEFAULT NULL,
  `take_down_reason` varchar(200) DEFAULT NULL,
  PRIMARY KEY (`share_id`),
  UNIQUE KEY `uq_shared_score_no` (`share_no`),
  UNIQUE KEY `uq_shared_score_request` (`source_request_id`),
  UNIQUE KEY `uq_shared_score_example` (`example_id`),
  KEY `fk_shared_score_owner` (`owner_account_id`),
  KEY `fk_shared_score_op` (`taken_down_by`),
  KEY `ix_shared_score_visible` (`unshared_at`,`taken_down_at`,`shared_at`),
  KEY `ix_shared_score_expires` (`expires_at`,`purged_at`),
  CONSTRAINT `fk_shared_score_op` FOREIGN KEY (`taken_down_by`) REFERENCES `operator_account` (`operator_id`),
  CONSTRAINT `fk_shared_score_owner` FOREIGN KEY (`owner_account_id`) REFERENCES `account` (`account_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_shared_score_request` FOREIGN KEY (`source_request_id`) REFERENCES `score_request` (`request_id`) ON DELETE SET NULL,
  CONSTRAINT `chk_shared_score_type` CHECK (`score_type` in ('staff','jeongganbo')),
  CONSTRAINT `chk_shared_score_title` CHECK (char_length(trim(`title`)) between 1 and 60)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `snapshot_engine_version`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `snapshot_engine_version` (
  `snapshot_id` bigint(20) NOT NULL,
  `engine_name` varchar(40) NOT NULL,
  `engine_version` varchar(40) NOT NULL,
  PRIMARY KEY (`snapshot_id`,`engine_name`),
  CONSTRAINT `fk_snapshot_engine` FOREIGN KEY (`snapshot_id`) REFERENCES `api_spec_snapshot` (`snapshot_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `stage_timing`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `stage_timing` (
  `request_id` bigint(20) NOT NULL,
  `stage_code` varchar(12) NOT NULL,
  `page_no` smallint(6) NOT NULL DEFAULT 0,
  `started_at` timestamp(3) NOT NULL,
  `ended_at` timestamp(3) NULL DEFAULT NULL,
  `duration_ms` bigint(20) GENERATED ALWAYS AS (timestampdiff(MICROSECOND,`started_at`,`ended_at`) DIV 1000) STORED,
  PRIMARY KEY (`request_id`,`stage_code`,`page_no`),
  CONSTRAINT `fk_stage_request` FOREIGN KEY (`request_id`) REFERENCES `score_request` (`request_id`),
  CONSTRAINT `chk_stage_code` CHECK (`stage_code` in ('check','queue','structure','jg_convert','validity')),
  CONSTRAINT `chk_stage_time` CHECK (`ended_at` is null or `ended_at` >= `started_at`),
  CONSTRAINT `chk_stage_page` CHECK (`page_no` between 0 and 10)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `upload_file`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `upload_file` (
  `upload_id` bigint(20) NOT NULL AUTO_INCREMENT,
  `request_id` bigint(20) NOT NULL,
  `file_no` smallint(6) NOT NULL DEFAULT 1,
  `original_name` varchar(255) NOT NULL,
  `size_bytes` bigint(20) NOT NULL,
  `image_short_side_px` int(11) DEFAULT NULL,
  `pdf_page_count` int(11) DEFAULT NULL,
  `pdf_converted_page` smallint(6) DEFAULT NULL,
  `storage_uri` varchar(500) DEFAULT NULL,
  `stored_at` timestamp(3) NOT NULL DEFAULT current_timestamp(3),
  `deleted_at` timestamp(3) NULL DEFAULT NULL,
  PRIMARY KEY (`upload_id`),
  UNIQUE KEY `uq_upload_file_no` (`request_id`,`file_no`),
  CONSTRAINT `fk_upload_request` FOREIGN KEY (`request_id`) REFERENCES `score_request` (`request_id`),
  CONSTRAINT `chk_upload_size` CHECK (`size_bytes` > 0),
  CONSTRAINT `chk_upload_deleted` CHECK (`deleted_at` is null and `storage_uri` is not null or `deleted_at` is not null and `storage_uri` is null),
  CONSTRAINT `chk_upload_file_no` CHECK (`file_no` between 1 and 10),
  CONSTRAINT `chk_upload_pdf_pages` CHECK ((`pdf_page_count` is null or `pdf_page_count` between 1 and 10) and (`pdf_converted_page` is null or `pdf_converted_page` = 1)),
  CONSTRAINT `chk_g1_image_limits` CHECK (`image_short_side_px` is null or `image_short_side_px` >= 300 and `size_bytes` <= 20971520)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `user_soundfont`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_soundfont` (
  `soundfont_id` bigint(20) NOT NULL AUTO_INCREMENT,
  `session_id` char(36) NOT NULL,
  `file_name` varchar(255) NOT NULL,
  `size_bytes` bigint(20) NOT NULL,
  `storage_uri` varchar(500) DEFAULT NULL,
  `uploaded_at` timestamp(3) NOT NULL DEFAULT current_timestamp(3),
  `api_copy_uri` varchar(500) DEFAULT NULL,
  `api_copy_sent_at` timestamp(3) NULL DEFAULT NULL,
  `file_deleted_at` timestamp(3) NULL DEFAULT NULL,
  `api_copy_deleted_at` timestamp(3) NULL DEFAULT NULL,
  PRIMARY KEY (`soundfont_id`),
  KEY `ix_soundfont_session` (`session_id`,`file_deleted_at`),
  CONSTRAINT `fk_soundfont_session` FOREIGN KEY (`session_id`) REFERENCES `anon_session` (`session_id`),
  CONSTRAINT `chk_g8_extension` CHECK (lcase(`file_name`) like '%.sf2'),
  CONSTRAINT `chk_g8_size` CHECK (`size_bytes` > 0 and `size_bytes` <= 52428800),
  CONSTRAINT `chk_soundfont_deleted` CHECK (`file_deleted_at` is null and `storage_uri` is not null or `file_deleted_at` is not null and `storage_uri` is null),
  CONSTRAINT `chk_soundfont_copy` CHECK (`api_copy_uri` is null = (`api_copy_sent_at` is null) and (`api_copy_deleted_at` is null or `api_copy_sent_at` is not null))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_uca1400_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 */ /*!50003 TRIGGER trg_g8_soundfont_count
BEFORE INSERT ON user_soundfont
FOR EACH ROW
BEGIN
  IF (SELECT can_upload FROM v_session_soundfont_count WHERE session_id = NEW.session_id) = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'G8: max 3 soundfonts per session';
  END IF;
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;

--
-- Temporary table structure for view `v_account_admin`
--

SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_account_admin` AS SELECT
 1 AS `account_id`,
  1 AS `login_id_masked`,
  1 AS `display_name`,
  1 AS `roles`,
  1 AS `status`,
  1 AS `created_at`,
  1 AS `last_login_at`,
  1 AS `locked_until`,
  1 AS `disabled_at`,
  1 AS `failed_logins`,
  1 AS `requests_7d` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_account_permission`
--

SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_account_permission` AS SELECT
 1 AS `account_id`,
  1 AS `login_id`,
  1 AS `role_code`,
  1 AS `uc_code` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_active_operator_count`
--

SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_active_operator_count` AS SELECT
 1 AS `n` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_active_processing`
--

SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_active_processing` AS SELECT
 1 AS `recognize_active`,
  1 AS `render_active`,
  1 AS `active_count` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_application_retention`
--

SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_application_retention` AS SELECT
 1 AS `key_id`,
  1 AS `applied_at`,
  1 AS `delete_due_at`,
  1 AS `is_retained`,
  1 AS `is_purge_due` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_apply_rate_window`
--

SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_apply_rate_window` AS SELECT
 1 AS `rate_key`,
  1 AS `recent_count`,
  1 AS `limit_count`,
  1 AS `next_allowed_at`,
  1 AS `is_blocked` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_change_history_all`
--

SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_change_history_all` AS SELECT
 1 AS `target_type`,
  1 AS `target_ref`,
  1 AS `operator_id`,
  1 AS `changed_at`,
  1 AS `field_name`,
  1 AS `before_value`,
  1 AS `after_value` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_current_derived_file`
--

SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_current_derived_file` AS SELECT
 1 AS `file_id`,
  1 AS `request_id`,
  1 AS `format`,
  1 AS `basis`,
  1 AS `edit_id`,
  1 AS `ensemble_id`,
  1 AS `render_status`,
  1 AS `renderer_name`,
  1 AS `renderer_version`,
  1 AS `requested_at`,
  1 AS `render_started_at`,
  1 AS `render_finished_at`,
  1 AS `failure_reason`,
  1 AS `storage_uri`,
  1 AS `deleted_at`,
  1 AS `render_ms` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_current_result`
--

SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_current_result` AS SELECT
 1 AS `result_id`,
  1 AS `request_id`,
  1 AS `origin`,
  1 AS `musicxml_uri`,
  1 AS `midi_uri`,
  1 AS `fallback_template_id`,
  1 AS `original_ensemble_id`,
  1 AS `created_at`,
  1 AS `deleted_at` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_current_selection`
--

SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_current_selection` AS SELECT
 1 AS `request_id`,
  1 AS `ensemble_id`,
  1 AS `source`,
  1 AS `selected_at` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_current_setting`
--

SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_current_setting` AS SELECT
 1 AS `setting_version_id`,
  1 AS `created_at`,
  1 AS `created_by`,
  1 AS `timeout_seconds`,
  1 AS `max_concurrency`,
  1 AS `fallback_enabled`,
  1 AS `default_call_limit_per_hour`,
  1 AS `apply_rate_limit_count`,
  1 AS `apply_rate_window_minutes`,
  1 AS `structure_threshold`,
  1 AS `grade_caution_boundary`,
  1 AS `grade_distrust_boundary`,
  1 AS `api_apply_status`,
  1 AS `api_applied_at`,
  1 AS `web_max_active_per_client`,
  1 AS `web_hourly_request_cap`,
  1 AS `max_concurrency_recognize`,
  1 AS `max_concurrency_render`,
  1 AS `web_concurrency_share`,
  1 AS `score_file_max_bytes`,
  1 AS `recommend_timeout_ms`,
  1 AS `login_max_failures`,
  1 AS `login_lock_minutes`,
  1 AS `llm_recommend_timeout_ms` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_edit_record`
--

SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_edit_record` AS SELECT
 1 AS `request_id`,
  1 AS `edited`,
  1 AS `transpose_semitones`,
  1 AS `track_count`,
  1 AS `soundfont_tracks`,
  1 AS `downloaded_mp3_after_edit`,
  1 AS `downloaded_pdf_after_edit`,
  1 AS `downloaded_midi_after_edit`,
  1 AS `downloaded_musicxml_after_edit` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_endpoint_menu`
--

SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_endpoint_menu` AS SELECT
 1 AS `snapshot_id`,
  1 AS `http_method`,
  1 AS `path`,
  1 AS `feature_name`,
  1 AS `input_format`,
  1 AS `response_format`,
  1 AS `example_text`,
  1 AS `engine_name` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_eval_metrics`
--

SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_eval_metrics` AS SELECT
 1 AS `jeongganbo_normal_rate`,
  1 AS `fake_passed_as_trust`,
  1 AS `fake_structure_filter_rate`,
  1 AS `real_false_block_rate` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_fallback_by_reason`
--

SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_fallback_by_reason` AS SELECT
 1 AS `channel`,
  1 AS `fallback_reason`,
  1 AS `cnt` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_identity_purge_due`
--

SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_identity_purge_due` AS SELECT
 1 AS `request_id`,
  1 AS `request_no` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_instrument_menu`
--

SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_instrument_menu` AS SELECT
 1 AS `instrument_id`,
  1 AS `code`,
  1 AS `name`,
  1 AS `family`,
  1 AS `midi_program`,
  1 AS `is_percussion`,
  1 AS `soundfont_file`,
  1 AS `range_low`,
  1 AS `range_high`,
  1 AS `menu_group`,
  1 AS `menu_order` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_job_engine`
--

SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_job_engine` AS SELECT
 1 AS `request_id`,
  1 AS `engine_name`,
  1 AS `engine_version` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_key_admin_list`
--

SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_key_admin_list` AS SELECT
 1 AS `key_id`,
  1 AS `key_kind`,
  1 AS `key_prefix`,
  1 AS `call_limit_per_hour`,
  1 AS `issued_at`,
  1 AS `status`,
  1 AS `application_no`,
  1 AS `application_purged` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_key_application_masked`
--

SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_key_application_masked` AS SELECT
 1 AS `application_no`,
  1 AS `applicant_name_masked`,
  1 AS `affiliation`,
  1 AS `contact_email_masked`,
  1 AS `purpose`,
  1 AS `applied_at`,
  1 AS `delete_due_at`,
  1 AS `is_retained`,
  1 AS `key_prefix`,
  1 AS `key_status` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_key_quota`
--

SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_key_quota` AS SELECT
 1 AS `key_id`,
  1 AS `call_limit_per_hour`,
  1 AS `calls_last_hour`,
  1 AS `remaining_this_hour`,
  1 AS `is_exhausted`,
  1 AS `retry_after_at` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_key_validity`
--

SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_key_validity` AS SELECT
 1 AS `key_id`,
  1 AS `key_hash`,
  1 AS `key_kind`,
  1 AS `is_valid` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_metric_by_channel`
--

SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_metric_by_channel` AS SELECT
 1 AS `scope`,
  1 AS `image_requests`,
  1 AS `first_pass_trust`,
  1 AS `first_pass_rate`,
  1 AS `caution_count`,
  1 AS `fallback_rate`,
  1 AS `edit_usage_rate`,
  1 AS `max_wait_ms`,
  1 AS `service_down_count` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_missing_log`
--

SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_missing_log` AS SELECT
 1 AS `request_id`,
  1 AS `request_no`,
  1 AS `channel`,
  1 AS `missing_stage_timing`,
  1 AS `missing_engine_version`,
  1 AS `missing_grade` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_model_load_estimate`
--

SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_model_load_estimate` AS SELECT
 1 AS `model_name`,
  1 AS `avg_load_ms`,
  1 AS `max_load_ms`,
  1 AS `last_ok_at`,
  1 AS `last_outcome`,
  1 AS `last_error` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_mp3_license`
--

SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_mp3_license` AS SELECT
 1 AS `license_confirmed`,
  1 AS `web_mp3_internal_only`,
  1 AS `api_mp3_allowed` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_operator_masked`
--

SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_operator_masked` AS SELECT
 1 AS `operator_id`,
  1 AS `login_id_masked`,
  1 AS `disabled_at` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_purge_due_requests`
--

SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_purge_due_requests` AS SELECT
 1 AS `request_id`,
  1 AS `request_no`,
  1 AS `expires_at` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_purge_due_soundfonts`
--

SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_purge_due_soundfonts` AS SELECT
 1 AS `soundfont_id`,
  1 AS `session_id`,
  1 AS `file_pending`,
  1 AS `api_copy_pending` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_render_queue_position`
--

SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_render_queue_position` AS SELECT
 1 AS `file_id`,
  1 AS `request_id`,
  1 AS `format`,
  1 AS `queue_position` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_request_log`
--

SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_request_log` AS SELECT
 1 AS `request_id`,
  1 AS `request_no`,
  1 AS `channel`,
  1 AS `route`,
  1 AS `status`,
  1 AS `fallback_reason`,
  1 AS `file_kind`,
  1 AS `chosen_score_type`,
  1 AS `confirmed_score_type`,
  1 AS `structure_verdict`,
  1 AS `type_mismatch`,
  1 AS `type_answer`,
  1 AS `validity_grade`,
  1 AS `engine_name`,
  1 AS `engine_version`,
  1 AS `check_ms`,
  1 AS `queue_ms`,
  1 AS `structure_ms`,
  1 AS `recognize_ms`,
  1 AS `jg_convert_ms`,
  1 AS `validity_ms`,
  1 AS `recommend_ms`,
  1 AS `render_ms`,
  1 AS `received_at`,
  1 AS `completed_at` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_request_queue_position`
--

SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_request_queue_position` AS SELECT
 1 AS `request_id`,
  1 AS `queue_position` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_request_retention`
--

SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_request_retention` AS SELECT
 1 AS `request_id`,
  1 AS `request_no`,
  1 AS `received_at`,
  1 AS `expires_at`,
  1 AS `remaining_seconds`,
  1 AS `is_expired` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_request_stage_label`
--

SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_request_stage_label` AS SELECT
 1 AS `request_id`,
  1 AS `channel`,
  1 AS `stage_label`,
  1 AS `completion_label`,
  1 AS `result_band` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_server_status`
--

SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_server_status` AS SELECT
 1 AS `snapshot_id`,
  1 AS `checked_at`,
  1 AS `health_status`,
  1 AS `api_version`,
  1 AS `mismatch_with_menu`,
  1 AS `last_ok_snapshot_id` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_session_soundfont_count`
--

SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_session_soundfont_count` AS SELECT
 1 AS `session_id`,
  1 AS `active_count`,
  1 AS `can_upload` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_session_state`
--

SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_session_state` AS SELECT
 1 AS `session_id`,
  1 AS `started_at`,
  1 AS `last_active_at`,
  1 AS `ended_at`,
  1 AS `end_reason`,
  1 AS `is_ended` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_setting_change_history`
--

SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_setting_change_history` AS SELECT
 1 AS `setting_version_id`,
  1 AS `operator_id`,
  1 AS `changed_at`,
  1 AS `field_name`,
  1 AS `before_value`,
  1 AS `after_value` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_shared_purge_due`
--

SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_shared_purge_due` AS SELECT
 1 AS `share_id`,
  1 AS `share_no`,
  1 AS `musicxml_uri` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_shared_score_list`
--

SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_shared_score_list` AS SELECT
 1 AS `share_id`,
  1 AS `share_no`,
  1 AS `title`,
  1 AS `score_type`,
  1 AS `shared_at`,
  1 AS `expires_at`,
  1 AS `is_example`,
  1 AS `like_count` */;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `v_web_request_limit`
--

SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `v_web_request_limit` AS SELECT
 1 AS `limit_key`,
  1 AS `active_count`,
  1 AS `hourly_count`,
  1 AS `hourly_retry_at`,
  1 AS `web_max_active_per_client`,
  1 AS `web_hourly_request_cap` */;
SET character_set_client = @saved_cs_client;

--
-- Table structure for table `validity_check_item`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `validity_check_item` (
  `request_id` bigint(20) NOT NULL,
  `item_code` varchar(20) NOT NULL,
  `measured_value` decimal(12,4) NOT NULL,
  PRIMARY KEY (`request_id`,`item_code`),
  CONSTRAINT `fk_validity_job` FOREIGN KEY (`request_id`) REFERENCES `processing_job` (`request_id`),
  CONSTRAINT `chk_validity_item` CHECK (`item_code` in ('note_count','beat_sum','range_leap','yulmyeong_ratio','engine_confidence'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping routines for database 'baseline'
--

--
-- Final view structure for view `v_account_admin`
--

/*!50001 DROP VIEW IF EXISTS `v_account_admin`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_uca1400_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY DEFINER */
/*!50001 VIEW `v_account_admin` AS select `a`.`account_id` AS `account_id`,concat(left(substring_index(`a`.`login_id`,'@',1),3),'**',case when locate('@',`a`.`login_id`) > 0 then concat('@',substring_index(`a`.`login_id`,'@',-1)) else '' end) AS `login_id_masked`,`a`.`display_name` AS `display_name`,(select group_concat(`ar`.`role_code` order by `ar`.`role_code` ASC separator ',') from `account_role` `ar` where `ar`.`account_id` = `a`.`account_id`) AS `roles`,case when `a`.`disabled_at` is not null then 'disabled' when `a`.`locked_until` is not null and `a`.`locked_until` > current_timestamp(3) then 'locked' else 'active' end AS `status`,`a`.`created_at` AS `created_at`,`a`.`last_login_at` AS `last_login_at`,`a`.`locked_until` AS `locked_until`,`a`.`disabled_at` AS `disabled_at`,`a`.`failed_logins` AS `failed_logins`,(select count(0) from `score_request` `r` where `r`.`account_id` = `a`.`account_id` and `r`.`channel` = 'web' and `r`.`received_at` > current_timestamp(3) - interval 7 day) AS `requests_7d` from `account` `a` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_account_permission`
--

/*!50001 DROP VIEW IF EXISTS `v_account_permission`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_uca1400_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY DEFINER */
/*!50001 VIEW `v_account_permission` AS select `a`.`account_id` AS `account_id`,`a`.`login_id` AS `login_id`,`ar`.`role_code` AS `role_code`,`rp`.`uc_code` AS `uc_code` from ((`account` `a` join `account_role` `ar` on(`ar`.`account_id` = `a`.`account_id`)) join `role_permission` `rp` on(`rp`.`role_code` = `ar`.`role_code`)) where `a`.`disabled_at` is null */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_active_operator_count`
--

/*!50001 DROP VIEW IF EXISTS `v_active_operator_count`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_uca1400_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY DEFINER */
/*!50001 VIEW `v_active_operator_count` AS select count(0) AS `n` from (`account` `a` join `account_role` `ar` on(`ar`.`account_id` = `a`.`account_id` and `ar`.`role_code` = 'operator')) where `a`.`disabled_at` is null */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_active_processing`
--

/*!50001 DROP VIEW IF EXISTS `v_active_processing`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_uca1400_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY DEFINER */
/*!50001 VIEW `v_active_processing` AS select (select count(0) from `score_request` `r` where `r`.`status` = 'converting') AS `recognize_active`,(select count(0) from `score_request` `r` where `r`.`status` = 'rendering') + (select count(0) from `derived_file` `d` where `d`.`render_status` = 'rendering') AS `render_active`,(select count(0) from `score_request` `r` where `r`.`status` in ('converting','rendering')) + (select count(0) from `derived_file` `d` where `d`.`render_status` = 'rendering') AS `active_count` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_application_retention`
--

/*!50001 DROP VIEW IF EXISTS `v_application_retention`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_uca1400_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY DEFINER */
/*!50001 VIEW `v_application_retention` AS select `a`.`key_id` AS `key_id`,`a`.`applied_at` AS `applied_at`,`a`.`applied_at` + interval '7' day AS `delete_due_at`,case when `a`.`retained_at` is not null then 1 else 0 end AS `is_retained`,case when `a`.`retained_at` is null and current_timestamp(3) >= `a`.`applied_at` + interval '7' day then 1 else 0 end AS `is_purge_due` from `key_application` `a` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_apply_rate_window`
--

/*!50001 DROP VIEW IF EXISTS `v_apply_rate_window`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_uca1400_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY DEFINER */
/*!50001 VIEW `v_apply_rate_window` AS select `x`.`rate_key` AS `rate_key`,count(0) AS `recent_count`,`s`.`apply_rate_limit_count` AS `limit_count`,min(`x`.`applied_at`) + interval `s`.`apply_rate_window_minutes` minute AS `next_allowed_at`,case when count(0) >= `s`.`apply_rate_limit_count` then 1 else 0 end AS `is_blocked` from ((select concat('email:',`a`.`contact_email`) AS `rate_key`,`a`.`applied_at` AS `applied_at` from `key_application` `a` union all select concat('addr:',`a`.`client_addr_hash`) AS `rate_key`,`a`.`applied_at` AS `applied_at` from `key_application` `a`) `x` join `v_current_setting` `s`) where `s`.`apply_rate_limit_count` is not null and `s`.`apply_rate_window_minutes` is not null and `x`.`applied_at` > current_timestamp(3) - interval `s`.`apply_rate_window_minutes` minute group by `x`.`rate_key`,`s`.`apply_rate_limit_count`,`s`.`apply_rate_window_minutes` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_change_history_all`
--

/*!50001 DROP VIEW IF EXISTS `v_change_history_all`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_uca1400_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY DEFINER */
/*!50001 VIEW `v_change_history_all` AS select 'setting' AS `target_type`,cast(`v_setting_change_history`.`setting_version_id` as char charset utf8mb4) AS `target_ref`,`v_setting_change_history`.`operator_id` AS `operator_id`,`v_setting_change_history`.`changed_at` AS `changed_at`,`v_setting_change_history`.`field_name` AS `field_name`,`v_setting_change_history`.`before_value` AS `before_value`,`v_setting_change_history`.`after_value` AS `after_value` from `v_setting_change_history` union all select `change_history`.`target_type` AS `target_type`,`change_history`.`target_ref` AS `target_ref`,`change_history`.`operator_id` AS `operator_id`,`change_history`.`changed_at` AS `changed_at`,`change_history`.`field_name` AS `field_name`,`change_history`.`before_value` AS `before_value`,`change_history`.`after_value` AS `after_value` from `change_history` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_current_derived_file`
--

/*!50001 DROP VIEW IF EXISTS `v_current_derived_file`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_uca1400_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY DEFINER */
/*!50001 VIEW `v_current_derived_file` AS select `d`.`file_id` AS `file_id`,`d`.`request_id` AS `request_id`,`d`.`format` AS `format`,`d`.`basis` AS `basis`,`d`.`edit_id` AS `edit_id`,`d`.`ensemble_id` AS `ensemble_id`,`d`.`render_status` AS `render_status`,`d`.`renderer_name` AS `renderer_name`,`d`.`renderer_version` AS `renderer_version`,`d`.`requested_at` AS `requested_at`,`d`.`render_started_at` AS `render_started_at`,`d`.`render_finished_at` AS `render_finished_at`,`d`.`failure_reason` AS `failure_reason`,`d`.`storage_uri` AS `storage_uri`,`d`.`deleted_at` AS `deleted_at`,`d`.`render_ms` AS `render_ms` from `derived_file` `d` where `d`.`file_id` = (select max(`d2`.`file_id`) from `derived_file` `d2` where `d2`.`request_id` = `d`.`request_id` and `d2`.`format` = `d`.`format` and `d2`.`basis` = `d`.`basis`) */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_current_result`
--

/*!50001 DROP VIEW IF EXISTS `v_current_result`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_uca1400_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY DEFINER */
/*!50001 VIEW `v_current_result` AS select `sr`.`result_id` AS `result_id`,`sr`.`request_id` AS `request_id`,`sr`.`origin` AS `origin`,`sr`.`musicxml_uri` AS `musicxml_uri`,`sr`.`midi_uri` AS `midi_uri`,`sr`.`fallback_template_id` AS `fallback_template_id`,`sr`.`original_ensemble_id` AS `original_ensemble_id`,`sr`.`created_at` AS `created_at`,`sr`.`deleted_at` AS `deleted_at` from (`score_result` `sr` join `score_request` `r` on(`r`.`request_id` = `sr`.`request_id`)) where `sr`.`origin` = case `r`.`route` when 'recognize' then 'recognized' when 'direct' then 'direct' else 'fallback' end */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_current_selection`
--

/*!50001 DROP VIEW IF EXISTS `v_current_selection`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_uca1400_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY DEFINER */
/*!50001 VIEW `v_current_selection` AS select `s`.`request_id` AS `request_id`,`s`.`ensemble_id` AS `ensemble_id`,`s`.`source` AS `source`,`s`.`selected_at` AS `selected_at` from `instrument_selection` `s` where `s`.`selection_id` = (select max(`s2`.`selection_id`) from `instrument_selection` `s2` where `s2`.`request_id` = `s`.`request_id`) */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_current_setting`
--

/*!50001 DROP VIEW IF EXISTS `v_current_setting`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_uca1400_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY DEFINER */
/*!50001 VIEW `v_current_setting` AS select `s`.`setting_version_id` AS `setting_version_id`,`s`.`created_at` AS `created_at`,`s`.`created_by` AS `created_by`,`s`.`timeout_seconds` AS `timeout_seconds`,`s`.`max_concurrency` AS `max_concurrency`,`s`.`fallback_enabled` AS `fallback_enabled`,`s`.`default_call_limit_per_hour` AS `default_call_limit_per_hour`,`s`.`apply_rate_limit_count` AS `apply_rate_limit_count`,`s`.`apply_rate_window_minutes` AS `apply_rate_window_minutes`,`s`.`structure_threshold` AS `structure_threshold`,`s`.`grade_caution_boundary` AS `grade_caution_boundary`,`s`.`grade_distrust_boundary` AS `grade_distrust_boundary`,`s`.`api_apply_status` AS `api_apply_status`,`s`.`api_applied_at` AS `api_applied_at`,`s`.`web_max_active_per_client` AS `web_max_active_per_client`,`s`.`web_hourly_request_cap` AS `web_hourly_request_cap`,`s`.`max_concurrency_recognize` AS `max_concurrency_recognize`,`s`.`max_concurrency_render` AS `max_concurrency_render`,`s`.`web_concurrency_share` AS `web_concurrency_share`,`s`.`score_file_max_bytes` AS `score_file_max_bytes`,`s`.`recommend_timeout_ms` AS `recommend_timeout_ms`,`s`.`login_max_failures` AS `login_max_failures`,`s`.`login_lock_minutes` AS `login_lock_minutes`,`s`.`llm_recommend_timeout_ms` AS `llm_recommend_timeout_ms` from `processing_setting_version` `s` where `s`.`setting_version_id` = (select max(`processing_setting_version`.`setting_version_id`) from `processing_setting_version`) */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_edit_record`
--

/*!50001 DROP VIEW IF EXISTS `v_edit_record`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_uca1400_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY DEFINER */
/*!50001 VIEW `v_edit_record` AS select `r`.`request_id` AS `request_id`,case when `es`.`edit_id` is null then 0 else 1 end AS `edited`,`es`.`transpose_semitones` AS `transpose_semitones`,(select count(0) from `edited_track` `t` where `t`.`edit_id` = `es`.`edit_id`) AS `track_count`,(select count(0) from `edited_track` `t` where `t`.`edit_id` = `es`.`edit_id` and `t`.`soundfont_id` is not null) AS `soundfont_tracks`,max(case when `d`.`format` = 'mp3' then 1 else 0 end) AS `downloaded_mp3_after_edit`,max(case when `d`.`format` = 'pdf' then 1 else 0 end) AS `downloaded_pdf_after_edit`,max(case when `d`.`format` = 'midi' then 1 else 0 end) AS `downloaded_midi_after_edit`,max(case when `d`.`format` = 'musicxml' then 1 else 0 end) AS `downloaded_musicxml_after_edit` from ((`score_request` `r` left join `edited_score` `es` on(`es`.`request_id` = `r`.`request_id`)) left join (select `de`.`request_id` AS `request_id`,`de`.`format` AS `format` from (`download_event` `de` join `derived_file` `f` on(`f`.`file_id` = `de`.`file_id`)) where `f`.`basis` = 'edited') `d` on(`d`.`request_id` = `r`.`request_id`)) group by `r`.`request_id`,`es`.`edit_id`,`es`.`transpose_semitones` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_endpoint_menu`
--

/*!50001 DROP VIEW IF EXISTS `v_endpoint_menu`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_uca1400_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY DEFINER */
/*!50001 VIEW `v_endpoint_menu` AS select `e`.`snapshot_id` AS `snapshot_id`,`e`.`http_method` AS `http_method`,`e`.`path` AS `path`,`e`.`feature_name` AS `feature_name`,`e`.`input_format` AS `input_format`,`e`.`response_format` AS `response_format`,`e`.`example_text` AS `example_text`,`e`.`engine_name` AS `engine_name` from `api_endpoint` `e` where `e`.`snapshot_id` = (select max(`o`.`snapshot_id`) from `api_spec_snapshot` `o` where `o`.`health_status` = 'ok') */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_eval_metrics`
--

/*!50001 DROP VIEW IF EXISTS `v_eval_metrics`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_uca1400_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY DEFINER */
/*!50001 VIEW `v_eval_metrics` AS select (select case when count(0) = 0 then NULL else sum(case when `r`.`route` = 'recognize' then 1 else 0 end) / count(0) end from ((`eval_run_result` `x` join `eval_item` `i` on(`i`.`item_id` = `x`.`item_id`)) join `score_request` `r` on(`r`.`request_id` = `x`.`request_id`)) where `i`.`set_kind` = 'real' and `i`.`sheet_kind` = 'jeongganbo') AS `jeongganbo_normal_rate`,(select count(0) from ((`eval_run_result` `x` join `eval_item` `i` on(`i`.`item_id` = `x`.`item_id`)) join `processing_job` `j` on(`j`.`request_id` = `x`.`request_id`)) where `i`.`set_kind` = 'fake' and `j`.`validity_grade` = 'trust') AS `fake_passed_as_trust`,(select case when count(0) = 0 then NULL else sum(case when `r`.`fallback_reason` = 'no_structure' then 1 else 0 end) / count(0) end from ((`eval_run_result` `x` join `eval_item` `i` on(`i`.`item_id` = `x`.`item_id`)) join `score_request` `r` on(`r`.`request_id` = `x`.`request_id`)) where `i`.`set_kind` = 'fake') AS `fake_structure_filter_rate`,(select case when count(0) = 0 then NULL else sum(case when `r`.`fallback_reason` in ('no_structure','distrust') then 1 else 0 end) / count(0) end from ((`eval_run_result` `x` join `eval_item` `i` on(`i`.`item_id` = `x`.`item_id`)) join `score_request` `r` on(`r`.`request_id` = `x`.`request_id`)) where `i`.`set_kind` = 'real') AS `real_false_block_rate` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_fallback_by_reason`
--

/*!50001 DROP VIEW IF EXISTS `v_fallback_by_reason`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_uca1400_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY DEFINER */
/*!50001 VIEW `v_fallback_by_reason` AS select `r`.`channel` AS `channel`,`r`.`fallback_reason` AS `fallback_reason`,count(0) AS `cnt` from `score_request` `r` where `r`.`route` = 'fallback' group by `r`.`channel`,`r`.`fallback_reason` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_identity_purge_due`
--

/*!50001 DROP VIEW IF EXISTS `v_identity_purge_due`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_uca1400_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY DEFINER */
/*!50001 VIEW `v_identity_purge_due` AS select `r`.`request_id` AS `request_id`,`r`.`request_no` AS `request_no` from `score_request` `r` where `r`.`channel` = 'web' and `r`.`identity_purged_at` is null and current_timestamp(3) >= `r`.`received_at` + interval 24 hour */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_instrument_menu`
--

/*!50001 DROP VIEW IF EXISTS `v_instrument_menu`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_uca1400_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY DEFINER */
/*!50001 VIEW `v_instrument_menu` AS select `i`.`instrument_id` AS `instrument_id`,`i`.`code` AS `code`,`i`.`name` AS `name`,`i`.`family` AS `family`,`i`.`midi_program` AS `midi_program`,`i`.`is_percussion` AS `is_percussion`,`i`.`soundfont_file` AS `soundfont_file`,`i`.`range_low` AS `range_low`,`i`.`range_high` AS `range_high`,case `i`.`family` when 'gugak' then 1 else 2 end AS `menu_group`,`i`.`menu_order` AS `menu_order` from `instrument` `i` where `i`.`is_active` = 1 */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_job_engine`
--

/*!50001 DROP VIEW IF EXISTS `v_job_engine`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_uca1400_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY DEFINER */
/*!50001 VIEW `v_job_engine` AS select `a`.`request_id` AS `request_id`,`a`.`engine_name` AS `engine_name`,`a`.`engine_version` AS `engine_version` from `engine_attempt` `a` where `a`.`outcome` = 'success' and `a`.`page_no` = (select min(`b`.`page_no`) from `engine_attempt` `b` where `b`.`request_id` = `a`.`request_id` and `b`.`outcome` = 'success') */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_key_admin_list`
--

/*!50001 DROP VIEW IF EXISTS `v_key_admin_list`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_uca1400_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY DEFINER */
/*!50001 VIEW `v_key_admin_list` AS select `k`.`key_id` AS `key_id`,`k`.`key_kind` AS `key_kind`,`k`.`key_prefix` AS `key_prefix`,`k`.`call_limit_per_hour` AS `call_limit_per_hour`,`k`.`issued_at` AS `issued_at`,`k`.`status` AS `status`,`k`.`application_no` AS `application_no`,case when `k`.`key_kind` = 'external' and `a`.`key_id` is null then 1 else 0 end AS `application_purged` from (`access_key` `k` left join `key_application` `a` on(`a`.`key_id` = `k`.`key_id`)) */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_key_application_masked`
--

/*!50001 DROP VIEW IF EXISTS `v_key_application_masked`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_uca1400_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY DEFINER */
/*!50001 VIEW `v_key_application_masked` AS select `k`.`application_no` AS `application_no`,concat(substr(`a`.`applicant_name`,1,1),'**') AS `applicant_name_masked`,`a`.`affiliation` AS `affiliation`,concat(substr(`a`.`contact_email`,1,1),'***@',substr(`a`.`contact_email`,locate('@',`a`.`contact_email`) + 1)) AS `contact_email_masked`,`a`.`purpose` AS `purpose`,`a`.`applied_at` AS `applied_at`,`v`.`delete_due_at` AS `delete_due_at`,`v`.`is_retained` AS `is_retained`,`k`.`key_prefix` AS `key_prefix`,`k`.`status` AS `key_status` from ((`key_application` `a` join `access_key` `k` on(`k`.`key_id` = `a`.`key_id`)) join `v_application_retention` `v` on(`v`.`key_id` = `a`.`key_id`)) */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_key_quota`
--

/*!50001 DROP VIEW IF EXISTS `v_key_quota`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_uca1400_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY DEFINER */
/*!50001 VIEW `v_key_quota` AS select `q`.`key_id` AS `key_id`,`q`.`call_limit_per_hour` AS `call_limit_per_hour`,`q`.`calls_last_hour` AS `calls_last_hour`,`q`.`call_limit_per_hour` - `q`.`calls_last_hour` AS `remaining_this_hour`,case when `q`.`call_limit_per_hour` is not null and `q`.`calls_last_hour` >= `q`.`call_limit_per_hour` then 1 else 0 end AS `is_exhausted`,`q`.`oldest_call_at` + interval 1 hour AS `retry_after_at` from (select `k`.`key_id` AS `key_id`,`k`.`call_limit_per_hour` AS `call_limit_per_hour`,(select count(0) from `api_call_log` `c` where `c`.`access_key_id` = `k`.`key_id` and `c`.`outcome` = 'accepted' and `c`.`endpoint` like 'POST %' and `c`.`called_at` > current_timestamp(3) - interval 1 hour) AS `calls_last_hour`,(select min(`c`.`called_at`) from `api_call_log` `c` where `c`.`access_key_id` = `k`.`key_id` and `c`.`outcome` = 'accepted' and `c`.`endpoint` like 'POST %' and `c`.`called_at` > current_timestamp(3) - interval 1 hour) AS `oldest_call_at` from `access_key` `k`) `q` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_key_validity`
--

/*!50001 DROP VIEW IF EXISTS `v_key_validity`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_uca1400_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY DEFINER */
/*!50001 VIEW `v_key_validity` AS select `k`.`key_id` AS `key_id`,`k`.`key_hash` AS `key_hash`,`k`.`key_kind` AS `key_kind`,case when `k`.`status` = 'active' then 1 else 0 end AS `is_valid` from `access_key` `k` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_metric_by_channel`
--

/*!50001 DROP VIEW IF EXISTS `v_metric_by_channel`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_uca1400_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY DEFINER */
/*!50001 VIEW `v_metric_by_channel` AS select `m`.`scope` AS `scope`,sum(`m`.`is_image`) AS `image_requests`,sum(`m`.`is_first_pass`) AS `first_pass_trust`,case when sum(`m`.`is_image`) = 0 then NULL else sum(`m`.`is_first_pass`) / sum(`m`.`is_image`) end AS `first_pass_rate`,sum(`m`.`is_caution`) AS `caution_count`,case when sum(`m`.`is_image`) = 0 then NULL else sum(`m`.`is_fallback`) / sum(`m`.`is_image`) end AS `fallback_rate`,case when sum(`m`.`has_result`) = 0 then NULL else sum(`m`.`is_edited`) / sum(`m`.`has_result`) end AS `edit_usage_rate`,max(`m`.`wait_ms`) AS `max_wait_ms`,sum(`m`.`is_down`) AS `service_down_count` from (select `sc`.`scope` AS `scope`,`x`.`channel` AS `channel`,`x`.`is_image` AS `is_image`,`x`.`is_first_pass` AS `is_first_pass`,`x`.`is_caution` AS `is_caution`,`x`.`is_fallback` AS `is_fallback`,`x`.`has_result` AS `has_result`,`x`.`is_edited` AS `is_edited`,`x`.`wait_ms` AS `wait_ms`,`x`.`is_down` AS `is_down` from ((select 'all' AS `scope` union all select 'web' AS `web` union all select 'api' AS `api`) `sc` join (select `r`.`channel` AS `channel`,case when `r`.`file_kind` in ('image','pdf') then 1 else 0 end AS `is_image`,case when `r`.`file_kind` in ('image','pdf') and `r`.`route` = 'recognize' and `j`.`validity_grade` = 'trust' and `r`.`status` = 'completed' and (`r`.`channel` = 'api' or `r`.`first_played_at` is not null) then 1 else 0 end AS `is_first_pass`,case when `r`.`route` = 'recognize' and `j`.`validity_grade` = 'caution' then 1 else 0 end AS `is_caution`,case when `r`.`file_kind` in ('image','pdf') and `r`.`route` = 'fallback' then 1 else 0 end AS `is_fallback`,case when `r`.`status` = 'completed' then 1 else 0 end AS `has_result`,case when exists(select 1 from `edited_score` `es` where `es`.`request_id` = `r`.`request_id` limit 1) then 1 else 0 end AS `is_edited`,case when `r`.`channel` = 'web' then timestampdiff(MICROSECOND,`r`.`received_at`,`r`.`first_played_at`) DIV 1000 else timestampdiff(MICROSECOND,`r`.`received_at`,`r`.`completed_at`) DIV 1000 end AS `wait_ms`,case when `r`.`status` = 'service_down' then 1 else 0 end AS `is_down` from (`score_request` `r` left join `processing_job` `j` on(`j`.`request_id` = `r`.`request_id`))) `x` on(`sc`.`scope` = 'all' or `sc`.`scope` = `x`.`channel`))) `m` group by `m`.`scope` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_missing_log`
--

/*!50001 DROP VIEW IF EXISTS `v_missing_log`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_uca1400_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY DEFINER */
/*!50001 VIEW `v_missing_log` AS select `r`.`request_id` AS `request_id`,`r`.`request_no` AS `request_no`,`r`.`channel` AS `channel`,case when !exists(select 1 from `stage_timing` `t` where `t`.`request_id` = `r`.`request_id` and `t`.`stage_code` = 'check' limit 1) then 1 else 0 end AS `missing_stage_timing`,case when `r`.`route` = 'recognize' and !exists(select 1 from `v_job_engine` `e` where `e`.`request_id` = `r`.`request_id` limit 1) then 1 else 0 end AS `missing_engine_version`,case when `r`.`route` = 'recognize' and !exists(select 1 from `processing_job` `j` where `j`.`request_id` = `r`.`request_id` and `j`.`validity_grade` is not null limit 1) then 1 else 0 end AS `missing_grade` from `score_request` `r` where `r`.`status` = 'completed' and (!exists(select 1 from `stage_timing` `t` where `t`.`request_id` = `r`.`request_id` and `t`.`stage_code` = 'check' limit 1) or `r`.`route` = 'recognize' and !exists(select 1 from `v_job_engine` `e` where `e`.`request_id` = `r`.`request_id` limit 1) or `r`.`route` = 'recognize' and !exists(select 1 from `processing_job` `j` where `j`.`request_id` = `r`.`request_id` and `j`.`validity_grade` is not null limit 1)) */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_model_load_estimate`
--

/*!50001 DROP VIEW IF EXISTS `v_model_load_estimate`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_uca1400_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY DEFINER */
/*!50001 VIEW `v_model_load_estimate` AS with ok_ranked as (select `e`.`model_name` AS `model_name`,`e`.`duration_ms` AS `duration_ms`,`e`.`finished_at` AS `finished_at`,row_number() over ( partition by `e`.`model_name` order by `e`.`load_id` desc) AS `rn` from `model_load_event` `e` where `e`.`outcome` = 'ok'), last_any as (select `e`.`model_name` AS `model_name`,`e`.`outcome` AS `outcome`,`e`.`error_text` AS `error_text`,row_number() over ( partition by `e`.`model_name` order by `e`.`load_id` desc) AS `rn` from `model_load_event` `e`)select `m`.`model_name` AS `model_name`,avg(`r`.`duration_ms`) AS `avg_load_ms`,max(`r`.`duration_ms`) AS `max_load_ms`,max(`r`.`finished_at`) AS `last_ok_at`,max(`l`.`outcome`) AS `last_outcome`,max(`l`.`error_text`) AS `last_error` from ((`model_registry` `m` left join `ok_ranked` `r` on(`r`.`model_name` = `m`.`model_name` and `r`.`rn` <= 5)) left join `last_any` `l` on(`l`.`model_name` = `m`.`model_name` and `l`.`rn` = 1)) group by `m`.`model_name` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_mp3_license`
--

/*!50001 DROP VIEW IF EXISTS `v_mp3_license`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_uca1400_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY DEFINER */
/*!50001 VIEW `v_mp3_license` AS select `p`.`confirmed` AS `license_confirmed`,case when `p`.`confirmed` then 0 else 1 end AS `web_mp3_internal_only`,case when `p`.`confirmed` then 1 else 0 end AS `api_mp3_allowed` from `license_policy` `p` where `p`.`policy_code` = 'sound_and_renderer' */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_operator_masked`
--

/*!50001 DROP VIEW IF EXISTS `v_operator_masked`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_uca1400_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY DEFINER */
/*!50001 VIEW `v_operator_masked` AS select `o`.`operator_id` AS `operator_id`,concat(substr(`o`.`login_id`,1,3),'**') AS `login_id_masked`,`o`.`disabled_at` AS `disabled_at` from `operator_account` `o` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_purge_due_requests`
--

/*!50001 DROP VIEW IF EXISTS `v_purge_due_requests`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_uca1400_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY DEFINER */
/*!50001 VIEW `v_purge_due_requests` AS select `v`.`request_id` AS `request_id`,`v`.`request_no` AS `request_no`,`v`.`expires_at` AS `expires_at` from (`v_request_retention` `v` join `score_request` `r` on(`r`.`request_id` = `v`.`request_id`)) where `r`.`purged_at` is null and current_timestamp(3) >= `v`.`expires_at` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_purge_due_soundfonts`
--

/*!50001 DROP VIEW IF EXISTS `v_purge_due_soundfonts`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_uca1400_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY DEFINER */
/*!50001 VIEW `v_purge_due_soundfonts` AS select `f`.`soundfont_id` AS `soundfont_id`,`f`.`session_id` AS `session_id`,case when `f`.`file_deleted_at` is null then 1 else 0 end AS `file_pending`,case when `f`.`api_copy_sent_at` is not null and `f`.`api_copy_deleted_at` is null then 1 else 0 end AS `api_copy_pending` from (`user_soundfont` `f` join `v_session_state` `s` on(`s`.`session_id` = `f`.`session_id`)) where `s`.`is_ended` = 1 and (`f`.`file_deleted_at` is null or `f`.`api_copy_sent_at` is not null and `f`.`api_copy_deleted_at` is null) */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_render_queue_position`
--

/*!50001 DROP VIEW IF EXISTS `v_render_queue_position`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_uca1400_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY DEFINER */
/*!50001 VIEW `v_render_queue_position` AS select `d`.`file_id` AS `file_id`,`d`.`request_id` AS `request_id`,`d`.`format` AS `format`,(select count(0) from `derived_file` `q` where `q`.`render_status` = 'queued' and `q`.`requested_at` <= `d`.`requested_at`) AS `queue_position` from `derived_file` `d` where `d`.`render_status` = 'queued' */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_request_log`
--

/*!50001 DROP VIEW IF EXISTS `v_request_log`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_uca1400_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY DEFINER */
/*!50001 VIEW `v_request_log` AS select `r`.`request_id` AS `request_id`,`r`.`request_no` AS `request_no`,`r`.`channel` AS `channel`,`r`.`route` AS `route`,`r`.`status` AS `status`,`r`.`fallback_reason` AS `fallback_reason`,`r`.`file_kind` AS `file_kind`,`r`.`chosen_score_type` AS `chosen_score_type`,`j`.`confirmed_score_type` AS `confirmed_score_type`,`j`.`structure_verdict` AS `structure_verdict`,`j`.`type_mismatch` AS `type_mismatch`,`j`.`type_answer` AS `type_answer`,`j`.`validity_grade` AS `validity_grade`,`e`.`engine_name` AS `engine_name`,`e`.`engine_version` AS `engine_version`,(select `t`.`duration_ms` from `stage_timing` `t` where `t`.`request_id` = `r`.`request_id` and `t`.`stage_code` = 'check') AS `check_ms`,(select `t`.`duration_ms` from `stage_timing` `t` where `t`.`request_id` = `r`.`request_id` and `t`.`stage_code` = 'queue') AS `queue_ms`,(select sum(`t`.`duration_ms`) from `stage_timing` `t` where `t`.`request_id` = `r`.`request_id` and `t`.`stage_code` = 'structure') AS `structure_ms`,(select sum(`a`.`duration_ms`) from `engine_attempt` `a` where `a`.`request_id` = `r`.`request_id`) AS `recognize_ms`,(select sum(`t`.`duration_ms`) from `stage_timing` `t` where `t`.`request_id` = `r`.`request_id` and `t`.`stage_code` = 'jg_convert') AS `jg_convert_ms`,(select sum(`t`.`duration_ms`) from `stage_timing` `t` where `t`.`request_id` = `r`.`request_id` and `t`.`stage_code` = 'validity') AS `validity_ms`,(select max(`c`.`duration_ms`) from `recommendation` `c` where `c`.`request_id` = `r`.`request_id`) AS `recommend_ms`,(select max(`d`.`render_ms`) from `derived_file` `d` where `d`.`request_id` = `r`.`request_id`) AS `render_ms`,`r`.`received_at` AS `received_at`,`r`.`completed_at` AS `completed_at` from ((`score_request` `r` left join `processing_job` `j` on(`j`.`request_id` = `r`.`request_id`)) left join `v_job_engine` `e` on(`e`.`request_id` = `r`.`request_id`)) */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_request_queue_position`
--

/*!50001 DROP VIEW IF EXISTS `v_request_queue_position`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_uca1400_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY DEFINER */
/*!50001 VIEW `v_request_queue_position` AS select `r`.`request_id` AS `request_id`,(select count(0) from `score_request` `q` where `q`.`status` = 'queued' and `q`.`received_at` <= `r`.`received_at`) AS `queue_position` from `score_request` `r` where `r`.`status` = 'queued' */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_request_retention`
--

/*!50001 DROP VIEW IF EXISTS `v_request_retention`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_uca1400_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY DEFINER */
/*!50001 VIEW `v_request_retention` AS select `r`.`request_id` AS `request_id`,`r`.`request_no` AS `request_no`,`r`.`received_at` AS `received_at`,`r`.`received_at` + interval '24' hour AS `expires_at`,greatest(0,timestampdiff(SECOND,current_timestamp(3),`r`.`received_at` + interval '24' hour)) AS `remaining_seconds`,case when `r`.`purged_at` is not null or current_timestamp(3) >= `r`.`received_at` + interval '24' hour then 1 else 0 end AS `is_expired` from `score_request` `r` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_request_stage_label`
--

/*!50001 DROP VIEW IF EXISTS `v_request_stage_label`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_uca1400_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY DEFINER */
/*!50001 VIEW `v_request_stage_label` AS select `r`.`request_id` AS `request_id`,`r`.`channel` AS `channel`,case when `r`.`status` = 'received' then '접수' when `r`.`status` = 'queued' then '대기' when `r`.`status` = 'converting' then '변환 중' when `r`.`status` = 'awaiting_type_answer' then '종류 확인' when `r`.`status` = 'rendering' then '연주 생성' when `r`.`status` = 'service_down' then '서비스 중단' when `r`.`route` = 'fallback' then case when `r`.`channel` = 'api' then '대체 완료' else '대체' end else '완료' end AS `stage_label`,case when `r`.`status` <> 'completed' then NULL when `r`.`route` = 'fallback' then '대체 결과로 완료' when `r`.`route` = 'direct' then '직행 결과로 완료' else '완료' end AS `completion_label`,case when `r`.`status` <> 'completed' then NULL when `r`.`route` = 'fallback' then 'fallback' when `r`.`route` = 'direct' then 'direct' when `j`.`validity_grade` = 'caution' then 'caution' else 'trust' end AS `result_band` from (`score_request` `r` left join `processing_job` `j` on(`j`.`request_id` = `r`.`request_id`)) */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_server_status`
--

/*!50001 DROP VIEW IF EXISTS `v_server_status`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_uca1400_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY DEFINER */
/*!50001 VIEW `v_server_status` AS select `p`.`snapshot_id` AS `snapshot_id`,`p`.`checked_at` AS `checked_at`,`p`.`health_status` AS `health_status`,`p`.`api_version` AS `api_version`,`p`.`mismatch_with_menu` AS `mismatch_with_menu`,(select max(`o`.`snapshot_id`) from `api_spec_snapshot` `o` where `o`.`health_status` = 'ok') AS `last_ok_snapshot_id` from `api_spec_snapshot` `p` where `p`.`snapshot_id` = (select max(`api_spec_snapshot`.`snapshot_id`) from `api_spec_snapshot`) */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_session_soundfont_count`
--

/*!50001 DROP VIEW IF EXISTS `v_session_soundfont_count`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_uca1400_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY DEFINER */
/*!50001 VIEW `v_session_soundfont_count` AS select `s`.`session_id` AS `session_id`,(select count(0) from `user_soundfont` `f` where `f`.`session_id` = `s`.`session_id` and `f`.`file_deleted_at` is null) AS `active_count`,case when (select count(0) from `user_soundfont` `f` where `f`.`session_id` = `s`.`session_id` and `f`.`file_deleted_at` is null) >= 3 then 0 else 1 end AS `can_upload` from `anon_session` `s` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_session_state`
--

/*!50001 DROP VIEW IF EXISTS `v_session_state`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_uca1400_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY DEFINER */
/*!50001 VIEW `v_session_state` AS select `s`.`session_id` AS `session_id`,`s`.`started_at` AS `started_at`,`s`.`last_active_at` AS `last_active_at`,`s`.`ended_at` AS `ended_at`,case when `s`.`ended_at` is not null then `s`.`end_reason` when `s`.`last_active_at` <= current_timestamp(3) - interval 2 hour then 'idle' else NULL end AS `end_reason`,case when `s`.`ended_at` is not null or `s`.`last_active_at` <= current_timestamp(3) - interval 2 hour then 1 else 0 end AS `is_ended` from `anon_session` `s` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_setting_change_history`
--

/*!50001 DROP VIEW IF EXISTS `v_setting_change_history`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_uca1400_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY DEFINER */
/*!50001 VIEW `v_setting_change_history` AS with v as (select `s`.`setting_version_id` AS `setting_version_id`,`s`.`created_at` AS `created_at`,`s`.`created_by` AS `created_by`,`s`.`timeout_seconds` AS `timeout_seconds`,`s`.`max_concurrency` AS `max_concurrency`,`s`.`fallback_enabled` AS `fallback_enabled`,`s`.`default_call_limit_per_hour` AS `default_call_limit_per_hour`,`s`.`apply_rate_limit_count` AS `apply_rate_limit_count`,`s`.`apply_rate_window_minutes` AS `apply_rate_window_minutes`,`s`.`structure_threshold` AS `structure_threshold`,`s`.`grade_caution_boundary` AS `grade_caution_boundary`,`s`.`grade_distrust_boundary` AS `grade_distrust_boundary`,`s`.`api_apply_status` AS `api_apply_status`,`s`.`api_applied_at` AS `api_applied_at`,`s`.`web_max_active_per_client` AS `web_max_active_per_client`,`s`.`web_hourly_request_cap` AS `web_hourly_request_cap`,`s`.`max_concurrency_recognize` AS `max_concurrency_recognize`,`s`.`max_concurrency_render` AS `max_concurrency_render`,`s`.`web_concurrency_share` AS `web_concurrency_share`,`s`.`score_file_max_bytes` AS `score_file_max_bytes`,`s`.`recommend_timeout_ms` AS `recommend_timeout_ms`,`s`.`login_max_failures` AS `login_max_failures`,`s`.`login_lock_minutes` AS `login_lock_minutes`,`s`.`llm_recommend_timeout_ms` AS `llm_recommend_timeout_ms`,(select group_concat(`o`.`engine_name` order by `o`.`seq` ASC separator '>') from `setting_engine_order` `o` where `o`.`setting_version_id` = `s`.`setting_version_id` and `o`.`score_type` = 'staff') AS `staff_order`,(select group_concat(`o`.`engine_name` order by `o`.`seq` ASC separator '>') from `setting_engine_order` `o` where `o`.`setting_version_id` = `s`.`setting_version_id` and `o`.`score_type` = 'jeongganbo') AS `jeongganbo_order`,(select group_concat(`o`.`engine_name` order by `o`.`seq` ASC separator '>') from `setting_engine_order` `o` where `o`.`setting_version_id` = `s`.`setting_version_id` and `o`.`score_type` = 'recommend') AS `recommend_order`,lag(`s`.`setting_version_id`,1) over ( order by `s`.`setting_version_id`) AS `prev_id` from `processing_setting_version` `s`), pair as (select `cur`.`setting_version_id` AS `setting_version_id`,`cur`.`created_by` AS `created_by`,`cur`.`created_at` AS `created_at`,`cur`.`staff_order` AS `c_staff`,`prv`.`staff_order` AS `p_staff`,`cur`.`jeongganbo_order` AS `c_jg`,`prv`.`jeongganbo_order` AS `p_jg`,`cur`.`recommend_order` AS `c_ro`,`prv`.`recommend_order` AS `p_ro`,`cur`.`timeout_seconds` AS `c_timeout`,`prv`.`timeout_seconds` AS `p_timeout`,`cur`.`max_concurrency_recognize` AS `c_cr`,`prv`.`max_concurrency_recognize` AS `p_cr`,`cur`.`max_concurrency_render` AS `c_cd`,`prv`.`max_concurrency_render` AS `p_cd`,`cur`.`web_concurrency_share` AS `c_ws`,`prv`.`web_concurrency_share` AS `p_ws`,`cur`.`fallback_enabled` AS `c_fb`,`prv`.`fallback_enabled` AS `p_fb`,`cur`.`default_call_limit_per_hour` AS `c_lim`,`prv`.`default_call_limit_per_hour` AS `p_lim`,`cur`.`apply_rate_limit_count` AS `c_rc`,`prv`.`apply_rate_limit_count` AS `p_rc`,`cur`.`apply_rate_window_minutes` AS `c_rw`,`prv`.`apply_rate_window_minutes` AS `p_rw`,`cur`.`structure_threshold` AS `c_st`,`prv`.`structure_threshold` AS `p_st`,`cur`.`grade_caution_boundary` AS `c_gc`,`prv`.`grade_caution_boundary` AS `p_gc`,`cur`.`grade_distrust_boundary` AS `c_gd`,`prv`.`grade_distrust_boundary` AS `p_gd`,`cur`.`web_max_active_per_client` AS `c_wa`,`prv`.`web_max_active_per_client` AS `p_wa`,`cur`.`web_hourly_request_cap` AS `c_wh`,`prv`.`web_hourly_request_cap` AS `p_wh`,`cur`.`score_file_max_bytes` AS `c_fm`,`prv`.`score_file_max_bytes` AS `p_fm`,`cur`.`recommend_timeout_ms` AS `c_rt`,`prv`.`recommend_timeout_ms` AS `p_rt`,`cur`.`llm_recommend_timeout_ms` AS `c_lt`,`prv`.`llm_recommend_timeout_ms` AS `p_lt` from (`v` `cur` left join `v` `prv` on(`prv`.`setting_version_id` = `cur`.`prev_id`)))select `diff`.`setting_version_id` AS `setting_version_id`,`diff`.`created_by` AS `operator_id`,`diff`.`created_at` AS `changed_at`,`diff`.`field_name` AS `field_name`,`diff`.`before_value` AS `before_value`,`diff`.`after_value` AS `after_value` from (select `pair`.`setting_version_id` AS `setting_version_id`,`pair`.`created_by` AS `created_by`,`pair`.`created_at` AS `created_at`,'staff_engine_order' AS `field_name`,`pair`.`p_staff` AS `before_value`,`pair`.`c_staff` AS `after_value` from `pair` where !(`pair`.`c_staff` <=> `pair`.`p_staff`) union all select `pair`.`setting_version_id` AS `setting_version_id`,`pair`.`created_by` AS `created_by`,`pair`.`created_at` AS `created_at`,'jeongganbo_engine_order' AS `jeongganbo_engine_order`,`pair`.`p_jg` AS `p_jg`,`pair`.`c_jg` AS `c_jg` from `pair` where !(`pair`.`c_jg` <=> `pair`.`p_jg`) union all select `pair`.`setting_version_id` AS `setting_version_id`,`pair`.`created_by` AS `created_by`,`pair`.`created_at` AS `created_at`,'recommend_engine_order' AS `recommend_engine_order`,`pair`.`p_ro` AS `p_ro`,`pair`.`c_ro` AS `c_ro` from `pair` where !(`pair`.`c_ro` <=> `pair`.`p_ro`) union all select `pair`.`setting_version_id` AS `setting_version_id`,`pair`.`created_by` AS `created_by`,`pair`.`created_at` AS `created_at`,'timeout_seconds' AS `timeout_seconds`,cast(`pair`.`p_timeout` as char charset utf8mb4) AS `CAST(p_timeout AS CHAR)`,cast(`pair`.`c_timeout` as char charset utf8mb4) AS `CAST(c_timeout AS CHAR)` from `pair` where !(`pair`.`c_timeout` <=> `pair`.`p_timeout`) union all select `pair`.`setting_version_id` AS `setting_version_id`,`pair`.`created_by` AS `created_by`,`pair`.`created_at` AS `created_at`,'max_concurrency_recognize' AS `max_concurrency_recognize`,cast(`pair`.`p_cr` as char charset utf8mb4) AS `CAST(p_cr AS CHAR)`,cast(`pair`.`c_cr` as char charset utf8mb4) AS `CAST(c_cr AS CHAR)` from `pair` where !(`pair`.`c_cr` <=> `pair`.`p_cr`) union all select `pair`.`setting_version_id` AS `setting_version_id`,`pair`.`created_by` AS `created_by`,`pair`.`created_at` AS `created_at`,'max_concurrency_render' AS `max_concurrency_render`,cast(`pair`.`p_cd` as char charset utf8mb4) AS `CAST(p_cd AS CHAR)`,cast(`pair`.`c_cd` as char charset utf8mb4) AS `CAST(c_cd AS CHAR)` from `pair` where !(`pair`.`c_cd` <=> `pair`.`p_cd`) union all select `pair`.`setting_version_id` AS `setting_version_id`,`pair`.`created_by` AS `created_by`,`pair`.`created_at` AS `created_at`,'web_concurrency_share' AS `web_concurrency_share`,cast(`pair`.`p_ws` as char charset utf8mb4) AS `CAST(p_ws AS CHAR)`,cast(`pair`.`c_ws` as char charset utf8mb4) AS `CAST(c_ws AS CHAR)` from `pair` where !(`pair`.`c_ws` <=> `pair`.`p_ws`) union all select `pair`.`setting_version_id` AS `setting_version_id`,`pair`.`created_by` AS `created_by`,`pair`.`created_at` AS `created_at`,'fallback_enabled' AS `fallback_enabled`,cast(`pair`.`p_fb` as char charset utf8mb4) AS `CAST(p_fb AS CHAR)`,cast(`pair`.`c_fb` as char charset utf8mb4) AS `CAST(c_fb AS CHAR)` from `pair` where !(`pair`.`c_fb` <=> `pair`.`p_fb`) union all select `pair`.`setting_version_id` AS `setting_version_id`,`pair`.`created_by` AS `created_by`,`pair`.`created_at` AS `created_at`,'default_call_limit_per_hour' AS `default_call_limit_per_hour`,cast(`pair`.`p_lim` as char charset utf8mb4) AS `CAST(p_lim AS CHAR)`,cast(`pair`.`c_lim` as char charset utf8mb4) AS `CAST(c_lim AS CHAR)` from `pair` where !(`pair`.`c_lim` <=> `pair`.`p_lim`) union all select `pair`.`setting_version_id` AS `setting_version_id`,`pair`.`created_by` AS `created_by`,`pair`.`created_at` AS `created_at`,'apply_rate_limit_count' AS `apply_rate_limit_count`,cast(`pair`.`p_rc` as char charset utf8mb4) AS `CAST(p_rc AS CHAR)`,cast(`pair`.`c_rc` as char charset utf8mb4) AS `CAST(c_rc AS CHAR)` from `pair` where !(`pair`.`c_rc` <=> `pair`.`p_rc`) union all select `pair`.`setting_version_id` AS `setting_version_id`,`pair`.`created_by` AS `created_by`,`pair`.`created_at` AS `created_at`,'apply_rate_window_minutes' AS `apply_rate_window_minutes`,cast(`pair`.`p_rw` as char charset utf8mb4) AS `CAST(p_rw AS CHAR)`,cast(`pair`.`c_rw` as char charset utf8mb4) AS `CAST(c_rw AS CHAR)` from `pair` where !(`pair`.`c_rw` <=> `pair`.`p_rw`) union all select `pair`.`setting_version_id` AS `setting_version_id`,`pair`.`created_by` AS `created_by`,`pair`.`created_at` AS `created_at`,'structure_threshold' AS `structure_threshold`,cast(`pair`.`p_st` as char charset utf8mb4) AS `CAST(p_st AS CHAR)`,cast(`pair`.`c_st` as char charset utf8mb4) AS `CAST(c_st AS CHAR)` from `pair` where !(`pair`.`c_st` <=> `pair`.`p_st`) union all select `pair`.`setting_version_id` AS `setting_version_id`,`pair`.`created_by` AS `created_by`,`pair`.`created_at` AS `created_at`,'grade_caution_boundary' AS `grade_caution_boundary`,cast(`pair`.`p_gc` as char charset utf8mb4) AS `CAST(p_gc AS CHAR)`,cast(`pair`.`c_gc` as char charset utf8mb4) AS `CAST(c_gc AS CHAR)` from `pair` where !(`pair`.`c_gc` <=> `pair`.`p_gc`) union all select `pair`.`setting_version_id` AS `setting_version_id`,`pair`.`created_by` AS `created_by`,`pair`.`created_at` AS `created_at`,'grade_distrust_boundary' AS `grade_distrust_boundary`,cast(`pair`.`p_gd` as char charset utf8mb4) AS `CAST(p_gd AS CHAR)`,cast(`pair`.`c_gd` as char charset utf8mb4) AS `CAST(c_gd AS CHAR)` from `pair` where !(`pair`.`c_gd` <=> `pair`.`p_gd`) union all select `pair`.`setting_version_id` AS `setting_version_id`,`pair`.`created_by` AS `created_by`,`pair`.`created_at` AS `created_at`,'web_max_active_per_client' AS `web_max_active_per_client`,cast(`pair`.`p_wa` as char charset utf8mb4) AS `CAST(p_wa AS CHAR)`,cast(`pair`.`c_wa` as char charset utf8mb4) AS `CAST(c_wa AS CHAR)` from `pair` where !(`pair`.`c_wa` <=> `pair`.`p_wa`) union all select `pair`.`setting_version_id` AS `setting_version_id`,`pair`.`created_by` AS `created_by`,`pair`.`created_at` AS `created_at`,'web_hourly_request_cap' AS `web_hourly_request_cap`,cast(`pair`.`p_wh` as char charset utf8mb4) AS `CAST(p_wh AS CHAR)`,cast(`pair`.`c_wh` as char charset utf8mb4) AS `CAST(c_wh AS CHAR)` from `pair` where !(`pair`.`c_wh` <=> `pair`.`p_wh`) union all select `pair`.`setting_version_id` AS `setting_version_id`,`pair`.`created_by` AS `created_by`,`pair`.`created_at` AS `created_at`,'score_file_max_bytes' AS `score_file_max_bytes`,cast(`pair`.`p_fm` as char charset utf8mb4) AS `CAST(p_fm AS CHAR)`,cast(`pair`.`c_fm` as char charset utf8mb4) AS `CAST(c_fm AS CHAR)` from `pair` where !(`pair`.`c_fm` <=> `pair`.`p_fm`) union all select `pair`.`setting_version_id` AS `setting_version_id`,`pair`.`created_by` AS `created_by`,`pair`.`created_at` AS `created_at`,'recommend_timeout_ms' AS `recommend_timeout_ms`,cast(`pair`.`p_rt` as char charset utf8mb4) AS `CAST(p_rt AS CHAR)`,cast(`pair`.`c_rt` as char charset utf8mb4) AS `CAST(c_rt AS CHAR)` from `pair` where !(`pair`.`c_rt` <=> `pair`.`p_rt`) union all select `pair`.`setting_version_id` AS `setting_version_id`,`pair`.`created_by` AS `created_by`,`pair`.`created_at` AS `created_at`,'llm_recommend_timeout_ms' AS `llm_recommend_timeout_ms`,cast(`pair`.`p_lt` as char charset utf8mb4) AS `CAST(p_lt AS CHAR)`,cast(`pair`.`c_lt` as char charset utf8mb4) AS `CAST(c_lt AS CHAR)` from `pair` where !(`pair`.`c_lt` <=> `pair`.`p_lt`)) `diff` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_shared_purge_due`
--

/*!50001 DROP VIEW IF EXISTS `v_shared_purge_due`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_uca1400_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY DEFINER */
/*!50001 VIEW `v_shared_purge_due` AS select `s`.`share_id` AS `share_id`,`s`.`share_no` AS `share_no`,`s`.`musicxml_uri` AS `musicxml_uri` from `shared_score` `s` where `s`.`expires_at` <= current_timestamp(3) and `s`.`purged_at` is null */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_shared_score_list`
--

/*!50001 DROP VIEW IF EXISTS `v_shared_score_list`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_uca1400_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY DEFINER */
/*!50001 VIEW `v_shared_score_list` AS select `s`.`share_id` AS `share_id`,`s`.`share_no` AS `share_no`,`s`.`title` AS `title`,`s`.`score_type` AS `score_type`,`s`.`shared_at` AS `shared_at`,`s`.`expires_at` AS `expires_at`,`s`.`example_id` is not null AS `is_example`,(select count(0) from `score_like` `l` where `l`.`share_id` = `s`.`share_id`) AS `like_count` from `shared_score` `s` where `s`.`unshared_at` is null and `s`.`taken_down_at` is null and `s`.`musicxml_uri` is not null and `s`.`expires_at` > current_timestamp(3) */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_web_request_limit`
--

/*!50001 DROP VIEW IF EXISTS `v_web_request_limit`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_uca1400_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY DEFINER */
/*!50001 VIEW `v_web_request_limit` AS select `x`.`limit_key` AS `limit_key`,sum(case when `x`.`status` in ('received','queued','converting','awaiting_type_answer') then 1 else 0 end) AS `active_count`,sum(case when `x`.`received_at` > current_timestamp(3) - interval 1 hour then 1 else 0 end) AS `hourly_count`,min(case when `x`.`received_at` > current_timestamp(3) - interval 1 hour then `x`.`received_at` end) + interval 1 hour AS `hourly_retry_at`,`s`.`web_max_active_per_client` AS `web_max_active_per_client`,`s`.`web_hourly_request_cap` AS `web_hourly_request_cap` from ((select concat('account:',`r`.`account_id`) AS `limit_key`,`r`.`status` AS `status`,`r`.`received_at` AS `received_at` from `score_request` `r` where `r`.`channel` = 'web' and `r`.`account_id` is not null and `r`.`received_at` > current_timestamp(3) - interval 1 day union all select concat('session:',`r`.`session_id`) AS `CONCAT('session:', r.session_id)`,`r`.`status` AS `status`,`r`.`received_at` AS `received_at` from `score_request` `r` where `r`.`channel` = 'web' and `r`.`session_id` is not null and `r`.`received_at` > current_timestamp(3) - interval 1 day union all select concat('addr:',`r`.`client_addr_hash`) AS `CONCAT('addr:', r.client_addr_hash)`,`r`.`status` AS `status`,`r`.`received_at` AS `received_at` from `score_request` `r` where `r`.`channel` = 'web' and `r`.`client_addr_hash` is not null and `r`.`received_at` > current_timestamp(3) - interval 1 day) `x` join `v_current_setting` `s`) group by `x`.`limit_key`,`s`.`web_max_active_per_client`,`s`.`web_hourly_request_cap` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*M!100616 SET NOTE_VERBOSITY=@OLD_NOTE_VERBOSITY */;

-- Dump completed
