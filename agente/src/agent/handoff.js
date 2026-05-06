import { db } from '../db/index.js';
import { GHL } from '../ghl/client.js';
import { writeQualificationFields } from '../ghl/customFields.js';
import { createOrMoveOpportunityQualified } from '../ghl/opportunities.js';
import { logger } from '../utils/logger.js';

const FOLLOWUP_MIN = Number(process.env.FOLLOWUP_SILENCE_MINUTES || 60);

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

  // GHL: tag + custom fields + oportunidade em paralelo (não deixa um erro travar os outros)
  const tag = GHL.addTag(contact.ghl_contact_id, [
    'iara-qualificado',
    result.funnel ? `funil-${result.funnel}` : 'funil-indefinido',
  ].filter(Boolean)).catch(err => logger.error({ err: err.message }, 'tag GHL falhou'));

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
    await GHL.addTag(contact.ghl_contact_id, ['iara-desqualificado']);
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
