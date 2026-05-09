import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';

const FILTERS = [
  { id: 'pending', label: 'A revisar', filter: c => !c.feedback_count || c.feedback_count === 0 },
  { id: 'reviewed', label: 'Já avaliadas', filter: c => c.feedback_count > 0 },
  { id: 'all', label: 'Todas', filter: () => true },
  { id: 'qualified', label: 'Qualificados', filter: c => c.stage === 'qualificado' || c.stage === 'handoff' },
  { id: 'in_progress', label: 'Em atendimento', filter: c => ['qualificando', 'pre_qualificando', 'novo'].includes(c.stage) },
  { id: 'today', label: 'Hoje', filter: c => isToday(c.last_inbound_at || c.updated_at) },
  { id: 'disqualified', label: 'Descartados', filter: c => c.stage === 'desqualificado' },
];

function isToday(iso) {
  if (!iso) return false;
  const d = new Date(iso);
  const today = new Date();
  return d.toDateString() === today.toDateString();
}

export default function Conversations() {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState(null);
  const [filter, setFilter] = useState('pending');
  const [search, setSearch] = useState('');
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState('');
  const [sending, setSending] = useState(false);
  const messagesRef = useRef(null);
  const nav = useNavigate();

  async function loadList() {
    setLoading(true);
    try {
      const r = await api.contacts({ limit: 200 });
      const order = { qualificado: 0, handoff: 1, qualificando: 2, pre_qualificando: 3, novo: 4, agendado: 5, desqualificado: 6 };
      const rows = (r.contacts || []).sort((a, b) => (order[a.stage] ?? 9) - (order[b.stage] ?? 9));
      setContacts(rows);
      // Forma funcional: só define o primeiro como ativo SE não tiver nenhum.
      // Senão (já tem ativo, mesmo que mudou pelo clique do usuário), preserva.
      // Importante: usar callback evita stale closure no setInterval.
      if (rows.length > 0) {
        setActive(prev => prev ?? rows[0].id);
      }
    } finally { setLoading(false); }
  }

  async function loadDetail(id) {
    if (!id) return;
    try {
      const r = await api.contact(id);
      setData(r);
    } catch (e) { console.error(e); }
  }

  // Carrega lista inicial e refaz a cada 15s.
  // IMPORTANTE: deps vazias propositalmente — o polling é independente do clique.
  // O fix do "volta pra primeira" foi feito em loadList usando setActive(prev => prev ?? ...).
  useEffect(() => {
    loadList();
    const t = setInterval(loadList, 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { loadDetail(active); }, [active]);
  useEffect(() => { messagesRef.current?.scrollTo(0, 9e9); }, [data?.messages?.length]);

  // Aplica filtros
  const filtered = useMemo(() => {
    const filterFn = FILTERS.find(f => f.id === filter)?.filter || (() => true);
    return contacts.filter(filterFn).filter(c => {
      if (!search) return true;
      const s = search.toLowerCase();
      return (c.name || '').toLowerCase().includes(s)
        || (c.phone || '').includes(s)
        || (c.qualification_notes || '').toLowerCase().includes(s);
    });
  }, [contacts, filter, search]);

  // Counts pra cada filtro
  const counts = useMemo(() => {
    const out = {};
    FILTERS.forEach(f => { out[f.id] = contacts.filter(f.filter).length; });
    return out;
  }, [contacts]);

  async function send() {
    if (!msg.trim() || !active) return;
    setSending(true);
    try {
      await api.send(active, msg.trim());
      setMsg('');
      await loadDetail(active);
    } catch (e) { alert(e.message); }
    finally { setSending(false); }
  }

  async function assume() { await api.assume(active); loadDetail(active); }
  async function release() { await api.release(active); loadDetail(active); }

  const contact = data?.contact;
  const messages = data?.messages || [];

  return (
    <div className="inbox-shell">
      {/* === Coluna 1: Lista === */}
      <aside className="inbox-list">
        <div className="inbox-list-head">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h2 style={{ fontSize: 18, fontFamily: 'var(--font-sans)' }}>Conversas</h2>
            <button className="ghost small" onClick={loadList} title="Atualizar">↻</button>
          </div>
          <input
            placeholder="🔍  Buscar por nome, telefone…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ marginTop: 10, marginBottom: 10 }}
          />

          <div className="inbox-tabs">
            {FILTERS.map(f => (
              <button
                key={f.id}
                className={filter === f.id ? 'active' : ''}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
                {counts[f.id] > 0 && <span className="badge">{counts[f.id]}</span>}
              </button>
            ))}
          </div>
        </div>

        <div className="inbox-list-body">
          {loading && filtered.length === 0 && (
            <>
              {[1, 2, 3, 4].map(i => <div key={i} className="skeleton" style={{ height: 64, marginBottom: 1 }} />)}
            </>
          )}
          {!loading && filtered.length === 0 && (
            <div className="muted small" style={{ padding: 30, textAlign: 'center' }}>
              Nada por aqui
            </div>
          )}
          {filtered.map(c => (
            <ChatListItem key={c.id} contact={c} active={c.id === active} onClick={() => setActive(c.id)} />
          ))}
        </div>
      </aside>

      {/* === Coluna 2: Conversa === */}
      <main className="inbox-chat">
        {!contact && (
          <div className="inbox-empty">
            <div style={{ fontSize: 48, opacity: 0.3 }}>✉</div>
            <h3>Selecione uma conversa</h3>
            <p className="muted small">Escolha um lead da lista pra ver o histórico</p>
          </div>
        )}

        {contact && (
          <>
            <div className="inbox-chat-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div className="lead-avatar" style={{ width: 40, height: 40, fontSize: 14 }}>
                  {(contact.name || '?').split(' ').map(s => s[0]).slice(0, 2).join('')}
                </div>
                <div>
                  <div style={{ fontWeight: 600 }}>{contact.name || '(sem nome)'}</div>
                  <div className="small muted">{contact.phone || '—'}</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {contact.ai_paused
                  ? <span className="tag black">🤖 IA pausada · SDR ativo</span>
                  : <span className="tag magenta">🤖 Lila atendendo</span>}
                {contact.ai_paused
                  ? <button onClick={release}>Devolver pra IA</button>
                  : <button className="primary" onClick={assume}>Assumir</button>}
                <button className="ghost" onClick={() => nav(`/leads/${contact.id}`)} title="Detalhe completo">⤢</button>
              </div>
            </div>

            <div className="inbox-chat-body" ref={messagesRef}>
              {messages.length === 0 && <div className="muted" style={{ textAlign: 'center', padding: 40 }}>Sem mensagens</div>}
              {messages.map(m => (
                <div key={m.id} className={`bubble ${m.author === 'lead' ? 'lead' : m.author === 'ia' ? 'ia' : 'sdr'}`}>
                  {m.content}
                  <div className="meta">
                    {m.author === 'lead' ? '👤' : m.author === 'ia' ? '🤖 Lila' : '👨‍💼 SDR'} · {' '}
                    {new Date(m.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              ))}
            </div>

            <div className="inbox-chat-foot">
              <textarea
                placeholder={contact.ai_paused ? 'Digite sua resposta…' : 'Assuma a conversa pra responder (ou use Atalho: Ctrl+Enter)'}
                value={msg}
                onChange={e => setMsg(e.target.value)}
                rows={2}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }}
              />
              <button className="primary" onClick={send} disabled={sending || !msg.trim()}>
                {sending ? '…' : 'Enviar'}
              </button>
            </div>
          </>
        )}
      </main>

      {/* === Coluna 3: Sidebar de info === */}
      {contact && (
        <aside className="inbox-side">
          <div className="card" style={{ padding: 16 }}>
            <h3 style={{ fontSize: 14 }}>Qualificação</h3>
            <Row label="Funil" value={contact.funnel ? `📂 ${contact.funnel}` : '—'} />
            <Row label="Estágio" value={contact.stage} tag />
            <Row label="Score" value={`${contact.qualification_score || 0}/100`} score={contact.qualification_score} />
            <Row label="SDR" value={contact.sdr_name || '—'} />

            {contact.qualification_notes && (
              <div style={{ marginTop: 14, padding: 10, background: 'var(--surface-bg)', borderRadius: 8, fontSize: 12, lineHeight: 1.5 }}>
                <div className="small muted" style={{ marginBottom: 4 }}>Notas da Lila</div>
                {contact.qualification_notes}
              </div>
            )}
          </div>

          <FeedbackBox contactId={contact.id} feedbacks={data?.feedbacks || []} reload={() => loadDetail(active)} />
        </aside>
      )}
    </div>
  );
}

function ChatListItem({ contact, active, onClick }) {
  const initials = (contact.name || '?').split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();
  const lastTime = contact.last_inbound_at || contact.updated_at;
  const isAI = !contact.ai_paused;
  const hasFeedback = contact.feedback_count > 0;

  return (
    <div className={`chat-list-item ${active ? 'active' : ''}`} onClick={onClick}>
      <div className="lead-avatar" style={{
        width: 40, height: 40, fontSize: 13,
        background: contact.funnel ? `var(--lc-magenta)` : 'var(--lc-stone)',
      }}>
        {initials}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {contact.name || '(sem nome)'}
          </span>
          <span className="small muted">
            {lastTime ? new Date(lastTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 4, marginTop: 4, alignItems: 'center' }}>
          {contact.funnel && <span className="tag magenta" style={{ fontSize: 10, padding: '1px 6px' }}>{contact.funnel}</span>}
          <span className="tag" style={{
            fontSize: 10, padding: '1px 6px',
            background: isAI ? 'var(--lc-magenta-50)' : 'var(--surface-bg)',
            color: isAI ? 'var(--lc-magenta-600)' : 'var(--text-tertiary)'
          }}>
            {isAI ? '🤖' : '👤'}
          </span>
          {contact.qualification_score > 50 && (
            <span className="tag success" style={{ fontSize: 10, padding: '1px 6px' }}>★ {contact.qualification_score}</span>
          )}
          {hasFeedback && (
            <span className="tag" style={{ fontSize: 10, padding: '1px 6px', background: 'var(--lc-success-bg)', color: 'var(--lc-success)' }} title={`${contact.feedback_count} avaliação(ões)`}>
              ✓ avaliada
            </span>
          )}
        </div>
        <div className="small muted" style={{ marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {contact.qualification_notes ? contact.qualification_notes.slice(0, 60) : '—'}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, tag, score }) {
  return (
    <div style={{ marginTop: 10 }}>
      <div className="small muted" style={{ marginBottom: 3 }}>{label}</div>
      {tag && value !== '—' ? <span className="tag magenta">{value}</span>
        : score !== undefined ? (
          <div>
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: 22, color: 'var(--lc-magenta-600)' }}>{value}</div>
            <div style={{ background: 'var(--border-soft)', borderRadius: 99, height: 4, marginTop: 4 }}>
              <div style={{ width: `${score || 0}%`, background: 'var(--lc-magenta)', height: '100%', borderRadius: 99 }} />
            </div>
          </div>
        )
        : <div style={{ fontWeight: 500, fontSize: 13 }}>{value}</div>
      }
    </div>
  );
}

function FeedbackBox({ contactId, feedbacks, reload }) {
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  async function send(verdict) {
    setSaving(true);
    try {
      await api.feedback(contactId, verdict, comment.trim() || null);
      setComment('');
      reload();
    } catch (e) { alert(e.message); } finally { setSaving(false); }
  }
  return (
    <div className="card" style={{ borderTop: '3px solid var(--lc-magenta)', padding: 16 }}>
      <h3 style={{ fontSize: 14 }}>Avalie o tom da Lila</h3>
      <div className="small muted" style={{ marginTop: 4 }}>Esse feedback alimenta refinamento do prompt.</div>
      <textarea
        placeholder="Comentário (opcional)…"
        value={comment}
        onChange={e => setComment(e.target.value)}
        rows={2}
        style={{ marginTop: 10, fontSize: 12 }}
      />
      <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
        <button onClick={() => send('tom_ok')} disabled={saving} style={{ flex: 1, fontSize: 12, padding: '6px 8px' }}>👍 OK</button>
        <button onClick={() => send('tom_errado')} disabled={saving} style={{ flex: 1, fontSize: 12, padding: '6px 8px' }}>👎 Errado</button>
        <button onClick={() => send('corrigir')} disabled={saving || !comment.trim()} style={{ flex: 1, fontSize: 12, padding: '6px 8px' }}>💬</button>
      </div>
      {feedbacks.length > 0 && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border-soft)', fontSize: 11 }}>
          <div className="small muted" style={{ marginBottom: 6 }}>{feedbacks.length} avaliação{feedbacks.length > 1 ? 'ões' : ''}</div>
          {feedbacks.slice(0, 3).map(f => (
            <div key={f.id} style={{ marginBottom: 6 }}>
              <span className="tag" style={{ fontSize: 10, padding: '1px 6px' }}>
                {f.verdict === 'tom_ok' ? '👍' : f.verdict === 'tom_errado' ? '👎' : '💬'} {f.reviewer_name}
              </span>
              {f.comment && <div style={{ paddingLeft: 6, color: 'var(--text-secondary)', marginTop: 2 }}>{f.comment}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
