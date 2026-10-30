// 변경 이력 (tasks T099, FR-052 · D-13): 설정 판본 차이 + 운영자 조치
import { Router } from 'express';
import { query } from '../db/pool.js';
import { wrap } from '../web/errors.js';

export const auditRouter = Router();

auditRouter.get('/audit', wrap(async (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 200)));
  const rows = await query(
    `SELECT h.target_type, h.target_ref, h.operator_id, m.login_id_masked, h.changed_at, h.field_name, h.before_value, h.after_value
       FROM v_change_history_all h LEFT JOIN v_operator_masked m ON m.operator_id = h.operator_id
      ORDER BY h.changed_at DESC LIMIT ?`, [limit]);
  res.json({ items: rows });
}));
