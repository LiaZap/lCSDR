# Deploy no EasyPanel

Passo a passo pra subir o LC SDR (Lila) no EasyPanel via repositório Git.

**Repo**: https://github.com/LiaZap/lCSDR.git

## Arquitetura no EasyPanel

```
┌─────────────────────────────────────────────────────────┐
│  EasyPanel — Project: lcsdr                            │
│                                                         │
│  ┌──────────────────────┐    ┌──────────────────────┐  │
│  │  Service: dashboard  │    │  Service: agente     │  │
│  │  (nginx + React)     │───▶│  (Node + Express)    │  │
│  │  Public: ✅ HTTPS    │    │  Public: ❌ privado  │  │
│  │  Port 80             │    │  Port 3333           │  │
│  └──────────────────────┘    └──────────────────────┘  │
│         ▲                              │                │
│         │                              ▼                │
│         │                      ┌─────────────────┐      │
│         │                      │ Volume          │      │
│   👤 Lilian/Bruna              │ /app/data       │      │
│   🤖 uazapi webhook            │ (SQLite)        │      │
│   📞 GHL webhook               └─────────────────┘      │
└─────────────────────────────────────────────────────────┘
```

**Apenas o dashboard tem domínio público.** O nginx dele faz proxy `/api`, `/auth` e `/webhook` pro backend (que é privado).

URL única: `https://lcsdr-dashboard.SEU-DOMINIO.easypanel.host`
- Dashboard: `/`
- Webhook uazapi: `/webhook/uazapi`
- Webhook GHL:    `/webhook/ghl`

---

## 1. Subir o código no GitHub

```bash
cd "C:/Users/Paulo/Documents/Agende SDR LC"
git init
git add .
git commit -m "Initial: LC SDR (Lila) — agente + dashboard"
git branch -M main
git remote add origin https://github.com/LiaZap/lCSDR.git
git push -u origin main
```

**Antes de pushar, confira que `.gitignore` está bloqueando `.env`** — rode:
```bash
git status | grep -i env
```
Não deve aparecer nenhum `.env` (só `.env.example` e `.env.production.example`).

---

## 2. Criar projeto no EasyPanel

1. Login → **Create Project** → nome: `lcsdr`
2. Add Service → **App** → `agente`
   - **Source**: GitHub → `LiaZap/lCSDR`
   - **Branch**: `main`
   - **Build path**: `/agente`
   - **Build method**: Dockerfile
   - **Dockerfile path**: `Dockerfile` (relativo ao build path)
   - **Public**: **NÃO** marcar (privado, só rede interna)
   - **Port**: `3333`
3. Add Service → **App** → `dashboard`
   - **Source**: mesmo repo, mesma branch
   - **Build path**: `/dashboard`
   - **Build method**: Dockerfile
   - **Dockerfile path**: `Dockerfile.prod`
   - **Public**: ✅ marcar
   - **Port**: `80`
   - **Domain**: deixe o EasyPanel atribuir o subdomínio temporário

---

## 3. Configurar Environment Variables (apenas no `agente`)

No EasyPanel → `agente` → **Environment** → cole as variáveis abaixo (uma por linha):

```env
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-proj-COLE_AQUI
OPENAI_MODEL=gpt-4.1-mini
ANTHROPIC_API_KEY=
CLAUDE_MODEL=claude-sonnet-4-6
UAZAPI_BASE=https://liaautomacoes.uazapi.com
UAZAPI_TOKEN=COLE_AQUI
UAZAPI_WEBHOOK_SECRET=
GHL_API_TOKEN=
GHL_LOCATION_ID=
GHL_API_BASE=https://services.leadconnectorhq.com
GHL_API_VERSION=2021-07-28
GHL_WEBHOOK_SECRET=
GHL_PIPELINE_ID=
GHL_PIPELINE_STAGE_QUALIFIED=
GHL_PIPELINE_STAGE_HANDOFF=
PORT=3333
NODE_ENV=production
LOG_LEVEL=info
PUBLIC_URL=https://SEU-SUBDOMINIO.easypanel.host
DASHBOARD_ORIGIN=https://SEU-SUBDOMINIO.easypanel.host
JWT_SECRET=COLE_UMA_STRING_ALEATORIA_LONGA
FOLLOWUP_SILENCE_MINUTES=60
MAX_ATTACHMENT_KB=200
MAX_MESSAGES_PER_CONVERSATION_PER_DAY=40
```

