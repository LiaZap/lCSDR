import { useState } from 'react';
import { Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom';
import { getUser, clearSession } from './lib/api.js';
import { getTheme, toggleTheme } from './lib/theme.js';
import LCLogo from './components/LCLogo.jsx';
import { Icon } from './components/Icon.jsx';
import Login from './pages/Login.jsx';
import Overview from './pages/Overview.jsx';
import Conversations from './pages/Conversations.jsx';
import Leads from './pages/Leads.jsx';
import LeadDetail from './pages/LeadDetail.jsx';
import Playground from './pages/Playground.jsx';

function Shell({ children }) {
  const user = getUser();
  const nav = useNavigate();
  const [theme, setTheme] = useState(getTheme());

  if (!user) return <Navigate to="/login" />;

  const initials = (user.name || 'U').split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <LCLogo variant="on-dark" size="md" />
          <div className="sidebar-subbrand">Lila · SDR</div>
        </div>

        <nav>
          <NavLink to="/" end>
            <Icon.Overview className="nav-ico" /> Visão geral
          </NavLink>
          <NavLink to="/conversas">
            <Icon.Inbox className="nav-ico" /> Conversas
          </NavLink>
          <NavLink to="/leads">
            <Icon.Kanban className="nav-ico" /> Leads
          </NavLink>
          <NavLink to="/playground">
            <Icon.Play className="nav-ico" /> Playground
          </NavLink>
        </nav>

        <div>
          <button
            className="theme-toggle"
            onClick={() => setTheme(toggleTheme())}
            title="Alternar tema"
          >
            {theme === 'dark' ? <Icon.Sun width={14} height={14} /> : <Icon.Moon width={14} height={14} />}
            {theme === 'dark' ? 'Claro' : 'Escuro'}
          </button>

          <div className="user">
            <div className="user-avatar">{initials}</div>
            <div style={{ fontWeight: 600, color: 'var(--lc-white)' }}>{user.name}</div>
            <div className="small muted" style={{ marginBottom: 8 }}>{user.email}</div>
            <button className="ghost small" style={{ padding: '4px 8px', color: 'rgba(255,255,255,0.6)', alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              onClick={() => { clearSession(); nav('/login'); }}>
              <Icon.Logout width={12} height={12} /> Sair
            </button>
          </div>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Shell><Overview /></Shell>} />
      <Route path="/conversas" element={<Shell><Conversations /></Shell>} />
      <Route path="/leads" element={<Shell><Leads /></Shell>} />
      <Route path="/leads/:id" element={<Shell><LeadDetail /></Shell>} />
      <Route path="/playground" element={<Shell><Playground /></Shell>} />
    </Routes>
  );
}
