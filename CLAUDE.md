# CLAUDE.md — LC SDR (Tina)

Regras para o Claude Code neste repositório. Espelha o [AGENTS.md](AGENTS.md) — se um dos dois mudar,
mude o outro na mesma alteração.

> **A Tina conversa com leads reais no WhatsApp e marca reunião na agenda de gente.** Mensagem
> repetida, reunião duplicada ou lead reabordado depois de fechado custam reputação do cliente.

## O agente se chama Tina

Já se chamou *Lila*. Válidos: `agente/src/agent/tina.js`, `TINA_SYSTEM_PROMPT`, `generateTinaReply`.
`generateLilaReply` e `LILA_SYSTEM_PROMPT` são aliases de transição — não use em código novo.
`docs/source-material/` mantém o nome antigo por ser material histórico.

## Ordem de leitura obrigatória

1. [README.md](README.md)
2. [docs/AGENT-PROMPT.md](docs/AGENT-PROMPT.md)
3. [docs/COMO-ATUALIZAR-LILA.md](docs/COMO-ATUALIZAR-LILA.md)
4. `agente/src/agent/systemPrompt.js` e `tina.js`
5. O arquivo real que vai ser alterado

## Stack

Node.js + Express · OpenAI Responses API (`gpt-4.1-mini`, JSON Schema strict) · React + Vite + nginx ·
**SQLite** (`better-sqlite3`) · uazapi (WhatsApp) · GoHighLevel (CRM) · Docker/EasyPanel.

## Invariantes — nunca quebrar

1. **A memória lê as mensagens MAIS RECENTES**, não as mais antigas.
2. **Lê todas as mensagens do lead antes de responder**; não repergunta o que já foi respondido.
3. **Histórico antigo não define a intenção de hoje.**
4. **Uma pergunta por vez**, bolha completa.
5. **Data e hora em BRT** — o servidor está em UTC.
6. **Não reabordar lead convertido** nem com reunião futura marcada por humano no GHL.
7. **Não reabrir lead com card declinado recente.**
8. **Detecção de humano é por procedência**, não por `userId`.
9. **Ao agendar, o card do Pré-Vendas é fechado** (`won` ou `lost`), nunca deixado aberto.
10. **Não inventar "agenda não aberta" nem entrar em loop de datas**; confirmar só com a hora da lista.
11. **`ctwa_clid` grava em `contact.ctwaclid`** (sem underscore).
12. **Divulgação exige link de vendas** — capa não substitui link.

## Nunca fazer

- Mudar uma frase do prompt sem ler o histórico do arquivo: cada regra veio de um caso real
  validado com a LC (a data no commit é a validação).
- Mexer no agendamento tratando só uma ponta — slot e card do CRM andam juntos.
- Unificar as guardas de reabordagem: convertido, reunião futura, card declinado e atendido por
  humano são quatro casos distintos.
- Calcular data pelo fuso do servidor.
- Usar `generateLilaReply` / `LILA_SYSTEM_PROMPT` em código novo.
- Trocar SQLite por outro banco de passagem — é decisão do projeto, migrar é trabalho próprio.
- Logar telefone, e-mail ou conversa de lead em texto claro.
- Comitar `.env`, `OPENAI_API_KEY`, `UAZAPI_TOKEN` ou `JWT_SECRET`.

## Sempre fazer

- Ao adicionar flag de comportamento, expor no `/health` — é a ferramenta de diagnóstico do
  atendimento.
- Rodar o `test-suite` de `agente/scripts/`.
- Manter a paridade `AGENTS.md` ↔ `CLAUDE.md`.

## Comandos

```bash
docker compose up -d
docker compose exec agente npm run seed:users
docker compose exec agente npm run seed:demo
```

## Checklist de saída

- [ ] Arquivos lidos antes de alterar
- [ ] Invariantes tocados
- [ ] Se mexeu no prompt: qual caso real motivou, e o texto novo colado
- [ ] Se mexeu em agenda: slot **e** card do CRM tratados
- [ ] Saída do `test-suite`
- [ ] Riscos residuais e o que ficou fora do escopo

## Higiene do repositório

A raiz tem dezenas de arquivos-lixo com nomes como `console.log('`, `(m.direction`, `{,+` — resíduo
de comando de shell mal escapado no PowerShell. Poluem `git status` e qualquer glob. Ao rodar
`node -e` com parênteses e aspas, escreva um `.mjs` em `agente/scripts/` em vez de comando inline.
