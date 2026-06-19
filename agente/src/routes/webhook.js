import express from 'express';
import { db } from '../db/index.js';
import { GHL, downloadAttachment } from '../ghl/client.js';
import { verifyGHLSignature } from '../ghl/webhookSig.js';
import { logger } from '../utils/logger.js';
import { transcribeAudioBuffer } from '../utils/transcribe.js';
import {
  upsertContactFromGHL, recordInbound, recordOutbound, countMessagesToday,
} from '../agent/contactService.js';
import { generateTinaReply } from '../agent/tina.js';
import { describeImageBuffer } from '../agent/tina-gemini.js';
import { sendSequence, sendText } from '../agent/messenger.js';
import {
  pauseIA, scheduleFollowup, handleSDRReply,
  markQualifiedAndHandoff, markDisqualified, applyTinaTags,
} from '../agent/handoff.js';
import {
  schedulingEnabled, getNextSlots, slotsContextBlock, bookSlot, recordOffer,
  upcomingAppointment,
} from '../agent/scheduling.js';
import { bookSearchEnabled, searchBookLink } from '../agent/bookSearch.js';
import { contactOppOutsideTinaLane, moveLeadToIaTina, claimToIaTina } from '../ghl/opportunities.js';
import { liveHandoff } from '../agent/queue.js';
import { notifyAgendamento, notifyLiveHandoff } from '../agent/notify.js';
import { withContactLock } from '../utils/contactLock.js';

const router = express.Router();
const MAX_KB = Number(process.env.MAX_ATTACHMENT_KB || 200);
const MAX_MSGS_DAY = Number(process.env.MAX_MESSAGES_PER_CONVERSATION_PER_DAY || 40);

// Identifica o tipo real de um anexo pelos MAGIC BYTES (assinatura do arquivo).
// O GHL serve mídia do WhatsApp sem extensão na URL e sem content-type, então
// não dá pra confiar só na URL. Retorna { kind: 'image'|'audio'|'pdf'|null, mime }.
function sniffAttachment(buf) {
  if (!buf || buf.length < 12) return { kind: null, mime: null };
  const b = buf;
  const ascii = (i, s) => [...s].every((c, k) => b[i + k] === c.charCodeAt(0));
  // imagens
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return { kind: 'image', mime: 'image/jpeg' };
  if (b[0] === 0x89 && ascii(1, 'PNG')) return { kind: 'image', mime: 'image/png' };
  if (ascii(0, 'GIF8')) return { kind: 'image', mime: 'image/gif' };
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return { kind: 'image', mime: 'image/webp' };
  if (b[0] === 0x42 && b[1] === 0x4D) return { kind: 'image', mime: 'image/bmp' };
  // PDF
  if (ascii(0, '%PDF')) return { kind: 'pdf', mime: 'application/pdf' };
  // áudio (OBS: WAV e WEBP são ambos RIFF — diferencia pelo bloco em offset 8)
  if (ascii(0, 'OggS')) return { kind: 'audio', mime: 'audio/ogg' };
  if (ascii(0, 'RIFF') && ascii(8, 'WAVE')) return { kind: 'audio', mime: 'audio/wav' };
  if (ascii(0, 'ID3')) return { kind: 'audio', mime: 'audio/mpeg' };
  if (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0) return { kind: 'audio', mime: 'audio/mpeg' };
  if (ascii(4, 'ftyp')) return { kind: 'audio', mime: 'audio/mp4' }; // m4a/aac
  return { kind: null, mime: null };
}

// Idempotência de webhook: GHL pode reentregar o mesmo evento mais de
// uma vez (timeout, retry). Sem dedup, a Tina processa 2x e responde 2x.
function alreadyProcessed(source, messageId) {
  if (!messageId) return false;
  const result = db.prepare(
    'INSERT OR IGNORE INTO processed_webhook_ids (source, message_id) VALUES (?, ?)'
  ).run(source, String(messageId));
  return result.changes === 0; // 0 = duplicata (UNIQUE bateu)
}

