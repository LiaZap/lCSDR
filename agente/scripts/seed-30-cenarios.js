// Seed de 30 conversas demo cobrindo TODOS os funis + cenários sensíveis
// das avaliações da equipe LC.
//
// Distribuição:
//   • 10 leads ESCREVER (curso, mentoria, ideia, trava, concursos)
//   • 10 leads PUBLICAR (LC Books, leitura crítica, orçamento)
//   • 8  leads DIVULGAR (Assessoria, leitura coletiva, redes)
//   • 2  CASOS ESPECIAIS (aluno do curso, hostil "é golpe")
//
// Cada persona tem 2-4 turnos de mensagem (lead → tina).
//
// Uso (dentro do container do lcsdr OU local com DB acessível):
//   node scripts/seed-30-cenarios.js
//
// Custo estimado: ~US$ 0.15 (30 conversas).

import 'dotenv/config';
import { db } from '../src/db/index.js';
import { generateTinaReply } from '../src/agent/tina.js';
import { recordInbound, recordOutbound } from '../src/agent/contactService.js';

const POOL = [
  // ════════════════════════════════════════════════════════════════
  // FUNIL ESCREVER (10)
  // ════════════════════════════════════════════════════════════════
  {
    cenario: 'escrever-01-ideia-iniciante',
    name: 'Maria Silva',
    phone: '5511990010001',
    turnos: [
      'Oi, quero escrever um livro mas não sei nem por onde começar.',
      'Tenho uma ideia sobre superação familiar.',
      'Sou psicóloga, atendo várias famílias.',
    ],
  },
  {
    cenario: 'escrever-02-trava-mentoria',
    name: 'Acácio Oficial',
    phone: '5511990010002',
    turnos: [
      'Sou oficial de justiça e tenho ideia de livro sobre carreira pública.',
      'Não sei se vou conseguir escrever, sempre travo.',
      'Vale a pena pra alguém como eu?',
    ],
  },
  {
    cenario: 'escrever-03-pastor-devocional',
    name: 'Daniel Pastor',
    phone: '5511990010003',
    turnos: [
      'Sou pastor evangélico, tenho mensagens devocionais reunidas.',
      'Quero transformar em livro pra distribuir na minha comunidade e fora dela.',
    ],
  },
  {
    cenario: 'escrever-04-sem-dinheiro',
    name: 'Pedro Sem Recurso',
    phone: '5511990010004',
    turnos: [
      'Quero publicar mas não tenho dinheiro nenhum agora.',
      'Tô desempregado, tem alguma coisa de graça?',
    ],
  },
  {
    cenario: 'escrever-05-acho-graca',
    name: 'Joana Curiosa',
    phone: '5511990010005',
    turnos: [
      'Oi! Achei que era de graça?',
    ],
  },
  {
    cenario: 'escrever-06-estudante-fantasia',
    name: 'Lucas Estudante',
    phone: '5511990010006',
    turnos: [
      'Sou universitário, 22 anos. Quero escrever fantasia épica.',
      'Tô começando do zero, nunca escrevi nada antes.',
    ],
  },
  {
    cenario: 'escrever-07-concursos',
    name: 'Renata Poeta',
    phone: '5511990010007',
    turnos: [
      'Quero participar de concursos literários e editais culturais com minha poesia.',
      'Onde eu aprendo isso?',
    ],
  },
  {
    cenario: 'escrever-08-isbn-curiosa',
    name: 'Helena Independente',
    phone: '5511990010008',
    turnos: [
      'Como faço pra registrar ISBN do meu livro?',
      'E ficha catalográfica, é vocês que fazem?',
    ],
  },
  {
    cenario: 'escrever-09-acelerar-mentoria',
    name: 'Vanessa Coach',
    phone: '5511990010009',
    turnos: [
      'Sou coach de carreira, atendo executivos. Quero publicar meu primeiro livro.',
      'Tenho material em PDF mas falta estruturar como livro.',
      'Posso pagar mentoria pra acelerar.',
    ],
  },
  {
    cenario: 'escrever-10-curiosidade-sem-ideia',
    name: 'Carlos Curioso',
    phone: '5511990010010',
    turnos: [
      'Como faço pra publicar um livro?',
      'Ah, não tenho livro ainda, só curiosidade mesmo.',
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // FUNIL PUBLICAR (10)
  // ════════════════════════════════════════════════════════════════
  {
    cenario: 'publicar-01-livro-pronto-premium',
    name: 'Dr. Carlos Tributário',
    phone: '5511990020001',
    turnos: [
      'Bom dia. Sou advogado e terminei meu livro de 180 páginas. Quero publicar premium.',
      'Quero distribuir em livraria, livro de autoridade pra palestras.',
      'Tenho orçamento, quero entender investimento e prazo.',
    ],
  },
  {
    cenario: 'publicar-02-direto-preco',
    name: 'Felipe Direto',
    phone: '5511990020002',
    turnos: [
      'Quanto custa pra publicar? Me diz só o valor.',
      'Não quero conversar com ninguém, só preço.',
    ],
  },
  {
    cenario: 'publicar-03-leitura-critica',
    name: 'Isabel Iniciante',
    phone: '5511990020003',
    turnos: [
      'Terminei meu primeiro romance, quero saber se está bom antes de publicar.',
      'Não sei se a estrutura ficou redonda.',
    ],
  },
  {
    cenario: 'publicar-04-medica-oncologia',
    name: 'Dra. Beatriz Oncologista',
    phone: '5511990020004',
    turnos: [
      'Sou médica oncologista, escrevi um livro de apoio emocional pra pacientes com câncer.',
      '220 páginas, pronto pra publicar.',
    ],
  },
  {
    cenario: 'publicar-05-biografia-pronta',
    name: 'Sr. Jorge Empresário',
    phone: '5511990020005',
    turnos: [
      'Sou empresário, escrevi minha biografia em 350 páginas.',
      'Quero algo profissional, distribuição em livrarias.',
    ],
  },
  {
    cenario: 'publicar-06-tributarista-publicar',
    name: 'Dr. Felipe Tributário',
    phone: '5511990020006',
    turnos: [
      'Advogado tributarista, livro técnico de 280 páginas finalizado.',
      'Quero publicar com a LC Books, busco orçamento.',
    ],
  },
  {
    cenario: 'publicar-07-tecnico-universitario',
    name: 'Prof. Ricardo PhD',
    phone: '5511990020007',
    turnos: [
      'Sou professor universitário, escrevi livro técnico de engenharia.',
      '450 páginas, quero distribuição em universidades.',
    ],
  },
  {
    cenario: 'publicar-08-aposentado-memorias',
    name: 'Seu Antônio Memorias',
    phone: '5511990020008',
    turnos: [
      'Sou aposentado, escrevi minhas memórias em 200 páginas.',
      'Quero deixar pros netos mas também ver na livraria.',
    ],
  },
  {
    cenario: 'publicar-09-investimento-50k',
    name: 'Patrícia Executiva',
    phone: '5511990020009',
    turnos: [
      'Tenho livro pronto sobre liderança feminina, 250 páginas.',
      'Tenho R$ 50.000 pra investir na publicação. É suficiente?',
    ],
  },
  {
    cenario: 'publicar-10-pdf-pronto',
    name: 'Marina Autora',
    phone: '5511990020010',
    turnos: [
      'Tenho o PDF do livro pronto, posso enviar?',
      'É um romance histórico de 320 páginas.',
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // FUNIL DIVULGAR (8)
  // ════════════════════════════════════════════════════════════════
  {
    cenario: 'divulgar-01-livro-amazon-midia',
    name: 'Roberto Empresário',
    phone: '5511990030001',
    turnos: [
      'Oi! Lancei meu livro de negócios mês passado na Amazon.',
      'Quero divulgar pra mídia, sair em revista, podcast.',
      'Sou dono de restaurante, livro fala sobre gestão.',
    ],
  },
  {
    cenario: 'divulgar-02-press-acessivel',
    name: 'Cristina Influencer',
    phone: '5511990030002',
    turnos: [
      'Lancei meu primeiro livro semana passada, tá na Amazon e Magalu.',
      'Sou influenciadora de finanças, 200k seguidores (@crisfinancas).',
      'Tenho budget de R$2500/mês pra divulgar.',
    ],
  },
  {
    cenario: 'divulgar-03-leitura-coletiva',
    name: 'Bruno Romance',
    phone: '5511990030003',
    turnos: [
      'Lancei romance YA mês passado na Amazon.',
      'Quero aparecer no bookstagram, ter resenhas.',
      'Vi que vocês têm Leitura Coletiva, me explica?',
    ],
  },
  {
    cenario: 'divulgar-04-palestrante-master',
    name: 'Vitor Palestrante',
    phone: '5511990030004',
    turnos: [
      'Sou palestrante corporativo, lancei livro de liderança há 3 meses.',
      'Link na Amazon, Instagram 12k seguidores (@vitor.lideranca).',
      'Tenho orçamento R$4000/mês. Quero divulgação pra mídia tradicional.',
    ],
  },
  {
    cenario: 'divulgar-05-infantil-magalu',
    name: 'Camila Infantil',
    phone: '5511990030005',
    turnos: [
      'Escrevi livro infantil, lancei na Magalu há 2 meses.',
      'Quero alcançar mais pais e escolas.',
    ],
  },
  {
    cenario: 'divulgar-06-master-vs-press',
    name: 'Eduardo Curioso',
    phone: '5511990030006',
    turnos: [
      'Qual é a diferença entre Master LC e Press LC?',
      'Tenho livro publicado e quero entender qual cabe melhor.',
    ],
  },
  {
    cenario: 'divulgar-07-religioso-midia',
    name: 'Pastor Marcos',
    phone: '5511990030007',
    turnos: [
      'Sou pastor, lancei livro cristão em fevereiro pela Amazon.',
      'Quero divulgar em mídia cristã, podcasts, programas evangélicos.',
    ],
  },
  {
    cenario: 'divulgar-08-gestao-redes',
    name: 'Luana Influencer',
    phone: '5511990030008',
    turnos: [
      'Lancei meu livro, queria que vocês cuidassem das minhas redes sociais.',
      'Postar diariamente, responder DM, criar conteúdo.',
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // CASOS ESPECIAIS (2)
  // ════════════════════════════════════════════════════════════════
  {
    cenario: 'especial-01-aluno-curso',
    name: 'Camila Aluna',
    phone: '5511990040001',
    turnos: [
      'Oi, sou aluna do Curso Escritores Admiráveis e estou com dificuldade pra acessar uma aula.',
    ],
  },
  {
    cenario: 'especial-02-hostil-golpe',
    name: 'Roberta Hostil',
    phone: '5511990040002',
    turnos: [
      'Para de me mandar mensagem isso é golpe!',
    ],
  },
];

async function seedOne(persona) {
  const ghlId = `demo-30-${persona.phone}-${Date.now()}`;

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
  console.log(`\n🌱 Seed de 30 cenários cobrindo escrever/publicar/divulgar + casos especiais\n`);
  console.log(`   Total: ${POOL.length} personas\n`);

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
  console.log(`✅ ${count} conversas seedadas (${errors} erros)`);
  console.log(`📱 Filtra no dashboard por ghl_contact_id LIKE 'demo-30-%'`);
  console.log(`   ou roda no DB:`);
  console.log(`   SELECT name, funnel, stage, qualification_score FROM contacts WHERE ghl_contact_id LIKE 'demo-30-%' ORDER BY id DESC;\n`);
}

main().catch(err => {
  console.error('❌ Seed falhou:', err.message);
  process.exit(1);
});
