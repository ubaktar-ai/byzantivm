// "Read with AI": a client inquiry or supplier quote (PDF or photo) is read by Claude through the
// Supabase Edge Function "read-document" (supabase/functions/read-document). Nothing is saved until
// the result has been checked in a review sheet.
import { esc, toast, openSheet, sheetHeader, money, $ } from './lib.js';
import { store, productsOf, nextSortOrder } from './store.js';
import { parseAmount } from './money.js';

const num = v => Number(v) || 0;
const clean = v => String(v == null ? '' : v).trim();

let reading = 0; // ignore answers for a reading the user already walked away from

export async function readWithAI(att, mode) {
  const p = store.get('projects', att.project_id);
  if (!p) return;
  const ticket = ++reading;
  openSheet(`
    <div>
      ${sheetHeader(mode === 'inquiry' ? 'Reading the inquiry…' : 'Reading the supplier quote…')}
      <div class="ai-wait">
        <div class="spinner"></div>
        <p><b>${esc(att.name)}</b></p>
        <p class="muted small">This usually takes 10–40 seconds. You can check everything before it is saved.</p>
      </div>
      <footer><span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button></footer>
    </div>`, { onClose() { if (ticket === reading) reading++; } });

  let data;
  try {
    data = await store.backend.readDocument(att.path, mode);
  } catch (err) {
    if (ticket !== reading) return;
    console.error(err);
    showProblem(err);
    return;
  }
  if (ticket !== reading) return;
  const r = data && data.result;
  if (!r) { showProblem(new Error((data && data.error) || 'No answer from the AI')); return; }
  if (mode === 'inquiry') reviewInquiry(p, att, r);
  else reviewSupplierQuote(p, att, r);
}

function showProblem(err) {
  const text = err.demo
    ? 'Reading documents with AI works when you are signed in to the team database. In demo mode, type the products in by hand.'
    : err.notSetUp
      ? 'AI reading isn’t switched on yet. It needs a one-time setup in Supabase (an Anthropic API key and the “read-document” function) — see “AI document reading” in the README.'
      : `The document couldn’t be read: ${err.message || err}`;
  openSheet(`
    <div>
      ${sheetHeader('Read with AI')}
      <p class="ai-problem">${esc(text)}</p>
      <footer><span class="spacer"></span><button type="button" class="btn primary" data-close>OK</button></footer>
    </div>`);
}

// ---------- Client inquiry → client, order details and products ----------

function findClient(name) {
  const n = clean(name).toLowerCase();
  if (!n) return null;
  return store.all('clients').find(c => c.name.toLowerCase() === n)
    || store.all('clients').find(c => c.name.toLowerCase().includes(n) || n.includes(c.name.toLowerCase()))
    || null;
}

