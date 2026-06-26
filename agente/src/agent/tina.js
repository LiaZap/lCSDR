// Router de provider LLM da Tina + sanitização pós-resposta.
//
// Resolução de provider:
//   1. Se LLM_PROVIDER=gemini|openai|anthropic estiver explícito → usa esse
//   2. Senão: primeira chave válida na ordem gemini → openai → anthropic
//
// Sanitização (cinto + suspensórios):
//   Mesmo com regra explícita no prompt, o modelo às vezes manda "—" ou outras
//   marcas de IA. Aplicamos sanitizeText() no output antes de devolver.

import { generateTinaReplyOpenAI } from './tina-openai.js';
import { generateTinaReplyAnthropic } from './tina-anthropic.js';
import { generateTinaReplyGemini } from './tina-gemini.js';
import { applyPolicyGuard } from './policyGuard.js';
import { logger } from '../utils/logger.js';

let warnedProvider = false;

const PROVIDERS = ['gemini', 'openai', 'anthropic'];

export function llmProvider() {
  const explicit = (process.env.LLM_PROVIDER || '').toLowerCase().trim();
  if (PROVIDERS.includes(explicit)) return explicit;
  // auto: primeira chave válida na ordem de preferência
  for (const p of PROVIDERS) {
    if (hasProviderKey(p)) return p;
  }
  return 'gemini';
}

function modelOf(name) {
  if (name === 'gemini') return process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  if (name === 'openai') return process.env.OPENAI_MODEL || 'gpt-4.1-mini';
  return process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
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

// Pipeline final de toda resposta da Tina: sanitização tipográfica +
// guardrail determinístico (trava de preço, Master/Press, "custo", etc).
// Toda resposta que sai pro lead passa por aqui, inclusive a do fallback.
function finalize(raw, contact) {
  const sanitized = sanitizeResult(raw);
  const { result } = applyPolicyGuard(sanitized, contact);
  return result;
}

// Erro do provider é "retryable" se for: timeout, rate limit, ou 5xx do servidor.
// Se for 4xx (auth, bad request, etc), NÃO faz fallback — é bug nosso.
function isRetryableLlmError(err) {
  if (!err) return false;
  const status = err.status || err.statusCode || err.code;
  if (typeof status === 'number' && (status >= 500 || status === 408 || status === 429)) return true;
  // Muitos SDKs (Gemini, p.ex.) NÃO colocam o status em err.status — vem só na
  // mensagem. Sem cobrir isso, um 429 de COTA do primário não era reconhecido
  // como retryable e o fallback de provider (OpenAI/Anthropic) NUNCA disparava →
  // a Tina ficava muda. Cobre cota/rate/5xx por mensagem também.
  if (/timeout|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|quota|RESOURCE_EXHAUSTED|rate.?limit|overloaded|insufficient_quota|too many requests|service unavailable|exceeded your current quota/i.test(err.message || '')) return true;
  return false;
}

function callProvider(name, args) {
  if (name === 'gemini') return generateTinaReplyGemini(args);
  if (name === 'openai') return generateTinaReplyOpenAI(args);
  return generateTinaReplyAnthropic(args);
}

function hasProviderKey(name) {
  if (name === 'gemini') return !!(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.length > 20);
  if (name === 'openai') return !!(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.length > 30);
  return !!(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.length > 30);
}

// Escolhe o melhor fallback: primeiro provider com chave que não seja o primário.
function pickSecondary(primary) {
  for (const p of PROVIDERS) {
    if (p !== primary && hasProviderKey(p)) return p;
  }
  return null;
}

export async function generateTinaReply({ contact, incomingText, extraContext = null }) {
  const primary = llmProvider();
  const secondary = pickSecondary(primary);

  if (!warnedProvider) {
    logger.info({
      provider: primary,
      model: modelOf(primary),
      fallback: secondary || 'nenhum',
    }, 'LLM provider ativo');
    warnedProvider = true;
  }

  try {
    const raw = await callProvider(primary, { contact, incomingText, extraContext });
    return finalize(raw, contact);
  } catch (err) {
    // Tenta fallback se: erro retryable + fallback configurado + chaves diferentes
    if (isRetryableLlmError(err) && secondary) {
      logger.warn({ primary, secondary, err: err.message, status: err.status },
        'LLM primário falhou, tentando fallback no outro provider');
      try {
        const raw = await callProvider(secondary, { contact, incomingText, extraContext });
        return finalize(raw, contact);
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
      llm_failed: true,
      handoff_reason: `IA indisponível (${primary}${secondary ? ` + ${secondary}` : ''}): ${err.message}`,
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
