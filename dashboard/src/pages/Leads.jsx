import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DndContext, DragOverlay, useSensor, useSensors, PointerSensor, KeyboardSensor,
  closestCorners, useDroppable,
} from '@dnd-kit/core';
import { useDraggable } from '@dnd-kit/core';
import { api } from '../lib/api.js';

// === Stages do pipeline ===
const STAGES = [
  { id: 'novo', label: 'Novo', color: '#9A9A9A', desc: 'Acabou de chegar' },
  { id: 'pre_qualificando', label: 'Pré-qualificando', color: '#E6227A', desc: 'Lila identificando funil' },
  { id: 'qualificando', label: 'Qualificando', color: '#C71766', desc: 'Lila aprofundando' },
  { id: 'qualificado', label: 'Qualificado', color: '#A01854', desc: 'Pronto pro Closer' },
  { id: 'handoff', label: 'Em handoff', color: '#111111', desc: 'SDR humano assumiu' },
  { id: 'agendado', label: 'Agendado', color: '#2F7D4B', desc: 'Reunião marcada' },
  { id: 'desqualificado', label: 'Desqualificado', color: '#B3261E', desc: 'Lila filtrou' },
];

const FUNNEL_LABELS = {
  escrever: '📝 Escrever',
  publicar: '📖 Publicar',
  divulgar: '📣 Divulgar',
};

const FUNNEL_CLS = {
  escrever: 'magenta',
  publicar: 'black',
  divulgar: 'berry',
};

export default function Leads() {
  const [contacts, setContacts] = useState([]);
  const [filters, setFilters] = useState({ funnel: '', q: '' });
  const [activeId, setActiveId] = useState(null);
  const [loading, setLoading] = useState(true);
  const nav = useNavigate();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  async function load() {
    setLoading(true);
    try {
      const r = await api.contacts({ funnel: filters.funnel, q: filters.q, limit: 200 });
      setContacts(r.contacts || []);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [filters.funnel, filters.q]);

  // Agrupa contatos por stage
  const byStage = useMemo(() => {
    const out = {};
    STAGES.forEach(s => out[s.id] = []);
    for (const c of contacts) {
      const s = c.stage || 'novo';
      if (out[s]) out[s].push(c);
      else out['novo'].push(c);
    }
    return out;
  }, [contacts]);

  const activeContact = activeId ? contacts.find(c => c.id === activeId) : null;

  function handleDragStart(e) {
    setActiveId(e.active.id);
  }

  async function handleDragEnd(e) {
    setActiveId(null);
    const { active, over } = e;
    if (!over || !active) return;
    const newStage = over.id;
    const contact = contacts.find(c => c.id === active.id);
    if (!contact || contact.stage === newStage) return;

    // Optimistic update
    setContacts(prev => prev.map(c => c.id === active.id ? { ...c, stage: newStage } : c));

    try {
      await api.setStage(active.id, newStage);
    } catch (err) {
      console.error('falha ao mover stage:', err);
      // Reverter caso falhe
      setContacts(prev => prev.map(c => c.id === active.id ? { ...c, stage: contact.stage } : c));
      alert('Falha ao mover lead. Recarregue a página.');
    }
  }

  const totalCount = contacts.length;
  const qualifiedCount = byStage.qualificado.length + byStage.handoff.length + byStage.agendado.length;

  return (
    <div className="leads-kanban-shell">
      <div className="page-header">
        <div>
          <h1>Pipeline de Leads</h1>
          <div className="muted small">
            {loading ? 'Carregando…' : `${totalCount} leads · ${qualifiedCount} qualificados pelo time`}
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <input
            placeholder="Buscar lead…"
            value={filters.q}
            onChange={e => setFilters(f => ({ ...f, q: e.target.value }))}
            style={{ width: 220 }}
          />
          <select
            value={filters.funnel}
            onChange={e => setFilters(f => ({ ...f, funnel: e.target.value }))}
            style={{ width: 180 }}
          >
            <option value="">Todos funis</option>
            <option value="escrever">📝 Escrever</option>
            <option value="publicar">📖 Publicar</option>
            <option value="divulgar">📣 Divulgar</option>
          </select>
          <button onClick={load} className="ghost" title="Recarregar">↻</button>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="kanban-board">
          {STAGES.map(stage => (
            <Column
              key={stage.id}
              stage={stage}
              contacts={byStage[stage.id] || []}
              loading={loading}
              onCardClick={(id) => nav(`/leads/${id}`)}
            />
          ))}
        </div>

        <DragOverlay dropAnimation={{ duration: 200 }}>
          {activeContact ? <LeadCard contact={activeContact} dragging /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

function Column({ stage, contacts, loading, onCardClick }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <div className={`kanban-col ${isOver ? 'drop-over' : ''}`} ref={setNodeRef}>
      <div className="kanban-col-header">
        <div className="kanban-col-title">
          <span className="dot" style={{ background: stage.color }} />
          {stage.label}
        </div>
        <span className="kanban-col-count">{contacts.length}</span>
      </div>
      <div className="kanban-col-desc">{stage.desc}</div>

      <div className="kanban-col-body">
        {loading && contacts.length === 0 && (
          <>
            <div className="skeleton" style={{ height: 90, marginBottom: 8 }} />
            <div className="skeleton" style={{ height: 90 }} />
          </>
        )}
        {!loading && contacts.length === 0 && (
          <div className="kanban-empty">Nenhum lead aqui</div>
        )}
        {contacts.map(c => (
          <DraggableCard key={c.id} contact={c} onClick={() => onCardClick(c.id)} />
        ))}
      </div>
    </div>
  );
}

function DraggableCard({ contact, onClick }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: contact.id });
  const style = isDragging ? { opacity: 0.4 } : {};

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        // só dispara click se não estiver arrastando
        if (!isDragging) onClick();
      }}
      style={style}
    >
      <LeadCard contact={contact} />
    </div>
  );
}

