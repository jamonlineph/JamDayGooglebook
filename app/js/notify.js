// Local reminders: task reminders, event alerts, habit nudges and a daily summary.
// In a browser they fire while JamDay is open. In the Android app they are also handed to
// Android's alarm service, so they fire even when the app is closed. Nothing leaves the device.
import { S, tasks, allEvents, isDone, taskDate, isTodayTask, eventsOn, openItem, toast, subscribe } from './store.js';
import { android } from './lib.js';
import * as D from './dates.js';

let fired;
try { fired = new Set(JSON.parse(localStorage.getItem('jd.fired') || '[]')); } catch { fired = new Set(); }
function mark(key) {
  fired.add(key);
  try { localStorage.setItem('jd.fired', JSON.stringify([...fired].slice(-600))); } catch { /* ignore */ }
}

export const notificationsSupported = () => !!android() || typeof Notification !== 'undefined';

/** 'granted' | 'denied' | 'default' | 'unsupported' */
export function permissionState() {
  const b = android();
  if (b) { try { return b.notificationPermission(); } catch { return 'default'; } }
  return typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
}

export async function requestPermission() {
  const b = android();
  if (b) {
    if (permissionState() === 'granted') return 'granted';
    return new Promise((resolve) => {
      const done = (state) => { window.jamdayPermissionResult = null; resolve(state); };
      window.jamdayPermissionResult = done;
      b.requestNotificationPermission();
      setTimeout(() => window.jamdayPermissionResult === done && done(permissionState()), 30000);
    });
  }
  if (!notificationsSupported()) return 'unsupported';
  return Notification.requestPermission();
}

export async function show(title, body, id, key) {
  const n = S.settings.notifications;
  const granted = permissionState() === 'granted';
  if (n.inApp || !granted || !document.hidden) {
    toast(`🔔 ${title}${body ? ' — ' + body : ''}`, { action: id ? { label: 'Open', run: () => openItem(id) } : null, timeout: 10000 });
  }
  if (!granted) return;
  const b = android();
  if (b) { b.showNotification(key || id || title, title, body || '', id || ''); return; }
  const opts = { body, tag: key || id || title, icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', data: { id } };
  try {
    const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
    if (reg) await reg.showNotification(title, opts); else new Notification(title, opts);
  } catch (e) { console.warn('Notification failed', e); }
}

/* ---------------- what each reminder says ---------------- */

const taskBody = (t) => (t.deadline ? 'Due ' + D.relDay(t.deadline) : t.when ? D.whenLabel(t.when) : 'Reminder');
const eventLead = (e) => (e.source === 'google' ? S.settings.notifications.eventLead : e.reminder);
const eventBody = (e, lead) => (lead ? `Starts in ${lead >= 60 ? Math.round(lead / 60) + ' h' : lead + ' min'}` : 'Starting now') + (e.location ? ' · ' + e.location : '');
function habitBody(day) {
  const pending = tasks().filter((t) => t.repeat && !isDone(t) && taskDate(t) === day);
  return pending.length ? pending.slice(0, 4).map((t) => t.title).join(', ') + (pending.length > 4 ? '…' : '') : '';
}
function summaryBody(day) {
  const tt = tasks().filter((t) => isTodayTask(t, day)).length;
  const ev = eventsOn(day).length;
  return `${tt} task${tt === 1 ? '' : 's'} · ${ev} event${ev === 1 ? '' : 's'} today`;
}

export function tick() {
  const n = S.settings.notifications;
  if (!S.ready) return;
  scheduleNative();
  syncNativeFired();
  if (!n.enabled) return;
  const now = new Date();
  const nowS = D.dtStr(now);
  const T = D.today();
  const recent = (s, mins) => s >= D.dtStr(new Date(now.getTime() - mins * 60000));

  if (n.tasks) {
    for (const t of tasks()) {
      if (isDone(t) || !t.reminder) continue;
      const key = 't:' + t.id + ':' + t.reminder;
      if (t.reminder <= nowS && recent(t.reminder, 360) && !fired.has(key)) { mark(key); show(t.title || 'Task reminder', taskBody(t), t.id, key); }
    }
  }
  if (n.events) {
    for (const e of allEvents()) {
      const lead = eventLead(e);
      if (e.allDay || lead == null) continue;
      const key = 'e:' + e.id + ':' + e.start + ':' + lead;
      if (D.addMinutesDT(e.start, -lead) <= nowS && recent(e.start, 10) && !fired.has(key)) { mark(key); show(e.title || 'Event', eventBody(e, lead), e.id, key); }
    }
  }
  if (n.habits) {
    const key = 'h:' + T;
    if (D.hhmm(now) >= n.habitTime && !fired.has(key)) {
      mark(key);
      const body = habitBody(T);
      if (body) show('Keep your streaks alive 🔥', body, null, key);
    }
  }
  if (n.summary) {
    const key = 's:' + T;
    if (D.hhmm(now) >= n.summaryTime && !fired.has(key)) { mark(key); show('Your day in JamDay', summaryBody(T), null, key); }
  }
}

/* ---------------- Android: hand upcoming reminders to the alarm service ---------------- */

let lastPlan = '';
/** Reminders Android already showed while JamDay was closed shouldn't pop up again on open. */
function syncNativeFired() {
  const b = android();
  if (!b || !b.firedKeys) return;
  try { JSON.parse(b.firedKeys() || '[]').forEach((k) => { if (!fired.has(k)) mark(k); }); } catch { /* ignore */ }
}
function scheduleNative() {
  const b = android();
  if (!b || !b.scheduleReminders) return;
  const n = S.settings.notifications;
  const plan = [];
  if (n.enabled) {
    const now = Date.now();
    const horizon = now + 7 * 86400000;
    const add = (key, at, title, body, id) => { if (at > now && at <= horizon && body !== '') plan.push({ key, at, title, body, id: id || '' }); };
    if (n.tasks) {
      for (const t of tasks()) if (!isDone(t) && t.reminder) add('t:' + t.id + ':' + t.reminder, D.parseDT(t.reminder).getTime(), t.title || 'Task reminder', taskBody(t), t.id);
    }
    if (n.events) {
      for (const e of allEvents()) {
        const lead = eventLead(e);
        if (e.allDay || lead == null) continue;
        add('e:' + e.id + ':' + e.start + ':' + lead, D.parseDT(D.addMinutesDT(e.start, -lead)).getTime(), e.title || 'Event', eventBody(e, lead), e.id);
      }
    }
    for (const day of [D.today(), D.addDays(D.today(), 1)]) {
      if (n.habits) add('h:' + day, D.parseDT(day + 'T' + n.habitTime).getTime(), 'Keep your streaks alive 🔥', habitBody(day));
      if (n.summary) add('s:' + day, D.parseDT(day + 'T' + n.summaryTime).getTime(), 'Your day in JamDay', summaryBody(day));
    }
    plan.sort((a, b2) => a.at - b2.at);
    plan.length = Math.min(plan.length, 60);
  }
  const json = JSON.stringify(plan);
  if (json === lastPlan) return;
  lastPlan = json;
  try { b.scheduleReminders(json); } catch (e) { console.warn('Could not schedule reminders', e); }
}

export function startScheduler() {
  setInterval(tick, 20000);
  setTimeout(tick, 2500);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  // On Android, keep the alarm plan in step with edits (debounced).
  if (android()) { let t; subscribe(() => { clearTimeout(t); t = setTimeout(scheduleNative, 1500); }); }
}
