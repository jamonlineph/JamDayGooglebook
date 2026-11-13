// Shared UI: overlay hosts, menus, dialogs, pickers and small controls.
import { html, useState, useEffect, useRef, useLayoutEffect, useMemo, clamp, cx, fuzzy, pickFiles, isMac } from '../lib.js';
import {
  S, closePopover, openPopover, openModal, closeModal, dismissToast, tags, folders, create, alive, titleOf,
  COLORS, storeFile, fileURL, toast, tasks, notes, allEvents, setUI,
} from '../store.js';
import * as D from '../dates.js';
import { Icon } from './icons.js';

/* ------------------------------------------------------------------ */
/* Small controls                                                       */
/* ------------------------------------------------------------------ */

export function Btn({ icon, label, onClick, kind = '', title, class: c = '', disabled, size, children, type = 'button', ...rest }) {
  return html`<button type=${type} class=${cx('btn', kind && 'btn-' + kind, !label && !children && 'btn-icon', size && 'btn-' + size, c)}
    title=${title || (!label ? undefined : undefined)} aria-label=${title || label} onClick=${onClick} disabled=${disabled} ...${rest}>
    ${icon && html`<${Icon} name=${icon} size=${size === 'sm' ? 15 : 17} />`}${label && html`<span>${label}</span>`}${children}</button>`;
}

export function Chip({ icon, label, color, kind = '', onClick, title, onRemove }) {
  return html`<span class=${cx('chip', kind, onClick && 'clickable')} title=${title} onClick=${onClick}
    style=${color ? `--chip:${color}` : ''}>
    ${color && !icon && html`<i class="dot" style=${`background:${color}`}></i>`}
    ${icon && html`<${Icon} name=${icon} size=${13} />`}<span class="chip-l">${label}</span>
    ${onRemove && html`<button class="chip-x" aria-label="Remove" onClick=${(e) => { e.stopPropagation(); onRemove(); }}><${Icon} name="x" size=${11} /></button>`}
  </span>`;
}

export function Segmented({ options, value, onChange, size }) {
  return html`<div class=${cx('seg', size && 'seg-' + size)} role="tablist">
    ${options.map((o) => html`<button type="button" role="tab" aria-selected=${o.v === value} class=${cx('seg-b', o.v === value && 'on')}
      title=${o.title || o.label} onClick=${() => onChange(o.v)}>${o.icon && html`<${Icon} name=${o.icon} size=${15} />`}${o.label && html`<span>${o.label}</span>`}</button>`)}
  </div>`;
}

export function Switch({ checked, onChange, label, hint, disabled }) {
  return html`<label class=${cx('switch-row', disabled && 'disabled')}>
    <span class="switch-text"><span>${label}</span>${hint && html`<small>${hint}</small>`}</span>
    <input type="checkbox" class="switch" checked=${!!checked} disabled=${disabled} onChange=${(e) => onChange(e.target.checked)} />
  </label>`;
}

export function Kbd({ keys }) {
  return html`<span class="kbds">${shortcutParts(keys).map((k) => html`<kbd>${k}</kbd>`)}</span>`;
}
export function shortcutParts(combo) {
  return combo.split('+').map((k) => ({
    alt: isMac ? '⌥' : 'Alt', ctrl: isMac ? '⌃' : 'Ctrl', shift: '⇧', meta: isMac ? '⌘' : 'Meta', space: 'Space',
    enter: '↵', esc: 'Esc', up: '↑', down: '↓', left: '←', right: '→', tab: 'Tab',
  }[k] || k.toUpperCase()));
}
export const shortcutLabel = (combo) => shortcutParts(combo).join(isMac ? '' : '+');

export function Empty({ icon = 'sparkles', title, text, children }) {
  return html`<div class="empty"><div class="empty-ic"><${Icon} name=${icon} size=${26} /></div><h3>${title}</h3>${text && html`<p>${text}</p>`}${children}</div>`;
}

