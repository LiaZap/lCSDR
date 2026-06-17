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
  // A versão do better-sqlite3 no container REJEITA `undefined` ("Too few
  // parameter values") — diferente da local, que aceita. Então montamos o
  // array de valores, coagimos TODO undefined p/ null e usamos spread (garante
  // exatamente 5 args, elimina erro de contagem). O log abaixo revela qual
  // campo estava undefined, pra achar a causa raiz sem ficar no escuro.
  const vals = [
    contactId,
    ghl_message_id ?? null,
    content ?? '',
    content_type ?? 'text',
    attachment_url ?? null,
  ];
  const undefIdx = vals.findIndex(v => v === undefined);
  if (undefIdx !== -1) {
    const campo = ['contactId', 'ghl_message_id', 'content', 'content_type', 'attachment_url'][undefIdx];
    logger.warn({ campo, contactId, content_type }, 'recordInbound: parâmetro undefined coagido p/ null');
    vals[undefIdx] = null;
  }
  const stmt = db.prepare(`
    INSERT INTO messages (contact_id, ghl_message_id, direction, author, content, content_type, raw_attachment_url)
    VALUES (?, ?, 'inbound', 'lead', ?, ?, ?)
  `);
  try {
    stmt.run(...vals);
  } catch (e) {
    // Diagnóstico: mostra a SQL real e cada valor/tipo pra achar a causa do
    // "Too few parameter values" (que NÃO deveria acontecer com 5 args).
    logger.error({
      err: e.message,
      sql: stmt.source,
      valsLen: vals.length,
      tipos: vals.map(v => v === undefined ? 'undefined' : v === null ? 'null' : typeof v),
      preview: vals.map(v => String(v ?? '').slice(0, 30)),
    }, 'recordInbound INSERT falhou — diagnóstico');
    // Fallback: grava o mínimo com primitivos garantidos pra NÃO derrubar o
    // webhook (Tina continua respondendo). Não relança o erro.
    try {
      db.prepare(`INSERT INTO messages (contact_id, direction, author, content, content_type) VALUES (?, 'inbound', 'lead', ?, ?)`)
        .run(contactId, String(content ?? ''), String(content_type ?? 'text'));
    } catch (e2) {
      logger.error({ err: e2.message }, 'recordInbound fallback também falhou');
    }
  }
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
