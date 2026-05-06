# Fases de implementação

Alinhado com o que a Lilian propôs na reunião: entregar em fases, não tudo de uma vez.

## Fase 1 — MVP (esta entrega)

**O que está pronto:**
- [x] Backend Node/Express com webhook GHL
- [x] Agente Iara (Claude Sonnet 4.6) com system prompt humanizado
- [x] Persistência em SQLite
- [x] Handoff automático: SDR responde → IA pausa
- [x] Follow-up automático após silêncio (configurável)
- [x] Transcrição de áudio (Whisper)
- [x] Bloqueio de PDF grande
- [x] Tags automáticas no GHL (`iara-qualificado`, `funil-X`)
- [x] Dashboard: login, visão geral, conversas, leads, detalhe com chat
- [x] SDR pode assumir/liberar conversa direto do dashboard
- [x] Métricas: leads/dia, por funil, custo IA

**Ainda falta configurar (você):**
- [ ] Subir em servidor com URL pública (Railway, Fly, Render, VPS)
- [ ] Configurar webhook no GHL apontando pra URL
- [ ] Rodar `npm install` nas duas pastas e `npm run init-db` no backend
- [ ] Preencher `.env` com chaves
- [ ] Criar usuários SDR no banco (Gabriel, Vítor etc.)

## Fase 2 — Refino do script (próximas 2 semanas)

Após rodar 1 semana com leads reais:

- [ ] Reunião com Lilian + Bruna pra revisar conversas da Iara
- [ ] Ajustar tom, textos de corte, mensagens de follow-up
- [ ] Adicionar few-shot examples baseados em 20-30 trechos reais
- [ ] Definir roteamento de SDR por funil
- [ ] Customizar nome que a Iara usa no handoff ("vou te passar pra Daniela")
- [ ] **Habilitar agendamento** direto no calendário GHL (Lilian pediu só após script refinado)

## Fase 3 — Expansão

- [ ] Botões interativos de pré-qualificação WhatsApp (escrever / publicar / divulgar)
- [ ] Mensagem de boas-vindas automática pós-compra de curso
- [ ] Ingestão de histórico (2-3 dias) pra melhorar coerência com conversas antigas
- [ ] Dashboard admin pra criar SDRs sem mexer no banco
- [ ] Métricas avançadas: tempo de resposta, conversão por funil, ROI por criativo
- [ ] Integração com criativos da Isabella (linkar lead ao ad_id de origem)
- [ ] Corrigir bug do GHL de contato duplicado (LGPD) — abrir ticket

## Fase 4 — Proativo

- [ ] IA detecta quando lead fica MUITO qualificado e já sugere horário
- [ ] Resumo diário automático pro Gabriel/Vítor: "seus 10 melhores leads da semana"
- [ ] Alerta quando volume de desqualificados explode (criativo ruim rodando)
- [ ] A/B test de scripts dentro do próprio agente
