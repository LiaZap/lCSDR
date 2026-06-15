// Guardrail determinístico da Tina (cinto de segurança pós-IA).
//
// Roda DEPOIS da IA gerar e ANTES de enviar. Não é outro LLM (não alucina):
// são regras fixas que CORRIGEM ou BLOQUEIAM as falhas que quebram a confiança
// do cliente e descaracterizam a SDR. Toda violação é registrada (pra métricas
// e pra provar que "é impossível a Tina soltar preço / virar bot").
//
// Severidades:
//   block  → troca a mensagem inteira pela resposta-cofre (ex: vazou preço)
//   fix    → conserta cirurgicamente e mantém a mensagem (ex: "custo"→"investimento")
//   flag   → não altera, só registra pra acompanhamento (ex: não terminou com pergunta)
//
// O guard é env-desligável (POLICY_GUARD_ENABLED=false) mas vem LIGADO por padrão.

import { db } from '../db/index.js';
import { logger } from '../utils/logger.js';

const ENABLED = process.env.POLICY_GUARD_ENABLED !== 'false';

// Valores que a Tina PODE citar (gate de qualificação + livro público).
// Qualquer outro valor monetário >= R$ 1.000 é preço de serviço proibido.
// Único valor que a Tina pode citar: o livro público "O Livro Secreto" (R$ 59,90).
// Qualquer outro número de dinheiro é bloqueado (regra Lilian: nunca preço).
const VALORES_PERMITIDOS = new Set([59.9, 59, 60]);

// Converte "7.800", "50.000", "1.299,90", "629", "59,90" → Number em reais.
function parseBRL(raw) {
  let s = String(raw).trim();
  // tem vírgula decimal? então pontos são milhar
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/\.(?=\d{3}\b)/g, ''); // ponto de milhar (1.000 → 1000)
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

// Detecta QUALQUER valor de dinheiro proibido. Regra Lilian (15/06): a Tina
// não fala NENHUM número de dinheiro, exceto o livro público (R$ 59,90).
// Ou seja: qualquer "R$ X" que não seja o livro é bloqueado.
function detectPriceLeak(text) {
  if (!text) return false;

  // 1) Qualquer valor com R$ que não seja o livro (59,90/59/60)
  const reMoney = /R\$\s?([\d][\d.,]*)/gi;
  let m;
  while ((m = reMoney.exec(text)) !== null) {
    const val = parseBRL(m[1]);
    if (val == null) continue;
    if (!VALORES_PERMITIDOS.has(val)) return true;
  }

  // 2) "X mil" perto de contexto financeiro (investimento/valor/custa/reais),
  //    sem pegar prova social tipo "5 mil livros divulgados".
  const reMil = /(?:investiment\w+|valor\w*|custa\w*|fica em|sai por|sai a|or[çc]ament\w+|a partir de|parte de|R\$)[^.!?]{0,25}\b(\d{1,3})\s*mil\b/i;
  if (reMil.test(text)) return true;
  // "cinquenta mil", "sete mil e oitocentos" perto de financeiro
  const reMilExt = /(?:investiment\w+|valor\w*|custa\w*|or[çc]ament\w+)[^.!?]{0,30}\b(?:mil|cem mil|cinquenta mil|sete mil)\b/i;
  if (reMilExt.test(text)) return true;

  return false;
}

// Correções cirúrgicas que mantêm a mensagem (regex → substituição).
const FIXES = [
  // Master/Press LC → Assessoria de Imprensa (a modalidade quem decide é o Closer)
  { re: /\b(Master|Press)\s*LC\b/gi, to: 'Assessoria de Imprensa', tag: 'master_press' },
  // Veículos específicos → genérico (sem quebrar "Café com Deus Pai" etc)
  { re: /\b(Globo|CNN|Folha de S\.?\s?Paulo|Folha|Veja|Record|SBT|Band)\b/g, to: 'grandes veículos', tag: 'veiculo_especifico' },
  // "custo(s)" → "investimento(s)"
  { re: /\bcustos\b/gi, to: 'investimentos', tag: 'palavra_custo' },
  { re: /\bcusto\b/gi, to: 'investimento', tag: 'palavra_custo' },
  // "Dr." / "Dra." antes de nome → remove o pronome
  { re: /\bDr[ª.ao]?\.?\s+(?=[A-ZÀ-Ú])/g, to: '', tag: 'dr_dra' },
  // Encerramentos de bot (não-SDR)
  { re: /\b(fico|estou|estamos)\s+(à|a)\s+disposi[çc][ãa]o\b\.?/gi, to: '', tag: 'encerramento_bot' },
];

