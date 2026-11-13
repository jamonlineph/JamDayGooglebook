// Quick tokens for fast capture:  #tag  &folder  @date  +person  !priority
import * as D from './dates.js';
import { S, tags, folders, findFolder, findOrCreateTag, findOrCreateFolder, create, PRIORITIES } from './store.js';
import { fuzzy } from './lib.js';

const WORD = '[\\p{L}\\p{N}_\\-/.]+';

export function parseQuick(text, { natural = false } = {}) {
  let s = ' ' + (text || '') + ' ';
  const res = { tagNames: [], folderName: null, priority: null, people: [], parsed: null };

  s = s.replace(new RegExp(`(^|\\s)#("([^"]+)"|${WORD})`, 'gu'), (m, sp, raw, q) => { res.tagNames.push((q || raw).replace(/[.]$/, '')); return sp; });
  s = s.replace(new RegExp(`(^|\\s)&("([^"]+)"|${WORD})`, 'gu'), (m, sp, raw, q) => { res.folderName = q || raw; return sp; });
  s = s.replace(/(^|\s)\+([\p{L}][\p{L}\p{N}_\-.]*)/gu, (m, sp, n) => { res.people.push(n); return sp; });
  s = s.replace(/(^|\s)!(urgent|high|medium|med|low|[1-4]|!{0,3})(?=\s)/gi, (m, sp, p) => {
    // !  = medium, !! = high, !!! = urgent; !1 (low) … !4 (urgent); or the word
    const map = { urgent: 4, high: 3, medium: 2, med: 2, low: 1, 4: 4, 3: 3, 2: 2, 1: 1, '': 2, '!': 3, '!!': 4 };
    res.priority = map[p.toLowerCase()] ?? 2;
    return sp;
  });

  const opts = { weekStart: S.settings.weekStart };
  if (natural) {
    const p = D.parseNatural(s, opts);
    if (p.found) { res.parsed = p; s = p.rest; }
  } else {
    // @date — everything after @ up to the next token marker; unparsed words go back to the title
    s = s.replace(/(^|\s)@("([^"]+)"|[^#&+!@]*)/u, (m, sp, raw, q) => {
      const p = D.parseNatural(q || raw, opts);
      if (p.found) { res.parsed = p; return sp + p.rest + ' '; }
      const first = (q || raw).trim().split(/\s+/)[0];
      if (first) { res.people.push(first); return sp + (q || raw).trim().slice(first.length) + ' '; }
      return sp;
    });
  }
  res.title = s.replace(/\s+/g, ' ').trim();
  return res;
}

export function whenFromParsed(p) {
  if (!p || !p.kind) return null;
  if (p.kind === 'someday') return { kind: 'someday' };
  if (p.kind === 'day') return { kind: 'day', date: p.date, time: p.time || null };
  return { kind: p.kind, date: p.date };
}

export function chipsFor(q) {
  const chips = [];
  if (q.parsed && q.parsed.found) chips.push({ icon: q.parsed.repeat ? 'repeat' : 'calendar', label: D.describeParse(q.parsed, { timeFmt: S.settings.timeFormat, weekStart: S.settings.weekStart }) });
  q.tagNames.forEach((t) => chips.push({ icon: 'tag', label: t }));
  if (q.folderName) { const f = findFolder(q.folderName); chips.push({ icon: 'folder', label: f ? f.name : q.folderName + ' (new)' }); }
  if (q.priority) chips.push({ icon: 'flag', label: PRIORITIES[q.priority].label, kind: 'p' + q.priority });
  q.people.forEach((p) => chips.push({ icon: 'user', label: p }));
  return chips;
}

