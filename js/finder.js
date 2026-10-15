// "Find products online": what a client sent (photos, scans, PDFs, the text of their email) is read by the
// "product-finder" Edge Function, which then looks up each original product online — brand, model, details,
// retail price and pictures. The review sheet shows the original next to our version (the original plus the
// client's changes); nothing is saved until it has been checked.
import { esc, toast, openSheet, sheetHeader, $, $$ } from './lib.js';
import { store, productsOf, nextSortOrder } from './store.js';
import { filesOfKind, uploadFiles } from './files.js';
import { SPEC_SECTIONS, fieldValue, visible, IMAGE_GROUPS } from './qc-spec.js';
import { parseAmount } from './money.js';

const clean = v => String(v == null ? '' : v).trim();
const FIELD = Object.fromEntries(SPEC_SECTIONS.flatMap(s => s.fields).map(f => [f.key, f]));
const label = key => (FIELD[key] ? FIELD[key].label : key);
const shown = (key, value) => (FIELD[key] ? fieldValue(FIELD[key], { [key]: value }) || clean(value) : clean(value));
const isDoc = a => /^image\/|application\/pdf/.test(a.mime || '');
// Words that say what a product is, for matching AI results to products already on the order.
const COMMON = new Set(['light', 'lights', 'lamp', 'lamps', 'ceiling', 'wall', 'floor', 'table', 'pendant', 'sconce', 'with', 'and', 'the', 'for',
  'mounted', 'mount', 'brass', 'glass', 'opal', 'white', 'black', 'gold', 'metal', 'round', 'large', 'small', 'fixture', 'design']);
const words = s => clean(s).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 4 && !COMMON.has(w));
const alike = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));
function bestMatch(pr, r, existing, used) {
  const mine = [...new Set(words([pr.name, pr.brand_guess, pr.model_guess, r && r.brand, r && r.model].join(' ')))];
  let best = null, score = 0;
  existing.filter(x => !used.has(x.id)).forEach(x => {
    const theirs = words(`${x.name} ${x.description || ''}`);
    const s = mine.filter(w => theirs.some(t => alike(w, t))).length;
    if (s > score) { best = x; score = s; }
  });
  return best;
}
const pairs = list => Object.fromEntries((Array.isArray(list) ? list : []).filter(x => x && FIELD[x.key] && clean(x.value)).map(x => [x.key, clean(x.value)]));

let run = 0; // answers for a search the user walked away from are ignored

// ---------- Step 1: what did the client send? ----------

export function openFinder(projectId, { itemId } = {}) {
  const p = store.get('projects', projectId);
  if (!p) return;
  const item = itemId && store.get('items', itemId);
  if (item) { findForItem(p, item); return; }
  const files = [...filesOfKind(p.id, 'inquiry'), ...filesOfKind(p.id, 'general')].filter(isDoc);
  const added = [];
  const fileList = () => [...added, ...files].map((a, i) => `
    <label class="check-line"><input type="checkbox" name="file" value="${esc(a.id)}" ${i < 6 && (added.includes(a) || files.length <= 3) ? 'checked' : ''}>
      <span class="grow">${esc(a.name)}</span></label>`).join('') || '<p class="muted small">No pictures or PDFs on this order yet.</p>';
  openSheet(`
    <form class="finder-start">
      ${sheetHeader('✨ Find products online')}
      <div class="fields">
        <p class="muted small">Add what the client sent: photos or screenshots of the product, a PDF, and the text of their email.
          The AI works out which products they want and what they want changed, then looks up each original online —
          brand, model, details, retail price and pictures. You check everything before it's saved.</p>
        <div class="field"><span>Pictures &amp; PDFs</span>
          <div class="finder-files">${fileList()}</div>
          <label class="btn small upload-btn">Add pictures or PDF<input type="file" multiple hidden accept="image/*,application/pdf" data-finder-upload></label>
        </div>
        <label class="field"><span>Client's email or notes</span>
          <textarea name="text" rows="6" placeholder="Paste the client's email here — e.g. “We love the Bocci 28 pendant but need it 30% bigger, 2700K and DALI dimming, 12 pieces.”"></textarea></label>
        <label class="field"><span>Link to the product (optional)</span><input name="link" type="url" placeholder="https://…" autocomplete="off"></label>
      </div>
      <footer><button type="button" class="btn" data-close>Cancel</button><span class="spacer"></span><button type="submit" class="btn primary">Find products</button></footer>
    </form>`, {
    wide: true,
    onOpen(sheet) {
      const input = $('[data-finder-upload]', sheet);
      input.addEventListener('change', async e => {
        e.stopPropagation();
        const saved = await uploadFiles(input.files, { project_id: p.id, kind: 'inquiry' });
        input.value = '';
        added.unshift(...saved.filter(isDoc));
        $('.finder-files', sheet).innerHTML = fileList();
        sheet.dataset.dirty = '1';
      });
    },
    onSubmit(fd, form) {
      const chosen = $$('[name=file]:checked', form).map(el => store.get('attachments', el.value)).filter(Boolean);
      const text = clean(fd.get('text'));
      const link = clean(fd.get('link'));
      if (!chosen.length && !text && !link) { toast('Add a picture, a PDF, the email text or a link'); return false; }
      setTimeout(() => startSearch(p, chosen, text, link), 30);
    },
  });
}

