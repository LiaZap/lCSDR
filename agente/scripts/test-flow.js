// Teste interno end-to-end da Tina SEM mandar pro WhatsApp real.
// Simula conversas com personas, mostra a resposta + qualificação + payload uazapi que iria.
//
// Uso:
//   node scripts/test-flow.js                  # roda todas as personas
//   node scripts/test-flow.js autor             # só autor inseguro
//   node scripts/test-flow.js profissional
//   node scripts/test-flow.js lixo
//   node scripts/test-flow.js publicado

import 'dotenv/config';
import { db } from '../src/db/index.js';
import { generateTinaReply } from '../src/agent/tina.js';
import { recordInbound, recordOutbound } from '../src/agent/contactService.js';

const PERSONAS = {
  autor: {
    nome: 'Maria (autora inseguro)',
    turnos: [
      'Oi, eu quero escrever um livro mas não sei nem por onde começar.',
      'Tenho uma ideia sobre superação. Minha filha tem autismo e foi uma jornada de 10 anos.',
      'Sou psicóloga, atendo várias famílias. Quero deixar isso em livro pra ajudar outros pais.',
      'Já tenho umas 30 páginas escritas mas tô travada na estrutura.',
    ],
  },
  profissional: {
    nome: 'Dr. Carlos (advogado)',
    turnos: [
      'Bom dia. Sou advogado tributarista e terminei meu livro de 180 páginas. Quero publicar com qualidade premium.',
      'Quero distribuir em livraria e ter um livro de autoridade pra usar em palestras.',
      'Tenho orçamento, estou querendo entender o investimento e o prazo.',
      'Posso conversar com alguém ainda hoje?',
    ],
  },
  lixo: {
    nome: 'Joana (lead sem perfil)',
    turnos: [
      'Oi achei que era de graça?',
      'Queria fazer um livrinho de receita pra dar pra minha família no natal',
      'Mas eu não tenho dinheiro pra pagar nada não, é só pra gente da família mesmo',
    ],
  },
  publicado: {
    nome: 'Roberto (livro publicado)',
    turnos: [
      'Oi! Lancei meu livro de negócios mês passado na Amazon, já tem umas 30 avaliações boas.',
      'Quero divulgar pra mídia, sair em revista, podcast, esse tipo de coisa.',
      'Sou empresário, tenho restaurante. O livro fala sobre gestão de equipe.',
      'Qual a diferença entre Master LC e Press LC?',
    ],
  },
};

function divider(char = '─', len = 70) {
  return char.repeat(len);
}

