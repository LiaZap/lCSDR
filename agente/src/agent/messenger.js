// Dispatcher de canal: decide se envia via uazapi ou GHL.
// - Se UAZAPI_TOKEN setado → uazapi (canal nativo brasileiro, suporta botões interativos)
// - Senão → GHL sendMessage (canal genérico, sem botões nativos)
//
// Mantém uma interface única pro restante do código não se preocupar com canal.

import { UAZAPI, normalizePhone } from '../uazapi/client.js';
import { GHL } from '../ghl/client.js';
import { logger } from '../utils/logger.js';

export function preferredChannel() {
  return process.env.UAZAPI_TOKEN ? 'uazapi' : 'ghl';
}

/**
 * Envia mensagem de texto pro lead.
 * @param {object} contact — {ghl_contact_id, phone, name}
 * @param {string} text
 * @param {object} [opts] — {ghlChannelType?: 'WhatsApp'|'SMS'|...}
 */
export async function sendText(contact, text, opts = {}) {
  if (preferredChannel() === 'uazapi') {
    const number = normalizePhone(contact.phone);
    if (!number) throw new Error(`contato sem phone válido: ${contact.id}`);
    return UAZAPI.sendText(number, text);
  }
  return GHL.sendMessage({
    contactId: contact.ghl_contact_id,
    message: text,
    type: opts.ghlChannelType || 'WhatsApp',
  });
}

/**
 * Envia menu com botões interativos.
 * choices: array de strings "Label|valor" (formato uazapi)
 * Quando canal não suporta (GHL), faz fallback pra texto numerado.
 */
export async function sendMenu(contact, { text, choices, footerText, type = 'button' }) {
  if (preferredChannel() === 'uazapi') {
    const number = normalizePhone(contact.phone);
    if (!number) throw new Error(`contato sem phone válido: ${contact.id}`);
    return UAZAPI.sendMenu({ number, text, choices, footerText, type });
  }
  // Fallback GHL: vira texto formatado em lista numerada
  const lines = choices.map((c, i) => {
    const [label] = c.split('|');
    return `${i + 1}. ${label.trim()}`;
  });
  const fallbackText = [text, '', ...lines, footerText && `\n_${footerText}_`].filter(Boolean).join('\n');
  return GHL.sendMessage({
    contactId: contact.ghl_contact_id,
    message: fallbackText,
    type: 'WhatsApp',
  });
}

/**
 * Envia múltiplas mensagens em sequência (split de bolhas).
 * Aceita formato:
 *   - string                            → manda como texto
 *   - {text, buttons?:[{label,value}]}  → texto, ou menu se tiver buttons
 */
export async function sendSequence(contact, items) {
  for (const item of items) {
    if (!item) continue;
    try {
      if (typeof item === 'string') {
        await sendText(contact, item);
      } else if (item.buttons && item.buttons.length) {
        const choices = item.buttons.map(b => `${b.label}|${b.value || b.label}`);
        await sendMenu(contact, {
          text: item.text,
          choices,
          footerText: item.footerText,
          type: item.buttons.length > 3 ? 'list' : 'button',
        });
      } else if (item.text) {
        await sendText(contact, item.text);
      }
      // Pausa pequena entre bolhas pra parecer humano
      await new Promise(r => setTimeout(r, 600));
    } catch (err) {
      logger.error({ err: err.message, contactId: contact.id }, 'falha enviando mensagem');
    }
  }
}
