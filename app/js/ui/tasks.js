// Task rows, quick add, list/board views, the task detail drawer and the task-centric pages.
import { html, useState, useRef, useEffect, useMemo, cx, plural } from '../lib.js';
import {
  S, tasks, update, create, trash, toggleTask, isDone, taskDate, isOverdue, isTodayTask, isInbox, sortTasks, subtasks,
  liveTags, folderOf, titleOf, openItem, PRIORITIES, STATUSES, undoable, eventsOn, relatedItems, link, unlink,
  alive, setSetting, folders, tags, toggleHabitDay, eventColor, closeDetail, byOrder, navigate, toast, findFolder, purge,
} from '../store.js';
import * as D from '../dates.js';
import { Icon } from './icons.js';
import {
  Btn, Chip, Segmented, Empty, ViewHeader, Section, openMenu, openContextMenu, openWhenPicker, openRepeatEditor,
  openTagPicker, openFolderPicker, openItemPicker, confirmDialog, Switch,
} from './common.js';
import { parseQuick, chipsFor, createTaskFromText, tokenAt, suggestionsFor } from '../tokens.js';
import { BlockEditor } from './editor.js';
import { Attachments } from './attachments.js';

const T = () => D.today();
const fmtOpts = () => ({ weekStart: S.settings.weekStart, timeFmt: S.settings.timeFormat });

/* ------------------------------------------------------------------ */
/* Checkbox + row                                                       */
/* ------------------------------------------------------------------ */

export function TaskCheck({ t, size = 18 }) {
  const st = t.repeat ? D.habitStats(t) : null;
  const on = isDone(t) || (st && st.doneToday && taskDate(t) !== T());
  return html`<button type="button" class=${cx('tcheck', 'p' + (t.priority || 0), on && 'on', t.repeat && 'habit')} style=${`--s:${size}px`}
    role="checkbox" aria-checked=${!!on} aria-label=${on ? 'Mark as not done' : 'Complete'}
    onClick=${(e) => { e.stopPropagation(); toggleTask(t.id); }}>${on && html`<${Icon} name="check" size=${size - 6} />`}</button>`;
}

export function taskMenuItems(t) {
  const today = T();
  return [
    { label: isDone(t) ? 'Mark as not done' : 'Complete', icon: 'check', onClick: () => toggleTask(t.id) },
    { label: 'Open', icon: 'arrowR', onClick: () => openItem(t.id) },
    { sep: true },
    { header: 'Schedule' },
    { label: 'Today', icon: 'sun', onClick: () => update(t.id, { when: { kind: 'day', date: today, time: t.when && t.when.time } }) },
    { label: 'Tomorrow', icon: 'upcoming', onClick: () => update(t.id, { when: { kind: 'day', date: D.addDays(today, 1), time: t.when && t.when.time } }) },
    { label: 'This week', icon: 'calendar', onClick: () => update(t.id, { when: { kind: 'week', date: D.startOfWeek(today, S.settings.weekStart) } }) },
    { label: 'Someday', icon: 'inbox', onClick: () => update(t.id, { when: { kind: 'someday' } }) },
    { sep: true },
    { header: 'Priority' },
    ...PRIORITIES.slice().reverse().map((p) => ({ label: p.label, icon: 'flag', checked: (t.priority || 0) === p.v, onClick: () => update(t.id, { priority: p.v }) })),
    { sep: true },
    { label: 'Duplicate', icon: 'copy', onClick: () => create('task', { ...t, id: undefined, title: t.title + ' (copy)', createdAt: Date.now(), completions: [], status: 'todo' }) },
    { label: 'Delete', icon: 'trash', danger: true, onClick: () => undoable(`Moved “${titleOf(t)}” to Trash`, [t.id], () => trash(t.id)) },
  ];
}

