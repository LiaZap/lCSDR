import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setSession } from '../lib/api.js';
import LCLogo from '../components/LCLogo.jsx';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();

  async function submit(e) {
    e.preventDefault();
    setLoading(true); setErr(null);
    try {
      const { token, user } = await api.login(email, password);
      setSession(token, user);
      nav('/');
    } catch (e) {
      setErr(e.message || 'Falha no login');
    } finally { setLoading(false); }
  }

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand"><LCLogo size="lg" /></div>
        <div className="login-sub">Lila · SDR</div>

        <div className="col">
          <label>
            <div className="small muted" style={{ marginBottom: 4 }}>E-mail</div>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
          </label>
          <label>
            <div className="small muted" style={{ marginBottom: 4 }}>Senha</div>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
          </label>

          {err && <div className="tag danger">{err}</div>}

          <button className="primary" type="submit" disabled={loading} style={{ marginTop: 8 }}>
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </div>
      </form>
    </div>
  );
}
