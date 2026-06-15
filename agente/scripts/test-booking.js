// Teste CONTROLADO de agendamento real no GHL.
//
// Cria um contato de teste, marca uma reunião num horário livre real e mostra
// o resultado pra você conferir no GHL. Depois apaga tudo (appointment +
// contato) pra não deixar lixo.
//
// Uso:
//   node scripts/test-booking.js          → cria contato + marca reunião (e mostra IDs)
//   node scripts/test-booking.js delete <appointmentId> <contactId>  → limpa
//
// Pré: GHL_API_TOKEN, GHL_LOCATION_ID, GHL_CALENDAR_IDS, SCHEDULING_ENABLED=true
import 'dotenv/config';
import { GHL } from '../src/ghl/client.js';
import { getCalendarIds, getNextSlots, labelForSlot } from '../src/agent/scheduling.js';

const SLOT_MIN = Number(process.env.GHL_SLOT_MINUTES || 30);

async function flattenFirstSlot() {
  // pega o slot mais próximo entre todos os calendários (com o calendarId dele)
  const slots = await getNextSlots(1);
  return slots[0] || null;
}

async function doBooking() {
  if (!getCalendarIds().length) { console.error('❌ GHL_CALENDAR_IDS vazio'); process.exit(1); }

  // 1) slot real mais próximo
  const slot = await flattenFirstSlot();
  if (!slot) { console.error('❌ nenhum horário livre encontrado'); process.exit(1); }
  console.log(`Horário escolhido: ${slot.label} (${slot.iso}) — closer ${slot.calendarId}`);

  // 2) contato de teste (claramente marcado pra apagar)
  console.log('\nCriando contato de teste...');
  const contactResp = await GHL.upsertContact({
    firstName: 'TESTE TINA',
    lastName: '(apagar)',
    phone: '+5511999990000',
    source: 'teste-agendamento-tina',
    tags: ['teste-tina-apagar'],
  });
  const contactId = contactResp?.contact?.id || contactResp?.id;
  if (!contactId) { console.error('❌ não consegui criar contato:', JSON.stringify(contactResp)); process.exit(1); }
  console.log('Contato de teste criado:', contactId);

  // 3) marca a reunião
  console.log('\nMarcando reunião...');
  const start = new Date(slot.iso);
  const end = new Date(start.getTime() + SLOT_MIN * 60000);
  const appt = await GHL.bookAppointment({
    calendarId: slot.calendarId,
    contactId,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    title: 'TESTE TINA — reunião de validação (apagar)',
    notes: 'Agendamento de teste criado pelo script test-booking.js. Pode apagar.',
  });
  const apptId = appt?.id || appt?.appointment?.id || appt?.event?.id;
  console.log('\n✅ REUNIÃO MARCADA!');
  console.log('   appointmentId:', apptId);
  console.log('   status:', appt?.appointmentStatus || appt?.appointment?.appointmentStatus || '?');
  console.log('   quando:', slot.label);
  console.log('\nConfere no GHL (calendário do closer). Pra APAGAR depois, rode:');
  console.log(`   node scripts/test-booking.js delete ${apptId} ${contactId}`);
}

async function doDelete(apptId, contactId) {
  if (apptId) {
    try { await GHL.deleteAppointment(apptId); console.log('✅ appointment apagado:', apptId); }
    catch (e) { console.log('⚠ falha ao apagar appointment:', e.message); }
  }
  if (contactId) {
    try { await GHL.deleteContact(contactId); console.log('✅ contato apagado:', contactId); }
    catch (e) { console.log('⚠ falha ao apagar contato:', e.message); }
  }
}

const [, , cmd, a, b] = process.argv;
(cmd === 'delete' ? doDelete(a, b) : doBooking())
  .catch(e => { console.error('ERRO:', e.message); process.exit(1); });
