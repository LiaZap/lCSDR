// Popula o banco com 30+ conversas demo geradas pela própria Lila.
// Útil pra Lilian/Bruna abrirem o dashboard e VEREM dado real (não vazio).
//
// Uso: node scripts/seed-demo-conversations.js [count]
//   count = quantas rodadas do conjunto de personas (default 2)

import 'dotenv/config';
import { db } from '../src/db/index.js';
import { generateLilaReply } from '../src/agent/lila.js';
import { recordInbound, recordOutbound } from '../src/agent/contactService.js';

// Pool de conversas demo — variações do test-suite + casos novos.
// Estes são contatos REAIS no banco (não prefixo "playground-"), pra aparecerem no dashboard.
const POOL = [
  {
    name: 'Maria Silva',
    phone: '5511987001001',
    turnos: [
      'Oi, quero escrever um livro mas não sei nem por onde começar.',
      'Tenho uma ideia sobre superação familiar.',
      'Sou psicóloga, atendo várias famílias.',
    ],
  },
  {
    name: 'Dr. Carlos Tributário',
    phone: '5511987001002',
    turnos: [
      'Bom dia. Sou advogado e terminei meu livro de 180 páginas. Quero publicar premium.',
      'Quero distribuir em livraria, livro de autoridade pra palestras.',
      'Tenho orçamento, quero entender investimento e prazo.',
    ],
  },
  {
    name: 'Roberto Empresário',
    phone: '5511987001003',
    turnos: [
      'Oi! Lancei meu livro de negócios mês passado na Amazon.',
      'Quero divulgar pra mídia, sair em revista, podcast.',
      'Sou dono de restaurante, livro fala sobre gestão.',
    ],
  },
  {
    name: 'Acácio Oficial',
    phone: '5511987001004',
    turnos: [
      'Sou oficial de justiça e tenho ideia de livro sobre carreira pública.',
      'Não sei se vou conseguir escrever, sempre travo.',
      'Vale a pena pra alguém como eu?',
    ],
  },
  {
    name: 'Patrícia Editora',
    phone: '5511987001005',
    turnos: [
      'Olá, represento a Editora Estrela do Sul, somos pequena, em Curitiba.',
      'Temos 12 títulos, queremos crescer com distribuição.',
    ],
  },
  {
    name: 'Joana',
    phone: '5511987001006',
    turnos: ['Oi achei que era de graça?'],
  },
  {
    name: 'Ana Receitas',
    phone: '5511987001007',
    turnos: [
      'Quero fazer livrinho de receitas só pra família.',
      'Não quero vender nada, é só pra parentes.',
    ],
  },
  {
    name: 'Pedro Sem Recurso',
    phone: '5511987001008',
    turnos: [
      'Quero publicar mas não tenho dinheiro nenhum agora.',
      'Tô desempregado, tem alguma coisa de graça?',
    ],
  },
  {
    name: 'Curioso Pesquisador',
    phone: '5511987001009',
    turnos: [
      'Tô só pesquisando como funciona publicação.',
      'Não tenho livro escrito, é curiosidade.',
    ],
  },
  {
    name: 'Direto ao Preço',
    phone: '5511987001010',
    turnos: [
      'Quanto custa pra publicar? Me diz só o valor.',
      'Não quero conversar com ninguém, só preço.',
    ],
  },
  {
    name: 'Claudia Pedagoga',
    phone: '5511987001011',
    turnos: [
      'Sou pedagoga, tenho livro infantil ilustrado pronto, 24 páginas.',
      'Já tem ilustrador, falta publicar e divulgar.',
    ],
  },
  {
    name: 'Felipe Já Cliente',
    phone: '5511987001012',
    turnos: [
      'Já contratei o Press LC mês passado pro meu primeiro livro.',
      'Agora quero divulgar nas redes, tenho 10k seguidores.',
    ],
  },
  {
    name: 'Chef Marcos',
    phone: '5511987001013',
    turnos: [
      'Sou chef há 20 anos, tenho restaurante, quero publicar livro de receitas profissional.',
      'Quero distribuir em livrarias e eventos gastronômicos.',
    ],
  },
  {
    name: 'Beatriz Médica',
    phone: '5511987001014',
    turnos: [
      'Sou médica oncologista, escrevi livro pra apoio emocional de pacientes com câncer.',
      'Já está pronto, 220 páginas, quero publicar com qualidade.',
      'Quero também divulgar pra grande mídia.',
    ],
  },
  {
    name: 'Lucas Estreante',
    phone: '5511987001015',
    turnos: [
      'Oi, queria começar a escrever um livro de fantasia.',
      'Nunca escrevi, sou estudante de direito.',
    ],
  },
  {
    name: 'Vanessa Coach',
    phone: '5511987001016',
    turnos: [
      'Sou coach de carreira, atendo executivos. Quero publicar meu primeiro livro.',
      'Tenho material em PDF mas falta estruturar como livro.',
      'Posso pagar mentoria pra acelerar.',
    ],
  },
  {
    name: 'Fernando Aposentado',
    phone: '5511987001017',
    turnos: [
      'Sou aposentado da Vale, quero publicar minha biografia.',
      'Tenho 350 páginas escritas, quero distribuir entre amigos e família.',
      'Quanto custa imprimir 1000 cópias?',
    ],
  },
  {
    name: 'Camila Influencer',
    phone: '5511987001018',
    turnos: [
      'Sou influenciadora de finanças, 250k seguidores. Quero lançar meu primeiro livro em 6 meses.',
      'Quero processo completo: escrita, edição, lançamento, divulgação.',
    ],
  },
  {
    name: 'Pastor Daniel',
    phone: '5511987001019',
    turnos: [
      'Sou pastor evangélico, escrevi um livro devocional.',
      'Tenho a comunidade pra distribuir, mas quero estrutura editorial profissional.',
    ],
  },
  {
    name: 'Roberta Hostil',
    phone: '5511987001020',
    turnos: ['Para de me mandar mensagem isso é golpe!'],
  },
];

