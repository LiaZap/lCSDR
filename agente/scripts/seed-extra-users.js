// Seed adicional — só Bruna Menel e Neto.
// Rode quando precisar adicionar usuários sem esperar redeploy completo.
//
// Uso: node scripts/seed-extra-users.js

import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { db } from '../src/db/index.js';

const EXTRA_USERS = [
  { name: 'Bruna Menel', email: 'brunamenel@lcagencia.com.br', password: 'LCagencia2026', role: 'sdr' },
  { name: 'Neto',        email: 'neto@lcagencia.com.br',       password: 'LCagencia2026', role: 'sdr' },
  { name: 'Nataly',      email: 'nataly@lcagencia.com.br',     password: 'LCagencia2026', role: 'sdr' },
];

for (const u of EXTRA_USERS) {
  const exists = db.prepare('SELECT id FROM sdr_users WHERE email = ?').get(u.email);
  if (exists) {
    console.log(`- já existe: ${u.email}`);
    continue;
  }
  const hash = bcrypt.hashSync(u.password, 10);
  db.prepare(`
    INSERT INTO sdr_users (name, email, password_hash, role)
    VALUES (?, ?, ?, ?)
  `).run(u.name, u.email, hash, u.role);
  console.log(`✓ criado: ${u.email} (senha: ${u.password})`);
}

console.log('\n✅ Done.');
