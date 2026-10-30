-- 004_quota_processing_calls.sql
-- 시간당 호출 한도(G3)는 처리를 일으키는 호출(POST)만 센다. 상태·결과 조회(GET)는 폴링이라 한도를 깎지 않는다.
-- 근거: 모델 API 코어 구현 보고(2026-09-28) — 폴링만으로 한도가 소진되는 문제.
SET NAMES utf8mb4;

CREATE OR REPLACE VIEW v_key_quota AS
SELECT q.key_id, q.call_limit_per_hour, q.calls_last_hour,
       q.call_limit_per_hour - q.calls_last_hour           AS remaining_this_hour,
       CASE WHEN q.call_limit_per_hour IS NOT NULL AND q.calls_last_hour >= q.call_limit_per_hour
            THEN 1 ELSE 0 END                               AS is_exhausted,
       q.oldest_call_at + INTERVAL 1 HOUR                   AS retry_after_at
  FROM (SELECT k.key_id, k.call_limit_per_hour,
               (SELECT COUNT(*) FROM api_call_log c
                 WHERE c.access_key_id = k.key_id AND c.outcome = 'accepted' AND c.endpoint LIKE 'POST %'
                   AND c.called_at > CURRENT_TIMESTAMP(3) - INTERVAL 1 HOUR) AS calls_last_hour,
               (SELECT MIN(c.called_at) FROM api_call_log c
                 WHERE c.access_key_id = k.key_id AND c.outcome = 'accepted' AND c.endpoint LIKE 'POST %'
                   AND c.called_at > CURRENT_TIMESTAMP(3) - INTERVAL 1 HOUR) AS oldest_call_at
          FROM access_key k) q;
