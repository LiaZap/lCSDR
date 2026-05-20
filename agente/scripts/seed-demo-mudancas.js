// Seed de 20 conversas demo focadas nas MUDANÇAS recentes da Tina
// (após documentação estratégica + reunião LC 18/05 + orientações 20/05).
//
// 5 cenários × 4 variações cada = 20 conversas. Cada variação tem
// mensagens diferentes pra não ficar repetitivo na demonstração.
//
// Cenários cobertos:
//   1. Lead sem dinheiro    → acolhe + indica livro/curso (NÃO desqualifica)
//   2. Aluno com dúvida     → encaminha pro email cursos@lcagencia.com.br
//   3. Não-aluno interess.  → menciona o Gabriel + leva pro time vender
//   4. ISBN / concursos     → orienta CBL e curso Escritores Admiráveis
//   5. Lead pronto agendar  → tina-agenda + handoff quente/superquente
//
// Uso (dentro do container do lcsdr):
//   node scripts/seed-demo-mudancas.js
//
// Custo aproximado: ~US$ 0.08 (20 conversas curtas).

import 'dotenv/config';
import { db } from '../src/db/index.js';
import { generateTinaReply } from '../src/agent/tina.js';
import { recordInbound, recordOutbound } from '../src/agent/contactService.js';

