// Migração one-time: move pra coluna "IA Tina" os leads que a Tina está
// ATENDENDO agora (stage local pre_qualificando/qualificando, IA ativa).
// Pula quem tem CONSULTOR ativo (último outbound de um SDR conhecido, recente) e
// quem está em outro pipeline (claimToIaTina só reorganiza dentro do Pré-Vendas LCA).
//
// Uso (no container do lcsdr):
//   node scripts/mover-ia-tina.js          → DRY-RUN (só lista)
//   node scripts/mover-ia-tina.js --send   → move de verdade
import 'dotenv/config';
import { db } from '../src/db/index.js';
import { GHL } from '../src/ghl/client.js';
import { claimToIaTina } from '../src/ghl/opportunities.js';

const SEND = process.argv.includes('--send');
const AUTO = new Set(['workflow', 'campaign', 'bulk_actions', 'bulk', 'automation']);

const WINDOW_DAYS = Number(process.env.MOVER_HUMAN_DAYS || 7);
const isSdr = uid => !!uid && !!db.prepare('SELECT 1 FROM sdr_users WHERE ghl_user_id = ?').get(uid);
// Decide se PULA o lead (consultor envolvido). Dois sinais, numa busca só:
//  - aposTina: um SDR conhecido respondeu DEPOIS da última msg da Tina (assumiu);
//  - recente:  algum SDR conhecido falou nos últimos N dias (co-atendimento).
// Tina = outbound com corpo de texto e SEM userId de SDR (ela manda com uid nulo).
async function consultorEnvolvido(g) {
  try {
    const cv = await GHL.searchConversations(g);
    const conv = cv?.conversations?.[0] || cv?.[0];
    if (!conv?.id) return { skip: false };
    const m = await GHL.getMessages(conv.id, { limit: 30 });
    const ms = m?.messages?.messages || m?.messages || m || [];
    const limite = Date.now() - WINDOW_DAYS * 864e5;
    let tinaMax = 0, sdrMax = 0, recente = false;
    for (const x of ms) {
      if ((x.direction || '').toLowerCase() !== 'outbound') continue;
      if (AUTO.has(String(x.source || '').toLowerCase())) continue; // ignora workflow/automação
      const ts = new Date(x.dateAdded || x.createdAt || 0).getTime();
      if (isSdr(x.userId || x.user_id)) { if (ts > sdrMax) sdrMax = ts; if (ts > limite) recente = true; }
      else if (String(x.body || '').trim()) { if (ts > tinaMax) tinaMax = ts; } // Tina
    }
    const aposTina = sdrMax > 0 && sdrMax >= tinaMax; // consultor respondeu depois (ou junto) da Tina
    return { skip: aposTina || recente, aposTina, recente };
  } catch { return { skip: false }; }
}

const rows = db.prepare(`
  SELECT id, ghl_contact_id g, name, stage
  FROM contacts
  WHERE stage IN ('pre_qualificando','qualificando')
    AND ai_paused = 0
    AND ghl_contact_id IS NOT NULL
    AND ghl_contact_id NOT LIKE 'test%'
    AND ghl_contact_id NOT LIKE 'demo%'
    AND ghl_contact_id NOT LIKE '%-%'   -- ids reais do GHL não têm hífen (descarta seed/demo)
  ORDER BY updated_at DESC
`).all();

console.log(`\n${rows.length} leads que a Tina está atendendo (ativos). Avaliando...\n`);
let movidos = 0, pulHuman = 0;
for (const r of rows) {
  const ce = await consultorEnvolvido(r.g);
  if (ce.skip) { pulHuman++; console.log(`  ⏭️  ${(r.name || '?').slice(0, 22).padEnd(22)} | pula (${ce.aposTina ? 'consultor após Tina' : 'consultor recente'})`); continue; }
  if (SEND) {
    const id = await claimToIaTina({ id: r.id, ghl_contact_id: r.g, name: r.name }).catch(() => null);
    console.log(`  ✅ ${(r.name || '?').slice(0, 22).padEnd(22)} | movido p/ IA Tina${id ? '' : ' (sem efeito)'}`);
    movidos++;
  } else {
    console.log(`  • (dry) ${(r.name || '?').slice(0, 22).padEnd(22)} | iria p/ IA Tina`);
  }
}

console.log(`\n──────── resumo ────────`);
console.log(`Ativos: ${rows.length} | ${SEND ? 'movidos: ' + movidos : 'iriam mover: ' + (rows.length - pulHuman)} | pulados (consultor ativo): ${pulHuman}`);
if (!SEND) console.log(`\n(DRY-RUN) Rode com --send pra mover de verdade.`);
