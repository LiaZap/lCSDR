// Testes de BORDA do agendamento (atrito real de conversa).
// Conversa real + slots reais + booking real, observando se a Tina segura:
//   E1) lead pede "amanhã de manhã" (dia diferente do oferecido)
//   E2) lead recusa os horários ("nenhum serve, tem mais tarde?")
//   E3) lead muda de ideia ("na verdade quero pensar")
//   E4) lead pede horário fora do disponível ("pode às 22h?")
//
// O que NÃO pode acontecer: inventar horário, marcar horário errado, ou
// empurrar agendamento quando o lead recuou.
//
// Uso: node scripts/test-agendamento-edge.js
import 'dotenv/config';
import { db } from '../src/db/index.js';
import { GHL } from '../src/ghl/client.js';
import { generateTinaReply } from '../src/agent/tina.js';
import { recordInbound, recordOutbound } from '../src/agent/contactService.js';
import {
  schedulingEnabled, getNextSlots, slotsContextBlock, bookSlot, recordOffer, labelForSlot,
} from '../src/agent/scheduling.js';

const created = { appts: [], ghlContacts: [], localIds: [] };
const bubbles = r => (r.split && r.split.length ? r.split : [r.reply]).map(x => typeof x === 'string' ? x : (x && x.text)).filter(Boolean);

async function turn(localId, msg) {
  recordInbound(localId, { content: msg });
  let fresh = db.prepare('SELECT * FROM contacts WHERE id = ?').get(localId);
  let extraContext = null;
  let offered = [];
  if (schedulingEnabled() && fresh.stage === 'agendando') {
    offered = await getNextSlots(8, { spread: true });
    if (offered.length) { extraContext = slotsContextBlock(offered); recordOffer(localId, offered); }
  }
  const r = await generateTinaReply({ contact: fresh, incomingText: msg, extraContext });
  recordOutbound(localId, { author: 'ia', content: bubbles(r).join(' ') });
  console.log('  🧑 ' + msg);
  bubbles(r).forEach(b => console.log('  🤖 ' + b));

  let booked = null;
  if (schedulingEnabled() && r.book_slot) {
    // valida: o book_slot tem que ser um dos horários REALMENTE oferecidos
    const offeredIsos = offered.map(s => s.iso);
    const wasOffered = offeredIsos.includes(r.book_slot);
    booked = await bookSlot(fresh, r.book_slot);
    if (booked.ok) {
      const id = booked.appointment?.id || booked.appointment?.appointment?.id || booked.appointment?.event?.id;
      if (id) created.appts.push(id);
    }
    console.log(`  📅 book_slot=${r.book_slot} (${labelForSlot(r.book_slot)}) | estava na lista oferecida? ${wasOffered ? 'SIM ✅' : 'NÃO ❌ INVENTOU'}`);
  }
  if (r.book_slot && booked?.ok) db.prepare(`UPDATE contacts SET stage='agendado', ai_paused=1 WHERE id=?`).run(localId);
  else if (r.handoff || r.stage === 'qualificado') db.prepare(`UPDATE contacts SET stage='agendando' WHERE id=?`).run(localId);
  else if (r.stage) db.prepare('UPDATE contacts SET stage=? WHERE id=?').run(r.stage, localId);
  return r;
}

async function novo(nome) {
  const c = await GHL.upsertContact({ firstName: nome, lastName: '(TESTE apagar)', phone: '+55119' + Math.floor(10000000 + Math.random() * 89999999), source: 'teste-edge-tina', tags: ['teste-tina-apagar'] });
  const ghlId = c?.contact?.id || c?.id;
  created.ghlContacts.push(ghlId);
  const info = db.prepare(`INSERT INTO contacts (ghl_contact_id,name,stage,funnel) VALUES (?,?,'agendando','divulgar')`).run(ghlId, nome);
  created.localIds.push(info.lastInsertRowid);
  // pré-carrega contexto de lead já qualificado (pra ir direto ao agendamento)
  recordInbound(info.lastInsertRowid, { content: 'tenho livro publicado, quero assessoria, posso investir sim' });
  recordOutbound(info.lastInsertRowid, { author: 'ia', content: 'Perfeito! Vou te encaixar com o especialista. Prefere hoje ou amanhã?' });
  return info.lastInsertRowid;
}

async function cleanup() {
  console.log('\n=== Limpando ===');
  for (const a of created.appts) { try { await GHL.deleteAppointment(a); } catch {} }
  for (const c of created.ghlContacts) { try { await GHL.deleteContact(c); } catch {} }
  for (const id of created.localIds) { db.prepare('DELETE FROM messages WHERE contact_id=?').run(id); db.prepare('DELETE FROM events_log WHERE contact_id=?').run(id); db.prepare('DELETE FROM contacts WHERE id=?').run(id); }
  console.log(`  apagados: ${created.appts.length} reuniões, ${created.ghlContacts.length} contatos`);
}

async function main() {
  if (!schedulingEnabled()) { console.error('❌ scheduling não configurado'); process.exit(1); }
  try {
    console.log('\n══════ E1: lead pede "amanhã de manhã" ══════');
    let id = await novo('Edu');
    await turn(id, 'na verdade prefiro amanhã de manhã, mais cedo possível');
    await turn(id, 'pode ser o horário mais cedo de amanhã');

    console.log('\n══════ E2: lead recusa os horários ══════');
    id = await novo('Bia');
    await turn(id, 'esses horários não servem, tem algo mais tarde, fim da tarde?');

    console.log('\n══════ E3: lead muda de ideia ══════');
    id = await novo('Caio');
    await turn(id, 'ah na verdade deixa eu pensar melhor antes de marcar');

    console.log('\n══════ E4: lead pede horário fora do disponível ══════');
    id = await novo('Dani');
    await turn(id, 'pode marcar às 22h hoje?');
  } finally {
    await cleanup();
  }
}
main().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
