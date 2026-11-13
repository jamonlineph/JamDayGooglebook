// Quick Launcher (Alt+Space / Ctrl+K): search everything, create tasks/events/notes,
// ">" for commands, Tab for quick actions, # tag, & folder, @ date.
import { html, useState, useEffect, useLayoutEffect, useRef, useMemo, cx, fuzzy } from '../lib.js';
import {
  S, emit, tasks, notes, folders, tags, allEvents, titleOf, itemText, openItem, navigate, create, update, trash, undoable,
  toggleTask, isDone, taskDate, setSetting, findFolder, SECTIONS, folderOf, liveTags, toast, eventColor,
} from '../store.js';
import * as D from '../dates.js';
import { Icon } from './icons.js';
import { Chip, ItemIcon, openFolderPicker, openTagPicker, Kbd } from './common.js';
import { parseQuick, chipsFor, createTaskFromText, createEventFromText, tokenAt, suggestionsFor } from '../tokens.js';

export function openLauncher(query = '') { S.ui.launcher = { query, t: Date.now() }; emit(); }
export function closeLauncher() { S.ui.launcher = null; emit(); }

let commandProvider = () => [];
export function registerCommands(fn) { commandProvider = fn; }

const TYPE_ICON = { task: 'tasks', note: 'notes', event: 'calendar', folder: 'folder', tag: 'tag' };

function itemActions(it) {
  const T = D.today();
  const close = () => closeLauncher();
  if (it.type === 'task') return [
    { icon: 'arrowR', label: 'Open', run: () => { openItem(it.id); close(); } },
    { icon: 'check', label: isDone(it) ? 'Mark as not done' : 'Complete', run: () => { toggleTask(it.id); close(); } },
    { icon: 'sun', label: 'Do today', run: () => { update(it.id, { when: { kind: 'day', date: T, time: it.when && it.when.time } }); close(); toast('Scheduled for today'); } },
    { icon: 'upcoming', label: 'Do tomorrow', run: () => { update(it.id, { when: { kind: 'day', date: D.addDays(T, 1) } }); close(); toast('Scheduled for tomorrow'); } },
    { icon: 'calendar', label: 'Sometime this week', run: () => { update(it.id, { when: { kind: 'week', date: D.startOfWeek(T, S.settings.weekStart) } }); close(); } },
    { icon: 'inbox', label: 'Someday', run: () => { update(it.id, { when: { kind: 'someday' } }); close(); } },
    { icon: 'flag', label: 'Mark high priority', run: () => { update(it.id, { priority: 3 }); close(); } },
    { icon: 'folder', label: 'Move to folder…', run: (anchor) => openFolderPicker(anchor, it.folderId, (id) => { update(it.id, { folderId: id }); close(); }) },
    { icon: 'tag', label: 'Tags…', run: (anchor) => openTagPicker(anchor, it.tags, (ids) => update(it.id, { tags: ids })) },
    { icon: 'trash', label: 'Delete', danger: true, run: () => { undoable(`Moved “${titleOf(it)}” to Trash`, [it.id], () => trash(it.id)); close(); } },
  ];
  if (it.type === 'note') return [
    { icon: 'arrowR', label: 'Open', run: () => { navigate('notes', it.id); close(); } },
    { icon: 'pin', label: it.pinned ? 'Unpin' : 'Pin to top', run: () => { update(it.id, { pinned: !it.pinned }); close(); } },
    { icon: 'folder', label: 'Move to folder…', run: (anchor) => openFolderPicker(anchor, it.folderId, (id) => { update(it.id, { folderId: id }); close(); }) },
    { icon: 'tag', label: 'Tags…', run: (anchor) => openTagPicker(anchor, it.tags, (ids) => update(it.id, { tags: ids })) },
    { icon: 'download', label: 'Export as Markdown', run: async () => { (await import('../io.js')).exportNoteMarkdown(it); close(); } },
    { icon: 'trash', label: 'Delete', danger: true, run: () => { undoable(`Moved “${titleOf(it)}” to Trash`, [it.id], () => trash(it.id)); close(); } },
  ];
  if (it.type === 'event') return [
    { icon: 'arrowR', label: 'Open', run: () => { openItem(it.id); close(); } },
    ...(it.url ? [{ icon: 'video', label: 'Join meeting', run: () => { window.open(it.url, '_blank', 'noopener'); close(); } }] : []),
    { icon: 'calendar', label: 'Show in calendar', run: () => { S.ui.calendar = { ...S.ui.calendar, anchor: it.start.slice(0, 10) }; navigate('calendar'); close(); } },
    ...(it.source === 'google' ? [] : [{ icon: 'trash', label: 'Delete', danger: true, run: () => { undoable(`Deleted “${titleOf(it)}”`, [it.id], () => trash(it.id)); close(); } }]),
  ];
  if (it.type === 'folder' || it.type === 'tag') return [
    { icon: 'arrowR', label: 'Open', run: () => { navigate(it.type, it.id); close(); } },
    { icon: 'tasks', label: `New task in ${it.type === 'folder' ? it.name : '#' + it.name}`, run: () => { const t = create('task', it.type === 'folder' ? { folderId: it.id } : { tags: [it.id] }); openItem(t.id); close(); } },
    { icon: 'notes', label: `New note in ${it.type === 'folder' ? it.name : '#' + it.name}`, run: () => { const n = create('note', it.type === 'folder' ? { folderId: it.id } : { tags: [it.id] }); navigate('notes', n.id); close(); } },
  ];
  return [];
}

