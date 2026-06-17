// Lista os grupos da instância uazapi (pra achar o JID do grupo do time).
// Uso (no container do lcsdr, com UAZAPI_TOKEN já no .env apontando pra
// instância que está no grupo — ex.: LCbooks):
//   node scripts/uazapi-groups.js
//
// Imprime nome + id (@g.us) de cada grupo. Copie o id pro UAZAPI_NOTIFY_GROUP.
import 'dotenv/config';
import fetch from 'node-fetch';

const BASE = (process.env.UAZAPI_BASE || 'https://liaautomacoes.uazapi.com').replace(/\/$/, '');
const TOKEN = process.env.UAZAPI_TOKEN;
if (!TOKEN) {
  console.error('❌ UAZAPI_TOKEN ausente no .env (use o token da instância que está no grupo).');
  process.exit(1);
}

// uazapi varia o endpoint conforme a versão — tenta os mais prováveis e para no 1º que devolve grupos.
const tentativas = [
  ['GET', '/group/list'],
  ['POST', '/group/list'],
  ['GET', '/chat/list'],
  ['POST', '/chat/list'],
  ['POST', '/group/getAll'],
];

function acharGrupos(data) {
  const arr = Array.isArray(data) ? data : (data.groups || data.chats || data.data || data.result || []);
  if (!Array.isArray(arr)) return [];
  return arr.filter(g => JSON.stringify(g).includes('@g.us'));
}

let achou = false;
for (const [method, path] of tentativas) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { token: TOKEN, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: method === 'POST' ? '{}' : undefined,
    });
    const text = await res.text();
    if (!res.ok) {
      console.log(`· ${method} ${path} → ${res.status} (pulando)`);
      continue;
    }
    let data; try { data = JSON.parse(text); } catch { console.log(`· ${method} ${path} → resposta não-JSON`); continue; }
    const grupos = acharGrupos(data);
    if (grupos.length) {
      console.log(`\n✅ ${grupos.length} grupo(s) via ${method} ${path}:\n`);
      grupos.forEach(g => {
        const nome = g.name || g.subject || g.title || g.Name || '(sem nome)';
        const id = g.id || g.jid || g.chatid || g.wa_chatid || g.JID || '?';
        console.log(`  • ${nome}\n      JID: ${id}\n`);
      });
      console.log('👉 Copie o JID do grupo do time pro UAZAPI_NOTIFY_GROUP no .env.');
      achou = true;
      break;
    }
    console.log(`· ${method} ${path} → 200, mas sem grupos óbvios. Resposta crua:\n${text.slice(0, 600)}\n`);
  } catch (err) {
    console.log(`· ${method} ${path} → erro: ${err.message}`);
  }
}

if (!achou) {
  console.log('\n⚠ Não consegui listar grupos automaticamente. Alternativa: pegue o JID no painel do uazapi (lista de grupos) — termina em @g.us.');
}
