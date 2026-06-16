// Linka os usuários locais (sdr_users) com os GHL user IDs, casando por e-mail.
// Necessário pra detecção automática de humano (lastOutboundWasHuman /
// handleSDRReply) reconhecer quando um consultor respondeu pelo GHL.
//
// Puxa a lista de usuários do GHL (API), e pra cada um que tenha e-mail
// igual a um sdr_users, grava o ghl_user_id. Idempotente.
//
// Uso (no container do lcsdr): node scripts/link-ghl-users.js
import 'dotenv/config';
import { db } from '../src/db/index.js';
import { GHL } from '../src/ghl/client.js';

async function main() {
  if (!process.env.GHL_API_TOKEN) { console.error('❌ GHL_API_TOKEN ausente'); process.exit(1); }

  const resp = await GHL.listUsers();
  const users = resp?.users || resp || [];
  if (!users.length) { console.error('❌ nenhum usuário GHL retornado'); process.exit(1); }

  const upd = db.prepare('UPDATE sdr_users SET ghl_user_id = ? WHERE lower(email) = lower(?)');
  let linked = 0;
  const semMatch = [];

  for (const u of users) {
    const email = (u.email || '').trim();
    if (!email) continue;
    const r = upd.run(u.id, email);
    if (r.changes > 0) {
      linked++;
      console.log(`✓ ${u.name || email}  →  ghl_user_id=${u.id}`);
    } else {
      semMatch.push(`${u.name || '?'} <${email}>`);
    }
  }

  console.log(`\n✅ ${linked} usuários locais linkados ao GHL.`);
  if (semMatch.length) {
    console.log(`\nUsuários GHL SEM correspondente local (ok, não atendem pela Tina):`);
    semMatch.slice(0, 40).forEach(s => console.log('  - ' + s));
  }

  // Mostra quem dos sdr_users ficou COM e SEM ghl_user_id
  const locais = db.prepare('SELECT name, email, ghl_user_id FROM sdr_users').all();
  const semId = locais.filter(l => !l.ghl_user_id);
  console.log(`\nsdr_users com ghl_user_id: ${locais.length - semId.length}/${locais.length}`);
  if (semId.length) {
    console.log('Sem ghl_user_id (detecção de humano não vai reconhecer):');
    semId.forEach(l => console.log(`  - ${l.name} <${l.email}>`));
  }
}

main().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
