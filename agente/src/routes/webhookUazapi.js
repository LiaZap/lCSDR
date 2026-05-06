import express from 'express';
import { db } from '../db/index.js';
import { logger } from '../utils/logger.js';
import { transcribeAudioBuffer } from '../utils/transcribe.js';
import {
  recordInbound, recordOutbound, countMessagesToday,
} from '../agent/contactService.js';
import { generateLilaReply } from '../agent/lila.js';
import { sendSequence, sendText } from '../agent/messenger.js';
import {
  pauseIA, scheduleFollowup,
  markQualifiedAndHandoff, markDisqualified,
} from '../agent/handoff.js';

const router = express.Router();
const MAX_KB = Number(process.env.MAX_ATTACHMENT_KB || 200);
const MAX_MSGS_DAY = Number(process.env.MAX_MESSAGES_PER_CONVERSATION_PER_DAY || 40);

// === Webhook do uazapi ===
// Configurar no painel uazapi → Webhooks: POST https://seu-dominio/webhook/uazapi
//
// FORMATO REAL do uazapi (capturado em prod, 2026-05-06):
// {
//   "EventType": "messages",
//   "owner": "5551926342449",
//   "token": "...",
//   "chat": {
//     "id": "...",
//     "phone": "+55 11 98795-9188",
//     "name": "Paulo Melo",
//     "wa_chatid": "5511987959188@s.whatsapp.net",
//     ...
//   },
//   "message": {
//     "id": "...",
//     "fromMe": false,
//     "chatid": "5511987959188@s.whatsapp.net",
//     "sender": "162801037402112@lid",
//     "sender_pn": "5511987959188@s.whatsapp.net",
//     "senderName": "Paulo Melo",
//     "text": "oi",
//     "content": "oi",
//     "messageType": "Conversation" | "audio" | "image" | "document",
//     "mediaType": "" | "audio" | "image" | ...,
//     "buttonOrListid": "",
//     ...
//   }
// }

router.post('/uazapi', async (req, res) => {
  // Validação de secret opcional
  const secret = process.env.UAZAPI_WEBHOOK_SECRET;
  if (secret) {
    const got = req.headers['x-webhook-secret'] || req.headers['x-uazapi-secret'];
    if (got !== secret) {
      logger.warn('webhook uazapi: secret inválido');
      return res.status(401).json({ error: 'invalid secret' });
    }
  }

  const event = req.body || {};
  const eventType = event.EventType || event.eventType || event.type || event.event;
  const msg = event.message || {};
  const chat = event.chat || {};

  // Log resumido
  logger.info({
    eventType,
    fromMe: msg.fromMe,
    chatid: msg.chatid || chat.wa_chatid,
    senderName: msg.senderName || chat.name,
    text: (msg.text || msg.content || '').slice(0, 80),
    messageType: msg.messageType,
  }, '[webhook uazapi]');

  // Log RAW completo enquanto estabiliza (desativar com LOG_WEBHOOK_FULL=false)
  if (process.env.LOG_WEBHOOK_FULL !== 'false') {
    logger.info({ payload: event }, '[webhook uazapi RAW]');
  }

  db.prepare('INSERT INTO events_log (kind, payload) VALUES (?, ?)')
    .run(`uazapi_${eventType || 'unknown'}`, JSON.stringify(event).slice(0, 8000));

  // Resposta rápida — processa assíncrono
  res.status(200).json({ ok: true });

  try {
    // Ignora mensagens enviadas por mim mesmo
    if (msg.fromMe === true || msg.wasSentByApi === true) {
      logger.info({ id: msg.id }, 'webhook ignorado: fromMe ou wasSentByApi');
      return;
    }

    // Aceita: EventType "messages" (uazapi padrão), ou qualquer evento que
    // tenha shape de mensagem (message.text + message.chatid)
    const isMessageEvent = eventType === 'messages'
      || eventType === 'message'
      || eventType === 'messages.upsert'
      || (msg.chatid && (msg.text || msg.content || msg.mediaType));

    if (!isMessageEvent) {
      logger.warn({ eventType }, 'evento uazapi não é mensagem, ignorando');
      return;
    }

    await handleInbound(event);
  } catch (err) {
    logger.error({ err: err.message, stack: err.stack }, 'erro processando webhook uazapi');
    db.prepare('INSERT INTO events_log (kind, payload) VALUES (?, ?)')
      .run('error_uazapi', JSON.stringify({ err: err.message, event }).slice(0, 8000));
  }
});

// Extrai phone E.164 (5511...) de qualquer um dos formatos uazapi
function extractPhone(event) {
  const msg = event.message || {};
  const chat = event.chat || {};

  // Preferência: chatid normalizado (5511987959188@s.whatsapp.net)
  // Fallback: chat.phone formatado ("+55 11 98795-9188") ou sender_pn
  const candidates = [
    msg.chatid,
    msg.sender_pn,
    chat.wa_chatid,
    chat.phone,
    msg.from,
    msg.sender,
  ];

  for (const raw of candidates) {
    if (!raw) continue;
    // Tira "@s.whatsapp.net", "@lid", espaços, +, hífens
    const digits = String(raw).split('@')[0].replace(/\D/g, '');
    // sender pode vir como "162801037402112@lid" (id interno, não phone) — descartar se menor que 10 dígitos
    if (digits && digits.length >= 10) return digits;
  }
  return null;
}

