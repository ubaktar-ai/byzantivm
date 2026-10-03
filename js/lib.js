// Shared constants and small helpers used by every screen.

export const STAGES = [
  { id: 'brief', label: 'Brief' },
  { id: 'concept', label: 'Concept' },
  { id: 'design', label: 'Design' },
  { id: 'client_review', label: 'Client review' },
  { id: 'revisions', label: 'Revisions' },
  { id: 'delivered', label: 'Delivered' },
];

export const PRIORITIES = [
  { id: 'urgent', label: 'Urgent', rank: 0 },
  { id: 'high', label: 'High', rank: 1 },
  { id: 'medium', label: 'Medium', rank: 2 },
  { id: 'low', label: 'Low', rank: 3 },
];

export const PROJECT_STATUSES = [
  { id: 'active', label: 'Active' },
  { id: 'on_hold', label: 'On hold' },
  { id: 'completed', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled' },
];

export const CURRENCIES = [
  { id: 'EUR', label: 'Euro (€)' },
  { id: 'USD', label: 'US dollar ($)' },
];

export const label = (list, id) => (list.find(x => x.id === id) || {}).label || id || '';
export const stageIndex = id => STAGES.findIndex(s => s.id === id);
export const priorityRank = id => (PRIORITIES.find(p => p.id === id) || { rank: 9 }).rank;

export const uuid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  }));

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// ---------- Dates (stored as YYYY-MM-DD, compared in local time) ----------

const pad = n => String(n).padStart(2, '0');
export const dateStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayStr = () => dateStr(new Date());

export function parseDate(s) {
  if (!s) return null;
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return dateStr(d);
}

export function daysUntil(s) {
  if (!s) return null;
  return Math.round((parseDate(s) - parseDate(todayStr())) / 86400000);
}

export function fmtDate(s) {
  if (!s) return '';
  const n = daysUntil(s);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  const d = parseDate(s);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

export function timeAgo(iso) {
  const sec = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 7 * 86400) return `${Math.floor(sec / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ---------- Money ----------

const moneyFormats = {};
export function money(amount, currency = 'EUR') {
  const key = currency;
  moneyFormats[key] ||= new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 });
  return moneyFormats[key].format(Number(amount) || 0);
}

// ---------- People ----------

export function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';
}

export const PERSON_COLORS = ['#e11d48', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#2563eb', '#7c3aed', '#c026d3'];

export function avatar(profile, size = 26) {
  if (!profile) return '';
  const name = profile.full_name || profile.email;
  return `<span class="avatar" style="--av:${esc(profile.color || '#64748b')};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px" title="${esc(name)}">${esc(initials(name))}</span>`;
}

// ---------- Icons ----------

export const icon = {
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
  chat: '<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/></svg>',
  mail: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  phone: '<svg viewBox="0 0 24 24"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z"/></svg>',
  globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/></svg>',
  send: '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  upload: '<svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>',
  clip: '<svg viewBox="0 0 24 24"><path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7"/></svg>',
  external: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/></svg>',
  box: '<svg viewBox="0 0 24 24"><path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="m3 8 9 5 9-5M12 13v8"/></svg>',
};

export function fmtSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

// ---------- Toast ----------

let toastTimer;
export function toast(msg, action) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  if (action) el.querySelector('button').onclick = () => { el.classList.remove('show'); action.run(); };
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? 5000 : 2600);
}

// ---------- Sheet (modal dialog) ----------

let sheetCleanup = null;

export function openSheet(html, { onSubmit, onOpen, onClose, wide = false } = {}) {
  const sheet = $('#sheet');
  if (sheet.open) closeSheet();
  sheet.classList.toggle('wide', wide);
  sheet.innerHTML = html;
  const form = sheet.querySelector('form');
  if (form && onSubmit) {
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const btn = form.querySelector('button[type=submit]');
      if (btn) btn.disabled = true;
      try {
        const keepOpen = await onSubmit(new FormData(form), form, e.submitter);
        if (keepOpen !== false) closeSheet();
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }
  sheet.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeSheet));
  sheetCleanup = onClose || null;
  sheet.showModal();
  const first = sheet.querySelector('[autofocus]');
  // Only focus empty fields, so editing doesn't pop up the iPad keyboard.
  if (first && !first.value) first.focus();
  else sheet.querySelector('form, div')?.focus?.();
  onOpen && onOpen(sheet);
  return sheet;
}

export function closeSheet() {
  const sheet = $('#sheet');
  if (sheet.open) sheet.close();
}

export function initSheet() {
  const sheet = $('#sheet');
  sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); });
  sheet.addEventListener('close', () => {
    const fn = sheetCleanup;
    sheetCleanup = null;
    sheet.innerHTML = '';
    fn && fn();
  });
}

export function sheetHeader(title) {
  return `<header><h2>${esc(title)}</h2><button type="button" class="btn ghost icon-btn" data-close aria-label="Close">${icon.close}</button></header>`;
}

export function options(list, selected, { empty } = {}) {
  return (empty !== undefined ? `<option value="">${esc(empty)}</option>` : '') +
    list.map(o => `<option value="${esc(o.id)}" ${String(o.id) === String(selected ?? '') ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
}

export function confirmAction(message) {
  return window.confirm(message);
}
