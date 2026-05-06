// Suite de testes automatizada da Lila — múltiplos cenários + avaliação automática.
//
// Cada cenário tem:
//   - turnos: mensagens do lead
//   - expects: o que a gente espera que aconteça (campo + condição)
//
// Uso:
//   node scripts/test-suite.js              # roda tudo
//   node scripts/test-suite.js <cenario>    # roda um só
//   node scripts/test-suite.js --json       # output JSON pra avaliação automática

import 'dotenv/config';
import { db } from '../src/db/index.js';
import { generateLilaReply } from '../src/agent/lila.js';
import { recordInbound, recordOutbound } from '../src/agent/contactService.js';

// ============================================================================
// CENÁRIOS DE TESTE
// ============================================================================
// `expects` aplica DEPOIS de TODOS os turnos rodarem.
// Comparações: contains/eq/gte/lte/in/oneOf/regex
const SCENARIOS = {
  // --- LEADS QUALIFICÁVEIS ---
  autor_emocional: {
    nome: 'Maria — autora com história pessoal',
    descricao: 'Acolher, depois qualificar',
    turnos: [
      'Oi, eu quero escrever um livro mas não sei nem por onde começar.',
      'Tenho uma ideia sobre superação. Minha filha tem autismo e foi uma jornada de 10 anos.',
      'Sou psicóloga, atendo várias famílias. Quero deixar isso em livro pra ajudar outros pais.',
      'Já tenho umas 30 páginas escritas mas tô travada na estrutura.',
    ],
    expects: [
      { field: 'final.funnel', op: 'eq', value: 'escrever' },
      { field: 'final.qualification_score', op: 'gte', value: 30 },
      { field: 'final.end_conversation', op: 'eq', value: false },
      { field: 'turn2', op: 'oneOf', value: ['história', 'forte', 'obrigada', 'compartil', 'confian'] },
    ],
  },

  profissional_premium: {
    nome: 'Dr. Carlos — advogado livro pronto premium',
    descricao: 'Identifica LC Books rápido, qualifica, faz handoff',
    turnos: [
      'Bom dia. Sou advogado tributarista e terminei meu livro de 180 páginas. Quero publicar com qualidade premium.',
      'Quero distribuir em livraria e ter um livro de autoridade pra usar em palestras.',
      'Tenho orçamento, estou querendo entender o investimento e o prazo.',
    ],
    expects: [
      { field: 'final.funnel', op: 'eq', value: 'publicar' },
      { field: 'final.handoff', op: 'eq', value: true },
      { field: 'final.qualification_score', op: 'gte', value: 60 },
      { field: 'final.service_recommended', op: 'contains', value: 'lc_books' },
    ],
  },

  publicado_midia: {
    nome: 'Roberto — empresário livro publicado quer mídia',
    descricao: 'Funil divulgar, oferece Master/Press LC, explica diferenças',
    turnos: [
      'Oi! Lancei meu livro de negócios mês passado na Amazon, já tem umas 30 avaliações boas.',
      'Quero divulgar pra mídia, sair em revista, podcast, esse tipo de coisa.',
      'Sou empresário, tenho restaurante. O livro fala sobre gestão de equipe.',
      'Qual a diferença entre Master LC e Press LC?',
    ],
    expects: [
      { field: 'final.funnel', op: 'eq', value: 'divulgar' },
      { field: 'turnsAll', op: 'oneOf', value: ['Master', 'Press', 'mídia', 'imprensa', 'divulgação'] },
      { field: 'final.qualification_score', op: 'gte', value: 30 },
    ],
  },

  acacio_oficial_justica: {
    nome: 'Acácio — oficial de justiça (caso real da Lilian)',
    descricao: 'Caso citado pela Lilian: SDR antiga quase perdeu, perfil ideal pra mentoria',
    turnos: [
      'Oi, sou oficial de justiça e tenho uma ideia de livro sobre carreira pública. Tô pensando há tempos.',
      'Não sei se vou conseguir mesmo escrever, sempre travo. Mas é um sonho.',
      'Você acha que vale a pena pra alguém como eu, mesmo trabalhando muito?',
    ],
    expects: [
      { field: 'final.funnel', op: 'eq', value: 'escrever' },
      { field: 'final.qualification_score', op: 'gte', value: 20 },
      { field: 'final.end_conversation', op: 'eq', value: false },
    ],
  },

  editora: {
    nome: 'Patrícia — representa editora pequena',
    descricao: 'Pergunta 1 da triagem deve direcionar pra closer (Assessoria Editoras)',
    turnos: [
      'Olá, represento a Editora Estrela do Sul, somos uma editora pequena de Curitiba.',
      'Temos 12 títulos no catálogo e queremos crescer com distribuição e marketing.',
    ],
    expects: [
      { field: 'final.handoff', op: 'eq', value: true },
      { field: 'turnsAll', op: 'oneOf', value: ['editora', 'consultoria', 'especialista', 'closer', 'time'] },
    ],
  },

  // --- LEADS PRA CORTAR ---
  lixo_de_graca: {
    nome: 'Joana — achou que era de graça',
    descricao: 'Corte imediato no turno 1',
    turnos: [
      'Oi achei que era de graça?',
    ],
    expects: [
      { field: 'final.end_conversation', op: 'eq', value: true },
      { field: 'final.stage', op: 'eq', value: 'desqualificado' },
      { field: 'turn1', op: 'contains', value: 'Livro Secreto' },
    ],
  },

  lixo_receita_familia: {
    nome: 'Ana — livrinho de receita pra família',
    descricao: 'Sem perfil, deve cortar até turno 2',
    turnos: [
      'Quero fazer um livrinho de receitas só pra dar pra minha família no Natal.',
      'Não quero vender nada não, é só pra distribuir entre os parentes.',
    ],
    expects: [
      { field: 'final.end_conversation', op: 'eq', value: true },
      { field: 'final.qualification_score', op: 'lte', value: 20 },
    ],
  },

  lixo_sem_dinheiro: {
    nome: 'Pedro — não tem dinheiro pra investir',
    descricao: 'Corte sem oferecer "ajuda grátis"',
    turnos: [
      'Quero publicar livro mas não tenho dinheiro nenhum agora.',
      'Tô desempregado faz tempo. Tem alguma coisa de graça?',
    ],
    expects: [
      { field: 'final.end_conversation', op: 'eq', value: true },
      { field: 'turnsAll', op: 'notContains', value: 'dicas grátis' },
      { field: 'turnsAll', op: 'contains', value: 'Livro Secreto' },
    ],
  },

  curiosidade: {
    nome: 'Curioso — só pesquisando',
    descricao: 'Lead curioso sem projeto concreto',
    turnos: [
      'Oi, tô só pesquisando como funciona publicação de livro.',
      'Não tenho livro escrito, é só curiosidade mesmo.',
    ],
    expects: [
      { field: 'final.qualification_score', op: 'lte', value: 30 },
      { field: 'final.end_conversation', op: 'eq', value: true },
    ],
  },

  // --- COMPORTAMENTOS ESPECÍFICOS ---
  pergunta_preco_direto: {
    nome: 'Direto — pergunta valor de cara',
    descricao: 'Não pode inventar preço; deve dizer que time comercial passa',
    turnos: [
      'Quanto custa pra publicar um livro com vocês?',
      'É autor com livro pronto de 200 páginas, quero saber valor.',
    ],
    expects: [
      { field: 'turnsAll', op: 'notContainsAny', value: ['R$ 50.000', 'R$50.000', 'R$ 30.000'] },
      { field: 'turnsAll', op: 'oneOf', value: ['orçamento', 'time', 'comercial', 'projeto', 'consultoria'] },
    ],
  },

  pergunta_agendamento: {
    nome: 'Quer agendar reunião direto',
    descricao: 'Lila não agenda sozinha (fase 1) — passa pro Closer',
    turnos: [
      'Oi! Quero marcar uma reunião com vocês, qual horário tem disponível?',
      'Sou autor de 3 livros, quero contratar Master LC.',
    ],
    expects: [
      { field: 'final.handoff', op: 'eq', value: true },
      { field: 'final.funnel', op: 'eq', value: 'divulgar' },
      { field: 'turnsAll', op: 'notContainsAny', value: ['agendei', 'marcado para', 'confirmado para', 'às 10h', 'às 14h'] },
    ],
  },

  pergunta_se_e_ia: {
    nome: 'Lead pergunta se é robô',
    descricao: 'Não nega ser IA, mas não declara explicitamente',
    turnos: [
      'Você é uma pessoa real ou um robô?',
    ],
    expects: [
      { field: 'turn1', op: 'notContainsAny', value: ['sou um robô', 'sou uma IA', 'sou um bot', 'sou um chatbot'] },
      { field: 'turn1', op: 'oneOf', value: ['Lila', 'consultora', 'Lilian', 'time', 'primeiro contato'] },
    ],
  },

  fora_escopo: {
    nome: 'Off-topic',
    descricao: 'Pergunta fora do escopo da LC — redireciona',
    turnos: [
      'Oi, vocês me indicam um bom advogado tributarista em SP?',
    ],
    expects: [
      { field: 'final.qualification_score', op: 'lte', value: 20 },
    ],
  },

  hostilidade: {
    nome: 'Lead hostil',
    descricao: 'Encerra educadamente sem confronto',
    turnos: [
      'Para de me mandar mensagem, isso é golpe!',
    ],
    expects: [
      { field: 'final.end_conversation', op: 'eq', value: true },
    ],
  },

  pdf_recebido: {
    nome: 'Lead manda PDF',
    descricao: 'Lila redireciona pra etapa de leitura crítica',
    turnos: [
      '[lead enviou arquivo: livro.pdf]',
      'Pode ler meu livro e me dar um parecer?',
    ],
    expects: [
      { field: 'turnsAll', op: 'oneOf', value: ['leitura crítica', 'equipe', 'etapa', 'analisa'] },
    ],
  },

  // --- EDGE CASES ADICIONAIS ---
  mudou_ideia: {
    nome: 'Lead muda perfil no meio (autor→editora)',
    descricao: 'Lila replaneja triagem',
    turnos: [
      'Oi, sou autor, terminei meu livro de 250 páginas.',
      'Na verdade espera, eu represento uma editora pequena que tá publicando 5 títulos esse ano.',
    ],
    expects: [
      { field: 'final.handoff', op: 'eq', value: true },
      { field: 'turnsAll', op: 'oneOf', value: ['editora', 'consultoria', 'especialista'] },
    ],
  },

  ingles: {
    nome: 'Lead em inglês',
    descricao: 'Lila responde em PT-BR (público é Brasil)',
    turnos: [
      'Hi, I want to publish my novel in Brazil. Can you help?',
    ],
    expects: [
      { field: 'turn1', op: 'notContainsAny', value: ['sure!', 'of course', 'i can help you', 'we offer'] },
      { field: 'turn1', op: 'oneOf', value: ['olá', 'oi', 'lila', 'lc', 'livro'] },
    ],
  },

  giria: {
    nome: 'Lead jovem com gíria',
    descricao: 'Lila mantém calorosa, adapta sem virar gíria pesada',
    turnos: [
      'eae mano, queria publicar um livro de cordel meu, top demais',
      'ta osso pra publicar sozinho, vc topa me ajudar?',
    ],
    expects: [
      { field: 'final.funnel', op: 'eq', value: 'publicar' },
      { field: 'final.end_conversation', op: 'eq', value: false },
    ],
  },

  preco_pressao: {
    nome: 'Lead insiste em saber preço',
    descricao: 'Lila não inventa, mantém "time comercial passa"',
    turnos: [
      'Quanto custa pra publicar? Me diz só o valor.',
      'Não, não quero conversar com ninguém. Só quero saber o preço.',
      'Se não me der valor, vou procurar outra editora.',
    ],
    expects: [
      { field: 'turnsAll', op: 'notContainsAny', value: ['R$ 50.000', 'R$ 30.000', 'R$ 20.000', 'R$ 10.000'] },
      { field: 'turnsAll', op: 'oneOf', value: ['orçamento', 'projeto', 'comercial', 'time'] },
    ],
  },

  livro_infantil: {
    nome: 'Autora de livro infantil',
    descricao: 'Funil identificado como publicar/escrever',
    turnos: [
      'Oi! Sou pedagoga e tenho um livro infantil ilustrado pronto, com 24 páginas. Quero publicar.',
      'Já tenho o ilustrador, falta só publicação e divulgação. Sou professora há 15 anos.',
    ],
    expects: [
      { field: 'final.funnel', op: 'oneOf', value: ['publicar', 'divulgar'] },
      { field: 'final.qualification_score', op: 'gte', value: 30 },
    ],
  },

  ja_cliente: {
    nome: 'Já é cliente, quer outro serviço',
    descricao: 'Lila reconhece e qualifica pra outro serviço',
    turnos: [
      'Oi, já contratei o Press LC mês passado pro meu primeiro livro. Agora quero divulgar mais o livro nas redes.',
      'Tenho 10k seguidores no Instagram, quero estratégia.',
    ],
    expects: [
      { field: 'final.funnel', op: 'eq', value: 'divulgar' },
      { field: 'turnsAll', op: 'oneOf', value: ['consultoria', 'marketing', 'redes'] },
    ],
  },

  audio_recebido: {
    nome: 'Lead manda áudio (simulado transcrito)',
    descricao: 'Lila reconhece áudio',
    turnos: [
      '[áudio transcrito] Oi, eu sou advogado e tô finalizando meu livro sobre direito de família, queria saber sobre publicação',
    ],
    expects: [
      { field: 'final.funnel', op: 'eq', value: 'publicar' },
      { field: 'final.end_conversation', op: 'eq', value: false },
    ],
  },

  livro_de_receita_serio: {
    nome: 'Livro de receitas REAL (chef profissional)',
    descricao: 'Não confundir com lead lixo só porque mencionou "receita"',
    turnos: [
      'Sou chef há 20 anos, tenho um restaurante e quero publicar um livro de receitas com fotos profissionais.',
      'Quero distribuir nas livrarias do meu bairro e em eventos gastronômicos.',
    ],
    expects: [
      { field: 'final.end_conversation', op: 'eq', value: false },
      { field: 'final.funnel', op: 'oneOf', value: ['publicar', 'divulgar'] },
      { field: 'final.qualification_score', op: 'gte', value: 30 },
    ],
  },
};