export function TaskRow({ t, showWhen = true, showFolder = true, depth = 0, compact = false, draggable = true }) {
  const today = T();
  const d = taskDate(t);
  const subs = subtasks(t.id);
  const st = t.repeat ? D.habitStats(t, today) : null;
  const overdue = isOverdue(t, today);
  const f = showFolder ? folderOf(t) : null;
  const tgs = liveTags(t);
  const hasNotes = (t.notes || []).some((b) => (b.html && b.html.replace(/<[^>]+>/g, '').trim()) || (b.type !== 'p' && b.type));
  return html`<div class=${cx('trow', isDone(t) && 'done', compact && 'compact', S.ui.detail && S.ui.detail.id === t.id && 'active')}
      style=${depth ? `--depth:${depth}` : ''} draggable=${draggable}
      onDragStart=${(e) => { e.dataTransfer.setData('jamday/task', t.id); e.dataTransfer.setData('text/plain', t.title); e.dataTransfer.effectAllowed = 'move'; }}
      onClick=${() => openItem(t.id)} onContextMenu=${(e) => openContextMenu(e, taskMenuItems(t))}
      onKeyDown=${(e) => { if (e.key === 'Enter') openItem(t.id); if (e.key === ' ' && e.target === e.currentTarget) { e.preventDefault(); toggleTask(t.id); } }} tabIndex="0">
    <${TaskCheck} t=${t} />
    <div class="trow-main">
      <div class="trow-title">${t.title || html`<span class="muted">Untitled task</span>`}
        ${hasNotes && html`<${Icon} name="notes" size=${13} class="muted" title="Has notes" />`}
      </div>
      <div class="trow-meta">
        ${showWhen && t.when && html`<span class=${cx('meta', overdue && d && 'danger', d === today && 'today')}><${Icon} name=${t.when.kind === 'someday' ? 'inbox' : 'calendar'} size=${12} />${D.whenLabel(t.when, fmtOpts())}</span>`}
        ${t.deadline && html`<span class=${cx('meta', t.deadline < today && !isDone(t) && 'danger', t.deadline === today && 'warn')}><${Icon} name="flag" size=${12} />Due ${D.relDay(t.deadline)}</span>`}
        ${st && html`<span class="meta flame" title=${D.describeRepeat(t.repeat)}><${Icon} name="flame" size=${12} />${st.streak}</span>`}
        ${t.reminder && !isDone(t) && html`<span class="meta"><${Icon} name="bell" size=${12} /></span>`}
        ${subs.length > 0 && html`<span class="meta"><${Icon} name="tasks" size=${12} />${subs.filter(isDone).length}/${subs.length}</span>`}
        ${(t.attachments || []).length > 0 && html`<span class="meta"><${Icon} name="clip" size=${12} />${t.attachments.length}</span>`}
        ${(t.people || []).map((p) => html`<span class="meta"><${Icon} name="user" size=${12} />${p}</span>`)}
        ${f && html`<span class="meta badge-folder" style=${`--c:${f.color}`}><${Icon} name="folder" size=${12} />${f.name}</span>`}
        ${tgs.map((tg) => html`<span class="meta tagm" style=${`--c:${tg.color}`}>#${tg.name}</span>`)}
      </div>
    </div>
    ${t.priority >= 3 && !isDone(t) && html`<span class=${'prio p' + t.priority} title=${PRIORITIES[t.priority].label}><${Icon} name="flag" size=${14} /></span>`}
    <button type="button" class="btn btn-icon btn-sm trow-more" aria-label="Task actions" onClick=${(e) => { e.stopPropagation(); openMenu(e.currentTarget, taskMenuItems(t), { align: 'right' }); }}><${Icon} name="more" size=${16} /></button>
  </div>
  ${!compact && subs.filter((s) => !isDone(s) || S.settings.showCompleted).length > 0 && depth < 3 && subs.filter((s) => !isDone(s) || S.settings.showCompleted).map((s) => html`<${TaskRow} t=${s} depth=${depth + 1} showFolder=${false} />`)}`;
}

export function TaskList({ list, empty, showWhen = true, showFolder = true, nested = true }) {
  const roots = nested ? list.filter((t) => !t.parentId || !list.some((x) => x.id === t.parentId)) : list;
  if (!roots.length) return empty || null;
  return html`<div class="tlist">${roots.map((t) => html`<${TaskRow} key=${t.id} t=${t} showWhen=${showWhen} showFolder=${showFolder} compact=${!nested} />`)}</div>`;
}

/* ------------------------------------------------------------------ */
/* Quick add with tokens                                                */
/* ------------------------------------------------------------------ */

export function QuickAdd({ defaults = {}, placeholder = 'Add a task…', autoFocus = false, onCreated, id }) {
  const [v, setV] = useState('');
  const [caret, setCaret] = useState(0);
  const [sel, setSel] = useState(0);
  const [focused, setFocused] = useState(false);
  const [nav, setNav] = useState(false);
  const ref = useRef();
  useEffect(() => { if (autoFocus && ref.current) ref.current.focus(); }, []);
  const tok = focused ? tokenAt(v, caret) : null;
  const sugg = tok ? suggestionsFor(tok) : [];
  const q = v.trim() ? parseQuick(v) : null;
  const chips = q ? chipsFor(q) : [];
  const apply = (s) => {
    const nv = v.slice(0, tok.start) + s.insert + ' ' + v.slice(tok.end).replace(/^\s+/, '');
    const pos = tok.start + s.insert.length + 1;
    setV(nv); setSel(0);
    requestAnimationFrame(() => { if (ref.current) { ref.current.focus(); ref.current.setSelectionRange(pos, pos); setCaret(pos); } });
  };
  const submit = () => {
    const t = createTaskFromText(v, defaults);
    if (t) { setV(''); setCaret(0); onCreated && onCreated(t); toast(`Added “${t.title}”`, { action: { label: 'Open', run: () => openItem(t.id) }, timeout: 2500 }); }
  };
  return html`<div class=${cx('qadd', focused && 'focus')} id=${id}>
    <div class="qadd-row">
      <${Icon} name="plus" size=${18} class="qadd-plus" />
      <input ref=${ref} class="qadd-in" value=${v} placeholder=${placeholder} aria-label="Add a task"
        onFocus=${() => setFocused(true)} onBlur=${() => setTimeout(() => setFocused(false), 150)}
        onInput=${(e) => { setV(e.target.value); setCaret(e.target.selectionStart); setSel(0); setNav(false); }}
        onKeyUp=${(e) => setCaret(e.target.selectionStart)} onClick=${(e) => setCaret(e.target.selectionStart)}
        onKeyDown=${(e) => {
          if (sugg.length) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setNav(true); setSel((sel + 1) % sugg.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setNav(true); setSel((sel - 1 + sugg.length) % sugg.length); return; }
            if (e.key === 'Tab' || (e.key === 'Enter' && nav)) { e.preventDefault(); setNav(false); apply(sugg[sel]); return; }
          }
          if (e.key === 'Enter') { e.preventDefault(); submit(); }
          if (e.key === 'Escape') { setV(''); e.target.blur(); }
        }} />
      ${v && html`<button type="button" class="btn btn-sm btn-primary" onMouseDown=${(e) => e.preventDefault()} onClick=${submit}>Add</button>`}
    </div>
    ${chips.length > 0 && html`<div class="qadd-chips">${chips.map((c) => html`<${Chip} icon=${c.icon} label=${c.label} kind=${c.kind} />`)}</div>`}
    ${focused && !v && html`<div class="qadd-hint">Try <code>Call Ana @tomorrow 3pm #home &Family !high</code> · <code>@every weekday</code> makes a habit</div>`}
    ${sugg.length > 0 && html`<div class="qadd-sugg" onMouseDown=${(e) => e.preventDefault()}>${sugg.map((s, i) => html`<button type="button"
        class=${cx('picker-i', i === sel && 'sel')} onMouseEnter=${() => setSel(i)} onClick=${() => apply(s)}>
        ${s.color ? html`<i class="dot" style=${`background:${s.color}`}></i>` : s.icon ? html`<${Icon} name=${s.icon} size=${14} />` : ''}
        <span class="grow">${s.label}</span>${s.hint && html`<span class="muted small">${s.hint}</span>`}</button>`)}</div>`}
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Board (kanban)                                                       */
/* ------------------------------------------------------------------ */

