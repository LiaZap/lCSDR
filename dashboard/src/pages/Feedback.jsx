import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Icon } from '../components/Icon.jsx';

// Tela de feedback agregado — útil principalmente pro mutirão de revisão
// (Lilian, Bruna, Gabriel, Andressa marcam tom OK / errado / corrige isso
// em várias conversas; Paulo abre essa página e vê tudo num lugar só).

const VERDICT_META = {
  tom_ok: { icon: '👍', label: 'Tom OK', cls: 'success' },
  tom_errado: { icon: '👎', label: 'Tom errado', cls: 'danger' },
  corrigir: { icon: '💬', label: 'Corrigir', cls: 'magenta' },
};

export default function Feedback() {
  const [data, setData] = useState({ feedbacks: [], summary: null });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const nav = useNavigate();

  async function load() {
    setLoading(true);
    try {
      const [list, summary] = await Promise.all([
        api.feedbacks(filter === 'all' ? null : filter),
        api.feedbackSummary(),
      ]);
      setData({ feedbacks: list.feedbacks || [], summary });
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [filter]);

  const summary = data.summary || { counts: [], total: 0 };
  const counts = useMemo(() => {
    const m = { tom_ok: 0, tom_errado: 0, corrigir: 0 };
    for (const c of summary.counts || []) m[c.verdict] = c.total;
    return m;
  }, [summary]);

  const total = summary.total || 0;
  const pctOk = total ? Math.round((counts.tom_ok / total) * 100) : 0;
  const pctErr = total ? Math.round((counts.tom_errado / total) * 100) : 0;
  const pctFix = total ? Math.round((counts.corrigir / total) * 100) : 0;

  // Agrupa correções por tema (identifica padrões nos comentários)
  const corrections = useMemo(
    () => data.feedbacks.filter(f => f.verdict === 'corrigir' && f.comment).slice(0, 30),
    [data.feedbacks]
  );

  return (
    <div className="col" style={{ gap: 24 }}>
      <div className="page-header">
        <div>
          <h1>Feedback do time</h1>
          <div className="muted small">Revisões de tom da Lila feitas pela equipe LC · {total} avaliações no total</div>
        </div>
        <button className="ghost" onClick={load} title="Recarregar">
          <Icon.Refresh width={16} height={16} />
        </button>
      </div>

      {/* === KPIs de qualidade === */}
      <div className="grid-3">
        <div className="kpi gradient">
          <div className="label">Aprovações</div>
          <div className="value" style={{ color: 'var(--lc-success)' }}>{counts.tom_ok}</div>
          <div className="hint">{pctOk}% das avaliações</div>
          <div style={{ marginTop: 12, background: 'var(--border-soft)', height: 6, borderRadius: 99 }}>
            <div style={{ width: `${pctOk}%`, background: 'var(--lc-success)', height: '100%', borderRadius: 99 }} />
          </div>
        </div>

        <div className="kpi">
          <div className="label">Reprovações</div>
          <div className="value" style={{ color: 'var(--lc-danger)' }}>{counts.tom_errado}</div>
          <div className="hint">{pctErr}% das avaliações</div>
          <div style={{ marginTop: 12, background: 'var(--border-soft)', height: 6, borderRadius: 99 }}>
            <div style={{ width: `${pctErr}%`, background: 'var(--lc-danger)', height: '100%', borderRadius: 99 }} />
          </div>
        </div>

        <div className="kpi">
          <div className="label">Correções pedidas</div>
          <div className="value" style={{ color: 'var(--lc-magenta)' }}>{counts.corrigir}</div>
          <div className="hint">{pctFix}% das avaliações</div>
          <div style={{ marginTop: 12, background: 'var(--border-soft)', height: 6, borderRadius: 99 }}>
            <div style={{ width: `${pctFix}%`, background: 'var(--lc-magenta)', height: '100%', borderRadius: 99 }} />
          </div>
        </div>
      </div>

      {/* === Correções detalhadas (mais valor pra Paulo) === */}
      {corrections.length > 0 && (
        <div className="card elevated">
          <h3>📝 Correções pedidas pela equipe</h3>
          <div className="muted small" style={{ marginBottom: 16 }}>
            Comentários específicos que viram input pro próximo refinamento do prompt
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {corrections.map(f => (
              <div key={f.id} style={{
                padding: 14,
                background: 'var(--surface-bg)',
                borderRadius: 10,
                borderLeft: '3px solid var(--lc-magenta)',
                cursor: 'pointer',
              }}
                onClick={() => nav(`/leads/${f.contact_id}`)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                  <strong style={{ fontSize: 13 }}>
                    {f.contact_name || 'Lead sem nome'}
                  </strong>
                  <span className="small muted">
                    {f.reviewer_name} · {new Date(f.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
                  "{f.comment}"
                </div>
                {(f.funnel || f.qualification_score) && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    {f.funnel && <span className="tag magenta" style={{ fontSize: 10, padding: '1px 6px' }}>{f.funnel}</span>}
                    {f.qualification_score > 0 && <span className="tag" style={{ fontSize: 10, padding: '1px 6px' }}>score {f.qualification_score}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* === Histórico completo === */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3>Histórico completo</h3>
          <div className="row" style={{ gap: 6 }}>
            <button onClick={() => setFilter('all')} className={filter === 'all' ? 'accent' : ''}>Todas</button>
            <button onClick={() => setFilter('tom_ok')} className={filter === 'tom_ok' ? 'accent' : ''}>👍 OK</button>
            <button onClick={() => setFilter('tom_errado')} className={filter === 'tom_errado' ? 'accent' : ''}>👎 Errado</button>
            <button onClick={() => setFilter('corrigir')} className={filter === 'corrigir' ? 'accent' : ''}>💬 Corrigir</button>
          </div>
        </div>

        {loading && <div className="skeleton" style={{ height: 100 }} />}

        {!loading && data.feedbacks.length === 0 && (
          <div className="muted" style={{ textAlign: 'center', padding: 40 }}>
            Nenhuma avaliação ainda{filter !== 'all' ? ' nesse filtro' : ''}.
            <br />
            <span className="small">Quando o time marcar 👍/👎/correções nas conversas, aparece aqui.</span>
          </div>
        )}

        {!loading && data.feedbacks.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Veredito</th>
                <th>Lead</th>
                <th>Funil</th>
                <th>Comentário</th>
                <th>Avaliador</th>
                <th>Quando</th>
              </tr>
            </thead>
            <tbody>
              {data.feedbacks.map(f => {
                const v = VERDICT_META[f.verdict] || {};
                return (
                  <tr key={f.id} onClick={() => nav(`/leads/${f.contact_id}`)}>
                    <td>
                      <span className={`tag ${v.cls || ''}`}>{v.icon} {v.label}</span>
                    </td>
                    <td><strong>{f.contact_name || '—'}</strong></td>
                    <td>{f.funnel ? <span className="tag magenta" style={{ fontSize: 11 }}>{f.funnel}</span> : <span className="muted">—</span>}</td>
                    <td style={{ maxWidth: 300, fontSize: 12, color: 'var(--text-secondary)' }}>
                      {f.comment ? `"${f.comment.slice(0, 100)}${f.comment.length > 100 ? '…' : ''}"` : <span className="muted">—</span>}
                    </td>
                    <td className="small">{f.reviewer_name || '—'}</td>
                    <td className="small muted">{new Date(f.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
