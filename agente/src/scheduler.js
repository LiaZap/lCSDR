import { db } from './db/index.js';
import { GHL } from './ghl/client.js';
import { resumeIA } from './agent/handoff.js';
import { recordOutbound } from './agent/contactService.js';
import { sendResumoDiaGroup } from './agent/notify.js';
import { sweepOrganico } from './agent/organicoSweep.js';
import { handleOpportunityStage } from './routes/webhook.js';
import { logger } from './utils/logger.js';

const TICK_MS = 60_000; // 1 min

// Processa follow-ups vencidos: lead/SDR em silêncio → IA retoma com mensagem leve.
// IMPORTANTE: processa só 1 follow-up por contato por tick. Mesmo que o banco
// tenha 5 follow-ups acumulados, manda só 1 mensagem e marca todos como sent.
async function processFollowups() {
  const due = db.prepare(`
    SELECT f.*, c.id as contact_id, c.ghl_contact_id, c.name, c.ai_paused, c.stage
    FROM followups f
    JOIN contacts c ON c.id = f.contact_id
    WHERE f.sent = 0 AND f.due_at <= datetime('now')
      AND f.id = (
        SELECT MIN(id) FROM followups
        WHERE contact_id = f.contact_id AND sent = 0
      )
    LIMIT 20
  `).all();

  for (const f of due) {
    try {
      // Defensa em camadas: marca TODOS os follow-ups pendentes do contato como
      // sent ANTES de processar. Garante que mesmo se algo der erro depois,
      // não vai disparar duplicado.
      db.prepare('UPDATE followups SET sent = 1 WHERE contact_id = ? AND sent = 0').run(f.contact_id);

      // Se já foi desqualificado, agendado, qualificado (handoff feito) ou
      // está em handoff, NÃO manda follow-up. Risco era a Tina mandar
      // "dei uma sumida" pra lead que o Closer humano está atendendo.
      if (['desqualificado', 'agendado', 'qualificado', 'handoff'].includes(f.stage)) {
        continue;
      }

      // Defesa em camadas: se a IA está pausada (qualquer motivo), nem retoma.
      // Só caminho legítimo de follow-up é silencio_lead com IA não-pausada.
      if (f.ai_paused) continue;

      const nome = (f.name || '').split(' ')[0];
      const saudacao = nome ? `Oi ${nome}, ` : 'Oi, ';
      const txt = f.reason === 'silencio_sdr'
        ? `${saudacao}passando pra te dar um retorno. O time já foi notificado, mas pra não te deixar no vácuo: me conta rapidinho o que você está precisando? Assim agilizo aqui.`
        : `${saudacao}dei uma sumida, me desculpa. Você ainda está interessado em saber mais sobre o livro? Se sim, me conta onde você está agora: escrevendo, com livro pronto pra publicar, ou quer divulgar um que já lançou?`;

      await GHL.sendMessage({
        contactId: f.ghl_contact_id,
        message: txt,
        type: process.env.GHL_OUTBOUND_TYPE || 'WhatsApp', // mesmo canal da Tina (SMS/WhatsApp)
      });
      recordOutbound(f.contact_id, { author: 'ia', content: txt });
      db.prepare(`INSERT INTO events_log (contact_id, kind, payload) VALUES (?, 'followup_sent', ?)`)
        .run(f.contact_id, JSON.stringify({ reason: f.reason }));
      logger.info({ contactId: f.contact_id, reason: f.reason }, 'follow-up enviado');
    } catch (err) {
      logger.error({ err: err.message, followupId: f.id }, 'falha em follow-up');
    }
  }
}

