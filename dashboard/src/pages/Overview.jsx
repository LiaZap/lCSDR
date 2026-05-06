import { useEffect, useState } from 'react';
import { api, getUser } from '../lib/api.js';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, CartesianGrid,
} from 'recharts';

const FUNNEL_COLORS = {
  escrever: '#E6227A',   // magenta principal
  publicar: '#111111',   // preto
  divulgar: '#A01854',   // berry
  indefinido: '#9A9A9A', // cinza
};

export default function Overview() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);

  useEffect(() => {
    api.metrics(days).then(setData).catch(console.error);
  }, [days]);

  const user = getUser();
  const seenWelcome = typeof window !== 'undefined' && localStorage.getItem('lc_welcome_seen') === '1';

  if (!data) return <div className="muted">Carregando métricas…</div>;
  const { totais = {}, porFunil = [], porDia = [] } = data;

  const totalLeads = totais.leads || 0;
  const qualificados = totais.qualificados || 0;
  const taxaQualificacao = totalLeads ? Math.round((qualificados / totalLeads) * 100) : 0;

  return (
    <div className="col" style={{ gap: 24 }}>
      {!seenWelcome && (
        <div className="card" style={{ borderLeft: '4px solid var(--lc-magenta)', position: 'relative' }}>
          <button
            className="ghost small"
            onClick={() => { localStorage.setItem('lc_welcome_seen', '1'); window.location.reload(); }}
            style={{ position: 'absolute', top: 8, right: 12, padding: '2px 8px', fontSize: 18, color: 'var(--lc-stone)' }}
            title="Fechar"
          >×</button>
          <h2 style={{ marginBottom: 8 }}>👋 Bem-vinda{user?.name ? `, ${user.name.split(' ')[0]}` : ''}!</h2>
          <p style={{ marginBottom: 12, lineHeight: 1.6 }}>
            Esse é o painel da <strong>Lila</strong>, IA SDR do Grupo LC. Veja o que dá pra fazer aqui:
          </p>
          <ol style={{ paddingLeft: 20, lineHeight: 1.8, fontSize: 14 }}>
            <li>
              <strong>Playground</strong> — converse com a Lila como se fosse um lead. Use pra testar o tom, tirar dúvidas, ver os botões interativos. Sem custo de WhatsApp real.
            </li>
            <li>
              <strong>Conversas / Leads</strong> — leia o que a Lila falou com leads. Em cada conversa, dá pra avaliar 👍 / 👎 e deixar comentário. <em>Esse feedback alimenta o refinamento contínuo do prompt</em> — quanto mais você marcar, melhor a Lila fica.
            </li>
            <li>
              <strong>Visão geral</strong> — métricas em tempo real: leads/dia, funil, taxa de qualificação.
            </li>
          </ol>
          <div className="small muted" style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--lc-line)' }}>
            ⚠ Os dados aqui são demo (gerados pela própria IA). WhatsApp real ainda não está conectado.
          </div>
        </div>
      )}

      <div className="page-header">
        <div>
          <h1>Visão geral</h1>
          <div className="muted small">Últimos {days} dias</div>
        </div>
        <div className="row">
          {[7, 15, 30].map(d => (
            <button key={d} className={d === days ? 'accent' : ''} onClick={() => setDays(d)}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      <div className="grid-4">
        <Kpi label="Leads no período" value={totais.leads || 0} />
        <Kpi label="Qualificados" value={totais.qualificados || 0} hint="prontos pro SDR" />
        <Kpi label="Em atendimento IA" value={totais.em_atendimento || 0} />
        <Kpi label="Desqualificados" value={totais.desqualificados || 0} hint="IA filtrou" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16 }}>
        <div className="card">
          <h3>Leads por dia</h3>
          <div style={{ height: 260, marginTop: 12 }}>
            <ResponsiveContainer>
              <LineChart data={porDia}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EDE7DF" />
                <XAxis dataKey="dia" fontSize={11} stroke="#6F6F6F" />
                <YAxis fontSize={11} stroke="#6F6F6F" />
                <Tooltip />
                <Line type="monotone" dataKey="total" stroke="#111111" strokeWidth={2} dot={false} name="Total" />
                <Line type="monotone" dataKey="qualificados" stroke="#E6227A" strokeWidth={2} dot={false} name="Qualificados" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="col">
          <div className="card">
            <h3>Taxa de qualificação</h3>
            <div style={{ marginTop: 10 }}>
              <div style={{
                fontFamily: 'var(--font-serif)',
                fontSize: 44,
                color: 'var(--lc-magenta-600)',
                lineHeight: 1,
              }}>
                {taxaQualificacao}%
              </div>
              <div className="small muted" style={{ marginTop: 6 }}>
                {qualificados} de {totalLeads} leads qualificados pela Lila
              </div>
              <div style={{ marginTop: 12, background: 'var(--lc-line)', borderRadius: 99, height: 8 }}>
                <div style={{
                  width: `${taxaQualificacao}%`,
                  background: 'var(--lc-magenta)',
                  height: '100%',
                  borderRadius: 99,
                  transition: 'width .4s',
                }} />
              </div>
            </div>
          </div>

          <div className="card">
            <h3>Por funil</h3>
            <div style={{ height: 180, marginTop: 10 }}>
              <ResponsiveContainer>
                <BarChart data={porFunil}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#EDE7DF" />
                  <XAxis dataKey="funnel" fontSize={11} stroke="#6F6F6F" />
                  <YAxis fontSize={11} stroke="#6F6F6F" />
                  <Tooltip />
                  <Bar dataKey="total" name="Leads">
                    {porFunil.map((f, i) => (
                      <rect key={i} fill={FUNNEL_COLORS[f.funnel] || '#9A9A9A'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, hint }) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}