// ---------- Step 2: read, then look up each product (a few at a time) ----------

async function startSearch(p, files, text, link) {
  const ticket = ++run;
  const state = { products: [], results: [], phase: 'read' };
  const draw = () => {
    const sheet = $('#sheet');
    const box = sheet && sheet.open && $('.finder-progress', sheet);
    if (!box) return;
    box.innerHTML = state.phase === 'read'
      ? `<div class="ai-wait"><div class="spinner"></div><p><b>Reading what the client sent…</b></p><p class="muted small">Usually 15–40 seconds.</p></div>`
      : `<ul class="finder-steps">${state.products.map((pr, i) => {
        const r = state.results[i];
        const status = !r ? '<span class="spinner small"></span> Searching online…'
          : r.error ? `⚠️ ${esc(r.error)}`
          : r.found ? `✅ ${esc([r.brand, r.model].filter(Boolean).join(' '))}${r.retail_price ? ` · ${esc(money(r.retail_price, r.currency))}` : ''}`
          : '— original not found';
        return `<li><b>${esc(pr.name)}</b><span class="muted small">${status}</span></li>`;
      }).join('')}</ul><p class="muted small">Each search takes about a minute. You can review when they're done.</p>`;
  };
  openSheet(`
    <div>
      ${sheetHeader('✨ Finding products')}
      <div class="fields finder-progress"></div>
      <footer><button type="button" class="btn" data-close>Cancel</button></footer>
    </div>`, { onClose() { if (ticket === run) run++; } });
  draw();

  let read;
  try {
    read = await store.backend.findProducts({ mode: 'read', paths: files.map(a => a.path), text, link });
  } catch (err) {
    if (ticket === run) problem(err);
    return;
  }
  if (ticket !== run) return;
  const products = ((read && read.result && read.result.products) || []).slice(0, 8);
  if (!products.length) { problem(new Error('No products were found in what the client sent.')); return; }
  if (link && products.length === 1 && !clean(products[0].product_url)) products[0].product_url = link;
  state.products = products;
  state.phase = 'research';
  draw();

  const company = store.get('companies', p.company_id) || {};
  const market = company.country === 'US' ? 'US' : 'EU';
  let next = 0;
  const worker = async () => {
    while (next < products.length && ticket === run) {
      const i = next++;
      try {
        const res = await store.backend.findProducts({
          mode: 'research', product: products[i], currency: p.currency || (market === 'US' ? 'USD' : 'EUR'), market,
          paths: picturesOf(products[i], files, products.length).slice(0, 3).map(a => a.path),
        });
        state.results[i] = (res && res.result) || { found: false, notes: 'No answer' };
      } catch (err) {
        state.results[i] = { error: err.notSetUp ? 'AI search isn’t switched on yet' : (err.message || String(err)) };
      }
      if (ticket === run) draw();
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  if (ticket !== run) return;
  review(p, files, read.result, products, state.results);
}

// One product that's already on the order: just look up its original.
async function findForItem(p, it) {
  const ticket = ++run;
  openSheet(`
    <div>
      ${sheetHeader(`✨ Finding the original — ${it.name}`)}
      <div class="ai-wait"><div class="spinner"></div><p><b>Searching online…</b></p><p class="muted small">Usually under a minute.</p></div>
      <footer><button type="button" class="btn" data-close>Cancel</button></footer>
    </div>`, { onClose() { if (ticket === run) run++; } });
  const spec = it.spec || {};
  const imgIds = [...((spec._images || {}).vision || []), ...((spec._images || {}).offer || [])];
  const images = imgIds.map(id => store.get('attachments', id)).filter(a => a && /^image\//.test(a.mime || '')).slice(0, 3);
  const company = store.get('companies', p.company_id) || {};
  const product = {
    name: it.name, quantity: Number(it.quantity) || 1, category: it.category || 'lighting',
    seen: [it.description, it.dimensions, it.materials].filter(Boolean).join(' · '),
    brand_guess: clean((spec._original || {}).brand), model_guess: clean((spec._original || {}).model),
    product_url: clean((spec._original || {}).product_url), search_query: it.name, changes: [], change_notes: '',
  };
  let res;
  try {
    res = await store.backend.findProducts({ mode: 'research', product, currency: p.currency, market: company.country === 'US' ? 'US' : 'EU', paths: images.map(a => a.path) });
  } catch (err) {
    if (ticket === run) problem(err);
    return;
  }
  if (ticket !== run) return;
  review(p, [], { summary: '' }, [product], [(res && res.result) || { found: false }], it);
}

// The client's pictures of one product: the files the AI said show it (numbered from 1); with a single product, all of them.
function picturesOf(pr, files, count) {
  const nums = Array.isArray(pr.pictures) ? pr.pictures : [];
  const picked = nums.map(n => files[Number(n) - 1]).filter(Boolean);
  return (picked.length ? picked : count === 1 ? files : []).filter(a => /^image\//.test(a.mime || ''));
}

function problem(err) {
  const msg = err.demo
    ? 'Finding products online works when you are signed in to the team database, not in demo mode.'
    : err.notSetUp
      ? 'This isn’t switched on yet: it needs the “product-finder” function and the ANTHROPIC_API_KEY secret in Supabase.'
      : `Something went wrong: ${err.message || err}`;
  openSheet(`<div>${sheetHeader('✨ Find products online')}<p class="ai-problem">${esc(msg)}</p>
    <footer><span class="spacer"></span><button type="button" class="btn primary" data-close>OK</button></footer></div>`);
}

const money = (v, cur) => {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: clean(cur) || 'USD' }).format(Number(v) || 0); } catch { return `${clean(cur)} ${v}`; }
};

// ---------- Step 3: check the original and our version, then save ----------

// Choice fields (dimming, light source…) as a dropdown with readable names; everything else as text.
function changeInput(name, key, value) {
  const f = FIELD[key];
  const opts = f && f.type === 'select' ? f.options : f && f.type === 'yesno' ? [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] : null;
  if (!opts) return `<input name="${name}" value="${esc(value)}">`;
  const known = opts.some(o => o.id === value);
  return `<select name="${name}">${known ? '' : `<option value="${esc(value)}" selected>${esc(value)}</option>`}${opts.map(o => `<option value="${esc(o.id)}" ${o.id === value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
}

function review(p, files, read, products, results, onlyItem) {
  const existing = productsOf(p.id);
  const used = new Set();
  const matches = products.map((pr, i) => {
    const m = onlyItem || bestMatch(pr, results[i], existing, used);
    if (m) used.add(m.id);
    return m;
  });
  const card = (pr, r, i) => {
    r = r || {};
    const orig = pairs(r.specs);
    const changes = pairs(pr.changes);
    const keys = Object.keys(changes);
    const origRows = Object.entries(orig).filter(([k]) => !changes[k]);
    const match = matches[i];
    return `
      <section class="finder-card" data-i="${i}">
        <label class="check-line"><input type="checkbox" name="pick_${i}" checked> <b class="grow">${esc(pr.name)}</b></label>
        <div class="finder-cols">
          <div class="finder-orig">
            <h4>The original</h4>
            ${r.error ? `<p class="notice warn small">${esc(r.error)}</p>`
              : r.found ? `
                <p><b>${esc([r.brand, r.model].filter(Boolean).join(' — '))}</b>${r.designer ? `<br><span class="muted small">Design: ${esc(r.designer)}</span>` : ''}
                  ${r.confidence && r.confidence !== 'high' ? `<span class="chip warn">${esc(r.confidence)} confidence</span>` : ''}</p>
                ${r.product_url ? `<p class="small"><a href="${esc(r.product_url)}" target="_blank" rel="noopener">Open the product page ↗</a></p>` : ''}
                ${r.retail_price ? `<p class="finder-price">Retail ${esc(money(r.retail_price, r.currency))}<span class="muted small">${r.price_note ? ` — ${esc(r.price_note)}` : ''}</span></p>` : '<p class="muted small">No retail price found.</p>'}
                ${(r.images || []).length ? `<div class="qc-thumbs">${r.images.map(im => `<img class="qc-thumb" src="data:${esc(im.mime)};base64,${im.data}" alt="">`).join('')}</div>` : ''}
                ${r.description ? `<p class="small">${esc(r.description)}</p>` : ''}
                ${origRows.length ? `<dl class="facts small">${origRows.map(([k, v]) => `<dt>${esc(label(k))}</dt><dd>${esc(shown(k, v))}</dd>`).join('')}</dl>` : ''}
                ${r.notes ? `<p class="muted small">Note: ${esc(r.notes)}</p>` : ''}`
              : `<p class="muted small">The original couldn't be identified${r.notes ? `: ${esc(r.notes)}` : '.'} You can still add the product with what the client asked for.</p>`}
          </div>
          <div class="finder-ours">
            <h4>Our version</h4>
            <div class="field-row">
              <label class="field grow"><span>Product name</span><input name="name_${i}" value="${esc(match ? match.name : pr.name)}"></label>
              <label class="field qty-field"><span>Qty</span><input name="qty_${i}" value="${esc(String(Number(match ? match.quantity : pr.quantity) || 1))}" inputmode="decimal"></label>
            </div>
            <label class="field"><span>Type</span><select name="cat_${i}">${['lighting', 'furniture', 'other'].map(c => `<option ${c === (pr.category || 'lighting') ? 'selected' : ''} value="${c}">${c[0].toUpperCase() + c.slice(1)}</option>`).join('')}</select></label>
            ${keys.length ? `<p class="small"><b>What the client wants changed</b></p>${keys.map(k => `
              <label class="field"><span>${esc(label(k))}${orig[k] ? ` <span class="muted">— original: ${esc(shown(k, orig[k]))}</span>` : ''}</span>
                ${changeInput(`chg_${i}_${k}`, k, changes[k])}</label>`).join('')}` : '<p class="muted small">No changes asked for — same as the original.</p>'}
            ${clean(pr.change_notes) ? `<label class="field"><span>Other wishes</span><textarea name="notes_${i}" rows="2">${esc(pr.change_notes)}</textarea></label>` : ''}
            ${onlyItem ? '' : `<label class="field"><span>Save as</span><select name="target_${i}" data-i="${i}">
              <option value="new">New product on this order</option>
              ${existing.map(x => `<option value="${x.id}" ${match && match.id === x.id ? 'selected' : ''}>Update “${esc(x.name)}”</option>`).join('')}
            </select></label>`}
          </div>
        </div>
      </section>`;
  };
  openSheet(`
    <form class="finder-review">
      ${sheetHeader('Check the products')}
      <div class="fields">
        ${clean(read.summary) ? `<p class="muted small">${esc(read.summary)}</p>` : ''}
        <p class="muted small">The original's details fill in the spec, and the client's changes go on top — that's our version.
          The original (brand, link, retail price, pictures) is kept with the product for reference. Untick what you don't want.</p>
        ${products.map((pr, i) => card(pr, results[i], i)).join('')}
      </div>
      <footer><button type="button" class="btn" data-close>Cancel</button><span class="spacer"></span><button type="submit" class="btn primary">Save</button></footer>
    </form>`, {
    wide: true,
    onOpen(sheet) {
      sheet.dataset.dirty = '1';
      // Updating a product keeps its own name and quantity; a new one takes the AI's.
      sheet.addEventListener('change', e => {
        const sel = e.target.closest('select[name^=target_]');
        if (!sel) return;
        const i = sel.dataset.i, x = store.get('items', sel.value);
        $(`[name=name_${i}]`, sheet).value = x ? x.name : products[i].name;
        $(`[name=qty_${i}]`, sheet).value = String(Number(x ? x.quantity : products[i].quantity) || 1);
      });
    },
    async onSubmit(fd) {
      let n = 0;
      for (let i = 0; i < products.length; i++) {
        if (fd.get(`pick_${i}`) !== 'on') continue;
        const pr = products[i];
        const r = results[i] || {};
        const changes = Object.fromEntries(Object.keys(pairs(pr.changes)).map(k => [k, clean(fd.get(`chg_${i}_${k}`))]).filter(([, v]) => v));
        try {
          await saveProduct(p, {
            target: onlyItem ? onlyItem.id : fd.get(`target_${i}`),
            name: clean(fd.get(`name_${i}`)) || pr.name,
            quantity: parseAmount(fd.get(`qty_${i}`)) || 1,
            category: fd.get(`cat_${i}`) || 'lighting',
            notes: clean(fd.get(`notes_${i}`)),
            seen: clean(pr.seen),
            original: r.found ? r : null,
            changes,
            clientImages: picturesOf(pr, files, products.length).map(a => a.id),
          });
          n++;
        } catch (err) { console.error(err); }
      }
      toast(n ? `Saved ${n} product${n === 1 ? '' : 's'}` : 'Nothing saved');
      if (n && !onlyItem) location.hash = `#/project/${p.id}/${/\/order$/.test(location.hash) ? 'order' : 'steps'}`;
    },
  });
}

