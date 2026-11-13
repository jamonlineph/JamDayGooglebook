// Folders, tags and Trash.
import { html, useState, cx, plural } from '../lib.js';
import {
  S, folders, tags, alive, create, update, trash, restore, purge, emptyTrash, trashed, itemsInFolder, itemsWithTag,
  navigate, openItem, titleOf, isDone, taskDate, blocksText, eventColor, setSetting, undoable, folderOf, liveTags, toggleTask, COLORS, COLOR_NAMES,
} from '../store.js';
import * as D from '../dates.js';
import { Icon } from './icons.js';
import { Btn, Empty, ViewHeader, Segmented, Section, ItemIcon, ColorSwatches, openIconPicker, openMenu, confirmDialog, promptDialog } from './common.js';
import { TaskRow, TaskCheck, QuickAdd } from './tasks.js';
import { openQuickEvent } from './calendar.js';
import { NewNoteButton } from './notes.js';

const TYPE_ICON = { task: 'tasks', note: 'notes', event: 'calendar' };
const TYPE_LABEL = { task: 'Tasks', note: 'Notes', event: 'Events' };

function itemDate(it) {
  if (it.type === 'event') return it.start.slice(0, 10);
  if (it.type === 'task') return taskDate(it) || it.deadline || D.ds(new Date(it.updatedAt));
  return D.ds(new Date(it.updatedAt));
}

function ItemCard({ it, showFolder }) {
  const f = showFolder ? folderOf(it) : null;
  const open = () => (it.type === 'note' ? navigate('notes', it.id) : openItem(it.id));
  return html`<div class=${cx('icard', 'icard-' + it.type, it.type === 'task' && isDone(it) && 'done')} onClick=${open} tabIndex="0"
      onKeyDown=${(e) => e.key === 'Enter' && open()} style=${it.type === 'event' ? `--c:${eventColor(it)}` : ''}>
    <div class="icard-h">
      ${it.type === 'task' ? html`<${TaskCheck} t=${it} size=${16} />` : it.type === 'note' ? html`<${ItemIcon} icon=${it.icon} fallback="notes" size=${16} />` : html`<${Icon} name="calendar" size=${16} />`}
      <b class="ellipsis">${titleOf(it)}</b>
    </div>
    <div class="icard-b">${it.type === 'note' ? blocksText(it.blocks).slice(0, 140) || 'Empty note'
      : it.type === 'event' ? `${D.fmtDate(it.start.slice(0, 10), { weekday: true })}${it.allDay ? ' · All day' : ' · ' + D.fmtTime(it.start.slice(11), S.settings.timeFormat)}${it.location ? ' · ' + it.location : ''}`
      : [it.when ? D.whenLabel(it.when) : '', it.deadline ? 'Due ' + D.relDay(it.deadline) : '', it.repeat ? D.describeRepeat(it.repeat) : ''].filter(Boolean).join(' · ') || 'No date'}</div>
    <div class="icard-f">
      <span class="muted small">${TYPE_LABEL[it.type].slice(0, -1)}</span>
      ${f && html`<span class="meta badge-folder" style=${`--c:${f.color}`}><${Icon} name="folder" size=${11} />${f.name}</span>`}
      ${liveTags(it).slice(0, 3).map((t) => html`<span class="meta tagm" style=${`--c:${t.color}`}>#${t.name}</span>`)}
    </div>
  </div>`;
}

function ItemRow({ it, showFolder }) {
  if (it.type === 'task') return html`<${TaskRow} t=${it} compact showFolder=${showFolder} />`;
  const open = () => (it.type === 'note' ? navigate('notes', it.id) : openItem(it.id));
  return html`<div class="trow" onClick=${open} tabIndex="0" onKeyDown=${(e) => e.key === 'Enter' && open()}>
    <span class="trow-ic" style=${it.type === 'event' ? `color:${eventColor(it)}` : ''}>${it.type === 'note' ? html`<${ItemIcon} icon=${it.icon} fallback="notes" size=${17} />` : html`<${Icon} name="calendar" size=${17} />`}</span>
    <div class="trow-main"><div class="trow-title">${titleOf(it)}</div>
      <div class="trow-meta"><span class="meta">${it.type === 'event' ? D.fmtDate(it.start.slice(0, 10), { weekday: true }) + (it.allDay ? '' : ' ' + D.fmtTime(it.start.slice(11), S.settings.timeFormat)) : 'Edited ' + D.relDay(D.ds(new Date(it.updatedAt)))}</span>
        ${liveTags(it).map((t) => html`<span class="meta tagm" style=${`--c:${t.color}`}>#${t.name}</span>`)}</div></div>
  </div>`;
}

function Collection({ items, showFolder = true, empty, groupBy, layout, typeFilter }) {
  let list = items;
  if (typeFilter !== 'all') list = list.filter((i) => i.type === typeFilter);
  if (!S.settings.showCompleted) list = list.filter((i) => !(i.type === 'task' && isDone(i)));
  if (!list.length) return empty;
  const sorted = list.slice().sort((a, b) => (itemDate(a) < itemDate(b) ? 1 : -1));
  let groups;
  if (groupBy === 'type') groups = ['task', 'note', 'event'].map((t) => ({ k: t, label: TYPE_LABEL[t], list: sorted.filter((i) => i.type === t) })).filter((g) => g.list.length);
  else if (groupBy === 'date') {
    const m = new Map(); const T = D.today();
    for (const it of sorted) {
      const d = itemDate(it);
      const k = d === T ? '0' : d > T ? (D.diffDays(T, d) <= 7 ? '1' : '2') : D.diffDays(d, T) <= 7 ? '3' : '4';
      const label = { 0: 'Today', 1: 'Next 7 days', 2: 'Later', 3: 'Past week', 4: 'Older' }[k];
      if (!m.has(k)) m.set(k, { k, label, list: [] });
      m.get(k).list.push(it);
    }
    groups = [...m.values()].sort((a, b) => a.k.localeCompare(b.k));
  } else if (groupBy === 'tag') {
    const m = new Map();
    for (const it of sorted) {
      const tg = liveTags(it);
      const keys = tg.length ? tg.map((t) => [t.id, '#' + t.name]) : [['-', 'Untagged']];
      for (const [k, label] of keys) { if (!m.has(k)) m.set(k, { k, label, list: [] }); m.get(k).list.push(it); }
    }
    groups = [...m.values()];
  } else groups = [{ k: 'all', label: null, list: sorted }];
  return groups.map((g) => {
    const body = layout === 'cards'
      ? html`<div class="cards">${g.list.map((it) => html`<${ItemCard} key=${it.id} it=${it} showFolder=${showFolder} />`)}</div>`
      : html`<div class="tlist">${g.list.map((it) => html`<${ItemRow} key=${it.id} it=${it} showFolder=${showFolder} />`)}</div>`;
    return g.label ? html`<${Section} key=${g.k} title=${g.label} count=${g.list.length}>${body}<//>` : body;
  });
}

