// AI: optional assistant with the user's own key (Claude, ChatGPT, Gemini, Grok) and
// on-device rewrite/summarize through Chrome's built-in AI (Gemini Nano) when available.
// Nothing is sent anywhere unless the user presses Send / picks an AI action.
import {
  S, tasks, notes, allEvents, titleOf, taskDate, isDone, liveTags, folderOf, blocksText, create, update, alive,
  findOrCreateTag, findOrCreateFolder, trash, toggleTask, toast,
} from './store.js';
import * as D from './dates.js';
import { markdownToBlocks } from './md.js';

export const PROVIDERS = {
  claude: { name: 'Claude', vendor: 'Anthropic', fast: 'claude-haiku-5-5', capable: 'claude-sonnet-5-5', keyUrl: 'https://console.anthropic.com/settings/keys', keyHint: 'sk-ant-…' },
  openai: { name: 'ChatGPT', vendor: 'OpenAI', fast: 'gpt-5-mini', capable: 'gpt-5', keyUrl: 'https://platform.openai.com/api-keys', keyHint: 'sk-…' },
  gemini: { name: 'Gemini', vendor: 'Google', fast: 'gemini-2.5-flash', capable: 'gemini-2.5-pro', keyUrl: 'https://aistudio.google.com/app/apikey', keyHint: 'AIza…' },
  grok: { name: 'Grok', vendor: 'xAI', fast: 'grok-3-mini', capable: 'grok-4', keyUrl: 'https://console.x.ai', keyHint: 'xai-…' },
};

export function modelFor(provider, tier) {
  const m = S.settings.ai.models && S.settings.ai.models[provider] && S.settings.ai.models[provider][tier];
  return (m && m.trim()) || PROVIDERS[provider][tier];
}

/** "Auto AI": quick questions go to the fast model, planning/writing to the capable one. */
export function pickTier(text) {
  const ai = S.settings.ai;
  if (!ai.auto) return ai.mode || 'capable';
  const heavy = /\b(plan|schedule|organi[sz]e|analy[sz]e|summari[sz]e|review|prioriti[sz]e|this week|next week|month|draft|write|outline|compare|break (it )?down|brainstorm|reschedule)\b/i.test(text);
  return text.length > 220 || heavy ? 'capable' : 'fast';
}

export async function callModel({ provider, model, key, system, messages, maxTokens = 2048 }) {
  if (!key) throw new Error(`Add your ${PROVIDERS[provider].vendor} API key in Settings ▸ AI.`);
  let res, data;
  const fail = async (r) => {
    let msg = 'HTTP ' + r.status;
    try { const j = await r.json(); msg = (j.error && (j.error.message || j.error)) || j.message || msg; } catch { /* ignore */ }
    throw new Error(`${PROVIDERS[provider].name}: ${msg}`);
  };
  if (provider === 'claude') {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: messages.map((m) => ({ role: m.role, content: m.content })) }),
    });
    if (!res.ok) await fail(res);
    data = await res.json();
    return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  }
  if (provider === 'openai' || provider === 'grok') {
    const url = provider === 'openai' ? 'https://api.openai.com/v1/chat/completions' : 'https://api.x.ai/v1/chat/completions';
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, ...messages] }),
    });
    if (!res.ok) await fail(res);
    data = await res.json();
    return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  }
  if (provider === 'gemini') {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        generationConfig: { maxOutputTokens: maxTokens },
      }),
    });
    if (!res.ok) await fail(res);
    data = await res.json();
    const c = data.candidates && data.candidates[0];
    return c && c.content ? (c.content.parts || []).map((p) => p.text || '').join('') : '';
  }
  throw new Error('Unknown provider');
}

/* ---------------- context + actions ---------------- */

