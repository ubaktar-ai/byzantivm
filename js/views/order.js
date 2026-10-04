// The order workflow:
// Inquiry → Costing → Proposal → Deposit → Drawings → Client approval → Production → Balance → Shipping → Delivered.
// This file holds the project's Order tab (next step + products), the product sheet and the workflow steps.
import { esc, icon, money, todayStr, addDays, label, toast, openSheet, closeSheet, sheetHeader, options, uuid, fmtDate, stageIndex, $ } from '../lib.js';
import { store, productsOf, drawingOf, roundsOf, shipmentsOf, nextSortOrder } from '../store.js';
import {
  quotesOf, itemsOf, quoteTotal, invoicesOf, invoiceState, projectFinance, docDefaults, nextNumber, makePdf, parseAmount,
  docsReady, countryReady, ordersReady,
} from '../money.js';
import { emptyState } from './common.js';
import { docCard, liveFileStrip, attachmentsOfItem } from '../files.js';

const num = v => Number(v) || 0;
const round2 = n => Math.round(n * 100) / 100;

export const PRODUCTION = [
  { id: 'not_started', label: 'Not started' },
  { id: 'in_production', label: 'In production' },
  { id: 'ready', label: 'Ready' },
];

// ---------- Order state ----------

export const depositInvoice = pid => invoicesOf(pid).filter(i => i.kind === 'deposit' && i.status !== 'cancelled').pop() || null;
export const balanceInvoice = pid => invoicesOf(pid).filter(i => i.kind === 'balance' && i.status !== 'cancelled').pop() || null;
export const isPaid = inv => !!inv && inv.status === 'paid';
const openProposal = pid => quotesOf(pid).filter(q => q.status === 'draft' || q.status === 'sent').pop() || null;
const acceptedProposal = pid => quotesOf(pid).filter(q => q.status === 'approved').pop() || null;

// none | sent | changes | approved
export function drawingState(item) {
  const d = drawingOf(item.id);
  if (!d) return 'none';
  if (d.status === 'approved') return 'approved';
  const rounds = roundsOf(d.id);
  const last = rounds[rounds.length - 1];
  if (!last) return 'none';
  return last.status === 'approved' ? 'approved' : last.status === 'changes_requested' ? 'changes' : 'sent';
}

function docExtras(projectId) {
  const d = docDefaults(projectId);
  const out = {};
  if (docsReady()) { out.vat_rate = d.vat_rate; out.language = d.language; }
  if (countryReady()) out.vat_treatment = d.vat_treatment;
  return out;
}

function copyDocFields(q) {
  const out = {};
  if (docsReady()) { out.vat_rate = num(q.vat_rate); out.language = q.language || 'en'; }
  if (countryReady() && q.vat_treatment) out.vat_treatment = q.vat_treatment;
  return out;
}

const moveStage = (p, stage, extra = {}) => store.update('projects', p.id, { stage, ...extra });

// ---------- Workflow steps (buttons on the Next step card) ----------

export async function runStep(step, p) {
  try {
    switch (step) {
      case 'costing': await moveStage(p, 'costing'); break;
      case 'proposal': await createOrUpdateProposal(p); break;
      case 'accept': await acceptProposal(p); break;
      case 'deposit-paid': await markPaid(p, depositInvoice(p.id), 'drawings', 'Deposit received — drawings can start'); break;
      case 'production': await startProduction(p); break;
      case 'all-ready':
        for (const it of productsOf(p.id)) if (it.production !== 'ready') await store.update('items', it.id, { production: 'ready' });
        break;
      case 'balance': await createBalance(p); break;
      case 'balance-paid': await markPaid(p, balanceInvoice(p.id), 'shipping', 'Balance received — ready to ship'); break;
      case 'shipped': await markShipped(p); break;
      case 'delivered': await markDelivered(p); break;
      case 'packing': await import('../pdf.js').then(m => m.createPdf('packing', p.id)); break;
    }
  } catch (err) {
    console.error(err); // store already showed a message
  }
}

