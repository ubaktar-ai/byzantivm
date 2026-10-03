// Quotes → costs → invoices: calculations and create/edit sheets.
// Amounts are always in the project's own currency; totals are never mixed across currencies.
import { esc, icon, todayStr, addDays, daysUntil, money, toast, openSheet, closeSheet, sheetHeader, options, uuid, $, $$ } from './lib.js';
import { store } from './store.js';

export const QUOTE_STATUSES = [
  { id: 'draft', label: 'Draft' },
  { id: 'sent', label: 'Sent' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
];
export const INVOICE_STATUSES = [
  { id: 'draft', label: 'Draft' },
  { id: 'sent', label: 'Sent' },
  { id: 'paid', label: 'Paid' },
  { id: 'cancelled', label: 'Cancelled' },
];
export const COST_CATEGORIES = [
  { id: 'freelancer', label: 'Freelancer' },
  { id: 'printing', label: 'Printing' },
  { id: 'production', label: 'Production' },
  { id: 'software', label: 'Software & licences' },
  { id: 'travel', label: 'Travel' },
  { id: 'other', label: 'Other' },
];

// ---------- Numbers ----------

const num = v => Number(v) || 0;
const round2 = n => Math.round(n * 100) / 100;

// Accepts "1500", "1.500,50", "1,500.50", "1500,5" …
export function parseAmount(text) {
  let s = String(text ?? '').trim().replace(/[^\d.,-]/g, '');
  if (!s) return 0;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    const dec = lastComma > lastDot ? ',' : '.';
    s = s.split(dec === ',' ? '.' : ',').join('').replace(dec, '.');
  } else if (lastComma > -1) {
    // "1,500" (thousands) vs "1500,5" (decimal): three digits after a single comma = thousands
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, ''); // "1.500", "1.500.000" (Turkish/European thousands)
  }
  return round2(parseFloat(s) || 0);
}

const amountValue = n => (num(n) ? String(round2(num(n))) : '');

// ---------- Lookups & totals ----------

export const quotesOf = pid => store.all('quotes').filter(q => q.project_id === pid).sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
export const itemsOf = qid => store.all('quote_items').filter(i => i.quote_id === qid).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
export const costsOf = pid => store.all('costs').filter(c => c.project_id === pid).sort((a, b) => (a.date < b.date ? 1 : -1));
export const invoicesOf = pid => store.all('invoices').filter(i => i.project_id === pid).sort((a, b) => ((a.issue_date || a.created_at) < (b.issue_date || b.created_at) ? -1 : 1));

export const quoteTotal = q => round2(itemsOf(q.id).reduce((s, i) => s + num(i.quantity) * num(i.unit_price), 0));

// Display status: a sent invoice past its due date is "overdue".
export function invoiceState(inv) {
  if (inv.status === 'sent' && inv.due_date && daysUntil(inv.due_date) < 0) return 'overdue';
  return inv.status;
}

export function projectFinance(pid) {
  const p = store.get('projects', pid);
  const quotes = quotesOf(pid);
  const approved = quotes.filter(q => q.status === 'approved');
  const pending = quotes.filter(q => q.status === 'sent' || q.status === 'draft');
  const budget = round2(approved.reduce((s, q) => s + quoteTotal(q), 0));
  const quotedPending = round2(pending.reduce((s, q) => s + quoteTotal(q), 0));
  const costs = costsOf(pid);
  const costTotal = round2(costs.reduce((s, c) => s + num(c.amount), 0));
  const invoices = invoicesOf(pid).filter(i => i.status === 'sent' || i.status === 'paid');
  const invoiced = round2(invoices.reduce((s, i) => s + num(i.amount), 0));
  const paid = round2(invoices.filter(i => i.status === 'paid').reduce((s, i) => s + num(i.amount), 0));
  const overdue = round2(invoices.filter(i => invoiceState(i) === 'overdue').reduce((s, i) => s + num(i.amount), 0));
  // Profit is measured against the approved budget; without one, against what has been invoiced.
  const revenue = budget || invoiced;
  const profit = round2(revenue - costTotal);
  return {
    currency: p ? p.currency : 'TRY',
    budget, quotedPending, costs: costTotal, invoiced, paid,
    outstanding: round2(invoiced - paid), overdue,
    leftToInvoice: budget ? round2(Math.max(0, budget - invoiced)) : 0,
    revenue, profit, margin: revenue ? Math.round((profit / revenue) * 100) : null,
    hasAny: quotes.length + costs.length + invoicesOf(pid).length > 0,
  };
}

