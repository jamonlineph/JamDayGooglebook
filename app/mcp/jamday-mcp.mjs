#!/usr/bin/env node
// JamDay MCP connector
// ---------------------------------------------------------------------------------------------
// Lets MCP clients (Claude Desktop, Claude Code, Cursor, VS Code, …) read and update your JamDay
// tasks, notes, calendar and habits. The client starts this script; it speaks MCP over stdio and
// relays each tool call over a local WebSocket to the JamDay app, which must be open with
// "Allow MCP clients" turned on (JamDay ▸ MCP). Your data never leaves your device.
//
//   node jamday-mcp.mjs --token <token from JamDay ▸ MCP> [--port 41823] [--host 127.0.0.1]
//
// The token can also come from the JAMDAY_TOKEN environment variable (JAMDAY_PORT, JAMDAY_HOST
// work the same way). Needs Node.js 18 or newer. No dependencies.
// ---------------------------------------------------------------------------------------------
import http from 'node:http';
import crypto from 'node:crypto';

const VERSION = '1.1.0';
const argv = process.argv.slice(2);
const arg = (name) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : undefined; };
const TOKEN = arg('token') || process.env.JAMDAY_TOKEN || '';
const PORT = Number(arg('port') || process.env.JAMDAY_PORT || 41823);
const HOST = arg('host') || process.env.JAMDAY_HOST || '127.0.0.1';
const log = (...a) => process.stderr.write('[jamday-mcp] ' + a.join(' ') + '\n');

/* ------------------------------------------------------------------ */
/* Tools                                                                */
/* ------------------------------------------------------------------ */

const str = (description) => ({ type: 'string', description });
const WHEN = str('When to do it, in plain language or ISO: "today", "tomorrow 3pm", "next fri", "2026-11-20", "2026-11-20 14:30", "this week", "next month", "someday", "every weekday at 7am". Use "" to clear.');
const PRIORITY = { description: 'Priority: none, low, medium, high or urgent (or 0–4).', oneOf: [{ type: 'string', enum: ['none', 'low', 'medium', 'high', 'urgent'] }, { type: 'integer', minimum: 0, maximum: 4 }] };
const TAGS = { type: 'array', items: { type: 'string' }, description: 'Tag names. New tags are created. Replaces existing tags when updating.' };
const FOLDER = str('Folder name. A new folder is created if it doesn’t exist. Use "" for no folder.');
const ID = str('The item id, as returned by other JamDay tools.');
const read = { readOnlyHint: true, openWorldHint: false };
const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

