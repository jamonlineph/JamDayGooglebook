// Tests the JamDay MCP connector: MCP over stdio on one side, a stand-in JamDay app over WebSocket on the other.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BRIDGE = fileURLToPath(new URL('../app/mcp/jamday-mcp.mjs', import.meta.url));
const TOKEN = 'test-token-123';
const PORT = 41000 + Math.floor(Math.random() * 800);

function startBridge() {
  const p = spawn(process.execPath, [BRIDGE, '--port', String(PORT)], { env: { ...process.env, JAMDAY_TOKEN: TOKEN }, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  const waiters = new Map();
  p.stdout.setEncoding('utf8');
  p.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
      const w = waiters.get(msg.id); if (w) { waiters.delete(msg.id); w(msg); }
    }
  });
  let n = 0;
  const rpc = (method, params) => new Promise((resolve) => { const id = ++n; waiters.set(id, resolve); p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  const ready = new Promise((resolve) => p.stderr.on('data', (d) => { if (String(d).includes('Listening')) resolve(); }));
  return { p, rpc, ready };
}

const connectApp = (token) => new Promise((resolve, reject) => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/?token=${token}`);
  ws.onopen = () => resolve(ws);
  ws.onerror = () => reject(new Error('refused'));
});

test('MCP handshake, tools, relay to the app, token check', async () => {
  const b = startBridge();
  try {
    await b.ready;
    const init = await b.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.equal(init.result.serverInfo.name, 'jamday');
    assert.ok(init.result.capabilities.tools);

    const list = await b.rpc('tools/list', {});
    const names = list.result.tools.map((t) => t.name);
    for (const n of ['get_today', 'search', 'create_task', 'update_note', 'delete_item']) assert.ok(names.includes(n), n);
    assert.equal(list.result.tools.find((t) => t.name === 'get_today').annotations.readOnlyHint, true);

    // no app connected yet → helpful error result
    const early = await b.rpc('tools/call', { name: 'get_today', arguments: {} });
    assert.equal(early.result.isError, true);
    assert.match(early.result.content[0].text, /isn’t connected/);

    // wrong token is refused
    await assert.rejects(connectApp('nope'));

    // stand-in app answers calls
    const ws = await connectApp(TOKEN);
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type !== 'call') return;
      if (m.name === 'create_task') ws.send(JSON.stringify({ type: 'result', id: m.id, ok: true, result: { created: { id: 't1', title: m.arguments.title } } }));
      else ws.send(JSON.stringify({ type: 'result', id: m.id, ok: false, error: 'read only' }));
    };
    await new Promise((r) => setTimeout(r, 50));
    const ok = await b.rpc('tools/call', { name: 'create_task', arguments: { title: 'Buy milk' } });
    assert.equal(ok.result.isError, false);
    assert.deepEqual(JSON.parse(ok.result.content[0].text), { created: { id: 't1', title: 'Buy milk' } });

    const bad = await b.rpc('tools/call', { name: 'delete_item', arguments: { id: 'x' } });
    assert.equal(bad.result.isError, true);
    assert.equal(bad.result.content[0].text, 'read only');

    const unknown = await b.rpc('nope/nope', {});
    assert.equal(unknown.error.code, -32601);
    ws.close();
  } finally {
    b.p.kill();
  }
});
