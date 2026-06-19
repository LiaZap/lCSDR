// Diagnóstico: leads que MANDARAM mensagem mas a Tina NÃO respondeu — e o PORQUÊ.
//
// Cruza 3 fontes:
//   1. events_log 'webhook_InboundMessage' — TODO inbound recebido é logado aqui
//      ANTES de qualquer gate (então é a lista autoritativa de "a Tina viu").
//   2. messages (author='ia') — se ela respondeu de fato.
//   3. TAGS no GHL + gates do .env — pra classificar o motivo da não-resposta.
//
// Uso (no container do lcsdr):
//   node scripts/diagnostico-nao-respondidos.js        → últimos 2 dias
//   node scripts/diagnostico-nao-respondidos.js 5      → últimos 5 dias
import 'dotenv/config';
import { db } from '../src/db/index.js';
import { GHL } from '../src/ghl/client.js';

const DAYS = Number(process.argv[2] || 2);
const REQUIRED_TAG = (process.env.GHL_TAG_REQUIRED ?? 'tina-liberada').toLowerCase();
const REQUIRED_TAG_ENABLED = REQUIRED_TAG && REQUIRED_TAG !== 'false' && REQUIRED_TAG !== '';
const BLOCK_TAGS = (process.env.GHL_TAG_BLOCK || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const PAUSE_TAG = (process.env.GHL_TAG_PAUSAR_TINA || 'tina-pausada').toLowerCase();
const LANE_GATE = process.env.LANE_GATE_ENABLED === 'true';
const AUTO_HUMAN = process.env.AUTO_HUMAN_DETECTION_ENABLED === 'true';
const WINDOW = `-${DAYS} days`;

function extractTags(c) {
  const raw = c?.tags || [];
  return raw.map(t => (typeof t === 'string' ? t : (t?.name || ''))).map(s => s.toLowerCase()).filter(Boolean);
}

// 1) Todos os inbounds recebidos na janela (logados ANTES dos gates)
const rows = db.prepare(`
  SELECT payload, created_at FROM events_log
  WHERE kind = 'webhook_InboundMessage' AND created_at >= datetime('now', ?)
  ORDER BY id ASC
`).all(WINDOW);

const byContact = new Map();
for (const r of rows) {
  let p; try { p = JSON.parse(r.payload); } catch { continue; }
  const cd = p.customData || {};
  const cid = cd.contactId || p.contactId || p.contact_id || p.contact?.id || p.id;
  if (!cid) continue;
  const name = p.contact?.name
    || [p.contact?.firstName, p.contact?.lastName].filter(Boolean).join(' ')
    || cd.full_name || p.full_name || '';
  if (!byContact.has(cid)) byContact.set(cid, { cid, name, count: 0 });
  const e = byContact.get(cid);
  e.count++;
  if (name && !e.name) e.name = name;
}

console.log(`\n════ DIAGNÓSTICO — inbounds dos últimos ${DAYS} dia(s) ════`);
console.log(`Whitelist: ${REQUIRED_TAG_ENABLED ? 'ON (exige "' + REQUIRED_TAG + '")' : 'OFF'} | Gate-coluna: ${LANE_GATE ? 'ON' : 'OFF'} | Detecção-humano: ${AUTO_HUMAN ? 'ON' : 'OFF'}`);
console.log(`Leads distintos que mandaram mensagem: ${byContact.size}\n`);

function respondeu(ghlId) {
  const local = db.prepare('SELECT * FROM contacts WHERE ghl_contact_id = ?').get(ghlId);
  if (!local) return { local: null, out: 0 };
  const out = db.prepare(
    `SELECT COUNT(*) c FROM messages WHERE contact_id=? AND author='ia' AND created_at >= datetime('now', ?)`
  ).get(local.id, WINDOW)?.c || 0;
  return { local, out };
}

let okCount = 0;
const naoResp = [];
for (const e of byContact.values()) {
  const { local, out } = respondeu(e.cid);
  if (out > 0) { okCount++; continue; }
  naoResp.push({ ...e, local });
}

console.log(`✅ Tina respondeu (≥1 msg):  ${okCount}`);
console.log(`❓ SEM resposta da Tina:      ${naoResp.length}\n`);

// 2) Classifica o motivo de cada não-resposta (busca as tags no GHL)
const tally = {};
for (const e of naoResp) {
  let tags = [];
  let motivo = null;
  try {
    const c = await GHL.getContact(e.cid);
    tags = extractTags(c);
    if (!e.name) e.name = c?.name || '';
  } catch {
    motivo = 'falha ao buscar contato no GHL';
  }

  const skip = db.prepare(`
    SELECT kind FROM events_log
    WHERE contact_id = (SELECT id FROM contacts WHERE ghl_contact_id = ?)
      AND kind LIKE 'skip_%' AND created_at >= datetime('now', ?)
    ORDER BY id DESC LIMIT 1
  `).get(e.cid, WINDOW)?.kind;

  if (!motivo) {
    const blk = BLOCK_TAGS.find(t => tags.includes(t));
    if (blk) motivo = `origem bloqueada (tag "${blk}")`;
    else if (tags.includes(PAUSE_TAG)) motivo = `pausada manualmente (tag "${PAUSE_TAG}")`;
    else if (REQUIRED_TAG_ENABLED && !tags.includes(REQUIRED_TAG)) motivo = `⚠ SEM a tag "${REQUIRED_TAG}" (whitelist barrou)`;
    else if (e.local?.ai_paused) motivo = 'IA pausada (SDR assumiu ou já agendou)';
    else if (skip) motivo = `gate: ${skip}`;
    else if (!e.local) motivo = '⚠ inbound recebido mas contato nem foi criado (tag/whitelist ou erro)';
    else motivo = '🔴 LIBERADO e SEM resposta — investigar (canal/erro/limite diário)';
  }

  tally[motivo] = (tally[motivo] || 0) + 1;
  console.log(`  • ${(e.name || '(sem nome)').slice(0, 26).padEnd(26)} | ${String(e.count).padStart(2)}x | ${motivo}`);
}

console.log(`\n──── resumo por motivo ────`);
Object.entries(tally).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${String(v).padStart(3)}  ${k}`));

console.log(`\n──── skips registrados no events_log (janela) ────`);
const skips = db.prepare(
  `SELECT kind, COUNT(*) c FROM events_log WHERE kind LIKE 'skip_%' AND created_at >= datetime('now', ?) GROUP BY kind ORDER BY c DESC`
).all(WINDOW);
if (skips.length) skips.forEach(s => console.log(`  ${String(s.c).padStart(3)}  ${s.kind}`));
else console.log('  (nenhum)');
console.log('');
