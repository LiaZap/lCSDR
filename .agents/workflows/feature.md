# Workflow — nova funcionalidade no LC SDR (Tina)

## 1. Ler antes de projetar

- `README.md` — produto, stack, setup
- `docs/AGENT-PROMPT.md` — o prompt da Tina explicado
- `docs/COMO-ATUALIZAR-LILA.md` — como mexer no comportamento sem quebrar
- `agente/src/agent/systemPrompt.js` e `tina.js` — o comportamento real
- `docs/GHL-SETUP.md` e `docs/UAZAPI-SETUP.md` — integrações
- O arquivo real que você vai alterar

A funcionalidade pode já existir com outro nome — confira a documentação antes de escrever.

## 2. Decidir onde mora

| Tipo de mudança | Onde |
| :--- | :--- |
| Comportamento da Tina | `agente/src/agent/systemPrompt.js` — e o motivo vai no commit |
| Conhecimento do produto | `agente/src/agent/knowledge.js` + `knowledge-base.md`, com origem em `docs/source-material/` |
| Integração WhatsApp | `agente/src/uazapi/` |
| Integração CRM | `agente/src/ghl/` |
| Rota HTTP / webhook | `agente/src/routes/` |
| Rotina agendada | `agente/src/scheduler.js` |
| Tela de revisão | `dashboard/src/pages/` |
| Flag de comportamento nova | expor também no `/health` — é a ferramenta de diagnóstico |

Regra de negócio fica em **um** lugar e é consumida por todas as telas. Se você está copiando a
mesma lógica para um segundo arquivo, pare.

## 3. Implementar respeitando os invariantes

Os da seção "Invariantes" em [../rules/lc-sdr-tina.md](../rules/lc-sdr-tina.md) valem todos. Em especial:

- **A memória lê as mensagens MAIS RECENTES**, não as mais antigas — ler as 30 mais antigas foi a causa raiz das mensagens repetidas
- **Lê todas as mensagens do lead antes de responder** e não repergunta o que já foi respondido (e-mail e horário costumam vir na mesma bolha)
- **Histórico antigo não define a intenção de hoje**
- **Uma pergunta por vez**, e a bolha sai completa

## 4. Testar

```bash
node agente/scripts/test-suite.js
```

## 5. Documentar na mesma alteração

- Módulo, integração ou invariante novo → a doc de arquitetura do projeto
- Invariante que os agentes precisam respeitar → `AGENTS.md` **e** `CLAUDE.md` (os dois)
- Decisão de arquitetura → ADR, se o projeto tiver `docs/adr/`

## 6. Reportar

Arquivos criados/alterados · invariantes tocados · saída dos comandos acima · docs atualizados ·
o que ficou fora do escopo.
