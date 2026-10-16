// Steps 8–10: the client's PO becomes the deposit invoice; each payment received makes a supplier payout slip;
// when the lights are ready to ship, the balance is checked, invoiced, received and paid on to the supplier.
// Payouts live in their own table (supplier_payouts): the supplier's price is already counted as product cost.
import { esc, money, toast, openSheet, sheetHeader, todayStr, fmtDate, uuid, stageIndex, $ } from '../lib.js';
import { store, productsOf } from '../store.js';
import { parseAmount, quoteTotal, companyCountry } from '../money.js';
import { uploadFiles } from '../files.js';
import { openProposal, acceptedProposal, depositInvoice, balanceInvoice, isPaid, acceptProposal, createBalance, moveStage } from './order.js';

const num = v => Number(v) || 0;
const round2 = n => Math.round(n * 100) / 100;

export const payoutsReady = () => store.backend.mode === 'demo' || !store.missing.has('supplier_payouts');
export const payoutsOf = pid => store.all('supplier_payouts').filter(x => x.project_id === pid && x.status !== 'cancelled')
  .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
const payoutFor = inv => inv && payoutsOf(inv.project_id).find(x => x.invoice_id === inv.id);

// What the client pays on an invoice: the amount plus VAT / sales tax when it applies.
export function invoiceGross(inv) {
  const p = store.get('projects', inv.project_id);
  const company = p && store.get('companies', p.company_id);
  const us = companyCountry(company) === 'US';
  const treatment = us ? 'standard' : (inv.vat_treatment || 'standard');
  const rate = treatment === 'standard' ? num(inv.vat_rate) : 0;
  return round2(num(inv.amount) * (1 + rate / 100));
}

// The supplier's side of the order: their price for everything, and what we have paid them so far.
export function supplierTotals(pid) {
  const cost = round2(productsOf(pid).reduce((s, i) => s + num(i.unit_cost) * (num(i.quantity) || 1), 0));
  const payouts = payoutsOf(pid);
  const planned = round2(payouts.reduce((s, x) => s + num(x.amount), 0));
  const paid = round2(payouts.filter(x => x.status === 'paid').reduce((s, x) => s + num(x.amount), 0));
  return { cost, planned, paid, left: round2(Math.max(0, cost - planned)) };
}

const supplierName = pid => {
  const counts = {};
  productsOf(pid).forEach(i => { if (i.supplier) counts[i.supplier] = (counts[i.supplier] || 0) + 1; });
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([s]) => s)[0] || '';
};

// ---------- What the Steps tab shows ----------

