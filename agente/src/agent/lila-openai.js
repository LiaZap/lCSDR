// Lila via OpenAI Responses API (gpt-4.1-mini)
//
// Por que Responses API e não Chat Completions:
//   - Suporte nativo a structured output via JSON Schema strict (garante formato)
//   - `instructions` separado de `input` (prompt cacheável)
//   - API mais nova, alinhada com agentes
//
// Custo gpt-4.1-mini (vs Sonnet 4.6 que era $3/$15):
//   - Input:        $0.40 / 1M tokens   (~7.5x mais barato)
//   - Cached input: $0.10 / 1M tokens   (~30x mais barato)
//   - Output:       $1.60 / 1M tokens   (~9.4x mais barato)

import OpenAI from 'openai';
import { LILA_SYSTEM_PROMPT } from './systemPrompt.js';
import { db } from '../db/index.js';
import { logger } from '../utils/logger.js';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

const COST_IN_PER_MTOK = 0.40;
const COST_CACHED_IN_PER_MTOK = 0.10;
const COST_OUT_PER_MTOK = 1.60;

// === JSON Schema da resposta da Lila ===
// OpenAI strict mode exige:
//  - Todos os campos em `required`
//  - `additionalProperties: false`
//  - Sem `minimum`/`maximum` (validados client-side se precisar)
const LILA_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'reply', 'split', 'funnel', 'service_recommended',
    'stage', 'handoff', 'handoff_reason',
    'qualification_score', 'qualification_notes', 'end_conversation',
  ],
  properties: {
    reply: {
      type: 'string',
      description: 'Texto da resposta da Lila (1-3 linhas pra WhatsApp). Vazio se split for usado.',
    },
    split: {
      anyOf: [
        { type: 'null' },
        {
          type: 'array',
          description: 'Bolhas separadas; sobrescreve reply quando preenchido. Cada item pode ser texto puro OU objeto com botões.',
          items: {
            anyOf: [
              { type: 'string' },
              {
                type: 'object',
                additionalProperties: false,
                required: ['text', 'buttons', 'footerText'],
                properties: {
                  text: { type: 'string' },
                  buttons: {
                    type: 'array',
                    description: 'Até 3 = botões inline; 4-10 = lista (modal WhatsApp).',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['label', 'value'],
                      properties: {
                        label: { type: 'string', description: 'Texto que aparece no botão' },
                        value: { type: 'string', description: 'Valor estável retornado quando clicar (snake_case)' },
                      },
                    },
                  },
                  footerText: {
                    anyOf: [{ type: 'string' }, { type: 'null' }],
                  },
                },
              },
            ],
          },
        },
      ],
    },
    funnel: {
      anyOf: [
        { type: 'null' },
        { type: 'string', enum: ['escrever', 'publicar', 'divulgar'] },
      ],
      description: 'Qual dos 3 funis Lila identificou (null se ainda não dá pra saber)',
    },
    service_recommended: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
      description: 'Chave do serviço recomendado em knowledge.js (opcional)',
    },
    stage: {
      type: 'string',
      enum: ['pre_qualificando', 'qualificando', 'qualificado', 'desqualificado'],
    },
    handoff: { type: 'boolean', description: 'true se vai passar pro Closer humano agora' },
    handoff_reason: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
      description: 'Contexto curto pro Closer entender o lead',
    },
    qualification_score: {
      type: 'integer',
      description: 'Score 0-100 conforme sinais. >=60 vira handoff. <30 vira encerramento.',
    },
    qualification_notes: {
      type: 'string',
      description: 'Anotação curta pro humano (perfil, urgência, sinais)',
    },
    end_conversation: { type: 'boolean', description: 'true se Lila encerrou a conversa por desqualificação ou off-topic' },
  },
};

