import { useEffect, useMemo, useState } from 'react';
import { api, getUser } from '../lib/api.js';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar,
  CartesianGrid, Area, AreaChart,
} from 'recharts';

const FUNNEL_COLORS = {
  escrever: '#E6227A',
  publicar: '#111111',
  divulgar: '#A01854',
  indefinido: '#9A9A9A',
};

const FUNNEL_LABELS = {
  escrever: 'Escrever',
  publicar: 'Publicar',
  divulgar: 'Divulgar',
  indefinido: 'Indefinido',
};

// Período → querystring pra API (days=N | all=1 | from=&to=).
function periodQuery(p) {
  if (p.all) return 'all=1';
  if (p.from || p.to) {
    const parts = [];
    if (p.from) parts.push('from=' + p.from);
    if (p.to) parts.push('to=' + p.to);
    return parts.join('&');
  }
  return 'days=' + (p.days || 7);
}
function periodLabel(p) {
  if (p.all) return 'Todo período';
  if (p.from || p.to) return `${p.from || '…'} → ${p.to || '…'}`;
  return `Últimos ${p.days || 7} dias`;
}
function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(String(s).replace(' ', 'T') + 'Z'); // banco é UTC
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function Overview() {
  const [period, setPeriod] = useState({ days: 7 });
  const [data, setData] = useState(null);
  const [atendidos, setAtendidos] = useState([]);
  const [agendados, setAgendados] = useState([]);
  const user = getUser();
  // Estado local em vez de ler localStorage direto: permite fechar sem reload
  const [seenWelcome, setSeenWelcome] = useState(
    typeof window !== 'undefined' && localStorage.getItem('lc_welcome_seen') === '1'
  );

  const q = periodQuery(period);
  useEffect(() => {
    api.metrics(q).then(setData).catch(console.error);
    api.atendidos(q + '&limit=500').then(r => setAtendidos(r.atendidos || [])).catch(console.error);
    api.agendados(q + '&limit=500').then(r => setAgendados(r.agendados || [])).catch(console.error);
  }, [q]);

  // Defaults defensivos (importante: hooks devem ser chamados ANTES de qualquer return)
  const totais = data?.totais || {};
  const porFunil = data?.porFunil || [];
  const porDia = data?.porDia || [];
  const porHora = data?.porHora || [];
  const tempoResposta = data?.tempoResposta || {};

  const totalLeads = totais.leads || 0;
  const qualificados = totais.qualificados || 0;
  const desqualificados = totais.desqualificados || 0;
  const emAtendimento = totais.em_atendimento || 0;
  const equipeAssumiu = data?.time_assumiu || 0;
  const taxaQualificacao = totalLeads ? Math.round((qualificados / totalLeads) * 100) : 0;
  const taxaFiltro = totalLeads ? Math.round((desqualificados / totalLeads) * 100) : 0;

  // Insights automáticos baseados nos dados — useMemo PRECISA vir antes do early return
  const insights = useMemo(
    () => generateInsights({ porDia, porFunil, porHora, tempoResposta, taxaQualificacao, totalLeads }),
    [porDia, porFunil, porHora, tempoResposta, taxaQualificacao, totalLeads]
  );

  if (!data) return <SkeletonOverview />;

  // Funil de conversão (todos → qualificados → handoff → agendado)
  const funilConversao = [
    { stage: 'Total', value: totalLeads, color: '#9A9A9A' },
    { stage: 'Em atendimento', value: emAtendimento, color: '#E6227A' },
    { stage: 'Qualificados', value: qualificados, color: '#A01854' },
    { stage: 'Handoff', value: totais.em_handoff || 0, color: '#111111' },
  ];

  return (
    <div className="col" style={{ gap: 24 }}>
      {!seenWelcome && (
        <div className="card glow" style={{ borderLeft: '4px solid var(--lc-magenta)', position: 'relative' }}>
          <button
            className="ghost small"
            onClick={() => { localStorage.setItem('lc_welcome_seen', '1'); setSeenWelcome(true); }}
            style={{ position: 'absolute', top: 12, right: 14, padding: '2px 8px', fontSize: 18, color: 'var(--text-tertiary)' }}
            title="Fechar"
          >×</button>
          <h2 style={{ marginBottom: 8 }}>👋 Bem-vinda{user?.name ? `, ${user.name.split(' ')[0]}` : ''}!</h2>
          <p style={{ marginBottom: 12, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
            Esse é o painel da <strong>Tina</strong>, IA SDR do Grupo LC.
          </p>
          <div className="grid-3" style={{ marginTop: 16 }}>
            <div>
              <strong style={{ display: 'block', color: 'var(--lc-magenta)', marginBottom: 4 }}>▶ Playground</strong>
              <span className="small" style={{ color: 'var(--text-secondary)' }}>Converse com a Tina como se fosse um lead. Teste tom e fluxo sem custo de WhatsApp.</span>
            </div>
            <div>
              <strong style={{ display: 'block', color: 'var(--lc-magenta)', marginBottom: 4 }}>⊞ Leads (Kanban)</strong>
              <span className="small" style={{ color: 'var(--text-secondary)' }}>Pipeline visual estilo Trello. Arraste leads entre os estágios.</span>
            </div>
            <div>
              <strong style={{ display: 'block', color: 'var(--lc-magenta)', marginBottom: 4 }}>✉ Conversas</strong>
              <span className="small" style={{ color: 'var(--text-secondary)' }}>Inbox. Avalie tom da Tina com 👍/👎 — alimenta refinamento contínuo.</span>
            </div>
          </div>
        </div>
      )}

      <div className="page-header">
        <div>
          <h1>Visão geral</h1>
          <div className="muted small">{periodLabel(period)} · atualizado agora</div>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {[7, 15, 30].map(d => (
            <button key={d} className={period.days === d ? 'accent' : ''} onClick={() => setPeriod({ days: d })}>
              {d}d
            </button>
          ))}
          <button className={period.all ? 'accent' : ''} onClick={() => setPeriod({ all: true })}>Geral</button>
          <input type="date" value={period.from || ''} max={period.to || undefined}
            onChange={e => setPeriod(p => ({ from: e.target.value, to: p.to }))}
            style={{ padding: '4px 8px', fontSize: 12 }} title="De" />
          <span className="small muted">até</span>
          <input type="date" value={period.to || ''} min={period.from || undefined}
            onChange={e => setPeriod(p => ({ from: p.from, to: e.target.value }))}
            style={{ padding: '4px 8px', fontSize: 12 }} title="Até" />
        </div>
      </div>

      {/* === Insights automáticos === */}
      {insights.length > 0 && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {insights.map((ins, i) => (
            <div key={i} className="card" style={{
              padding: '14px 18px',
              flex: '1 1 240px',
              borderLeft: `3px solid ${ins.color}`,
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <div style={{ fontSize: 22 }}>{ins.icon}</div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{ins.title}</div>
                <div className="small muted">{ins.detail}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* === KPIs com sparklines === */}
      <div className="grid-4">
        <KpiCard
          label="Leads no período"
          value={totalLeads}
          spark={porDia.map(d => ({ v: d.total }))}
          sparkColor="var(--lc-magenta)"
          gradient
        />
        <KpiCard
          label="Qualificados"
          value={qualificados}
          hint={`${taxaQualificacao}% de conversão`}
          spark={porDia.map(d => ({ v: d.qualificados || 0 }))}
          sparkColor="var(--lc-success)"
          delta={taxaQualificacao >= 20 ? { dir: 'up', value: `${taxaQualificacao}%` } : null}
        />
        <KpiCard
          label="Em atendimento"
          value={emAtendimento}
          hint="Tina conversando"
          spark={porDia.map(d => ({ v: Math.max(0, (d.total || 0) - (d.qualificados || 0)) }))}
          sparkColor="var(--lc-magenta-600)"
        />
        <KpiCard
          label="Equipe assumiu"
          value={equipeAssumiu}
          hint="leads que o time pegou"
          spark={porDia.map(d => ({ v: 0 }))}
          sparkColor="var(--lc-stone)"
        />
      </div>

      {/* === Layout 2 colunas: chart principal + funil + por funil === */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16 }}>
        <div className="card elevated">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
            <h3>Volume de leads por dia</h3>
            <span className="small muted">Total vs Qualificados</span>
          </div>
          <div style={{ height: 260, marginTop: 12 }}>
            <ResponsiveContainer>
              <AreaChart data={porDia}>
                <defs>
                  <linearGradient id="gradTotal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#111111" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#111111" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradQual" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#E6227A" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#E6227A" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" />
                <XAxis dataKey="dia" fontSize={11} stroke="var(--text-tertiary)" />
                <YAxis fontSize={11} stroke="var(--text-tertiary)" />
                <Tooltip contentStyle={{ background: 'var(--surface-card)', border: '1px solid var(--border-soft)', borderRadius: 10 }} />
                <Area type="monotone" dataKey="total" stroke="#111111" strokeWidth={2} fill="url(#gradTotal)" name="Total" />
                <Area type="monotone" dataKey="qualificados" stroke="#E6227A" strokeWidth={2} fill="url(#gradQual)" name="Qualificados" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="col" style={{ gap: 16 }}>
          {/* Funil de conversão */}
          <div className="card">
            <h3>Funil de conversão</h3>
            <div style={{ marginTop: 14 }}>
              {funilConversao.map((s, i) => {
                const pct = totalLeads ? Math.round((s.value / totalLeads) * 100) : 0;
                const widthPct = i === 0 ? 100 : pct;
                return (
                  <div key={s.stage} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>{s.stage}</span>
                      <span style={{ color: 'var(--text-tertiary)' }}>{s.value} · {pct}%</span>
                    </div>
                    <div style={{ background: 'var(--border-soft)', borderRadius: 6, height: 8, overflow: 'hidden' }}>
                      <div style={{
                        width: `${widthPct}%`,
                        background: s.color,
                        height: '100%',
                        borderRadius: 6,
                        transition: 'width 0.6s var(--ease-out)',
                      }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Por funil */}
          <div className="card">
            <h3>Distribuição por funil</h3>
            <div style={{ marginTop: 12 }}>
              {porFunil.map(f => {
                const pct = totalLeads ? Math.round((f.total / totalLeads) * 100) : 0;
                const color = FUNNEL_COLORS[f.funnel] || '#9A9A9A';
                return (
                  <div key={f.funnel} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                      <span style={{ color: 'var(--text-secondary)', textTransform: 'capitalize' }}>
                        {FUNNEL_LABELS[f.funnel] || f.funnel}
                      </span>
                      <span style={{ color: 'var(--text-tertiary)' }}>{f.total}</span>
                    </div>
                    <div style={{ background: 'var(--border-soft)', borderRadius: 6, height: 6, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, background: color, height: '100%', transition: 'width 0.6s' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* === Atendidos × Agendados (listas) === */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h3>Atendidos pela Tina</h3>
            <span className="small muted">{atendidos.length}</span>
          </div>
          <div style={{ marginTop: 12, maxHeight: 360, overflow: 'auto' }}>
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-tertiary)' }}>
                  <th style={{ padding: '4px 6px' }}>Lead</th>
                  <th style={{ padding: '4px 6px' }}>Funil</th>
                  <th style={{ padding: '4px 6px' }}>Última resposta</th>
                  <th style={{ padding: '4px 6px' }}>Msgs</th>
                </tr>
              </thead>
              <tbody>
                {atendidos.map(a => (
                  <tr key={a.id} style={{ borderTop: '1px solid var(--border-soft)' }}>
                    <td style={{ padding: '4px 6px' }}>{a.name || '—'}</td>
                    <td style={{ padding: '4px 6px', textTransform: 'capitalize' }}>{a.funnel || '—'}</td>
                    <td style={{ padding: '4px 6px' }} className="small muted">{fmtDate(a.ultima_resposta)}</td>
                    <td style={{ padding: '4px 6px' }}>{a.msgs_ia}</td>
                  </tr>
                ))}
                {!atendidos.length && <tr><td colSpan={4} className="small muted" style={{ padding: '8px 6px' }}>Nenhum no período.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h3>Agendados</h3>
            <span className="small muted">{agendados.length}</span>
          </div>
          <div style={{ marginTop: 12, maxHeight: 360, overflow: 'auto' }}>
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-tertiary)' }}>
                  <th style={{ padding: '4px 6px' }}>Lead</th>
                  <th style={{ padding: '4px 6px' }}>Quando</th>
                  <th style={{ padding: '4px 6px' }}>Funil</th>
                </tr>
              </thead>
              <tbody>
                {agendados.map((a, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border-soft)' }}>
                    <td style={{ padding: '4px 6px' }}>{a.name || '—'}</td>
                    <td style={{ padding: '4px 6px' }} className="small">{a.quando || '—'}</td>
                    <td style={{ padding: '4px 6px', textTransform: 'capitalize' }}>{a.funnel || '—'}</td>
                  </tr>
                ))}
                {!agendados.length && <tr><td colSpan={3} className="small muted" style={{ padding: '8px 6px' }}>Nenhum no período.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, hint, spark, sparkColor, delta, gradient }) {
  return (
    <div className={`kpi ${gradient ? 'gradient' : ''}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {hint && <div className="hint">{hint}</div>}
      {delta && (
        <div className={`delta ${delta.dir}`}>
          {delta.dir === 'up' && '↗'}
          {delta.dir === 'down' && '↘'}
          {delta.dir === 'flat' && '→'}
          {delta.value}
        </div>
      )}
      {spark && spark.length > 1 && (
        <div className="spark">
          <ResponsiveContainer>
            <LineChart data={spark}>
              <Line type="monotone" dataKey="v" stroke={sparkColor} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function generateInsights({ porDia, porFunil, porHora, tempoResposta, taxaQualificacao, totalLeads }) {
  if (totalLeads === 0) return [];
  const ins = [];

  // Insight 1: tempo médio de resposta da Tina — número que vende
  if (tempoResposta?.media && tempoResposta.media < 600) {
    const seg = Math.round(tempoResposta.media);
    ins.push({
      icon: '⚡',
      title: `Resposta em ${seg < 60 ? `${seg}s` : `${Math.round(seg / 60)}min`}`,
      detail: 'Tina responde antes do lead esfriar',
      color: 'var(--lc-success)',
    });
  }

  // Insight 2: tendência (último dia vs penúltimo)
  if (porDia.length >= 2) {
    const last = porDia[porDia.length - 1];
    const prev = porDia[porDia.length - 2];
    const diff = (last.total || 0) - (prev.total || 0);
    if (diff > 0) {
      ins.push({
        icon: '📈',
        title: `+${diff} leads vs dia anterior`,
        detail: `Hoje: ${last.total}, ontem: ${prev.total}`,
        color: 'var(--lc-success)',
      });
    } else if (diff < 0 && Math.abs(diff) > 2) {
      ins.push({
        icon: '📉',
        title: `${diff} leads vs dia anterior`,
        detail: 'Tráfego em queda, checar criativos',
        color: 'var(--lc-warn)',
      });
    }
  }

  // Insight 3: taxa de qualificação
  if (taxaQualificacao >= 25) {
    ins.push({
      icon: '🎯',
      title: `${taxaQualificacao}% de conversão`,
      detail: 'Acima da média, Tina qualificando bem',
      color: 'var(--lc-success)',
    });
  }

  // Insight 4: top funil
  const topFunil = [...porFunil].sort((a, b) => b.total - a.total)[0];
  if (topFunil && topFunil.funnel !== 'indefinido') {
    ins.push({
      icon: '🏆',
      title: `Funil ${FUNNEL_LABELS[topFunil.funnel] || topFunil.funnel} liderando`,
      detail: `${topFunil.total} leads (${Math.round(topFunil.total / totalLeads * 100)}% do total)`,
      color: 'var(--lc-magenta)',
    });
  }

  return ins.slice(0, 4);
}

function SkeletonOverview() {
  return (
    <div className="col" style={{ gap: 24 }}>
      <div className="skeleton" style={{ height: 80, borderRadius: 14 }} />
      <div className="grid-4">
        {[1, 2, 3, 4].map(i => <div key={i} className="skeleton" style={{ height: 130, borderRadius: 14 }} />)}
      </div>
      <div className="skeleton" style={{ height: 320, borderRadius: 14 }} />
    </div>
  );
}
