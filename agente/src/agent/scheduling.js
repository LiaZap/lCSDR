// Orquestração de agendamento da Tina via calendários do GHL.
//
// Fluxo (a Tina é uma SDR que agenda o quanto antes pra não esfriar o lead):
//   1. Lead qualifica → webhook coloca em stage 'agendando' (IA segue ativa)
//   2. Próximo turno → getNextSlots() puxa os horários livres mais próximos
//      do AGORA, OLHANDO TODOS os calendários dos closers (rodízio), e pega
//      os mais cedo entre todos
//   3. Tina oferece os 2-3 slots mais próximos
//   4. Lead escolhe → Tina devolve book_slot (ISO) → bookSlot() marca no GHL,
//      no calendário do closer dono daquele horário
//   5. Confirma + notifica grupo + handoff (Closer assume)
//
// MÚLTIPLOS CALENDÁRIOS (rodízio de closers):
//   GHL_CALENDAR_IDS = "id1,id2,id3"  (lista dos closers)
//   ou GHL_CALENDAR_ID = "id"          (um só, compat)
// A Tina consulta todos, junta os horários e oferece os mais próximos de
// QUALQUER closer livre. Assim o lead pega o primeiro horário disponível.
//
// Env-gated: sem calendário configurado, cai no handoff normal.

import { db } from '../db/index.js';
import { GHL } from '../ghl/client.js';
import { logger } from '../utils/logger.js';

const SLOT_MINUTES = Number(process.env.GHL_SLOT_MINUTES || 30);
const LOOKAHEAD_DAYS = Number(process.env.GHL_SLOT_LOOKAHEAD_DAYS || 5);
const TIMEZONE = process.env.GHL_TIMEZONE || 'America/Sao_Paulo';