function findOrCreateContactByPhone(phone, name) {
  const ghlId = `wa-${phone}`;
  let contact = db.prepare('SELECT * FROM contacts WHERE ghl_contact_id = ?').get(ghlId);
  if (!contact) {
    const info = db.prepare(`
      INSERT INTO contacts (ghl_contact_id, name, phone, stage)
      VALUES (?, ?, ?, 'novo')
    `).run(ghlId, name || null, phone);
    contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(info.lastInsertRowid);
  } else if (name && !contact.name) {
    db.prepare('UPDATE contacts SET name = ? WHERE id = ?').run(name, contact.id);
    contact = { ...contact, name };
  }
  return contact;
}

async function handleInbound(event) {
  const msg = event.message || {};
  const chat = event.chat || {};

  const phone = extractPhone(event);
  if (!phone) {
    logger.warn({ event }, 'handleInbound: sem phone identificável');
    return;
  }

  const name = msg.senderName || chat.name || chat.wa_name || null;
  const contact = findOrCreateContactByPhone(phone, name);

  // Texto da mensagem
  let content = msg.text || msg.content || '';
  let content_type = 'text';
  let attachment_url = null;

  // Tipo da mídia (uazapi usa mediaType ou messageType)
  const mediaType = (msg.mediaType || '').toLowerCase();
  const messageType = (msg.messageType || '').toLowerCase();

  // Botão / lista clicado
  // uazapi: msg.buttonOrListid traz o id que a Lila definiu como `value`
  const buttonId = msg.buttonOrListid || msg.buttonReplyId || msg.listResponseId;
  if (buttonId) {
    content = `[lead clicou: ${msg.text || msg.content || buttonId}] (valor=${buttonId})`;
    content_type = 'button_click';
  }

  // Áudio
  if (mediaType === 'audio' || messageType === 'audio' || msg.audio || msg.audioUrl) {
    const url = msg.audioUrl || msg.audio?.url || msg.mediaUrl;
    attachment_url = url;
    try {
      let buf;
      const audioData = msg.audio?.base64 || msg.mediaBase64;
      if (audioData) {
        buf = Buffer.from(audioData, 'base64');
      } else if (url) {
        const r = await fetch(url);
        buf = Buffer.from(await r.arrayBuffer());
      }
      const transcript = buf ? await transcribeAudioBuffer(buf) : null;
      content = transcript || '[áudio recebido — falha na transcrição]';
      content_type = 'audio_transcript';
    } catch (err) {
      logger.error({ err: err.message }, 'falha baixando/transcrevendo áudio uazapi');
      content = '[áudio recebido — não consegui ouvir]';
      content_type = 'audio_transcript';
    }
  }

  // Documento / PDF — bloqueia, não tenta analisar
  if (mediaType === 'document' || messageType === 'document' || msg.documentUrl) {
    const url = msg.documentUrl || msg.mediaUrl;
    recordInbound(contact.id, {
      content: `[lead enviou arquivo: ${url || '?'}]`,
      content_type: 'pdf_blocked',
      attachment_url: url,
    });
    const txt = 'Opa, análise de arquivo a gente faz na etapa de leitura crítica com a equipe. Me conta em texto: o livro já está finalizado?';
    await sendText(contact, txt).catch(err => logger.error({ err: err.message }, 'send fail'));
    recordOutbound(contact.id, { author: 'ia', content: txt });
    return;
  }

  // Imagem — registra mas não tenta analisar
  if (mediaType === 'image' || messageType === 'image') {
    attachment_url = msg.imageUrl || msg.mediaUrl;
    content = content || '[lead enviou uma imagem]';
    content_type = 'image';
  }

  if (!content || !content.trim()) {
    logger.warn({ phone, mediaType, messageType }, 'mensagem vazia, ignorando');
    return;
  }

  recordInbound(contact.id, { content, content_type, attachment_url });

  // Se IA pausada → não responde
  const fresh = db.prepare('SELECT * FROM contacts WHERE id = ?').get(contact.id);
  if (fresh.ai_paused) {
    logger.info({ contactId: fresh.id }, 'IA pausada (SDR no controle), só registrando');
    scheduleFollowup(contact.id, 'silencio_sdr');
    return;
  }

  if (countMessagesToday(contact.id) > MAX_MSGS_DAY) {
    logger.warn({ contactId: contact.id }, 'limite diário atingido, pausando IA');
    pauseIA(contact.id, 'limite_mensagens_dia');
    return;
  }

  // Gera resposta
  const result = await generateLilaReply({ contact: fresh, incomingText: content });

  const items = result.split && result.split.length ? result.split : [result.reply];
  await sendSequence(fresh, items);
  for (const item of items) {
    const txt = typeof item === 'string' ? item : (item?.text || '');
    if (txt) recordOutbound(fresh.id, { author: 'ia', content: txt, usage: result.usage });
  }

  // Atualiza estado
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

  if (result.handoff || result.stage === 'qualificado') {
    await markQualifiedAndHandoff(fresh, result);
  } else if (result.stage === 'desqualificado' || result.end_conversation) {
    await markDisqualified(fresh, result);
  } else {
    scheduleFollowup(fresh.id, 'silencio_lead');
  }
}

export default router;
