// Router de provider LLM da Tina + sanitização pós-resposta.
//
// Resolução de provider:
//   1. Se LLM_PROVIDER=openai|anthropic estiver explícito → usa esse
//   2. Senão: se OPENAI_API_KEY válida → openai
//   3. Senão: anthropic
//
// Sanitização (cinto + suspensórios):
//   Mesmo com regra explícita no prompt, o modelo às vezes manda "—" ou outras
//   marcas de IA. Aplicamos sanitizeText() no output antes de devolver.

import { generateTinaReplyOpenAI } from './tina-openai.js';
import { generateTinaReplyAnthropic } from './tina-anthropic.js';
import { logger } from '../utils/logger.js';

let warnedProvider = false;

export function llmProvider() {
  const explicit = (process.env.LLM_PROVIDER || '').toLowerCase().trim();
  if (explicit === 'openai' || explicit === 'anthropic') return explicit;
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.length > 30) return 'openai';
  if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.length > 30) return 'anthropic';
  return 'openai';
}

// Remove marcas tipográficas de IA + normaliza pontuação pra estilo WhatsApp brasileiro.
function sanitizeText(text) {
  if (!text || typeof text !== 'string') return text;
  return text
    // Travessão / em-dash → vírgula. Só substitui quando tem espaços (uso de IA),
    // não em casos válidos como "Press LC—Master LC" que seria intencional.
    .replace(/\s+[—–]\s+/g, ', ')
    .replace(/^[—–]\s+/g, '')        // travessão no início de fala
    .replace(/\s+[—–]$/g, '')        // no fim (sobrou)
    // Hífen duplo ou triplo: --, ---
    .replace(/\s+-{2,}\s+/g, ', ')
    // Aspas curvas → retas
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    // Reticências unicode → 3 pontos normais (ainda evita, mas se aparecer fica padrão)
    .replace(/…/g, '...')
    // 2+ espaços → 1
    .replace(/  +/g, ' ')
    // Remove espaços antes de pontuação
    .replace(/ +([,.;:!?])/g, '$1')
    .trim();
}

// Aplica sanitize em todos campos textuais da resposta da Tina
function sanitizeResult(result) {
  if (!result) return result;

  if (typeof result.reply === 'string') {
    result.reply = sanitizeText(result.reply);
  }

  if (Array.isArray(result.split)) {
    result.split = result.split.map(item => {
      if (typeof item === 'string') return sanitizeText(item);
      if (item && typeof item === 'object') {
        if (item.text) item.text = sanitizeText(item.text);
        if (item.footerText) item.footerText = sanitizeText(item.footerText);
        if (Array.isArray(item.buttons)) {
          item.buttons = item.buttons.map(b => ({
            ...b,
            label: sanitizeText(b.label),
          }));
        }
      }
      return item;
    });
  }

  if (typeof result.qualification_notes === 'string') {
    result.qualification_notes = sanitizeText(result.qualification_notes);
  }

  return result;
}

// Erro do provider é "retryable" se for: timeout, rate limit, ou 5xx do servidor.
// Se for 4xx (auth, bad request, etc), NÃO faz fallback — é bug nosso.
function isRetryableLlmError(err) {
  if (!err) return false;
  const status = err.status || err.statusCode;
  if (status >= 500) return true;
  if (status === 408 || status === 429) return true;
  if (/timeout|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(err.message || '')) return true;
  return false;
}

function callProvider(name, args) {
  return name === 'openai'
    ? generateTinaReplyOpenAI(args)
    : generateTinaReplyAnthropic(args);
}

function hasProviderKey(name) {
  if (name === 'openai') return !!(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.length > 30);
  return !!(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.length > 30);
}

export async function generateTinaReply({ contact, incomingText }) {
  const primary = llmProvider();
  const secondary = primary === 'openai' ? 'anthropic' : 'openai';

  if (!warnedProvider) {
    logger.info({
      provider: primary,
      model: primary === 'openai'
        ? (process.env.OPENAI_MODEL || 'gpt-4.1-mini')
        : (process.env.CLAUDE_MODEL || 'claude-sonnet-4-6'),
      fallbackAvailable: hasProviderKey(secondary),
    }, 'LLM provider ativo');
    warnedProvider = true;
  }

  try {
    const raw = await callProvider(primary, { contact, incomingText });
    return sanitizeResult(raw);
  } catch (err) {
    // Tenta fallback se: erro retryable + fallback configurado + chaves diferentes
    if (isRetryableLlmError(err) && hasProviderKey(secondary)) {
      logger.warn({ primary, secondary, err: err.message, status: err.status },
        'LLM primário falhou, tentando fallback no outro provider');
      try {
        const raw = await callProvider(secondary, { contact, incomingText });
        return sanitizeResult(raw);
      } catch (err2) {
        logger.error({ err2: err2.message, status: err2.status },
          'LLM fallback também falhou — devolvendo handoff de emergência');
      }
    } else {
      logger.error({ err: err.message, status: err.status },
        'LLM erro não-retryable ou sem fallback configurado');
    }

    // Hardcoded fallback final: handoff pra humano. Não trava o lead esperando.
    return sanitizeResult({
      reply: 'Deixa eu te conectar com alguém aqui do time, [aguarde um instante].',
      funnel: null,
      stage: 'pre_qualificando',
      handoff: true,
      handoff_reason: `IA indisponível (${primary}${hasProviderKey(secondary) ? ' + fallback' : ''}): ${err.message}`,
      qualification_score: 0,
      qualification_notes: '⚠ Ambos LLMs falharam — encaminhando ao humano',
      end_conversation: false,
      usage: { tokens_in: 0, tokens_out: 0, cost_usd: 0 },
    });
  }
}

// Aliases de compatibilidade durante a transição Lila → Tina
export const generateLilaReply = generateTinaReply;
export const generateIaraReply = generateTinaReply;

// Exportado pra testes
export { sanitizeText, sanitizeResult };
