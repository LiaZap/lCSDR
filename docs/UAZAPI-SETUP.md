# Integração uazapi (WhatsApp brasileiro não-oficial)

A LC vai usar **uazapi** como canal real de WhatsApp (token foi fornecido pelo Paulo). O **GHL continua** como CRM (contatos, oportunidades, pipeline, calendário) — só não é mais o canal de envio.

## Arquitetura final

```
┌─────────────┐ webhook  ┌──────────────┐  Claude  ┌──────────┐
│ WhatsApp    │ ───────►│  Iara backend │ ──────► │ Lila 🤖  │
│ (uazapi)    │         │ /webhook/uazapi│ ◄────── │          │
│             │ ◄────── │                │         └──────────┘
└─────────────┘ /send/  └───┬──────┬─────┘
                            │      │ tags + custom fields + opportunity
                            │      ▼
                            │     ┌──────────┐
                            │     │   GHL    │ CRM
                            │     │ (apenas) │
                            │     └──────────┘
                            ▼
                     ┌─────────────┐
                     │  Dashboard  │ login SDR
                     └─────────────┘
```

**Decisão de canal**:
- `UAZAPI_TOKEN` definido → uazapi vira canal oficial (WhatsApp ⇄ Lila)
- Vazio → fallback pro GHL `sendMessage`

GHL é usado em paralelo pra:
- Tag automática (`iara-qualificado`, `funil-X`)
- Custom fields (funnel_lc, iara_score, iara_notes)
- Opportunity no pipeline (move pro stage Qualificado)
- Calendar (futuro: agendar reunião com Closer)

## Setup

### 1. .env
```env
UAZAPI_BASE=https://liaautomacoes.uazapi.com
UAZAPI_TOKEN=bbd11044-87b7-4173-a762-760ea6094d94
UAZAPI_WEBHOOK_SECRET=         # opcional, define um valor e configure no painel uazapi
```

### 2. Validar conexão
```bash
docker compose exec agente npm run uaz:status
```

### 3. Mandar mensagem teste
```bash
docker compose exec agente npm run uaz:test text 5511987959188 "Oi, teste da Lila"
```

### 4. Mandar menu de botões
```bash
# 3 botões (button mode)
docker compose exec agente npm run uaz:test menu 5511987959188

# 8 opções (list mode — abre modal de lista no WhatsApp)
docker compose exec agente npm run uaz:test list 5511987959188
```

### 5. Configurar webhook no painel uazapi
URL: `https://seu-dominio/webhook/uazapi`

Eventos: `message` (mensagens recebidas)

Se quiser HMAC, define `UAZAPI_WEBHOOK_SECRET` no `.env` E coloca o mesmo valor no header `X-Webhook-Secret` do painel.

### 6. Em dev local, expor com ngrok
```bash
ngrok http 3333
# cole a URL https://xxx.ngrok-free.app/webhook/uazapi no painel uazapi
```

## Formato dos botões

A Lila gera no JSON de saída:

```json
{
  "split": [
    "Olá! Aqui é a Lila do Grupo LC 😊",
    {
      "text": "Por que entrou em contato hoje?",
      "buttons": [
        { "label": "Sou autor", "value": "autor" },
        { "label": "Represento editora", "value": "editora" }
      ],
      "footerText": "Toque em uma opção"
    }
  ]
}
```

O `messenger.js` traduz pra payload uazapi:
```json
{
  "number": "5511987959188",
  "type": "button",
  "text": "Por que entrou em contato hoje?",
  "choices": ["Sou autor|autor", "Represento editora|editora"],
  "footerText": "Toque em uma opção"
}
```

Quando o lead clica num botão, o webhook recebe:
```json
{
  "type": "message",
  "from": "5511987959188",
  "messageType": "buttonResponse",
  "buttonReply": { "id": "autor", "title": "Sou autor" }
}
```

E o handler converte em `[lead clicou: Sou autor] (valor=autor)` antes de mandar pra Lila — ela vê como mensagem normal.

## Regras dos botões (no system prompt da Lila)

- Até **3 botões** = button mode
- 4-10 opções = list mode (abre modal)
- Lila usa botões em momentos certos:
  - Abertura sem formulário (8 opções de motivo → list)
  - Triagem rápida autor/editora (2 botões)
  - Confirmar próximo passo
- Lila **NÃO** usa botões quando lead se abre emocionalmente

## Fallback GHL

Se `UAZAPI_TOKEN` não estiver setado e a Lila gerar uma resposta com botões, o `messenger` faz fallback pra texto numerado:
```
Por que entrou em contato hoje?

1. Sou autor
2. Represento editora

_Toque em uma opção_
```

## Comandos úteis

```bash
# Listar status da instância uazapi
npm run uaz:status

# Mandar texto
npm run uaz:test text 5511XXXXXXXXX "mensagem"

# Mandar menu de teste
npm run uaz:test menu 5511XXXXXXXXX

# Simular webhook localmente (futuro — TODO)
# npm run uaz:simulate <numero> "texto"
```

## Troubleshooting

| Sintoma | Causa / solução |
|---|---|
| `uazapi 401` | Token errado ou instância desconectada — checar painel uazapi |
| `uazapi 429` | Rate limit — cliente já faz retry com backoff; reduzir volume se persistir |
| Lead clicou botão mas Lila não viu | Webhook não chegou — checar URL pública + logs `events_log` table kind='uazapi_*' |
| Áudio não transcreve | uazapi pode mandar base64 ou URL — handler tenta os dois; checar `OPENAI_API_KEY` |
| Mensagem chegou mas Lila não respondeu | Ver `docker logs lc-sdr-agente` — pode ser `ANTHROPIC_API_KEY` faltando ou `ai_paused=1` no contato |
