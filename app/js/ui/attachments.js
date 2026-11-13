import { html, useState, useEffect, fmtBytes, pickFiles, cx, download } from '../lib.js';
import { addAttachments, removeAttachment, getFileRecord, openModal, toast } from '../store.js';
import { Icon } from './icons.js';
import { Btn } from './common.js';

const kindOf = (type = '', name = '') => {
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (type === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
  if (type.startsWith('text/') || /\.(md|txt|csv|json|js|ts|css|html|log)$/i.test(name)) return 'text';
  return 'file';
};

function Preview({ att, close }) {
  const [url, setUrl] = useState(null);
  const [text, setText] = useState(null);
  const [rec, setRec] = useState(null);
  const kind = kindOf(att.type, att.name);
  useEffect(() => {
    let u;
    getFileRecord(att.id).then(async (r) => {
      if (!r) { setUrl(''); return; }
      setRec(r);
      u = URL.createObjectURL(r.blob); setUrl(u);
      if (kind === 'text') setText((await r.blob.text()).slice(0, 200000));
    });
    return () => u && URL.revokeObjectURL(u);
  }, [att.id]);
  return html`<div class="quicklook">
    <div class="ql-h"><${Icon} name="eye" size=${16} /><b class="grow ellipsis">${att.name}</b><span class="muted small">${fmtBytes(att.size)}</span>
      <${Btn} icon="download" title="Download" onClick=${() => rec && download(att.name, rec.blob)} />
      <${Btn} icon="external" title="Open in new tab" onClick=${() => url && window.open(url, '_blank')} />
      <${Btn} icon="x" title="Close" onClick=${close} /></div>
    <div class="ql-body">
      ${url === null ? html`<div class="muted">Loading…</div>`
        : url === '' ? html`<div class="muted">File not found on this device.</div>`
        : kind === 'image' ? html`<img src=${url} alt=${att.name} />`
        : kind === 'video' ? html`<video src=${url} controls autoplay></video>`
        : kind === 'audio' ? html`<audio src=${url} controls autoplay></audio>`
        : kind === 'pdf' ? html`<iframe src=${url} title=${att.name}></iframe>`
        : kind === 'text' ? html`<pre>${text}</pre>`
        : html`<div class="ql-file"><${Icon} name="clip" size=${40} /><p>No preview for this file type.</p><${Btn} kind="primary" icon="download" label="Download" onClick=${() => rec && download(att.name, rec.blob)} /></div>`}
    </div>
  </div>`;
}

export function quickLook(att) {
  openModal((close) => html`<${Preview} att=${att} close=${close} />`, { className: 'modal-ql', width: 960 });
}

function Thumb({ att }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (kindOf(att.type) !== 'image') return;
    let u; getFileRecord(att.id).then((r) => { if (r) { u = URL.createObjectURL(r.blob); setUrl(u); } });
    return () => u && URL.revokeObjectURL(u);
  }, [att.id]);
  if (url) return html`<img class="att-thumb" src=${url} alt="" />`;
  const icon = { video: 'video', audio: 'bell', pdf: 'notes', text: 'text', image: 'image', file: 'clip' }[kindOf(att.type, att.name)];
  return html`<span class="att-thumb icon"><${Icon} name=${icon} size=${18} /></span>`;
}

export function Attachments({ item }) {
  const [over, setOver] = useState(false);
  const list = item.attachments || [];
  const add = async () => { const files = await pickFiles({ multiple: true }); if (files.length) { await addAttachments(item.id, files); toast(`Attached ${files.length} file${files.length > 1 ? 's' : ''}`); } };
  return html`<div class=${cx('atts', over && 'over')}
      onDragOver=${(e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); setOver(true); } }}
      onDragLeave=${() => setOver(false)}
      onDrop=${async (e) => { e.preventDefault(); setOver(false); const f = [...e.dataTransfer.files]; if (f.length) await addAttachments(item.id, f); }}>
    ${list.map((a) => html`<div class="att" key=${a.id}>
      <button type="button" class="att-main" onClick=${() => quickLook(a)} title="Quick Look">
        <${Thumb} att=${a} /><span class="att-n ellipsis">${a.name}</span><span class="muted small">${fmtBytes(a.size)}</span>
      </button>
      <button type="button" class="btn btn-icon btn-sm" title="Remove attachment" onClick=${() => removeAttachment(item.id, a.id)}><${Icon} name="x" size=${14} /></button>
    </div>`)}
    <button type="button" class="att-add" onClick=${add}><${Icon} name="clip" size=${15} /><span>${list.length ? 'Add file' : 'Attach files — drop here or click (up to 100 MB each)'}</span></button>
  </div>`;
}
