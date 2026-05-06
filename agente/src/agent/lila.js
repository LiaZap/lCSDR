// Router de provider LLM da Lila.
// Define qual backend usar (OpenAI Responses ou Anthropic Messages) com base em env.
//
// Resolução:
//   1. Se LLM_PROVIDER=openai|anthropic estiver explícito → usa esse
//   2. Senão: se OPENAI_API_KEY válida → openai
//   3. Senão: anthropic

import { generateLilaReplyOpenAI } from './lila-openai.js';
import { generateLilaReplyAnthropic } from './lila-anthropic.js';
import { logger } from '../utils/logger.js';

let warnedProvider = false;

export function llmProvider() {
  const explicit = (process.env.LLM_PROVIDER || '').toLowerCase().trim();
  if (explicit === 'openai' || explicit === 'anthropic') return explicit;
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.length > 30) return 'openai';
  if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.length > 30) return 'anthropic';
  return 'openai';  // default — gpt-4.1-mini é barato e suficiente pra SDR
}

export async function generateLilaReply({ contact, incomingText }) {
  const provider = llmProvider();
  if (!warnedProvider) {
    logger.info({ provider, model: provider === 'openai' ? (process.env.OPENAI_MODEL || 'gpt-4.1-mini') : (process.env.CLAUDE_MODEL || 'claude-sonnet-4-6') }, 'LLM provider ativo');
    warnedProvider = true;
  }
  if (provider === 'openai') return generateLilaReplyOpenAI({ contact, incomingText });
  return generateLilaReplyAnthropic({ contact, incomingText });
}

// Alias pra compatibilidade
export const generateIaraReply = generateLilaReply;