/** Create a task from a quick-add string; `defaults` come from the current view. */
export function createTaskFromText(text, defaults = {}) {
  const q = parseQuick(text);
  if (!q.title && !q.parsed) return null;
  const data = { ...defaults, title: q.title || 'New task' };
  if (q.tagNames.length) data.tags = [...new Set([...(defaults.tags || []), ...q.tagNames.map((n) => findOrCreateTag(n).id)])];
  if (q.folderName) data.folderId = findOrCreateFolder(q.folderName).id;
  if (q.priority) data.priority = q.priority;
  if (q.people.length) data.people = q.people;
  const w = whenFromParsed(q.parsed);
  if (w) data.when = w;
  if (q.parsed && q.parsed.repeat) data.repeat = { ...q.parsed.repeat, anchor: w && w.date ? w.date : D.today() };
  if (w && w.time) data.reminder = w.date + 'T' + w.time;
  return create('task', data);
}

/** Create an event from text like "Lunch with Ana tomorrow 12-1pm &Work #social". */
export function createEventFromText(text, defaults = {}) {
  const q = parseQuick(text, { natural: true });
  const p = q.parsed;
  const data = { ...defaults, title: q.title || 'New event' };
  if (q.tagNames.length) data.tags = q.tagNames.map((n) => findOrCreateTag(n).id);
  if (q.folderName) data.folderId = findOrCreateFolder(q.folderName).id;
  if (p && p.kind === 'day') {
    if (p.time) {
      data.start = p.date + 'T' + p.time;
      data.end = p.endTime ? p.date + 'T' + p.endTime : D.addMinutesDT(data.start, 60);
      if (data.end <= data.start) data.end = D.addMinutesDT(data.start, 60);
      data.allDay = false;
    } else {
      data.start = p.date + 'T00:00'; data.end = p.date + 'T00:00'; data.allDay = true;
    }
  }
  return create('event', data);
}

/* ---------------- autocomplete ---------------- */

const DATE_SUGGESTIONS = ['today', 'tomorrow', 'tonight', 'this weekend', 'next week', 'this week', 'this month', 'next month', 'someday',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'next monday', 'in 3 days', 'in 2 weeks',
  'every day', 'every weekday', 'every week', 'every month'];

export function tokenAt(value, caret) {
  const before = value.slice(0, caret);
  const m = /(^|\s)([#&@+!])([^\s#&@+!]*)$/u.exec(before);
  if (!m) return null;
  return { char: m[2], query: m[3], start: caret - m[3].length - 1, end: caret };
}

export function suggestionsFor(tok) {
  if (!tok) return [];
  const q = tok.query.toLowerCase();
  const rank = (arr, key) => arr.map((x) => ({ x, s: q ? fuzzy(q, key(x)) : 1 })).filter((r) => r.s >= 0).sort((a, b) => b.s - a.s).slice(0, 7).map((r) => r.x);
  if (tok.char === '#') {
    const list = rank(tags(), (t) => t.name).map((t) => ({ label: '#' + t.name, insert: '#' + (t.name.includes(' ') ? `"${t.name}"` : t.name), color: t.color }));
    if (q && !tags().some((t) => t.name.toLowerCase() === q)) list.push({ label: `Create tag “${tok.query}”`, insert: '#' + tok.query });
    return list;
  }
  if (tok.char === '&') {
    const list = rank(folders(), (f) => f.name).map((f) => ({ label: f.name, insert: '&' + (f.name.includes(' ') ? `"${f.name}"` : f.name), color: f.color, icon: 'folder' }));
    if (q && !folders().some((f) => f.name.toLowerCase() === q)) list.push({ label: `Create folder “${tok.query}”`, insert: '&' + tok.query, icon: 'folder' });
    return list;
  }
  if (tok.char === '@') {
    return rank(DATE_SUGGESTIONS, (x) => x).map((x) => {
      const p = D.parseNatural(x, { weekStart: S.settings.weekStart });
      return { label: x, hint: D.describeParse(p, { timeFmt: S.settings.timeFormat }), insert: '@' + x, icon: 'calendar' };
    });
  }
  if (tok.char === '!') {
    return PRIORITIES.slice(1).reverse().map((p) => ({ label: p.label, insert: '!' + p.label.toLowerCase(), icon: 'flag', kind: 'p' + p.v })).filter((p) => !q || p.label.toLowerCase().startsWith(q));
  }
  return [];
}
