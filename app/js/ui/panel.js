// Quick Panel — the companion that would live in a menu bar on other platforms.
// Styles: dropdown, draggable floating window, or docked full height on the left/right edge.
import { html, useState, useEffect, useRef, cx } from '../lib.js';
import {
  S, emit, setSetting, tasks, notes, eventsOn, allEvents, isDone, isTodayTask, taskDate, sortTasks, openItem, navigate,
  create, titleOf, eventColor, isInbox,
} from '../store.js';
import * as D from '../dates.js';
import { Icon } from './icons.js';
import { Btn, MiniMonth, Segmented, Empty, ItemIcon, openMenu } from './common.js';
import { TaskRow, QuickAdd } from './tasks.js';
import { createEventFromText } from '../tokens.js';

export function togglePanel(force) { S.ui.panel = force != null ? force : !S.ui.panel; emit(); }

const TABS = [
  { v: 'today', icon: 'sun', title: 'Today' }, { v: 'calendar', icon: 'calendar', title: 'Calendar' },
  { v: 'tasks', icon: 'tasks', title: 'Tasks' }, { v: 'events', icon: 'clock', title: 'Events' }, { v: 'notes', icon: 'notes', title: 'Notes' },
];

function Agenda({ date, empty = 'No events' }) {
  const evs = eventsOn(date);
  const tf = S.settings.timeFormat;
  if (!evs.length) return html`<div class="muted small qp-empty">${empty}</div>`;
  return html`<div class="qp-ag">${evs.map((e) => html`<button type="button" class="qp-ev" style=${`--c:${eventColor(e)}`} onClick=${() => openItem(e.id)}>
    <span class="qp-ev-t">${e.allDay ? 'All day' : D.fmtTime(e.start.slice(11), tf)}</span><span class="ellipsis grow">${e.title || 'Untitled'}</span>
    ${e.url && html`<a class="btn btn-sm btn-primary" href=${e.url} target="_blank" rel="noopener" onClick=${(x) => x.stopPropagation()}>Join</a>`}
  </button>`)}</div>`;
}

function TodayTab() {
  const T = D.today();
  const list = sortTasks(tasks().filter((t) => isTodayTask(t, T) && !t.parentId));
  return html`<div class="qp-sec">
    <h5>${D.fmtDate(T, { weekday: true, long: true })}</h5>
    <${Agenda} date=${T} empty="No events today" />
    <h5>Tasks</h5>
    <${QuickAdd} defaults=${{ when: { kind: 'day', date: T } }} placeholder="Add for today…" />
    <div class="tlist">${list.map((t) => html`<${TaskRow} key=${t.id} t=${t} compact draggable=${false} />`)}</div>
    ${!list.length && html`<div class="muted small qp-empty">Nothing due today 🎉</div>`}
  </div>`;
}

function CalendarTab() {
  const [d, setD] = useState(D.today());
  const marks = new Set();
  const start = D.addDays(D.startOfMonth(d), -7), end = D.addDays(D.endOfMonth(d), 7);
  allEvents().forEach((e) => { const s = e.start.slice(0, 10); if (s >= start && s <= end) marks.add(s); });
  tasks().forEach((t) => { const td = taskDate(t); if (td && !isDone(t)) marks.add(td); });
  const tl = sortTasks(tasks().filter((t) => !isDone(t) && (taskDate(t) === d || t.deadline === d)));
  return html`<div class="qp-sec">
    <${MiniMonth} value=${d} onPick=${setD} marks=${marks} />
    <h5>${D.relDay(d)} · ${D.fmtDate(d, { weekday: true })}</h5>
    <${Agenda} date=${d} />
    ${tl.length > 0 && html`<div class="tlist">${tl.map((t) => html`<${TaskRow} key=${t.id} t=${t} compact draggable=${false} showWhen=${false} />`)}</div>`}
  </div>`;
}

function TasksTab() {
  const T = D.today();
  const inbox = sortTasks(tasks().filter(isInbox));
  const up = sortTasks(tasks().filter((t) => !isDone(t) && !t.parentId && taskDate(t) && taskDate(t) > T && taskDate(t) <= D.addDays(T, 7)));
  return html`<div class="qp-sec">
    <${QuickAdd} placeholder="Capture a task… (@date #tag &folder)" />
    <h5>Inbox · ${inbox.length}</h5>
    <div class="tlist">${inbox.slice(0, 12).map((t) => html`<${TaskRow} key=${t.id} t=${t} compact draggable=${false} />`)}</div>
    ${!inbox.length && html`<div class="muted small qp-empty">Inbox zero</div>`}
    <h5>Next 7 days · ${up.length}</h5>
    <div class="tlist">${up.slice(0, 12).map((t) => html`<${TaskRow} key=${t.id} t=${t} compact draggable=${false} />`)}</div>
  </div>`;
}

