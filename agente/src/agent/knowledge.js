// Base de conhecimento da Tina, fonte única de verdade sobre Grupo LC.
// Mantenha este arquivo atualizado quando produtos/preços/links mudarem.
// Extraído de: docs/source-material/01-lila-treinamento-completo.md
//              docs/source-material/02-manual-servicos-triagem.md

export const GRUPO_LC = {
  nome: 'Grupo LC',
  fundadora: 'Lilian Cardoso',
  fundacao: 2008,
  numeros: {
    livros_divulgados: '5.000+',
    insercoes_ano: '30.000+',
    jornalistas_base: '60.000+',
    blogs_bookstagrammers: '5.000+',
    autores_impactados: '100.000+',
  },
  empresas: [
    { nome: 'LC Agência de Comunicação', tipo: 'agência', site: 'lcagencia.com.br' },
    { nome: 'LC Books Editora', tipo: 'editora autopublicação', site: 'lcbookseditora.com.br' },
    { nome: 'Lilian Cardoso (cursos/mentorias)', tipo: 'PF', site: 'liliancardoso.com.br' },
  ],
  livro_referencia: {
    titulo: 'O Livro Secreto do Escritor',
    autora: 'Lilian Cardoso',
    selo: 'best-seller (1º não-ficção PublishNews, mais vendidos Veja)',
    link: 'https://vempra.lc/livro',
  },
};

// === Persona ideal (perfil de cliente que vale a pena qualificar) ===
export const PERSONA = {
  idade_min: 30,
  renda_min: 5000,
  proporcao_genero: '1/3 feminino, 2/3 masculino',
  profissoes: [
    'professor', 'psicólogo', 'médico', 'advogado', 'servidor público',
    'escritor', 'profissional liberal', 'palestrante', 'influenciador',
  ],
  valores: ['autonomia', 'impacto positivo', 'autenticidade', 'desenvolvimento pessoal'],
  dores_principais: [
    'não saber publicar sem editora',
    'dificuldade de fazer o leitor comprar',
    'insegurança sobre ter público',
    'medo de produzir livro sem qualidade',
    'estoque parado em casa',
    'dificuldade de criar conteúdo nas redes',
    'gastar tudo na produção sem retorno',
  ],
};

