// Files & photos: upload (with photo downscaling), thumbnails, viewer, delete.
import { esc, icon, uuid, toast, openSheet, closeSheet, sheetHeader, fmtSize, timeAgo, avatar, $ } from './lib.js';
import { store } from './store.js';

const MAX_BYTES = 50 * 1024 * 1024; // Supabase free plan limit per file
const MAX_SIDE = 2400;              // photos are scaled down to this many pixels on the long side

export const isImage = a => /^image\/(jpeg|png|webp|gif|heic|heif)$/.test(a.mime || '');

// ---------- Temporary links (cached until shortly before they expire) ----------

const urlCache = new Map(); // path -> { url, until }

export async function fileUrls(paths) {
  const now = Date.now();
  const missing = paths.filter(p => !(urlCache.get(p)?.until > now));
  if (missing.length) {
    const urls = await store.backend.signedUrls(missing);
    Object.entries(urls).forEach(([p, url]) => urlCache.set(p, { url, until: now + 50 * 60 * 1000 }));
  }
  const out = {};
  paths.forEach(p => { if (urlCache.has(p)) out[p] = urlCache.get(p).url; });
  return out;
}

// Any <img data-path> without a src gets its image loaded automatically.
let hydrating = false;
async function hydrateThumbs() {
  if (hydrating) return;
  hydrating = true;
  try {
    const imgs = [...document.querySelectorAll('img[data-path]:not([src])')];
    if (!imgs.length) return;
    const urls = await fileUrls([...new Set(imgs.map(i => i.dataset.path))]);
    imgs.forEach(img => { if (urls[img.dataset.path]) img.src = urls[img.dataset.path]; });
  } catch (err) {
    console.warn('Could not load thumbnails', err);
  } finally {
    hydrating = false;
  }
}

// ---------- Preparing & uploading ----------

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Unreadable image')); };
    img.src = url;
  });
}

function niceName(file) {
  // iPad camera photos all arrive as "image.jpg"; give them a readable name.
  if (/^image\.(jpe?g|png|heic)$/i.test(file.name)) {
    const d = new Date();
    return `Photo ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toTimeString().slice(0, 5).replace(':', '.')}.jpg`;
  }
  return file.name || 'file';
}

async function prepareFile(file) {
  const original = { blob: file, name: niceName(file), mime: file.type || 'application/octet-stream' };
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type)) return original;
  try {
    const img = await loadImage(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    if (scale === 1 && file.size < 1.5 * 1024 * 1024 && /jpeg|png|webp/.test(file.type)) return original;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const keepPng = file.type === 'image/png';
    const mime = keepPng ? 'image/png' : 'image/jpeg';
    const blob = await new Promise(r => canvas.toBlob(r, mime, 0.85));
    if (!blob || blob.size >= file.size) return original;
    return { blob, mime, name: keepPng ? original.name : original.name.replace(/\.(heic|heif|png|webp|jpe?g)$/i, '') + '.jpg' };
  } catch (e) {
    return original;
  }
}

const safe = name => name.normalize('NFKD').replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_').slice(-80) || 'file';

export async function uploadFiles(fileList, target) {
  const files = [...fileList];
  if (!files.length) return [];
  const tooBig = files.filter(f => f.size > MAX_BYTES);
  if (tooBig.length) toast(`${tooBig.map(f => f.name).join(', ')} is over 50 MB and was skipped`);
  const todo = files.filter(f => f.size <= MAX_BYTES);
  if (!todo.length) return [];
  toast(todo.length === 1 ? 'Uploading…' : `Uploading ${todo.length} files…`);
  const saved = [];
  for (const file of todo) {
    const prepared = await prepareFile(file);
    const path = `${target.project_id}/${uuid()}-${safe(prepared.name)}`;
    try {
      await store.backend.uploadFile(path, prepared.blob, prepared.mime);
    } catch (err) {
      console.error(err);
      toast(`Upload failed: ${err.message || err}`);
      continue;
    }
    try {
      saved.push(await store.insert('attachments', {
        project_id: target.project_id,
        task_id: target.task_id || null,
        round_id: target.round_id || null,
        path, name: prepared.name, mime: prepared.mime, size: prepared.blob.size,
        created_by: store.user.id,
      }));
    } catch (err) {
      store.backend.removeFiles([path]).catch(() => {});
    }
  }
  if (saved.length) toast(saved.length === 1 ? 'File uploaded' : `${saved.length} files uploaded`);
  return saved;
}

export async function deleteAttachment(att) {
  if (!confirm(`Delete “${att.name}”? This can't be undone.`)) return false;
  try {
    await store.remove('attachments', att.id);
    await store.backend.removeFiles([att.path]);
    urlCache.delete(att.path);
    toast('File deleted');
    return true;
  } catch (err) {
    return false;
  }
}

// Remove the stored files of a project before the project itself is deleted.
export async function removeProjectFiles(projectId) {
  const paths = store.all('attachments').filter(a => a.project_id === projectId).map(a => a.path);
  if (paths.length) await store.backend.removeFiles(paths).catch(() => {});
}

// ---------- HTML pieces ----------

