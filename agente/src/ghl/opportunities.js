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

// Defaults conhecidos (Pré-Vendas LCA). Evita o auto-detect que pegava
// "Reentrada" (stages[0]) errado. Env sobrescreve.
const DEFAULT_PIPELINE_ID = 'MfDNcFdH03j0ZBuwJDYM';
const DEFAULT_STAGE_QUALIFIED = '0c040fa3-3ed5-449f-ab07-c7b3fb40f97c'; // Aguardando Atendimento
const DEFAULT_STAGE_IA_TINA = '74164182-d3b0-447b-a761-3bdcd6d47eac';    // IA Tina

function resolvePipeline() {
  if (PIPELINE_CACHE) return PIPELINE_CACHE;
  PIPELINE_CACHE = {
    pipelineId: process.env.GHL_PIPELINE_ID || DEFAULT_PIPELINE_ID,
    stageQualified: process.env.GHL_PIPELINE_STAGE_QUALIFIED || DEFAULT_STAGE_QUALIFIED,
    stageIaTina: process.env.GHL_PIPELINE_STAGE_IA_TINA || DEFAULT_STAGE_IA_TINA,
  };
  return PIPELINE_CACHE;
}

// Cria oportunidade no pipeline "Qualificado" quando a Iara qualifica.
// Se já existe oportunidade pro contato, só move pra stage qualificada.
export async function createOrMoveOpportunityQualified(contact, { funnel, score, notes }) {
  const { pipelineId, stageQualified } = await resolvePipeline();
  if (!pipelineId || !stageQualified) return null;

  try {
    // Verifica se já existe oportunidade aberta. SEM `.catch` inline: se a busca
    // FALHAR (rede/5xx/401), o erro sobe pro catch externo e retorna null SEM
    // criar — senão duplicaria a oportunidade (falha de API ≠ "não tem opp").
    const existing = await GHL.getOpportunitiesByContact(contact.ghl_contact_id);
    const opp = existing?.opportunities?.[0] || existing?.[0];

    if (opp) {
      const cur = opp.pipelineStageId;
      const status = String(opp.status || 'open').toLowerCase();
      // Não reabre negócio fechado (won/lost) nem rouba lead que o time está
      // re-trabalhando (stage bloqueada). Só move o que está livre pra handoff.
      if (status === 'won' || status === 'lost' || blockedOppStages().includes(cur)) return opp.id;
      // Manda `pipelineId` junto: sem ele, o GHL valida o stage contra o
      // pipeline ATUAL da oportunidade — se ela estiver em outro pipeline (ex.:
      // já foi movida pros Closers), o stage não bate e dá 400. Com o
      // pipelineId, move a oportunidade pro pipeline configurado.
      await GHL.updateOpportunity(opp.id, {
        pipelineId,
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

// Stages "do time" (ex: Reentrada): se o lead tem oportunidade ABERTA numa
// delas, o time já está re-trabalhando ele → a Tina NÃO deve assumir. Default:
// "Reentrada" do Pré-Vendas LCA. Adicione outras stages via GHL_BLOCK_OPP_STAGES
// (CSV de stageIds). A Tina move pra "Aguardando Atendimento", nunca pra essas,
// então não há conflito com o que ela mesma cria.
function blockedOppStages() {
  const raw = process.env.GHL_BLOCK_OPP_STAGES || [
    'b661d5f1-69cd-4531-8be9-79b3e11c862f', // Reentrada — Pré-Vendas LCA (SDR)
    '009b6a60-2c9b-41f9-95d3-20d54c18ab8d', // Reentrada — LC Editorial
    'ee211407-4153-4a93-bf03-0b9ff000effe', // Reentrada — Pré-Vendas 2.0 (SDR1)
  ].join(',');
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

// Retorna a oportunidade aberta do lead que está numa stage bloqueada (time
// re-trabalhando), ou null. Falha ABERTO (erro → null → Tina segue normal).
export async function contactInBlockedOppStage(contact) {
  const stages = blockedOppStages();
  if (!stages.length || !contact?.ghl_contact_id || !process.env.GHL_API_TOKEN) return null;
  try {
    const r = await GHL.getOpportunitiesByContact(contact.ghl_contact_id);
    const ops = r?.opportunities || (Array.isArray(r) ? r : []);
    return ops.find(o =>
      stages.includes(o.pipelineStageId)
      && String(o.status || 'open').toLowerCase() === 'open'
    ) || null;
  } catch (err) {
    logger.warn({ err: err.message, contactId: contact.id }, 'falha checando stage de oportunidade (reentrada); segue');
    return null;
  }
}

// Coloca o lead na coluna "IA Tina" pra dar visibilidade ao time enquanto a
// Tina qualifica. SEGURO (default-deny): só CRIA uma oportunidade na IA Tina
// quando o lead NÃO tem nenhuma aberta. Se JÁ existe opp (de quem for, em
// qualquer stage), NÃO mexe — não rouba lead do time nem rebaixa stage. SEM
// `.catch` inline na busca: erro de API → catch externo → NÃO cria (não
// duplica). Falha aberto.
export async function moveLeadToIaTina(contact) {
  const { pipelineId, stageIaTina } = resolvePipeline();
  if (!pipelineId || !stageIaTina || !contact?.ghl_contact_id || !process.env.GHL_API_TOKEN) return null;
  try {
    const r = await GHL.getOpportunitiesByContact(contact.ghl_contact_id);
    const ops = r?.opportunities || (Array.isArray(r) ? r : []);
    if (ops.length) return ops[0].id; // já tem opp → não mexe (não rouba/duplica/rebaixa)
    // Só chega aqui se a busca teve SUCESSO e o lead não tem nenhuma opp.
    const created = await GHL.createOpportunity({
      pipelineId, stageId: stageIaTina, contactId: contact.ghl_contact_id,
      name: `${contact.name || 'Lead'} · IA Tina`,
    });
    return created?.opportunity?.id || created?.id || null;
  } catch (err) {
    logger.warn({ err: err.message, contactId: contact.id }, 'falha criando opp na IA Tina; segue');
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
