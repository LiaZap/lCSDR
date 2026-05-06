// Cria usuários pra LC (Lilian, Bruna) acessarem o dashboard.
// Uso (dentro do container):
//   node scripts/seed-users.js

import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { db } from '../src/db/index.js';

const USERS = [
  { name: 'Lilian Cardoso', email: 'lilian@lcagencia.com.br', password: 'LCagencia2026', role: 'admin' },
  { name: 'Bruna',          email: 'bruna@lcagencia.com.br',  password: 'LCagencia2026', role: 'admin' },
  { name: 'Paulo',          email: 'paulo@bep.media',         password: 'BEP2026',        role: 'admin' },
];

for (const u of USERS) {
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

console.log('\n⚠ Troque essas senhas no primeiro login.');
