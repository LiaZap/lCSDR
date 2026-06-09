// Extrai os .docx oficiais da LC e gera um markdown único.
// Output: src/agent/knowledge-base.md (consumido pelo systemPrompt.js)
//
// Quando a LC mandar doc novo: substitui o .docx aqui, roda esse script,
// commita o knowledge-base.md gerado, deploya. Sem mexer em código.
import mammoth from 'mammoth';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('..');
const OUT = './src/agent/knowledge-base.md';

const DOCS = [
  { file: '19.05 - Exemplo de conversas.docx',         titulo: 'Exemplos de conversas reais (referência de tom)' },
  { file: 'Documentação IA_ajustes.docx',              titulo: 'Documentação estratégica da Tina' },
  { file: 'LC_Manual_Servicos_IA.docx',                titulo: 'Manual oficial de serviços e triagem' },
  { file: 'LILA_Treinamento_Completo_1.docx',          titulo: 'Treinamento completo da Tina (fonte primária)' },
  { file: 'Links úteis.docx',                          titulo: 'Links oficiais do Grupo LC' },
  { file: 'Orientações rápidas para IA_TINA.docx',     titulo: 'Orientações rápidas / frases prontas' },
  { file: 'TAGS.docx',                                 titulo: 'Tags oficiais do GHL' },
];

async function main() {
  let md = `# Base de conhecimento oficial do Grupo LC\n\n`;
  md += `Compilado em: ${new Date().toISOString()}\n`;
  md += `Documentos fonte (.docx) mantidos em: ${ROOT}\n\n`;
  md += `> Esta base é INJETADA no system prompt da Tina. Tudo aqui é tratado como verdade oficial.\n`;
  md += `> Se houver conflito entre regras do prompt e esta base, **a base oficial PREVALECE**.\n\n`;
  md += `---\n\n`;

  let totalChars = 0;
  for (const d of DOCS) {
    const full = path.join(ROOT, d.file);
    if (!fs.existsSync(full)) {
      console.warn(`⚠ Arquivo não encontrado: ${full}, pulando.`);
      continue;
    }
    try {
      const r = await mammoth.extractRawText({ path: full });
      const text = (r.value || '').trim().replace(/\n{3,}/g, '\n\n');
      md += `## ${d.titulo}\n`;
      md += `_(fonte: \`${d.file}\`)_\n\n`;
      md += text + '\n\n---\n\n';
      totalChars += text.length;
      console.log(`✓ ${d.file}, ${text.length} chars`);
    } catch (e) {
      console.error(`✗ ${d.file}, ERRO: ${e.message}`);
    }
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, md, 'utf8');
  console.log(`\n✓ Knowledge base salva em ${OUT}`);
  console.log(`  Total: ${totalChars} chars, ~${Math.ceil(totalChars / 4)} tokens`);
}
main().catch(e => { console.error(e); process.exit(1); });
