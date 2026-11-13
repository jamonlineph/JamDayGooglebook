// Markdown <-> block conversion (used for paste, import and export).
import { uid, escapeHtml } from './lib.js';
import { alive, titleOf } from './store.js';
import * as D from './dates.js';

export function inlineMdToHtml(s) {
  let h = escapeHtml(s);
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
  h = h.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/__([^_]+)__/g, '<b>$1</b>');
  h = h.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<i>$2</i>').replace(/(^|[^\w])_([^_\s][^_]*?)_(?!\w)/g, '$1<i>$2</i>');
  h = h.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  h = h.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  h = h.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  return h;
}

export function htmlToInlineMd(htmlStr) {
  if (!htmlStr) return '';
  const div = document.createElement('div');
  div.innerHTML = htmlStr;
  const walk = (n) => {
    if (n.nodeType === 3) return n.nodeValue.replace(/ /g, ' ');
    if (n.nodeType !== 1) return '';
    const inner = [...n.childNodes].map(walk).join('');
    const tag = n.tagName.toLowerCase();
    if (n.classList.contains('mention')) { const it = alive(n.dataset.ref); return '[[' + (it ? titleOf(it) : n.textContent) + ']]'; }
    if (tag === 'b' || tag === 'strong') return inner.trim() ? `**${inner}**` : inner;
    if (tag === 'i' || tag === 'em') return inner.trim() ? `_${inner}_` : inner;
    if (tag === 's' || tag === 'strike' || tag === 'del') return `~~${inner}~~`;
    if (tag === 'u') return inner;
    if (tag === 'code') return '`' + inner + '`';
    if (tag === 'a') return `[${inner}](${n.getAttribute('href')})`;
    if (tag === 'br') return '\n';
    if (tag === 'div' || tag === 'p') return inner + '\n';
    return inner;
  };
  return [...div.childNodes].map(walk).join('').replace(/\n+$/, '');
}

const nb = (type, html = '', extra = {}) => ({ id: uid('b'), type, html, ...extra });

export function markdownToBlocks(md) {
  const lines = String(md || '').replace(/\r/g, '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
      out.push(nb('code', escapeHtml(buf.join('\n'))));
      continue;
    }
    if (!line.trim()) continue;
    const indent = Math.min(4, Math.floor((line.match(/^\s*/)[0].replace(/\t/g, '  ').length) / 2));
    let m;
    if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) { out.push(nb('h' + Math.min(3, m[1].length), inlineMdToHtml(m[2]))); continue; }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push(nb('divider')); continue; }
    if ((m = /^\s*[-*+]\s+\[( |x|X)\]\s*(.*)$/.exec(line))) { out.push(nb('todo', inlineMdToHtml(m[2]), { checked: m[1] !== ' ', level: indent })); continue; }
    if ((m = /^\s*[-*+•]\s+(.*)$/.exec(line))) { out.push(nb('ul', inlineMdToHtml(m[1]), { level: indent })); continue; }
    if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) { out.push(nb('ol', inlineMdToHtml(m[1]), { level: indent })); continue; }
    if ((m = /^\s*>\s?(.*)$/.exec(line))) {
      const buf = [m[1]];
      while (i + 1 < lines.length && /^\s*>/.test(lines[i + 1])) buf.push(lines[++i].replace(/^\s*>\s?/, ''));
      out.push(nb('quote', buf.map(inlineMdToHtml).join('<br>')));
      continue;
    }
    if ((m = /^\s*!\[([^\]]*)\]\(([^)\s]+)\)\s*$/.exec(line))) { out.push(nb('image', '', { src: m[2], caption: m[1] })); continue; }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const rows = [];
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => inlineMdToHtml(c.trim()));
      rows.push(cells(line)); i++;
      while (i + 1 < lines.length && /^\s*\|.*\|\s*$/.test(lines[i + 1])) rows.push(cells(lines[++i]));
      const w = Math.max(...rows.map((r) => r.length));
      out.push(nb('table', '', { rows: rows.map((r) => [...r, ...Array(w - r.length).fill('')]), header: true }));
      continue;
    }
    out.push(nb('p', inlineMdToHtml(line.trim())));
  }
  return out.length ? out : [nb('p')];
}