function reviewInquiry(p, att, r) {
  const c = r.client || {};
  const products = Array.isArray(r.products) ? r.products : [];
  const linked = store.get('clients', p.client_id);
  const clientName = clean(c.company) || clean(c.contact_name);
  const match = !linked && findClient(clientName);
  const notes = [clean(r.summary), clean(r.budget) && `Budget: ${clean(r.budget)}`].filter(Boolean).join('\n');
  const check = (name, on) => `<input type="checkbox" name="${name}" ${on ? 'checked' : ''}>`;

  const clientBlock = linked
    ? `<p class="muted small">Client: <b>${esc(linked.name)}</b> (already linked)</p>`
    : clientName ? `
      <label class="field"><span>Client</span>
        <select name="client_choice">
          ${match ? `<option value="existing">Use existing client “${esc(match.name)}”</option>` : ''}
          <option value="new">Create new client</option>
          <option value="none">Don't set a client</option>
        </select></label>
      <div class="ai-new-client" ${match ? 'hidden' : ''}>
        <div class="field-row">
          <label class="field"><span>Company / name</span><input name="c_name" value="${esc(clientName)}"></label>
          <label class="field"><span>Contact person</span><input name="c_contact" value="${esc(c.contact_name || '')}"></label>
        </div>
        <div class="field-row">
          <label class="field"><span>Email</span><input name="c_email" type="email" value="${esc(c.email || '')}"></label>
          <label class="field"><span>Phone</span><input name="c_phone" value="${esc(c.phone || '')}"></label>
        </div>
        <label class="field"><span>Address</span><textarea name="c_address" rows="2">${esc([c.address, c.country].filter(x => clean(x)).join('\n'))}</textarea></label>
        ${clean(c.vat_number) ? `<label class="field"><span>VAT / tax number</span><input name="c_vat" value="${esc(c.vat_number)}"></label>` : ''}
      </div>`
      : `<p class="muted small">No client details found in the document.</p>`;

  openSheet(`
    <form class="ai-review">
      ${sheetHeader('Check what the AI found')}
      <div class="fields">
        <p class="muted small">From <b>${esc(att.name)}</b>. Change anything that's wrong, untick what you don't want, then save.</p>
        <h3 class="sheet-sub">Client</h3>
        ${clientBlock}

        <h3 class="sheet-sub">Order</h3>
        ${clean(r.project_name) && clean(r.project_name) !== p.name ? `
          <label class="check-line">${check('use_name', false)} Rename order to <input name="name" value="${esc(r.project_name)}"></label>` : ''}
        ${notes ? `<label class="check-line top">${check('use_notes', true)} <span class="grow">Add to the brief<textarea name="notes" rows="3">${esc(notes)}</textarea></span></label>` : ''}
        ${clean(r.delivery_address) ? `<label class="check-line top">${check('use_address', !clean(p.delivery_address))} <span class="grow">Delivery address<textarea name="delivery_address" rows="2">${esc(r.delivery_address)}</textarea></span></label>` : ''}
        ${/^\d{4}-\d{2}-\d{2}$/.test(clean(r.deadline)) ? `<label class="check-line">${check('use_deadline', !p.due_date)} Deadline <input type="date" name="deadline" value="${esc(r.deadline)}"></label>` : ''}

        <h3 class="sheet-sub">Products (${products.length})</h3>
        ${products.length ? `<div class="ai-lines">${products.map((it, i) => `
          <div class="ai-line">
            <input type="checkbox" name="pick_${i}" checked aria-label="Add this product">
            <div class="ai-line-fields">
              <div class="field-row">
                <label class="field grow"><span>Product</span><input name="p_name_${i}" value="${esc(it.name || '')}"></label>
                <label class="field qty-field"><span>Qty</span><input name="p_qty_${i}" value="${esc(String(num(it.quantity) || 1))}" inputmode="decimal"></label>
              </div>
              <div class="field-row">
                <label class="field"><span>Dimensions</span><input name="p_dim_${i}" value="${esc(it.dimensions || '')}"></label>
                <label class="field"><span>Materials / finish</span><input name="p_mat_${i}" value="${esc(it.materials || '')}"></label>
              </div>
              ${clean(it.notes) ? `<label class="field"><span>Notes</span><input name="p_notes_${i}" value="${esc(it.notes)}"></label>` : ''}
            </div>
          </div>`).join('')}</div>` : `<p class="muted small">No products found — add them on the Order tab.</p>`}
      </div>
      <footer>
        <span class="spacer"></span>
        <button type="button" class="btn" data-close>Cancel</button>
        <button type="submit" class="btn primary">Save to order</button>
      </footer>
    </form>`, {
    wide: true,
    onOpen(sheet) {
      const sel = $('[name=client_choice]', sheet);
      if (sel) sel.addEventListener('change', () => { $('.ai-new-client', sheet).hidden = sel.value !== 'new'; });
    },
    async onSubmit(fd) {
      const patch = {};
      // Client
      const choice = fd.get('client_choice');
      if (choice === 'existing' && match) patch.client_id = match.id;
      if (choice === 'new' && clean(fd.get('c_name'))) {
        const row = {
          name: clean(fd.get('c_name')),
          email: clean(fd.get('c_email')),
          phone: clean(fd.get('c_phone')),
          address: clean(fd.get('c_address')),
          notes: '',
        };
        if (fd.has('c_vat') && store.all('clients').some(x => 'tax_id' in x)) row.tax_id = clean(fd.get('c_vat'));
        try {
          const client = await store.insert('clients', row);
          patch.client_id = client.id;
          if (clean(fd.get('c_contact')) && clean(fd.get('c_contact')) !== row.name) {
            await store.insert('contacts', { client_id: client.id, name: clean(fd.get('c_contact')), email: row.email, phone: row.phone }).catch(() => {});
          }
        } catch (err) { return true; }
      }
      // Order details
      if (fd.get('use_name') === 'on' && clean(fd.get('name'))) patch.name = clean(fd.get('name'));
      if (fd.get('use_notes') === 'on' && clean(fd.get('notes'))) patch.description = [clean(p.description), clean(fd.get('notes'))].filter(Boolean).join('\n\n');
      if (fd.get('use_address') === 'on' && 'delivery_address' in p) patch.delivery_address = clean(fd.get('delivery_address'));
      if (fd.get('use_deadline') === 'on' && fd.get('deadline')) patch.due_date = fd.get('deadline');
      if (Object.keys(patch).length) store.update('projects', p.id, patch).catch(() => {});
      // Products
      let order = nextSortOrder(productsOf(p.id));
      let added = 0;
      products.forEach((_, i) => {
        const name = clean(fd.get(`p_name_${i}`));
        if (fd.get(`pick_${i}`) !== 'on' || !name) return;
        added++;
        store.insert('items', {
          project_id: p.id,
          name,
          quantity: parseAmount(fd.get(`p_qty_${i}`)) || 1,
          dimensions: clean(fd.get(`p_dim_${i}`)),
          materials: clean(fd.get(`p_mat_${i}`)),
          description: clean(fd.get(`p_notes_${i}`)),
          sort_order: order++,
        }).catch(() => {});
      });
      toast(added ? `Added ${added} product${added === 1 ? '' : 's'} from the inquiry` : 'Order updated');
      location.hash = `#/project/${p.id}/order`;
    },
  });
}