export function ItemIcon({ icon, fallback = 'notes', size = 18 }) {
  const [url, setUrl] = useState(null);
  useEffect(() => { if (icon && icon.type === 'image') fileURL(icon.fileId).then(setUrl); }, [icon && icon.fileId]);
  if (!icon) return html`<${Icon} name=${fallback} size=${size} />`;
  if (icon.type === 'emoji') return html`<span class="emoji-ic" style=${`font-size:${size}px;line-height:1`}>${icon.value}</span>`;
  if (icon.type === 'image') return url ? html`<img class="img-ic" src=${url} width=${size} height=${size} alt="" />` : html`<span style=${`width:${size}px;height:${size}px;display:inline-block`}></span>`;
  return html`<${Icon} name=${fallback} size=${size} />`;
}

/* ------------------------------------------------------------------ */
/* Overlay hosts                                                        */
/* ------------------------------------------------------------------ */

export function PopoverHost() {
  const p = S.overlay.popover;
  const ref = useRef();
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    if (!p || !ref.current) { setPos(null); return; }
    const el = ref.current; const r = p.rect;
    const w = el.offsetWidth, hgt = el.offsetHeight, vw = innerWidth, vh = innerHeight, gap = 6;
    let left = p.align === 'right' ? r.right - w : p.align === 'center' ? r.left + r.width / 2 - w / 2 : r.left;
    let top = r.bottom + gap;
    if (p.placement === 'right') { left = r.right + gap; top = r.top; }
    if (p.placement === 'above') top = r.top - hgt - gap;
    if (top + hgt > vh - 8) top = p.placement === 'right' ? vh - hgt - 8 : r.top - hgt - gap;
    top = clamp(top, 8, Math.max(8, vh - hgt - 8));
    left = clamp(left, 8, Math.max(8, vw - w - 8));
    setPos({ left, top });
  }, [p && p.id]);
  if (!p) return null;
  return html`<div class="pop-backdrop" onMouseDown=${(e) => { if (e.target === e.currentTarget) closePopover(); }}
      onContextMenu=${(e) => { e.preventDefault(); closePopover(); }}>
    <div ref=${ref} key=${p.id} class=${cx('popover', p.className)}
      style=${pos ? `left:${pos.left}px;top:${pos.top}px` : 'left:0;top:0;visibility:hidden'}>${p.render()}</div>
  </div>`;
}

export function ModalHost() {
  return S.overlay.modals.map((m) => html`<div class="modal-backdrop" key=${m.id}
      onMouseDown=${(e) => { if (e.target === e.currentTarget && !m.sticky) closeModal(m.id); }}>
    <div class=${cx('modal', m.className)} style=${m.width ? `width:min(${m.width}px, calc(100vw - 24px))` : ''} role="dialog" aria-modal="true">
      ${m.render(() => closeModal(m.id))}
    </div>
  </div>`);
}

export function ToastHost() {
  return html`<div class="toasts" role="status" aria-live="polite">${S.toasts.map((t) => html`<div class=${cx('toast', t.kind)} key=${t.id}>
    <span>${t.message}</span>
    ${t.action && html`<button class="toast-a" onClick=${() => { t.action.run(); dismissToast(t.id); }}>${t.action.label}</button>`}
    <button class="toast-x" aria-label="Dismiss" onClick=${() => dismissToast(t.id)}><${Icon} name="x" size=${13} /></button>
  </div>`)}</div>`;
}

/* ------------------------------------------------------------------ */
/* Menus + dialogs                                                      */
/* ------------------------------------------------------------------ */

export function openMenu(anchor, items, opts = {}) {
  openPopover(anchor, () => html`<${Menu} items=${items} />`, { className: 'menu-pop', ...opts });
}
export function openContextMenu(e, items) {
  e.preventDefault();
  openMenu({ left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY, width: 0, height: 0 }, items);
}

