import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';

export default function Conversations() {
  const [contacts, setContacts] = useState([]);
  const nav = useNavigate();

  async function load() {
    const r = await api.contacts({ stage: '' });
    // ordena: handoff / qualificado primeiro, depois em atendimento, depois desqualificados
    const order = { qualificado: 0, handoff: 1, qualificando: 2, pre_qualificando: 3, novo: 4, desqualificado: 5 };
    const rows = (r.contacts || []).sort((a, b) => (order[a.stage] ?? 9) - (order[b.stage] ?? 9));
    setContacts(rows);
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="col">
      <div className="page-header">
        <div>
          <h1>Conversas</h1>
          <div className="muted small">Prioridade: qualificados → handoff → em atendimento</div>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {contacts.map(c => (
          <div
            key={c.id}
            onClick={() => nav(`/leads/${c.id}`)}
            style={{
              padding: '16px 20px',
              borderBottom: '1px solid var(--lc-line)',
              cursor: 'pointer',
              display: 'grid',
              gridTemplateColumns: '1fr auto auto auto',
              gap: 16,
              alignItems: 'center',
            }}
          >
            <div>
              <div style={{ fontWeight: 600 }}>{c.name || '(sem nome)'}</div>
              <div className="small muted">{c.phone || c.email || '—'} · {c.qualification_notes?.slice(0, 80) || 'sem notas'}</div>
            </div>
            {c.funnel && <span className="tag orange">{c.funnel}</span>}
            <StageTag stage={c.stage} />
            <span className="small muted">
              {c.last_inbound_at ? new Date(c.last_inbound_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}
            </span>
          </div>
        ))}
        {contacts.length === 0 && <div className="muted" style={{ padding: 40, textAlign: 'center' }}>Nenhuma conversa ainda</div>}
      </div>
    </div>
  );
}

function StageTag({ stage }) {
  const map = {
    qualificado: { cls: 'success', label: 'Qualificado' },
    handoff: { cls: 'black', label: 'Handoff' },
    qualificando: { cls: 'orange', label: 'Qualificando' },
    pre_qualificando: { cls: 'orange', label: 'Pré-qual.' },
    desqualificado: { cls: 'danger', label: 'Desqualif.' },
    novo: { cls: '', label: 'Novo' },
  };
  const it = map[stage] || { cls: '', label: stage || '—' };
  return <span className={`tag ${it.cls}`}>{it.label}</span>;
}
