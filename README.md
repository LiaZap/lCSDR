# LC SDR — Lila

Agente SDR humanizado pra Grupo LC (Agência de Comunicação + LC Books Editora). Lila qualifica leads via WhatsApp (uazapi), passa qualificados pro Closer humano, e roda dashboard de revisão pra LC.

**Stack**: Node.js + Express · OpenAI Responses API (gpt-4.1-mini) · React + Vite + nginx · SQLite · uazapi (WhatsApp) · GoHighLevel (CRM) · Docker

## Estrutura

```
agente/         backend Node + Express + OpenAI/Anthropic + SQLite
  src/agent/    Lila: prompt, knowledge base, dispatcher de canal
  src/uazapi/   cliente WhatsApp via uazapi
  src/ghl/      cliente GoHighLevel (CRM, custom fields, opportunities)
  src/routes/   webhook + auth + dashboard API + playground
  scripts/      test-suite, seed, ghl-test, uazapi-test

dashboard/      React + Vite. Em prod: build estática servida por nginx
  src/pages/    Login · Overview · Conversations · Leads · LeadDetail · Playground

docs/           Setup, deploy, prompt da Lila, material-fonte (treinamento)
```

## Setup local (dev)

```bash
git clone https://github.com/LiaZap/lCSDR.git
cd lCSDR

cp agente/.env.example agente/.env
# preencha OPENAI_API_KEY, UAZAPI_TOKEN, JWT_SECRET

docker compose up -d
docker compose exec agente npm run seed:users
docker compose exec agente npm run seed:demo
```

Abra http://localhost:5173 → login `lilian@lcagencia.com.br` / `LCagencia2026`

## Deploy em produção (EasyPanel)

Ver [docs/DEPLOY-EASYPANEL.md](docs/DEPLOY-EASYPANEL.md) — passo a passo completo.

Resumo: 2 serviços (`agente` privado + `dashboard` público com nginx fazendo proxy), volume persistente pro SQLite, env vars pelo painel, SSL automático.

## Comandos úteis

```bash
# Testes da Lila
docker compose exec agente npm run test:suite           # 23 cenários + avaliação
docker compose exec agente npm run test:suite --runs=3  # multi-run

# Integrações
docker compose exec agente npm run uaz:status           # valida uazapi
docker compose exec agente npm run uaz:test text 5511X "msg"
docker compose exec agente npm run ghl:test health
docker compose exec agente npm run ghl:bootstrap

# Seed
docker compose exec agente npm run seed:users
docker compose exec agente npm run seed:demo
```

## Documentação

- [docs/DEPLOY-EASYPANEL.md](docs/DEPLOY-EASYPANEL.md) — deploy passo a passo
- [docs/UAZAPI-SETUP.md](docs/UAZAPI-SETUP.md) — integração WhatsApp
- [docs/GHL-SETUP.md](docs/GHL-SETUP.md) — integração GoHighLevel
- [docs/AGENT-PROMPT.md](docs/AGENT-PROMPT.md) — prompt da Lila explicado
- [docs/FASES.md](docs/FASES.md) — roadmap por fases
- [docs/source-material/](docs/source-material/) — material oficial entregue pelo cliente

## Custo operacional estimado (LC, 50 leads/dia)

- OpenAI gpt-4.1-mini: ~R$10-20/mês
- VPS EasyPanel (2GB): ~R$30-40/mês
- uazapi: depende do plano LC
- **Total infra+IA**: ~R$60-90/mês

## Status atual

- ✅ Lila conversa via OpenAI Responses (JSON Schema strict)
- ✅ Suite de testes 23 cenários, 100% em multi-run
- ✅ Dashboard com login, métricas, conversas, playground
- ✅ Botões interativos via uazapi (testado envio)
- ✅ Feedback humano por conversa (👍/👎/correção)
- ⏳ Webhook real uazapi end-to-end (testar em prod)
- ⏳ Aprovação Lilian/Bruna do tom (próxima fase)
