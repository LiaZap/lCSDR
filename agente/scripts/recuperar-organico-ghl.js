// Recupera os leads do Funil Orgânico ESPERANDO resposta, puxando DIRETO DO GHL
// (fonte de verdade) — pega inclusive os que NÃO estão no banco local (chegaram sem
// a tag tina-liberada, ou durante um apagão da IA). Diferente do recuperar-raia-tina.js,
// que filtra pelo banco local e por isso perde esses.
//
// Pra cada opp aberta no Funil Orgânico, olha a conversa no GHL: se a ÚLTIMA msg é do
// LEAD (ESPERANDO), está <24h, o lead está SÓ na raia da Tina e nenhum SDR mandou msg
// nas últimas SDR_ACTIVE_HOURS (12h) → a Tina responde CONTEXTUAL (handleOpportunityStage
// sincroniza a conversa, gera+envia, move pra IA Tina, tagueia, despausa; 12h cooldown
// interno evita duplicar). Falha FECHADO nas checagens de humano (na dúvida, pula).
//
// Uso (no container do lcsdr, IA COM crédito):
//   node scripts/recuperar-organico-ghl.js            → DRY-RUN (analisa e lista)
//   node scripts/recuperar-organico-ghl.js --send      → responde os recuperáveis
import 'dotenv/config';
import fetch from 'node-fetch';
import { GHL } from '../src/ghl/client.js';
import { handleOpportunityStage } from '../src/routes/webhook.js';

const SEND = process.argv.includes('--send');
const B = 'https://services.leadconnectorhq.com';
const LOC = process.env.GHL_LOCATION_ID;
const H = { Authorization: 'Bearer ' + process.env.GHL_API_TOKEN, Version: (process.env.GHL_API_VERSION || '2021-07-28'), Accept: 'application/json' };
const ORG = process.env.ORGANICO_STAGE_ID || 'd596db34-ada4-4e7a-936a-943a9410d9a6';
const IA_TINA = '74164182-d3b0-447b-a761-3bdcd6d47eac';
const PVL = 'MfDNcFdH03j0ZBuwJDYM';
const OWNED = new Set([ORG, IA_TINA, ...(process.env.GHL_TINA_OWNED_STAGES || '').split(',').map(s => s.trim()).filter(Boolean)]);
const AUTO = new Set(['workflow', 'campaign', 'bulk_actions', 'bulk', 'automation']);
const _h = Number(process.env.SDR_ACTIVE_HOURS); const SDR_ACTIVE_MS = (Number.isFinite(_h) && _h > 0 ? _h : 12) * 3600000;
const DELAY_MS = Number(process.env.RECUP_DELAY_MS || 6000);
const now = Date.now();
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchOrg() {
  const out = []; let page = 1;
  while (page <= 15) {
    const r = await fetch(`${B}/opportunities/search?location_id=${LOC}&pipeline_stage_id=${ORG}&status=open&limit=100&page=${page}`, { headers: H });
    const j = await r.json(); const ops = j.opportunities || [];
    if (!ops.length) break; out.push(...ops); if (ops.length < 100) break; page++;
  }
  return out;
}

