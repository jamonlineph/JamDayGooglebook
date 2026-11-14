// MCP page: connect AI apps to JamDay through the local JamDay MCP connector.
import { html, useState, cx, download, android } from '../lib.js';
import { S, setSetting, toast } from '../store.js';
import { Icon } from './icons.js';
import { Btn, ViewHeader, Segmented, Switch, Empty, confirmDialog } from './common.js';
import { startMCP, stopMCP, reconnectNow, newToken, TOOL_INFO, DEFAULT_URL } from '../mcp.js';

const STATUS = {
  off: { label: 'Off', tone: 'off', text: 'AI apps can’t reach JamDay.' },
  connecting: { label: 'Connecting…', tone: 'wait', text: 'Looking for the JamDay connector on this device.' },
  waiting: { label: 'Waiting for the connector', tone: 'wait', text: 'Start an AI app that has the JamDay connector set up. JamDay keeps trying in the background.' },
  connected: { label: 'Connected', tone: 'on', text: 'AI apps using the connector can work with your JamDay now.' },
};

async function copy(text, what = 'Copied') {
  try { await navigator.clipboard.writeText(text); toast(what); } catch { toast('Couldn’t copy — select the text and copy it yourself.'); }
}

function Code({ text, label }) {
  return html`<div class="code-box">
    <pre>${text}</pre>
    <button type="button" class="btn btn-sm code-copy" onClick=${() => copy(text, (label || 'Snippet') + ' copied')}><${Icon} name="copy" size=${14} /><span>Copy</span></button>
  </div>`;
}

function snippets(token, path, port) {
  const portArgs = port && port !== '41823' ? `, "--port", "${port}"` : '';
  const portCli = port && port !== '41823' ? ` --port ${port}` : '';
  const desktop = `{
  "mcpServers": {
    "jamday": {
      "command": "node",
      "args": ["${path}"${portArgs}],
      "env": { "JAMDAY_TOKEN": "${token}" }
    }
  }
}`;
  return {
    claude: { title: 'Claude Desktop', where: 'Settings ▸ Developer ▸ Edit config, then add this to claude_desktop_config.json and restart Claude:', code: desktop },
    code: { title: 'Claude Code', where: 'Run this once in a terminal:', code: `claude mcp add jamday --env JAMDAY_TOKEN=${token} -- node ${path}${portCli}` },
    cursor: { title: 'Cursor', where: 'Add this to ~/.cursor/mcp.json (or the project’s .cursor/mcp.json):', code: desktop },
    vscode: { title: 'VS Code', where: 'Add this to .vscode/mcp.json, then start the server from the MCP view:', code: `{
  "servers": {
    "jamday": {
      "type": "stdio",
      "command": "node",
      "args": ["${path}"${portArgs}],
      "env": { "JAMDAY_TOKEN": "${token}" }
    }
  }
}` },
    other: { title: 'Other apps', where: 'Any MCP client that can start a local (stdio) server:', code: `command: node\nargs:    ${path}${portCli}\nenv:     JAMDAY_TOKEN=${token}` },
  };
}