const POOL = [
  // ════════════════════════════════════════════════════════════
  // CENÁRIO 1 — LEAD SEM DINHEIRO (acolhe + produto de entrada)
  // Demonstra: mudança estratégica, lead sem grana NÃO é desqualificado
  // ════════════════════════════════════════════════════════════
  {
    cenario: '1-sem-dinheiro',
    name: 'Pedro Aspirante',
    phone: '5511990001001',
    turnos: [
      'Oi, eu queria publicar um livro mas tô meio apertado financeiramente.',
      'Tô desempregado faz uns meses, queria saber se tem alguma coisa de graça pra eu começar.',
      'É um livro sobre superação pessoal, ainda tô organizando os capítulos.',
    ],
  },
  {
    cenario: '1-sem-dinheiro',
    name: 'Camila Esperança',
    phone: '5511990001002',
    turnos: [
      'Oi! Eu queria muito escrever e publicar, mas não tenho condição de pagar agora.',
      'Vocês têm alguma coisa pra quem tá começando do zero, sem investimento?',
      'É um livro sobre maternidade atípica, minha filha tem autismo.',
    ],
  },
  {
    cenario: '1-sem-dinheiro',
    name: 'Roberto Sonhador',
    phone: '5511990001003',
    turnos: [
      'Achei que era de graça vocês ajudarem a publicar, é gratuito né?',
      'Eu não tenho dinheiro pra investir agora, mas tenho um livro pronto.',
    ],
  },
  {
    cenario: '1-sem-dinheiro',
    name: 'Joana Lutadora',
    phone: '5511990001004',
    turnos: [
      'Oi, tô desempregada faz 8 meses. Dá pra começar a publicar sem dinheiro?',
      'O livro é sobre superação no trabalho, tô na metade ainda.',
    ],
  },

  // ════════════════════════════════════════════════════════════
  // CENÁRIO 2 — ALUNO COM DÚVIDA DO CURSO
  // Demonstra: encaminha pro email cursos@lcagencia.com.br
  // ════════════════════════════════════════════════════════════
  {
    cenario: '2-aluno-duvida',
    name: 'Marina Aluna',
    phone: '5511990002001',
    turnos: [
      'Oi, já sou aluna do curso Escritores Admiráveis e tô com uma dúvida sobre o módulo de divulgação.',
      'Não consigo achar a aula sobre apresentar pra editora, sabe me dizer?',
    ],
  },
  {
    cenario: '2-aluno-duvida',
    name: 'Ricardo Cursista',
    phone: '5511990002002',
    turnos: [
      'Comprei o curso Escritores Admiráveis semana passada mas não consegui acessar ainda.',
      'Onde eu entro pra ver os módulos?',
    ],
  },
  {
    cenario: '2-aluno-duvida',
    name: 'Tatiana Estudante',
    phone: '5511990002003',
    turnos: [
      'Sou aluna do curso, tô no módulo 3 mas tenho uma dúvida.',
      'A aula sobre concursos literários sumiu da minha plataforma, tem como verificar?',
    ],
  },
  {
    cenario: '2-aluno-duvida',
    name: 'Eduardo Aluno-novo',
    phone: '5511990002004',
    turnos: [
      'Fiz a inscrição no curso ontem mas não recebi o email com o acesso ainda.',
      'Como faço pra entrar no curso?',
    ],
  },

  // ════════════════════════════════════════════════════════════
  // CENÁRIO 3 — NÃO-ALUNO INTERESSADO NO CURSO
  // Demonstra: Tina menciona o Gabriel + leva pro time vender
  // ════════════════════════════════════════════════════════════
  {
    cenario: '3-curso-comprar',
    name: 'Bruno Curioso',
    phone: '5511990003001',
    turnos: [
      'Oi, vi o Curso Escritores Admiráveis nos stories da Lilian, vale a pena?',
      'Tô pensando em começar a escrever, mas quero entender o que cobre antes de comprar.',
      'Como faço pra fechar?',
    ],
  },
  {
    cenario: '3-curso-comprar',
    name: 'Patrícia Indecisa',
    phone: '5511990003002',
    turnos: [
      'Oi! Tô interessada no curso da Lilian, mas tenho algumas perguntas antes de comprar.',
      'Ele atende quem nunca escreveu nada? E o acesso é vitalício mesmo?',
    ],
  },
  {
    cenario: '3-curso-comprar',
    name: 'Lucas Cético',
    phone: '5511990003003',
    turnos: [
      'Esse curso é tipo aqueles do youtube ou tem material sério?',
      'O que faz ele valer a pena pra alguém como eu, que tá começando?',
    ],
  },
  {
    cenario: '3-curso-comprar',
    name: 'Fernanda Pesquisando',
    phone: '5511990003004',
    turnos: [
      'Minha amiga indicou o curso da Lilian, gostaria de saber mais.',
      'Tem alguma garantia? E posso parcelar?',
    ],
  },

  // ════════════════════════════════════════════════════════════
  // CENÁRIO 4 — ISBN / CONCURSOS LITERÁRIOS (orientações novas)
  // Demonstra: orienta CBL + curso Escritores Admiráveis
  // ════════════════════════════════════════════════════════════
  {
    cenario: '4-isbn-concurso',
    name: 'Camila Editora-Solo',
    phone: '5511990004001',
    turnos: [
      'Bom dia! Como faço pra registrar o ISBN do meu livro? E a ficha catalográfica?',
      'Outra coisa: quero participar de concursos literários esse ano, como me preparo?',
      'O livro é de contos, ainda tô finalizando os últimos capítulos.',
    ],
  },
  {
    cenario: '4-isbn-concurso',
    name: 'Antônio Acadêmico',
    phone: '5511990004002',
    turnos: [
      'Oi, sou professor universitário, escrevi um livro acadêmico.',
      'Preciso registrar o ISBN e fazer a ficha catalográfica, onde faço isso?',
    ],
  },
  {
    cenario: '4-isbn-concurso',
    name: 'Beatriz Estreante',
    phone: '5511990004003',
    turnos: [
      'Quero participar de concursos literários, mas não sei nem por onde começar.',
      'Sou escritora estreante, tenho um romance quase pronto.',
    ],
  },
  {
    cenario: '4-isbn-concurso',
    name: 'Daniel Independente',
    phone: '5511990004004',
    turnos: [
      'Preciso registrar meu livro de poesias, onde faço o ISBN?',
      'Também queria saber se vocês ajudam a inscrever em concurso, edital cultural, essas coisas.',
    ],
  },

  // ════════════════════════════════════════════════════════════
  // CENÁRIO 5 — LEAD QUENTE PRONTO PRA AGENDAR
  // Demonstra: tina-agenda + handoff + temperatura quente/superquente
  // ════════════════════════════════════════════════════════════
  {
    cenario: '5-quente-agenda',
    name: 'Dra. Helena Empresária',
    phone: '5511990005001',
    turnos: [
      'Olá, sou médica oncologista, lancei meu livro há 2 meses na Amazon. Quero divulgar pra grande mídia.',
      'Link de venda: amazon.com.br/dp/exemplo. Instagram @drahelena com 8k seguidores.',
      'Tenho budget de R$3000/mês pra investir em divulgação. Quero a Master LC. Quando podemos conversar?',
    ],
  },
  {
    cenario: '5-quente-agenda',
    name: 'Sérgio CEO',
    phone: '5511990005002',
    turnos: [
      'Bom dia. Sou CEO de uma empresa de tecnologia, lancei livro de negócios mês passado.',
      'Está vendendo na Amazon (link no meu IG @sergiotech com 15k seguidores). Quero cobertura de imprensa.',
      'Investimento até R$5000/mês não é problema. Quero agendar pra fechar a Master LC.',
    ],
  },
  {
    cenario: '5-quente-agenda',
    name: 'Cristiane Influencer',
    phone: '5511990005003',
    turnos: [
      'Oi! Sou influenciadora de finanças, 200k seguidores no Instagram (@crisfinancas).',
      'Lancei meu primeiro livro semana passada, tá na Amazon e Magalu. Quero divulgar em peso.',
      'Quero fechar Press LC ou Master LC, tenho budget de R$2500/mês. Bora marcar?',
    ],
  },
  {
    cenario: '5-quente-agenda',
    name: 'Vitor Palestrante',
    phone: '5511990005004',
    turnos: [
      'Boa tarde. Sou palestrante corporativo, lancei livro de liderança há 3 meses.',
      'Tem link na Amazon e meu Instagram tem 12k seguidores (@vitor.lideranca).',
      'Tenho orçamento de R$4000/mês pra divulgação. Quero agendar reunião com closer pra ver Master LC.',
    ],
  },
];

