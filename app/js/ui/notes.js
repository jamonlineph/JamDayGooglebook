// Notes: list + page editor with covers, icons, tags, folders, backlinks and export.
import { html, useState, useEffect, useRef, cx, fuzzy, pickFiles } from '../lib.js';
import {
  S, notes, alive, create, update, trash, undoable, navigate, setSetting, itemText, folderOf, liveTags, titleOf,
  storeFile, fileURL, toast, openPopover, closePopover, blocksText, setUI, purge,
} from '../store.js';
import * as D from '../dates.js';
import { Icon } from './icons.js';
import { Btn, Empty, ItemIcon, openIconPicker, openMenu, openContextMenu } from './common.js';
import { BlockEditor } from './editor.js';
import { AutoTitle, RelatedList, TagsField, FolderField } from './tasks.js';
import { Attachments } from './attachments.js';
import { exportNoteMarkdown } from '../io.js';

export const COVERS = [
  { id: 'jam', name: 'Jam', css: 'linear-gradient(120deg,#ff5f8f 0%,#ff9a8b 55%,#ffc3a0 100%)' },
  { id: 'berry', name: 'Berry', css: 'linear-gradient(135deg,#6a11cb 0%,#d6409f 100%)' },
  { id: 'citrus', name: 'Citrus', css: 'linear-gradient(135deg,#f6d365 0%,#fda085 100%)' },
  { id: 'mint', name: 'Mint', css: 'linear-gradient(135deg,#84fab0 0%,#8fd3f4 100%)' },
  { id: 'ocean', name: 'Ocean', css: 'linear-gradient(135deg,#1e6fa8 0%,#6dd5ed 100%)' },
  { id: 'dusk', name: 'Dusk', css: 'linear-gradient(135deg,#0f2027 0%,#203a43 50%,#2c5364 100%)' },
  { id: 'peach', name: 'Peach', css: 'radial-gradient(circle at 18% 30%,#ffd1dc 0,transparent 42%),radial-gradient(circle at 82% 70%,#ffe5b4 0,transparent 46%),#fff1e6' },
  { id: 'aurora', name: 'Aurora', css: 'radial-gradient(ellipse at 20% 0%,#7ef9c4 0,transparent 55%),radial-gradient(ellipse at 80% 20%,#6aa8ff 0,transparent 55%),radial-gradient(ellipse at 50% 100%,#b06ab3 0,transparent 60%),#16213e' },
  { id: 'dots', name: 'Confetti', css: 'radial-gradient(circle,rgba(255,255,255,.45) 1.6px,transparent 1.8px) 0 0/18px 18px,linear-gradient(135deg,#ff758c,#ff7eb3)' },
  { id: 'grid', name: 'Graph', css: 'linear-gradient(rgba(0,0,0,.06) 1px,transparent 1px) 0 0/22px 22px,linear-gradient(90deg,rgba(0,0,0,.06) 1px,transparent 1px) 0 0/22px 22px,#f5f1ea' },
  { id: 'stripes', name: 'Candy', css: 'repeating-linear-gradient(-45deg,#ffe0ea 0 18px,#ffd0df 18px 36px)' },
  { id: 'forest', name: 'Forest', css: 'linear-gradient(160deg,#134e5e 0%,#71b280 100%)' },
  { id: 'sunrise', name: 'Sunrise', css: 'linear-gradient(180deg,#ffecd2 0%,#fcb69f 100%)' },
  { id: 'night', name: 'Night', css: 'radial-gradient(circle at 70% 30%,#ffe9a8 0 6%,transparent 7%),radial-gradient(circle,rgba(255,255,255,.7) 1px,transparent 1.4px) 0 0/34px 34px,linear-gradient(180deg,#0b1026,#2b3a67)' },
  { id: 'lilac', name: 'Lilac', css: 'linear-gradient(135deg,#e0c3fc 0%,#8ec5fc 100%)' },
  { id: 'paper', name: 'Paper', css: 'linear-gradient(135deg,#fdfbfb 0%,#ebedee 100%)' },
];

function coverStyle(cover, url) {
  if (!cover) return '';
  if (cover.type === 'image') return url ? `background-image:url("${url}");background-size:cover;background-position:center ${cover.y ?? 50}%` : 'background:var(--bg-hover)';
  const p = COVERS.find((c) => c.id === cover.id);
  return p ? `background:${p.css}` : '';
}

function Cover({ n }) {
  const [url, setUrl] = useState(null);
  useEffect(() => { if (n.cover && n.cover.type === 'image') fileURL(n.cover.fileId).then(setUrl); }, [n.cover && n.cover.fileId]);
  if (!n.cover) return null;
  return html`<div class="cover" style=${coverStyle(n.cover, url)}>
    <div class="cover-tools">
      <button type="button" class="btn btn-sm btn-glass" onClick=${(e) => openCoverPicker(e.currentTarget, n)}>Change cover</button>
      ${n.cover.type === 'image' && html`<button type="button" class="btn btn-sm btn-glass" onClick=${() => update(n.id, { cover: { ...n.cover, y: ((n.cover.y ?? 50) + 25) % 125 } })}>Reposition</button>`}
      <button type="button" class="btn btn-sm btn-glass" onClick=${() => update(n.id, { cover: null })}>Remove</button>
    </div>
  </div>`;
}