// === Catálogo COMPLETO de serviços (3 fases) ===
// Atenção a "ticket_publico": false → "valor sob orçamento, time comercial passa".
export const SERVICOS = {
  // ============================================================
  // FASE 1: ESCRITA (autor está escrevendo ou quer começar)
  // ============================================================
  curso_escritores_admiraveis: {
    fase: 'escrever',
    nome: 'Curso Escritores Admiráveis',
    descricao: 'Curso mais completo do mercado do livro nacional. Cobre da escrita à divulgação. Acesso vitalício, canal exclusivo de alunos.',
    plataforma: 'Hotmart',
    site: 'https://escritoresadmiraveis.com.br',
    youtube_apresentacao: 'https://www.youtube.com/watch?v=tahhnLdtMhc',
    depoimentos: 'https://escritoresadmiraveis.com.br/depoimentos/',
    ticket_publico: false,    // sob consulta
    quando_recomendar: ['quer aprender a escrever sozinho', 'orçamento menor', 'quer entender o mercado antes de investir mais'],
  },
  curso_escritores_publicados: {
    fase: 'escrever',
    nome: 'Curso Escritores Publicados',
    descricao: 'Programa online de 10h focado em estrutura e formas de publicação. Inclui Jornada Escreva Junto (30 dias com Lilian).',
    site: 'https://liliancardoso.com.br/curso-escritores-publicados',
    duracao: '10 horas (vitalício) + 30 dias de jornada',
    ticket_publico: false,
    quando_recomendar: ['quer publicar e quer aprender o caminho', 'precisa de acompanhamento de 30 dias'],
  },
  mentoria_arquitetos: {
    fase: 'escrever',
    nome: 'Mentoria Arquitetos do Livro',
    descricao: 'Mentoria em grupo: do desenvolvimento da ideia à finalização da obra. Novas turmas periodicamente.',
    site: 'https://liliancardoso.com.br/arquitetosdolivro/',
    formato: 'em grupo',
    ticket_publico: false,
    quando_recomendar: ['precisa de apoio de editor', 'tem ideia mas não sabe estruturar', 'quer escrever em comunidade'],
  },
  mentoria_dna_bestseller: {
    fase: 'escrever',
    nome: 'Mentoria DNA Best-Seller',
    descricao: 'Mentoria avançada para criar livro com potencial real de vendas e reconhecimento. Foco em posicionamento, proposta de valor e estratégia.',
    site: 'https://liliancardoso.com.br/mentoria/',
    ticket_publico: false,
    quando_recomendar: ['já sabe escrever', 'quer best-seller', 'autoridade de mercado'],
  },
  mentoria_individual: {
    fase: 'escrever',
    nome: 'Mentoria de Escrita Individual',
    descricao: 'Acompanhamento individual com Lilian. Vagas limitadas, sempre consultar disponibilidade.',
    ticket_publico: false,
    obs: 'consultar vagas com a equipe; orçamento individual',
  },
  ghost_writer: {
    fase: 'escrever',
    nome: 'Ghost Writer / Leitura Crítica',
    descricao: 'Escrita por terceiro ou análise crítica do manuscrito.',
    obs: 'consultar disponibilidade; orçamento personalizado',
    ticket_publico: false,
  },

  // ============================================================
  // FASE 2: PUBLICAÇÃO (livro pronto, quer publicar com qualidade)
  // ============================================================
  lc_books_editora: {
    fase: 'publicar',
    nome: 'LC Books Editora',
    descricao: 'Editora de autopublicação do Grupo LC. Produção completa: capa profissional, diagramação, revisão, cadastro Amazon (KDP), tiragem mínima 750 exemplares, distribuição em livrarias.',
    site: 'https://lcbookseditora.com.br',
    loja: 'https://lcbookseditora.com.br/loja',
    contato: 'contato@lcbookseditora.com.br',
    contar_caracteres: 'https://lceditorial.com.br/contar-caracteres',
    requisitos: 'autor investe na produção; recebe royalties da obra distribuída e 100% das vendas próprias',
    ticket_publico: false,
    quando_recomendar: [
      'autor escreveu o livro mas ainda não produziu',
      'quer autopublicação com qualidade premium',
      'quer distribuir em livrarias',
      'quer investir 100% na publicação',
    ],
    nao_indicar_se: 'autor ainda não terminou de escrever',
  },
  leitura_critica: {
    fase: 'publicar',  // ou pré-publicação
    nome: 'Leitura Crítica',
    descricao: 'Análise editorial do manuscrito por especialista LC. Aponta melhorias e qualidades. Inclui livro comentado, relatório, bônus de assessoria de publicação e videochamada de debate.',
    site: 'https://lcagencia.com.br/leitura-critica/',
    analise: ['escrita e linguagem', 'público-alvo', 'sinopse', 'estrutura/encadeamento', 'personagens/cenários', 'temas delicados', 'capa/ilustrações', 'parecer de marketing'],
    ticket_publico: false,
    quando_recomendar: ['finalizando manuscrito e quer feedback', 'já publicou e quer entender melhorias pro próximo', 'não sabe se livro tá pronto'],
  },

  // ============================================================
  // FASE 3: DIVULGAÇÃO (livro publicado, quer mídia/vendas)
  // ============================================================
  master_lc: {
    fase: 'divulgar',
    nome: 'Master LC Assessoria de Imprensa',
    descricao: 'Serviço mais completo. Cobertura na grande mídia (Globo, CNN, Folha, Veja, podcasts, rádios). Releases, pautas, follow-up com veículos, intermédio de entrevistas, branded content, clipping mensal.',
    site: 'https://lcagencia.com.br/assessoria-de-imprensa/',
    duracao_minima: '3 meses',
    requisitos: 'livro PUBLICADO ou previsão de lançamento com link de venda',
    ticket_publico: false,
    quando_recomendar: ['quer cobertura na grande mídia', 'autor com livro lançado/em pré-venda', 'editoras divulgando lançamentos'],
  },
  press_lc: {
    fase: 'divulgar',
    nome: 'Press LC Assessoria de Imprensa',
    descricao: 'Versão mais acessível. 6 semanas de divulgação focada em blogs literários, bookstagrammers, podcasts, jornais, portais e rádios. Equipe lê o livro, cria release, executa campanhas e entrega clipagem final.',
    site: 'https://presslc.com',
    duracao: '6 semanas',
    diferenca_master: 'Master LC = 3 meses+, mais horas de trabalho, follow-up ativo. Press LC = 6 semanas, campanhas mais diretas.',
    ticket_publico: false,
    quando_recomendar: ['quer começar com visibilidade no universo literário online', 'orçamento menor que Master LC'],
  },
  leitura_coletiva: {
    fase: 'divulgar',
    nome: 'Leitura Coletiva',
    descricao: 'Clube de leitura LC com 20-30 influenciadores literários selecionados (bookstagrammers, booktokers, blogueiros). Eles leem, debatem (com autor), resenham e avaliam na Amazon.',
    site: 'https://lcagencia.com.br/leitura-coletiva/',
    duracao: '3 meses',
    importante: 'Influenciadores têm liberdade total de notas, LC NÃO garante nota mínima (transparência desde o início)',
    ticket_publico: false,
    quando_recomendar: ['quer resenhas e avaliações Amazon', 'quer aparecer em bookstagram/booktok', 'networking com influenciadores literários'],
  },
  consultoria_marketing: {
    fase: 'divulgar',
    nome: 'Consultoria com Plano de Marketing',
    descricao: '2 encontros online com especialista. 1º: ouvir autor e entender objetivos. 2º: entrega do plano completo + templates Canva + orientação de redes + dicas de anúncios pagos.',
    site: 'https://lcagencia.com.br/consultoria-de-marketing/',
    formato: '2 encontros + plano + templates Canva',
    ticket_publico: false,
    quando_recomendar: ['livro publicado', 'quer divulgar nas redes mas não sabe por onde'],
    nao_indicar_se: 'livro ainda não publicado OU autor não quer/não sabe mexer em redes',
  },
  consultoria_marketing_criativos: {
    fase: 'divulgar',
    nome: 'Consultoria de Marketing + Criativos LC',
    descricao: 'Versão completa: além do plano estratégico, designers da LC produzem 10 imagens + 10 legendas com copywriting + post de apresentação + banners FB + link encurtado + calendário de datas + acesso ao curso Escritores Influentes.',
    site: 'https://lcagencia.com.br/consultoria-de-marketing-criativos/',
    diferenca_basica: 'Aqui o autor recebe os posts PRONTOS feitos por designers LC, não só templates',
    ticket_publico: false,
    quando_recomendar: ['quer estratégia + posts prontos', 'não tem tempo de criar conteúdo'],
  },
  assessoria_editoras: {
    fase: 'divulgar',  // ou meta-fase pra editoras
    nome: 'Assessoria e Consultoria para Editoras',
    descricao: '3 especialistas LC: Marcos Torrigo (linha editorial/catálogo), Rackel Accetti (comercial/distribuição), Lilian Cardoso (marketing/redes). Resolve linha editorial, distribuição em livrarias, gestão de equipe, marketing.',
    site: 'https://lcagencia.com.br/assessoria-consultoria-para-editoras/',
    publico: 'EDITORAS (não autores individuais)',
    ticket_publico: false,
    quando_recomendar: ['já tem ou está abrindo editora'],
    nao_indicar_se: 'cliente é autor individual',
  },
  desenvolvimento_sites: {
    fase: 'divulgar',
    nome: 'Desenvolvimento de Sites',
    descricao: 'Sites profissionais para autores e editoras. Briefing, configuração de domínio/hospedagem, desenvolvimento, testes, entrega.',
    site: 'https://lcagencia.com.br/desenvolvimento-de-sites/',
    ticket_publico: false,
    quando_recomendar: ['autor/editora sem site ou querendo renovar', 'COMPLEMENTAR a outro serviço principal'],
  },
};

