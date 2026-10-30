-- 008_rbac.sql (2026-09-29 조성기) — 역할 기반 접근 제어(RBAC), 영역 H 계정·권한
-- design/gugak_ddl_rbac.sql 과 같다 + 계정별 웹 요청 한도(v_web_request_limit 에 account: 키).
-- 원천: spec FR-066~FR-068 · design/UC_16 · UC_00 §4-1 권한표 · SD_01 §9A · SD_03 §11A
-- 권한표 추가(2026-09-29 사진+PDF): 모델 API 내부 /v1/internal/upload-check 는 service 의 UC3.
SET NAMES utf8mb4;

-- H1 계정 — 사용자·운영자가 로그인하는 사람 한 명(BR-AUTH-01·02)
CREATE TABLE IF NOT EXISTS account (
  account_id        BIGINT        NOT NULL AUTO_INCREMENT,
  login_id          VARCHAR(254)  NOT NULL,          -- 이메일(사용자). 옮겨 온 운영자는 기존 아이디
  password_hash     VARCHAR(255)  NOT NULL,          -- argon2id. 원문은 저장하지 않는다
  display_name      VARCHAR(100)  NOT NULL,
  created_at        TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  disabled_at       TIMESTAMP(3)  NULL,              -- 사용 중지(로그인 불가)
  failed_logins     INT           NOT NULL DEFAULT 0, -- 연속 실패 수(G15)
  locked_until      TIMESTAMP(3)  NULL,              -- 5회 실패 뒤 잠금 끝 시각(G15)
  last_login_at     TIMESTAMP(3)  NULL,
  signup_addr_hash  CHAR(64)      NULL,              -- 가입 빈도 제한(G14)용 접속 주소 해시. 24시간 뒤 지움(FR-063)
  CONSTRAINT pk_account PRIMARY KEY (account_id),
  CONSTRAINT uq_account_login UNIQUE (login_id),
  CONSTRAINT chk_account_nonempty CHECK (TRIM(login_id) <> '' AND TRIM(password_hash) <> '' AND TRIM(display_name) <> ''),
  CONSTRAINT chk_account_failed CHECK (failed_logins >= 0)
);

-- H2 역할 — 4개로 고정(BR-AUTH-03)
CREATE TABLE IF NOT EXISTS role (
  role_code    VARCHAR(16)   NOT NULL,
  name_ko      VARCHAR(40)   NOT NULL,
  description  VARCHAR(200)  NOT NULL,
  CONSTRAINT pk_role PRIMARY KEY (role_code),
  CONSTRAINT chk_role_code CHECK (role_code IN ('user','operator','api_caller','service'))
);

-- H3 계정 ↔ 역할 (여러 개 가능). api_caller·service 는 계정이 아니라 키에 붙으므로 여기 두지 않는다
CREATE TABLE IF NOT EXISTS account_role (
  account_id  BIGINT        NOT NULL,
  role_code   VARCHAR(16)   NOT NULL,
  granted_at  TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  granted_by  BIGINT        NULL,                    -- 부여한 계정(가입 자동 부여면 NULL)
  CONSTRAINT pk_account_role PRIMARY KEY (account_id, role_code),
  CONSTRAINT fk_account_role_account FOREIGN KEY (account_id) REFERENCES account (account_id),
  CONSTRAINT fk_account_role_role FOREIGN KEY (role_code) REFERENCES role (role_code),
  CONSTRAINT fk_account_role_by FOREIGN KEY (granted_by) REFERENCES account (account_id),
  CONSTRAINT chk_account_role_person CHECK (role_code IN ('user','operator'))
);