function buildResults(q) {
  const out = [];
  if (q.startsWith('>')) {
    const cq = q.slice(1).trim();
    return commandProvider().map((c) => ({ ...c, s: cq ? Math.max(fuzzy(cq, c.label), fuzzy(cq, c.kw || '')) : 1 }))
      .filter((c) => c.s >= 0).sort((a, b) => b.s - a.s).slice(0, 30).map((c) => ({ ...c, group: 'Commands', kind: 'cmd' }));
  }
  const parsed = parseQuick(q);
  const text = parsed.title;
  const tagIds = parsed.tagNames.map((n) => (tags().find((t) => t.name.toLowerCase() === n.toLowerCase()) || {}).id).filter(Boolean);
  const folder = parsed.folderName ? findFolder(parsed.folderName) : null;
  const date = parsed.parsed && parsed.parsed.kind === 'day' ? parsed.parsed.date : null;
  const filtered = !!(tagIds.length || folder || date);

  if (!q.trim()) {
    const recent = [...tasks().filter((t) => !isDone(t)), ...notes()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6);
    recent.forEach((it) => out.push({ group: 'Recent', kind: 'item', item: it }));
    ['today', 'inbox', 'upcoming', 'calendar', 'notes', 'habits'].forEach((s) => out.push({ group: 'Jump to', kind: 'nav', icon: SECTIONS[s].icon, label: SECTIONS[s].label, run: () => { navigate(s); closeLauncher(); } }));
    return out;
  }

  // search
  const pool = [...tasks(), ...notes(), ...allEvents(), ...(filtered ? [] : [...folders(), ...tags()])];
  const scored = [];
  for (const it of pool) {
    if (tagIds.length && !tagIds.every((id) => (it.tags || []).includes(id))) continue;
    if (folder && it.folderId !== folder.id) continue;
    if (date) {
      const d = it.type === 'event' ? it.start.slice(0, 10) : it.type === 'task' ? taskDate(it) || it.deadline : null;
      if (d !== date) continue;
    }
    let s = text ? fuzzy(text, titleOf(it)) : 500;
    if (text && s < 0 && it.type !== 'folder' && it.type !== 'tag') { const b = fuzzy(text, itemText(it)); s = b >= 0 && b >= 600 ? b - 400 : -1; }
    if (s < 0) continue;
    if (it.type === 'task' && isDone(it)) s -= 200;
    scored.push({ it, s });
  }
  scored.sort((a, b) => b.s - a.s || b.it.updatedAt - a.it.updatedAt);
  const top = scored.slice(0, 12);

  // navigation targets
  if (!filtered && text) {
    Object.entries(SECTIONS).forEach(([k, v]) => { const s = fuzzy(text, v.label); if (s >= 600) out.push({ group: 'Jump to', kind: 'nav', icon: v.icon, label: v.label, s, run: () => { navigate(k); closeLauncher(); } }); });
    const sv = fuzzy(text, 'settings'); if (sv >= 600) out.push({ group: 'Jump to', kind: 'nav', icon: 'settings', label: 'Settings', run: () => { navigate('settings'); closeLauncher(); } });
  }

  const create_ = [];
  const chips = chipsFor(parsed);
  const label = text || (date ? 'on ' + D.fmtDate(date) : '…');
  create_.push({ group: 'Create', kind: 'create', icon: 'tasks', label: `New task “${label}”`, chips, run: () => { const t = createTaskFromText(q); closeLauncher(); if (t) toast(`Added “${t.title}”`, { action: { label: 'Open', run: () => openItem(t.id) } }); } });
  const pe = parseQuick(q, { natural: true });
  const evChips = pe.parsed ? [{ icon: 'calendar', label: D.describeParse(pe.parsed, { timeFmt: S.settings.timeFormat }) }] : [];
  create_.push({ group: 'Create', kind: 'create', icon: 'calendar', label: `New event “${pe.title || 'New event'}”`, chips: evChips, run: () => { const ev = createEventFromText(q.replace(/(^|\s)@/g, '$1')); closeLauncher(); openItem(ev.id); } });
  create_.push({ group: 'Create', kind: 'create', icon: 'notes', label: `New note “${text || 'Untitled'}”`, run: () => {
    const n = create('note', { title: text, folderId: folder ? folder.id : null, tags: tagIds }); closeLauncher(); navigate('notes', n.id);
  } });

  const results = top.map(({ it }) => ({ group: it.type === 'folder' || it.type === 'tag' ? 'Folders & tags' : 'Results', kind: 'item', item: it }));
  const strong = top.length && top[0].s >= 600;
  return strong ? [...results, ...out, ...create_] : [...create_, ...results, ...out];
}