// Resumo diário pro grupo do time no WhatsApp. Default DESLIGADO; liga com
// RESUMO_DIA_ENABLED=true. Hora em RESUMO_DIA_HORA (0-23, horário de Brasília;
// default 18; valor inválido/vazio cai no default). O placar é ancorado no dia
// de Brasília (queries em notify.js usam date(...,'-3 hours')), então qualquer
// hora 0-23 conta o dia certo. Dispara 1x/dia: reserva o evento ANTES de enviar
// (sobrevive a restart e bloqueia os ticks seguintes); se o envio falhar, desfaz
// a reserva pra tentar de novo no próximo tick.
async function maybeSendResumoDia() {
  if (process.env.RESUMO_DIA_ENABLED !== 'true') return;
  // Sem grupo/token configurado: nem tenta (senão logaria um warn a cada tick).
  if (!process.env.UAZAPI_NOTIFY_GROUP || !process.env.UAZAPI_TOKEN) return;

  // Hora alvo (BRT). NaN/vazio/fora de 0-23 → default 18, em vez de morrer calado.
  const raw = process.env.RESUMO_DIA_HORA;
  let hora = (raw == null || raw === '') ? 18 : Number(raw);
  if (!Number.isInteger(hora) || hora < 0 || hora > 23) hora = 18;

  let brtHour;
  try {
    brtHour = Number(new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo', hour: 'numeric', hourCycle: 'h23',
    }).format(new Date()));
  } catch {
    brtHour = (new Date().getUTCHours() + 21) % 24; // fallback: UTC-3
  }
  if (brtHour !== hora) return;

  // Idempotência: no máx. 1 envio por ~dia (janela de 20h em UTC).
  const ja = db.prepare(
    `SELECT 1 FROM events_log WHERE kind='resumo_dia_enviado' AND created_at >= datetime('now','-20 hours') LIMIT 1`
  ).get();
  if (ja) return;

  // Reserva o marcador ANTES de enviar: se o INSERT falhar não enviou (nada a
  // duplicar); se o envio falhar, desfaz a reserva pra retomar no próximo tick.
  const reserva = db.prepare(`INSERT INTO events_log (contact_id, kind, payload) VALUES (NULL, 'resumo_dia_enviado', ?)`)
    .run(JSON.stringify({ horaBRT: hora }));
  const ok = await sendResumoDiaGroup();
  if (ok) {
    logger.info({ horaBRT: hora }, 'resumo diário enviado pro grupo');
  } else {
    db.prepare(`DELETE FROM events_log WHERE id = ?`).run(reserva.lastInsertRowid);
  }
}

// VARREDURA automática do Funil Orgânico (safety-net): responde os leads PARADOS
// (esperando resposta, <24h, só na raia da Tina, sem SDR ativo) mesmo se o webhook
// ao vivo falhar ou houver apagão de IA — pra os leads não empilharem. Default
// DESLIGADA (ORGANICO_SWEEP_ENABLED=true pra ligar). Roda a cada ORGANICO_SWEEP_MINUTES
// (default 30), no máx. ORGANICO_SWEEP_MAX leads por rodada (default 12). Idempotente:
// o cooldown de 12h do handleOpportunityStage evita re-responder o mesmo lead.
const SWEEP_ON = process.env.ORGANICO_SWEEP_ENABLED === 'true';
const SWEEP_INTERVAL_MS = Math.max(5, Number(process.env.ORGANICO_SWEEP_MINUTES) || 30) * 60_000;
const SWEEP_MAX = Math.max(1, Number(process.env.ORGANICO_SWEEP_MAX) || 12);
let _sweepLast = 0;
let _sweepRunning = false;

async function maybeSweepOrganico() {
  if (!SWEEP_ON) return;
  if (_sweepRunning) return;                                  // não sobrepõe (a varredura demora)
  if (Date.now() - _sweepLast < SWEEP_INTERVAL_MS) return;
  _sweepLast = Date.now();
  _sweepRunning = true;
  try {
    const r = await sweepOrganico({
      send: true,
      max: SWEEP_MAX,
      respondFn: (cid) => handleOpportunityStage({ type: 'IaTinaAssumir', contactId: cid, _force: true }),
    });
    if (r.esperando || r.respondidos) {
      logger.info({
        total: r.total, esperando: r.esperando, respondidos: r.respondidos,
        foraRaia: r.foraRaia, sdrAtivo: r.sdrAtivo, fora24h: r.fora24h, elegiveis: r.elegiveis.length,
      }, 'varredura Funil Orgânico');
    }
  } catch (e) {
    logger.error({ err: e.message }, 'varredura Funil Orgânico falhou');
  } finally {
    _sweepRunning = false;
  }
}

export function startScheduler() {
  const resumoOn = process.env.RESUMO_DIA_ENABLED === 'true';
  const resumoConfigOk = Boolean(process.env.UAZAPI_NOTIFY_GROUP && process.env.UAZAPI_TOKEN);
  if (resumoOn && !resumoConfigOk) {
    logger.warn('RESUMO_DIA_ENABLED=true mas falta UAZAPI_NOTIFY_GROUP/UAZAPI_TOKEN — resumo diário não vai enviar');
  }
  logger.info({
    tick_ms: TICK_MS,
    resumoDia: resumoOn ? (resumoConfigOk ? `ligado (${process.env.RESUMO_DIA_HORA || 18}h BRT)` : 'ligado mas sem grupo/token') : 'desligado',
    varreduraOrganico: SWEEP_ON ? `ligada (${SWEEP_INTERVAL_MS / 60000}min, máx ${SWEEP_MAX})` : 'desligada',
  }, 'scheduler iniciado');
  setInterval(() => {
    processFollowups().catch(err => logger.error(err));
    maybeSendResumoDia().catch(err => logger.error(err));
    maybeSweepOrganico().catch(err => logger.error(err));
  }, TICK_MS);
}