export function paySteps(p, step) {
  const m = v => money(v, p.currency);
  const proposal = openProposal(p.id) || acceptedProposal(p.id);
  const dep = depositInvoice(p.id);
  const bal = balanceInvoice(p.id);
  const pct = num(p.deposit_pct) || 50;
  const products = productsOf(p.id);
  const ready = products.filter(i => i.production === 'ready').length;
  const sup = supplierTotals(p.id);

  // 8 — client's PO → invoice
  const s8 = !proposal ? '<p class="muted small">Make the proposal first (step 5). When the client sends their purchase order, upload it here.</p>'
    : dep ? `
      <p class="small">${p.client_po ? `Client PO <b>${esc(p.client_po)}</b>${p.client_po_date ? ` of ${esc(fmtDate(p.client_po_date))}` : ''} · ` : ''}Deposit invoice <b>${esc(dep.number || '')}</b>: ${esc(m(invoiceGross(dep)))} (${esc(dep.title || '')}) — ${isPaid(dep) ? 'paid' : 'sent'}</p>
      <div class="qc-actions">
        <button class="btn" data-action="pay-invoice-pdf" data-id="${dep.id}">Deposit invoice PDF</button>
        ${p.client_po ? '' : `<button class="btn" data-action="pay-po" data-id="${p.id}">Add the PO number</button>`}
      </div>`
    : `
      <p class="muted small">Upload the client's purchase order (PDF or photo). The AI reads the PO number, date and total; you check them against the proposal, then the deposit invoice (${pct}%) is made.</p>
      <div class="qc-actions">
        <label class="btn primary upload-btn"><span>Upload the client's PO</span><input type="file" hidden accept="image/*,application/pdf" data-pay-po="${p.id}"></label>
        <button class="btn" data-action="pay-po" data-id="${p.id}">Type the PO in</button>
      </div>`;

  // 9 — payments from the client → supplier payout slips
  const invoices = [dep, bal].filter(Boolean);
  const payouts = payoutsOf(p.id);
  const s9 = !invoices.length ? '<p class="muted small">After the deposit invoice is made, enter each payment from the client here. Each one makes a payout slip for the supplier.</p>' : `
    <div class="pay-rows">${invoices.map(inv => {
      const out = payoutFor(inv);
      return `<div class="pay-row">
        <div class="pay-line"><span><b>${esc(inv.number || '')}</b> · ${esc(inv.title || '')}</span>
          <span>${isPaid(inv)
            ? `received <b>${esc(m(inv.received_amount != null ? num(inv.received_amount) : invoiceGross(inv)))}</b> · ${esc(fmtDate(inv.paid_date || todayStr()))}`
            : `<b>${esc(m(invoiceGross(inv)))}</b> to receive <button class="btn small primary" data-action="pay-received" data-id="${inv.id}">Payment received</button>`}</span></div>
        <div class="pay-line muted-line"><span>Supplier payout</span>
          <span>${out ? `<b>${esc(m(out.amount))}</b> · ${out.status === 'paid' ? `paid ${esc(fmtDate(out.paid_date || todayStr()))}` : '<b class="bad-text">to pay</b>'}
              <button class="btn small" data-action="pay-slip" data-id="${out.id}">Slip PDF</button>
              ${out.status === 'paid' ? '' : `<button class="btn small" data-action="pay-out-paid" data-id="${out.id}">Paid to supplier</button>`}`
            : isPaid(inv) ? `<button class="btn small primary" data-action="pay-payout" data-id="${inv.id}">Make payout slip</button>` : '<span class="muted small">after the client pays</span>'}</span></div>
      </div>`;
    }).join('')}</div>
    <p class="muted small">Supplier total ${esc(m(sup.cost))} · payout slips ${esc(m(sup.planned))} · paid to supplier ${esc(m(sup.paid))} · still to pay ${esc(m(round2(Math.max(0, sup.cost - sup.paid))))}</p>
    ${payouts.filter(x => !x.invoice_id).map(x => `<p class="small">${esc(x.title || 'Payout')}: ${esc(m(x.amount))} — ${x.status === 'paid' ? 'paid' : 'to pay'}
      <button class="btn small" data-action="pay-slip" data-id="${x.id}">Slip PDF</button></p>`).join('')}`;

  // 10 — ready to ship → balance
  const s10 = !isPaid(dep) ? '<p class="muted small">When the supplier says the lights are ready to ship, confirm it here. The app then checks the balance payment with you.</p>' : `
    <p class="small">${products.length ? `${ready} of ${products.length} ready to ship.` : ''}
      ${bal ? `Balance invoice <b>${esc(bal.number || '')}</b>: ${esc(m(invoiceGross(bal)))} — ${isPaid(bal) ? 'received' : 'waiting for the client’s payment'}.` : ''}</p>
    <div class="qc-actions">
      ${isPaid(bal) ? '' : `<button class="btn primary" data-action="pay-ready" data-id="${p.id}">${bal ? 'Has the balance been paid?' : 'Lights are ready to ship'}</button>`}
      ${bal ? `<button class="btn" data-action="pay-invoice-pdf" data-id="${bal.id}">Balance invoice PDF</button>` : ''}
    </div>
    ${isPaid(bal) ? '<p class="small good-text">Balance received — ship when the supplier is paid. Shipping is in the Order tab.</p>' : ''}`;

  const allPaidOut = sup.cost > 0 && sup.paid >= sup.cost - 0.01;
  return `
    ${step(8, 'Client’s PO → invoice', dep ? (p.client_po ? `PO ${esc(p.client_po)}` : 'invoiced') : '', s8, { done: !!dep })}
    ${step(9, 'Payments → supplier payout slips', invoices.length ? `${invoices.filter(isPaid).length}/${invoices.length} received` : '', s9, { done: allPaidOut })}
    ${step(10, 'Ready to ship → balance', isPaid(bal) ? 'balance received' : bal ? 'balance invoiced' : '', s10, { done: isPaid(bal) })}`;
}

