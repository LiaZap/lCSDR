import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api.js';

export default function LeadDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState('');
  const [sending, setSending] = useState(false);
  const messagesRef = useRef(null);

  async function load() {
    const r = await api.contact(id);
    setData(r);
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [id]);

  useEffect(() => {
    messagesRef.current?.scrollTo(0, 9e9);
  }, [data?.messages?.length]);

  if (!data) return <div className="muted">Carregando…</div>;
  const { contact, messages = [] } = data;

  async function send() {
    if (sending) return; // double-submit guard (Ctrl+Enter mantido apertado)
    if (!msg.trim()) return;
    setSending(true);
    try {
      await api.send(id, msg.trim());
      setMsg('');
      await load();
    } catch (e) { alert(e.message); }
    finally { setSending(false); }
  }

  async function assume() { await api.assume(id); load(); }
  async function release() { await api.release(id); load(); }

  return (
    <div className="col">
      <div className="page-header">
        <div>
          <Link to="/leads" className="small">← Voltar aos leads</Link>
          <h1 style={{ marginTop: 8 }}>{contact.name || '(sem nome)'}</h1>
          <div className="muted small">{contact.phone || '—'} · {contact.email || '—'}</div>
        </div>
        <div className="row">
          {contact.ai_paused ? (
            <button className="accent" onClick={release}>Devolver pra IA</button>
          ) : (
            <button className="primary" onClick={assume}>Assumir conversa</button>
          )}
        </div>
      </div>

      <div className="chat-shell" style={{ gridTemplateColumns: '1fr 300px' }}>
        <div className="chat-panel">
          <div className="header">
            <div>
              <strong>Conversa</strong>
              <div className="small muted">{messages.length} mensagens</div>
            </div>
            <div className="row">
              {contact.ai_paused
                ? <span className="tag black">IA pausada · SDR no controle</span>
                : <span className="tag magenta">IA atendendo</span>}
            </div>
          </div>

          <div className="messages" ref={messagesRef}>
            {messages.map(m => (
              <div key={m.id} className={`bubble ${m.author === 'lead' ? 'lead' : m.author === 'ia' ? 'ia' : 'sdr'}`}>
                {m.content}
                <div className="meta">
                  {m.author === 'lead' ? 'Lead' : m.author === 'ia' ? 'Lila' : 'SDR'} ·{' '}
                  {new Date(m.created_at).toLocaleString('pt-BR')}
                </div>
              </div>
            ))}
            {messages.length === 0 && <div className="muted" style={{ textAlign: 'center' }}>Sem mensagens ainda</div>}
          </div>

          <div className="composer">
            <textarea
              placeholder="Responder como SDR (isso pausa a IA)…"
              value={msg}
              onChange={e => setMsg(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }}
            />
            <button className="primary" onClick={send} disabled={sending}>
              {sending ? 'Enviando…' : 'Enviar'}
            </button>
          </div>
        </div>

        <div className="col">
          <div className="card">
            <h3>Qualificação</h3>
            <div style={{ marginTop: 12 }}>
              <div className="small muted">Funil</div>
              <div><strong>{contact.funnel || '—'}</strong></div>
              <div className="small muted" style={{ marginTop: 10 }}>Estágio</div>
              <div><strong>{contact.stage}</strong></div>
              <div className="small muted" style={{ marginTop: 10 }}>Score</div>
              <div><strong style={{ color: 'var(--lc-magenta-600)', fontSize: 20 }}>{contact.qualification_score || 0}/100</strong></div>
              <div className="small muted" style={{ marginTop: 10 }}>Notas da Lila</div>
              <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, marginTop: 4 }}>
                {contact.qualification_notes || <span className="muted">—</span>}
              </div>
            </div>
          </div>

          <div className="card">
            <h3>Atividade</h3>
            <div className="small" style={{ marginTop: 10 }}>
              <div className="muted">Última msg recebida</div>
              <div>{contact.last_inbound_at ? new Date(contact.last_inbound_at).toLocaleString('pt-BR') : '—'}</div>
              <div className="muted" style={{ marginTop: 8 }}>Última msg enviada</div>
              <div>{contact.last_outbound_at ? new Date(contact.last_outbound_at).toLocaleString('pt-BR') : '—'}</div>
              <div className="muted" style={{ marginTop: 8 }}>SDR atribuído</div>
              <div>{contact.sdr_name || '—'}</div>
            </div>
          </div>

          <FeedbackCard contactId={id} feedbacks={data.feedbacks || []} reload={load} />
        </div>
      </div>
    </div>
  );
}

// === Card de feedback humano sobre o tom da Lila ===
function FeedbackCard({ contactId, feedbacks, reload }) {
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  async function send(verdict) {
    setSaving(true);
    try {
      await api.feedback(contactId, verdict, comment.trim() || null);
      setComment('');
      reload();
    } catch (e) {
      alert('Erro: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  const labelMap = {
    tom_ok: { icon: '👍', label: 'Tom OK', cls: 'success' },
    tom_errado: { icon: '👎', label: 'Tom errado', cls: 'danger' },
    corrigir: { icon: '💬', label: 'Corrige isso', cls: 'magenta' },
  };

  return (
    <div className="card" style={{ borderTop: '3px solid var(--lc-magenta)' }}>
      <h3>Avalie o tom da Lila</h3>
      <div className="small muted" style={{ marginTop: 6 }}>
        Esse feedback alimenta refinamento contínuo do prompt.
      </div>

      <textarea
        placeholder="O que ajustar (opcional)…"
        value={comment}
        onChange={e => setComment(e.target.value)}
        rows={3}
        style={{ marginTop: 12, fontSize: 13 }}
      />

      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        <button onClick={() => send('tom_ok')} disabled={saving} style={{ flex: 1, fontSize: 13 }}>
          👍 OK
        </button>
        <button onClick={() => send('tom_errado')} disabled={saving} style={{ flex: 1, fontSize: 13 }}>
          👎 Errado
        </button>
        <button onClick={() => send('corrigir')} disabled={saving || !comment.trim()} style={{ flex: 1, fontSize: 13 }}>
          💬 Corrigir
        </button>
      </div>

      {feedbacks.length > 0 && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--lc-line)' }}>
          <div className="small muted" style={{ marginBottom: 8 }}>Histórico ({feedbacks.length})</div>
          {feedbacks.slice(0, 5).map(f => {
            const it = labelMap[f.verdict] || { icon: '?', label: f.verdict, cls: '' };
            return (
              <div key={f.id} style={{ marginBottom: 8, fontSize: 12 }}>
                <span className={`tag ${it.cls}`}>{it.icon} {it.label}</span>
                {' '}<span className="muted">— {f.reviewer_name}, {new Date(f.created_at).toLocaleString('pt-BR')}</span>
                {f.comment && (
                  <div style={{ marginTop: 4, paddingLeft: 8, borderLeft: '2px solid var(--lc-line)' }}>{f.comment}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