function ResultRow({ r, sel, onHover, onRun }) {
  if (r.kind === 'item') {
    const it = r.item;
    const f = folderOf(it);
    let meta = '';
    if (it.type === 'task') meta = [it.when ? D.whenLabel(it.when) : '', it.deadline ? 'Due ' + D.relDay(it.deadline) : '', isDone(it) ? 'Done' : ''].filter(Boolean).join(' · ');
    else if (it.type === 'event') meta = D.fmtDate(it.start.slice(0, 10), { weekday: true }) + (it.allDay ? '' : ' ' + D.fmtTime(it.start.slice(11), S.settings.timeFormat)) + (it.source === 'google' ? ' · Google' : '');
    else if (it.type === 'note') meta = 'Note · edited ' + D.relDay(D.ds(new Date(it.updatedAt)));
    else meta = it.type === 'folder' ? 'Folder' : 'Tag';
    return html`<button type="button" class=${cx('l-row', sel && 'sel')} onMouseMove=${onHover} onClick=${onRun}>
      <span class="l-ic" style=${it.type === 'event' ? `color:${eventColor(it)}` : it.color ? `color:${it.color}` : ''}>
        ${it.type === 'note' || it.type === 'folder' ? html`<${ItemIcon} icon=${it.icon} fallback=${TYPE_ICON[it.type]} size=${17} />` : html`<${Icon} name=${it.repeat ? 'flame' : TYPE_ICON[it.type]} size=${17} />`}</span>
      <span class="l-main"><span class=${cx('ellipsis', it.type === 'task' && isDone(it) && 'struck')}>${it.type === 'tag' ? '#' : ''}${titleOf(it)}</span><span class="l-meta">${meta}${f ? ' · ' + f.name : ''}${liveTags(it).map((t) => ' #' + t.name).join('')}</span></span>
      ${sel && html`<span class="l-hint"><kbd>Tab</kbd> actions</span>`}
    </button>`;
  }
  return html`<button type="button" class=${cx('l-row', sel && 'sel', r.danger && 'danger')} onMouseMove=${onHover} onClick=${onRun}>
    <span class="l-ic"><${Icon} name=${r.icon || 'command'} size=${17} /></span>
    <span class="l-main"><span class="ellipsis">${r.label}</span>${r.chips && r.chips.length > 0 && html`<span class="l-chips">${r.chips.map((c) => html`<${Chip} icon=${c.icon} label=${c.label} kind=${c.kind} />`)}</span>`}</span>
    ${r.hint && html`<span class="l-hint">${r.hint}</span>`}
  </button>`;
}

