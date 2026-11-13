// Calendar: day, 2/3/4-day, week and month views; event detail; events list.
import { html, useState, useRef, useEffect, useLayoutEffect, cx } from '../lib.js';
import {
  S, emit, setSetting, allEvents, eventDays, eventColor, tasks, taskDate, isDone, update, create, openItem, trash,
  undoable, titleOf, openPopover, closePopover, toggleTask, closeDetail, eventsOn, toggleHabitDay, liveTags, folderOf, navigate,
} from '../store.js';
import * as D from '../dates.js';
import { Icon } from './icons.js';
import { Btn, Segmented, ViewHeader, Switch, openMenu, openContextMenu, ColorSwatches, Empty, Chip } from './common.js';
import { TaskCheck, AutoTitle, Prop, RelatedList, TagsField, FolderField, registerMonthGrid } from './tasks.js';
import { BlockEditor } from './editor.js';
import { Attachments } from './attachments.js';
import { createEventFromText } from '../tokens.js';
import * as G from '../google.js';

const VIEWS = [
  { v: 'day', label: 'Day', n: 1 }, { v: '2d', label: '2D', n: 2, title: '2 days' }, { v: '3d', label: '3D', n: 3, title: '3 days' },
  { v: '4d', label: '4D', n: 4, title: '4 days' }, { v: 'week', label: 'Week', n: 7 }, { v: 'month', label: 'Month' },
];
const HOUR = 48;
const tf = () => S.settings.timeFormat;

function rangeTitle(days) {
  const a = D.pd(days[0]), b = D.pd(days[days.length - 1]);
  if (days.length === 1) return D.fmtDate(days[0], { weekday: true, long: true, year: true });
  if (a.getMonth() === b.getMonth()) return `${D.MON_LONG[a.getMonth()]} ${a.getDate()} – ${b.getDate()}, ${b.getFullYear()}`;
  return `${D.MON_SHORT[a.getMonth()]} ${a.getDate()} – ${D.MON_SHORT[b.getMonth()]} ${b.getDate()}, ${b.getFullYear()}`;
}

export function visibleDays(view, anchor) {
  if (view === 'week') { const s = D.startOfWeek(anchor, S.settings.weekStart); return Array.from({ length: 7 }, (_, i) => D.addDays(s, i)); }
  const n = (VIEWS.find((x) => x.v === view) || { n: 1 }).n;
  return Array.from({ length: n }, (_, i) => D.addDays(anchor, i));
}

