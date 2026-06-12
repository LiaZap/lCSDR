// Extrai os documentos oficiais da LC e gera um markdown único.
// Output: src/agent/knowledge-base.md (consumido pelo systemPrompt.js)
//
// Quando a LC mandar doc novo:
//   - .docx → substitui na raiz do projeto
//   - .odt  → roda antes: node scripts/convert-odt.js <arq.odt> docs/source-material/<nome>.txt
//   roda esse script, commita o knowledge-base.md gerado, deploya.
import mammoth from 'mammoth';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('..');
const OUT = './src/agent/knowledge-base.md';

// type: 'docx' (lido da raiz via mammoth) | 'text' (lido direto, ex: .txt/.md já convertido)
// legenda: nota opcional injetada ANTES do conteúdo (ex: explicar marcadores A/T/S)
const DOCS = [
  {
    type: 'text',
    file: 'agente/docs/source-material/REV1-treinamento-tina.txt',
    titulo: 'TREINAMENTO OFICIAL DA TINA — REV.1 (fonte primária, 11/06/2026)',
    legenda: [
      '**Como ler os modelos de conversa abaixo:**',
      '- `A:` = mensagem do Autor (o lead).',
      '- `T:` = resposta que a Tina deu (exemplo, pode ter erros sinalizados pela equipe).',
      '- `S:` = **SUGESTÃO da equipe LC de como a Tina DEVERIA responder**. **A linha S é o padrão-ouro.** Quando houver `S:`, siga o estilo e o conteúdo dela, NÃO o da `T:`.',
      '- `TINA-QUALIFICADO` = tag aplicada quando o lead qualifica; o SDR/Closer assume a partir daí.',
    ].join('\n'),
  },
  { type: 'docx', file: '19.05 - Exemplo de conversas.docx',     titulo: 'Exemplos de conversas reais (referência de tom)' },
  { type: 'docx', file: 'Documentação IA_ajustes.docx',          titulo: 'Documentação estratégica da Tina' },
  { type: 'docx', file: 'LC_Manual_Servicos_IA.docx',            titulo: 'Manual oficial de serviços e triagem' },
  { type: 'docx', file: 'Links úteis.docx',                      titulo: 'Links oficiais do Grupo LC' },
  { type: 'docx', file: 'Orientações rápidas para IA_TINA.docx', titulo: 'Orientações rápidas / frases prontas' },
  { type: 'docx', file: 'TAGS.docx',                             titulo: 'Tags oficiais do GHL' },
];

async function readDoc(d) {
  if (d.type === 'text') {
    // caminho relativo à raiz do repo (um nível acima de agente/)
    const full = path.resolve('..', d.file);
    if (!fs.existsSync(full)) {
      // tenta relativo ao cwd (agente/) também
      const alt = path.resolve(d.file.replace(/^agente\//, ''));
      if (fs.existsSync(alt)) return fs.readFileSync(alt, 'utf8');
      throw new Error(`não encontrado: ${full}`);
    }
    return fs.readFileSync(full, 'utf8');
  }
  // docx via mammoth, lido da raiz do projeto
  const full = path.join(ROOT, d.file);
  if (!fs.existsSync(full)) throw new Error(`não encontrado: ${full}`);
  const r = await mammoth.extractRawText({ path: full });
  return r.value || '';
}

async function main() {
  let md = `# Base de conhecimento oficial do Grupo LC\n\n`;
  md += `Compilado em: ${new Date().toISOString()}\n\n`;
  md += `> Esta base é INJETADA no system prompt da Tina. Tudo aqui é tratado como verdade oficial.\n`;
  md += `> Se houver conflito entre regras de COMPORTAMENTO do prompt e esta base, as regras de comportamento mandam no COMO falar; a base manda nos FATOS (serviços, preços-gate, links, tags).\n\n`;
  md += `---\n\n`;

  let totalChars = 0;
  for (const d of DOCS) {
    try {
      const text = (await readDoc(d)).trim().replace(/\n{3,}/g, '\n\n');
      md += `## ${d.titulo}\n`;
      md += `_(fonte: \`${d.file}\`)_\n\n`;
      if (d.legenda) md += d.legenda + '\n\n';
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
