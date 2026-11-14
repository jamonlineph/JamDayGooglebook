// MCP: lets AI apps (Claude Desktop, Claude Code, Cursor, VS Code…) work with JamDay through the
// JamDay MCP connector (app/mcp/jamday-mcp.mjs). JamDay connects to the connector over a local,
// token-protected WebSocket and answers its tool calls here. Nothing goes through a server.
import {
  S, emit, setSetting, tasks, notes, allEvents, folders, tags, alive, create, update, trash, toggleTask, isDone,
  taskDate, isOverdue, isTodayTask, isInbox, sortTasks, subtasks, liveTags, folderOf, titleOf, itemText,
  findOrCreateTag, findOrCreateFolder, findFolder, eventsOn, eventDays, snapshot, restoreSnapshot, toast, dismissToast, PRIORITIES,
  itemsInFolder, itemsWithTag,
} from './store.js';
import { fuzzy, APP_VERSION } from './lib.js';
import * as D from './dates.js';
import { markdownToBlocks, blocksToMarkdown } from './md.js';

export const DEFAULT_URL = 'ws://127.0.0.1:41823';
export const newToken = () => Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 56]).join('');

S.mcp = { status: 'off', since: null, log: [], calls: 0 };

/* ------------------------------------------------------------------ */
/* Connection                                                           */
/* ------------------------------------------------------------------ */

let ws = null;
let timer = null;
let attempt = 0;

const setStatus = (status) => { S.mcp.status = status; if (status === 'connected') S.mcp.since = Date.now(); emit(); };

export function startMCP() {
  stopMCP(true);
  const m = S.settings.mcp;
  if (!m.enabled) { setStatus('off'); return; }
  if (!m.token) setSetting('mcp.token', newToken());
  connect();
}

export function stopMCP(silent = false) {
  clearTimeout(timer);
  if (ws) { ws.onclose = null; ws.onerror = null; try { ws.close(); } catch { /* ignore */ } ws = null; }
  if (!silent) setStatus('off');
}

export function reconnectNow() { attempt = 0; startMCP(); }

function connect() {
  const { url, token } = S.settings.mcp;
  setStatus('connecting');
  try {
    ws = new WebSocket((url || DEFAULT_URL).replace(/\/+$/, '') + '/?token=' + encodeURIComponent(token) + '&client=jamday');
  } catch (e) {
    S.mcp.error = e.message;
    return retry();
  }
  ws.onopen = () => {
    attempt = 0;
    S.mcp.error = '';
    setStatus('connected');
    ws.send(JSON.stringify({ type: 'hello', app: 'JamDay', version: APP_VERSION, access: S.settings.mcp.access }));
  };
  ws.onmessage = async (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type !== 'call') return;
    const out = await runTool(msg.name, msg.arguments || {});
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'result', id: msg.id, ...out }));
  };
  ws.onerror = () => {};
  ws.onclose = () => { ws = null; retry(); };
}

function retry() {
  if (!S.settings.mcp.enabled) { setStatus('off'); return; }
  setStatus('waiting');
  const delay = Math.min(30000, 1500 * 2 ** Math.min(attempt++, 5));
  clearTimeout(timer);
  timer = setTimeout(connect, delay);
}

/* ------------------------------------------------------------------ */
/* Tool calls                                                           */
/* ------------------------------------------------------------------ */

const READ_ONLY = new Set(['get_today', 'search', 'list_tasks', 'get_item', 'list_events', 'list_notes', 'list_folders_and_tags', 'list_habits']);

export const TOOL_INFO = [
  ['get_today', 'Today’s overview'], ['search', 'Search everything'], ['list_tasks', 'List tasks by view'], ['get_item', 'Read one item'],
  ['list_events', 'List events'], ['list_notes', 'List notes'], ['list_folders_and_tags', 'Folders & tags'], ['list_habits', 'Habits & streaks'],
  ['create_task', 'Create tasks & habits'], ['update_task', 'Edit tasks'], ['complete_task', 'Complete tasks'], ['create_event', 'Create events'],
  ['update_event', 'Edit events'], ['create_note', 'Create notes'], ['update_note', 'Edit & append to notes'], ['delete_item', 'Move to Trash'],
].map(([name, label]) => ({ name, label, write: !READ_ONLY.has(name) }));

