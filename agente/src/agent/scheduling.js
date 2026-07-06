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

// TRAVA de horário comercial: a Tina só oferece/agenda slots DENTRO desta faixa
// (hora local BRT). O free-slots do GHL às vezes devolve horários FORA do expediente
// (ex.: 19h–23h30 por config de fuso/disponibilidade errada no calendário) — sem esta
// trava a Tina agendava de madrugada. Default 9h–18h. Config: SCHEDULING_HOUR_MIN /
// SCHEDULING_HOUR_MAX (0-24). Se MIN >= MAX (inválido), a trava fica DESLIGADA.
const SCHED_HOUR_MIN = Number(process.env.SCHEDULING_HOUR_MIN ?? 9);
const SCHED_HOUR_MAX = Number(process.env.SCHEDULING_HOUR_MAX ?? 18);
function slotHourBRT(iso) {
  try {
    return Number(new Intl.DateTimeFormat('pt-BR', { timeZone: TIMEZONE, hour: 'numeric', hourCycle: 'h23' }).format(new Date(iso)));
  } catch { return new Date(iso).getHours(); }
}
// True se o slot COMEÇA dentro do expediente. Trava desligada/ inválida → sempre true.
function withinBusinessHours(iso) {
  if (!Number.isFinite(SCHED_HOUR_MIN) || !Number.isFinite(SCHED_HOUR_MAX) || SCHED_HOUR_MIN >= SCHED_HOUR_MAX) return true;
  const h = slotHourBRT(iso);
  return h >= SCHED_HOUR_MIN && h < SCHED_HOUR_MAX;
}

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

