# Integração GoHighLevel (GHL) — passo a passo completo

Fluxo em uma linha: **WhatsApp → GHL → webhook `/webhook/ghl` → Iara (Claude) → GHL `sendMessage` → WhatsApp**.
Quando SDR humano responde pelo GHL, a IA detecta via `OutboundMessage.userId` e pausa automaticamente.

## 1. Gerar Private Integration Token (PIT)

GHL sub-account → **Settings → Private Integrations → Create new token**

Escopos necessários (marcar todos):

```
contacts.readonly           contacts.write
conversations.readonly      conversations.write
conversations/message.readonly   conversations/message.write
calendars.readonly          calendars/events.write
opportunities.readonly      opportunities.write
locations.readonly          locations/customFields.readonly
users.readonly
```

Copiar token (`pit-xxxxxxxxxxx`) e preencher `.env`:

```env
GHL_API_TOKEN=pit-xxxxxxxxxxxxxxxxxxxx
GHL_LOCATION_ID=<id da sub-account LC>
```

Pra achar o `GHL_LOCATION_ID`: abrir GHL no navegador, a URL tem `/location/<ID>/...`.

## 2. Testar que o token funciona

```bash
cd agente
npm run ghl:test health
# ✓ Token presente: pit-abc12…
# ✓ Location: xxxx
# ✓ API v2 respondeu. Usuários na location: 7
```

Outros comandos úteis:
```bash
npm run ghl:test contact <id>        # vê dados de um contato
npm run ghl:test send <id> "oi"      # envia WhatsApp de teste
npm run ghl:test customfields        # lista custom fields
npm run ghl:test pipelines           # lista pipelines + stages
npm run ghl:test users               # lista usuários (pra linkar com SDRs)
```

## 3. Configurar custom fields

Criar em **Settings → Custom Fields → Contact**:

| Nome | fieldKey esperada | Tipo | Uso |
|---|---|---|---|
| Funil LC | `funnel_lc` | Single-line text (ou Dropdown escrever/publicar/divulgar) | Preenchido pela Iara |
| Score Iara | `iara_score` | Number | Qualificação 0-100 |
| Notas Iara | `iara_notes` | Multi-line text | Contexto pro SDR |

Não precisa criar tags — a Iara cria automaticamente (`iara-qualificado`, `iara-desqualificado`, `funil-X`).

## 4. Configurar pipeline de oportunidades

**Opportunities → Settings → Pipelines** → criar pipeline (ex: "LC Autor") com stages:

1. Novo
2. Pré-qualificando
3. **Qualificado** ← a Iara move pra cá automaticamente
4. Em atendimento (handoff humano)
5. Agendado
6. Fechado (ganho / perdido)

Depois roda:
```bash
npm run ghl:bootstrap
```

O script lista os IDs e sugere o que colocar no `.env`:
```env
GHL_PIPELINE_ID=abc123
GHL_PIPELINE_STAGE_QUALIFIED=stage_xyz
```

O mesmo script tenta linkar automaticamente os SDRs locais (tabela `sdr_users`) com os usuários do GHL pelo e-mail.

## 5. Configurar webhook

**Settings → Webhooks → Add Webhook**

- **URL**: `https://seu-dominio/webhook/ghl`
  - Em dev: rode `ngrok http 3333` e cole a URL `https://xxx.ngrok-free.app/webhook/ghl`
- **Eventos** (mínimo):
  - `InboundMessage` — obrigatório
  - `OutboundMessage` — obrigatório (detecta quando SDR assume)
- **Opcional**:
  - `ContactCreate` — útil pra pré-criar contato no banco local
  - `AppointmentCreate` — sincroniza agendamentos manuais feitos pelo SDR

### Validação HMAC (recomendado)

Se o GHL oferecer campo "Secret" no webhook, gere uma string aleatória e cole nos dois lugares:
- Campo "Secret" no GHL
- `.env` → `GHL_WEBHOOK_SECRET=mesma-string`

Sem secret, a Iara aceita webhooks sem validar (modo dev).

## 6. Simular um webhook localmente (sem WhatsApp real)

Com o server rodando (`npm run dev`):

```bash
# em outro terminal
npm run ghl:simulate <ghl_contact_id> "Oi, quero publicar um livro"
```