export function TaskBoard({ list, defaults = {} }) {
  const [over, setOver] = useState(null);
  return html`<div class="board">${STATUSES.map((s) => {
    const col = sortTasks(list.filter((t) => (t.status || 'todo') === s.v && !t.parentId));
    return html`<div class=${cx('board-col', over === s.v && 'over')}
        onDragOver=${(e) => { if ([...e.dataTransfer.types].includes('jamday/task')) { e.preventDefault(); setOver(s.v); } }}
        onDragLeave=${() => setOver(null)}
        onDrop=${(e) => { const id = e.dataTransfer.getData('jamday/task'); setOver(null); if (id) update(id, { status: s.v, completedAt: s.v === 'done' ? Date.now() : null }); }}>
      <div class="board-h"><span class=${'st-dot st-' + s.v}></span><b>${s.label}</b><span class="count">${col.length}</span></div>
      <div class="board-list">
        ${col.map((t) => html`<div class="card" key=${t.id} draggable="true" onDragStart=${(e) => { e.dataTransfer.setData('jamday/task', t.id); }}
            onClick=${() => openItem(t.id)} onContextMenu=${(e) => openContextMenu(e, taskMenuItems(t))}>
          <div class="card-t"><${TaskCheck} t=${t} size=${16} /><span>${t.title || 'Untitled'}</span></div>
          <div class="trow-meta">
            ${t.when && html`<span class=${cx('meta', isOverdue(t) && 'danger')}><${Icon} name="calendar" size=${12} />${D.whenLabel(t.when, fmtOpts())}</span>`}
            ${t.priority > 0 && html`<span class=${'meta prio-t p' + t.priority}><${Icon} name="flag" size=${12} />${PRIORITIES[t.priority].label}</span>`}
            ${subtasks(t.id).length > 0 && html`<span class="meta"><${Icon} name="tasks" size=${12} />${subtasks(t.id).filter(isDone).length}/${subtasks(t.id).length}</span>`}
            ${liveTags(t).map((tg) => html`<span class="meta tagm" style=${`--c:${tg.color}`}>#${tg.name}</span>`)}
          </div>
        </div>`)}
        ${s.v !== 'done' && html`<${BoardAdd} status=${s.v} defaults=${defaults} />`}
      </div>
    </div>`;
  })}</div>`;
}

function BoardAdd({ status, defaults }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState('');
  if (!open) return html`<button type="button" class="board-add" onClick=${() => setOpen(true)}><${Icon} name="plus" size=${14} /> Add card</button>`;
  return html`<input class="input sm" autoFocus value=${v} placeholder="Task name, then Enter" onInput=${(e) => setV(e.target.value)}
    onBlur=${() => { setOpen(false); setV(''); }}
    onKeyDown=${(e) => { if (e.key === 'Enter' && v.trim()) { const t = createTaskFromText(v, defaults); if (t) update(t.id, { status }); setV(''); } if (e.key === 'Escape') setOpen(false); }} />`;
}

/* ------------------------------------------------------------------ */
/* Task detail drawer                                                   */
/* ------------------------------------------------------------------ */

function AutoTitle({ value, onInput, placeholder, onEnter, class: c, autoFocus }) {
  const ref = useRef();
  useEffect(() => { const el = ref.current; if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; } }, [value]);
  useEffect(() => { if (autoFocus && ref.current) ref.current.focus(); }, []);
  return html`<textarea ref=${ref} rows="1" class=${cx('title-in', c)} value=${value} placeholder=${placeholder}
    onInput=${(e) => onInput(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter && onEnter(); } }}></textarea>`;
}
export { AutoTitle };

export function Prop({ icon, label, children }) {
  return html`<div class="prop"><div class="prop-l"><${Icon} name=${icon} size=${15} /><span>${label}</span></div><div class="prop-v">${children}</div></div>`;
}

export function RelatedList({ item }) {
  const rel = relatedItems(item);
  const icon = { task: 'tasks', note: 'notes', event: 'calendar' };
  const folderId = item.folderId;
  return html`<div class="related">
    ${rel.map((r) => html`<div class="rel" key=${r.id}>
      <button type="button" class="rel-main" onClick=${() => openItem(r.id)}><${Icon} name=${icon[r.type] || 'link'} size=${15} /><span class="ellipsis">${titleOf(r)}</span></button>
      ${(item.links || []).includes(r.id) || (r.links || []).includes(item.id) ? html`<button type="button" class="btn btn-icon btn-sm" title="Unlink" onClick=${() => unlink(item.id, r.id)}><${Icon} name="x" size=${13} /></button>` : html`<span class="muted small" title="Mentioned in its content">mention</span>`}
    </div>`)}
    <div class="rel-actions">
      <button type="button" class="btn btn-sm" onClick=${(e) => openItemPicker(e.currentTarget, { exclude: [item.id, ...rel.map((r) => r.id)], onPick: (x) => x && link(item.id, x.id) })}><${Icon} name="link" size=${14} /><span>Link…</span></button>
      ${item.type !== 'note' && html`<button type="button" class="btn btn-sm" onClick=${() => { const n = create('note', { title: titleOf(item) + ' — notes', folderId, links: [item.id] }); navigate('notes', n.id); closeDetail(); }}><${Icon} name="notes" size=${14} /><span>New linked note</span></button>`}
      ${item.type !== 'task' && html`<button type="button" class="btn btn-sm" onClick=${() => { const t = create('task', { title: '', folderId, links: [item.id], when: item.type === 'event' ? { kind: 'day', date: item.start.slice(0, 10) } : null }); openItem(t.id); }}><${Icon} name="tasks" size=${14} /><span>New linked task</span></button>`}
    </div>
  </div>`;
}

export function TagsField({ item }) {
  const tg = liveTags(item);
  return html`<div class="chips-wrap">
    ${tg.map((t) => html`<${Chip} label=${t.name} color=${t.color} onClick=${() => navigate('tag', t.id)} onRemove=${() => update(item.id, { tags: item.tags.filter((x) => x !== t.id) })} />`)}
    <button type="button" class="btn btn-sm btn-ghost" onClick=${(e) => openTagPicker(e.currentTarget, item.tags, (ids) => update(item.id, { tags: ids }))}><${Icon} name="plus" size=${13} /><span>${tg.length ? '' : 'Add tag'}</span></button>
  </div>`;
}

export function FolderField({ item }) {
  const f = folderOf(item);
  return html`<button type="button" class=${cx('btn btn-sm', f ? 'btn-soft' : 'btn-ghost')} style=${f ? `--c:${f.color}` : ''}
    onClick=${(e) => openFolderPicker(e.currentTarget, item.folderId, (id) => update(item.id, { folderId: id }))}>
    <${Icon} name="folder" size=${14} /><span>${f ? f.name : 'No folder'}</span></button>`;
}

function HabitCard({ t }) {
  const today = T();
  const st = D.habitStats(t, today);
  const days = Array.from({ length: 21 }, (_, i) => D.addDays(today, i - 20));
  const comps = new Set(t.completions || []);
  return html`<div class="habit-card">
    <div class="habit-stats">
      <div><b class="flame-t"><${Icon} name="flame" size=${16} />${st.streak}</b><span>current streak</span></div>
      <div><b>${st.best}</b><span>best</span></div>
      <div><b>${st.rate}%</b><span>last 30 days</span></div>
    </div>
    <div class="habit-days">${days.map((d) => html`<button type="button" title=${D.fmtDate(d, { weekday: true })}
      class=${cx('hday', D.occursOn({ ...t.repeat, anchor: t.repeat.anchor || d }, d) && 'sched', comps.has(d) && 'done', d === today && 'today')}
      onClick=${() => toggleHabitDay(t.id, d)}>${+d.slice(8)}</button>`)}</div>
    <div class="muted small">${D.describeRepeat(t.repeat)} · click a day to log or un-log it</div>
  </div>`;
}

export function TaskDetail({ t }) {
  const today = T();
  useEffect(() => () => {
    const cur = alive(t.id);
    if (cur && !cur.title.trim() && !subtasks(cur.id).length && !(cur.attachments || []).length && Date.now() - cur.createdAt < 600000
      && !(cur.notes || []).some((b) => b.type !== 'p' || (b.html || '').replace(/<[^>]+>/g, '').trim())) purge(cur.id);
  }, [t.id]);
  const subs = subtasks(t.id);
  const parent = t.parentId ? alive(t.parentId) : null;
  const set = (p) => update(t.id, p);
  return html`<div class="detail" key=${t.id}>
    <div class="detail-top">
      ${parent ? html`<button type="button" class="crumb" onClick=${() => openItem(parent.id)}><${Icon} name="chevL" size=${14} />${titleOf(parent)}</button>` : html`<span class="detail-kind"><${Icon} name=${t.repeat ? 'flame' : 'tasks'} size=${14} />${t.repeat ? 'Habit' : 'Task'}</span>`}
      <span class="grow"></span>
      <${Btn} icon="more" title="More" onClick=${(e) => openMenu(e.currentTarget, taskMenuItems(t), { align: 'right' })} />
      <${Btn} icon="x" title="Close (Esc)" onClick=${closeDetail} />
    </div>
    <div class="detail-title"><${TaskCheck} t=${t} size=${22} />
      <${AutoTitle} value=${t.title} placeholder="Task name" autoFocus=${!t.title} onInput=${(v) => set({ title: v })} /></div>
    <div class="props">
      <${Prop} icon="tasks" label="Status">
        <select class="input sm" value=${t.status} onChange=${(e) => set({ status: e.target.value, completedAt: e.target.value === 'done' ? Date.now() : null })}>
          ${STATUSES.map((s) => html`<option value=${s.v}>${s.label}</option>`)}</select>
      <//>
      <${Prop} icon="calendar" label="When">
        <button type="button" class=${cx('btn btn-sm', t.when ? 'btn-soft' : 'btn-ghost', isOverdue(t, today) && taskDate(t) && 'danger')}
          onClick=${(e) => openWhenPicker(e.currentTarget, { value: t.when, onChange: (w) => set({ when: w, reminder: w && w.kind === 'day' && w.time && !t.reminder ? w.date + 'T' + w.time : t.reminder }), repeat: t.repeat, onRepeat: (r) => set({ repeat: r, when: r && (!t.when || t.when.kind !== 'day') ? { kind: 'day', date: r.anchor } : t.when }) })}>
          <${Icon} name="calendar" size=${14} /><span>${t.when ? D.whenLabel(t.when, fmtOpts()) : 'Set date'}</span></button>
      <//>
      <${Prop} icon="flag" label="Deadline">
        <button type="button" class=${cx('btn btn-sm', t.deadline ? 'btn-soft' : 'btn-ghost', t.deadline && t.deadline < today && !isDone(t) && 'danger')}
          onClick=${(e) => openWhenPicker(e.currentTarget, { value: t.deadline, mode: 'deadline', onChange: (d) => set({ deadline: d }) })}>
          <span>${t.deadline ? D.fmtDate(t.deadline, { weekday: true }) : 'None'}</span></button>
      <//>
      <${Prop} icon="repeat" label="Repeat">
        <button type="button" class=${cx('btn btn-sm', t.repeat ? 'btn-soft' : 'btn-ghost')}
          onClick=${() => openRepeatEditor(t.repeat, taskDate(t) || today, (r) => set({ repeat: r, when: r ? { kind: 'day', date: D.occursOn(r, r.anchor) && r.anchor >= today ? r.anchor : (D.occursOn(r, today) ? today : D.nextOccurrence(r, today)), time: t.when && t.when.time } : t.when }))}>
          ${t.repeat && html`<${Icon} name="flame" size=${14} />`}<span>${t.repeat ? D.describeRepeat(t.repeat) : 'Never'}</span></button>
      <//>
      <${Prop} icon="bell" label="Reminder">
        <input type="datetime-local" class="input sm" value=${t.reminder || ''} onChange=${(e) => set({ reminder: e.target.value || null, reminderFired: false })} />
        ${t.reminder && html`<${Btn} icon="x" size="sm" title="Clear reminder" onClick=${() => set({ reminder: null })} />`}
      <//>
      <${Prop} icon="flag" label="Priority">
        <${Segmented} size="sm" value=${t.priority || 0} onChange=${(v) => set({ priority: v })}
          options=${PRIORITIES.map((p) => ({ v: p.v, label: p.v ? p.short : '–', title: p.label }))} />
      <//>
      <${Prop} icon="folder" label="Folder"><${FolderField} item=${t} /><//>
      <${Prop} icon="tag" label="Tags"><${TagsField} item=${t} /><//>
      <${Prop} icon="user" label="People"><${PeopleField} item=${t} /><//>
    </div>
    ${t.repeat && html`<${HabitCard} t=${t} />`}
    <div class="detail-sec">
      <h4><${Icon} name="tasks" size=${14} /> Subtasks ${subs.length > 0 && html`<span class="count">${subs.filter(isDone).length}/${subs.length}</span>`}</h4>
      ${subs.length > 0 && html`<div class="tlist">${subs.map((s) => html`<${TaskRow} key=${s.id} t=${s} compact showFolder=${false} />`)}</div>`}
      <${QuickAdd} defaults=${{ parentId: t.id, folderId: t.folderId }} placeholder="Add a subtask…" />
    </div>
    <div class="detail-sec">
      <h4><${Icon} name="notes" size=${14} /> Notes</h4>
      <${BlockEditor} key=${'n' + t.id} blocks=${t.notes} ownerId=${t.id} compact placeholder="Add notes — type ‘/’ for blocks, ‘@’ to mention" onChange=${(b) => update(t.id, { notes: b })} />
    </div>
    <div class="detail-sec"><h4><${Icon} name="link" size=${14} /> Linked</h4><${RelatedList} item=${t} /></div>
    <div class="detail-sec"><h4><${Icon} name="clip" size=${14} /> Attachments</h4><${Attachments} item=${t} /></div>
    <div class="detail-foot muted small">
      Created ${new Date(t.createdAt).toLocaleString()} · Updated ${new Date(t.updatedAt).toLocaleString()}
      ${t.completedAt && html` · Completed ${new Date(t.completedAt).toLocaleString()}`}
      <span class="grow"></span>
      <${Btn} icon="trash" label="Delete" kind="ghost-danger" size="sm" onClick=${() => undoable(`Moved “${titleOf(t)}” to Trash`, [t.id, ...subs.map((s) => s.id)], () => trash(t.id))} />
    </div>
  </div>`;
}

function PeopleField({ item }) {
  const [v, setV] = useState('');
  const ppl = item.people || [];
  return html`<div class="chips-wrap">
    ${ppl.map((p) => html`<${Chip} icon="user" label=${p} onRemove=${() => update(item.id, { people: ppl.filter((x) => x !== p) })} />`)}
    <input class="input sm bare people-in" placeholder=${ppl.length ? '+' : 'Add person'} value=${v} onInput=${(e) => setV(e.target.value)}
      onKeyDown=${(e) => { if (e.key === 'Enter' && v.trim()) { update(item.id, { people: [...new Set([...ppl, v.trim()])] }); setV(''); } }} />
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Pages                                                                */
/* ------------------------------------------------------------------ */

