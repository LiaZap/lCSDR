// Fila de atendimento "falar agora" (decisão Lilian: todos viram closers,
// sem SDR humano; lead que quer falar na hora vai pro próximo consultor).
//
// Fluxo:
//   Lead qualifica → Tina pergunta "falar agora ou agendar?"
//     - "agora"   → liveHandoff(): rodízio entre os consultores, atribui o
//                   contato ao próximo no GHL, avisa o time, pausa a Tina
//     - "agendar" → fluxo de agendamento (scheduling.js)
//
// Rodízio SEM estado extra: o índice da vez = nº de live_handoffs já feitos
// (contado no events_log) módulo o tamanho da fila. Justo e simples.
//
// Config: QUEUE_USER_IDS = "userId" ou "userId:Nome", separados por vírgula.
// Sem isso, "falar agora" ainda funciona como aviso ao time (sem atribuir).

import { db } from '../db/index.js';
import { GHL } from '../ghl/client.js';
import { logger } from '../utils/logger.js';

// Parse "id:Nome,id2:Nome2" → [{ userId, name }]
export function getConsultants() {
  return (process.env.QUEUE_USER_IDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(entry => {
      const [userId, ...rest] = entry.split(':');
      return { userId: userId.trim(), name: rest.join(':').trim() || null };
    });
}

export function queueEnabled() {
  return getConsultants().length > 0;
}

// Próximo da fila por rodízio: conta quantos live_handoffs já rolaram.
function nextConsultant(consultants) {
  const row = db.prepare("SELECT COUNT(*) AS c FROM events_log WHERE kind = 'live_handoff'").get();
  const idx = (row?.c || 0) % consultants.length;
  return { consultant: consultants[idx], idx };
}

// Passa o lead pro próximo consultor da fila AGORA.
// Atribui no GHL + registra (avança o rodízio) + retorna quem pegou.
export async function liveHandoff(contact) {
  const consultants = getConsultants();
  if (!consultants.length) {
    // fila não configurada: registra mesmo assim pra notificar o time
    db.prepare("INSERT INTO events_log (contact_id, kind, payload) VALUES (?, 'live_handoff', ?)")
      .run(contact.id, JSON.stringify({ note: 'fila vazia, sem atribuição' }));
    return { ok: true, consultant: null };
  }

  // Caso Leandro (16/07): lead já estava sendo atendido pelo Victor e o rodízio
  // passou pra Fernanda. Se o lead JÁ tem consultor atribuído no GHL e ele está
  // na fila, MANTÉM com ele (kind próprio pra não avançar o rodízio dos demais).
  if (process.env.GHL_API_TOKEN && contact.ghl_contact_id && !String(contact.ghl_contact_id).startsWith('wa-')) {
    try {
      const g = await GHL.getContact(contact.ghl_contact_id);
      const atual = consultants.find(c => c.userId === g?.assignedTo);
      if (atual) {
        db.prepare("INSERT INTO events_log (contact_id, kind, payload) VALUES (?, 'live_handoff_kept', ?)")
          .run(contact.id, JSON.stringify({ userId: atual.userId, name: atual.name }));
        logger.info({ contactId: contact.id, consultant: atual.name || atual.userId }, 'lead mantido com o consultor que já atendia (falar agora)');
        return { ok: true, consultant: atual };
      }
    } catch (err) {
      logger.warn({ err: err.message, contactId: contact.id }, 'falha checando consultor atual; segue rodízio');
    }
  }

  const { consultant, idx } = nextConsultant(consultants);

  // atribui o contato ao consultor da vez no GHL
  if (process.env.GHL_API_TOKEN && contact.ghl_contact_id && !String(contact.ghl_contact_id).startsWith('wa-')) {
    try {
      await GHL.assignContact(contact.ghl_contact_id, consultant.userId);
    } catch (err) {
      logger.error({ err: err.message, contactId: contact.id, userId: consultant.userId }, 'falha ao atribuir lead ao consultor');
    }
  }

  // registra (isso avança o rodízio pra próxima vez)
  db.prepare("INSERT INTO events_log (contact_id, kind, payload) VALUES (?, 'live_handoff', ?)")
    .run(contact.id, JSON.stringify({ userId: consultant.userId, name: consultant.name, idx }));

  logger.info({ contactId: contact.id, consultant: consultant.name || consultant.userId, idx }, 'lead passado pro próximo da fila (falar agora)');
  return { ok: true, consultant };
}