// Frases que denunciam comportamento de bot/atendente (flag, não bloqueia).
const FLAG_PHRASES = [
  /qualquer d[úu]vida,?\s*(me avise|estou aqui|é s[óo] chamar)/i,
  /espero ter ajudado/i,
];

function applyFixesToText(text, violations) {
  if (!text) return text;
  let out = text;
  for (const f of FIXES) {
    if (f.re.test(out)) {
      out = out.replace(f.re, f.to);
      violations.push(f.tag);
    }
    f.re.lastIndex = 0;
  }
  // colapsa repetição criada pela substituição ("grandes veículos e grandes veículos")
  out = out.replace(/grandes ve[íi]culos(\s*[,e]+\s*grandes ve[íi]culos)+/gi, 'grandes veículos');
  // normaliza espaços que sobraram de remoções
  return out.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim();
}

// Extrai todos os textos da resposta (reply + split bubbles).
function eachText(result, fn) {
  if (typeof result.reply === 'string' && result.reply) result.reply = fn(result.reply);
  if (Array.isArray(result.split)) {
    result.split = result.split.map(item => {
      if (typeof item === 'string') return fn(item);
      if (item && typeof item === 'object' && item.text) item.text = fn(item.text);
      return item;
    });
  }
}

function allTextOf(result) {
  const parts = [];
  if (result.reply) parts.push(result.reply);
  if (Array.isArray(result.split)) {
    for (const it of result.split) parts.push(typeof it === 'string' ? it : (it?.text || ''));
  }
  return parts.join(' ');
}

// Resposta-cofre quando vaza preço: troca a mensagem inteira por uma versão
// SEM número (o especialista é quem fala valor). Sonda investimento aberto.
function priceVaultMessage(contact) {
  const nome = contact?.name && !/\d/.test(contact.name) ? contact.name : null;
  const ola = nome ? `${nome}, ` : '';
  return [
    `${ola}o investimento é personalizado conforme o projeto, e quem apresenta a proposta completa é nosso especialista.`,
    `Posso te conectar com ele pra detalhar tudo. Você já tem uma ideia de investimento pra esse próximo passo?`,
  ];
}

/**
 * Aplica o guardrail. Retorna { result, violations, blocked }.
 * Muta o result (corrige textos) e, se necessário, substitui a mensagem.
 */
export function applyPolicyGuard(result, contact = {}) {
  if (!ENABLED || !result) return { result, violations: [], blocked: false };

  const violations = [];

  // 1) PREÇO — severidade máxima: bloqueia e troca pela resposta-cofre.
  if (detectPriceLeak(allTextOf(result))) {
    violations.push('price_leak');
    result.reply = '';
    result.split = priceVaultMessage(contact);
    // garante que continua sendo uma SDR coerente
    if (!result.stage) result.stage = 'qualificando';
    logViolations(contact, ['price_leak'], { blocked: true });
    return { result, violations, blocked: true };
  }

  // 2) FIXES cirúrgicos (mantêm a mensagem)
  eachText(result, t => applyFixesToText(t, violations));

  // 3) FLAGS (não alteram, só registram)
  const full = allTextOf(result);
  for (const re of FLAG_PHRASES) {
    if (re.test(full)) violations.push('encerramento_bot_flag');
  }
  // SDR sempre termina com pergunta (exceto confirmação de agendamento / encerramento).
  // Tira emojis e pontuação de fechamento do fim antes de checar o "?".
  const isClosing = result.book_slot || result.end_conversation;
  if (!isClosing && full) {
    const tail = full.trim().replace(/[\s)"'.!]*$/u, '').replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '').trim();
    if (!tail.endsWith('?')) violations.push('sem_pergunta_final');
  }

  if (violations.length) logViolations(contact, violations, { blocked: false });
  return { result, violations: [...new Set(violations)], blocked: false };
}

function logViolations(contact, violations, { blocked }) {
  try {
    if (contact?.id) {
      db.prepare(`INSERT INTO events_log (contact_id, kind, payload) VALUES (?, 'policy_guard', ?)`)
        .run(contact.id, JSON.stringify({ violations: [...new Set(violations)], blocked }));
    }
  } catch { /* não-crítico */ }
  logger.warn({ contactId: contact?.id, violations, blocked }, 'policy guard atuou');
}

// exportado pra testes
export { detectPriceLeak, applyFixesToText };
