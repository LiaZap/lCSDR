// Recupera (manual) os leads do Funil Orgânico ESPERANDO resposta, puxando DIRETO
// do GHL. Usa o MESMO módulo da varredura automática do scheduler (src/agent/
// organicoSweep.js) — guardas em fonte única, sem divergir. Pega inclusive os leads
// que NÃO estão no banco local (chegaram sem tag/durante apagão), que o
// recuperar-raia-tina.js (base local) perde.
//
// Responde só quem está: ESPERANDO, <24h, EXCLUSIVAMENTE na raia da Tina e sem SDR
// ativo (SDR_ACTIVE_HOURS, default 12h). Idempotente (cooldown 12h).
//
// Uso (no container do lcsdr, IA COM crédito):
//   node scripts/recuperar-organico-ghl.js            → DRY-RUN (lista os elegíveis)
//   node scripts/recuperar-organico-ghl.js --send      → responde de verdade
import 'dotenv/config';
import { sweepOrganico } from '../src/agent/organicoSweep.js';
import { handleOpportunityStage } from '../src/routes/webhook.js';

const SEND = process.argv.includes('--send');
const MAX = Math.max(1, Number(process.env.RECUP_MAX) || 999); // manual: responde todos

console.log(`\n═══ Recuperação Funil Orgânico (${SEND ? 'ENVIO' : 'DRY-RUN'}) ═══\n`);
const r = await sweepOrganico({
  send: SEND,
  max: MAX,
  respondFn: (cid) => handleOpportunityStage({ type: 'IaTinaAssumir', contactId: cid, _force: true }),
});

if (!SEND && r.elegiveis.length) {
  console.log('Elegíveis (seriam respondidos):');
  r.elegiveis.forEach(e => console.log(`  ✅ ${e.nome}`));
  console.log('');
}
console.log('──────── resumo ────────');
console.log(`Total no Funil Orgânico: ${r.total}`);
console.log(`Esperando resposta: ${r.esperando}`);
console.log(`  ✅ ${SEND ? 'respondidos' : 'elegíveis'}: ${SEND ? r.respondidos : r.elegiveis.length}`);
console.log(`  ⛔ fora da raia (negócio vivo em outra coluna): ${r.foraRaia}`);
console.log(`  ⏭️  SDR ativo (não sobrescreve): ${r.sdrAtivo}`);
console.log(`  ⏰ fora das 24h (Meta — toque manual do time): ${r.fora24h}`);
if (!SEND) console.log('\n(DRY-RUN) Rode com --send pra responder de verdade.');
console.log('');
