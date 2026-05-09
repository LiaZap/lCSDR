import Anthropic from '@anthropic-ai/sdk';
import { LILA_SYSTEM_PROMPT } from './systemPrompt.js';
import { SERVICOS } from './knowledge.js';
import { db } from '../db/index.js';
import { logger } from '../utils/logger.js';

const VALID_SERVICES = new Set(Object.keys(SERVICOS));

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

// Custos aproximados Sonnet 4.6 — usado só pra dashboard admin
const COST_IN_PER_MTOK = 3.0;
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

function buildHistory(contactId, limit = 30) {
  const rows = db.prepare(`
    SELECT direction, author, content, content_type, created_at
    FROM messages
    WHERE contact_id = ?
    ORDER BY created_at ASC, id ASC
    LIMIT ?
  `).all(contactId, limit);

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

export async function generateLilaReplyAnthropic({ contact, incomingText }) {
  const history = buildHistory(contact.id);

  if (history.length === 0 || history[history.length - 1].role !== 'user') {
    history.push({ role: 'user', content: incomingText });
  }

  const usableName = sanitizeName(contact.name);
  const meta = `
Contexto atual do lead (NÃO responda sobre isso, só use pra calibrar):
- Nome: ${usableName || '⚠ AINDA NÃO CONHECIDO — use saudação genérica tipo "Olá!" sem nome até o lead se apresentar'}
- Funil detectado até agora: ${contact.funnel || 'ainda não identificado'}
- Estágio: ${contact.stage || 'novo'}
- Última nota de qualificação: ${contact.qualification_notes || 'nenhuma'}
`.trim();

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 900,
    system: [
      { type: 'text', text: LILA_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: meta },
    ],
    messages: history,
  });

  const raw = resp.content.map(c => c.text || '').join('\n').trim();
  const parsed = tryParseJSON(raw);

  const usage = resp.usage || {};
  const tokens_in = (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0);
  const tokens_out = usage.output_tokens || 0;
  const cost_usd = (tokens_in / 1e6) * COST_IN_PER_MTOK + (tokens_out / 1e6) * COST_OUT_PER_MTOK;

  if (!parsed || (!parsed.reply && !parsed.split)) {
    logger.warn({ raw: raw.slice(0, 300) }, 'Lila devolveu JSON inválido, usando fallback');
    return {
      reply: 'Deixa eu te conectar com alguém aqui do time, [aguarde um instante].',
      funnel: null,
      stage: 'pre_qualificando',
      handoff: true,
      handoff_reason: 'IA falhou em gerar resposta válida — encaminhando ao humano',
      qualification_score: 0,
      qualification_notes: '⚠ Lila falhou em gerar resposta válida',
      end_conversation: false,
      usage: { tokens_in, tokens_out, cost_usd },
    };
  }

  // Defesa contra hallucination de serviço (mesmo guard do lila-openai)
  if (parsed.service_recommended && !VALID_SERVICES.has(parsed.service_recommended)) {
    logger.warn(
      { invented: parsed.service_recommended },
      'Lila (Anthropic) inventou serviço inexistente — descartando'
    );
    parsed.service_recommended = null;
  }

  return { ...parsed, usage: { tokens_in, tokens_out, cost_usd } };
}