// === Pricing público (o que a Tina PODE mencionar) ===
// Tudo o resto é "sob orçamento" e a Tina passa pro humano.
export const PRECOS_PUBLICOS = {
  livro_secreto: { valor: 'R$ 59,90', produto: 'O Livro Secreto do Escritor' },
};

// === Triagem por árvore de decisão ===
// Esta é a sequência exata que a Tina usa pra identificar serviço certo.
export const TRIAGEM = `
PERGUNTA 1: Você é AUTOR (escritor) ou representa uma EDITORA?
  → EDITORA: encaminhar pra closer (Assessoria e Consultoria para Editoras)
  → AUTOR: ir pra pergunta 2

PERGUNTA 2 (autor): Seu livro JÁ ESTÁ PUBLICADO ou ainda é manuscrito?
  → MANUSCRITO:
      • Quer melhorar o texto antes de publicar? → Leitura Crítica
      • Quer aprender a escrever e publicar?     → Mentoria Arquitetos OU Cursos
      • Quer produzir o livro (capa/diagramação/revisão)? → LC Books Editora
  → PUBLICADO: ir pra pergunta 3

PERGUNTA 3 (publicado): Busca DIVULGAÇÃO NA MÍDIA ou ESTRATÉGIA DE REDES SOCIAIS?
  → MÍDIA:
      • Cobertura na grande mídia (Globo/CNN/Folha)? → Master LC
      • Foco blogs/influenciadores literários?       → Press LC
      • Resenhas + avaliações Amazon?                → Leitura Coletiva
  → REDES SOCIAIS:
      • Estratégia + criar conteúdo com templates? → Consultoria com Plano de Marketing
      • Estratégia + posts/imagens PRONTOS?         → Consultoria + Criativos LC

PERGUNTA 4 (complementar): Tem SITE pro livro/obra?
  → NÃO: oferecer Desenvolvimento de Sites como complemento
`.trim();

