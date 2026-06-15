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

// Dia (YYYY-MM-DD) de um ISO no fuso configurado, pra agrupar.
function dayKey(iso) {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: TIMEZONE });
}

// Puxa horários livres OLHANDO TODOS os calendários dos closers.
// - spread=false (padrão): os N mais cedo (pra urgência).
// - spread=true: um LEQUE com cobertura de manhã/tarde de cada dia, nos
//   próximos dias, pra atender pedidos tipo "amanhã de manhã" / "fim da tarde"
//   sem a Tina precisar inventar nem jogar pro humano.
// Retorna [{ iso, label, calendarId }] ordenado do mais cedo pro mais tarde.
export async function getNextSlots(count = 3, { fromDate = new Date(), spread = false } = {}) {
  if (!schedulingEnabled()) return [];
  const calendarIds = getCalendarIds();
  const startMs = fromDate.getTime();
  const endMs = startMs + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000;

  const results = await Promise.allSettled(calendarIds.map(calendarId =>
    GHL.getFreeSlots(calendarId, { startDate: String(startMs), endDate: String(endMs), timezone: TIMEZONE })
      .then(raw => ({ calendarId, isos: flattenSlots(raw) }))
  ));

  // junta {iso, calendarId}, filtra passado e dedup por instante (1 closer por horário)
  const merged = [];
  const seen = new Set();
  for (const r of results) {
    if (r.status !== 'fulfilled') { logger.warn({ err: r.reason?.message }, 'falha ao puxar free-slots de um calendário'); continue; }
    for (const iso of r.value.isos) {
      const t = new Date(iso).getTime();
      if (t <= fromDate.getTime() || seen.has(t)) continue;
      seen.add(t);
      merged.push({ iso, calendarId: r.value.calendarId });
    }
  }
  merged.sort((a, b) => new Date(a.iso) - new Date(b.iso));

  const pack = s => ({ iso: s.iso, label: labelForSlot(s.iso), calendarId: s.calendarId });
  if (!spread) return merged.slice(0, count).map(pack);

  // SPREAD: por dia (até 3 dias), pega cedo + meio + fim do dia.
  const byDay = new Map();
  for (const s of merged) {
    const k = dayKey(s.iso);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(s);
  }
  const chosen = [];
  for (const day of [...byDay.keys()].slice(0, 3)) {
    const ds = byDay.get(day);
    const picks = ds.length <= 3 ? ds : [ds[0], ds[Math.floor(ds.length / 2)], ds[ds.length - 1]];
    chosen.push(...picks);
  }
  chosen.sort((a, b) => new Date(a.iso) - new Date(b.iso));
  return chosen.slice(0, count).map(pack);
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
HORÁRIOS DISPONÍVEIS PARA AGENDAMENTO (entre os closers, próximos dias):
${linhas}

REGRAS DE AGENDAMENTO:
- Ofereça proativamente os **2-3 mais cedo** desta lista (priorize o quanto antes, o lead não pode esfriar).
- Se o lead pedir um DIA ou PERÍODO específico ("amanhã de manhã", "fim da tarde", "quinta"), escolha da lista o horário que MELHOR casa com o pedido e ofereça. NÃO invente horário fora da lista.
- Se NENHUM horário da lista casa com o que o lead quer, seja honesta: ofereça o mais próximo que tem ("o mais perto disso que consigo é X") e, se ainda assim não servir, diga que o especialista confirma um horário sob medida.
- Quando o lead confirmar um, devolva "book_slot" com o ISO EXATO daquele horário (copie da lista), e confirme na mensagem.
- NUNCA invente um horário que não está nesta lista.`.trim();
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
