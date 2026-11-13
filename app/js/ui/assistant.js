// AI assistant page: chat with your tasks, notes and calendar using your own API key.
import { html, useState, useRef, useEffect, cx } from '../lib.js';
import { S, emit, setSetting, navigate, openItem, toast, titleOf } from '../store.js';
import { Icon } from './icons.js';
import { Btn, ViewHeader, Switch } from './common.js';
import { markdownToBlocks, blocksToHTML } from '../md.js';
import * as AI from '../ai.js';

const SUGGESTIONS = [
  'What’s on my plate today?',
  'Plan my week around my calendar',
  'Summarize my recent notes',
  'Add a task to call the dentist tomorrow at 10am',
  'Which habits am I keeping up with?',
  'Break my biggest task into subtasks',
];

function Message({ m, idx }) {
  const applyAll = () => {
    const results = m.actions.map((a, i) => (m.applied && m.applied[i] ? null : AI.applyAction(a)));
    m.applied = m.actions.map(() => true);
    emit();
    const made = results.filter((r) => r && typeof r === 'object');
    toast(`Applied ${m.actions.length} change${m.actions.length > 1 ? 's' : ''}`, made.length === 1 ? { action: { label: 'Open', run: () => (made[0].type === 'note' ? navigate('notes', made[0].id) : openItem(made[0].id)) } } : {});
  };
  const applyOne = (i) => {
    const r = AI.applyAction(m.actions[i]);
    m.applied = m.applied || m.actions.map(() => false);
    m.applied[i] = true; emit();
    if (r && typeof r === 'object') toast('Done', { action: { label: 'Open', run: () => (r.type === 'note' ? navigate('notes', r.id) : openItem(r.id)) } });
  };
  if (m.role === 'user') return html`<div class="msg user"><div class="bubble">${m.content}</div></div>`;
  return html`<div class=${cx('msg ai', m.error && 'error')}>
    <span class="ai-av"><${Icon} name="sparkles" size=${15} /></span>
    <div class="bubble">
      ${m.error ? html`<p>${m.content}</p>` : html`<div class="md" dangerouslySetInnerHTML=${{ __html: blocksToHTML(markdownToBlocks(m.display || m.content)) }}></div>`}
      ${m.actions && m.actions.length > 0 && html`<div class="ai-actions">
        <div class="ai-actions-h"><${Icon} name="bolt" size=${14} /> Suggested changes</div>
        ${m.actions.map((a, i) => html`<div class=${cx('ai-act', m.applied && m.applied[i] && 'done')}>
          <span class="grow">${AI.describeAction(a)}</span>
          ${m.applied && m.applied[i] ? html`<span class="muted small"><${Icon} name="check" size=${13} /> Applied</span>` : html`<button type="button" class="btn btn-sm" onClick=${() => applyOne(i)}>Apply</button>`}
        </div>`)}
        ${!(m.applied && m.applied.every(Boolean)) && m.actions.length > 1 && html`<div class="row-end"><${Btn} size="sm" kind="primary" label="Apply all" onClick=${applyAll} /></div>`}
      </div>`}
      ${m.model && html`<div class="ai-model">${m.model}${m.tier ? ' · ' + (S.settings.ai.auto ? 'Auto → ' : '') + m.tier : ''}</div>`}
    </div>
  </div>`;
}

function Setup() {
  const ai = S.settings.ai;
  const P = AI.PROVIDERS[ai.provider];
  return html`<div class="ai-setup card-pad">
    <div class="ai-hero"><${Icon} name="sparkles" size=${30} /></div>
    <h2>Chat with your tasks, notes and calendar</h2>
    <p class="muted">The assistant is optional and off by default. It uses <b>your own API key</b> and only runs when you press Send. The data you choose to include (tasks, calendar, notes) is sent to the provider you pick — nowhere else.</p>
    <div class="form-grid">
      <label>Provider</label>
      <select class="input" value=${ai.provider} onChange=${(e) => setSetting('ai.provider', e.target.value)}>
        ${Object.entries(AI.PROVIDERS).map(([k, p]) => html`<option value=${k}>${p.name} (${p.vendor})</option>`)}</select>
      <label>API key</label>
      <div class="row"><input class="input grow" type="password" autocomplete="off" placeholder=${P.keyHint} value=${(ai.keys || {})[ai.provider] || ''}
        onInput=${(e) => setSetting('ai.keys', { ...(ai.keys || {}), [ai.provider]: e.target.value.trim() })} />
        <a class="btn" href=${P.keyUrl} target="_blank" rel="noopener"><${Icon} name="external" size=${14} />Get a key</a></div>
    </div>
    <p class="muted small"><${Icon} name="lock" size=${13} /> Keys are stored only on this device (in this app’s local storage) and are never included in backups.</p>
    <${Btn} kind="primary" icon="sparkles" label="Turn on the assistant" disabled=${!(ai.keys || {})[ai.provider]} onClick=${() => setSetting('ai.enabled', true)} />
  </div>`;
}