export function CalendarView() {
  const ui = S.ui.calendar;
  const view = ui.view || S.settings.calendarView || 'week';
  const anchor = ui.anchor || D.today();
  const setAnchor = (a) => { S.ui.calendar = { ...S.ui.calendar, anchor: a }; emit(); };
  const setView = (v) => { S.ui.calendar = { ...S.ui.calendar, view: v }; setSetting('calendarView', v); };
  const step = (dir) => {
    if (view === 'month') setAnchor(D.addMonths(D.startOfMonth(anchor), dir));
    else if (view === 'week') setAnchor(D.addDays(anchor, 7 * dir));
    else setAnchor(D.addDays(anchor, (VIEWS.find((x) => x.v === view).n) * dir));
  };
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest('input, textarea, [contenteditable="true"]') || e.ctrlKey || e.metaKey || e.altKey || S.overlay.modals.length || S.ui.launcher) return;
      if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'd') setView('day');
      else if (e.key === 'w') setView('week');
      else if (e.key === 'm') setView('month');
      else if (e.key >= '2' && e.key <= '4') setView(e.key + 'd');
      else if (e.key === '.') setAnchor(D.today());
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });
  const days = view === 'month' ? null : visibleDays(view, anchor);
  const title = view === 'month' ? D.monthTitle(anchor) : rangeTitle(days);
  return html`<div class="view cal-view">
    <${ViewHeader} icon="calendar" iconColor="var(--accent)" title=${title}>
      ${S.google.connected && html`<${Btn} icon="refresh" title="Refresh Google Calendar" class=${S.google.busy ? 'spin' : ''} onClick=${() => G.refreshEvents(true)} />`}
      <${Btn} label="Today" onClick=${() => setAnchor(D.today())} />
      <div class="btn-pair"><${Btn} icon="chevL" title="Previous (←)" onClick=${() => step(-1)} /><${Btn} icon="chevR" title="Next (→)" onClick=${() => step(1)} /></div>
      <${Segmented} value=${view} onChange=${setView} options=${VIEWS.map((v) => ({ v: v.v, label: v.label, title: v.title || v.label }))} />
      <${Btn} icon="plus" label="Event" kind="primary" onClick=${(e) => openQuickEvent(e.currentTarget, { date: view === 'month' ? D.today() : days[0] === D.today() || !days.includes(D.today()) ? days[0] : D.today() })} />
    <//>
    ${S.google.error && html`<div class="banner warn"><${Icon} name="info" size=${15} /> Google Calendar: ${S.google.error}</div>`}
    <div class="cal-body">
      ${view === 'month' ? html`<${MonthGrid} anchor=${anchor} onAnchor=${setAnchor} onOpenDay=${(d) => { S.ui.calendar = { ...S.ui.calendar, anchor: d }; setView('day'); }} />`
        : html`<${TimeGrid} days=${days} onOpenDay=${(d) => { S.ui.calendar = { ...S.ui.calendar, anchor: d }; setView('day'); }} />`}
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Helpers shared by grids                                              */
/* ------------------------------------------------------------------ */

function habitsOn(d) {
  return tasks().filter((t) => t.repeat && !isDone(t) && D.occursOn(t.repeat, d) && d <= D.addDays(D.today(), 60));
}
function tasksOn(d, list) {
  return (list || tasks()).filter((t) => !t.repeat && !t.parentId && (taskDate(t) === d || (t.deadline === d && taskDate(t) !== d)));
}

function HabitChip({ t, d }) {
  const done = (t.completions || []).includes(d);
  return html`<button type="button" class=${cx('cal-habit', done && 'done')} title=${`${t.title} — ${D.describeRepeat(t.repeat)}${done ? ' (done)' : ''}`}
    onClick=${(e) => { e.stopPropagation(); if (d <= D.today()) toggleHabitDay(t.id, d); else openItem(t.id); }}>
    <${Icon} name="flame" size=${12} /><span class="ellipsis">${t.title}</span></button>`;
}

function TaskChip({ t, d }) {
  const isDeadline = t.deadline === d && taskDate(t) !== d;
  return html`<div class=${cx('cal-task', isDone(t) && 'done')} draggable="true"
      onDragStart=${(e) => { e.stopPropagation(); e.dataTransfer.setData('jamday/task', t.id); }}
      onClick=${(e) => { e.stopPropagation(); openItem(t.id); }} onContextMenu=${(e) => openContextMenu(e, [{ label: 'Open', icon: 'arrowR', onClick: () => openItem(t.id) }, { label: isDone(t) ? 'Mark not done' : 'Complete', icon: 'check', onClick: () => toggleTask(t.id) }])}>
    <${TaskCheck} t=${t} size=${14} /><span class="ellipsis">${isDeadline ? '⚑ ' : ''}${t.when && t.when.time && taskDate(t) === d ? D.fmtTime(t.when.time, tf()) + ' ' : ''}${t.title || 'Untitled'}</span>
  </div>`;
}

function EventPill({ e, d }) {
  const startsHere = e.start.slice(0, 10) === d;
  return html`<button type="button" class=${cx('cal-ev', e.allDay ? 'allday' : 'timed', e.source === 'google' && 'g')} style=${`--c:${eventColor(e)}`}
      draggable=${e.source !== 'google'} onDragStart=${(ev) => { ev.stopPropagation(); ev.dataTransfer.setData('jamday/event', e.id); ev.dataTransfer.setData('jamday/from', d); }}
      onClick=${(ev) => { ev.stopPropagation(); openItem(e.id); }} title=${e.title}>
    ${!e.allDay && startsHere && html`<span class="cal-ev-t">${D.fmtTime(e.start.slice(11), tf())}</span>`}<span class="ellipsis">${e.title || 'Untitled event'}</span>
  </button>`;
}

function moveEventToDay(id, from, to) {
  const e = allEvents().find((x) => x.id === id);
  if (!e || e.source === 'google') return;
  const delta = D.diffDays(from, to);
  if (!delta) return;
  const shift = (s) => D.addDays(s.slice(0, 10), delta) + s.slice(10);
  update(id, { start: shift(e.start), end: shift(e.end) });
}

function dropHandlers(d, { onTask, onEvent } = {}) {
  return {
    onDragOver: (e) => { const t = [...e.dataTransfer.types]; if (t.includes('jamday/task') || t.includes('jamday/event')) { e.preventDefault(); e.currentTarget.classList.add('drop'); } },
    onDragLeave: (e) => e.currentTarget.classList.remove('drop'),
    onDrop: (e) => {
      e.currentTarget.classList.remove('drop');
      const tid = e.dataTransfer.getData('jamday/task');
      const eid = e.dataTransfer.getData('jamday/event');
      if (tid) { e.preventDefault(); const t = tasks().find((x) => x.id === tid); if (t) (onTask ? onTask(t) : update(tid, { when: { kind: 'day', date: d, time: t.when && t.when.time ? t.when.time : null } })); }
      else if (eid) { e.preventDefault(); onEvent ? onEvent(eid) : moveEventToDay(eid, e.dataTransfer.getData('jamday/from'), d); }
    },
  };
}

/* ------------------------------------------------------------------ */
/* Time grid                                                            */
/* ------------------------------------------------------------------ */

function layoutDay(segs) {
  segs.sort((a, b) => a.s - b.s || b.e - a.e);
  const out = []; let cluster = []; let clusterEnd = -1;
  const flush = () => {
    const cols = [];
    for (const s of cluster) {
      let c = cols.findIndex((end) => end <= s.s);
      if (c < 0) { c = cols.length; cols.push(0); }
      cols[c] = s.e; s.col = c;
    }
    cluster.forEach((s) => { s.cols = cols.length; out.push(s); });
    cluster = [];
  };
  for (const s of segs) {
    if (cluster.length && s.s >= clusterEnd) { flush(); clusterEnd = -1; }
    cluster.push(s); clusterEnd = Math.max(clusterEnd, s.e);
  }
  if (cluster.length) flush();
  return out;
}

function TimeGrid({ days, onOpenDay }) {
  const scroller = useRef();
  const gridRef = useRef();
  const [drag, setDrag] = useState(null); // {mode:'create'|'move'|'resize', ...}
  const [now, setNow] = useState(new Date());
  const today = D.today();
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(t); }, []);
  useLayoutEffect(() => {
    const el = scroller.current; if (!el) return;
    const h = days.includes(today) ? Math.max(0, now.getHours() - 2) : S.settings.dayStartHour;
    el.scrollTop = h * HOUR;
  }, [days[0], days.length]);

  const evs = allEvents();
  const segsFor = (d) => {
    const dayStart = d + 'T00:00', dayEnd = D.addDays(d, 1) + 'T00:00';
    return layoutDay(evs.filter((ev) => !ev.allDay && ev.start < dayEnd && ev.end > dayStart).map((ev) => {
      const s = ev.start < dayStart ? 0 : D.minutesOf(ev.start.slice(11));
      const en = ev.end >= dayEnd ? 1440 : D.minutesOf(ev.end.slice(11));
      return { ev, s, e: Math.max(en, s + 15) };
    }));
  };

  const minutesAt = (clientY) => {
    const r = gridRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(1440, Math.round(((clientY - r.top) / HOUR) * 60 / 15) * 15));
  };
  const dayAt = (clientX, clientY) => {
    const el = document.elementsFromPoint(clientX, clientY).find((x) => x.dataset && x.dataset.date);
    return el ? el.dataset.date : null;
  };

  const startCreate = (e, d) => {
    if (e.button !== 0 || e.target.closest('.tg-ev, .tg-task')) return;
    const m = minutesAt(e.clientY);
    const start = Math.floor(m / 30) * 30;
    const st = { mode: 'create', day: d, a: start, b: start + 60, moved: false, x: e.clientX, y: e.clientY };
    setDrag(st);
    const move = (ev) => {
      const mm = minutesAt(ev.clientY);
      const moved = st.moved || Math.abs(ev.clientY - st.y) > 6;
      st.moved = moved;
      if (moved) { st.b = Math.max(st.a + 15, mm); if (mm < st.a) { st.b = st.a + 15; } }
      setDrag({ ...st });
    };
    const up = (ev) => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      const a = st.a, b = st.moved ? st.b : st.a + 60;
      const rect = { left: ev.clientX, right: ev.clientX, top: ev.clientY, bottom: ev.clientY, width: 0, height: 0 };
      openQuickEvent(rect, { date: d, start: D.fromMinutes(a), end: b >= 1440 ? '23:59' : D.fromMinutes(b), onClose: () => setDrag(null) });
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };

  const startMove = (e, ev, d, mode) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    if (ev.source === 'google') { const up = () => { removeEventListener('pointerup', up); openItem(ev.id); }; addEventListener('pointerup', up); return; }
    const m0 = minutesAt(e.clientY);
    const st = { mode, id: ev.id, day0: d, m0, moved: false, x: e.clientX, y: e.clientY, start: ev.start, end: ev.end, curStart: ev.start, curEnd: ev.end };
    const move = (pe) => {
      if (!st.moved && Math.abs(pe.clientY - st.y) + Math.abs(pe.clientX - st.x) < 5) return;
      st.moved = true;
      const dm = minutesAt(pe.clientY) - st.m0;
      if (mode === 'move') {
        const d2 = dayAt(pe.clientX, pe.clientY) || st.day0;
        const dd = D.diffDays(st.day0, d2);
        const ns = D.addMinutesDT(st.start, dm + dd * 1440);
        const ne = D.addMinutesDT(st.end, dm + dd * 1440);
        st.curStart = ns; st.curEnd = ne;
      } else {
        const ne = D.addMinutesDT(st.end, dm);
        st.curEnd = ne > D.addMinutesDT(st.start, 15) ? ne : D.addMinutesDT(st.start, 15);
      }
      setDrag({ ...st });
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      setDrag(null);
      if (!st.moved) { openItem(ev.id); return; }
      update(ev.id, { start: st.curStart, end: st.curEnd });
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const gridCols = `56px repeat(${days.length}, minmax(0, 1fr))`;
  return html`<div class="tg" style=${`--hour:${HOUR}px`}>
    <div class="tg-head" style=${`grid-template-columns:${gridCols}`}>
      <div class="tg-gutter small muted">${Intl.DateTimeFormat().resolvedOptions().timeZone.split('/').pop().replace(/_/g, ' ')}</div>
      ${days.map((d) => html`<button type="button" class=${cx('tg-dh', d === today && 'today', D.dow(d) % 6 === 0 && 'wkend')} onClick=${() => onOpenDay(d)}>
        <span>${D.DOW_SHORT[D.dow(d)]}</span><b>${+d.slice(8)}</b></button>`)}
    </div>
    <div class="tg-allday" style=${`grid-template-columns:${gridCols}`}>
      <div class="tg-gutter small muted">all-day</div>
      ${days.map((d) => {
        const ad = evs.filter((e) => e.allDay && eventDays(e).includes(d));
        return html`<div class="tg-adcell" data-date=${d} ...${dropHandlers(d)}
            onDblClick=${(e) => { if (e.target === e.currentTarget) openQuickEvent(e.currentTarget, { date: d, allDay: true }); }}>
          ${ad.map((e) => html`<${EventPill} e=${e} d=${d} key=${e.id} />`)}
          ${habitsOn(d).map((t) => html`<${HabitChip} t=${t} d=${d} key=${'h' + t.id} />`)}
          ${tasksOn(d).filter((t) => !(t.when && t.when.time && taskDate(t) === d)).map((t) => html`<${TaskChip} t=${t} d=${d} key=${t.id} />`)}
        </div>`;
      })}
    </div>
    <div class="tg-scroll" ref=${scroller}>
      <div class="tg-grid" ref=${gridRef} style=${`grid-template-columns:${gridCols};height:${24 * HOUR}px`}>
        <div class="tg-hours">${hours.map((h) => html`<span style=${`top:${h * HOUR}px`}>${h ? D.fmtTime(D.pad(h) + ':00', tf()) : ''}</span>`)}</div>
        ${days.map((d) => {
          const segs = segsFor(d);
          const timedTasks = tasks().filter((t) => !t.repeat && taskDate(t) === d && t.when.time && !t.parentId);
          return html`<div class=${cx('tg-col', d === today && 'today', D.dow(d) % 6 === 0 && 'wkend')} data-date=${d} onPointerDown=${(e) => startCreate(e, d)}
              ...${dropHandlers(d, { onTask: (t) => update(t.id, { when: { kind: 'day', date: d, time: t.when && t.when.time } }) })}>
            ${segs.map((s) => {
              const ev = s.ev;
              const dragging = drag && drag.id === ev.id && drag.moved;
              let top = s.s, bottom = s.e;
              if (dragging) {
                const cs = drag.curStart, ce = drag.curEnd;
                if (cs.slice(0, 10) !== d && !(cs.slice(0, 10) < d && ce.slice(0, 10) >= d)) return null;
                top = cs.slice(0, 10) === d ? D.minutesOf(cs.slice(11)) : 0;
                bottom = ce.slice(0, 10) === d ? D.minutesOf(ce.slice(11)) : 1440;
              }
              const h = Math.max(18, ((bottom - top) / 60) * HOUR - 2);
              const short = h < 36;
              return html`<div key=${ev.id} class=${cx('tg-ev', ev.source === 'google' && 'g', dragging && 'dragging', short && 'short')}
                  style=${`--c:${eventColor(ev)};top:${(top / 60) * HOUR}px;height:${h}px;left:calc(${(s.col / s.cols) * 100}% + 2px);width:calc(${100 / s.cols}% - 4px)`}
                  onPointerDown=${(e) => startMove(e, ev, d, 'move')} title=${ev.title}>
                <b class="ellipsis">${ev.title || 'Untitled event'}</b>
                ${!short && html`<span class="tg-ev-time">${D.fmtTime((dragging ? drag.curStart : ev.start).slice(11), tf())} – ${D.fmtTime((dragging ? drag.curEnd : ev.end).slice(11), tf())}</span>`}
                ${h >= 62 && ev.location && html`<span class="tg-ev-loc ellipsis">${ev.location}</span>`}
                ${ev.url && h >= 62 && html`<a class="tg-join" href=${ev.url} target="_blank" rel="noopener" onPointerDown=${(e) => e.stopPropagation()}><${Icon} name="video" size=${12} />Join</a>`}
                ${ev.source !== 'google' && html`<span class="tg-resize" onPointerDown=${(e) => startMove(e, ev, d, 'resize')}></span>`}
              </div>`;
            })}
            ${timedTasks.map((t) => html`<div key=${t.id} class=${cx('tg-task', isDone(t) && 'done')} style=${`top:${(D.minutesOf(t.when.time) / 60) * HOUR}px`}
                onPointerDown=${(e) => e.stopPropagation()} onClick=${() => openItem(t.id)}>
              <${TaskCheck} t=${t} size=${14} /><span class="ellipsis">${D.fmtTime(t.when.time, tf())} ${t.title}</span></div>`)}
            ${drag && drag.mode === 'create' && drag.day === d && html`<div class="tg-ev ghost" style=${`top:${(drag.a / 60) * HOUR}px;height:${((drag.b - drag.a) / 60) * HOUR - 2}px`}>
              <b>New event</b><span class="tg-ev-time">${D.fmtTime(D.fromMinutes(drag.a), tf())} – ${D.fmtTime(D.fromMinutes(Math.min(drag.b, 1439)), tf())}</span></div>`}
            ${d === today && html`<div class="tg-now" style=${`top:${(nowMin / 60) * HOUR}px`}><i></i></div>`}
          </div>`;
        })}
      </div>
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Month grid                                                           */
/* ------------------------------------------------------------------ */

