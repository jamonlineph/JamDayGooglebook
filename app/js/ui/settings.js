// Settings: general, appearance, sidebar, notifications, shortcuts & panel, integrations, AI, data, about.
import { html, useState, useEffect, cx, pickFiles, fmtBytes, APP_VERSION, android } from '../lib.js';
import {
  S, emit, setSetting, navigate, SECTIONS, toast, wipeEverything, resetSettings, tasks, notes, events, folders, tags, trashed,
} from '../store.js';
import { db } from '../db.js';
import { Icon } from './icons.js';
import { Btn, ViewHeader, Segmented, Switch, Kbd, confirmDialog, shortcutLabel } from './common.js';
import * as AI from '../ai.js';
import * as G from '../google.js';
import * as IO from '../io.js';
import { requestPermission, permissionState, show } from '../notify.js';
import { loadDemo } from '../demo.js';
import { startTour } from './tour.js';

export const ACCENTS = {
  jam: { name: 'Crimson', c: '#bc243c' }, blueberry: { name: 'Blueberry', c: '#4f6bed' }, mint: { name: 'Mint', c: '#15a37f' },
  citrus: { name: 'Citrus', c: '#ec7a12' }, grape: { name: 'Grape', c: '#8a4fd6' }, graphite: { name: 'Graphite', c: '#5b6470' },
};
export const GLASS = { '': 'None', aurora: 'Aurora', sunset: 'Sunset', midnight: 'Midnight', meadow: 'Meadow' };

const SECTIONS_NAV = [
  ['general', 'General', 'settings'], ['appearance', 'Appearance', 'palette'], ['sidebar', 'Sidebar', 'sidebar'],
  ['notifications', 'Notifications', 'bell'], ['shortcuts', 'Shortcuts & panel', 'keyboard'], ['integrations', 'Integrations & sync', 'cloud'],
  ['ai', 'AI & MCP', 'plug'], ['data', 'Data & import', 'download'], ['about', 'About & privacy', 'info'],
];

const Row = ({ label, hint, children }) => html`<div class="set-row"><div class="set-l"><span>${label}</span>${hint && html`<small>${hint}</small>`}</div><div class="set-v">${children}</div></div>`;

function General() {
  const s = S.settings;
  return html`
    <${Row} label="Open JamDay to"><select class="input sm" value=${s.startView} onChange=${(e) => setSetting('startView', e.target.value)}>
      ${['today', 'inbox', 'upcoming', 'calendar', 'tasks', 'notes'].map((k) => html`<option value=${k}>${SECTIONS[k].label}</option>`)}</select><//>
    <${Row} label="Week starts on"><${Segmented} size="sm" value=${s.weekStart} onChange=${(v) => setSetting('weekStart', v)} options=${[{ v: 0, label: 'Sunday' }, { v: 1, label: 'Monday' }, { v: 6, label: 'Saturday' }]} /><//>
    <${Row} label="Time format"><${Segmented} size="sm" value=${s.timeFormat} onChange=${(v) => setSetting('timeFormat', v)} options=${[{ v: '12', label: '1:00 PM' }, { v: '24', label: '13:00' }]} /><//>
    <${Row} label="Default calendar view"><select class="input sm" value=${s.calendarView} onChange=${(e) => { setSetting('calendarView', e.target.value); S.ui.calendar.view = e.target.value; }}>
      ${[['day', 'Day'], ['2d', '2 days'], ['3d', '3 days'], ['4d', '4 days'], ['week', 'Week'], ['month', 'Month']].map(([v, l]) => html`<option value=${v}>${l}</option>`)}</select><//>
    <${Row} label="Calendar scrolls to" hint="Where the day view starts when today isn’t visible"><select class="input sm" value=${s.dayStartHour} onChange=${(e) => setSetting('dayStartHour', +e.target.value)}>
      ${Array.from({ length: 13 }, (_, i) => i + 5).map((h) => html`<option value=${h}>${h}:00</option>`)}</select><//>
    <${Row} label="Show completed tasks" hint="In lists, boards and folders"><input type="checkbox" class="switch" checked=${s.showCompleted} onChange=${(e) => setSetting('showCompleted', e.target.checked)} /><//>`;
}