export function Menu({ items }) {
  const list = items.filter(Boolean);
  const [sel, setSel] = useState(-1);
  const ref = useRef();
  useEffect(() => { ref.current && ref.current.focus(); }, []);
  const actionable = list.map((it, i) => (it.sep || it.header || it.disabled ? -1 : i)).filter((i) => i >= 0);
  const onKey = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const pos = actionable.indexOf(sel);
      const n = e.key === 'ArrowDown' ? actionable[(pos + 1) % actionable.length] : actionable[(pos - 1 + actionable.length) % actionable.length];
      setSel(n);
    } else if (e.key === 'Enter' && sel >= 0) { e.preventDefault(); run(list[sel]); }
  };
  const run = (it) => { if (it.keepOpen) { it.onClick && it.onClick(); return; } closePopover(); it.onClick && setTimeout(() => it.onClick(), 0); };
  return html`<div class="menu" tabIndex="-1" ref=${ref} onKeyDown=${onKey} role="menu">
    ${list.map((it, i) => it.sep ? html`<div class="menu-sep"></div>`
      : it.header ? html`<div class="menu-h">${it.header}</div>`
      : html`<button role="menuitem" class=${cx('menu-i', it.danger && 'danger', i === sel && 'sel', it.disabled && 'disabled')}
          disabled=${it.disabled} onMouseEnter=${() => setSel(i)} onClick=${() => run(it)}>
          <span class="menu-ic">${it.checked ? html`<${Icon} name="check" size=${15} />` : it.color ? html`<i class="dot" style=${`background:${it.color}`}></i>` : it.icon ? html`<${Icon} name=${it.icon} size=${15} />` : ''}</span>
          <span class="menu-l">${it.label}</span>${it.hint && html`<span class="menu-hint">${it.hint}</span>`}
        </button>`)}
  </div>`;
}

export function confirmDialog({ title = 'Are you sure?', message = '', confirmLabel = 'Delete', danger = true, cancelLabel = 'Cancel' } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const id = openModal((close) => html`<div class="dialog">
      <h3>${title}</h3>${message && html`<p class="muted">${message}</p>`}
      <div class="dialog-actions">
        <${Btn} label=${cancelLabel} onClick=${() => { done(false); close(); }} />
        <${Btn} label=${confirmLabel} kind=${danger ? 'danger' : 'primary'} autoFocus onClick=${() => { done(true); close(); }} />
      </div></div>`, { width: 400, onClose: () => done(false) });
    return id;
  });
}

function PromptBody({ title, label, value, placeholder, okLabel, onDone, close, multiline }) {
  const [v, setV] = useState(value || '');
  const ref = useRef();
  useEffect(() => { ref.current && (ref.current.focus(), ref.current.select && ref.current.select()); }, []);
  const ok = () => { onDone(v); close(); };
  return html`<form class="dialog" onSubmit=${(e) => { e.preventDefault(); ok(); }}>
    <h3>${title}</h3>
    ${label && html`<label class="field-l">${label}</label>`}
    ${multiline
      ? html`<textarea ref=${ref} class="input" rows="6" value=${v} placeholder=${placeholder} onInput=${(e) => setV(e.target.value)}></textarea>`
      : html`<input ref=${ref} class="input" value=${v} placeholder=${placeholder} onInput=${(e) => setV(e.target.value)} />`}
    <div class="dialog-actions"><${Btn} label="Cancel" onClick=${close} /><${Btn} type="submit" kind="primary" label=${okLabel || 'OK'} /></div>
  </form>`;
}
export function promptDialog({ title, label, value = '', placeholder = '', okLabel = 'Save', multiline = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    openModal((close) => html`<${PromptBody} ...${{ title, label, value, placeholder, okLabel, multiline, close }} onDone=${done} />`, { width: 440, onClose: () => done(null) });
  });
}

/* ------------------------------------------------------------------ */
/* Mini month calendar                                                  */
/* ------------------------------------------------------------------ */

