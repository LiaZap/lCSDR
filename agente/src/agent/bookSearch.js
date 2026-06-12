// Busca do livro do lead (bônus do treinamento REV.1).
//
// Quando o lead diz que tem livro publicado e dá o TÍTULO (ou título+autor),
// a Tina pesquisa na web (Amazon/Google) e devolve o link pra CONFIRMAR com o
// lead — exatamente como o documento pede:
//   "consultei aqui pelo título e encontrei esse link XXX, confere se é esse?"
//
// Usa Google Programmable Search (Custom Search JSON API), free tier 100/dia.
// É a IA que extrai a query (campo search_book); a busca REAL é feita aqui, e
// a Tina só confirma o resultado. Assim ela NUNCA inventa um link.
//
// Env (todas necessárias pra ligar):
//   BOOK_SEARCH_ENABLED=true
//   BOOK_SEARCH_API_KEY=<Google API key>
//   BOOK_SEARCH_CSE_ID=<Programmable Search Engine ID>
// Sem isso, o recurso fica off e a Tina apenas pede o link ao lead.

import fetch from 'node-fetch';
import { logger } from '../utils/logger.js';

export function bookSearchEnabled() {
  return process.env.BOOK_SEARCH_ENABLED === 'true'
    && !!process.env.BOOK_SEARCH_API_KEY
    && !!process.env.BOOK_SEARCH_CSE_ID;
}

// Domínios de venda/listagem de livro que valem como "link do livro".
const PREFERRED_HOSTS = [
  'amazon.com.br', 'amazon.com', 'amzn.to',
  'lojasaraiva', 'americanas', 'magazineluiza', 'magazinevoce',
  'submarino', 'estantevirtual', 'travessa', 'cultura',
  'lcbookseditora', 'hotmart', 'uiclap', 'clubedeautores',
];

function scoreLink(item) {
  const url = (item.link || '').toLowerCase();
  let score = 0;
  for (let i = 0; i < PREFERRED_HOSTS.length; i++) {
    if (url.includes(PREFERRED_HOSTS[i])) { score += (PREFERRED_HOSTS.length - i) + 10; break; }
  }
  // Amazon com /dp/ costuma ser página de produto (livro), prioriza
  if (/amazon\.[^/]+\/.*\/dp\//.test(url) || /\/dp\//.test(url)) score += 5;
  return score;
}

// Procura o livro pela query (título, idealmente + autor). Retorna
// { title, link } do melhor resultado, ou null.
export async function searchBookLink(query, { timeoutMs = 8000 } = {}) {
  if (!bookSearchEnabled()) return null;
  const q = String(query || '').trim();
  if (!q) return null;

  const params = new URLSearchParams({
    key: process.env.BOOK_SEARCH_API_KEY,
    cx: process.env.BOOK_SEARCH_CSE_ID,
    q: `${q} livro`,
    num: '5',
    hl: 'pt-BR',
    gl: 'br',
  });
  const url = `https://www.googleapis.com/customsearch/v1?${params}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
      logger.warn({ status: res.status }, 'book search retornou erro HTTP');
      return null;
    }
    const json = await res.json();
    const items = json.items || [];
    if (!items.length) return null;

    // ordena pelos domínios preferenciais; mantém ordem original em empate
    const ranked = items
      .map((it, i) => ({ it, s: scoreLink(it), i }))
      .sort((a, b) => (b.s - a.s) || (a.i - b.i));
    const best = ranked[0].it;
    return { title: best.title || q, link: best.link };
  } catch (err) {
    logger.warn({ err: err.message, q }, 'falha na busca do livro');
    return null;
  }
}
