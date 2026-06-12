// Notificação de agendamento pro time (grupo/contato no GHL).
//
// O próprio GHL já dispara notificação nativa ao criar o appointment, mas a
// LC pediu um aviso no grupo. Env-gated e não-bloqueante: se AGENDA_NOTIFY_
// CONTACT_ID não estiver setado, só registra no events_log.

import { db } from '../db/index.js';
import { GHL } from '../ghl/client.js';
import { logger } from '../utils/logger.js';

export async function notifyAgendamento(contact, { label, iso, funnel }) {
  // Registra sempre no log interno
  try {
    db.prepare(`INSERT INTO events_log (contact_id, kind, payload) VALUES (?, 'reuniao_agendada', ?)`)
      .run(contact.id, JSON.stringify({ label, iso, funnel }));
  } catch (err) {
    logger.error({ err: err.message, contactId: contact.id }, 'falha ao registrar evento de agendamento');
  }

  // Aviso opcional no grupo/contato do time
  const notifyId = process.env.AGENDA_NOTIFY_CONTACT_ID;
  if (!notifyId || !process.env.GHL_API_TOKEN) return;

  const nome = contact.name || 'Lead';
  const tel = contact.phone || '';
  const msg = `🗓️ Nova reunião agendada pela Tina\n`
    + `Lead: ${nome}${tel ? ` (${tel})` : ''}\n`
    + `Funil: ${funnel || '-'}\n`
    + `Horário: ${label}`;

  try {
    await GHL.sendMessage({ contactId: notifyId, message: msg, type: 'WhatsApp' });
  } catch (err) {
    logger.error({ err: err.message }, 'falha ao notificar grupo de agendamento');
  }
}