// ============================================================================
// AVALIAÇÃO AUTOMÁTICA
// ============================================================================
function getValue(snapshot, fieldPath) {
  const [section, ...rest] = fieldPath.split('.');
  if (section === 'final') {
    return rest.reduce((acc, k) => acc?.[k], snapshot.final);
  }
  // ATENÇÃO: 'turnsAll' tem que ser checado ANTES de 'turn' (porque ambos começam com "turn")
  if (section === 'turnsAll') {
    return JSON.stringify(snapshot.turns).toLowerCase();
  }
  if (section.startsWith('turn')) {
    const idx = parseInt(section.slice(4), 10);
    const t = snapshot.turns[idx - 1];
    if (!t) return null;
    return JSON.stringify(t).toLowerCase();
  }
  return null;
}

function evalExpect(snapshot, exp) {
  const v = getValue(snapshot, exp.field);
  switch (exp.op) {
    case 'eq': return v === exp.value;
    case 'gte': return Number(v) >= exp.value;
    case 'lte': return Number(v) <= exp.value;
    case 'in': return Array.isArray(exp.value) && exp.value.includes(v);
    case 'contains': return String(v || '').toLowerCase().includes(String(exp.value).toLowerCase());
    case 'notContains': return !String(v || '').toLowerCase().includes(String(exp.value).toLowerCase());
    case 'oneOf': return exp.value.some(needle => String(v || '').toLowerCase().includes(String(needle).toLowerCase()));
    case 'notContainsAny': return !exp.value.some(needle => String(v || '').toLowerCase().includes(String(needle).toLowerCase()));
    case 'regex': return new RegExp(exp.value, 'i').test(String(v || ''));
    default: return false;
  }
}

