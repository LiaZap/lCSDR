import { db } from '../db/index.js';
import { GHL } from '../ghl/client.js';
import { writeQualificationFields } from '../ghl/customFields.js';
import { createOrMoveOpportunityQualified } from '../ghl/opportunities.js';
import { logger } from '../utils/logger.js';

const FOLLOWUP_MIN = Number(process.env.FOLLOWUP_SILENCE_MINUTES || 60);

// === Etiquetas GHL (esquema real da LC) ===
// Configuráveis por env — se a LC renomear uma etiqueta, ajusta a variável
// sem mexer no código. Defaults = nomes confirmados pela Icá (mai/2026).
const TAG = {
  closers: process.env.GHL_TAG_CLOSERS || 'funil-lca-closers',
  quente: process.env.GHL_TAG_QUENTE || 'quente',
  morno: process.env.GHL_TAG_MORNO || 'morno',
  frio: process.env.GHL_TAG_FRIO || 'frio',
};

// Temperatura do lead pelo score de qualificação.
function temperatureForScore(score) {
  const s = Number(score) || 0;
  if (s >= 60) return TAG.quente;
  if (s >= 30) return TAG.morno;
  return TAG.frio;
}

// Sincroniza a etiqueta de temperatura no GHL.
// Só chama a API do GHL quando a faixa MUDA (compara com contacts.ghl_temp_tag)
// — evita spammar a API a cada turno da conversa.
async function syncTemperatureTag(contact, score) {
  if (!process.env.GHL_API_TOKEN) return;
  // Contato ainda com ID sintético wa- não existe no GHL — pula
  if (!contact.ghl_contact_id || String(contact.ghl_contact_id).startsWith('wa-')) return;

  const wanted = temperatureForScore(score);
  const current = contact.ghl_temp_tag || null;
  if (wanted === current) return; // já está na faixa certa

  try {
    if (current) {
      await GHL.removeTag(contact.ghl_contact_id, [current]).catch(() => {});
    }
    await GHL.addTag(contact.ghl_contact_id, [wanted]);
    db.prepare('UPDATE contacts SET ghl_temp_tag = ? WHERE id = ?').run(wanted, contact.id);
    logger.info({ contactId: contact.id, from: current, to: wanted }, 'temperatura GHL atualizada');
  } catch (err) {
    logger.error({ err: err.message, contactId: contact.id }, 'falha ao sincronizar temperatura GHL');
  }
}

// Chamado a cada turno enquanto o lead ainda está em qualificação (não fez
// handoff nem foi descartado). Mantém a etiqueta de temperatura em dia.
export async function tagLeadProgress(contact, result) {
  await syncTemperatureTag(contact, result?.qualification_score);
}

export function pauseIA(contactId, reason = 'sdr_assumiu') {
  db.prepare(`
    UPDATE contacts
    SET ai_paused = 1, ai_paused_at = CURRENT_TIMESTAMP, stage = 'handoff', updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(contactId);
  db.prepare(`
    INSERT INTO events_log (contact_id, kind, payload) VALUES (?, 'handoff', ?)
  `).run(contactId, JSON.stringify({ reason }));
}

export function resumeIA(contactId, reason = 'silencio_humano') {
  db.prepare(`
    UPDATE contacts
    SET ai_paused = 0, ai_paused_at = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(contactId);
  db.prepare(`
    INSERT INTO events_log (contact_id, kind, payload) VALUES (?, 'ia_resume', ?)
  `).run(contactId, JSON.stringify({ reason }));
}

export function scheduleFollowup(contactId, reason = 'silencio_lead', minutesFromNow = FOLLOWUP_MIN) {
  const due = new Date(Date.now() + minutesFromNow * 60_000).toISOString();
  db.prepare(`
    INSERT INTO followups (contact_id, due_at, reason) VALUES (?, ?, ?)
  `).run(contactId, due, reason);
}

export async function markQualifiedAndHandoff(contact, result) {
  db.prepare(`
    UPDATE contacts
    SET stage = 'qualificado',
        funnel = COALESCE(?, funnel),
        qualification_score = ?,
        qualification_notes = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(result.funnel || null, result.qualification_score || 0, result.qualification_notes || '', contact.id);

  pauseIA(contact.id, 'qualificado_pronto_pro_sdr');

  // GHL: etiquetas + custom fields + oportunidade em paralelo (erro de um não trava os outros)
  // Etiqueta funil-lca-closers = lead "passa pras closers". Temperatura = quente.
  const tag = (async () => {
    await syncTemperatureTag(contact, result.qualification_score);
    await GHL.addTag(contact.ghl_contact_id, [TAG.closers]);
  })().catch(err => logger.error({ err: err.message }, 'tag GHL (handoff) falhou'));

  const fields = writeQualificationFields(contact.ghl_contact_id, {
    funnel: result.funnel,
    score: result.qualification_score,
    notes: result.qualification_notes,
  });

  const opp = createOrMoveOpportunityQualified(contact, {
    funnel: result.funnel,
    score: result.qualification_score,
    notes: result.qualification_notes,
  }).then(oppId => {
    if (oppId) {
      db.prepare(`
        INSERT INTO events_log (contact_id, kind, payload)
        VALUES (?, 'opportunity_qualified', ?)
      `).run(contact.id, JSON.stringify({ oppId }));
    }
  });

  await Promise.allSettled([tag, fields, opp]);
}

export async function markDisqualified(contact, result) {
  db.prepare(`
    UPDATE contacts
    SET stage = 'desqualificado',
        qualification_score = ?,
        qualification_notes = ?,
        ai_paused = 1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(result.qualification_score || 0, result.qualification_notes || '', contact.id);

  try {
    // Lead descartado → temperatura frio (score baixo cai na faixa frio)
    await syncTemperatureTag(contact, result.qualification_score);
    await writeQualificationFields(contact.ghl_contact_id, {
      funnel: result.funnel,
      score: result.qualification_score,
      notes: result.qualification_notes,
    });
  } catch (err) {
    logger.error({ err: err.message }, 'falha ao taggear desqualificado');
  }
}

// Chamado quando detectamos no webhook que um SDR humano respondeu direto no GHL.
// Pausa a IA na hora e agenda retomada caso o lead fique no vácuo.
export function handleSDRReply(contactId, sdrId = null) {
  db.prepare(`
    UPDATE contacts
    SET ai_paused = 1,
        ai_paused_at = CURRENT_TIMESTAMP,
        assigned_sdr_id = COALESCE(?, assigned_sdr_id),
        last_outbound_at = CURRENT_TIMESTAMP,
        stage = CASE WHEN stage IN ('novo','pre_qualificando','qualificando') THEN 'handoff' ELSE stage END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(sdrId, contactId);
}
