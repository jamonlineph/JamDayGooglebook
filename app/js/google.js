// Optional Google connection: Calendar (read, optional two-way for JamDay-made events, Meet links)
// and Drive app-data sync. Uses Google Identity Services with the user's own OAuth Client ID.
// Tokens live in memory only; Google events are held in memory and never written to IndexedDB.
import { S, emit, hooks, update, toast, setSetting, get, upsertMany, applyTombstones, blocksText } from './store.js';
import { loadScript, debounce } from './lib.js';
import * as D from './dates.js';

const GIS = 'https://accounts.google.com/gsi/client';
const CAL = 'https://www.googleapis.com/calendar/v3';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const SYNC_FILE = 'jamday-sync.json';
const SC_READ = 'https://www.googleapis.com/auth/calendar.readonly';
const SC_EVENTS = 'https://www.googleapis.com/auth/calendar.events';
const SC_DRIVE = 'https://www.googleapis.com/auth/drive.appdata';

// Publishers can ship a default OAuth Web client ID so users don't need their own.
// Users can still override it in Settings ▸ Integrations.
export const DEFAULT_CLIENT_ID = '';
export const clientId = () => ((S.settings.google.clientId || '').trim() || DEFAULT_CLIENT_ID);

let token = null;
let tokenExp = 0;

function wantedScopes() {
  const s = [SC_READ];
  if (S.settings.google.twoWay) s.push(SC_EVENTS);
  if (S.settings.google.drive) s.push(SC_DRIVE);
  return s.join(' ');
}

export async function connect() {
  const cid = clientId();
  if (!cid) throw new Error('Add a Google OAuth Client ID in Settings ▸ Integrations first.');
  S.google.busy = true; S.google.error = ''; emit();
  try {
    await loadScript(GIS);
    await new Promise((resolve, reject) => {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: cid,
        scope: wantedScopes(),
        callback: (r) => {
          if (r.error) { reject(new Error(r.error_description || r.error)); return; }
          token = r.access_token;
          tokenExp = Date.now() + ((r.expires_in || 3600) - 60) * 1000;
          resolve();
        },
        error_callback: (e) => reject(new Error((e && (e.message || e.type)) || 'Google sign-in was cancelled.')),
      });
      client.requestAccessToken({ prompt: '' });
    });
    S.google.connected = true;
    setSetting('google.autoConnect', true);
    await loadCalendars();
    await refreshEvents();
  } catch (e) {
    S.google.error = e.message;
    throw e;
  } finally {
    S.google.busy = false; emit();
  }
}

export function disconnect() {
  try { if (token && window.google) window.google.accounts.oauth2.revoke(token, () => {}); } catch { /* ignore */ }
  token = null; tokenExp = 0;
  S.google = { ...S.google, connected: false, events: [], calendars: [], error: '' };
  setSetting('google.autoConnect', false);
  emit();
}

