// Orquestração de agendamento da Tina via calendário do GHL.
//
// Fluxo (a Tina é uma SDR que agenda o quanto antes pra não esfriar o lead):
//   1. Lead qualifica → webhook coloca em stage 'agendando' (IA segue ativa)
//   2. Próximo turno → getNextSlots() puxa os horários livres mais próximos
//      do AGORA e injeta no contexto da Tina
//   3. Tina oferece os 2-3 slots mais próximos
//   4. Lead escolhe → Tina devolve book_slot (ISO) → bookSlot() marca no GHL
//   5. Confirma + notifica grupo + handoff (Closer assume)
//
// Tudo é env-gated. Sem GHL_CALENDAR_ID configurado, o agendamento é pulado
// e a Tina cai no handoff normal ("a equipe entra em contato").

import { GHL } from '../ghl/client.js';
import { logger } from '../utils/logger.js';

const SLOT_MINUTES = Number(process.env.GHL_SLOT_MINUTES || 30);
const LOOKAHEAD_DAYS = Number(process.env.GHL_SLOT_LOOKAHEAD_DAYS || 5);
const TIMEZONE = process.env.GHL_TIMEZONE || 'America/Sao_Paulo';

export function schedulingEnabled() {
  return process.env.SCHEDULING_ENABLED === 'true' && !!process.env.GHL_CALENDAR_ID;
}

export function getCalendarId() {
  return process.env.GHL_CALENDAR_ID || null;
}

// Achata a resposta de free-slots do GHL num array ordenado de ISO datetimes.
// O GHL devolve { "2026-06-15": { slots: [ "2026-06-15T14:00:00-03:00", ... ] }, traceId }
function flattenSlots(raw) {
  if (!raw || typeof raw !== 'object') return [];
  const all = [];
  for (const [key, val] of Object.entries(raw)) {
    if (key === 'traceId' || key === '_dates_') continue;
    if (val && Array.isArray(val.slots)) all.push(...val.slots);
    else if (Array.isArray(val)) all.push(...val);
  }
  // ordena ascendente (mais próximo do agora primeiro) e dedup
  return [...new Set(all)].sort((a, b) => new Date(a) - new Date(b));
}

// Puxa os N horários livres mais próximos do agora.
// Retorna [{ iso, label }] já formatados pra oferecer ao lead.
export async function getNextSlots(count = 3, fromDate = new Date()) {
  if (!schedulingEnabled()) return [];
  const calendarId = getCalendarId();

  const startMs = fromDate.getTime();
  const endMs = startMs + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000;

  try {
    const raw = await GHL.getFreeSlots(calendarId, {
      startDate: String(startMs),
      endDate: String(endMs),
      timezone: TIMEZONE,
    });
    const isos = flattenSlots(raw).filter(iso => new Date(iso) > fromDate);
    return isos.slice(0, count).map(iso => ({ iso, label: labelForSlot(iso) }));
  } catch (err) {
    logger.error({ err: err.message, calendarId }, 'falha ao puxar free-slots do GHL');
    return [];
  }
}

// Formata um ISO em rótulo humano PT-BR relativo (hoje/amanhã + hora).
export function labelForSlot(iso) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();

  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TIMEZONE });
  if (sameDay) return `hoje às ${hora}`;
  if (isTomorrow) return `amanhã às ${hora}`;
  const dia = d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: TIMEZONE });
  return `${dia} às ${hora}`;
}

// Bloco de contexto injetado no prompt quando há slots disponíveis.
export function slotsContextBlock(slots) {
  if (!slots || !slots.length) return null;
  const linhas = slots.map((s, i) => `  ${i + 1}. ${s.label}  (ISO: ${s.iso})`).join('\n');
  return `
HORÁRIOS DISPONÍVEIS PARA AGENDAMENTO (puxados do calendário do Closer, mais próximos do agora):
${linhas}

REGRAS DE AGENDAMENTO:
- Ofereça SOMENTE estes horários, do mais próximo pro mais distante. NÃO invente outros.
- Priorize o mais cedo possível (o lead não pode esfriar).
- Quando o lead escolher um, devolva o campo "book_slot" com o ISO EXATO daquele horário (copie da lista acima), e confirme na mensagem.
- Se nenhum servir, ofereça os próximos ou diga que a equipe confirma outro horário.`.trim();
}

// Marca o agendamento no GHL. Retorna { ok, label, error }.
export async function bookSlot(contact, iso, { title, notes, assignedUserId } = {}) {
  if (!schedulingEnabled()) return { ok: false, error: 'scheduling desativado' };
  if (!iso) return { ok: false, error: 'iso vazio' };

  const start = new Date(iso);
  if (isNaN(start.getTime())) return { ok: false, error: 'iso inválido' };
  const end = new Date(start.getTime() + SLOT_MINUTES * 60 * 1000);

  try {
    const res = await GHL.bookAppointment({
      calendarId: getCalendarId(),
      contactId: contact.ghl_contact_id,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      title: title || `Reunião LC, ${contact.name || 'lead'}`,
      notes: notes || `Agendado pela Tina (SDR). Funil: ${contact.funnel || '-'}.`,
      ...(assignedUserId ? { assignedUserId } : {}),
    });
    logger.info({ contactId: contact.id, iso, apptId: res?.id || res?.appointment?.id }, 'reunião agendada no GHL');
    return { ok: true, label: labelForSlot(iso), appointment: res };
  } catch (err) {
    logger.error({ err: err.message, contactId: contact.id, iso }, 'falha ao agendar no GHL');
    return { ok: false, error: err.message };
  }
}
