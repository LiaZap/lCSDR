// Lista todos os pipelines e stages do GHL com seus IDs — pra configurar:
//   GHL_BLOCK_OPP_STAGES   = stages do TIME que a Tina NÃO atende (Reentrada,
//                            Closers, Editorial, Proposta, Follow Up...) — CSV de ids
//   GHL_TINA_LANE_STAGES   = funis de ENTRADA que ela DEVE atender (opcional)
//
// Uso (no container do lcsdr):  node scripts/listar-stages.js
import 'dotenv/config';
import { GHL } from '../src/ghl/client.js';

if (!process.env.GHL_API_TOKEN || !process.env.GHL_LOCATION_ID) {
  console.error('GHL_API_TOKEN/GHL_LOCATION_ID ausentes');
  process.exit(1);
}

const r = await GHL.listPipelines();
const pipelines = r?.pipelines || (Array.isArray(r) ? r : []);
if (!pipelines.length) { console.log('Nenhum pipeline retornado.'); process.exit(0); }

console.log('\n════ PIPELINES & STAGES (GHL) ════');
for (const p of pipelines) {
  console.log(`\n📂 ${p.name || '(sem nome)'}   (pipeline id: ${p.id})`);
  for (const s of (p.stages || [])) {
    console.log(`   • ${String(s.name || '?').padEnd(30)} ${s.id}`);
  }
}

console.log('\n──────────────────────────────────────');
console.log('Pra a Tina NÃO atender os funis do time: copie os IDs das stages');
console.log('do time (Reentrada/Closers/Editorial/Proposta/Follow Up/Aplicação) e');
console.log('cole em GHL_BLOCK_OPP_STAGES (separados por vírgula) no .env/easypanel.\n');
