// Roda o prompt da Tina contra cenários críticos das avaliações da equipe LC.
// SEM banco, SEM webhook, SEM GHL. Só OpenAI + prompt.
//
// Uso:
//   1. Define OPENAI_API_KEY no .env do agente
//   2. cd agente
//   3. node scripts/test-prompt-local.js
//
// Saída: docs/teste-prompt-output.md com cada cenário + resposta da Tina.
import 'dotenv/config';
import OpenAI from 'openai';
import fs from 'node:fs';
import path from 'node:path';
import { TINA_SYSTEM_PROMPT, PROMPT_VERSION } from '../src/agent/systemPrompt.js';

if (!process.env.OPENAI_API_KEY) {
  console.error('Erro: defina OPENAI_API_KEY no .env');
  process.exit(1);
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 25_000 });
const MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

// === Cenários extraídos das avaliações da equipe LC ===
const CENARIOS = [
  {
    nome: 'C01 - Lead sem dinheiro (Pedro desempregado)',
    avaliacao_referencia: 'feedback #15 (Brenda) + #23/#24/#30/#104/#105 (Andressa)',
    contato: { name: 'Pedro', funnel: null, stage: 'novo', qualification_notes: null },
    turnos: [
      { lead: 'Quero publicar mas não tenho dinheiro nenhum agora.' },
      { lead: 'Tô desempregado, tem alguma coisa de graça?' },
    ],
    validar: [
      'NÃO deve encerrar conversa',
      'DEVE oferecer Curso Escritores Admiráveis ANTES do livro',
      'DEVE indicar redes Lilian/LC (gratuitas) e livro como ponte',
      'DEVE terminar com pergunta',
      'NÃO deve elogiar vazio',
    ],
  },
  {
    nome: 'C02 - Lead hostil "é golpe" (Roberta)',
    avaliacao_referencia: 'feedback #14/#28/#33/#39 (Brenda + Andressa)',
    contato: { name: 'Roberta', funnel: null, stage: 'novo', qualification_notes: null },
    turnos: [
      { lead: 'Para de me mandar mensagem isso é golpe!' },
    ],
    validar: [
      'NÃO deve encerrar de cara',
      'DEVE apresentar LC como maior agência de MKT Literário',
      'DEVE mandar redes/site como prova social',
      'DEVE reabrir conversa com pergunta',
    ],
  },
  {
    nome: 'C03 - Projeto pessoal (Ana receitas pra família)',
    avaliacao_referencia: 'feedback #12/#13/#29/#87 (Lilian + Bruna + Andressa)',
    contato: { name: 'Ana', funnel: null, stage: 'novo', qualification_notes: null },
    turnos: [
      { lead: 'Oi! Quero fazer um livrinho de receitas só pra família.' },
    ],
    validar: [
      'DEVE explicar que LC trabalha com projetos profissionais',
      'DEVE oferecer ponte: Curso EA + LC Books',
      'NÃO deve encerrar',
      'NÃO deve elogiar vazio',
    ],
  },
  {
    nome: 'C04 - Lead com livro publicado pede assessoria (Roberto Amazon)',
    avaliacao_referencia: 'feedback #11/#48/#77/#91/#92 (Brenda + Andressa)',
    contato: { name: 'Roberto', funnel: null, stage: 'novo', qualification_notes: null },
    turnos: [
      { lead: 'Oi! Lancei meu livro de negócios mês passado na Amazon. Quero divulgar pra mídia, sair em revista, podcast.' },
    ],
    validar: [
      'NÃO deve diferenciar Master LC vs Press LC',
      'DEVE pedir link de vendas do livro',
      'DEVE pedir @ do Instagram',
      'NÃO deve perguntar se está publicado (ele já disse Amazon)',
      'NÃO deve citar Globo/CNN/Folha/Veja',
      'DEVE falar em "Assessoria de Imprensa" + "grandes veículos"',
    ],
  },
  {
    nome: 'C05 - Lead "vale a pena pra mim?" (Acácio oficial)',
    avaliacao_referencia: 'feedback #8/#10 (Victor)',
    contato: { name: 'Acácio', funnel: 'escrever', stage: 'qualificando', qualification_notes: 'oficial de justiça, ideia sobre carreira pública, trava na escrita' },
    turnos: [
      { lead: 'Sou oficial de justiça e tenho ideia de livro sobre carreira pública.' },
      { tina: '[contexto anterior: pergunta sobre EA]' },
      { lead: 'Vale a pena pra alguém como eu?' },
    ],
    validar: [
      'DEVE responder a pergunta dele PRIMEIRO ("Com certeza, vai da escrita à venda")',
      'DEPOIS apresentar o curso',
      'DEVE terminar com pergunta',
    ],
  },
  {
    nome: 'C06 - Lead direto ao preço',
    avaliacao_referencia: 'feedback #16/#38/#86 (Brenda + Andressa)',
    contato: { name: 'Felipe', funnel: 'publicar', stage: 'novo', qualification_notes: null },
    turnos: [
      { lead: 'Quanto custa pra publicar? Me diz só o valor.' },
      { lead: 'Não quero conversar com ninguém, só preço.' },
    ],
    validar: [
      'NÃO deve usar "custo" (deve usar "investimento")',
      'DEVE oferecer 2 opções: arquivo PDF pra análise OU info básica pra orçamento',
      'NÃO deve encerrar',
      'PODE mencionar piso de investimento LC Books a partir de 50k',
    ],
  },
  {
    nome: 'C07 - Lead "trava" na escrita (Mentoria Arquitetos)',
    avaliacao_referencia: 'feedback #49/#78 (Andressa)',
    contato: { name: 'Acácio', funnel: 'escrever', stage: 'qualificando', qualification_notes: null },
    turnos: [
      { lead: 'Sou oficial de justiça e tenho ideia de livro sobre carreira pública.' },
      { lead: 'Não sei se vou conseguir escrever, sempre travo.' },
    ],
    validar: [
      'DEVE validar que travar é comum',
      'DEVE oferecer Mentoria Arquitetos do Livro (escrita em grupo ao vivo)',
      'DEVE terminar com pergunta',
    ],
  },
  {
    nome: 'C08 - Lead aluno do curso com dúvida',
    avaliacao_referencia: 'feedback #93/#94/#103 (Andressa)',
    contato: { name: 'Camila', funnel: null, stage: 'novo', qualification_notes: null },
    turnos: [
      { lead: 'Oi, sou aluna do curso Escritores Admiráveis e estou com dificuldade pra acessar uma aula.' },
    ],
    validar: [
      'DEVE direcionar pro e-mail cursos@lcagencia.com.br',
      'DEVE setar course_help: "aluno"',
      'DEVE setar end_conversation: true',
    ],
  },
  {
    nome: 'C09 - Apresentação obrigatória (primeiro contato sem nome)',
    avaliacao_referencia: 'feedback #42/#95/#105 (Andressa)',
    contato: { name: null, funnel: null, stage: 'novo', qualification_notes: null },
    turnos: [
      { lead: 'oi' },
    ],
    validar: [
      'DEVE se apresentar: "Aqui é a Tina, especialista do Grupo LC"',
      'NÃO deve usar "Dr." nem "Dra."',
      'DEVE terminar com pergunta',
    ],
  },
  {
    nome: 'C10 - Lead religioso (case Café com Deus Pai)',
    avaliacao_referencia: 'feedback #58/#89 (Andressa)',
    contato: { name: 'Daniel', funnel: 'publicar', stage: 'novo', qualification_notes: null },
    turnos: [
      { lead: 'Sou pastor evangélico, escrevi um livro devocional. Quero estrutura editorial profissional.' },
    ],
    validar: [
      'PODE mencionar case Café com Deus Pai',
      'DEVE pedir arquivo PDF do livro',
      'DEVE explicar LC Books + investimento',
      'DEVE terminar com pergunta',
    ],
  },
];

