import express from 'express';
import crypto from 'node:crypto';
import { db } from '../db/index.js';
import { authMiddleware } from './auth.js';
import { generateLilaReply } from '../agent/lila.js';
import { recordInbound, recordOutbound } from '../agent/contactService.js';
import { logger } from '../utils/logger.js';

const router = express.Router();
router.use(authMiddleware);

// Playground: conversa com a Iara sem passar pelo GHL.
// Usa a mesma lógica de qualificação real — contato sintético com prefixo `playground-`
// pra não misturar com leads reais nas métricas.

function findOrCreatePlaygroundContact(sessionId, userName) {
  const ghlId = `playground-${sessionId}`;
  let contact = db.prepare('SELECT * FROM contacts WHERE ghl_contact_id = ?').get(ghlId);
  if (!contact) {
    const info = db.prepare(`
      INSERT INTO contacts (ghl_contact_id, name, phone, stage, qualification_notes)
      VALUES (?, ?, ?, 'novo', 'sessão de playground — não é lead real')
    `).run(ghlId, userName || 'Lead de teste', null);
    contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(info.lastInsertRowid);
  }
  return contact;
}

// === POST /api/playground/chat ===
// body: { sessionId, message, userName? }
// retorna: { reply | split, funnel, stage, score, notes, handoff, endConversation, messages: [...] }
router.post('/chat', async (req, res) => {
  const { sessionId, message, userName } = req.body || {};
  if (!sessionId || !message) return res.status(400).json({ error: 'sessionId e message obrigatórios' });

  try {
    const contact = findOrCreatePlaygroundContact(sessionId, userName);
    recordInbound(contact.id, { content: message });

    const fresh = db.prepare('SELECT * FROM contacts WHERE id = ?').get(contact.id);
    const result = await generateLilaReply({ contact: fresh, incomingText: message });

    // Registra resposta(s) no banco (sem mandar pra lugar nenhum — é playground)
    // Cada item pode ser string OU {text, buttons:[{label,value}]}
    const items = result.split && result.split.length ? result.split : [result.reply];
    for (const item of items) {
      if (!item) continue;
      const text = typeof item === 'string' ? item : (item.text || '');
      const buttons = (typeof item === 'object' && item.buttons) ? item.buttons : null;
      if (!text) continue;
      // Persistência simples: gravamos só o texto. Botões vão no JSON da resposta pro frontend renderizar.
      recordOutbound(fresh.id, { author: 'ia', content: text, usage: result.usage });
      // Se quisermos persistir buttons no banco no futuro, criar coluna buttons_json em messages
    }

    // Atualiza estado
    db.prepare(`
      UPDATE contacts
      SET funnel = COALESCE(?, funnel),
          stage = COALESCE(?, stage),
          qualification_score = ?,
          qualification_notes = COALESCE(?, qualification_notes),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      result.funnel || null,
      result.stage || null,
      result.qualification_score || fresh.qualification_score || 0,
      result.qualification_notes || null,
      fresh.id
    );

    const updated = db.prepare('SELECT * FROM contacts WHERE id = ?').get(fresh.id);
    const messages = db.prepare(`
      SELECT id, direction, author, content, content_type, created_at
      FROM messages WHERE contact_id = ?
      ORDER BY created_at ASC, id ASC
    `).all(fresh.id);

    // Extrai os botões da última resposta (se houver) pro frontend renderizar
    const lastWithButtons = [...items].reverse().find(it => it && typeof it === 'object' && it.buttons);
    const lastButtons = lastWithButtons?.buttons || null;
    const lastFooter = lastWithButtons?.footerText || null;

    res.json({
      reply: result.reply,
      split: result.split || null,
      buttons: lastButtons,
      footerText: lastFooter,
      funnel: result.funnel,
      stage: result.stage,
      score: result.qualification_score || 0,
      notes: result.qualification_notes,
      handoff: !!result.handoff,
      handoffReason: result.handoff_reason,
      endConversation: !!result.end_conversation,
      contact: updated,
      messages,
    });
  } catch (err) {
    logger.error({ err: err.message, sessionId }, 'falha no playground chat');
    res.status(500).json({ error: err.message });
  }
});

// === GET /api/playground/sessions ===
// Lista todas as sessões de playground existentes
router.get('/sessions', (req, res) => {
  const rows = db.prepare(`
    SELECT c.id, c.ghl_contact_id, c.name, c.funnel, c.stage, c.qualification_score,
           c.updated_at, c.last_inbound_at,
           (SELECT COUNT(*) FROM messages m WHERE m.contact_id = c.id) as msg_count
    FROM contacts c
    WHERE c.ghl_contact_id LIKE 'playground-%'
    ORDER BY c.updated_at DESC
    LIMIT 100
  `).all();
  res.json({ sessions: rows.map(r => ({
    ...r,
    sessionId: r.ghl_contact_id.replace('playground-', ''),
  })) });
});

// === GET /api/playground/sessions/:sessionId ===
// Retorna mensagens e estado completo de uma sessão
router.get('/sessions/:sessionId', (req, res) => {
  const ghlId = `playground-${req.params.sessionId}`;
  const contact = db.prepare('SELECT * FROM contacts WHERE ghl_contact_id = ?').get(ghlId);
  if (!contact) return res.status(404).json({ error: 'sessão não encontrada' });

  const messages = db.prepare(`
    SELECT id, direction, author, content, content_type, created_at
    FROM messages WHERE contact_id = ?
    ORDER BY created_at ASC, id ASC
  `).all(contact.id);

  res.json({ contact, messages });
});

// === DELETE /api/playground/sessions/:sessionId ===
// Apaga sessão (útil pra limpar testes ruins)
router.delete('/sessions/:sessionId', (req, res) => {
  const ghlId = `playground-${req.params.sessionId}`;
  const contact = db.prepare('SELECT id FROM contacts WHERE ghl_contact_id = ?').get(ghlId);
  if (contact) {
    db.prepare('DELETE FROM messages WHERE contact_id = ?').run(contact.id);
    db.prepare('DELETE FROM contacts WHERE id = ?').run(contact.id);
  }
  res.json({ ok: true });
});

// === POST /api/playground/sessions/new ===
// Cria um sessionId novo (uuid curto) — útil pro frontend começar sessão limpa
router.post('/sessions/new', (req, res) => {
  const sessionId = crypto.randomBytes(6).toString('hex');
  res.json({ sessionId });
});

export default router;
