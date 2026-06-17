import { db } from '../db/index.js';
import { GHL } from '../ghl/client.js';
import { logger } from '../utils/logger.js';

export function upsertContactFromGHL(ghlContact) {
  const existing = db.prepare('SELECT * FROM contacts WHERE ghl_contact_id = ?').get(ghlContact.id);
  if (existing) {
    db.prepare(`
      UPDATE contacts
      SET name = COALESCE(?, name),
          phone = COALESCE(?, phone),
          email = COALESCE(?, email),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      ghlContact.name || `${ghlContact.firstName || ''} ${ghlContact.lastName || ''}`.trim() || null,
      ghlContact.phone || null,
      ghlContact.email || null,
      existing.id
    );
    return db.prepare('SELECT * FROM contacts WHERE id = ?').get(existing.id);
  }

  const info = db.prepare(`
    INSERT INTO contacts (ghl_contact_id, name, phone, email, stage)
    VALUES (?, ?, ?, ?, 'novo')
  `).run(
    ghlContact.id,
    ghlContact.name || `${ghlContact.firstName || ''} ${ghlContact.lastName || ''}`.trim() || null,
    ghlContact.phone || null,
    ghlContact.email || null,
  );
  return db.prepare('SELECT * FROM contacts WHERE id = ?').get(info.lastInsertRowid);
}

export function recordInbound(contactId, { content, content_type = 'text', ghl_message_id = null, attachment_url = null } = {}) {
  // O better-sqlite3 só aceita number/string/bigint/buffer/null. Se passar um
  // OBJETO, ele acha que são "named params" e dispara "Too few parameter
  // values". O GHL às vezes manda o `body` como objeto (áudio/anexo
  // estruturado), então coagimos qualquer não-primitivo p/ JSON string.
  const bind = (v, dflt = null) => {
    if (v === undefined || v === null) return dflt;
    if (typeof v === 'object') { try { return JSON.stringify(v); } catch { return String(v); } }
    return v; // number, string, bigint, boolean
  };
  db.prepare(`
    INSERT INTO messages (contact_id, ghl_message_id, direction, author, content, content_type, raw_attachment_url)
    VALUES (?, ?, 'inbound', 'lead', ?, ?, ?)
  `).run(
    contactId,
    bind(ghl_message_id),
    bind(content, ''),
    bind(content_type, 'text'),
    bind(attachment_url),
  );
  db.prepare('UPDATE contacts SET last_inbound_at = CURRENT_TIMESTAMP WHERE id = ?').run(contactId);
  // Lead respondeu → cancela follow-ups pendentes desse contato.
  // Não faz sentido mandar "dei uma sumida" pra quem acabou de falar.
  db.prepare('UPDATE followups SET sent = 1 WHERE contact_id = ? AND sent = 0').run(contactId);
}

export function recordOutbound(contactId, { author = 'ia', content, sdr_id = null, usage = {} }) {
  const {
    tokens_in = 0,
    tokens_out = 0,
    cached_tokens = 0,
    cost_usd = 0,
    provider = null,
    model = null,
    prompt_version = null,
  } = usage;
  db.prepare(`
    INSERT INTO messages
      (contact_id, direction, author, sdr_id, content, tokens_in, tokens_out, cached_tokens, cost_usd, provider, model_used, prompt_version)
    VALUES (?, 'outbound', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(contactId, author, sdr_id, content, tokens_in, tokens_out, cached_tokens, cost_usd, provider, model, prompt_version);
  db.prepare('UPDATE contacts SET last_outbound_at = CURRENT_TIMESTAMP WHERE id = ?').run(contactId);
}

export function countMessagesToday(contactId) {
  const row = db.prepare(`
    SELECT COUNT(*) as c FROM messages
    WHERE contact_id = ? AND date(created_at) = date('now')
  `).get(contactId);
  return row?.c || 0;
}