export function MiniMonth({ value, onPick, marks, initialMonth, compact }) {
  const ws = S.settings.weekStart;
  const [month, setMonth] = useState(D.startOfMonth(initialMonth || value || D.today()));
  useEffect(() => { if (value && value.slice(0, 7) !== month.slice(0, 7) && !initialMonth) setMonth(D.startOfMonth(value)); }, [value]);
  const start = D.startOfWeek(month, ws);
  const T = D.today();
  const days = Array.from({ length: 42 }, (_, i) => D.addDays(start, i));
  const heads = Array.from({ length: 7 }, (_, i) => D.DOW_SHORT[(i + ws) % 7].slice(0, 2));
  return html`<div class=${cx('mini', compact && 'compact')}>
    <div class="mini-h">
      <b>${D.monthTitle(month)}</b>
      <span>
        <button type="button" class="btn btn-icon btn-sm" aria-label="Previous month" onClick=${() => setMonth(D.addMonths(month, -1))}><${Icon} name="chevL" size=${15} /></button>
        <button type="button" class="btn btn-icon btn-sm" aria-label="Next month" onClick=${() => setMonth(D.addMonths(month, 1))}><${Icon} name="chevR" size=${15} /></button>
      </span>
    </div>
    <div class="mini-g">
      ${heads.map((h) => html`<span class="mini-dow">${h}</span>`)}
      ${days.map((d) => html`<button type="button" class=${cx('mini-d', d.slice(0, 7) !== month.slice(0, 7) && 'out', d === T && 'today', d === value && 'sel')}
        onClick=${() => onPick(d)}>${+d.slice(8)}${marks && marks.has(d) && html`<i></i>`}</button>`)}
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* When / date picker (plain language)                                  */
/* ------------------------------------------------------------------ */

export function WhenPicker({ value, onChange, mode = 'when', repeat, onRepeat, onClose }) {
  const [text, setText] = useState('');
  const ws = S.settings.weekStart;
  const T = D.today();
  const parsed = useMemo(() => (text.trim() ? D.parseNatural(text, { weekStart: ws }) : null), [text]);
  const inputRef = useRef();
  useEffect(() => { inputRef.current && inputRef.current.focus(); }, []);
  const isDeadline = mode === 'deadline';
  const cur = isDeadline ? (value ? { kind: 'day', date: value } : null) : value;
  const set = (w) => {
    if (isDeadline) onChange(w && w.date ? w.date : null);
    else onChange(w);
    if (!w || w.kind !== 'day' || isDeadline) closePopover();
  };
  const applyParsed = () => {
    if (!parsed || !parsed.found) return;
    if (parsed.kind === 'someday') set({ kind: 'someday' });
    else if (parsed.kind === 'day') {
      if (isDeadline) set({ kind: 'day', date: parsed.date });
      else { onChange({ kind: 'day', date: parsed.date, time: parsed.time || null }); if (parsed.repeat && onRepeat) onRepeat({ ...parsed.repeat, anchor: parsed.date }); closePopover(); }
    } else set({ kind: parsed.kind, date: parsed.date });
  };
  const sat = D.addDays(T, (6 - D.dow(T) + 7) % 7);
  const quick = [
    { icon: 'sun', label: 'Today', w: { kind: 'day', date: T } },
    { icon: 'upcoming', label: 'Tomorrow', w: { kind: 'day', date: D.addDays(T, 1) } },
    { icon: 'calendar', label: 'This weekend', w: { kind: 'day', date: sat } },
    { icon: 'arrowR', label: 'Next week', w: { kind: 'day', date: D.addDays(D.startOfWeek(T, ws), 7) }, hint: D.fmtDate(D.addDays(D.startOfWeek(T, ws), 7), { weekday: true }) },
  ];
  const spans = isDeadline ? [] : [
    { label: 'This week', w: { kind: 'week', date: D.startOfWeek(T, ws) } },
    { label: 'Next week', w: { kind: 'week', date: D.addDays(D.startOfWeek(T, ws), 7) } },
    { label: 'This month', w: { kind: 'month', date: D.startOfMonth(T) } },
    { label: 'Next month', w: { kind: 'month', date: D.addMonths(D.startOfMonth(T), 1) } },
    { label: 'Someday', w: { kind: 'someday' } },
  ];
  return html`<div class="when-pick">
    <div class="when-in">
      <${Icon} name="sparkles" size=${15} />
      <input ref=${inputRef} class="input bare" placeholder=${isDeadline ? 'Deadline: “fri”, “nov 30”, “in 2 weeks”…' : 'Type: “tomorrow 3pm”, “next fri”, “every mon”…'} value=${text}
        onInput=${(e) => setText(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); applyParsed(); } }} />
    </div>
    ${parsed && html`<button type="button" class=${cx('when-preview', !parsed.found && 'none')} onClick=${applyParsed} disabled=${!parsed.found}>
      ${parsed.found ? html`<${Icon} name="check" size=${14} /> ${D.describeParse(parsed, { timeFmt: S.settings.timeFormat, weekStart: ws })}` : 'Keep typing — try “next tue 4pm”'}
    </button>`}
    <div class="when-quick">
      ${quick.map((q) => html`<button type="button" class=${cx('when-q', cur && cur.kind === 'day' && cur.date === q.w.date && 'on')} onClick=${() => set(isDeadline ? q.w : { ...q.w, time: cur && cur.time })}>
        <${Icon} name=${q.icon} size=${15} /><span>${q.label}</span><small>${q.hint || D.fmtDate(q.w.date, { weekday: true }).split(',')[0]}</small></button>`)}
    </div>
    ${spans.length > 0 && html`<div class="when-spans">${spans.map((s) => html`<button type="button" class=${cx('pill', cur && cur.kind === s.w.kind && cur.date === s.w.date && 'on')} onClick=${() => set(s.w)}>${s.label}</button>`)}</div>`}
    <${MiniMonth} value=${cur && cur.kind === 'day' ? cur.date : null} onPick=${(d) => { if (isDeadline) set({ kind: 'day', date: d }); else onChange({ kind: 'day', date: d, time: cur && cur.time ? cur.time : null }); }} compact />
    <div class="when-foot">
      ${!isDeadline && cur && cur.kind === 'day' && html`<label class="when-time"><${Icon} name="clock" size=${15} />
        <input type="time" class="input sm" value=${cur.time || ''} onChange=${(e) => onChange({ ...cur, time: e.target.value || null })} /></label>`}
      ${onRepeat && html`<button type="button" class=${cx('btn btn-sm', repeat && 'btn-soft')} onClick=${() => { closePopover(); openRepeatEditor(repeat, cur && cur.date, onRepeat); }}>
        <${Icon} name="repeat" size=${15} /><span>${repeat ? D.describeRepeat(repeat) : 'Repeat…'}</span></button>`}
      <span class="grow"></span>
      ${cur && html`<button type="button" class="btn btn-sm" onClick=${() => set(null)}><${Icon} name="x" size=${14} /><span>Clear</span></button>`}
    </div>
  </div>`;
}

export function openWhenPicker(anchor, props) {
  openPopover(anchor, () => html`<${WhenPicker} ...${props} />`, { className: 'when-pop' });
}

/* ------------------------------------------------------------------ */
/* Repeat editor                                                        */
/* ------------------------------------------------------------------ */

function RepeatBody({ initial, anchor, onSave, close }) {
  const a = anchor || D.today();
  const [r, setR] = useState(() => initial ? { ...initial } : { freq: 'day', interval: 1, anchor: a });
  const upd = (p) => setR({ ...r, ...p });
  const preview = useMemo(() => {
    const rule = { ...r, anchor: r.anchor || a };
    const out = []; let d = D.occursOn(rule, D.today()) ? D.today() : D.nextOccurrence(rule, D.today());
    for (let i = 0; d && i < 5; i++) { out.push(d); d = D.nextOccurrence(rule, d); }
    return out;
  }, [r]);
  const days = r.days && r.days.length ? r.days : [D.dow(r.anchor || a)];
  const presets = [
    { label: 'Daily', r: { freq: 'day', interval: 1 } },
    { label: 'Weekdays', r: { freq: 'week', interval: 1, days: [1, 2, 3, 4, 5] } },
    { label: 'Weekly', r: { freq: 'week', interval: 1, days: [D.dow(a)] } },
    { label: 'Every 2 weeks', r: { freq: 'week', interval: 2, days: [D.dow(a)] } },
    { label: 'Monthly', r: { freq: 'month', interval: 1, monthDay: +a.slice(8) } },
    { label: 'Yearly', r: { freq: 'year', interval: 1 } },
  ];
  const unit = { day: 'day', week: 'week', month: 'month', year: 'year' }[r.freq];
  return html`<div class="dialog repeat-ed">
    <h3><${Icon} name="repeat" size=${18} /> Repeat</h3>
    <div class="pill-row">${presets.map((p) => html`<button type="button" class="pill" onClick=${() => setR({ ...p.r, anchor: r.anchor || a })}>${p.label}</button>`)}</div>
    <div class="repeat-row">
      <span>Every</span>
      <input type="number" min="1" max="99" class="input sm num" value=${r.interval || 1} onInput=${(e) => upd({ interval: Math.max(1, +e.target.value || 1) })} />
      <select class="input sm" value=${r.freq} onChange=${(e) => upd({ freq: e.target.value, days: e.target.value === 'week' ? days : undefined })}>
        ${['day', 'week', 'month', 'year'].map((f) => html`<option value=${f}>${f}${(r.interval || 1) > 1 ? 's' : ''}</option>`)}
      </select>
    </div>
    ${r.freq === 'week' && html`<div class="dow-row">${[0, 1, 2, 3, 4, 5, 6].map((i) => (i + S.settings.weekStart) % 7).map((d) => html`<button type="button"
      class=${cx('dow-b', days.includes(d) && 'on')} onClick=${() => { const set = new Set(days); set.has(d) ? set.delete(d) : set.add(d); if (set.size) upd({ days: [...set].sort() }); }}>${D.DOW_SHORT[d].slice(0, 2)}</button>`)}</div>`}
    ${r.freq === 'month' && html`<div class="repeat-row"><span>On day</span>
      <select class="input sm" value=${r.monthDay || +((r.anchor || a).slice(8))} onChange=${(e) => upd({ monthDay: +e.target.value })}>
        ${Array.from({ length: 31 }, (_, i) => html`<option value=${i + 1}>${D.ordinal(i + 1)}</option>`)}</select></div>`}
    <div class="repeat-row"><span>Starting</span><input type="date" class="input sm" value=${r.anchor || a} onChange=${(e) => e.target.value && upd({ anchor: e.target.value })} /></div>
    <div class="repeat-sum"><b>${D.describeRepeat({ ...r, anchor: r.anchor || a })}</b>
      <span class="muted">Next: ${preview.map((d) => D.fmtDate(d, { weekday: true })).join(' · ') || '—'}</span></div>
    <p class="muted small"><${Icon} name="flame" size=${13} /> Repeating tasks become habits with streak tracking. Each ${unit} you complete keeps the streak alive.</p>
    <div class="dialog-actions">
      ${initial && html`<${Btn} label="Remove repeat" kind="ghost-danger" onClick=${() => { onSave(null); close(); }} />`}
      <span class="grow"></span>
      <${Btn} label="Cancel" onClick=${close} />
      <${Btn} label="Save" kind="primary" onClick=${() => { onSave({ ...r, anchor: r.anchor || a }); close(); }} />
    </div>
  </div>`;
}
export function openRepeatEditor(initial, anchor, onSave) {
  openModal((close) => html`<${RepeatBody} initial=${initial} anchor=${anchor} onSave=${onSave} close=${close} />`, { width: 460 });
}

/* ------------------------------------------------------------------ */
/* Tag / folder / item pickers                                          */
/* ------------------------------------------------------------------ */

function ListPicker({ placeholder, items, selected = [], multi, onToggle, onCreate, createLabel, renderItem }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const ref = useRef();
  useEffect(() => { ref.current && ref.current.focus(); }, []);
  const list = (q ? items.map((x) => ({ x, s: fuzzy(q, x.label) })).filter((r) => r.s >= 0).sort((a, b) => b.s - a.s).map((r) => r.x) : items).slice(0, 50);
  const canCreate = onCreate && q.trim() && !items.some((i) => i.label.toLowerCase() === q.trim().toLowerCase());
  const total = list.length + (canCreate ? 1 : 0);
  const choose = (i) => { if (i < list.length) { onToggle(list[i]); if (!multi) closePopover(); } else if (canCreate) { onCreate(q.trim()); setQ(''); if (!multi) closePopover(); } };
  return html`<div class="picker">
    <input ref=${ref} class="input bare" placeholder=${placeholder} value=${q} onInput=${(e) => { setQ(e.target.value); setSel(0); }}
      onKeyDown=${(e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setSel((sel + 1) % Math.max(1, total)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((sel - 1 + total) % Math.max(1, total)); }
        else if (e.key === 'Enter') { e.preventDefault(); choose(sel); }
      }} />
    <div class="picker-list">
      ${list.map((it, i) => html`<button type="button" class=${cx('picker-i', i === sel && 'sel')} onMouseEnter=${() => setSel(i)} onClick=${() => choose(i)}>
        ${renderItem ? renderItem(it) : html`${it.color && html`<i class="dot" style=${`background:${it.color}`}></i>`}${it.icon && html`<${Icon} name=${it.icon} size=${15} />`}<span class="grow">${it.label}</span>`}
        ${multi && selected.includes(it.id) && html`<${Icon} name="check" size=${15} />`}
        ${!multi && selected.includes(it.id) && html`<${Icon} name="check" size=${15} />`}
      </button>`)}
      ${canCreate && html`<button type="button" class=${cx('picker-i', sel === list.length && 'sel')} onClick=${() => choose(list.length)}>
        <${Icon} name="plus" size=${15} /><span class="grow">${createLabel || 'Create'} “${q.trim()}”</span></button>`}
      ${!total && html`<div class="picker-empty">Nothing found</div>`}
    </div>
  </div>`;
}

export function openTagPicker(anchor, selectedIds, onChange) {
  let current = [...(selectedIds || [])];
  const render = () => html`<${ListPicker} placeholder="Find or create a tag…" multi selected=${current}
    items=${tags().map((t) => ({ id: t.id, label: t.name, color: t.color }))}
    onToggle=${(it) => { current = current.includes(it.id) ? current.filter((x) => x !== it.id) : [...current, it.id]; onChange(current); }}
    onCreate=${(name) => { const t = create('tag', { name }); current = [...current, t.id]; onChange(current); }} createLabel="Create tag" />`;
  openPopover(anchor, render, { className: 'picker-pop' });
}

export function openFolderPicker(anchor, selectedId, onChange) {
  openPopover(anchor, () => html`<${ListPicker} placeholder="Move to folder…" selected=${[selectedId]}
    items=${[{ id: null, label: 'No folder', icon: 'x' }, ...folders().map((f) => ({ id: f.id, label: f.name, color: f.color, icon: 'folder' }))]}
    onToggle=${(it) => onChange(it.id)} onCreate=${(name) => { const f = create('folder', { name }); onChange(f.id); }} createLabel="Create folder" />`, { className: 'picker-pop' });
}

export function openItemPicker(anchor, { types = ['task', 'note', 'event'], exclude = [], onPick }) {
  const pool = [
    ...(types.includes('task') ? tasks() : []),
    ...(types.includes('note') ? notes() : []),
    ...(types.includes('event') ? allEvents().filter((e) => e.source !== 'google') : []),
  ].filter((i) => !exclude.includes(i.id));
  const icon = { task: 'tasks', note: 'notes', event: 'calendar' };
  openPopover(anchor, () => html`<${ListPicker} placeholder="Link a task, note or event…"
    items=${pool.sort((a, b) => b.updatedAt - a.updatedAt).map((i) => ({ id: i.id, label: titleOf(i), icon: icon[i.type] }))}
    onToggle=${(it) => onPick(alive(it.id))} />`, { className: 'picker-pop' });
}

/* ------------------------------------------------------------------ */
/* Icon + colour pickers                                                */
/* ------------------------------------------------------------------ */

const EMOJI = ('📝 📌 📎 📚 📖 🗂️ 📁 🗃️ 📅 🗓️ ⏰ ✅ ☑️ 🎯 🚀 💡 🔥 ⭐ ✨ 🌱 🌿 🌸 🌻 🍓 🍇 🍊 🍋 🫐 🍯 ☕ 🍵 🥗 🏃 🧘 💪 🚲 🏊 🎧 🎵 🎨 🎬 📷 ✈️ 🏖️ 🏔️ 🏠 🛒 💼 💰 💳 📈 📊 🧾 🛠️ ⚙️ 💻 📱 🧠 ❤️ 💜 💙 💚 🧡 💛 🤝 👋 🎉 🎁 🐶 🐱 🦊 🐝 🌙 ☀️ 🌈 ⚡ 🔒 🔑 📣 ✉️ 🧪 🎓 ✏️').split(' ');

export function openIconPicker(anchor, onPick) {
  openPopover(anchor, () => html`<div class="icon-pick">
    <div class="emoji-grid">${EMOJI.map((e) => html`<button type="button" class="emoji-b" onClick=${() => { onPick({ type: 'emoji', value: e }); closePopover(); }}>${e}</button>`)}</div>
    <div class="icon-pick-foot">
      <button type="button" class="btn btn-sm" onClick=${async () => {
        closePopover();
        const [f] = await pickFiles({ accept: 'image/*' });
        if (!f) return;
        try { const meta = await storeFile(f); onPick({ type: 'image', fileId: meta.id }); } catch (e) { toast(e.message, { kind: 'error' }); }
      }}><${Icon} name="upload" size=${14} /><span>Upload icon</span></button>
      <button type="button" class="btn btn-sm" onClick=${() => { onPick(null); closePopover(); }}><${Icon} name="x" size=${14} /><span>Remove</span></button>
    </div>
  </div>`, { className: 'icon-pop' });
}

export function ColorSwatches({ value, onChange }) {
  return html`<div class="swatches">${COLORS.map((c) => html`<button type="button" class=${cx('swatch', c === value && 'on')} style=${`background:${c}`} aria-label=${'Colour ' + c} onClick=${() => onChange(c)}></button>`)}</div>`;
}

/* ------------------------------------------------------------------ */
/* Layout bits                                                          */
/* ------------------------------------------------------------------ */

export function ViewHeader({ icon, iconColor, title, subtitle, children, onTitleClick }) {
  return html`<header class="vh">
    <button type="button" class="btn btn-icon vh-menu" aria-label="Open sidebar" onClick=${() => setUI({ sidebarOpen: true })}><${Icon} name="menu" size=${18} /></button>
    <div class="vh-t" onClick=${onTitleClick}>
      ${icon && html`<span class="vh-ic" style=${iconColor ? `color:${iconColor}` : ''}>${typeof icon === 'string' ? html`<${Icon} name=${icon} size=${22} />` : icon}</span>`}
      <div><h1>${title}</h1>${subtitle && html`<div class="vh-sub">${subtitle}</div>`}</div>
    </div>
    <div class="vh-actions">${children}
      <button type="button" class=${cx('btn btn-icon panel-toggle', S.ui.panel && 'on')} title=${'Quick panel (' + shortcutLabel(S.settings.shortcuts.panel) + ')'}
        aria-label="Toggle quick panel" onClick=${() => setUI({ panel: !S.ui.panel, panelFromEdge: false })}><${Icon} name="panel" size=${18} /></button>
    </div>
  </header>`;
}

export function Section({ title, count, children, collapsible = false, defaultOpen = true, actions, id, tone }) {
  const key = id ? 'jd.sec.' + id : null;
  const [open, setOpen] = useState(() => {
    if (!key) return defaultOpen;
    try { const v = localStorage.getItem(key); return v == null ? defaultOpen : v === '1'; } catch { return defaultOpen; }
  });
  const toggle = () => { const v = !open; setOpen(v); if (key) try { localStorage.setItem(key, v ? '1' : '0'); } catch { /* ignore */ } };
  return html`<section class=${cx('sec', tone && 'sec-' + tone)}>
    <div class="sec-h">
      ${collapsible ? html`<button type="button" class="sec-tog" onClick=${toggle} aria-expanded=${open}><${Icon} name=${open ? 'chevD' : 'chevR'} size=${14} /><span>${title}</span>${count != null && html`<span class="count">${count}</span>`}</button>`
        : html`<h2>${title}${count != null && html`<span class="count">${count}</span>`}</h2>`}
      <span class="grow"></span>${actions}
    </div>
    ${(!collapsible || open) && children}
  </section>`;
}
