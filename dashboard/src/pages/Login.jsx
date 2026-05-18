import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setSession } from '../lib/api.js';
import LCLogo from '../components/LCLogo.jsx';
import { Icon } from '../components/Icon.jsx';

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
              A Tina qualifica em segundos. Vocês fecham com tempo.
            </p>
          </div>

          <ul className="login-features">
            <li>
              <div className="feat-ico">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 4.5h18l-7.2 9v6l-3.6 1.8v-7.8L3 4.5z" />
                </svg>
              </div>
              <div>
                <strong>Filtra antes de chegar</strong>
                <span>Lead sem perfil cortado antes do SDR olhar</span>
              </div>
            </li>
            <li>
              <div className="feat-ico">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                  <line x1="9" y1="7" x2="15" y2="7" />
                  <line x1="9" y1="11" x2="13" y2="11" />
                </svg>
              </div>
              <div>
                <strong>Treinada na LC</strong>
                <span>16 anos de mercado literário no DNA</span>
              </div>
            </li>
            <li>
              <div className="feat-ico">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                </svg>
              </div>
              <div>
                <strong>Humano sempre fecha</strong>
                <span>Tina passa pro Closer no momento certo</span>
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
            <p className="muted">Acesse o painel da Tina</p>
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
              <Icon.X width={14} height={14} /> {err}
            </div>
          )}

          <button className="login-submit" type="submit" disabled={loading}>
            {loading ? (
              <><span className="spinner" /> Entrando…</>
            ) : (
              <>Entrar no painel <Icon.ArrowRight className="arrow" width={16} height={16} /></>
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
