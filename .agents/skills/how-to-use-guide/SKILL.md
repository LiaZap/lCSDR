---
name: how-to-use-guide
description: >-
  Cria um guia "como usar" em PDF de um recurso do LC SDR (Tina) (agente SDR de WhatsApp do Grupo LC), escrito para quem VAI
  USAR — equipe da LC, closer, suporte interno — com prints reais da aplicação rodando e
  os dados pessoais anonimizados. Use quando o usuário pedir "como usar", "guia da LC", "explica o dashboard de revisão", "documenta esse recurso para a LC",
  "guia do usuário", "manual", "tutorial para o cliente", "passo a passo", "material para mandar no
  WhatsApp", "release notes", ou "das últimas N melhorias faz um como-usar". NÃO use para
  documentação técnica interna (essa é `repo-docs-sync`), para auditoria de dados, nem para
  escrever código.
---

# Guia "Como usar" — LC SDR (Tina)

Produz um PDF de 6 a 10 páginas ensinando alguém a usar um recurso do sistema. O leitor não vai ler
duas vezes: ele quer saber **onde clicar** e **o que vai acontecer**.

> **Nome em inglês, conteúdo em português.** O identificador é `how-to-use-guide` por convenção
> (skill sempre em kebab-case inglês), mas tudo que ela produz é PT-BR. Quem lê é brasileiro.

## 1. Decida a AUDIÊNCIA antes de escrever

| Variante | Leitor | Vocabulário interno | Prints de onde |
| :--- | :--- | :--- | :--- |
| **Equipe da LC** (padrão) | quem revisa conversas e trabalha os leads qualificados | ❌ nunca | dashboard — Overview, Conversations, Leads |
| **Closer** | quem recebe o lead qualificado e fecha | ❌ nunca | Leads e LeadDetail |
| **Suporte interno** | nós | ✅ é a linguagem dele | dashboard + Playground + `/health` |

> [!CAUTION]
> **Variante externa — o que NUNCA entra:** nome de provedor (OpenAI, uazapi, GoHighLevel), nome de tabela ou coluna (`contact.ctwaclid`), rota de API ou do `/health`, variável de ambiente, nome de arquivo de código, **o texto do prompt da Tina** — é ativo do projeto, não material de cliente, conversa de lead real. Se qualquer um desses aparecer no
> rascunho, está errado — isso é documentação interna e mora em `docs/`.
>
> **Regra de ouro:** a LC quer saber **como revisar o que a Tina falou e o que fazer com o lead qualificado**. Ela não precisa saber como o prompt é montado.

> [!IMPORTANT]
> **Se o recurso mexe em dinheiro ou em dado que não volta**, a pergunta mais importante é
> **"o que NÃO acontece"**. Neste sistema:
>
> - **a Tina não reaborda lead já convertido nem lead com reunião futura marcada por um humano** — se ela ficou quieta, provavelmente é isso, e é proposital;
> - **ao agendar, o card do Pré-Vendas é fechado** — por isso ele some daquela coluna;
> - **a Tina faz uma pergunta por vez** e confirma só com a hora escolhida da lista;
> - **data e hora aparecem no horário de Brasília**, mesmo com o servidor em UTC.
>
> Confirme cada uma nos docs do projeto antes de escrever — são invariantes do sistema, não opinião.

## 2. Passo 0 — preparar a marca

A marca é única (Grupo LC) e os ativos vivem em `assets/marca/`:

```bash
node .claude/skills/how-to-use-guide/scripts/preparar-marca.mjs
```

Copia `assets/marca/` para `.tmp_guia/marca/`, que é onde o montador procura. **Leia
`assets/marca/LEIA-ME.md`** — `logo-negativo.svg`, `logo-tinta.svg` e `icone.png` ainda precisam ser
colocados lá na primeira vez. O montador aborta se faltar ativo, de propósito.

> `--marca` é cor de **preenchimento**; para texto, filete e número em papel branco use
> `--marca-texto`. Cor de marca raramente tem contraste suficiente para texto.

