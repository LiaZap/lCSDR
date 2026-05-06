// Mapeamento dos 3 funis do Grupo LC.
// Fonte: docs/source-material/01-lila-treinamento-completo.md
//        agente/src/agent/knowledge.js (catálogo completo de serviços)
//
// Este arquivo é a "view de funis" pro frontend e pra detecção de intenção rápida.
// Para detalhes de produtos use knowledge.js.

import { SERVICOS, FUNIS as FUNIS_MAP } from '../agent/knowledge.js';

export const FUNNELS = {
  escrever: {
    id: 'escrever',
    label: 'Escrever',
    emoji: '📝',
    descricao: 'Autor escrevendo ou querendo começar — precisa de curso, mentoria ou ghost writer',
    servicos_chaves: FUNIS_MAP.escrever,
    perguntas_qualificacao: [
      'Qual o gênero literário?',
      'Qual a ideia/tema do livro?',
      'Está pronto? Se sim, quantas páginas? Se não, quando ficará pronto?',
      'Está com alguma dificuldade pra escrever?',
      'Está procurando editora? (LC NÃO faz agenciamento — explicar)',
    ],
  },
  publicar: {
    id: 'publicar',
    label: 'Publicar',
    emoji: '📖',
    descricao: 'Manuscrito pronto — quer publicar com qualidade (LC Books) ou avaliar antes (Leitura Crítica)',
    servicos_chaves: FUNIS_MAP.publicar,
    perguntas_qualificacao: [
      'Já conhece o trabalho da LC Books?',
      'Qual o tema? Número de páginas? Caracteres com espaço?',
      'Quer publicação completa (capa/diagramação/revisão/Amazon) ou só análise crítica?',
    ],
  },
  divulgar: {
    id: 'divulgar',
    label: 'Divulgar',
    emoji: '📣',
    descricao: 'Livro publicado — quer mídia (imprensa) ou redes sociais (estratégia/conteúdo)',
    servicos_chaves: FUNIS_MAP.divulgar,
    perguntas_qualificacao: [
      'Nome do livro? Tem link de venda? Onde está disponível?',
      'Quantos exemplares em casa?',
      'Tem site? Redes sociais? Como é a divulgação atual?',
      'Quantos livros já vendeu?',
      'Busca grande mídia (TV/portais), influenciadores, ou estratégia de redes?',
    ],
  },
};

// Detecção heurística de funil pelo texto inicial.
// Não é 100% — a Lila refina via árvore de triagem na conversa.
export function detectFunnel(text = '') {
  const t = text.toLowerCase();
  if (/(divulg|imprensa|lanç|press|resenha|review|amazon|avali|mídia|midia|redes sociais|instagram|tiktok)/.test(t)) return 'divulgar';
  if (/(public|editora|impress|diagramaç|capa|revis|isbn|leitura crítica|leitura critica|manuscrit)/.test(t)) return 'publicar';
  if (/(escrever|ideia|come[cç]ar|curso|mentoria|como fazer|ghost writer|escritor)/.test(t)) return 'escrever';
  return null;
}

// Retorna detalhes completos do serviço por chave
export function getServico(key) {
  return SERVICOS[key] || null;
}
