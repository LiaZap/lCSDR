import { db } from '../db/index.js';
import { GHL } from '../ghl/client.js';
import { writeQualificationFields } from '../ghl/customFields.js';
import { createOrMoveOpportunityQualified } from '../ghl/opportunities.js';
import { logger } from '../utils/logger.js';

const FOLLOWUP_MIN = Number(process.env.FOLLOWUP_SILENCE_MINUTES || 60);

// === Etiquetas GHL — esquema "tina-*" (reunião de alinhamento LC, 18/05/2026) ===
// Configuráveis por env — se a LC renomear uma etiqueta, ajusta a variável
// sem mexer no código.
const TAG = {
  // Interesse do lead (mapeia direto do funnel detectado pela Tina)
  escrever: process.env.GHL_TAG_ESCREVER || 'tina-escrever',
  publicar: process.env.GHL_TAG_PUBLICAR || 'tina-publicar',
  divulgar: process.env.GHL_TAG_DIVULGAR || 'tina-divulgar',
  // Lead pronto pro closer (quer agendar / tem perfil de investimento)
  agenda: process.env.GHL_TAG_AGENDA || 'tina-agenda',
  // Dúvidas sobre curso
  duvidaCurso: process.env.GHL_TAG_DUVIDA_CURSO || 'tina-duvida-curso',
  duvidaCursoAluno: process.env.GHL_TAG_DUVIDA_CURSO_ALUNO || 'tina-duvida-curso-aluno',
  // Temperatura (termômetro do lead)
  frio: process.env.GHL_TAG_FRIO || 'frio',
  morno: process.env.GHL_TAG_MORNO || 'morno',
  quente: process.env.GHL_TAG_QUENTE || 'quente',
  superquente: process.env.GHL_TAG_SUPERQUENTE || 'superquente',
};

// Temperatura pelo score (escala definida na reunião LC 18/05):
//   frio 0-20 · morno 21-45 · quente 46-70 · superquente 71+ COM tina-agenda
function temperatureForScore(score, hasAgenda = false) {
  const s = Number(score) || 0;
  if (hasAgenda && s >= 71) return TAG.superquente;
  if (s >= 46) return TAG.quente;
  if (s >= 21) return TAG.morno;
  return TAG.frio;
}

// Mapeia o funnel da Tina pra etiqueta de interesse
function interestTag(funnel) {
  if (funnel === 'escrever') return TAG.escrever;
  if (funnel === 'publicar') return TAG.publicar;
  if (funnel === 'divulgar') return TAG.divulgar;
  return null;
}

const isSyntheticId = (id) => !id || String(id).startsWith('wa-');

// Sincroniza a etiqueta de temperatura no GHL.
// Só chama a API quando a faixa MUDA (compara com contacts.ghl_temp_tag).
async function syncTemperatureTag(contact, score, hasAgenda) {
  if (!process.env.GHL_API_TOKEN || isSyntheticId(contact.ghl_contact_id)) return;

  const wanted = temperatureForScore(score, hasAgenda);
  const current = contact.ghl_temp_tag || null;
  if (wanted === current) return;

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

// Aplica TODAS as etiquetas tina-* no GHL conforme o resultado da Tina.
// Chamado a cada turno pelos webhooks. Idempotente (addTag não duplica).
//   - interesse: tina-escrever / tina-publicar / tina-divulgar (do funnel)
//   - course_help: tina-duvida-curso / tina-duvida-curso-aluno
//   - handoff: tina-agenda (lead pronto pro closer)
//   - temperatura: frio / morno / quente / superquente
export async function applyTinaTags(contact, result) {
  if (!process.env.GHL_API_TOKEN || isSyntheticId(contact.ghl_contact_id)) return;
  if (!result) return;

  const hasAgenda = result.handoff === true || result.stage === 'qualificado';
  const toAdd = [];

  const interest = interestTag(result.funnel);
  if (interest) toAdd.push(interest);

  if (result.course_help === 'comprar') toAdd.push(TAG.duvidaCurso);
  if (result.course_help === 'aluno') toAdd.push(TAG.duvidaCursoAluno);

  if (hasAgenda) toAdd.push(TAG.agenda);

  try {
    if (toAdd.length) {
      await GHL.addTag(contact.ghl_contact_id, toAdd);
    }
    await syncTemperatureTag(contact, result.qualification_score, hasAgenda);
  } catch (err) {
    logger.error({ err: err.message, contactId: contact.id }, 'falha ao aplicar etiquetas tina-* no GHL');
  }
}

// Alias mantido pra compat — agora aplica o conjunto completo de etiquetas.
export const tagLeadProgress = applyTinaTags;

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

  // As etiquetas (tina-agenda, temperatura, etc) são aplicadas pelo
  // applyTinaTags() que o webhook chama a cada turno. Aqui só custom
  // fields + oportunidade no GHL.
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

  await Promise.allSettled([fields, opp]);
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

  // Etiquetas (temperatura frio, etc) são aplicadas pelo applyTinaTags()
  // que o webhook chama a cada turno. Aqui só os custom fields.
  try {
    await writeQualificationFields(contact.ghl_contact_id, {
      funnel: result.funnel,
      score: result.qualification_score,
      notes: result.qualification_notes,
    });
  } catch (err) {
    logger.error({ err: err.message }, 'falha ao gravar custom fields do desqualificado');
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