// Sum per currency → [{ currency, value }]
export function totalsByCurrency(rows, value, currencyOf) {
  const m = new Map();
  rows.forEach(r => {
    const c = currencyOf(r);
    m.set(c, round2((m.get(c) || 0) + num(value(r))));
  });
  return [...m].filter(([, v]) => v).map(([currency, value]) => ({ currency, value }));
}

export const moneyList = (totals, empty = '—') =>
  totals.length ? totals.map(t => `<span class="money-val">${esc(money(t.value, t.currency))}</span>`).join('') : `<span class="money-val muted">${esc(empty)}</span>`;

// ---------- Numbering: BYZ-2026-001 (invoices), BYZ-Q-2026-001 (quotes) ----------

function nextNumber(table, projectId) {
  const p = store.get('projects', projectId);
  const company = p && store.get('companies', p.company_id);
  const code = (company ? company.name : 'INV').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'INV';
  const year = new Date().getFullYear();
  const prefix = table === 'quotes' ? `${code}-Q-${year}-` : `${code}-${year}-`;
  const used = store.all(table).map(r => r.number || '').filter(n => n.startsWith(prefix)).map(n => parseInt(n.slice(prefix.length), 10) || 0);
  return prefix + String((used.length ? Math.max(...used) : 0) + 1).padStart(3, '0');
}

const currencyNote = p => `<span class="muted small">Amounts in ${esc(p.currency)}</span>`;

// ---------------------------------------------------------------------
// Quote (with line items)
// ---------------------------------------------------------------------

