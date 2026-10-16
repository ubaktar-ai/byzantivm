// "Read schedule & drawings": the client's project documents → product cards with pictures.
//  1. In the browser: each PDF page gives its text (for schedules) and a picture (for drawings); Excel and CSV
//     files give their rows. Big drawing sets are fine — pages are handled one by one.
//  2. The "drawing-reader" Edge Function (Claude) picks the schedule rows meant for us, then looks at the
//     drawings a few pages at a time and says where each of our marked lights is drawn.
//  3. A check screen shows every card found with its cut-out picture; nothing is saved before that.
//  4. Saving makes the cards; each remembers its picture's place (file, page, area) and the picture is cut
//     from the original PDF at full sharpness (pdfcrop.js).
import { esc, toast, openSheet, closeSheet, sheetHeader, $ } from './lib.js';
import { store, productsOf, nextSortOrder } from './store.js';
import { fileUrls, uploadFiles } from './files.js';
import { pdfjs, cutPictures } from './pdfcrop.js';

const SIDE = 1568;          // page pictures for the AI (long side, px)
const SCHEDULE_CHARS = 1200; // a page with this much text is a schedule / table, not a drawing
const PER_CALL = 3;
const PARALLEL = 2;

const isPdf = a => a.mime === 'application/pdf' || /\.pdf$/i.test(a.name || '');
const isXlsx = a => /spreadsheetml/.test(a.mime || '') || /\.xlsx$/i.test(a.name || '');
const isCsv = a => /text\/csv/.test(a.mime || '') || /\.csv$/i.test(a.name || '');
const isPic = a => /^image\/(jpeg|png|webp)$/.test(a.mime || '');
export const readable = a => a && a.kind !== 'qc' && (isPdf(a) || isXlsx(a) || isCsv(a) || isPic(a));
const docsOf = pid => store.all('attachments').filter(a => a.project_id === pid && readable(a))
  .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));

// Links the app can't open without the client's login.
export const needsLogin = url => /sharepoint\.com|onedrive\.live\.com|1drv\.ms|dropbox\.com\/(?!s\/|scl\/)|drive\.google\.com|box\.com/i.test(url || '');
export const LOGIN_WARNING = 'This link needs a sign-in (SharePoint, OneDrive, Google Drive…), so the AI can’t open it. Open it yourself, choose Download, and add the file here instead.';

let ticket = 0;

export function openReader(projectId) {
  const p = store.get('projects', projectId);
  if (!p) return;
  const docs = docsOf(projectId);
  const company = (store.get('companies', p.company_id) || {}).name || 'Byzantivm';
  openSheet(`
    <form class="reader-form">
      ${sheetHeader('Read schedule & drawings')}
      <div class="fields">
        <p class="muted small">For projects with a luminaire schedule and drawing sets: the AI finds the lights marked for ${esc(company)}, makes a card for each with its details, and cuts its picture out of the drawings. You check everything before it's saved.</p>
        ${docs.length ? `<div class="reader-files">${docs.map(a => `
          <label class="check-row"><input type="checkbox" name="doc" value="${a.id}" checked>
            <span>${esc(a.name)} <span class="muted small">${a.size ? `${Math.max(1, Math.round(a.size / 1048576))} MB` : ''}</span></span></label>`).join('')}</div>`
          : '<p class="small">No PDFs or Excel files on this order yet — add them below.</p>'}
        <label class="btn upload-btn"><span>Add files (PDF, Excel, photos)</span><input type="file" hidden multiple accept="application/pdf,.xlsx,.csv,image/*" data-reader-add></label>
        <label class="field"><span>Link (optional)</span><input name="link" placeholder="Paste a link to check it" autocomplete="off"></label>
        <p class="ai-problem" data-link-warning hidden>${esc(LOGIN_WARNING)}</p>
        <label class="field"><span>How our lights are marked on the drawings</span><input name="mark" value="B" style="max-width:140px"></label>
        <p class="muted small">Big drawing sets take a few minutes: every page is looked at.</p>
      </div>
      <footer><span class="spacer"></span>
        <button type="button" class="btn" data-close>Cancel</button>
        <button type="submit" class="btn primary" ${docs.length ? '' : 'disabled'}>Read</button></footer>
    </form>`, {
    onOpen(sheet) {
      $('[data-reader-add]', sheet).addEventListener('change', async e => {
        const files = [...e.target.files];
        if (!files.length) return;
        await uploadFiles(files, { project_id: projectId, kind: 'inquiry' });
        openReader(projectId);
      });
      $('[name=link]', sheet).addEventListener('input', e => { $('[data-link-warning]', sheet).hidden = !needsLogin(e.target.value); });
    },
    onSubmit(fd) {
      const ids = fd.getAll('doc');
      if (!ids.length) { toast('Tick at least one file'); return false; }
      setTimeout(() => run(projectId, ids.map(id => store.get('attachments', id)).filter(Boolean), String(fd.get('mark') || 'B').trim() || 'B', company), 30);
    },
  });
}