-- H4 역할 ↔ 유스케이스 — 권한표 그 자체(UC_00 §4-1, FR-068). 코드에 따로 적지 않는다
CREATE TABLE IF NOT EXISTS role_permission (
  role_code  VARCHAR(16)  NOT NULL,
  uc_code    VARCHAR(5)   NOT NULL,                  -- 'UC1' ~ 'UC16'
  CONSTRAINT pk_role_permission PRIMARY KEY (role_code, uc_code),
  CONSTRAINT fk_role_permission_role FOREIGN KEY (role_code) REFERENCES role (role_code),
  CONSTRAINT chk_role_permission_uc CHECK (uc_code REGEXP '^UC([1-9]|1[0-6])$')
);

-- 기존 표에 계정 연결
ALTER TABLE operator_account  ADD COLUMN IF NOT EXISTS account_id BIGINT NULL;   -- 설정 이력 등이 가리키는 운영자 표는 남기고 계정과 연결
ALTER TABLE anon_session      ADD COLUMN IF NOT EXISTS account_id BIGINT NULL;   -- 로그인 세션(H10): 로그인하면 채운다
ALTER TABLE score_request     ADD COLUMN IF NOT EXISTS account_id BIGINT NULL;   -- 웹 요청의 주인(계정 소유, BR-AUTH-04)
ALTER TABLE key_application   ADD COLUMN IF NOT EXISTS account_id BIGINT NULL;   -- 신청한 계정(FR-053 2026-09-29)

-- 다시 실행할 때: 외래 키를 먼저 지워야 고유 인덱스를 지울 수 있다
ALTER TABLE operator_account DROP CONSTRAINT IF EXISTS fk_operator_account;
ALTER TABLE operator_account DROP INDEX IF EXISTS uq_operator_account;
ALTER TABLE operator_account ADD CONSTRAINT uq_operator_account UNIQUE (account_id);
ALTER TABLE operator_account ADD CONSTRAINT fk_operator_account FOREIGN KEY (account_id) REFERENCES account (account_id);
ALTER TABLE anon_session DROP CONSTRAINT IF EXISTS fk_session_account;
ALTER TABLE anon_session ADD CONSTRAINT fk_session_account FOREIGN KEY (account_id) REFERENCES account (account_id);
ALTER TABLE score_request DROP CONSTRAINT IF EXISTS fk_request_account;
ALTER TABLE score_request ADD CONSTRAINT fk_request_account FOREIGN KEY (account_id) REFERENCES account (account_id);
ALTER TABLE key_application DROP CONSTRAINT IF EXISTS fk_application_account;
ALTER TABLE key_application ADD CONSTRAINT fk_application_account FOREIGN KEY (account_id) REFERENCES account (account_id);

CREATE INDEX IF NOT EXISTS ix_request_account_time ON score_request (account_id, received_at);   -- G12 계정별 한도
CREATE INDEX IF NOT EXISTS ix_account_signup_addr  ON account (signup_addr_hash, created_at);     -- G14 가입 빈도

-- 게이트 G13(권한)·G14(가입 검사)·G15(로그인 잠금)와 주체 'account'
ALTER TABLE gate_event DROP CONSTRAINT IF EXISTS chk_gate_code;
ALTER TABLE gate_event ADD CONSTRAINT chk_gate_code
  CHECK (gate_code IN ('G1','G2','G3','G4','G5','G6','G7','G8','G10','G11','G12','G13','G14','G15'));
ALTER TABLE gate_event DROP CONSTRAINT IF EXISTS chk_gate_subject;
ALTER TABLE gate_event ADD CONSTRAINT chk_gate_subject
  CHECK (subject_type IN ('session','access_key','api_call','request','operator','soundfont','setting_version','client','account'));

-- 역할 4개
INSERT IGNORE INTO role (role_code, name_ko, description) VALUES
  ('user',       '사용자',     '가입한 계정. 악보 올리기·듣기·편집·내려받기, 접근 키 신청'),
  ('operator',   '운영자',     '팀원 계정. 관리자 화면(내부망)의 지표·설정·키 관리'),
  ('api_caller', 'API 호출자', '접근 키(X-API-Key)로 들어온 호출. 모델 기능 API·연주 API'),
  ('service',    '웹 서비스',  '서비스 전용 키로 모델 API 를 부르는 웹 서비스(시스템)');

