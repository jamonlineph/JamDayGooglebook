// First-run welcome + feature tour.
import { html, useState, useLayoutEffect, useEffect } from '../lib.js';
import { S, emit, setSetting, navigate, openModal } from '../store.js';
import { Icon } from './icons.js';
import { Btn, Kbd } from './common.js';
import { loadDemo } from '../demo.js';

const STEPS = [
  { sel: '.sidebar nav', title: 'Everything in one place', text: 'Inbox, Today, Upcoming, Calendar, Notes and Habits live here. Reorder or hide sections in Settings ▸ Sidebar.', sidebar: true },
  { sel: '#quick-add', title: 'Capture with quick tokens', text: 'Try “Call Ana @tomorrow 3pm #home &Family !high”. @ sets the date, # adds a tag, & picks a folder and ! sets priority.' },
  { sel: '.launch-btn', title: 'Quick Launcher', text: 'Press Alt+Space (or Ctrl+K) anywhere to search everything or create tasks, events and notes. Type > for commands and Tab for quick actions.', sidebar: true },
  { sel: '.panel-toggle', title: 'Quick panel', text: 'A compact companion with Today, Calendar, Tasks, Events and Notes tabs. Ctrl+Alt+Space toggles it — use it as a dropdown, a floating window, or docked to an edge.' },
  { sel: '[data-nav="calendar"]', title: 'Calendar', text: 'Day, 2/3/4-day, week and month views. Drag to create, move or resize events. Connect Google Calendar from Settings.', sidebar: true },
  { sel: '[data-nav="notes"]', title: 'Notes that do more', text: 'Headings, to-dos, tables, images and covers. Type / for commands (even mid-line) and @ to link tasks, events or other notes.', sidebar: true },
  { sel: '[data-nav="habits"]', title: 'Habits with streaks', text: 'Any task can repeat. Keep the 🔥 streak going — the flame shows in Today, Upcoming and the calendar.', sidebar: true },
  { sel: '.sb-settings', title: 'Make it yours', text: 'Themes (including glass), shortcuts, reminders, Google sync, and on-device AI are in Settings. Connect AI apps like Claude from MCP in the sidebar.', sidebar: true },
];

export function startTour() { S.ui.tour = { i: 0 }; emit(); }
function endTour() { S.ui.tour = null; S.ui.sidebarOpen = false; setSetting('tourDone', true); }

export function Tour() {
  const t = S.ui.tour;
  const [rect, setRect] = useState(null);
  const step = t ? STEPS[t.i] : null;
  useLayoutEffect(() => {
    if (!step) return;
    const narrow = innerWidth < 900;
    if (narrow && step.sidebar !== S.ui.sidebarOpen) { S.ui.sidebarOpen = !!step.sidebar; emit(); }
    const measure = () => {
      const el = document.querySelector(step.sel);
      const r = el && el.getBoundingClientRect();
      setRect(r && r.width ? { left: r.left, top: r.top, width: r.width, height: r.height } : null);
    };
    const id = setTimeout(measure, 60);
    addEventListener('resize', measure);
    return () => { clearTimeout(id); removeEventListener('resize', measure); };
  }, [t && t.i]);
  useEffect(() => {
    if (!t) return;
    const k = (e) => { if (e.key === 'Escape') { endTour(); } if (e.key === 'ArrowRight') go(1); if (e.key === 'ArrowLeft') go(-1); };
    addEventListener('keydown', k, true);
    return () => removeEventListener('keydown', k, true);
  });
  if (!t) return null;
  const go = (d) => { const i = t.i + d; if (i >= STEPS.length) endTour(); else if (i >= 0) { S.ui.tour = { i }; emit(); } };
  const pad = 6;
  const W = 330;
  let cardStyle = `left:50%;top:50%;transform:translate(-50%,-50%)`;
  if (rect) {
    const right = rect.left + rect.width + 16;
    const below = rect.top + rect.height + 14;
    if (right + W < innerWidth && rect.width < innerWidth * 0.5) cardStyle = `left:${right}px;top:${Math.max(12, Math.min(innerHeight - 230, rect.top))}px`;
    else if (below + 200 < innerHeight) cardStyle = `left:${Math.max(12, Math.min(innerWidth - W - 12, rect.left))}px;top:${below}px`;
    else cardStyle = `left:${Math.max(12, Math.min(innerWidth - W - 12, rect.left))}px;top:${Math.max(12, rect.top - 214)}px`;
  }
  return html`<div class="tour" role="dialog" aria-label="Feature tour">
    ${rect ? html`<div class="tour-spot" style=${`left:${rect.left - pad}px;top:${rect.top - pad}px;width:${rect.width + pad * 2}px;height:${rect.height + pad * 2}px`}></div>` : html`<div class="tour-dim"></div>`}
    <div class="tour-card" style=${cardStyle}>
      <div class="muted small">Step ${t.i + 1} of ${STEPS.length}</div>
      <h3>${step.title}</h3>
      <p>${step.text}</p>
      <div class="dialog-actions">
        <button type="button" class="btn btn-sm btn-ghost" onClick=${endTour}>Skip tour</button><span class="grow"></span>
        ${t.i > 0 && html`<${Btn} size="sm" label="Back" onClick=${() => go(-1)} />`}
        <${Btn} size="sm" kind="primary" label=${t.i === STEPS.length - 1 ? 'Done' : 'Next'} onClick=${() => go(1)} />
      </div>
    </div>
  </div>`;
}

let welcomeOpen = false;
export function showWelcome() {
  if (welcomeOpen || S.settings.onboarded) return;
  welcomeOpen = true;
  openModal((close) => html`<div class="welcome">
    <div class="welcome-art"><span class="logo-big"><${Icon} name="logo" size=${58} /></span></div>
    <h2>Welcome to JamDay</h2>
    <p class="lead">Tasks, notes & calendar. One beautiful app for your Googlebook.</p>
    <ul class="welcome-list">
      <li><${Icon} name="calendar" size=${18} /><span><b>Calendar & events</b> — day to month views, Google Calendar optional</span></li>
      <li><${Icon} name="flame" size=${18} /><span><b>Tasks & habits</b> — plain-language dates, quick tokens, streaks</span></li>
      <li><${Icon} name="notes" size=${18} /><span><b>Notes</b> — blocks, tables, mentions, covers and icons</span></li>
      <li><${Icon} name="lock" size=${18} /><span><b>Local & private</b> — no account, works offline, no tracking</span></li>
    </ul>
    <div class="welcome-actions">
      <${Btn} kind="primary" icon="sparkles" label="Explore with demo content" onClick=${() => { loadDemo(); setSetting('onboarded', true); close(); navigate('today'); setTimeout(startTour, 350); }} />
      <${Btn} label="Start with a clean slate" onClick=${() => { setSetting('onboarded', true); close(); navigate('today'); setTimeout(startTour, 350); }} />
    </div>
    <p class="muted small center">Tip: press <${Kbd} keys=${S.settings.shortcuts.launcher} /> any time to search or create.</p>
  </div>`, { width: 520, sticky: true, className: 'modal-welcome', onClose: () => { welcomeOpen = false; } });
}
