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
// Janela "SDR ativo": mesma regra do webhook (default 12h; SDR_ACTIVE_HOURS ou
// SDR_ACTIVE_MINUTES sobrescrevem). Se um consultor mandou msg dentro dela, pula.
const _sdrMin = Number(process.env.SDR_ACTIVE_MINUTES);
const _sdrHrs = Number(process.env.SDR_ACTIVE_HOURS);
const SDR_ACTIVE_MS =
  (Number.isFinite(_sdrMin) && _sdrMin > 0) ? _sdrMin * 60_000
  : (Number.isFinite(_sdrHrs) && _sdrHrs > 0) ? _sdrHrs * 3_600_000
  : 12 * 3_600_000;
const SDR_ACTIVE_LABEL = SDR_ACTIVE_MS >= 3_600_000 ? `${SDR_ACTIVE_MS / 3_600_000}h` : `${Math.round(SDR_ACTIVE_MS / 60_000)}min`;
const DELAY_MS = Number(process.env.RECUP_DELAY_MS || 5000);
const AUTO = new Set(['workflow', 'campaign', 'bulk_actions', 'bulk', 'automation']);

// SDR mandou msg dentro da janela de "SDR ativo" (default 12h)? Se sim, o consultor
// ainda pode estar tocando o lead → pula. Olha direto no GHL (cobre o webhook
// OutboundMessage desligado). Humano = outbound com userId e source != automação.
// Falha FECHADO (erro → true → pula, pra nunca atropelar humano).
async function sdrAtivoAgora(ghlId) {
  try {
    const cv = await GHL.searchConversations(ghlId);
    const conv = cv?.conversations?.[0] || cv?.[0];
    if (!conv?.id) return false;
    const m = await GHL.getMessages(conv.id, { limit: 20 });
    const ms = m?.messages?.messages || m?.messages || m || [];
    const limite = Date.now() - SDR_ACTIVE_MS;
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

// Diagnóstico (dry-run): mostra em QUAL funil/coluna o lead está, pra decidir se o
// pulo "fora da raia" foi certo (coluna do time) ou se é um funil de entrada que a
// Tina deveria pegar (aí é só somar o stageId em GHL_TINA_OWNED_STAGES).
const PVL = 'MfDNcFdH03j0ZBuwJDYM'; // Pré-Vendas LCA (SDR)
const STAGE_NAMES = {
  'b661d5f1-69cd-4531-8be9-79b3e11c862f': 'Reentrada', '74164182-d3b0-447b-a761-3bdcd6d47eac': 'IA Tina',
  '93eea3c5-dce9-4be0-bbd2-076e8d81308d': 'Follow Up', '568d2055-fb2c-4b47-9b40-fbe7dab084fb': 'Funil de Aplicação LCA',
  '0c040fa3-3ed5-449f-ab07-c7b3fb40f97c': 'Aguardando Atendimento', '9e03622b-2483-4215-b374-8adc1cf59b83': 'Funil DNA Best-Seller',
  'd596db34-ada4-4e7a-936a-943a9410d9a6': 'Funil Orgânico', '78bd7ebd-1b01-4326-8571-a13c69f906a2': 'Funil WhatsApp',
  'a79b9e1f-9ebd-48c9-976c-e2ebd3503317': 'Funil Hotmart', 'f65819a0-47fd-48a0-bc1a-bd038a01947c': 'Funil Social Selling',
  '09971fb3-e052-486e-8817-351b33849710': 'Funis de Aquisição', '53e5b454-d467-4f48-a34f-c9995452f72b': 'Funil Arquitetos do livro',
  '0f1d73ec-4e43-4ba4-aa30-7b1f2dae18b0': 'Proposta Enviada',
};
async function oppStagesLabel(ghlId) {
  try {
    const r = await GHL.getOpportunitiesByContact(ghlId);
    const ops = (r?.opportunities || (Array.isArray(r) ? r : [])).filter(o => String(o.status || 'open').toLowerCase() === 'open');
    if (!ops.length) return '(sem opp aberta)';
    return ops.map(o => o.pipelineId && o.pipelineId !== PVL ? '(outro pipeline)' : (STAGE_NAMES[o.pipelineStageId] || `stage:${String(o.pipelineStageId || '').slice(-6)}`)).join(' + ');
  } catch { return '(erro)'; }
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
    const detalhe = SEND ? '' : ` — está em: ${await oppStagesLabel(r.g)}`;
    console.log(`  ⏭️  ${nome} | fora da raia da Tina${detalhe}`);
    foraRaia++; continue;
  }
  if (await sdrAtivoAgora(r.g)) {
    console.log(`  ⏭️  ${nome} | SDR ativo (${SDR_ACTIVE_LABEL}) — não sobrescreve`);
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
