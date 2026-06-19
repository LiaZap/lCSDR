// Varredura one-time: dispara a CONTINUIDADE da Tina pros leads que o time JÁ
// colocou na coluna "IA Tina" (sem precisar mover o card de novo nem esperar o
// webhook). Reusa o MESMO handler do webhook (handleOpportunityStage), então
// respeita anti-loop (não dispara nos que a própria Tina moveu), cooldown (12h),
// janela de 24h (lead frio → avisa o time, não manda) e roteamento.
//
// ⚠️ Com --send ele REALMENTE manda mensagem (1 chamada de LLM + 1 envio por
// lead dentro da janela de 24h). Rode primeiro sem --send pra ver a contagem.
//
// Uso (no container do lcsdr):
//   node scripts/continuar-ia-tina.js          → DRY-RUN (só lista quem está na coluna)
//   node scripts/continuar-ia-tina.js --send   → dispara a retomada (rate-limited)
import 'dotenv/config';
import fetch from 'node-fetch';
import { db } from '../src/db/index.js';
import { GHL } from '../src/ghl/client.js';
import { resolvePipeline } from '../src/ghl/opportunities.js';
import { handleOpportunityStage } from '../src/routes/webhook.js';

const SEND = process.argv.includes('--send');
const DELAY_MS = Number(process.env.CONTINUAR_DELAY_MS || 5000);
// Pula lead com outbound RECENTE (a Tina/SDR já está conversando agora) — a
// varredura é pra reviver lead PARADO, não pra cutucar conversa ativa.
const SKIP_RECENT_MS = Number(process.env.CONTINUAR_SKIP_RECENT_H || 3) * 3600_000;
const { stageIaTina } = resolvePipeline();
const B = process.env.GHL_API_BASE || 'https://services.leadconnectorhq.com';
const H = {
  Authorization: 'Bearer ' + process.env.GHL_API_TOKEN,
  Version: process.env.GHL_API_VERSION || '2021-07-28',
  Accept: 'application/json',
};