async function api(url, opts = {}, retry = true) {
  if (!token || Date.now() > tokenExp) await connect();
  const headers = { Authorization: 'Bearer ' + token };
  if (typeof opts.body === 'string') headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
  if (res.status === 401 && retry) { token = null; return api(url, opts, false); }
  if (!res.ok) {
    let msg = 'HTTP ' + res.status;
    try { const j = await res.json(); msg = (j.error && (j.error.message || j.error)) || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') || '';
  return ct.includes('json') ? res.json() : res.text();
}

export async function loadCalendars() {
  const r = await api(CAL + '/users/me/calendarList?maxResults=250');
  S.google.calendars = (r.items || []).map((c) => ({ id: c.id, name: c.summaryOverride || c.summary, color: c.backgroundColor, primary: !!c.primary, selected: !!c.selected, role: c.accessRole }));
  if (!S.settings.google.calendars.length) setSetting('google.calendars', S.google.calendars.filter((c) => c.primary || c.selected).map((c) => c.id));
  emit();
}

const toLocal = (g) => (g.date ? g.date + 'T00:00' : D.dtStr(new Date(g.dateTime)));

/** Reads ~2 weeks back and ~3 months ahead from the selected calendars, in memory only. */
export async function refreshEvents(manual = false) {
  if (!S.google.connected) { if (manual) toast('Connect Google Calendar in Settings ▸ Integrations.'); return; }
  S.google.busy = true; emit();
  try {
    if (!S.google.calendars.length) await loadCalendars();
    const ids = S.settings.google.calendars.length ? S.settings.google.calendars : ['primary'];
    const timeMin = new Date(Date.now() - 14 * 86400000).toISOString();
    const timeMax = new Date(Date.now() + 92 * 86400000).toISOString();
    const out = [];
    for (const id of ids) {
      const cal = S.google.calendars.find((c) => c.id === id) || { name: 'Calendar', color: null };
      let pageToken = '';
      do {
        const r = await api(`${CAL}/calendars/${encodeURIComponent(id)}/events?singleEvents=true&orderBy=startTime&maxResults=250&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}${pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''}`);
        for (const g of r.items || []) {
          if (g.status === 'cancelled' || !g.start) continue;
          const allDay = !!g.start.date;
          const end = allDay ? D.addDays(g.end.date, -1) + 'T00:00' : toLocal(g.end);
          const video = g.conferenceData && (g.conferenceData.entryPoints || []).find((p) => p.entryPointType === 'video');
          out.push({
            id: 'g_' + id + '_' + g.id, googleId: g.id, type: 'event', source: 'google', readOnly: true,
            calendarId: id, calendarName: cal.name, title: g.summary || '', start: toLocal(g.start), end, allDay,
            location: g.location || '', description: (g.description || '').replace(/<[^>]+>/g, ' '), url: g.hangoutLink || (video && video.uri) || '',
            htmlLink: g.htmlLink, color: cal.color, organizer: g.organizer ? g.organizer.displayName || g.organizer.email : '',
            tags: [], links: [], attachments: [], updatedAt: Date.parse(g.updated) || 0, createdAt: Date.parse(g.created) || 0,
          });
        }
        pageToken = r.nextPageToken || '';
      } while (pageToken);
    }
    S.google.events = out;
    S.google.lastFetch = Date.now();
    S.google.error = '';
    if (manual) toast(`Google Calendar updated · ${out.length} events`);
  } catch (e) {
    S.google.error = e.message;
    if (manual) toast('Google Calendar: ' + e.message, { kind: 'error' });
  } finally {
    S.google.busy = false; emit();
  }
}

/* ---------------- two-way sync for events created in JamDay ---------------- */

function toGoogle(ev) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const body = { summary: ev.title || 'Untitled event', location: ev.location || '', description: blocksText(ev.notes) };
  if (ev.allDay) { body.start = { date: ev.start.slice(0, 10) }; body.end = { date: D.addDays(ev.end.slice(0, 10), 1) }; }
  else { body.start = { dateTime: D.parseDT(ev.start).toISOString(), timeZone: tz }; body.end = { dateTime: D.parseDT(ev.end).toISOString(), timeZone: tz }; }
  if (ev.meet) body.conferenceData = { createRequest: { requestId: ev.id + '-' + Date.now(), conferenceSolutionKey: { type: 'hangoutsMeet' } } };
  return body;
}

export async function pushEvent(id) {
  const ev = get(id);
  if (!ev || ev.deletedAt || !S.settings.google.twoWay || !S.google.connected) return;
  const cal = ev.googleCal || 'primary';
  try {
    const body = JSON.stringify(toGoogle(ev));
    const r = ev.googleId
      ? await api(`${CAL}/calendars/${encodeURIComponent(cal)}/events/${ev.googleId}?conferenceDataVersion=1`, { method: 'PATCH', body })
      : await api(`${CAL}/calendars/${encodeURIComponent(cal)}/events?conferenceDataVersion=1`, { method: 'POST', body });
    update(id, { googleId: r.id, googleCal: cal, url: ev.url || r.hangoutLink || '', meet: false, googleSyncedAt: Date.now() }, { silent: true });
    if (ev.meet && r.hangoutLink) toast('Google Meet link added');
  } catch (e) { toast('Google sync failed: ' + e.message, { kind: 'error' }); }
}

async function deleteRemote(ev) {
  try { await api(`${CAL}/calendars/${encodeURIComponent(ev.googleCal || 'primary')}/events/${ev.googleId}`, { method: 'DELETE' }); }
  catch (e) { if (!/404|410|deleted/i.test(e.message)) toast('Could not delete the Google copy: ' + e.message, { kind: 'error' }); }
}

const timers = new Map();
hooks.change.add((kind, item) => {
  if (!item || item.type !== 'event' || item.source === 'google') return;
  if (!S.google.connected || !S.settings.google.twoWay) return;
  if (kind === 'trash' || kind === 'purge') {
    if (item.googleId) { deleteRemote(item); if (kind === 'trash') setTimeout(() => update(item.id, { googleId: null }, { silent: true }), 0); }
    return;
  }
  if (!(item.syncGoogle || item.googleId)) return;
  clearTimeout(timers.get(item.id));
  timers.set(item.id, setTimeout(() => { timers.delete(item.id); pushEvent(item.id); }, 1200));
});

/* ---------------- Drive app-data sync ---------------- */

function deviceName() {
  const ua = navigator.userAgent;
  return /CrOS/.test(ua) ? 'Chromebook/Googlebook' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Device';
}

export async function syncDrive({ quiet = false } = {}) {
  if (!S.settings.google.drive) throw new Error('Turn on Google Drive sync first.');
  if (!S.google.connected) await connect();
  S.google.syncing = true; emit();
  try {
    const list = await api(`${DRIVE}/files?spaces=appDataFolder&fields=files(id,modifiedTime)&q=${encodeURIComponent(`name='${SYNC_FILE}'`)}`);
    const file = list.files && list.files[0];
    if (file) {
      let remote = await api(`${DRIVE}/files/${file.id}?alt=media`);
      if (typeof remote === 'string') remote = JSON.parse(remote);
      if (remote && Array.isArray(remote.items)) { applyTombstones(remote.tombstones || {}); upsertMany(remote.items); }
    }
    const payload = JSON.stringify({ app: 'JamDay', format: 1, savedAt: Date.now(), device: deviceName(), items: [...S.items.values()], tombstones: S.tombstones });
    if (file) {
      await api(`${UPLOAD}/files/${file.id}?uploadType=media`, { method: 'PATCH', body: payload });
    } else {
      const b = 'jamday' + Date.now();
      const body = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: SYNC_FILE, parents: ['appDataFolder'] })}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${payload}\r\n--${b}--`;
      await api(`${UPLOAD}/files?uploadType=multipart`, { method: 'POST', body, headers: { 'Content-Type': 'multipart/related; boundary=' + b } });
    }
    setSetting('google.lastSync', Date.now());
    if (!quiet) toast('Synced with Google Drive');
  } catch (e) {
    toast('Drive sync failed: ' + e.message, { kind: 'error' });
    throw e;
  } finally {
    S.google.syncing = false; emit();
  }
}

const autoSync = debounce(() => { if (S.settings.google.drive && S.google.connected && !S.google.syncing) syncDrive({ quiet: true }).catch(() => {}); }, 30000);
hooks.change.add(() => autoSync());