-- 권한표(UC_00 §4-1). 방문자(로그인 안 함)는 역할이 없고, UC11·UC16 은 경로 대응표에서 "누구나"로 둔다
INSERT IGNORE INTO role_permission (role_code, uc_code) VALUES
  ('user','UC1'),('user','UC2'),('user','UC3'),('user','UC5'),('user','UC6'),('user','UC7'),
  ('user','UC11'),('user','UC15'),('user','UC16'),
  ('operator','UC9'),('operator','UC10'),('operator','UC14'),('operator','UC11'),('operator','UC16'),
  ('api_caller','UC11'),('api_caller','UC12'),('api_caller','UC13'),
  ('service','UC1'),('service','UC2'),('service','UC3'),('service','UC5'),('service','UC7'),
  ('service','UC10'),('service','UC12'),('service','UC14');

-- 기존 운영자 → 계정 + operator 역할 (같은 아이디·비밀번호 해시, 사용 중지 상태도 그대로)
INSERT IGNORE INTO account (login_id, password_hash, display_name, created_at, disabled_at)
  SELECT o.login_id, o.password_hash, o.display_name, o.created_at, o.disabled_at FROM operator_account o;
UPDATE operator_account o JOIN account a ON a.login_id = o.login_id SET o.account_id = a.account_id WHERE o.account_id IS NULL;
INSERT IGNORE INTO account_role (account_id, role_code)
  SELECT o.account_id, 'operator' FROM operator_account o WHERE o.account_id IS NOT NULL;

-- 사람에게 보이는 권한 목록(관리자 화면·점검용)
CREATE OR REPLACE VIEW v_account_permission AS
SELECT a.account_id, a.login_id, ar.role_code, rp.uc_code
  FROM account a
  JOIN account_role ar ON ar.account_id = a.account_id
  JOIN role_permission rp ON rp.role_code = ar.role_code
 WHERE a.disabled_at IS NULL;

-- G12 웹 요청 한도를 계정 기준으로(FR-062 2026-09-29). 세션·주소 키는 RBAC 이전 행과 보조 판정용으로 남긴다
CREATE OR REPLACE VIEW v_web_request_limit AS
SELECT x.limit_key,
       SUM(CASE WHEN x.status IN ('received','queued','converting','awaiting_type_answer') THEN 1 ELSE 0 END) AS active_count,
       SUM(CASE WHEN x.received_at > CURRENT_TIMESTAMP(3) - INTERVAL 1 HOUR THEN 1 ELSE 0 END)                AS hourly_count,
       MIN(CASE WHEN x.received_at > CURRENT_TIMESTAMP(3) - INTERVAL 1 HOUR THEN x.received_at END)
         + INTERVAL 1 HOUR                                                                                   AS hourly_retry_at,
       s.web_max_active_per_client,
       s.web_hourly_request_cap
  FROM (SELECT CONCAT('account:', r.account_id) AS limit_key, r.status, r.received_at
          FROM score_request r
         WHERE r.channel = 'web' AND r.account_id IS NOT NULL
           AND r.received_at > CURRENT_TIMESTAMP(3) - INTERVAL 1 DAY
        UNION ALL
        SELECT CONCAT('session:', r.session_id), r.status, r.received_at
          FROM score_request r
         WHERE r.channel = 'web' AND r.session_id IS NOT NULL
           AND r.received_at > CURRENT_TIMESTAMP(3) - INTERVAL 1 DAY
        UNION ALL
        SELECT CONCAT('addr:', r.client_addr_hash), r.status, r.received_at
          FROM score_request r
         WHERE r.channel = 'web' AND r.client_addr_hash IS NOT NULL
           AND r.received_at > CURRENT_TIMESTAMP(3) - INTERVAL 1 DAY) x
  CROSS JOIN v_current_setting s
 GROUP BY x.limit_key, s.web_max_active_per_client, s.web_hourly_request_cap;
