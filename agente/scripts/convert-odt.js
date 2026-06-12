// Converte um .odt (OpenDocument) pra texto limpo.
// Uso: node scripts/convert-odt.js <input.odt> <output.txt>
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error('uso: node scripts/convert-odt.js <input.odt> <output.txt>');
  process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'odt-'));
execSync(`unzip -o "${input}" content.xml -d "${tmp}"`, { stdio: 'ignore' });
let xml = fs.readFileSync(path.join(tmp, 'content.xml'), 'utf8');

xml = xml
  .replace(/<text:p[^>]*>/g, '\n')
  .replace(/<text:h[^>]*>/g, '\n## ')
  .replace(/<text:line-break[^>]*\/>/g, '\n')
  .replace(/<text:tab[^>]*\/>/g, ' ')
  .replace(/<text:s\/>/g, ' ')
  .replace(/<text:s [^>]*\/>/g, ' ')
  .replace(/<text:list-item[^>]*>/g, '\n- ')
  .replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&apos;/g, "'").replace(/&quot;/g, '"');

// Conserta espacos comidos na extracao (palavraColada)
xml = xml.replace(/([a-zà-úç])([A-ZÀ-Ú])/g, '$1 $2');
xml = xml.replace(/([.,:;!?])([A-Za-zÀ-ú])/g, '$1 $2');
xml = xml.replace(/\n{3,}/g, '\n\n').trim();

fs.writeFileSync(output, xml, 'utf8');
console.log(`✓ ${output}: ${xml.length} chars`);
fs.rmSync(tmp, { recursive: true, force: true });
