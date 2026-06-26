// Responde os leads PENDENTES: mandaram mensagem e a Tina ainda NÃO respondeu
// (ficou muda enquanto a IA estava sem crédito). Reusa handleOpportunityStage
// (gera + envia + move pra IA Tina + tagueia), respeitando janela de 24h,
// cooldown e anti-loop. A Tina responde a ÚLTIMA mensagem do lead, do ponto onde
// parou.
//
// ⚠️ Com --send REALMENTE manda (1 chamada de IA + 1 envio por lead). Rode antes
// sem --send pra ver a lista. Precisa da IA COM crédito.
//
// Uso (no container do lcsdr):
//   node scripts/responder-pendentes.js          → DRY-RUN (lista os pendentes)
//   node scripts/responder-pendentes.js --send    → responde (rate-limited)
//   node scripts/responder-pendentes.js --send 48 → janela de 48h (default 24)
import 'dotenv/config';
import { db } from '../src/db/index.js';
import { GHL } from '../src/ghl/client.js';
import { handleOpportunityStage } from '../src/routes/webhook.js';

const SEND = process.argv.includes('--send');
const HOURS = Number(process.argv.find(a => /^\d+$/.test(a)) || process.env.PENDENTES_HORAS || 24);
const DELAY_MS = Number(process.env.PENDENTES_DELAY_MS || 5000);
// Janela pra considerar "humano está atendendo": se um SDR respondeu na conversa
// do GHL nas últimas N horas, NÃO responde (anti-colisão).
const HUMAN_HORAS = Number(process.env.PENDENTES_HUMAN_HORAS || 24);
const AUTO = new Set(['workflow', 'campaign', 'bulk_actions', 'bulk', 'automation']);

// Um HUMANO (SDR) respondeu recente na conversa do GHL? Olha direto no GHL —
// cobre o caso do webhook OutboundMessage NÃO estar configurado (aí a resposta
// do time não aparece no banco local). Humano = outbound com userId e source não
// automação. Falha FECHADO (erro → true → pula, pra nunca atropelar humano).
async function humanRespondeu(contactId) {
  try {
    const cv = await GHL.searchConversations(contactId);
    const conv = cv?.conversations?.[0] || cv?.[0];
    if (!conv?.id) return false;
    const m = await GHL.getMessages(conv.id, { limit: 20 });
    const ms = m?.messages?.messages || m?.messages || m || [];
    const limite = Date.now() - HUMAN_HORAS * 3600 * 1000;
    return ms.some(x => {
      if (String(x.direction || '').toLowerCase() !== 'outbound') return false;
      const uid = x.userId || x.user_id || x.sentBy?.id;
      if (!uid) return false;                                  // Tina via API = sem userId
      if (AUTO.has(String(x.source || '').toLowerCase())) return false; // workflow/automação
      const ts = new Date(x.dateAdded || x.createdAt || 0).getTime();
      return ts >= limite;                                     // humano recente
    });
  } catch { return true; } // na dúvida, PULA (não colide com humano)
}

// Leads cujo ÚLTIMO movimento foi uma mensagem do LEAD (inbound), dentro de N
// horas, e a Tina não respondeu depois (last_inbound_at > last_outbound_at).
// Pula pausados (SDR assumiu) e ids de seed/demo (com hífen).
const rows = db.prepare(`
  SELECT id, ghl_contact_id g, name, last_inbound_at, last_outbound_at
  FROM contacts
  WHERE ghl_contact_id IS NOT NULL
    AND ai_paused = 0
    AND ghl_contact_id NOT LIKE '%-%'
    AND last_inbound_at IS NOT NULL
    AND last_inbound_at >= datetime('now', ?)
    AND (last_outbound_at IS NULL OR last_inbound_at > last_outbound_at)
  ORDER BY last_inbound_at DESC
`).all(`-${HOURS} hours`);

console.log(`\n${rows.length} lead(s) PENDENTE(S) — mandaram msg nas últimas ${HOURS}h e a Tina não respondeu\n`);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const t0 = new Date().toISOString().slice(0, 19).replace('T', ' ');

let resp = 0, pulHuman = 0;
for (const r of rows) {
  // ANTI-COLISÃO: pula se um humano (SDR) respondeu recente na conversa do GHL —
  // cobre o caso do time ter respondido direto no GHL (mesmo sem o webhook
  // OutboundMessage, que atualizaria o banco local).
  if (await humanRespondeu(r.g)) {
    console.log(`  ⏭️  ${(r.name || r.g).slice(0, 26).padEnd(26)} | pula (humano respondeu)`);
    pulHuman++;
    continue;
  }
  if (SEND) {
    try {
      // Mesmo motor da continuidade: responde a última msg + move pra IA Tina + tagueia.
      await handleOpportunityStage({ type: 'IaTinaAssumir', contactId: r.g, _force: true });
      console.log(`  ▶️  ${(r.name || r.g).slice(0, 26).padEnd(26)} | respondido`);
      resp++;
      await sleep(DELAY_MS);
    } catch (e) {
      console.log(`  ❌ ${(r.name || r.g).slice(0, 26).padEnd(26)} | erro: ${e.message}`);
    }
  } else {
    console.log(`  • (dry) ${(r.name || r.g).slice(0, 26).padEnd(26)} | iria responder (último inbound: ${r.last_inbound_at})`);
  }
}

console.log(`\n──────── resumo ────────`);
console.log(`Pendentes: ${rows.length} | pulados (humano respondeu): ${pulHuman}` + (SEND ? ` | respondidos: ${resp}` : ` | iriam responder: ${rows.length - pulHuman}`));
if (SEND) {
  const ev = db.prepare(
    `SELECT kind, COUNT(*) c FROM events_log WHERE created_at >= ? AND kind IN ('ia_tina_continuation','ia_tina_fora_janela') GROUP BY kind ORDER BY c DESC`
  ).all(t0);
  console.log(`Desfecho:`);
  if (ev.length) ev.forEach(e => console.log(`   ${String(e.c).padStart(3)}  ${e.kind}`));
  else console.log('   (nenhum — provável cooldown/janela; veja os logs)');
  console.log(`\nLegenda: ia_tina_continuation = respondeu | ia_tina_fora_janela = fora das 24h (avisou o time)`);
} else {
  console.log(`\n(DRY-RUN) Rode com --send pra responder de verdade.`);
}
