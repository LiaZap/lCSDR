// Procedimento LGPD — exclusão de contato a pedido do titular dos dados.
// Art. 18, V e VI da LGPD: direito à eliminação dos dados pessoais.
//
// Uso:
//   node scripts/delete-contact-lgpd.js --phone 5511987654321
//   node scripts/delete-contact-lgpd.js --email "lead@exemplo.com.br"
//   node scripts/delete-contact-lgpd.js --id 42
//
// O CASCADE do schema cuida de:
//   - messages (DELETE ON CASCADE em contacts)
//   - appointments (idem)
//   - followups (idem)
//   - conversation_feedback (idem)
//
// O que NÃO é apagado automaticamente (precisa de step manual):
//   - GoHighLevel (apagar pelo painel da LC se aplicável)
//   - Logs gerais (events_log mantém referência por contact_id mas
//     sem dados pessoais identificáveis depois do DELETE).
//
// Imprime relatório do que foi apagado pra mandar de volta ao titular.

import 'dotenv/config';
import { db } from '../src/db/index.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--phone') out.phone = args[++i];
    else if (a === '--email') out.email = args[++i];
    else if (a === '--id') out.id = Number(args[++i]);
    else if (a === '--dry-run') out.dryRun = true;
  }
  return out;
}

const opts = parseArgs();
if (!opts.phone && !opts.email && !opts.id) {
  console.error('Uso: --phone XXXX | --email X | --id N  [--dry-run]');
  process.exit(1);
}

let where = [];
let params = [];
if (opts.id) { where.push('id = ?'); params.push(opts.id); }
if (opts.phone) { where.push('phone = ?'); params.push(opts.phone); }
if (opts.email) { where.push('email = ?'); params.push(opts.email); }

const sql = `SELECT * FROM contacts WHERE ${where.join(' OR ')}`;
const matches = db.prepare(sql).all(...params);

if (matches.length === 0) {
  console.log('Nenhum contato encontrado com esses critérios.');
  process.exit(0);
}

console.log(`\nEncontrados ${matches.length} contato(s):\n`);
for (const c of matches) {
  console.log(`  • [${c.id}] ${c.name || '(sem nome)'} · ${c.phone || '—'} · ${c.email || '—'} · stage=${c.stage}`);
}

// Conta o que cascateia
const counts = matches.map(c => ({
  contactId: c.id,
  name: c.name,
  msgs: db.prepare('SELECT COUNT(*) as n FROM messages WHERE contact_id = ?').get(c.id).n,
  appts: db.prepare('SELECT COUNT(*) as n FROM appointments WHERE contact_id = ?').get(c.id).n,
  fbs: db.prepare('SELECT COUNT(*) as n FROM conversation_feedback WHERE contact_id = ?').get(c.id).n,
  fups: db.prepare('SELECT COUNT(*) as n FROM followups WHERE contact_id = ?').get(c.id).n,
}));

console.log('\nDados que serão apagados em cascata:');
for (const c of counts) {
  console.log(`  • [${c.contactId}] ${c.msgs} mensagens, ${c.appts} appointments, ${c.fbs} feedbacks, ${c.fups} followups`);
}

if (opts.dryRun) {
  console.log('\n[DRY RUN] Nada foi apagado. Rode sem --dry-run pra confirmar.');
  process.exit(0);
}

// Confirmação interativa
console.log('\n⚠ ATENÇÃO: essa exclusão é IRREVERSÍVEL. Aperte Ctrl+C agora se não tiver certeza.');
console.log('Aguardando 5s antes de executar...');
await new Promise(r => setTimeout(r, 5000));

// Apaga (cascade no schema cuida do resto)
const deleteIds = matches.map(c => c.id);
const placeholders = deleteIds.map(() => '?').join(',');
const result = db.prepare(`DELETE FROM contacts WHERE id IN (${placeholders})`).run(...deleteIds);

console.log(`\n✓ ${result.changes} contato(s) apagado(s) — registros relacionados foram removidos via CASCADE.`);
console.log('\nLembretes pós-execução:');
console.log('  1. Apagar do GoHighLevel manualmente (se aplicável)');
console.log('  2. Confirmar via WhatsApp/email pro titular: "Conforme solicitado, seus dados foram excluídos em ' + new Date().toLocaleString('pt-BR') + '"');
console.log('  3. Registrar a exclusão num log de compliance (planilha/Notion)');
