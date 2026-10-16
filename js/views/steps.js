// "Steps": the whole order on one screen, one card per step, one or two buttons each (lighting).
//   1 Client's request → AI product cards   2 Ask the supplier for prices   3 Supplier's prices back
//   4 Cost sheet & your prices              5 Proposal & tear sheets for the client   6–7 Client's reply, revisions
//   8 Client's PO → invoice   9 Payments → supplier payout slips   10 Ready to ship → balance   11 Quality control
// Everything else (spec details, approvals, inspections…) stays in its own tab, out of the way.
import { esc, icon, money, toast, openSheet, closeSheet, sheetHeader, $ } from '../lib.js';
import { store, productsOf, nextSortOrder } from '../store.js';
import { SPEC_SECTIONS, fieldValue, visible } from '../qc-spec.js';
import { parseAmount } from '../money.js';
import { lightingOf, fieldHtml, readSpec, wireSpecFields, photoPicker, wirePhotos, templateOf, itemNo } from './qc.js';
import { openProposal, acceptedProposal, createOrUpdateProposal } from './order.js';
import { pricesOf, pricesReady } from './prices.js';
import { uploadFiles } from '../files.js';
import { paySteps } from './payments.js';
import { roundsSteps, openClientReply, markSent, readNewPrices, makeRevisedProposal, withChanges, unsent } from './rounds.js';

const num = v => Number(v) || 0;
const round2 = n => Math.round(n * 100) / 100;
const FIELD = Object.fromEntries(SPEC_SECTIONS.flatMap(s => s.fields).map(f => [f.key, f]));
// The few details a product card asks for (everything else stays in the full spec).
const CARD_FIELDS = ['overall_size', 'diameter', 'body_material', 'glass', 'finish', 'source_type', 'cct', 'dimming', 'voltage'].map(k => FIELD[k]);

