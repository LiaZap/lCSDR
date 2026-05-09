import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { logger } from './utils/logger.js';
import webhookRoutes from './routes/webhook.js';
import webhookUazapiRoutes from './routes/webhookUazapi.js';
import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import playgroundRoutes from './routes/playground.js';
import { startScheduler } from './scheduler.js';
import { captureRawBody } from './ghl/webhookSig.js';
import { refreshCustomFieldsCache } from './ghl/customFields.js';

// Importar db só pra rodar schema antes de servir
import { db } from './db/index.js';

// === Fail-fast em config crítica ===
// Sem JWT_SECRET, qualquer token forjado entra. Falha alto e claro.
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('[boot] FATAL: JWT_SECRET ausente ou < 32 chars. Defina no .env (use `openssl rand -hex 32`).');
  process.exit(1);
}

const app = express();

// CORS: aceita lista CSV pra suportar múltiplas origens (prod + dev local)
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

// Health check real: testa conexão com DB.
// EasyPanel/UptimeRobot batem nesse endpoint pra detectar zumbi.
app.get('/health', (_, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ ok: true, ts: new Date().toISOString() });
  } catch (err) {
    logger.error({ err: err.message }, 'health check falhou');
    res.status(503).json({ ok: false, error: 'db unreachable' });
  }
});

app.use('/webhook', webhookRoutes);
app.use('/webhook', webhookUazapiRoutes);
app.use('/auth', authRoutes);
app.use('/api/playground', playgroundRoutes);
app.use('/api', dashboardRoutes);

app.use((err, req, res, _next) => {
  logger.error({ err: err.message, path: req.path }, 'erro no handler');
  res.status(500).json({ error: 'erro interno' });
});

const PORT = Number(process.env.PORT || 3333);
app.listen(PORT, async () => {
  const channel = process.env.UAZAPI_TOKEN ? 'uazapi' : 'ghl';
  logger.info({ port: PORT, channel }, `🤖 Lila online — LC SDR agent`);
  // Pré-carrega cache de custom fields do GHL (não-bloqueante)
  refreshCustomFieldsCache().catch(() => {});
  startScheduler();
});
