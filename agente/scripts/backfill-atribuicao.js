// BACKFILL do rastreamento de anúncio (Click-to-WhatsApp → campos UTM).
// Varre os contatos com oportunidade aberta no pipeline Pré-Vendas LCA, lê a
// atribuição que a GHL já capturou (attributionSource) e grava nos campos UTM.
//
// Usa a MESMA função do fluxo ao vivo (enrichContactAttribution) — fonte única.
// NÍVEL 2 (campanha/conjunto por nome) entra automático se META_ADS_TOKEN estiver setado.
//
// Uso (dentro do container ou local com .env):
//   node scripts/backfill-atribuicao.js            # DRY-RUN (não grava, só mostra)
//   node scripts/backfill-atribuicao.js --send     # grava de verdade
import 'dotenv/config';
import fetch from 'node-fetch';
import { GHL } from '../src/ghl/client.js';
import { enrichContactAttribution } from '../src/agent/attribution.js';

const SEND = process.argv.includes('--send');
const B = 'https://services.leadconnectorhq.com';
const LOC = process.env.GHL_LOCATION_ID;
const PIPE = process.env.BACKFILL_PIPELINE_ID || 'MfDNcFdH03j0ZBuwJDYM'; // Pré-Vendas LCA
const H = { Authorization: 'Bearer ' + process.env.GHL_API_TOKEN, Version: (process.env.GHL_API_VERSION || '2021-07-28'), Accept: 'application/json' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

if (!process.env.GHL_API_TOKEN || !LOC) { console.error('Falta GHL_API_TOKEN / GHL_LOCATION_ID no .env'); process.exit(1); }

async function allContactIds() {
  const ids = new Set();
  for (let page = 1; page <= 25; page++) {
    const r = await fetch(`${B}/opportunities/search?location_id=${LOC}&pipeline_id=${PIPE}&status=open&limit=100&page=${page}`, { headers: H });
    if (!r.ok) break;
    const j = await r.json();
    const ops = j.opportunities || [];
    if (!ops.length) break;
    for (const o of ops) { const c = o.contactId || o.contact?.id; if (c) ids.add(c); }
    if (ops.length < 100) break;
    await sleep(250);
  }
  return [...ids];
}

console.log(`\nBackfill de atribuição — modo: ${SEND ? '🟢 GRAVANDO (--send)' : '🟡 DRY-RUN (simulação)'}`);
console.log(`Nível 2 (campanha/conjunto): ${process.env.META_ADS_TOKEN ? 'LIGADO (META_ADS_TOKEN presente)' : 'desligado (sem META_ADS_TOKEN — só Nível 1)'}\n`);

const ids = await allContactIds();
console.log(`${ids.length} contatos com opp aberta no pipeline. Processando...\n`);

const res = { total: ids.length, comAnuncio: 0, gravados: 0, semAtribuicao: 0, semCampos: 0, erro: 0 };
const amostra = [];
let done = 0;
const BATCH = 3;
for (let i = 0; i < ids.length; i += BATCH) {
  const chunk = ids.slice(i, i + BATCH);
  const rs = await Promise.all(chunk.map(cid => enrichContactAttribution(cid, { dryRun: !SEND })));
  rs.forEach((r, k) => {
    if (!r?.ok) { res.erro++; return; }
    if (r.skipped === 'sem-atribuicao-de-anuncio') { res.semAtribuicao++; return; }
    if (r.skipped === 'sem-campos-para-gravar') { res.semCampos++; return; }
    res.comAnuncio++;
    if (r.wrote || r.dryRun) res.gravados++;
    if (amostra.length < 8) amostra.push({ cid: chunk[k], nivel: r.nivel, campos: r.campos || r.wrote, adId: r.adId, names: r.names });
  });
  done += chunk.length;
  if (done % 60 === 0) process.stderr.write(`  ...${done}/${ids.length}\n`);
  await sleep(350);
}

console.log('=== RESULTADO ===');
console.log(`  contatos analisados : ${res.total}`);
console.log(`  DE ANÚNCIO (adId)   : ${res.comAnuncio}`);
console.log(`  ${SEND ? 'GRAVADOS' : 'gravaria'}            : ${res.gravados}`);
console.log(`  sem atribuição      : ${res.semAtribuicao}  (orgânico/indicação — esperado)`);
console.log(`  sem campo p/ gravar : ${res.semCampos}`);
console.log(`  erros               : ${res.erro}`);
if (amostra.length) {
  console.log('\n  amostra:');
  for (const a of amostra) console.log(`   • ${a.cid}  nível ${a.nivel}  campos:${a.campos}  adId:${a.adId}${a.names ? '  ('+[a.names.campaign,a.names.adset,a.names.ad].filter(Boolean).join(' / ')+')' : ''}`);
}
if (!SEND) console.log('\n→ DRY-RUN. Rode com --send pra gravar de verdade.');