## 3. Passo 1 — levantar o que entra no guia

Pergunte ao usuário quais recursos entram. Se ele disser "as últimas N melhorias", leia
`git log --oneline -n 20` + `git status --short` e **proponha a lista antes de escrever**.

Para cada recurso, responda três perguntas na ótica do leitor:
- Que problema isso resolve **para ele**?
- Onde ele clica?
- O que acontece depois — e, se a ação não tem volta, o que **não** acontece?

## 4. Passo 2 — capturar os prints da aplicação REAL

Nunca desenhe mockup nem descreva a tela de memória.

```bash
node .claude/skills/how-to-use-guide/scripts/capturar-prints.mjs \
  .tmp_guia/perfil-chrome .tmp_guia/prints <email> <senha>
```

Sobe o Chrome headless, faz login **de verdade no formulário**, força tema claro e salva PNG em 2x.
Edite o "roteiro dos prints" no fim do arquivo para o fluxo da vez. `.tmp_guia/prints` é o diretório
que `montar-guia.mjs` procura; o nome de cada PNG é o que você cita em `{{PRINT:nome}}`.

**Seletores reais deste projeto** (verificados no código — confira antes de editar o roteiro):

| Tela | Rota | Campos |
| :--- | :--- | :--- |
| Dashboard | `/login` | `#email` e `input[type=password]`, botão `type=submit` |

Pré-requisito: `docker compose up -d` na porta **5173** (rodar em `dashboard`).

> [!CAUTION]
> **A tela de Conversations mostra conversas reais de leads.** Não capture de conta de produção: use
> o `seed:demo` (`docker compose exec agente npm run seed:demo`) para ter dados fictícios e faça o
> guia inteiro com eles. Consulte `docs/LILA-PRIVACIDADE-FAQ.md` antes.

> [!IMPORTANT]
> **O dashboard é Vite na porta 5173**, não Next na 3000 — ajuste `GUIA_BASE_URL`. O login é
> `#email` + `input[type=password]`.
> 
> O **Playground** é ferramenta interna de teste de prompt: não entra em guia de cliente.

> [!WARNING]
> **Não publique o prompt da Tina.** Se o guia precisa explicar o comportamento dela, descreva o que
> ela faz do ponto de vista de quem conversa — não cole o `systemPrompt.js`.

> [!WARNING]
> **Anonimize sempre — e confira PNG a PNG.** O que cada tela expõe:
>
> | Tela | O que expõe |
> | :--- | :--- |
> | `Conversations` | **conversa inteira do lead no WhatsApp** — nome, telefone e conteúdo |
> | `Leads / LeadDetail` | dados de contato e histórico de qualificação |
> | `Overview` | números da operação da LC |
> | `Playground` | teste do prompt — **ferramenta interna**, não entra em guia de cliente |
>
> O script carrega `scripts/anonimizar.js`, que troca nome/documento/e-mail/telefone/endereço por
> valores fictícios. **Ajuste os nomes fictícios e o `operador` em `anonimizar.js`** para a realidade
> deste projeto antes do primeiro guia — o modelo veio com nomes de outra empresa.

> [!CAUTION]
> **Nunca escreva o JS de anonimização dentro de um template literal.** O template literal processa
> escapes: `\s` vira `s` e `\/` vira `/`, então a função lança em silêncio e os prints saem **sem
> anonimização nenhuma**, com aparência correta. Mantenha o código em `anonimizar.js` e carregue com
> `readFileSync` — é assim que o script já faz.

> [!CAUTION]
> **O banco de desenvolvimento pode ser cópia de produção.** O `capturar-prints.mjs` é **read-only**
> de propósito: o helper `clicar()` recusa botão de ação destrutiva ou de gravação (Salvar, Receber,
> Estornar, Cancelar, Excluir, Importar). Se o guia precisa mostrar uma dessas ações, use um banco
> **local** — não afrouxe a guarda.

## 5. Passo 3 — escrever as páginas

Copie o esqueleto e troque o texto — **não** escreva `<html>`/`<head>`/`<style>`, quem traz isso é o
montador:

