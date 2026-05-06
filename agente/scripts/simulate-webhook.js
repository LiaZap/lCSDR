// Simula um webhook do GHL localmente, pra testar o fluxo da Iara sem esperar lead real.
// Uso: node scripts/simulate-webhook.js <ghl_contact_id> "mensagem do lead"

import 'dotenv/config';
import fetch from 'node-fetch';

const [,, contactId, ...rest] = process.argv;
const body = rest.join(' ') || 'Oi, quero saber mais sobre publicação de livro.';

if (!contactId) {
  console.log('Uso: node scripts/simulate-webhook.js <ghl_contact_id> "texto"');
  process.exit(1);
}

const payload = {
  type: 'InboundMessage',
  locationId: process.env.GHL_LOCATION_ID,
  messageId: `sim-${Date.now()}`,
  contactId,
  conversationId: `conv-sim-${contactId}`,
  direction: 'inbound',
  messageType: 'WhatsApp',
  body,
  attachments: [],
  dateAdded: new Date().toISOString(),
};

const url = (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3333}`) + '/webhook/ghl';

console.log('→ POST', url);
console.log(JSON.stringify(payload, null, 2));

const r = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});
console.log('← status', r.status, await r.text());