function ext(name) {
  const m = /\.([a-z0-9]{1,5})$/i.exec(name || '');
  return m ? m[1].toUpperCase() : 'FILE';
}

export function fileContext(att) {
  if (att.round_id) {
    const r = store.get('feedback_rounds', att.round_id);
    const d = r && store.get('deliverables', r.deliverable_id);
    return d ? `${d.name} · Round ${r.round_no}` : 'Feedback round';
  }
  if (att.task_id) {
    const t = store.get('tasks', att.task_id);
    return t ? `Task: ${t.title}` : 'Task';
  }
  return 'Project file';
}

export function fileTile(att, { context = false } = {}) {
  const who = store.get('profiles', att.created_by);
  return `
    <button type="button" class="file-tile" data-action="open-file" data-id="${att.id}" title="${esc(att.name)}">
      <span class="file-thumb">
        ${isImage(att) ? `<img data-path="${esc(att.path)}" alt="" loading="lazy">` : `<span class="file-ext">${esc(ext(att.name))}</span>`}
      </span>
      <span class="file-name">${esc(att.name)}</span>
      <span class="file-meta">${context ? `${esc(fileContext(att))} · ` : ''}${esc(fmtSize(att.size))}${who ? ` · ${esc((who.full_name || who.email).split(' ')[0])}` : ''}</span>
    </button>`;
}

export function uploadButton(target, { label = 'Add files', primary = false } = {}) {
  return `
    <label class="btn ${primary ? 'primary' : ''} upload-btn">
      ${icon.upload}<span>${esc(label)}</span>
      <input type="file" multiple hidden
        data-upload-project="${esc(target.project_id)}"
        ${target.task_id ? `data-upload-task="${esc(target.task_id)}"` : ''}
        ${target.round_id ? `data-upload-round="${esc(target.round_id)}"` : ''}>
    </label>`;
}

export function fileStrip(atts, target, { emptyText = '' } = {}) {
  return `
    <div class="file-strip">
      ${atts.map(a => fileTile(a)).join('')}
      ${target ? uploadButton(target) : ''}
    </div>
    ${!atts.length && emptyText ? `<div class="muted small">${esc(emptyText)}</div>` : ''}`;
}

// ---------- Viewer ----------

export async function openFileSheet(att) {
  let url = '';
  try {
    url = (await fileUrls([att.path]))[att.path] || '';
  } catch (err) {
    toast('Could not open the file — check your connection');
    return;
  }
  const who = store.get('profiles', att.created_by);
  const target = att.task_id ? `#/project/${att.project_id}/tasks` : att.round_id ? `#/project/${att.project_id}/deliverables` : '';
  openSheet(`
    <div class="file-viewer" tabindex="-1">
      ${sheetHeader(att.name)}
      <div class="viewer-body">
        ${isImage(att) && url
          ? `<img src="${esc(url)}" alt="${esc(att.name)}">`
          : `<div class="viewer-placeholder"><span class="file-ext big">${esc(ext(att.name))}</span><span class="muted">${esc(fmtSize(att.size))}</span></div>`}
      </div>
      <div class="viewer-info">
        <span>${who ? avatar(who, 24) : ''} ${esc(who ? who.full_name || who.email : '')} · ${esc(timeAgo(att.created_at))} · ${esc(fmtSize(att.size))}</span>
        <span class="muted">${target ? `<a href="${target}" data-close>${esc(fileContext(att))}</a>` : esc(fileContext(att))}</span>
      </div>
      <footer>
        <button type="button" class="btn danger" data-delete-file>Delete</button>
        <span class="spacer"></span>
        ${url ? `<a class="btn primary" href="${esc(url)}" target="_blank" rel="noopener">${icon.external} Open</a>` : ''}
      </footer>
    </div>`, {
    wide: isImage(att),
    onOpen(sheet) {
      $('[data-delete-file]', sheet).addEventListener('click', async () => {
        closeSheet();
        await deleteAttachment(att);
      });
    },
  });
}

// ---------- Wiring ----------

export function initFiles() {
  // Upload buttons anywhere (screens and sheets).
  document.addEventListener('change', async e => {
    const input = e.target;
    if (!input.matches('input[type=file][data-upload-project]') || !input.files.length) return;
    const target = {
      project_id: input.dataset.uploadProject,
      task_id: input.dataset.uploadTask || null,
      round_id: input.dataset.uploadRound || null,
    };
    const files = [...input.files];
    input.value = '';
    const label = input.closest('.upload-btn');
    label && label.classList.add('busy');
    try { await uploadFiles(files, target); } finally { label && label.classList.remove('busy'); }
  });

  // Tapping a file tile inside a sheet (the screen-level handler only covers the main view).
  $('#sheet').addEventListener('click', e => {
    const b = e.target.closest('[data-action=open-file]');
    if (!b) return;
    const att = store.get('attachments', b.dataset.id);
    if (att) openFileSheet(att);
  });

  // Load thumbnails whenever new ones appear on screen.
  let timer;
  new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(hydrateThumbs, 30); })
    .observe(document.body, { childList: true, subtree: true });
}