function Appearance() {
  const s = S.settings;
  return html`
    <${Row} label="Theme"><${Segmented} value=${s.theme} onChange=${(v) => setSetting('theme', v)} options=${[{ v: 'system', label: 'System', icon: 'globe' }, { v: 'light', label: 'Light', icon: 'sun' }, { v: 'dark', label: 'Dark', icon: 'moon' }]} /><//>
    <${Row} label="Glass" hint="Translucent panels over a soft wallpaper">
      <div class="glass-pick">${Object.entries(GLASS).map(([k, n]) => html`<button type="button" class=${cx('glass-sw', 'g-' + (k || 'none'), s.glass === k && 'on')} onClick=${() => setSetting('glass', k)}><span>${n}</span></button>`)}</div>
    <//>
    <${Row} label="Accent colour">
      <div class="accent-pick">${Object.entries(ACCENTS).map(([k, a]) => html`<button type="button" title=${a.name} class=${cx('accent-sw', s.accent === k && 'on')} style=${`--c:${a.c}`} onClick=${() => setSetting('accent', k)}><span>${a.name}</span></button>`)}</div>
    <//>
    <${Row} label="Density"><${Segmented} size="sm" value=${s.density} onChange=${(v) => setSetting('density', v)} options=${[{ v: 'comfortable', label: 'Comfortable' }, { v: 'compact', label: 'Compact' }]} /><//>
    <${Row} label="Text size"><${Segmented} size="sm" value=${s.fontScale} onChange=${(v) => setSetting('fontScale', v)} options=${[{ v: 0.92, label: 'Small' }, { v: 1, label: 'Default' }, { v: 1.08, label: 'Large' }]} /><//>`;
}