function CollectionToolbar({ typeFilter, setTypeFilter }) {
  return html`<div class="filters">
    <${Segmented} size="sm" value=${typeFilter} onChange=${setTypeFilter} options=${[{ v: 'all', label: 'All' }, { v: 'task', label: 'Tasks' }, { v: 'note', label: 'Notes' }, { v: 'event', label: 'Events' }]} />
    <span class="grow"></span>
    <select class="input sm" value=${S.settings.folderGroup} onChange=${(e) => setSetting('folderGroup', e.target.value)} aria-label="Group by">
      <option value="type">Group by type</option><option value="date">Group by date</option><option value="tag">Group by tag</option><option value="none">No grouping</option></select>
    <${Segmented} size="sm" value=${S.settings.folderLayout} onChange=${(v) => setSetting('folderLayout', v)} options=${[{ v: 'cards', icon: 'grid', title: 'Cards' }, { v: 'list', icon: 'list', title: 'List' }]} />
  </div>`;
}

/* ---------------- Folders ---------------- */

export function folderMenu(f) {
  return [
    { label: 'Rename', icon: 'text', onClick: async () => { const v = await promptDialog({ title: 'Rename folder', value: f.name }); if (v && v.trim()) update(f.id, { name: v.trim() }); } },
    { label: 'Change icon', icon: 'star', onClick: () => openIconPicker(document.querySelector('.vh-ic') || document.body, (icon) => update(f.id, { icon })) },
    { header: 'Colour' },
    ...COLORS.map((c, i) => ({ label: COLOR_NAMES[i], color: c, checked: c === f.color, onClick: () => update(f.id, { color: c }) })),
    { sep: true },
    { label: 'Delete folder', icon: 'trash', danger: true, onClick: async () => {
      const n = itemsInFolder(f.id).length;
      if (await confirmDialog({ title: `Delete “${f.name}”?`, message: n ? `The ${n} item${n > 1 ? 's' : ''} inside stay in JamDay without a folder. You can restore the folder from Trash.` : 'You can restore it from Trash.' })) { trash(f.id); navigate('folders'); }
    } },
  ];
}

