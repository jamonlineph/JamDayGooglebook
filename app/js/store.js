// Central state: items, settings, UI state, persistence, queries and actions.
import { db } from './db.js';
import { uid, debounce, deepClone, stripHtml } from './lib.js';
import * as D from './dates.js';

/* ------------------------------------------------------------------ */
/* Defaults                                                             */
/* ------------------------------------------------------------------ */

export const SECTIONS = {
  inbox: { label: 'Inbox', icon: 'inbox' },
  today: { label: 'Today', icon: 'sun' },
  upcoming: { label: 'Upcoming', icon: 'upcoming' },
  calendar: { label: 'Calendar', icon: 'calendar' },
  tasks: { label: 'Tasks', icon: 'tasks' },
  events: { label: 'Events', icon: 'clock' },
  notes: { label: 'Notes', icon: 'notes' },
  habits: { label: 'Habits', icon: 'flame' },
  folders: { label: 'Folders', icon: 'folder' },
  tags: { label: 'Tags', icon: 'tag' },
  mcp: { label: 'MCP', icon: 'plug' },
};

export const PRIORITIES = [
  { v: 0, label: 'No priority', short: '' },
  { v: 1, label: 'Low', short: 'Low' },
  { v: 2, label: 'Medium', short: 'Med' },
  { v: 3, label: 'High', short: 'High' },
  { v: 4, label: 'Urgent', short: 'Urgent' },
];

export const STATUSES = [
  { v: 'todo', label: 'To do' },
  { v: 'doing', label: 'In progress' },
  { v: 'waiting', label: 'Waiting' },
  { v: 'done', label: 'Done' },
];

export const COLORS = ['#e5484d', '#f76b15', '#ffb224', '#30a46c', '#12a594', '#0090ff', '#6e56cf', '#d6409f', '#8d8d86', '#a18072'];
export const COLOR_NAMES = ['Red', 'Orange', 'Amber', 'Green', 'Teal', 'Blue', 'Violet', 'Pink', 'Gray', 'Brown'];

export const DEFAULT_SETTINGS = {
  theme: 'system',            // light | dark | system
  glass: '',                  // '' | aurora | sunset | midnight
  accent: 'jam',
  density: 'comfortable',     // comfortable | compact
  fontScale: 1,
  weekStart: 1,
  timeFormat: '12',
  calendarView: 'week',
  dayStartHour: 7,
  startView: 'today',
  tasksView: 'list',
  showCompleted: true,
  sidebar: Object.keys(SECTIONS).map((id) => ({ id, show: id !== 'events' })),
  sidebarCollapsed: false,
  sidebarFolders: true,
  sidebarTags: true,
  notifications: {
    enabled: false, tasks: true, events: true, habits: true, summary: false,
    summaryTime: '08:00', habitTime: '20:00', eventLead: 10, inApp: true,
  },
  shortcuts: { launcher: 'alt+space', panel: 'ctrl+alt+space' },
  panel: { style: 'dropdown', edge: false, edgeSide: 'right', x: null, y: null, tab: 'today' },
  mcp: { enabled: false, url: 'ws://127.0.0.1:41823', token: '', access: 'write', notify: true },
  google: { clientId: '', twoWay: false, calendars: [], drive: false, lastSync: null, autoConnect: false },
  onboarded: false,
  tourDone: false,
  notesSort: 'updated',
  folderLayout: 'cards',
  folderGroup: 'type',
};

/* ------------------------------------------------------------------ */
/* State + subscriptions                                                */
/* ------------------------------------------------------------------ */

export const S = {
  ready: false,
  items: new Map(),
  settings: deepClone(DEFAULT_SETTINGS),
  tombstones: {},
  ui: {
    route: { view: 'today', id: null },
    detail: null,          // { id }
    launcher: null,        // { query }
    panel: false,
    sidebarOpen: false,    // mobile
    tour: null,
    shortcutsHelp: false,
    calendar: { anchor: D.today(), view: null },
  },
  overlay: { popover: null, modals: [] },
  toasts: [],
  google: { connected: false, busy: false, events: [], calendars: [], error: '', lastFetch: null },
  ai: { messages: [], busy: false },
};

