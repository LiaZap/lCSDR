-- Schema do banco do agente SDR da LC
-- Design: só guardamos o que o dashboard precisa ou o que não está no GHL.
-- GHL continua sendo a fonte da verdade para contato/oportunidade.

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ghl_contact_id TEXT UNIQUE NOT NULL,
  name TEXT,
  phone TEXT,
  email TEXT,
  funnel TEXT,                    -- escrever | publicar | divulgar | indefinido
  stage TEXT,                     -- novo | pre_qualificando | qualificando | qualificado | desqualificado | agendado | handoff
  qualification_score INTEGER DEFAULT 0,
  qualification_notes TEXT,
  assigned_sdr_id INTEGER,        -- FK sdr_users.id quando SDR assume
  ai_paused INTEGER DEFAULT 0,    -- 1 = IA pausada (SDR tomou conta)
  ai_paused_at DATETIME,
  last_inbound_at DATETIME,
  last_outbound_at DATETIME,
  -- Origem/campanha (fase 2): rastreio de qual campanha trouxe o lead
  -- Ex: "curso_admiraveis_nov", "imersao_sp_jan", "press_lc_organic"
  campaign_source TEXT,
  campaign_tags TEXT,             -- JSON array: ["curso_admiraveis","novembro_2026"]
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_contacts_stage ON contacts(stage);
CREATE INDEX IF NOT EXISTS idx_contacts_funnel ON contacts(funnel);
CREATE INDEX IF NOT EXISTS idx_contacts_sdr ON contacts(assigned_sdr_id);
-- Índices adicionais pra queries do dashboard (filtro temporal + dedup webhook)
CREATE INDEX IF NOT EXISTS idx_contacts_created ON contacts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone);
CREATE INDEX IF NOT EXISTS idx_contacts_updated ON contacts(updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL,
  ghl_message_id TEXT,
  direction TEXT NOT NULL,        -- inbound | outbound
  author TEXT NOT NULL,           -- lead | ia | sdr
  sdr_id INTEGER,                 -- preenchido se author=sdr
  content TEXT,
  content_type TEXT DEFAULT 'text', -- text | audio_transcript | image | pdf_blocked
  raw_attachment_url TEXT,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages(contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_ghl_id ON messages(ghl_message_id);

CREATE TABLE IF NOT EXISTS sdr_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'sdr',        -- sdr | closer | admin
  ghl_user_id TEXT,               -- id do usuário no GHL (para linkar handoff)
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL,
  ghl_appointment_id TEXT,
  scheduled_at DATETIME NOT NULL,
  calendar_id TEXT,
  status TEXT DEFAULT 'booked',   -- booked | canceled | completed | noshow
  created_by TEXT DEFAULT 'ia',   -- ia | sdr
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS followups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL,
  due_at DATETIME NOT NULL,
  sent INTEGER DEFAULT 0,
  reason TEXT,                    -- silencio_lead | silencio_sdr | retomar_script
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_followups_due ON followups(due_at, sent);

CREATE TABLE IF NOT EXISTS events_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER,
  kind TEXT NOT NULL,             -- webhook_in | ia_reply | handoff | followup_sent | error
  payload TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Feedback humano sobre conversas (Lilian/Bruna marcam tom OK / errado / corrige)
-- Vira insumo pra refinamento contínuo do prompt
CREATE TABLE IF NOT EXISTS conversation_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL,
  reviewer_id INTEGER NOT NULL,         -- FK sdr_users.id (quem revisou)
  verdict TEXT NOT NULL,                 -- 'tom_ok' | 'tom_errado' | 'corrigir'
  comment TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewer_id) REFERENCES sdr_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_feedback_contact ON conversation_feedback(contact_id);
CREATE INDEX IF NOT EXISTS idx_feedback_verdict ON conversation_feedback(verdict);

-- Dedup de webhooks (uazapi reentrega sem ack confiável → não pode processar 2x)
CREATE TABLE IF NOT EXISTS processed_webhook_ids (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,                 -- 'uazapi' | 'ghl' etc
  message_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source, message_id)
);
CREATE INDEX IF NOT EXISTS idx_processed_webhook_created ON processed_webhook_ids(created_at);

-- Métricas diárias pré-agregadas (opcional, útil pro dashboard)
CREATE TABLE IF NOT EXISTS daily_metrics (
  day TEXT PRIMARY KEY,           -- YYYY-MM-DD
  leads_total INTEGER DEFAULT 0,
  leads_qualified INTEGER DEFAULT 0,
  leads_disqualified INTEGER DEFAULT 0,
  appointments_booked INTEGER DEFAULT 0,
  messages_in INTEGER DEFAULT 0,
  messages_out INTEGER DEFAULT 0,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0
);
