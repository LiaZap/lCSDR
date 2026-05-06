import crypto from 'node:crypto';
import { logger } from '../utils/logger.js';

// Validação de assinatura do webhook GHL.
// GHL envia `x-wh-signature` (HMAC-SHA256 do raw body usando GHL_WEBHOOK_SECRET).
// Obs: nem todo webhook do GHL vem assinado (depende do tipo de integração).
// Se GHL_WEBHOOK_SECRET não estiver setado, a validação é desativada (só loga warn).

export function verifyGHLSignature(req, rawBody) {
  const secret = process.env.GHL_WEBHOOK_SECRET;
  if (!secret) {
    // sem segredo → aceita (modo dev ou PIT sem signing)
    return { ok: true, skipped: true };
  }

  const sig = req.headers['x-wh-signature'] || req.headers['x-gohighlevel-signature'];
  if (!sig) {
    logger.warn('webhook sem assinatura — rejeitando');
    return { ok: false, reason: 'missing_signature' };
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  // timing-safe compare
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return { ok: false, reason: 'length_mismatch' };

  const match = crypto.timingSafeEqual(a, b);
  return match ? { ok: true } : { ok: false, reason: 'signature_mismatch' };
}

// Middleware Express que captura o raw body (necessário pro HMAC) e expõe em req.rawBody
export function captureRawBody(req, _res, buf) {
  req.rawBody = buf?.toString('utf8') || '';
}