export function openCoverPicker(anchor, n) {
  openPopover(anchor, () => html`<div class="cover-pick">
    <div class="menu-h">Artwork gallery</div>
    <div class="cover-grid">${COVERS.map((c) => html`<button type="button" class="cover-sw" title=${c.name} style=${`background:${c.css}`} onClick=${() => { update(n.id, { cover: { type: 'preset', id: c.id } }); closePopover(); }}></button>`)}</div>
    <button type="button" class="btn btn-sm" onClick=${async () => {
      closePopover();
      const [f] = await pickFiles({ accept: 'image/*' });
      if (!f) return;
      try { const meta = await storeFile(f); update(n.id, { cover: { type: 'image', fileId: meta.id, y: 50 } }); } catch (e) { toast(e.message, { kind: 'error' }); }
    }}><${Icon} name="upload" size=${14} /><span>Upload an image</span></button>
  </div>`, { className: 'cover-pop' });
}

function noteMenu(n) {
  return [
    { label: n.pinned ? 'Unpin' : 'Pin to top', icon: 'pin', onClick: () => update(n.id, { pinned: !n.pinned }) },
    { label: 'Duplicate', icon: 'copy', onClick: () => { const c = create('note', { ...n, id: undefined, title: n.title + ' (copy)', createdAt: Date.now() }); navigate('notes', c.id); } },
    { label: 'Export as Markdown', icon: 'download', onClick: () => exportNoteMarkdown(n) },
    { sep: true },
    { label: 'Move to Trash', icon: 'trash', danger: true, onClick: () => { undoable(`Moved “${titleOf(n)}” to Trash`, [n.id], () => trash(n.id)); navigate('notes'); } },
  ];
}

export function NewNoteButton({ folderId = null, label = 'New note', kind = 'primary', tags }) {
  return html`<${Btn} icon="plus" label=${label} kind=${kind} onClick=${() => { const n = create('note', { folderId, tags: tags || [] }); navigate('notes', n.id); }} />`;
}

export function NotesView({ id }) {
  const [q, setQ] = useState('');
  const sort = S.settings.notesSort;
  let list = notes();
  if (q.trim()) list = list.map((n) => ({ n, s: fuzzy(q, itemText(n)) })).filter((r) => r.s >= 0).sort((a, b) => b.s - a.s).map((r) => r.n);
  else list = list.slice().sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (sort === 'title' ? titleOf(a).localeCompare(titleOf(b)) : sort === 'created' ? b.createdAt - a.createdAt : b.updatedAt - a.updatedAt));
  const current = id ? alive(id) : null;
  useEffect(() => { if (id && !current) navigate('notes'); }, [id, !!current]);
  return html`<div class=${cx('view notes-layout', current && 'has-note')}>
    <aside class="notes-list">
      <div class="nl-h">
        <button type="button" class="btn btn-icon vh-menu" aria-label="Open sidebar" onClick=${() => setUI({ sidebarOpen: true })}><${Icon} name="menu" size=${18} /></button>
        <h1>Notes</h1><span class="count">${notes().length}</span><span class="grow"></span><${NewNoteButton} label="" />
      </div>
      <div class="nl-tools">
        <div class="search-in"><${Icon} name="search" size=${15} /><input placeholder="Search notes…" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
        <select class="input sm" value=${sort} onChange=${(e) => setSetting('notesSort', e.target.value)} aria-label="Sort notes">
          <option value="updated">Recently edited</option><option value="created">Recently created</option><option value="title">Title</option></select>
      </div>
      <div class="nl-items">
        ${list.map((n) => {
          const f = folderOf(n);
          const snippet = blocksText(n.blocks).replace(/\s+/g, ' ').slice(0, 110);
          return html`<button type="button" key=${n.id} class=${cx('nl-item', current && current.id === n.id && 'active')} onClick=${() => navigate('notes', n.id)}
              onContextMenu=${(e) => openContextMenu(e, noteMenu(n))}>
            <span class="nl-ic"><${ItemIcon} icon=${n.icon} fallback="notes" size=${17} /></span>
            <span class="nl-main">
              <b class="ellipsis">${n.pinned && html`<${Icon} name="pin" size=${12} class="pin-ic" />`}${titleOf(n)}</b>
              <span class="nl-snip">${snippet || 'No content yet'}</span>
              <span class="nl-meta">${D.relDay(D.ds(new Date(n.updatedAt)))}${f && html` · <span class="badge-folder-t" style=${`--c:${f.color}`}>${f.name}</span>`}${liveTags(n).map((t) => html` <span class="tagm" style=${`--c:${t.color}`}>#${t.name}</span>`)}</span>
            </span>
          </button>`;
        })}
        ${!list.length && html`<div class="picker-empty">${q ? 'No notes match.' : 'No notes yet.'}</div>`}
      </div>
    </aside>
    <main class="note-main">
      ${current ? html`<${NoteEditor} key=${current.id} n=${current} />` : html`<${Empty} icon="notes" title="Pick a note or start a new one" text="Notes support headings, lists, to-dos, tables, images, @mentions and ‘/’ commands — even mid-line.">
        <${NewNoteButton} /></${Empty}>`}
    </main>
  </div>`;
}