function LeadCard({ contact, dragging }) {
  const score = contact.qualification_score || 0;
  const scoreColor = score >= 60 ? 'var(--lc-success)' : score >= 30 ? 'var(--lc-magenta)' : 'var(--lc-stone)';
  const tempo = formatTime(contact.updated_at);
  const isStagnant = isStagnantStage(contact.updated_at);

  const initials = (contact.name || '?').split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className={`lead-card ${dragging ? 'dragging' : ''} ${isStagnant ? 'stagnant' : ''}`}>
      <div className="lead-card-top">
        <div className="lead-avatar" style={{ background: contact.funnel ? `var(--lc-magenta)` : 'var(--lc-stone)' }}>
          {initials}
        </div>
        <div className="lead-card-name">
          <div className="name">{contact.name || '(sem nome)'}</div>
          <div className="phone small muted">{contact.phone || contact.email || '—'}</div>
        </div>
      </div>

      <div className="lead-card-tags">
        {contact.funnel && (
          <span className={`tag ${FUNNEL_CLS[contact.funnel] || ''}`}>
            {FUNNEL_LABELS[contact.funnel] || contact.funnel}
          </span>
        )}
        {contact.qualification_score > 0 && (
          <span className="lead-score">
            <span className="score-bar" style={{
              width: `${score}%`,
              background: scoreColor,
            }} />
            <span className="score-num">{score}</span>
          </span>
        )}
      </div>

      {contact.qualification_notes && (
        <div className="lead-notes" title={contact.qualification_notes}>
          {contact.qualification_notes.slice(0, 100)}{contact.qualification_notes.length > 100 ? '…' : ''}
        </div>
      )}

      <div className="lead-card-foot">
        <span className="small muted">⏱ {tempo}</span>
        {isStagnant && <span className="tag warn small">parado</span>}
      </div>
    </div>
  );
}

function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const now = Date.now();
  const diff = (now - d.getTime()) / 1000;
  if (diff < 60) return 'agora';
  if (diff < 3600) return `${Math.floor(diff / 60)}min`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function isStagnantStage(iso) {
  if (!iso) return false;
  const diffDays = (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24);
  return diffDays > 3;
}