// ============================================================================
// EXECUÇÃO
// ============================================================================
async function runScenario(key, scenario) {
  const ghlId = `suite-${key}-${Date.now()}`;
  const info = db.prepare(`
    INSERT INTO contacts (ghl_contact_id, name, phone, stage)
    VALUES (?, ?, ?, 'novo')
  `).run(ghlId, scenario.nome, '5511999999999');
  const contactId = info.lastInsertRowid;

  const turns = [];
  let final = null;
  let totalCost = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;

  try {
    for (const userMsg of scenario.turnos) {
      recordInbound(contactId, { content: userMsg });
      const fresh = db.prepare('SELECT * FROM contacts WHERE id = ?').get(contactId);
      const result = await generateLilaReply({ contact: fresh, incomingText: userMsg });

      // Atualiza estado
      db.prepare(`
        UPDATE contacts
        SET funnel = COALESCE(?, funnel),
            stage = COALESCE(?, stage),
            qualification_score = ?,
            qualification_notes = COALESCE(?, qualification_notes)
        WHERE id = ?
      `).run(
        result.funnel || null, result.stage || null,
        result.qualification_score || fresh.qualification_score || 0,
        result.qualification_notes || null, contactId
      );

      const items = result.split && result.split.length ? result.split : [result.reply];
      for (const item of items) {
        const txt = typeof item === 'string' ? item : (item?.text || '');
        if (txt) recordOutbound(contactId, { author: 'ia', content: txt, usage: result.usage });
      }

      turns.push({
        user: userMsg,
        reply: result.reply,
        split: result.split,
        funnel: result.funnel,
        stage: result.stage,
        score: result.qualification_score,
        handoff: result.handoff,
        end: result.end_conversation,
      });

      const u = result.usage || {};
      totalCost += u.cost_usd || 0;
      totalTokensIn += u.tokens_in || 0;
      totalTokensOut += u.tokens_out || 0;

      final = result;

      if (result.end_conversation || result.handoff) break;
    }
  } catch (err) {
    return { key, scenario, error: err.message, turns, passed: 0, failed: 0, results: [] };
  } finally {
    db.prepare('DELETE FROM messages WHERE contact_id = ?').run(contactId);
    db.prepare('DELETE FROM contacts WHERE id = ?').run(contactId);
  }

  const snapshot = { final, turns };
  const results = scenario.expects.map(exp => ({
    expectation: exp,
    passed: evalExpect(snapshot, exp),
  }));
  const passed = results.filter(r => r.passed).length;
  const failed = results.length - passed;

  return {
    key,
    scenario,
    turns,
    final,
    results,
    passed,
    failed,
    cost_usd: totalCost,
    tokens_in: totalTokensIn,
    tokens_out: totalTokensOut,
  };
}

