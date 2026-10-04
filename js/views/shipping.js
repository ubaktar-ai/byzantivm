// Shipping tab: delivery address, shipments (carrier, tracking, dates, cost) and the packing list.
import { esc, icon, money, todayStr, fmtDate, label, openSheet, closeSheet, sheetHeader, options, toast, $ } from '../lib.js';
import { store, shipmentsOf, productsOf } from '../store.js';
import { parseAmount, ordersReady } from '../money.js';
import { emptyState } from './common.js';

export const SHIPMENT_STATUSES = [
  { id: 'preparing', label: 'Preparing' },
  { id: 'shipped', label: 'Shipped' },
  { id: 'delivered', label: 'Delivered' },
];

const CARRIERS = ['UPS', 'FedEx', 'DHL Express', 'DHL Freight', 'DPD', 'PostNL', 'GLS', 'TNT', 'Own transport', 'Freight forwarder'];

// Tap-to-track links for the common carriers.
export function trackingUrl(carrier, code) {
  if (!code) return '';
  const c = (carrier || '').toLowerCase();
  const t = encodeURIComponent(code.trim());
  if (c.includes('ups')) return `https://www.ups.com/track?tracknum=${t}`;
  if (c.includes('fedex')) return `https://www.fedex.com/fedextrack/?trknbr=${t}`;
  if (c.includes('dhl')) return `https://www.dhl.com/global-en/home/tracking/tracking-express.html?tracking-id=${t}`;
  if (c.includes('postnl')) return `https://jouw.postnl.nl/track-and-trace/${t}`;
  if (c.includes('dpd')) return `https://tracking.dpd.de/status/en_US/parcel/${t}`;
  if (c.includes('gls')) return `https://gls-group.com/track/${t}`;
  return '';
}

export function deliveryAddress(p) {
  const client = store.get('clients', p.client_id);
  return (p.delivery_address || '').trim() || (client && client.address) || '';
}