export function openQuoteSheet(projectId, existing) {
  const p = store.get('projects', projectId);
  const q = existing || { number: nextNumber('quotes', projectId), title: p ? p.name : '', issue_date: todayStr(), valid_until: addDays(todayStr(), 30), status: 'draft', notes: '' };
  const items = existing ? itemsOf(existing.id).map(i => ({ ...i })) : [{ id: null, description: '', quantity: 1, unit_price: 0 }];

  const itemRow = it => `
    <div class="item-row" data-item="${esc(it.id || '')}">
      <input class="it-desc" value="${esc(it.description)}" placeholder="Description (e.g. Logo design — 3 concepts)" aria-label="Description">
      <input class="it-qty" value="${esc(String(num(it.quantity) || 1))}" inputmode="decimal" aria-label="Quantity">
      <input class="it-price" value="${esc(amountValue(it.unit_price))}" inputmode="decimal" placeholder="0" aria-label="Unit price">
      <span class="it-total"></span>
      <button type="button" class="btn ghost icon-btn it-remove" aria-label="Remove line">${icon.close}</button>
    </div>`;

  openSheet(`
    <form>
      ${sheetHeader(existing ? `Quote ${q.number}` : 'New quote')}
      <div class="fields">
        <div class="field-row">
          <label class="field"><span>Quote number</span><input name="number" value="${esc(q.number)}"></label>
          <label class="field"><span>Status</span><select name="status">${options(QUOTE_STATUSES, q.status)}</select></label>
        </div>
        <label class="field"><span>Title</span><input name="title" value="${esc(q.title)}" placeholder="e.g. Brand identity — phase 1"></label>
        <div class="field-row">
          <label class="field"><span>Date</span><input type="date" name="issue_date" value="${esc(q.issue_date || '')}"></label>
          <label class="field"><span>Valid until</span><input type="date" name="valid_until" value="${esc(q.valid_until || '')}"></label>
        </div>
        <div class="field"><span>Line items</span>
          <div class="items">
            <div class="item-row item-head"><span>Description</span><span>Qty</span><span>Unit price</span><span>Total</span><span></span></div>
            <div id="item-rows">${items.map(itemRow).join('')}</div>
            <button type="button" class="btn small" id="add-item">${icon.plus} Add line</button>
            <div class="items-total"><span>Total ${currencyNote(p)}</span><b id="quote-total"></b></div>
          </div>
        </div>
        <label class="field"><span>Notes / terms</span><textarea name="notes" rows="3" placeholder="Payment terms, what's excluded, VAT…">${esc(q.notes)}</textarea></label>
      </div>
      <footer>
        ${existing ? `<button type="button" class="btn danger" data-delete>Delete</button>` : ''}
        <span class="spacer"></span>
        <button type="button" class="btn" data-close>Cancel</button>
        <button type="submit" class="btn primary">${existing ? 'Save' : 'Create quote'}</button>
      </footer>
    </form>`, {
    wide: true,
    onOpen(sheet) {
      const rows = $('#item-rows', sheet);
      const recalc = () => {
        let total = 0;
        $$('.item-row', rows).forEach(r => {
          const line = parseAmount($('.it-qty', r).value) * parseAmount($('.it-price', r).value);
          total += line;
          $('.it-total', r).textContent = money(line, p.currency);
        });
        $('#quote-total', sheet).textContent = money(total, p.currency);
      };
      rows.addEventListener('input', recalc);
      rows.addEventListener('click', e => {
        const rm = e.target.closest('.it-remove');
        if (!rm) return;
        rm.closest('.item-row').remove();
        if (!$('.item-row', rows)) rows.insertAdjacentHTML('beforeend', itemRow({ description: '', quantity: 1, unit_price: 0 }));
        recalc();
      });
      $('#add-item', sheet).addEventListener('click', () => {
        rows.insertAdjacentHTML('beforeend', itemRow({ description: '', quantity: 1, unit_price: 0 }));
        $$('.it-desc', rows).pop().focus();
        recalc();
      });
      recalc();
      const del = sheet.querySelector('[data-delete]');
      if (del) del.addEventListener('click', () => {
        if (!confirm(`Delete quote ${existing.number}?`)) return;
        closeSheet();
        store.remove('quotes', existing.id).catch(() => {});
      });
    },
    async onSubmit(fd, form) {
      const lines = $$('#item-rows .item-row', form).map((r, i) => ({
        id: r.dataset.item || null,
        description: $('.it-desc', r).value.trim(),
        quantity: parseAmount($('.it-qty', r).value) || 1,
        unit_price: parseAmount($('.it-price', r).value),
        sort_order: i,
      })).filter(l => l.description || l.unit_price);
      const data = {
        number: String(fd.get('number')).trim(),
        title: String(fd.get('title')).trim(),
        status: fd.get('status'),
        issue_date: fd.get('issue_date') || null,
        valid_until: fd.get('valid_until') || null,
        notes: fd.get('notes'),
      };
      let quoteId;
      try {
        if (existing) { await store.update('quotes', existing.id, data); quoteId = existing.id; }
        else { quoteId = (await store.insert('quotes', { ...data, id: uuid(), project_id: projectId })).id; }
        // Sync line items: update kept ones, add new ones, delete removed ones.
        const keep = new Set(lines.filter(l => l.id).map(l => l.id));
        for (const old of itemsOf(quoteId)) if (!keep.has(old.id)) await store.remove('quote_items', old.id);
        for (const l of lines) {
          const { id, ...row } = l;
          if (id) await store.update('quote_items', id, { ...row, description: row.description || '—' });
          else await store.insert('quote_items', { ...row, description: row.description || '—', quote_id: quoteId });
        }
      } catch (err) {
        return false;
      }
      if (data.status === 'approved' && (!existing || existing.status !== 'approved')) {
        toast(`Quote approved — budget is now ${money(projectFinance(projectId).budget, p.currency)}`);
      }
    },
  });
}

