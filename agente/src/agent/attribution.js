// RASTREAMENTO DE ANÚNCIO (Click-to-WhatsApp) → campos UTM da GHL.
//
// A GHL JÁ captura a atribuição do Meta no contato (campo attributionSource):
//   { sessionSource:"Paid Social", medium:"whatsapp", adId, adName, url, ctwaClid }
// Este módulo copia esses dados pros campos UTM que o time usa nos relatórios.
//
// NÍVEL 1 (sem dependência externa): grava adId, nome do anúncio, URL, origem.
// NÍVEL 2 (precisa META_ADS_TOKEN com ads_read): resolve adId → nome da CAMPANHA
//   e do CONJUNTO (adset) no Meta Graph API, com cache por adId. Se o token não
//   estiver setado, roda só o Nível 1 (campanha/conjunto ficam pra depois).
//
// Fail-open: qualquer erro só loga e segue — NUNCA quebra o fluxo da Tina.
import fetch from 'node-fetch';
import { GHL } from '../ghl/client.js';
import { logger } from '../utils/logger.js';

export function attributionEnabled() {
  return process.env.ATTRIBUTION_SYNC_ENABLED === 'true';
}

// Mapa lógico → fieldKey do custom field na GHL (confirmados na location LCA).
// Sobrescrevível por ATTRIBUTION_FIELD_MAP (JSON) se a convenção do time mudar.
const DEFAULT_MAP = {
  adId:        'contact.sourceid',       // id do anúncio (Meta)
  adName:      'contact.sourceads',      // nome do anúncio
  url:         'contact.sourceurl',      // permalink do post/anúncio
  sourceType:  'contact.sourcetype',     // "Paid Social" / "Social media"
  utmSource:   'contact.utm_source',     // instagram / facebook / meta
  utmMedium:   'contact.utm_medium',     // paid_social
  utmCampaign: 'contact.utm_campaign',   // NOME da campanha (Nível 2)
  utmContent:  'contact.utm_content',    // NOME do anúncio
  utmTerm:     'contact.utm_term_lca',   // NOME do conjunto/adset (Nível 2)
  ctwaClid:    'contact.ctwa_clid',      // click-id (só se o campo existir na location)
};
function fieldMap() {
  if (!process.env.ATTRIBUTION_FIELD_MAP) return DEFAULT_MAP;
  try { return { ...DEFAULT_MAP, ...JSON.parse(process.env.ATTRIBUTION_FIELD_MAP) }; }
  catch { return DEFAULT_MAP; }
}

// cache fieldKey → fieldId (resolve 1x por processo)
let _fieldIdByKey = null;
async function fieldIdByKey() {
  if (_fieldIdByKey) return _fieldIdByKey;
  const r = await GHL.listCustomFields();
  const fields = r.customFields || r || [];
  const m = {};
  for (const f of fields) if (f.fieldKey) m[f.fieldKey] = f.id;
  _fieldIdByKey = m;
  return m;
}

// cache adId → { ad, adset, campaign } (Nível 2). Guarda null p/ não repetir chamada falha.
const _adCache = new Map();

// Extrai a atribuição de ANÚNCIO do contato. Retorna null se não for de anúncio pago.
export function readAttribution(contact) {
  const a = contact?.attributionSource || contact?.lastAttributionSource || null;
  if (!a) return null;
  const adId = a.adId || a.adid || null;
  const ctwaClid = a.ctwaClid || a.ctwaclid || null;
  if (!adId && !ctwaClid) return null; // orgânico / sem anúncio → nada a rastrear
  return {
    adId, ctwaClid,
    adName: a.adName || null,
    url: a.url || null,
    sessionSource: a.sessionSource || null,
    medium: a.medium || null,
  };
}

function deriveUtmSource(url, sessionSource) {
  const u = String(url || '').toLowerCase();
  if (u.includes('instagram') || u.includes('ig.me')) return 'instagram';
  if (u.includes('facebook') || u.includes('fb.me') || u.includes('fb.com')) return 'facebook';
  return sessionSource ? sessionSource.toLowerCase().replace(/\s+/g, '_') : 'meta';
}