export function buildContext() {
  const ai = S.settings.ai;
  const T = D.today();
  const parts = [];
  if (ai.includeTasks) {
    const open = tasks().filter((t) => !isDone(t)).slice(0, 200).map((t) => ({
      id: t.id, title: t.title,
      when: t.when ? (t.when.kind === 'day' ? t.when.date + (t.when.time ? ' ' + t.when.time : '') : t.when.kind + (t.when.date ? ' of ' + t.when.date : '')) : undefined,
      deadline: t.deadline || undefined, priority: t.priority || undefined, status: t.status !== 'todo' ? t.status : undefined,
      folder: folderOf(t) ? folderOf(t).name : undefined, tags: liveTags(t).length ? liveTags(t).map((x) => x.name) : undefined,
      habit: t.repeat ? D.describeRepeat(t.repeat) + ', streak ' + D.habitStats(t).streak : undefined, parent: t.parentId || undefined,
    }));
    const done = tasks().filter((t) => isDone(t) && t.completedAt > Date.now() - 7 * 86400000).map((t) => t.title).slice(0, 40);
    parts.push('OPEN TASKS:\n' + JSON.stringify(open) + (done.length ? '\nCOMPLETED IN THE LAST 7 DAYS: ' + JSON.stringify(done) : ''));
  }
  if (ai.includeEvents) {
    const evs = allEvents().filter((e) => e.end.slice(0, 10) >= D.addDays(T, -7) && e.start.slice(0, 10) <= D.addDays(T, 31)).sort((a, b) => (a.start < b.start ? -1 : 1)).slice(0, 200)
      .map((e) => ({ id: e.source === 'google' ? undefined : e.id, title: e.title, start: e.start, end: e.end, allDay: e.allDay || undefined, location: e.location || undefined, readOnly: e.source === 'google' || undefined }));
    parts.push('CALENDAR (last week to next month):\n' + JSON.stringify(evs));
  }
  if (ai.includeNotes) {
    const ns = notes().slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 40)
      .map((n) => ({ id: n.id, title: titleOf(n), folder: folderOf(n) ? folderOf(n).name : undefined, text: blocksText(n.blocks).slice(0, 700) }));
    parts.push('NOTES (most recent first, truncated):\n' + JSON.stringify(ns));
  }
  return parts.join('\n\n');
}

export function systemPrompt() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `You are the built-in assistant in JamDay, a private, local-first app for tasks, notes and calendar.
Today is ${D.fmtDate(D.today(), { weekday: true, long: true, year: true })} (${D.today()}); local time ${D.hhmm(new Date())} (${tz}).
Answer concisely in friendly Markdown.

When the user asks you to create, change, complete or delete things, add ONE fenced code block tagged \`jamday\` that holds a JSON array of actions. The app shows them to the user, who confirms before anything changes. Supported actions:
- {"action":"create_task","title":"…","date":"YYYY-MM-DD","time":"HH:MM","deadline":"YYYY-MM-DD","priority":0-4,"tags":["…"],"folder":"…","notes":"markdown","repeat":"every weekday"}
- {"action":"update_task","id":"…", …any create_task fields}
- {"action":"complete_task","id":"…"}
- {"action":"create_event","title":"…","start":"YYYY-MM-DDTHH:MM","end":"YYYY-MM-DDTHH:MM","allDay":false,"location":"…","notes":"markdown"}
- {"action":"update_event","id":"…", …any create_event fields}
- {"action":"create_note","title":"…","markdown":"…","folder":"…","tags":["…"]}
- {"action":"append_to_note","id":"…","markdown":"…"}
- {"action":"delete","id":"…"}
Use only ids that appear in the data below. Leave out fields you don't need. Don't invent facts. Events marked readOnly come from Google Calendar and can't be changed.

USER DATA:
${buildContext() || '(The user chose not to share any of their data with you.)'}`;
}

export function parseActions(text) {
  const re = /```jamday\s*([\s\S]*?)```/i;
  const m = re.exec(text || '');
  if (!m) return { text, actions: [] };
  let actions = [];
  try { const j = JSON.parse(m[1]); actions = Array.isArray(j) ? j : [j]; } catch { actions = []; }
  return { text: text.replace(re, '').trim(), actions: actions.filter((a) => a && a.action) };
}