// === Webhook principal do GHL ===
// GHL → Settings → Webhooks: POST https://seu-dominio/webhook/ghl
// Eventos: InboundMessage, OutboundMessage
router.post('/ghl', async (req, res) => {
  // 1) Valida assinatura se GHL_WEBHOOK_SECRET configurado
  const sig = verifyGHLSignature(req, req.rawBody || JSON.stringify(req.body || {}));
  if (!sig.ok) {
    logger.warn({ reason: sig.reason }, 'webhook GHL rejeitado por assinatura');
    return res.status(401).json({ error: 'invalid signature' });
  }

  const rawBody = req.body || {};

  // GHL Workflow webhook tem 2 formatos possíveis:
  //   1. Flat: { type, contactId, body, ... }
  //   2. Custom Data aninhado: { contact: {...}, customData: { type, contactId, body, ... } }
  // Fazemos merge dos 2 — o customData tem prioridade.
  const customData = rawBody.customData || {};
  const event = {
    ...rawBody,
    ...customData,
    // Dados do contato podem vir em rawBody.contact.* ou no nível raiz
    contactId: customData.contactId || rawBody.contactId || rawBody.contact_id || rawBody.contact?.id || rawBody.id,
  };

  const kind = event.type || event.event || 'unknown';

  // Log mais verboso: se kind=unknown, mostra o body completo pra debug
  if (kind === 'unknown') {
    logger.warn({ rawBody, customData }, '[webhook GHL] kind=unknown — body completo pra debug');
  } else {
    logger.info({ kind, contactId: event.contactId, id: event.messageId || event.id }, '[webhook GHL]');
  }

  db.prepare('INSERT INTO events_log (kind, payload) VALUES (?, ?)')
    .run(`webhook_${kind}`, JSON.stringify(rawBody).slice(0, 8000));

  // 2) Responder rápido (GHL tem timeout ~10s). Processa assíncrono.
  res.status(200).json({ ok: true });

  try {
    // Dedup: se o GHL reentregar o mesmo message_id, ignora silenciosamente
    const msgId = event.messageId || event.id;
    if ((kind === 'InboundMessage' || kind === 'OutboundMessage') && alreadyProcessed('ghl', msgId)) {
      logger.info({ kind, messageId: msgId }, 'webhook GHL: evento duplicado, ignorando');
      return;
    }

    if (kind === 'InboundMessage') {
      await handleInbound(event);
    } else if (kind === 'OutboundMessage') {
      await handleOutbound(event);
    } else if (kind === 'ContactCreate') {
      await handleContactCreate(event);
    } else {
      logger.debug({ kind }, 'webhook não tratado');
    }
  } catch (err) {
    logger.error({ err: err.message, stack: err.stack, kind }, 'erro processando webhook');
    db.prepare('INSERT INTO events_log (kind, payload) VALUES (?, ?)')
      .run('error', JSON.stringify({ err: err.message, kind }).slice(0, 8000));
  }
});

async function handleContactCreate(event) {
  const ghlContactId = event.contactId || event.id;
  if (!ghlContactId) return;
  try {
    const contact = await GHL.getContact(ghlContactId);
    upsertContactFromGHL(contact);
  } catch (err) {
    logger.warn({ err: err.message, ghlContactId }, 'contact create: falha ao buscar');
  }
}

// Tag de WHITELIST: só atende contatos com essa tag (durante teste pra
// não atropelar produção). Em produção, setar GHL_TAG_REQUIRED=false ou
// vazio pra desabilitar a whitelist (Tina passa a atender todos).
const REQUIRED_TAG = (process.env.GHL_TAG_REQUIRED ?? 'tina-liberada').toLowerCase();
const REQUIRED_TAG_ENABLED = REQUIRED_TAG && REQUIRED_TAG !== 'false' && REQUIRED_TAG !== '';

// Tag que, se presente no contato GHL, faz a Tina NÃO responder.
// Plano A (manual): time aplica/remove a tag pra pausar/reativar.
// Plano B (automático): o checkHumanResponded() abaixo detecta SDR respondendo
// e pausa sozinho.
const PAUSE_TAG = (process.env.GHL_TAG_PAUSAR_TINA || 'tina-pausada').toLowerCase();

