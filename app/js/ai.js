// On-device AI: rewrite and summarize with Chrome's built-in model (Gemini Nano) when the device
// supports it. Nothing is sent anywhere. To use other AI apps with JamDay, connect them through MCP.
import { toast } from './store.js';

export async function localAIStatus() {
  const check = async (name) => {
    try { return name in self ? await self[name].availability() : 'unsupported'; } catch { return 'unsupported'; }
  };
  return { summarizer: await check('Summarizer'), rewriter: await check('Rewriter'), prompt: await check('LanguageModel') };
}

const usable = (s) => s === 'available' || s === 'downloadable' || s === 'downloading';
const UNAVAILABLE = 'On-device AI isn’t available on this device yet. It needs Chrome with built-in AI (Gemini Nano). You can also connect an AI app through MCP.';

function monitor(m) {
  m.addEventListener('downloadprogress', (e) => { if (e.loaded < 1) toast(`Downloading the on-device model… ${Math.round(e.loaded * 100)}%`, { timeout: 1500 }); });
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
  throw new Error(UNAVAILABLE);
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
  throw new Error(UNAVAILABLE);
}