function Agenda({ date }) {
  const evs = eventsOn(date);
  if (!evs.length) return null;
  const tf = S.settings.timeFormat;
  const now = D.dtStr(new Date());
  return html`<div class="agenda">${evs.map((e) => html`<button type="button" class=${cx('ag', !e.allDay && e.end < now && 'past', !e.allDay && e.start <= now && e.end > now && 'now')}
      style=${`--c:${eventColor(e)}`} onClick=${() => openItem(e.id)}>
    <span class="ag-time">${e.allDay ? 'All day' : D.fmtTime(e.start.slice(11), tf)}</span>
    <span class="ag-t ellipsis">${e.title || 'Untitled event'}</span>
    ${e.url && html`<a class="btn btn-sm btn-primary ag-join" href=${e.url} target="_blank" rel="noopener" onClick=${(ev) => ev.stopPropagation()}><${Icon} name="video" size=${13} />Join</a>`}
  </button>`)}</div>`;
}

export function TodayView() {
  const today = T();
  const all = tasks();
  const overdue = sortTasks(all.filter((t) => !isDone(t) && !t.parentId && ((taskDate(t) && taskDate(t) < today) || (t.deadline && t.deadline < today))));
  const todays = sortTasks(all.filter((t) => !isDone(t) && !t.parentId && !overdue.includes(t) && isTodayTask(t, today)));
  const ws = D.startOfWeek(today, S.settings.weekStart);
  const week = sortTasks(all.filter((t) => !isDone(t) && !t.parentId && t.when && t.when.kind === 'week' && t.when.date <= ws));
  const month = sortTasks(all.filter((t) => !isDone(t) && !t.parentId && t.when && t.when.kind === 'month' && t.when.date <= D.startOfMonth(today)));
  const doneToday = all.filter((t) => (isDone(t) && t.completedAt && D.ds(new Date(t.completedAt)) === today) || (t.repeat && (t.completions || []).includes(today)));
  const hr = new Date().getHours();
  const greet = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  const habitsToday = all.filter((t) => t.repeat && !isDone(t) && taskDate(t) === today).length;
  return html`<div class="view">
    <${ViewHeader} icon="sun" iconColor="var(--warn)" title="Today" subtitle=${`${greet} · ${D.fmtDate(today, { weekday: true, long: true })}`} />
    <div class="view-body narrow">
      <${Agenda} date=${today} />
      <${QuickAdd} id="quick-add" defaults=${{ when: { kind: 'day', date: today } }} placeholder="Add a task for today…" />
      ${overdue.length > 0 && html`<${Section} title="Overdue" count=${overdue.length} tone="danger"
        actions=${html`<button type="button" class="btn btn-sm btn-ghost" onClick=${() => undoable('Moved overdue tasks to today', overdue.map((t) => t.id), () => overdue.forEach((t) => update(t.id, { when: { kind: 'day', date: today, time: t.when && t.when.time } })))}>Move all to today</button>`}>
        <${TaskList} list=${overdue} /><//>`}
      <${Section} title="Today" count=${todays.length}>
        <${TaskList} list=${todays} empty=${!overdue.length && html`<${Empty} icon="sun" title="All clear for today" text=${habitsToday ? '' : 'Add something above, or pull tasks in from Upcoming.'} />`} />
      <//>
      ${week.length > 0 && html`<${Section} title="Planned this week" count=${week.length} collapsible id="today-week"><${TaskList} list=${week} /><//>`}
      ${month.length > 0 && html`<${Section} title="Planned this month" count=${month.length} collapsible id="today-month" defaultOpen=${false}><${TaskList} list=${month} /><//>`}
      ${doneToday.length > 0 && html`<${Section} title="Completed today" count=${doneToday.length} collapsible id="today-done" defaultOpen=${false}><${TaskList} list=${doneToday} nested=${false} /><//>`}
    </div>
  </div>`;
}

export function UpcomingView() {
  const today = T();
  const all = tasks().filter((t) => !isDone(t) && !t.parentId);
  const days = Array.from({ length: 14 }, (_, i) => D.addDays(today, i + 1));
  const ws = D.startOfWeek(today, S.settings.weekStart);
  const end = days[days.length - 1];
  const later = sortTasks(all.filter((t) => (taskDate(t) && taskDate(t) > end) || (!taskDate(t) && t.deadline && t.deadline > end)));
  const spans = (kind, date) => sortTasks(all.filter((t) => t.when && t.when.kind === kind && (date ? t.when.date === date : true)));
  const thisWeek = spans('week', ws), nextWeek = spans('week', D.addDays(ws, 7));
  const laterWeeks = sortTasks(all.filter((t) => t.when && t.when.kind === 'week' && t.when.date > D.addDays(ws, 7)));
  const months = sortTasks(all.filter((t) => t.when && t.when.kind === 'month' && t.when.date >= D.startOfMonth(today)));
  const someday = sortTasks(all.filter((t) => t.when && t.when.kind === 'someday'));
  return html`<div class="view">
    <${ViewHeader} icon="upcoming" iconColor="var(--info)" title="Upcoming" subtitle="The next two weeks, then everything planned loosely" />
    <div class="view-body narrow">
      <${QuickAdd} defaults=${{ when: { kind: 'day', date: D.addDays(today, 1) } }} placeholder="Add a task — defaults to tomorrow, or type @friday…" />
      ${days.map((d) => {
        const list = sortTasks(all.filter((t) => taskDate(t) === d || (t.deadline === d && taskDate(t) !== d)));
        const evs = eventsOn(d);
        return html`<div class=${cx('day-block', !list.length && !evs.length && 'empty')}
            onDragOver=${(e) => { if ([...e.dataTransfer.types].includes('jamday/task')) e.preventDefault(); }}
            onDrop=${(e) => { const id = e.dataTransfer.getData('jamday/task'); if (id) update(id, { when: { kind: 'day', date: d } }); }}>
          <div class="day-h"><b>${D.relDay(d)}</b><span class="muted">${D.fmtDate(d, { weekday: D.diffDays(today, d) >= 7 })}</span>
            ${D.dow(d) === S.settings.weekStart && html`<span class="pill sm">New week</span>`}</div>
          <${Agenda} date=${d} />
          <${TaskList} list=${list} showWhen=${false} />
        </div>`;
      })}
      ${later.length > 0 && html`<${Section} title="Later" count=${later.length} collapsible id="up-later"><${TaskList} list=${later} /><//>`}
      ${thisWeek.length > 0 && html`<${Section} title="Sometime this week" count=${thisWeek.length} collapsible id="up-tw"><${TaskList} list=${thisWeek} showWhen=${false} /><//>`}
      ${nextWeek.length > 0 && html`<${Section} title="Next week" count=${nextWeek.length} collapsible id="up-nw"><${TaskList} list=${nextWeek} showWhen=${false} /><//>`}
      ${laterWeeks.length > 0 && html`<${Section} title="Later weeks" count=${laterWeeks.length} collapsible id="up-lw"><${TaskList} list=${laterWeeks} /><//>`}
      ${months.length > 0 && html`<${Section} title="This month & later months" count=${months.length} collapsible id="up-m"><${TaskList} list=${months} /><//>`}
      ${someday.length > 0 && html`<${Section} title="Someday" count=${someday.length} collapsible id="up-s" defaultOpen=${false}><${TaskList} list=${someday} showWhen=${false} /><//>`}
    </div>
  </div>`;
}

export function InboxView() {
  const all = tasks();
  const list = sortTasks(all.filter(isInbox));
  const done = all.filter((t) => isDone(t) && !t.when && !t.deadline && !t.folderId && !t.parentId).sort((a, b) => b.completedAt - a.completedAt).slice(0, 30);
  return html`<div class="view">
    <${ViewHeader} icon="inbox" iconColor="var(--accent)" title="Inbox" subtitle="Capture first, organize later" />
    <div class="view-body narrow">
      <${QuickAdd} id="quick-add" placeholder="Capture a task… (@date #tag &folder !priority)" />
      <${TaskList} list=${list} empty=${html`<${Empty} icon="inbox" title="Inbox zero" text="Anything without a date or folder lands here." />`} />
      ${done.length > 0 && S.settings.showCompleted && html`<${Section} title="Completed" count=${done.length} collapsible id="inbox-done" defaultOpen=${false}><${TaskList} list=${done} /><//>`}
    </div>
  </div>`;
}

export function TasksView() {
  const view = S.settings.tasksView;
  const [filter, setFilter] = useState({ folder: '', tag: '', priority: 0, q: '' });
  const [group, setGroup] = useState('none');
  let list = tasks();
  if (filter.folder) list = list.filter((t) => (filter.folder === '-' ? !t.folderId : t.folderId === filter.folder));
  if (filter.tag) list = list.filter((t) => (t.tags || []).includes(filter.tag));
  if (filter.priority) list = list.filter((t) => (t.priority || 0) >= filter.priority);
  if (filter.q) { const q = filter.q.toLowerCase(); list = list.filter((t) => t.title.toLowerCase().includes(q)); }
  const open = sortTasks(list.filter((t) => !isDone(t)));
  const done = list.filter(isDone).sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
  const defaults = { folderId: filter.folder && filter.folder !== '-' ? filter.folder : null, tags: filter.tag ? [filter.tag] : [] };
  const groups = useMemo(() => {
    if (group === 'none') return null;
    const m = new Map();
    for (const t of open.filter((x) => !x.parentId)) {
      let k, label;
      if (group === 'folder') { const f = folderOf(t); k = f ? f.id : '-'; label = f ? f.name : 'No folder'; }
      else if (group === 'priority') { k = 'p' + (t.priority || 0); label = PRIORITIES[t.priority || 0].label; }
      else if (group === 'status') { k = t.status; label = STATUSES.find((s) => s.v === t.status).label; }
      else { const d = taskDate(t) || t.deadline; k = d ? (d < T() ? '0' : d) : t.when ? 'z' + t.when.kind : 'zz'; label = d ? (d < T() ? 'Overdue' : D.relDay(d)) : t.when ? D.whenLabel(t.when, fmtOpts()) : 'No date'; }
      if (!m.has(k)) m.set(k, { label, list: [] });
      m.get(k).list.push(t);
    }
    const entries = [...m.entries()];
    if (group === 'priority') entries.sort((a, b) => b[0].localeCompare(a[0])); else entries.sort((a, b) => a[0].localeCompare(b[0]));
    return entries.map(([k, v]) => ({ k, ...v }));
  }, [group, open]);
  return html`<div class="view">
    <${ViewHeader} icon="tasks" iconColor="var(--ok)" title="Tasks" subtitle=${`${open.length} open · ${done.length} done`}>
      <${Segmented} value=${view} onChange=${(v) => setSetting('tasksView', v)} options=${[{ v: 'list', icon: 'list', title: 'List' }, { v: 'board', icon: 'board', title: 'Board' }, { v: 'calendar', icon: 'calendar', title: 'Calendar' }]} />
    <//>
    <div class="filters">
      <div class="search-in"><${Icon} name="search" size=${15} /><input placeholder="Filter tasks…" value=${filter.q} onInput=${(e) => setFilter({ ...filter, q: e.target.value })} /></div>
      <select class="input sm" value=${filter.folder} onChange=${(e) => setFilter({ ...filter, folder: e.target.value })}>
        <option value="">All folders</option><option value="-">No folder</option>${folders().map((f) => html`<option value=${f.id}>${f.name}</option>`)}</select>
      <select class="input sm" value=${filter.tag} onChange=${(e) => setFilter({ ...filter, tag: e.target.value })}>
        <option value="">All tags</option>${tags().map((t) => html`<option value=${t.id}>#${t.name}</option>`)}</select>
      <select class="input sm" value=${filter.priority} onChange=${(e) => setFilter({ ...filter, priority: +e.target.value })}>
        <option value="0">Any priority</option>${PRIORITIES.slice(1).map((p) => html`<option value=${p.v}>${p.label}+</option>`)}</select>
      ${view === 'list' && html`<select class="input sm" value=${group} onChange=${(e) => setGroup(e.target.value)}>
        <option value="none">No grouping</option><option value="date">Group by date</option><option value="folder">Group by folder</option><option value="priority">Group by priority</option><option value="status">Group by status</option></select>`}
      <label class="check-l"><input type="checkbox" checked=${S.settings.showCompleted} onChange=${(e) => setSetting('showCompleted', e.target.checked)} /> Show completed</label>
    </div>
    <div class=${cx('view-body', view === 'list' && 'narrow', view !== 'list' && 'wide')}>
      ${view === 'list' && html`
        <${QuickAdd} id="quick-add" defaults=${defaults} />
        ${groups ? groups.map((g) => html`<${Section} key=${g.k} title=${g.label} count=${g.list.length}><${TaskList} list=${g.list} /><//>`)
          : html`<${TaskList} list=${open} empty=${html`<${Empty} icon="tasks" title="No tasks match" text="Try another filter or add one above." />`} />`}
        ${S.settings.showCompleted && done.length > 0 && html`<${Section} title="Completed" count=${done.length} collapsible id="tasks-done" defaultOpen=${false}><${TaskList} list=${done.slice(0, 100)} nested=${false} /><//>`}`}
      ${view === 'board' && html`<${TaskBoard} list=${S.settings.showCompleted ? list : open} defaults=${defaults} />`}
      ${view === 'calendar' && html`<${TasksCalendarLazy} list=${list} />`}
    </div>
  </div>`;
}

