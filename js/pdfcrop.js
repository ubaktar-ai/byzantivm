// Cut a card's picture out of a client PDF (drawings, design studies). A card can point at an area of an
// uploaded PDF in spec._crop = { attachment_id, page, box: [x0, y0, x1, y1] } (fractions of the page);
// (a photo works too) — this renders just that area with pdf.js and saves it as the card's "received from client" picture.
import { store, productsOf } from './store.js';
import { fileUrls, uploadFiles } from './files.js';
import { toast } from './lib.js';

const TARGET = 1400; // pixels across the cut-out picture
let lib = null;

export async function pdfjs() {
  if (!lib) {
    lib = await import('../vendor/pdfjs/pdf.min.mjs');
    lib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  }
  return lib;
}

const validBox = b => Array.isArray(b) && b.length === 4 && b.every(n => typeof n === 'number' && n >= 0 && n <= 1) && b[2] > b[0] && b[3] > b[1];
export const needsCut = it => {
  const c = ((it && it.spec) || {})._crop;
  return !!(c && c.attachment_id && !c.done_at && validBox(c.box) && store.get('attachments', c.attachment_id));
};
export const cutsWaiting = projectId => productsOf(projectId).filter(needsCut);

// A photo behaves like a one-page document.
async function imageDoc(url) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = url; });
  return { image: img, numPages: 1, destroy() {} };
}

// Render one area of one page to a JPEG file.
async function renderArea(doc, pageNo, box, name) {
  if (doc.image) {
    const img = doc.image;
    const sw = (box[2] - box[0]) * img.naturalWidth, sh = (box[3] - box[1]) * img.naturalHeight;
    const s = Math.min(1, TARGET / Math.max(sw, sh));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(sw * s)); c.height = Math.max(1, Math.round(sh * s));
    c.getContext('2d').drawImage(img, box[0] * img.naturalWidth, box[1] * img.naturalHeight, sw, sh, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.88));
    c.width = c.height = 0;
    if (!blob) throw new Error('The picture could not be made');
    return new File([blob], name, { type: 'image/jpeg' });
  }
  const page = await doc.getPage(Math.min(Math.max(1, pageNo), doc.numPages));
  const base = page.getViewport({ scale: 1 });
  const w = (box[2] - box[0]) * base.width;
  const h = (box[3] - box[1]) * base.height;
  // Big enough to be sharp, small enough for an iPad canvas.
  const scale = Math.max(0.5, Math.min(TARGET / Math.max(w, h), 8));
  const vp = page.getViewport({ scale, offsetX: -box[0] * base.width * scale, offsetY: -box[1] * base.height * scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  page.cleanup();
  const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.88));
  canvas.width = canvas.height = 0; // free the memory at once (iPad)
  if (!blob) throw new Error('The picture could not be made');
  return new File([blob], name, { type: 'image/jpeg' });
}

// Cut the pictures for every card of the order that is waiting for one. Returns how many were made.
export async function cutPictures(projectId, { onProgress } = {}) {
  const todo = cutsWaiting(projectId);
  if (!todo.length) return 0;
  const byFile = new Map();
  todo.forEach(it => { const id = it.spec._crop.attachment_id; byFile.set(id, [...(byFile.get(id) || []), it]); });
  let done = 0;
  for (const [attId, items] of byFile) {
    const att = store.get('attachments', attId);
    const url = (await fileUrls([att.path]))[att.path];
    if (!url) { toast(`Couldn't open ${att.name}`); continue; }
    const doc = /^image\//.test(att.mime || '') ? await imageDoc(url) : await (await pdfjs()).getDocument({ url, disableAutoFetch: true }).promise;
    try {
      for (const it of items) {
        const c = it.spec._crop;
        try {
          const file = await renderArea(doc, c.page, c.box, `${it.item_no || 'card'}-${it.name}`.replace(/[^\w.-]+/g, '-').slice(0, 60) + '.jpg');
          const [saved] = await uploadFiles([file], { project_id: projectId, item_id: it.id, kind: 'qc', quiet: true });
          if (!saved) continue;
          const now = store.get('items', it.id) || it;
          const spec = { ...(now.spec || {}) };
          const images = { ...(spec._images || {}) };
          images.vision = [...new Set([...(images.vision || []), saved.id])];
          spec._images = images;
          spec._crop = { ...c, done_at: new Date().toISOString(), image: saved.id };
          await store.update('items', it.id, { spec });
          done++;
          if (onProgress) onProgress(done, todo.length);
        } catch (err) {
          console.error(err);
        }
      }
    } finally {
      doc.destroy();
    }
  }
  return done;
}