function SidebarSettings() {
  const s = S.settings;
  const list = s.sidebar;
  const move = (i, d) => { const l = list.slice(); const j = i + d; if (j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; setSetting('sidebar', l); };
  return html`
    <p class="muted small">Show, hide and reorder the sections in the sidebar.</p>
    <div class="sb-order">${list.map((it, i) => html`<div class="sb-order-row" key=${it.id}>
      <input type="checkbox" checked=${it.show} onChange=${(e) => setSetting('sidebar', list.map((x) => (x.id === it.id ? { ...x, show: e.target.checked } : x)))} aria-label=${'Show ' + SECTIONS[it.id].label} />
      <${Icon} name=${SECTIONS[it.id].icon} size=${16} /><span class="grow">${SECTIONS[it.id].label}</span>
      <${Btn} icon="chevU" size="sm" title="Move up" disabled=${i === 0} onClick=${() => move(i, -1)} />
      <${Btn} icon="chevD" size="sm" title="Move down" disabled=${i === list.length - 1} onClick=${() => move(i, 1)} />
    </div>`)}</div>
    <${Row} label="Show folder list"><input type="checkbox" class="switch" checked=${s.sidebarFolders} onChange=${(e) => setSetting('sidebarFolders', e.target.checked)} /><//>
    <${Row} label="Show tag list"><input type="checkbox" class="switch" checked=${s.sidebarTags} onChange=${(e) => setSetting('sidebarTags', e.target.checked)} /><//>`;
}

function Notifications() {
  const n = S.settings.notifications;
  const perm = permissionState();
  const set = (k, v) => setSetting('notifications.' + k, v);
  return html`
    <${Row} label="Reminders & notifications" hint=${android() ? 'Reminders fire even when JamDay is closed. Android may deliver them a few minutes late to save battery.' : 'Local notifications fire while JamDay is open — install it and keep it in your shelf for the best results.'}>
      <input type="checkbox" class="switch" checked=${n.enabled} onChange=${async (e) => {
        const on = e.target.checked;
        set('enabled', on);
        if (on && perm === 'default') { const p = await requestPermission(); emit(); if (p !== 'granted') toast('System notifications are blocked — JamDay will show in-app alerts instead.'); }
      }} /><//>
    ${perm === 'denied' && html`<div class="banner warn"><${Icon} name="info" size=${15} /> ${android() ? 'Notifications are turned off for JamDay. Turn them on in Android Settings ▸ Apps ▸ JamDay ▸ Notifications.' : 'Notifications are blocked for this site. Allow them in your browser’s site settings to get system alerts.'}</div>`}
    <div class=${cx(!n.enabled && 'disabled-block')}>
      <${Row} label="Task reminders"><input type="checkbox" class="switch" checked=${n.tasks} onChange=${(e) => set('tasks', e.target.checked)} /><//>
      <${Row} label="Event alerts"><input type="checkbox" class="switch" checked=${n.events} onChange=${(e) => set('events', e.target.checked)} /><//>
      <${Row} label="Default event alert" hint="For new events and Google Calendar events"><select class="input sm" value=${n.eventLead} onChange=${(e) => set('eventLead', +e.target.value)}>
        ${[0, 5, 10, 15, 30, 60].map((m) => html`<option value=${m}>${m ? m + ' min before' : 'At start'}</option>`)}</select><//>
      <${Row} label="Habit nudge" hint="If habits due today aren’t done yet"><input type="checkbox" class="switch" checked=${n.habits} onChange=${(e) => set('habits', e.target.checked)} />
        <input type="time" class="input sm" value=${n.habitTime} onChange=${(e) => set('habitTime', e.target.value)} /><//>
      <${Row} label="Daily summary"><input type="checkbox" class="switch" checked=${n.summary} onChange=${(e) => set('summary', e.target.checked)} />
        <input type="time" class="input sm" value=${n.summaryTime} onChange=${(e) => set('summaryTime', e.target.value)} /><//>
      <${Row} label="Also show in-app alerts"><input type="checkbox" class="switch" checked=${n.inApp} onChange=${(e) => set('inApp', e.target.checked)} /><//>
      <${Row} label="Test"><${Btn} icon="bell" label="Send a test notification" onClick=${async () => { if (perm === 'default') await requestPermission(); show('JamDay', 'Notifications are working 🎉'); }} /><//>
    </div>`;
}

const LAUNCHER_KEYS = [['alt+space', 'Alt+Space'], ['ctrl+space', 'Ctrl+Space'], ['ctrl+shift+space', 'Ctrl+Shift+Space'], ['ctrl+k', 'Ctrl+K only']];
const PANEL_KEYS = [['ctrl+alt+space', 'Ctrl+Alt+Space'], ['ctrl+shift+.', 'Ctrl+Shift+.'], ['alt+shift+space', 'Alt+Shift+Space']];
export const SHORTCUTS = [
  ['Search & create (Quick Launcher)', null, 'launcher'], ['Quick Launcher (always)', 'ctrl+k'], ['Quick panel', null, 'panel'],
  ['New task', 't'], ['New note', 'n'], ['New event', 'e'], ['Search', '/'],
  ['Go to Today / Inbox / Upcoming', 'g+t'], ['Go to Calendar / Notes / Habits', 'g+c'], ['Toggle sidebar', '['], ['Keyboard shortcuts', '?'],
  ['Calendar: previous / next', 'left'], ['Calendar: day / week / month', 'd'], ['Calendar: today', '.'],
  ['Editor: commands', '/'], ['Editor: mention', '@'], ['Editor: bold / italic / link', 'ctrl+b'], ['Close / back', 'esc'],
];

function Shortcuts() {
  const s = S.settings;
  return html`
    <${Row} label="Quick Launcher shortcut" hint="Ctrl+K also always works"><select class="input sm" value=${s.shortcuts.launcher} onChange=${(e) => setSetting('shortcuts.launcher', e.target.value)}>
      ${LAUNCHER_KEYS.map(([v, l]) => html`<option value=${v}>${l}</option>`)}</select><//>
    <${Row} label="Quick panel shortcut"><select class="input sm" value=${s.shortcuts.panel} onChange=${(e) => setSetting('shortcuts.panel', e.target.value)}>
      ${PANEL_KEYS.map(([v, l]) => html`<option value=${v}>${l}</option>`)}</select><//>
    <${Row} label="Quick panel style"><select class="input sm" value=${s.panel.style} onChange=${(e) => setSetting('panel.style', e.target.value)}>
      <option value="dropdown">Dropdown</option><option value="floating">Floating (drag to move)</option><option value="dock-left">Docked left</option><option value="dock-right">Docked right</option></select><//>
    <${Row} label="Open the panel at the screen edge" hint="Move the pointer to the very left/right edge of the window"><input type="checkbox" class="switch" checked=${s.panel.edge} onChange=${(e) => setSetting('panel.edge', e.target.checked)} /><//>
    <h4 class="set-sub">All shortcuts</h4>
    <div class="kbd-list">${SHORTCUTS.map(([l, k, ref]) => html`<div class="kbd-row"><span>${l}</span><${Kbd} keys=${ref ? s.shortcuts[ref] : k} /></div>`)}</div>`;
}

function Integrations() {
  const g = S.settings.google;
  const [busy, setBusy] = useState(false);
  const run = async (fn) => { setBusy(true); try { await fn(); } catch (e) { toast(e.message, { kind: 'error', timeout: 8000 }); } setBusy(false); };
  if (android()) return html`
    <div class="int-card">
      <div class="int-h"><span class="int-logo g"><${Icon} name="calendar" size=${18} /></span><div><b>Google Calendar & Drive sync</b><div class="muted small">Not available in the Android app yet</div></div></div>
      <p class="muted small">Google doesn’t allow its sign-in page inside apps that embed a web view, so the Google connection only works when you use JamDay in Chrome. To move data between devices, export a backup in Settings ▸ Data & import and import it on the other device.</p>
    </div>
    <div class="int-card">
      <div class="int-h"><span class="int-logo"><${Icon} name="upload" size=${18} /></span><div><b>Bring your stuff</b><div class="muted small">Calendar files (.ics), Todoist / Linear / spreadsheet exports (CSV or Excel), Markdown, PDFs and JamDay backups</div></div></div>
      <${Btn} icon="upload" label="Import files…" onClick=${() => importFlow()} />
    </div>`;
  return html`
    <div class="int-card">
      <div class="int-h"><span class="int-logo g"><${Icon} name="calendar" size=${18} /></span><div><b>Google Calendar</b><div class="muted small">Optional · reads ~2 weeks back and 3 months ahead · events stay in memory only</div></div>
        <span class="grow"></span>${S.google.connected ? html`<span class="pill on sm">Connected</span>` : html`<span class="pill sm">Not connected</span>`}</div>
      ${G.DEFAULT_CLIENT_ID ? html`<p class="muted small">Ready to connect — no setup needed. (Advanced: paste your own client ID below to use it instead.)</p>` : ''}
      <details class="int-help" open=${!g.clientId && !G.DEFAULT_CLIENT_ID}>
        <summary>How to connect (one-time, ~3 minutes)</summary>
        <ol>
          <li>Open <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">Google Cloud Console ▸ Credentials</a> and create a project.</li>
          <li>Enable the <b>Google Calendar API</b> (and <b>Google Drive API</b> if you want Drive sync).</li>
          <li>Configure the OAuth consent screen (External, add yourself as a test user).</li>
          <li>Create an <b>OAuth client ID</b> of type <b>Web application</b> and add this origin under “Authorized JavaScript origins”: <code>${location.origin}</code></li>
          <li>Paste the Client ID below and press Connect.</li>
        </ol>
      </details>
      <div class="row"><input class="input grow" placeholder=${G.DEFAULT_CLIENT_ID ? 'Using the built-in client ID' : 'xxxxxxxx.apps.googleusercontent.com'} value=${g.clientId} onInput=${(e) => setSetting('google.clientId', e.target.value.trim())} />
        ${S.google.connected ? html`<${Btn} label="Disconnect" onClick=${() => G.disconnect()} />` : html`<${Btn} kind="primary" label=${busy || S.google.busy ? 'Connecting…' : 'Connect'} disabled=${!G.clientId() || busy} onClick=${() => run(G.connect)} />`}</div>
      ${S.google.error && html`<div class="banner warn small">${S.google.error}</div>`}
      ${S.google.connected && html`
        <h4 class="set-sub">Calendars to show</h4>
        <div class="cal-list">${S.google.calendars.map((c) => html`<label class="check-l"><input type="checkbox" checked=${g.calendars.includes(c.id)}
          onChange=${(e) => { setSetting('google.calendars', e.target.checked ? [...g.calendars, c.id] : g.calendars.filter((x) => x !== c.id)); G.refreshEvents(); }} />
          <i class="dot" style=${`background:${c.color}`}></i>${c.name}${c.primary ? ' (primary)' : ''}</label>`)}</div>
        <${Btn} icon="refresh" label="Refresh now" size="sm" onClick=${() => G.refreshEvents(true)} />`}
      <${Switch} label="Two-way sync for events made in JamDay" hint="Create, edit and delete only the events you create in JamDay; add Google Meet links. Reconnect after turning this on."
        checked=${g.twoWay} onChange=${(v) => { setSetting('google.twoWay', v); if (S.google.connected) toast('Reconnect Google to grant the extra permission.', { action: { label: 'Reconnect', run: () => run(G.connect) } }); }} />
    </div>
    <div class="int-card">
      <div class="int-h"><span class="int-logo d"><${Icon} name="cloud" size=${18} /></span><div><b>Sync across devices with Google Drive</b><div class="muted small">Optional · stores one private file in Drive’s hidden app-data folder that only JamDay can read</div></div></div>
      <${Switch} label="Sync via Google Drive" hint="Uses the same Google connection. Attachments stay on each device." checked=${g.drive} onChange=${(v) => setSetting('google.drive', v)} />
      ${g.drive && html`<div class="row"><${Btn} icon="refresh" label=${S.google.syncing ? 'Syncing…' : 'Sync now'} disabled=${S.google.syncing || !G.clientId()} onClick=${() => run(() => G.syncDrive())} />
        <span class="muted small">${g.lastSync ? 'Last synced ' + new Date(g.lastSync).toLocaleString() : 'Never synced'}</span></div>`}
    </div>
    <div class="int-card">
      <div class="int-h"><span class="int-logo"><${Icon} name="upload" size=${18} /></span><div><b>Bring your stuff</b><div class="muted small">Calendar files (.ics) from any calendar app, Todoist / Linear / spreadsheet exports (CSV or Excel), Markdown and PDFs</div></div></div>
      <${Btn} icon="upload" label="Import files…" onClick=${() => importFlow()} />
    </div>`;
}

export async function importFlow() {
  const files = await pickFiles({ multiple: true, accept: '.json,.csv,.tsv,.xlsx,.xls,.ods,.md,.markdown,.txt,.pdf,.ics' });
  if (!files.length) return;
  toast('Importing…', { timeout: 1500 });
  const res = await IO.importFiles(files);
  res.forEach((r) => toast(r, { timeout: 6000 }));
}

function AISettings() {
  const [local, setLocal] = useState(null);
  useEffect(() => { AI.localAIStatus().then(setLocal); }, []);
  const label = (s) => ({ available: 'Ready', downloadable: 'Available (downloads on first use)', downloading: 'Downloading…', unavailable: 'Not available on this device', unsupported: 'Not supported here' }[s] || s);
  const st = S.mcp || { status: 'off' };
  return html`
    <div class="int-card">
      <div class="int-h"><span class="int-logo"><${Icon} name="plug" size=${18} /></span><div><b>MCP — connect AI apps</b><div class="muted small">Let Claude, Cursor, VS Code and other MCP apps read and update your JamDay through a small connector on this device.</div></div>
        <span class="grow"></span><span class=${cx('pill sm', st.status === 'connected' && 'on')}>${{ off: 'Off', connecting: 'Connecting', waiting: 'Waiting', connected: 'Connected' }[st.status] || 'Off'}</span></div>
      <div class="row"><${Btn} kind="primary" icon="plug" label="Set up MCP" onClick=${() => navigate('mcp')} /></div>
    </div>
    <div class="int-card">
      <div class="int-h"><span class="int-logo"><${Icon} name="wand" size=${18} /></span><div><b>On-device AI</b><div class="muted small">Rewrite & summarize with Chrome’s built-in model (Gemini Nano). Runs locally — nothing leaves your device.</div></div></div>
      ${local ? html`<div class="kbd-list">
        <div class="kbd-row"><span>Summarizer</span><span class=${cx('pill sm', local.summarizer === 'available' && 'on')}>${label(local.summarizer)}</span></div>
        <div class="kbd-row"><span>Rewriter</span><span class=${cx('pill sm', local.rewriter === 'available' && 'on')}>${label(local.rewriter)}</span></div>
        <div class="kbd-row"><span>Prompt API</span><span class=${cx('pill sm', local.prompt === 'available' && 'on')}>${label(local.prompt)}</span></div>
      </div>` : html`<span class="muted small">Checking…</span>`}
      <p class="muted small">Use it from the ✨ button when you select text in a note, or “Summarize” on any note.</p>
    </div>`;
}

function Data() {
  const [est, setEst] = useState(null);
  useEffect(() => { db.estimate().then(setEst); }, []);
  return html`
    <div class="stat-row">
      <div><b>${tasks().length}</b><span>tasks</span></div><div><b>${notes().length}</b><span>notes</span></div><div><b>${events().length}</b><span>events</span></div>
      <div><b>${folders().length}</b><span>folders</span></div><div><b>${tags().length}</b><span>tags</span></div><div><b>${trashed().length}</b><span>in Trash</span></div>
    </div>
    ${est && html`<p class="muted small">Using ${fmtBytes(est.usage || 0)} of local storage on this device.</p>`}
    <h4 class="set-sub">Export</h4>
    <div class="btn-row">
      <${Btn} icon="download" label="Full backup (.json)" onClick=${() => IO.exportJSON()} />
      <${Btn} icon="download" label="Tasks (.csv)" onClick=${() => IO.exportTasksCSV()} />
      <${Btn} icon="download" label="All notes (.md)" onClick=${() => IO.exportAllNotesMarkdown()} />
    </div>
    <h4 class="set-sub">Import</h4>
    <p class="muted small">JamDay backups (.json) · tasks from CSV or Excel (Todoist, Linear, spreadsheets) · notes from Markdown or PDF · events from .ics calendar files.</p>
    <div class="drop-zone" onDragOver=${(e) => e.preventDefault()} onDrop=${async (e) => { e.preventDefault(); const r = await IO.importFiles([...e.dataTransfer.files]); r.forEach((x) => toast(x, { timeout: 6000 })); }}
      onClick=${importFlow} tabIndex="0" onKeyDown=${(e) => e.key === 'Enter' && importFlow()}><${Icon} name="upload" size=${20} /><span>Drop files here or click to choose</span></div>
    <h4 class="set-sub">Demo & tour</h4>
    <div class="btn-row">
      <${Btn} icon="sparkles" label="Add demo content" onClick=${() => { loadDemo(); toast('Demo content added'); navigate('today'); }} />
      <${Btn} icon="info" label="Start the feature tour" onClick=${() => { navigate('today'); setTimeout(startTour, 200); }} />
    </div>
    <h4 class="set-sub danger-t">Danger zone</h4>
    <div class="btn-row">
      <${Btn} label="Reset settings" onClick=${async () => { if (await confirmDialog({ title: 'Reset all settings?', message: 'Your tasks, notes and events are not affected.', confirmLabel: 'Reset' })) resetSettings(); }} />
      <${Btn} kind="danger" icon="trash" label="Delete all data on this device" onClick=${async () => {
        if (await confirmDialog({ title: 'Delete everything?', message: 'All tasks, notes, events, attachments and settings on this device will be permanently deleted. Export a backup first if you might need it.', confirmLabel: 'Delete everything' })) { await wipeEverything(); location.hash = '#/today'; location.reload(); }
      }} />
    </div>`;
}

function About() {
  const [upd, setUpd] = useState('');
  return html`
    <div class="about-hero"><span class="logo-big"><${Icon} name="logo" size=${46} /></span><div><h2>JamDay</h2><span class="muted">Tasks, notes & calendar · version ${APP_VERSION}</span></div></div>
    ${android() ? html`<p class="muted small">You’re using the JamDay Android app. Updates arrive as new versions of the app.</p>` : S.ui.installPrompt ? html`<${Btn} kind="primary" icon="download" label="Install JamDay on this device" onClick=${async () => { S.ui.installPrompt.prompt(); await S.ui.installPrompt.userChoice; S.ui.installPrompt = null; emit(); }} />`
      : html`<p class="muted small">${matchMedia('(display-mode: standalone)').matches ? 'Installed ✓ — JamDay runs in its own window and works offline.' : 'To install: open Chrome’s menu ▸ Cast, save and share ▸ Install page as app (or the install icon in the address bar).'}</p>`}
    ${!android() && html`<div class="row"><${Btn} icon="refresh" label="Check for updates" onClick=${async () => {
      const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
      if (!reg) { setUpd('Updates are checked automatically when JamDay is installed.'); return; }
      await reg.update(); setUpd(reg.waiting || reg.installing ? 'An update is ready — it applies the next time you open JamDay.' : 'You’re on the latest version.');
    }} /><span class="muted small">${upd}</span></div>`}
    <h4 class="set-sub">Privacy</h4>
    <ul class="privacy-list">
      <li><${Icon} name="lock" size=${15} /> No account. Everything is stored in a local database on this device.</li>
      <li><${Icon} name="eye" size=${15} /> No analytics, telemetry, crash reports or location data.</li>
      <li><${Icon} name="globe" size=${15} /> Network is used only for: loading app updates, the optional Google connection (Calendar / Drive), on-demand import helpers (Excel / PDF readers), and — only if you turn on MCP — a local connection to the JamDay connector on this device.</li>
      <li><${Icon} name="cloud" size=${15} /> Google tokens and Google events live in memory only and are never saved to the database.</li>
    </ul>
    <div class="btn-row"><a class="btn" href="../updates.html" target="_blank" rel="noopener">What’s new</a><a class="btn" href="../docs.html" target="_blank" rel="noopener">Help & docs</a><a class="btn" href="../privacy.html" target="_blank" rel="noopener">Privacy policy</a></div>`;
}

export function SettingsView({ section }) {
  const sec = SECTIONS_NAV.find((s) => s[0] === section) ? section : 'general';
  const Body = { general: General, appearance: Appearance, sidebar: SidebarSettings, notifications: Notifications, shortcuts: Shortcuts, integrations: Integrations, ai: AISettings, data: Data, about: About }[sec];
  return html`<div class="view">
    <${ViewHeader} icon="settings" title="Settings" />
    <div class="settings">
      <nav class="set-nav">${SECTIONS_NAV.map(([k, l, ic]) => html`<button type="button" class=${cx('set-nav-i', k === sec && 'on')} onClick=${() => navigate('settings', k)}><${Icon} name=${ic} size=${16} /><span>${l}</span></button>`)}</nav>
      <div class="set-body"><h2>${SECTIONS_NAV.find((s) => s[0] === sec)[1]}</h2><${Body} /></div>
    </div>
  </div>`;
}