```bash
cp .claude/skills/how-to-use-guide/assets/exemplo-paginas.html .tmp_guia/paginas.html
```

Cada página é uma `<section class="pagina">`. Ativos entram por placeholder: `{{LOGO_NEGATIVO}}` (só
na capa escura), `{{LOGO_TINTA}}`, `{{ICONE}}` e `{{PRINT:01-nome}}`.

## 6. Passo 4 — montar e gerar o PDF

```bash
node .claude/skills/how-to-use-guide/scripts/montar-guia.mjs \
  .tmp_guia/paginas.html .tmp_guia/guia.html --titulo "<título do guia>"
```

Injeta os tokens da marca, embute logo e prints em base64 (o PDF tem que ser **um arquivo único**),
grava o título nas propriedades do PDF e diz quantas páginas você escreveu. Placeholder sem ativo
**aborta** de propósito — print faltando viraria um retângulo escuro que ninguém nota. Depois:

```bash
"C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --disable-gpu \
  --no-pdf-header-footer --print-to-pdf="$HOME/Downloads/GrupoLC-<Assunto>.pdf" \
  "file://$PWD/.tmp_guia/guia.html"
```

O montador já imprime o comando com o nome certo.

## 7. Passo 5 — verificação obrigatória

1. **Contagem de páginas** bate com o número de `<section class="pagina">`:
   ```bash
   python -c "import re,sys;d=open(sys.argv[1],'rb').read();print(len(re.findall(rb'/Type\s*/Page[^s]',d)))" <pdf>
   ```
   Veio **menos**? Alguma `section` não fechou. **Nunca vem mais** — `.pagina` tem `height:297mm` +
   `overflow:hidden`, então o que estoura é **recortado em silêncio**.
2. **Olhe o resultado — TODAS as páginas.** Renderize e confira; não confie no HTML. A capa é a única
   página sem print — os defeitos moram nas páginas internas.
3. **Varra vazamento — removendo o base64 antes.** Grep direto dá falso positivo (as imagens
   embutidas são megabytes de base64 e contêm qualquer sequência por acaso):
   ```bash
   python -c "
   import re
   h=open('.tmp_guia/guia.html', encoding='utf-8').read()
   h=re.sub(r'data:[a-z/+]+;base64,[A-Za-z0-9+/=]+','IMG',h)
   v=set(re.findall(r'/api/|OpenAI|uazapi|GoHighLevel|ghl|ctwaclid|JWT_SECRET|process\.env|localhost|agente/src',h,re.I))
   print(v or 'nenhum vazamento')"
   ```
4. **Confirme a anonimização print a print.** É o passo que mais falha.
5. **Confirme o título gravado no PDF** — o Chrome grava em duas formas (literal `(...)` quando é
   ASCII puro, hexadecimal UTF-16 quando tem acento), então um `grep` de uma só forma dá falso
   "sem título".

## Referências

### O método — leia antes de escrever o guia

- `references/estrutura-e-tom.md` — estrutura das páginas, tom de voz e frases-modelo
- `references/design-system.md` — tokens, tipografia, geometria da página e por que o papel é branco
- `references/captura-de-prints.md` — captura read-only, login, tema, máscara de valores e anonimização
- `references/marca.md` — as duas armadilhas de branding (logo negativo, contraste)

### Deste projeto

- `README.md` — produto e setup
- `docs/AGENT-PROMPT.md` — o que a Tina faz e por quê — base para explicar o comportamento no guia
- `docs/LILA-PRIVACIDADE-FAQ.md` — privacidade — leia antes de publicar qualquer print de conversa
- `AGENTS.md` — invariantes do projeto
- `assets/marca/LEIA-ME.md` — ativos da marca e o que ainda falta
- `assets/base.css.html` (CSS do documento) · `assets/exemplo-paginas.html` (esqueleto)
- `scripts/` — `preparar-marca.mjs`, `capturar-prints.mjs` + `anonimizar.js`, `montar-guia.mjs`
