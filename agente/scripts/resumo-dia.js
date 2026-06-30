// Resumo do dia da Tina — pra acompanhar/mandar pra Lilian.
// Roda no container do lcsdr: node scripts/resumo-dia.js
import 'dotenv/config';
import { db } from '../src/db/index.js';

// mapa calendarId/userId → nome (ajuste se mudar a equipe)
const CAL = {
  'xzm7QW8TUGbwOP6IxAK8': 'Andressa', 'fMuUzjj4nSKRUXEPZYAx': 'Victor',
  'OGYp8xuhvT1Fk5alNApk': 'Nataly', 'mbhOf9ovPL5HcCnCu5EN': 'Fernanda',
  '3XfNAPi9421TD3HlN7ac': 'Bruna', 'NhjBRFw1AJex8TqNuLAw': 'Gabriel',
};

function countToday(kind) {
  return db.prepare(`SELECT COUNT(*) c FROM events_log WHERE kind=? AND date(created_at)=date('now')`).get(kind)?.c || 0;
}
function rowsToday(kind) {
  return db.prepare(`
    SELECT e.created_at, e.payload, c.name, c.phone, c.funnel
    FROM events_log e LEFT JOIN contacts c ON c.id = e.contact_id
    WHERE e.kind=? AND date(e.created_at)=date('now') ORDER BY e.id DESC
  `).all(kind);
}

console.log('\n════════ RESUMO DO DIA — TINA ════════');
console.log('(' + new Date().toLocaleDateString('pt-BR') + ')\n');

// ═══ PLACAR (resumo rápido pra mandar pro grupo) ═══
const _atendeu = db.prepare(`SELECT COUNT(DISTINCT contact_id) c FROM messages WHERE author='ia' AND date(created_at)=date('now')`).get()?.c || 0;
const _msgsIa = db.prepare(`SELECT COUNT(*) c FROM messages WHERE author='ia' AND date(created_at)=date('now')`).get()?.c || 0;
const _agendou = countToday('reuniao_agendada');
const _conv = _atendeu ? Math.round((_agendou / _atendeu) * 100) : 0;
const _falarAgora = countToday('live_handoff');
const _sdrMsg = db.prepare(`SELECT COUNT(DISTINCT contact_id) c FROM messages WHERE author='sdr' AND date(created_at)=date('now')`).get()?.c || 0;
// "Time assumiu" = leads que o SDR respondeu OU que a Tina passou ("falar agora").
const _timeAssumiu = db.prepare(`
  SELECT COUNT(DISTINCT cid) c FROM (
    SELECT contact_id cid FROM messages   WHERE author='sdr'        AND date(created_at)=date('now')
    UNION
    SELECT contact_id cid FROM events_log WHERE kind='live_handoff' AND date(created_at)=date('now')
  )`).get()?.c || 0;

console.log('═══ PLACAR DO DIA ═══');
console.log('🤖 Tina atendeu:   ' + _atendeu + ' leads  (' + _msgsIa + ' msgs)');
console.log('🗓️  Agendou:        ' + _agendou + ' reuniões  (' + _conv + '% dos atendidos)');
console.log('👤 Time assumiu:   ' + _timeAssumiu + ' leads  (' + _falarAgora + ' "falar agora" + ' + _sdrMsg + ' SDR respondeu)');
console.log('─────────────────────\n');

// Leads que mandaram mensagem hoje
const leadsHoje = db.prepare(`
  SELECT COUNT(DISTINCT contact_id) c FROM messages
  WHERE direction='inbound' AND date(created_at)=date('now')
`).get()?.c || 0;
console.log('👥 Leads que conversaram hoje: ' + leadsHoje);

// Leads que a Tina RESPONDEU hoje (saída author='ia') + total de mensagens dela
const tinaFalou = db.prepare(`
  SELECT COUNT(DISTINCT contact_id) c FROM messages
  WHERE author='ia' AND date(created_at)=date('now')
`).get()?.c || 0;
const msgsTina = db.prepare(`
  SELECT COUNT(*) c FROM messages
  WHERE author='ia' AND date(created_at)=date('now')
`).get()?.c || 0;
console.log('💬 Leads que a Tina respondeu hoje: ' + tinaFalou + '  (' + msgsTina + ' mensagens)');

// Stage atual
const stages = db.prepare(`SELECT stage, COUNT(*) c FROM contacts WHERE date(updated_at)=date('now') GROUP BY stage ORDER BY c DESC`).all();
if (stages.length) {
  console.log('\n📊 Por estágio (atualizados hoje):');
  stages.forEach(s => console.log('   ' + (s.stage || '?').padEnd(16) + ' ' + s.c));
}

// Agendamentos
const ag = rowsToday('reuniao_agendada');
console.log('\n🗓️  REUNIÕES AGENDADAS HOJE: ' + ag.length);
const porConsultor = {};
ag.forEach(r => {
  let p = {}; try { p = JSON.parse(r.payload); } catch {}
  const consultor = CAL[p.calendarId] || '(consultor?)';
  porConsultor[consultor] = (porConsultor[consultor] || 0) + 1;
  console.log('   • ' + (r.name || '?').padEnd(22) + ' ' + (p.label || '') + '  → ' + consultor);
});
if (ag.length) {
  console.log('\n   Distribuição (rodízio):');
  Object.entries(porConsultor).forEach(([k, v]) => console.log('     ' + k.padEnd(12) + ' ' + v));
}

// Falar agora (fila ao vivo)
const lh = rowsToday('live_handoff');
console.log('\n🔥 "FALAR AGORA" (passados pra consultor): ' + lh.length);
lh.forEach(r => {
  let p = {}; try { p = JSON.parse(r.payload); } catch {}
  console.log('   • ' + (r.name || '?').padEnd(22) + ' → ' + (p.name || p.userId || '?'));
});

// Outros encaminhamentos
console.log('\n📨 Encaminhamentos:');
console.log('   Publicação (editorial@):     ' + countToday('handoff_publicar'));
console.log('   Aluno do curso (cursos@):    ' + countToday('handoff_aluno'));

// Proteções
console.log('\n🛡️  Proteções:');
console.log('   Pulou (já em atendimento):   ' + (countToday('skip_em_atendimento') + countToday('skip_ja_atribuido')));
console.log('   Pulou (fora da raia/time):   ' + (countToday('skip_fora_raia') + countToday('skip_reentrada')));
console.log('   Double-booking evitado:      ' + countToday('double_booking_evitado'));
console.log('   Trava de preço atuou:        ' + countToday('policy_guard'));

console.log('\n══════════════════════════════════════\n');