function fmt(s, max = 80) {
  if (!s) return '—';
  s = String(s).replace(/\n/g, ' ');
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

async function main() {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const which = args[0];
  const json = process.argv.includes('--json');
  const runsArg = process.argv.find(a => a.startsWith('--runs='));
  const runs = runsArg ? parseInt(runsArg.split('=')[1], 10) : 1;
  const scenarios = which && SCENARIOS[which]
    ? { [which]: SCENARIOS[which] }
    : SCENARIOS;

  const all = [];
  for (const [key, scenario] of Object.entries(scenarios)) {
    for (let run = 1; run <= runs; run++) {
      if (!json) console.log(`\n▶ ${key}${runs > 1 ? ` (run ${run}/${runs})` : ''} — ${scenario.nome}`);
      const result = await runScenario(key, scenario);
      result.run = run;
      all.push(result);
      if (json) continue;
      if (result.error) { console.log(`  ❌ ERRO: ${result.error}`); continue; }
      console.log(`  ${result.failed === 0 ? '✅' : '❌'} ${result.passed}/${result.passed + result.failed} expectations  ·  ${result.turns.length} turnos · US$${result.cost_usd.toFixed(4)}`);
      if (result.failed > 0) {
        for (const r of result.results.filter(r => !r.passed)) {
          console.log(`    ✗ ${r.expectation.field} ${r.expectation.op} ${JSON.stringify(r.expectation.value).slice(0, 60)}`);
        }
        console.log(`    📝 últimas respostas:`);
        result.turns.forEach((t, i) => {
          const out = t.split && t.split.length
            ? t.split.map(s => typeof s === 'string' ? s : s?.text).filter(Boolean).join(' | ')
            : t.reply;
          console.log(`       T${i + 1}: ${fmt(out, 100)}`);
        });
      }
    }
    continue;
  }

  // Sumário
  const totalPassed = all.reduce((s, r) => s + (r.passed || 0), 0);
  const totalExpect = all.reduce((s, r) => s + (r.results?.length || 0), 0);
  const totalCost = all.reduce((s, r) => s + (r.cost_usd || 0), 0);
  const errors = all.filter(r => r.error).length;
  const allPass = all.filter(r => !r.error && r.failed === 0).length;

  if (json) {
    console.log(JSON.stringify({ summary: { totalPassed, totalExpect, totalCost, errors, allPass, total: all.length }, results: all }, null, 2));
  } else {
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`SUITE COMPLETA — ${allPass}/${all.length} cenários 100%, ${totalPassed}/${totalExpect} expectations, US$${totalCost.toFixed(4)}`);
    console.log(`${'═'.repeat(70)}\n`);
  }

  process.exit(allPass === all.length ? 0 : 1);
}

main().catch(err => {
  console.error('❌ Suite falhou:', err.message);
  console.error(err.stack);
  process.exit(2);
});
