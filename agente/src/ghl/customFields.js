import { db } from '../db/index.js';
import { GHL } from './client.js';
import { logger } from '../utils/logger.js';

// Cache dos IDs dos custom fields (chave → id) por processo.
// Resolve as chaves lógicas usadas no código pros IDs reais criados na location LC.
let CACHE = null;

const EXPECTED = {
  funnel_lc:  { name: 'Funil LC',  dataType: 'TEXT' },
  iara_score: { name: 'Score Iara', dataType: 'NUMBER' },
  iara_notes: { name: 'Notas Iara', dataType: 'LARGE_TEXT' },
};

export async function refreshCustomFieldsCache() {
  try {
    const r = await GHL.listCustomFields();
    const fields = r.customFields || r || [];
    const byKey = {};
    for (const f of fields) {
      const key = (f.fieldKey || f.key || f.name || '').toLowerCase().replace(/\s+/g, '_');
      byKey[key] = f;
    }
    CACHE = byKey;
    logger.info({ count: fields.length }, 'custom fields GHL carregados');
    return byKey;
  } catch (err) {
    logger.warn({ err: err.message }, 'não consegui listar custom fields do GHL (seguindo sem cache)');
    CACHE = {};
    return CACHE;
  }
}

export async function getCustomFieldId(key) {
  if (!CACHE) await refreshCustomFieldsCache();
  const f = CACHE[key];
  return f ? (f.id || f.fieldKey) : null;
}

// Escreve funnel/score/notes no contato no GHL
// Se os custom fields não existirem, loga e segue (não quebra o fluxo).
export async function writeQualificationFields(ghlContactId, { funnel, score, notes }) {
  const updates = [];

  for (const [key, value] of Object.entries({ funnel_lc: funnel, iara_score: score, iara_notes: notes })) {
    if (value === undefined || value === null) continue;
    const id = await getCustomFieldId(key);
    if (!id) {
      logger.warn({ key }, `custom field "${key}" não existe na location — pule ou crie manualmente`);
      continue;
    }
    updates.push({ id, field_value: value });
  }

  if (!updates.length) return;
  try {
    await GHL.upsertCustomFields(ghlContactId, updates);
  } catch (err) {
    logger.error({ err: err.message, updates }, 'falha ao gravar custom fields');
  }
}