const subs = new Set();
let scheduled = false;
export let itemsVersion = 0;
export function emit() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => { scheduled = false; subs.forEach((f) => f()); });
}
export function subscribe(f) { subs.add(f); return () => subs.delete(f); }

/** Hooks other modules can register (e.g. Google two-way sync). */
export const hooks = { change: new Set() };

/* ------------------------------------------------------------------ */
/* Persistence                                                          */
/* ------------------------------------------------------------------ */

const dirty = new Set();
const removed = new Set();
const flush = debounce(async () => {
  const items = [...dirty].map((id) => S.items.get(id)).filter(Boolean);
  const rm = [...removed];
  dirty.clear(); removed.clear();
  try {
    if (items.length) await db.putItems(items);
    if (rm.length) await db.deleteItems(rm);
  } catch (e) { console.error('Save failed', e); toast('Could not save changes: ' + e.message, { kind: 'error' }); }
}, 200);
const saveSettings = debounce(() => db.setMeta('settings', S.settings), 200);
const saveTombstones = debounce(() => db.setMeta('tombstones', S.tombstones), 400);

function markDirty(id) { dirty.add(id); itemsVersion++; flush(); }
export function flushNow() { flush.flush(); saveSettings.flush(); }
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushNow);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushNow(); });
}

/* ------------------------------------------------------------------ */
/* Boot                                                                 */
/* ------------------------------------------------------------------ */

function mergeDeep(base, over) {
  for (const k of Object.keys(over || {})) {
    const v = over[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) mergeDeep(base[k], v);
    else base[k] = v;
  }
  return base;
}

export async function boot() {
  const [items, settings, tomb] = await Promise.all([db.allItems(), db.getMeta('settings'), db.getMeta('tombstones')]);
  items.forEach((i) => S.items.set(i.id, i));
  S.settings = mergeDeep(deepClone(DEFAULT_SETTINGS), settings || {});
  // make sure new sidebar sections show up for older settings
  const known = new Set(S.settings.sidebar.map((s) => s.id));
  for (const id of Object.keys(SECTIONS)) if (!known.has(id)) S.settings.sidebar.push({ id, show: true });
  S.settings.sidebar = S.settings.sidebar.filter((s) => SECTIONS[s.id]);
  // The old built-in assistant stored API keys here; MCP replaced it, so drop them.
  if (S.settings.ai) { delete S.settings.ai; saveSettings(); }
  S.tombstones = tomb || {};
  S.ui.route = parseHash();
  S.ui.calendar.view = S.settings.calendarView;
  itemsVersion++;
  rollHabits();
  purgeOldTrash();
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch { /* ignore */ }
  S.ready = true;
  emit();
}

/* ------------------------------------------------------------------ */
/* Settings                                                             */
/* ------------------------------------------------------------------ */

export function setSetting(path, value) {
  const keys = path.split('.');
  let o = S.settings;
  for (let i = 0; i < keys.length - 1; i++) { o[keys[i]] = { ...(o[keys[i]] || {}) }; o = o[keys[i]]; }
  o[keys[keys.length - 1]] = value;
  S.settings = { ...S.settings };
  saveSettings();
  emit();
}
export function resetSettings() { S.settings = deepClone(DEFAULT_SETTINGS); S.settings.onboarded = true; saveSettings(); emit(); }

/* ------------------------------------------------------------------ */
/* Items                                                                */
/* ------------------------------------------------------------------ */

const blank = () => [{ id: uid('b'), type: 'p', html: '' }];

