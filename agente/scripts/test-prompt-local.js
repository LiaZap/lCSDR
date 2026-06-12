// Roda os cenários críticos pelo CAMINHO DE PRODUÇÃO REAL da Tina.
// Usa generateTinaReply() -> mesmo provider (OpenAI Responses API + JSON
// Schema strict), mesma sanitização e mesmo histórico do banco que o lead
// recebe no WhatsApp. NÃO é uma simulação simplificada: é idêntico à prod.
//
// Cria contatos temporários no banco local (prefixo test-prompt-) e os
// APAGA no fim. Não polui dados reais.
//
// Uso:
//   1. Define OPENAI_API_KEY no .env do agente (e LLM_PROVIDER se quiser forçar)
//   2. cd agente
//   3. node scripts/test-prompt-local.js
//
// Saída: docs/teste-prompt-output.md + .json
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PROMPT_VERSION } from '../src/agent/systemPrompt.js';
import { db } from '../src/db/index.js';
import { generateTinaReply, llmProvider } from '../src/agent/tina.js';
import { recordInbound, recordOutbound } from '../src/agent/contactService.js';

const PROVIDER = llmProvider();
const MODEL = PROVIDER === 'openai'
  ? (process.env.OPENAI_MODEL || 'gpt-4.1-mini')
  : (process.env.CLAUDE_MODEL || 'claude-sonnet-4-6');

if (PROVIDER === 'openai' && !process.env.OPENAI_API_KEY) {
  console.error('Erro: provider openai mas OPENAI_API_KEY ausente no .env');
  process.exit(1);
}
if (PROVIDER === 'anthropic' && !process.env.ANTHROPIC_API_KEY) {
  console.error('Erro: provider anthropic mas ANTHROPIC_API_KEY ausente no .env');
  process.exit(1);
}

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
    nome: 'C06 - Lead direto ao preço (REGRA Nº1: NUNCA dizer preço)',
    avaliacao_referencia: 'reunião 12/06 Lilian: nunca fala preço',
    contato: { name: 'Felipe', funnel: 'publicar', stage: 'novo', qualification_notes: null },
    turnos: [
      { lead: 'Quanto custa pra publicar? Me diz só o valor.' },
      { lead: 'Não quero conversar com ninguém, só preço.' },
    ],
    validar: [
      '🔴 NÃO PODE dizer NENHUM valor de serviço (nada de 50.000, 7.800)',
      'NÃO deve usar "custo" (deve usar "investimento")',
      'DEVE usar o gate "investir a partir de R$ 629/mês, faz sentido?"',
      'DEVE dizer que quem apresenta proposta é o especialista',
      'NÃO deve encerrar',
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
      'NÃO deve dizer preço de serviço',
      'DEVE terminar com pergunta',
    ],
  },
  {
    nome: 'C11 - Lead qualificado pede reunião (handoff + agendamento)',
    avaliacao_referencia: 'reunião 12/06: Tina é SDR, qualifica e agenda',
    contato: { name: 'Vitor', funnel: 'divulgar', stage: 'qualificando', qualification_notes: 'palestrante, livro liderança publicado Amazon, @vitor.lideranca, quer divulgar' },
    turnos: [
      { lead: 'Tenho livro de liderança publicado na Amazon, link tá na bio, meu insta é @vitor.lideranca.' },
      { tina: '[contexto: Tina perguntou sobre investimento via gate R$629]' },
      { lead: 'Sim, consigo investir nesse valor tranquilo. Quero marcar uma reunião.' },
    ],
    validar: [
      '🟢 DEVE marcar handoff: true + stage: "qualificado"',
      'DEVE convidar pro agendamento (horário hoje/amanhã)',
      'NÃO deve dizer preço de serviço',
      'NÃO deve continuar dialogando depois do handoff',
    ],
  },
  {
    nome: 'C12 - Lead pergunta preço de assessoria direto',
    avaliacao_referencia: 'reunião 12/06 Lilian: estopim foi Tina soltar R$7.800',
    contato: { name: 'Marcos', funnel: 'divulgar', stage: 'qualificando', qualification_notes: 'livro publicado, quer assessoria de imprensa' },
    turnos: [
      { lead: 'Quanto custa a assessoria de imprensa de vocês por mês?' },
    ],
    validar: [
      '🔴 NÃO PODE dizer R$ 7.800 nem nenhum valor de assessoria',
      'DEVE dizer que o especialista apresenta a proposta',
      'DEVE usar o gate de R$ 629/mês pra qualificar',
    ],
  },
];

// Cria um contato temporário no banco, injeta os turnos como mensagens reais
// e chama generateTinaReply() (caminho de produção). Apaga o contato no fim.
async function runScenario(c, idx) {
  console.log(`\n[${c.nome}]`);
  const ghlId = `test-prompt-${idx}-${c.contato.phone || c.contato.name || idx}`;

  // contato com o estágio/funil/nota do cenário (mesma calibração que produção usa)
  const info = db.prepare(`
    INSERT INTO contacts (ghl_contact_id, name, stage, funnel, qualification_notes)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    ghlId,
    c.contato.name || null,
    c.contato.stage || 'novo',
    c.contato.funnel || null,
    c.contato.qualification_notes || null,
  );
  const contactId = info.lastInsertRowid;

  try {
    // Reproduz a conversa no banco: cada turno vira mensagem real.
    let lastLead = null;
    for (const t of c.turnos) {
      if (t.lead) { recordInbound(contactId, { content: t.lead }); lastLead = t.lead; }
      if (t.tina) { recordOutbound(contactId, { author: 'ia', content: t.tina }); }
    }

    const fresh = db.prepare('SELECT * FROM contacts WHERE id = ?').get(contactId);
    // CAMINHO DE PRODUÇÃO: Responses API + schema strict + sanitização
    const resposta = await generateTinaReply({ contact: fresh, incomingText: lastLead });
    const usage = resposta.usage || {};
    console.log(`  ✓ resposta gerada (${usage.tokens_in || '?'} in / ${usage.tokens_out || '?'} out, ${usage.provider || PROVIDER})`);
    return { cenario: c, resposta, tokens: { prompt_tokens: usage.tokens_in || 0, completion_tokens: usage.tokens_out || 0 } };
  } catch (err) {
    console.error(`  ✗ erro: ${err.message}`);
    return { cenario: c, erro: err.message };
  } finally {
    // Limpa o contato temporário e suas mensagens
    db.prepare('DELETE FROM messages WHERE contact_id = ?').run(contactId);
    db.prepare('DELETE FROM followups WHERE contact_id = ?').run(contactId);
    db.prepare('DELETE FROM events_log WHERE contact_id = ?').run(contactId);
    db.prepare('DELETE FROM contacts WHERE id = ?').run(contactId);
  }
}

async function main() {
  console.log(`Testando prompt versão ${PROMPT_VERSION}`);
  console.log(`Provider: ${PROVIDER} | Modelo: ${MODEL} (CAMINHO DE PRODUÇÃO)`);
  console.log(`Cenários: ${CENARIOS.length}\n`);

  const out = [];
  for (let i = 0; i < CENARIOS.length; i++) {
    out.push(await runScenario(CENARIOS[i], i + 1));
  }

  // Markdown
  let md = `# Teste do prompt da Tina (versão ${PROMPT_VERSION})\n\n`;
  md += `Provider: ${PROVIDER} | Modelo: ${MODEL}\n`;
  md += `Caminho: PRODUÇÃO real (generateTinaReply → Responses API + schema strict + sanitização)\n`;
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
