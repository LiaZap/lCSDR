import { db } from './db/index.js';
import { GHL } from './ghl/client.js';
import { resumeIA } from './agent/handoff.js';
import { recordOutbound } from './agent/contactService.js';
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

      // Se já foi desqualificado ou agendado, ignora
      if (['desqualificado', 'agendado'].includes(f.stage)) {
        continue;
      }

      // Se IA estava pausada (SDR assumiu), retoma antes de mandar
      if (f.ai_paused) resumeIA(f.contact_id, f.reason);

      const nome = (f.name || '').split(' ')[0];
      const saudacao = nome ? `Oi ${nome}, ` : 'Oi, ';
      const txt = f.reason === 'silencio_sdr'
        ? `${saudacao}passando pra te dar um retorno. O time já foi notificado, mas pra não te deixar no vácuo: me conta rapidinho o que você está precisando? Assim agilizo aqui.`
        : `${saudacao}dei uma sumida, me desculpa. Você ainda está interessado em saber mais sobre o livro? Se sim, me conta onde você está agora: escrevendo, com livro pronto pra publicar, ou quer divulgar um que já lançou?`;

      await GHL.sendMessage({
        contactId: f.ghl_contact_id,
        message: txt,
        type: 'WhatsApp',
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

export function startScheduler() {
  logger.info({ tick_ms: TICK_MS }, 'scheduler iniciado');
  setInterval(() => { processFollowups().catch(err => logger.error(err)); }, TICK_MS);
}
