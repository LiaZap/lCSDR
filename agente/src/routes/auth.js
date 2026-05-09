import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../db/index.js';

const router = express.Router();

// JWT_SECRET é obrigatório. O processo já fail-fast no boot (ver index.js)
// se não estiver setado ou for muito curto. Aqui assumimos válido.
const JWT_SECRET = process.env.JWT_SECRET;

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  // Validação de tamanho — evita DoS via password gigante (bcrypt trava event loop)
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'email e senha obrigatórios' });
  }
  if (email.length > 200 || email.length < 3 || password.length > 200 || password.length < 1) {
    return res.status(400).json({ error: 'email ou senha com tamanho inválido' });
  }

  const user = db.prepare('SELECT * FROM sdr_users WHERE email = ? AND active = 1').get(email.toLowerCase());
  if (!user) return res.status(401).json({ error: 'credenciais inválidas' });

  if (!bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'credenciais inválidas' });
  }

  const token = jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role },
    JWT_SECRET,
    { expiresIn: '12h' }
  );

  res.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  });
});

export function authMiddleware(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'sem token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'token inválido' });
  }
}

export default router;
