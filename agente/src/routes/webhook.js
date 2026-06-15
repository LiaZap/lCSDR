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
import {
  schedulingEnabled, getNextSlots, slotsContextBlock, bookSlot, recordOffer,
} from '../agent/scheduling.js';
import { bookSearchEnabled, searchBookLink } from '../agent/bookSearch.js';
import { notifyAgendamento } from '../agent/notify.js';
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
const AUTO_HUMAN_DETECTION = process.env.AUTO_HUMAN_DETECTION_ENABLED === 'true';

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

  // 1.5) Checa tag de pausa manual (Plano A) — time aplicou tag pra assumir
  if (tags.includes(PAUSE_TAG)) {
    logger.info({ ghlContactId, tag: PAUSE_TAG }, 'tag de pausa presente, Tina não responde');
    return;
  }

  const contact = upsertContactFromGHL(ghlContact);

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
      booked = await bookSlot(fresh, result.book_slot);
      if (!booked.ok) {
        logger.error({ contactId: fresh.id, err: booked.error }, 'book_slot falhou, mantém agendando');
      }
    }

    // 7.5) BÔNUS: lead deu o título do livro → busca o link e anexa a
    // confirmação (a Tina nunca inventa link, quem busca é o sistema).
    const items = result.split && result.split.length ? result.split : [result.reply];
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

    if (booked && booked.ok) {
      // Reunião marcada: pausa IA, notifica o time, encerra a parte da Tina.
      db.prepare(`
        UPDATE contacts SET ai_paused = 1, ai_paused_at = CURRENT_TIMESTAMP,
          stage = 'agendado', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(fresh.id);
      db.prepare('UPDATE followups SET sent = 1 WHERE contact_id = ? AND sent = 0').run(fresh.id);
      await notifyAgendamento(fresh, { label: booked.label, iso: result.book_slot, funnel: result.funnel || fresh.funnel });

    } else if (result.course_help === 'aluno' && result.end_conversation) {
      // CASO ESPECIAL: aluno com dúvida de curso NÃO é "desqualificado".
      db.prepare(`
        UPDATE contacts SET ai_paused = 1, ai_paused_at = CURRENT_TIMESTAMP,
          stage = 'handoff', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(fresh.id);
      db.prepare(`INSERT INTO events_log (contact_id, kind, payload) VALUES (?, 'handoff_aluno', ?)`)
        .run(fresh.id, JSON.stringify({ to: 'cursos@lcagencia.com.br' }));

    } else if (result.handoff || result.stage === 'qualificado') {
      // Lead qualificou. Se agendamento ON: entra em "agendando" e MANTÉM a IA
      // ativa pra ela puxar horários e marcar. Se OFF: handoff normal (pausa).
      if (SCHED) {
        db.prepare(`
          UPDATE contacts SET stage = 'agendando', updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(fresh.id);
        // cancela follow-ups pendentes (a Tina está ativa fechando o horário)
        db.prepare('UPDATE followups SET sent = 1 WHERE contact_id = ? AND sent = 0').run(fresh.id);
        // grava custom fields + oportunidade no GHL sem pausar a IA
        await markQualifiedAndHandoff(fresh, result, { pause: false }).catch(err =>
          logger.error({ err: err.message }, 'markQualifiedAndHandoff (agendando) falhou'));
      } else {
        await markQualifiedAndHandoff(fresh, result);
      }

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
