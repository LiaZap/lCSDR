// Monitor de leads SEM RESPOSTA (cliente falou por último e ninguém respondeu).
// Cruza nosso banco (lead falou por último) com o GHL (última msg real da
// conversa) — assim distingue "cliente largado" de "humano atendeu pelo GHL"
// (que não passa pelo nosso banco). Pausado != largado.
//
// Uso (no container do lcsdr):
//   node scripts/sem-resposta.js          → últimas 24h
//   node scripts/sem-resposta.js 6        → últimas 6h
import 'dotenv/config';
import { db } from '../src/db/index.js';
import { GHL } from '../src/ghl/client.js';

const horas = Number(process.argv[2] || 24);

const rows = db.prepare(`
  SELECT c.id, c.ghl_contact_id g, c.name n, c.phone p, c.stage s,
         MAX(CASE WHEN m.direction='inbound'  THEN m.created_at END) li,
         MAX(CASE WHEN m.direction='outbound' THEN m.created_at END) lo
  FROM contacts c JOIN messages m ON m.contact_id = c.id
  GROUP BY c.id
  HAVING li IS NOT NULL AND (lo IS NULL OR li > lo)
     AND datetime(li) >= datetime('now', '-${horas} hours')
  ORDER BY li DESC
`).all();

console.log(`\nChecando ${rows.length} conversa(s) onde o lead falou por último (últimas ${horas}h)...\n`);

const semResp = [];
let atendidos = 0;
for (const x of rows) {
  if (!x.g || String(x.g).startsWith('test')) continue;
  let lastDir = '?';
  try {
    const cv = await GHL.searchConversations(x.g);
    const conv = cv?.conversations?.[0] || cv?.[0];
    if (conv) {
      const m = await GHL.getMessages(conv.id, { limit: 1 });
      const ms = m?.messages?.messages || m?.messages || m || [];
      const lm = ms[0];
      if (lm) lastDir = (lm.direction || '?').toLowerCase();
    }
  } catch { /* falha de API → ignora este */ }

  if (lastDir === 'inbound') {
    const lm = db.prepare("SELECT content FROM messages WHERE contact_id=? AND direction='inbound' ORDER BY id DESC LIMIT 1").get(x.id);
    semResp.push({ ...x, disse: String(lm?.content || '').slice(0, 90) });
  } else if (lastDir === 'outbound') {
    atendidos++;
  }
}

console.log(`🟢 Atendidos (alguém respondeu no GHL): ${atendidos}`);
if (!semResp.length) {
  console.log('✅ Ninguém sem resposta — todos os pausados foram atendidos.\n');
} else {
  console.log(`\n🔴 ${semResp.length} SEM RESPOSTA (última msg no GHL é do cliente):\n`);
  semResp.forEach(x => console.log(`  • ${(x.n || '?')} | +${x.p} | ${x.s || '?'} | disse: ${x.disse || '(mídia/vazio)'}`));
  console.log('');
}
