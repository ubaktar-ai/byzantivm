// Supplier prices for lights: a price-request link (the supplier sees the pictures and details, never the
// original's price, our prices or the client), prices received or typed in by hand, and accepting one as the
// product's cost. Every price is kept with the name and the time (supplier_prices is permanent).
import { esc, money, toast, openSheet, sheetHeader, fmtDate, $$ } from '../lib.js';
import { store } from '../store.js';
import { byCreated, chip, lightingOf, itemNo } from './qc.js';
import { newToken, shareLink } from './qc-more.js';
import { parseAmount } from '../money.js';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CNY', 'TRY'];
export const pricesReady = () => store.loaded && !store.missing.has('supplier_prices');
const priceLinks = pid => store.all('qc_links').filter(l => l.project_id === pid && l.purpose === 'quote').sort(byCreated);
export const pricesOf = itemId => store.all('supplier_prices').filter(r => r.item_id === itemId).sort(byCreated);
const who = r => r.person || (r.link_id ? ((store.get('qc_links', r.link_id) || {}).label || 'Supplier') : 'Supplier');
const amount = (v, cur) => { try { return money(Number(v) || 0, /^[A-Z]{3}$/.test(cur || '') ? cur : 'USD'); } catch { return `${cur} ${v}`; } };
const accepted = (it, r) => Number(it.unit_cost) === Number(r.unit_price) && (it.supplier || '') === who(r);

export function pricesBlock(p) {
  const lights = lightingOf(p.id);
  if (!lights.length) return '';
  if (!pricesReady()) {
    return `<h2 class="section">Supplier prices</h2><div class="notice warn">To ask suppliers for prices, run <code>supabase/migrations/010_supplier_prices.sql</code> in the Supabase SQL Editor.</div>`;
  }
  const links = priceLinks(p.id);
  const items = new Map(lights.map(i => [i.id, i]));
  return `
    <h2 class="section">Supplier prices</h2>
    <div class="card-surface pad">
      <p class="muted small">Send a supplier a price request: they see the pictures, our version's details, what changed from the original and the original's materials —
        never the original's price, your prices or the client. Their prices arrive here; <b>Accept</b> one to use it as the product's cost.</p>
      ${store.backend.mode === 'cloud' ? '' : '<p class="notice warn small">Price request links only work with the team database, not in demo mode. You can still add prices by hand.</p>'}
      ${lights.map(it => {
        const rows = pricesOf(it.id);
        return `<div class="price-item">
          <div class="price-head"><b>${esc(itemNo(it))} · ${esc(it.name)}</b> <span class="muted small">× ${esc(String(Number(it.quantity) || 1))}</span>
            ${(it.spec || {})._original && it.spec._original.retail_price ? `<span class="muted small">· original retail ${esc(amount(it.spec._original.retail_price, it.spec._original.currency))}</span>` : ''}</div>
          ${rows.length ? `<div class="qc-rows">${rows.map(r => `
            <div class="qc-row static">
              <span><b>${esc(amount(r.unit_price, r.currency))}</b> per piece · ${esc(who(r))}${r.lead_time ? ` · ${esc(r.lead_time)}` : ''}
                <span class="muted small"> · ${esc(fmtDate(r.created_at.slice(0, 10)))}${r.party === 'us' ? ' · typed in' : ''}${r.notes ? ` — ${esc(r.notes)}` : ''}</span></span>
              ${accepted(it, r) ? chip('Accepted ✓', 'good') : `<button class="btn small" data-action="price-accept" data-id="${r.id}">Accept</button>`}
            </div>`).join('')}</div>` : '<p class="muted small">No prices yet.</p>'}
          <button class="btn small" data-action="price-add" data-id="${it.id}">Add a price by hand</button>
        </div>`;
      }).join('')}
      ${links.length ? `<h4 class="price-links-title">Price request links</h4><div class="qc-rows">${links.map(l => `
        <div class="qc-row static">
          <span><b>${esc(l.label || 'Supplier')}</b><span class="muted small"> · ${l.item_ids.length ? l.item_ids.map(id => esc((items.get(id) || {}).name || 'removed')).join(', ') : 'all lights'} · made ${esc(fmtDate(l.created_at.slice(0, 10)))}</span></span>
          ${l.revoked_at ? chip('Switched off') : `<span class="qc-actions" style="margin:0">
            <button class="btn small" data-action="qc-link-share" data-id="${l.id}">Share</button>
            <button class="btn small" data-action="qc-link-revoke" data-id="${l.id}">Switch off</button></span>`}
        </div>`).join('')}</div>` : ''}
      <div class="qc-actions">
        <button class="btn small primary" data-action="price-request" data-id="${p.id}">New price request</button>
        <button class="btn small" data-action="price-pdf" data-id="${p.id}">Price request PDF</button>
      </div>
    </div>`;
}

function chooseLights(lights, checked = () => true) {
  return lights.map(i => `<label class="check-line"><input type="checkbox" name="item" value="${i.id}" ${checked(i) ? 'checked' : ''}> ${esc(itemNo(i))} · ${esc(i.name)}</label>`).join('');
}