async function createOrUpdateProposal(p) {
  const products = productsOf(p.id);
  if (!products.length) { toast('Add the products first'); openProductSheet(p.id); return; }
  const unpriced = products.filter(i => !num(i.unit_price));
  if (unpriced.length && !confirm(`${unpriced.length} product${unpriced.length === 1 ? ' has' : 's have'} no price yet. Create the proposal anyway?`)) return;

  let q = openProposal(p.id);
  if (q) {
    await store.update('quotes', q.id, { status: 'sent', issue_date: todayStr() });
  } else {
    q = await store.insert('quotes', {
      id: uuid(), project_id: p.id, number: nextNumber('quotes', p.id), title: p.name,
      issue_date: todayStr(), valid_until: addDays(todayStr(), 30), status: 'sent', notes: '', ...docExtras(p.id),
    });
  }
  for (const old of itemsOf(q.id)) await store.remove('quote_items', old.id);
  let i = 0;
  for (const it of products) {
    await store.insert('quote_items', {
      quote_id: q.id, sort_order: i++,
      description: [it.name, it.dimensions, it.materials].filter(Boolean).join(' — '),
      quantity: num(it.quantity) || 1, unit_price: num(it.unit_price),
    });
  }
  if (stageIndex(p.stage) < stageIndex('proposal')) await moveStage(p, 'proposal');
  makePdf('quote', q.id);
}

async function acceptProposal(p) {
  const q = openProposal(p.id) || acceptedProposal(p.id);
  if (!q) { toast('Create the proposal first'); return; }
  if (q.status !== 'approved') await store.update('quotes', q.id, { status: 'approved' });
  let inv = depositInvoice(p.id);
  if (!inv) {
    const pct = num(p.deposit_pct) || 50;
    inv = await store.insert('invoices', {
      id: uuid(), project_id: p.id, kind: 'deposit', number: nextNumber('invoices', p.id),
      title: `Deposit (${pct}%)`, amount: round2(quoteTotal(q) * pct / 100), status: 'sent',
      issue_date: todayStr(), due_date: addDays(todayStr(), 14), notes: '', ...copyDocFields(q),
    });
  }
  await moveStage(p, 'deposit');
  makePdf('invoice', inv.id);
}

async function markPaid(p, inv, nextStage, message) {
  if (inv && inv.status !== 'paid') await store.update('invoices', inv.id, { status: 'paid', paid_date: todayStr() });
  await moveStage(p, nextStage);
  toast(message);
}

async function startProduction(p) {
  await moveStage(p, 'production');
  for (const it of productsOf(p.id)) if (it.production === 'not_started') await store.update('items', it.id, { production: 'in_production' });
  toast('Production started');
}

async function createBalance(p) {
  let inv = balanceInvoice(p.id);
  if (!inv) {
    const q = acceptedProposal(p.id);
    const total = q ? quoteTotal(q) : projectFinance(p.id).budget;
    const billed = invoicesOf(p.id).filter(i => i.status !== 'cancelled').reduce((s, i) => s + num(i.amount), 0);
    const pct = 100 - (num(p.deposit_pct) || 50);
    inv = await store.insert('invoices', {
      id: uuid(), project_id: p.id, kind: 'balance', number: nextNumber('invoices', p.id),
      title: `Balance (${pct}%)`, amount: round2(Math.max(0, total - billed)), status: 'sent',
      issue_date: todayStr(), due_date: addDays(todayStr(), 14), notes: '', ...(q ? copyDocFields(q) : docExtras(p.id)),
    });
  }
  await moveStage(p, 'balance');
  makePdf('invoice', inv.id);
}

async function markShipped(p) {
  const sh = shipmentsOf(p.id).filter(s => s.status === 'preparing').pop();
  if (!sh) {
    const { openShipmentSheet } = await import('./shipping.js');
    openShipmentSheet(p.id, null, { status: 'shipped' });
    return;
  }
  await store.update('shipments', sh.id, { status: 'shipped', shipped_date: sh.shipped_date || todayStr() });
  toast('Marked as shipped');
}

async function markDelivered(p) {
  for (const sh of shipmentsOf(p.id)) {
    if (sh.status !== 'delivered') await store.update('shipments', sh.id, { status: 'delivered', delivered_date: sh.delivered_date || todayStr(), shipped_date: sh.shipped_date || todayStr() });
  }
  await moveStage(p, 'delivered', { status: 'completed' });
  toast('Delivered — order complete 🎉');
}

// ---------- Next step card ----------

function btn(step, text, { primary = false, p } = {}) {
  return `<button class="btn ${primary ? 'primary' : ''}" data-action="wf" data-step="${step}" data-id="${p.id}">${text}</button>`;
}
const tabBtn = (p, tab, text) => `<a class="btn" href="#/project/${p.id}/${tab}">${text}</a>`;