const val = (it, key) => { const s = (it && it.spec) || {}; return FIELD[key] && visible(FIELD[key], s) ? fieldValue(FIELD[key], s) : ''; };
export const cardPicture = it => {
  const s = (it && it.spec) || {};
  return [...((s._images || {}).offer || []), ...((s._tear || {}).images || []), ...((s._original || {}).images || []), ...((s._images || {}).vision || [])]
    .map(id => store.get('attachments', id)).find(a => a && /^image\//.test(a.mime || '')) || null;
};
const summary = it => [val(it, 'overall_size') || val(it, 'diameter') || it.dimensions, val(it, 'body_material') || it.materials, val(it, 'finish'),
  val(it, 'source_type') && [val(it, 'source_type'), val(it, 'cct')].filter(Boolean).join(' '), val(it, 'dimming')].filter(Boolean).join(' · ');

function step(n, title, status, body, { done = false, open = true } = {}) {
  return `<section class="card-surface flow-step ${done ? 'done' : ''}">
    <header class="flow-head"><span class="flow-no">${done ? icon.check : n}</span><h3>${esc(title)}</h3>${status ? `<span class="flow-status muted small">${status}</span>` : ''}</header>
    ${open ? `<div class="flow-body">${body}</div>` : ''}
  </section>`;
}

export function stepsTab(p) {
  const cards = lightingOf(p.id);
  const m = v => money(v, p.currency);
  const priced = cards.filter(i => num(i.unit_cost));
  const selling = cards.filter(i => num(i.unit_price));
  const proposal = openProposal(p.id) || acceptedProposal(p.id);
  const links = store.all('qc_links').filter(l => l.project_id === p.id && l.purpose === 'quote' && !l.revoked_at);
  const totals = cards.reduce((t, i) => ({ cost: t.cost + num(i.unit_cost) * num(i.quantity), price: t.price + num(i.unit_price) * num(i.quantity) }), { cost: 0, price: 0 });
  const profit = round2(totals.price - totals.cost);
  const margin = totals.price ? Math.round((profit / totals.price) * 100) : null;

  // 1 — client's request → product cards
  const s1 = `
    <p class="muted small">Add everything the client sent — photos, screenshots of emails, PDFs, links. The AI makes one product card per light; you check them before they're saved.</p>
    <div class="qc-actions">
      <button class="btn primary" data-action="finder-open" data-id="${p.id}">✨ Add from client files</button>
      <button class="btn" data-action="card-new" data-id="${p.id}">${icon.plus} Card by hand</button>
    </div>
    ${cards.length ? `<div class="flow-cards">${cards.map(it => {
      const pic = cardPicture(it);
      return `<button type="button" class="flow-card" data-action="card-edit" data-id="${it.id}">
        <span class="flow-pic">${pic ? `<img data-path="${esc(pic.path)}" alt="">` : '<span class="muted small">No picture</span>'}</span>
        <span class="flow-card-text"><b>${esc(itemNo(it))} · ${esc(it.name)}</b> <span class="muted">× ${esc(String(num(it.quantity) || 1))}</span>
          <span class="muted small">${esc(summary(it) || 'Tap to add the details')}</span>
          ${unsent(it) ? '<span class="chip warn">Changed — not sent to supplier</span>' : ''}
          ${(it.spec || {})._original ? `<span class="muted small">Based on ${esc([it.spec._original.brand, it.spec._original.model].filter(Boolean).join(' '))}</span>` : ''}</span>
      </button>`;
    }).join('')}</div>` : ''}`;

  // 2 — ask the supplier
  const s2 = `
    <p class="muted small">Send the cards to the supplier: one PDF with all cards, a PDF per card, or a link where they type their prices. They never see the original's price, your prices or the client.</p>
    <div class="qc-actions">
      <button class="btn primary" data-action="flow-rfq-all" data-id="${p.id}" ${cards.length ? '' : 'disabled'}>One PDF with all cards</button>
      <button class="btn" data-action="flow-rfq-each" data-id="${p.id}" ${cards.length ? '' : 'disabled'}>A PDF per card</button>
      ${pricesReady() ? `<button class="btn" data-action="price-request" data-id="${p.id}" ${cards.length ? '' : 'disabled'}>Send a price link</button>` : ''}
    </div>
    ${links.length ? `<p class="small">Price links: ${links.map(l => `<b>${esc(l.label || 'Supplier')}</b>`).join(', ')} <a href="#/project/${p.id}/qc">see answers</a></p>` : ''}`;

  // 3 — supplier's prices back
  const s3 = `
    <p class="muted small">When the supplier sends the cards back with prices (PDF, photo or their own quote), upload it. The AI reads the prices and puts them on the right cards — you check them first.</p>
    <div class="qc-actions">
      <label class="btn primary upload-btn">${icon.upload}<span>Upload supplier's prices</span><input type="file" hidden accept="image/*,application/pdf" data-flow-supplier="${p.id}"></label>
    </div>
    ${cards.length ? `<p class="small">${priced.length} of ${cards.length} card${cards.length === 1 ? '' : 's'} have a cost.${pricesReady() && cards.some(i => pricesOf(i.id).length) ? ' Prices from links and documents are kept in the QC tab.' : ''}</p>` : ''}`;

  // 4 — cost sheet & your prices
  const s4 = cards.length ? `
    <div class="flow-table-wrap"><table class="flow-table">
      <thead><tr><th>Card</th><th>Qty</th><th>Cost / pc</th><th>Your price / pc</th><th>Profit</th><th>Margin</th></tr></thead>
      <tbody>${cards.map(it => {
        const c = num(it.unit_cost), pr = num(it.unit_price), q = num(it.quantity) || 1;
        const mg = pr && c ? Math.round(((pr - c) / pr) * 100) : null;
        const o = (it.spec || {})._original;
        return `<tr>
          <td><b>${esc(it.name)}</b>${o && o.retail_price ? `<br><span class="muted small">original retail ${esc(money(o.retail_price, /^[A-Z]{3}$/.test(o.currency || '') ? o.currency : p.currency))}</span>` : ''}</td>
          <td>${esc(String(q))}</td>
          <td><input class="flow-in" data-flow-cost="${it.id}" value="${c ? esc(String(c)) : ''}" inputmode="decimal" placeholder="—" aria-label="Cost per piece"></td>
          <td><input class="flow-in" data-flow-price="${it.id}" value="${pr ? esc(String(pr)) : ''}" inputmode="decimal" placeholder="—" aria-label="Your price per piece"></td>
          <td>${c && pr ? esc(m((pr - c) * q)) : '—'}</td>
          <td class="${mg == null ? '' : mg < 20 ? 'bad-text' : 'good-text'}">${mg == null ? '—' : `${mg}%`}</td>
        </tr>`;
      }).join('')}</tbody>
      <tfoot><tr><td><b>Total</b></td><td></td><td>${esc(m(totals.cost))}</td><td>${esc(m(totals.price))}</td><td><b>${esc(m(profit))}</b></td><td>${margin == null ? '—' : `${margin}%`}</td></tr></tfoot>
    </table></div>
    <div class="flow-margin">
      <label class="field"><span>Margin for empty prices</span><input name="flow-margin" inputmode="decimal" placeholder="e.g. 45" style="max-width:110px"></label>
      <button class="btn small" data-action="flow-apply-margin" data-id="${p.id}">Fill prices</button>
      <span class="spacer"></span>
      <button class="btn small" data-action="wf" data-step="cost-report" data-id="${p.id}">Cost sheet PDF</button>
    </div>
    <p class="muted small">Prices exclude tax. Type in the table; it saves when you leave the box. Margin = profit ÷ your price.</p>` : '<p class="muted small">Add product cards first.</p>';

  // 5 — proposal & tear sheets
  const s5 = `
    <label class="field"><span>Special notes for the client</span>
      <textarea data-flow-notes="${p.id}" rows="3" placeholder="e.g. Lead time 10–12 weeks after deposit · prices ex works Miami · samples on request">${esc((proposal && proposal.notes) || '')}</textarea></label>
    <div class="qc-actions">
      <button class="btn primary" data-action="flow-proposal" data-id="${p.id}" ${cards.length ? '' : 'disabled'}>${proposal ? 'Update proposal PDF' : 'Make proposal PDF'}</button>
      <button class="btn" data-action="tear-order" data-id="${p.id}" ${cards.length ? '' : 'disabled'}>Tear sheets for the client</button>
    </div>
    ${proposal ? `<p class="small">Proposal <b>${esc(proposal.number || '')}</b> · ${esc(proposal.status === 'approved' ? 'accepted by the client' : 'sent')} — <a href="#/project/${p.id}/money">see it under Money</a></p>` : ''}`;

  const s6 = `<p class="muted small">Specs, approvals by us, the supplier and the client, samples, inspections and packing — in its own tab.</p>
    <a class="btn" href="#/project/${p.id}/qc">Open quality control</a>`;

  return `
    <div class="flow">
      ${step(1, 'Client’s request → product cards', cards.length ? `${cards.length} card${cards.length === 1 ? '' : 's'}` : '', s1, { done: cards.length > 0 })}
      ${step(2, 'Ask the supplier for prices', links.length ? 'link sent' : '', s2)}
      ${step(3, 'Supplier’s prices', cards.length ? `${priced.length}/${cards.length} priced` : '', s3, { done: cards.length > 0 && priced.length === cards.length })}
      ${step(4, 'Cost sheet & your prices', cards.length ? `${selling.length}/${cards.length} with your price${margin != null ? ` · margin ${margin}%` : ''}` : '', s4, { done: cards.length > 0 && selling.length === cards.length })}
      ${step(5, 'Proposal & tear sheets for the client', proposal ? (proposal.status === 'approved' ? 'accepted' : 'sent') : '', s5, { done: !!proposal })}
      ${roundsSteps(p, step)}
      ${paySteps(p, step)}
      ${step(11, 'Quality control', '', s6)}
    </div>`;
}

// ---------- The simple product card editor ----------

function openCardSheet(p, existing) {
  const it = existing || { name: '', quantity: 1, description: '', spec: {} };
  const spec = { ...(it.spec || {}) };
  const template = templateOf(p);
  const bag = { card: [...((spec._images || {}).offer || [])] };
  const others = [...((spec._original || {}).images || []), ...((spec._images || {}).vision || [])].map(id => store.get('attachments', id)).filter(a => a && /^image\//.test(a.mime || ''));
  openSheet(`
    <form class="spec-form card-form">
      ${sheetHeader(existing ? it.name : 'New product card')}
      <div class="fields">
        <div class="field-row">
          <label class="field grow"><span>Product</span><input name="name" required value="${esc(it.name)}" placeholder="e.g. Pendant — opal glass globe"></label>
          <label class="field qty-field"><span>Qty</span><input name="quantity" value="${esc(String(num(it.quantity) || 1))}" inputmode="decimal"></label>
        </div>
        <div class="field"><span>Pictures</span>${photoPicker('card', 'Add pictures', true)}
          ${others.length ? `<span class="muted small">Also on the card: ${others.length} picture${others.length === 1 ? '' : 's'} from the client and the original.</span>` : ''}</div>
        <div class="spec-grid">${CARD_FIELDS.map(f => fieldHtml(f, spec, template, { toggles: () => '' })).join('')}</div>
        <label class="field"><span>Notes / special requests</span><textarea name="description" rows="3">${esc(it.description || '')}</textarea></label>
        ${existing ? `<p class="muted small">More details (driver, mounting, certification…) are in the <button type="button" class="link-btn" data-action="qc-spec" data-id="${it.id}">full spec</button>.</p>` : ''}
      </div>
      <footer>
        ${existing ? '<button type="button" class="btn danger" data-delete-card>Delete</button>' : ''}
        <span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">Save</button>
      </footer>
    </form>`, {
    wide: true,
    onOpen(sheet) {
      const form = $('form', sheet);
      wirePhotos(sheet, { project_id: p.id, item_id: existing ? existing.id : null }, bag, { removable: true });
      bag.onChange = () => { sheet.dataset.dirty = '1'; };
      wireSpecFields(form, spec, template);
      const del = $('[data-delete-card]', form);
      if (del) del.addEventListener('click', async () => {
        if (!confirm(`Delete “${it.name}”?`)) return;
        await store.remove('items', existing.id).catch(() => {});
        closeSheet();
      });
    },
    async onSubmit(fd, form) {
      const next = readSpec(form, spec);
      next._images = { ...(spec._images || {}), offer: bag.card || [] };
      const row = {
        name: String(fd.get('name') || '').trim(), quantity: parseAmount(fd.get('quantity')) || 1,
        description: String(fd.get('description') || '').trim(), spec: next, category: 'lighting',
        dimensions: next.overall_size || next.diameter || it.dimensions || '', materials: [next.body_material, next.finish].filter(Boolean).join(', ') || it.materials || '',
      };
      // After the proposal, edits are changes: marked on the card until they're sent to the supplier.
      if (existing && (openProposal(p.id) || acceptedProposal(p.id))) {
        const watch = [...CARD_FIELDS.map(f => f.key), 'quantity', 'name'];
        const before = k => (k === 'quantity' ? String(num(it.quantity) || 1) : k === 'name' ? it.name : String((it.spec || {})[k] || ''));
        const after = k => (k === 'quantity' ? String(row.quantity) : k === 'name' ? row.name : String(next[k] || ''));
        const changes = watch.filter(k => before(k) !== after(k)).map(k => ({ key: k, label: k === 'quantity' ? 'Quantity' : k === 'name' ? 'Name' : FIELD[k].label, from: before(k), to: after(k) }));
        if (changes.length) {
          const marked = withChanges({ ...it, spec: next }, changes, { by: 'us' });
          row.spec = { ...next, _rev: marked._rev, _history: marked._history };
        }
      }
      try {
        if (existing) await store.update('items', existing.id, row);
        else await store.insert('items', { project_id: p.id, sort_order: nextSortOrder(productsOf(p.id)), ...row });
      } catch (err) { return false; }
      toast('Card saved');
    },
  });
}

// ---------- Actions ----------

async function applyMargin(p) {
  const el = document.querySelector('[name=flow-margin]');
  const pct = parseAmount(el && el.value);
  if (!(pct > 0 && pct < 100)) { toast('Type a margin between 1 and 99 %'); return; }
  const todo = lightingOf(p.id).filter(i => num(i.unit_cost) && !num(i.unit_price));
  if (!todo.length) { toast('Every card with a cost already has a price'); return; }
  // Margin on the selling price: price = cost ÷ (1 − margin).
  for (const it of todo) await store.update('items', it.id, { unit_price: round2(num(it.unit_cost) / (1 - pct / 100)) }).catch(() => {});
  toast(`Prices filled for ${todo.length} card${todo.length === 1 ? '' : 's'}`);
}

function openEachPdfSheet(p) {
  const cards = lightingOf(p.id);
  openSheet(`<div>${sheetHeader('A PDF per card')}<div class="fields"><p class="muted small">Tap a card to make its PDF for the supplier.</p>
    <div class="qc-rows">${cards.map(it => `<button type="button" class="qc-row" data-rfq-one="${it.id}"><span>${esc(itemNo(it))} · ${esc(it.name)}</span><span class="muted small">PDF</span></button>`).join('')}</div></div>
    <footer><span class="spacer"></span><button type="button" class="btn" data-close>Close</button></footer></div>`, {
    onOpen(sheet) {
      sheet.addEventListener('click', e => {
        const b = e.target.closest('[data-rfq-one]');
        if (b) import('../qc-pdf.js').then(mod => mod.createRfqPdf(p.id, [b.dataset.rfqOne]));
      });
    },
  });
}

export function stepsAction(action, el) {
  const id = el.dataset.id;
  const p = store.get('projects', id);
  const it = store.get('items', id);
  if (action === 'card-new' && p) openCardSheet(p);
  else if (action === 'card-edit' && it) openCardSheet(store.get('projects', it.project_id), it);
  else if (action === 'flow-rfq-all' && p) import('../qc-pdf.js').then(mod => mod.createRfqPdf(p.id, lightingOf(p.id).map(i => i.id)));
  else if (action === 'flow-rfq-each' && p) openEachPdfSheet(p);
  else if (action === 'flow-apply-margin' && p) applyMargin(p);
  else if (action === 'flow-reply' && p) openClientReply(p);
  else if (action === 'flow-send-changed' && p) {
    const ids = lightingOf(p.id).filter(unsent).map(i => i.id);
    if (ids.length) import('../qc-pdf.js').then(mod => mod.createRfqPdf(p.id, ids)).then(() => markSent(p, ids));
  }
  else if (action === 'flow-revised' && p) makeRevisedProposal(p).catch(err => console.error(err));
  else if (action === 'flow-proposal' && p) {
    const notes = (document.querySelector(`[data-flow-notes="${p.id}"]`) || {}).value;
    createOrUpdateProposal(p, { notes: notes == null ? undefined : String(notes).trim() }).catch(err => console.error(err));
  }
}

// Typing in the cost sheet, uploading the supplier's prices.
document.addEventListener('change', async e => {
  const t = e.target;
  if (t.matches && t.matches('[data-flow-cost], [data-flow-price]')) {
    const key = t.dataset.flowCost ? 'unit_cost' : 'unit_price';
    const id = t.dataset.flowCost || t.dataset.flowPrice;
    const v = t.value.trim() === '' ? 0 : parseAmount(t.value);
    if (Number.isNaN(v)) return;
    store.update('items', id, { [key]: v }).catch(() => {});
  } else if (t.matches && t.matches('[data-flow-supplier]') && t.files.length) {
    const p = store.get('projects', t.dataset.flowSupplier);
    const saved = await uploadFiles(t.files, { project_id: p.id, kind: 'supplier_quote' });
    t.value = '';
    if (saved[0]) import('../ai.js').then(m => m.readWithAI(saved[0], 'supplier'));
  } else if (t.matches && t.matches('[data-flow-newprices]') && t.files.length) {
    const p = store.get('projects', t.dataset.flowNewprices);
    const file = t.files[0];
    t.value = '';
    readNewPrices(p, file);
  } else if (t.matches && t.matches('[data-flow-notes]')) {
    const q = openProposal(t.dataset.flowNotes);
    if (q) store.update('quotes', q.id, { notes: t.value.trim() }).catch(() => {});
  }
});