// ---------- 8: the client's PO ----------

let reading = 0;

async function readPo(p, file) {
  const saved = await uploadFiles([file], { project_id: p.id, kind: 'money' });
  const att = saved[0];
  if (!att) return;
  if (store.backend.mode !== 'cloud') { reviewPo(p, {}, att, 'Reading the PO with AI works with the team database. Type the details in below.'); return; }
  const ticket = ++reading;
  openSheet(`
    <div>
      ${sheetHeader('Reading the PO…')}
      <div class="ai-wait"><div class="spinner"></div><p><b>${esc(att.name)}</b></p>
        <p class="muted small">This usually takes 10–40 seconds. You check everything before it is saved.</p></div>
      <footer><span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button></footer>
    </div>`, { onClose() { if (ticket === reading) reading++; } });
  let r = {};
  let problem = '';
  try {
    const data = await store.backend.readDocument(att.path, 'po');
    r = (data && data.result) || {};
    if (!data || !data.result) problem = (data && data.error) || 'No answer from the AI — type the details in.';
  } catch (err) {
    console.error(err);
    problem = err.notSetUp ? 'AI reading isn’t switched on yet (see “AI document reading” in the README). Type the details in.' : `The PO couldn’t be read: ${err.message || err}. Type the details in.`;
  }
  if (ticket !== reading) return;
  reviewPo(p, r, att, problem);
}