export function blocksToMarkdown(blocks) {
  const out = [];
  const counters = [];
  let prevList = false;
  for (const b of blocks || []) {
    const lvl = '  '.repeat(b.level || 0);
    const t = htmlToInlineMd(b.html || '');
    const isList = ['ul', 'ol', 'todo', 'task'].includes(b.type);
    if (!isList || !prevList) { if (out.length) out.push(''); }
    if (b.type !== 'ol') counters.length = 0;
    switch (b.type) {
      case 'h1': out.push('# ' + t); break;
      case 'h2': out.push('## ' + t); break;
      case 'h3': out.push('### ' + t); break;
      case 'ul': out.push(lvl + '- ' + t); break;
      case 'ol': { const L = b.level || 0; counters[L] = (counters[L] || 0) + 1; counters.length = L + 1; out.push(lvl + counters[L] + '. ' + t); break; }
      case 'todo': out.push(lvl + `- [${b.checked ? 'x' : ' '}] ` + t); break;
      case 'quote': out.push(t.split('\n').map((l) => '> ' + l).join('\n')); break;
      case 'callout': out.push('> ' + (b.emoji || '💡') + ' ' + t); break;
      case 'code': out.push('```\n' + (b.html ? htmlToInlineMd(b.html).replace(/`/g, '') : '') + '\n```'); break;
      case 'divider': out.push('---'); break;
      case 'image': out.push(`![${b.caption || ''}](${b.src || 'attachment'})`); break;
      case 'table': {
        const rows = b.rows || [];
        if (!rows.length) break;
        const md = rows.map((r) => '| ' + r.map((c) => htmlToInlineMd(c).replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ') + ' |');
        md.splice(1, 0, '| ' + rows[0].map(() => '---').join(' | ') + ' |');
        out.push(md.join('\n'));
        break;
      }
      case 'task': { const tk = alive(b.ref); out.push(lvl + `- [${tk && tk.status === 'done' ? 'x' : ' '}] ` + (tk ? tk.title : '(deleted task)')); break; }
      case 'event': { const ev = alive(b.ref); out.push(ev ? `📅 ${ev.title} — ${D.fmtDate(ev.start.slice(0, 10), { weekday: true })}${ev.allDay ? '' : ' ' + D.fmtTime(ev.start.slice(11), '24')}` : '📅 (deleted event)'); break; }
      case 'page': { const n = alive(b.ref); out.push('[[' + (n ? titleOf(n) : 'deleted note') + ']]'); break; }
      default: out.push(t);
    }
    prevList = isList;
  }
  return out.join('\n') + '\n';
}

export function noteToMarkdown(note) {
  return '# ' + (note.title || 'Untitled') + '\n\n' + blocksToMarkdown(note.blocks);
}

/** Render blocks as static HTML (used for assistant replies). Inline HTML is already escaped by inlineMdToHtml. */
export function blocksToHTML(blocks) {
  let out = '';
  let list = null;
  const close = () => { if (list) { out += `</${list}>`; list = null; } };
  for (const b of blocks) {
    const tag = b.type === 'ol' ? 'ol' : b.type === 'ul' || b.type === 'todo' ? 'ul' : null;
    if (tag !== list) { close(); if (tag) { out += `<${tag}>`; list = tag; } }
    switch (b.type) {
      case 'h1': case 'h2': case 'h3': out += `<h4>${b.html}</h4>`; break;
      case 'ul': case 'ol': out += `<li>${b.html}</li>`; break;
      case 'todo': out += `<li class="todo">${b.checked ? '☑' : '☐'} ${b.html}</li>`; break;
      case 'quote': out += `<blockquote>${b.html}</blockquote>`; break;
      case 'code': out += `<pre><code>${b.html}</code></pre>`; break;
      case 'divider': out += '<hr>'; break;
      case 'table': out += '<table>' + (b.rows || []).map((r, i) => '<tr>' + r.map((c) => (i === 0 && b.header ? `<th>${c}</th>` : `<td>${c}</td>`)).join('') + '</tr>').join('') + '</table>'; break;
      case 'image': out += ''; break;
      default: out += `<p>${b.html}</p>`;
    }
  }
  close();
  return out;
}