// ---------- 1. Pages, text and rows ----------

function lineText(items) {
  // Rebuild lines from pdf.js text pieces; a wide gap becomes " | " (a table cell).
  const rows = new Map();
  items.forEach(it => {
    if (!it.str || !it.str.trim()) return;
    const y = Math.round(it.transform[5] / 3);
    rows.set(y, [...(rows.get(y) || []), it]);
  });
  return [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, row]) => {
    row.sort((a, b) => a.transform[4] - b.transform[4]);
    let out = '';
    let end = null;
    row.forEach(it => {
      const x = it.transform[4];
      if (end != null) out += x - end > Math.max(6, (it.height || 8) * 0.9) ? ' | ' : (out.endsWith(' ') || it.str.startsWith(' ') ? '' : ' ');
      out += it.str.trim();
      end = x + (it.width || 0);
    });
    return out;
  }).join('\n');
}

const toB64 = async blob => {
  const u = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
};

// Draw at most SIDE px on the long side and return a JPEG.
async function canvasBlob(w, h, draw) {
  const scale = Math.min(1, SIDE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await draw(ctx, scale);
  const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.82));
  canvas.width = canvas.height = 0; // free the memory at once (iPad)
  return blob;
}

async function extract(atts, progress) {
  const texts = [];
  const pages = [];
  const schedulePages = [];
  const { getDocument } = await pdfjs();
  for (const att of atts) {
    const url = (await fileUrls([att.path]))[att.path];
    if (!url) continue;
    if (isPdf(att)) {
      const doc = await getDocument({ url, disableAutoFetch: true }).promise;
      try {
        for (let n = 1; n <= doc.numPages; n++) {
          progress(`Reading ${att.name}: page ${n} of ${doc.numPages}`);
          const page = await doc.getPage(n);
          const t = lineText((await page.getTextContent()).items);
          if (t.replace(/\s/g, '').length >= 80) texts.push(`== ${att.name}, page ${n} ==\n${t}`);
          // Drawings go to the mark search; schedule pages (lots of text) go along with the schedule text.
          const isTable = t.length >= SCHEDULE_CHARS;
          if (!isTable || schedulePages.length < 8) {
            const vp1 = page.getViewport({ scale: 1 });
            const blob = await canvasBlob(vp1.width * 4, vp1.height * 4, (ctx, scale) =>
              page.render({ canvasContext: ctx, viewport: page.getViewport({ scale: 4 * scale }) }).promise);
            (isTable ? schedulePages : pages).push({ att, page: n, blob, label: `${att.name}, page ${n}` });
          }
          page.cleanup();
        }
      } finally { doc.destroy(); }
    } else if (isXlsx(att)) {
      progress(`Reading ${att.name}`);
      const { readXlsx } = await import('./xlsx-lite.js');
      const blob = await (await fetch(url)).blob();
      (await readXlsx(blob)).forEach(sh => texts.push(`== ${att.name}, sheet "${sh.name}" ==\n${sh.rows.map(r => r.join(' | ')).join('\n')}`));
    } else if (isCsv(att)) {
      texts.push(`== ${att.name} ==\n${(await (await fetch(url)).text()).replace(/[,;\t]/g, ' | ')}`);
    } else if (isPic(att)) {
      progress(`Reading ${att.name}`);
      const img = await new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const blob = await canvasBlob(img.naturalWidth, img.naturalHeight, (ctx, scale) => ctx.drawImage(img, 0, 0, img.naturalWidth * scale, img.naturalHeight * scale));
      pages.push({ att, page: 1, blob, label: att.name });
    }
  }
  return { texts, pages, schedulePages };
}