// Check screen: PO number, date and deposit, the PO total next to the proposal total.
export function reviewPo(p, r = {}, att = null, problem = '') {
  const q = openProposal(p.id) || acceptedProposal(p.id);
  if (!q) { toast('Make the proposal first'); return; }
  const m = v => money(v, p.currency);
  const qTotal = quoteTotal(q);
  const poTotal = num(r.total);
  const differs = poTotal && Math.abs(poTotal - qTotal) > Math.max(1, qTotal * 0.005);
  const pct = num(r.deposit_pct) || num(p.deposit_pct) || 50;
  const lines = Array.isArray(r.lines) ? r.lines : [];
  const already = !!depositInvoice(p.id);
  openSheet(`
    <form>
      ${sheetHeader('Client’s purchase order')}
      <div class="fields">
        ${problem ? `<p class="ai-problem">${esc(problem)}</p>` : ''}
        ${att ? `<p class="muted small">File: <b>${esc(att.name)}</b> (kept under Money)</p>` : ''}
        <div class="spec-grid">
          <label class="field"><span>PO number</span><input name="po" value="${esc(r.po_number || p.client_po || '')}" placeholder="e.g. PO-24017" required></label>
          <label class="field"><span>PO date</span><input name="po_date" type="date" value="${esc(/^\d{4}-\d{2}-\d{2}$/.test(r.po_date || '') ? r.po_date : (p.client_po_date || todayStr()))}"></label>
          ${already ? '' : `<label class="field"><span>Deposit %</span><input name="pct" inputmode="decimal" value="${esc(String(pct))}"></label>`}
        </div>
        <p class="small">Proposal <b>${esc(q.number || '')}</b>: ${esc(m(qTotal))} excl. tax${poTotal ? ` · PO total: <b>${esc(money(poTotal, /^[A-Z]{3}$/.test(r.currency || '') ? r.currency : p.currency))}</b>` : ''}</p>
        ${differs ? `<p class="ai-problem">The PO total is different from the proposal (${esc(m(qTotal))}). Check it with the client before going on — the invoice follows the proposal.</p>` : ''}
        ${r.currency && r.currency !== p.currency ? `<p class="ai-problem">The PO is in ${esc(r.currency)}, the order in ${esc(p.currency)}.</p>` : ''}
        ${lines.length ? `<div class="flow-table-wrap"><table class="flow-table"><thead><tr><th>On the PO</th><th>Qty</th><th>Price / pc</th></tr></thead>
          <tbody>${lines.map(l => `<tr><td>${esc(l.description || '')}</td><td>${esc(String(num(l.quantity) || ''))}</td><td>${num(l.unit_price) ? esc(m(l.unit_price)) : '—'}</td></tr>`).join('')}</tbody></table></div>` : ''}
        ${r.payment_terms ? `<p class="small">Payment terms: ${esc(r.payment_terms)}</p>` : ''}
        ${r.delivery_date ? `<p class="small">Wanted by: ${esc(r.delivery_date)}</p>` : ''}
        ${r.notes ? `<p class="small">Notes: ${esc(r.notes)}</p>` : ''}
        <p class="muted small">${already ? 'Saves the PO number on the order and the deposit invoice.' : 'Saving accepts the proposal and makes the deposit invoice with your PO number on it.'}</p>
      </div>
      <footer><span class="spacer"></span>
        <button type="button" class="btn" data-close>Cancel</button>
        <button type="submit" class="btn primary">${already ? 'Save' : 'Accept & make invoice'}</button></footer>
    </form>`, {
    async onSubmit(fd) {
      const po = String(fd.get('po') || '').trim();
      const poDate = String(fd.get('po_date') || '') || null;
      if (!po) { toast('Type the PO number'); return false; }
      const patch = { client_po: po, client_po_date: poDate };
      const newPct = fd.has('pct') ? parseAmount(fd.get('pct')) : NaN;
      if (!Number.isNaN(newPct) && newPct > 0 && newPct <= 100 && newPct !== num(p.deposit_pct)) patch.deposit_pct = newPct;
      try {
        await store.update('projects', p.id, patch);
        const notes = `Your PO: ${po}${poDate ? ` (${fmtDate(poDate)})` : ''}`;
        const fresh = store.get('projects', p.id);
        const inv = await acceptProposal(fresh, { notes, pct: patch.deposit_pct });
        if (inv) toast(already ? 'PO saved' : 'Proposal accepted — deposit invoice made');
      } catch (err) { console.error(err); return false; }
    },
  });
}

// ---------- 9: payment received → supplier payout slip ----------

export function openPaymentSheet(inv) {
  const p = store.get('projects', inv.project_id);
  const due = invoiceGross(inv);
  openSheet(`
    <form>
      ${sheetHeader(`Payment received — ${inv.number || inv.title || 'invoice'}`)}
      <div class="fields">
        <p class="small">${esc(inv.title || '')}: <b>${esc(money(due, p.currency))}</b> to receive.</p>
        <div class="spec-grid">
          <label class="field"><span>Amount received</span><input name="amount" inputmode="decimal" value="${esc(String(due))}" required></label>
          <label class="field"><span>Date received</span><input name="date" type="date" value="${esc(todayStr())}"></label>
        </div>
        <p class="muted small">Next you make the supplier payout slip for this payment.</p>
      </div>
      <footer><span class="spacer"></span>
        <button type="button" class="btn" data-close>Cancel</button>
        <button type="submit" class="btn primary">Save & make payout slip</button></footer>
    </form>`, {
    async onSubmit(fd) {
      const amount = parseAmount(fd.get('amount'));
      const date = String(fd.get('date') || '') || todayStr();
      if (Number.isNaN(amount) || amount <= 0) { toast('Type the amount received'); return false; }
      if (amount < due - 0.01 && !confirm(`${money(amount, p.currency)} is less than the ${money(due, p.currency)} on the invoice. Count the invoice as paid anyway?`)) return false;
      const patch = { status: 'paid', paid_date: date };
      if (store.backend.mode === 'demo' || 'received_amount' in inv) patch.received_amount = round2(amount);
      if (Math.abs(amount - due) > 0.01) patch.notes = [inv.notes, `Received ${money(amount, p.currency)} on ${fmtDate(date)}.`].filter(Boolean).join('\n');
      try {
        await store.update('invoices', inv.id, patch);
        const next = inv.kind === 'balance' ? 'shipping' : 'drawings';
        if (stageIndex(p.stage) < stageIndex(next)) await moveStage(p, next);
      } catch (err) { console.error(err); return false; }
      toast(`${inv.kind === 'balance' ? 'Balance' : 'Payment'} received`);
      setTimeout(() => openPayoutSheet(store.get('invoices', inv.id)), 60);
    },
  });
}

