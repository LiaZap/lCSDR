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

export function resolvePipeline() {
  if (PIPELINE_CACHE) return PIPELINE_CACHE;
  PIPELINE_CACHE = {
    pipelineId: process.env.GHL_PIPELINE_ID || DEFAULT_PIPELINE_ID,
    stageQualified: process.env.GHL_PIPELINE_STAGE_QUALIFIED || DEFAULT_STAGE_QUALIFIED,
    stageIaTina: process.env.GHL_PIPELINE_STAGE_IA_TINA || DEFAULT_STAGE_IA_TINA,
  };
  return PIPELINE_CACHE;
}

// Escolhe a oportunidade RELEVANTE do contato (em vez de `ops[0]` cego, que é
// não-determinístico quando o contato tem várias). Prioriza a ABERTA no pipeline
// da Tina; senão a 1ª aberta; null se não há aberta.
function pickOpenOpp(ops, pipelineId) {
  const open = (Array.isArray(ops) ? ops : []).filter(o => String(o.status || 'open').toLowerCase() === 'open');
  return open.find(o => o.pipelineId === pipelineId) || open[0] || null;
}

// Marca que foi a PRÓPRIA Tina que moveu/criou a opp na IA Tina. O handler do
// webhook de mudança de stage (handleOpportunityStage) usa isso pra IGNORAR o
// evento gerado pela própria movimentação (anti-loop) — imune ao quirk de
// alguns PITs carimbarem userId nas escritas via API.
function markSelfMove(contact, oppId = null) {
  if (!contact?.id) return;
  try {
    db.prepare('UPDATE contacts SET ia_tina_self_moved_at = CURRENT_TIMESTAMP, ia_tina_self_moved_opp = ? WHERE id = ?')
      .run(oppId ? String(oppId) : null, contact.id);
  } catch { /* coluna pode não existir em banco muito antigo; segue */ }
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
    const ops = existing?.opportunities || (Array.isArray(existing) ? existing : []);
    const opp = pickOpenOpp(ops, pipelineId); // a aberta do pipeline da Tina (não ops[0] cego)

    if (opp) {
      const cur = opp.pipelineStageId;
      // pickOpenOpp já exclui won/lost (só abertas). Não rouba lead que o time
      // está re-trabalhando (stage bloqueada/reentrada).
      if (blockedOppStages().includes(cur)) return opp.id;
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

// A "RAIA" da Tina (allowlist, default-deny). Ela só atende lead cuja
// oportunidade está na IA Tina ou na Aguardando Atendimento (qualificado/
// agendando que ela mesma conduz), OU que NÃO tem oportunidade (lead novo). Se
// há opp ABERTA em QUALQUER outra coluna (Reentrada, Follow Up, Aplicação,
// Proposta, funis de captação, Closers...), é trabalho de OUTRO → retorna a opp
// pra bloquear. Falha ABERTO (erro → null → Tina segue normal).
export async function contactOppOutsideTinaLane(contact) {
  const { stageIaTina, stageQualified } = resolvePipeline();
  if (!contact?.ghl_contact_id || !process.env.GHL_API_TOKEN) return null;
  // Raia da Tina = IA Tina + Aguardando Atendimento + funis de ENTRADA onde caem
  // os leads de anúncio/captação que ela DEVE qualificar (env GHL_TINA_LANE_STAGES,
  // CSV de stageIds). Setar os funis de entrada lá pra a Tina atender os anúncios.
  const extra = (process.env.GHL_TINA_LANE_STAGES || '').split(',').map(s => s.trim()).filter(Boolean);
  const lane = new Set([stageIaTina, stageQualified, ...extra].filter(Boolean));
  try {
    const r = await GHL.getOpportunitiesByContact(contact.ghl_contact_id);
    const ops = r?.opportunities || (Array.isArray(r) ? r : []);
    return ops.find(o =>
      String(o.status || 'open').toLowerCase() === 'open'
      && !lane.has(o.pipelineStageId)
    ) || null;
  } catch (err) {
    logger.warn({ err: err.message, contactId: contact.id }, 'falha checando raia da Tina (opp); segue');
    return null;
  }
}

// Lead tem opp ABERTA na coluna IA Tina? É o sinal POSITIVO de que o TIME colocou
// o lead na raia da Tina pra ela trabalhar → ela DEVE assumir e qualificar, mesmo
// que a conversa tenha histórico de humano (em_atendimento) ou reentrada: a
// colocação na coluna É a autorização. Falha FECHADO (erro → false → não força;
// os gates normais decidem). Cobre multi-opp (basta UMA aberta na IA Tina).
export async function contactInIaTinaLane(contact) {
  const { stageIaTina } = resolvePipeline();
  if (!stageIaTina || !contact?.ghl_contact_id || !process.env.GHL_API_TOKEN) return false;
  try {
    const r = await GHL.getOpportunitiesByContact(contact.ghl_contact_id);
    const ops = r?.opportunities || (Array.isArray(r) ? r : []);
    return ops.some(o => String(o.status || 'open').toLowerCase() === 'open' && o.pipelineStageId === stageIaTina);
  } catch {
    return false;
  }
}

// Lead está EXCLUSIVAMENTE na raia da Tina? True SÓ se (a) tem pelo menos uma opp
// ABERTA e (b) TODAS as opps abertas estão numa stage que a Tina é dona (IA Tina +
// Funil Orgânico, por padrão). Basta UMA opp aberta fora da raia (outro pipeline,
// Reentrada, ou stage do time no mesmo pipeline — Proposta/Follow Up/Aplicação...)
// pra dar false. É a guarda do RECLAIM: a Tina só reassume um lead que sumiu do radar
// do time se ele NÃO tem nenhum negócio vivo em outra coluna (senão roubaria um lead
// que um closer está tocando — caso multi-opp). Configurável por GHL_TINA_OWNED_STAGES
// (CSV de stageIds). Falha FECHADO (erro → false → não reassume; lado seguro).
export async function contactExclusivelyInTinaLane(contact) {
  if (!contact?.ghl_contact_id || !process.env.GHL_API_TOKEN) return false;
  const { stageIaTina } = resolvePipeline();
  const extra = (process.env.GHL_TINA_OWNED_STAGES
    || 'd596db34-ada4-4e7a-936a-943a9410d9a6') // Funil Orgânico (Pré-Vendas LCA)
    .split(',').map(s => s.trim()).filter(Boolean);
  const owned = new Set([stageIaTina, ...extra].filter(Boolean));
  try {
    const r = await GHL.getOpportunitiesByContact(contact.ghl_contact_id);
    const open = (r?.opportunities || (Array.isArray(r) ? r : []))
      .filter(o => String(o.status || 'open').toLowerCase() === 'open');
    if (!open.length) return false;                        // sem opp aberta → não reassume
    return open.every(o => owned.has(o.pipelineStageId));  // TODAS na raia da Tina
  } catch {
    return false;
  }
}

// Lead tem opp ABERTA numa stage de REENTRADA (o time está re-trabalhando ele)?
// Usado pelo modo "atende todos menos Reentrada" pra a Tina NÃO assumir esses.
// Falha ABERTO (erro → false → atende; não bloqueia atendimento por falha de API).
export async function contactOppInReentrada(contact) {
  if (!contact?.ghl_contact_id || !process.env.GHL_API_TOKEN) return false;
  const blocked = new Set(blockedOppStages());
  if (!blocked.size) return false;
  try {
    const r = await GHL.getOpportunitiesByContact(contact.ghl_contact_id);
    const ops = r?.opportunities || (Array.isArray(r) ? r : []);
    return ops.some(o => String(o.status || 'open').toLowerCase() === 'open' && blocked.has(o.pipelineStageId));
  } catch {
    return false;
  }
}

// Lead pertence a OUTRO time (a Tina NÃO deve assumir)? True se tem opp ABERTA:
//  (1) numa stage de REENTRADA (blockedOppStages), OU
//  (2) num PIPELINE diferente do da Tina (Pré-Vendas LCA) — ou seja, Closers,
//      Editorial, Pré-Vendas 2.0, etc. estão com o lead.
// Lead novo/de anúncio só tem opp no pipeline da Tina (Funil Orgânico) → false →
// atende. Cobre "outros funis" sem precisar listar 80 stages. Dentro do pipeline
// da Tina, a colisão (Follow Up/Proposta) fica na detecção por MENSAGEM
// (lastOutboundWasHuman). Falha ABERTO (erro → false → atende; não trava por hiccup).
export async function contactWorkedByOtherTeam(contact) {
  const { pipelineId } = resolvePipeline();
  if (!contact?.ghl_contact_id || !process.env.GHL_API_TOKEN) return false;
  const blocked = new Set(blockedOppStages());
  try {
    const r = await GHL.getOpportunitiesByContact(contact.ghl_contact_id);
    const ops = r?.opportunities || (Array.isArray(r) ? r : []);
    return ops.some(o => {
      if (String(o.status || 'open').toLowerCase() !== 'open') return false;
      if (blocked.has(o.pipelineStageId)) return true;                          // Reentrada
      if (o.pipelineId && pipelineId && o.pipelineId !== pipelineId) return true; // outro time/pipeline
      return false;
    });
  } catch {
    return false;
  }
}

// Reivindica o lead pra Tina (re-engajamento ATIVO): move a opp pra IA Tina (ou
// cria). NÃO reabre won/lost. Uso INTENCIONAL (script de re-engajamento) — aí o
// lead entra na raia da Tina e ela passa a tratar as respostas dele.
export async function claimToIaTina(contact) {
  const { pipelineId, stageIaTina, stageQualified } = resolvePipeline();
  if (!pipelineId || !stageIaTina || !contact?.ghl_contact_id) return null;
  try {
    const r = await GHL.getOpportunitiesByContact(contact.ghl_contact_id);
    const ops = r?.opportunities || (Array.isArray(r) ? r : []);
    const opp = pickOpenOpp(ops, pipelineId); // a aberta do pipeline da Tina (não ops[0] cego)
    if (opp) {
      // Já na IA Tina ou já em Aguardando Atendimento → não mexe.
      if (opp.pipelineStageId === stageIaTina || opp.pipelineStageId === stageQualified) return opp.id;
      // NÃO assume/move lead que o time está re-trabalhando (Reentrada).
      if (blockedOppStages().includes(opp.pipelineStageId)) return opp.id;
      // Só reorganiza DENTRO do pipeline da Tina (Pré-Vendas LCA). Não puxa opp
      // de OUTRO pipeline (Closers/Editorial) pra não bagunçar o board deles.
      if (opp.pipelineId && opp.pipelineId !== pipelineId) return opp.id;
      markSelfMove(contact, opp.id);
      await GHL.updateOpportunity(opp.id, { pipelineId, pipelineStageId: stageIaTina, status: 'open' });
      return opp.id;
    }
    // Sem opp ABERTA, mas COM opp fechada (won/lost) = cliente convertido/perdido →
    // NÃO cria duplicada na IA Tina (deixa como está). Só cria pra lead REALMENTE
    // novo (zero opp), senão re-qualifica cliente do zero + suja o board.
    if (ops.length) return ops[0]?.id || null;
    const created = await GHL.createOpportunity({
      pipelineId, stageId: stageIaTina, contactId: contact.ghl_contact_id,
      name: `${contact.name || 'Lead'} · IA Tina`,
    });
    const newId = created?.opportunity?.id || created?.id || null;
    markSelfMove(contact, newId);
    return newId;
  } catch (err) {
    logger.warn({ err: err.message, contactId: contact.id }, 'falha reivindicando lead p/ IA Tina; segue');
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
    const newId = created?.opportunity?.id || created?.id || null;
    markSelfMove(contact, newId);
    return newId;
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