async function seedOne(persona) {
  const ghlId = `demo-${persona.phone}-${Date.now()}`;

  // Cria contato
  const info = db.prepare(`
    INSERT INTO contacts (ghl_contact_id, name, phone, stage)
    VALUES (?, ?, ?, 'novo')
  `).run(ghlId, persona.name, persona.phone);
  const contactId = info.lastInsertRowid;

  // Roda turnos
  for (const userMsg of persona.turnos) {
    recordInbound(contactId, { content: userMsg });
    const fresh = db.prepare('SELECT * FROM contacts WHERE id = ?').get(contactId);

    let result;
    try {
      result = await generateLilaReply({ contact: fresh, incomingText: userMsg });
    } catch (err) {
      console.error(`  ❌ ${persona.name}: ${err.message}`);
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
    for (const item of items) {
      const txt = typeof item === 'string' ? item : (item?.text || '');
      if (txt) recordOutbound(contactId, { author: 'ia', content: txt, usage: result.usage });
    }

    if (result.end_conversation || result.handoff) break;
  }

  const final = db.prepare('SELECT * FROM contacts WHERE id = ?').get(contactId);
  return final;
}

async function main() {
  const rounds = parseInt(process.argv[2] || '1', 10);
  console.log(`\nSeed demo: ${POOL.length} personas × ${rounds} rodada(s) = ${POOL.length * rounds} conversas\n`);

  let count = 0;
  let errors = 0;
  let totalCost = 0;

  for (let r = 0; r < rounds; r++) {
    for (const persona of POOL) {
      const suffix = rounds > 1 ? ` (#${r + 1})` : '';
      try {
        const final = await seedOne({
          ...persona,
          name: persona.name + suffix,
          phone: persona.phone.slice(0, -3) + String(r * POOL.length + (count % 1000)).padStart(3, '0'),
        });
        const stage = final.stage || '?';
        const score = final.qualification_score || 0;
        const funnel = final.funnel || '—';
        console.log(`✓ ${persona.name}${suffix} · ${funnel} · ${stage} · ${score}/100`);
        count++;
      } catch (err) {
        console.error(`✗ ${persona.name}${suffix}: ${err.message}`);
        errors++;
      }
    }
  }

  console.log(`\n✅ ${count} conversas seedadas (${errors} erros)`);
  console.log('   Abra o dashboard em /leads ou /conversas pra ver.\n');
}

main().catch(err => {
  console.error('❌ Seed falhou:', err.message);
  process.exit(1);
});