async function runPersona(key) {
  const persona = PERSONAS[key];
  if (!persona) { console.error(`persona "${key}" não existe`); return; }

  console.log('\n' + '═'.repeat(70));
  console.log(`  PERSONA: ${persona.nome}  [${key}]`);
  console.log('═'.repeat(70));

  // Cria contato sintético isolado
  const ghlId = `flow-test-${key}-${Date.now()}`;
  const info = db.prepare(`
    INSERT INTO contacts (ghl_contact_id, name, phone, stage)
    VALUES (?, ?, ?, 'novo')
  `).run(ghlId, persona.nome, '5511999999999');
  const contactId = info.lastInsertRowid;

  for (let i = 0; i < persona.turnos.length; i++) {
    const userMsg = persona.turnos[i];
    console.log(`\n${divider()}`);
    console.log(`TURNO ${i + 1} — Lead diz:`);
    console.log(`  "${userMsg}"`);
    console.log(divider());

    recordInbound(contactId, { content: userMsg });
    const fresh = db.prepare('SELECT * FROM contacts WHERE id = ?').get(contactId);

    let result;
    try {
      result = await generateTinaReply({ contact: fresh, incomingText: userMsg });
    } catch (err) {
      console.error('  ❌ Tina falhou:', err.message);
      console.error('  ', err.body || '');
      break;
    }

    // Atualiza estado do contato (igual webhook real faz)
    db.prepare(`
      UPDATE contacts
      SET funnel = COALESCE(?, funnel),
          stage = COALESCE(?, stage),
          qualification_score = ?,
          qualification_notes = COALESCE(?, qualification_notes),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      result.funnel || null, result.stage || null,
      result.qualification_score || fresh.qualification_score || 0,
      result.qualification_notes || null, contactId
    );

    // Mostra resposta(s)
    const items = result.split && result.split.length ? result.split : [result.reply];
    items.forEach((item, idx) => {
      const text = typeof item === 'string' ? item : (item?.text || '');
      const buttons = (typeof item === 'object' && item?.buttons) || null;
      const footer = (typeof item === 'object' && item?.footerText) || null;

      console.log(`\n  💬 Tina${items.length > 1 ? ` (bolha ${idx + 1})` : ''}:`);
      text.split('\n').forEach(l => console.log(`     ${l}`));

      if (buttons && buttons.length) {
        console.log(`\n     [BOTÕES — ${buttons.length > 3 ? 'lista (modal)' : 'inline (até 3)'}]`);
        buttons.forEach(b => console.log(`     ◉  ${b.label}  →  value=${b.value || b.label}`));
        if (footer) console.log(`     ${footer}`);

        // Mostra o payload uazapi que sairia
        const choices = buttons.map(b => `${b.label}|${b.value || b.label}`);
        console.log(`\n     ↳ payload uazapi:`);
        console.log(`       type:    "${buttons.length > 3 ? 'list' : 'button'}"`);
        console.log(`       choices: ${JSON.stringify(choices)}`);
      }

      if (text) recordOutbound(contactId, { author: 'ia', content: text, usage: result.usage });
    });

    // Painel de qualificação
    const updated = db.prepare('SELECT * FROM contacts WHERE id = ?').get(contactId);
    console.log(`\n  📊 Estado:`);
    console.log(`     funil:  ${updated.funnel || '(indef)'}`);
    console.log(`     fase:   ${updated.stage}`);
    console.log(`     score:  ${updated.qualification_score}/100`);
    if (result.service_recommended) console.log(`     produto sugerido: ${result.service_recommended}`);
    if (result.handoff) console.log(`     ⇢ HANDOFF: ${result.handoff_reason || 'qualificado'}`);
    if (result.end_conversation) console.log(`     ✕ ENCERRA conversa`);
    if (result.qualification_notes) {
      console.log(`     notas:  ${result.qualification_notes}`);
    }
    const u = result.usage || {};
    console.log(`     custo:  ${u.tokens_in || 0}in + ${u.tokens_out || 0}out = US$${(u.cost_usd || 0).toFixed(4)}`);

    // Para se a IA já encerrou ou já fez handoff
    if (result.end_conversation || result.handoff) {
      console.log(`\n  → fluxo encerrado pela Tina no turno ${i + 1}`);
      break;
    }
  }

  // Limpa o contato sintético
  db.prepare('DELETE FROM messages WHERE contact_id = ?').run(contactId);
  db.prepare('DELETE FROM contacts WHERE id = ?').run(contactId);
}

async function main() {
  const which = process.argv[2];
  const hasOpenAI = process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.length > 30;
  const hasAnthropic = process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.length > 30;
  if (!hasOpenAI && !hasAnthropic) {
    console.error('❌ Nenhum provider configurado. Defina OPENAI_API_KEY ou ANTHROPIC_API_KEY no .env');
    process.exit(1);
  }
  const provider = process.env.LLM_PROVIDER || (hasOpenAI ? 'openai' : 'anthropic');
  const model = provider === 'openai' ? (process.env.OPENAI_MODEL || 'gpt-4.1-mini') : (process.env.CLAUDE_MODEL || 'claude-sonnet-4-6');
  console.log(`\nProvider: ${provider}  ·  Model: ${model}\n`);

  const keys = which ? [which] : Object.keys(PERSONAS);
  for (const k of keys) {
    await runPersona(k);
  }

  console.log('\n' + '═'.repeat(70));
  console.log('  ✅ teste de fluxo concluído');
  console.log('═'.repeat(70));
}

main().catch(err => {
  console.error('❌', err.message);
  if (err.body) console.error(JSON.stringify(err.body, null, 2));
  process.exit(1);
});
