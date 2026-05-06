// Teste rápido da integração uazapi.
// Uso:
//   node scripts/test-uazapi.js status
//   node scripts/test-uazapi.js text  <55119...> "mensagem"
//   node scripts/test-uazapi.js menu  <55119...>
//   node scripts/test-uazapi.js list  <55119...>

import 'dotenv/config';
import { UAZAPI, normalizePhone } from '../src/uazapi/client.js';

const [,, cmd, ...args] = process.argv;

function pp(x) { console.log(JSON.stringify(x, null, 2)); }

async function main() {
  if (!process.env.UAZAPI_TOKEN) {
    console.error('❌ UAZAPI_TOKEN não definido no .env');
    process.exit(1);
  }
  console.log('uazapi base:', process.env.UAZAPI_BASE || 'https://liaautomacoes.uazapi.com');
  console.log('token:      ', process.env.UAZAPI_TOKEN.slice(0, 8) + '…');

  switch (cmd) {
    case 'status': {
      pp(await UAZAPI.status());
      break;
    }
    case 'text': {
      const number = normalizePhone(args[0]);
      const text = args.slice(1).join(' ') || 'Olá! Teste da Lila.';
      console.log('→ enviando texto pra', number);
      pp(await UAZAPI.sendText(number, text));
      break;
    }
    case 'menu': {
      const number = normalizePhone(args[0]);
      console.log('→ enviando menu pra', number);
      pp(await UAZAPI.sendMenu({
        number,
        text: 'Olá! Como posso te ajudar hoje? 😊',
        choices: [
          'Sou autor|autor',
          'Represento editora|editora',
          'Outra coisa|outro',
        ],
        footerText: 'Toque em uma opção',
      }));
      break;
    }
    case 'list': {
      const number = normalizePhone(args[0]);
      console.log('→ enviando lista pra', number);
      pp(await UAZAPI.sendList({
        number,
        text: 'Por que você entrou em contato com a LC?',
        choices: [
          'Curso, mentoria ou ghost writer|escrita',
          'Projeto gráfico (capa, diagramação, revisão)|projeto_grafico',
          'Publicação pela LC Books|publicacao',
          'Análise/leitura crítica|leitura_critica',
          'Divulgação na imprensa|imprensa',
          'Distribuição do livro|distribuicao',
          'Marketing e redes sociais|marketing',
          'Outro motivo|outro',
        ],
        footerText: 'Escolha uma opção pra eu te ajudar melhor',
      }));
      break;
    }
    default:
      console.log(`
Uso:
  node scripts/test-uazapi.js status
  node scripts/test-uazapi.js text  <numero> "mensagem"
  node scripts/test-uazapi.js menu  <numero>
  node scripts/test-uazapi.js list  <numero>

O número pode ter formatos variados (com/sem DDI, com/sem +). O script normaliza pra 55XX...
`);
  }
}

main().catch(err => {
  console.error('❌', err.message);
  if (err.body) pp(err.body);
  process.exit(1);
});
