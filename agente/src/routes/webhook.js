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
import { sendSequence, sendText } from '../agent/messenger.js';
import {
  pauseIA, scheduleFollowup, handleSDRReply,
  markQualifiedAndHandoff, markDisqualified, applyTinaTags,
} from '../agent/handoff.js';
import { withContactLock } from '../utils/contactLock.js';

const router = express.Router();
const MAX_KB = Number(process.env.MAX_ATTACHMENT_KB || 200);
const MAX_MSGS_DAY = Number(process.env.MAX_MESSAGES_PER_CONVERSATION_PER_DAY || 40);

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

async function handleInbound(event) {
  const ghlContactId = event.contactId || event.contact_id;
  if (!ghlContactId) return;

  // 1) Hydrata contato do GHL (pega nome, phone, email)
  let ghlContact;
  try {
    ghlContact = await GHL.getContact(ghlContactId);
  } catch (err) {
    logger.error({ err: err.message, ghlContactId }, 'não consegui buscar contato no GHL');
    ghlContact = { id: ghlContactId };
  }

  const contact = upsertContactFromGHL(ghlContact);

  // 2) Classifica tipo de mensagem (texto, áudio, imagem, PDF)
  //    GHL envia em `messageType` (WhatsApp/SMS/Email/FB/IG/GMB) e conteúdo em `body` + `attachments`.
  const msgType = (event.messageType || '').toLowerCase();
  const body = event.body || event.message || '';
  const attachments = event.attachments || [];

  let content = body;
  let content_type = 'text';
  let attachment_url = null;

  // Detecta attachments por URL (GHL manda array de strings URL ou objetos)
  const attachList = attachments.map(a => typeof a === 'string' ? { url: a } : a);
  const audioAtt = attachList.find(a => /\.(ogg|opus|mp3|m4a|wav)(\?|$)/i.test(a.url || ''));
  const pdfAtt = attachList.find(a => /\.(pdf|doc|docx)(\?|$)/i.test(a.url || ''));
  const imageAtt = attachList.find(a => /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(a.url || ''));

  // PDF → bloquear (não analisar via IA, delegar à leitura crítica)
  if (pdfAtt) {
    attachment_url = pdfAtt.url;
    recordInbound(contact.id, {
      content: `[lead enviou arquivo: ${pdfAtt.url}]`,
      content_type: 'pdf_blocked',
      ghl_message_id: event.messageId || event.id,
      attachment_url,
    });
    const txt = 'Opa, análise de arquivo a gente faz na etapa de leitura crítica com a equipe. Me conta em texto: o livro já está finalizado ou ainda está em processo?';
    await sendText(contact, txt).catch(err => logger.error({ err: err.message }, 'send fail'));
    recordOutbound(contact.id, { author: 'ia', content: txt });
    return;
  }

  // Áudio → baixa (com auth GHL) e transcreve
  if (audioAtt || msgType === 'audio') {
    const url = audioAtt?.url || attachList[0]?.url;
    attachment_url = url;
    try {
      const buf = url ? await downloadAttachment(url) : null;
      const transcript = buf ? await transcribeAudioBuffer(buf) : null;
      content = transcript || '[áudio recebido — falha na transcrição]';
      content_type = 'audio_transcript';
    } catch (err) {
      logger.error({ err: err.message }, 'falha baixando/transcrevendo áudio');
      content = '[áudio recebido — não consegui ouvir]';
      content_type = 'audio_transcript';
    }
  }

  // Imagem → registra mas não tenta ler (fora do escopo da Iara por enquanto)
  if (imageAtt && !audioAtt) {
    attachment_url = imageAtt.url;
    content = body || '[lead enviou uma imagem]';
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

    // 5) Gera resposta da Tina
    const result = await generateTinaReply({ contact: fresh, incomingText: content });

    // 6) Envia resposta(s) — canal escolhido pelo messenger
    const items = result.split && result.split.length ? result.split : [result.reply];
    await sendSequence(fresh, items);
    for (const item of items) {
      const txt = typeof item === 'string' ? item : (item?.text || '');
      if (txt) recordOutbound(fresh.id, { author: 'ia', content: txt, usage: result.usage });
    }

    // 7) Atualiza estado do contato
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

    // 8) Etiquetas tina-* no GHL (interesse, agenda, dúvida-curso, temperatura)
    await applyTinaTags(fresh, result);

    // 9) Roteamento final
    if (result.handoff || result.stage === 'qualificado') {
      await markQualifiedAndHandoff(fresh, result);
    } else if (result.stage === 'desqualificado' || result.end_conversation) {
      await markDisqualified(fresh, result);
    } else {
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