// Nome do consultor dono do calendário (pra avisos do time). Prioriza o env
// GHL_CALENDAR_NAMES ("calId:Nome,calId:Nome"); cai no mapa conhecido dos 6.
const CALENDAR_NAMES = {
  xzm7QW8TUGbwOP6IxAK8: 'Andressa', fMuUzjj4nSKRUXEPZYAx: 'Victor',
  OGYp8xuhvT1Fk5alNApk: 'Nataly', mbhOf9ovPL5HcCnCu5EN: 'Fernanda',
  '3XfNAPi9421TD3HlN7ac': 'Bruna', NhjBRFw1AJex8TqNuLAw: 'Gabriel',
};
export function calendarName(calendarId) {
  if (!calendarId) return null;
  for (const pair of (process.env.GHL_CALENDAR_NAMES || '').split(',')) {
    const [id, ...rest] = pair.split(':');
    if (id?.trim() === calendarId && rest.length) return rest.join(':').trim();
  }
  return CALENDAR_NAMES[calendarId] || null;
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

// Índice de rodízio do agendamento: distribui os leads entre os consultores
// (a "roleta" que a Lilian pediu). Avança a cada reunião agendada. Como todos
// os closers têm a MESMA grade de horário, sem isso todo lead cairia no 1º da
// lista (sempre o mesmo consultor). Rotaciona pra dividir de forma justa.
function rotationStart(n) {
  try {
    const row = db.prepare("SELECT COUNT(*) AS c FROM events_log WHERE kind = 'reuniao_agendada'").get();
    return (row?.c || 0) % n;
  } catch { return 0; }
}

// Pega um spread (cedo/meio/fim de cada dia, até 3 dias) de uma lista de slots.
function spreadPick(slots, count) {
  const byDay = new Map();
  for (const s of slots) {
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
  return chosen.slice(0, count);
}

// Puxa horários livres dos closers, com RODÍZIO entre eles (roleta).
// Cada lead é atendido por um consultor da vez; oferece os horários DELE.
// Se o consultor da vez não tiver horário, passa pro próximo da roleta.
// Retorna [{ iso, label, calendarId }] de UM consultor, ordenado.
export async function getNextSlots(count = 3, { fromDate = new Date(), spread = true } = {}) {
  if (!schedulingEnabled()) return [];
  const calendarIds = getCalendarIds();
  const startMs = fromDate.getTime();
  const endMs = startMs + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000;

  const results = await Promise.allSettled(calendarIds.map(calendarId =>
    GHL.getFreeSlots(calendarId, { startDate: String(startMs), endDate: String(endMs), timezone: TIMEZONE })
      .then(raw => ({ calendarId, isos: flattenSlots(raw) }))
  ));

  // mapa calendarId → slots futuros ordenados
  const byCal = new Map();
  for (const r of results) {
    if (r.status !== 'fulfilled') { logger.warn({ err: r.reason?.message }, 'falha ao puxar free-slots de um calendário'); continue; }
    const list = r.value.isos
      .filter(iso => new Date(iso).getTime() > fromDate.getTime())
      .filter(withinBusinessHours)   // ignora slots fora do expediente que o GHL retorna
      .sort()
      .map(iso => ({ iso, calendarId: r.value.calendarId }));
    if (list.length) byCal.set(r.value.calendarId, list);
  }
  if (!byCal.size) return [];

  const pack = s => ({ iso: s.iso, label: labelForSlot(s.iso), calendarId: s.calendarId });

  // RODÍZIO: começa pelo consultor da vez, oferece os horários DELE.
  // Pula quem não tiver horário, na ordem da roleta.
  const start = rotationStart(calendarIds.length);
  for (let i = 0; i < calendarIds.length; i++) {
    const cid = calendarIds[(start + i) % calendarIds.length];
    const slots = byCal.get(cid);
    if (slots && slots.length) {
      const picked = spread ? spreadPick(slots, count) : slots.slice(0, count);
      return picked.map(pack);
    }
  }
  return [];
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
- ⚠️ SÓ devolva "book_slot" quando o lead confirmar **DIA E HORA específicos** (ex: "pode ser amanhã às 11h30", ou um "sim" claro a um horário que VOCÊ ofereceu com dia+hora). Use o ISO EXATO daquele horário (copie da lista).
- ⚠️ Se o lead deu só a HORA ("11:30 dá certo") mas NÃO o dia — ou só o dia sem a hora — **NÃO marque ainda**: confirme o que falta ("11h30 de qual dia fica melhor pra você, hoje ou amanhã?") e só devolva book_slot depois que ele responder com dia+hora.
- ⚠️ NUNCA trate como confirmação mensagens ambíguas tipo "ok", "recebido", "confirmado o recebimento", "blz", "deixa eu ver", "vou verificar". Isso NÃO é "pode marcar". Pergunte de forma direta: "Posso confirmar então [dia] às [hora]?" e só marque com o "sim" explícito.
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

// Retorna a próxima reunião FUTURA e ativa do contato (anti double-booking), ou
// null. Se um consultor (ou a própria Tina) já marcou, não cria outra.
// Falha ABERTO (erro/API fora → null → segue e agenda) pra não travar o lead.
export async function upcomingAppointment(contact) {
  if (!contact?.ghl_contact_id || !process.env.GHL_API_TOKEN) return null;
  try {
    const r = await GHL.getContactAppointments(contact.ghl_contact_id);
    const events = r?.events || r?.appointments || (Array.isArray(r) ? r : []);
    if (!Array.isArray(events) || !events.length) return null;
    const now = Date.now();
    const ativos = events.filter(e => {
      const st = new Date(e.startTime || e.startedAt || 0).getTime();
      const status = String(e.appointmentStatus || e.status || '').toLowerCase();
      const morta = /cancel|invalid|noshow|no-show|deleted/.test(status);
      return st > now && !morta;
    }).sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
    return ativos[0] || null;
  } catch (err) {
    logger.warn({ err: err.message, contactId: contact.id }, 'falha checando reunião existente; segue (fail-open)');
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
  // Defensivo: nunca marca fora do expediente, mesmo se a IA passar um horário que o
  // lead pediu (fora da lista oferecida). O webhook trata ok:false ("mantém agendando").
  if (!withinBusinessHours(iso)) {
    logger.warn({ contactId: contact.id, iso }, 'book_slot fora do horário comercial — recusado');
    return { ok: false, error: 'horário fora do expediente' };
  }
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
    return { ok: true, label: labelForSlot(iso), calendarId, appointment: res };
  } catch (err) {
    logger.error({ err: err.message, contactId: contact.id, iso, calendarId }, 'falha ao agendar no GHL');
    return { ok: false, error: err.message };
  }
}
