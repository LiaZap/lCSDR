import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';

// Playground: chat ao vivo com a Lila sem passar pelo GHL.
// Serve pra refinar prompt, gerar exemplos bons/ruins e demonstrar pra Lilian.

const PERSONAS_SUGESTAO = [
  { label: '📝 Autor inseguro', msg: 'Oi, eu quero escrever um livro mas não sei nem por onde começar. Tenho uma ideia sobre superação, minha filha tem autismo e foi uma jornada.' },
  { label: '📖 Autor profissional', msg: 'Oi, sou advogado, já terminei meu livro sobre direito tributário (180 páginas) e quero publicar com qualidade. Preciso que chegue em livraria.' },
  { label: '📣 Autor publicado', msg: 'Tenho um livro que lancei mês passado na Amazon e preciso de divulgação / mídia espontânea. Já tem umas 30 avaliações.' },
  { label: '🗑️ Lead lixo', msg: 'Oi achei que fosse de graça, queria fazer um livrinho de receita pra dar pra minha família no Natal' },
  { label: '❓ Curioso', msg: 'Oi, vi um anúncio, queria saber quanto custa publicar um livro' },
];

export default function Playground() {
  const [sessionId, setSessionId] = useState(null);
  const [userName, setUserName] = useState('Lead de teste');
  const [messages, setMessages] = useState([]);
  const [contact, setContact] = useState(null);
  const [msg, setMsg] = useState('');
  const [sending, setSending] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [lastResult, setLastResult] = useState(null);
  const messagesRef = useRef(null);

  async function loadSessions() {
    const r = await api.playground.sessions();
    setSessions(r.sessions || []);
  }

  async function newSession() {
    const r = await api.playground.newSession();
    setSessionId(r.sessionId);
    setMessages([]);
    setContact(null);
    setLastResult(null);
  }

  async function openSession(sid) {
    setSessionId(sid);
    const r = await api.playground.session(sid);
    setMessages(r.messages || []);
    setContact(r.contact);
    setLastResult(null);
  }

  async function deleteSession(sid, e) {
    e.stopPropagation();
    if (!confirm('Apagar esta sessão?')) return;
    await api.playground.delete(sid);
    if (sid === sessionId) newSession();
    loadSessions();
  }

  useEffect(() => {
    loadSessions();
    if (!sessionId) newSession();
  }, []);

  useEffect(() => { messagesRef.current?.scrollTo(0, 9e9); }, [messages.length]);

  async function send(textOverride) {
    if (sending) return; // double-submit guard
    const text = (textOverride ?? msg).trim();
    if (!text || !sessionId) return;
    setSending(true);
    // Otimista: mostra a mensagem do usuário no chat na hora
    const tempMsg = {
      id: `temp-${Date.now()}`,
      direction: 'inbound',
      author: 'lead',
      content: text,
      created_at: new Date().toISOString(),
    };
    setMessages(m => [...m, tempMsg]);
    setMsg('');
    try {
      const r = await api.playground.chat(sessionId, text, userName);
      setMessages(r.messages || []);
      setContact(r.contact);
      setLastResult(r);
      loadSessions();
    } catch (e) {
      alert('Erro: ' + e.message);
      setMessages(m => m.filter(x => x.id !== tempMsg.id));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="col" style={{ gap: 0 }}>
      <div className="page-header">
        <div>
          <h1>Playground</h1>
          <div className="muted small">Converse com a Lila sem passar pelo WhatsApp real · use pra refinar o script</div>
        </div>
        <div className="row">
          <input
            placeholder="Nome fictício do lead"
            value={userName}
            onChange={e => setUserName(e.target.value)}
            style={{ width: 200 }}
          />
          <button className="accent" onClick={newSession}>+ Nova conversa</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr 320px', gap: 16, height: 'calc(100vh - 140px)' }}>
        {/* === SIDEBAR: sessões salvas === */}
        <div className="card" style={{ padding: 0, overflowY: 'auto' }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--lc-line)' }}>
            <div className="small muted">Sessões salvas</div>
            <div style={{ fontWeight: 600 }}>{sessions.length}</div>
          </div>
          {sessions.map(s => (
            <div
              key={s.sessionId}
              onClick={() => openSession(s.sessionId)}
              style={{
                padding: '12px 16px',
                borderBottom: '1px solid var(--lc-line)',
                cursor: 'pointer',
                background: s.sessionId === sessionId ? 'var(--lc-magenta-50)' : 'transparent',
                borderLeft: s.sessionId === sessionId ? '3px solid var(--lc-magenta)' : '3px solid transparent',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{s.name || 'Sem nome'}</div>
                <button
                  className="ghost small"
                  onClick={e => deleteSession(s.sessionId, e)}
                  style={{ padding: '0 6px', fontSize: 11, color: 'var(--lc-stone)' }}
                  title="Apagar"
                >×</button>
              </div>
              <div className="small muted" style={{ marginTop: 2 }}>
                {s.msg_count} msgs · {s.funnel || '—'} · {s.stage}
              </div>
            </div>
          ))}
          {sessions.length === 0 && (
            <div className="muted small" style={{ padding: 20, textAlign: 'center' }}>
              Nenhuma sessão ainda
            </div>
          )}
        </div>

        {/* === CENTRO: chat === */}
        <div className="chat-panel">
          <div className="header">
            <div>
              <strong>Conversa</strong>
              <div className="small muted">Session: <code className="mono">{sessionId || '—'}</code></div>
            </div>
          </div>

          <div className="messages" ref={messagesRef}>
            {messages.length === 0 && (
              <div style={{ textAlign: 'center', padding: 30 }}>
                <div className="muted" style={{ marginBottom: 16 }}>
                  Comece uma conversa ou clique numa persona pronta:
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
                  {PERSONAS_SUGESTAO.map(p => (
                    <button
                      key={p.label}
                      className="ghost"
                      onClick={() => send(p.msg)}
                      style={{
                        maxWidth: 500,
                        textAlign: 'left',
                        padding: '10px 14px',
                        border: '1px solid var(--lc-line)',
                        fontSize: 13,
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>{p.label}</div>
                      <div className="small muted" style={{ marginTop: 2 }}>{p.msg}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map(m => (
              <div key={m.id} className={`bubble ${m.author === 'lead' ? 'lead' : m.author === 'ia' ? 'ia' : 'sdr'}`}>
                {m.content}
                <div className="meta">
                  {m.author === 'lead' ? 'Lead' : m.author === 'ia' ? 'Lila' : 'SDR'} ·{' '}
                  {new Date(m.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            ))}

            {sending && (
              <div className="bubble ia" style={{ opacity: 0.6 }}>
                Lila digitando…
              </div>
            )}

            {/* Botões da última resposta da Lila — clique manda o `value` como nova mensagem */}
            {!sending && lastResult?.buttons?.length > 0 && (
              <div style={{ alignSelf: 'flex-end', display: 'flex', flexDirection: 'column', gap: 6, maxWidth: '72%' }}>
                {lastResult.buttons.map((b, i) => (
                  <button
                    key={i}
                    onClick={() => send(`[clicou: ${b.label}] (valor=${b.value || b.label})`)}
                    style={{
                      background: 'var(--lc-white)',
                      border: '1px solid var(--lc-magenta)',
                      color: 'var(--lc-magenta-600)',
                      borderRadius: 12,
                      padding: '8px 14px',
                      fontSize: 13,
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    {b.label}
                  </button>
                ))}
                {lastResult.footerText && (
                  <div className="small muted" style={{ textAlign: 'right', marginTop: 2 }}>
                    {lastResult.footerText}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="composer">
            <textarea
              placeholder="Digite como se fosse o lead… (Ctrl/Cmd+Enter envia)"
              value={msg}
              onChange={e => setMsg(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }}
              disabled={sending}
            />
            <button className="primary" onClick={() => send()} disabled={sending || !msg.trim()}>
              {sending ? 'Lila pensando…' : 'Enviar'}
            </button>
          </div>
        </div>

        {/* === DIREITA: painel de qualificação ao vivo === */}
        <div className="col">
          <div className="card">
            <h3>Qualificação ao vivo</h3>
            <div style={{ marginTop: 14 }}>
              <Row label="Funil detectado" value={<FunnelTag funnel={contact?.funnel} />} />
              <Row label="Estágio" value={<StageTag stage={contact?.stage} />} />
              <Row label="Score">
                <div style={{ width: '100%' }}>
                  <div style={{
                    fontFamily: 'var(--font-serif)',
                    fontSize: 32,
                    color: 'var(--lc-magenta-600)',
                    lineHeight: 1,
                  }}>
                    {contact?.qualification_score || 0}
                    <span style={{ fontSize: 14, color: 'var(--lc-stone)' }}>/100</span>
                  </div>
                  <div style={{ marginTop: 8, background: 'var(--lc-line)', borderRadius: 99, height: 6 }}>
                    <div style={{
                      width: `${Math.max(0, Math.min(100, contact?.qualification_score || 0))}%`,
                      background: 'var(--lc-magenta)',
                      height: '100%',
                      borderRadius: 99,
                      transition: 'width .4s',
                    }} />
                  </div>
                </div>
              </Row>

              {lastResult?.handoff && (
                <div className="tag black" style={{ marginTop: 12, display: 'inline-block' }}>
                  ⇢ Handoff acionado
                </div>
              )}
              {lastResult?.endConversation && (
                <div className="tag danger" style={{ marginTop: 12, display: 'inline-block' }}>
                  ✕ IA encerrou a conversa
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <h3>Notas da Lila</h3>
            <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, marginTop: 10, color: 'var(--lc-ink)' }}>
              {contact?.qualification_notes || <span className="muted">Ainda sem notas — a Lila escreve conforme a conversa avança.</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="small muted" style={{ marginBottom: 4 }}>{label}</div>
      <div>{children || value || <span className="muted">—</span>}</div>
    </div>
  );
}

function FunnelTag({ funnel }) {
  if (!funnel) return <span className="muted">indefinido</span>;
  const map = {
    escrever: { cls: 'magenta', label: '📝 Escrever' },
    publicar: { cls: 'black', label: '📖 Publicar' },
    divulgar: { cls: 'berry', label: '📣 Divulgar' },
  };
  const it = map[funnel] || { cls: '', label: funnel };
  return <span className={`tag ${it.cls}`}>{it.label}</span>;
}

function StageTag({ stage }) {
  if (!stage) return <span className="muted">—</span>;
  const map = {
    qualificado: { cls: 'success', label: 'Qualificado' },
    handoff: { cls: 'black', label: 'Handoff' },
    qualificando: { cls: 'magenta', label: 'Qualificando' },
    pre_qualificando: { cls: 'magenta', label: 'Pré-qualificando' },
    desqualificado: { cls: 'danger', label: 'Desqualificado' },
    novo: { cls: '', label: 'Novo' },
  };
  const it = map[stage] || { cls: '', label: stage };
  return <span className={`tag ${it.cls}`}>{it.label}</span>;
}