// === Avisos importantes (regras duras que a Tina respeita sempre) ===
export const REGRAS_DURAS = [
  '⚠ A LC NÃO faz agenciamento literário. Quem busca isso vai pro Curso Escritores Admiráveis (que ensina a enviar proposta pra editora).',
  '⚠ Master LC e Press LC exigem livro PUBLICADO ou em pré-venda com link.',
  '⚠ Leitura Coletiva: influenciadores têm liberdade total de notas; LC NÃO garante nota mínima.',
  '⚠ Capa amadora: explicar que imprensa avalia capa, sugerir refinamento antes da assessoria.',
  '⚠ Livro fora de plataforma de venda: orientar cadastro Amazon antes de assessoria.',
  '⚠ Consultoria de Marketing: NÃO indicar se autor não publicou ou não quer/sabe mexer em redes.',
  '⚠ Assessoria pra Editoras: SOMENTE pra quem tem ou está abrindo editora; autor individual vai pra outras.',
];

// === Links úteis que a Tina pode mandar ===
export const LINKS = {
  // Sites
  agencia: 'https://lcagencia.com.br',
  editora: 'https://lcbookseditora.com.br',
  lilian: 'https://liliancardoso.com.br',
  press_lc: 'https://presslc.com',
  // Material gratuito / ofertas de entrada (Documentação Estratégica Tina, mai/2026)
  livro_secreto: 'https://olivrosecretodoescritor.com.br/',
  instagram_lilian: 'https://www.instagram.com/liliancardoso/',
  youtube_lilian: 'https://www.youtube.com/@liliancardoso',
  blog_lilian: 'https://liliancardoso.com.br/blog/',
  telegram: 'https://liliancardoso.com.br/telegram',
  // Ferramentas
  contar_caracteres: 'https://lceditorial.com.br/contar-caracteres',
  // Cursos
  curso_admiraveis: 'https://escritoresadmiraveis.com.br/',
  depoimentos_admiraveis: 'https://escritoresadmiraveis.com.br/depoimentos/',
  // Mentorias
  arquitetos_livro: 'https://liliancardoso.com.br/arquitetosdolivro/',
  dna_bestseller: 'https://liliancardoso.com.br/mentoria/',
  // Serviços
  leitura_critica: 'https://lcagencia.com.br/leitura-critica/',
  // Vídeo curso
  youtube_curso: 'https://www.youtube.com/watch?v=tahhnLdtMhc',
  // E-mails
  contato: 'contato@lcagencia.com.br',
  comercial: 'comercial@lcagencia.com.br',
  editora_email: 'contato@lcbookseditora.com.br',
};

// === Mapeamento legado dos 3 funis pro frontend ===
// Mantém compatibilidade com filtros do dashboard (escrever/publicar/divulgar).
export const FUNIS = {
  escrever: ['curso_escritores_admiraveis', 'curso_escritores_publicados', 'mentoria_arquitetos', 'mentoria_dna_bestseller', 'mentoria_individual', 'ghost_writer'],
  publicar: ['lc_books_editora', 'leitura_critica'],
  divulgar: ['master_lc', 'press_lc', 'leitura_coletiva', 'consultoria_marketing', 'consultoria_marketing_criativos', 'assessoria_editoras', 'desenvolvimento_sites'],
};
