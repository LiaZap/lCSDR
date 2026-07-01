// Recupera os leads da RAIA da Tina (Funil Orgânico / IA Tina) que ficaram SEM
// RESPOSTA — mandaram mensagem e a Tina não respondeu, INCLUSIVE os que ficaram
// PAUSADOS por um 1º toque de consultor (durante os deploys/ajustes). Responde
// CONTEXTUAL: reusa handleOpportunityStage (sincroniza a conversa do GHL, respeita
// a janela de 24h + cooldown + anti-loop, gera+envia, move pra IA Tina, tagueia,
// despausa). Diferente do responder-pendentes.js, que PULA pausados e usa janela
// longa de humano — aqui o alvo são justamente os travados pelo opener do consultor.
//
// Anti-colisão (MESMA regra do webhook novo):
//   - só leads EXCLUSIVAMENTE na raia da Tina (contactExclusivelyInTinaLane) —
//     lead com negócio vivo em Proposta/Follow Up/outro pipeline NÃO é tocado;
//   - PULA se um SDR mandou msg nos últimos SDR_ACTIVE_MINUTES (default 15) —
//     não sobrescreve consultor atendendo agora. Ambas falham FECHADO (na dúvida, pula).
//
// Uso (no container do lcsdr, IA COM crédito):
//   node scripts/recuperar-raia-tina.js            → DRY-RUN (lista)
//   node scripts/recuperar-raia-tina.js --send      → responde (rate-limited)
//   node scripts/recuperar-raia-tina.js --send 48   → janela de 48h (default 24)
import 'dotenv/config';
import { db } from '../src/db/index.js';
import { GHL } from '../src/ghl/client.js';
import { handleOpportunityStage } from '../src/routes/webhook.js';
import { contactExclusivelyInTinaLane } from '../src/ghl/opportunities.js';

const SEND = process.argv.includes('--send');
const HOURS = Number(process.argv.find(a => /^\d+$/.test(a)) || process.env.RECUP_HORAS || 24);
const SDR_ACTIVE_MIN = Math.max(1, Number(process.env.SDR_ACTIVE_MINUTES) || 15);
const DELAY_MS = Number(process.env.RECUP_DELAY_MS || 5000);
const AUTO = new Set(['workflow', 'campaign', 'bulk_actions', 'bulk', 'automation']);

// SDR mandou msg nos últimos SDR_ACTIVE_MIN min? (janela curta = "atendendo agora").
// Olha direto no GHL (cobre o caso do webhook OutboundMessage não estar ligado).
// Humano = outbound com userId e source != automação. Falha FECHADO (erro → true → pula).
async function sdrAtivoAgora(ghlId) {
  try {
    const cv = await GHL.searchConversations(ghlId);
    const conv = cv?.conversations?.[0] || cv?.[0];
    if (!conv?.id) return false;
    const m = await GHL.getMessages(conv.id, { limit: 20 });
    const ms = m?.messages?.messages || m?.messages || m || [];
    const limite = Date.now() - SDR_ACTIVE_MIN * 60 * 1000;
    return ms.some(x => {
      if (String(x.direction || '').toLowerCase() !== 'outbound') return false;
      const uid = x.userId || x.user_id || x.sentBy?.id;
      if (!uid) return false;                                   // Tina via API = sem userId
      if (AUTO.has(String(x.source || '').toLowerCase())) return false;
      const ts = new Date(x.dateAdded || x.createdAt || 0).getTime();
      return ts >= limite;
    });
  } catch { return true; } // na dúvida, PULA (não atropela humano)
}

// Leads cujo ÚLTIMO movimento foi msg do lead (inbound sem resposta), dentro de N
// horas. INCLUI pausados (ai_paused=1). Fecha fora desqualificado/agendado/qualificado.
const rows = db.prepare(`
  SELECT id, ghl_contact_id g, name, ai_paused, stage, last_inbound_at, last_outbound_at
  FROM contacts
  WHERE ghl_contact_id IS NOT NULL
    AND ghl_contact_id NOT LIKE '%-%'
    AND ghl_contact_id NOT LIKE 'playground-%'
    AND stage NOT IN ('desqualificado','agendado','qualificado')
    AND last_inbound_at IS NOT NULL
    AND last_inbound_at >= datetime('now', ?)
    AND (last_outbound_at IS NULL OR last_inbound_at > last_outbound_at)
  ORDER BY last_inbound_at DESC
`).all(`-${HOURS} hours`);

console.log(`\n${rows.length} lead(s) sem resposta nas últimas ${HOURS}h (inclui pausados). Filtrando raia da Tina...\n`);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const t0 = new Date().toISOString().slice(0, 19).replace('T', ' ');
let resp = 0, foraRaia = 0, sdrAtivo = 0;

for (const r of rows) {
  const nome = (r.name || r.g).slice(0, 26).padEnd(26);
  if (!(await contactExclusivelyInTinaLane({ id: r.id, ghl_contact_id: r.g }))) {
    console.log(`  ⏭️  ${nome} | fora da raia da Tina (negócio vivo em outra coluna)`);
    foraRaia++; continue;
  }
  if (await sdrAtivoAgora(r.g)) {
    console.log(`  ⏭️  ${nome} | SDR ativo (${SDR_ACTIVE_MIN}min) — não sobrescreve`);
    sdrAtivo++; continue;
  }
  if (SEND) {
    try {
      // Mesmo motor da continuidade: responde a última msg do ponto onde parou,
      // respeitando 24h/cooldown, move pra IA Tina, tagueia e despausa.
      await handleOpportunityStage({ type: 'IaTinaAssumir', contactId: r.g, _force: true });
      console.log(`  ▶️  ${nome} | respondido${r.ai_paused ? ' (estava pausado)' : ''}`);
      resp++;
      await sleep(DELAY_MS);
    } catch (e) {
      console.log(`  ❌ ${nome} | erro: ${e.message}`);
    }
  } else {
    console.log(`  • (dry) ${nome} | iria responder${r.ai_paused ? ' (pausado)' : ''} — inbound ${r.last_inbound_at}`);
  }
}

console.log(`\n──────── resumo ────────`);
console.log(`Candidatos: ${rows.length} | fora da raia: ${foraRaia} | SDR ativo (pulados): ${sdrAtivo}`
  + (SEND ? ` | respondidos: ${resp}` : ` | iriam responder: ${rows.length - foraRaia - sdrAtivo}`));
if (SEND) {
  const ev = db.prepare(
    `SELECT kind, COUNT(*) c FROM events_log WHERE created_at >= ? AND kind IN ('ia_tina_continuation','ia_tina_fora_janela') GROUP BY kind ORDER BY c DESC`
  ).all(t0);
  console.log(`Desfecho:`);
  if (ev.length) ev.forEach(e => console.log(`   ${String(e.c).padStart(3)}  ${e.kind}`));
  else console.log('   (nenhum — provável cooldown/janela fechada; veja os logs)');
  console.log(`\nLegenda: ia_tina_continuation = respondeu | ia_tina_fora_janela = fora das 24h (avisou o time)`);
} else {
  console.log(`\n(DRY-RUN) Rode com --send pra responder de verdade.`);
}
