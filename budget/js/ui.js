/* ui.js — tiny DOM helpers: escaping, icons, sheets, toasts, confirms. */
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const attr = esc;

const P = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevR: '<path d="m9 6 6 6-6 6"/>',
  chevL: '<path d="m15 6-6 6 6 6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  sync: '<path d="M21 12a9 9 0 0 1-15.5 6.3L3 16M3 12a9 9 0 0 1 15.5-6.3L21 8M21 3v5h-5M3 21v-5h5"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  download: '<path d="M12 3v12m0 0-4-4m4 4 4-4M4 21h16"/>',
};
export const icon = (name, cls = '') =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;

/* ---------- sheets ---------- */
const stack = [];
export function openSheet(html, { onMount, onClose, id } = {}) {
  const root = document.getElementById('sheet-root');
  const back = document.createElement('div');
  back.className = 'sheet-backdrop';
  const sh = document.createElement('div');
  sh.className = 'sheet';
  sh.setAttribute('role', 'dialog');
  sh.setAttribute('aria-modal', 'true');
  if (id) sh.dataset.sheet = id;
  sh.innerHTML = `<div class="grab"></div>${html}`;
  root.append(back, sh);
  const entry = { back, sh, onClose };
  stack.push(entry);
  back.addEventListener('click', () => closeSheet());
  document.body.style.overflow = 'hidden';
  if (onMount) onMount(sh);
  requestAnimationFrame(() => { back.classList.add('in'); sh.classList.add('in'); });
  return sh;
}
export function closeSheet() {
  const e = stack.pop();
  if (!e) return;
  e.back.classList.remove('in'); e.sh.classList.remove('in');
  setTimeout(() => { e.back.remove(); e.sh.remove(); }, 260);
  if (!stack.length) document.body.style.overflow = '';
  e.onClose?.();
}
export const closeAllSheets = () => { while (stack.length) closeSheet(); };
export const topSheet = () => stack[stack.length - 1]?.sh || null;

export function sheetHeader(title, extra = '') {
  return `<div class="sheet-h"><h2>${esc(title)}</h2><div style="display:flex;gap:8px">${extra}<button type="button" class="icon-btn" data-act="closeSheet" aria-label="Close">${icon('x')}</button></div></div>`;
}

/* ---------- toast ---------- */
let toastTimer;
export function toast(msg, { action, onAction, ms = 2600 } = {}) {
  const root = document.getElementById('toast-root');
  root.innerHTML = `<div class="toast-wrap"><div class="toast">${esc(msg)}${action ? `<button type="button">${esc(action)}</button>` : ''}</div></div>`;
  const t = root.querySelector('.toast');
  if (action) t.querySelector('button').onclick = () => { onAction?.(); root.innerHTML = ''; };
  requestAnimationFrame(() => t.classList.add('in'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove('in'); setTimeout(() => { if (root.contains(t)) root.innerHTML = ''; }, 250); }, ms);
}

/* ---------- confirm ---------- */
export function confirmSheet({ title, body, ok = 'Confirm', danger = false }) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    openSheet(`${sheetHeader(title)}<p class="muted" style="margin:0 0 18px;line-height:1.5">${body}</p>
      <div class="btn-row"><button type="button" class="btn" data-c="0">Cancel</button><button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-c="1">${esc(ok)}</button></div>`, {
      onMount: sh => sh.querySelectorAll('[data-c]').forEach(b => b.addEventListener('click', () => { finish(b.dataset.c === '1'); closeSheet(); })),
      onClose: () => finish(false),
    });
  });
}

/** Download or share a file (iOS standalone apps prefer the share sheet). */
export async function saveFile(name, text, type = 'text/plain') {
  const blob = new Blob([text], { type });
  try {
    const file = new File([blob], name, { type });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && /iPhone|iPad|iPod/.test(navigator.userAgent)) {
      await navigator.share({ files: [file], title: name });
      return;
    }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