function NoteEditor({ n }) {
  const [busy, setBusy] = useState(false);
  useEffect(() => () => {
    setTimeout(() => {
      const cur = alive(n.id);
      if (cur && !cur.title.trim() && !blocksText(cur.blocks).trim() && !(cur.blocks || []).some((b) => b.type !== 'p') && !(cur.attachments || []).length && !cur.cover && !cur.icon && Date.now() - cur.createdAt < 600000) purge(cur.id);
    }, 400);
  }, [n.id]);
  const words = blocksText(n.blocks).split(/\s+/).filter(Boolean).length;
  const summarize = async () => {
    const text = blocksText(n.blocks);
    if (text.length < 40) { toast('Write a bit more first — there’s not much to summarize.'); return; }
    setBusy(true);
    try {
      const ai = await import('../ai.js');
      const s = await ai.summarizeText(text);
      if (s) update(n.id, { blocks: [{ id: 'b' + Date.now(), type: 'callout', emoji: '✨', html: '<b>Summary:</b> ' + s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])) }, ...n.blocks] });
    } catch (e) { toast(e.message, { kind: 'error', timeout: 8000 }); }
    setBusy(false);
  };
  return html`<div class="note-page">
    <div class="note-bar">
      <button type="button" class="btn btn-sm note-back" onClick=${() => navigate('notes')}><${Icon} name="chevL" size=${15} /><span>Notes</span></button>
      <span class="muted small">Edited ${new Date(n.updatedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · ${words} word${words === 1 ? '' : 's'}</span>
      <span class="grow"></span>
      <${Btn} icon="sparkles" label=${busy ? 'Summarizing…' : 'Summarize'} size="sm" disabled=${busy} onClick=${summarize} title="Summarize with on-device AI" />
      <${Btn} icon="pin" size="sm" title=${n.pinned ? 'Unpin' : 'Pin'} class=${n.pinned ? 'on' : ''} onClick=${() => update(n.id, { pinned: !n.pinned })} />
      <${Btn} icon="download" size="sm" title="Export as Markdown" onClick=${() => exportNoteMarkdown(n)} />
      <${Btn} icon="more" size="sm" title="More" onClick=${(e) => openMenu(e.currentTarget, noteMenu(n), { align: 'right' })} />
    </div>
    <${Cover} n=${n} />
    <div class=${cx('note-doc', n.cover && 'has-cover')}>
      <div class="note-adds">
        ${!n.icon && html`<button type="button" class="btn btn-sm btn-ghost" onClick=${(e) => openIconPicker(e.currentTarget, (icon) => update(n.id, { icon }))}><${Icon} name="star" size=${14} />Add icon</button>`}
        ${!n.cover && html`<button type="button" class="btn btn-sm btn-ghost" onClick=${(e) => openCoverPicker(e.currentTarget, n)}><${Icon} name="image" size=${14} />Add cover</button>`}
      </div>
      ${n.icon && html`<button type="button" class="note-icon" title="Change icon" onClick=${(e) => openIconPicker(e.currentTarget, (icon) => update(n.id, { icon }))}><${ItemIcon} icon=${n.icon} size=${52} /></button>`}
      <${AutoTitle} class="note-title" value=${n.title} placeholder="Untitled" autoFocus=${!n.title && !blocksText(n.blocks)} onInput=${(v) => update(n.id, { title: v })}
        onEnter=${() => { const el = document.querySelector('.note-doc .editor [contenteditable="true"]'); el && el.focus(); }} />
      <div class="note-meta"><${FolderField} item=${n} /><${TagsField} item=${n} /></div>
      <${BlockEditor} key=${'nb' + n.id} blocks=${n.blocks} ownerId=${n.id} onChange=${(b) => update(n.id, { blocks: b })} />
      <div class="note-foot">
        <div class="detail-sec"><h4><${Icon} name="link" size=${14} /> Linked & mentioned in</h4><${RelatedList} item=${n} /></div>
        <div class="detail-sec"><h4><${Icon} name="clip" size=${14} /> Attachments</h4><${Attachments} item=${n} /></div>
      </div>
    </div>
  </div>`;
}
