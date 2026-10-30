-- 009_account_admin.sql (2026-09-29 조성기) — RBAC 운영자 메뉴 "계정·권한"(S7) — spec FR-069 · design/UC_17 · SD_01 §9B P8 · SD_03 §11A-4
-- 새 표 없음. 변경 이력(change_history)이 계정 조작을 받고, 게이트 G16(관리 조작 보호)과 관리용 뷰 두 개를 더한다.
-- 계정 조작에는 사유 칸을 두지 않는다(사유는 API 접근 키 신청의 '사용 목적'에서만 — 2026-09-29 결정).
-- 다시 실행해도 된다. 황송해 님이 예정한 쪽 표 마이그레이션과 파일 이름이 달라 서로 겹치지 않는다(schema_migration 은 파일 이름으로 기록).
SET NAMES utf8mb4;

ALTER TABLE change_history DROP CONSTRAINT IF EXISTS chk_history_target;
ALTER TABLE change_history ADD CONSTRAINT chk_history_target
  CHECK (target_type IN ('access_key','key_application','license_policy','model','account'));
ALTER TABLE change_history DROP CONSTRAINT IF EXISTS chk_history_field;
ALTER TABLE change_history ADD CONSTRAINT chk_history_field
  CHECK (field_name IN ('issued','status','call_limit_per_hour','retained','confirmed',
                        'registered','enabled','provider_ref','config','load','unregistered',
                        'role_granted','role_revoked','disabled','unlocked','email_revealed'));

ALTER TABLE gate_event DROP CONSTRAINT IF EXISTS chk_gate_code;
ALTER TABLE gate_event ADD CONSTRAINT chk_gate_code
  CHECK (gate_code IN ('G1','G2','G3','G4','G5','G6','G7','G8','G10','G11','G12','G13','G14','G15','G16'));

-- 권한표에 UC17(계정·권한 관리하기 — operator) — 유스케이스 번호 범위를 UC1~UC19 로 넓힌다
ALTER TABLE role_permission DROP CONSTRAINT IF EXISTS chk_role_permission_uc;
ALTER TABLE role_permission ADD CONSTRAINT chk_role_permission_uc CHECK (uc_code REGEXP '^UC([1-9]|1[0-9])$');
INSERT IGNORE INTO role_permission (role_code, uc_code) VALUES ('operator', 'UC17');

-- 계정 목록(가린 이메일 · 역할 · 상태 · 최근 7일 웹 요청 수)
CREATE OR REPLACE VIEW v_account_admin AS
SELECT a.account_id,
       CONCAT(LEFT(SUBSTRING_INDEX(a.login_id, '@', 1), 3), '**',
              CASE WHEN LOCATE('@', a.login_id) > 0 THEN CONCAT('@', SUBSTRING_INDEX(a.login_id, '@', -1)) ELSE '' END) AS login_id_masked,
       a.display_name,
       (SELECT GROUP_CONCAT(ar.role_code ORDER BY ar.role_code) FROM account_role ar WHERE ar.account_id = a.account_id) AS roles,
       CASE WHEN a.disabled_at IS NOT NULL THEN 'disabled'
            WHEN a.locked_until IS NOT NULL AND a.locked_until > CURRENT_TIMESTAMP(3) THEN 'locked'
            ELSE 'active' END AS status,
       a.created_at, a.last_login_at, a.locked_until, a.disabled_at, a.failed_logins,
       (SELECT COUNT(*) FROM score_request r
         WHERE r.account_id = a.account_id AND r.channel = 'web'
           AND r.received_at > CURRENT_TIMESTAMP(3) - INTERVAL 7 DAY) AS requests_7d
  FROM account a;

-- 사용 중인 운영자 수(BR-ADM-02 마지막 operator 보호)
CREATE OR REPLACE VIEW v_active_operator_count AS
SELECT COUNT(*) AS n
  FROM account a JOIN account_role ar ON ar.account_id = a.account_id AND ar.role_code = 'operator'
 WHERE a.disabled_at IS NULL;