export function MonthGrid({ anchor: anchorProp, onAnchor, onOpenDay, tasksOnly = false, taskList }) {
  const [own, setOwn] = useState(D.today());
  const anchor = anchorProp || own;
  const setAnchor = onAnchor || setOwn;
  const month = D.startOfMonth(anchor);
  const start = D.startOfWeek(month, S.settings.weekStart);
  const days = Array.from({ length: 42 }, (_, i) => D.addDays(start, i));
  const today = D.today();
  const evs = tasksOnly ? [] : allEvents();
  const heads = Array.from({ length: 7 }, (_, i) => D.DOW_SHORT[(i + S.settings.weekStart) % 7]);
  const MAX = 4;
  return html`<div class="month">
    ${tasksOnly && html`<div class="month-nav"><b>${D.monthTitle(month)}</b><span class="grow"></span>
      <${Btn} label="Today" size="sm" onClick=${() => setAnchor(today)} />
      <${Btn} icon="chevL" size="sm" title="Previous month" onClick=${() => setAnchor(D.addMonths(month, -1))} />
      <${Btn} icon="chevR" size="sm" title="Next month" onClick=${() => setAnchor(D.addMonths(month, 1))} /></div>`}
    <div class="month-h">${heads.map((h) => html`<span>${h}</span>`)}</div>
    <div class="month-g">${days.map((d) => {
      const dayEvs = evs.filter((e) => eventDays(e).includes(d)).sort((a, b) => (a.allDay === b.allDay ? (a.start < b.start ? -1 : 1) : a.allDay ? -1 : 1));
      const dayTasks = tasksOn(d, taskList).filter((t) => S.settings.showCompleted || !isDone(t));
      const hab = tasksOnly ? [] : habitsOn(d);
      const items = [...dayEvs.map((e) => ({ k: 'e', e })), ...hab.map((t) => ({ k: 'h', t })), ...dayTasks.map((t) => ({ k: 't', t }))];
      const shown = items.slice(0, MAX);
      const more = items.length - shown.length;
      return html`<div class=${cx('mcell', d.slice(0, 7) !== month.slice(0, 7) && 'out', d === today && 'today', D.dow(d) % 6 === 0 && 'wkend')} data-date=${d}
          ...${dropHandlers(d)} onClick=${(e) => { if (!tasksOnly && (e.target === e.currentTarget || e.target.classList.contains('mcell-items'))) openQuickEvent(e.currentTarget, { date: d, allDay: true }); }}>
        <button type="button" class="mcell-d" onClick=${(e) => { e.stopPropagation(); onOpenDay ? onOpenDay(d) : null; }}>${+d.slice(8) === 1 ? D.MON_SHORT[D.pd(d).getMonth()] + ' 1' : +d.slice(8)}</button>
        <div class="mcell-items">
          ${shown.map((it) => it.k === 'e' ? html`<${EventPill} e=${it.e} d=${d} key=${it.e.id} />` : it.k === 'h' ? html`<${HabitChip} t=${it.t} d=${d} key=${'h' + it.t.id} />` : html`<${TaskChip} t=${it.t} d=${d} key=${it.t.id} />`)}
          ${more > 0 && html`<button type="button" class="mcell-more" onClick=${(e) => { e.stopPropagation(); openPopover(e.currentTarget, () => html`<div class="day-pop"><b>${D.fmtDate(d, { weekday: true, long: true })}</b>
            ${items.map((it) => it.k === 'e' ? html`<${EventPill} e=${it.e} d=${d} />` : it.k === 'h' ? html`<${HabitChip} t=${it.t} d=${d} />` : html`<${TaskChip} t=${it.t} d=${d} />`)}</div>`); }}>+${more} more</button>`}
        </div>
      </div>`;
    })}</div>
  </div>`;
}
registerMonthGrid(MonthGrid);