// Tags de ORIGEM bloqueadas: se o contato tiver QUALQUER uma delas, a Tina
// NÃO responde. Decisão Lilian: a Tina não atende leads do FORMULÁRIO DO SITE,
// só Meta + WhatsApp. Configurável por env (CSV), ex:
//   GHL_TAG_BLOCK=lc-lca,lc-lce,form-site
// Vazio = nenhum bloqueio por origem.
const BLOCK_TAGS = (process.env.GHL_TAG_BLOCK || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

function extractTags(ghlContact) {
  const raw = ghlContact?.tags || [];
  return raw.map(t => (typeof t === 'string' ? t : (t?.name || ''))).map(s => s.toLowerCase()).filter(Boolean);
}

// DETECÇÃO AUTOMÁTICA DE HUMANO RESPONDENDO
// GHL não tem trigger nativo de "Outbound Message Sent", então antes da Tina
// responder, perguntamos pro GHL: a última mensagem outbound da conversa foi
// enviada por um humano (tem userId)?
//
// ATENÇÃO — fail mode catastrófico se mal calibrado:
//   Se o PIT do GHL atribui userId em todas as mensagens enviadas via API
//   (alguns tokens fazem isso), a Tina classifica a PRÓPRIA resposta como
//   "humano" e pausa SOZINHA logo após mandar a primeira mensagem.
//
// Por isso, esta detecção é OFF por padrão e tem 2 sanity checks:
//   1. AUTO_HUMAN_DETECTION_ENABLED=true no env pra ativar
//   2. O userId tem que bater com um SDR conhecido em sdr_users.ghl_user_id
//      (cruzamento com nossa base; se não bate, assume API e não pausa)
//   3. A mensagem outbound do GHL tem que ser mais nova que o nosso
//      contacts.last_outbound_at (com tolerância de 5s), senão foi nossa
// OPT-IN (default OFF). Faz 2 chamadas ao GHL por mensagem (latência) e, se mal
// calibrado, pode classificar a própria msg da Tina como humana e pausá-la.
// O caminho LIMPO de detecção de humano é o webhook de OutboundMessage
// (handleOutbound), event-driven e sem esse risco. Ligar só se necessário:
// AUTO_HUMAN_DETECTION_ENABLED=true (precisa link-ghl-users rodado).
const AUTO_HUMAN_DETECTION = process.env.AUTO_HUMAN_DETECTION_ENABLED === 'true';

// Filtro LEAD NOVO vs. JÁ EM ATENDIMENTO (pedido do Gabriel: o GHL não filtra
// reentrada). Default ON. Só roda no PRIMEIRO contato (Tina nunca respondeu o
// lead) e checa se a conversa do GHL já tem saída de um humano. Falha aberto.
const SKIP_IN_ATTENDANCE = process.env.SKIP_LEADS_IN_ATTENDANCE !== 'false';
// Janela: só conta como "em atendimento" se o humano falou nos últimos N dias.
// Evita bloquear lead FRIO antigo (humano falou há meses, lead sumiu e voltou —
// é oportunidade nova pra Tina). Configurável; 0/negativo = sem janela (qualquer idade).
const ATTENDANCE_DAYS = Number(process.env.SKIP_ATTENDANCE_DAYS || 30);

// Sources que são AUTOMAÇÃO (não atendimento humano), mesmo tendo userId — o
// GHL carimba o dono do workflow/campanha no userId. Confirmado em prod: msg
// de workflow vem com userId preenchido.
const AUTO_SOURCES = new Set(['workflow', 'campaign', 'bulk_actions', 'bulk', 'automation']);

// True se a conversa do GHL tem uma saída RECENTE de um HUMANO. Discriminador
// confirmado em prod (jun/2026): humano envia com `userId` preenchido (Tina via
// API sempre vem com userId NULL). Excluímos sources de automação (workflow/
// campanha), que também trazem userId. Saídas antigas (fora da janela) não
// contam — lead esfriou e a Tina pode reabordar.
async function conversationAlreadyInAttendance(ghlContactId) {
  if (!process.env.GHL_API_TOKEN) return false;
  try {
    const convResp = await GHL.searchConversations(ghlContactId);
    const conv = convResp?.conversations?.[0] || convResp?.[0];
    if (!conv?.id) return false;
    const msgsResp = await GHL.getMessages(conv.id, { limit: 25 });
    const msgs = msgsResp?.messages?.messages || msgsResp?.messages || msgsResp || [];
    if (!Array.isArray(msgs) || !msgs.length) return false;
    const limiteMs = ATTENDANCE_DAYS > 0 ? Date.now() - ATTENDANCE_DAYS * 864e5 : 0;
    return msgs.some(m => {
      const dir = (m.direction || '').toLowerCase();
      const uid = m.userId || m.user_id || m.sentBy?.id;
      const src = String(m.source || '').toLowerCase();
      if (dir !== 'outbound' || !uid) return false;   // só humano tem userId; Tina = null
      if (AUTO_SOURCES.has(src)) return false;         // workflow/campanha não é humano atendendo
      if (!limiteMs) return true;                      // sem janela → qualquer idade conta
      const ts = new Date(m.dateAdded || m.createdAt || m.date || 0).getTime();
      return ts ? ts >= limiteMs : false;              // sem data confiável → não bloqueia (lado seguro p/ atender)
    });
  } catch (err) {
    logger.warn({ err: err.message, ghlContactId }, 'falha checando atendimento prévio; segue normal');
    return false;
  }
}

function isKnownSdrUserId(userId) {
  if (!userId) return false;
  const row = db.prepare('SELECT id FROM sdr_users WHERE ghl_user_id = ?').get(String(userId));
  return Boolean(row);
}

async function lastOutboundWasHuman(ghlContactId, localContact) {
  if (!AUTO_HUMAN_DETECTION) return false;
  if (!process.env.GHL_API_TOKEN) return false;
  try {
    const convResp = await GHL.searchConversations(ghlContactId);
    const conv = convResp?.conversations?.[0] || convResp?.[0];
    if (!conv?.id) return false;
    const msgsResp = await GHL.getMessages(conv.id, { limit: 10 });
    let msgs = msgsResp?.messages?.messages || msgsResp?.messages || msgsResp || [];
    if (!Array.isArray(msgs) || !msgs.length) return false;

    // Ordena por dateAdded/createdAt desc client-side pra não depender da API
    msgs = [...msgs].sort((a, b) => {
      const da = new Date(a.dateAdded || a.createdAt || a.date || 0).getTime();
      const db_ = new Date(b.dateAdded || b.createdAt || b.date || 0).getTime();
      return db_ - da;
    });

    const lastOut = msgs.find(m => (m.direction || '').toLowerCase() === 'outbound');
    if (!lastOut) return false;

    const userId = lastOut.userId || lastOut.user_id || lastOut.sentBy?.id;
    if (!userId) return false; // sem userId → API → Tina, não humano

    // Sanity 1: userId conhecido em sdr_users?
    // (Se não bate, é provavelmente o PIT da API com algum userId fantasma.)
    if (!isKnownSdrUserId(userId)) {
      logger.debug({ userId }, 'userId outbound não bate com nenhum SDR conhecido — assumindo API');
      return false;
    }

    // Sanity 2: outbound do GHL é mais nova que nossa última outbound?
    // Se o timestamp do GHL é igual/menor ao nosso last_outbound_at + 5s,
    // foi a Tina mesmo que enviou.
    if (localContact?.last_outbound_at) {
      const ghlTs = new Date(lastOut.dateAdded || lastOut.createdAt || 0).getTime();
      const localTs = new Date(localContact.last_outbound_at).getTime();
      if (ghlTs <= localTs + 5_000) {
        return false;
      }
    }
    return true;
  } catch (err) {
    logger.warn({ err: err.message, ghlContactId }, 'falha checando última mensagem; segue sem pausar');
    return false;
  }
}

async function handleInbound(event) {
  const ghlContactId = event.contactId || event.contact_id;
  if (!ghlContactId) return;

  // 1) Hydrata contato do GHL (pega nome, phone, email, TAGS)
  let ghlContact;
  try {
    ghlContact = await GHL.getContact(ghlContactId);
  } catch (err) {
    logger.error({ err: err.message, ghlContactId }, 'não consegui buscar contato no GHL');
    ghlContact = { id: ghlContactId };
  }

  const tags = extractTags(ghlContact);

  // 1.4) WHITELIST: durante teste/staging, Tina só atende quem TEM a tag tina-liberada.
  // Sem essa verificação, qualquer lead importado no GHL recebe resposta automática.
  if (REQUIRED_TAG_ENABLED && !tags.includes(REQUIRED_TAG)) {
    logger.info({ ghlContactId, required: REQUIRED_TAG }, 'contato sem tag de liberação, Tina não responde');
    return;
  }

  // 1.45) BLOQUEIO POR ORIGEM: Tina não atende leads de origem bloqueada
  // (ex: formulário do site). Só Meta + WhatsApp. Lilian, jun/2026.
  if (BLOCK_TAGS.length) {
    const hit = BLOCK_TAGS.find(t => tags.includes(t));
    if (hit) {
      logger.info({ ghlContactId, blockedBy: hit }, 'lead de origem bloqueada (ex: form do site), Tina não responde');
      return;
    }
  }

  // 1.5) Checa tag de pausa manual (Plano A) — time aplicou tag pra assumir
  if (tags.includes(PAUSE_TAG)) {
    logger.info({ ghlContactId, tag: PAUSE_TAG }, 'tag de pausa presente, Tina não responde');
    return;
  }

  const contact = upsertContactFromGHL(ghlContact);

  // 1.55) FILTRO LEAD NOVO vs. EM ATENDIMENTO (Gabriel não consegue filtrar
  // reentrada no GHL). Só no PRIMEIRO contato da Tina (ela nunca respondeu este
  // lead): se a conversa do GHL já tem saída de um humano, o lead JÁ estava em
  // atendimento → a Tina não assume. Não atrapalha conversas que ela já toca.
  if (SKIP_IN_ATTENDANCE && !contact.last_outbound_at) {
    if (await conversationAlreadyInAttendance(ghlContactId)) {
      logger.info({ ghlContactId, contactId: contact.id }, 'lead já estava em atendimento humano (conversa pré-existente), Tina não assume');
      // Log auditável: pra você acompanhar quantas vezes o filtro atuou e
      // checar se não está bloqueando lead que devia atender (resumo-dia).
      try {
        db.prepare(`INSERT INTO events_log (contact_id, kind, payload) VALUES (?, 'skip_em_atendimento', ?)`)
          .run(contact.id, JSON.stringify({ ghlContactId }));
      } catch {}
      handleSDRReply(contact.id, null);
      return;
    }
  }

  // 1.56) GATE POR COLUNA — DESLIGADO por padrão (LANE_GATE_ENABLED=true p/ ligar).
  // A varredura (jun/2026) mostrou que a COLUNA da opp é um sinal RUIM: leads de
  // anúncio/form VOLTAM com opp velha em Follow Up/Closers, então bloquear por
  // coluna barraria os próprios leads de anúncio que a Tina precisa atender. A
  // proteção de colisão correta é por MENSAGEM (consultor respondeu recente — ver
  // lastOutboundWasHuman / AUTO_HUMAN_DETECTION abaixo).
  if (process.env.LANE_GATE_ENABLED === 'true' && !contact.ai_paused) {
    const oppHit = await contactOppOutsideTinaLane(contact);
    if (oppHit) {
      logger.info({ ghlContactId, contactId: contact.id, stage: oppHit.pipelineStageId }, 'lead fora da raia da Tina (opp em funil do time), Tina não assume');
      try {
        db.prepare(`INSERT INTO events_log (contact_id, kind, payload) VALUES (?, 'skip_fora_raia', ?)`)
          .run(contact.id, JSON.stringify({ stage: oppHit.pipelineStageId }));
      } catch {}
      return;
    }
  }

  // NOTA: NÃO bloquear por assignedTo. O GHL auto-atribui o lead a um consultor
  // já na ENTRADA (round-robin), então assignedTo vem preenchido em todo lead
  // novo — bloquear por isso faria a Tina não responder NINGUÉM. A detecção de
  // humano real é feita por lastOutboundWasHuman (checa se alguém de fato
  // RESPONDEU) e/ou pelo webhook de OutboundMessage (handleOutbound).

  // 1.6) DETECÇÃO AUTOMÁTICA (Plano B) — verifica se humano respondeu pelo GHL
  // antes da Tina. Default OFF (env AUTO_HUMAN_DETECTION_ENABLED=true pra ligar).
  // Tem sanity checks contra falso positivo do PIT — ver lastOutboundWasHuman.
  if (await lastOutboundWasHuman(ghlContactId, contact)) {
    logger.info({ ghlContactId, contactId: contact.id }, 'humano respondeu pelo GHL, pausando Tina automaticamente');
    handleSDRReply(contact.id, null);
    return; // recordInbound será feito pelo handler comum no próximo ciclo
  }

  // 2) Classifica tipo de mensagem (texto, áudio, imagem, PDF)
  //    GHL envia em `messageType` (WhatsApp/SMS/Email/FB/IG/GMB) e conteúdo em `body` + `attachments`.
  const msgType = (event.messageType || '').toLowerCase();
  let rawBody = event.body ?? event.message ?? '';
  let attachments = event.attachments || [];

  // O GHL às vezes manda o conteúdo como OBJETO (áudio/anexo estruturado), não
  // como string nem no array `attachments`. Loga a estrutura real (pra mapear)
  // e tenta extrair a URL/mídia de dentro dele.
  if (rawBody && typeof rawBody === 'object') {
    logger.info({ ghlContactId, bodyObj: rawBody, keys: Object.keys(rawBody) }, 'body veio como OBJETO (provável áudio/anexo) — inspecionando');
    const cand = rawBody.attachments || rawBody.media || rawBody.url || rawBody.audio
      || rawBody.file || rawBody.attachmentUrl || rawBody.fileUrl || rawBody.link;
    if (Array.isArray(cand)) attachments = attachments.concat(cand);
    else if (cand) attachments = attachments.concat([cand]);
    rawBody = typeof rawBody.text === 'string' ? rawBody.text
      : typeof rawBody.body === 'string' ? rawBody.body
      : typeof rawBody.caption === 'string' ? rawBody.caption : '';
  }
  const body = typeof rawBody === 'string' ? rawBody : String(rawBody || '');

  let content = body;
  let content_type = 'text';
  let attachment_url = null;

  // Detecta attachments por URL (GHL manda array de strings URL ou objetos)
  const attachList = attachments.map(a => typeof a === 'string' ? { url: a } : a);
  // tipo declarado pelo GHL no objeto do anexo (varia: type/mimeType/contentType)
  const attType = a => String(a.type || a.mimeType || a.contentType || a.format || '').toLowerCase();
  const byExt = re => attachList.find(a => re.test(a.url || ''));
  const byType = re => attachList.find(a => re.test(attType(a)));

  // 1ª passada: classifica por extensão/type declarado pelo GHL
  let pdfAtt = byExt(/\.(pdf|docx?|odt)(\?|$)/i) || byType(/pdf|msword|officedocument|document/);
  let imageAtt = byExt(/\.(jpe?g|png|gif|webp|bmp)(\?|$)/i) || byType(/image/);
  let audioAtt = byExt(/\.(ogg|opus|mp3|m4a|wav|amr|aac|mpeg)(\?|$)/i) || byType(/audio|voice|ptt/);

  let kind = pdfAtt ? 'pdf' : imageAtt ? 'image' : audioAtt ? 'audio' : null;
  const primaryUrl = (pdfAtt || imageAtt || audioAtt || attachList[0])?.url || null;

  // 2ª passada: o GHL frequentemente serve a mídia SEM extensão e SEM type
  // (ex.: nota de voz e imagem do WhatsApp). Aí baixa e identifica pelos
  // MAGIC BYTES (assinatura do arquivo). Acaba com a confusão imagem↔áudio.
  let attBuf = null, attMime = null;
  if (attachList.length && !kind && primaryUrl) {
    try {
      attBuf = await downloadAttachment(primaryUrl);
      const s = sniffAttachment(attBuf);
      kind = s.kind; attMime = s.mime;
      logger.info({ ghlContactId, kind, mime: attMime, len: attBuf?.length }, 'anexo ambíguo — tipo por magic bytes');
    } catch (err) {
      logger.error({ err: err.message, ghlContactId }, 'falha ao baixar anexo pra sniff');
    }
  }

  // PDF → bloquear (não analisar via IA, delegar à leitura crítica)
  if (kind === 'pdf') {
    attachment_url = primaryUrl;
    recordInbound(contact.id, {
      content: `[lead enviou arquivo: ${primaryUrl}]`,
      content_type: 'pdf_blocked',
      ghl_message_id: event.messageId || event.id,
      attachment_url,
    });
    const txt = 'Opa, análise de arquivo a gente faz na etapa de leitura crítica com a equipe. Me conta em texto: o livro já está finalizado ou ainda está em processo?';
    await sendText(contact, txt).catch(err => logger.error({ err: err.message }, 'send fail'));
    recordOutbound(contact.id, { author: 'ia', content: txt });
    return;
  }

  // Áudio → baixa (com auth GHL) e transcreve (Whisper)
  if (kind === 'audio') {
    attachment_url = primaryUrl;
    logger.info({ ghlContactId, attCount: attachList.length }, 'mensagem detectada como ÁUDIO, transcrevendo');
    try {
      const buf = attBuf || (primaryUrl ? await downloadAttachment(primaryUrl) : null);
      const transcript = buf ? await transcribeAudioBuffer(buf) : null;
      content = transcript ? `[áudio transcrito] ${transcript}` : '[áudio recebido — falha na transcrição]';
    } catch (err) {
      logger.error({ err: err.message }, 'falha baixando/transcrevendo áudio');
      content = '[áudio recebido — não consegui ouvir]';
    }
    content_type = 'audio_transcript';
  }

  // Imagem → descreve com a visão do Gemini (a Tina "lê" capa de livro, print, etc.)
  if (kind === 'image') {
    attachment_url = primaryUrl;
    logger.info({ ghlContactId, attCount: attachList.length }, 'mensagem detectada como IMAGEM, descrevendo (visão)');
    try {
      const buf = attBuf || (primaryUrl ? await downloadAttachment(primaryUrl) : null);
      const mime = attMime || (buf ? sniffAttachment(buf).mime : null) || 'image/jpeg';
      const desc = buf ? await describeImageBuffer(buf, mime) : null;
      const legenda = body.trim() ? ` Legenda do lead: "${body.trim()}"` : '';
      content = desc ? `[imagem] ${desc}${legenda}` : (body || '[lead enviou uma imagem]');
    } catch (err) {
      logger.error({ err: err.message }, 'falha ao descrever imagem');
      content = body || '[lead enviou uma imagem]';
    }
    content_type = 'image';
  }

  recordInbound(contact.id, {
    content,
    content_type,
    ghl_message_id: event.messageId || event.id,
    attachment_url,
  });

  // === Lock por contato ===
  // Serializa LLM call + send + update por contactId. Sem isso, 2 mensagens
  // do mesmo lead em < 1s rodam 2 chamadas LLM paralelas que leem o mesmo
  // histórico e respondem coisas conflitantes (resposta duplicada).
  await withContactLock(contact.id, async () => {
    // Re-lê dentro do lock — estado pode ter mudado enquanto esperava
    const fresh = db.prepare('SELECT * FROM contacts WHERE id = ?').get(contact.id);
    if (!fresh) return;

    // 3) Se IA está pausada (SDR assumiu), só registra
    if (fresh.ai_paused) {
      logger.info({ contactId: contact.id }, 'IA pausada, registrando sem responder');
      scheduleFollowup(contact.id, 'silencio_sdr');
      return;
    }

    // 4) Proteção de custo
    if (countMessagesToday(contact.id) > MAX_MSGS_DAY) {
      logger.warn({ contactId: contact.id }, 'limite diário atingido, pausando IA');
      pauseIA(contact.id, 'limite_mensagens_dia');
      return;
    }

    // 5) AGENDAMENTO, fase 2: se o lead está em modo "agendando", puxa os
    // horários livres mais próximos do calendário do GHL e injeta no contexto
    // pra Tina oferecer. Mais cedo possível, pra não esfriar o lead.
    let extraContext = null;
    if (schedulingEnabled() && fresh.stage === 'agendando') {
      // leque de horários (manhã/tarde, próximos dias) pra atender pedidos
      // específicos do lead sem inventar. A Tina oferece os mais cedo por padrão.
      const slots = await getNextSlots(8, { spread: true });
      if (slots.length) {
        extraContext = slotsContextBlock(slots);
        recordOffer(fresh.id, slots);  // guarda qual closer tem cada horário
      } else {
        // Sem horário disponível: cai no handoff normal (humano confirma)
        logger.warn({ contactId: fresh.id }, 'agendando mas sem free-slots, handoff normal');
      }
    }

    // 6) Gera resposta da Tina
    const result = await generateTinaReply({ contact: fresh, incomingText: content, extraContext });

    // 7) AGENDAMENTO, fase 3: o lead confirmou um horário → marca no GHL.
    let booked = null;
    if (schedulingEnabled() && result.book_slot) {
      // ANTI DOUBLE-BOOKING: se o lead JÁ tem reunião futura (um consultor
      // marcou manualmente, ou a própria Tina já marcou antes), NÃO cria outra.
      const existing = await upcomingAppointment(fresh);
      if (existing) {
        logger.warn({ contactId: fresh.id, existingStart: existing.startTime, existingId: existing.id }, 'lead já tem reunião futura — evitando double-booking');
        booked = { ok: false, alreadyBooked: true, existing };
      } else {
        booked = await bookSlot(fresh, result.book_slot);
        if (!booked.ok) {
          logger.error({ contactId: fresh.id, err: booked.error }, 'book_slot falhou, mantém agendando');
        }
      }
    }

    // 7.5) BÔNUS: lead deu o título do livro → busca o link e anexa a
    // confirmação (a Tina nunca inventa link, quem busca é o sistema).
    let items;
    if (booked && booked.alreadyBooked) {
      // Evitamos double-booking: a resposta do LLM provavelmente "confirmou" o
      // agendamento — substitui por um aviso de que o lead já tem horário.
      const primeiro = (fresh.name || '').trim().split(/\s+/)[0];
      items = [`Perfeito${primeiro ? ', ' + primeiro : ''}! Vi aqui que você já tem um horário reservado com a nossa equipe ✅ Em breve o especialista confirma os detalhes com você. Qualquer coisa até lá, é só me chamar!`];
    } else {
      items = result.split && result.split.length ? result.split : [result.reply];
      if (bookSearchEnabled() && result.search_book) {
        const found = await searchBookLink(result.search_book);
        if (found && found.link) {
          items.push(`Consultei aqui pelo título e encontrei esse: ${found.link} 😊 Confere se é esse mesmo o seu livro?`);
          db.prepare(`INSERT INTO events_log (contact_id, kind, payload) VALUES (?, 'book_found', ?)`)
            .run(fresh.id, JSON.stringify({ query: result.search_book, link: found.link }));
        } else {
          items.push('Não consegui localizar pelo título aqui. Você pode me mandar o link de vendas do seu livro?');
        }
      }
    }

    // 8) Envia resposta(s)
    await sendSequence(fresh, items);
    for (const item of items) {
      const txt = typeof item === 'string' ? item : (item?.text || '');
      if (txt) recordOutbound(fresh.id, { author: 'ia', content: txt, usage: result.usage });
    }

    // 9) Atualiza estado do contato
    if (result.funnel || result.stage) {
      db.prepare(`
        UPDATE contacts
        SET funnel = COALESCE(?, funnel),
            stage = COALESCE(?, stage),
            qualification_score = ?,
            qualification_notes = COALESCE(?, qualification_notes),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        result.funnel || null,
        result.stage || null,
        result.qualification_score || fresh.qualification_score || 0,
        result.qualification_notes || null,
        fresh.id
      );
    }

    // 10) Etiquetas tina-* no GHL (interesse, agenda, dúvida-curso, temperatura)
    await applyTinaTags(fresh, result);

    // 11) Roteamento final
    const SCHED = schedulingEnabled();

    if (booked && booked.alreadyBooked) {
      // Lead JÁ tinha reunião futura (consultor marcou, ou a Tina já marcou).
      // Não duplica: pausa, marca como agendado, registra. NÃO notifica de novo.
      db.prepare(`
        UPDATE contacts SET ai_paused = 1, ai_paused_at = CURRENT_TIMESTAMP,
          stage = 'agendado', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(fresh.id);
      db.prepare('UPDATE followups SET sent = 1 WHERE contact_id = ? AND sent = 0').run(fresh.id);
      db.prepare(`INSERT INTO events_log (contact_id, kind, payload) VALUES (?, 'double_booking_evitado', ?)`)
        .run(fresh.id, JSON.stringify({ existingStart: booked.existing?.startTime || null, existingId: booked.existing?.id || null }));

    } else if (booked && booked.ok) {
      // Reunião marcada: pausa IA, notifica o time, encerra a parte da Tina.
      db.prepare(`
        UPDATE contacts SET ai_paused = 1, ai_paused_at = CURRENT_TIMESTAMP,
          stage = 'agendado', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(fresh.id);
      db.prepare('UPDATE followups SET sent = 1 WHERE contact_id = ? AND sent = 0').run(fresh.id);
      await notifyAgendamento(fresh, { label: booked.label, iso: result.book_slot, funnel: result.funnel || fresh.funnel, calendarId: booked.calendarId });

    } else if (result.course_help === 'aluno' && result.end_conversation) {
      // CASO ESPECIAL: aluno com dúvida de curso NÃO é "desqualificado".
      db.prepare(`
        UPDATE contacts SET ai_paused = 1, ai_paused_at = CURRENT_TIMESTAMP,
          stage = 'handoff', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(fresh.id);
      db.prepare(`INSERT INTO events_log (contact_id, kind, payload) VALUES (?, 'handoff_aluno', ?)`)
        .run(fresh.id, JSON.stringify({ to: 'cursos@lcagencia.com.br' }));

    } else if (result.funnel === 'publicar' && (result.handoff || result.stage === 'qualificado') && !result.handoff_mode && !result.book_slot) {
      // PUBLICAÇÃO: orçamento vai pro e-mail editorial@, não pro agendamento.
      // Encerra a parte da Tina (handoff por e-mail), pausa pra não ficar dialogando.
      db.prepare(`
        UPDATE contacts SET ai_paused = 1, ai_paused_at = CURRENT_TIMESTAMP,
          stage = 'handoff', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(fresh.id);
      db.prepare(`INSERT INTO events_log (contact_id, kind, payload) VALUES (?, 'handoff_publicar', ?)`)
        .run(fresh.id, JSON.stringify({ to: 'editorial@lcagencia.com.br' }));
      await markQualifiedAndHandoff(fresh, result, { pause: true }).catch(() => {});

    } else if (result.handoff_mode === 'agora') {
      // FALAR AGORA: passa pro próximo consultor da fila, avisa o time e pausa
      // a Tina (humano assume a conversa na hora).
      const lh = await liveHandoff(fresh).catch(err => {
        logger.error({ err: err.message }, 'liveHandoff falhou'); return { ok: false };
      });
      await markQualifiedAndHandoff(fresh, result, { pause: true }).catch(() => {});
      db.prepare(`
        UPDATE contacts SET ai_paused = 1, ai_paused_at = CURRENT_TIMESTAMP,
          stage = 'em_atendimento', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(fresh.id);
      await notifyLiveHandoff(fresh, { consultant: lh?.consultant, funnel: result.funnel || fresh.funnel });

    } else if (result.handoff_mode === 'agendar' && SCHED) {
      // AGENDAR: entra em "agendando", MANTÉM a IA ativa pra puxar horários e marcar.
      db.prepare(`UPDATE contacts SET stage = 'agendando', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(fresh.id);
      db.prepare('UPDATE followups SET sent = 1 WHERE contact_id = ? AND sent = 0').run(fresh.id);
      await markQualifiedAndHandoff(fresh, result, { pause: false }).catch(err =>
        logger.error({ err: err.message }, 'markQualifiedAndHandoff (agendando) falhou'));

    } else if (result.handoff || result.stage === 'qualificado') {
      // Lead qualificou mas ainda NÃO escolheu agora/agendar (Tina acabou de
      // perguntar "falar agora ou agendar?"). Grava a qualificação e mantém a
      // IA ATIVA pra receber a escolha no próximo turno.
      await markQualifiedAndHandoff(fresh, result, { pause: false }).catch(err =>
        logger.error({ err: err.message }, 'markQualifiedAndHandoff (escolha) falhou'));

    } else if (result.stage === 'desqualificado' || result.end_conversation) {
      await markDisqualified(fresh, result);

    } else {
      // Tina ainda qualificando: se JÁ identificou o funil, coloca o lead na
      // coluna "IA Tina" (raia dela). Com a detecção de humano LIGADA, a Tina só
      // chega aqui em leads que NENHUM consultor está atendendo → seguro MOVER a
      // opp pra IA Tina (claimToIaTina, dentro do pipeline dela). Sem a detecção,
      // só CRIA pra lead novo (moveLeadToIaTina) pra não roubar lead do time.
      if (result.funnel || fresh.funnel) {
        if (AUTO_HUMAN_DETECTION) await claimToIaTina(fresh).catch(() => {});
        else await moveLeadToIaTina(fresh).catch(() => {});
      }
      scheduleFollowup(fresh.id, 'silencio_lead');
    }
  });
}

function mapMessageType(incoming) {
  // GHL exige o mesmo canal da conversa. Mapa seguro.
  const t = (incoming || '').toLowerCase();
  if (t.includes('whats')) return 'WhatsApp';
  if (t.includes('sms'))   return 'SMS';
  if (t.includes('email')) return 'Email';
  if (t === 'fb' || t.includes('facebook')) return 'FB';
  if (t === 'ig' || t.includes('instagram')) return 'IG';
  return 'WhatsApp';  // default pra LC (canal principal)
}

async function handleOutbound(event) {
  const ghlContactId = event.contactId || event.contact_id;
  if (!ghlContactId) return;

  const contact = db.prepare('SELECT * FROM contacts WHERE ghl_contact_id = ?').get(ghlContactId);
  if (!contact) return;

  // Se veio com userId, foi humano do GHL (UI ou mobile) quem respondeu.
  // Quando a gente envia via API com PIT, o GHL NÃO preenche userId → não entra aqui.
  const humanUserId = event.userId || event.user_id;
  if (humanUserId) {
    // Tenta linkar com SDR local (se já conhecemos o ghl_user_id)
    const sdr = db.prepare('SELECT id FROM sdr_users WHERE ghl_user_id = ?').get(humanUserId);
    handleSDRReply(contact.id, sdr?.id || null);
    recordOutbound(contact.id, {
      author: 'sdr',
      content: event.body || event.message || '',
      sdr_id: sdr?.id || null,
    });
    logger.info({ contactId: contact.id, humanUserId }, 'SDR humano assumiu via GHL — IA pausada');
  }
}

export default router;