function EventsTab() {
  const [v, setV] = useState('');
  const T = D.today();
  const days = Array.from({ length: 7 }, (_, i) => D.addDays(T, i)).filter((d) => eventsOn(d).length);
  return html`<div class="qp-sec">
    <div class="qadd"><div class="qadd-row"><${Icon} name="calendar" size=${16} class="qadd-plus" />
      <input class="qadd-in" placeholder="“Coffee with Sam fri 10am”" value=${v} onInput=${(e) => setV(e.target.value)}
        onKeyDown=${(e) => { if (e.key === 'Enter' && v.trim()) { const ev = createEventFromText(v); setV(''); openItem(ev.id); } }} /></div></div>
    ${days.map((d) => html`<h5>${D.relDay(d)}</h5><${Agenda} date=${d} />`)}
    ${!days.length && html`<div class="muted small qp-empty">No events this week</div>`}
  </div>`;
}

function NotesTab() {
  const [v, setV] = useState('');
  const recent = notes().slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 10);
  const save = () => {
    if (!v.trim()) return;
    const [first, ...rest] = v.trim().split('\n');
    create('note', { title: first.slice(0, 80), blocks: (rest.length ? rest : ['']).map((l, i) => ({ id: 'b' + Date.now() + i, type: 'p', html: l.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])) })) });
    setV('');
  };
  return html`<div class="qp-sec">
    <textarea class="input qp-note" rows="3" placeholder="Quick note… first line becomes the title (Ctrl+Enter to save)" value=${v} onInput=${(e) => setV(e.target.value)}
      onKeyDown=${(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save(); }}></textarea>
    <div class="row-end"><${Btn} size="sm" kind="primary" label="Save note" onClick=${save} disabled=${!v.trim()} /></div>
    <h5>Recent notes</h5>
    ${recent.map((n) => html`<button type="button" class="qp-note-row" onClick=${() => navigate('notes', n.id)}><${ItemIcon} icon=${n.icon} fallback="notes" size=${15} /><span class="ellipsis">${titleOf(n)}</span><span class="muted small">${D.relDay(D.ds(new Date(n.updatedAt)))}</span></button>`)}
  </div>`;
}

export function QuickPanel() {
  const p = S.settings.panel;
  const ref = useRef();
  const open = S.ui.panel;
  const style = p.style;
  const tab = p.tab || 'today';
  useEffect(() => {
    if (!open || style !== 'dropdown') return;
    const off = (e) => {
      if (ref.current && !ref.current.contains(e.target) && !e.target.closest('.panel-toggle, .popover, .modal, .pop-backdrop, .modal-backdrop, .drawer')) togglePanel(false);
    };
    const t = setTimeout(() => document.addEventListener('mousedown', off), 0);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', off); };
  }, [open, style]);
  if (!open) return null;
  const startDrag = (e) => {
    if (style !== 'floating' || e.target.closest('button')) return;
    const r = ref.current.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    const move = (ev) => { ref.current.style.left = Math.max(0, Math.min(innerWidth - r.width, ev.clientX - dx)) + 'px'; ref.current.style.top = Math.max(0, Math.min(innerHeight - 60, ev.clientY - dy)) + 'px'; };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); setSetting('panel.x', parseInt(ref.current.style.left, 10)); setSetting('panel.y', parseInt(ref.current.style.top, 10)); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };
  const pos = style === 'floating' ? `left:${p.x != null ? Math.min(p.x, innerWidth - 380) : innerWidth - 420}px;top:${p.y != null ? Math.min(p.y, innerHeight - 200) : 80}px` : '';
  return html`<div ref=${ref} class=${cx('qp', 'qp-' + style)} style=${pos} role="dialog" aria-label="Quick panel"
      onMouseLeave=${() => { if (p.edge && (style === 'dock-left' || style === 'dock-right') && S.ui.panelFromEdge) { S.ui.panelFromEdge = false; togglePanel(false); } }}>
    <div class="qp-h" onPointerDown=${startDrag}>
      <span class="qp-logo"><${Icon} name="logo" size=${18} /></span><b>JamDay</b><span class="grow"></span>
      <${Btn} icon="dock" size="sm" title="Panel style" onClick=${(e) => openMenu(e.currentTarget, [
        { header: 'Panel style' },
        { label: 'Dropdown', checked: style === 'dropdown', onClick: () => setSetting('panel.style', 'dropdown') },
        { label: 'Floating (drag to move)', checked: style === 'floating', onClick: () => setSetting('panel.style', 'floating') },
        { label: 'Docked left', checked: style === 'dock-left', onClick: () => setSetting('panel.style', 'dock-left') },
        { label: 'Docked right', checked: style === 'dock-right', onClick: () => setSetting('panel.style', 'dock-right') },
        { sep: true },
        { label: 'Open when pointer hits the screen edge', checked: p.edge, onClick: () => setSetting('panel.edge', !p.edge) },
      ], { align: 'right' })} />
      <${Btn} icon="x" size="sm" title="Close (Esc)" onClick=${() => togglePanel(false)} />
    </div>
    <div class="qp-tabs"><${Segmented} value=${tab} onChange=${(v) => setSetting('panel.tab', v)} options=${TABS.map((t) => ({ ...t, label: '' }))} /></div>
    <div class="qp-body">
      ${tab === 'today' && html`<${TodayTab} />`}
      ${tab === 'calendar' && html`<${CalendarTab} />`}
      ${tab === 'tasks' && html`<${TasksTab} />`}
      ${tab === 'events' && html`<${EventsTab} />`}
      ${tab === 'notes' && html`<${NotesTab} />`}
    </div>
  </div>`;
}