export function MCPView() {
  const m = S.settings.mcp;
  const st = STATUS[S.mcp.status] || STATUS.off;
  const [tab, setTab] = useState('claude');
  const [path, setPath] = useState(() => { try { return localStorage.getItem('jd.mcpPath') || ''; } catch { return ''; } });
  const [showToken, setShowToken] = useState(false);
  const port = ((m.url || DEFAULT_URL).match(/:(\d+)/) || [])[1] || '41823';
  const filePath = path.trim() || (android() ? '/path/to/jamday-mcp.mjs' : '~/Downloads/jamday-mcp.mjs');
  const sn = snippets(m.token || 'turn-on-MCP-first', filePath, port);
  const toggle = (on) => { setSetting('mcp.enabled', on); setTimeout(on ? startMCP : stopMCP, 0); };
  const getConnector = async () => {
    try {
      const res = await fetch(new URL('../mcp/jamday-mcp.mjs', location.href));
      download('jamday-mcp.mjs', await res.text(), 'text/javascript');
    } catch (e) { toast('Couldn’t get the connector: ' + e.message, { kind: 'error' }); }
  };
  return html`<div class="view">
    <${ViewHeader} icon="plug" iconColor="var(--accent)" title="MCP" subtitle="Let AI apps like Claude work with your tasks, notes and calendar" />
    <div class="view-body narrow">
      <section class=${cx('mcp-hero', 'tone-' + st.tone)}>
        <div class="mcp-hero-main">
          <span class="mcp-dot"></span>
          <div><b>${st.label}</b><span class="muted small">${st.text}${S.mcp.status === 'connected' && S.mcp.calls ? ` · ${S.mcp.calls} request${S.mcp.calls === 1 ? '' : 's'} this session` : ''}</span></div>
          <span class="grow"></span>
          ${m.enabled && S.mcp.status !== 'connected' && html`<${Btn} size="sm" icon="refresh" label="Retry now" onClick=${reconnectNow} />`}
        </div>
        <${Switch} label="Allow MCP clients" hint="AI apps connect through the JamDay connector running on this device. Nothing goes through the internet." checked=${m.enabled} onChange=${toggle} />
        <div class="mcp-row">
          <span>What AI apps may do</span>
          <${Segmented} size="sm" value=${m.access} onChange=${(v) => setSetting('mcp.access', v)} options=${[{ v: 'read', label: 'Read only' }, { v: 'write', label: 'Read & make changes' }]} />
        </div>
        <${Switch} label="Tell me when an AI app changes something" hint="Shows a notice with Undo for every change." checked=${m.notify} onChange=${(v) => setSetting('mcp.notify', v)} />
      </section>

      <h2 class="mcp-h">Set it up</h2>
      <ol class="mcp-steps">
        <li>
          <div class="mcp-step-h"><b>Get the JamDay connector</b><span class="muted small">One small file. It needs <a href="https://nodejs.org" target="_blank" rel="noopener">Node.js</a> 18 or newer on the computer that runs your AI app.</span></div>
          <div class="row wrap"><${Btn} icon="download" label="Download jamday-mcp.mjs" kind="primary" onClick=${getConnector} />
            <input class="input sm grow" placeholder="Where you saved it, e.g. /home/you/jamday-mcp.mjs" value=${path}
              onInput=${(e) => { setPath(e.target.value); try { localStorage.setItem('jd.mcpPath', e.target.value); } catch { /* ignore */ } }} /></div>
        </li>
        <li>
          <div class="mcp-step-h"><b>Add it to your AI app</b><span class="muted small">${m.token ? 'Your snippet already includes this device’s token.' : 'Turn on “Allow MCP clients” first to create your token.'}</span></div>
          <div class="mcp-tabs">${Object.entries(sn).map(([k, v]) => html`<button type="button" class=${cx('pill sm', tab === k && 'on')} onClick=${() => setTab(k)}>${v.title}</button>`)}</div>
          <p class="muted small">${sn[tab].where}</p>
          <${Code} text=${sn[tab].code} label=${sn[tab].title + ' setup'} />
        </li>
        <li>
          <div class="mcp-step-h"><b>Keep JamDay open</b><span class="muted small">Then ask your AI app things like “What’s on my plate today?” or “Plan my week in JamDay”.</span></div>
        </li>
      </ol>

      <details class="mcp-adv">
        <summary>Connection details</summary>
        <div class="mcp-row"><span>Connector address</span>
          <div class="row"><input class="input sm" value=${m.url} onChange=${(e) => { setSetting('mcp.url', e.target.value.trim() || DEFAULT_URL); if (m.enabled) setTimeout(reconnectNow, 0); }} />
          ${m.url !== DEFAULT_URL && html`<${Btn} size="sm" label="Reset" onClick=${() => { setSetting('mcp.url', DEFAULT_URL); if (m.enabled) setTimeout(reconnectNow, 0); }} />`}</div></div>
        <div class="mcp-row"><span>Token</span>
          <div class="row"><code class="token">${m.token ? (showToken ? m.token : '•'.repeat(12) + m.token.slice(-4)) : '—'}</code>
            ${m.token && html`<${Btn} size="sm" icon="eye" title=${showToken ? 'Hide' : 'Show'} onClick=${() => setShowToken(!showToken)} />
            <${Btn} size="sm" icon="copy" title="Copy token" onClick=${() => copy(m.token, 'Token copied')} />`}
            <${Btn} size="sm" icon="refresh" label="New token" onClick=${async () => {
              if (await confirmDialog({ title: 'Create a new token?', message: 'AI apps set up with the old token won’t be able to connect until you update their settings.', confirmLabel: 'Create new token', danger: false })) {
                setSetting('mcp.token', newToken()); if (m.enabled) setTimeout(reconnectNow, 0);
              }
            }} /></div></div>
        <p class="muted small">Using a Chromebook or Googlebook with your AI app in the Linux environment? Turn on port forwarding for port ${port} in ChromeOS Settings ▸ About ChromeOS ▸ Developers ▸ Linux ▸ Port forwarding, so JamDay in Chrome can reach the connector.</p>
      </details>

      <h2 class="mcp-h">What AI apps can do</h2>
      <div class="tool-grid">${TOOL_INFO.map((t) => html`<div class=${cx('tool', t.write && 'write', t.write && m.access !== 'write' && 'blocked')}>
        <${Icon} name=${t.write ? 'bolt' : 'eye'} size=${14} /><span>${t.label}</span><code>${t.name}</code></div>`)}</div>
      ${m.access !== 'write' && html`<p class="muted small">Changes are switched off — AI apps can only read.</p>`}

      <h2 class="mcp-h">Activity</h2>
      ${!S.mcp.log.length ? html`<${Empty} icon="plug" title="No requests yet" text="Requests from AI apps show up here, so you can always see what they read or changed." />`
        : html`<div class="mcp-log">${S.mcp.log.map((e) => html`<div class=${cx('mcp-log-row', !e.ok && 'err')}>
            <span class="mcp-log-t">${new Date(e.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</span>
            <${Icon} name=${e.ok ? (TOOL_INFO.find((t) => t.name === e.tool) || {}).write ? 'bolt' : 'eye' : 'info'} size=${14} />
            <code>${e.tool}</code><span class="ellipsis grow">${e.summary}</span></div>`)}</div>`}
    </div>
  </div>`;
}
