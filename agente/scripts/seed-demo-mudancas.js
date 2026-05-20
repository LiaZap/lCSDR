// Seed de 5 conversas demo focadas nas MUDANÇAS recentes da Tina
// (após documentação estratégica + reunião LC 18/05 + orientações 20/05).
//
// Cada persona foi curada pra exercitar UM ponto novo do prompt:
//   1. Lead sem dinheiro  → acolhe + indica livro/curso (NÃO desqualifica)
//   2. Aluno com dúvida   → encaminha pro email cursos@lcagencia.com.br
//   3. Não-aluno interess.→ menciona o Gabriel + leva pro time vender
//   4. ISBN / concursos   → orienta CBL e curso Escritores Admiráveis
//   5. Lead pronto agendar→ tina-agenda + handoff quente/superquente
//
// Uso (dentro do container do lcsdr):
//   node scripts/seed-demo-mudancas.js
//
// Custo aproximado: ~US$ 0.02 (5 conversas curtas).

import 'dotenv/config';
import { db } from '../src/db/index.js';
import { generateTinaReply } from '../src/agent/tina.js';
import { recordInbound, recordOutbound } from '../src/agent/contactService.js';

const POOL = [
  // ============================================================
  // 1. LEAD SEM DINHEIRO — exercita a mudança estratégica (acolhe)
  // ============================================================
  {
    persona: 'Sem dinheiro — acolhimento + produto de entrada',
    name: 'Pedro Aspirante',
    phone: '5511990001001',
    turnos: [
      'Oi, eu queria publicar um livro mas tô meio apertado financeiramente.',
      'Tô desempregado faz uns meses, queria saber se tem alguma coisa de graça pra eu começar.',
      'É um livro sobre superação pessoal, ainda tô organizando os capítulos.',
    ],
  },

  // ============================================================
  // 2. ALUNO COM DÚVIDA — encaminha pro email cursos@lcagencia
  // ============================================================
  {
    persona: 'Aluno com dúvida do curso',
    name: 'Marina Aluna',
    phone: '5511990001002',
    turnos: [
      'Oi, já sou aluna do curso Escritores Admiráveis e tô com uma dúvida sobre o módulo de divulgação.',
      'Não consigo achar a aula sobre apresentar pra editora, sabe me dizer?',
    ],
  },

  // ============================================================
  // 3. NÃO-ALUNO INTERESSADO — Tina menciona o Gabriel
  // ============================================================
  {
    persona: 'Não-aluno interessado no curso',
    name: 'Bruno Curioso',
    phone: '5511990001003',
    turnos: [
      'Oi, vi o Curso Escritores Admiráveis nos stories da Lilian, vale a pena?',
      'Tô pensando em começar a escrever, mas quero entender o que cobre antes de comprar.',
      'Posso parcelar? Como funciona pra fechar?',
    ],
  },

  // ============================================================
  // 4. ISBN / CONCURSO — orientações rápidas novas (CBL, curso)
  // ============================================================
  {
    persona: 'Dúvidas práticas: ISBN e concurso literário',
    name: 'Camila Editora-Solo',
    phone: '5511990001004',
    turnos: [
      'Bom dia! Como faço pra registrar o ISBN do meu livro? E a ficha catalográfica?',
      'Outra coisa: quero participar de concursos literários esse ano, como me preparo?',
      'O livro é de contos, ainda tô finalizando os últimos capítulos.',
    ],
  },

  // ============================================================
  // 5. LEAD QUENTE — perfil completo, vai pra tina-agenda
  // ============================================================
  {
    persona: 'Lead pronto pra agendar (handoff quente)',
    name: 'Dra. Helena Empresária',
    phone: '5511990001005',
    turnos: [
      'Olá, sou médica oncologista, lancei meu livro há 2 meses na Amazon. Quero divulgar pra grande mídia.',
      'Link de venda: amazon.com.br/dp/exemplo. Instagram @drahelena com 8k seguidores.',
      'Tenho budget de R$3000/mês pra investir em divulgação. Quero a Master LC. Quando podemos conversar?',
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

  console.log(`\n━━━ ${persona.persona} ━━━`);
  console.log(`👤 ${persona.name} (${persona.phone})`);

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

    // Atualiza estado
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
  console.log(`   ${POOL.length} personas curadas (uma por mudança/regra nova)\n`);

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
  console.log(`📱 Abra o dashboard em /conversas pra ver — busque por "Pedro Aspirante", "Marina Aluna", etc.\n`);
}

main().catch(err => {
  console.error('❌ Seed falhou:', err.message);
  process.exit(1);
});