// { estado: ESPERANDO|tina-respondeu|humano-respondeu|sem-msg, lastInboundH, sdrAtivo }
async function convState(cid) {
  try {
    const cv = await GHL.searchConversations(cid);
    const conv = cv?.conversations?.[0] || cv?.[0];
    if (!conv?.id) return { estado: 'sem-conversa' };
    const m = await GHL.getMessages(conv.id, { limit: 30 });
    let ms = (m?.messages?.messages || m?.messages || m || []).filter(x => !/ACTIVITY|OPPORTUNITY/i.test(String(x.messageType || x.type || '')) && (x.body || x.message || '').trim());
    ms.sort((a, b) => new Date(a.dateAdded || a.createdAt || 0) - new Date(b.dateAdded || b.createdAt || 0));
    if (!ms.length) return { estado: 'sem-msg' };
    const last = ms[ms.length - 1];
    const lastIn = [...ms].reverse().find(x => (x.direction || '').toLowerCase() === 'inbound');
    const lastInboundH = lastIn ? Math.round((now - new Date(lastIn.dateAdded || lastIn.createdAt || 0).getTime()) / 3600000) : null;
    const limite = now - SDR_ACTIVE_MS;
    const sdrAtivo = ms.some(x => {
      const uid = x.userId || x.user_id || x.sentBy?.id;
      if ((x.direction || '').toLowerCase() !== 'outbound' || !uid) return false;
      if (AUTO.has(String(x.source || '').toLowerCase())) return false;
      return new Date(x.dateAdded || x.createdAt || 0).getTime() >= limite;
    });
    const dir = (last.direction || '').toLowerCase();
    if (dir !== 'inbound') {
      const uid = last.userId || last.user_id || last.sentBy?.id;
      return { estado: uid && !AUTO.has(String(last.source || '').toLowerCase()) ? 'humano-respondeu' : 'tina-respondeu', lastInboundH, sdrAtivo };
    }
    return { estado: 'ESPERANDO', lastInboundH, sdrAtivo };
  } catch (e) { return { estado: 'erro' }; }
}

// o contato tem opp aberta FORA da raia da Tina?
async function foraDaRaia(cid) {
  try {
    const r = await GHL.getOpportunitiesByContact(cid);
    const ops = (r?.opportunities || []).filter(o => String(o.status || 'open').toLowerCase() === 'open');
    return ops.some(o => (o.pipelineId && o.pipelineId !== PVL) || !OWNED.has(o.pipelineStageId));
  } catch { return true; } // dúvida → considera fora (não toca)
}

const ops = await fetchOrg();
console.log(`\n═══ Funil Orgânico: ${ops.length} opp(s) aberta(s) — ${SEND ? 'MODO ENVIO' : 'DRY-RUN'} ═══\n`);
const t0 = new Date().toISOString().slice(0, 19).replace('T', ' ');
let esperando = 0, resp = 0, multiOpp = 0, fora24 = 0, sdrAt = 0, outros = 0;

for (const o of ops) {
  const cid = o.contactId || o.contact?.id;
  const nome = (o.contact?.name || o.name || cid || '?').slice(0, 24).padEnd(24);
  if (!cid) continue;
  const cs = await convState(cid);
  if (cs.estado !== 'ESPERANDO') { outros++; continue; }
  esperando++;
  if (cs.lastInboundH != null && cs.lastInboundH > 24) { console.log(`  ⏰ ${nome} | fora das 24h (${cs.lastInboundH}h) — Meta bloqueia`); fora24++; continue; }
  if (cs.sdrAtivo) { console.log(`  ⏭️  ${nome} | SDR ativo (<${SDR_ACTIVE_MS / 3600000}h) — não sobrescreve`); sdrAt++; continue; }
  if (await foraDaRaia(cid)) { console.log(`  ⏭️  ${nome} | negócio vivo em outra coluna`); multiOpp++; continue; }
  if (SEND) {
    try {
      await handleOpportunityStage({ type: 'IaTinaAssumir', contactId: cid, _force: true });
      console.log(`  ▶️  ${nome} | respondido (esperava ${cs.lastInboundH}h)`);
      resp++;
      await sleep(DELAY_MS);
    } catch (e) { console.log(`  ❌ ${nome} | erro: ${e.message}`); }
  } else {
    console.log(`  ✅ ${nome} | RECUPERÁVEL (esperando ${cs.lastInboundH}h)`);
    resp++;
  }
}

console.log(`\n──────── resumo ────────`);
console.log(`Total Funil Orgânico: ${ops.length} | já respondido/humano/sem-msg: ${outros}`);
console.log(`Esperando: ${esperando} → ${SEND ? 'respondidos' : 'recuperáveis'}: ${resp} | multi-opp: ${multiOpp} | SDR ativo: ${sdrAt} | fora 24h: ${fora24}`);
if (SEND) {
  console.log(`\nLegenda: ia_tina_continuation = respondeu | ia_tina_fora_janela = avisou o time (>24h)`);
} else {
  console.log(`\n(DRY-RUN) Rode com --send pra responder de verdade.`);
}