const DEFAULTS = {
  task: () => ({
    title: '', notes: blank(), status: 'todo', priority: 0, when: null, deadline: null,
    reminder: null, repeat: null, completions: [], completedAt: null, parentId: null, people: [], order: Date.now(),
  }),
  note: () => ({ title: '', icon: null, cover: null, blocks: blank(), pinned: false }),
  event: () => {
    const s = D.nowRounded(30);
    const e = new Date(s.getTime() + 3600000);
    return {
      title: '', start: D.dtStr(s), end: D.dtStr(e), allDay: false, location: '', url: '', notes: blank(),
      color: null, reminder: S.settings.notifications.eventLead, googleId: null, syncGoogle: false,
    };
  },
  folder: () => ({ name: '', icon: null, color: COLORS[(Math.random() * COLORS.length) | 0], order: Date.now() }),
  tag: () => ({ name: '', color: COLORS[(Math.random() * COLORS.length) | 0], icon: null }),
};

function notify(kind, item, prev) { hooks.change.forEach((f) => { try { f(kind, item, prev); } catch (e) { console.error(e); } }); }

export function create(type, data = {}) {
  const now = Date.now();
  const item = {
    id: uid(type[0]), type, createdAt: now, updatedAt: now, deletedAt: null,
    tags: [], folderId: null, links: [], attachments: [],
    ...DEFAULTS[type](), ...data,
  };
  S.items.set(item.id, item);
  markDirty(item.id);
  notify('create', item);
  emit();
  return item;
}

export function update(id, patch, { silent = false } = {}) {
  const it = S.items.get(id);
  if (!it) return null;
  const p = typeof patch === 'function' ? patch(it) : patch;
  const next = { ...it, ...p, updatedAt: Date.now() };
  S.items.set(id, next);
  markDirty(id);
  if (!silent) notify('update', next, it);
  emit();
  return next;
}

export const get = (id) => S.items.get(id) || null;
export const alive = (id) => { const it = id && S.items.get(id); return it && !it.deletedAt ? it : null; };

export function descendants(id) {
  const out = [];
  const walk = (pid) => { for (const t of S.items.values()) if (t.type === 'task' && t.parentId === pid && !out.includes(t.id)) { out.push(t.id); walk(t.id); } };
  walk(id);
  return out;
}

export function trash(id) {
  const it = get(id); if (!it) return;
  const ids = [id, ...(it.type === 'task' ? descendants(id) : [])];
  const now = Date.now();
  ids.forEach((x) => { const cur = get(x); if (cur && !cur.deletedAt) { S.items.set(x, { ...cur, deletedAt: now, updatedAt: now }); markDirty(x); notify('trash', S.items.get(x), cur); } });
  if (S.ui.detail && ids.includes(S.ui.detail.id)) S.ui.detail = null;
  emit();
}

export function restore(id) {
  const it = get(id); if (!it) return;
  const ids = [id, ...(it.type === 'task' ? descendants(id).filter((d) => get(d).deletedAt === it.deletedAt) : [])];
  ids.forEach((x) => { const cur = get(x); S.items.set(x, { ...cur, deletedAt: null, updatedAt: Date.now() }); markDirty(x); notify('restore', S.items.get(x), cur); });
  emit();
}

export function purge(id) {
  const it = get(id); if (!it) return;
  (it.attachments || []).forEach((a) => db.deleteFile(a.id).catch(() => {}));
  S.items.delete(id);
  removed.add(id);
  itemsVersion++;
  S.tombstones[id] = Date.now();
  saveTombstones();
  flush();
  notify('purge', it);
  emit();
}

export function emptyTrash() { [...S.items.values()].filter((i) => i.deletedAt).forEach((i) => purge(i.id)); }

function purgeOldTrash() {
  const cutoff = Date.now() - 30 * 86400000;
  [...S.items.values()].filter((i) => i.deletedAt && i.deletedAt < cutoff).forEach((i) => purge(i.id));
}

/** Replace/merge items wholesale (import / sync). */
export function upsertMany(list, { overwrite = 'newer' } = {}) {
  let n = 0;
  for (const it of list) {
    if (!it || !it.id || !it.type || !DEFAULTS[it.type]) continue;
    if (S.tombstones[it.id] && S.tombstones[it.id] >= (it.updatedAt || 0)) continue;
    const cur = S.items.get(it.id);
    if (cur && overwrite === 'newer' && (cur.updatedAt || 0) >= (it.updatedAt || 0)) continue;
    S.items.set(it.id, { ...DEFAULTS[it.type](), tags: [], links: [], attachments: [], ...it });
    markDirty(it.id); n++;
  }
  emit();
  return n;
}

