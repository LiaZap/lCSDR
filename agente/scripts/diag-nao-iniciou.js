// Diagnóstico: POR QUE a Tina não INICIOU o atendimento nesses leads?
// Junta 3 coisas num lugar só: (1) pipelines do GHL x o pipeline configurado da
// Tina (pega mismatch), (2) estado local + eventos de cada lead, (3) roda os
// MESMOS gates do webhook (tag, origem, pausa, outro-time/Reentrada, em-atendimento)
// e imprime o VEREDITO. Falha aberto — só leitura, não muda nada.
//
// Uso (no container do lcsdr):
//   node scripts/diag-nao-iniciou.js "Neto" "Vanessa" "Camila"
//   (sem args usa esses 3 nomes)
import 'dotenv/config';
import { GHL } from '../src/ghl/client.js';
import { db } from '../src/db/index.js';
import { resolvePipeline, contactWorkedByOtherTeam, contactOppInReentrada } from '../src/ghl/opportunities.js';

const targets = process.argv.slice(2).length ? process.argv.slice(2) : ['Neto', 'Vanessa', 'Camila'];

const REQUIRED_TAG = (process.env.GHL_TAG_REQUIRED ?? 'tina-liberada').toLowerCase();
const REQUIRED_ON = REQUIRED_TAG && REQUIRED_TAG !== 'false' && REQUIRED_TAG !== '';
const PAUSE_TAG = (process.env.GHL_TAG_PAUSAR_TINA || 'tina-pausada').toLowerCase();
const BLOCK_TAGS = (process.env.GHL_TAG_BLOCK || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const AUTO_SOURCES = new Set(['workflow', 'campaign', 'bulk_actions', 'bulk', 'automation']);
const ATTENDANCE_DAYS = Number(process.env.SKIP_ATTENDANCE_DAYS || 30);
const { pipelineId } = resolvePipeline();

const extractTags = (c) => (c?.tags || []).map(t => (typeof t === 'string' ? t : (t?.name || ''))).map(s => s.toLowerCase()).filter(Boolean);

// 1) PIPELINES — o mismatch mais provável: se o funil dos leads não for o
// pipeline configurado, contactWorkedByOtherTeam barra tudo como "outro time".
console.log('\n════════ PIPELINES (GHL) ════════');
console.log(`Tina usa pipelineId = ${pipelineId}  (GHL_PIPELINE_ID ${process.env.GHL_PIPELINE_ID ? 'setado no env' : 'VAZIO → usando default do código'})`);
try {
  const pr = await GHL.listPipelines();
  for (const p of (pr?.pipelines || [])) {
    console.log(`  ${p.id === pipelineId ? '>> TINA >>' : '         '} ${p.id}  ${p.name}`);
  }
} catch (e) { console.log('  (falha listando pipelines:', e.message, ')'); }

// 2) POR LEAD
for (const t of targets) {
  console.log(`\n════════ ${t} ════════`);
  const local = db.prepare(`SELECT * FROM contacts WHERE name LIKE ? ORDER BY updated_at DESC LIMIT 1`).get(`%${t}%`);

  // 2a) O GHL ENTREGOU o inbound? webhook_InboundMessage é logado ANTES de qualquer
  // gate (contact_id NULL), então se NÃO existe, o GHL não mandou a mensagem pro
  // servidor — o problema é a configuração do webhook no GHL (Gabriel), não os gates.
  const termosBusca = [`%${t}%`];
  if (local?.phone) { termosBusca.push(`%${local.phone}%`); const d = String(local.phone).replace(/\D/g, ''); if (d) termosBusca.push(`%${d.slice(-8)}%`); }
  const whClause = termosBusca.map(() => 'payload LIKE ?').join(' OR ');
  const wh = db.prepare(`SELECT created_at, substr(payload,1,90) p FROM events_log WHERE kind='webhook_InboundMessage' AND (${whClause}) ORDER BY id DESC LIMIT 3`).all(...termosBusca);
  if (wh.length) {
    console.log(`  ✅ GHL ENTREGOU o inbound (${wh.length} webhook_InboundMessage): ${wh.map(w => w.created_at).join(', ')}`);
    console.log('     → o webhook chegou; se não respondeu, foi GATE/LLM/cap (ver abaixo).');
  } else {
    console.log('  ⚠️  NENHUM webhook_InboundMessage encontrado pra esse lead.');
    console.log('     → O GHL provavelmente NÃO está encaminhando as mensagens desse funil/canal pro servidor.');
    console.log('       (Correção é no GHL — o Workflow/Webhook de InboundMessage — não no código da Tina.)');
  }

  if (!local) {
    console.log('  ❌ Também NÃO está no banco local (nunca passou pelo upsert).');
    continue;
  }

  console.log(`  local: id=${local.id}  stage=${local.stage}  ai_paused=${local.ai_paused}  ghl=${local.ghl_contact_id}`);
  console.log(`  last_inbound=${local.last_inbound_at || '—'}   last_outbound(Tina)=${local.last_outbound_at || '—'}`);
  const evs = db.prepare(`SELECT kind, created_at FROM events_log WHERE contact_id=? ORDER BY id DESC LIMIT 8`).all(local.id);
  console.log('  eventos:', evs.length ? evs.map(e => `${e.kind}@${e.created_at}`).join(' | ') : '(nenhum)');
  const iaReplies = db.prepare(`SELECT COUNT(*) c FROM messages WHERE contact_id=? AND author='ia'`).get(local.id)?.c || 0;
  console.log('  respostas da Tina (author=ia):', iaReplies);

  const contact = { id: local.id, ghl_contact_id: local.ghl_contact_id };
  const bloqueios = [];
  try {
    const gc = await GHL.getContact(local.ghl_contact_id);
    const tags = extractTags(gc);
    console.log('  tags GHL:', tags.join(', ') || '(nenhuma)');

    const r = await GHL.getOpportunitiesByContact(local.ghl_contact_id);
    const ops = (r?.opportunities || (Array.isArray(r) ? r : [])).filter(Boolean);
    if (!ops.length) console.log('  opps: (nenhuma)');
    for (const o of ops) {
      const outro = o.pipelineId && o.pipelineId !== pipelineId ? '  <<< OUTRO PIPELINE (barra a Tina)' : '';
      console.log(`  opp: status=${o.status || 'open'}  pipeline=${o.pipelineId}  stage=${o.pipelineStageId}${outro}`);
    }

    // gates de tag (na ordem do webhook)
    if (REQUIRED_ON && !tags.includes(REQUIRED_TAG)) bloqueios.push(`sem tag ${REQUIRED_TAG} (whitelist)`);
    const bt = BLOCK_TAGS.find(x => tags.includes(x));
    if (bt) bloqueios.push(`origem bloqueada: ${bt}`);
    if (tags.includes(PAUSE_TAG)) bloqueios.push(`tag de pausa ${PAUSE_TAG}`);

    // gate outro-time/Reentrada (default ON) — roda a MESMA função do webhook
    const worked = await contactWorkedByOtherTeam(contact);
    const reent = await contactOppInReentrada(contact);
    console.log(`  contactWorkedByOtherTeam = ${worked}   contactOppInReentrada = ${reent}`);
    if (worked) bloqueios.push('contactWorkedByOtherTeam=true → skip_reentrada (opp em Reentrada OU em pipeline ≠ o da Tina)');

    // gate "em atendimento" (só 1º contato, sem outbound da Tina): conversa do
    // GHL tem saída de HUMANO recente (userId, não-automação, dentro de N dias)?
    if (!local.last_outbound_at) {
      try {
        const conv = await GHL.searchConversations(local.ghl_contact_id);
        const c0 = conv?.conversations?.[0] || conv?.[0];
        const mr = c0?.id ? await GHL.getMessages(c0.id, { limit: 25 }) : null;
        const msgs = mr?.messages?.messages || mr?.messages || mr || [];
        const limiteMs = ATTENDANCE_DAYS > 0 ? Date.now() - ATTENDANCE_DAYS * 864e5 : 0;
        const humano = (Array.isArray(msgs) ? msgs : []).find(m => {
          const uid = m.userId || m.user_id || m.sentBy?.id;
          if ((m.direction || '').toLowerCase() !== 'outbound' || !uid) return false;
          if (AUTO_SOURCES.has(String(m.source || '').toLowerCase())) return false;
          if (!limiteMs) return true;
          const ts = new Date(m.dateAdded || m.createdAt || m.date || 0).getTime();
          return ts ? ts >= limiteMs : false;
        });
        if (humano) bloqueios.push(`em atendimento: humano respondeu no GHL (userId=${humano.userId || humano.sentBy?.id}) dentro de ${ATTENDANCE_DAYS}d → skip_em_atendimento`);
      } catch (e) { console.log('  (falha checando em-atendimento:', e.message, ')'); }
    }
  } catch (e) { console.log('  (falha GHL:', e.message, ')'); }

  console.log('  ►► VEREDITO:', bloqueios.length ? bloqueios.join('  ;  ') : 'NENHUM gate de tag/opp/atendimento bloqueia → a Tina DEVERIA ter respondido (suspeitar de webhook não entregue, LLM fora, ou cap diário no momento).');
}
console.log('');
