# AGENTS.md — LC SDR (Tina)

Instruções obrigatórias para qualquer agente de IA (Codex, Antigravity, Cursor, Copilot) neste
repositório. Claude Code lê o [CLAUDE.md](CLAUDE.md), que espelha este arquivo.

> **A Tina conversa com leads reais no WhatsApp e marca reunião na agenda de gente.** Mensagem
> repetida, reunião duplicada ou lead reabordado depois de fechado custam reputação do cliente —
> não são bugs cosméticos.

## 1. O agente se chama **Tina**

Já se chamou *Lila*. O código foi renomeado: `src/agent/tina.js`, `TINA_SYSTEM_PROMPT`,
`generateTinaReply`. Os aliases `generateLilaReply` e `LILA_SYSTEM_PROMPT` existem **só por
compatibilidade da transição** — não use em código novo, e não reintroduza o nome antigo. Os
arquivos em `docs/source-material/` mantêm "Lila" por serem material histórico de treinamento.

## 2. Ordem de leitura obrigatória

1. [README.md](README.md) — produto, stack, setup
2. [docs/AGENT-PROMPT.md](docs/AGENT-PROMPT.md) — o prompt da Tina explicado
3. [docs/COMO-ATUALIZAR-LILA.md](docs/COMO-ATUALIZAR-LILA.md) — como mexer no comportamento sem quebrar
4. `agente/src/agent/systemPrompt.js` e `tina.js` — o comportamento real
5. [docs/GHL-SETUP.md](docs/GHL-SETUP.md) e [docs/UAZAPI-SETUP.md](docs/UAZAPI-SETUP.md) — integrações
6. O arquivo real que você vai alterar

Para incidente: [docs/ROLLBACK.md](docs/ROLLBACK.md).

## 3. Invariantes — nunca quebrar

| # | Invariante | Por quê |
| :-- | :--- | :--- |
| 1 | **A memória lê as mensagens MAIS RECENTES**, não as mais antigas | ler as 30 mais antigas foi a causa raiz das mensagens repetidas (commit `4901924`) |
| 2 | **Lê todas as mensagens do lead antes de responder** e não repergunta o que já foi respondido | e-mail e horário costumam vir juntos numa bolha só (commit `370540b`) |
| 3 | **Histórico antigo não define a intenção de hoje** | commit `1330e1d` |
| 4 | **Uma pergunta por vez**, e a bolha sai completa | commits `0a2dd96`, `85fee43` |
| 5 | **Data e hora em BRT**, não no fuso do servidor (UTC) | o rótulo "hoje/amanhã" saía errado (commit `4c5aabd`) |
| 6 | **Não reabordar lead já convertido** (venda ganha em outro pipeline) nem com **reunião futura** marcada por humano no GHL | commits `b39f320`, `3f2c04b`, `0a2dd96` |
| 7 | **Não reabrir lead com card declinado recente** | commit `6dad366` |
| 8 | **Detecção de humano é por PROCEDÊNCIA**, não por `userId` | commit `138ee92` |
| 9 | **Ao agendar, o card do Pré-Vendas é fechado** — `won` ou `lost` conforme o caso, nunca deixado aberto | duplicava em Aguardando/Reentrada (commits `6b99b80`, `d80de55`) |
| 10 | **A Tina não inventa "agenda não aberta" nem fica em loop de datas**; confirma só com a hora vinda da lista | commits `e20a955`, `b4900ac` |
| 11 | **`ctwa_clid` grava em `contact.ctwaclid`** (sem underscore) | commit `9c5a21b` |
| 12 | **Divulgação exige link de vendas**; capa não substitui link | commits `6dad366`, `b4900ac` |
| 13 | **Anúncio de leitura coletiva é divulgação, não LC Books** | commit `1330e1d` |

## 4. Regras por domínio

### O prompt da Tina
`agente/src/agent/systemPrompt.js` é o comportamento. Quase todo commit deste repo é ajuste fino de
prompt validado com a LC — **leia o histórico do arquivo antes de mudar uma frase**. Cada regra ali
veio de um caso real, e a data no commit (`LC 13/07`, `LC 16/07`) é a validação com o cliente.

O material-fonte do treinamento está em `docs/source-material/` — é a origem da knowledge base, não
um rascunho.

### Agenda e GHL
Agendar toca **duas pontas**: a agenda (slot, fuso BRT) e o CRM (card do pipeline). Mexer numa sem a
outra é o erro clássico daqui — foi o que gerou card duplicado em Aguardando/Reentrada.

### Guardas de reabordagem
Existem várias, e cada uma cobre um caso distinto: convertido, reunião futura, card declinado
recente, atendido por humano. Não unifique sem entender os quatro — elas não são redundantes.

### Health check
`/health` expõe de propósito `requiredTag`, `attendExceptReentrada`, `ownsEntryLane`, `blockTags`,
`preAtendimento`, `slotMinutes`, `lookaheadDays` e a quantidade de calendários. É a ferramenta de
diagnóstico do atendimento — ao adicionar uma flag de comportamento, exponha ali também.

### Banco
**SQLite** (`better-sqlite3`). Diverge do padrão da base (PostgreSQL) — é decisão deste projeto, com
histórico. Não "corrija" no meio de outra tarefa; migrar é projeto próprio.

### Segurança
- Nunca logue telefone, e-mail ou conteúdo de conversa de lead em texto claro.
- Nunca comite `.env`, `OPENAI_API_KEY`, `UAZAPI_TOKEN` ou `JWT_SECRET`.
- Privacidade: [docs/LILA-PRIVACIDADE-FAQ.md](docs/LILA-PRIVACIDADE-FAQ.md).

## 5. Comandos

```bash
docker compose up -d
docker compose exec agente npm run seed:users
docker compose exec agente npm run seed:demo
# testes e utilitarios em agente/scripts/: test-suite, ghl-test, uazapi-test
```

## 6. Checklist de saída

- [ ] Quais arquivos foram lidos antes de alterar
- [ ] Quais invariantes da seção 3 a mudança toca
- [ ] Se mexeu no prompt: **qual caso real motivou** e o que a Tina passa a dizer, colado
- [ ] Se mexeu em agenda: as duas pontas (slot e card do CRM) foram tratadas?
- [ ] Saída do `test-suite`
- [ ] Riscos residuais e o que ficou fora do escopo