// ---------- Supplier quote → product costs ----------

const words = s => new Set(clean(s).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 2));

// Pair each quote line with the product it most likely prices (each product used once).
function matchLines(lines, products, att) {
  if (att.item_id && lines.length === 1 && products.some(i => i.id === att.item_id)) return [att.item_id];
  const used = new Set();
  return lines.map(l => {
    const lw = words(`${l.description} ${l.dimensions || ''}`);
    let best = null; let bestScore = 0;
    products.forEach(i => {
      if (used.has(i.id)) return;
      const iw = words(i.name);
      let score = 0;
      iw.forEach(w => { if (lw.has(w)) score++; });
      if (score > bestScore) { best = i; bestScore = score; }
    });
    if (best) { used.add(best.id); return best.id; }
    return 'new';
  });
}

function reviewSupplierQuote(p, att, r) {
  const lines = Array.isArray(r.lines) ? r.lines : [];
  const products = productsOf(p.id);
  const matches = matchLines(lines, products, att);
  const cur = clean(r.currency).toUpperCase();
  const otherCurrency = cur && cur !== p.currency;
  const choices = (sel) => `<option value="new" ${sel === 'new' ? 'selected' : ''}>New product</option>`
    + products.map(i => `<option value="${i.id}" ${sel === i.id ? 'selected' : ''}>${esc(i.name)}</option>`).join('')
    + `<option value="skip">Don't use</option>`;

  openSheet(`
    <form class="ai-review">
      ${sheetHeader('Check the supplier quote')}
      <div class="fields">
        <p class="muted small">From <b>${esc(att.name)}</b>. Costs are per piece, excluding VAT. Check each line, then save.</p>
        ${otherCurrency ? `<div class="notice warn">This quote is in <b>${esc(cur)}</b> but the order is in <b>${esc(p.currency)}</b>. Convert the costs before saving.</div>` : ''}
        <div class="field-row">
          <label class="field"><span>Supplier / workshop</span><input name="supplier" value="${esc(r.supplier || '')}"></label>
          <label class="field"><span>Quote no.</span><input name="supplier_ref" value="${esc(r.quote_number || '')}"></label>
        </div>
        <h3 class="sheet-sub">Lines (${lines.length})</h3>
        ${lines.length ? `<div class="ai-lines">${lines.map((l, i) => `
          <div class="ai-line">
            <div class="ai-line-fields">
              <div class="ai-line-desc"><b>${esc(l.description || 'Line ' + (i + 1))}</b>
                <span class="muted small">${esc([l.dimensions, l.materials].filter(x => clean(x)).join(' · '))}</span></div>
              <div class="field-row three">
                <label class="field"><span>For product</span><select name="m_${i}">${choices(matches[i])}</select></label>
                <label class="field"><span>Qty</span><input name="q_${i}" value="${esc(String(num(l.quantity) || 1))}" inputmode="decimal"></label>
                <label class="field"><span>Cost per piece (${esc(p.currency)})</span><input name="c_${i}" value="${num(l.unit_cost) ? esc(String(num(l.unit_cost))) : ''}" inputmode="decimal"></label>
              </div>
            </div>
          </div>`).join('')}</div>` : `<p class="muted small">No prices found in this document.</p>`}
        ${num(r.shipping_cost) ? `<p class="muted small">The quote also lists ${esc(money(num(r.shipping_cost), cur || p.currency))} for transport — add it under Shipping if you pay it.</p>` : ''}
        ${clean(r.notes) ? `<p class="muted small">Notes on the quote: ${esc(r.notes)}</p>` : ''}
      </div>
      <footer>
        <span class="spacer"></span>
        <button type="button" class="btn" data-close>Cancel</button>
        <button type="submit" class="btn primary">Save costs</button>
      </footer>
    </form>`, {
    wide: true,
    onSubmit(fd) {
      const supplier = clean(fd.get('supplier'));
      const ref = clean(fd.get('supplier_ref'));
      let order = nextSortOrder(products);
      const touched = new Set();
      let n = 0;
      lines.forEach((l, i) => {
        const target = fd.get(`m_${i}`);
        if (target === 'skip') return;
        const unitCost = parseAmount(fd.get(`c_${i}`));
        const qty = parseAmount(fd.get(`q_${i}`)) || 1;
        if (target === 'new') {
          if (!clean(l.description)) return;
          n++;
          store.insert('items', {
            project_id: p.id,
            name: clean(l.description).slice(0, 120),
            quantity: qty,
            dimensions: clean(l.dimensions),
            materials: clean(l.materials),
            supplier, supplier_ref: ref,
            unit_cost: unitCost,
            sort_order: order++,
          }).catch(() => {});
          return;
        }
        const it = store.get('items', target);
        if (!it) return;
        n++;
        touched.add(it.id);
        const patch = { unit_cost: unitCost, supplier: supplier || it.supplier, supplier_ref: ref || it.supplier_ref };
        if (!clean(it.dimensions) && clean(l.dimensions)) patch.dimensions = clean(l.dimensions);
        if (!clean(it.materials) && clean(l.materials)) patch.materials = clean(l.materials);
        store.update('items', it.id, patch).catch(() => {});
      });
      // A quote for a single product is kept with that product.
      if (touched.size === 1 && !att.item_id && store.fileSections) {
        store.update('attachments', att.id, { item_id: [...touched][0], kind: 'supplier_quote' }).catch(() => {});
      }
      toast(n ? `Saved costs for ${n} product${n === 1 ? '' : 's'} — set the client prices next` : 'Nothing saved');
      location.hash = `#/project/${p.id}/order`;
    },
  });
}
