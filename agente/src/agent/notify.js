// Notificação de agendamento pro time (grupo/contato no GHL).
//
// O próprio GHL já dispara notificação nativa ao criar o appointment, mas a
// LC pediu um aviso no grupo. Env-gated e não-bloqueante: se AGENDA_NOTIFY_
// CONTACT_ID não estiver setado, só registra no events_log.

import { db } from '../db/index.js';
import { GHL } from '../ghl/client.js';
import { UAZAPI } from '../uazapi/client.js';
import { calendarName } from './scheduling.js';
import { logger } from '../utils/logger.js';

// Funil em rótulo amigável pro time.
function funnelLabel(f) {
  return {
    escrever: 'Escrita / desenvolvimento do livro',
    publicar: 'Publicação',
    divulgar: 'Divulgação / Assessoria de Imprensa',
  }[f] || (f || '—');
}

// Resumo rápido pro consultor se situar antes de assumir a conversa.
function resumoLead(contact, funnel) {
  const linhas = [`🎯 Interesse: ${funnelLabel(funnel || contact.funnel)}`];
  const notas = (contact.qualification_notes || '').trim();
  if (notas) linhas.push(`📋 Contexto: ${notas}`);
  return linhas.join('\n');
}

// Grupo interno do time no WhatsApp (JID uazapi, ex.: "1203...@g.us"). O
// WhatsApp oficial (Meta) é 1:1 e NÃO posta em grupo; o número uazapi participa
// do grupo e manda os avisos. Setar UAZAPI_NOTIFY_GROUP no .env pra ativar.
const NOTIFY_GROUP = process.env.UAZAPI_NOTIFY_GROUP || '';

// Manda o aviso pro grupo do time via uazapi (não-bloqueante).
async function notifyGroupUazapi(text) {
  if (!NOTIFY_GROUP || !process.env.UAZAPI_TOKEN) return;
  try {
    await UAZAPI.sendText(NOTIFY_GROUP, text);
  } catch (err) {
    logger.error({ err: err.message }, 'falha ao avisar grupo via uazapi');
  }
}

// Aviso opcional via contato GHL (caminho antigo; só se AGENDA_NOTIFY_CONTACT_ID).
async function notifyContactGHL(msg) {
  const notifyId = process.env.AGENDA_NOTIFY_CONTACT_ID;
  if (!notifyId || !process.env.GHL_API_TOKEN) return;
  try {
    await GHL.sendMessage({ contactId: notifyId, message: msg, type: 'WhatsApp' });
  } catch (err) {
    logger.error({ err: err.message }, 'falha ao notificar contato GHL');
  }
}

// Aviso de "lead quer falar AGORA" pro time / consultor da vez.
export async function notifyLiveHandoff(contact, { consultant, funnel }) {
  try {
    db.prepare(`INSERT INTO events_log (contact_id, kind, payload) VALUES (?, 'live_handoff_notify', ?)`)
      .run(contact.id, JSON.stringify({ consultant: consultant?.name || consultant?.userId || null, funnel }));
  } catch (err) {
    logger.error({ err: err.message, contactId: contact.id }, 'falha ao registrar aviso de live handoff');
  }

  const nome = contact.name || 'Lead';
  const tel = contact.phone || '';
  const quem = consultant?.name || '(próximo da fila)';
  const msg = `🔥 *Lead quer falar AGORA*\n`
    + `👤 Lead: ${nome}${tel ? ` (${tel})` : ''}\n`
    + `👨‍💼 Consultor: ${quem}\n`
    + `${resumoLead(contact, funnel)}\n`
    + `\n⚡ Assumir a conversa no WhatsApp o quanto antes.`;

  await notifyGroupUazapi(msg);
  await notifyContactGHL(msg);
}

export async function notifyAgendamento(contact, { label, iso, funnel, calendarId }) {
  // Registra sempre no log interno
  try {
    db.prepare(`INSERT INTO events_log (contact_id, kind, payload) VALUES (?, 'reuniao_agendada', ?)`)
      .run(contact.id, JSON.stringify({ label, iso, funnel, calendarId }));
  } catch (err) {
    logger.error({ err: err.message, contactId: contact.id }, 'falha ao registrar evento de agendamento');
  }

  const nome = contact.name || 'Lead';
  const tel = contact.phone || '';
  const consultor = calendarName(calendarId);
  const msg = `🗓️ *Nova reunião agendada pela Tina*\n`
    + `👤 Lead: ${nome}${tel ? ` (${tel})` : ''}\n`
    + (consultor ? `👨‍💼 Consultor: ${consultor}\n` : '')
    + `🕐 Quando: ${label}\n`
    + `${resumoLead(contact, funnel)}`;

  await notifyGroupUazapi(msg);
  await notifyContactGHL(msg);
}