/* ------------------------------------------------------------------ */
/* Quick event popover                                                  */
/* ------------------------------------------------------------------ */

function QuickEvent({ date, start, end, allDay }) {
  const [title, setTitle] = useState('');
  const [isAll, setAll] = useState(!!allDay || !start);
  const [s, setS] = useState(start || D.hhmm(D.nowRounded(30)));
  const [e, setE] = useState(end || D.fromMinutes(Math.min(1439, D.minutesOf(start || D.hhmm(D.nowRounded(30))) + 60)));
  const [d, setD] = useState(date);
  const ref = useRef();
  useEffect(() => { ref.current && ref.current.focus(); }, []);
  const save = (open = false) => {
    let ev;
    if (title.trim() && !start && !allDay) ev = createEventFromText(title);
    if (!ev) {
      const data = { title: title.trim() || 'New event', allDay: isAll };
      if (isAll) { data.start = d + 'T00:00'; data.end = d + 'T00:00'; }
      else { data.start = d + 'T' + s; data.end = (e > s ? d : D.addDays(d, 1)) + 'T' + e; }
      ev = create('event', data);
    }
    closePopover();
    if (open) openItem(ev.id);
  };
  return html`<form class="qev" onSubmit=${(ev) => { ev.preventDefault(); save(); }}>
    <input ref=${ref} class="input" placeholder=${start || allDay ? 'Event title' : 'e.g. “Lunch with Ana tomorrow 12–1pm”'} value=${title} onInput=${(ev) => setTitle(ev.target.value)} />
    <div class="qev-row">
      <input type="date" class="input sm" value=${d} onChange=${(ev) => ev.target.value && setD(ev.target.value)} />
      ${!isAll && html`<input type="time" class="input sm" value=${s} onChange=${(ev) => setS(ev.target.value)} /><span>–</span><input type="time" class="input sm" value=${e} onChange=${(ev) => setE(ev.target.value)} />`}
    </div>
    <label class="check-l"><input type="checkbox" checked=${isAll} onChange=${(ev) => setAll(ev.target.checked)} /> All day</label>
    <div class="dialog-actions">
      <button type="button" class="btn btn-sm" onClick=${() => save(true)}>More options</button>
      <button type="submit" class="btn btn-sm btn-primary">Save</button>
    </div>
  </form>`;
}