// ---------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------

export function openCostSheet(projectId, existing) {
  const p = store.get('projects', projectId);
  const c = existing || { date: todayStr(), description: '', category: 'freelancer', vendor: '', amount: 0, paid: false };
  const vendors = [...new Set(store.all('costs').map(x => x.vendor).filter(Boolean))].sort();
  openSheet(`
    <form>
      ${sheetHeader(existing ? 'Edit cost' : 'New cost')}
      <div class="fields">
        <label class="field"><span>What was it for?</span><input name="description" value="${esc(c.description)}" required autofocus placeholder="e.g. Illustrator — label artwork"></label>
        <div class="field-row">
          <label class="field"><span>Amount (${esc(p.currency)})</span><input name="amount" value="${esc(amountValue(c.amount))}" inputmode="decimal" required placeholder="0"></label>
          <label class="field"><span>Date</span><input type="date" name="date" value="${esc(c.date || todayStr())}" required></label>
        </div>
        <div class="field-row">
          <label class="field"><span>Category</span><select name="category">${options(COST_CATEGORIES, c.category)}</select></label>
          <label class="field"><span>Paid to</span><input name="vendor" value="${esc(c.vendor)}" list="vendors" placeholder="Supplier or freelancer" autocomplete="off"></label>
        </div>
        <datalist id="vendors">${vendors.map(v => `<option value="${esc(v)}">`).join('')}</datalist>
        <label class="toggle"><input type="checkbox" name="paid" ${c.paid ? 'checked' : ''}><span>Already paid</span></label>
      </div>
      <footer>
        ${existing ? `<button type="button" class="btn danger" data-delete>Delete</button>` : ''}
        <span class="spacer"></span>
        <button type="button" class="btn" data-close>Cancel</button>
        <button type="submit" class="btn primary">${existing ? 'Save' : 'Add cost'}</button>
      </footer>
    </form>`, {
    onOpen(sheet) {
      const del = sheet.querySelector('[data-delete]');
      if (del) del.addEventListener('click', () => {
        if (!confirm('Delete this cost?')) return;
        closeSheet();
        store.remove('costs', existing.id).catch(() => {});
      });
    },
    onSubmit(fd) {
      const data = {
        description: String(fd.get('description')).trim(),
        amount: parseAmount(fd.get('amount')),
        date: fd.get('date') || todayStr(),
        category: fd.get('category'),
        vendor: String(fd.get('vendor') || '').trim(),
        paid: fd.get('paid') === 'on',
      };
      if (!data.description) return false;
      if (existing) store.update('costs', existing.id, data).catch(() => {});
      else store.insert('costs', { ...data, project_id: projectId }).catch(() => {});
    },
  });
}

// ---------------------------------------------------------------------
// Invoice
// ---------------------------------------------------------------------

