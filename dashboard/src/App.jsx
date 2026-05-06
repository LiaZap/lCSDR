import { Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom';
import { getUser, clearSession } from './lib/api.js';
import LCLogo from './components/LCLogo.jsx';
import Login from './pages/Login.jsx';
import Overview from './pages/Overview.jsx';
import Conversations from './pages/Conversations.jsx';
import Leads from './pages/Leads.jsx';
import LeadDetail from './pages/LeadDetail.jsx';
import Playground from './pages/Playground.jsx';

function Shell({ children }) {
  const user = getUser();
  const nav = useNavigate();
  if (!user) return <Navigate to="/login" />;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <LCLogo variant="on-dark" size="md" />
          <div className="sidebar-subbrand">Lila · SDR</div>
        </div>
        <nav>
          <NavLink to="/" end>Visão geral</NavLink>
          <NavLink to="/conversas">Conversas</NavLink>
          <NavLink to="/leads">Leads</NavLink>
          <NavLink to="/playground">Playground</NavLink>
        </nav>
        <div className="user">
          <div>{user.name}</div>
          <div className="small muted">{user.email}</div>
          <button className="ghost small" style={{ marginTop: 10, padding: '4px 8px', color: 'rgba(255,255,255,0.6)' }}
            onClick={() => { clearSession(); nav('/login'); }}>
            Sair
          </button>
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
