import express from 'express';
import { db } from '../db/index.js';
import { GHL } from '../ghl/client.js';
import { authMiddleware } from './auth.js';
import { pauseIA, resumeIA } from '../agent/handoff.js';
import { recordOutbound } from '../agent/contactService.js';

const router = express.Router();
router.use(authMiddleware);

// === Métricas gerais do período ===
// Exclui contatos de playground (ghl_contact_id começa com "playground-") pra não poluir stats.
router.get('/metrics', (req, res) => {
  const days = Number(req.query.days || 7);
  const NOT_PG = "c.ghl_contact_id NOT LIKE 'playground-%'";

  const totais = db.prepare(`
    SELECT
      COUNT(DISTINCT c.id) as leads,
      SUM(CASE WHEN c.stage = 'qualificado' THEN 1 ELSE 0 END) as qualificados,
      SUM(CASE WHEN c.stage = 'desqualificado' THEN 1 ELSE 0 END) as desqualificados,
      SUM(CASE WHEN c.stage = 'handoff' THEN 1 ELSE 0 END) as em_handoff,
      SUM(CASE WHEN c.stage IN ('novo','pre_qualificando','qualificando') THEN 1 ELSE 0 END) as em_atendimento
    FROM contacts c
    WHERE ${NOT_PG} AND c.created_at >= datetime('now', '-' || ? || ' days')
  `).get(days);

  // Tempo médio de 1ª resposta (entre primeira mensagem inbound e primeira outbound da IA)
  // Útil pro Lilian ver que a Lila responde em segundos vs SDR humano que demora horas
  const tempoResposta = db.prepare(`
    SELECT AVG(diff_seconds) as media, MIN(diff_seconds) as menor, MAX(diff_seconds) as maior
    FROM (
      SELECT
        c.id,
        (julianday(MIN(CASE WHEN m.author='ia' THEN m.created_at END))
         - julianday(MIN(CASE WHEN m.direction='inbound' THEN m.created_at END))
        ) * 86400 AS diff_seconds
      FROM contacts c
      JOIN messages m ON m.contact_id = c.id
      WHERE c.ghl_contact_id NOT LIKE 'playground-%'
        AND c.created_at >= datetime('now', '-' || ? || ' days')
      GROUP BY c.id
      HAVING diff_seconds IS NOT NULL AND diff_seconds > 0
    )
  `).get(days);

  const porFunil = db.prepare(`
    SELECT COALESCE(funnel, 'indefinido') as funnel, COUNT(*) as total
    FROM contacts c
    WHERE ${NOT_PG} AND c.created_at >= datetime('now', '-' || ? || ' days')
    GROUP BY funnel
  `).all(days);

  const custo = db.prepare(`
    SELECT
      COALESCE(SUM(m.tokens_in), 0) as tokens_in,
      COALESCE(SUM(m.tokens_out), 0) as tokens_out,
      COALESCE(SUM(m.cost_usd), 0) as cost_usd,
      COUNT(*) as mensagens_ia
    FROM messages m
    JOIN contacts c ON c.id = m.contact_id
    WHERE ${NOT_PG} AND m.author = 'ia' AND m.created_at >= datetime('now', '-' || ? || ' days')
  `).get(days);

  const porDia = db.prepare(`
    SELECT date(c.created_at) as dia, COUNT(*) as total,
      SUM(CASE WHEN c.stage = 'qualificado' THEN 1 ELSE 0 END) as qualificados
    FROM contacts c
    WHERE ${NOT_PG} AND c.created_at >= datetime('now', '-' || ? || ' days')
    GROUP BY date(c.created_at)
    ORDER BY dia ASC
  `).all(days);

  // Volume por hora do dia (heatmap futuro / horário de pico)
  const porHora = db.prepare(`
    SELECT
      CAST(strftime('%H', c.created_at) AS INTEGER) as hora,
      COUNT(*) as total
    FROM contacts c
    WHERE ${NOT_PG} AND c.created_at >= datetime('now', '-' || ? || ' days')
    GROUP BY hora
    ORDER BY hora
  `).all(days);

  res.json({ totais, porFunil, custo, porDia, porHora, tempoResposta });
});

