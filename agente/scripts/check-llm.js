// Healthcheck dos provedores de LLM: faz um "ping" mínimo (1 token) em cada chave
// configurada e diz se ainda RESPONDE (tem cota/crédito) ou se caiu — pra
// descobrir na hora se a Tina está mandando o fallback por falta de crédito.
//
// Uso (no container do lcsdr):  node scripts/check-llm.js
import 'dotenv/config';
import fetch from 'node-fetch';

const G_KEY = process.env.GEMINI_API_KEY;
const O_KEY = process.env.OPENAI_API_KEY;
const A_KEY = process.env.ANTHROPIC_API_KEY;
const G_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const O_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const A_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

// Provedor PRIMÁRIO (mesma ordem do tina.js): LLM_PROVIDER explícito, senão a 1ª chave.
const explicit = (process.env.LLM_PROVIDER || '').toLowerCase().trim();
const primary = ['gemini', 'openai', 'anthropic'].includes(explicit)
  ? explicit
  : (G_KEY ? 'gemini' : O_KEY ? 'openai' : A_KEY ? 'anthropic' : 'nenhum');

// Classifica a resposta HTTP num veredito legível.
function verdict(status, bodyText) {
  const b = (bodyText || '').toLowerCase();
  if (status === 200) return '✅ OK — responde (tem cota/crédito)';
  if (status === 401 || status === 403) return '🔑 CHAVE inválida/sem permissão';
  if (status === 429) {
    if (/insufficient_quota|exceeded your current quota|resource_exhausted|credit|billing/.test(b))
      return '🔴 SEM COTA/CRÉDITO (429) — é isso que derruba a Tina';
    return '🟠 rate limit (429) — muitas chamadas; cota pode estar ok';
  }
  if (status === 402) return '🔴 SEM CRÉDITO (402)';
  if (status === 404) return '⚠️ modelo não encontrado (chave OK — ajustar o nome do modelo)';
  if (status === 400 && /api_key|invalid.*key/.test(b)) return '🔑 CHAVE inválida';
  if (status === 400 && /credit balance|too low/.test(b)) return '🔴 SEM CRÉDITO (saldo baixo)';
  return `⚠️ erro ${status}`;
}

async function ping(name, fn) {
  try {
    const { status, text } = await fn();
    const v = verdict(status, text);
    const extra = status !== 200 ? `  ·  ${(text || '').replace(/\s+/g, ' ').slice(0, 160)}` : '';
    console.log(`${name.padEnd(10)} ${v}${extra}`);
  } catch (e) {
    console.log(`${name.padEnd(10)} ⚠️ falha de rede: ${e.message}`);
  }
}

async function gemini() {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${G_MODEL}:generateContent?key=${G_KEY}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: 'ping' }] }], generationConfig: { maxOutputTokens: 1 } }),
  });
  return { status: r.status, text: await r.text() };
}

async function openai() {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${O_KEY}` },
    body: JSON.stringify({ model: O_MODEL, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
  });
  return { status: r.status, text: await r.text() };
}

async function anthropic() {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': A_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: A_MODEL, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
  });
  return { status: r.status, text: await r.text() };
}

console.log('\n════ HEALTHCHECK LLM ════');
console.log(`Provedor PRIMÁRIO da Tina: ${primary}${primary !== 'nenhum' ? ' (' + ({ gemini: G_MODEL, openai: O_MODEL, anthropic: A_MODEL }[primary]) + ')' : ''}\n`);

if (G_KEY) await ping('gemini', gemini); else console.log('gemini     — sem chave (GEMINI_API_KEY)');
if (O_KEY) await ping('openai', openai); else console.log('openai     — sem chave (OPENAI_API_KEY)');
if (A_KEY) await ping('anthropic', anthropic); else console.log('anthropic  — sem chave (ANTHROPIC_API_KEY)');

console.log('\nSe o PRIMÁRIO estiver 🔴/🔑 e não houver outro ✅, a Tina manda o fallback.');
console.log('Correção: recarregar crédito / renovar a chave, ou garantir um fallback ✅.\n');