export function describeAction(a) {
  const it = a.id ? alive(a.id) : null;
  const name = a.title || (it ? titleOf(it) : a.id || '');
  switch (a.action) {
    case 'create_task': return `New task “${name}”${a.date ? ' · ' + D.fmtDate(a.date, { weekday: true }) : ''}${a.time ? ' ' + D.fmtTime(a.time, S.settings.timeFormat) : ''}${a.repeat ? ' · ' + a.repeat : ''}`;
    case 'update_task': return `Update task “${name}”`;
    case 'complete_task': return `Complete “${name}”`;
    case 'create_event': return `New event “${name}”${a.start ? ' · ' + D.fmtDate(a.start.slice(0, 10), { weekday: true }) + (a.allDay ? '' : ' ' + D.fmtTime(a.start.slice(11, 16), S.settings.timeFormat)) : ''}`;
    case 'update_event': return `Update event “${name}”`;
    case 'create_note': return `New note “${name}”`;
    case 'append_to_note': return `Add to note “${name}”`;
    case 'delete': return `Move “${name}” to Trash`;
    default: return a.action;
  }
}

function taskFields(a) {
  const p = {};
  if (a.title != null) p.title = String(a.title);
  if (a.date) p.when = { kind: 'day', date: a.date, time: a.time || null };
  if (a.deadline !== undefined) p.deadline = a.deadline || null;
  if (a.priority != null) p.priority = Math.max(0, Math.min(4, +a.priority || 0));
  if (Array.isArray(a.tags)) p.tags = a.tags.map((n) => findOrCreateTag(n)).filter(Boolean).map((t) => t.id);
  if (a.folder) p.folderId = findOrCreateFolder(a.folder).id;
  if (a.notes) p.notes = markdownToBlocks(a.notes);
  if (a.repeat) {
    const r = D.parseNatural(String(a.repeat));
    if (r.repeat) { p.repeat = { ...r.repeat, anchor: (p.when && p.when.date) || r.date || D.today() }; if (!p.when) p.when = { kind: 'day', date: r.date || D.today() }; }
  }
  if (p.when && p.when.time) p.reminder = p.when.date + 'T' + p.when.time;
  return p;
}

export function applyAction(a) {
  switch (a.action) {
    case 'create_task': return create('task', taskFields(a));
    case 'update_task': if (alive(a.id)) return update(a.id, taskFields(a)); break;
    case 'complete_task': { const t = alive(a.id); if (t && !isDone(t)) toggleTask(t.id); return t; }
    case 'create_event':
    case 'update_event': {
      const p = {};
      if (a.title != null) p.title = String(a.title);
      if (a.allDay != null) p.allDay = !!a.allDay;
      if (a.start) p.start = a.start.length === 10 ? a.start + 'T00:00' : a.start.slice(0, 16);
      if (a.end) p.end = a.end.length === 10 ? a.end + 'T00:00' : a.end.slice(0, 16);
      if (p.start && !p.end && a.action === 'create_event') p.end = p.allDay ? p.start : D.addMinutesDT(p.start, 60);
      if (a.location != null) p.location = a.location;
      if (a.notes) p.notes = markdownToBlocks(a.notes);
      if (a.action === 'create_event') return create('event', p);
      if (alive(a.id)) return update(a.id, p);
      break;
    }
    case 'create_note': {
      const p = { title: a.title || 'Untitled note', blocks: markdownToBlocks(a.markdown || '') };
      if (a.folder) p.folderId = findOrCreateFolder(a.folder).id;
      if (Array.isArray(a.tags)) p.tags = a.tags.map((n) => findOrCreateTag(n).id);
      return create('note', p);
    }
    case 'append_to_note': { const n = alive(a.id); if (n) return update(n.id, { blocks: [...(n.blocks || []), ...markdownToBlocks(a.markdown || '')] }); break; }
    case 'delete': if (alive(a.id)) { trash(a.id); return true; } break;
    default: break;
  }
  return null;
}