// ---------- 2. The AI ----------

// "The AI is busy" (rate limit) or a timeout: wait and try again, a few times, before giving up.
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function retry(fn, onWait) {
  const waits = [8000, 20000, 45000];
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (err) {
      if (err.demo || err.notSetUp || ![429, 502, 503, 504].includes(err.status) || i >= waits.length) throw err;
      if (onWait) onWait(waits[i]);
      await sleep(waits[i]);
    }
  }
}

async function pool(jobs, n, fn) {
  const out = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => {
    while (next < jobs.length) { const i = next++; out[i] = await fn(jobs[i], i); }
  }));
  return out;
}

const clamp = v => Math.min(1, Math.max(0, v));
function toBox(b) {
  if (!Array.isArray(b) || b.length !== 4) return null;
  let [x0, y0, x1, y1] = b.map(v => clamp(Number(v) / 1000));
  if (x1 < x0) [x0, x1] = [x1, x0];
  if (y1 < y0) [y0, y1] = [y1, y0];
  if (x1 - x0 < 0.01 || y1 - y0 < 0.01) return null;
  const mx = (x1 - x0) * 0.06, my = (y1 - y0) * 0.06; // a little air around the light
  return [clamp(x0 - mx), clamp(y0 - my), clamp(x1 + mx), clamp(y1 + my)];
}

async function run(projectId, atts, mark, company) {
  const mine = ++ticket;
  let cancelled = false;
  openSheet(`
    <div>
      ${sheetHeader('Reading the documents…')}
      <div class="ai-wait"><div class="spinner"></div>
        <p data-reader-progress>Opening the files…</p>
        <p class="muted small">Big drawing sets take a few minutes. Keep this screen open.</p></div>
      <footer><span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button></footer>
    </div>`, { onClose() { cancelled = true; } });
  const progress = msg => { if (mine === ticket && !cancelled) { const el = document.querySelector('[data-reader-progress]'); if (el) el.textContent = msg; } };
  const stop = () => cancelled || mine !== ticket;
  try {
    const { texts, pages, schedulePages } = await extract(atts, progress);
    if (stop()) return;
    let items = [];
    if (texts.length) {
      progress('Finding the lights in the schedule…');
      const pics = await Promise.all(schedulePages.map(async pg => ({ label: pg.label, mime: 'image/jpeg', data: await toB64(pg.blob) })));
      const r = await retry(() => store.backend.readDrawings({ mode: 'schedule', company, text: texts.join('\n\n').slice(0, 120000), pages: pics }),
        ms => progress(`The AI is busy — trying again in ${Math.round(ms / 1000)} s…`));
      items = ((r && r.result && r.result.items) || []).filter(it => it && (it.code || it.name));
      const hint = r && r.result && String(r.result.mark_hint || '').trim();
      if (hint && mark === 'B' && !/\bB\b/.test(hint)) mark = hint; // the documents say how they mark our lights
    }
    if (stop()) return;
    const batches = [];
    for (let i = 0; i < pages.length; i += PER_CALL) batches.push(pages.slice(i, i + PER_CALL));
    let looked = 0;
    const skipped = [];
    const brief = items.map(it => ({ code: it.code, name: it.name, description: it.description, location: it.location, notes: (it.notes || '').slice(0, 200) }));
    const found = (await pool(batches, PARALLEL, async batch => {
      if (stop()) return [];
      const body = { mode: 'marks', company, mark, items: brief, pages: await Promise.all(batch.map(async pg => ({ label: pg.label, mime: 'image/jpeg', data: await toB64(pg.blob) }))) };
      let lights = [];
      try {
        const r = await retry(() => store.backend.readDrawings(body));
        lights = ((r && r.result && r.result.lights) || []).map(l => ({ ...l, at: batch[(Number(l.page) || 1) - 1] })).filter(l => l.at && toBox(l.box));
      } catch (err) {
        if (err.demo || err.notSetUp) throw err;
        console.error(err); // one batch failing shouldn't lose the rest — but say which pages were skipped
        skipped.push(...batch.map(pg => pg.label));
      }
      looked += batch.length;
      progress(`Looking at the drawings: ${looked} of ${pages.length} pages`);
      return lights;
    })).flat();
    if (stop()) return;
    review(projectId, merge(items, found, projectId), { pages: pages.length, files: atts.length, skipped });
  } catch (err) {
    if (stop()) return;
    console.error(err);
    const msg = err.demo ? 'Reading documents with AI works with the team database, not in demo mode.'
      : err.notSetUp ? 'The “drawing-reader” function isn’t set up in Supabase yet.'
      : `The documents couldn’t be read: ${err.message || err}`;
    openSheet(`<div>${sheetHeader('Read schedule & drawings')}<p class="ai-problem">${esc(msg)}</p>
      <footer><span class="spacer"></span><button type="button" class="btn primary" data-close>OK</button></footer></div>`);
  }
}