let MonthGridRef = null;
export function registerMonthGrid(c) { MonthGridRef = c; }
function TasksCalendarLazy({ list }) {
  return MonthGridRef ? html`<${MonthGridRef} tasksOnly taskList=${list} />` : null;
}

export function HabitsView() {
  const today = T();
  const habits = tasks().filter((t) => t.repeat).sort((a, b) => (taskDate(a) || '9') < (taskDate(b) || '9') ? -1 : 1);
  const [v, setV] = useState('');
  const days = Array.from({ length: 7 }, (_, i) => D.addDays(today, i - 6));
  const add = () => {
    if (!v.trim()) return;
    const q = parseQuick(v, { natural: true });
    const rule = q.parsed && q.parsed.repeat ? q.parsed.repeat : { freq: 'day', interval: 1 };
    const anchor = q.parsed && q.parsed.date ? q.parsed.date : today;
    const r = { ...rule, anchor };
    const date = D.occursOn(r, today) ? today : D.nextOccurrence(r, today);
    const data = { title: q.title || 'New habit', repeat: r, when: { kind: 'day', date, time: q.parsed && q.parsed.time } };
    if (q.parsed && q.parsed.time) data.reminder = date + 'T' + q.parsed.time;
    create('task', data);
    setV('');
  };
  return html`<div class="view">
    <${ViewHeader} icon="flame" iconColor="var(--flame)" title="Habits" subtitle="Any task can repeat — keep the flame going" />
    <div class="view-body narrow">
      <div class="qadd"><div class="qadd-row"><${Icon} name="flame" size=${18} class="qadd-plus" />
        <input class="qadd-in" placeholder="New habit — e.g. “Read 20 pages every day at 9pm”, “Gym every mon, wed and fri”" value=${v}
          onInput=${(e) => setV(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') add(); }} />
        ${v && html`<button type="button" class="btn btn-sm btn-primary" onClick=${add}>Add</button>`}</div></div>
      ${!habits.length && html`<${Empty} icon="flame" title="No habits yet" text="Create one above, or open any task and choose Repeat." />`}
      ${habits.length > 0 && html`<div class="habits">
        <div class="habit-head"><span></span>${days.map((d) => html`<span class=${cx('hh', d === today && 'today')}>${D.DOW_SHORT[D.dow(d)].slice(0, 2)}<b>${+d.slice(8)}</b></span>`)}<span></span></div>
        ${habits.map((t) => {
          const st = D.habitStats(t, today);
          const comps = new Set(t.completions || []);
          return html`<div class="habit-row" key=${t.id}>
            <button type="button" class="habit-name" onClick=${() => openItem(t.id)}>
              <span class="ellipsis"><b>${t.title || 'Untitled habit'}</b></span>
              <span class="muted small">${D.describeRepeat(t.repeat)}${taskDate(t) && taskDate(t) !== today ? ' · next ' + D.relDay(taskDate(t)) : ''}</span>
            </button>
            ${days.map((d) => {
              const sched = D.occursOn(t.repeat, d);
              return html`<button type="button" class=${cx('hcell', sched && 'sched', comps.has(d) && 'done')} title=${D.fmtDate(d, { weekday: true }) + (sched ? '' : ' (not scheduled)')}
                onClick=${() => toggleHabitDay(t.id, d)}>${comps.has(d) ? html`<${Icon} name="check" size=${14} />` : ''}</button>`;
            })}
            <span class=${cx('streak', st.streak > 0 && 'hot')} title=${`Best ${st.best} · ${st.rate}% over 30 days`}><${Icon} name="flame" size=${16} />${st.streak}</span>
          </div>`;
        })}
      </div>`}
    </div>
  </div>`;
}