export function shippingTab(p) {
  if (!ordersReady()) {
    return `<div class="notice warn">The database needs an update before shipping can be used: run <code>supabase/migrations/005_order_workflow.sql</code> in the Supabase SQL Editor.</div>`;
  }
  const client = store.get('clients', p.client_id);
  const list = shipmentsOf(p.id);
  const bal = store.all('invoices').filter(i => i.project_id === p.id && i.kind === 'balance' && i.status !== 'cancelled').pop();
  const products = productsOf(p.id);
  const totalWeight = products.reduce((s, i) => s + (Number(i.weight_kg) || 0) * (Number(i.quantity) || 0), 0);
  const addr = deliveryAddress(p);

  return `
    ${bal && bal.status !== 'paid' ? `<div class="notice warn">The balance invoice (${esc(bal.number)}) isn't paid yet — ship once it's received.
      <button class="btn small" data-action="wf" data-step="balance-paid" data-id="${p.id}">Balance received</button></div>` : ''}
    <div class="two-col">
      <div>
        <h2 class="section section-with-action">Shipments <button class="btn small" data-action="new-shipment" data-project="${p.id}">${icon.plus} Shipment</button></h2>
        ${list.length ? `<div class="card-surface">${list.map(sh => {
          const url = trackingUrl(sh.carrier, sh.tracking);
          return `
            <div class="money-row" data-action="edit-shipment" data-id="${sh.id}">
              <div class="mr-main">
                <b>${esc(sh.carrier || 'Shipment')}${sh.packages ? ` <span class="muted">· ${esc(sh.packages)}</span>` : ''}</b>
                <span class="muted small">
                  ${sh.tracking ? (url ? `<a href="${esc(url)}" target="_blank" rel="noopener" class="track-link">${esc(sh.tracking)} ${icon.external}</a>` : esc(sh.tracking)) : 'No tracking number'}
                  ${sh.shipped_date ? ` · shipped ${esc(fmtDate(sh.shipped_date))}` : ''}${sh.delivered_date ? ` · delivered ${esc(fmtDate(sh.delivered_date))}` : ''}
                </span>
              </div>
              <span class="chip ship-${esc(sh.status)}">${esc(label(SHIPMENT_STATUSES, sh.status))}</span>
              ${sh.status === 'preparing' ? `<button class="btn small" data-action="wf" data-step="shipped" data-id="${p.id}">Mark shipped</button>`
                : sh.status === 'shipped' ? `<button class="btn small" data-action="wf" data-step="delivered" data-id="${p.id}">${icon.check} Delivered</button>` : ''}
              <b class="mr-amount">${Number(sh.cost) ? esc(money(sh.cost, p.currency)) : ''}</b>
            </div>`;
        }).join('')}</div>`
          : emptyState('No shipment yet', 'Add the carrier, tracking number and shipping cost when the order is ready to go.',
            `<button class="btn primary" data-action="new-shipment" data-project="${p.id}">${icon.plus} Add shipment</button>`)}
      </div>
      <div>
        <h2 class="section section-with-action">Deliver to <button class="btn small" data-action="edit-delivery" data-id="${p.id}">${icon.edit} Change</button></h2>
        <div class="card-surface pad">
          ${client ? `<b>${esc(client.name)}</b><br>` : ''}
          ${addr ? `<span class="prewrap">${esc(addr)}</span>` : '<span class="muted">No address yet — add the client\'s address or a delivery address.</span>'}
          ${!(p.delivery_address || '').trim() && addr ? `<p class="muted small">Using the client's address.</p>` : ''}
        </div>
        <h2 class="section">Packing list</h2>
        <div class="card-surface pad">
          <p class="muted small">${products.length} product${products.length === 1 ? '' : 's'} · ${products.reduce((s, i) => s + (Number(i.quantity) || 0), 0)} pieces${totalWeight ? ` · ${Math.round(totalWeight)} kg` : ''}</p>
          <button class="btn" data-action="wf" data-step="packing" data-id="${p.id}">Packing list PDF</button>
        </div>
      </div>
    </div>`;
}

export function openShipmentSheet(projectId, existing, defaults = {}) {
  const p = store.get('projects', projectId);
  const sh = existing || { carrier: '', tracking: '', status: defaults.status || 'preparing', shipped_date: defaults.status === 'shipped' ? todayStr() : null, delivered_date: null, cost: 0, packages: '', notes: '' };
  openSheet(`
    <form>
      ${sheetHeader(existing ? 'Shipment' : 'New shipment')}
      <div class="fields">
        <div class="field-row">
          <label class="field"><span>Carrier</span><input name="carrier" value="${esc(sh.carrier)}" list="carrier-list" autocomplete="off" ${existing ? '' : 'autofocus'}></label>
          <label class="field"><span>Tracking number</span><input name="tracking" value="${esc(sh.tracking)}" autocapitalize="characters" autocomplete="off"></label>
        </div>
        <datalist id="carrier-list">${CARRIERS.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
        <div class="field-row three">
          <label class="field"><span>Status</span><select name="status">${options(SHIPMENT_STATUSES, sh.status)}</select></label>
          <label class="field"><span>Shipped on</span><input type="date" name="shipped_date" value="${esc(sh.shipped_date || '')}"></label>
          <label class="field"><span>Delivered on</span><input type="date" name="delivered_date" value="${esc(sh.delivered_date || '')}"></label>
        </div>
        <div class="field-row">
          <label class="field"><span>Packages</span><input name="packages" value="${esc(sh.packages)}" placeholder="e.g. 2 crates, 3 boxes"></label>
          <label class="field"><span>Shipping cost (${esc(p.currency)})</span><input name="cost" value="${Number(sh.cost) ? esc(String(sh.cost)) : ''}" inputmode="decimal" placeholder="0"></label>
        </div>
        <label class="field"><span>Notes</span><textarea name="notes" rows="2" placeholder="Pickup time, insurance, customs…">${esc(sh.notes)}</textarea></label>
      </div>
      <footer>
        ${existing ? `<button type="button" class="btn danger" data-delete>Delete</button>` : ''}
        <span class="spacer"></span>
        <button type="button" class="btn" data-close>Cancel</button>
        <button type="submit" class="btn primary">${existing ? 'Save' : 'Add shipment'}</button>
      </footer>
    </form>`, {
    onOpen(sheet) {
      const status = $('[name=status]', sheet);
      status.addEventListener('change', () => {
        if (status.value !== 'preparing' && !$('[name=shipped_date]', sheet).value) $('[name=shipped_date]', sheet).value = todayStr();
        if (status.value === 'delivered' && !$('[name=delivered_date]', sheet).value) $('[name=delivered_date]', sheet).value = todayStr();
      });
      const del = sheet.querySelector('[data-delete]');
      if (del) del.addEventListener('click', () => {
        if (!confirm('Delete this shipment?')) return;
        closeSheet();
        store.remove('shipments', existing.id).catch(() => {});
      });
    },
    onSubmit(fd) {
      const data = {
        carrier: String(fd.get('carrier') || '').trim(),
        tracking: String(fd.get('tracking') || '').trim(),
        status: fd.get('status'),
        shipped_date: fd.get('shipped_date') || null,
        delivered_date: fd.get('delivered_date') || null,
        packages: String(fd.get('packages') || '').trim(),
        cost: parseAmount(fd.get('cost')),
        notes: fd.get('notes') || '',
      };
      if (existing) store.update('shipments', existing.id, data).catch(() => {});
      else store.insert('shipments', { ...data, project_id: projectId }).catch(() => {});
      if (data.status === 'delivered' && p.stage !== 'delivered') {
        toast('Shipment delivered', { label: 'Complete order', run: () => import('./order.js').then(m => m.runStep('delivered', store.get('projects', projectId))) });
      }
    },
  });
}

export function openDeliverySheet(p) {
  const client = store.get('clients', p.client_id);
  openSheet(`
    <form>
      ${sheetHeader('Delivery address')}
      <div class="fields">
        <label class="field"><span>Deliver to</span><textarea name="delivery_address" rows="4" autofocus placeholder="${esc(client && client.address ? client.address : 'Street, number\nPostcode City\nCountry')}">${esc(p.delivery_address || '')}</textarea></label>
        <p class="muted small">Leave empty to use the client's address${client && client.address ? '' : ' (none saved yet)'}.</p>
      </div>
      <footer><span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">Save</button></footer>
    </form>`, {
    onSubmit(fd) {
      store.update('projects', p.id, { delivery_address: String(fd.get('delivery_address') || '').trim() }).catch(() => {});
    },
  });
}
