// Shared helpers + the tiny UI runtime (Preact + htm, vendored, no build step).
import { h, render, Fragment, createRef } from '../vendor/preact.mjs';
import {
  useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect, useReducer,
} from '../vendor/hooks.mjs';
import htm from '../vendor/htm.mjs';

export const html = htm.bind(h);
export {
  h, render, Fragment, createRef,
  useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect, useReducer,
};

export const APP_VERSION = '1.0.0';

export function uid(prefix = '') {
  const r = (crypto.getRandomValues ? crypto.getRandomValues(new Uint32Array(2)) : [Math.random() * 1e9, Math.random() * 1e9]);
  return prefix + Array.from(r, (n) => n.toString(36)).join('').slice(0, 12);
}

export const cx = (...a) => a.flat().filter(Boolean).join(' ');

export function debounce(fn, ms) {
  let t;
  const d = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  d.flush = (...args) => { clearTimeout(t); fn(...args); };
  d.cancel = () => clearTimeout(t);
  return d;
}

export function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const _tmp = typeof document !== 'undefined' ? document.createElement('div') : null;
export function stripHtml(s = '') {
  if (!s) return '';
  if (!/[<&]/.test(s)) return s;
  _tmp.innerHTML = s.replace(/<br\s*\/?>/gi, ' ');
  return (_tmp.textContent || '').replace(/\s+/g, ' ').trim();
}

export function download(filename, data, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export const readText = (file) => file.text();
export const readBuffer = (file) => file.arrayBuffer();
export function readDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file);
  });
}

/** Opens a native file chooser and resolves with the chosen File[] (empty if cancelled). */
export function pickFiles({ accept = '', multiple = false } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept; input.multiple = multiple;
    input.style.display = 'none';
    input.onchange = () => { resolve([...input.files]); input.remove(); };
    document.body.appendChild(input);
    input.click();
  });
}

const scriptCache = new Map();
export function loadScript(src) {
  if (scriptCache.has(src)) return scriptCache.get(src);
  const p = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.async = true; s.crossOrigin = 'anonymous';
    s.onload = () => res(); s.onerror = () => { scriptCache.delete(src); rej(new Error('Could not load ' + src)); };
    document.head.appendChild(s);
  });
  scriptCache.set(src, p);
  return p;
}

export function fmtBytes(n = 0) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/** Simple fuzzy score: higher is better, -1 means no match. */
export function fuzzy(query, text) {
  if (!query) return 0;
  const q = query.toLowerCase().trim();
  const t = (text || '').toLowerCase();
  if (!q) return 0;
  const idx = t.indexOf(q);
  if (idx === 0) return 1000 - t.length;
  if (idx > 0) {
    const wordStart = /[\s\-_/(]/.test(t[idx - 1]);
    return (wordStart ? 800 : 600) - idx - t.length * 0.1;
  }
  // subsequence
  let ti = 0, score = 0, streak = 0;
  for (const ch of q) {
    if (ch === ' ') continue;
    const found = t.indexOf(ch, ti);
    if (found < 0) return -1;
    streak = found === ti ? streak + 1 : 0;
    score += 10 + streak * 5 - (found - ti);
    ti = found + 1;
  }
  return Math.max(1, score);
}

export function isEditableTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function deepClone(o) {
  return typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o));
}

/** Parse a CSV string into rows (handles quotes, escaped quotes, CRLF). */
export function parseCSV(text) {
  const rows = [];
  let row = [], field = '', i = 0, q = false;
  text = text.replace(/^﻿/, '');
  while (i < text.length) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        q = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { q = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

export function toCSV(rows) {
  return rows.map((r) => r.map((v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\n');
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');