export function openQuickEvent(anchor, props) {
  const { onClose, ...rest } = props;
  openPopover(anchor, () => html`<${QuickEvent} ...${rest} />`, { className: 'qev-pop', onClose });
}

/* ------------------------------------------------------------------ */
/* Event detail                                                         */
/* ------------------------------------------------------------------ */

const REMINDERS = [{ v: null, l: 'None' }, { v: 0, l: 'At start' }, { v: 5, l: '5 minutes before' }, { v: 10, l: '10 minutes before' }, { v: 15, l: '15 minutes before' }, { v: 30, l: '30 minutes before' }, { v: 60, l: '1 hour before' }, { v: 1440, l: '1 day before' }];

export function EventDetail({ e }) {
  if (e.source === 'google') return html`<${GoogleEventDetail} e=${e} />`;
  const set = (p) => update(e.id, p);
  const sd = e.start.slice(0, 10), st = e.start.slice(11, 16), ed = e.end.slice(0, 10), et = e.end.slice(11, 16);
  const setStart = (date, time) => {
    const ns = date + 'T' + (time || st || '09:00');
    const dur = D.parseDT(e.end) - D.parseDT(e.start);
    const ne = D.dtStr(new Date(D.parseDT(ns).getTime() + Math.max(0, dur)));
    set({ start: ns, end: ne });
  };
  const google = S.google.connected;
  return html`<div class="detail" key=${e.id}>
    <div class="detail-top"><span class="detail-kind"><${Icon} name="calendar" size=${14} />Event</span><span class="grow"></span>
      <${Btn} icon="more" title="More" onClick=${(ev) => openMenu(ev.currentTarget, [
        { label: 'Duplicate', icon: 'copy', onClick: () => { const c = create('event', { ...e, id: undefined, googleId: null, title: e.title + ' (copy)' }); openItem(c.id); } },
        { label: 'Delete', icon: 'trash', danger: true, onClick: () => undoable(`Deleted “${titleOf(e)}”`, [e.id], () => trash(e.id)) },
      ], { align: 'right' })} />
      <${Btn} icon="x" title="Close (Esc)" onClick=${closeDetail} /></div>
    <div class="detail-title"><span class="ev-dot" style=${`background:${eventColor(e)}`}></span>
      <${AutoTitle} value=${e.title} placeholder="Event title" onInput=${(v) => set({ title: v })} /></div>
    <div class="props">
      <${Prop} icon="sun" label="All day"><input type="checkbox" class="switch" checked=${e.allDay} onChange=${(ev) => set(ev.target.checked ? { allDay: true, start: sd + 'T00:00', end: (ed < sd ? sd : ed) + 'T00:00' } : { allDay: false, start: sd + 'T09:00', end: sd + 'T10:00' })} /><//>
      <${Prop} icon="clock" label="Starts">
        <input type="date" class="input sm" value=${sd} onChange=${(ev) => ev.target.value && setStart(ev.target.value, st)} />
        ${!e.allDay && html`<input type="time" class="input sm" value=${st} onChange=${(ev) => ev.target.value && setStart(sd, ev.target.value)} />`}
      <//>
      <${Prop} icon="clock" label="Ends">
        <input type="date" class="input sm" value=${ed} min=${sd} onChange=${(ev) => ev.target.value && set({ end: ev.target.value + 'T' + (e.allDay ? '00:00' : et) })} />
        ${!e.allDay && html`<input type="time" class="input sm" value=${et} onChange=${(ev) => ev.target.value && set({ end: ed + 'T' + ev.target.value })} />`}
      <//>
      <${Prop} icon="mappin" label="Location">
        <input class="input sm grow" value=${e.location} placeholder="Add location" onInput=${(ev) => set({ location: ev.target.value })} />
        ${e.location && html`<a class="btn btn-icon btn-sm" title="Open map" target="_blank" rel="noopener" href=${'https://www.google.com/maps/search/' + encodeURIComponent(e.location)}><${Icon} name="external" size=${14} /></a>`}
      <//>
      <${Prop} icon="video" label="Meeting">
        <input class="input sm grow" value=${e.url} placeholder="Paste a Meet / Zoom / Teams link" onInput=${(ev) => set({ url: ev.target.value })} />
        ${e.url && html`<a class="btn btn-sm btn-primary" href=${e.url} target="_blank" rel="noopener"><${Icon} name="video" size=${14} />Join</a>`}
      <//>
      ${google && html`<${Prop} icon="cloud" label="Google">
        <div class="col-gap">
          <label class="check-l"><input type="checkbox" checked=${e.syncGoogle || !!e.googleId} disabled=${!S.settings.google.twoWay}
            onChange=${(ev) => set({ syncGoogle: ev.target.checked })} /> Sync to Google Calendar ${!S.settings.google.twoWay && html`<span class="muted small">(turn on two-way sync in Settings)</span>`}</label>
          ${S.settings.google.twoWay && !e.url && html`<button type="button" class="btn btn-sm" onClick=${() => set({ syncGoogle: true, meet: true })}><${Icon} name="video" size=${14} />Add Google Meet link</button>`}
          ${e.googleId && html`<span class="muted small">Synced${e.googleSyncedAt ? ' ' + new Date(e.googleSyncedAt).toLocaleTimeString() : ''}</span>`}
        </div>
      <//>`}
      <${Prop} icon="bell" label="Reminder">
        <select class="input sm" value=${e.reminder == null ? '' : String(e.reminder)} onChange=${(ev) => set({ reminder: ev.target.value === '' ? null : +ev.target.value })}>
          ${REMINDERS.map((r) => html`<option value=${r.v == null ? '' : String(r.v)}>${r.l}</option>`)}</select>
      <//>
      <${Prop} icon="palette" label="Colour"><${ColorSwatches} value=${e.color} onChange=${(c) => set({ color: c === e.color ? null : c })} /><//>
      <${Prop} icon="folder" label="Folder"><${FolderField} item=${e} /><//>
      <${Prop} icon="tag" label="Tags"><${TagsField} item=${e} /><//>
    </div>
    <div class="detail-sec"><h4><${Icon} name="notes" size=${14} /> Notes</h4>
      <${BlockEditor} key=${'e' + e.id} blocks=${e.notes} ownerId=${e.id} compact placeholder="Agenda, notes — ‘/’ for blocks, ‘/task’ to add an action item" onChange=${(b) => update(e.id, { notes: b })} /></div>
    <div class="detail-sec"><h4><${Icon} name="link" size=${14} /> Linked tasks & notes</h4><${RelatedList} item=${e} /></div>
    <div class="detail-sec"><h4><${Icon} name="clip" size=${14} /> Attachments</h4><${Attachments} item=${e} /></div>
    <div class="detail-foot muted small">Created ${new Date(e.createdAt).toLocaleString()}<span class="grow"></span>
      <${Btn} icon="trash" label="Delete" kind="ghost-danger" size="sm" onClick=${() => undoable(`Deleted “${titleOf(e)}”`, [e.id], () => trash(e.id))} /></div>
  </div>`;
}

function GoogleEventDetail({ e }) {
  const t = tf();
  return html`<div class="detail" key=${e.id}>
    <div class="detail-top"><span class="detail-kind"><${Icon} name="cloud" size=${14} />Google Calendar · ${e.calendarName || 'Calendar'}</span><span class="grow"></span>
      <${Btn} icon="x" title="Close (Esc)" onClick=${closeDetail} /></div>
    <div class="detail-title"><span class="ev-dot" style=${`background:${eventColor(e)}`}></span><h2>${e.title || '(No title)'}</h2></div>
    <div class="props">
      <${Prop} icon="clock" label="When"><span>${D.fmtDate(e.start.slice(0, 10), { weekday: true, long: true })}${e.allDay ? ' · All day' : ` · ${D.fmtTime(e.start.slice(11), t)} – ${D.fmtTime(e.end.slice(11), t)}`}</span><//>
      ${e.location && html`<${Prop} icon="mappin" label="Location"><span>${e.location}</span><//>`}
      ${e.url && html`<${Prop} icon="video" label="Meeting"><a class="btn btn-sm btn-primary" href=${e.url} target="_blank" rel="noopener"><${Icon} name="video" size=${14} />Join meeting</a><//>`}
      ${e.organizer && html`<${Prop} icon="user" label="Organizer"><span>${e.organizer}</span><//>`}
    </div>
    ${e.description && html`<div class="detail-sec"><h4>Description</h4><p class="pre-wrap">${e.description}</p></div>`}
    <p class="muted small">Events from Google are read-only in JamDay and are kept in memory only — they’re never saved to this device. Two-way sync only edits events you create in JamDay.</p>
    <div class="dialog-actions">
      ${e.htmlLink && html`<a class="btn" href=${e.htmlLink} target="_blank" rel="noopener"><${Icon} name="external" size=${14} />Open in Google Calendar</a>`}
      <button type="button" class="btn" onClick=${() => { const n = create('note', { title: (e.title || 'Meeting') + ' — notes ' + D.fmtDate(e.start.slice(0, 10)) }); closeDetail(); navigate('notes', n.id); }}><${Icon} name="notes" size=${14} />Meeting notes</button>
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Events list                                                          */
/* ------------------------------------------------------------------ */

export function EventsView() {
  const [past, setPast] = useState(false);
  const [q, setQ] = useState('');
  const [v, setV] = useState('');
  const today = D.today();
  const from = past ? D.addDays(today, -30) : today;
  const to = D.addDays(today, 90);
  let list = allEvents().filter((e) => e.end.slice(0, 10) >= from && e.start.slice(0, 10) <= to);
  if (q) list = list.filter((e) => (e.title + ' ' + (e.location || '')).toLowerCase().includes(q.toLowerCase()));
  list.sort((a, b) => (a.start < b.start ? -1 : 1));
  const groups = [];
  for (const e of list) {
    const d = e.start.slice(0, 10) < from ? from : e.start.slice(0, 10);
    let g = groups[groups.length - 1];
    if (!g || g.d !== d) { g = { d, list: [] }; groups.push(g); }
    g.list.push(e);
  }
  const t = tf();
  return html`<div class="view">
    <${ViewHeader} icon="clock" iconColor="var(--accent)" title="Events" subtitle=${`${list.length} in the next 90 days`}>
      <label class="check-l"><input type="checkbox" checked=${past} onChange=${(e) => setPast(e.target.checked)} /> Show past 30 days</label>
    <//>
    <div class="view-body narrow">
      <div class="qadd"><div class="qadd-row"><${Icon} name="calendar" size=${18} class="qadd-plus" />
        <input class="qadd-in" placeholder="New event — “Dentist next tue 3pm”, “Team sync fri 10-11am &Work”" value=${v} onInput=${(e) => setV(e.target.value)}
          onKeyDown=${(e) => { if (e.key === 'Enter' && v.trim()) { const ev = createEventFromText(v); setV(''); openItem(ev.id); } }} /></div></div>
      <div class="search-in wide"><${Icon} name="search" size=${15} /><input placeholder="Search events…" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
      ${!groups.length && html`<${Empty} icon="calendar" title="No events" text="Create one above, or connect Google Calendar in Settings ▸ Integrations." />`}
      ${groups.map((g) => html`<div class="ev-group" key=${g.d}>
        <div class="day-h"><b>${D.relDay(g.d)}</b><span class="muted">${D.fmtDate(g.d, { weekday: true })}</span></div>
        ${g.list.map((e) => html`<button type="button" class="ev-row" style=${`--c:${eventColor(e)}`} onClick=${() => openItem(e.id)}>
          <span class="ev-bar"></span>
          <span class="ev-time">${e.allDay ? 'All day' : D.fmtTime(e.start.slice(11), t)}<small>${e.allDay ? '' : D.fmtTime(e.end.slice(11), t)}</small></span>
          <span class="ev-main"><b class="ellipsis">${e.title || 'Untitled event'}</b>
            <span class="muted small ellipsis">${[e.location, e.source === 'google' ? 'Google · ' + (e.calendarName || '') : '', folderOf(e) ? folderOf(e).name : ''].filter(Boolean).join(' · ')}</span></span>
          ${liveTags(e).map((tg) => html`<span class="meta tagm" style=${`--c:${tg.color}`}>#${tg.name}</span>`)}
          ${e.url && html`<a class="btn btn-sm btn-primary" href=${e.url} target="_blank" rel="noopener" onClick=${(x) => x.stopPropagation()}><${Icon} name="video" size=${13} />Join</a>`}
        </button>`)}
      </div>`)}
    </div>
  </div>`;
}
