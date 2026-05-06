import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';

const STAGES = [
  { v: '', label: 'Todos' },
  { v: 'qualificado', label: 'Qualificados', cls: 'success' },
  { v: 'handoff', label: 'Em handoff', cls: 'black' },
  { v: 'qualificando', label: 'Qualificando', cls: 'orange' },
  { v: 'pre_qualificando', label: 'Pré-qualificando', cls: 'orange' },
  { v: 'desqualificado', label: 'Desqualificados', cls: 'danger' },
];

const FUNNELS = [
  { v: '', label: 'Todos funis' },
  { v: 'escrever', label: '📝 Escrever' },
  { v: 'publicar', label: '📖 Publicar' },
  { v: 'divulgar', label: '📣 Divulgar' },
];

export default function Leads() {
  const [filters, setFilters] = useState({ stage: '', funnel: '', q: '' });
  const [contacts, setContacts] = useState([]);
  const nav = useNavigate();

  useEffect(() => {
    api.contacts(filters).then(r => setContacts(r.contacts || [])).catch(console.error);
  }, [filters.stage, filters.funnel, filters.q]);

  return (
    <div className="col">
      <div className="page-header">
        <div>
          <h1>Leads</h1>
          <div className="muted small">{contacts.length} contato{contacts.length !== 1 ? 's' : ''}</div>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {STAGES.map(s => (
            <button
              key={s.v}
              className={filters.stage === s.v ? 'accent' : ''}
              onClick={() => setFilters(f => ({ ...f, stage: s.v }))}
            >{s.label}</button>
          ))}
          <div style={{ flex: 1 }} />
          <select value={filters.funnel} onChange={e => setFilters(f => ({ ...f, funnel: e.target.value }))} style={{ width: 180 }}>
            {FUNNELS.map(f => <option key={f.v} value={f.v}>{f.label}</option>)}
          </select>
          <input
            placeholder="Buscar nome, telefone, e-mail…"
            value={filters.q}
            onChange={e => setFilters(f => ({ ...f, q: e.target.value }))}
            style={{ width: 280 }}
          />
        </div>

        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Funil</th>
              <th>Estágio</th>
              <th>Score</th>
              <th>SDR</th>
              <th>Última msg</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {contacts.map(c => (
              <tr key={c.id} onClick={() => nav(`/leads/${c.id}`)}>
                <td>
                  <div style={{ fontWeight: 600 }}>{c.name || '(sem nome)'}</div>
                  <div className="small muted">{c.phone || c.email || '—'}</div>
                </td>
                <td>{c.funnel ? <span className="tag orange">{c.funnel}</span> : <span className="muted small">—</span>}</td>
                <td><StageTag stage={c.stage} /></td>
                <td>
                  <ScoreBar score={c.qualification_score || 0} />
                </td>
                <td>{c.sdr_name || <span className="muted small">—</span>}</td>
                <td className="small muted">
                  {c.last_inbound_at ? new Date(c.last_inbound_at).toLocaleString('pt-BR') : '—'}
                </td>
                <td>
                  <button className="ghost small">Abrir →</button>
                </td>
              </tr>
            ))}
            {contacts.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40 }} className="muted">Nenhum lead no filtro atual</td></tr>
            )}
          </tbody>
        </table>
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
    agendado: { cls: 'success', label: 'Agendado' },
  };
  const it = map[stage] || { cls: '', label: stage || '—' };
  return <span className={`tag ${it.cls}`}>{it.label}</span>;
}

function ScoreBar({ score }) {
  const w = Math.max(0, Math.min(100, score));
  const color = w >= 70 ? 'var(--lc-success)' : w >= 40 ? 'var(--lc-magenta)' : 'var(--lc-stone)';
  return (
    <div style={{ width: 80 }}>
      <div style={{ background: 'var(--lc-line)', borderRadius: 99, height: 6 }}>
        <div style={{ width: `${w}%`, background: color, height: '100%', borderRadius: 99 }} />
      </div>
      <div className="small muted" style={{ marginTop: 2 }}>{w}/100</div>
    </div>
  );
}