// NÍVEL 2: resolve nomes no Meta Graph API. Cacheado por adId. null sem token.
async function resolveAdNames(adId) {
  const token = process.env.META_ADS_TOKEN;
  if (!token || !adId) return null;
  if (_adCache.has(adId)) return _adCache.get(adId);
  try {
    const ver = process.env.META_API_VERSION || 'v21.0';
    const url = `https://graph.facebook.com/${ver}/${adId}?fields=name,adset{name,campaign{name}}&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url);
    const j = await res.json();
    if (j.error) {
      logger.warn({ adId, err: j.error.message }, 'Meta: resolveAdNames retornou erro');
      _adCache.set(adId, null);
      return null;
    }
    const out = { ad: j.name || null, adset: j.adset?.name || null, campaign: j.adset?.campaign?.name || null };
    _adCache.set(adId, out);
    return out;
  } catch (e) {
    logger.warn({ adId, err: e.message }, 'Meta: resolveAdNames falhou');
    return null;
  }
}

// Monta os pares [{ id, field_value }] — só campos que EXISTEM na location e têm valor.
async function buildFields(attr, names) {
  const map = fieldMap();
  const idByKey = await fieldIdByKey();
  const pairs = [];
  const seen = new Set();
  const put = (logicalKey, value) => {
    if (value == null || value === '') return;
    const fk = map[logicalKey];
    const id = fk && idByKey[fk];
    if (!id || seen.has(id)) return; // campo inexistente (ex.: ctwa_clid) → ignora
    seen.add(id);
    pairs.push({ id, field_value: String(value) });
  };
  put('adId', attr.adId);
  put('adName', names?.ad || attr.adName);
  put('url', attr.url);
  put('sourceType', attr.sessionSource);
  put('utmSource', deriveUtmSource(attr.url, attr.sessionSource));
  put('utmMedium', 'paid_social');
  put('utmContent', names?.ad || attr.adName);   // anúncio
  put('utmCampaign', names?.campaign);            // campanha (Nível 2)
  put('utmTerm', names?.adset);                   // conjunto/adset (Nível 2)
  put('ctwaClid', attr.ctwaClid);
  return pairs;
}

// Enriquece UM contato: lê atribuição → grava UTM. Idempotente e fail-open.
// opts.contact: passa o objeto do contato já buscado (evita refetch).
// opts.dryRun: calcula mas NÃO grava (pra o backfill em modo simulação).
export async function enrichContactAttribution(ghlContactId, { contact = null, dryRun = false, skipIfFilled = false } = {}) {
  if (!ghlContactId || !process.env.GHL_API_TOKEN) return { ok: false, reason: 'sem-id-ou-token' };
  try {
    const c = contact || await GHL.getContact(ghlContactId);
    const attr = readAttribution(c);
    if (!attr) return { ok: true, skipped: 'sem-atribuicao-de-anuncio' };
    // Idempotência sem banco: se o contato JÁ tem o campo do anúncio preenchido, não regrava.
    // Deixa o gancho ao vivo rodar em TODO inbound sem custo de re-escrita.
    if (skipIfFilled) {
      const idByKey = await fieldIdByKey();
      const sid = idByKey[fieldMap().adId];
      if (sid && (c.customFields || c.custom_fields || []).some(x => x.id === sid && x.value)) {
        return { ok: true, skipped: 'ja-preenchido', adId: attr.adId };
      }
    }
    const names = await resolveAdNames(attr.adId); // null no Nível 1
    const fields = await buildFields(attr, names);
    if (!fields.length) return { ok: true, skipped: 'sem-campos-para-gravar', adId: attr.adId };
    if (dryRun) return { ok: true, dryRun: true, adId: attr.adId, nivel: names ? 2 : 1, campos: fields.length, names, attr };
    await GHL.upsertCustomFields(ghlContactId, fields);
    return { ok: true, wrote: fields.length, adId: attr.adId, nivel: names ? 2 : 1 };
  } catch (e) {
    logger.warn({ err: e.message, ghlContactId }, 'enrichContactAttribution falhou (segue)');
    return { ok: false, reason: e.message };
  }
}
