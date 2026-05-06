import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setSession } from '../lib/api.js';
import LCLogo from '../components/LCLogo.jsx';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const nav = useNavigate();

  useEffect(() => { setMounted(true); }, []);

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
    <div className="login-premium">
      {/* === Lado esquerdo: branding e proposta de valor === */}
      <aside className="login-side">
        <div className="login-side-glow" />
        <div className="login-side-content">
          <div className="login-side-logo">
            <LCLogo variant="on-dark" size="lg" />
          </div>

          <div className="login-headline">
            <span className="login-eyebrow">Plataforma SDR · Grupo LC</span>
            <h1>Cada lead com a atenção certa, no momento certo.</h1>
            <p className="login-sub">
              A Lila qualifica em segundos. Vocês fecham com tempo.
            </p>
          </div>

          <ul className="login-features">
            <li>
              <div className="feat-ico">⚡</div>
              <div>
                <strong>Filtra antes de chegar</strong>
                <span>Lead lixo cortado antes do SDR olhar</span>
              </div>
            </li>
            <li>
              <div className="feat-ico">📚</div>
              <div>
                <strong>Treinada na LC</strong>
                <span>16 anos de mercado literário no DNA</span>
              </div>
            </li>
            <li>
              <div className="feat-ico">🤝</div>
              <div>
                <strong>Humano sempre fecha</strong>
                <span>Lila passa pro Closer no momento certo</span>
              </div>
            </li>
          </ul>

          <div className="login-stats">
            <div>
              <strong>5.000+</strong>
              <span>livros divulgados</span>
            </div>
            <div>
              <strong>30k</strong>
              <span>inserções/ano</span>
            </div>
            <div>
              <strong>60k</strong>
              <span>jornalistas</span>
            </div>
          </div>
        </div>

        <div className="login-side-footer">
          BEP Media · Powered by OpenAI · uazapi
        </div>
      </aside>

      {/* === Lado direito: form === */}
      <main className={`login-form-wrap ${mounted ? 'mounted' : ''}`}>
        <form className="login-form" onSubmit={submit}>
          <div className="login-form-header">
            <h2>Bem-vindo de volta</h2>
            <p className="muted">Acesse o painel da Lila</p>
          </div>

          <div className="form-group">
            <label htmlFor="email">E-mail</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus
              autoComplete="email"
              placeholder="seu@email.com.br"
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Senha</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              placeholder="••••••••"
            />
          </div>

          {err && (
            <div className="login-error">
              <span>⚠</span> {err}
            </div>
          )}

          <button className="login-submit" type="submit" disabled={loading}>
            {loading ? (
              <><span className="spinner" /> Entrando…</>
            ) : (
              <>Entrar no painel <span className="arrow">→</span></>
            )}
          </button>

          <div className="login-form-footer">
            <span className="muted small">
              Acesso restrito · LC Agência de Comunicação
            </span>
          </div>
        </form>
      </main>
    </div>
  );
}
