// Testa o envio de aviso pro grupo do time via uazapi (sem esperar agendamento).
// Uso (no container do lcsdr, com UAZAPI_TOKEN + UAZAPI_NOTIFY_GROUP no .env):
//   node scripts/test-notify-grupo.js
import 'dotenv/config';
import { UAZAPI } from '../src/uazapi/client.js';

const group = process.env.UAZAPI_NOTIFY_GROUP;
if (!group) { console.error('❌ UAZAPI_NOTIFY_GROUP ausente no .env'); process.exit(1); }
if (!process.env.UAZAPI_TOKEN) { console.error('❌ UAZAPI_TOKEN ausente no .env'); process.exit(1); }

console.log('Enviando teste pro grupo:', group, '\nvia', process.env.UAZAPI_BASE || 'https://liaautomacoes.uazapi.com');

const msg = '✅ Teste Tina — aviso no grupo funcionando. (mensagem de teste, pode ignorar)';
try {
  const r = await UAZAPI.sendText(group, msg);
  console.log('\n✅ Enviado! Resposta uazapi:', JSON.stringify(r).slice(0, 400));
} catch (err) {
  console.error('\n❌ Falhou:', err.message);
  if (err.body) console.error('   detalhe:', JSON.stringify(err.body).slice(0, 400));
  console.error('\nChecar: (1) número do token está DENTRO do grupo? (2) JID certo? (3) token certo?');
}