// ---------- 3. Cards from rows + marks ----------

const RANK = { high: 3, medium: 2, low: 1 };
const area = l => { const b = toBox(l.box); return b ? (b[2] - b[0]) * (b[3] - b[1]) : 0; };
const best = marks => [...marks].sort((a, b) => (b.marked - a.marked) || (RANK[b.confidence] || 0) - (RANK[a.confidence] || 0) || area(b) - area(a))[0];

function merge(items, lights, projectId) {
  const existing = new Set(productsOf(projectId).map(i => (i.item_no || '').toUpperCase()).filter(Boolean));
  const codes = new Set(items.map(it => (it.code || '').toUpperCase()).filter(Boolean));
  const cards = items.map(it => {
    const marks = lights.filter(l => l.code && l.code.toUpperCase() === (it.code || '').toUpperCase());
    const pick = marks.length ? best(marks) : null;
    return { ...it, use: !existing.has((it.code || '').toUpperCase()), already: existing.has((it.code || '').toUpperCase()),
      quantity: Number(it.quantity) || 0, pic: pick ? { at: pick.at, box: toBox(pick.box) } : null, marks: marks.length };
  });
  // Marked lights that match no schedule row, and featured lights without marks (suggestions).
  const extra = lights.filter(l => !l.code || !codes.has(l.code.toUpperCase()));
  const seen = new Set();
  extra.forEach(l => {
    const key = `${l.marked}|${(l.description || '').toLowerCase().slice(0, 40)}`;
    if (seen.has(key)) return;
    seen.add(key);
    cards.push({ code: '', name: (l.description || 'Light').split(/[,.;—]/)[0].slice(0, 60), description: l.description || '', location: '', mounting: '',
      quantity: 0, size: '', finish: '', cct: '', voltage: '', dimming: '', notes: l.marked ? 'Marked on the drawings but not on the schedule.' : 'Not marked — shown in the drawings; check if it is ours.',
      source: l.at.label, use: !!l.marked, suggestion: !l.marked, pic: { at: l.at, box: toBox(l.box) }, marks: 1 });
  });
  return cards;
}

// ---------- 4. Check screen ----------

const thumbs = new Map(); // page blob → object URL
const pageUrl = pg => { if (!thumbs.has(pg.blob)) thumbs.set(pg.blob, URL.createObjectURL(pg.blob)); return thumbs.get(pg.blob); };

async function cropPreview(pic) {
  if (!pic) return '';
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = pageUrl(pic.at); });
  const [x0, y0, x1, y1] = pic.box;
  const sw = (x1 - x0) * img.naturalWidth, sh = (y1 - y0) * img.naturalHeight;
  const s = Math.min(1, 360 / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * s)); c.height = Math.max(1, Math.round(sh * s));
  c.getContext('2d').drawImage(img, x0 * img.naturalWidth, y0 * img.naturalHeight, sw, sh, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}