async function saveProduct(p, d) {
  const origSpecs = d.original ? pairs(d.original.specs) : {};
  let it = d.target && d.target !== 'new' ? store.get('items', d.target) : null;
  if (!it) {
    it = await store.insert('items', {
      project_id: p.id, name: d.name, quantity: d.quantity, category: d.category,
      description: [d.seen, d.notes].filter(Boolean).join('\n'), sort_order: nextSortOrder(productsOf(p.id)),
    });
  }
  // Pictures of the original go into permanent QC storage with the product.
  let origImages = [];
  if (d.original && (d.original.images || []).length) {
    const blobs = d.original.images.map(im => new File([Uint8Array.from(atob(im.data), c => c.charCodeAt(0))], im.name, { type: im.mime }));
    origImages = (await uploadFiles(blobs, { project_id: p.id, item_id: it.id, kind: 'qc' })).map(a => a.id);
  }
  const old = it.spec || {};
  // Our version: what's already filled in stays; empty fields take the original's facts; the client's changes win.
  const spec = { ...origSpecs, ...Object.fromEntries(Object.entries(old).filter(([, v]) => clean(typeof v === 'string' ? v : JSON.stringify(v)))), ...d.changes };
  const images = { ...(old._images || {}) };
  IMAGE_GROUPS.forEach(g => { images[g.id] = [...(images[g.id] || [])]; });
  images.vision = [...new Set([...images.vision, ...d.clientImages])];
  if (!images.offer.length && origImages.length) images.offer = [origImages[0]];
  spec._images = images;
  if (d.original) {
    const o = d.original;
    spec._original = {
      brand: clean(o.brand), model: clean(o.model), designer: clean(o.designer), product_url: clean(o.product_url),
      description: clean(o.description), retail_price: Number(o.retail_price) || 0, currency: /^[A-Z]{3}$/.test(clean(o.currency).toUpperCase()) ? clean(o.currency).toUpperCase() : '', price_note: clean(o.price_note),
      confidence: clean(o.confidence), specs: origSpecs, images: origImages, sources: (o.sources || []).map(clean).filter(Boolean).slice(0, 8),
      notes: clean(o.notes), found_at: new Date().toISOString(),
    };
  }
  spec._custom = Object.keys(d.changes).map(k => ({ key: k, label: label(k), original: origSpecs[k] || '', ours: d.changes[k] }));
  if (!spec._custom.length) delete spec._custom;
  const patch = { spec, category: d.category, quantity: d.quantity, name: d.name };
  if (!clean(it.dimensions) && (spec.overall_size || spec.diameter)) patch.dimensions = spec.overall_size || spec.diameter;
  if (!clean(it.materials) && (spec.body_material || spec.finish)) patch.materials = [spec.body_material, spec.finish].filter(Boolean).join(', ');
  await store.update('items', it.id, patch);
}

