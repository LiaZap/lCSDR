// Teste de LEITURA dos horários livres dos calendários do GHL.
// NÃO marca nada — só consulta free-slots e mostra. 100% seguro.
//
// Pré-requisitos no .env:
//   GHL_API_TOKEN=pit-...
//   GHL_LOCATION_ID=...
//   SCHEDULING_ENABLED=true
//   GHL_CALENDAR_IDS=id1,id2,...   (os calendários de rodízio dos closers)
//
// Uso: node scripts/test-slots.js
import 'dotenv/config';
import { GHL } from '../src/ghl/client.js';
import {
  schedulingEnabled, getCalendarIds, getNextSlots, labelForSlot,
} from '../src/agent/scheduling.js';

const TIMEZONE = process.env.GHL_TIMEZONE || 'America/Sao_Paulo';

function flatten(raw) {
  if (!raw || typeof raw !== 'object') return [];
  const all = [];
  for (const [k, v] of Object.entries(raw)) {
    if (k === 'traceId' || k === '_dates_') continue;
    if (v && Array.isArray(v.slots)) all.push(...v.slots);
    else if (Array.isArray(v)) all.push(...v);
  }
  return all;
}

async function main() {
  console.log('=== Config ===');
  console.log('SCHEDULING_ENABLED:', process.env.SCHEDULING_ENABLED);
  console.log('Calendários no env:', getCalendarIds());
  console.log('schedulingEnabled():', schedulingEnabled());
  if (!process.env.GHL_API_TOKEN) { console.error('\n❌ GHL_API_TOKEN ausente no .env'); process.exit(1); }

  // Lista TODOS os calendários do location direto da API (fonte de verdade,
  // sem depender de print). Mostra id + nome + tipo pra escolher os do rodízio.
  console.log('\n=== TODOS os calendários no GHL (direto da API) ===');
  try {
    const resp = await GHL.listCalendars();
    const cals = resp?.calendars || resp || [];
    if (!cals.length) console.log('  (nenhum calendário retornado)');
    const roundRobin = [];
    for (const c of cals) {
      const tipo = c.calendarType || c.widgetType || c.type || '?';
      const inEnv = getCalendarIds().includes(c.id) ? '  ⭐ JÁ no env' : '';
      console.log(`  - ${c.name}  [${tipo}]  id=${c.id}${inEnv}`);
      if (String(tipo).toLowerCase().includes('round')) roundRobin.push(c.id);
    }
    console.log(`\n  Total: ${cals.length} calendários`);

    // Linha pronta pra colar no .env (só os de rodízio), IDs exatos da API.
    if (roundRobin.length) {
      console.log('\n=== COPIE pro .env (todos os calendários de rodízio) ===');
      console.log(`GHL_CALENDAR_IDS=${roundRobin.join(',')}`);
    }
  } catch (err) {
    console.log('  ❌ erro ao listar calendários:', err.message);
  }

  if (!getCalendarIds().length) {
    console.log('\n⚠ Nenhum calendário em GHL_CALENDAR_IDS — preencha com os IDs de rodízio acima e rode de novo pro teste de slots.');
    return;
  }

  const startMs = Date.now();
  const endMs = startMs + 5 * 24 * 60 * 60 * 1000;

  console.log('\n=== Horários livres por calendário (próximos 5 dias) ===');
  for (const cid of getCalendarIds()) {
    try {
      const raw = await GHL.getFreeSlots(cid, { startDate: String(startMs), endDate: String(endMs), timezone: TIMEZONE });
      const isos = flatten(raw).filter(i => new Date(i) > new Date());
      console.log(`\n📅 ${cid}: ${isos.length} horários livres`);
      isos.slice(0, 3).forEach(i => console.log(`   - ${labelForSlot(i)}  (${i})`));
      if (isos.length > 3) console.log(`   ... +${isos.length - 3}`);
    } catch (err) {
      console.log(`\n📅 ${cid}: ❌ ERRO — ${err.message}`);
    }
  }

  console.log('\n=== O que a Tina ofereceria (3 mais próximos entre TODOS) ===');
  const next = await getNextSlots(3);
  if (!next.length) console.log('  (nenhum horário disponível)');
  next.forEach((s, i) => console.log(`  ${i + 1}. ${s.label}  → closer ${s.calendarId}`));
}

main().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