function openPriceRequestSheet(p) {
  const lights = lightingOf(p.id);
  if (!lights.length) { toast('No lighting products in this order'); return; }
  openSheet(`
    <form>
      ${sheetHeader(`Price request — ${p.name}`)}
      <div class="fields">
        <label class="field"><span>Supplier</span><input name="label" required placeholder="e.g. Atelier Lumen" autocomplete="off"></label>
        <label class="field"><span>Currency for their prices</span><select name="currency">${[...new Set([p.currency || 'USD', ...CURRENCIES])].map(c => `<option ${c === (p.currency || 'USD') ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
        <div class="field"><span>Lights to price</span>${chooseLights(lights)}</div>
        <p class="muted small">The supplier sees, per light: the pictures (proposed, the original's and the client's), every detail meant for suppliers,
          what changed from the original and the original's materials. Not: the original's price or shop link, your cost or selling price, or the client's name.</p>
      </div>
      <footer><span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">Create link</button></footer>
    </form>`, {
    async onSubmit(fd) {
      const ids = fd.getAll('item');
      if (!ids.length) { toast('Choose at least one light'); return false; }
      let link;
      try {
        link = await store.insert('qc_links', {
          project_id: p.id, token: newToken(), party: 'supplier', purpose: 'quote', currency: String(fd.get('currency') || ''),
          item_ids: ids.length === lights.length ? [] : ids, label: String(fd.get('label') || '').trim(),
        });
      } catch (err) { return false; }
      setTimeout(() => shareLink(store.get('qc_links', link.id) || link), 50);
    },
  });
}

// A price that came by email, phone or a PDF quote.
function openManualPriceSheet(it) {
  const p = store.get('projects', it.project_id);
  const names = [...new Set(store.all('supplier_prices').map(r => r.person).concat(store.all('items').map(x => x.supplier)).filter(Boolean))].sort();
  openSheet(`
    <form>
      ${sheetHeader(`Add a supplier price — ${it.name}`)}
      <div class="fields">
        <label class="field"><span>Supplier</span><input name="person" required list="price-suppliers" value="${esc(it.supplier || '')}" autocomplete="off"></label>
        <datalist id="price-suppliers">${names.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
        <div class="field-row">
          <label class="field"><span>Price per piece</span><input name="unit_price" required inputmode="decimal" autocomplete="off"></label>
          <label class="field"><span>Currency</span><select name="currency">${[...new Set([(p && p.currency) || 'USD', ...CURRENCIES])].map(c => `<option>${esc(c)}</option>`).join('')}</select></label>
        </div>
        <label class="field"><span>Lead time</span><input name="lead_time" autocomplete="off"></label>
        <label class="field"><span>Notes</span><input name="notes" placeholder="e.g. from their quote no. Q-2231, excl. transport"></label>
        <p class="muted small">Saved permanently with your name and the date, like the other quality-control records.</p>
      </div>
      <footer><span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">Save price</button></footer>
    </form>`, {
    async onSubmit(fd) {
      const price = parseAmount(fd.get('unit_price'));
      if (!(price > 0)) { toast('Fill in a price per piece'); return false; }
      try {
        await store.insert('supplier_prices', {
          project_id: it.project_id, item_id: it.id, item_name: it.name, party: 'us', person: String(fd.get('person') || '').trim(),
          unit_price: price, currency: String(fd.get('currency') || ''), lead_time: String(fd.get('lead_time') || '').trim(), notes: String(fd.get('notes') || '').trim(),
        });
      } catch (err) { return false; }
      toast('Price saved');
    },
  });
}

async function acceptPrice(r) {
  const it = store.get('items', r.item_id);
  if (!it) return;
  const p = store.get('projects', it.project_id);
  if (p && r.currency && p.currency && r.currency !== p.currency
    && !confirm(`This price is in ${r.currency}, the order is in ${p.currency}. Use ${r.unit_price} as the cost anyway? (Amounts are not converted.)`)) return;
  await store.update('items', it.id, { unit_cost: Number(r.unit_price), supplier: who(r) }).catch(() => {});
  toast(`Cost of ${it.name} set to ${amount(r.unit_price, r.currency)} (${who(r)})`);
}

function openPdfSheet(p) {
  const lights = lightingOf(p.id);
  if (!lights.length) { toast('No lighting products in this order'); return; }
  openSheet(`
    <form>
      ${sheetHeader('Price request PDF')}
      <div class="fields">
        <p class="muted small">The same as the link — pictures, details, changes and the original's materials, with space for the price and lead time. No prices or client name.</p>
        <div class="field"><span>Lights</span>${chooseLights(lights)}</div>
      </div>
      <footer><span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">Make PDF</button></footer>
    </form>`, {
    onSubmit(fd, form) {
      const ids = $$('[name=item]:checked', form).map(el => el.value);
      if (!ids.length) { toast('Choose at least one light'); return false; }
      setTimeout(() => import('../qc-pdf.js').then(m => m.createRfqPdf(p.id, ids)), 50);
    },
  });
}

export function pricesAction(action, el) {
  const id = el.dataset.id;
  if (action === 'price-request') { const p = store.get('projects', id); if (p) openPriceRequestSheet(p); }
  else if (action === 'price-add') { const it = store.get('items', id); if (it) openManualPriceSheet(it); }
  else if (action === 'price-accept') { const r = store.get('supplier_prices', id); if (r) acceptPrice(r); }
  else if (action === 'price-pdf') { const p = store.get('projects', id); if (p) openPdfSheet(p); }
}