async function runScenario(c) {
  console.log(`\n[${c.nome}]`);
  const meta = `
Contexto atual do lead (NÃO responda sobre isso, só use pra calibrar):
- Nome: ${c.contato.name || '⚠ AINDA NÃO CONHECIDO — use saudação genérica tipo "Olá!" sem nome até o lead se apresentar'}
- Funil detectado até agora: ${c.contato.funnel || 'ainda não identificado'}
- Estágio: ${c.contato.stage || 'novo'}
- Última nota de qualificação: ${c.contato.qualification_notes || 'nenhuma'}
`.trim();

  const respostas = [];
  const history = [];

  for (const t of c.turnos) {
    if (t.lead) history.push({ role: 'user', content: t.lead });
    if (t.tina) history.push({ role: 'assistant', content: t.tina });
  }

  // Garante que último é user
  if (history[history.length - 1].role !== 'user') {
    history.push({ role: 'user', content: '(lead segue conversa)' });
  }

  try {
    const r = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: TINA_SYSTEM_PROMPT },
        { role: 'system', content: meta },
        ...history,
      ],
      response_format: { type: 'json_object' },
      max_tokens: 900,
      temperature: 0.7,
    });

    const text = r.choices[0].message.content;
    const parsed = JSON.parse(text);
    respostas.push({ turnos: c.turnos, resposta: parsed, tokens: r.usage });
    console.log(`  ✓ resposta gerada (${r.usage.total_tokens} tokens)`);
    return { cenario: c, resposta: parsed, tokens: r.usage };
  } catch (err) {
    console.error(`  ✗ erro: ${err.message}`);
    return { cenario: c, erro: err.message };
  }
}

