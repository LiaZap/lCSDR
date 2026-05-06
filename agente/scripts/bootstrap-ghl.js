// Sincroniza IDs importantes do GHL com o banco local / .env sugerido.
// Uso: node scripts/bootstrap-ghl.js
//
// Detecta:
//  - Custom fields existentes (e avisa se os esperados pela Iara não existem)
//  - Pipeline "LC Autor" ou primeiro pipeline com stage "Qualificado"
//  - Linka SDRs locais com usuários GHL pelo e-mail

import 'dotenv/config';
import { GHL } from '../src/ghl/client.js';
import { db } from '../src/db/index.js';

const EXPECTED_FIELDS = {
  funnel_lc: 'Dropdown (escrever / publicar / divulgar)',
  iara_score: 'Number (0-100)',
  iara_notes: 'Multi-line text',
};

async function checkCustomFields() {
  console.log('\n▶ Custom fields');
  const r = await GHL.listCustomFields();
  const fields = r.customFields || r || [];
  const byKey = {};
  fields.forEach(f => {
    const key = (f.fieldKey || f.key || f.name || '').toLowerCase().replace(/\s+/g, '_');
    byKey[key] = f;
  });

  let missing = 0;
  for (const [key, desc] of Object.entries(EXPECTED_FIELDS)) {
    if (byKey[key]) console.log(`  ✓ ${key} (${byKey[key].name})`);
    else { console.log(`  ✗ ${key} — FALTANDO. Criar manualmente: ${desc}`); missing++; }
  }
  if (missing) console.log(`\n  ⚠ Crie os ${missing} custom field(s) em: Settings → Custom Fields → Contact`);
}

async function checkPipeline() {
  console.log('\n▶ Pipelines');
  const r = await GHL.listPipelines();
  const pipes = r.pipelines || r || [];
  if (!pipes.length) return console.log('  ✗ Nenhum pipeline. Crie um em: Opportunities → Settings → Pipelines');

  pipes.forEach(p => {
    const hasQual = (p.stages || []).find(s => /qualif/i.test(s.name));
    console.log(`  • ${p.name} (${p.id})`);
    (p.stages || []).forEach(s => console.log(`      └ ${s.name} (${s.id})${hasQual && hasQual.id === s.id ? '  ← stage qualificado' : ''}`));
  });

  const pick = pipes[0];
  const qStage = (pick.stages || []).find(s => /qualif/i.test(s.name)) || pick.stages?.[0];
  console.log('\n  Sugestão .env:');
  console.log(`    GHL_PIPELINE_ID=${pick.id}`);
  if (qStage) console.log(`    GHL_PIPELINE_STAGE_QUALIFIED=${qStage.id}`);
}

async function linkSDRUsers() {
  console.log('\n▶ Linkando SDRs locais com usuários GHL pelo e-mail');
  const r = await GHL.listUsers();
  const ghlUsers = r.users || r || [];
  const sdrs = db.prepare('SELECT id, name, email, ghl_user_id FROM sdr_users').all();

  if (!sdrs.length) return console.log('  (nenhum SDR no banco ainda — use `npm run init-db` e adicione)');

  for (const sdr of sdrs) {
    const gu = ghlUsers.find(u => (u.email || '').toLowerCase() === sdr.email.toLowerCase());
    if (gu && !sdr.ghl_user_id) {
      db.prepare('UPDATE sdr_users SET ghl_user_id = ? WHERE id = ?').run(gu.id, sdr.id);
      console.log(`  ✓ ${sdr.email} → GHL user ${gu.id}`);
    } else if (gu) {
      console.log(`  = ${sdr.email} já linkado (${sdr.ghl_user_id})`);
    } else {
      console.log(`  ✗ ${sdr.email} não encontrado no GHL`);
    }
  }
}

async function main() {
  await checkCustomFields();
  await checkPipeline();
  await linkSDRUsers();
  console.log('\n✅ Bootstrap concluído.');
}

main().catch(err => {
  console.error('❌', err.message);
  if (err.body) console.error(JSON.stringify(err.body, null, 2));
  process.exit(1);
});