export function applyTombstones(t) {
  for (const [id, ts] of Object.entries(t || {})) {
    S.tombstones[id] = Math.max(S.tombstones[id] || 0, ts);
    const cur = S.items.get(id);
    if (cur && (cur.updatedAt || 0) <= ts) { S.items.delete(id); removed.add(id); }
  }
  itemsVersion++; flush(); saveTombstones(); emit();
}

export async function wipeEverything() {
  await db.clearAll();
  S.items.clear(); S.tombstones = {};
  S.settings = deepClone(DEFAULT_SETTINGS);
  itemsVersion++;
  emit();
}

/* ---------------- undo ---------------- */

export function snapshot(ids) { return ids.map((id) => (S.items.has(id) ? deepClone(S.items.get(id)) : { id, __missing: true })); }
export function restoreSnapshot(snap) {
  snap.forEach((s) => {
    if (s.__missing) { S.items.delete(s.id); removed.add(s.id); }
    else { S.items.set(s.id, { ...s, updatedAt: Date.now() }); dirty.add(s.id); }
  });
  itemsVersion++; flush(); emit();
}
export function undoable(message, ids, fn) {
  const snap = snapshot(ids);
  const r = fn();
  toast(message, { action: { label: 'Undo', run: () => restoreSnapshot(snap) } });
  return r;
}

/* ------------------------------------------------------------------ */
/* Queries                                                              */
/* ------------------------------------------------------------------ */

let qc = { v: -1, byType: {} };
export function ofType(type) {
  if (qc.v !== itemsVersion) {
    qc = { v: itemsVersion, byType: {} };
    for (const it of S.items.values()) {
      if (it.deletedAt) continue;
      (qc.byType[it.type] || (qc.byType[it.type] = [])).push(it);
    }
  }
  return qc.byType[type] || [];
}
export const tasks = () => ofType('task');
export const notes = () => ofType('note');
export const events = () => ofType('event');
export const folders = () => ofType('folder').slice().sort((a, b) => (a.order || 0) - (b.order || 0));
export const tags = () => ofType('tag').slice().sort((a, b) => a.name.localeCompare(b.name));
export const trashed = () => [...S.items.values()].filter((i) => i.deletedAt).sort((a, b) => b.deletedAt - a.deletedAt);

export const titleOf = (it) => (it ? (it.type === 'folder' || it.type === 'tag' ? it.name : it.title) || (it.type === 'note' ? 'Untitled note' : it.type === 'event' ? 'Untitled event' : 'Untitled') : '');
export const liveTags = (it) => (it.tags || []).map(alive).filter(Boolean);
export const folderOf = (it) => (it.folderId ? alive(it.folderId) : null);
export const isDone = (t) => t.status === 'done';
export const taskDate = (t) => (t.when && t.when.kind === 'day' ? t.when.date : null);
export const subtasks = (id) => tasks().filter((t) => t.parentId === id).sort((a, b) => (a.order || 0) - (b.order || 0));
export const byOrder = (a, b) => (a.order || 0) - (b.order || 0);

export function isOverdue(t, T = D.today()) {
  if (isDone(t)) return false;
  if (t.deadline && t.deadline < T) return true;
  const d = taskDate(t);
  return !!(d && d < T);
}
export function isTodayTask(t, T = D.today()) {
  if (isDone(t)) return false;
  const d = taskDate(t);
  return !!((d && d <= T) || (t.deadline && t.deadline <= T));
}
export const isInbox = (t) => !isDone(t) && !t.when && !t.deadline && !t.folderId && !t.parentId;