function pushLog(entry) {
  S.mcp.log = [entry, ...S.mcp.log].slice(0, 100);
  S.mcp.calls++;
  emit();
}

export async function runTool(name, args) {
  const entry = { at: Date.now(), tool: name, ok: true, summary: '' };
  try {
    if (!READ_ONLY.has(name) && S.settings.mcp.access !== 'write') {
      throw new Error('JamDay only allows reading for MCP clients right now. The user can allow changes in JamDay ▸ MCP.');
    }
    const handler = HANDLERS[name];
    if (!handler) throw new Error('Unknown tool: ' + name);
    const result = await handler(args || {});
    entry.summary = result && result.summary ? result.summary : summarize(name, args);
    pushLog(entry);
    return { ok: true, result };
  } catch (e) {
    entry.ok = false;
    entry.summary = e.message;
    pushLog(entry);
    return { ok: false, error: e.message };
  }
}

function summarize(name, a) {
  if (a.query) return `“${a.query}”`;
  if (a.view) return a.view;
  if (a.id) { const it = alive(a.id); return it ? titleOf(it) : a.id; }
  return '';
}

/** Applies a change, then shows one notice with Undo. Changes in quick succession share a notice. */
let batch = null;
function change(message, ids, fn) {
  const snap = snapshot(ids);
  const r = fn();
  // Undoing a create removes the new item again
  if (r && r.id && !ids.includes(r.id)) snap.push({ id: r.id, __missing: true });
  if (!S.settings.mcp.notify) return r;
  if (batch && Date.now() - batch.at < 8000) { dismissToast(batch.toast); batch.snaps.push(snap); batch.count++; }
  else batch = { snaps: [snap], count: 1 };
  batch.at = Date.now();
  const b = batch;
  const text = b.count > 1 ? `An AI app made ${b.count} changes — latest: ${message.replace(/^An AI app /, '')}` : message;
  b.toast = toast('🔌 ' + text, { timeout: 8000, action: { label: b.count > 1 ? 'Undo all' : 'Undo', run: () => { b.snaps.slice().reverse().forEach(restoreSnapshot); if (batch === b) batch = null; } } });
  return r;
}

/* ---------------- input helpers ---------------- */

const need = (id, type) => {
  const it = alive(id);
  if (!it || (type && it.type !== type)) throw new Error(`No ${type || 'item'} with id “${id}”. Use search to find it.`);
  return it;
};

function parseWhen(s) {
  if (s == null) return undefined;
  const v = String(s).trim();
  if (!v) return { when: null, repeat: null };
  let m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?$/.exec(v);
  if (m) return { when: { kind: 'day', date: m[1], time: m[2] || null } };
  const p = D.parseNatural(v, { weekStart: S.settings.weekStart });
  if (!p.found) throw new Error(`Couldn’t understand the date “${v}”. Try “tomorrow 3pm” or “2026-11-20 15:00”.`);
  const when = p.kind === 'someday' ? { kind: 'someday' } : p.kind === 'day' ? { kind: 'day', date: p.date, time: p.time || null } : { kind: p.kind, date: p.date };
  return { when, repeat: p.repeat ? { ...p.repeat, anchor: p.date || D.today() } : undefined };
}

function parseDate(s) {
  const v = String(s || '').trim();
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const p = D.parseNatural(v, { weekStart: S.settings.weekStart });
  if (p.found && p.date) return p.date;
  throw new Error(`Couldn’t understand the date “${v}”.`);
}

function parsePriority(p) {
  if (p == null) return undefined;
  if (typeof p === 'number') return Math.max(0, Math.min(4, Math.round(p)));
  const i = ['none', 'low', 'medium', 'high', 'urgent'].indexOf(String(p).toLowerCase());
  if (i < 0) throw new Error('Priority must be none, low, medium, high or urgent.');
  return i;
}

const tagIds = (names) => (Array.isArray(names) ? names.map((n) => findOrCreateTag(String(n))).filter(Boolean).map((t) => t.id) : undefined);
const folderId = (name) => (name == null ? undefined : String(name).trim() ? findOrCreateFolder(String(name)).id : null);