async function seedOne(persona) {
  const ghlId = `demo-${persona.phone}-${Date.now()}`;

  const info = db.prepare(`
    INSERT INTO contacts (ghl_contact_id, name, phone, stage)
    VALUES (?, ?, ?, 'novo')
  `).run(ghlId, persona.name, persona.phone);
  const contactId = info.lastInsertRowid;

  console.log(`\n━━━ [${persona.cenario}] ${persona.name} ━━━`);

  for (const userMsg of persona.turnos) {
    recordInbound(contactId, { content: userMsg });
    const fresh = db.prepare('SELECT * FROM contacts WHERE id = ?').get(contactId);

    let result;
    try {
      result = await generateTinaReply({ contact: fresh, incomingText: userMsg });
    } catch (err) {
      console.error(`  ❌ Tina falhou: ${err.message}`);
      break;
    }

    db.prepare(`
      UPDATE contacts
      SET funnel = COALESCE(?, funnel),
          stage = COALESCE(?, stage),
          qualification_score = ?,
          qualification_notes = COALESCE(?, qualification_notes),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      result.funnel || null,
      result.stage || null,
      result.qualification_score || fresh.qualification_score || 0,
      result.qualification_notes || null,
      contactId
    );

    const items = result.split && result.split.length ? result.split : [result.reply];
    const replyTxt = items.map(i => typeof i === 'string' ? i : (i?.text || '')).filter(Boolean).join(' | ');
    for (const item of items) {
      const txt = typeof item === 'string' ? item : (item?.text || '');
      if (txt) recordOutbound(contactId, { author: 'ia', content: txt, usage: result.usage });
    }

    console.log(`  🧑 ${userMsg.slice(0, 80)}${userMsg.length > 80 ? '...' : ''}`);
    console.log(`  🤖 ${replyTxt.slice(0, 120)}${replyTxt.length > 120 ? '...' : ''}`);

    if (result.end_conversation || result.handoff) break;
  }

  const final = db.prepare('SELECT * FROM contacts WHERE id = ?').get(contactId);
  console.log(`  📊 funil=${final.funnel || '—'} · stage=${final.stage || '?'} · score=${final.qualification_score || 0}/100`);
  return final;
}

async function main() {
  console.log(`\n🌱 Seed demo focado nas MUDANÇAS recentes da Tina`);
  console.log(`   ${POOL.length} personas (5 cenários × 4 variações cada)\n`);

  let count = 0;
  let errors = 0;

  for (const persona of POOL) {
    try {
      await seedOne(persona);
      count++;
    } catch (err) {
      console.error(`✗ ${persona.name}: ${err.message}`);
      errors++;
    }
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ ${count} conversas demo seedadas (${errors} erros)`);
  console.log(`📱 Abra o dashboard em /conversas pra ver — filtra por nome ou rode:`);
  console.log(`   SELECT name, funnel, stage, qualification_score FROM contacts WHERE ghl_contact_id LIKE 'demo-%' ORDER BY id DESC LIMIT 20;\n`);
}

main().catch(err => {
  console.error('❌ Seed falhou:', err.message);
  process.exit(1);
});