function nextStep(p) {
  const products = productsOf(p.id);
  const n = products.length;
  const m = v => money(v, p.currency);
  const dep = depositInvoice(p.id);
  const bal = balanceInvoice(p.id);
  const q = openProposal(p.id) || acceptedProposal(p.id);
  const invLine = inv => inv ? `${esc(inv.number)} · ${m(inv.amount)} · ${invoiceState(inv) === 'overdue' ? '<b class="bad-text">overdue</b>' : esc(inv.status)}` : '';
  const ds = products.map(drawingState);
  const count = s => ds.filter(x => x === s).length;
  const ready = products.filter(i => i.production === 'ready').length;
  const warn = text => `<p class="notice warn small">${text}</p>`;

  switch (p.stage) {
    case 'inquiry':
      return { title: 'New inquiry', text: n ? `${n} product${n === 1 ? '' : 's'} added. Next: ask your suppliers for prices.` : 'Add the products the client is asking for.',
        actions: `<button class="btn ${n ? '' : 'primary'}" data-action="add-product" data-project="${p.id}">${icon.plus} Add product</button>${n ? btn('costing', 'Start costing →', { primary: true, p }) : ''}` };
    case 'costing': {
      const costed = products.filter(i => num(i.unit_cost)).length;
      const priced = products.filter(i => num(i.unit_price)).length;
      return { title: 'Costing', text: n ? `Supplier cost entered for <b>${costed}/${n}</b> products · price set for <b>${priced}/${n}</b>.` : 'Add products, their supplier costs and your prices.',
        actions: `<button class="btn" data-action="add-product" data-project="${p.id}">${icon.plus} Add product</button>${btn('proposal', 'Create proposal →', { primary: n > 0 && priced === n, p })}` };
    }
    case 'proposal':
      return { title: 'Proposal sent', text: q ? `Proposal <b>${esc(q.number)}</b> · ${m(quoteTotal(q))} excl. tax${q.issue_date ? ` · sent ${esc(fmtDate(q.issue_date))}` : ''}. When the client accepts, create the ${num(p.deposit_pct) || 50}% deposit invoice.` : 'No proposal yet.',
        actions: q ? `${btn('accept', `Client accepted → ${num(p.deposit_pct) || 50}% deposit invoice`, { primary: true, p })}<button class="btn" data-action="pdf-quote" data-id="${q.id}">Proposal PDF</button>${btn('proposal', 'Update from products', { p })}` : btn('proposal', 'Create proposal', { primary: true, p }) };
    case 'deposit':
      return { title: 'Waiting for the deposit', text: dep ? `Deposit invoice ${invLine(dep)}. Drawings start when it's paid.` : 'No deposit invoice yet.',
        actions: dep ? `${btn('deposit-paid', `${icon.check} Deposit received`, { primary: true, p })}<button class="btn" data-action="pdf-invoice" data-id="${dep.id}">Invoice PDF</button>` : btn('accept', 'Create deposit invoice', { primary: true, p }) };
    case 'drawings':
    case 'approval': {
      const all = n > 0 && count('approved') === n;
      const text = n ? `Drawings: <b>${count('approved')}/${n}</b> approved · ${count('sent')} waiting for the client · ${count('changes')} need changes · ${count('none')} not sent yet.` : 'Add products to make drawings for.';
      return { title: p.stage === 'drawings' ? 'Drawings' : 'Client approval', text: text + (!isPaid(dep) ? warn('The deposit hasn’t been marked as paid yet.') : ''),
        actions: `${tabBtn(p, 'drawings', 'Open drawings')}${all ? btn('production', 'All approved → start production', { primary: true, p }) : ''}` };
    }
    case 'production':
      return { title: 'Production', text: `<b>${ready}/${n}</b> products ready.`,
        actions: ready === n && n ? btn('balance', 'Production finished → balance invoice', { primary: true, p }) : `${btn('all-ready', 'Mark all products ready', { p })}` };
    case 'balance':
      return { title: 'Waiting for the balance payment', text: bal ? `Balance invoice ${invLine(bal)}. Ship when it's paid.` : 'No balance invoice yet.',
        actions: bal ? `${btn('balance-paid', `${icon.check} Balance received`, { primary: true, p })}<button class="btn" data-action="pdf-invoice" data-id="${bal.id}">Invoice PDF</button>` : btn('balance', 'Create balance invoice', { primary: true, p }) };
    case 'shipping': {
      const sh = shipmentsOf(p.id);
      const shipped = sh.some(s => s.status !== 'preparing');
      const text = sh.length ? sh.map(s => `${esc(s.carrier || 'Shipment')}${s.tracking ? ` ${esc(s.tracking)}` : ''} — ${esc(s.status)}`).join('<br>') : 'Add the shipment details and print the packing list.';
      return { title: 'Shipping', text: text + (!isPaid(bal) ? warn('The balance hasn’t been marked as paid yet.') : ''),
        actions: `${tabBtn(p, 'shipping', 'Shipping details')}${btn('packing', 'Packing list PDF', { p })}${shipped ? btn('delivered', `${icon.check} Delivered`, { primary: true, p }) : btn('shipped', 'Mark shipped', { primary: true, p })}` };
    }
    case 'delivered': {
      const d = shipmentsOf(p.id).map(s => s.delivered_date).filter(Boolean).sort().pop();
      return { title: 'Delivered', text: `Order complete${d ? ` — delivered ${esc(fmtDate(d))}` : ''}. 🎉`, actions: '' };
    }
    default:
      return { title: 'Next step', text: '', actions: '' };
  }
}