function parseStart(s) {
  const v = String(s || '').trim();
  let m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/.exec(v);
  if (m) return m[2] ? { start: m[1] + 'T' + m[2], allDay: false } : { start: m[1] + 'T00:00', allDay: true };
  const p = D.parseNatural(v, { weekStart: S.settings.weekStart });
  if (!p.found || p.kind !== 'day') throw new Error(`Couldn’t understand the start “${v}”. Use “2026-11-20T15:00” or “tomorrow 3pm”.`);
  if (!p.time) return { start: p.date + 'T00:00', allDay: true };
  return { start: p.date + 'T' + p.time, allDay: false, end: p.endTime ? p.date + 'T' + p.endTime : undefined };
}

/* ---------------- output helpers ---------------- */

function whenOut(w) {
  if (!w) return null;
  if (w.kind === 'someday') return 'someday';
  if (w.kind === 'week') return 'week of ' + w.date;
  if (w.kind === 'month') return 'month of ' + w.date.slice(0, 7);
  return w.date + (w.time ? ' ' + w.time : '');
}

function taskOut(t, detail = false) {
  const subs = subtasks(t.id);
  const o = {
    id: t.id, type: 'task', title: t.title, status: t.status, priority: PRIORITIES[t.priority || 0].label.toLowerCase().replace('no priority', 'none'),
    when: whenOut(t.when), deadline: t.deadline || null, overdue: isOverdue(t) || undefined,
    folder: folderOf(t) ? folderOf(t).name : null, tags: liveTags(t).map((x) => x.name),
  };
  if (t.repeat) { const st = D.habitStats(t); o.repeat = D.describeRepeat(t.repeat); o.streak = st ? st.streak : 0; }
  if (t.people && t.people.length) o.people = t.people;
  if (t.parentId) o.parent_id = t.parentId;
  if (detail) {
    o.notes = blocksToMarkdown(t.notes).trim();
    o.subtasks = subs.map((s) => ({ id: s.id, title: s.title, status: s.status }));
    o.reminder = t.reminder || null;
    o.created = new Date(t.createdAt).toISOString();
    o.updated = new Date(t.updatedAt).toISOString();
  } else if (subs.length) {
    o.subtasks = `${subs.filter(isDone).length}/${subs.length} done`;
  }
  return o;
}

function eventOut(e, detail = false) {
  const o = {
    id: e.id, type: 'event', title: e.title, start: e.allDay ? e.start.slice(0, 10) : e.start, end: e.allDay ? e.end.slice(0, 10) : e.end,
    all_day: !!e.allDay, location: e.location || undefined, url: e.url || undefined,
  };
  if (e.source === 'google') o.source = 'google calendar (read-only)';
  else { o.folder = folderOf(e) ? folderOf(e).name : null; o.tags = liveTags(e).map((x) => x.name); }
  if (detail && e.source !== 'google') o.notes = blocksToMarkdown(e.notes).trim();
  if (detail && e.source === 'google' && e.description) o.notes = e.description;
  return o;
}

function noteOut(n, detail = false) {
  const md = blocksToMarkdown(n.blocks).trim();
  const o = { id: n.id, type: 'note', title: titleOf(n), folder: folderOf(n) ? folderOf(n).name : null, tags: liveTags(n).map((x) => x.name), pinned: !!n.pinned || undefined, updated: new Date(n.updatedAt).toISOString() };
  if (detail) o.markdown = md; else o.excerpt = md.replace(/\s+/g, ' ').slice(0, 220);
  return o;
}

const out = (it, detail) => (it.type === 'task' ? taskOut(it, detail) : it.type === 'note' ? noteOut(it, detail) : eventOut(it, detail));

/* ---------------- handlers ---------------- */