export function openPayoutSheet(inv) {
  if (!payoutsReady()) { toast('Supplier payouts need the database update 011 (see the README)'); return; }
  const p = store.get('projects', inv.project_id);
  const existing = payoutFor(inv);
  if (existing) { makePayoutPdf(existing.id); return; }
  const sup = supplierTotals(p.id);
  const balance = inv.kind === 'balance';
  const pct = balance ? null : num(p.deposit_pct) || 50;
  const amount = balance ? sup.left : round2(sup.cost * pct / 100);
  openSheet(`
    <form>
      ${sheetHeader(balance ? 'Balance payout to the supplier' : 'Deposit payout to the supplier')}
      <div class="fields">
        <p class="small">Supplier total for this order: <b>${esc(money(sup.cost, p.currency))}</b>${sup.planned ? ` · already on slips: ${esc(money(sup.planned, p.currency))}` : ''}.</p>
        ${sup.cost ? '' : '<p class="ai-problem">The cards have no supplier cost yet — type the amount to pay.</p>'}
        <div class="spec-grid">
          <label class="field"><span>Supplier</span><input name="supplier" value="${esc(supplierName(p.id))}" placeholder="Workshop name"></label>
          ${balance ? '' : `<label class="field"><span>Deposit to supplier %</span><input name="pct" inputmode="decimal" value="${esc(String(pct))}"></label>`}
          <label class="field"><span>Amount to pay</span><input name="amount" inputmode="decimal" value="${esc(String(amount))}" required></label>
          <label class="field wide"><span>Note on the slip</span><input name="notes" placeholder="e.g. bank transfer, ref. supplier quote 2291"></label>
        </div>
        <p class="muted small">The slip shows the supplier's prices only — never the client or your selling prices.</p>
      </div>
      <footer><span class="spacer"></span>
        <button type="button" class="btn" data-close>Later</button>
        <button type="submit" class="btn primary">Save & make slip PDF</button></footer>
    </form>`, {
    onOpen(sheet) {
      const pctIn = $('[name=pct]', sheet);
      if (pctIn) pctIn.addEventListener('input', () => {
        const v = parseAmount(pctIn.value);
        if (!Number.isNaN(v) && sup.cost) $('[name=amount]', sheet).value = String(round2(sup.cost * v / 100));
      });
    },
    async onSubmit(fd) {
      const amt = parseAmount(fd.get('amount'));
      if (Number.isNaN(amt) || amt < 0) { toast('Type the amount to pay'); return false; }
      const pctV = fd.has('pct') ? parseAmount(fd.get('pct')) : NaN;
      const n = payoutsOf(p.id).length + 1;
      let out;
      try {
        out = await store.insert('supplier_payouts', {
          id: uuid(), project_id: p.id, kind: balance ? 'balance' : 'deposit', invoice_id: inv.id,
          number: `${p.order_no || 'PAY'}-S${n}`,
          title: balance ? 'Balance payment' : `Deposit payment${Number.isNaN(pctV) ? '' : ` (${pctV}%)`}`,
          supplier: String(fd.get('supplier') || '').trim(), pct: Number.isNaN(pctV) ? null : pctV,
          amount: round2(amt), status: 'to_pay', notes: String(fd.get('notes') || '').trim(),
        });
      } catch (err) { console.error(err); return false; }
      setTimeout(() => makePayoutPdf(out.id), 50);
    },
  });
}

