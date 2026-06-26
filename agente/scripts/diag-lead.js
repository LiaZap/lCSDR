// Diagnóstico de UM lead: estado local + mensagens + eventos — pra entender
// EXATAMENTE por que a Tina respondeu ou não esse lead.
//
// Uso (no container):  node scripts/diag-lead.js "<parte do nome ou telefone>"
//   ex: node scripts/diag-lead.js Eufrazio      |   node scripts/diag-lead.js 96480
import 'dotenv/config';
import { db } from '../src/db/index.js';

const q = (process.argv[2] || '').trim();
if (!q) { console.error('Passe parte do nome ou do telefone. Ex: node scripts/diag-lead.js Eufrazio'); process.exit(1); }

const contacts = db.prepare(
  `SELECT * FROM contacts WHERE name LIKE ? OR phone LIKE ? ORDER BY updated_at DESC LIMIT 5`
).all(`%${q}%`, `%${q}%`);

if (!contacts.length) {
  console.log(`\nNenhum contato LOCAL com "${q}".`);
  console.log('→ Se o lead existe no GHL mas não aqui, a Tina foi barrada ANTES de gravar');
  console.log('  (whitelist sem tag, origem bloqueada, pausa) OU o webhook de inbound não chegou.\n');
  process.exit(0);
}

for (const c of contacts) {
  console.log(`\n══════ ${c.name || '(sem nome)'}  (${c.phone || 's/ fone'}) ══════`);
  console.log(`stage=${c.stage}  ai_paused=${c.ai_paused}  funnel=${c.funnel || '-'}`);
  console.log(`last_inbound_at = ${c.last_inbound_at || '—'}`);
  console.log(`last_outbound_at= ${c.last_outbound_at || '—'}  (se < last_inbound → a Tina ainda DEVE resposta)`);

  const msgs = db.prepare(
    `SELECT direction, author, substr(content,1,55) c, created_at FROM messages WHERE contact_id=? ORDER BY id DESC LIMIT 8`
  ).all(c.id);
  console.log('  ── últimas mensagens (local) ──');
  if (msgs.length) msgs.forEach(m => console.log(`   ${m.created_at}  ${m.direction}/${m.author}: ${m.c}`));
  else console.log('   (nenhuma mensagem local gravada → barrada antes do recordInbound)');

  const evs = db.prepare(
    `SELECT kind, created_at FROM events_log WHERE contact_id=? ORDER BY id DESC LIMIT 8`
  ).all(c.id);
  console.log('  ── eventos (local) ──');
  if (evs.length) evs.forEach(e => console.log(`   ${e.created_at}  ${e.kind}`));
  else console.log('   (nenhum)');
}
console.log('');