export function sortTasks(list) {
  return list.slice().sort((a, b) => {
    if (isDone(a) !== isDone(b)) return isDone(a) ? 1 : -1;
    const da = taskDate(a) || a.deadline || '9999', db_ = taskDate(b) || b.deadline || '9999';
    if (da !== db_) return da < db_ ? -1 : 1;
    const ta = (a.when && a.when.time) || '99', tb = (b.when && b.when.time) || '99';
    if (ta !== tb) return ta < tb ? -1 : 1;
    if ((b.priority || 0) !== (a.priority || 0)) return (b.priority || 0) - (a.priority || 0);
    return (a.order || 0) - (b.order || 0);
  });
}

export function blocksText(blocks) {
  if (!Array.isArray(blocks)) return '';
  return blocks.map((b) => {
    if (b.type === 'table') return (b.rows || []).map((r) => r.map(stripHtml).join(' ')).join(' ');
    if (b.type === 'task') { const t = alive(b.ref); return t ? t.title : ''; }
    return stripHtml(b.html || b.caption || '');
  }).filter(Boolean).join('\n');
}

const textCache = new Map();
export function itemText(it) {
  const hit = textCache.get(it.id);
  if (hit && hit.u === it.updatedAt) return hit.t;
  const t = [titleOf(it), it.location || '', blocksText(it.blocks || it.notes)].join(' \n');
  textCache.set(it.id, { u: it.updatedAt, t });
  return t;
}

export function backlinks(id) {
  const res = [];
  const needle = `data-ref="${id}"`;
  for (const it of S.items.values()) {
    if (it.deletedAt || it.id === id) continue;
    if ((it.links || []).includes(id)) { res.push(it); continue; }
    const blocks = it.blocks || it.notes;
    if (Array.isArray(blocks) && blocks.some((b) => b.ref === id || (b.html && b.html.includes(needle)) || (b.rows && JSON.stringify(b.rows).includes(id)))) res.push(it);
  }
  return res;
}

export function relatedItems(it) {
  const set = new Map();
  (it.links || []).map(alive).filter(Boolean).forEach((x) => set.set(x.id, x));
  backlinks(it.id).forEach((x) => set.set(x.id, x));
  return [...set.values()];
}

export function link(aId, bId) {
  const a = get(aId); if (!a || aId === bId) return;
  if ((a.links || []).includes(bId)) return;
  update(aId, { links: [...(a.links || []), bId] });
}
export function unlink(aId, bId) {
  const a = get(aId); const b = get(bId);
  if (a && (a.links || []).includes(bId)) update(aId, { links: a.links.filter((x) => x !== bId) });
  if (b && (b.links || []).includes(aId)) update(bId, { links: b.links.filter((x) => x !== aId) });
}

export function itemsInFolder(fid) { return [...tasks(), ...notes(), ...events()].filter((i) => i.folderId === fid); }
export function itemsWithTag(tid) { return [...tasks(), ...notes(), ...events()].filter((i) => (i.tags || []).includes(tid)); }

