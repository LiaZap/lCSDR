// Cria usuários pra LC (Lilian, Bruna) acessarem o dashboard.
// Uso (dentro do container):
//   node scripts/seed-users.js

import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { db } from '../src/db/index.js';

const USERS = [
  // Admins LC
  { name: 'Lilian Cardoso', email: 'lilian@lcagencia.com.br',  password: 'LCagencia2026', role: 'admin' },

  // Time comercial LC (testers do mutirão de sábado)
  { name: 'Gabriel',     email: 'gabriel@lcagencia.com.br',     password: 'LCagencia2026', role: 'sdr' },
  { name: 'Andressa',    email: 'andressa@lcagencia.com.br',    password: 'LCagencia2026', role: 'closer' },
  { name: 'Brenda',      email: 'brenda@lcagencia.com.br',      password: 'LCagencia2026', role: 'admin' },
  // Consultores/closers (rodízio da fila + atendem leads)
  { name: 'Bruna Menel', email: 'brunamenel@lcagencia.com.br',  password: 'LCagencia2026', role: 'closer' },
  { name: 'Nataly',      email: 'nataly@lcagencia.com.br',      password: 'LCagencia2026', role: 'closer' },
  { name: 'Victor',      email: 'victor@lcagencia.com.br',      password: 'LCagencia2026', role: 'closer' },
  { name: 'Fernanda Vieira', email: 'fernanda@lcagencia.com.br', password: 'LCagencia2026', role: 'closer' },
  { name: 'Neto',        email: 'neto@lcagencia.com.br',        password: 'LCagencia2026', role: 'sdr' },
  { name: 'Isabella',    email: 'isabella@lcagencia.com.br',    password: 'LCagencia2026', role: 'admin' },

  // BEP (executor do projeto)
  { name: 'Paulo', email: 'paulo@bep.media', password: 'BEP2026', role: 'admin' },
  { name: 'Pedro', email: 'pedro@bep.media', password: 'BEP2026', role: 'admin' },
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
