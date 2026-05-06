import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../db/index.js';

const router = express.Router();

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email e senha obrigatórios' });

  const user = db.prepare('SELECT * FROM sdr_users WHERE email = ? AND active = 1').get(email.toLowerCase());
  if (!user) return res.status(401).json({ error: 'credenciais inválidas' });

  if (!bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'credenciais inválidas' });
  }

  const token = jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role },
    process.env.JWT_SECRET || 'dev-secret',
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
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
    next();
  } catch {
    res.status(401).json({ error: 'token inválido' });
  }
}

export default router;