export function findOrCreateTag(name) {
  const n = name.trim().replace(/^#/, '');
  if (!n) return null;
  const ex = tags().find((t) => t.name.toLowerCase() === n.toLowerCase());
  return ex || create('tag', { name: n });
}
export function findFolder(name) {
  const n = name.trim().replace(/^&/, '').replace(/[-_]/g, ' ').toLowerCase();
  return folders().find((f) => f.name.toLowerCase() === n) || folders().find((f) => f.name.toLowerCase().startsWith(n)) || null;
}
export function findOrCreateFolder(name) { return findFolder(name) || create('folder', { name: name.trim().replace(/^&/, '') }); }

/* ---------------- tasks & habits ---------------- */

export function nextHabitDate(t, T = D.today()) {
  const r = { ...t.repeat, anchor: t.repeat.anchor || taskDate(t) || T };
  const st = D.habitStats({ ...t, repeat: r }, T);
  let cur = D.occursOn(r, T) ? T : D.nextOccurrence(r, T);
  if (st && st.currentDone && cur) cur = D.nextOccurrence(r, cur);
  return cur;
}

function shiftReminder(t, newDate) {
  if (!t.reminder || !newDate || !taskDate(t)) return t.reminder;
  const delta = D.diffDays(taskDate(t), newDate);
  return D.addDays(t.reminder.slice(0, 10), delta) + t.reminder.slice(10);
}

export function toggleTask(id) {
  const t = get(id); if (!t) return;
  const T = D.today();
  if (t.repeat) {
    const st = D.habitStats(t, T);
    const comps = new Set(t.completions || []);
    if (st && (st.doneToday)) comps.delete(T); else comps.add(T);
    const nt = { ...t, completions: [...comps].sort(), updatedAt: Date.now() };
    const next = nextHabitDate(nt, T);
    const r = update(id, { completions: nt.completions, when: next ? { ...(t.when || {}), kind: 'day', date: next } : t.when, reminder: shiftReminder(t, next), reminderFired: false });
    const s2 = D.habitStats(r, T);
    if (comps.has(T) && s2) toast(s2.streak > 1 ? `🔥 Streak: ${s2.streak} in a row — keep it going!` : '🔥 Streak started!');
    return;
  }
  if (isDone(t)) update(id, { status: 'todo', completedAt: null });
  else {
    undoable(`Completed “${titleOf(t)}”`, [id], () => update(id, { status: 'done', completedAt: Date.now() }));
  }
}

export function toggleHabitDay(id, date) {
  const t = get(id); if (!t || !t.repeat) return;
  const comps = new Set(t.completions || []);
  if (comps.has(date)) comps.delete(date); else comps.add(date);
  const nt = { ...t, completions: [...comps].sort(), updatedAt: Date.now() };
  const next = nextHabitDate(nt);
  update(id, { completions: nt.completions, when: next ? { ...(t.when || {}), kind: 'day', date: next } : t.when, reminder: shiftReminder(t, next) });
}

/** Missed habit occurrences roll forward to the next one on load. */
function rollHabits() {
  const T = D.today();
  for (const t of tasks()) {
    if (!t.repeat || isDone(t)) continue;
    const d = taskDate(t);
    if (d && d < T) {
      const next = nextHabitDate(t, T);
      if (next && next !== d) {
        S.items.set(t.id, { ...t, when: { ...t.when, date: next }, reminder: shiftReminder(t, next), reminderFired: false });
        markDirty(t.id);
      }
    }
  }
}

/* ---------------- events ---------------- */

export function eventDays(ev) {
  const s = ev.start.slice(0, 10);
  let e = (ev.end || ev.start).slice(0, 10);
  if (!ev.allDay && ev.end && ev.end.slice(11) === '00:00' && e > s) e = D.addDays(e, -1);
  if (e < s) e = s;
  const out = [];
  for (let d = s, i = 0; d <= e && i < 60; d = D.addDays(d, 1), i++) out.push(d);
  return out;
}

export function eventColor(ev) {
  if (ev.color) return ev.color;
  const f = folderOf(ev); if (f && f.color) return f.color;
  const t = liveTags(ev)[0]; if (t && t.color) return t.color;
  return 'var(--accent)';
}

/** Local events + in-memory Google events (minus ones that mirror local events). */
export function allEvents() {
  const local = events();
  const mirrored = new Set(local.map((e) => e.googleId).filter(Boolean));
  return [...local, ...S.google.events.filter((g) => !mirrored.has(g.googleId))];
}
export function eventsOn(date) {
  return allEvents().filter((e) => eventDays(e).includes(date)).sort((a, b) => (a.allDay === b.allDay ? (a.start < b.start ? -1 : 1) : a.allDay ? -1 : 1));
}
export const findEvent = (id) => alive(id) || S.google.events.find((g) => g.id === id) || null;

/* ------------------------------------------------------------------ */
/* Attachments                                                          */
/* ------------------------------------------------------------------ */

export const MAX_ATTACHMENT = 100 * 1024 * 1024;
export async function storeFile(file) {
  if (file.size > MAX_ATTACHMENT) throw new Error(`“${file.name}” is larger than 100 MB.`);
  const id = uid('f');
  await db.putFile({ id, blob: file, name: file.name, type: file.type, size: file.size, addedAt: Date.now() });
  return { id, name: file.name, type: file.type, size: file.size, addedAt: Date.now() };
}
export async function addAttachments(itemId, files) {
  for (const f of files) {
    try {
      const meta = await storeFile(f);
      update(itemId, (it) => ({ attachments: [...(it.attachments || []), meta] }));
    } catch (e) { toast(e.message, { kind: 'error' }); }
  }
}
export async function removeAttachment(itemId, fileId) {
  update(itemId, (it) => ({ attachments: (it.attachments || []).filter((a) => a.id !== fileId) }));
  await db.deleteFile(fileId).catch(() => {});
}
const urlCache = new Map();
export async function fileURL(fileId) {
  if (!fileId) return null;
  if (urlCache.has(fileId)) return urlCache.get(fileId);
  const rec = await db.getFile(fileId);
  if (!rec) return null;
  const u = URL.createObjectURL(rec.blob);
  urlCache.set(fileId, u);
  return u;
}
export const getFileRecord = (id) => db.getFile(id);

/* ------------------------------------------------------------------ */
/* Routing + UI                                                         */
/* ------------------------------------------------------------------ */

export function parseHash() {
  const h = (typeof location !== 'undefined' ? location.hash : '').replace(/^#\/?/, '');
  const [view, id, sub] = h.split('/');
  return { view: view || S.settings.startView || 'today', id: id ? decodeURIComponent(id) : null, sub: sub || null };
}
export function navigate(view, id = null, sub = null) {
  const h = '#/' + view + (id ? '/' + encodeURIComponent(id) : '') + (sub ? '/' + sub : '');
  if (location.hash !== h) location.hash = h;
  else { S.ui.route = parseHash(); emit(); }
  S.ui.sidebarOpen = false;
}
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    const prev = S.ui.route;
    S.ui.route = parseHash();
    if (prev && prev.view !== S.ui.route.view) S.ui.detail = null;
    emit();
  });
}

