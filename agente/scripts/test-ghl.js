// Teste rápido da integração GHL.
// Uso:  node scripts/test-ghl.js health
//       node scripts/test-ghl.js contact <ghl_contact_id>
//       node scripts/test-ghl.js send <ghl_contact_id> "mensagem"
//       node scripts/test-ghl.js tag <ghl_contact_id> iara-teste
//       node scripts/test-ghl.js customfields
//       node scripts/test-ghl.js pipelines
//       node scripts/test-ghl.js users
//       node scripts/test-ghl.js calendars
//       node scripts/test-ghl.js qualify <ghl_contact_id>   (simula qualificação completa)

import 'dotenv/config';
import { GHL } from '../src/ghl/client.js';
import { writeQualificationFields } from '../src/ghl/customFields.js';
import { createOrMoveOpportunityQualified } from '../src/ghl/opportunities.js';

const [,, cmd, ...args] = process.argv;

function pp(x) { console.log(JSON.stringify(x, null, 2)); }

async function main() {
  if (!process.env.GHL_API_TOKEN) { console.error('❌ Defina GHL_API_TOKEN no .env'); process.exit(1); }
  if (!process.env.GHL_LOCATION_ID) { console.error('❌ Defina GHL_LOCATION_ID no .env'); process.exit(1); }

  switch (cmd) {
    case 'health': {
      console.log('✓ Token presente:', process.env.GHL_API_TOKEN.slice(0, 8) + '…');
      console.log('✓ Location:', process.env.GHL_LOCATION_ID);
      const users = await GHL.listUsers();
      console.log('✓ API v2 respondeu. Usuários na location:', (users.users || users).length);
      break;
    }
    case 'contact': {
      pp(await GHL.getContact(args[0]));
      break;
    }
    case 'send': {
      pp(await GHL.sendMessage({
        contactId: args[0],
        message: args.slice(1).join(' ') || '[teste Iara]',
        type: 'WhatsApp',
      }));
      break;
    }
    case 'tag': {
      pp(await GHL.addTag(args[0], args.slice(1)));
      break;
    }
    case 'customfields': {
      pp(await GHL.listCustomFields());
      break;
    }
    case 'pipelines': {
      pp(await GHL.listPipelines());
      break;
    }
    case 'users': {
      pp(await GHL.listUsers());
      break;
    }
    case 'calendars': {
      pp(await GHL.listCalendars());
      break;
    }
    case 'qualify': {
      const contactId = args[0];
      const contact = await GHL.getContact(contactId);
      const name = contact.name || `${contact.firstName || ''} ${contact.lastName || ''}`.trim();
      console.log('Contato:', name, '·', contact.phone || '—');

      await GHL.addTag(contactId, ['iara-qualificado', 'funil-divulgar']);
      console.log('✓ tags adicionadas');

      await writeQualificationFields(contactId, {
        funnel: 'divulgar',
        score: 75,
        notes: 'Teste automatizado da integração — autor com livro publicado, quer mídia.',
      });
      console.log('✓ custom fields escritos');

      const oppId = await createOrMoveOpportunityQualified(
        { ghl_contact_id: contactId, name, id: null },
        { funnel: 'divulgar', score: 75, notes: 'teste' }
      );
      console.log('✓ oportunidade:', oppId || '(não criada — verifique pipeline no GHL)');
      break;
    }
    default:
      console.log(`
Uso:
  node scripts/test-ghl.js health
  node scripts/test-ghl.js contact <ghl_contact_id>
  node scripts/test-ghl.js send <ghl_contact_id> "msg"
  node scripts/test-ghl.js tag <ghl_contact_id> tag1 tag2
  node scripts/test-ghl.js customfields
  node scripts/test-ghl.js pipelines
  node scripts/test-ghl.js users
  node scripts/test-ghl.js calendars
  node scripts/test-ghl.js qualify <ghl_contact_id>
`);
  }
}

main().catch(err => {
  console.error('❌', err.message);
  if (err.body) pp(err.body);
  process.exit(1);
});
