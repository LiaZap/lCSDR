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
// Formato esperado (uazapi pode variar; ajuste conforme docs do provider):
// {
//   "type": "message",
//   "fromMe": false,
//   "from": "5511999999999@s.whatsapp.net" | "5511999999999",
//   "pushName": "Nome do Contato",
//   "id": "msg_id",
//   "messageType": "text" | "audio" | "image" | "document" | "buttonResponse" | "listResponse",
//   "body": "texto",
//   "audio": { "url": "...", "mimetype": "..." },
//   "buttonReply": { "id": "valor_do_botao", "title": "Label" },
//   "listReply": { "id": "valor", "title": "Label" }
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
  logger.info({ type: event.type, from: event.from, id: event.id }, '[webhook uazapi]');

  db.prepare('INSERT INTO events_log (kind, payload) VALUES (?, ?)')
    .run(`uazapi_${event.type || 'unknown'}`, JSON.stringify(event).slice(0, 8000));

  // Resposta rápida — processa assíncrono
  res.status(200).json({ ok: true });

  try {
    // Ignora mensagens enviadas por mim mesmo (ecos)
    if (event.fromMe || event.type === 'message.fromMe') return;
    if (event.type !== 'message' && event.type !== 'messages.upsert') {
      logger.debug({ type: event.type }, 'evento uazapi não tratado');
      return;
    }
    await handleInbound(event);
  } catch (err) {
    logger.error({ err: err.message, stack: err.stack }, 'erro processando webhook uazapi');
    db.prepare('INSERT INTO events_log (kind, payload) VALUES (?, ?)')
      .run('error_uazapi', JSON.stringify({ err: err.message, event }).slice(0, 8000));
  }
});

function extractPhone(rawFrom) {
  if (!rawFrom) return null;
  // formatos comuns: "5511999999999@s.whatsapp.net", "5511999999999"
  const digits = String(rawFrom).split('@')[0].replace(/\D/g, '');
  return digits || null;
}

function findOrCreateContactByPhone(phone, name) {
  // No fluxo uazapi puro, usamos `phone` como chave (não temos GHL contactId).
  // Convencionamos ghl_contact_id = `wa-${phone}` quando o canal é uazapi.
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
  const phone = extractPhone(event.from);
  if (!phone) return;

  const contact = findOrCreateContactByPhone(phone, event.pushName);

  // Tipo de mensagem
  const msgType = (event.messageType || event.message?.type || 'text').toLowerCase();
  let content = event.body || event.message?.text || '';
  let content_type = 'text';
  let attachment_url = null;

  // Botão / lista clicado — vem com o `value` que a Lila definiu
  const buttonReply = event.buttonReply || event.message?.buttonReply;
  const listReply = event.listReply || event.message?.listReply;
  if (buttonReply || listReply) {
    const reply = buttonReply || listReply;
    content = `[lead clicou: ${reply.title || reply.id}]`;
    // Adiciona o value como hint pra Lila contextualizar
    if (reply.id && reply.id !== reply.title) content += ` (valor=${reply.id})`;
    content_type = 'button_click';
  }

  // Áudio
  if (msgType === 'audio' || event.audio) {
    const url = event.audio?.url || event.message?.audio?.url;
    attachment_url = url;
    try {
      // uazapi geralmente serve áudio em URL pública (sem auth) ou base64
      const audioData = event.audio?.base64 || event.message?.audio?.base64;
      let buf;
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

  // PDF / arquivo
  const docUrl = event.document?.url || event.message?.document?.url;
  if (msgType === 'document' || docUrl) {
    recordInbound(contact.id, {
      content: `[lead enviou arquivo: ${docUrl || '?'}]`,
      content_type: 'pdf_blocked',
      attachment_url: docUrl,
    });
    const txt = 'Opa, análise de arquivo a gente faz na etapa de leitura crítica com a equipe. Me conta em texto: o livro já está finalizado?';
    await sendText(contact, txt).catch(err => logger.error({ err: err.message }, 'send fail'));
    recordOutbound(contact.id, { author: 'ia', content: txt });
    return;
  }

  recordInbound(contact.id, { content, content_type, attachment_url });

  // Se IA pausada (humano assumiu) → não responde
  const fresh = db.prepare('SELECT * FROM contacts WHERE id = ?').get(contact.id);
  if (fresh.ai_paused) {
    scheduleFollowup(contact.id, 'silencio_sdr');
    return;
  }

  if (countMessagesToday(contact.id) > MAX_MSGS_DAY) {
    pauseIA(contact.id, 'limite_mensagens_dia');
    return;
  }

  // Gera resposta da Lila
  const result = await generateLilaReply({ contact: fresh, incomingText: content });

  // Envia (canal uazapi escolhido via messenger)
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