// Lista as oportunidades ABERTAS na coluna IA Tina (paginado).
async function fetchStage(stageId) {
  const out = [];
  let page = 1;
  while (page <= 20) {
    const u = `${B}/opportunities/search?location_id=${process.env.GHL_LOCATION_ID}&pipeline_stage_id=${stageId}&status=open&limit=100&page=${page}`;
    const r = await fetch(u, { headers: H });
    const j = await r.json();
    const ops = j.opportunities || [];
    if (!ops.length) break;
    out.push(...ops);
    if (ops.length < 100) break;
    page++;
  }
  return out;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Conversa ativa? (Tina/SDR mandou algo nas últimas N horas — não cutuca.)
function talkedRecently(cid) {
  const row = db.prepare('SELECT last_outbound_at FROM contacts WHERE ghl_contact_id = ?').get(cid);
  if (!row?.last_outbound_at) return false;
  const t = new Date(String(row.last_outbound_at).replace(' ', 'T') + 'Z').getTime();
  return Number.isFinite(t) && (Date.now() - t) < SKIP_RECENT_MS;
}

// Status da conversa no GHL (só pro DRY-RUN — pra você ver quem está esperando).
async function convStatus(cid) {
  try {
    const cv = await GHL.searchConversations(cid);
    const conv = cv?.conversations?.[0] || cv?.[0];
    if (!conv?.id) return 'sem conversa';
    const m = await GHL.getMessages(conv.id, { limit: 15 });
    const ms = (m?.messages?.messages || m?.messages || m || [])
      .filter(x => ['inbound', 'outbound'].includes(String(x.direction || '').toLowerCase()))
      .sort((a, b) => new Date(b.dateAdded || b.createdAt || 0) - new Date(a.dateAdded || a.createdAt || 0));
    if (!ms.length) return 'sem mensagens';
    const lastIn = ms.find(x => String(x.direction || '').toLowerCase() === 'inbound');
    if (!lastIn) return 'nunca falou (só saída)';
    const lastInMs = new Date(lastIn.dateAdded || lastIn.createdAt || 0).getTime();
    if (Date.now() - lastInMs > 24 * 3600 * 1000) return '⏰ fora 24h (avisa time)';
    const ultimaEhLead = String(ms[0].direction || '').toLowerCase() === 'inbound';
    return ultimaEhLead ? '🟢 ESPERANDO resposta (retomar)' : 'respondido (em dia)';
  } catch { return '? erro ao checar' }
}

if (!stageIaTina) { console.error('stageIaTina não resolvido (config do pipeline)'); process.exit(1); }
if (!process.env.GHL_API_TOKEN || !process.env.GHL_LOCATION_ID) { console.error('GHL_API_TOKEN/GHL_LOCATION_ID ausentes'); process.exit(1); }

const ops = await fetchStage(stageIaTina);
console.log(`\nColuna IA Tina (open): ${ops.length} oportunidade(s)\n`);

// Marca o instante (UTC, formato do SQLite) pra resumir só os eventos desta rodada.
const t0 = new Date().toISOString().slice(0, 19).replace('T', ' ');

let disparados = 0, pulados = 0;
const tally = {};
for (const o of ops) {
  const c = o.contact || {};
  const cid = o.contactId || c.id;
  const name = c.name || [c.firstName, c.lastName].filter(Boolean).join(' ') || o.name || '';
  if (!cid) { console.log(`  ⚠️  (opp ${o.id}) sem contactId, pulando`); continue; }
  const ativa = talkedRecently(cid);

  if (SEND) {
    if (ativa) {
      console.log(`  ⏭️  ${(name || cid).slice(0, 26).padEnd(26)} | pula (conversa ativa)`);
      pulados++;
      continue;
    }
    try {
      // Mesmo caminho do webhook: type dedicado + _force pra rodar sem o flag.
      await handleOpportunityStage({ type: 'IaTinaAssumir', contactId: cid, opportunityId: o.id, _force: true });
      console.log(`  ▶️  ${(name || cid).slice(0, 26).padEnd(26)} | disparado`);
      disparados++;
      await sleep(DELAY_MS);
    } catch (e) {
      console.log(`  ❌ ${(name || cid).slice(0, 26).padEnd(26)} | erro: ${e.message}`);
    }
  } else {
    // DRY-RUN: mostra o status de cada lead (quem está esperando vs respondido).
    const st = await convStatus(cid);
    tally[st] = (tally[st] || 0) + 1;
    console.log(`  ${(name || cid).slice(0, 26).padEnd(26)} | ${st}${ativa ? ' | (conversa ativa, seria pulado)' : ''}`);
  }
}

console.log(`\n──────── resumo ────────`);
if (SEND) {
  console.log(`Na coluna IA Tina: ${ops.length} | disparados: ${disparados} | pulados (conversa ativa): ${pulados}`);
  // O handler grava o DESFECHO real em events_log; resume o que rolou nesta rodada.
  const ev = db.prepare(
    `SELECT kind, COUNT(*) c FROM events_log WHERE created_at >= ? AND kind IN ('ia_tina_continuation','ia_tina_fora_janela') GROUP BY kind ORDER BY c DESC`
  ).all(t0);
  console.log(`Desfecho (events_log desta rodada):`);
  if (ev.length) ev.forEach(e => console.log(`   ${String(e.c).padStart(3)}  ${e.kind}`));
  else console.log('   (nenhum — provável cooldown/auto-movimentação; veja os logs)');
  console.log(`\nLegenda: ia_tina_continuation = retomou a conversa | ia_tina_fora_janela = lead frio >24h (avisou o time, não mandou)`);
} else {
  console.log(`Na coluna IA Tina: ${ops.length} — status da conversa:`);
  Object.entries(tally).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`   ${String(v).padStart(3)}  ${k}`));
  console.log(`\nOs 🟢 ESPERANDO são os que a retomada vai pegar (dentro de 24h e lead aguardando).`);
  console.log(`Rode com --send pra disparar.`);
}
