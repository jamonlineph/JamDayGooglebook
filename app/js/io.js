// Import (JSON backup, CSV, Excel, Markdown, PDF, iCalendar) and export (JSON, CSV, Markdown).
import { S, upsertMany, create, update, tasks, notes, findOrCreateTag, findOrCreateFolder, titleOf, storeFile, liveTags, folderOf, taskDate, PRIORITIES, STATUSES } from './store.js';
import { download, parseCSV, toCSV, loadScript, APP_VERSION, escapeHtml } from './lib.js';
import * as D from './dates.js';
import { markdownToBlocks, noteToMarkdown, blocksToMarkdown } from './md.js';

const slug = (s) => (s || 'untitled').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'untitled';

/* ---------------- export ---------------- */

export function exportJSON() {
  const settings = { ...S.settings, ai: { ...S.settings.ai, keys: {} } };
  const data = { app: 'JamDay', version: APP_VERSION, exportedAt: new Date().toISOString(), items: [...S.items.values()], tombstones: S.tombstones, settings };
  download(`jamday-backup-${D.today()}.json`, JSON.stringify(data), 'application/json');
}

export function exportTasksCSV() {
  const rows = [['Title', 'Status', 'Priority', 'When', 'Deadline', 'Repeat', 'Folder', 'Tags', 'Notes', 'Created', 'Completed']];
  for (const t of tasks()) {
    rows.push([
      t.title, (STATUSES.find((s) => s.v === t.status) || {}).label || t.status, PRIORITIES[t.priority || 0].label,
      t.when ? (t.when.kind === 'day' ? t.when.date + (t.when.time ? ' ' + t.when.time : '') : D.whenLabel(t.when)) : '',
      t.deadline || '', t.repeat ? D.describeRepeat(t.repeat) : '', folderOf(t) ? folderOf(t).name : '',
      liveTags(t).map((x) => x.name).join(', '), blocksToMarkdown(t.notes).trim(),
      new Date(t.createdAt).toISOString(), t.completedAt ? new Date(t.completedAt).toISOString() : '',
    ]);
  }
  download(`jamday-tasks-${D.today()}.csv`, toCSV(rows), 'text/csv');
}

export function exportNoteMarkdown(note) {
  download(slug(note.title) + '.md', noteToMarkdown(note), 'text/markdown');
}

export function exportAllNotesMarkdown() {
  const all = notes().slice().sort((a, b) => a.title.localeCompare(b.title));
  download(`jamday-notes-${D.today()}.md`, all.map(noteToMarkdown).join('\n\n---\n\n'), 'text/markdown');
}

/* ---------------- import ---------------- */

export async function importJSON(file) {
  const data = JSON.parse(await file.text());
  if (!data || !Array.isArray(data.items)) throw new Error('That file is not a JamDay backup.');
  const n = upsertMany(data.items, { overwrite: 'newer' });
  return `Imported ${n} item${n === 1 ? '' : 's'} from backup`;
}

function parseDateLoose(s) {
  if (!s) return null;
  const v = String(s).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: /T?(\d{2}):(\d{2})/.test(v.slice(10)) ? v.slice(10).match(/(\d{2}):(\d{2})/)[0] : null };
  const p = D.parseNatural(v);
  return p.found && p.kind === 'day' ? { date: p.date, time: p.time } : null;
}

