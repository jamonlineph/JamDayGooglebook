// Block editor: headings, lists, to-dos, quotes, callouts, code, dividers, images, tables,
// embedded tasks/events/sub-notes, a slash menu that works mid-line and @ mentions.
import { html, useState, useEffect, useRef, useLayoutEffect, uid, cx, escapeHtml, pickFiles, stripHtml, fuzzy, debounce } from '../lib.js';
import {
  S, alive, titleOf, create, update, openItem, toggleTask, isDone, storeFile, fileURL, toast, tasks, notes, events,
  taskDate, navigate, addAttachments,
} from '../store.js';
import * as D from '../dates.js';
import { Icon } from './icons.js';
import { markdownToBlocks } from '../md.js';
import { openMenu, promptDialog, Chip } from './common.js';

const TEXT_TYPES = new Set(['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'todo', 'quote', 'callout', 'code']);
const LIST_TYPES = new Set(['ul', 'ol', 'todo']);
const INDENTABLE = new Set(['ul', 'ol', 'todo', 'task', 'p']);

const SLASH = [
  { id: 'p', label: 'Text', icon: 'text', kw: 'paragraph text plain' },
  { id: 'h1', label: 'Heading 1', icon: 'heading', kw: 'title h1 big heading' },
  { id: 'h2', label: 'Heading 2', icon: 'heading', kw: 'h2 subtitle heading' },
  { id: 'h3', label: 'Heading 3', icon: 'heading', kw: 'h3 heading small' },
  { id: 'ul', label: 'Bulleted list', icon: 'list', kw: 'bullet unordered ul list' },
  { id: 'ol', label: 'Numbered list', icon: 'olist', kw: 'numbered ordered ol list' },
  { id: 'todo', label: 'To-do', icon: 'checkbox', kw: 'todo check checkbox checklist' },
  { id: 'quote', label: 'Quote', icon: 'quote', kw: 'quote blockquote' },
  { id: 'callout', label: 'Callout', icon: 'callout', kw: 'callout note info tip' },
  { id: 'code', label: 'Code', icon: 'code', kw: 'code snippet pre' },
  { id: 'divider', label: 'Divider', icon: 'divider', kw: 'divider hr line separator' },
  { id: 'image', label: 'Image', icon: 'image', kw: 'image picture photo upload' },
  { id: 'table', label: 'Table', icon: 'table', kw: 'table grid spreadsheet' },
  { id: 'task', label: 'Task', icon: 'tasks', hint: 'Linked task', kw: 'task todo action item' },
  { id: 'subtask', label: 'Subtask', icon: 'tasks', hint: 'Under the task above', kw: 'subtask child task' },
  { id: 'event', label: 'Event', icon: 'calendar', hint: 'Linked event', kw: 'event meeting calendar' },
  { id: 'page', label: 'Note', icon: 'notes', hint: 'New sub-note', kw: 'note page doc subpage' },
  { id: 'date', label: 'Today’s date', icon: 'sun', kw: 'date today now' },
  { id: 'mention', label: 'Mention…', icon: 'link', hint: 'Task, event or note', kw: 'mention link at reference' },
];

const nb = (type = 'p', extra = {}) => ({ id: uid('b'), type, html: '', ...extra });
const norm = (h) => (!h || h === '<br>' ? '' : h);
const isEmptyHTML = (h) => !/class="mention"/.test(h || '') && stripHtml(h || '').trim() === '';

/* ------------------------------ caret helpers ------------------------------ */

function textNodes(el) {
  const out = []; const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let n; while ((n = w.nextNode())) out.push(n);
  return out;
}
function caretOffset(el) {
  const sel = getSelection();
  if (!sel.rangeCount) return 0;
  const r = sel.getRangeAt(0);
  if (!el.contains(r.startContainer)) return 0;
  const pre = document.createRange();
  pre.selectNodeContents(el);
  pre.setEnd(r.startContainer, r.startOffset);
  return pre.toString().length;
}
function pointAt(el, pos) {
  let rem = pos;
  for (const n of textNodes(el)) {
    if (rem <= n.length) {
      const m = n.parentElement && n.parentElement.closest('.mention');
      if (m && el.contains(m)) { const r = document.createRange(); r.setStartAfter(m); return [r.startContainer, r.startOffset]; }
      return [n, rem];
    }
    rem -= n.length;
  }
  return null;
}
function setCaret(el, pos) {
  if (!el) return;
  el.focus({ preventScroll: false });
  const sel = getSelection(); const r = document.createRange();
  if (pos === 'start' || pos === 0) { r.setStart(el, 0); r.collapse(true); }
  else if (pos === 'end' || pos == null) { r.selectNodeContents(el); r.collapse(false); }
  else { const p = pointAt(el, pos); if (p) { r.setStart(p[0], p[1]); r.collapse(true); } else { r.selectNodeContents(el); r.collapse(false); } }
  sel.removeAllRanges(); sel.addRange(r);
}
function rangeFromOffsets(el, a, b) {
  const pa = pointAt(el, a), pb = pointAt(el, b);
  if (!pa || !pb) return null;
  const r = document.createRange(); r.setStart(pa[0], pa[1]); r.setEnd(pb[0], pb[1]);
  return r;
}
const fragHTML = (frag) => { const d = document.createElement('div'); d.appendChild(frag); return d.innerHTML; };
function splitHTML(el) {
  const sel = getSelection();
  if (!sel.rangeCount || !el.contains(sel.getRangeAt(0).startContainer)) return [el.innerHTML, ''];
  const r = sel.getRangeAt(0);
  const before = document.createRange(); before.selectNodeContents(el); before.setEnd(r.startContainer, r.startOffset);
  const after = document.createRange(); after.selectNodeContents(el); after.setStart(r.endContainer, r.endOffset);
  return [norm(fragHTML(before.cloneContents())), norm(fragHTML(after.cloneContents()))];
}
function lineCheck(el, first) {
  const sel = getSelection();
  if (!sel.rangeCount) return true;
  const r = sel.getRangeAt(0).cloneRange(); r.collapse(true);
  const rect = r.getClientRects()[0];
  if (!rect) return true;
  const er = el.getBoundingClientRect();
  const lh = parseFloat(getComputedStyle(el).lineHeight) || 22;
  return first ? rect.top - er.top < lh * 0.8 : er.bottom - rect.bottom < lh * 0.8;
}
function caretRect(el) {
  const sel = getSelection();
  if (sel.rangeCount) {
    const r = sel.getRangeAt(0).cloneRange(); r.collapse(true);
    const rect = r.getClientRects()[0];
    if (rect && (rect.width || rect.height)) return rect;
  }
  return el.getBoundingClientRect();
}
function insertNodeAtCaret(node, trailingSpace = true) {
  const sel = getSelection(); if (!sel.rangeCount) return;
  const r = sel.getRangeAt(0); r.deleteContents(); r.insertNode(node);
  const sp = document.createTextNode(trailingSpace ? ' ' : '');
  node.after(sp);
  const r2 = document.createRange(); r2.setStart(sp, sp.length); r2.collapse(true);
  sel.removeAllRanges(); sel.addRange(r2);
}
export function mentionHTML(item) {
  const kind = item.type;
  return `<span class="mention m-${kind}" contenteditable="false" data-ref="${item.id}">${escapeHtml(titleOf(item))}</span>`;
}
function hydrateMentions(el) {
  el.querySelectorAll('.mention').forEach((m) => {
    const it = alive(m.dataset.ref);
    const t = it ? titleOf(it) : 'Deleted item';
    if (m.textContent !== t) m.textContent = t;
    m.classList.toggle('dead', !it);
  });
}

/* ------------------------------ editor ------------------------------ */

export function BlockEditor({ blocks: initial, onChange, ownerId, compact = false, placeholder = 'Type ‘/’ for commands, ‘@’ to mention…', autoFocus = false }) {
  const [blocks, setBlocksState] = useState(() => (initial && initial.length ? initial : [nb()]));
  const blocksRef = useRef(blocks);
  const lastEmitted = useRef(initial);
  const root = useRef();
  const pendingFocus = useRef(autoFocus ? { id: blocks[0].id, pos: 'end' } : null);
  const [menu, setMenu] = useState(null); // {kind, blockId, offset, query, rect, sel}
  const menuRef = useRef(null); menuRef.current = menu;
  const [toolbar, setToolbar] = useState(null);
  const dragId = useRef(null);
  const [dropAt, setDropAt] = useState(null);

  const emit = useRef(debounce((b) => { lastEmitted.current = b; onChange && onChange(b); }, 250)).current;
  useEffect(() => () => emit.flush(blocksRef.current), []);

  useEffect(() => {
    if (initial && initial !== lastEmitted.current && initial !== blocksRef.current) {
      blocksRef.current = initial.length ? initial : [nb()];
      lastEmitted.current = initial;
      setBlocksState(blocksRef.current);
    }
  }, [initial]);

  const setBlocks = (next, { now = false } = {}) => {
    blocksRef.current = next;
    setBlocksState(next);
    if (now) emit.flush(next); else emit(next);
  };
  const patch = (id, p, opts) => setBlocks(blocksRef.current.map((b) => (b.id === id ? { ...b, ...p } : b)), opts);
  const idx = (id) => blocksRef.current.findIndex((b) => b.id === id);
  const elOf = (id) => root.current && root.current.querySelector(`[data-bid="${id}"]`);
  const focusLater = (id, pos = 'end') => { pendingFocus.current = { id, pos }; };
  const insertAfter = (id, newBlocks, focus = true) => {
    const list = blocksRef.current.slice(); const i = list.findIndex((b) => b.id === id);
    list.splice(i + 1, 0, ...newBlocks);
    setBlocks(list);
    if (focus) { const last = newBlocks[newBlocks.length - 1]; focusLater(last.id, TEXT_TYPES.has(last.type) ? 'start' : null); }
  };
  const removeBlock = (id) => {
    const list = blocksRef.current.filter((b) => b.id !== id);
    setBlocks(list.length ? list : [nb()]);
  };

  useLayoutEffect(() => {
    const f = pendingFocus.current;
    if (!f) return;
    pendingFocus.current = null;
    const el = elOf(f.id);
    if (!el) return;
    const b = blocksRef.current.find((x) => x.id === f.id);
    if (b && el.isContentEditable && norm(el.innerHTML) !== norm(b.html)) { el.innerHTML = b.html || ''; hydrateMentions(el); }
    if (el.isContentEditable) { setCaret(el, f.pos); return; }
    const inner = el.querySelector('[contenteditable="true"], input');
    if (inner) { if (inner.isContentEditable) setCaret(inner, 'start'); else inner.focus(); } else el.focus();
  });

  /* ----- selection toolbar ----- */
  useEffect(() => {
    const onSel = () => {
      const sel = getSelection();
      if (!sel.rangeCount || sel.isCollapsed || !root.current) { setToolbar(null); return; }
      const r = sel.getRangeAt(0);
      const host = r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement;
      const blockEl = host && host.closest('[data-bid]');
      if (!blockEl || !root.current.contains(blockEl) || !blockEl.isContentEditable) { setToolbar(null); return; }
      const rect = r.getBoundingClientRect();
      const base = root.current.getBoundingClientRect();
      setToolbar({ left: Math.max(0, rect.left - base.left + rect.width / 2), top: rect.top - base.top, text: r.toString() });
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, []);

  /* ----- slash / mention menus ----- */
  const openSlash = (kind, b, el, offset) => setMenu({ kind, blockId: b.id, offset, query: '', rect: caretRect(el), sel: 0 });
  const closeMenuState = () => setMenu(null);
  const menuItems = () => {
    const m = menuRef.current; if (!m) return [];
    const q = m.query.toLowerCase();
    if (m.kind === 'slash') {
      return SLASH.map((c) => ({ c, s: q ? Math.max(fuzzy(q, c.label), fuzzy(q, c.kw)) : 1 })).filter((r) => r.s >= 0).sort((a, b) => b.s - a.s).map((r) => ({ ...r.c, kind: 'cmd' })).slice(0, 12);
    }
    const pool = [...tasks(), ...notes(), ...events()].filter((i) => i.id !== ownerId);
    const found = pool.map((i) => ({ i, s: q ? fuzzy(q, titleOf(i)) : 1 })).filter((r) => r.s >= 0)
      .sort((a, b) => b.s - a.s || b.i.updatedAt - a.i.updatedAt).slice(0, 8)
      .map((r) => ({ id: r.i.id, label: titleOf(r.i), icon: { task: 'tasks', note: 'notes', event: 'calendar' }[r.i.type], kind: 'item', item: r.i, hint: r.i.type }));
    if (m.query.trim()) {
      found.push({ id: '+task', label: `New task “${m.query}”`, icon: 'plus', kind: 'new', type: 'task' });
      found.push({ id: '+note', label: `New note “${m.query}”`, icon: 'plus', kind: 'new', type: 'note' });
    }
    return found;
  };

  const removeTrigger = (el, m) => {
    const end = caretOffset(el);
    const r = rangeFromOffsets(el, m.offset, Math.max(end, m.offset + 1 + m.query.length));
    if (r) { r.deleteContents(); const sel = getSelection(); sel.removeAllRanges(); const c = document.createRange(); c.setStart(r.startContainer, r.startOffset); c.collapse(true); sel.addRange(c); }
  };

  const pickMenu = (item) => {
    const m = menuRef.current; if (!m) return;
    const b = blocksRef.current.find((x) => x.id === m.blockId);
    const el = elOf(m.blockId);
    setMenu(null);
    if (!b || !el) return;
    removeTrigger(el, m);
    const atStart = caretOffset(el) === 0;
    const [before, after] = splitHTML(el);
    const owner = alive(ownerId);
    const inherit = owner ? { folderId: owner.folderId || null } : {};

    if (m.kind === 'mention') {
      let target = item.item;
      if (item.kind === 'new') target = create(item.type, { title: m.query, ...inherit });
      const span = document.createElement('span'); span.innerHTML = mentionHTML(target); insertNodeAtCaret(span.firstChild);
      patch(b.id, { html: norm(el.innerHTML) });
      return;
    }
    const id = item.id;
    if (id === 'mention') {
      // re-open as mention menu at the caret
      const span = document.createTextNode('@'); insertNodeAtCaret(span, false);
      patch(b.id, { html: norm(el.innerHTML) });
      setTimeout(() => { const off = caretOffset(el); setMenu({ kind: 'mention', blockId: b.id, offset: off - 1, query: '', rect: caretRect(el), sel: 0 }); }, 0);
      return;
    }
    if (id === 'date') {
      const t = document.createTextNode(D.fmtDate(D.today(), { weekday: true, year: true }));
      insertNodeAtCaret(t, false);
      patch(b.id, { html: norm(el.innerHTML) });
      return;
    }
    if (TEXT_TYPES.has(id)) {
      if (atStart || !stripHtml(before).trim()) {
        el.innerHTML = after; patch(b.id, { type: id, html: after, checked: false, emoji: id === 'callout' ? '💡' : undefined });
        focusLater(b.id, 'start');
      } else {
        el.innerHTML = before;
        const nbk = nb(id, { html: after, emoji: id === 'callout' ? '💡' : undefined });
        const list = blocksRef.current.map((x) => (x.id === b.id ? { ...x, html: before } : x));
        list.splice(list.findIndex((x) => x.id === b.id) + 1, 0, nbk);
        setBlocks(list); focusLater(nbk.id, 'start');
      }
      return;
    }
    // block-level inserts: divider, image, table, task, event, page
    const textBefore = stripHtml(before).trim();
    const replaceCurrent = !textBefore && !stripHtml(after).trim();
    const makeBlocks = async () => {
      if (id === 'divider') return [nb('divider')];
      if (id === 'table') return [nb('table', { rows: [['', '', ''], ['', '', ''], ['', '', '']], header: true })];
      if (id === 'image') {
        const files = await pickFiles({ accept: 'image/*', multiple: true });
        const out = [];
        for (const f of files) { try { const meta = await storeFile(f); out.push(nb('image', { fileId: meta.id, caption: '' })); } catch (e) { toast(e.message, { kind: 'error' }); } }
        return out;
      }
      if (id === 'task' || id === 'subtask') {
        const title = stripHtml(replaceCurrent ? '' : after).trim();
        let parentId = null, level = b.level || 0;
        if (id === 'subtask') {
          const list = blocksRef.current; const i = list.findIndex((x) => x.id === b.id);
          for (let j = i; j >= 0; j--) if (list[j].type === 'task') { parentId = list[j].ref; level = (list[j].level || 0) + 1; break; }
        }
        const t = create('task', { title, parentId, ...inherit });
        return [nb('task', { ref: t.id, level })];
      }
      if (id === 'event') {
        const ev = create('event', { title: stripHtml(after).trim(), ...inherit });
        setTimeout(() => openItem(ev.id), 50);
        return [nb('event', { ref: ev.id })];
      }
      if (id === 'page') {
        const n = create('note', { title: stripHtml(after).trim() || 'Untitled note', ...inherit });
        return [nb('page', { ref: n.id })];
      }
      return [];
    };
    makeBlocks().then((nbs) => {
      if (!nbs.length) return;
      const list = blocksRef.current.slice();
      const i = list.findIndex((x) => x.id === b.id);
      const tail = nb(LIST_TYPES.has(b.type) ? b.type : 'p');
      if (replaceCurrent || ((id === 'task' || id === 'subtask' || id === 'event' || id === 'page') && !textBefore)) {
        list.splice(i, 1, ...nbs);
        if (i + nbs.length >= list.length) list.push(tail);
      } else {
        el.innerHTML = before;
        list[i] = { ...list[i], html: before };
        const extra = (id === 'task' || id === 'subtask' || id === 'event' || id === 'page') ? [] : (stripHtml(after).trim() ? [{ ...tail, html: after }] : []);
        list.splice(i + 1, 0, ...nbs, ...extra);
        if (i + 1 + nbs.length + extra.length >= list.length) list.push(tail);
      }
      setBlocks(list, { now: true });
      const last = nbs[nbs.length - 1];
      if (last.type === 'task' || last.type === 'table') focusLater(last.id, null);
      else { const after_ = list[list.indexOf(last) + 1]; if (after_) focusLater(after_.id, 'start'); }
    });
  };

  const menuKey = (key) => {
    const items = menuItems();
    const m = menuRef.current;
    if (key === 'Escape') { setMenu(null); return; }
    if (!items.length) { if (key === 'Enter' || key === 'Tab') setMenu(null); return; }
    if (key === 'ArrowDown') setMenu({ ...m, sel: (m.sel + 1) % items.length });
    else if (key === 'ArrowUp') setMenu({ ...m, sel: (m.sel - 1 + items.length) % items.length });
    else if (key === 'Enter' || key === 'Tab') pickMenu(items[Math.min(m.sel, items.length - 1)]);
  };

  /* ----- text block events ----- */
  const onInput = (b, el) => {
    if (el.innerHTML === '<br>') el.innerHTML = '';
    let h = norm(el.innerHTML);
    const text = el.textContent;
    // markdown shortcuts at the start of a plain paragraph
    if (b.type === 'p') {
      const m = /^(#{1,3}|[-*•]|1[.)]|\[[ x]?\]|>|```|---)[\s ]/.exec(text);
      if (m || text === '---') {
        const tok = m ? m[1] : '---';
        const map = { '#': 'h1', '##': 'h2', '###': 'h3', '-': 'ul', '*': 'ul', '•': 'ul', '1.': 'ol', '1)': 'ol', '[]': 'todo', '[ ]': 'todo', '[x]': 'todo', '>': 'quote', '```': 'code', '---': 'divider' };
        const type = map[tok];
        if (type) {
          const r = rangeFromOffsets(el, 0, m ? m[0].length : 3);
          if (r) r.deleteContents();
          h = norm(el.innerHTML);
          if (type === 'divider') {
            const list = blocksRef.current.slice(); const i = idx(b.id);
            const next = nb('p', { html: h });
            list.splice(i, 1, nb('divider'), next);
            setBlocks(list); focusLater(next.id, 'start');
            return;
          }
          patch(b.id, { type, html: h, checked: tok === '[x]' });
          focusLater(b.id, 'start');
          return;
        }
      }
    }
    // slash + mention triggers
    const off = caretOffset(el);
    const ch = text[off - 1];
    const prevCh = text[off - 2];
    const m = menuRef.current;
    if (m && m.blockId === b.id) {
      const q = text.slice(m.offset + 1, off);
      if (off <= m.offset || text[m.offset] !== (m.kind === 'slash' ? '/' : '@') || /\s\s|^\s/.test(q) || q.length > 40) setMenu(null);
      else setMenu({ ...m, query: q, sel: 0 });
    } else if (b.type !== 'code' && (ch === '/' || ch === '@') && (off === 1 || /[\s ]/.test(prevCh || ''))) {
      openSlash(ch === '/' ? 'slash' : 'mention', b, el, off - 1);
    }
    patch(b.id, { html: h });
  };

  const onKeyDown = (e, b, el) => {
    if (menuRef.current && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); menuKey(e.key); return; }
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'e' && !e.shiftKey) { e.preventDefault(); wrapInline('code'); return; }
    if (mod && k === 'k') { e.preventDefault(); e.stopPropagation(); addLink(); return; }
    if (mod && e.shiftKey && k === 'x') { e.preventDefault(); document.execCommand('strikeThrough'); return; }
    const i = idx(b.id);
    const sel = getSelection();
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      if (b.type === 'code' && !mod) { e.preventDefault(); document.execCommand('insertText', false, '\n'); return; }
      e.preventDefault();
      const [before, after] = splitHTML(el);
      if ((LIST_TYPES.has(b.type) || b.type === 'quote' || b.type === 'callout') && isEmptyHTML(before) && isEmptyHTML(after)) {
        if (b.level > 0) patch(b.id, { level: b.level - 1 }); else { patch(b.id, { type: 'p' }); }
        focusLater(b.id, 'start');
        return;
      }
      if (isEmptyHTML(before) && !isEmptyHTML(after)) {
        // Enter at the very start: push the block down
        const n = nb(b.type === 'code' ? 'p' : LIST_TYPES.has(b.type) ? b.type : 'p', { level: b.level });
        const list = blocksRef.current.slice(); list.splice(i, 0, n); setBlocks(list); focusLater(b.id, 'start');
        return;
      }
      el.innerHTML = before;
      const newType = LIST_TYPES.has(b.type) ? b.type : 'p';
      const n = nb(newType, { html: after, level: LIST_TYPES.has(b.type) ? b.level : 0 });
      const list = blocksRef.current.map((x) => (x.id === b.id ? { ...x, html: before } : x));
      list.splice(i + 1, 0, n);
      setBlocks(list); focusLater(n.id, 'start');
      return;
    }
    if (e.key === 'Backspace' && sel.isCollapsed && caretOffset(el) === 0) {
      if (b.type !== 'p') {
        e.preventDefault();
        if (LIST_TYPES.has(b.type) && b.level > 0) patch(b.id, { level: b.level - 1 }); else patch(b.id, { type: 'p', level: 0 });
        focusLater(b.id, 'start');
        return;
      }
      if (b.level > 0) { e.preventDefault(); patch(b.id, { level: 0 }); focusLater(b.id, 'start'); return; }
      const prev = blocksRef.current[i - 1];
      if (!prev) return;
      e.preventDefault();
      if (TEXT_TYPES.has(prev.type)) {
        const pel = elOf(prev.id);
        const len = pel ? pel.textContent.length : stripHtml(prev.html).length;
        const merged = norm((prev.html || '') + (b.html || ''));
        const list = blocksRef.current.filter((x) => x.id !== b.id).map((x) => (x.id === prev.id ? { ...x, html: merged } : x));
        if (pel) pel.innerHTML = merged;
        setBlocks(list); focusLater(prev.id, len);
      } else if (isEmptyHTML(b.html)) {
        removeBlock(b.id); focusLater(prev.id, null);
      } else {
        focusLater(prev.id, null); setBlocksState(blocksRef.current.slice());
      }
      return;
    }
    if (e.key === 'Delete' && sel.isCollapsed && caretOffset(el) === el.textContent.length) {
      const next = blocksRef.current[i + 1];
      if (next && TEXT_TYPES.has(next.type)) {
        e.preventDefault();
        const len = el.textContent.length;
        const merged = norm((b.html || '') + (next.html || ''));
        el.innerHTML = merged;
        setBlocks(blocksRef.current.filter((x) => x.id !== next.id).map((x) => (x.id === b.id ? { ...x, html: merged } : x)));
        focusLater(b.id, len);
      }
      return;
    }
    if (e.key === 'ArrowUp' && !e.shiftKey && lineCheck(el, true)) {
      const prev = blocksRef.current[i - 1];
      if (prev) { e.preventDefault(); const pel = elOf(prev.id); if (pel) pel.isContentEditable ? setCaret(pel, 'end') : pel.focus(); }
      return;
    }
    if (e.key === 'ArrowDown' && !e.shiftKey && lineCheck(el, false)) {
      const next = blocksRef.current[i + 1];
      if (next) { e.preventDefault(); const nel = elOf(next.id); if (nel) nel.isContentEditable ? setCaret(nel, 'start') : nel.focus(); }
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      if (b.type === 'code') { document.execCommand('insertText', false, '  '); return; }
      if (INDENTABLE.has(b.type)) {
        const off = caretOffset(el);
        const level = Math.max(0, Math.min(4, (b.level || 0) + (e.shiftKey ? -1 : 1)));
        patch(b.id, { level });
        focusLater(b.id, off);
      }
    }
  };

  const onPaste = (e, b, el) => {
    const cd = e.clipboardData; if (!cd) return;
    const files = [...(cd.files || [])];
    if (files.length) {
      e.preventDefault();
      (async () => {
        const out = [];
        for (const f of files) {
          if (f.type.startsWith('image/')) { try { const meta = await storeFile(f); out.push(nb('image', { fileId: meta.id })); } catch (err) { toast(err.message, { kind: 'error' }); } }
          else if (ownerId) await addAttachments(ownerId, [f]);
        }
        if (out.length) insertAfter(b.id, out, false);
      })();
      return;
    }
    const text = cd.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    if (b.type === 'code' || !/\n/.test(text.trim())) { document.execCommand('insertText', false, b.type === 'code' ? text : text.replace(/\s*\n\s*/g, ' ')); return; }
    const parsed = markdownToBlocks(text);
    const [before, after] = splitHTML(el);
    const list = blocksRef.current.slice();
    const i = idx(b.id);
    if (isEmptyHTML(before) && isEmptyHTML(after)) list.splice(i, 1, ...parsed);
    else {
      el.innerHTML = before;
      list[i] = { ...list[i], html: before };
      const tail = isEmptyHTML(after) ? [] : [nb(b.type, { html: after, level: b.level })];
      list.splice(i + 1, 0, ...parsed, ...tail);
    }
    setBlocks(list);
    focusLater(parsed[parsed.length - 1].id, 'end');
  };

  /* ----- inline formatting ----- */
  const wrapInline = (tag) => {
    const sel = getSelection(); if (!sel.rangeCount || sel.isCollapsed) return;
    const r = sel.getRangeAt(0);
    const host = r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement;
    const existing = host.closest(tag);
    if (existing) { existing.replaceWith(...existing.childNodes); }
    else { const w = document.createElement(tag); w.appendChild(r.extractContents()); r.insertNode(w); }
    const blockEl = host.closest('[data-bid]');
    if (blockEl) blockEl.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const addLink = async () => {
    const sel = getSelection(); if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0).cloneRange();
    const url = await promptDialog({ title: 'Add link', label: 'URL', placeholder: 'https://…', okLabel: 'Add link' });
    if (!url) return;
    const href = /^https?:|^mailto:/.test(url) ? url : 'https://' + url;
    sel.removeAllRanges(); sel.addRange(range);
    if (range.collapsed) { const a = document.createElement('a'); a.href = href; a.textContent = url; a.target = '_blank'; a.rel = 'noopener'; insertNodeAtCaret(a); }
    else document.execCommand('createLink', false, href);
    const host = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    const blockEl = host && host.closest('[data-bid]');
    if (blockEl) { blockEl.querySelectorAll('a').forEach((a) => { a.target = '_blank'; a.rel = 'noopener'; }); blockEl.dispatchEvent(new Event('input', { bubbles: true })); }
  };
  const aiOnSelection = async (kind) => {
    const sel = getSelection(); if (!sel.rangeCount || sel.isCollapsed) return;
    const range = sel.getRangeAt(0).cloneRange();
    const text = range.toString();
    setToolbar(null);
    try {
      const ai = await import('../ai.js');
      toast(kind === 'summarize' ? 'Summarizing…' : 'Rewriting…', { timeout: 2500 });
      const out = kind === 'summarize' ? await ai.summarizeText(text) : await ai.rewriteText(text, kind);
      if (!out) return;
      range.deleteContents();
      range.insertNode(document.createTextNode(out.trim()));
      const host = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
      const blockEl = host && host.closest('[data-bid]');
      if (blockEl) blockEl.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (e) { toast(e.message, { kind: 'error', timeout: 7000 }); }
  };

  /* ----- clicks: mentions, links, todo ----- */
  const onRootClick = (e) => {
    const m = e.target.closest('.mention');
    if (m) { e.preventDefault(); const it = alive(m.dataset.ref); if (it) openItem(it.id); else toast('That item was deleted.'); return; }
    const a = e.target.closest('a[href]');
    if (a && (e.ctrlKey || e.metaKey || !a.closest('[contenteditable="true"]'))) { e.preventDefault(); window.open(a.href, '_blank', 'noopener'); }
  };

  const onDrop = async (e) => {
    const files = [...(e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files : [])];
    if (files.length) {
      e.preventDefault();
      const out = [];
      for (const f of files) {
        if (f.type.startsWith('image/')) { try { const meta = await storeFile(f); out.push(nb('image', { fileId: meta.id })); } catch (err) { toast(err.message, { kind: 'error' }); } }
        else if (ownerId) await addAttachments(ownerId, [f]);
      }
      if (out.length) { const last = blocksRef.current[blocksRef.current.length - 1]; insertAfter(last.id, out, false); }
      return;
    }
    if (dragId.current && dropAt) {
      e.preventDefault();
      const list = blocksRef.current.slice();
      const from = list.findIndex((b) => b.id === dragId.current);
      const [moved] = list.splice(from, 1);
      let to = list.findIndex((b) => b.id === dropAt.id);
      if (to < 0) to = list.length - 1;
      list.splice(dropAt.after ? to + 1 : to, 0, moved);
      setBlocks(list);
    }
    dragId.current = null; setDropAt(null);
  };

  const blockMenu = (anchor, b) => {
    const i = idx(b.id);
    const turn = (t) => ({ label: SLASH.find((s) => s.id === t).label, icon: SLASH.find((s) => s.id === t).icon, checked: b.type === t, onClick: () => { patch(b.id, { type: t }); focusLater(b.id, 'end'); } });
    openMenu(anchor, [
      ...(TEXT_TYPES.has(b.type) ? [{ header: 'Turn into' }, ...['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'todo', 'quote', 'callout', 'code'].map(turn), { sep: true }] : []),
      { label: 'Duplicate', icon: 'copy', onClick: () => insertAfter(b.id, [{ ...b, id: uid('b') }], false) },
      { label: 'Move up', icon: 'chevU', disabled: i === 0, onClick: () => { const l = blocksRef.current.slice(); [l[i - 1], l[i]] = [l[i], l[i - 1]]; setBlocks(l); } },
      { label: 'Move down', icon: 'chevD', disabled: i === blocksRef.current.length - 1, onClick: () => { const l = blocksRef.current.slice(); [l[i + 1], l[i]] = [l[i], l[i + 1]]; setBlocks(l); } },
      { sep: true },
      { label: 'Delete block', icon: 'trash', danger: true, onClick: () => removeBlock(b.id) },
    ]);
  };

  // ordered-list numbering
  const numbers = {};
  { const counters = []; for (const b of blocks) { if (b.type === 'ol') { const L = b.level || 0; counters[L] = (counters[L] || 0) + 1; counters.length = L + 1; numbers[b.id] = counters[L]; } else if (!(b.level > 0)) counters.length = 0; } }

  const ctx = { onInput, onKeyDown, onPaste, patch, removeBlock, insertAfter, focusLater, blockMenu, setBlocks, blocksRef, elOf, ownerId };
  const items = menu ? menuItems() : [];
  const showPh = blocks.length === 1 && blocks[0].type === 'p' && isEmptyHTML(blocks[0].html);

  return html`<div class=${cx('editor', compact && 'compact', showPh && 'is-empty')} ref=${root} onClick=${onRootClick}
      onDragOver=${(e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); }} onDrop=${onDrop}>
    ${blocks.map((b) => html`<${Block} key=${b.id} b=${b} ctx=${ctx} num=${numbers[b.id]} placeholder=${showPh ? placeholder : 'Type ‘/’ for commands'}
      dropAt=${dropAt && dropAt.id === b.id ? dropAt : null}
      onDragStart=${(e) => { dragId.current = b.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', b.id); }}
      onDragOver=${(e) => { if (!dragId.current) return; e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setDropAt({ id: b.id, after: e.clientY > r.top + r.height / 2 }); }}
      onDragEnd=${() => { dragId.current = null; setDropAt(null); }} />`)}
    <div class="editor-tail" onClick=${() => {
      const last = blocksRef.current[blocksRef.current.length - 1];
      if (last && TEXT_TYPES.has(last.type) && isEmptyHTML(last.html)) { setCaret(elOf(last.id), 'end'); return; }
      const n = nb(); setBlocks([...blocksRef.current, n]); focusLater(n.id, 'start');
    }}></div>
    ${menu && html`<${InlineMenu} menu=${menu} items=${items} rootEl=${root.current} onPick=${pickMenu} onHover=${(i) => setMenu({ ...menu, sel: i })} onClose=${closeMenuState} />`}
    ${toolbar && !menu && html`<div class="sel-toolbar" style=${`left:${toolbar.left}px;top:${toolbar.top}px`} onMouseDown=${(e) => e.preventDefault()}>
      <button title="Bold (Ctrl+B)" onClick=${() => document.execCommand('bold')}><b>B</b></button>
      <button title="Italic (Ctrl+I)" onClick=${() => document.execCommand('italic')}><i>I</i></button>
      <button title="Underline (Ctrl+U)" onClick=${() => document.execCommand('underline')}><u>U</u></button>
      <button title="Strikethrough (Ctrl+Shift+X)" onClick=${() => document.execCommand('strikeThrough')}><s>S</s></button>
      <button title="Inline code (Ctrl+E)" onClick=${() => wrapInline('code')}><${Icon} name="code" size=${15} /></button>
      <button title="Link (Ctrl+K)" onClick=${addLink}><${Icon} name="link" size=${15} /></button>
      <span class="sep"></span>
      <button title="Rewrite with AI" onClick=${(e) => openMenu(e.currentTarget, [
        { header: 'Rewrite selection' },
        { label: 'Improve writing', icon: 'wand', onClick: () => aiOnSelection('improve') },
        { label: 'More formal', icon: 'wand', onClick: () => aiOnSelection('more-formal') },
        { label: 'More casual', icon: 'wand', onClick: () => aiOnSelection('more-casual') },
        { label: 'Shorter', icon: 'wand', onClick: () => aiOnSelection('shorter') },
        { label: 'Longer', icon: 'wand', onClick: () => aiOnSelection('longer') },
        { sep: true },
        { label: 'Summarize', icon: 'sparkles', onClick: () => aiOnSelection('summarize') },
      ])}><${Icon} name="sparkles" size=${15} /><span>AI</span></button>
    </div>`}
  </div>`;
}

function InlineMenu({ menu, items, rootEl, onPick, onHover, onClose }) {
  const ref = useRef();
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    if (!rootEl || !ref.current) return;
    const base = rootEl.getBoundingClientRect();
    const h = ref.current.offsetHeight;
    let top = menu.rect.bottom - base.top + 4;
    if (menu.rect.bottom + h + 12 > innerHeight) top = menu.rect.top - base.top - h - 4;
    const left = Math.min(menu.rect.left - base.left, Math.max(0, base.width - 280));
    setPos({ top, left: Math.max(0, left) });
  }, [menu.rect, items.length]);
  useEffect(() => {
    const el = ref.current && ref.current.querySelector('.sel');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [menu.sel]);
  useEffect(() => {
    const off = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, []);
  return html`<div ref=${ref} class="inline-menu" style=${pos ? `top:${pos.top}px;left:${pos.left}px` : 'visibility:hidden'} onMouseDown=${(e) => e.preventDefault()}>
    <div class="menu-h">${menu.kind === 'slash' ? (menu.query ? `Commands · “${menu.query}”` : 'Insert block') : (menu.query ? `Mention “${menu.query}”` : 'Mention a task, event or note')}</div>
    ${items.length ? items.map((it, i) => html`<button type="button" class=${cx('menu-i', i === menu.sel && 'sel')} onMouseEnter=${() => onHover(i)} onClick=${() => onPick(it)}>
      <span class="menu-ic"><${Icon} name=${it.icon} size=${15} /></span><span class="menu-l">${it.label}</span>${it.hint && html`<span class="menu-hint">${it.hint}</span>`}</button>`)
      : html`<div class="picker-empty">No matches — press Esc</div>`}
  </div>`;
}

/* ------------------------------ blocks ------------------------------ */

function Block({ b, ctx, num, placeholder, dropAt, onDragStart, onDragOver, onDragEnd }) {
  const wrapCls = cx('blk', 'blk-' + b.type, dropAt && (dropAt.after ? 'drop-after' : 'drop-before'));
  const handle = html`<div class="blk-handle">
    <button type="button" class="blk-grip" title="Drag to move · click for options" draggable="true" onDragStart=${onDragStart} onDragEnd=${onDragEnd}
      onClick=${(e) => ctx.blockMenu(e.currentTarget, b)} tabIndex="-1"><${Icon} name="grip" size=${14} /></button>
  </div>`;
  let body;
  if (TEXT_TYPES.has(b.type)) body = html`<${TextBlock} b=${b} ctx=${ctx} num=${num} placeholder=${placeholder} />`;
  else if (b.type === 'divider') body = html`<div class="blk-divider" tabIndex="0" data-bid=${b.id} onKeyDown=${(e) => nonTextKeys(e, b, ctx)}><hr /></div>`;
  else if (b.type === 'image') body = html`<${ImageBlock} b=${b} ctx=${ctx} />`;
  else if (b.type === 'table') body = html`<${TableBlock} b=${b} ctx=${ctx} />`;
  else if (b.type === 'task') body = html`<${TaskBlock} b=${b} ctx=${ctx} />`;
  else if (b.type === 'event') body = html`<${RefCard} b=${b} ctx=${ctx} kind="event" />`;
  else if (b.type === 'page') body = html`<${RefCard} b=${b} ctx=${ctx} kind="page" />`;
  else body = html`<div class="muted">Unknown block</div>`;
  return html`<div class=${wrapCls} style=${b.level ? `--lvl:${b.level}` : ''} onDragOver=${onDragOver}>${handle}${body}</div>`;
}

function nonTextKeys(e, b, ctx) {
  const list = ctx.blocksRef.current; const i = list.findIndex((x) => x.id === b.id);
  if (e.key === 'Backspace' || e.key === 'Delete') {
    if (e.target.closest('input, [contenteditable="true"]')) return;
    e.preventDefault();
    const prev = list[i - 1], next = list[i + 1];
    ctx.removeBlock(b.id);
    const target = prev || next;
    if (target) ctx.focusLater(target.id, 'end');
  } else if (e.key === 'ArrowUp' && list[i - 1]) { e.preventDefault(); const el = ctx.elOf(list[i - 1].id); el && (el.isContentEditable ? setCaret(el, 'end') : el.focus()); }
  else if ((e.key === 'ArrowDown' || e.key === 'Enter') && !e.target.closest('input')) {
    e.preventDefault();
    if (list[i + 1]) { const el = ctx.elOf(list[i + 1].id); el && (el.isContentEditable ? setCaret(el, 'start') : el.focus()); }
    else { const n = nb(); ctx.insertAfter(b.id, [n]); }
  }
}

function TextBlock({ b, ctx, num, placeholder }) {
  const ref = useRef();
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    if (norm(el.innerHTML) !== norm(b.html)) { el.innerHTML = b.html || ''; }
    hydrateMentions(el);
  }, [b.html, b.type]);
  const prefix = b.type === 'ul' ? html`<span class="blk-bullet">${['•', '◦', '▪'][(b.level || 0) % 3]}</span>`
    : b.type === 'ol' ? html`<span class="blk-num">${num || 1}.</span>`
    : b.type === 'todo' ? html`<button type="button" class=${cx('blk-check', b.checked && 'on')} role="checkbox" aria-checked=${!!b.checked}
        onClick=${() => ctx.patch(b.id, { checked: !b.checked })}>${b.checked && html`<${Icon} name="check" size=${12} />`}</button>`
    : b.type === 'callout' ? html`<button type="button" class="blk-emoji" onClick=${() => {
        const opts = ['💡', '📌', '⚠️', '✅', '🔥', '📣', '🍓', '🧠'];
        ctx.patch(b.id, { emoji: opts[(opts.indexOf(b.emoji || '💡') + 1) % opts.length] });
      }}>${b.emoji || '💡'}</button>` : null;
  const Tag = b.type === 'code' ? 'pre' : 'div';
  return html`${prefix}<${Tag} ref=${ref} class=${cx('blk-text', 't-' + b.type, b.type === 'todo' && b.checked && 'checked')} contenteditable="true"
    spellcheck=${b.type !== 'code'} data-bid=${b.id} data-ph=${b.type === 'p' ? placeholder : { h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3', ul: 'List', ol: 'List', todo: 'To-do', quote: 'Quote', callout: 'Callout', code: 'Code' }[b.type]}
    onInput=${(e) => ctx.onInput(b, e.currentTarget)} onKeyDown=${(e) => ctx.onKeyDown(e, b, e.currentTarget)} onPaste=${(e) => ctx.onPaste(e, b, e.currentTarget)}></${Tag}>`;
}

function ImageBlock({ b, ctx }) {
  const [url, setUrl] = useState(b.src || null);
  useEffect(() => { if (b.fileId) fileURL(b.fileId).then(setUrl); else setUrl(b.src || null); }, [b.fileId, b.src]);
  return html`<figure class=${cx('blk-image', b.width === 'half' && 'half')} tabIndex="0" data-bid=${b.id} onKeyDown=${(e) => nonTextKeys(e, b, ctx)}>
    ${url ? html`<img src=${url} alt=${b.caption || ''} loading="lazy" />` : html`<div class="img-missing"><${Icon} name="image" size=${22} /> Image unavailable</div>`}
    <div class="img-tools">
      <button type="button" class="btn btn-sm btn-glass" title="Toggle size" onClick=${() => ctx.patch(b.id, { width: b.width === 'half' ? 'full' : 'half' })}><${Icon} name="grid" size=${14} /></button>
      <button type="button" class="btn btn-sm btn-glass" title="Delete image" onClick=${() => ctx.removeBlock(b.id)}><${Icon} name="trash" size=${14} /></button>
    </div>
    <input class="img-cap" placeholder="Add a caption…" value=${b.caption || ''} onInput=${(e) => ctx.patch(b.id, { caption: e.target.value })} />
  </figure>`;
}

function Cell({ value, onInput, onKeyDown, header }) {
  const ref = useRef();
  useLayoutEffect(() => { if (ref.current && norm(ref.current.innerHTML) !== norm(value)) ref.current.innerHTML = value || ''; }, [value]);
  return html`<div ref=${ref} class=${cx('cell', header && 'th')} contenteditable="true" onInput=${(e) => onInput(norm(e.currentTarget.innerHTML))} onKeyDown=${onKeyDown}></div>`;
}

function TableBlock({ b, ctx }) {
  const rows = b.rows && b.rows.length ? b.rows : [['']];
  const set = (r2) => ctx.patch(b.id, { rows: r2 });
  const onCell = (ri, ci, v) => set(rows.map((r, i) => (i === ri ? r.map((c, j) => (j === ci ? v : c)) : r)));
  const tableRef = useRef();
  const focusCell = (ri, ci) => { const el = tableRef.current && tableRef.current.querySelector(`[data-rc="${ri}-${ci}"] .cell`); if (el) setCaret(el, 'end'); };
  const onKey = (e, ri, ci) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const w = rows[0].length;
      let n = ri * w + ci + (e.shiftKey ? -1 : 1);
      if (n >= rows.length * w) { set([...rows, Array(w).fill('')]); setTimeout(() => focusCell(rows.length, 0), 0); return; }
      n = Math.max(0, n); focusCell(Math.floor(n / w), n % w);
    } else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (ri + 1 < rows.length) focusCell(ri + 1, ci); else { set([...rows, Array(rows[0].length).fill('')]); setTimeout(() => focusCell(ri + 1, ci), 0); } }
  };
  return html`<div class="blk-table" data-bid=${b.id} tabIndex="-1">
    <div class="tbl-scroll"><table ref=${tableRef}><tbody>
      ${rows.map((r, ri) => html`<tr>${r.map((c, ci) => html`<td data-rc=${ri + '-' + ci} class=${b.header && ri === 0 ? 'th' : ''}>
        <${Cell} value=${c} header=${b.header && ri === 0} onInput=${(v) => onCell(ri, ci, v)} onKeyDown=${(e) => onKey(e, ri, ci)} /></td>`)}</tr>`)}
    </tbody></table></div>
    <div class="tbl-tools">
      <button type="button" class="btn btn-sm" onClick=${() => set([...rows, Array(rows[0].length).fill('')])}><${Icon} name="plus" size=${13} /><span>Row</span></button>
      <button type="button" class="btn btn-sm" onClick=${() => set(rows.map((r) => [...r, '']))}><${Icon} name="plus" size=${13} /><span>Column</span></button>
      <button type="button" class="btn btn-sm" disabled=${rows.length < 2} onClick=${() => set(rows.slice(0, -1))}><span>− Row</span></button>
      <button type="button" class="btn btn-sm" disabled=${rows[0].length < 2} onClick=${() => set(rows.map((r) => r.slice(0, -1)))}><span>− Column</span></button>
      <button type="button" class=${cx('btn btn-sm', b.header && 'btn-soft')} onClick=${() => ctx.patch(b.id, { header: !b.header })}><span>Header row</span></button>
      <button type="button" class="btn btn-sm" title="Delete table" onClick=${() => ctx.removeBlock(b.id)}><${Icon} name="trash" size=${13} /></button>
    </div>
  </div>`;
}

function TaskBlock({ b, ctx }) {
  const t = alive(b.ref);
  const inputRef = useRef();
  if (!t) return html`<div class="blk-task dead" tabIndex="0" data-bid=${b.id} onKeyDown=${(e) => nonTextKeys(e, b, ctx)}><${Icon} name="tasks" size=${15} /> <span class="muted">This task was deleted</span></div>`;
  const d = taskDate(t);
  return html`<div class=${cx('blk-task', isDone(t) && 'done')} data-bid=${b.id} tabIndex="-1"
      onFocus=${(e) => { if (e.target === e.currentTarget && inputRef.current) inputRef.current.focus(); }}>
    <button type="button" class=${cx('tcheck', 'p' + (t.priority || 0), isDone(t) && 'on')} aria-label="Complete" onClick=${() => toggleTask(t.id)}>${isDone(t) && html`<${Icon} name="check" size=${12} />`}</button>
    <input ref=${inputRef} class="blk-task-in" value=${t.title} placeholder="Task name" onInput=${(e) => update(t.id, { title: e.target.value })}
      onKeyDown=${(e) => {
        if (e.key === 'Enter') { e.preventDefault(); const nt = create('task', { parentId: t.parentId, folderId: t.folderId }); ctx.insertAfter(b.id, [nb('task', { ref: nt.id, level: b.level })]); }
        else if (e.key === 'Backspace' && !e.target.value) { e.preventDefault(); ctx.removeBlock(b.id); }
        else if (e.key === 'Tab') {
          e.preventDefault();
          const list = ctx.blocksRef.current; const i = list.findIndex((x) => x.id === b.id);
          const level = Math.max(0, Math.min(4, (b.level || 0) + (e.shiftKey ? -1 : 1)));
          let parentId = null;
          for (let j = i - 1; j >= 0; j--) if (list[j].type === 'task' && (list[j].level || 0) < level) { parentId = list[j].ref; break; }
          update(t.id, { parentId });
          ctx.patch(b.id, { level });
        }
        else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          const list = ctx.blocksRef.current; const i = list.findIndex((x) => x.id === b.id);
          const o = list[i + (e.key === 'ArrowUp' ? -1 : 1)];
          if (o) { e.preventDefault(); const el = ctx.elOf(o.id); if (el) { if (el.isContentEditable) setCaret(el, e.key === 'ArrowUp' ? 'end' : 'start'); else (el.querySelector('input') || el).focus(); } }
        }
      }} />
    ${d && html`<${Chip} icon="calendar" label=${D.relDay(d)} kind=${d < D.today() && !isDone(t) ? 'danger' : ''} />`}
    ${t.repeat && html`<${Chip} icon="flame" label=${String(D.habitStats(t).streak)} kind="flame" />`}
    <button type="button" class="btn btn-icon btn-sm blk-open" title="Open task" onClick=${() => openItem(t.id)}><${Icon} name="arrowR" size=${14} /></button>
  </div>`;
}

function RefCard({ b, ctx, kind }) {
  const it = alive(b.ref);
  const tf = S.settings.timeFormat;
  return html`<div class=${cx('blk-ref', 'ref-' + kind, !it && 'dead')} tabIndex="0" data-bid=${b.id} onKeyDown=${(e) => nonTextKeys(e, b, ctx)}
      onClick=${() => { if (!it) return; if (kind === 'page') navigate('notes', it.id); else openItem(it.id); }}>
    <${Icon} name=${kind === 'page' ? 'notes' : 'calendar'} size=${16} />
    ${it ? html`<span class="ref-t">${titleOf(it)}</span>
      ${kind === 'event' && html`<span class="muted small">${D.fmtDate(it.start.slice(0, 10), { weekday: true })}${it.allDay ? ' · All day' : ' · ' + D.fmtTime(it.start.slice(11), tf)}</span>`}`
      : html`<span class="muted">Deleted ${kind === 'page' ? 'note' : 'event'}</span>`}
    <span class="grow"></span><${Icon} name="arrowR" size=${14} />
  </div>`;
}
