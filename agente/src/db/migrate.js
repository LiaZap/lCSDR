import bcrypt from 'bcryptjs';
import { db, runSchema } from './index.js';

runSchema();

// Cria usuário admin padrão na primeira execução
const admin = db.prepare('SELECT id FROM sdr_users WHERE email = ?').get('admin@lcagencia.com.br');
if (!admin) {
  const hash = bcrypt.hashSync('trocar123', 10);
  db.prepare(`
    INSERT INTO sdr_users (name, email, password_hash, role)
    VALUES (?, ?, ?, 'admin')
  `).run('Admin LC', 'admin@lcagencia.com.br', hash);
  console.log('[migrate] usuário admin criado: admin@lcagencia.com.br / trocar123');
}

console.log('[migrate] schema aplicado com sucesso');
