// Endpoints internos protegidos por token simples (não-usuário).
// Servem pra exportar dados crus pra análise offline (avaliações, etc).
//
// Proteção: header `x-internal-token` OU query `?token=...` precisa bater
// com INTERNAL_EXPORT_TOKEN do env. Sem o env, rota retorna 503 (desligada).
import express from 'express';
import { db } from '../db/index.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

function checkToken(req, res, next) {
  const expected = process.env.INTERNAL_EXPORT_TOKEN;
  if (!expected) {
    return res.status(503).json({ error: 'export desativado — defina INTERNAL_EXPORT_TOKEN' });
  }
  const got = req.header('x-internal-token') || req.query.token;
  if (got !== expected) {
    logger.warn({ ip: req.ip, path: req.path }, 'tentativa de export sem token válido');
    return res.status(401).json({ error: 'não autorizado' });
  }
  next();
}

// GET /api/internal/feedback-export?token=...
// Retorna JSON completo com TODAS as avaliações + conversa de contexto.
// Mesma estrutura do scripts/export-feedback.js.
router.get('/feedback-export', checkToken, (_req, res) => {
  try {
    const rows = db.prepare(`
      SELECT
        f.id            AS feedback_id,
        f.verdict,
        f.comment,
        f.created_at    AS reviewed_at,
        c.id            AS contact_id,
        c.name          AS contact_name,
        c.phone,
        c.stage,
        c.funnel,
        c.qualification_score,
        u.name          AS reviewer_name,
        u.email         AS reviewer_email
      FROM conversation_feedback f
      JOIN contacts c   ON c.id = f.contact_id
      JOIN sdr_users u  ON u.id = f.reviewer_id
      ORDER BY f.created_at DESC
    `).all();

    const msgsStmt = db.prepare(`
      SELECT direction, author, content, created_at
      FROM messages
      WHERE contact_id = ?
      ORDER BY created_at DESC
      LIMIT 20
    `);

    const enriched = rows.map(r => ({
      ...r,
      conversation: msgsStmt.all(r.contact_id).reverse(),
    }));

    res
      .setHeader('Content-Type', 'application/json; charset=utf-8')
      .setHeader('Content-Disposition', `attachment; filename="avaliacoes-equipe-lc-${new Date().toISOString().slice(0,10)}.json"`)
      .send(JSON.stringify({
        exported_at: new Date().toISOString(),
        total: enriched.length,
        data: enriched,
      }, null, 2));
  } catch (err) {
    logger.error({ err: err.message }, 'falha no feedback-export');
    res.status(500).json({ error: 'erro ao exportar' });
  }
});

export default router;
