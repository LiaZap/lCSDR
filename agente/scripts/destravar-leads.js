// Destrava (ai_paused=0) os leads que ficaram presos pela trava errada de
// assignedTo. PRESERVA os que estão legitimamente encaminhados (agendado,
// em atendimento ao vivo, handoff de aluno/publicação, desqualificado).
//
// Uso (no container do lcsdr): node scripts/destravar-leads.js
//   --all   → destrava TODOS os pausados (inclusive os encaminhados) [use com cuidado]
import 'dotenv/config';
import { db } from '../src/db/index.js';

const all = process.argv.includes('--all');

// stages que devem CONTINUAR pausados (encaminhamento legítimo)
const PRESERVAR = ['agendado', 'em_atendimento', 'handoff', 'desqualificado'];

const antes = db.prepare("SELECT stage, COUNT(*) c FROM contacts WHERE ai_paused = 1 GROUP BY stage ORDER BY c DESC").all();
console.log('Pausados ANTES:');
antes.forEach(r => console.log('  ' + (r.stage || 'null').padEnd(16) + ' ' + r.c));
const total = antes.reduce((s, r) => s + r.c, 0);
console.log('  total: ' + total);

let res;
if (all) {
  res = db.prepare("UPDATE contacts SET ai_paused = 0, ai_paused_at = NULL WHERE ai_paused = 1").run();
  console.log('\n[--all] Destravados TODOS: ' + res.changes);
} else {
  const placeholders = PRESERVAR.map(() => '?').join(',');
  res = db.prepare(
    `UPDATE contacts SET ai_paused = 0, ai_paused_at = NULL
     WHERE ai_paused = 1 AND (stage IS NULL OR stage NOT IN (${placeholders}))`
  ).run(...PRESERVAR);
  console.log('\nDestravados (preservando ' + PRESERVAR.join('/') + '): ' + res.changes);
}

const depois = db.prepare("SELECT COUNT(*) c FROM contacts WHERE ai_paused = 1").get().c;
console.log('Ainda pausados (encaminhados, ok): ' + depois);