// === Lista de contatos com filtros ===
router.get('/contacts', (req, res) => {
  const { stage, funnel, sdrId, q, limit = 50 } = req.query;
  const where = ["c.ghl_contact_id NOT LIKE 'playground-%'"];
  const params = [];

  if (stage) { where.push('c.stage = ?'); params.push(stage); }
  if (funnel) { where.push('c.funnel = ?'); params.push(funnel); }
  if (sdrId) { where.push('c.assigned_sdr_id = ?'); params.push(sdrId); }
  if (q) { where.push('(c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }

  const sql = `
    SELECT c.*, u.name as sdr_name
    FROM contacts c
    LEFT JOIN sdr_users u ON u.id = c.assigned_sdr_id
    WHERE ${where.join(' AND ')}
    ORDER BY c.updated_at DESC
    LIMIT ?
  `;
  const rows = db.prepare(sql).all(...params, Number(limit));
  res.json({ contacts: rows });
});

// === Detalhe do contato + conversa + feedbacks ===
router.get('/contacts/:id', (req, res) => {
  const contact = db.prepare(`
    SELECT c.*, u.name as sdr_name
    FROM contacts c
    LEFT JOIN sdr_users u ON u.id = c.assigned_sdr_id
    WHERE c.id = ?
  `).get(req.params.id);
  if (!contact) return res.status(404).json({ error: 'não encontrado' });

  const messages = db.prepare(`
    SELECT id, direction, author, content, content_type, created_at
    FROM messages WHERE contact_id = ?
    ORDER BY created_at ASC
  `).all(req.params.id);

  const feedbacks = db.prepare(`
    SELECT f.*, u.name as reviewer_name
    FROM conversation_feedback f
    LEFT JOIN sdr_users u ON u.id = f.reviewer_id
    WHERE f.contact_id = ?
    ORDER BY f.created_at DESC
  `).all(req.params.id);

  res.json({ contact, messages, feedbacks });
});

// === Feedback humano sobre uma conversa ===
// POST /api/contacts/:id/feedback  body: { verdict, comment }
router.post('/contacts/:id/feedback', (req, res) => {
  const { verdict, comment } = req.body || {};
  const valid = ['tom_ok', 'tom_errado', 'corrigir'];
  if (!valid.includes(verdict)) {
    return res.status(400).json({ error: `verdict precisa ser um de: ${valid.join(', ')}` });
  }
  const contact = db.prepare('SELECT id FROM contacts WHERE id = ?').get(req.params.id);
  if (!contact) return res.status(404).json({ error: 'contato não encontrado' });

  const info = db.prepare(`
    INSERT INTO conversation_feedback (contact_id, reviewer_id, verdict, comment)
    VALUES (?, ?, ?, ?)
  `).run(req.params.id, req.user.id, verdict, comment || null);

  res.json({ ok: true, id: info.lastInsertRowid });
});

// === Lista todos os feedbacks (vira input pro refinamento de prompt) ===
router.get('/feedback', (req, res) => {
  const verdict = req.query.verdict;
  const sql = `
    SELECT f.*, c.name as contact_name, c.funnel, c.stage, c.qualification_score,
           u.name as reviewer_name
    FROM conversation_feedback f
    JOIN contacts c ON c.id = f.contact_id
    LEFT JOIN sdr_users u ON u.id = f.reviewer_id
    ${verdict ? 'WHERE f.verdict = ?' : ''}
    ORDER BY f.created_at DESC
    LIMIT 200
  `;
  const rows = verdict ? db.prepare(sql).all(verdict) : db.prepare(sql).all();
  res.json({ feedbacks: rows });
});

// === Resumo de feedback (pra dashboard de qualidade) ===
router.get('/feedback/summary', (req, res) => {
  const counts = db.prepare(`
    SELECT verdict, COUNT(*) as total
    FROM conversation_feedback
    GROUP BY verdict
  `).all();
  const total = counts.reduce((s, c) => s + c.total, 0);
  res.json({ counts, total });
});

// === Atualizar stage de um contato (kanban drag) ===
router.put('/contacts/:id/stage', (req, res) => {
  const { stage } = req.body || {};
  const valid = ['novo', 'pre_qualificando', 'qualificando', 'qualificado', 'handoff', 'agendado', 'desqualificado'];
  if (!valid.includes(stage)) return res.status(400).json({ error: `stage inválido` });

  const contact = db.prepare('SELECT id FROM contacts WHERE id = ?').get(req.params.id);
  if (!contact) return res.status(404).json({ error: 'contato não encontrado' });

  db.prepare('UPDATE contacts SET stage = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(stage, req.params.id);
  db.prepare('INSERT INTO events_log (contact_id, kind, payload) VALUES (?, ?, ?)')
    .run(req.params.id, 'stage_changed_manual', JSON.stringify({ stage, by: req.user.id }));
  res.json({ ok: true });
});

// === SDR assume contato ===
router.post('/contacts/:id/assume', async (req, res) => {
  db.prepare(`
    UPDATE contacts SET assigned_sdr_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(req.user.id, req.params.id);
  pauseIA(req.params.id, 'sdr_assumiu_manualmente');
  res.json({ ok: true });
});

// === SDR libera contato de volta pra IA ===
router.post('/contacts/:id/release', (req, res) => {
  resumeIA(req.params.id, 'sdr_liberou_manualmente');
  res.json({ ok: true });
});

// === SDR envia mensagem pelo dashboard (opcional, evita trocar de aba) ===
router.post('/contacts/:id/send', async (req, res) => {
  const { message } = req.body || {};
  if (!message) return res.status(400).json({ error: 'mensagem vazia' });
  const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id);
  if (!contact) return res.status(404).json({ error: 'não encontrado' });

  try {
    await GHL.sendMessage({
      contactId: contact.ghl_contact_id,
      message,
      type: 'WhatsApp',
    });
    recordOutbound(contact.id, { author: 'sdr', content: message, sdr_id: req.user.id });
    pauseIA(contact.id, 'sdr_enviou_via_dashboard');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === Gerenciar SDRs (admin) ===
router.get('/sdrs', (req, res) => {
  const users = db.prepare('SELECT id, name, email, role, active FROM sdr_users ORDER BY name').all();
  res.json({ users });
});

export default router;
