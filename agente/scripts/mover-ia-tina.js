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
// Consultor envolvido? QUALQUER outbound da conversa (não só o último) de um SDR
// conhecido, nos últimos N dias. Pega o caso de a Tina ter mandado a última msg
// mas um humano ter falado com o lead antes/depois (co-atendimento).
async function humanTouched(g) {
  try {
    const cv = await GHL.searchConversations(g);
    const conv = cv?.conversations?.[0] || cv?.[0];
    if (!conv?.id) return false;
    const m = await GHL.getMessages(conv.id, { limit: 30 });
    const ms = m?.messages?.messages || m?.messages || m || [];
    const limite = Date.now() - WINDOW_DAYS * 864e5;
    return ms.some(x => {
      if ((x.direction || '').toLowerCase() !== 'outbound') return false;
      const uid = x.userId || x.user_id;
      if (!uid || AUTO.has(String(x.source || '').toLowerCase())) return false;
      if (!db.prepare('SELECT 1 FROM sdr_users WHERE ghl_user_id = ?').get(uid)) return false; // não é SDR conhecido
      const ts = new Date(x.dateAdded || x.createdAt || 0).getTime();
      return ts > limite; // SDR falou recentemente
    });
  } catch { return false; }
}

const rows = db.prepare(`
  SELECT id, ghl_contact_id g, name, stage
  FROM contacts
  WHERE stage IN ('pre_qualificando','qualificando')
    AND ai_paused = 0
    AND ghl_contact_id IS NOT NULL AND ghl_contact_id NOT LIKE 'test%'
  ORDER BY updated_at DESC
`).all();

console.log(`\n${rows.length} leads que a Tina está atendendo (ativos). Avaliando...\n`);
let movidos = 0, pulHuman = 0;
for (const r of rows) {
  if (await humanTouched(r.g)) { pulHuman++; console.log(`  ⏭️  ${(r.name || '?').slice(0, 22).padEnd(22)} | consultor falou (${WINDOW_DAYS}d), pula`); continue; }
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
