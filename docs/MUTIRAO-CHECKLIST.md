# Checklist Operacional do Mutirão — Sábado 14/mai

Cadência hora a hora pra Paulo NÃO entrar em pânico.

---

## ✅ Sex 13/mai — preparação (4-6h)

### Manhã (10h-13h)
- [ ] Confirmar redeploy do `lcsdr` aplicou todas as mudanças (commit `48e58c0`)
- [ ] Confirmar redeploy do `lcdash` aplicou (mobile + sonner + UX)
- [ ] **Variáveis de ambiente no EasyPanel** — `lcsdr` precisa ter:
  - `JWT_SECRET` com 32+ chars (use `openssl rand -hex 32`)
  - `OPENAI_API_KEY` (ou `ANTHROPIC_API_KEY`, ou os 2 — fallback)
  - `DASHBOARD_ORIGIN` apontando pro domínio do `lcdash` (CSV se múltiplos)
  - `UAZAPI_TOKEN` + `UAZAPI_WEBHOOK_SECRET`
  - `LLM_HISTORY_MAX_TOKENS=8000` (default OK, só pra deixar explícito)
- [ ] Trocar senha do `admin@lcagencia.com.br` se ainda for `trocar123`:
  ```bash
  # No console Bash do lcsdr:
  node -e "
  const D = require('better-sqlite3');
  const bcrypt = require('bcryptjs');
  const db = new D('/app/data/lc-sdr.db');
  db.prepare('UPDATE sdr_users SET password_hash = ? WHERE email = ?')
    .run(bcrypt.hashSync('NOVA_SENHA_FORTE_AQUI', 10), 'admin@lcagencia.com.br');
  console.log('senha trocada');
  "
  ```

### Tarde (14h-17h)
- [ ] Smoke test completo — você simula 3 conversas no Playground:
  - 1 lead curioso
  - 1 lead pediu desconto
  - 1 áudio (faz upload)
  Verifica que respostas chegam, sem alert nem erro
- [ ] Verifica `/api/admin/cost-now` (logado como admin) retorna JSON
- [ ] Roda `npm run test:suite` no console do `lcsdr` pra baseline:
  ```bash
  node scripts/test-suite.js
  ```
  Salva output num arquivo (`baseline-pre-mutirao.txt`)
- [ ] Configura **UptimeRobot** (free) batendo em `https://[seu-dominio]/health` a cada 1min
- [ ] Confirma billing OpenAI/Anthropic aceitam até **$200 hard limit**

### Noite (18h)
- [ ] **Backup manual antes do freeze:**
  ```bash
  # No console Bash do lcsdr:
  node -e "
  const D=require('better-sqlite3'); const fs=require('fs');
  fs.mkdirSync('/app/data/backups', {recursive:true});
  const ts = new Date().toISOString().replace(/[:.]/g,'-').slice(0,16);
  const dest = '/app/data/backups/pre-mutirao-' + ts + '.db';
  const db = new D('/app/data/lc-sdr.db', {readonly:true});
  db.backup(dest).then(() => { console.log('OK:', dest); process.exit(0); });
  "
  ```
- [ ] **No host (SSH 69.62.94.175)** — copia pra `/root/`:
  ```bash
  docker cp <CONTAINER_ID>:/app/data/backups/pre-mutirao-*.db /root/
  ls -lh /root/lc-sdr*.db
  ```
- [ ] Cópia adicional pro Drive/B2:
  - Upload manual do `.db` pra Google Drive ou rclone pra B2
- [ ] **Deploy freeze**: avisa o time "ninguém mexe em código até segunda 9h"

---

## 🚦 Sáb 14/mai — dia do mutirão

### 8h — smoke test interno
- [ ] Você manda mensagem teste no WhatsApp do lead-teste
- [ ] Vê resposta da Lila chegar em <30s
- [ ] Confirma backup hourly automático tá rodando (EasyPanel UI)

### 9h — abertura
- [ ] Abas abertas:
  - EasyPanel (containers + Implantações)
  - VPS console SSH
  - OpenAI Platform → Usage (refresh manual a cada 30min)
  - Anthropic Console → Usage
  - UptimeRobot dashboard
  - Terminal com `docker logs -f` no `lcsdr`
  - Dashboard custo: `/admin/cost-now`
  - Planilha com 10 testers + cenários atribuídos (1-2 personas cada)
- [ ] Mensagem no grupo: **"Bora! Antes de começar: faz logout/login no dashboard pra sessão renovar"**

### 9h-13h — observação ativa
**A cada 30min:**
- Olha `/admin/cost-now` — se total do dia passar de $20, alerta amarelo. Passar de $40, alerta vermelho.
- Olha logs procurando `ERROR` (Ctrl+F)
- Olha UptimeRobot — qualquer downtime → investiga

**A cada 1h:**
- Backup manual de emergência:
  ```bash
  docker exec <ID> sh -c "cp /app/data/lc-sdr.db /app/data/backups/emergencia-$(date +%H%M).db"
  ```

**Você NÃO faz deploy durante o mutirão.** Bug? Anota. Conserta segunda.

### Se algo quebrar
- **OpenAI down** → fallback Anthropic já está configurado, só observa
- **Ambos LLMs down** → handoff hardcoded já dispara, leads recebem "encaminhando ao time"
- **Backend caiu** → EasyPanel restart automático via health check. Se persistir, rollback (ver `ROLLBACK.md`)
- **Banco zicado** → restore do backup `pre-mutirao-*.db` (ver `ROLLBACK.md`)

### 13h — encerramento
- [ ] Backup final manual
- [ ] Export CSV de todas as conversas pra Drive:
  ```bash
  node -e "
  const D=require('better-sqlite3'); const fs=require('fs');
  const db=new D('/app/data/lc-sdr.db',{readonly:true});
  const rows = db.prepare('SELECT c.id, c.name, c.phone, c.funnel, c.stage, c.qualification_score, c.qualification_notes FROM contacts c WHERE c.ghl_contact_id NOT LIKE \"playground-%\"').all();
  fs.writeFileSync('/app/data/export-mutirao.csv', 'id,name,phone,funnel,stage,score,notes\n' + rows.map(r => [r.id, r.name, r.phone, r.funnel, r.stage, r.qualification_score, JSON.stringify(r.qualification_notes||'')].join(',')).join('\n'));
  console.log('exportadas', rows.length, 'linhas');
  "
  ```
- [ ] Pega o export e manda pro Drive/Lilian
- [ ] Mensagem no grupo: **"Mutirão fechado. Obrigado a todo mundo. Análise dos feedbacks segunda."**

---

## 📊 Métricas que você quer ter no fim do mutirão

- Quantas conversas testadas
- Custo total IA (esperado: $5-30 dependendo de quantos turnos)
- Cache hit ratio (quanto mais alto, melhor — esperado >50%)
- Quantos `tom_ok` vs `tom_errado` vs `corrigir`
- Bugs reportados (texto livre dos comentários)
- Top 3 cenários onde a Lila errou mais

Tudo dá pra puxar com queries SQL na segunda.

---

## 📞 Contatos de emergência

- **Hostinger suporte 24/7**: chat web no painel
- **OpenAI status**: https://status.openai.com (RSS feed útil)
- **Anthropic status**: https://status.anthropic.com
- **uazapi suporte**: [contato cadastrado]
- **Lilian (LC)**: [WhatsApp]
- **Bruna (LC)**: [WhatsApp]

---

**Última atualização**: pós-bloco 4 do plano (commit `48e58c0`)
**Mantenedor**: Paulo (BEP Media) · paulo@bep.media