export async function chat(history) {
  const ai = S.settings.ai;
  if (!ai.enabled) throw new Error('The AI assistant is off. Turn it on in Settings ▸ AI.');
  const provider = ai.provider;
  const key = (ai.keys || {})[provider];
  const last = history[history.length - 1];
  const tier = pickTier(last ? last.content : '');
  const model = modelFor(provider, tier);
  const text = await callModel({ provider, model, key, system: systemPrompt(), messages: history.map((m) => ({ role: m.role, content: m.content })) });
  return { text, model, tier };
}

/* ---------------- on-device AI (Chrome built-in, Gemini Nano) ---------------- */

export async function localAIStatus() {
  const check = async (name) => {
    try { return name in self ? await self[name].availability() : 'unsupported'; } catch { return 'unsupported'; }
  };
  return { summarizer: await check('Summarizer'), rewriter: await check('Rewriter'), prompt: await check('LanguageModel') };
}

const usable = (s) => s === 'available' || s === 'downloadable' || s === 'downloading';

async function cloudFallback(prompt) {
  const ai = S.settings.ai;
  const key = (ai.keys || {})[ai.provider];
  if (!ai.enabled || !key) throw new Error('On-device AI isn’t available in this browser yet (it needs Chrome with built-in AI). You can turn on the AI assistant with your own key in Settings ▸ AI instead.');
  toast(`Using ${PROVIDERS[ai.provider].name} (cloud) — on-device AI isn’t available here.`, { timeout: 3500 });
  return callModel({ provider: ai.provider, model: modelFor(ai.provider, 'fast'), key, system: 'You are a precise writing assistant. Reply with the resulting text only, no preamble.', messages: [{ role: 'user', content: prompt }], maxTokens: 1500 });
}

function monitor(m) {
  m.addEventListener('downloadprogress', (e) => { if (e.loaded < 1) toast(`Downloading on-device model… ${Math.round(e.loaded * 100)}%`, { timeout: 1500 }); });
}

export async function summarizeText(text) {
  const st = await localAIStatus();
  if (usable(st.summarizer)) {
    const s = await self.Summarizer.create({ type: 'tldr', format: 'plain-text', length: 'medium', monitor });
    try { return await s.summarize(text); } finally { s.destroy && s.destroy(); }
  }
  if (usable(st.prompt)) {
    const s = await self.LanguageModel.create({ monitor });
    try { return await s.prompt('Summarize this in 2–4 sentences. Reply with the summary only.\n\n' + text); } finally { s.destroy && s.destroy(); }
  }
  return cloudFallback('Summarize the following in 2–4 sentences:\n\n' + text);
}

export async function rewriteText(text, style = 'improve') {
  const st = await localAIStatus();
  const instruction = { improve: 'improve clarity and fix grammar, keep the meaning', 'more-formal': 'make it more formal', 'more-casual': 'make it more casual', shorter: 'make it shorter', longer: 'expand it a little' }[style] || 'improve it';
  if (usable(st.rewriter)) {
    const r = await self.Rewriter.create({
      tone: style === 'more-formal' ? 'more-formal' : style === 'more-casual' ? 'more-casual' : 'as-is',
      length: style === 'shorter' ? 'shorter' : style === 'longer' ? 'longer' : 'as-is',
      format: 'plain-text', monitor,
    });
    try { return await r.rewrite(text, { context: 'Please ' + instruction + '.' }); } finally { r.destroy && r.destroy(); }
  }
  if (usable(st.prompt)) {
    const s = await self.LanguageModel.create({ monitor });
    try { return await s.prompt(`Rewrite the text below to ${instruction}. Reply with the rewritten text only.\n\n${text}`); } finally { s.destroy && s.destroy(); }
  }
  return cloudFallback(`Rewrite the text below to ${instruction}. Reply with the rewritten text only.\n\n${text}`);
}
