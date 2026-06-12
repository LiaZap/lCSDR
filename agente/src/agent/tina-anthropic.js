import Anthropic from '@anthropic-ai/sdk';
import { TINA_SYSTEM_PROMPT, PROMPT_VERSION } from './systemPrompt.js';
import { SERVICOS } from './knowledge.js';
import { db } from '../db/index.js';
import { logger } from '../utils/logger.js';

const VALID_SERVICES = new Set(Object.keys(SERVICOS));
const PROVIDER = 'anthropic';
const MAX_HISTORY_TOKENS = Number(process.env.LLM_HISTORY_MAX_TOKENS || 8000);

// timeout de 25s + 1 retry no SDK (mesma justificativa do tina-openai)
// Client LAZY: só constrói quando usado, pra não exigir ANTHROPIC_API_KEY no
// boot quando o provider primário é outro (ex: Gemini).
let _client;
function getClient() {
  if (!_client) {
    _client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      timeout: 25_000,
      maxRetries: 1,
    });
  }
  return _client;
}
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

// Custos Anthropic Sonnet 4.6 (todos por 1M tokens):
// - input não-cacheado: $3
// - cache write (criação): $3.75 (1.25x base) — só na primeira chamada
// - cache read (hit):     $0.30 (10% base) — todas as subsequentes em ~5min
// - output:               $15
// Antes a gente somava cache_read no tokens_in e cobrava tudo a $3 — superestimava ~10x.
const COST_IN_PER_MTOK = 3.0;
const COST_CACHE_WRITE_PER_MTOK = 3.75;
const COST_CACHE_READ_PER_MTOK = 0.30;
const COST_OUT_PER_MTOK = 15.0;

// Detecta nome "lixo" (números, vazio, padrões esquisitos do WhatsApp)
function sanitizeName(rawName) {
  if (!rawName || typeof rawName !== 'string') return null;
  const name = rawName.trim();
  if (!name || name.length < 2) return null;
  if (/\d/.test(name)) return null;
  if (/^[\W_]+$/.test(name)) return null;
  return name;
}

function estimateTokens(text) {
  return Math.ceil((text || '').length / 4);
}

function buildHistory(contactId, limit = 30) {
  let rows = db.prepare(`
    SELECT direction, author, content, content_type, created_at
    FROM messages
    WHERE contact_id = ?
    ORDER BY created_at ASC, id ASC
    LIMIT ?
  `).all(contactId, limit);

  // Cap defensivo: trunca histórico se passar do orçamento de tokens
  let totalTokens = rows.reduce((s, m) => s + estimateTokens(m.content), 0);
  if (totalTokens > MAX_HISTORY_TOKENS) {
    const kept = [];
    let cum = 0;
    for (let i = rows.length - 1; i >= 0; i--) {
      const t = estimateTokens(rows[i].content);
      if (cum + t > MAX_HISTORY_TOKENS) break;
      cum += t;
      kept.unshift(rows[i]);
    }
    logger.warn(
      { contactId, original: rows.length, kept: kept.length },
      'history truncado por exceder MAX_HISTORY_TOKENS'
    );
    rows = [
      { direction: 'inbound', author: 'lead', content: '[contexto anterior truncado por tamanho — segue só os últimos turnos]', content_type: 'text' },
      ...kept,
    ];
  }

  const turns = [];
  for (const m of rows) {
    const role = m.direction === 'inbound' ? 'user' : 'assistant';
    let text = m.content || '';
    if (m.content_type === 'audio_transcript') text = `[áudio transcrito] ${text}`;
    if (m.content_type === 'pdf_blocked') text = `[o lead mandou um PDF — você respondeu que análise é etapa de leitura crítica]`;
    if (m.author === 'sdr') text = `[SDR humano respondeu] ${text}`;
    turns.push({ role, content: text });
  }
  return turns;
}

function tryParseJSON(text) {
  const cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try { return JSON.parse(cleaned); } catch {}
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

export async function generateTinaReplyAnthropic({ contact, incomingText, extraContext = null }) {
  const history = buildHistory(contact.id);

  if (history.length === 0 || history[history.length - 1].role !== 'user') {
    history.push({ role: 'user', content: incomingText });
  }

  const usableName = sanitizeName(contact.name);
  let meta = `
Contexto atual do lead (NÃO responda sobre isso, só use pra calibrar):
- Nome: ${usableName || '⚠ AINDA NÃO CONHECIDO — use saudação genérica tipo "Olá!" sem nome até o lead se apresentar'}
- Funil detectado até agora: ${contact.funnel || 'ainda não identificado'}
- Estágio: ${contact.stage || 'novo'}
- Última nota de qualificação: ${contact.qualification_notes || 'nenhuma'}
`.trim();
  if (extraContext) meta += `\n\n${extraContext}`;

  const resp = await getClient().messages.create({
    model: MODEL,
    max_tokens: 900,
    system: [
      { type: 'text', text: TINA_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: meta },
    ],
    messages: history,
  });

  const raw = resp.content.map(c => c.text || '').join('\n').trim();
  const parsed = tryParseJSON(raw);

  const usage = resp.usage || {};
  const non_cached = usage.input_tokens || 0;
  const cache_read = usage.cache_read_input_tokens || 0;
  const cache_write = usage.cache_creation_input_tokens || 0;
  const tokens_in = non_cached + cache_read + cache_write;
  const tokens_out = usage.output_tokens || 0;

  // Custo correto separando cada bucket (antes cobrava tudo a $3/M)
  const cost_usd =
    (non_cached / 1e6) * COST_IN_PER_MTOK +
    (cache_write / 1e6) * COST_CACHE_WRITE_PER_MTOK +
    (cache_read / 1e6) * COST_CACHE_READ_PER_MTOK +
    (tokens_out / 1e6) * COST_OUT_PER_MTOK;

  const meta_usage = {
    tokens_in,
    tokens_out,
    cached_tokens: cache_read,
    cost_usd,
    provider: PROVIDER,
    model: MODEL,
    prompt_version: PROMPT_VERSION,
  };

  if (!parsed || (!parsed.reply && !parsed.split)) {
    logger.warn({ raw: raw.slice(0, 300) }, 'Tina devolveu JSON inválido, usando fallback');
    return {
      reply: 'Deixa eu te conectar com alguém aqui do time, [aguarde um instante].',
      funnel: null,
      stage: 'pre_qualificando',
      handoff: true,
      handoff_reason: 'IA falhou em gerar resposta válida — encaminhando ao humano',
      qualification_score: 0,
      qualification_notes: '⚠ Tina falhou em gerar resposta válida',
      end_conversation: false,
      usage: meta_usage,
    };
  }

  // Defesa contra hallucination de serviço (mesmo guard do tina-openai)
  if (parsed.service_recommended && !VALID_SERVICES.has(parsed.service_recommended)) {
    logger.warn(
      { invented: parsed.service_recommended },
      'Tina (Anthropic) inventou serviço inexistente — descartando'
    );
    parsed.service_recommended = null;
  }

  return { ...parsed, usage: meta_usage };
}