export function FoldersView() {
  const list = folders();
  const add = async () => { const name = await promptDialog({ title: 'New folder', placeholder: 'e.g. Work, Home, Side project', okLabel: 'Create' }); if (name && name.trim()) { const f = create('folder', { name: name.trim() }); navigate('folder', f.id); } };
  return html`<div class="view">
    <${ViewHeader} icon="folder" iconColor="var(--info)" title="Folders" subtitle="Folders hold notes, tasks and events together"><${Btn} icon="plus" label="New folder" kind="primary" onClick=${add} /><//>
    <div class="view-body wide">
      ${!list.length && html`<${Empty} icon="folder" title="No folders yet" text="Create one for each project or area of life."><${Btn} icon="plus" label="New folder" kind="primary" onClick=${add} /><//>`}
      <div class="cards folders">${list.map((f) => {
        const items = itemsInFolder(f.id);
        const c = (t) => items.filter((i) => i.type === t && !(t === 'task' && isDone(i))).length;
        return html`<div class="fcard" key=${f.id} style=${`--c:${f.color}`} onClick=${() => navigate('folder', f.id)} tabIndex="0" onKeyDown=${(e) => e.key === 'Enter' && navigate('folder', f.id)}
            onDragOver=${(e) => { if ([...e.dataTransfer.types].includes('jamday/task')) e.preventDefault(); }} onDrop=${(e) => { const id = e.dataTransfer.getData('jamday/task'); if (id) update(id, { folderId: f.id }); }}>
          <div class="fcard-ic">${f.icon ? html`<${ItemIcon} icon=${f.icon} size=${22} />` : html`<${Icon} name="folder" size=${22} />`}</div>
          <b>${f.name}</b>
          <span class="muted small">${plural(c('task'), 'open task')} · ${plural(c('note'), 'note')} · ${plural(c('event'), 'event')}</span>
          <button type="button" class="btn btn-icon btn-sm fcard-more" aria-label="Folder options" onClick=${(e) => { e.stopPropagation(); openMenu(e.currentTarget, folderMenu(f), { align: 'right' }); }}><${Icon} name="more" size=${16} /></button>
        </div>`;
      })}</div>
    </div>
  </div>`;
}

export function FolderPage({ id }) {
  const f = alive(id);
  const [typeFilter, setTypeFilter] = useState('all');
  if (!f) return html`<div class="view"><${ViewHeader} icon="folder" title="Folder not found" /><${Empty} icon="folder" title="This folder was deleted" text="Check Trash to restore it." /></div>`;
  const items = itemsInFolder(f.id);
  return html`<div class="view">
    <${ViewHeader} icon=${f.icon ? html`<${ItemIcon} icon=${f.icon} size=${22} />` : 'folder'} iconColor=${f.color} title=${f.name}
        subtitle=${`${items.length} item${items.length === 1 ? '' : 's'}`}>
      <${Btn} icon="plus" label="New" onClick=${(e) => openMenu(e.currentTarget, [
        { label: 'Task', icon: 'tasks', onClick: () => { const t = create('task', { folderId: f.id }); openItem(t.id); } },
        { label: 'Note', icon: 'notes', onClick: () => { const n = create('note', { folderId: f.id }); navigate('notes', n.id); } },
        { label: 'Event', icon: 'calendar', onClick: () => openQuickEvent(e.currentTarget, { date: D.today(), allDay: false, start: D.hhmm(D.nowRounded(30)), end: D.hhmm(new Date(D.nowRounded(30).getTime() + 3600000)) }) },
      ], { align: 'right' })} />
      <${Btn} icon="more" title="Folder options" onClick=${(e) => openMenu(e.currentTarget, folderMenu(f), { align: 'right' })} />
    <//>
    <${CollectionToolbar} typeFilter=${typeFilter} setTypeFilter=${setTypeFilter} />
    <div class="view-body wide">
      <${QuickAdd} defaults=${{ folderId: f.id }} placeholder=${`Add a task to ${f.name}…`} />
      <${Collection} items=${items} showFolder=${false} groupBy=${S.settings.folderGroup} layout=${S.settings.folderLayout} typeFilter=${typeFilter}
        empty=${html`<${Empty} icon="folder" title="Nothing here yet" text="Add a task above, create a note, or drag tasks onto the folder in the sidebar." />`} />
    </div>
  </div>`;
}

/* ---------------- Tags ---------------- */

export function TagsView() {
  const list = tags();
  const [name, setName] = useState('');
  const add = () => { if (name.trim()) { create('tag', { name: name.trim().replace(/^#/, '') }); setName(''); } };
  return html`<div class="view">
    <${ViewHeader} icon="tag" iconColor="var(--accent)" title="Tags" subtitle="Tags cut across folders — each one has its own page" />
    <div class="view-body wide">
      <div class="qadd"><div class="qadd-row"><${Icon} name="tag" size=${18} class="qadd-plus" />
        <input class="qadd-in" placeholder="New tag name, then Enter" value=${name} onInput=${(e) => setName(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && add()} /></div></div>
      ${!list.length && html`<${Empty} icon="tag" title="No tags yet" text="Type #tag when adding a task, or create one above." />`}
      <div class="cards tags">${list.map((t) => {
        const n = itemsWithTag(t.id).length;
        return html`<div class="tcard" key=${t.id} style=${`--c:${t.color}`} onClick=${() => navigate('tag', t.id)} tabIndex="0" onKeyDown=${(e) => e.key === 'Enter' && navigate('tag', t.id)}>
          <span class="tcard-ic">${t.icon ? html`<${ItemIcon} icon=${t.icon} size=${18} />` : '#'}</span><b class="ellipsis">${t.name}</b><span class="count">${n}</span>
        </div>`;
      })}</div>
    </div>
  </div>`;
}

export function TagPage({ id }) {
  const t = alive(id);
  const [typeFilter, setTypeFilter] = useState('all');
  if (!t) return html`<div class="view"><${ViewHeader} icon="tag" title="Tag not found" /><${Empty} icon="tag" title="This tag was deleted" /></div>`;
  const items = itemsWithTag(t.id);
  return html`<div class="view">
    <${ViewHeader} icon=${t.icon ? html`<${ItemIcon} icon=${t.icon} size=${22} />` : 'tag'} iconColor=${t.color} title=${'#' + t.name} subtitle=${`${items.length} item${items.length === 1 ? '' : 's'}`}>
      <${Btn} icon="more" title="Tag options" onClick=${(e) => openMenu(e.currentTarget, [
        { label: 'Rename', icon: 'text', onClick: async () => { const v = await promptDialog({ title: 'Rename tag', value: t.name }); if (v && v.trim()) update(t.id, { name: v.trim().replace(/^#/, '') }); } },
        { label: 'Custom icon', icon: 'star', onClick: () => openIconPicker(document.querySelector('.vh-ic') || document.body, (icon) => update(t.id, { icon })) },
        { header: 'Colour' },
        ...COLORS.map((c, i) => ({ label: COLOR_NAMES[i], color: c, checked: c === t.color, onClick: () => update(t.id, { color: c }) })),
        { sep: true },
        { label: 'Delete tag', icon: 'trash', danger: true, onClick: async () => { if (await confirmDialog({ title: `Delete #${t.name}?`, message: 'Items keep their content; only the tag is removed. You can restore it from Trash.' })) { trash(t.id); navigate('tags'); } } },
      ], { align: 'right' })} />
    <//>
    <${CollectionToolbar} typeFilter=${typeFilter} setTypeFilter=${setTypeFilter} />
    <div class="view-body wide">
      <${QuickAdd} defaults=${{ tags: [t.id] }} placeholder=${`Add a task tagged #${t.name}…`} />
      <${Collection} items=${items} groupBy=${S.settings.folderGroup === 'tag' ? 'type' : S.settings.folderGroup} layout=${S.settings.folderLayout} typeFilter=${typeFilter}
        empty=${html`<${Empty} icon="tag" title="Nothing tagged yet" text=${`Type #${t.name} in any quick add.`} />`} />
    </div>
  </div>`;
}

/* ---------------- Trash ---------------- */

export function TrashView() {
  const list = trashed();
  const icon = { task: 'tasks', note: 'notes', event: 'calendar', folder: 'folder', tag: 'tag' };
  return html`<div class="view">
    <${ViewHeader} icon="trash" title="Trash" subtitle="Deleted items stay here for 30 days">
      ${list.length > 0 && html`<${Btn} icon="trash" label="Empty Trash" kind="danger" onClick=${async () => { if (await confirmDialog({ title: 'Empty Trash?', message: `Permanently delete ${list.length} item${list.length > 1 ? 's' : ''}. This can’t be undone.`, confirmLabel: 'Empty Trash' })) emptyTrash(); }} />`}
    <//>
    <div class="view-body narrow">
      ${!list.length && html`<${Empty} icon="trash" title="Trash is empty" text="Deleted tasks, notes, events, folders and tags show up here." />`}
      <div class="tlist">${list.map((it) => html`<div class="trow" key=${it.id}>
        <span class="trow-ic"><${Icon} name=${icon[it.type]} size=${17} /></span>
        <div class="trow-main"><div class="trow-title">${titleOf(it)}</div>
          <div class="trow-meta"><span class="meta">${it.type} · deleted ${D.relDay(D.ds(new Date(it.deletedAt)))}</span></div></div>
        <${Btn} icon="undo" label="Restore" size="sm" onClick=${() => restore(it.id)} />
        <${Btn} icon="x" title="Delete forever" size="sm" onClick=${async () => { if (await confirmDialog({ title: 'Delete forever?', message: `“${titleOf(it)}” will be permanently deleted.` })) purge(it.id); }} />
      </div>`)}</div>
    </div>
  </div>`;
}
