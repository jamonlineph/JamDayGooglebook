// Local reminders: task reminders, event alerts, habit nudges and a daily summary.
// They fire while JamDay is open (installed app window or tab); nothing leaves the device.
import { S, tasks, allEvents, isDone, taskDate, isTodayTask, eventsOn, openItem, toast } from './store.js';
import * as D from './dates.js';

let fired;
try { fired = new Set(JSON.parse(localStorage.getItem('jd.fired') || '[]')); } catch { fired = new Set(); }
function mark(key) {
  fired.add(key);
  try { localStorage.setItem('jd.fired', JSON.stringify([...fired].slice(-600))); } catch { /* ignore */ }
}

export const notificationsSupported = () => typeof Notification !== 'undefined';
export async function requestPermission() {
  if (!notificationsSupported()) return 'unsupported';
  return Notification.requestPermission();
}

export async function show(title, body, id, tag) {
  const n = S.settings.notifications;
  if (n.inApp || !notificationsSupported() || Notification.permission !== 'granted' || !document.hidden) {
    toast(`🔔 ${title}${body ? ' — ' + body : ''}`, { action: id ? { label: 'Open', run: () => openItem(id) } : null, timeout: 10000 });
  }
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  const opts = { body, tag: tag || id || title, icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', data: { id } };
  try {
    const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
    if (reg) await reg.showNotification(title, opts); else new Notification(title, opts);
  } catch (e) { console.warn('Notification failed', e); }
}

export function tick() {
  const n = S.settings.notifications;
  if (!n.enabled || !S.ready) return;
  const now = new Date();
  const nowS = D.dtStr(now);
  const T = D.today();
  const recent = (s, mins) => s >= D.dtStr(new Date(now.getTime() - mins * 60000));

  if (n.tasks) {
    for (const t of tasks()) {
      if (isDone(t) || !t.reminder) continue;
      const key = 't:' + t.id + ':' + t.reminder;
      if (t.reminder <= nowS && recent(t.reminder, 360) && !fired.has(key)) {
        mark(key);
        show(t.title || 'Task reminder', t.deadline ? 'Due ' + D.relDay(t.deadline) : t.when ? D.whenLabel(t.when) : 'Reminder', t.id);
      }
    }
  }
  if (n.events) {
    for (const e of allEvents()) {
      if (e.allDay) continue;
      const lead = e.source === 'google' ? n.eventLead : e.reminder;
      if (lead == null) continue;
      const at = D.addMinutesDT(e.start, -lead);
      const key = 'e:' + e.id + ':' + e.start + ':' + lead;
      if (at <= nowS && recent(e.start, 10) && !fired.has(key)) {
        mark(key);
        show(e.title || 'Event', (lead ? `Starts in ${lead >= 60 ? Math.round(lead / 60) + ' h' : lead + ' min'}` : 'Starting now') + (e.location ? ' · ' + e.location : ''), e.id);
      }
    }
  }
  if (n.habits) {
    const key = 'h:' + T;
    if (D.hhmm(now) >= n.habitTime && !fired.has(key)) {
      mark(key);
      const pending = tasks().filter((t) => t.repeat && !isDone(t) && taskDate(t) === T);
      if (pending.length) show('Keep your streaks alive 🔥', pending.slice(0, 4).map((t) => t.title).join(', ') + (pending.length > 4 ? '…' : ''), null, 'habits');
    }
  }
  if (n.summary) {
    const key = 's:' + T;
    if (D.hhmm(now) >= n.summaryTime && !fired.has(key)) {
      mark(key);
      const tt = tasks().filter((t) => isTodayTask(t, T)).length;
      const ev = eventsOn(T).length;
      show('Your day in JamDay', `${tt} task${tt === 1 ? '' : 's'} · ${ev} event${ev === 1 ? '' : 's'} today`, null, 'summary');
    }
  }
}

export function startScheduler() {
  setInterval(tick, 20000);
  setTimeout(tick, 2500);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
}