const TOOLS = [
  { name: 'get_today', title: 'Today in JamDay', annotations: read,
    description: 'Overview of today: overdue tasks, tasks planned for today, today’s events, habits and progress. Start here.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'search', title: 'Search JamDay', annotations: read,
    description: 'Search tasks, notes and events by text. Returns ids you can pass to get_item or update tools.',
    inputSchema: { type: 'object', properties: { query: str('Words to look for.'), types: { type: 'array', items: { type: 'string', enum: ['task', 'note', 'event'] }, description: 'Limit to these item types.' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, required: ['query'] } },
  { name: 'list_tasks', title: 'List tasks', annotations: read,
    description: 'List tasks from a view: today (due or planned today, plus overdue), upcoming (next 14 days), inbox (no date or folder), overdue, someday, all (open tasks) or completed.',
    inputSchema: { type: 'object', properties: { view: { type: 'string', enum: ['today', 'upcoming', 'inbox', 'overdue', 'someday', 'all', 'completed'] }, folder: str('Only tasks in this folder.'), tag: str('Only tasks with this tag.'), limit: { type: 'integer', minimum: 1, maximum: 500 } } } },
  { name: 'get_item', title: 'Get an item', annotations: read,
    description: 'Full details of one task, note or event, including notes/content as Markdown and subtasks.',
    inputSchema: { type: 'object', properties: { id: ID }, required: ['id'] } },
  { name: 'create_task', title: 'Create a task', annotations: write,
    description: 'Create a task. Repeating "when" values (e.g. "every mon, wed and fri") make it a habit with streaks.',
    inputSchema: { type: 'object', properties: { title: str('Task name.'), when: WHEN, deadline: str('Hard deadline: "fri", "2026-11-30"…'), priority: PRIORITY, tags: TAGS, folder: FOLDER, notes: str('Notes in Markdown.'), parent_id: str('Make it a subtask of this task id.'), reminder: str('Reminder time, ISO local "YYYY-MM-DDTHH:MM". Defaults to the "when" time if one is given.') }, required: ['title'] } },
  { name: 'update_task', title: 'Update a task', annotations: write,
    description: 'Change a task. Only the fields you pass are changed.',
    inputSchema: { type: 'object', properties: { id: ID, title: str('New name.'), when: WHEN, deadline: str('Deadline, or "" to clear.'), priority: PRIORITY, status: { type: 'string', enum: ['todo', 'doing', 'waiting', 'done'] }, tags: TAGS, folder: FOLDER, notes: str('Replace the notes (Markdown).') }, required: ['id'] } },
  { name: 'complete_task', title: 'Complete a task', annotations: write,
    description: 'Mark a task as done. For habits this logs today and moves it to the next occurrence.',
    inputSchema: { type: 'object', properties: { id: ID }, required: ['id'] } },
  { name: 'list_events', title: 'List events', annotations: read,
    description: 'Calendar events between two dates (inclusive). Defaults to today through 7 days ahead. Google Calendar events are included when connected and are read-only.',
    inputSchema: { type: 'object', properties: { from: str('Start date, YYYY-MM-DD.'), to: str('End date, YYYY-MM-DD.') } } },
  { name: 'create_event', title: 'Create an event', annotations: write,
    description: 'Create a calendar event. "start" accepts ISO ("2026-11-20T15:00", or a date for all-day) or plain language ("tomorrow 3-4pm").',
    inputSchema: { type: 'object', properties: { title: str('Event title.'), start: str('Start: "2026-11-20T15:00", "2026-11-20" (all day) or "next tue 10am".'), end: str('End, ISO. Defaults to one hour after start.'), all_day: { type: 'boolean' }, location: str('Location.'), url: str('Meeting link.'), notes: str('Notes / agenda in Markdown.'), folder: FOLDER, tags: TAGS }, required: ['title', 'start'] } },
  { name: 'update_event', title: 'Update an event', annotations: write,
    description: 'Change an event made in JamDay. Only the fields you pass are changed.',
    inputSchema: { type: 'object', properties: { id: ID, title: str('New title.'), start: str('New start (ISO or plain language). Keeps the duration unless "end" is given.'), end: str('New end, ISO.'), all_day: { type: 'boolean' }, location: str('Location.'), url: str('Meeting link.'), notes: str('Replace the notes (Markdown).'), folder: FOLDER, tags: TAGS }, required: ['id'] } },
  { name: 'list_notes', title: 'List notes', annotations: read,
    description: 'Notes, most recently edited first, with a short excerpt. Use get_item for the full content.',
    inputSchema: { type: 'object', properties: { query: str('Only notes containing this text.'), folder: str('Only notes in this folder.'), tag: str('Only notes with this tag.'), limit: { type: 'integer', minimum: 1, maximum: 200 } } } },
  { name: 'create_note', title: 'Create a note', annotations: write,
    description: 'Create a note from Markdown (headings, lists, - [ ] to-dos, tables, quotes and code are supported).',
    inputSchema: { type: 'object', properties: { title: str('Note title.'), markdown: str('Content in Markdown.'), folder: FOLDER, tags: TAGS }, required: ['title'] } },
  { name: 'update_note', title: 'Update a note', annotations: write,
    description: 'Rename a note, replace its content, or append Markdown to the end.',
    inputSchema: { type: 'object', properties: { id: ID, title: str('New title.'), markdown: str('Replace the whole content with this Markdown.'), append_markdown: str('Add this Markdown to the end.'), folder: FOLDER, tags: TAGS }, required: ['id'] } },
  { name: 'delete_item', title: 'Move to Trash', annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Move a task, note or event to JamDay’s Trash (it can be restored for 30 days).',
    inputSchema: { type: 'object', properties: { id: ID }, required: ['id'] } },
  { name: 'list_folders_and_tags', title: 'Folders and tags', annotations: read,
    description: 'All folders and tags with how many items each holds.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'list_habits', title: 'Habits', annotations: read,
    description: 'Repeating tasks (habits) with their schedule, current streak, best streak and 30-day completion rate.',
    inputSchema: { type: 'object', properties: {} } },
];

const INSTRUCTIONS = 'JamDay is the user’s private tasks, notes and calendar app. Dates are local, as YYYY-MM-DD; times are 24-hour HH:MM. ' +
  'Call get_today for an overview before planning. Changes show up in JamDay right away and the user can undo them there. ' +
  'Prefer updating existing items (find them with search) over creating duplicates.';

/* ------------------------------------------------------------------ */
/* Minimal WebSocket server (RFC 6455) for the JamDay app               */
/* ------------------------------------------------------------------ */

function writeFrame(socket, op, payload) {
  const len = payload.length;
  let header;
  if (len < 126) header = Buffer.from([0x80 | op, len]);
  else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x80 | op; header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x80 | op; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
  socket.write(Buffer.concat([header, payload]));
}

function wsConnection(socket) {
  let buf = Buffer.alloc(0);
  let parts = [];
  let closed = false;
  const conn = {
    onMessage() {}, onClose() {},
    send(obj) { if (!closed) writeFrame(socket, 0x1, Buffer.from(JSON.stringify(obj))); },
    close() { if (closed) return; closed = true; try { writeFrame(socket, 0x8, Buffer.alloc(0)); } catch { /* ignore */ } socket.end(); },
  };
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const fin = buf[0] & 0x80, op = buf[0] & 0x0f, masked = buf[1] & 0x80;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      const maskAt = off;
      if (masked) off += 4;
      if (buf.length < off + len) return;
      let payload = Buffer.from(buf.subarray(off, off + len));
      if (masked) for (let i = 0; i < payload.length; i++) payload[i] ^= buf[maskAt + (i & 3)];
      buf = buf.subarray(off + len);
      if (op === 0x8) { conn.close(); return; }
      if (op === 0x9) { writeFrame(socket, 0xA, payload); continue; }
      if (op === 0xA) continue;
      if (op === 0x1 || op === 0x0) {
        parts.push(payload);
        if (fin) { const text = Buffer.concat(parts).toString('utf8'); parts = []; conn.onMessage(text); }
      }
    }
  });
  const end = () => { if (!conn._ended) { conn._ended = true; closed = true; conn.onClose(); } };
  socket.on('close', end);
  socket.on('error', end);
  return conn;
}

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

