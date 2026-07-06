// Testa o CANAL de envio do GHL (SMS x WhatsApp) ANTES de trocar em produção.
// Manda UMA mensagem pro contato informado e mostra a resposta do GHL. Depois você
// confere se chegou no WhatsApp do contato + apareceu na conversa do GHL.
//
// ⚠️ Manda mensagem REAL — use um contato SEU / de teste, NUNCA um lead de verdade.
//
// Como pegar o contactId: abre o contato no GHL e copia da URL
//   .../contacts/detail/<CONTACT_ID>
//
// Uso:
//   node scripts/test-canal-ghl.js <contactId> "mensagem de teste" SMS
//   node scripts/test-canal-ghl.js <contactId> "mensagem de teste" WhatsApp
import 'dotenv/config';
import { GHL } from '../src/ghl/client.js';

const cid = process.argv[2];
const msg = process.argv[3] || 'Teste de canal da Tina (pode ignorar) ✅';
const type = process.argv[4] || 'SMS';

if (!cid) {
  console.error('Uso: node scripts/test-canal-ghl.js <contactId> "mensagem" [SMS|WhatsApp]');
  process.exit(1);
}
if (!process.env.GHL_API_TOKEN) { console.error('GHL_API_TOKEN ausente no .env'); process.exit(1); }

console.log(`\nEnviando pro contato ${cid} via type="${type}"...\n`);
try {
  const r = await GHL.sendMessage({ contactId: cid, message: msg, type });
  console.log('✅ GHL ACEITOU. Resposta:', JSON.stringify(r).slice(0, 400));
  console.log('\n→ Agora confere: (1) chegou no WhatsApp do contato? (2) apareceu na conversa dele no GHL?');
  console.log('  Se chegou no WhatsApp com type=SMS, o canal "SMS" está apontando pro WhatsApp Business (ok pra trocar).');
} catch (e) {
  console.error('❌ FALHOU:', e.message);
  if (e.body) console.error('   detalhe:', JSON.stringify(e.body).slice(0, 400));
  console.error('\n  Se deu erro de canal/conexão, o "SMS" ainda não está conectado ao WhatsApp Business no GHL.');
}
