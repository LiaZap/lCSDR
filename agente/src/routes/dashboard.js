import express from 'express';
import { db } from '../db/index.js';
import { GHL } from '../ghl/client.js';
import { authMiddleware } from './auth.js';
import { pauseIA, resumeIA } from '../agent/handoff.js';
import { recordOutbound } from '../agent/contactService.js';

const router = express.Router();
router.use(authMiddleware);

// Filtro de data flexível pros endpoints de métricas/listas:
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD → range PERSONALIZADO (de X até Y)
//   ?days=N → últimos N dias   ·   ?days=0 ou ?all=1 → todo período (GERAL)
// Retorna { clause, params } pra concatenar no WHERE da query.
function dateFilter(req, col) {
  const { from, to } = req.query;
  if (from || to) {
    const parts = [], params = [];
    if (from) { parts.push(`${col} >= ?`); params.push(String(from).slice(0, 10) + ' 00:00:00'); }
    if (to)   { parts.push(`${col} <= ?`); params.push(String(to).slice(0, 10) + ' 23:59:59'); }
    return { clause: parts.length ? ' AND ' + parts.join(' AND ') : '', params };
  }
  if (req.query.all) return { clause: '', params: [] };                 // geral
  const raw = req.query.days;
  const days = (raw === undefined || raw === null || raw === '') ? 7 : Number(raw);
  if (!Number.isFinite(days) || days <= 0) return { clause: '', params: [] }; // days=0 = geral
  return { clause: ` AND ${col} >= datetime('now', '-' || ? || ' days')`, params: [days] };
}

// === Métricas gerais do período ===
// Exclui contatos de playground (ghl_contact_id começa com "playground-") pra não poluir stats.
router.get('/metrics', (req, res) => {
  const NOT_PG = "c.ghl_contact_id NOT LIKE 'playground-%'";
  const df  = dateFilter(req, 'c.created_at');  // queries de contacts (alias c)
  const dfm = dateFilter(req, 'm.created_at');  // custo / atendidos (messages)
  const dfe = dateFilter(req, 'created_at');    // events_log (agendados)

  const totais = db.prepare(`
    SELECT
      COUNT(DISTINCT c.id) as leads,
      SUM(CASE WHEN c.stage = 'qualificado' THEN 1 ELSE 0 END) as qualificados,
      SUM(CASE WHEN c.stage = 'desqualificado' THEN 1 ELSE 0 END) as desqualificados,
      SUM(CASE WHEN c.stage = 'handoff' THEN 1 ELSE 0 END) as em_handoff,
      SUM(CASE WHEN c.stage IN ('novo','pre_qualificando','qualificando') THEN 1 ELSE 0 END) as em_atendimento
    FROM contacts c
    WHERE ${NOT_PG}${df.clause}
  `).get(...df.params);

  // Tempo médio de 1ª resposta (entre 1ª inbound e 1ª outbound da IA).
  const tempoResposta = db.prepare(`
    SELECT AVG(diff_seconds) as media, MIN(diff_seconds) as menor, MAX(diff_seconds) as maior
    FROM (
      SELECT c.id,
        (julianday(MIN(CASE WHEN m.author='ia' THEN m.created_at END))
         - julianday(MIN(CASE WHEN m.direction='inbound' THEN m.created_at END))) * 86400 AS diff_seconds
      FROM contacts c JOIN messages m ON m.contact_id = c.id
      WHERE c.ghl_contact_id NOT LIKE 'playground-%'${df.clause}
      GROUP BY c.id
      HAVING diff_seconds IS NOT NULL AND diff_seconds > 0
    )
  `).get(...df.params);

  const porFunil = db.prepare(`
    SELECT COALESCE(funnel, 'indefinido') as funnel, COUNT(*) as total
    FROM contacts c
    WHERE ${NOT_PG}${df.clause}
    GROUP BY funnel
  `).all(...df.params);

  const custo = db.prepare(`
    SELECT COALESCE(SUM(m.tokens_in),0) as tokens_in, COALESCE(SUM(m.tokens_out),0) as tokens_out,
      COALESCE(SUM(m.cost_usd),0) as cost_usd, COUNT(*) as mensagens_ia
    FROM messages m JOIN contacts c ON c.id = m.contact_id
    WHERE ${NOT_PG} AND m.author = 'ia'${dfm.clause}
  `).get(...dfm.params);

  const porDia = db.prepare(`
    SELECT date(c.created_at) as dia, COUNT(*) as total,
      SUM(CASE WHEN c.stage = 'qualificado' THEN 1 ELSE 0 END) as qualificados
    FROM contacts c
    WHERE ${NOT_PG}${df.clause}
    GROUP BY date(c.created_at)
    ORDER BY dia ASC
  `).all(...df.params);

  // ATENDIDOS (leads distintos que a Tina respondeu) + AGENDADOS (reuniões).
  const atendidos = db.prepare(`
    SELECT COUNT(DISTINCT m.contact_id) as c
    FROM messages m JOIN contacts c ON c.id = m.contact_id
    WHERE m.author = 'ia' AND ${NOT_PG}${dfm.clause}
  `).get(...dfm.params)?.c || 0;
  const agendados = db.prepare(`
    SELECT COUNT(*) as c FROM events_log
    WHERE kind = 'reuniao_agendada'${dfe.clause}
  `).get(...dfe.params)?.c || 0;

  res.json({ totais, porFunil, custo, porDia, tempoResposta, atendidos, agendados });
});

