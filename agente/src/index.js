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
import './db/index.js';

const app = express();
app.use(cors({ origin: process.env.DASHBOARD_ORIGIN || '*' }));
// Precisa do raw body pra validar assinatura HMAC do GHL.
app.use(express.json({ limit: '2mb', verify: captureRawBody }));
app.use(express.urlencoded({ extended: true }));

app.get('/health', (_, res) => res.json({ ok: true, ts: new Date().toISOString() }));

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