// Detecta nome "lixo" (números, vazio, padrões esquisitos do WhatsApp)
function sanitizeContactName(rawName) {
  if (!rawName || typeof rawName !== 'string') return null;
  const name = rawName.trim();
  if (!name) return null;
  // Sem dígitos no nome (descarta "Lead 5511...", "+5511...", etc)
  if (/\d/.test(name)) return null;
  // Muito curto (provavelmente lixo)
  if (name.length < 2) return null;
  // Padrão de telefone disfarçado (só caracteres ou pontos)
  if (/^[\W_]+$/.test(name)) return null;
  return name;
}

function buildHistory(contactId, limit = 30) {
  const rows = db.prepare(`
    SELECT direction, author, content, content_type, created_at
    FROM messages WHERE contact_id = ?
    ORDER BY created_at ASC, id ASC
    LIMIT ?
  `).all(contactId, limit);

  return rows.map(m => {
    const role = m.direction === 'inbound' ? 'user' : 'assistant';
    let text = m.content || '';
    if (m.content_type === 'audio_transcript') text = `[áudio transcrito] ${text}`;
    if (m.content_type === 'pdf_blocked') text = '[lead mandou PDF — você respondeu que análise é etapa de leitura crítica]';
    if (m.author === 'sdr') text = `[SDR humano respondeu] ${text}`;
    return { role, content: text };
  });
}

export async function generateLilaReplyOpenAI({ contact, incomingText }) {
  const history = buildHistory(contact.id);
  if (history.length === 0 || history[history.length - 1].role !== 'user') {
    history.push({ role: 'user', content: incomingText });
  }

  const usableName = sanitizeContactName(contact.name);
  const meta = `
Contexto atual do lead (NÃO responda sobre isso, só use pra calibrar):
- Nome: ${usableName || '⚠ AINDA NÃO CONHECIDO — use saudação genérica tipo "Olá!" sem nome até o lead se apresentar'}
- Funil detectado até agora: ${contact.funnel || 'ainda não identificado'}
- Estágio: ${contact.stage || 'novo'}
- Última nota de qualificação: ${contact.qualification_notes || 'nenhuma'}
`.trim();

  let response;
  try {
    response = await client.responses.create({
      model: MODEL,
      instructions: `${LILA_SYSTEM_PROMPT}\n\n${meta}`,
      input: history,
      text: {
        format: {
          type: 'json_schema',
          name: 'lila_response',
          strict: true,
          schema: LILA_SCHEMA,
        },
      },
      max_output_tokens: 900,
    });
  } catch (err) {
    logger.error({ err: err.message, code: err.code, status: err.status }, 'OpenAI Responses falhou');
    throw err;
  }

  const raw = response.output_text || '';
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.warn({ raw: raw.slice(0, 300) }, 'Lila (OpenAI) JSON inválido — fallback');
    parsed = null;
  }

  const u = response.usage || {};
  const tokens_in = u.input_tokens || 0;
  const tokens_out = u.output_tokens || 0;
  const cached = u.input_tokens_details?.cached_tokens || 0;
  const non_cached = Math.max(0, tokens_in - cached);
  const cost_usd =
    (cached / 1e6) * COST_CACHED_IN_PER_MTOK +
    (non_cached / 1e6) * COST_IN_PER_MTOK +
    (tokens_out / 1e6) * COST_OUT_PER_MTOK;

  if (!parsed || (!parsed.reply && !(parsed.split && parsed.split.length))) {
    return {
      reply: 'Deixa eu te conectar com alguém aqui do time, [aguarde um instante].',
      funnel: null,
      stage: 'pre_qualificando',
      handoff: true,
      handoff_reason: 'IA OpenAI falhou em gerar resposta válida',
      qualification_score: 0,
      qualification_notes: '⚠ JSON inválido OpenAI Responses',
      end_conversation: false,
      usage: { tokens_in, tokens_out, cost_usd },
    };
  }

  return { ...parsed, usage: { tokens_in, tokens_out, cost_usd } };
}
