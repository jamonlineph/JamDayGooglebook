// Date utilities, plain-language date parsing, repeat rules and habit streaks.
// Dates are local "YYYY-MM-DD" strings; date-times are local "YYYY-MM-DDTHH:MM".

export const DAY_MS = 86400000;
export const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MON_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const pad = (n) => String(n).padStart(2, '0');
export const ds = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
export function pd(s) {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}
export const today = () => ds(new Date());
export function addDays(s, n) { const d = pd(s); d.setDate(d.getDate() + n); return ds(d); }
export const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
export function addMonths(s, n) {
  const d = pd(s); const day = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, daysInMonth(d.getFullYear(), d.getMonth())));
  return ds(d);
}
export const dow = (s) => pd(s).getDay();
export function startOfWeek(s, weekStart = 1) { return addDays(s, -((dow(s) - weekStart + 7) % 7)); }
export const startOfMonth = (s) => s.slice(0, 8) + '01';
export function endOfMonth(s) { const d = pd(s); return ds(new Date(d.getFullYear(), d.getMonth() + 1, 0)); }
export const diffDays = (a, b) => Math.round((pd(b) - pd(a)) / DAY_MS); // b - a
export const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][((n % 100) - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');

export const dtStr = (d) => ds(d) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
export function parseDT(s) {
  if (!s) return null;
  const [a, b = '00:00'] = s.split('T');
  const [y, m, d] = a.split('-').map(Number);
  const [hh, mm] = b.split(':').map(Number);
  return new Date(y, m - 1, d, hh || 0, mm || 0);
}
export function addMinutesDT(s, mins) { const d = parseDT(s); d.setMinutes(d.getMinutes() + mins); return dtStr(d); }
export const hhmm = (d) => pad(d.getHours()) + ':' + pad(d.getMinutes());
export const minutesOf = (t) => { if (!t) return 0; const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
export const fromMinutes = (mins) => pad(Math.floor(mins / 60) % 24) + ':' + pad(mins % 60);
export function nowRounded(step = 30) {
  const d = new Date(); d.setSeconds(0, 0);
  d.setMinutes(Math.ceil(d.getMinutes() / step) * step);
  return d;
}

export function fmtTime(t, fmt = '12') {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  if (fmt === '24') return pad(h) + ':' + pad(m);
  const ap = h < 12 ? 'AM' : 'PM';
  const hh = h % 12 || 12;
  return m ? `${hh}:${pad(m)} ${ap}` : `${hh} ${ap}`;
}

export function fmtDate(s, { weekday = false, long = false, year = 'auto' } = {}) {
  if (!s) return '';
  const d = pd(s);
  const showYear = year === true || (year === 'auto' && d.getFullYear() !== new Date().getFullYear());
  const mon = long ? MON_LONG[d.getMonth()] : MON_SHORT[d.getMonth()];
  const wd = weekday ? (long ? DOW_LONG : DOW_SHORT)[d.getDay()] + ', ' : '';
  return `${wd}${mon} ${d.getDate()}${showYear ? ', ' + d.getFullYear() : ''}`;
}

export function relDay(s, base = today()) {
  if (!s) return '';
  const d = diffDays(base, s);
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d === -1) return 'Yesterday';
  if (d > 1 && d < 7) return DOW_LONG[dow(s)];
  return fmtDate(s);
}

export function monthTitle(s) { const d = pd(s); return MON_LONG[d.getMonth()] + ' ' + d.getFullYear(); }

/** Label for a task's "when" value. */
export function whenLabel(when, { weekStart = 1, timeFmt = '12' } = {}) {
  if (!when) return '';
  const t = today();
  if (when.kind === 'someday') return 'Someday';
  if (when.kind === 'week') {
    const w = startOfWeek(t, weekStart);
    if (when.date === w) return 'This week';
    if (when.date === addDays(w, 7)) return 'Next week';
    if (when.date < w) return 'Week of ' + fmtDate(when.date);
    return 'Week of ' + fmtDate(when.date);
  }
  if (when.kind === 'month') {
    const m = startOfMonth(t);
    if (when.date === m) return 'This month';
    if (when.date === addMonths(m, 1)) return 'Next month';
    const d = pd(when.date);
    return MON_LONG[d.getMonth()] + (d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : '');
  }
  return relDay(when.date) + (when.time ? ' ' + fmtTime(when.time, timeFmt) : '');
}

/* ------------------------------------------------------------------ */
/* Plain-language parsing                                               */
/* ------------------------------------------------------------------ */

const DOW_RE = '(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:s|nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)';
const MON_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const NUM_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const dowIdx = (w) => ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(w.slice(0, 3));
const monIdx = (w) => ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(w.slice(0, 3));
const num = (w) => (NUM_WORDS[w] != null ? NUM_WORDS[w] : parseInt(w, 10));
const B = '(?<![\\w])';
const E = '(?![\\w])';

function to24(h, m, ap) {
  h = parseInt(h, 10); m = parseInt(m || '0', 10);
  if (h > 23 || m > 59) return null;
  if (ap) {
    const p = ap[0] === 'p';
    if (h > 12) return null;
    if (p && h < 12) h += 12;
    if (!p && h === 12) h = 0;
  }
  return pad(h) + ':' + pad(m);
}

/**
 * Parse phrases like "tomorrow 3pm", "next fri", "in 2 weeks", "nov 20", "this week",
 * "someday", "every weekday at 7", "3-4pm". Returns the matched pieces and the rest of the text.
 */
export function parseNatural(input, { base = new Date(), weekStart = 1 } = {}) {
  let src = ' ' + (input || '') + ' ';
  let low = src.toLowerCase();
  if (low.length !== src.length) low = src;
  const T = ds(base);
  const out = { date: null, time: null, endTime: null, kind: null, repeat: null, matched: [] };

  const take = (re, fn) => {
    const m = new RegExp(re, 'i').exec(low);
    if (!m) return false;
    if (fn(m) === false) return false;
    const a = m.index, b = m.index + m[0].length;
    out.matched.push(src.slice(a, b).trim());
    src = src.slice(0, a) + ' '.repeat(b - a) + src.slice(b);
    low = low.slice(0, a) + ' '.repeat(b - a) + low.slice(b);
    return true;
  };

  // ---- repeat ----
  take(`${B}(?:every|each)\\s+(other\\s+|\\d+\\s+)?(day|days|weekday|weekdays|weekend|weekends|week|weeks|month|months|year|years)(?:\\s+on\\s+(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?)?${E}`, (m) => {
    const iv = m[1] ? (m[1].trim() === 'other' ? 2 : parseInt(m[1], 10)) : 1;
    const u = m[2];
    if (u.startsWith('weekday')) out.repeat = { freq: 'week', interval: 1, days: [1, 2, 3, 4, 5] };
    else if (u.startsWith('weekend')) out.repeat = { freq: 'week', interval: 1, days: [0, 6] };
    else if (u.startsWith('day')) out.repeat = { freq: 'day', interval: iv };
    else if (u.startsWith('week')) out.repeat = { freq: 'week', interval: iv };
    else if (u.startsWith('month')) out.repeat = { freq: 'month', interval: iv, monthDay: m[3] ? parseInt(m[3], 10) : undefined };
    else out.repeat = { freq: 'year', interval: iv };
  }) ||
  take(`${B}(?:every|each)\\s+(?:(other|\\d+)\\s+weeks?\\s+on\\s+)?(${DOW_RE}(?:\\s*(?:,|and|&|/)\\s*${DOW_RE})*)${E}`, (m) => {
    const days = [...new Set(m[2].split(/\s*(?:,|and|&|\/)\s*/).map(dowIdx).filter((x) => x >= 0))].sort();
    const iv = m[1] ? (m[1] === 'other' ? 2 : parseInt(m[1], 10)) : 1;
    out.repeat = { freq: 'week', interval: iv, days };
  }) ||
  take(`${B}(daily|weekly|biweekly|monthly|yearly|annually|weekdays)${E}`, (m) => {
    const w = m[1];
    out.repeat = w === 'daily' ? { freq: 'day', interval: 1 }
      : w === 'weekly' ? { freq: 'week', interval: 1 }
      : w === 'biweekly' ? { freq: 'week', interval: 2 }
      : w === 'monthly' ? { freq: 'month', interval: 1 }
      : w === 'weekdays' ? { freq: 'week', interval: 1, days: [1, 2, 3, 4, 5] }
      : { freq: 'year', interval: 1 };
  });

  // ---- spans ----
  take(`${B}(someday|some day|eventually|sometime)${E}`, () => { out.kind = 'someday'; });
  if (!out.kind) {
    take(`${B}(?:later\\s+)?(this|next)\\s+(week|month)${E}`, (m) => {
      if (m[2] === 'week') { out.kind = 'week'; out.date = addDays(startOfWeek(T, weekStart), m[1] === 'next' ? 7 : 0); }
      else { out.kind = 'month'; out.date = m[1] === 'next' ? addMonths(startOfMonth(T), 1) : startOfMonth(T); }
    });
  }

  // ---- relative days ----
  const setDate = (d) => { out.date = d; out.kind = 'day'; };
  if (!out.kind) {
    take(`${B}(?:the\\s+)?day\\s+after\\s+tomorrow${E}`, () => setDate(addDays(T, 2))) ||
    take(`${B}(today|tdy)${E}`, () => setDate(T)) ||
    take(`${B}tonight${E}`, () => { setDate(T); out._tonight = true; }) ||
    take(`${B}(tomorrow|tmrw|tmr|tmw)${E}`, () => setDate(addDays(T, 1))) ||
    take(`${B}yesterday${E}`, () => setDate(addDays(T, -1))) ||
    take(`${B}in\\s+(\\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\\s+(days?|weeks?|months?|years?|hours?|hrs?|minutes?|mins?)${E}`, (m) => {
      const n = num(m[1]); const u = m[2];
      if (u.startsWith('h') || u.startsWith('min')) {
        const d = new Date(base.getTime() + n * (u.startsWith('h') ? 3600000 : 60000));
        d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5);
        setDate(ds(d)); out.time = hhmm(d);
      } else if (u.startsWith('d')) setDate(addDays(T, n));
      else if (u.startsWith('w')) setDate(addDays(T, n * 7));
      else if (u.startsWith('m')) setDate(addMonths(T, n));
      else setDate(addMonths(T, n * 12));
    }) ||
    take(`${B}(\\d+)\\s+(days?|weeks?)\\s+from\\s+(?:now|today)${E}`, (m) => setDate(addDays(T, parseInt(m[1], 10) * (m[2][0] === 'w' ? 7 : 1)))) ||
    take(`${B}(?:end\\s+of\\s+(?:the\\s+)?month|eom)${E}`, () => setDate(endOfMonth(T))) ||
    take(`${B}(?:end\\s+of\\s+(?:the\\s+)?week|eow)${E}`, () => { const fri = addDays(startOfWeek(T, 1), 4); setDate(fri < T ? addDays(fri, 7) : fri); }) ||
    take(`${B}(this\\s+|next\\s+)?weekend${E}`, (m) => {
      const sat = addDays(T, (6 - dow(T) + 7) % 7);
      if (m[1] && m[1].trim() === 'next') setDate(addDays(sat, 7));
      else setDate(dow(T) === 0 ? T : sat);
    });
  }

  // ---- absolute dates ----
  if (!out.kind) {
    const fixYear = (y, mo, d, explicitYear) => {
      if (mo < 0 || mo > 11 || d < 1 || d > daysInMonth(y, mo)) return null;
      let s = ds(new Date(y, mo, d));
      if (!explicitYear && s < T) s = ds(new Date(y + 1, mo, Math.min(d, daysInMonth(y + 1, mo))));
      return s;
    };
    const Y = base.getFullYear();
    take(`${B}(\\d{4})-(\\d{1,2})-(\\d{1,2})${E}`, (m) => { const r = fixYear(+m[1], +m[2] - 1, +m[3], true); if (!r) return false; setDate(r); }) ||
    take(`${B}(?:on\\s+)?(\\d{1,2})/(\\d{1,2})(?:/(\\d{2,4}))?${E}`, (m) => {
      let y = m[3] ? +m[3] : Y; if (y < 100) y += 2000;
      const r = fixYear(y, +m[1] - 1, +m[2], !!m[3]); if (!r) return false; setDate(r);
    }) ||
    take(`${B}(?:on\\s+)?${MON_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?${E}`, (m) => {
      const r = fixYear(m[3] ? +m[3] : Y, monIdx(m[1]), +m[2], !!m[3]); if (!r) return false; setDate(r);
    }) ||
    take(`${B}(?:on\\s+)?(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MON_RE}\\.?(?:,?\\s+(\\d{4}))?${E}`, (m) => {
      const r = fixYear(m[3] ? +m[3] : Y, monIdx(m[2]), +m[1], !!m[3]); if (!r) return false; setDate(r);
    }) ||
    take(`${B}(?:on\\s+)?the\\s+(\\d{1,2})(?:st|nd|rd|th)${E}`, (m) => {
      const d = +m[1]; if (d < 1 || d > 31) return false;
      let mo = base.getMonth(), y = Y;
      if (d < base.getDate()) { mo++; if (mo > 11) { mo = 0; y++; } }
      setDate(ds(new Date(y, mo, Math.min(d, daysInMonth(y, mo)))));
    }) ||
    take(`${B}(next\\s+|this\\s+|on\\s+|coming\\s+)?${DOW_RE}${E}`, (m) => {
      const target = dowIdx(m[2]);
      const mod = (m[1] || '').trim();
      let d;
      if (mod === 'next') d = addDays(startOfWeek(T, weekStart), 7 + ((target - weekStart + 7) % 7));
      else d = addDays(T, (target - dow(T) + 7) % 7);
      setDate(d);
    });
  }

  // ---- times ----
  take(`${B}(?:from\\s+)?(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm|a|p)?\\s*(?:-|–|to|until|till)\\s*(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm|a|p)${E}`, (m) => {
    const ap2 = m[6]; let ap1 = m[3] || ap2;
    let start = to24(m[1], m[2], ap1);
    const end = to24(m[4], m[5], ap2);
    if (!start || !end) return false;
    if (!m[3] && minutesOf(start) > minutesOf(end)) start = to24(m[1], m[2], ap1 === 'pm' || ap1 === 'p' ? 'am' : 'pm');
    out.time = start; out.endTime = end;
  }) ||
  take(`${B}(?:from\\s+)?([01]?\\d|2[0-3]):([0-5]\\d)\\s*(?:-|–|to|until)\\s*([01]?\\d|2[0-3]):([0-5]\\d)${E}`, (m) => {
    out.time = to24(m[1], m[2]); out.endTime = to24(m[3], m[4]);
  }) ||
  take(`${B}(?:at\\s+|@\\s*)?(\\d{1,2})(?::(\\d{2}))?\\s*(a\\.m\\.|p\\.m\\.|am|pm|a|p)${E}`, (m) => {
    const t = to24(m[1], m[2], m[3].replace(/\./g, '')); if (!t) return false; out.time = t;
  }) ||
  take(`${B}(?:at\\s+)?([01]?\\d|2[0-3]):([0-5]\\d)${E}`, (m) => { out.time = to24(m[1], m[2]); }) ||
  take(`${B}at\\s+(\\d{1,2})${E}`, (m) => {
    let h = +m[1]; if (h > 23) return false;
    if (h >= 1 && h <= 6) h += 12;
    out.time = pad(h) + ':00';
  }) ||
  take(`${B}(?:at\\s+)?(noon|midday|lunchtime)${E}`, () => { out.time = '12:00'; }) ||
  take(`${B}(?:at\\s+)?midnight${E}`, () => { out.time = '00:00'; }) ||
  take(`${B}(?:in\\s+the\\s+|this\\s+)?morning${E}`, () => { out.time = '09:00'; }) ||
  take(`${B}(?:in\\s+the\\s+|this\\s+)?afternoon${E}`, () => { out.time = '14:00'; }) ||
  take(`${B}(?:in\\s+the\\s+|this\\s+)?evening${E}`, () => { out.time = '18:00'; });

  if (out._tonight && !out.time) out.time = '20:00';
  delete out._tonight;
  if (out.time && !out.kind) { out.kind = 'day'; out.date = T; }
  if (out.repeat) {
    if (!out.date || out.kind !== 'day') {
      const anchor = T;
      const r = { ...out.repeat, anchor };
      out.date = occursOn(r, T) ? T : nextOccurrence(r, T);
      out.kind = 'day';
    }
    out.repeat.anchor = out.date;
  }
  out.rest = src.replace(/\s+/g, ' ').trim();
  out.found = out.matched.length > 0;
  return out;
}

/** Turn a parse result into a human label. */
export function describeParse(p, { timeFmt = '12', weekStart = 1 } = {}) {
  if (!p || !p.found) return '';
  const parts = [];
  if (p.kind) parts.push(p.kind === 'day' ? fmtDate(p.date, { weekday: true }) : whenLabel({ kind: p.kind, date: p.date }, { weekStart }));
  if (p.time) parts.push(fmtTime(p.time, timeFmt) + (p.endTime ? ' – ' + fmtTime(p.endTime, timeFmt) : ''));
  if (p.repeat) parts.push(describeRepeat(p.repeat));
  return parts.join(' · ');
}

/* ------------------------------------------------------------------ */
/* Repeat rules                                                         */
/* rule: { freq: 'day'|'week'|'month'|'year', interval, days?, monthDay?, anchor } */
/* ------------------------------------------------------------------ */

export function occursOn(rule, d) {
  if (!rule) return false;
  const a = rule.anchor || d;
  if (d < a) return false;
  const iv = Math.max(1, rule.interval || 1);
  switch (rule.freq) {
    case 'day': return diffDays(a, d) % iv === 0;
    case 'week': {
      const days = rule.days && rule.days.length ? rule.days : [dow(a)];
      if (!days.includes(dow(d))) return false;
      if (iv === 1) return true;
      const w = Math.round(diffDays(startOfWeek(a, 0), startOfWeek(d, 0)) / 7);
      return w % iv === 0;
    }
    case 'month': {
      const md = rule.monthDay || pd(a).getDate();
      const dd = pd(d);
      if (dd.getDate() !== Math.min(md, daysInMonth(dd.getFullYear(), dd.getMonth()))) return false;
      const ad = pd(a);
      return ((dd.getFullYear() - ad.getFullYear()) * 12 + dd.getMonth() - ad.getMonth()) % iv === 0;
    }
    case 'year': {
      const ad = pd(a), dd = pd(d);
      if (ad.getMonth() !== dd.getMonth()) return false;
      if (dd.getDate() !== Math.min(ad.getDate(), daysInMonth(dd.getFullYear(), dd.getMonth()))) return false;
      return (dd.getFullYear() - ad.getFullYear()) % iv === 0;
    }
    default: return false;
  }
}

export function nextOccurrence(rule, after, limit = 1500) {
  let d = addDays(after, 1);
  if (rule.anchor && d < rule.anchor) d = rule.anchor;
  for (let i = 0; i < limit; i++) { if (occursOn(rule, d)) return d; d = addDays(d, 1); }
  return null;
}

export function prevOccurrence(rule, before, limit = 1500) {
  let d = addDays(before, -1);
  for (let i = 0; i < limit; i++) {
    if (rule.anchor && d < rule.anchor) return null;
    if (occursOn(rule, d)) return d;
    d = addDays(d, -1);
  }
  return null;
}

export function occurrencesBetween(rule, from, to, max = 500) {
  const res = [];
  let d = from < (rule.anchor || from) ? rule.anchor : from;
  for (let i = 0; d <= to && i < 1000 && res.length < max; i++) {
    if (occursOn(rule, d)) res.push(d);
    d = addDays(d, 1);
  }
  return res;
}

export function describeRepeat(rule) {
  if (!rule) return '';
  const iv = rule.interval || 1;
  const anchor = rule.anchor || today();
  switch (rule.freq) {
    case 'day': return iv === 1 ? 'Every day' : `Every ${iv} days`;
    case 'week': {
      const days = (rule.days && rule.days.length ? rule.days : [dow(anchor)]).slice().sort();
      if (days.length === 7 && iv === 1) return 'Every day';
      if (iv === 1 && days.join() === '1,2,3,4,5') return 'Every weekday';
      if (iv === 1 && days.join() === '0,6') return 'Every weekend';
      const names = days.map((d) => DOW_SHORT[d]).join(', ');
      return iv === 1 ? `Every ${names}` : iv === 2 ? `Every other week on ${names}` : `Every ${iv} weeks on ${names}`;
    }
    case 'month': {
      const md = rule.monthDay || pd(anchor).getDate();
      return `Every ${iv > 1 ? iv + ' months' : 'month'} on the ${ordinal(md)}`;
    }
    case 'year': {
      const d = pd(anchor);
      return `Every ${iv > 1 ? iv + ' years' : 'year'} on ${MON_SHORT[d.getMonth()]} ${d.getDate()}`;
    }
    default: return '';
  }
}

/* ------------------------------------------------------------------ */
/* Habit stats                                                          */
/* A scheduled occurrence o is satisfied by any completion c where      */
/* previousOccurrence(o) < c <= o (so finishing early still counts).    */
/* ------------------------------------------------------------------ */

const statsCache = new Map();

export function habitStats(task, T = today()) {
  const rule = task.repeat;
  if (!rule) return null;
  const key = T + '|' + task.updatedAt;
  const hit = statsCache.get(task.id);
  if (hit && hit.key === key) return hit.value;

  const comps = [...new Set(task.completions || [])].sort();
  const hasIn = (a, b) => {
    // binary search for first completion > a
    let lo = 0, hi = comps.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (comps[mid] > a) hi = mid; else lo = mid + 1; }
    return lo < comps.length && comps[lo] <= b;
  };
  const r = { ...rule, anchor: rule.anchor || (comps[0] || T) };
  if (comps[0] && comps[0] < r.anchor) r.anchor = comps[0];

  const cur = occursOn(r, T) ? T : nextOccurrence(r, T);
  let streak = 0, best = 0, curDone = false;
  if (cur) {
    const prev = prevOccurrence(r, cur);
    curDone = hasIn(prev || '0000-00-00', cur);
    if (curDone) streak++;
    let o = prev, steps = 0;
    while (o && steps++ < 500) {
      const p = prevOccurrence(r, o);
      if (hasIn(p || '0000-00-00', o)) { streak++; o = p; } else break;
    }
    // best streak, walking forward from the anchor
    let run = 0, p = null, d = occursOn(r, r.anchor) ? r.anchor : nextOccurrence(r, r.anchor);
    for (let i = 0; d && d <= cur && i < 1200; i++) {
      if (hasIn(p || '0000-00-00', d)) { run++; best = Math.max(best, run); }
      else if (d < cur) run = 0;
      p = d; d = nextOccurrence(r, d);
    }
  }
  best = Math.max(best, streak);

  // completion rate over the last 30 days of scheduled occurrences
  const from = addDays(T, -29);
  const occ = occurrencesBetween(r, from < r.anchor ? r.anchor : from, T);
  let done = 0;
  for (const o of occ) { const p = prevOccurrence(r, o); if (hasIn(p || '0000-00-00', o)) done++; }
  const rate = occ.length ? Math.round((done / occ.length) * 100) : 0;

  const value = { streak, best, rate, doneToday: comps.includes(T), currentDone: curDone, next: cur };
  statsCache.set(task.id, { key, value });
  return value;
}