// Small summary of the original, for the product sheet and the QC card.
export function originalSummary(it, { full = false } = {}) {
  const o = ((it && it.spec) || {})._original;
  const custom = ((it && it.spec) || {})._custom || [];
  if (!o) return '';
  return `<div class="finder-note">
    <div><span class="muted small">Original</span> <b>${esc([o.brand, o.model].filter(Boolean).join(' — '))}</b>
      ${o.retail_price ? ` · <span>retail ${esc(money(o.retail_price, o.currency))}</span>` : ''}
      ${o.product_url ? ` · <a href="${esc(o.product_url)}" target="_blank" rel="noopener">page ↗</a>` : ''}</div>
    ${full && custom.length ? `<div class="small">Our changes: ${custom.map(c => `${esc(c.label)} <b>${esc(shown(c.key, c.ours))}</b>${c.original ? ` <span class="muted">(original ${esc(shown(c.key, c.original))})</span>` : ''}`).join(' · ')}</div>` : ''}
  </div>`;
}

// The spec's key details on the product sheet (the full spec opens from here).
const KEY_DETAILS = ['overall_size', 'diameter', 'overall_drop', 'body_material', 'glass', 'finish', 'source_type', 'led_power', 'socket', 'cct', 'dimming', 'voltage'];
export function specSummary(it) {
  const spec = (it && it.spec) || {};
  const filled = SPEC_SECTIONS.flatMap(sec => sec.fields).filter(f => f.type !== 'files' && visible(f, spec) && fieldValue(f, spec));
  if (!filled.length) return '';
  const rows = KEY_DETAILS.map(k => FIELD[k]).filter(f => f && visible(f, spec) && fieldValue(f, spec));
  return `<div class="finder-note">
    <div><span class="muted small">Spec</span> <b>${filled.length} detail${filled.length === 1 ? '' : 's'} filled in</b></div>
    ${rows.length ? `<dl class="facts small">${rows.map(f => `<dt>${esc(f.label)}</dt><dd>${esc(fieldValue(f, spec))}</dd>`).join('')}</dl>` : ''}
    ${it.category === 'lighting' ? `<div><button type="button" class="btn small" data-action="qc-spec" data-id="${esc(it.id)}">Open the full spec</button></div>` : ''}
  </div>`;
}
