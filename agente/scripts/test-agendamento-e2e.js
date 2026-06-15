// Teste END-TO-END do agendamento: conversa real (Gemini) + slots reais do
// GHL + booking real, e confere se o horário marcado bate com o que o lead
// escolheu na conversa. Limpa tudo no fim (appointment + contatos).
//
// Replica a orquestração do webhook (fetch slots quando 'agendando' → Tina
// oferece → lead escolhe → bookSlot → marca no GHL).
//
// Uso: node scripts/test-agendamento-e2e.js
import 'dotenv/config';
import { db } from '../src/db/index.js';
import { GHL } from '../src/ghl/client.js';
import { generateTinaReply } from '../src/agent/tina.js';
import { recordInbound, recordOutbound } from '../src/agent/contactService.js';
import {
  schedulingEnabled, getNextSlots, slotsContextBlock, bookSlot, recordOffer,
} from '../src/agent/scheduling.js';

const created = { appts: [], ghlContacts: [], localIds: [] };

function bubbles(r) {
  return (r.split && r.split.length ? r.split : [r.reply])
    .map(x => typeof x === 'string' ? x : (x && x.text)).filter(Boolean);
}

// Roda 1 turno como o webhook faria (com fetch de slots se 'agendando').
async function turn(localId, msg) {
  recordInbound(localId, { content: msg });
  let fresh = db.prepare('SELECT * FROM contacts WHERE id = ?').get(localId);

  let extraContext = null;
  if (schedulingEnabled() && fresh.stage === 'agendando') {
    const slots = await getNextSlots(8, { spread: true });
    if (slots.length) { extraContext = slotsContextBlock(slots); recordOffer(localId, slots); }
  }

  const r = await generateTinaReply({ contact: fresh, incomingText: msg, extraContext });
  const bs = bubbles(r);
  recordOutbound(localId, { author: 'ia', content: bs.join(' ') });

  console.log('  🧑 ' + msg);
  bs.forEach(b => console.log('  🤖 ' + b));

  // booking real se a Tina decidiu o horário
  let booked = null;
  if (schedulingEnabled() && r.book_slot) {
    booked = await bookSlot(fresh, r.book_slot);
    if (booked.ok) {
      const apptId = booked.appointment?.id || booked.appointment?.appointment?.id || booked.appointment?.event?.id;
      if (apptId) created.appts.push(apptId);
      console.log(`  📅 BOOKED → ${booked.label} | apptId=${apptId}`);
    } else {
      console.log('  ⚠ book falhou:', booked.error);
    }
  }
  // aplica transições de stage como o webhook
  if (r.book_slot && booked?.ok) {
    db.prepare(`UPDATE contacts SET stage='agendado', ai_paused=1 WHERE id=?`).run(localId);
  } else if (r.handoff || r.stage === 'qualificado') {
    db.prepare(`UPDATE contacts SET stage='agendando' WHERE id=?`).run(localId);
  } else if (r.stage) {
    db.prepare('UPDATE contacts SET stage=? WHERE id=?').run(r.stage, localId);
  }
  console.log(`     [stage agora: ${db.prepare('SELECT stage FROM contacts WHERE id=?').get(localId).stage} | book_slot: ${r.book_slot || '-'}]`);
  return { r, booked };
}

async function novoContato(nome) {
  const c = await GHL.upsertContact({
    firstName: nome, lastName: '(TESTE apagar)',
    phone: '+55119' + Math.floor(10000000 + Math.random() * 89999999),
    source: 'teste-e2e-tina', tags: ['teste-tina-apagar'],
  });
  const ghlId = c?.contact?.id || c?.id;
  created.ghlContacts.push(ghlId);
  const info = db.prepare(`INSERT INTO contacts (ghl_contact_id,name,stage) VALUES (?,?,'novo')`).run(ghlId, nome);
  created.localIds.push(info.lastInsertRowid);
  return info.lastInsertRowid;
}

async function cleanup() {
  console.log('\n=== Limpando ===');
  for (const a of created.appts) { try { await GHL.deleteAppointment(a); console.log('  appt apagado', a); } catch (e) { console.log('  ⚠', e.message); } }
  for (const c of created.ghlContacts) { try { await GHL.deleteContact(c); console.log('  contato GHL apagado', c); } catch (e) { console.log('  ⚠', e.message); } }
  for (const id of created.localIds) { db.prepare('DELETE FROM messages WHERE contact_id=?').run(id); db.prepare('DELETE FROM events_log WHERE contact_id=?').run(id); db.prepare('DELETE FROM contacts WHERE id=?').run(id); }
}

async function main() {
  if (!schedulingEnabled()) { console.error('❌ SCHEDULING_ENABLED/GHL_CALENDAR_IDS não configurado'); process.exit(1); }

  try {
    console.log('\n══════ CENÁRIO A: lead quer o quanto antes ══════');
    let id = await novoContato('Vitor');
    await turn(id, 'Oi! Lancei meu livro de liderança na Amazon, quero divulgar pra mídia');
    await turn(id, 'Link é amazon.com.br/vitorlideranca e meu insta @vitor.lideranca');
    await turn(id, 'Consigo investir sim, quanto antes melhor pra mim');
    await turn(id, 'pode ser hoje mesmo');
    const fim = await turn(id, 'pode marcar o primeiro horário que você falou');
    console.log('\n  >>> Resultado A: ' + (fim.booked?.ok ? 'AGENDADO em ' + fim.booked.label : 'NÃO agendou'));

    console.log('\n══════ CENÁRIO B: lead escolhe horário específico ══════');
    id = await novoContato('Carla');
    await turn(id, 'Tenho livro publicado, quero assessoria de imprensa');
    await turn(id, 'amazon.com.br/carla e @carla.escritora, posso investir sim');
    await turn(id, 'quero marcar');
    const slots = await getNextSlots(3);
    const escolha = slots[1] || slots[0];
    console.log(`  (lead vai pedir o 2º horário: ${escolha?.label})`);
    const fimB = await turn(id, `prefiro ${escolha?.label}`);
    console.log('\n  >>> Resultado B: ' + (fimB.booked?.ok ? 'AGENDADO em ' + fimB.booked.label : 'NÃO agendou') + ` | esperado ~${escolha?.label}`);
  } finally {
    await cleanup();
  }
}

main().catch(e => { console.error('ERRO:', e.message, e.stack); process.exit(1); });
