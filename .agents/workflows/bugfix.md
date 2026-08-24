# Workflow — corrigir bug no LC SDR (Tina)

## 1. Ler antes de tocar

- `README.md` — produto, stack, setup
- `docs/AGENT-PROMPT.md` — o prompt da Tina explicado
- `docs/COMO-ATUALIZAR-LILA.md` — como mexer no comportamento sem quebrar
- `agente/src/agent/systemPrompt.js` e `tina.js` — o comportamento real
- `docs/GHL-SETUP.md` e `docs/UAZAPI-SETUP.md` — integrações
- O arquivo real que você vai alterar

## 2. Localizar a camada

| Sintoma | Comece por |
| :--- | :--- |
| Tina repetindo pergunta já respondida | ordem da memória (mais recentes) e leitura de todas as mensagens do lead |
| Tina abordando quem já comprou ou já tem reunião | as guardas de reabordagem — são quatro, distintas |
| Rótulo hoje/amanhã errado | cálculo em BRT vs UTC do servidor |
| Card duplicado em Aguardando/Reentrada | o card do Pré-Vendas não foi fechado no agendamento |
| Tina inventando que a agenda não está aberta, ou repetindo datas | `systemPrompt.js` + a lista de slots |
| Atendimento sem tag / Tina não assume | `/health` expõe `requiredTag`, `attendExceptReentrada`, `ownsEntryLane`, `blockTags` |
| Origem do lead perdida | `ctwa_clid` tem que ir em `contact.ctwaclid`, sem underscore |
| Tina falando de LC Books quando não devia | anúncio de leitura coletiva é divulgação, não LC Books |

## 3. Diagnosticar sem escrever

Reproduza e leia o estado antes de editar. Confira a trilha de auditoria: quem fez, o quê, quando.
Se for escrever script de diagnóstico, ele tem que percorrer **o mesmo caminho do código de
produção** — script que testa por fora mente.

## 4. Corrigir a causa, não o sintoma

Antes de editar, `grep` por **todos os chamadores** da função que você vai tocar. A guarda certa
fica na função compartilhada, não em cada chamador — senão o bug continua vivo nos irmãos.

## 5. Provar

```bash
node agente/scripts/test-suite.js
```

## 6. Reportar

Sintoma × causa raiz · arquivos lidos e alterados · invariantes tocados · saída dos comandos acima ·
risco residual.
