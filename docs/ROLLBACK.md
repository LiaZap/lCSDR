# Plano de Rollback — Lila SDR

Procedimento de 5 passos pra reverter quando algo quebra. **Treme antes de fazer, mas faz.**

---

## Cenário A — deploy quebrou o backend (`lcsdr`)

**Sintoma**: dashboard mostra erro de rede, Lila parou de responder, `/health` retorna 503 ou nada.

### Passos (≤ 90 segundos)

1. Abre **EasyPanel → `lcsdr` → Implantações**
2. Identifica o commit anterior (que sabia que estava funcionando)
3. Clica nos 3 pontos `⋮` desse commit → **Reimplantar**
4. Aguarda ~60s o build subir
5. Testa `https://[seu-dominio]/health` → tem que retornar `{"ok": true}`

**Volume persiste.** Banco fica intacto. Só código volta.

---

## Cenário B — deploy quebrou o frontend (`lcdash`)

**Sintoma**: dashboard mostra tela branca, erro de JS no console, layout esculhambado.

### Passos
1. Mesma coisa que Cenário A, mas no serviço `lcdash`.
2. Como dashboard é estático (build via vite + nginx), rollback é instantâneo.

---

## Cenário C — banco zicado (DROP TABLE acidental, corrupção, etc)

**Sintoma**: queries falham, dashboard mostra "erro interno", `node -e ... SELECT COUNT(*)` dá erro de schema.

### Passos
1. **Para o agente** pra evitar mais writes:
   - EasyPanel → `lcsdr` → ⏹ Stop
2. SSH no host VPS:
   ```bash
   ssh root@69.62.94.175
   ```
3. Identifica o backup mais recente válido:
   ```bash
   ls -lh /etc/easypanel/backups/app/data/
   ls -lh /root/lc-sdr*.db
   ```
   Pega o mais recente (ou `pre-mutirao-*.db` que você fez sex 18h)
4. Substitui o banco corrente:
   ```bash
   # Backup do banco atual zicado (forense)
   cp /etc/easypanel/projects/realsistema/lcsdr/volumes/lcsdr-data/lc-sdr.db \
      /etc/easypanel/projects/realsistema/lcsdr/volumes/lcsdr-data/lc-sdr.db.zicado-$(date +%H%M)

   # Restore do backup
   cp /root/lc-sdr-backup-pre-mutirao-XXXX.db \
      /etc/easypanel/projects/realsistema/lcsdr/volumes/lcsdr-data/lc-sdr.db

   # Remove arquivos WAL antigos pra não confundir o SQLite
   rm -f /etc/easypanel/projects/realsistema/lcsdr/volumes/lcsdr-data/lc-sdr.db-wal \
         /etc/easypanel/projects/realsistema/lcsdr/volumes/lcsdr-data/lc-sdr.db-shm
   ```
5. **Inicia o agente novamente**:
   - EasyPanel → `lcsdr` → ▶ Start
6. Confirma:
   ```bash
   docker exec <CONTAINER_ID> node -e "
   const D=require('better-sqlite3');
   const db=new D('/app/data/lc-sdr.db',{readonly:true});
   console.log('users:', db.prepare('SELECT COUNT(*) as n FROM sdr_users').get().n);
   console.log('contacts:', db.prepare('SELECT COUNT(*) as n FROM contacts').get().n);
   "
   ```

---

## Cenário D — uazapi caiu / WhatsApp não envia

**Sintoma**: leads mandam mensagem, Lila gera resposta no banco mas nada chega no WhatsApp deles.

Não tem rollback aqui — é dependência externa. Mas:

1. Verifica painel uazapi (https://uazapi.com)
2. Se for problema deles, **avisa o time**: "Lila tá recebendo mas o WhatsApp tá fora. Estamos vendo." (resposta humana imediata)
3. Quando voltar, o sistema retoma — mensagens não perdidas porque foram registradas no banco.

---

## Cenário E — OpenAI E Anthropic ambos caíram simultaneamente

**Sintoma**: todas as respostas viram "Deixa eu te conectar com alguém aqui do time" (handoff hardcoded).

**Não há rollback** — fallback hardcoded já está ativo. O lead recebe mensagem honesta. Time humano assume manualmente até voltar.

1. Mensagem no grupo: **"OpenAI/Anthropic em outage. Lila tá só fazendo handoff. Quem puder, atende manualmente os leads que chegarem.**
2. Acompanha status pages
3. Quando voltar, sistema volta sozinho ao normal.

---

## Quando NÃO fazer rollback

- Bug pequeno, cosmético: anota, conserta segunda
- Lila respondendo "esquisito" mas funcionando: feedback `corrigir` resolve
- Demora > 5s pra responder: provavelmente OpenAI lenta, não nosso bug
- Erro 401 no dashboard: usuário com token velho, é só fazer logout/login

**Rollback é pra coisa que IMPEDE atendimento, não pra coisa estética.**

---

**Última atualização**: bloco final do plano pré-mutirão (mai/2026)