// Lista de calendários (closers). Aceita GHL_CALENDAR_IDS (CSV) ou GHL_CALENDAR_ID (único).
export function getCalendarIds() {
  const multi = (process.env.GHL_CALENDAR_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (multi.length) return multi;
  const single = (process.env.GHL_CALENDAR_ID || '').trim();
  return single ? [single] : [];
}

export function schedulingEnabled() {
  return process.env.SCHEDULING_ENABLED === 'true' && getCalendarIds().length > 0;
}

// Achata a resposta de free-slots do GHL num array de ISO datetimes.
// GHL devolve { "2026-06-15": { slots: [ "...T14:00:00-03:00", ... ] }, traceId }
function flattenSlots(raw) {
  if (!raw || typeof raw !== 'object') return [];
  const all = [];
  for (const [key, val] of Object.entries(raw)) {
    if (key === 'traceId' || key === '_dates_') continue;
    if (val && Array.isArray(val.slots)) all.push(...val.slots);
    else if (Array.isArray(val)) all.push(...val);
  }
  return all;
}

// Puxa os N horários livres mais próximos do agora, OLHANDO TODOS os
// calendários dos closers. Retorna [{ iso, label, calendarId }] ordenado
// do mais cedo pro mais tarde, com no máx 1 horário repetido por instante.
export async function getNextSlots(count = 3, fromDate = new Date()) {
  if (!schedulingEnabled()) return [];
  const calendarIds = getCalendarIds();
  const startMs = fromDate.getTime();
  const endMs = startMs + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000;

  // consulta todos os calendários em paralelo
  const results = await Promise.allSettled(calendarIds.map(calendarId =>
    GHL.getFreeSlots(calendarId, { startDate: String(startMs), endDate: String(endMs), timezone: TIMEZONE })
      .then(raw => ({ calendarId, isos: flattenSlots(raw) }))
  ));

  // junta {iso, calendarId} de todos os closers
  const merged = [];
  for (const r of results) {
    if (r.status !== 'fulfilled') {
      logger.warn({ err: r.reason?.message }, 'falha ao puxar free-slots de um calendário');
      continue;
    }
    for (const iso of r.value.isos) {
      if (new Date(iso) > fromDate) merged.push({ iso, calendarId: r.value.calendarId });
    }
  }

  // ordena por horário (mais cedo primeiro) e dedup por INSTANTE
  // (se 2 closers têm 14h, oferece só 1 horário 14h, no closer que veio 1º)
  merged.sort((a, b) => new Date(a.iso) - new Date(b.iso));
  const seen = new Set();
  const unique = [];
  for (const s of merged) {
    const t = new Date(s.iso).getTime();
    if (seen.has(t)) continue;
    seen.add(t);
    unique.push({ iso: s.iso, label: labelForSlot(s.iso), calendarId: s.calendarId });
    if (unique.length >= count) break;
  }
  return unique;
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
HORÁRIOS DISPONÍVEIS PARA AGENDAMENTO (mais próximos do agora, entre os closers disponíveis):
${linhas}

REGRAS DE AGENDAMENTO:
- Ofereça SOMENTE estes horários, do mais próximo pro mais distante. NÃO invente outros.
- Priorize o mais cedo possível (o lead não pode esfriar).
- Quando o lead escolher um, devolva o campo "book_slot" com o ISO EXATO daquele horário (copie da lista acima), e confirme na mensagem.
- Se nenhum servir, ofereça os próximos ou diga que a equipe confirma outro horário.`.trim();
}

// Registra os horários oferecidos (com o calendário de cada um) pra na hora
// de marcar saber em qual closer agendar.
export function recordOffer(contactId, slots) {
  if (!slots || !slots.length) return;
  try {
    db.prepare(`INSERT INTO events_log (contact_id, kind, payload) VALUES (?, 'slots_offered', ?)`)
      .run(contactId, JSON.stringify({ slots }));
  } catch (err) {
    logger.warn({ err: err.message, contactId }, 'falha ao registrar slots oferecidos');
  }
}

// Descobre em qual calendário (closer) está o horário que o lead escolheu,
// lendo o último 'slots_offered' do contato.
function calendarForSlot(contactId, iso) {
  try {
    const row = db.prepare(`
      SELECT payload FROM events_log
      WHERE contact_id = ? AND kind = 'slots_offered'
      ORDER BY id DESC LIMIT 1
    `).get(contactId);
    if (!row) return null;
    const { slots } = JSON.parse(row.payload);
    const t = new Date(iso).getTime();
    const match = (slots || []).find(s => new Date(s.iso).getTime() === t);
    return match?.calendarId || null;
  } catch {
    return null;
  }
}

// Marca o agendamento no GHL, no calendário do closer dono do horário.
// Retorna { ok, label, error }.
export async function bookSlot(contact, iso, { title, notes, assignedUserId } = {}) {
  if (!schedulingEnabled()) return { ok: false, error: 'scheduling desativado' };
  if (!iso) return { ok: false, error: 'iso vazio' };

  const start = new Date(iso);
  if (isNaN(start.getTime())) return { ok: false, error: 'iso inválido' };
  const end = new Date(start.getTime() + SLOT_MINUTES * 60 * 1000);

  // calendário do closer que tinha esse horário (ou o 1º configurado como fallback)
  const calendarId = calendarForSlot(contact.id, iso) || getCalendarIds()[0];
  if (!calendarId) return { ok: false, error: 'sem calendário configurado' };

  try {
    const res = await GHL.bookAppointment({
      calendarId,
      contactId: contact.ghl_contact_id,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      title: title || `Reunião LC, ${contact.name || 'lead'}`,
      notes: notes || `Agendado pela Tina (SDR). Funil: ${contact.funnel || '-'}.`,
      ...(assignedUserId ? { assignedUserId } : {}),
    });
    logger.info({ contactId: contact.id, iso, calendarId, apptId: res?.id || res?.appointment?.id }, 'reunião agendada no GHL');
    return { ok: true, label: labelForSlot(iso), appointment: res };
  } catch (err) {
    logger.error({ err: err.message, contactId: contact.id, iso, calendarId }, 'falha ao agendar no GHL');
    return { ok: false, error: err.message };
  }
}