export function openItem(id) {
  const it = findEvent(id) || get(id);
  if (!it) return;
  if (it.type === 'note') { S.ui.detail = null; navigate('notes', id); }
  else if (it.type === 'folder') navigate('folder', id);
  else if (it.type === 'tag') navigate('tag', id);
  else { S.ui.detail = { id }; emit(); }
}
export function closeDetail() { S.ui.detail = null; emit(); }
export function setUI(patch) { Object.assign(S.ui, patch); emit(); }

/* ---------------- toasts & overlays ---------------- */

export function toast(message, { action = null, timeout = 4500, kind = 'info' } = {}) {
  const t = { id: uid('t'), message, action, kind };
  S.toasts = [...S.toasts, t].slice(-4);
  emit();
  setTimeout(() => dismissToast(t.id), timeout);
  return t.id;
}
export function dismissToast(id) { S.toasts = S.toasts.filter((t) => t.id !== id); emit(); }

export function openPopover(anchor, render, opts = {}) {
  const rect = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : anchor;
  S.overlay.popover = { id: uid('p'), rect, render, ...opts };
  emit();
}
export function closePopover() { if (S.overlay.popover) { const p = S.overlay.popover; S.overlay.popover = null; p.onClose && p.onClose(); emit(); } }

export function openModal(render, opts = {}) {
  const m = { id: uid('m'), render, ...opts };
  S.overlay.modals = [...S.overlay.modals, m];
  emit();
  return m.id;
}
export function closeModal(id) {
  const m = S.overlay.modals.find((x) => x.id === id);
  S.overlay.modals = S.overlay.modals.filter((x) => x.id !== id);
  if (m && m.onClose) m.onClose();
  emit();
}
export function closeTopModal() { const m = S.overlay.modals[S.overlay.modals.length - 1]; if (m) { closeModal(m.id); return true; } return false; }
