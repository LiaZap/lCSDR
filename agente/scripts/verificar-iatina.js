// Verifica se a Tina PUXOU pra coluna "IA Tina" os leads que ela está atendendo.
// (1) conta as opps abertas na coluna IA Tina; (2) varre o Funil Orgânico e aponta
// os leads que a Tina JÁ RESPONDEU (última saída = Tina, sem userId) mas continuam no
// Funil Orgânico = NÃO foram puxados. Só leitura, não muda nada.
//
// Uso (no container do lcsdr):  node scripts/verificar-iatina.js
import 'dotenv/config';
import fetch from 'node-fetch';
import { GHL } from '../src/ghl/client.js';

const B = 'https://services.leadconnectorhq.com';
const LOC = process.env.GHL_LOCATION_ID;
const H = { Authorization: 'Bearer ' + process.env.GHL_API_TOKEN, Version: (process.env.GHL_API_VERSION || '2021-07-28'), Accept: 'application/json' };
const ORG = 'd596db34-ada4-4e7a-936a-943a9410d9a6';   // Funil Orgânico
const IA_TINA = '74164182-d3b0-447b-a761-3bdcd6d47eac'; // IA Tina
const AUTO = new Set(['workflow', 'campaign', 'bulk_actions', 'bulk', 'automation']);

async function countStage(stageId) {
  let n = 0, page = 1, nomes = [];
  while (page <= 15) {
    const r = await fetch(`${B}/opportunities/search?location_id=${LOC}&pipeline_stage_id=${stageId}&status=open&limit=100&page=${page}`, { headers: H });
    const j = await r.json(); const ops = j.opportunities || [];
    if (!ops.length) break; n += ops.length; nomes.push(...ops); if (ops.length < 100) break; page++;
  }
  return nomes;
}

// quem falou por último na conversa: 'tina' | 'lead' | 'humano' | 'sem'
async function quemRespondeu(cid) {
  try {
    const cv = await GHL.searchConversations(cid);
    const conv = cv?.conversations?.[0] || cv?.[0];
    if (!conv?.id) return 'sem';
    const m = await GHL.getMessages(conv.id, { limit: 30 });
    let ms = (m?.messages?.messages || m?.messages || m || []).filter(x => !/ACTIVITY|OPPORTUNITY/i.test(String(x.messageType || x.type || '')) && (x.body || x.message || '').trim());
    ms.sort((a, b) => new Date(a.dateAdded || a.createdAt || 0) - new Date(b.dateAdded || b.createdAt || 0));
    if (!ms.length) return 'sem';
    const last = ms[ms.length - 1];
    if ((last.direction || '').toLowerCase() === 'inbound') return 'lead';
    const uid = last.userId || last.user_id || last.sentBy?.id;
    return (uid && !AUTO.has(String(last.source || '').toLowerCase())) ? 'humano' : 'tina';
  } catch { return 'erro'; }
}

const iaTina = await countStage(IA_TINA);
const org = await countStage(ORG);
console.log(`\n═══ VERIFICAÇÃO — coluna IA Tina x Funil Orgânico ═══`);
console.log(`Coluna IA Tina (opps abertas): ${iaTina.length}`);
console.log(`Funil Orgânico (opps abertas): ${org.length}\n`);

console.log('Varrendo Funil Orgânico (quem a Tina respondeu mas NÃO puxou)...\n');
let tinaResp = 0, esperando = 0, humano = 0, sem = 0;
const naoPuxados = [];
for (const o of org) {
  const cid = o.contactId || o.contact?.id;
  const nome = (o.contact?.name || o.name || cid || '?').slice(0, 26);
  if (!cid) continue;
  const q = await quemRespondeu(cid);
  if (q === 'tina') { tinaResp++; naoPuxados.push(nome); }
  else if (q === 'lead') esperando++;
  else if (q === 'humano') humano++;
  else sem++;
}

console.log(`──────── resultado ────────`);
console.log(`No Funil Orgânico:`);
console.log(`  🟠 Tina RESPONDEU mas continua no Funil Orgânico (NÃO puxado): ${tinaResp}`);
console.log(`  ⏳ esperando resposta: ${esperando}`);
console.log(`  👤 humano respondeu: ${humano}  |  sem msg: ${sem}`);
if (naoPuxados.length) {
  console.log(`\n  Leads que a Tina respondeu e deviam estar em IA Tina:`);
  naoPuxados.forEach(n => console.log(`    • ${n}`));
  console.log(`\n  → Se este número for >0 DEPOIS do deploy+recuperação, a Tina respondeu mas não puxou.`);
} else {
  console.log(`\n  ✅ Nenhum lead "respondido pela Tina" preso no Funil Orgânico — ela puxou todos.`);
}