export function importCSVText(text) {
  const rows = parseCSV(text);
  if (!rows.length) throw new Error('The file is empty.');
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names) => header.findIndex((h) => names.includes(h));
  let iTitle = col('title', 'name', 'task', 'content', 'task name', 'subject', 'summary', 'item');
  const hasHeader = iTitle >= 0;
  if (!hasHeader) iTitle = 0;
  const iNotes = col('notes', 'description', 'details', 'note', 'body');
  const iDue = col('due', 'due date', 'deadline', 'due_date', 'date', 'when', 'start date', 'start', 'scheduled');
  const iPrio = col('priority', 'prio', 'importance');
  const iTags = col('tags', 'labels', 'label', 'tag');
  const iStatus = col('status', 'state', 'done', 'completed', 'is completed', 'complete');
  const iFolder = col('folder', 'project', 'list', 'section', 'category');
  const iType = col('type');
  let n = 0;
  for (const row of rows.slice(hasHeader ? 1 : 0)) {
    if (iType >= 0 && row[iType] && !/task/i.test(row[iType])) continue;
    const title = (row[iTitle] || '').trim();
    if (!title) continue;
    const data = { title };
    if (iNotes >= 0 && row[iNotes]) data.notes = markdownToBlocks(row[iNotes]);
    if (iDue >= 0 && row[iDue]) { const d = parseDateLoose(row[iDue]); if (d) data.when = { kind: 'day', date: d.date, time: d.time || null }; }
    if (iPrio >= 0 && row[iPrio]) {
      const v = row[iPrio].trim().toLowerCase();
      const num = parseInt(v.replace(/^p/, ''), 10);
      data.priority = /urgent|critical|highest/.test(v) ? 4 : /high/.test(v) ? 3 : /med/.test(v) ? 2 : /low/.test(v) ? 1 : Number.isFinite(num) ? (v.startsWith('p') ? Math.max(0, 5 - num) : Math.max(0, Math.min(4, num))) : 0;
    }
    if (iTags >= 0 && row[iTags]) data.tags = row[iTags].split(/[,;]|\s+(?=@)/).map((s) => s.trim().replace(/^[@#]/, '')).filter(Boolean).map((x) => findOrCreateTag(x).id);
    if (iStatus >= 0 && row[iStatus] && /^(done|complete|completed|true|yes|x|1)$/i.test(row[iStatus].trim())) { data.status = 'done'; data.completedAt = Date.now(); }
    if (iFolder >= 0 && row[iFolder] && row[iFolder].trim()) data.folderId = findOrCreateFolder(row[iFolder].trim()).id;
    create('task', data);
    n++;
  }
  return `Imported ${n} task${n === 1 ? '' : 's'}`;
}

export async function importExcel(file) {
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
  const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return importCSVText(window.XLSX.utils.sheet_to_csv(ws));
}

export function importMarkdownText(text, fileName = 'Imported note') {
  let title = fileName.replace(/\.(md|markdown|txt)$/i, '');
  let body = text.replace(/^﻿/, '');
  body = body.replace(/^---\n[\s\S]*?\n---\n/, ''); // front matter
  const m = /^\s*#\s+(.+)\n/.exec(body);
  if (m) { title = m[1].trim(); body = body.slice(m.index + m[0].length); }
  return create('note', { title, blocks: markdownToBlocks(body) });
}

export async function importPDF(file) {
  const base = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  await loadScript(base + 'pdf.min.js');
  const lib = window.pdfjsLib;
  lib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.js';
  const pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const blocks = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const lines = [];
    let lastY = null, line = '';
    for (const it of tc.items) {
      const y = Math.round(it.transform[5]);
      if (lastY !== null && Math.abs(y - lastY) > 2) { lines.push(line); line = ''; }
      line += (line && !line.endsWith(' ') && !it.str.startsWith(' ') ? ' ' : '') + it.str;
      lastY = y;
    }
    if (line) lines.push(line);
    if (pdf.numPages > 1) blocks.push({ id: 'b' + Math.random().toString(36).slice(2), type: 'h3', html: 'Page ' + p });
    let para = [];
    const flush = () => { if (para.length) { blocks.push({ id: 'b' + Math.random().toString(36).slice(2), type: 'p', html: escapeHtml(para.join(' ').replace(/\s+/g, ' ').trim()) }); para = []; } };
    for (const l of lines) { if (!l.trim()) flush(); else { para.push(l.trim()); if (/[.!?:]$/.test(l.trim()) && para.join(' ').length > 280) flush(); } }
    flush();
  }
  const note = create('note', { title: file.name.replace(/\.pdf$/i, ''), blocks: blocks.length ? blocks : undefined });
  try { const meta = await storeFile(file); update(note.id, { attachments: [meta] }); } catch { /* larger than 100 MB: keep text only */ }
  return note;
}

function icsUnescape(s) { return (s || '').replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\'); }
function icsDate(v, params) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/.exec(v);
  if (!m) return null;
  if (!m[4] || /VALUE=DATE(?!-)/.test(params)) return { allDay: true, dt: `${m[1]}-${m[2]}-${m[3]}T00:00` };
  if (m[7]) return { allDay: false, dt: D.dtStr(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)))) };
  return { allDay: false, dt: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}` };
}

export function importICSText(text) {
  const lines = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  let cur = null, n = 0;
  for (const raw of lines) {
    if (raw === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (raw === 'END:VEVENT') {
      if (cur && cur.start) {
        let end = cur.end || cur.start;
        if (cur.allDay && cur.end) end = { ...end, dt: D.addDays(end.dt.slice(0, 10), -1) + 'T00:00' };
        if (cur.allDay && end.dt < cur.start.dt) end = cur.start;
        if (!cur.allDay && !cur.end) end = { dt: D.addMinutesDT(cur.start.dt, 60) };
        create('event', { title: cur.summary || 'Untitled event', start: cur.start.dt, end: end.dt, allDay: !!cur.allDay, location: cur.location || '', url: cur.url || '', notes: cur.description ? markdownToBlocks(cur.description) : undefined });
        n++;
      }
      cur = null; continue;
    }
    if (!cur) continue;
    const i = raw.indexOf(':'); if (i < 0) continue;
    const [name, ...params] = raw.slice(0, i).split(';');
    const val = raw.slice(i + 1);
    const p = params.join(';');
    switch (name.toUpperCase()) {
      case 'SUMMARY': cur.summary = icsUnescape(val); break;
      case 'DESCRIPTION': cur.description = icsUnescape(val); break;
      case 'LOCATION': cur.location = icsUnescape(val); break;
      case 'URL': cur.url = val; break;
      case 'DTSTART': cur.start = icsDate(val, p); cur.allDay = cur.start && cur.start.allDay; break;
      case 'DTEND': cur.end = icsDate(val, p); break;
      default: break;
    }
  }
  return `Imported ${n} event${n === 1 ? '' : 's'}`;
}

/** Route files to the right importer by extension. Returns human-readable results. */
export async function importFiles(files) {
  const results = [];
  for (const f of files) {
    const name = f.name.toLowerCase();
    try {
      if (name.endsWith('.json')) results.push(await importJSON(f));
      else if (name.endsWith('.csv') || name.endsWith('.tsv')) results.push(importCSVText(name.endsWith('.tsv') ? (await f.text()).replace(/\t/g, ',') : await f.text()));
      else if (/\.(xlsx|xls|ods)$/.test(name)) results.push(await importExcel(f));
      else if (/\.(md|markdown|txt)$/.test(name)) { const n = importMarkdownText(await f.text(), f.name); results.push(`Imported note “${titleOf(n)}”`); }
      else if (name.endsWith('.pdf')) { const n = await importPDF(f); results.push(`Imported PDF as note “${titleOf(n)}”`); }
      else if (name.endsWith('.ics') || name.endsWith('.ical')) results.push(importICSText(await f.text()));
      else results.push(`Skipped ${f.name} (unsupported type)`);
    } catch (e) {
      results.push(`${f.name}: ${e.message}`);
    }
  }
  return results;
}
