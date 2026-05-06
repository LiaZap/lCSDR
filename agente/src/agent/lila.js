// Router de provider LLM da Lila + sanitização pós-resposta.
//
// Resolução de provider:
//   1. Se LLM_PROVIDER=openai|anthropic estiver explícito → usa esse
//   2. Senão: se OPENAI_API_KEY válida → openai
//   3. Senão: anthropic
//
// Sanitização (cinto + suspensórios):
//   Mesmo com regra explícita no prompt, o modelo às vezes manda "—" ou outras
//   marcas de IA. Aplicamos sanitizeText() no output antes de devolver.

import { generateLilaReplyOpenAI } from './lila-openai.js';
import { generateLilaReplyAnthropic } from './lila-anthropic.js';
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

// Aplica sanitize em todos campos textuais da resposta da Lila
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

export async function generateLilaReply({ contact, incomingText }) {
  const provider = llmProvider();
  if (!warnedProvider) {
    logger.info({
      provider,
      model: provider === 'openai'
        ? (process.env.OPENAI_MODEL || 'gpt-4.1-mini')
        : (process.env.CLAUDE_MODEL || 'claude-sonnet-4-6'),
    }, 'LLM provider ativo');
    warnedProvider = true;
  }

  const raw = provider === 'openai'
    ? await generateLilaReplyOpenAI({ contact, incomingText })
    : await generateLilaReplyAnthropic({ contact, incomingText });

  return sanitizeResult(raw);
}

// Alias pra compatibilidade
export const generateIaraReply = generateLilaReply;

// Exportado pra testes
export { sanitizeText, sanitizeResult };
