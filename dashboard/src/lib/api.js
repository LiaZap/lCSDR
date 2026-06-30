const TOKEN_KEY = 'lc_sdr_token';
const USER_KEY = 'lc_sdr_user';

export function getToken() { return localStorage.getItem(TOKEN_KEY); }
export function getUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
}
export function setSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}
export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

async function request(path, opts = {}) {
  const token = getToken();
  const res = await fetch(path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401) {
    clearSession();
    if (typeof window !== 'undefined') window.location.hash = '#/login';
  }
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

export const api = {
  login(email, password) {
    return request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  },
  metrics(q = 'days=7') {
    return request(`/api/metrics?${q}`);
  },
  atendidos(q = 'days=7') {
    return request(`/api/atendidos?${q}`);
  },
  agendados(q = 'days=7') {
    return request(`/api/agendados?${q}`);
  },
  contacts(filters = {}) {
    const qs = new URLSearchParams(Object.entries(filters).filter(([_, v]) => v)).toString();
    return request(`/api/contacts?${qs}`);
  },
  contact(id) {
    return request(`/api/contacts/${id}`);
  },
  assume(id) {
    return request(`/api/contacts/${id}/assume`, { method: 'POST' });
  },
  setStage(id, stage) {
    return request(`/api/contacts/${id}/stage`, {
      method: 'PUT',
      body: JSON.stringify({ stage }),
    });
  },
  feedback(contactId, verdict, comment) {
    return request(`/api/contacts/${contactId}/feedback`, {
      method: 'POST',
      body: JSON.stringify({ verdict, comment }),
    });
  },
  feedbacks(verdict) {
    const qs = verdict ? `?verdict=${verdict}` : '';
    return request(`/api/feedback${qs}`);
  },
  feedbackSummary() {
    return request('/api/feedback/summary');
  },
  release(id) {
    return request(`/api/contacts/${id}/release`, { method: 'POST' });
  },
  send(id, message) {
    return request(`/api/contacts/${id}/send`, { method: 'POST', body: JSON.stringify({ message }) });
  },
  sdrs() { return request('/api/sdrs'); },

  // === Feedback humano (single source of truth) ===
  // (definição original em feedback() acima, na linha 61 — esta seção
  // duplicata foi removida e substituída por aliases pra compat)
  feedbackList(verdict) {
    const qs = verdict ? `?verdict=${verdict}` : '';
    return request(`/api/feedback${qs}`);
  },

  // === Admin: custo da IA ao vivo (admin only no backend) ===
  costNow() { return request('/api/admin/cost-now'); },

  // === Playground ===
  playground: {
    newSession() {
      return request('/api/playground/sessions/new', { method: 'POST' });
    },
    sessions() {
      return request('/api/playground/sessions');
    },
    session(sessionId) {
      return request(`/api/playground/sessions/${sessionId}`);
    },
    chat(sessionId, message, userName) {
      return request('/api/playground/chat', {
        method: 'POST',
        body: JSON.stringify({ sessionId, message, userName }),
      });
    },
    delete(sessionId) {
      return request(`/api/playground/sessions/${sessionId}`, { method: 'DELETE' });
    },
  },
};
