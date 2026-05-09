import bcrypt from 'bcryptjs';
import { db, runSchema } from './index.js';

runSchema();

// Cria usuário admin padrão na primeira execução, SE houver senha no env.
// Antes era hardcoded `trocar123` — risco de qualquer um que viu o repo logar.
// Agora: ou define ADMIN_DEFAULT_PASSWORD no env, ou usa só seed-users.js.
const admin = db.prepare('SELECT id FROM sdr_users WHERE email = ?').get('admin@lcagencia.com.br');
if (!admin) {
  const pwd = process.env.ADMIN_DEFAULT_PASSWORD;
  if (pwd && pwd.length >= 8) {
    const hash = bcrypt.hashSync(pwd, 10);
    db.prepare(`
      INSERT INTO sdr_users (name, email, password_hash, role)
      VALUES (?, ?, ?, 'admin')
    `).run('Admin LC', 'admin@lcagencia.com.br', hash);
    console.log('[migrate] usuário admin@lcagencia.com.br criado com senha do env');
  } else {
    console.log('[migrate] admin default não criado (defina ADMIN_DEFAULT_PASSWORD no env ou use scripts/seed-users.js)');
  }
}

console.log('[migrate] schema aplicado com sucesso');
