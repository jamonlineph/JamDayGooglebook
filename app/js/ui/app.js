// App shell: sidebar, routing, detail drawer, overlays, global shortcuts, theme.
import { html, useState, useEffect, useLayoutEffect, useRef, cx, isEditableTarget } from '../lib.js';
import {
  S, emit, subscribe, setSetting, navigate, SECTIONS, folders, tags, tasks, isInbox, isTodayTask, isOverdue, isDone, taskDate,
  findEvent, closeDetail, closePopover, closeTopModal, create, openItem, setUI, update, toast, emptyTrash, notes, itemsInFolder,
} from '../store.js';
import * as D from '../dates.js';
import { Icon } from './icons.js';
import { Kbd, PopoverHost, ModalHost, ToastHost, ItemIcon, openMenu, promptDialog, shortcutLabel } from './common.js';
import { TodayView, UpcomingView, InboxView, TasksView, HabitsView, TaskDetail } from './tasks.js';
import { CalendarView, EventsView, EventDetail, openQuickEvent } from './calendar.js';
import { NotesView } from './notes.js';
import { FoldersView, FolderPage, TagsView, TagPage, TrashView, folderMenu } from './collections.js';
import { Launcher, openLauncher, closeLauncher, registerCommands } from './launcher.js';
import { QuickPanel, togglePanel } from './panel.js';
import { AssistantView } from './assistant.js';
import { SettingsView, ACCENTS, SHORTCUTS, importFlow } from './settings.js';
import { Tour, startTour, showWelcome } from './tour.js';
import { loadDemo } from '../demo.js';
import * as IO from '../io.js';
import * as G from '../google.js';

/* ------------------------------------------------------------------ */
/* Theme                                                                */
/* ------------------------------------------------------------------ */

const mq = matchMedia('(prefers-color-scheme: dark)');
export function applyTheme() {
  const s = S.settings;
  const root = document.documentElement;
  const dark = s.theme === 'dark' || (s.theme === 'system' && mq.matches) || s.glass === 'midnight';
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.glass = s.glass || '';
  root.dataset.density = s.density;
  root.style.setProperty('--accent', (ACCENTS[s.accent] || ACCENTS.jam).c);
  root.style.setProperty('--font-scale', s.fontScale || 1);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? '#17151a' : '#faf8f6';
}
mq.addEventListener('change', applyTheme);

/* ------------------------------------------------------------------ */
/* Commands for the launcher (">")                                     */
/* ------------------------------------------------------------------ */