**JWT_SECRET**: gere uma string aleatória longa. No terminal:
```bash
openssl rand -hex 32
```

**PUBLIC_URL e DASHBOARD_ORIGIN**: são iguais — apontam pro **dashboard** (não pro agente). Pegue do EasyPanel após o deploy do dashboard.

---

## 4. Configurar volume persistente (apenas no `agente`)

EasyPanel → `agente` → **Mounts** → Add:
- **Type**: Volume
- **Name**: `lcsdr-data`
- **Mount path**: `/app/data`

Esse volume persiste o SQLite. Se você apagar, perde TODAS as conversas.

---

## 5. Deploy

EasyPanel → cada serviço → **Deploy**.

Aguarda o build (3-5 min cada).

Verifique logs:
- `agente` deve mostrar: `🤖 Lila online — LC SDR agent { port: 3333, channel: 'uazapi' }`
- `dashboard` deve subir nginx silenciosamente

Acesse: `https://SEU-SUBDOMINIO.easypanel.host`
- Login: `admin@lcagencia.com.br` / `trocar123`

---

## 6. Criar usuários pra Lilian e Bruna

Dentro do shell do container `agente`:
```bash
# No EasyPanel: agente → Console
node -e "
import('./src/db/index.js').then(({db}) => {
  import('bcryptjs').then(({default: bcrypt}) => {
    const users = [
      ['Lilian Cardoso', 'lilian@lcagencia.com.br', 'LCagencia2026'],
      ['Bruna', 'bruna@lcagencia.com.br', 'LCagencia2026'],
    ];
    for (const [name, email, pwd] of users) {
      const hash = bcrypt.hashSync(pwd, 10);
      const exists = db.prepare('SELECT id FROM sdr_users WHERE email = ?').get(email);
      if (!exists) {
        db.prepare('INSERT INTO sdr_users (name, email, password_hash, role) VALUES (?, ?, ?, ?)').run(name, email, hash, 'admin');
        console.log('✓ criado:', email);
      } else {
        console.log('- já existe:', email);
      }
    }
  });
});
"
```

Ou substitua pelo script `scripts/seed-users.js` (vou criar esse arquivo).

---

## 7. Configurar webhook uazapi

No painel uazapi → Webhooks:
- **URL**: `https://SEU-SUBDOMINIO.easypanel.host/webhook/uazapi`
- **Eventos**: `message` (mensagens recebidas)

Se quiser HMAC: setar `UAZAPI_WEBHOOK_SECRET` no env do agente E no painel uazapi com o mesmo valor.

Pra testar:
```bash
# do seu PC
curl -X POST https://SEU-SUBDOMINIO.easypanel.host/health
# deve retornar {"ok":true,"ts":"..."}
```

---

## 8. Atualizar (deploys subsequentes)

EasyPanel detecta novos pushes na branch `main` automaticamente (se você ativar Auto Deploy). Senão:

```bash
git push origin main
```

Depois EasyPanel → cada serviço → **Redeploy**.

---

## Troubleshooting

| Sintoma | Causa / solução |
|---|---|
| `502 Bad Gateway` ao abrir dashboard | Backend não subiu. Ver logs do `agente`, geralmente env var faltando |
| Login dá erro de CORS | `DASHBOARD_ORIGIN` no env do agente está diferente do domínio real |
| `OPENAI_API_KEY` invalid | Verifique que a chave foi colada inteira (são ~164 chars) |
| Banco zerado após redeploy | Volume não foi montado em `/app/data` (passo 4) |
| Webhook uazapi não chega | URL errada, ou secret divergente |
| `npm error Missing script` | Build path no EasyPanel está errado (precisa ser `/agente` ou `/dashboard`, não raiz) |

---

## Custo estimado

EasyPanel cobra por VPS, não por app. Setup mínimo:
- VPS 2GB RAM (Hetzner ou Contabo): ~R$25-40/mês
- LLM (gpt-4.1-mini, ~50 leads/dia): ~R$10-20/mês
- uazapi: ~R$50-100/mês (depende do plano)
- **Total: R$85-160/mês** pra LC operar a Lila 24/7
