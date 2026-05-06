import fetch from 'node-fetch';
import FormData from 'form-data';
import { logger } from './logger.js';

// Usa Whisper (OpenAI) apenas pra transcrever áudio. Robusto e barato.
// Expõe duas formas: pela URL (baixa sem auth) e por Buffer (quando já baixamos com auth GHL).

export async function transcribeAudioBuffer(buffer, { filename = 'audio.ogg', mime = 'audio/ogg' } = {}) {
  if (!process.env.OPENAI_API_KEY) {
    logger.warn('OPENAI_API_KEY ausente — transcrição pulada');
    return null;
  }
  try {
    const form = new FormData();
    form.append('file', buffer, { filename, contentType: mime });
    form.append('model', 'whisper-1');
    form.append('language', 'pt');

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, ...form.getHeaders() },
      body: form,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`whisper ${res.status}: ${body}`);
    }
    const json = await res.json();
    return json.text || null;
  } catch (err) {
    logger.error({ err: err.message }, 'Falha na transcrição Whisper');
    return null;
  }
}

export async function transcribeAudio(audioUrl) {
  try {
    const r = await fetch(audioUrl);
    if (!r.ok) throw new Error(`download áudio ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    return transcribeAudioBuffer(buf);
  } catch (err) {
    logger.error({ err: err.message }, 'Falha ao baixar áudio');
    return null;
  }
}