registerCommands(() => {
  const close = () => closeLauncher();
  const go = (v, id) => () => { navigate(v, id); close(); };
  const cmds = [
    ...Object.entries(SECTIONS).map(([k, v]) => ({ icon: v.icon, label: 'Go to ' + v.label, kw: 'open show ' + k, run: go(k) })),
    { icon: 'trash', label: 'Go to Trash', run: go('trash') },
    { icon: 'settings', label: 'Open Settings', kw: 'preferences options', run: go('settings') },
    { icon: 'tasks', label: 'New task', kw: 'create add todo', run: () => { const t = create('task', {}); close(); openItem(t.id); } },
    { icon: 'notes', label: 'New note', kw: 'create page doc', run: () => { const n = create('note', {}); close(); navigate('notes', n.id); } },
    { icon: 'calendar', label: 'New event', kw: 'create meeting', run: () => { close(); openQuickEvent({ left: innerWidth / 2 - 160, right: innerWidth / 2, top: 120, bottom: 120, width: 0, height: 0 }, { date: D.today() }); } },
    { icon: 'folder', label: 'New folder', kw: 'create project list', run: async () => { close(); const n = await promptDialog({ title: 'New folder', okLabel: 'Create' }); if (n && n.trim()) navigate('folder', create('folder', { name: n.trim() }).id); } },
    { icon: 'panel', label: 'Toggle quick panel', hint: shortcutLabel(S.settings.shortcuts.panel), run: () => { close(); togglePanel(); } },
    { icon: 'sidebar', label: 'Toggle sidebar', hint: '[', run: () => { setSetting('sidebarCollapsed', !S.settings.sidebarCollapsed); close(); } },
    { icon: 'moon', label: S.settings.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme', kw: 'theme appearance dark light', run: () => { setSetting('theme', document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); close(); } },
    { icon: 'palette', label: S.settings.glass ? 'Turn off glass theme' : 'Use a glass theme', kw: 'theme glass aurora', run: () => { setSetting('glass', S.settings.glass ? '' : 'aurora'); close(); } },
    { icon: 'sparkles', label: 'Ask the AI assistant', kw: 'chat ai claude gpt gemini grok', run: go('assistant') },
    { icon: 'keyboard', label: 'Keyboard shortcuts', hint: '?', run: () => { close(); setUI({ shortcutsHelp: true }); } },
    { icon: 'info', label: 'Start the feature tour', kw: 'help onboarding', run: () => { close(); navigate('today'); setTimeout(startTour, 200); } },
    { icon: 'download', label: 'Export a backup (.json)', kw: 'backup save export', run: () => { IO.exportJSON(); close(); } },
    { icon: 'upload', label: 'Import files…', kw: 'csv excel markdown pdf ics todoist', run: () => { close(); importFlow(); } },
    { icon: 'sparkles', label: 'Add demo content', kw: 'sample example', run: () => { loadDemo(); close(); toast('Demo content added'); } },
    { icon: 'trash', label: 'Empty Trash', danger: true, run: () => { emptyTrash(); close(); toast('Trash emptied'); } },
  ];
  if (S.google.connected) cmds.push({ icon: 'refresh', label: 'Refresh Google Calendar', run: () => { G.refreshEvents(true); close(); } });
  if (S.settings.google.drive) cmds.push({ icon: 'cloud', label: 'Sync with Google Drive', run: () => { G.syncDrive().catch(() => {}); close(); } });
  return cmds;
});

/* ------------------------------------------------------------------ */
/* Sidebar                                                              */
/* ------------------------------------------------------------------ */

function NavItem({ id, icon, label, count, danger, active, onDrop, color, children, onContext }) {
  const [over, setOver] = useState(false);
  return html`<a href=${'#/' + id} data-nav=${id.split('/')[0]} class=${cx('nav-i', active && 'on', over && 'drop')} onClick=${() => setUI({ sidebarOpen: false })}
      onContextMenu=${onContext}
      onDragOver=${onDrop ? (e) => { if ([...e.dataTransfer.types].includes('jamday/task')) { e.preventDefault(); setOver(true); } } : undefined}
      onDragLeave=${() => setOver(false)} onDrop=${onDrop ? (e) => { setOver(false); const tid = e.dataTransfer.getData('jamday/task'); if (tid) { e.preventDefault(); onDrop(tid); } } : undefined}>
    <span class="nav-ic" style=${color ? `color:${color}` : ''}>${children || html`<${Icon} name=${icon} size=${17} />`}</span>
    <span class="nav-l">${label}</span>
    ${count ? html`<span class=${cx('nav-c', danger && 'danger')}>${count}</span>` : ''}
  </a>`;
}

function Sidebar() {
  const r = S.ui.route;
  const T = D.today();
  const all = tasks();
  const counts = {
    inbox: all.filter(isInbox).length,
    today: all.filter((t) => isTodayTask(t, T) && !t.parentId).length,
    habits: all.filter((t) => t.repeat && !isDone(t) && taskDate(t) === T).length,
  };
  const overdue = all.filter((t) => isOverdue(t, T) && !t.parentId).length;
  const [foldersOpen, setFO] = useState(true);
  const [tagsOpen, setTO] = useState(true);
  const s = S.settings;
  const dropTo = {
    today: (id) => { update(id, { when: { kind: 'day', date: T } }); toast('Moved to Today'); },
    inbox: (id) => update(id, { when: null, deadline: null, folderId: null }),
    upcoming: (id) => update(id, { when: { kind: 'day', date: D.addDays(T, 1) } }),
  };
  return html`<aside class="sidebar" aria-label="Sidebar">
    <div class="sb-top">
      <a class="brand" href="#/today"><span class="brand-logo"><${Icon} name="logo" size=${24} /></span><b>JamDay</b></a>
      <span class="grow"></span>
      <button type="button" class="btn btn-icon btn-sm sb-collapse" title="Hide sidebar ([)" onClick=${() => { if (innerWidth < 900) setUI({ sidebarOpen: false }); else setSetting('sidebarCollapsed', true); }}><${Icon} name="sidebar" size=${17} /></button>
    </div>
    <button type="button" class="sb-search launch-btn" onClick=${() => { setUI({ sidebarOpen: false }); openLauncher(); }}>
      <${Icon} name="search" size=${16} /><span>Search</span><${Kbd} keys=${s.shortcuts.launcher === 'ctrl+k' ? 'ctrl+k' : s.shortcuts.launcher} />
    </button>
    <nav>
      ${s.sidebar.filter((x) => x.show).map((x) => html`<${NavItem} key=${x.id} id=${x.id} icon=${SECTIONS[x.id].icon} label=${SECTIONS[x.id].label}
        active=${r.view === x.id || (x.id === 'folders' && r.view === 'folder') || (x.id === 'tags' && r.view === 'tag')}
        count=${x.id === 'today' ? counts.today : counts[x.id]} danger=${x.id === 'today' && overdue > 0} onDrop=${dropTo[x.id]} />`)}
    </nav>
    ${s.sidebarFolders && html`<div class="sb-group">
      <div class="sb-gh"><button type="button" class="sb-gt" onClick=${() => setFO(!foldersOpen)}><${Icon} name=${foldersOpen ? 'chevD' : 'chevR'} size=${13} />Folders</button>
        <button type="button" class="btn btn-icon btn-sm" title="New folder" onClick=${async () => { const n = await promptDialog({ title: 'New folder', okLabel: 'Create', placeholder: 'e.g. Work' }); if (n && n.trim()) navigate('folder', create('folder', { name: n.trim() }).id); }}><${Icon} name="plus" size=${14} /></button></div>
      ${foldersOpen && folders().map((f) => html`<${NavItem} key=${f.id} id=${'folder/' + f.id} label=${f.name} color=${f.color} active=${r.view === 'folder' && r.id === f.id}
        count=${itemsInFolder(f.id).filter((i) => !(i.type === 'task' && isDone(i))).length || ''} onDrop=${(id) => { update(id, { folderId: f.id }); toast('Moved to ' + f.name); }}
        onContext=${(e) => { e.preventDefault(); openMenu({ left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY, width: 0, height: 0 }, folderMenu(f)); }}>
        ${f.icon ? html`<${ItemIcon} icon=${f.icon} size=${15} />` : html`<${Icon} name="folder" size=${16} />`}<//>`)}
      ${foldersOpen && !folders().length && html`<div class="sb-empty">No folders yet</div>`}
    </div>`}
    ${s.sidebarTags && tags().length > 0 && html`<div class="sb-group">
      <div class="sb-gh"><button type="button" class="sb-gt" onClick=${() => setTO(!tagsOpen)}><${Icon} name=${tagsOpen ? 'chevD' : 'chevR'} size=${13} />Tags</button></div>
      ${tagsOpen && html`<div class="sb-tags">${tags().map((t) => html`<a key=${t.id} href=${'#/tag/' + t.id} class=${cx('sb-tag', r.view === 'tag' && r.id === t.id && 'on')} style=${`--c:${t.color}`}
        onDragOver=${(e) => e.preventDefault()} onDrop=${(e) => { const id = e.dataTransfer.getData('jamday/task'); if (id) { const it = S.items.get(id); update(id, { tags: [...new Set([...(it.tags || []), t.id])] }); toast('Tagged #' + t.name); } }}>#${t.name}</a>`)}</div>`}
    </div>`}
    <div class="sb-foot">
      <${NavItem} id="trash" icon="trash" label="Trash" active=${r.view === 'trash'} />
      <a href="#/settings" class=${cx('nav-i sb-settings', r.view === 'settings' && 'on')} data-nav="settings"><span class="nav-ic"><${Icon} name="settings" size=${17} /></span><span class="nav-l">Settings</span></a>
      ${S.ui.installPrompt && html`<button type="button" class="nav-i install" onClick=${async () => { S.ui.installPrompt.prompt(); await S.ui.installPrompt.userChoice; S.ui.installPrompt = null; emit(); }}>
        <span class="nav-ic"><${Icon} name="download" size=${17} /></span><span class="nav-l">Install JamDay</span></button>`}
    </div>
  </aside>`;
}

/* ------------------------------------------------------------------ */
/* Shortcuts help                                                       */
/* ------------------------------------------------------------------ */

function ShortcutsHelp() {
  if (!S.ui.shortcutsHelp) return null;
  return html`<div class="modal-backdrop" onMouseDown=${(e) => e.target === e.currentTarget && setUI({ shortcutsHelp: false })}>
    <div class="modal" style="width:min(560px,calc(100vw - 24px))"><div class="dialog">
      <h3><${Icon} name="keyboard" size=${18} /> Keyboard shortcuts</h3>
      <div class="kbd-list">${SHORTCUTS.map(([l, k, ref]) => html`<div class="kbd-row"><span>${l}</span><${Kbd} keys=${ref ? S.settings.shortcuts[ref] : k} /></div>`)}</div>
      <div class="dialog-actions"><button type="button" class="btn btn-primary" onClick=${() => setUI({ shortcutsHelp: false })}>Done</button></div>
    </div></div>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Global keyboard                                                      */
/* ------------------------------------------------------------------ */

function comboMatches(e, combo) {
  const parts = combo.toLowerCase().split('+');
  const key = parts[parts.length - 1];
  const want = { ctrl: parts.includes('ctrl'), alt: parts.includes('alt'), shift: parts.includes('shift'), meta: parts.includes('meta') };
  if (e.ctrlKey !== want.ctrl || e.altKey !== want.alt || e.shiftKey !== want.shift || e.metaKey !== want.meta) return false;
  const k = e.key === ' ' ? 'space' : e.key.toLowerCase();
  return k === key || (key === 'space' && e.code === 'Space') || (key === '.' && e.code === 'Period');
}

let gPending = 0;
function onGlobalKey(e) {
  if (e.defaultPrevented) return;
  const s = S.settings;
  if (comboMatches(e, s.shortcuts.launcher) || ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k')) {
    e.preventDefault();
    if (S.ui.launcher) closeLauncher(); else { closePopover(); openLauncher(); }
    return;
  }
  if (comboMatches(e, s.shortcuts.panel)) { e.preventDefault(); togglePanel(); return; }
  if (e.key === 'Escape') {
    if (S.ui.shortcutsHelp) { setUI({ shortcutsHelp: false }); return; }
    if (S.overlay.popover) { closePopover(); return; }
    if (closeTopModal()) return;
    if (S.ui.launcher) { closeLauncher(); return; }
    if (S.ui.panel) { togglePanel(false); return; }
    if (S.ui.detail) { closeDetail(); return; }
    if (S.ui.sidebarOpen) { setUI({ sidebarOpen: false }); return; }
    return;
  }
  if (isEditableTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey || S.ui.launcher || S.overlay.modals.length || S.overlay.popover || S.ui.tour) return;
  const k = e.key;
  if (gPending && Date.now() - gPending < 1200) {
    gPending = 0;
    const map = { t: 'today', i: 'inbox', u: 'upcoming', c: 'calendar', n: 'notes', h: 'habits', k: 'tasks', e: 'events', f: 'folders', s: 'settings', a: 'assistant' };
    if (map[k]) { e.preventDefault(); navigate(map[k]); }
    return;
  }
  if (k === 'g') { gPending = Date.now(); return; }
  if (k === '/' ) { e.preventDefault(); openLauncher(); return; }
  if (k === '?') { e.preventDefault(); setUI({ shortcutsHelp: true }); return; }
  if (k === '[') { e.preventDefault(); if (innerWidth < 900) setUI({ sidebarOpen: !S.ui.sidebarOpen }); else setSetting('sidebarCollapsed', !s.sidebarCollapsed); return; }
  if (S.ui.route.view === 'calendar' && /^[dwm234.]$|^Arrow/.test(k)) return;
  if (k === 't') {
    e.preventDefault();
    const q = document.querySelector('#quick-add input');
    if (q) q.focus(); else { const t = create('task', { when: S.ui.route.view === 'today' ? { kind: 'day', date: D.today() } : null }); openItem(t.id); }
    return;
  }
  if (k === 'n') { e.preventDefault(); const n = create('note', {}); navigate('notes', n.id); return; }
  if (k === 'e') { e.preventDefault(); openQuickEvent({ left: innerWidth / 2 - 160, right: innerWidth / 2, top: 120, bottom: 120, width: 0, height: 0 }, { date: S.ui.route.view === 'calendar' ? S.ui.calendar.anchor : D.today() }); }
}

function onEdgeMove(e) {
  const p = S.settings.panel;
  if (!p.edge || S.ui.panel || e.buttons) return;
  const side = p.style === 'dock-left' ? 'left' : 'right';
  if ((side === 'right' && e.clientX >= innerWidth - 2) || (side === 'left' && e.clientX <= 1)) {
    if (e.clientY > 40) { S.ui.panelFromEdge = true; togglePanel(true); }
  }
}

/* ------------------------------------------------------------------ */
/* App                                                                  */
/* ------------------------------------------------------------------ */

function Main() {
  const r = S.ui.route;
  switch (r.view) {
    case 'inbox': return html`<${InboxView} />`;
    case 'today': return html`<${TodayView} />`;
    case 'upcoming': return html`<${UpcomingView} />`;
    case 'calendar': return html`<${CalendarView} />`;
    case 'tasks': return html`<${TasksView} />`;
    case 'events': return html`<${EventsView} />`;
    case 'notes': return html`<${NotesView} id=${r.id} />`;
    case 'habits': return html`<${HabitsView} />`;
    case 'folders': return html`<${FoldersView} />`;
    case 'folder': return html`<${FolderPage} key=${r.id} id=${r.id} />`;
    case 'tags': return html`<${TagsView} />`;
    case 'tag': return html`<${TagPage} key=${r.id} id=${r.id} />`;
    case 'trash': return html`<${TrashView} />`;
    case 'assistant': return html`<${AssistantView} />`;
    case 'settings': return html`<${SettingsView} section=${r.id} />`;
    case 'open': if (r.id) setTimeout(() => { navigate(S.settings.startView); openItem(r.id); }, 0); return null;
    default: return html`<${TodayView} />`;
  }
}

export function App() {
  const [, force] = useState(0);
  useLayoutEffect(() => {
    const off = subscribe(() => force((x) => x + 1));
    force((x) => x + 1); // catch anything emitted before we subscribed
    return off;
  }, []);
  useEffect(() => { applyTheme(); }, [S.settings]);
  useEffect(() => {
    addEventListener('keydown', onGlobalKey);
    addEventListener('mousemove', onEdgeMove, { passive: true });
    return () => { removeEventListener('keydown', onGlobalKey); removeEventListener('mousemove', onEdgeMove); };
  }, []);
  const ready = S.ready;
  useEffect(() => {
    if (ready && !S.settings.onboarded) setTimeout(showWelcome, 300);
  }, [ready]);
  if (!S.ready) return html`<div class="boot"><span class="brand-logo"><${Icon} name="logo" size=${44} /></span></div>`;
  const detailItem = S.ui.detail ? findEvent(S.ui.detail.id) : null;
  if (S.ui.detail && !detailItem) setTimeout(closeDetail, 0);
  return html`<div class=${cx('app', S.settings.sidebarCollapsed && 'sb-collapsed', S.ui.sidebarOpen && 'sb-open', detailItem && 'has-detail')}>
    <${Sidebar} />
    <div class="sb-scrim" onClick=${() => setUI({ sidebarOpen: false })}></div>
    <main class="main" id="main">
      ${S.settings.sidebarCollapsed && html`<button type="button" class="btn btn-icon sb-reopen" title="Show sidebar ([)" onClick=${() => setSetting('sidebarCollapsed', false)}><${Icon} name="sidebar" size=${17} /></button>`}
      <${Main} />
    </main>
    ${detailItem && html`<div class="drawer-scrim" onClick=${closeDetail}></div>
      <aside class="drawer" aria-label="Details">
        ${detailItem.type === 'task' ? html`<${TaskDetail} t=${detailItem} />` : html`<${EventDetail} e=${detailItem} />`}
      </aside>`}
    <${QuickPanel} />
    <${Launcher} />
    <${ShortcutsHelp} />
    <${ModalHost} />
    <${PopoverHost} />
    <${Tour} />
    <${ToastHost} />
  </div>`;
}