Isso chama o webhook local com payload simulado de `InboundMessage`. Olha o log do server — a Iara vai:
1. Buscar contato no GHL (pega nome, phone)
2. Rodar Claude pra gerar resposta
3. Enviar via `GHL.sendMessage`
4. Atualizar estado no SQLite

Se quiser testar qualificação completa end-to-end:
```bash
npm run ghl:test qualify <ghl_contact_id>
# → adiciona tag, escreve custom fields, cria oportunidade no pipeline
```

## 7. Mapeamento de canais

GHL suporta vários canais — a Iara detecta o `messageType` do webhook e responde no mesmo canal:

| Canal do webhook | Canal de resposta |
|---|---|
| WhatsApp | WhatsApp (padrão LC) |
| SMS | SMS |
| Email | Email |
| FB (Messenger) | FB |
| IG (Instagram DM) | IG |

Pra forçar tudo pra WhatsApp, editar `mapMessageType` em `src/routes/webhook.js`.

## 8. Como a IA pausa/retoma

| Evento | Ação |
|---|---|
| Lead manda msg | IA responde (se não pausada) |
| **SDR responde direto no GHL** | Webhook `OutboundMessage` com `userId` → IA pausa |
| SDR clica "Assumir" no dashboard | IA pausa |
| SDR clica "Devolver pra IA" | IA retoma |
| Lead fica X min em silêncio (padrão 60) | IA retoma com follow-up |
| IA atinge limite diário (40 msgs/contato) | IA pausa e chama SDR |

Pra forçar silêncio permanente num contato: adicione tag `iara-off` (filtro a implementar — TODO).

## 9. Attachments (áudio, imagem, PDF)

GHL envia URLs de arquivos que exigem o mesmo Bearer token pra baixar. O cliente (`src/ghl/client.js` → `downloadAttachment`) já faz isso.

Regras da Iara:
- **Áudio** (ogg/opus/mp3/m4a) → baixa com auth, transcreve via Whisper, trata como texto
- **PDF / doc / docx** → BLOQUEIA (responde que leitura crítica é etapa da equipe)
- **Imagem** → registra mas não analisa (fora do escopo)

## 10. Rate limit e retry

`src/ghl/client.js` já tem:
- Retry com backoff exponencial pra 429 (respeita `Retry-After`)
- Retry pra 5xx transientes
- Timing-safe HMAC pra webhook

Se começar a ver muitos 429: aumente `FOLLOWUP_SILENCE_MINUTES` ou reduza `MAX_MESSAGES_PER_CONVERSATION_PER_DAY`.

## 11. Troubleshooting

| Sintoma | Causa / solução |
|---|---|
| `GHL 401 Unauthorized` | Token expirado ou escopos insuficientes — regenerar PIT |
| `GHL 404 on sendMessage` | `contactId` não tem WhatsApp linkado — cadastrar número |
| `custom field "xxx" não existe` | Rodar `npm run ghl:bootstrap` pra ver o que falta criar |
| IA não responde | `curl http://localhost:3333/health` + checar `ANTHROPIC_API_KEY` |
| IA responde duas vezes | Webhook duplicado no GHL (ver lista) OU `userId` presente erroneamente |
| Lead duplicado por bug GHL/LGPD | Abrir ticket no suporte GHL (citado pela Lilian na reunião) |
| Webhook rejeita 401 | `GHL_WEBHOOK_SECRET` divergente do GHL; remover se não quiser validar |
| Opportunity não cria | `GHL_PIPELINE_ID` / `GHL_PIPELINE_STAGE_QUALIFIED` não setados |

## 12. Checklist de go-live

- [ ] Token PIT gerado e validado (`npm run ghl:test health`)
- [ ] Custom fields criados no GHL
- [ ] Pipeline + stage "Qualificado" criados
- [ ] `.env` completo (pipeline IDs incluídos)
- [ ] `npm run ghl:bootstrap` OK, SDRs linkados
- [ ] Webhook configurado com URL pública + `GHL_WEBHOOK_SECRET` (se usar)
- [ ] Teste E2E: mandar WhatsApp real pro número da LC → Iara responde
- [ ] Teste handoff: SDR responder pelo app GHL → IA pausa
- [ ] Dashboard acessível, SDRs com login