export const makePayoutPdf = id => import('../qc-pdf.js').then(m => m.createPayoutPdf(id));

// ---------- 10: ready to ship → is the balance paid? ----------

function openReadySheet(p) {
  const bal = balanceInvoice(p.id);
  const products = productsOf(p.id);
  const notReady = products.filter(i => i.production !== 'ready');
  openSheet(`
    <form>
      ${sheetHeader('Ready to ship')}
      <div class="fields">
        ${notReady.length ? `<p class="small">Mark ${notReady.length === products.length ? 'all lights' : `the other ${notReady.length}`} as ready to ship:</p>
          <ul class="small">${notReady.map(i => `<li>${esc(i.name)} × ${esc(String(num(i.quantity) || 1))}</li>`).join('')}</ul>` : '<p class="small">All lights are ready to ship.</p>'}
        <p><b>Has the client paid the balance${bal ? ` (invoice ${esc(bal.number || '')}, ${esc(money(invoiceGross(bal), p.currency))})` : ''}?</b></p>
        <p class="muted small">${bal ? 'If not yet, the balance invoice PDF opens again so you can remind the client.' : 'If not yet, the balance invoice is made now so you can send it.'}</p>
      </div>
      <footer><span class="spacer"></span>
        <button type="button" class="btn" data-close>Cancel</button>
        <button type="submit" class="btn" value="no">Not yet${bal ? ' — invoice PDF' : ' — make invoice'}</button>
        <button type="submit" class="btn primary" value="yes">Yes, it's paid</button></footer>
    </form>`, {
    async onSubmit(fd, form, submitter) {
      const paid = submitter && submitter.value === 'yes';
      try {
        for (const it of notReady) await store.update('items', it.id, { production: 'ready' });
        const inv = balanceInvoice(p.id) || await createBalance(store.get('projects', p.id), { pdf: !paid });
        if (!inv) return;
        if (paid) setTimeout(() => openPaymentSheet(store.get('invoices', inv.id)), 60);
        else {
          if (bal) import('../money.js').then(m => m.makePdf('invoice', inv.id));
          toast('Send the balance invoice to the client');
        }
      } catch (err) { console.error(err); return false; }
    },
  });
}

// ---------- Buttons ----------

export function payAction(action, el) {
  const id = el.dataset.id;
  const p = store.get('projects', id);
  const inv = store.get('invoices', id);
  if (action === 'pay-po' && p) reviewPo(p);
  else if (action === 'pay-received' && inv) openPaymentSheet(inv);
  else if (action === 'pay-payout' && inv) openPayoutSheet(inv);
  else if (action === 'pay-slip') makePayoutPdf(id);
  else if (action === 'pay-out-paid') {
    const out = store.get('supplier_payouts', id);
    if (!out) return true;
    store.update('supplier_payouts', id, { status: 'paid', paid_date: todayStr() })
      .then(() => toast(`${out.title} marked paid to the supplier`, { label: 'Undo', run: () => store.update('supplier_payouts', id, { status: 'to_pay', paid_date: null }).catch(() => {}) }))
      .catch(() => {});
  }
  else if (action === 'pay-invoice-pdf' && inv) import('../money.js').then(m => m.makePdf('invoice', inv.id));
  else if (action === 'pay-ready' && p) openReadySheet(p);
  else return false;
  return true;
}

document.addEventListener('change', e => {
  const t = e.target;
  if (t.matches && t.matches('[data-pay-po]') && t.files.length) {
    const p = store.get('projects', t.dataset.payPo);
    const file = t.files[0];
    t.value = '';
    if (p) readPo(p, file).catch(err => { console.error(err); toast(`Couldn't upload the PO: ${err.message || err}`); });
  }
});