function review(projectId, cards, stats) {
  const ours = cards.filter(c => !c.suggestion);
  const withPic = ours.filter(c => c.pic).length;
  openSheet(`
    <form class="reader-review">
      ${sheetHeader(`Found ${ours.length} light${ours.length === 1 ? '' : 's'}`)}
      <div class="fields">
        <p class="small">${stats.files} file${stats.files === 1 ? '' : 's'}, ${stats.pages} drawing page${stats.pages === 1 ? '' : 's'} looked at · ${withPic} with a picture.
          ${stats.skipped.length ? `</p><p class="ai-problem">${stats.skipped.length} page${stats.skipped.length === 1 ? '' : 's'} couldn't be looked at (the AI was busy): ${esc(stats.skipped.join('; '))}. Cancel and read again in a few minutes to include them.</p><p class="small">` : ''}
          Untick what isn't ours, fix names and quantities. <b>Bigger</b> widens a picture; <b>Whole page</b> uses the full page.</p>
        <label class="check-row"><input type="checkbox" name="originals" checked>
          <span>Then look up each light's <b>original online</b> (brand, model, specs, retail price, pictures) — about a minute per light, three at a time</span></label>
        ${cards.length ? cards.map((c, i) => `
          <div class="read-row ${c.suggestion ? 'suggestion' : ''}" data-row="${i}">
            <label class="read-use"><input type="checkbox" name="use_${i}" ${c.use ? 'checked' : ''}></label>
            <div class="read-pic">${c.pic ? `<img data-pic="${i}" alt="">` : '<span class="muted small">No picture found</span>'}</div>
            <div class="read-text">
              <div class="read-line">${c.code ? `<b>${esc(c.code)}</b>` : ''}<input name="name_${i}" value="${esc(c.name || '')}" aria-label="Name">
                <input name="qty_${i}" value="${c.quantity ? esc(String(c.quantity)) : ''}" placeholder="Qty" inputmode="decimal" style="width:64px" aria-label="Quantity"></div>
              <span class="muted small">${esc([c.location, c.mounting].filter(Boolean).join(' · '))}</span>
              ${c.description && c.description !== c.name ? `<span class="small">${esc(c.description)}</span>` : ''}
              ${c.already ? '<span class="chip warn">Already a card on this order</span>' : ''}
              ${c.suggestion ? '<span class="chip">Not marked — is it ours?</span>' : ''}
              ${c.pic ? `<span class="read-tools"><button type="button" class="btn small" data-bigger="${i}">Bigger</button>
                <button type="button" class="btn small" data-whole="${i}">Whole page</button>
                <button type="button" class="btn small" data-nopic="${i}">No picture</button>
                <span class="muted small">${esc(c.pic.at.label)}</span></span>` : ''}
            </div>
          </div>`).join('') : '<p class="ai-problem">No lights for us were found. Check that the schedule names us as the manufacturer, or that the mark on the drawings is right.</p>'}
      </div>
      <footer><span class="spacer"></span>
        <button type="button" class="btn" data-close>Cancel</button>
        <button type="submit" class="btn primary" ${cards.length ? '' : 'disabled'}>Make the cards</button></footer>
    </form>`, {
    wide: true,
    async onOpen(sheet) {
      const draw = async i => { const img = $(`[data-pic="${i}"]`, sheet); if (img) img.src = await cropPreview(cards[i].pic).catch(() => ''); };
      for (let i = 0; i < cards.length; i++) draw(i);
      sheet.addEventListener('click', e => {
        const b = e.target.closest('[data-bigger],[data-whole],[data-nopic]');
        if (!b) return;
        const i = Number(b.dataset.bigger ?? b.dataset.whole ?? b.dataset.nopic);
        const c = cards[i];
        if (!c || !c.pic) return;
        sheet.dataset.dirty = '1';
        if (b.dataset.nopic != null) { c.pic = null; $(`[data-pic="${i}"]`, sheet).replaceWith(Object.assign(document.createElement('span'), { className: 'muted small', textContent: 'No picture' })); b.closest('.read-tools').remove(); return; }
        if (b.dataset.whole != null) c.pic.box = [0, 0, 1, 1];
        else { const [x0, y0, x1, y1] = c.pic.box; const mx = (x1 - x0) * 0.25, my = (y1 - y0) * 0.25; c.pic.box = [clamp(x0 - mx), clamp(y0 - my), clamp(x1 + mx), clamp(y1 + my)]; }
        draw(i);
      });
    },
    async onSubmit(fd) {
      const chosen = cards.map((c, i) => ({ ...c, use: !!fd.get(`use_${i}`), name: String(fd.get(`name_${i}`) || c.name || '').trim(), quantity: Number(String(fd.get(`qty_${i}`) || '').replace(',', '.')) || 0 })).filter(c => c.use);
      if (!chosen.length) { toast('Tick at least one light'); return false; }
      try { await save(projectId, chosen, { originals: !!fd.get('originals') }); } catch (err) { console.error(err); return false; }
    },
  });
}

// ---------- 5. Save ----------

async function save(projectId, cards, { originals = false } = {}) {
  let order = nextSortOrder(productsOf(projectId));
  const made = [];
  for (const c of cards) {
    const notes = [
      c.location && `Location: ${c.location}`,
      c.mounting && `Mounting: ${c.mounting}`,
      [c.cct && `CCT ${c.cct}`, c.voltage && `Voltage ${c.voltage}`, c.dimming && `Dimming ${c.dimming}`].filter(Boolean).join(' · '),
      c.notes,
      c.source && `Source: ${c.source}`,
      !c.quantity && 'Quantity to confirm with the client (not given).',
    ].filter(Boolean).join('\n');
    const spec = { location_tag: (c.location || '').split(/ — | - |, /)[0].slice(0, 80), notes, _source: { schedule_type: c.code || '', mounting: c.mounting || '', ref: c.source || '' } };
    if (c.size) spec.overall_size = c.size;
    if (c.finish) spec.finish = c.finish;
    if (c.pic) spec._crop = { attachment_id: c.pic.at.att.id, page: c.pic.at.page, box: c.pic.box.map(v => Math.round(v * 1000) / 1000) };
    made.push((await store.insert('items', {
      project_id: projectId, item_no: c.code || '', name: c.name || c.code || 'Light', description: c.description || '',
      quantity: c.quantity || 1, category: 'lighting', sort_order: order++, spec,
    })).id);
  }
  thumbs.forEach(u => URL.revokeObjectURL(u));
  thumbs.clear();
  toast(`${cards.length} card${cards.length === 1 ? '' : 's'} made — cutting the pictures…`);
  // The pictures are cut from the original PDFs at full sharpness while the cards are already on screen.
  cutPictures(projectId).then(async n => {
    if (n) toast(`${n} picture${n === 1 ? '' : 's'} added to the cards`);
    if (!originals) return;
    toast('Looking up the originals online…');
    const r = await findOriginals(projectId, { ids: made });
    if (r) toast(`Originals found for ${r.found} of ${r.done} light${r.done === 1 ? '' : 's'}`);
  }).catch(err => { console.error(err); toast(err.demo ? 'Finding originals online works with the team database, not in demo mode.' : `Couldn't finish: ${err.message || err}`); });
}


// ---------- 6. The originals online ----------
// For each card with a client picture, the product-finder function looks at the picture, recognises or
// describes the light and searches the web for the original (brand, model, specs, retail price, pictures).
// What it finds is kept next to the card as "the original" — our own details on the card are not changed.

// Searches before similar products were kept (version 1) are run again for cards without an original.
const SEARCH_V = 2;
export const needsOriginal = it => {
  const s = (it && it.spec) || {};
  const tried = s._original_search && (s._original_search.v || 1) >= SEARCH_V;
  return !!(((s._images || {}).vision || []).length && !s._original && !tried);
};
export const originalsWaiting = projectId => productsOf(projectId).filter(needsOriginal);

const clean = v => String(v == null ? '' : v).trim();
let searching = false;

const toFile = im => new File([Uint8Array.from(atob(im.data), c => c.charCodeAt(0))], im.name, { type: im.mime });
const currencyOf = c => (/^[A-Z]{3}$/.test(clean(c).toUpperCase()) ? clean(c).toUpperCase() : '');

// Up to 3 similar products on sale (not the original) — a price benchmark when there's no exact original.
async function similarOf(projectId, itemId, list) {
  const out = [];
  for (const x of (list || []).filter(x => x && /^https:\/\//.test(clean(x.product_url))).slice(0, 3)) {
    let image = null;
    if (x && x.image) image = ((await uploadFiles([toFile(x.image)], { project_id: projectId, item_id: itemId, kind: 'qc', quiet: true }))[0] || {}).id || null;
    out.push({ brand: clean(x.brand), model: clean(x.model), product_url: clean(x.product_url), retail_price: Number(x.retail_price) || 0,
      currency: currencyOf(x.currency), why: clean(x.why), image });
  }
  return out.filter(x => x.brand || x.model);
}

async function applyOriginal(projectId, itemId, o) {
  const it = store.get('items', itemId);
  if (!it) return false;
  const at = new Date().toISOString();
  const similar = o && !o.error ? await similarOf(projectId, itemId, o.similar) : [];
  if (!o || o.error || !o.found) {
    const spec = { ...((store.get('items', itemId) || it).spec || {}) };
    spec._original_search = { at, v: SEARCH_V, found: false, note: clean((o && (o.error || o.notes)) || '').slice(0, 300) };
    if (similar.length) spec._similar = similar;
    await store.update('items', itemId, { spec });
    return false;
  }
  let ids = [];
  if ((o.images || []).length) ids = (await uploadFiles(o.images.map(toFile), { project_id: projectId, item_id: itemId, kind: 'qc', quiet: true })).map(a => a.id);
  const specs = Object.fromEntries((o.specs || []).filter(s => s && s.key && clean(s.value)).map(s => [s.key, clean(s.value)]));
  const fresh = store.get('items', itemId) || it;
  const next = { ...(fresh.spec || {}) };
  const images = { ...(next._images || {}) };
  if (!(images.offer || []).length && ids.length) images.offer = [ids[0]];
  next._images = images;
  next._original = {
    brand: clean(o.brand), model: clean(o.model), designer: clean(o.designer), product_url: clean(o.product_url),
    description: clean(o.description), retail_price: Number(o.retail_price) || 0,
    currency: currencyOf(o.currency), price_note: clean(o.price_note),
    confidence: clean(o.confidence), specs, images: ids, sources: (o.sources || []).map(clean).filter(Boolean).slice(0, 8),
    notes: clean(o.notes), found_at: at,
  };
  if (similar.length) next._similar = similar;
  next._original_search = { at, v: SEARCH_V, found: true };
  await store.update('items', itemId, { spec: next });
  return true;
}

// Look up the originals of the given cards (all waiting ones if none given), three at a time.
export async function findOriginals(projectId, { ids, onProgress } = {}) {
  if (searching) return null;
  searching = true;
  try {
    const p = store.get('projects', projectId);
    const company = p && store.get('companies', p.company_id);
    const market = company && company.country === 'NL' ? 'EU' : (p && p.currency === 'EUR' ? 'EU' : 'US');
    const todo = (ids ? ids.map(id => store.get('items', id)).filter(Boolean) : originalsWaiting(projectId)).filter(needsOriginal);
    let done = 0, found = 0;
    await pool(todo, 3, async it => {
      const pics = ((it.spec._images || {}).vision || []).map(id => store.get('attachments', id)).filter(a => a && /^image\//.test(a.mime || ''));
      const product = {
        name: it.name, seen: [it.description, it.spec.location_tag && `In: ${it.spec.location_tag}`, 'The picture is cut from the designer’s rendering / mood board.'].filter(Boolean).join(' '),
        brand_guess: '', model_guess: '', product_url: '', search_query: [it.name, it.description].filter(Boolean).join(' ').slice(0, 200), changes: [], change_notes: '',
      };
      let res;
      try {
        res = await retry(() => store.backend.findProducts({ mode: 'research', product, currency: (p && p.currency) || 'USD', market, paths: pics.slice(0, 2).map(a => a.path) }));
      } catch (err) {
        if (err.demo || err.notSetUp) throw err;
        res = { result: { found: false, error: err.message || String(err) } };
      }
      if (await applyOriginal(projectId, it.id, res && res.result).catch(e => { console.error(e); return false; })) found++;
      done++;
      if (onProgress) onProgress(done, todo.length, found);
    });
    return { done, found };
  } finally {
    searching = false;
  }
}