export function AssistantView() {
  const ai = S.settings.ai;
  const msgs = S.ai.messages;
  const [v, setV] = useState('');
  const endRef = useRef();
  const inRef = useRef();
  useEffect(() => { endRef.current && endRef.current.scrollIntoView({ block: 'end' }); }, [msgs.length, S.ai.busy]);
  const send = async (text) => {
    const content = (text ?? v).trim();
    if (!content || S.ai.busy) return;
    setV('');
    msgs.push({ role: 'user', content });
    S.ai.busy = true; emit();
    try {
      const history = msgs.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content })).slice(-16);
      const r = await AI.chat(history);
      const parsed = AI.parseActions(r.text);
      msgs.push({ role: 'assistant', content: r.text, display: parsed.text, actions: parsed.actions, model: r.model, tier: r.tier });
    } catch (e) {
      msgs.push({ role: 'assistant', content: e.message, error: true });
    }
    S.ai.busy = false; emit();
    setTimeout(() => inRef.current && inRef.current.focus(), 0);
  };
  const P = AI.PROVIDERS[ai.provider];
  return html`<div class="view assistant">
    <${ViewHeader} icon="sparkles" iconColor="var(--accent)" title="Assistant" subtitle=${ai.enabled ? `${P.name} · ${ai.auto ? 'Auto AI (fast or capable per message)' : AI.modelFor(ai.provider, ai.mode)}` : 'Optional · off by default'}>
      ${ai.enabled && msgs.length > 0 && html`<${Btn} icon="refresh" label="New chat" onClick=${() => { S.ai.messages = []; emit(); }} />`}
      <${Btn} icon="settings" title="AI settings" onClick=${() => navigate('settings', 'ai')} />
    <//>
    ${!ai.enabled ? html`<div class="view-body narrow"><${Setup} /></div>` : html`
      <div class="chat">
        ${!msgs.length && html`<div class="chat-empty">
          <div class="ai-hero"><${Icon} name="sparkles" size=${28} /></div>
          <h2>How can I help?</h2>
          <p class="muted">Ask about your day, plan your week, or have me create and update items. You confirm every change.</p>
          <div class="sugg">${SUGGESTIONS.map((s) => html`<button type="button" class="pill" onClick=${() => send(s)}>${s}</button>`)}</div>
        </div>`}
        ${msgs.map((m, i) => html`<${Message} key=${i} m=${m} idx=${i} />`)}
        ${S.ai.busy && html`<div class="msg ai"><span class="ai-av"><${Icon} name="sparkles" size=${15} /></span><div class="bubble typing"><i></i><i></i><i></i></div></div>`}
        <div ref=${endRef}></div>
      </div>
      <div class="composer">
        <div class="ctx-row">
          <span class="muted small">Share with ${P.name}:</span>
          ${[['includeTasks', 'Tasks', 'tasks'], ['includeEvents', 'Calendar', 'calendar'], ['includeNotes', 'Notes', 'notes']].map(([k, l, ic]) => html`<button type="button"
            class=${cx('pill sm', ai[k] && 'on')} onClick=${() => setSetting('ai.' + k, !ai[k])}><${Icon} name=${ic} size=${13} />${l}</button>`)}
        </div>
        <div class="composer-in">
          <textarea ref=${inRef} rows="1" class="input" placeholder="Ask anything… (Enter to send, Shift+Enter for a new line)" value=${v}
            onInput=${(e) => { setV(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(180, e.target.scrollHeight) + 'px'; }}
            onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}></textarea>
          <${Btn} icon="send" kind="primary" title="Send" disabled=${!v.trim() || S.ai.busy} onClick=${() => send()} />
        </div>
      </div>`}
  </div>`;
}
