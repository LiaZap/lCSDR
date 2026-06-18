import fetch from 'node-fetch';
import { logger } from '../utils/logger.js';

const BASE = process.env.GHL_API_BASE || 'https://services.leadconnectorhq.com';
const VERSION = process.env.GHL_API_VERSION || '2021-07-28';

// === Auth ===
// Suporta Private Integration Token (PIT, começa com `pit-`) e OAuth access_token.
// PIT é o mais simples; OAuth só faz sentido se for app de Marketplace.
function authHeader() {
  const tok = process.env.GHL_API_TOKEN;
  if (!tok) throw new Error('GHL_API_TOKEN ausente no .env');
  return `Bearer ${tok}`;
}

function headers() {
  return {
    Authorization: authHeader(),
    Version: VERSION,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

// === Retry com backoff para 429/5xx ===
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function ghl(method, path, body, { retries = 3 } = {}) {
  const url = `${BASE}${path}`;
  let lastErr;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers: headers(),
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      let json;
      try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }

      if (res.ok) return json;

      // 429 → respeita retry-after se vier; senão backoff exponencial
      if (res.status === 429 && attempt < retries) {
        const ra = Number(res.headers.get('retry-after')) || (2 ** attempt);
        logger.warn({ path, attempt, waitSec: ra }, 'GHL 429 rate limit, tentando de novo');
        await sleep(ra * 1000);
        continue;
      }

      // 5xx transiente → tenta de novo
      if (res.status >= 500 && res.status < 600 && attempt < retries) {
        logger.warn({ path, attempt, status: res.status }, 'GHL 5xx, retry');
        await sleep((2 ** attempt) * 500);
        continue;
      }

      // erro não-retryable
      logger.error({ method, path, status: res.status, body: json }, 'GHL API error');
      const err = new Error(`GHL ${method} ${path} → ${res.status}`);
      err.status = res.status;
      err.body = json;
      throw err;
    } catch (err) {
      lastErr = err;
      if (err.status) throw err;  // erro HTTP já tratado
      // erro de rede → retry
      if (attempt < retries) {
        logger.warn({ path, attempt, err: err.message }, 'GHL network error, retry');
        await sleep((2 ** attempt) * 500);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

// === Download autenticado (attachments) ===
// GHL serve anexos em URLs que exigem o mesmo Bearer token.
export async function downloadAttachment(url) {
  const res = await fetch(url, { headers: { Authorization: authHeader() } });
  if (!res.ok) throw new Error(`GHL attachment ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export const GHL = {
  // === CONTATOS ===
  async getContact(contactId) {
    const r = await ghl('GET', `/contacts/${contactId}`);
    return r.contact || r;
  },
  async findContactByPhone(phone) {
    const q = new URLSearchParams({
      locationId: process.env.GHL_LOCATION_ID,
      query: phone,
    });
    return ghl('GET', `/contacts/?${q}`);
  },
  // Cria OU atualiza contato por telefone/email. Retorna { contact, new }.
  // Usado pra sincronizar leads que entram pela uazapi (WhatsApp) com o GHL.
  async upsertContact({ phone, email, name, firstName, lastName, source, tags } = {}) {
    const body = { locationId: process.env.GHL_LOCATION_ID };
    if (phone) body.phone = phone;
    if (email) body.email = email;
    if (name) body.name = name;
    if (firstName) body.firstName = firstName;
    if (lastName) body.lastName = lastName;
    if (source) body.source = source;
    if (tags && tags.length) body.tags = tags;
    return ghl('POST', '/contacts/upsert', body);
  },
  async updateContact(contactId, patch) {
    return ghl('PUT', `/contacts/${contactId}`, patch);
  },
  async upsertCustomFields(contactId, fields) {
    // fields: [{ id?: string, key?: string, field_value: any }]
    return ghl('PUT', `/contacts/${contactId}`, { customFields: fields });
  },
  async addTag(contactId, tags) {
    return ghl('POST', `/contacts/${contactId}/tags`, { tags: Array.isArray(tags) ? tags : [tags] });
  },
  async removeTag(contactId, tags) {
    return ghl('DELETE', `/contacts/${contactId}/tags`, { tags: Array.isArray(tags) ? tags : [tags] });
  },
  async assignContact(contactId, userId) {
    return ghl('PUT', `/contacts/${contactId}`, { assignedTo: userId });
  },

  // === CONVERSAS / MENSAGENS ===
  async sendMessage({ contactId, message, type = 'WhatsApp', attachments = [] }) {
    const payload = { type, contactId, message };
    if (attachments.length) payload.attachments = attachments;
    return ghl('POST', '/conversations/messages', payload);
  },
  async searchConversations(contactId) {
    const q = new URLSearchParams({
      contactId,
      locationId: process.env.GHL_LOCATION_ID,
    });
    return ghl('GET', `/conversations/search?${q}`);
  },
  async getMessages(conversationId, { limit = 100 } = {}) {
    return ghl('GET', `/conversations/${conversationId}/messages?limit=${limit}`);
  },

  // === CALENDÁRIO ===
  async listCalendars() {
    return ghl('GET', `/calendars/?locationId=${process.env.GHL_LOCATION_ID}`);
  },
  async getFreeSlots(calendarId, { startDate, endDate, timezone = 'America/Sao_Paulo' }) {
    const q = new URLSearchParams({ startDate, endDate, timezone });
    return ghl('GET', `/calendars/${calendarId}/free-slots?${q}`);
  },
  async bookAppointment({ calendarId, contactId, startTime, endTime, title, notes, assignedUserId }) {
    return ghl('POST', '/calendars/events/appointments', {
      calendarId,
      locationId: process.env.GHL_LOCATION_ID,
      contactId,
      startTime,
      endTime,
      title,
      appointmentStatus: 'confirmed',
      notes,
      ...(assignedUserId ? { assignedUserId } : {}),
    });
  },
  async deleteAppointment(eventId) {
    return ghl('DELETE', `/calendars/events/${eventId}`);
  },
  // Reuniões do contato (pra evitar double-booking). Retorna { events: [...] }.
  async getContactAppointments(contactId) {
    return ghl('GET', `/contacts/${contactId}/appointments`);
  },
  async deleteContact(contactId) {
    return ghl('DELETE', `/contacts/${contactId}`);
  },

  // === PIPELINES / OPORTUNIDADES ===
  async listPipelines() {
    return ghl('GET', `/opportunities/pipelines?locationId=${process.env.GHL_LOCATION_ID}`);
  },
  async createOpportunity({ pipelineId, stageId, contactId, name, monetaryValue = 0, assignedTo, status = 'open' }) {
    return ghl('POST', '/opportunities/', {
      pipelineId,
      locationId: process.env.GHL_LOCATION_ID,
      name: name || 'Lead qualificado (Iara)',
      pipelineStageId: stageId,
      contactId,
      monetaryValue,
      status,
      ...(assignedTo ? { assignedTo } : {}),
    });
  },
  async updateOpportunity(opportunityId, patch) {
    return ghl('PUT', `/opportunities/${opportunityId}`, patch);
  },
  async getOpportunitiesByContact(contactId) {
    const q = new URLSearchParams({
      location_id: process.env.GHL_LOCATION_ID,
      contact_id: contactId,
    });
    return ghl('GET', `/opportunities/search?${q}`);
  },

  // === USUÁRIOS ===
  async listUsers() {
    return ghl('GET', `/users/?locationId=${process.env.GHL_LOCATION_ID}`);
  },
  async getUserByEmail(email) {
    const r = await this.listUsers();
    const users = r.users || r || [];
    return users.find(u => (u.email || '').toLowerCase() === email.toLowerCase()) || null;
  },

  // === CUSTOM FIELDS (listar os definidos na location) ===
  async listCustomFields() {
    return ghl('GET', `/locations/${process.env.GHL_LOCATION_ID}/customFields`);
  },
};

export default GHL;