let app = null;
let appInfo = null;
let listenError = null;
const pending = new Map();

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('JamDay MCP connector ' + VERSION + ' is running. ' + (app ? 'JamDay is connected.' : 'Waiting for JamDay — open JamDay ▸ MCP.'));
});

server.on('upgrade', (req, socket) => {
  const url = new URL(req.url, 'http://localhost');
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return; }
  if (!TOKEN || !safeEqual(url.searchParams.get('token') || '', TOKEN)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    log('Refused a connection: the token doesn’t match. Copy the token from JamDay ▸ MCP.');
    return;
  }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', 'Sec-WebSocket-Accept: ' + accept, '', ''].join('\r\n'));
  socket.setNoDelay(true);
  socket.setKeepAlive(true, 20000);
  const conn = wsConnection(socket);
  if (app) app.close();
  app = conn;
  log('JamDay connected.');
  conn.onMessage = (text) => {
    let m;
    try { m = JSON.parse(text); } catch { return; }
    if (m.type === 'hello') { appInfo = m; return; }
    if (m.type === 'result' && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      clearTimeout(p.timer);
      p.resolve(m);
    }
  };
  conn.onClose = () => { if (app === conn) { app = null; appInfo = null; log('JamDay disconnected.'); } };
});

setInterval(() => { if (app) { try { app.send({ type: 'ping' }); } catch { /* ignore */ } } }, 25000).unref();

server.on('error', (e) => {
  listenError = e.code === 'EADDRINUSE'
    ? `Port ${PORT} is already in use — another JamDay connector is probably running. Close the other MCP client, or start this one with --port and change the address in JamDay ▸ MCP.`
    : e.message;
  log(listenError);
});
server.listen(PORT, HOST, () => log(`Listening on ws://${HOST}:${PORT} — waiting for JamDay.${TOKEN ? '' : ' WARNING: no token set (use --token or JAMDAY_TOKEN), so JamDay can’t connect.'}`));

async function callTool(name, args) {
  const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], isError });
  if (!TOOLS.some((t) => t.name === name)) return text('Unknown tool: ' + name, true);
  if (listenError) return text(listenError, true);
  if (!TOKEN) return text('The JamDay connector has no token. Add JAMDAY_TOKEN (from JamDay ▸ MCP) to this MCP server’s settings.', true);
  if (!app) return text('JamDay isn’t connected. Open JamDay, go to MCP in the sidebar and turn on “Allow MCP clients”. The token there must match this connector’s token.', true);
  const id = crypto.randomUUID();
  const res = await new Promise((resolve) => {
    const timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, error: 'JamDay didn’t answer in time. Is the app open?' }); }, 30000);
    pending.set(id, { resolve, timer });
    app.send({ type: 'call', id, name, arguments: args || {} });
  });
  if (!res.ok) return text(res.error || 'The call failed.', true);
  return text(typeof res.result === 'string' ? res.result : JSON.stringify(res.result, null, 2));
}

/* ------------------------------------------------------------------ */
/* MCP over stdio (newline-delimited JSON-RPC 2.0)                      */
/* ------------------------------------------------------------------ */

const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];
const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(m) {
  if (!m || typeof m !== 'object') return;
  const { id, method, params } = m;
  if (id === undefined || id === null) return; // notifications need no answer
  try {
    switch (method) {
      case 'initialize': {
        const asked = params && params.protocolVersion;
        return reply(id, {
          protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'jamday', title: 'JamDay', version: VERSION },
          instructions: INSTRUCTIONS,
        });
      }
      case 'ping': return reply(id, {});
      case 'tools/list': return reply(id, { tools: TOOLS });
      case 'tools/call': return reply(id, await callTool(params && params.name, params && params.arguments));
      case 'resources/list': return reply(id, { resources: [] });
      case 'resources/templates/list': return reply(id, { resourceTemplates: [] });
      case 'prompts/list': return reply(id, { prompts: [] });
      default: return fail(id, -32601, 'Method not found: ' + method);
    }
  } catch (e) {
    return fail(id, -32603, e.message || String(e));
  }
}

let inbuf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  inbuf += chunk;
  let i;
  while ((i = inbuf.indexOf('\n')) >= 0) {
    const line = inbuf.slice(0, i).trim();
    inbuf = inbuf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { fail(null, -32700, 'Parse error'); continue; }
    if (Array.isArray(msg)) msg.forEach(handle); else handle(msg);
  }
});
process.stdin.on('end', () => process.exit(0));