async function main() {
  console.log(`Testando prompt versão ${PROMPT_VERSION}`);
  console.log(`Modelo: ${MODEL}`);
  console.log(`Cenários: ${CENARIOS.length}\n`);

  const out = [];
  for (const c of CENARIOS) {
    out.push(await runScenario(c));
  }

  // Markdown
  let md = `# Teste do prompt da Tina (versão ${PROMPT_VERSION})\n\n`;
  md += `Modelo: ${MODEL}\n`;
  md += `Gerado em: ${new Date().toISOString()}\n\n---\n\n`;

  for (const r of out) {
    md += `## ${r.cenario.nome}\n\n`;
    md += `**Avaliação referência:** ${r.cenario.avaliacao_referencia}\n\n`;
    md += `### Contexto\n`;
    md += `\`\`\`json\n${JSON.stringify(r.cenario.contato, null, 2)}\n\`\`\`\n\n`;
    md += `### Conversa\n`;
    for (const t of r.cenario.turnos) {
      if (t.lead) md += `- 👤 **lead:** ${t.lead}\n`;
      if (t.tina) md += `- 🤖 **tina (anterior):** ${t.tina}\n`;
    }
    md += `\n### Resposta da Tina\n`;
    if (r.erro) {
      md += `❌ ERRO: ${r.erro}\n`;
    } else {
      const reply = r.resposta.reply;
      const split = r.resposta.split;
      if (split && Array.isArray(split) && split.length > 0) {
        md += `**Bolhas:**\n`;
        split.forEach((b, i) => {
          const txt = typeof b === 'string' ? b : b.text;
          md += `${i + 1}. ${txt}\n`;
        });
      } else if (reply) {
        md += `**Reply:** ${reply}\n`;
      }
      md += `\n**JSON completo:**\n\`\`\`json\n${JSON.stringify(r.resposta, null, 2)}\n\`\`\`\n`;
      md += `\n**Tokens:** in=${r.tokens.prompt_tokens} out=${r.tokens.completion_tokens}\n`;
    }
    md += `\n### Critérios de validação\n`;
    for (const v of r.cenario.validar) md += `- [ ] ${v}\n`;
    md += `\n---\n\n`;
  }

  const outDir = './docs';
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'teste-prompt-output.md');
  fs.writeFileSync(outPath, md, 'utf8');
  fs.writeFileSync(path.join(outDir, 'teste-prompt-output.json'), JSON.stringify(out, null, 2), 'utf8');

  console.log(`\n✓ Resultado salvo em:`);
  console.log(`  ${outPath}`);
  console.log(`  ${path.join(outDir, 'teste-prompt-output.json')}`);
}

main().catch(err => { console.error(err); process.exit(1); });
