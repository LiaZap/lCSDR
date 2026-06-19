// Dispatcher de canal: decide se envia via uazapi ou GHL.
// - Se UAZAPI_TOKEN setado → uazapi (canal nativo brasileiro, suporta botões interativos)
// - Senão → GHL sendMessage (canal genérico, sem botões nativos)
//
// Mantém uma interface única pro restante do código não se preocupar com canal.

import { UAZAPI, normalizePhone } from '../uazapi/client.js';
import { GHL } from '../ghl/client.js';
import { logger } from '../utils/logger.js';

export function preferredChannel() {
  // Canal de ATENDIMENTO do lead. Default = GHL/Meta oficial.
  // ATENÇÃO: ter UAZAPI_TOKEN setado é SÓ pros avisos no grupo (notify.js usa o
  // uazapi direto) — NÃO deve trocar o canal do lead. Antes, a mera presença do
  // token jogava TODA resposta da Tina pro número uazapi (lead recebia de outro
  // número, e a conversa sumia do GHL). Agora só usa uazapi pro lead se for
  // explicitamente pedido (LEAD_CHANNEL=uazapi) ou se o inbound do uazapi estiver
  // ligado (UAZAPI_INBOUND_ENABLED=true) — aí entra e sai pelo mesmo número.
  const explicit = (process.env.LEAD_CHANNEL || '').toLowerCase();
  if (explicit === 'uazapi' || explicit === 'ghl') return explicit;
  return process.env.UAZAPI_INBOUND_ENABLED === 'true' ? 'uazapi' : 'ghl';
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
  // Retorna o nº de bolhas REALMENTE enviadas. Callers que só querem disparar
  // ignoram o retorno (comportamento inalterado); quem precisa saber se algo
  // saiu (ex.: continuidade IA Tina) checa o contador pra não gravar/contabilizar
  // um envio que falhou.
  let sent = 0;
  for (const item of items) {
    if (!item) continue;
    try {
      let delivered = false;
      if (typeof item === 'string') {
        await sendText(contact, item);
        delivered = true;
      } else if (item.buttons && item.buttons.length) {
        const choices = item.buttons.map(b => `${b.label}|${b.value || b.label}`);
        await sendMenu(contact, {
          text: item.text,
          choices,
          footerText: item.footerText,
          type: item.buttons.length > 3 ? 'list' : 'button',
        });
        delivered = true;
      } else if (item.text) {
        await sendText(contact, item.text);
        delivered = true;
      }
      if (delivered) {
        sent++;
        // Pausa pequena entre bolhas pra parecer humano
        await new Promise(r => setTimeout(r, 600));
      }
    } catch (err) {
      logger.error({ err: err.message, contactId: contact.id }, 'falha enviando mensagem');
    }
  }
  return sent;
}