const HANDLERS = {
  get_today() {
    const T = D.today();
    const open = tasks().filter((t) => !isDone(t) && !t.parentId);
    const overdue = sortTasks(open.filter((t) => isOverdue(t, T)));
    const today = sortTasks(open.filter((t) => isTodayTask(t, T) && !overdue.includes(t)));
    const ws = D.startOfWeek(T, S.settings.weekStart);
    const doneToday = tasks().filter((t) => (isDone(t) && t.completedAt && D.ds(new Date(t.completedAt)) === T) || (t.repeat && (t.completions || []).includes(T)));
    const habits = tasks().filter((t) => t.repeat && D.occursOn(t.repeat, T)).map((t) => ({ id: t.id, title: t.title, done_today: (t.completions || []).includes(T), streak: D.habitStats(t).streak }));
    return {
      date: T, weekday: D.DOW_LONG[D.dow(T)], time: D.hhmm(new Date()),
      progress: { done_today: doneToday.length, remaining_today: today.length + overdue.length },
      overdue: overdue.map((t) => taskOut(t)), today: today.map((t) => taskOut(t)),
      planned_this_week: sortTasks(open.filter((t) => t.when && t.when.kind === 'week' && t.when.date <= ws)).map((t) => taskOut(t)),
      events: eventsOn(T).map((e) => eventOut(e)), habits,
      summary: `${today.length + overdue.length} tasks · ${eventsOn(T).length} events`,
    };
  },

  search({ query, types, limit = 20 }) {
    if (!query || !String(query).trim()) throw new Error('Give a query.');
    const want = Array.isArray(types) && types.length ? types : ['task', 'note', 'event'];
    const pool = [...(want.includes('task') ? tasks() : []), ...(want.includes('note') ? notes() : []), ...(want.includes('event') ? allEvents() : [])];
    const hits = pool.map((it) => ({ it, s: Math.max(fuzzy(query, titleOf(it)), fuzzy(query, itemText(it)) - 300) })).filter((r) => r.s >= 0)
      .sort((a, b) => b.s - a.s).slice(0, Math.min(100, limit)).map((r) => out(r.it));
    return { count: hits.length, results: hits, summary: `“${query}” · ${hits.length} found` };
  },

  list_tasks({ view = 'today', folder, tag, limit = 100 }) {
    const T = D.today();
    let list = tasks();
    if (folder) { const f = findFolder(folder); if (!f) throw new Error(`No folder named “${folder}”.`); list = list.filter((t) => t.folderId === f.id); }
    if (tag) { const tg = tags().find((x) => x.name.toLowerCase() === String(tag).replace(/^#/, '').toLowerCase()); if (!tg) throw new Error(`No tag named “${tag}”.`); list = list.filter((t) => (t.tags || []).includes(tg.id)); }
    const end = D.addDays(T, 14);
    const pick = {
      today: (t) => isTodayTask(t, T),
      upcoming: (t) => !isDone(t) && ((taskDate(t) && taskDate(t) > T && taskDate(t) <= end) || (t.deadline && t.deadline > T && t.deadline <= end)),
      inbox: isInbox,
      overdue: (t) => isOverdue(t, T),
      someday: (t) => !isDone(t) && t.when && t.when.kind === 'someday',
      all: (t) => !isDone(t),
      completed: isDone,
    }[view];
    if (!pick) throw new Error('Unknown view: ' + view);
    let res = list.filter(pick);
    res = view === 'completed' ? res.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0)) : sortTasks(res);
    return { view, count: res.length, tasks: res.slice(0, Math.min(500, limit)).map((t) => taskOut(t)) };
  },

  get_item({ id }) {
    const it = alive(id) || allEvents().find((e) => e.id === id);
    if (!it || !['task', 'note', 'event'].includes(it.type)) throw new Error(`No task, note or event with id “${id}”.`);
    return out(it, true);
  },

  create_task(a) {
    if (!a.title || !String(a.title).trim()) throw new Error('A task needs a title.');
    const data = { title: String(a.title).trim() };
    const w = parseWhen(a.when);
    if (w) { data.when = w.when; if (w.repeat) data.repeat = w.repeat; }
    if (a.deadline) data.deadline = parseDate(a.deadline);
    const p = parsePriority(a.priority); if (p != null) data.priority = p;
    const tg = tagIds(a.tags); if (tg) data.tags = tg;
    const f = folderId(a.folder); if (f !== undefined) data.folderId = f;
    if (a.notes) data.notes = markdownToBlocks(String(a.notes));
    if (a.parent_id) { const parent = need(a.parent_id, 'task'); data.parentId = parent.id; if (data.folderId === undefined) data.folderId = parent.folderId; }
    if (a.reminder) data.reminder = String(a.reminder).slice(0, 16);
    else if (data.when && data.when.time) data.reminder = data.when.date + 'T' + data.when.time;
    let t;
    change(`An AI app added “${data.title}”`, [], () => (t = create('task', data)));
    return { created: taskOut(t, true), summary: data.title };
  },

  update_task(a) {
    const t = need(a.id, 'task');
    const p = {};
    if (a.title != null) p.title = String(a.title);
    const w = parseWhen(a.when);
    if (w) { p.when = w.when; if (w.repeat !== undefined) p.repeat = w.repeat; if (w.when && w.when.time) p.reminder = w.when.date + 'T' + w.when.time; }
    if (a.deadline !== undefined) p.deadline = a.deadline ? parseDate(a.deadline) : null;
    const pr = parsePriority(a.priority); if (pr != null) p.priority = pr;
    if (a.status) { if (!['todo', 'doing', 'waiting', 'done'].includes(a.status)) throw new Error('Status must be todo, doing, waiting or done.'); p.status = a.status; p.completedAt = a.status === 'done' ? Date.now() : null; }
    const tg = tagIds(a.tags); if (tg) p.tags = tg;
    const f = folderId(a.folder); if (f !== undefined) p.folderId = f;
    if (a.notes != null) p.notes = markdownToBlocks(String(a.notes));
    change(`An AI app updated “${titleOf(t)}”`, [t.id], () => update(t.id, p));
    return { updated: taskOut(alive(t.id), true), summary: titleOf(t) };
  },

  complete_task({ id }) {
    const t = need(id, 'task');
    if (isDone(t)) return { already_done: true, task: taskOut(t), summary: titleOf(t) };
    change(`An AI app completed “${titleOf(t)}”`, [t.id], () => {
      if (t.repeat) toggleTask(t.id); else update(t.id, { status: 'done', completedAt: Date.now() });
    });
    return { completed: taskOut(alive(t.id)), summary: titleOf(t) };
  },

  list_events({ from, to }) {
    const a = from ? parseDate(from) : D.today();
    const b = to ? parseDate(to) : D.addDays(a, 7);
    const list = allEvents().filter((e) => eventDays(e).some((d) => d >= a && d <= b)).sort((x, y) => (x.start < y.start ? -1 : 1));
    return { from: a, to: b, count: list.length, events: list.map((e) => eventOut(e)), summary: `${a} → ${b}` };
  },

  create_event(a) {
    if (!a.title) throw new Error('An event needs a title.');
    if (!a.start) throw new Error('An event needs a start.');
    const s = parseStart(a.start);
    const allDay = a.all_day != null ? !!a.all_day : s.allDay;
    const data = { title: String(a.title), allDay, start: allDay ? s.start.slice(0, 10) + 'T00:00' : s.start };
    if (a.end) data.end = /^\d{4}-\d{2}-\d{2}$/.test(a.end) ? a.end + 'T00:00' : String(a.end).replace(' ', 'T').slice(0, 16);
    else data.end = allDay ? data.start : (s.end || D.addMinutesDT(data.start, 60));
    if (data.end < data.start) throw new Error('The end is before the start.');
    if (a.location) data.location = String(a.location);
    if (a.url) data.url = String(a.url);
    if (a.notes) data.notes = markdownToBlocks(String(a.notes));
    const tg = tagIds(a.tags); if (tg) data.tags = tg;
    const f = folderId(a.folder); if (f !== undefined) data.folderId = f;
    let e;
    change(`An AI app added the event “${data.title}”`, [], () => (e = create('event', data)));
    return { created: eventOut(e, true), summary: data.title };
  },

  update_event(a) {
    const e = alive(a.id);
    if (!e || e.type !== 'event') {
      if (allEvents().some((g) => g.id === a.id)) throw new Error('That event comes from Google Calendar and is read-only in JamDay.');
      throw new Error(`No event with id “${a.id}”.`);
    }
    const p = {};
    if (a.title != null) p.title = String(a.title);
    if (a.all_day != null) p.allDay = !!a.all_day;
    if (a.start) {
      const s = parseStart(a.start);
      const dur = D.parseDT(e.end) - D.parseDT(e.start);
      p.start = s.start;
      if (a.all_day == null) p.allDay = s.allDay;
      p.end = s.end || D.dtStr(new Date(D.parseDT(s.start).getTime() + Math.max(0, dur)));
    }
    if (a.end) p.end = /^\d{4}-\d{2}-\d{2}$/.test(a.end) ? a.end + 'T00:00' : String(a.end).replace(' ', 'T').slice(0, 16);
    if (a.location != null) p.location = String(a.location);
    if (a.url != null) p.url = String(a.url);
    if (a.notes != null) p.notes = markdownToBlocks(String(a.notes));
    const tg = tagIds(a.tags); if (tg) p.tags = tg;
    const f = folderId(a.folder); if (f !== undefined) p.folderId = f;
    change(`An AI app updated the event “${titleOf(e)}”`, [e.id], () => update(e.id, p));
    return { updated: eventOut(alive(e.id), true), summary: titleOf(e) };
  },

  list_notes({ query, folder, tag, limit = 50 }) {
    let list = notes().slice().sort((a, b) => b.updatedAt - a.updatedAt);
    if (folder) { const f = findFolder(folder); if (!f) throw new Error(`No folder named “${folder}”.`); list = list.filter((n) => n.folderId === f.id); }
    if (tag) { const tg = tags().find((x) => x.name.toLowerCase() === String(tag).replace(/^#/, '').toLowerCase()); if (!tg) throw new Error(`No tag named “${tag}”.`); list = list.filter((n) => (n.tags || []).includes(tg.id)); }
    if (query) list = list.filter((n) => itemText(n).toLowerCase().includes(String(query).toLowerCase()));
    return { count: list.length, notes: list.slice(0, Math.min(200, limit)).map((n) => noteOut(n)) };
  },

  create_note(a) {
    if (!a.title) throw new Error('A note needs a title.');
    const data = { title: String(a.title), blocks: markdownToBlocks(String(a.markdown || '')) };
    const tg = tagIds(a.tags); if (tg) data.tags = tg;
    const f = folderId(a.folder); if (f !== undefined) data.folderId = f;
    let n;
    change(`An AI app added the note “${data.title}”`, [], () => (n = create('note', data)));
    return { created: noteOut(n, true), summary: data.title };
  },

  update_note(a) {
    const n = need(a.id, 'note');
    const p = {};
    if (a.title != null) p.title = String(a.title);
    if (a.markdown != null) p.blocks = markdownToBlocks(String(a.markdown));
    if (a.append_markdown) p.blocks = [...(p.blocks || n.blocks || []), ...markdownToBlocks(String(a.append_markdown))];
    const tg = tagIds(a.tags); if (tg) p.tags = tg;
    const f = folderId(a.folder); if (f !== undefined) p.folderId = f;
    change(`An AI app updated the note “${titleOf(n)}”`, [n.id], () => update(n.id, p));
    return { updated: noteOut(alive(n.id), true), summary: titleOf(n) };
  },

  delete_item({ id }) {
    const it = alive(id);
    if (!it || !['task', 'note', 'event'].includes(it.type)) throw new Error(`No task, note or event with id “${id}”.`);
    change(`An AI app moved “${titleOf(it)}” to Trash`, [it.id], () => trash(it.id));
    return { moved_to_trash: { id: it.id, type: it.type, title: titleOf(it) }, summary: titleOf(it) };
  },

  list_folders_and_tags() {
    return {
      folders: folders().map((f) => ({ name: f.name, items: itemsInFolder(f.id).length })),
      tags: tags().map((t) => ({ name: t.name, items: itemsWithTag(t.id).length })),
    };
  },

  list_habits() {
    const list = tasks().filter((t) => t.repeat && !isDone(t)).map((t) => {
      const st = D.habitStats(t);
      return { id: t.id, title: t.title, repeat: D.describeRepeat(t.repeat), next: taskDate(t), streak: st.streak, best_streak: st.best, completion_rate_30d: st.rate + '%', done_today: st.doneToday };
    });
    return { count: list.length, habits: list };
  },
};

