// Exporta TODAS as avaliações da equipe LC sobre conversas da Tina.
// Saída: docs/avaliacoes-equipe-lc.md (markdown organizado por verdict)
//        + docs/avaliacoes-equipe-lc.json (cru, pra processar no prompt)
//
// Uso: node scripts/export-feedback.js
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = process.env.DB_PATH || './data/lc-sdr.db';
const OUT_DIR = './docs';

if (!fs.existsSync(DB_PATH)) {
  console.error(`Banco não encontrado em ${DB_PATH}`);
  process.exit(1);
}
fs.mkdirSync(OUT_DIR, { recursive: true });

const db = new Database(DB_PATH, { readonly: true });

// Puxa avaliações + contexto (últimas N mensagens do contato + reviewer)
const rows = db.prepare(`
  SELECT
    f.id            AS feedback_id,
    f.verdict,
    f.comment,
    f.created_at    AS reviewed_at,
    c.id            AS contact_id,
    c.name          AS contact_name,
    c.phone,
    c.stage,
    c.funnel,
    c.qualification_score,
    u.name          AS reviewer_name,
    u.email         AS reviewer_email
  FROM conversation_feedback f
  JOIN contacts c   ON c.id = f.contact_id
  JOIN sdr_users u  ON u.id = f.reviewer_id
  ORDER BY f.created_at DESC
`).all();

if (rows.length === 0) {
  console.log('Nenhuma avaliação registrada ainda no banco.');
  console.log('Tabela conversation_feedback está vazia.');
  process.exit(0);
}

// Pra cada avaliação puxa as últimas 20 msgs daquele contato (contexto da avaliação)
const msgsStmt = db.prepare(`
  SELECT direction, author, content, created_at
  FROM messages
  WHERE contact_id = ?
  ORDER BY created_at DESC
  LIMIT 20
`);

const enriched = rows.map(r => ({
  ...r,
  conversation: msgsStmt.all(r.contact_id).reverse(),
}));

// === Saída JSON crua ===
fs.writeFileSync(
  path.join(OUT_DIR, 'avaliacoes-equipe-lc.json'),
  JSON.stringify(enriched, null, 2),
  'utf8'
);

// === Saída Markdown agrupada por verdict ===
const byVerdict = enriched.reduce((acc, r) => {
  (acc[r.verdict] ||= []).push(r);
  return acc;
}, {});

let md = `# Avaliações da equipe LC sobre a Tina\n\n`;
md += `Exportado em ${new Date().toISOString()} — total: **${enriched.length}** avaliações\n\n`;
md += `## Resumo\n\n`;
for (const [v, list] of Object.entries(byVerdict)) {
  md += `- **${v}**: ${list.length}\n`;
}
md += `\n---\n\n`;

for (const [verdict, list] of Object.entries(byVerdict)) {
  md += `## ${verdict.toUpperCase()} (${list.length})\n\n`;
  for (const r of list) {
    md += `### ${r.contact_name || '(sem nome)'} — ${r.phone || ''}\n`;
    md += `- **Revisor:** ${r.reviewer_name} (${r.reviewer_email})\n`;
    md += `- **Data:** ${r.reviewed_at}\n`;
    md += `- **Stage/Funnel:** ${r.stage} / ${r.funnel || '-'} (score ${r.qualification_score || 0})\n`;
    if (r.comment) md += `- **Comentário do revisor:**\n  > ${r.comment.replace(/\n/g, '\n  > ')}\n`;
    md += `\n<details><summary>Conversa (${r.conversation.length} msgs)</summary>\n\n`;
    for (const m of r.conversation) {
      const who = m.direction === 'inbound' ? '👤 lead' : (m.author === 'ia' ? '🤖 tina' : '🧑 sdr');
      md += `- **${who}** \`${m.created_at}\`: ${m.content?.slice(0, 300) || ''}\n`;
    }
    md += `\n</details>\n\n---\n\n`;
  }
}

fs.writeFileSync(path.join(OUT_DIR, 'avaliacoes-equipe-lc.md'), md, 'utf8');

console.log(`✓ ${enriched.length} avaliações exportadas:`);
console.log(`  - ${OUT_DIR}/avaliacoes-equipe-lc.md  (revisar)`);
console.log(`  - ${OUT_DIR}/avaliacoes-equipe-lc.json (alimentar prompt)`);
console.log(`\nResumo por verdict:`);
for (const [v, list] of Object.entries(byVerdict)) console.log(`  ${v}: ${list.length}`);
