import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'lc-sdr.db');
export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function runSchema() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);

  // Migrações leves pra bancos existentes (idempotentes)
  // SQLite: ALTER TABLE ADD COLUMN só falha se a coluna já existir → catch e seguir.
  const safeAddColumn = (table, column, type) => {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      console.log(`[migrate] +coluna ${table}.${column}`);
    } catch (err) {
      // duplicate column name — esperado se já rodou. Não logar.
      if (!/duplicate column/i.test(err.message)) {
        console.warn(`[migrate] erro adicionando ${table}.${column}:`, err.message);
      }
    }
  };

  safeAddColumn('contacts', 'campaign_source', 'TEXT');
  safeAddColumn('contacts', 'campaign_tags', 'TEXT');
}

// Garante schema na primeira importação
runSchema();