// ---------- Order tab ----------

export function orderTab(p) {
  if (!ordersReady()) {
    return `<div class="notice warn">The database needs an update before products and the order workflow can be used: run <code>supabase/migrations/005_order_workflow.sql</code> in the Supabase SQL Editor.</div>`;
  }
  const step = nextStep(p);
  const products = productsOf(p.id);
  const m = v => money(v, p.currency);
  const showProd = stageIndex(p.stage) >= stageIndex('production');
  const totals = products.reduce((t, i) => ({ cost: t.cost + num(i.unit_cost) * num(i.quantity), price: t.price + num(i.unit_price) * num(i.quantity) }), { cost: 0, price: 0 });
  const margin = totals.price ? Math.round(((totals.price - totals.cost) / totals.price) * 100) : null;
  const drawLabel = { none: 'No drawing', sent: 'Drawing with client', changes: 'Drawing: changes', approved: 'Drawing approved' };

  return `
    <section class="next-step card-surface stage-${esc(p.stage)}">
      <div class="ns-head"><span class="ns-label">Next step</span><h3>${step.title}</h3></div>
      <div class="ns-text">${step.text}</div>
      ${step.actions ? `<div class="ns-actions">${step.actions}</div>` : ''}
    </section>

    <div class="two-col doc-cols">
      ${docCard(p, 'inquiry', { title: 'Client inquiry', label: 'Add inquiry', hint: `The client's request — PDF, email printout, sketch or photo.${store.backend.mode === 'cloud' ? ' Tap a file and choose <b>✨ Read with AI</b> to fill in the products.' : ''}` })}
      ${docCard(p, 'supplier_quote', { title: 'Supplier quotes', label: 'Add supplier quote', hint: `Prices from workshops and suppliers.${store.backend.mode === 'cloud' ? ' Tap a file and choose <b>✨ Read with AI</b> to fill in the costs.' : ''}` })}
    </div>

    <h2 class="section section-with-action">Products <button class="btn small" data-action="add-product" data-project="${p.id}">${icon.plus} Product</button></h2>
    ${products.length ? `
      <div class="card-surface product-list">
        ${products.map(i => {
          const cost = num(i.unit_cost) * num(i.quantity);
          const price = num(i.unit_price) * num(i.quantity);
          const mg = price ? Math.round(((price - cost) / price) * 100) : null;
          const ds = drawingState(i);
          return `
            <div class="product-row" data-action="edit-product" data-id="${i.id}">
              <div class="pr-main">
                <b>${esc(i.name)}${num(i.quantity) !== 1 ? ` <span class="qty">× ${esc(String(num(i.quantity)))}</span>` : ''}</b>
                <span class="muted small">${esc([i.dimensions, i.materials].filter(Boolean).join(' · ') || 'No dimensions yet')}</span>
                <span class="muted small">${i.supplier ? `${esc(i.supplier)}${i.supplier_ref ? ` · ${esc(i.supplier_ref)}` : ''}` : '<i>No supplier yet</i>'}</span>
              </div>
              <div class="pr-chips">
                ${stageIndex(p.stage) >= stageIndex('drawings') ? `<span class="chip draw-${ds}">${esc(drawLabel[ds])}</span>` : ''}
                ${showProd ? `<button class="chip-toggle prod-${esc(i.production)}" data-action="product-production" data-id="${i.id}">${esc(label(PRODUCTION, i.production))}</button>` : ''}
              </div>
              <div class="pr-money">
                <span class="muted small">cost ${num(i.unit_cost) ? m(cost) : '—'}</span>
                <b>${num(i.unit_price) ? m(price) : '<span class="muted">no price</span>'}</b>
                ${mg != null && cost ? `<span class="small ${mg < 20 ? 'bad-text' : 'good-text'}">${mg}% margin</span>` : ''}
              </div>
            </div>`;
        }).join('')}
        <div class="product-total">
          <span>${products.length} product${products.length === 1 ? '' : 's'}</span>
          <span class="muted">cost ${m(totals.cost)}</span>
          <b>${m(totals.price)}</b>
          ${margin != null && totals.cost ? `<span class="small ${margin < 20 ? 'bad-text' : 'good-text'}">${margin}% margin</span>` : ''}
        </div>
      </div>` : emptyState('No products yet', 'Add each piece the client wants — e.g. a dining table, 8 chairs and 3 pendant lights.',
        `<button class="btn primary" data-action="add-product" data-project="${p.id}">${icon.plus} Add product</button>`)}
    <p class="muted small">Prices exclude tax. Delivery address: ${p.delivery_address ? esc(p.delivery_address.split('\n')[0]) + '…' : 'same as the client'} · Deposit ${num(p.deposit_pct) || 50}% — change in <button class="link-btn" data-action="edit-project" data-id="${p.id}">project settings</button>.</p>`;
}

// ---------- Product sheet ----------

export function openProductSheet(projectId, existing) {
  const p = store.get('projects', projectId);
  if (!p) return;
  const it = existing || { name: '', description: '', quantity: 1, dimensions: '', materials: '', weight_kg: null, supplier: '', supplier_ref: '', unit_cost: 0, unit_price: 0, production: 'not_started' };
  const suppliers = [...new Set(store.all('items').map(x => x.supplier).filter(Boolean))].sort();
  const cur = p.currency;
  const val = v => (num(v) ? String(round2(num(v))) : '');
  const markup = num(it.unit_cost) && num(it.unit_price) ? Math.round((num(it.unit_price) / num(it.unit_cost) - 1) * 100) : '';
  let stopFiles = null;

  openSheet(`
    <form>
      ${sheetHeader(existing ? it.name : 'New product')}
      <div class="fields">
        <div class="field-row">
          <label class="field grow"><span>Product</span><input name="name" value="${esc(it.name)}" required autofocus placeholder="e.g. Dining table, Pendant light"></label>
          <label class="field qty-field"><span>Quantity</span><input name="quantity" value="${esc(String(num(it.quantity) || 1))}" inputmode="decimal"></label>
        </div>
        <div class="field-row">
          <label class="field"><span>Dimensions</span><input name="dimensions" value="${esc(it.dimensions)}" placeholder="280 × 110 × 75 cm"></label>
          <label class="field"><span>Weight per piece (kg)</span><input name="weight_kg" value="${esc(val(it.weight_kg))}" inputmode="decimal"></label>
        </div>
        <label class="field"><span>Materials / finish</span><input name="materials" value="${esc(it.materials)}" placeholder="Solid walnut, oiled · brass details"></label>
        <label class="field"><span>Notes</span><textarea name="description" rows="2" placeholder="Special requests, references…">${esc(it.description)}</textarea></label>

        <h3 class="sheet-sub">Costing</h3>
        <div class="field-row">
          <label class="field"><span>Supplier / workshop</span><input name="supplier" value="${esc(it.supplier)}" list="supplier-list" autocomplete="off"></label>
          <label class="field"><span>Supplier quote no.</span><input name="supplier_ref" value="${esc(it.supplier_ref)}"></label>
        </div>
        <datalist id="supplier-list">${suppliers.map(s => `<option value="${esc(s)}">`).join('')}</datalist>
        <div class="field-row three">
          <label class="field"><span>Cost per piece (${esc(cur)})</span><input name="unit_cost" value="${esc(val(it.unit_cost))}" inputmode="decimal" placeholder="supplier price"></label>
          <label class="field"><span>Markup %</span><input name="markup" value="${esc(String(markup))}" inputmode="decimal" placeholder="e.g. 60"></label>
          <label class="field"><span>Price per piece (${esc(cur)})</span><input name="unit_price" value="${esc(val(it.unit_price))}" inputmode="decimal" placeholder="to the client"></label>
        </div>
        <div class="calc-line" id="calc-line"></div>
        ${existing && stageIndex(p.stage) >= stageIndex('production') ? `<label class="field"><span>Production</span><select name="production">${options(PRODUCTION, it.production)}</select></label>` : ''}
        ${existing && store.fileSections ? `<h3 class="sheet-sub">Supplier quote &amp; documents</h3><div id="product-files"></div>` : ''}
      </div>
      <footer>
        ${existing ? `<button type="button" class="btn danger" data-delete>Delete</button>` : ''}
        <span class="spacer"></span>
        <button type="button" class="btn" data-close>Cancel</button>
        <button type="submit" class="btn primary">${existing ? 'Save' : 'Add product'}</button>
      </footer>
    </form>`, {
    onOpen(sheet) {
      const f = name => $(`[name=${name}]`, sheet);
      const calc = () => {
        const q = parseAmount(f('quantity').value) || 1;
        const c = parseAmount(f('unit_cost').value);
        const pr = parseAmount(f('unit_price').value);
        const mg = pr ? Math.round(((pr - c) / pr) * 100) : null;
        $('#calc-line', sheet).innerHTML = c || pr
          ? `Total: cost <b>${money(c * q, cur)}</b> · price <b>${money(pr * q, cur)}</b>${mg != null && c ? ` · margin <b class="${mg < 20 ? 'bad-text' : 'good-text'}">${mg}%</b> (${money((pr - c) * q, cur)})` : ''}`
          : '';
      };
      // Markup ↔ price stay in sync.
      f('markup').addEventListener('input', () => {
        const c = parseAmount(f('unit_cost').value);
        if (c && f('markup').value !== '') f('unit_price').value = String(round2(c * (1 + parseAmount(f('markup').value) / 100)));
        calc();
      });
      const syncMarkup = () => {
        const c = parseAmount(f('unit_cost').value);
        const pr = parseAmount(f('unit_price').value);
        f('markup').value = c && pr ? String(Math.round((pr / c - 1) * 100)) : f('markup').value;
        calc();
      };
      f('unit_price').addEventListener('input', syncMarkup);
      f('unit_cost').addEventListener('input', () => {
        const c = parseAmount(f('unit_cost').value);
        if (c && f('markup').value !== '' && !parseAmount(f('unit_price').value)) f('unit_price').value = String(round2(c * (1 + parseAmount(f('markup').value) / 100)));
        else syncMarkup();
        calc();
      });
      f('quantity').addEventListener('input', calc);
      calc();
      if (existing && store.fileSections) {
        stopFiles = liveFileStrip(sheet, '#product-files', () => attachmentsOfItem(existing.id),
          { project_id: projectId, kind: 'supplier_quote', item_id: existing.id }, { label: 'Add PDF or photo', docs: true });
      }
      const del = sheet.querySelector('[data-delete]');
      if (del) del.addEventListener('click', () => {
        if (!confirm(`Delete “${existing.name}” and its drawings?`)) return;
        closeSheet();
        store.remove('items', existing.id).catch(() => {});
      });
    },
    onClose() { stopFiles && stopFiles(); },
    onSubmit(fd) {
      const data = {
        name: String(fd.get('name')).trim(),
        quantity: parseAmount(fd.get('quantity')) || 1,
        dimensions: String(fd.get('dimensions') || '').trim(),
        materials: String(fd.get('materials') || '').trim(),
        description: fd.get('description') || '',
        weight_kg: fd.get('weight_kg') ? parseAmount(fd.get('weight_kg')) : null,
        supplier: String(fd.get('supplier') || '').trim(),
        supplier_ref: String(fd.get('supplier_ref') || '').trim(),
        unit_cost: parseAmount(fd.get('unit_cost')),
        unit_price: parseAmount(fd.get('unit_price')),
      };
      if (fd.has('production')) data.production = fd.get('production');
      if (!data.name) return false;
      if (existing) {
        store.update('items', existing.id, data).catch(() => {});
        const d = drawingOf(existing.id);
        if (d && d.name !== data.name) store.update('deliverables', d.id, { name: data.name }).catch(() => {});
      } else {
        store.insert('items', { ...data, project_id: projectId, sort_order: nextSortOrder(productsOf(projectId)) }).catch(() => {});
      }
    },
  });
}

export function cycleProduction(item) {
  const order = PRODUCTION.map(x => x.id);
  const next = order[(order.indexOf(item.production) + 1) % order.length];
  store.update('items', item.id, { production: next }).catch(() => {});
}