export function Launcher() {
  const st = S.ui.launcher;
  const [q, setQ] = useState(st ? st.query : '');
  const [sel, setSel] = useState(0);
  const [actionsFor, setActionsFor] = useState(null);
  const [caret, setCaret] = useState(0);
  const inputRef = useRef();
  const listRef = useRef();
  useLayoutEffect(() => { setQ(st ? st.query : ''); setSel(0); setActionsFor(null); if (inputRef.current) inputRef.current.focus(); }, [st && st.t]);
  const results = useMemo(() => (actionsFor ? itemActions(actionsFor).map((a) => ({ ...a, group: 'Actions · ' + titleOf(actionsFor), kind: 'action' })) : buildResults(q)), [q, actionsFor, S.items.size]);
  useEffect(() => { const el = listRef.current && listRef.current.querySelector('.l-row.sel'); if (el) el.scrollIntoView({ block: 'nearest' }); }, [sel]);
  if (!st) return null;
  const tok = !actionsFor && !q.startsWith('>') ? tokenAt(q, caret) : null;
  const sugg = tok && tok.char !== '+' ? suggestionsFor(tok) : [];
  const run = (r, anchor) => {
    if (!r) return;
    if (r.kind === 'item') { const it = r.item; if (it.type === 'note') navigate('notes', it.id); else if (it.type === 'folder' || it.type === 'tag') navigate(it.type, it.id); else openItem(it.id); closeLauncher(); return; }
    r.run(anchor || inputRef.current);
  };
  const applySugg = (s) => {
    const nv = q.slice(0, tok.start) + s.insert + ' ' + q.slice(tok.end).replace(/^\s+/, '');
    setQ(nv); setSel(0);
    const pos = tok.start + s.insert.length + 1;
    requestAnimationFrame(() => { inputRef.current.setSelectionRange(pos, pos); setCaret(pos); });
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (actionsFor) { setActionsFor(null); setSel(0); } else closeLauncher(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((sel + 1) % Math.max(1, results.length)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSel((sel - 1 + results.length) % Math.max(1, results.length)); return; }
    if (e.key === 'Tab') {
      e.preventDefault();
      if (sugg.length && !e.shiftKey) { applySugg(sugg[0]); return; }
      if (e.shiftKey || actionsFor) { setActionsFor(null); setSel(0); return; }
      const r = results[sel];
      if (r && r.kind === 'item') { setActionsFor(r.item); setSel(0); }
      return;
    }
    if (e.key === 'Backspace' && actionsFor && !q) { setActionsFor(null); setSel(0); return; }
    if (e.key === 'Enter') { e.preventDefault(); const rows = listRef.current ? listRef.current.querySelectorAll('.l-row') : []; run(results[sel], rows[sel]); }
  };
  let lastGroup = null;
  return html`<div class="launcher-wrap" onMouseDown=${(e) => { if (e.target === e.currentTarget) closeLauncher(); }}>
    <div class="launcher" role="dialog" aria-label="Quick Launcher">
      <div class="l-in">
        <${Icon} name=${q.startsWith('>') ? 'command' : actionsFor ? 'bolt' : 'search'} size=${19} />
        ${actionsFor && html`<span class="l-crumb">${titleOf(actionsFor)}</span>`}
        <input ref=${inputRef} value=${q} placeholder=${actionsFor ? 'Filter actions…' : 'Search, or create: “Call Ana @tomorrow 3pm #home &Family”'}
          onInput=${(e) => { setQ(e.target.value); setSel(0); setCaret(e.target.selectionStart); }} onKeyDown=${onKey}
          onKeyUp=${(e) => setCaret(e.target.selectionStart)} aria-label="Search everything" />
        <kbd>Esc</kbd>
      </div>
      ${sugg.length > 0 && html`<div class="l-sugg">${sugg.slice(0, 6).map((s) => html`<button type="button" class="pill" onMouseDown=${(e) => e.preventDefault()} onClick=${() => applySugg(s)}>${s.label}${s.hint ? html` <span class="muted">${s.hint}</span>` : ''}</button>`)}</div>`}
      <div class="l-results" ref=${listRef}>
        ${results.map((r, i) => {
          const head = r.group !== lastGroup ? html`<div class="l-group">${r.group}</div>` : null;
          lastGroup = r.group;
          return html`${head}<${ResultRow} r=${r} sel=${i === sel} onHover=${() => i !== sel && setSel(i)} onRun=${(e) => run(r, e.currentTarget)} />`;
        })}
        ${!results.length && html`<div class="picker-empty">No matches</div>`}
      </div>
      <div class="l-foot">
        <span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>Tab</kbd> actions</span>
        <span><kbd>></kbd> commands</span><span><kbd>#</kbd> tag</span><span><kbd>&</kbd> folder</span><span><kbd>@</kbd> date</span>
      </div>
    </div>
  </div>`;
}
