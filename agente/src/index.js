import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { logger } from './utils/logger.js';
import webhookRoutes from './routes/webhook.js';
import webhookUazapiRoutes from './routes/webhookUazapi.js';
import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import playgroundRoutes from './routes/playground.js';
import internalRoutes from './routes/internal.js';
import { startScheduler } from './scheduler.js';
import { captureRawBody } from './ghl/webhookSig.js';
import { refreshCustomFieldsCache } from './ghl/customFields.js';
import { preferredChannel } from './agent/messenger.js';

// Importar db só pra rodar schema antes de servir
import { db } from './db/index.js';

// === Fail-fast em config crítica ===
// Sem JWT_SECRET, qualquer token forjado entra. Falha alto e claro.
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('[boot] FATAL: JWT_SECRET ausente ou < 32 chars. Defina no .env (use `openssl rand -hex 32`).');
  process.exit(1);
}

const app = express();

// Confia no proxy reverso da EasyPanel pra rate-limit pegar IP real
app.set('trust proxy', 1);

// === Helmet: cabeçalhos de segurança básicos ===
// CSP customizado pode quebrar React inline scripts; usar default sem CSP.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

// === CORS com lista CSV (prod + dev local) ===
const allowedOrigins = (process.env.DASHBOARD_ORIGIN || '*')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return cb(null, true);
    }
    cb(new Error(`CORS: origem ${origin} não permitida`));
  },
}));
// Precisa do raw body pra validar assinatura HMAC do GHL.
app.use(express.json({ limit: '2mb', verify: captureRawBody }));
app.use(express.urlencoded({ extended: true }));

// === Rate limiting ===
// Login: brute-force protection. 10 tentativas/min por IP.
const loginLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'muitas tentativas — aguarde 1 minuto' },
});
// Webhooks (uazapi/ghl): bursts são normais, limite alto. 600/min.
const webhookLimiter = rateLimit({
  windowMs: 60_000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
});
// API geral (/api/*): 200/min por IP. Conta dashboard + admin.
const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/auth/login', loginLimiter);
app.use('/webhook', webhookLimiter);
app.use('/api', apiLimiter);

// Health check real: testa conexão com DB.
// EasyPanel/UptimeRobot batem nesse endpoint pra detectar zumbi.
app.get('/health', (_, res) => {
  try {
    db.prepare('SELECT 1').get();
    // cfg: flags de configuração (só booleanos/tipo, SEM valores de segredo) — serve pra
    // confirmar remotamente o que está ligado em produção sem adivinhar. Se este bloco
    // aparecer no /health, o deploy pegou este build.
    res.json({
      ok: true,
      ts: new Date().toISOString(),
      cfg: {
        attribution: process.env.ATTRIBUTION_SYNC_ENABLED === 'true',
        metaToken: Boolean(process.env.META_ADS_TOKEN),
        outbound: process.env.GHL_OUTBOUND_TYPE || 'WhatsApp',
        conflictCheck: process.env.SCHEDULING_CONFLICT_CHECK !== 'false',
        organicoSweep: process.env.ORGANICO_SWEEP_ENABLED === 'true',
      },
    });
  } catch (err) {
    logger.error({ err: err.message }, 'health check falhou');
    res.status(503).json({ ok: false, error: 'db unreachable' });
  }
});

app.use('/webhook', webhookRoutes);
app.use('/webhook', webhookUazapiRoutes);
app.use('/auth', authRoutes);
app.use('/api/playground', playgroundRoutes);
app.use('/api/internal', internalRoutes);
app.use('/api', dashboardRoutes);

app.use((err, req, res, _next) => {
  logger.error({ err: err.message, path: req.path }, 'erro no handler');
  res.status(500).json({ error: 'erro interno' });
});

const PORT = Number(process.env.PORT || 3333);
app.listen(PORT, async () => {
  const channel = preferredChannel(); // canal REAL de atendimento do lead
  logger.info({
    port: PORT,
    leadChannel: channel,
    uazapiInbound: process.env.UAZAPI_INBOUND_ENABLED === 'true',
    skipInAttendance: process.env.SKIP_LEADS_IN_ATTENDANCE !== 'false',
    groupNotify: Boolean(process.env.UAZAPI_NOTIFY_GROUP),
  }, `🤖 Tina online — canal do lead: ${channel.toUpperCase()}`);
  // Pré-carrega cache de custom fields do GHL (não-bloqueante)
  refreshCustomFieldsCache().catch(() => {});
  startScheduler();
});
