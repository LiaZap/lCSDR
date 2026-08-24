# Regras do workspace — LC SDR (Tina)

Regras para o agente do Antigravity / Codex neste repositório. **A fonte completa é o
[AGENTS.md](../../AGENTS.md) e o [CLAUDE.md](../../CLAUDE.md) na raiz** — este arquivo é o resumo
operacional, não um segundo conjunto de regras. Se divergirem, vale a raiz.

## Contexto

Agente SDR humanizado do Grupo LC (Agência de Comunicação + LC Books Editora). A **Tina** qualifica leads pelo WhatsApp, agenda reunião e passa o qualificado para o Closer humano; a LC revisa tudo por um dashboard.

> **O agente se chama Tina.** Já se chamou *Lila*; `tina.js`, `TINA_SYSTEM_PROMPT` e `generateTinaReply` são os nomes válidos. Os aliases `LILA_*` existem só por compatibilidade da transição.

Node.js + Express · OpenAI Responses API (`gpt-4.1-mini`, JSON Schema strict) · React + Vite + nginx · **SQLite** (`better-sqlite3`) · uazapi (WhatsApp) · GoHighLevel (CRM) · Docker/EasyPanel.

## Ordem de leitura

1. `README.md` — produto, stack, setup
2. `docs/AGENT-PROMPT.md` — o prompt da Tina explicado
3. `docs/COMO-ATUALIZAR-LILA.md` — como mexer no comportamento sem quebrar
4. `agente/src/agent/systemPrompt.js` e `tina.js` — o comportamento real
5. `docs/GHL-SETUP.md` e `docs/UAZAPI-SETUP.md` — integrações
6. O arquivo real que você vai alterar

## Invariantes

1. **A memória lê as mensagens MAIS RECENTES**, não as mais antigas — ler as 30 mais antigas foi a causa raiz das mensagens repetidas
2. **Lê todas as mensagens do lead antes de responder** e não repergunta o que já foi respondido (e-mail e horário costumam vir na mesma bolha)
3. **Histórico antigo não define a intenção de hoje**
4. **Uma pergunta por vez**, e a bolha sai completa
5. **Data e hora em BRT**, nunca no fuso do servidor (UTC)
6. **Não reabordar lead já convertido** (venda ganha em outro pipeline) nem lead com **reunião futura** marcada por humano no GHL
7. **Não reabrir lead com card declinado recente**
8. **Detecção de humano é por PROCEDÊNCIA**, não por `userId`
9. **Ao agendar, o card do Pré-Vendas é fechado** (`won` ou `lost` conforme o caso), nunca deixado aberto
10. **A Tina não inventa "agenda não aberta" nem entra em loop de datas**; confirma só com a hora vinda da lista
11. **`ctwa_clid` grava em `contact.ctwaclid`** (sem underscore)
12. **Divulgação exige link de vendas** — capa não substitui link

## Proibido

- Mudar frase do prompt sem ler o histórico do arquivo — cada regra veio de um caso real validado com a LC
- Tratar só uma ponta do agendamento: slot e card do CRM andam juntos
- Unificar as guardas de reabordagem (convertido, reunião futura, card declinado, atendido por humano são quatro casos distintos)
- Calcular data no fuso do servidor
- Usar `generateLilaReply` ou `LILA_SYSTEM_PROMPT` em código novo
- Trocar o SQLite de passagem
- Logar telefone, e-mail ou conversa de lead em texto claro
- Comitar `.env`, `OPENAI_API_KEY`, `UAZAPI_TOKEN` ou `JWT_SECRET`

## Comandos

`docker compose up -d` · `docker compose exec agente npm run seed:users` · `docker compose exec agente npm run seed:demo` · `node agente/scripts/test-suite.js`

## Atenção

Quase todo commit deste repo é **ajuste fino de prompt validado com o cliente** — a data no título (`LC 13/07`, `LC 16/07`) é a validação. Antes de mudar uma frase, leia o histórico daquele arquivo: o que parece redundante costuma ser a correção de um caso real que já aconteceu com um lead.
