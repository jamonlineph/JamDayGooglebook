// Boot: load data, render, register the service worker, wire install + notification clicks.
import { html, render, android } from './lib.js';
import { S, boot, emit, openItem, toast } from './store.js';
import { App, applyTheme } from './ui/app.js';
import { startScheduler } from './notify.js';
import { startMCP } from './mcp.js';

applyTheme();
render(html`<${App} />`, document.getElementById('app'));

boot().then(() => {
  applyTheme();
  startScheduler();
  if (S.settings.mcp && S.settings.mcp.enabled) startMCP();
}).catch((e) => {
  console.error(e);
  document.getElementById('app').innerHTML = `<div class="boot-error"><h2>JamDay couldn’t open its local database</h2><p>${String(e && e.message || e)}</p><p>If you’re in a private/guest window, storage may be disabled. Try a normal window.</p></div>`;
});

// Install as an app (Chrome on Googlebook / ChromeOS / Android / desktop)
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.ui.installPrompt = e; emit(); });
addEventListener('appinstalled', () => { S.ui.installPrompt = null; emit(); toast('JamDay is installed — find it in your launcher and shelf.'); });

// Offline support + notification clicks
// Inside the Android app, files ship with the APK, so no service worker is needed.
if (android()) {
  document.documentElement.dataset.platform = 'android';
  window.jamdayOpen = (id) => { if (id) openItem(id); };
} else if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('Service worker not registered', e));
  navigator.serviceWorker.addEventListener('message', (ev) => {
    if (ev.data && ev.data.type === 'open' && ev.data.id) openItem(ev.data.id);
  });
}

// Deep links from the manifest's shortcuts (e.g. ?new=task)
const params = new URLSearchParams(location.search);
if (params.get('new')) {
  const kind = params.get('new');
  history.replaceState(null, '', location.pathname + location.hash);
  const wait = setInterval(async () => {
    if (!S.ready) return;
    clearInterval(wait);
    const { create, navigate } = await import('./store.js');
    if (kind === 'note') { const n = create('note', {}); navigate('notes', n.id); }
    else if (kind === 'event') { navigate('calendar'); }
    else { const { openLauncher } = await import('./ui/launcher.js'); openLauncher(''); }
  }, 50);
}