// === Lista de leads ATENDIDOS pela Tina no período (quem ela respondeu) ===
router.get('/atendidos', (req, res) => {
  const dfm = dateFilter(req, 'm.created_at');
  const rows = db.prepare(`
    SELECT c.id, c.name, c.phone, c.funnel, c.stage,
      MAX(m.created_at) as ultima_resposta, COUNT(m.id) as msgs_ia
    FROM contacts c JOIN messages m ON m.contact_id = c.id
    WHERE m.author = 'ia' AND c.ghl_contact_id NOT LIKE 'playground-%'${dfm.clause}
    GROUP BY c.id
    ORDER BY ultima_resposta DESC
    LIMIT ?
  `).all(...dfm.params, Number(req.query.limit || 1000));
  res.json({ total: rows.length, atendidos: rows });
});

// === Lista de AGENDAMENTOS (reuniões que a Tina marcou) no período ===
router.get('/agendados', (req, res) => {
  const dfe = dateFilter(req, 'e.created_at');
  const rows = db.prepare(`
    SELECT e.created_at, e.payload, c.name, c.phone, c.funnel
    FROM events_log e LEFT JOIN contacts c ON c.id = e.contact_id
    WHERE e.kind = 'reuniao_agendada'${dfe.clause}
    ORDER BY e.id DESC
    LIMIT ?
  `).all(...dfe.params, Number(req.query.limit || 1000));
  const agendados = rows.map(r => {
    let p = {}; try { p = JSON.parse(r.payload); } catch {}
    return {
      name: r.name, phone: r.phone, funnel: p.funnel || r.funnel || null,
      quando: p.label || p.iso || null, calendarId: p.calendarId || null,
      agendado_em: r.created_at,
    };
  });
  res.json({ total: agendados.length, agendados });
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
    SELECT c.*, u.name as sdr_name,
      (SELECT COUNT(*) FROM conversation_feedback WHERE contact_id = c.id) as feedback_count
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
    ORDER BY created_at ASC, id ASC
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
  try {
    const { verdict, comment } = req.body || {};
    const valid = ['tom_ok', 'tom_errado', 'corrigir'];
    if (!valid.includes(verdict)) {
      return res.status(400).json({ error: `verdict precisa ser um de: ${valid.join(', ')}` });
    }
    // Cap defensivo no comment — evita inserir blob gigante no banco
    if (comment != null && (typeof comment !== 'string' || comment.length > 2000)) {
      return res.status(400).json({ error: 'comentário muito longo (máx 2000 caracteres)' });
    }
    const contact = db.prepare('SELECT id FROM contacts WHERE id = ?').get(req.params.id);
    if (!contact) return res.status(404).json({ error: 'contato não encontrado' });

    // Verifica se o reviewer ainda existe no banco. Se o token JWT foi gerado
    // antes de um restore/reseed, o req.user.id pode apontar pra ID que não
    // existe mais. Nesse caso, busca pelo email (estável entre reseeds).
    let reviewerId = req.user?.id;
    if (reviewerId) {
      const exists = db.prepare('SELECT id FROM sdr_users WHERE id = ?').get(reviewerId);
      if (!exists && req.user?.email) {
        // Fallback: tenta achar pelo email
        const byEmail = db.prepare('SELECT id FROM sdr_users WHERE email = ?').get(req.user.email);
        if (byEmail) reviewerId = byEmail.id;
        else {
          return res.status(401).json({
            error: 'sessão expirada — faça logout e login novamente',
            code: 'STALE_TOKEN',
          });
        }
      }
    }

    if (!reviewerId) {
      return res.status(401).json({ error: 'usuário não identificado, faça login novamente' });
    }

    const info = db.prepare(`
      INSERT INTO conversation_feedback (contact_id, reviewer_id, verdict, comment)
      VALUES (?, ?, ?, ?)
    `).run(req.params.id, reviewerId, verdict, comment || null);

    res.json({ ok: true, id: info.lastInsertRowid });
  } catch (err) {
    // Logger pra investigar se acontecer de novo (em vez de "erro interno" genérico)
    console.error('[feedback] erro:', err.message, 'user:', req.user?.email, 'contact:', req.params.id);
    res.status(500).json({ error: err.message || 'erro ao salvar feedback' });
  }
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

// === Custo da IA ao vivo — pra Paulo monitorar durante mutirão ===
// Mostra: total hoje, última hora, top 5 conversas mais caras, breakdown
// por provider e por versão de prompt. Refresh sugerido: 30s.
router.get('/admin/cost-now', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'admin only' });

  const today = db.prepare(`
    SELECT
      COALESCE(SUM(cost_usd), 0) as cost_usd,
      COUNT(*) as messages,
      COALESCE(SUM(tokens_in), 0) as tokens_in,
      COALESCE(SUM(tokens_out), 0) as tokens_out,
      COALESCE(SUM(cached_tokens), 0) as cached_tokens
    FROM messages
    WHERE author = 'ia' AND date(created_at) = date('now')
  `).get();

  const lastHour = db.prepare(`
    SELECT
      COALESCE(SUM(cost_usd), 0) as cost_usd,
      COUNT(*) as messages,
      COALESCE(AVG(cost_usd), 0) as avg_cost_per_msg
    FROM messages
    WHERE author = 'ia' AND created_at > datetime('now', '-1 hour')
  `).get();

  // Cache hit ratio: cached / total_in. Útil pra ver se o fix do prefix
  // cache OpenAI tá realmente economizando.
  const cacheRatio = today.tokens_in > 0
    ? today.cached_tokens / today.tokens_in
    : 0;

  const topConversations = db.prepare(`
    SELECT
      m.contact_id,
      c.name,
      c.phone,
      c.funnel,
      COUNT(*) as msgs,
      ROUND(SUM(m.cost_usd) * 10000) / 10000 as total_cost
    FROM messages m
    JOIN contacts c ON c.id = m.contact_id
    WHERE m.author = 'ia'
      AND date(m.created_at) = date('now')
      AND c.ghl_contact_id NOT LIKE 'playground-%'
    GROUP BY m.contact_id
    ORDER BY total_cost DESC
    LIMIT 5
  `).all();

  const byProvider = db.prepare(`
    SELECT
      COALESCE(provider, 'unknown') as provider,
      COUNT(*) as messages,
      ROUND(SUM(cost_usd) * 10000) / 10000 as cost_usd
    FROM messages
    WHERE author = 'ia' AND date(created_at) = date('now')
    GROUP BY provider
  `).all();

  const byPromptVersion = db.prepare(`
    SELECT
      COALESCE(prompt_version, 'unversioned') as prompt_version,
      COUNT(*) as messages,
      ROUND(SUM(cost_usd) * 10000) / 10000 as cost_usd
    FROM messages
    WHERE author = 'ia' AND date(created_at) = date('now')
    GROUP BY prompt_version
    ORDER BY messages DESC
  `).all();

  res.json({
    today: {
      cost_usd: today.cost_usd,
      messages: today.messages,
      tokens_in: today.tokens_in,
      tokens_out: today.tokens_out,
      cached_tokens: today.cached_tokens,
      cache_hit_ratio: cacheRatio,
    },
    lastHour,
    topConversations,
    byProvider,
    byPromptVersion,
    generatedAt: new Date().toISOString(),
  });
});

export default router;
