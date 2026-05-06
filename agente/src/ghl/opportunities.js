import { db } from '../db/index.js';
import { GHL } from './client.js';
import { logger } from '../utils/logger.js';

// Resolve pipeline + stage "Qualificado" a partir do .env ou de nomes convencionais.
// Configurar no .env:
//   GHL_PIPELINE_ID=abc123
//   GHL_PIPELINE_STAGE_QUALIFIED=stage_xyz
//   GHL_PIPELINE_STAGE_HANDOFF=stage_zzz (opcional, se quiser mover depois)
//
// Se não configurado, tenta detectar: primeiro pipeline da location + primeira stage que contenha "qualif" no nome.

let PIPELINE_CACHE = null;

async function resolvePipeline() {
  if (PIPELINE_CACHE) return PIPELINE_CACHE;

  const envPid = process.env.GHL_PIPELINE_ID;
  const envStageQ = process.env.GHL_PIPELINE_STAGE_QUALIFIED;
  if (envPid && envStageQ) {
    PIPELINE_CACHE = { pipelineId: envPid, stageQualified: envStageQ };
    return PIPELINE_CACHE;
  }

  try {
    const r = await GHL.listPipelines();
    const pipes = r.pipelines || r || [];
    if (!pipes.length) {
      logger.warn('nenhum pipeline no GHL — oportunidade não será criada');
      PIPELINE_CACHE = { pipelineId: null, stageQualified: null };
      return PIPELINE_CACHE;
    }
    const pipe = pipes[0];
    const stage = (pipe.stages || []).find(s => /qualif/i.test(s.name))
                || (pipe.stages || [])[0];
    PIPELINE_CACHE = {
      pipelineId: pipe.id,
      stageQualified: stage?.id || null,
    };
    logger.info({ cache: PIPELINE_CACHE }, 'pipeline detectado');
    return PIPELINE_CACHE;
  } catch (err) {
    logger.error({ err: err.message }, 'falha ao resolver pipeline');
    PIPELINE_CACHE = { pipelineId: null, stageQualified: null };
    return PIPELINE_CACHE;
  }
}

// Cria oportunidade no pipeline "Qualificado" quando a Iara qualifica.
// Se já existe oportunidade pro contato, só move pra stage qualificada.
export async function createOrMoveOpportunityQualified(contact, { funnel, score, notes }) {
  const { pipelineId, stageQualified } = await resolvePipeline();
  if (!pipelineId || !stageQualified) return null;

  try {
    // Verifica se já existe oportunidade aberta
    const existing = await GHL.getOpportunitiesByContact(contact.ghl_contact_id).catch(() => null);
    const opp = existing?.opportunities?.[0] || existing?.[0];

    if (opp) {
      await GHL.updateOpportunity(opp.id, {
        pipelineStageId: stageQualified,
        status: 'open',
        ...(score ? { monetaryValue: estimateTicket(funnel, score) } : {}),
      });
      return opp.id;
    }

    const name = `${contact.name || 'Lead'} · funil ${funnel || '—'}`;
    const created = await GHL.createOpportunity({
      pipelineId,
      stageId: stageQualified,
      contactId: contact.ghl_contact_id,
      name,
      monetaryValue: estimateTicket(funnel, score),
    });
    return created?.opportunity?.id || created?.id || null;
  } catch (err) {
    logger.error({ err: err.message, contactId: contact.id }, 'falha ao criar/mover oportunidade');
    return null;
  }
}

// Estimativa grosseira de ticket pro campo monetaryValue.
// Base: tabela de preços mencionada pela Lilian na reunião.
function estimateTicket(funnel, score = 0) {
  const factor = Math.max(0.3, score / 100);
  switch (funnel) {
    case 'escrever': return Math.round(1680 * factor);   // ticket base: curso
    case 'publicar': return Math.round(50000 * factor);  // Hélice Books
    case 'divulgar': return Math.round(8000 * factor);   // estimativa média
    default: return 0;
  }
}