export function openInvoiceSheet(projectId, existing) {
  const p = store.get('projects', projectId);
  const fin = projectFinance(projectId);
  const inv = existing || { number: nextNumber('invoices', projectId), title: '', issue_date: todayStr(), due_date: addDays(todayStr(), 30), amount: 0, status: 'draft', paid_date: null, notes: '' };
  const presets = !existing && fin.budget ? [
    { label: '30% deposit', title: 'Deposit (30%)', amount: fin.budget * 0.3 },
    { label: '50% deposit', title: 'Deposit (50%)', amount: fin.budget * 0.5 },
    ...(fin.leftToInvoice > 0 ? [{ label: `Remaining ${money(fin.leftToInvoice, p.currency)}`, title: fin.invoiced ? 'Final payment' : 'Full amount', amount: fin.leftToInvoice }] : []),
  ] : [];

  openSheet(`
    <form>
      ${sheetHeader(existing ? `Invoice ${inv.number}` : 'New invoice')}
      <div class="fields">
        ${presets.length ? `<div class="field"><span>Quick fill from budget (${esc(money(fin.budget, p.currency))})</span>
          <div class="preset-row">${presets.map((pr, i) => `<button type="button" class="btn small" data-preset="${i}">${esc(pr.label)}</button>`).join('')}</div></div>` : ''}
        <div class="field-row">
          <label class="field"><span>Invoice number</span><input name="number" value="${esc(inv.number)}"></label>
          <label class="field"><span>Status</span><select name="status">${options(INVOICE_STATUSES, inv.status)}</select></label>
        </div>
        <label class="field"><span>Milestone / description</span><input name="title" value="${esc(inv.title)}" placeholder="e.g. Deposit (50%), Final delivery" ${existing ? '' : 'autofocus'}></label>
        <label class="field"><span>Amount (${esc(p.currency)})</span><input name="amount" value="${esc(amountValue(inv.amount))}" inputmode="decimal" required placeholder="0"></label>
        <div class="field-row">
          <label class="field"><span>Issued</span><input type="date" name="issue_date" value="${esc(inv.issue_date || '')}"></label>
          <label class="field"><span>Due</span><input type="date" name="due_date" value="${esc(inv.due_date || '')}"></label>
        </div>
        <label class="field" id="paid-field" ${inv.status === 'paid' ? '' : 'hidden'}><span>Paid on</span><input type="date" name="paid_date" value="${esc(inv.paid_date || todayStr())}"></label>
        <label class="field"><span>Notes</span><textarea name="notes" rows="2" placeholder="Bank details, PO number…">${esc(inv.notes)}</textarea></label>
      </div>
      <footer>
        ${existing ? `<button type="button" class="btn danger" data-delete>Delete</button>` : ''}
        <span class="spacer"></span>
        <button type="button" class="btn" data-close>Cancel</button>
        <button type="submit" class="btn primary">${existing ? 'Save' : 'Create invoice'}</button>
      </footer>
    </form>`, {
    onOpen(sheet) {
      const status = $('[name=status]', sheet);
      status.addEventListener('change', () => { $('#paid-field', sheet).hidden = status.value !== 'paid'; });
      $$('[data-preset]', sheet).forEach(b => b.addEventListener('click', () => {
        const pr = presets[Number(b.dataset.preset)];
        $('[name=title]', sheet).value = pr.title;
        $('[name=amount]', sheet).value = amountValue(pr.amount);
      }));
      const del = sheet.querySelector('[data-delete]');
      if (del) del.addEventListener('click', () => {
        if (!confirm(`Delete invoice ${existing.number}?`)) return;
        closeSheet();
        store.remove('invoices', existing.id).catch(() => {});
      });
    },
    onSubmit(fd) {
      const status = fd.get('status');
      const data = {
        number: String(fd.get('number')).trim(),
        title: String(fd.get('title')).trim(),
        amount: parseAmount(fd.get('amount')),
        status,
        issue_date: fd.get('issue_date') || null,
        due_date: fd.get('due_date') || null,
        paid_date: status === 'paid' ? (fd.get('paid_date') || todayStr()) : null,
        notes: fd.get('notes'),
      };
      if (existing) store.update('invoices', existing.id, data).catch(() => {});
      else store.insert('invoices', { ...data, project_id: projectId }).catch(() => {});
    },
  });
}

export function markInvoicePaid(inv) {
  store.update('invoices', inv.id, { status: 'paid', paid_date: todayStr() }).catch(() => {});
  toast(`${inv.number || 'Invoice'} marked paid`, {
    label: 'Undo',
    run: () => store.update('invoices', inv.id, { status: inv.status, paid_date: inv.paid_date }).catch(() => {}),
  });
}

export function toggleCostPaid(cost) {
  store.update('costs', cost.id, { paid: !cost.paid }).catch(() => {});
}
