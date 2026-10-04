// Money: the project → Money tab and the cross-project Money screen.
import { esc, icon, money, fmtDate, label, todayStr } from '../lib.js';
import { store, isLive } from '../store.js';
import { inScope } from '../ui-state.js';
import {
  QUOTE_STATUSES, INVOICE_STATUSES, COST_CATEGORIES, quotesOf, itemsOf, costsOf, invoicesOf, quoteTotal,
  invoiceState, projectFinance, totalsByCurrency, moneyList,
} from '../money.js';
import { companySegmented, companyColor, scopeName, emptyState, dueChip } from './common.js';
import { docCard } from '../files.js';

const stateLabel = s => (s === 'overdue' ? 'Overdue' : label(INVOICE_STATUSES, s));

function invoiceChip(inv) {
  const s = invoiceState(inv);
  return `<span class="chip inv-${s}">${esc(stateLabel(s))}</span>`;
}

function statCard(title, value, sub = '', cls = '') {
  return `<div class="money-stat ${cls}"><span>${esc(title)}</span><b>${value}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
}

// ---------------------------------------------------------------------
// Project → Money tab
// ---------------------------------------------------------------------

export function moneyTab(p) {
  const f = projectFinance(p.id);
  const m = v => esc(money(v, p.currency));
  const quotes = quotesOf(p.id);
  const costs = costsOf(p.id);
  const invoices = invoicesOf(p.id);

  const summary = `
    <div class="money-stats six">
      ${statCard('Order value', f.budget ? m(f.budget) : '—', f.budget ? 'accepted proposal' : f.quotedPending ? `${m(f.quotedPending)} proposed, not accepted yet` : 'no accepted proposal yet')}
      ${statCard('Costs', m(f.costs), [f.productCost ? `products ${m(f.productCost)}` : '', f.shippingCost ? `shipping ${m(f.shippingCost)}` : '', f.otherCost ? `other ${m(f.otherCost)}` : ''].filter(Boolean).join(' · '))}
      ${statCard('Profit', f.revenue ? m(f.profit) : '—', f.margin != null ? `${f.margin}% margin${f.budget ? '' : ' (on invoiced)'}` : '', f.revenue && f.profit < 0 ? 'bad' : f.revenue ? 'good' : '')}
      ${statCard('Invoiced', m(f.invoiced), f.budget ? `${m(f.leftToInvoice)} left to invoice` : '')}
      ${statCard('Paid', m(f.paid), f.invoiced ? `${Math.round((f.paid / f.invoiced) * 100)}% of invoiced` : '')}
      ${statCard('Outstanding', m(f.outstanding), f.overdue ? `<b class="bad-text">${m(f.overdue)} overdue</b>` : '', f.overdue ? 'bad' : '')}
    </div>`;

  const quotesSection = `
    <section class="money-section">
      <h2 class="section section-with-action">Proposals <button class="btn small" data-action="new-quote" data-project="${p.id}">${icon.plus} Proposal</button></h2>
      ${quotes.length ? `<div class="card-surface">${quotes.map(q => `
        <div class="money-row" data-action="edit-quote" data-id="${q.id}">
          <div class="mr-main"><b>${esc(q.title || 'Proposal')}</b><span class="muted small">${esc(q.number)}${q.issue_date ? ` · ${esc(fmtDate(q.issue_date))}` : ''} · ${itemsOf(q.id).length} line${itemsOf(q.id).length === 1 ? '' : 's'}</span></div>
          <span class="chip quote-${q.status}">${esc(label(QUOTE_STATUSES, q.status))}</span>
          <button class="btn small pdf-btn" data-action="pdf-quote" data-id="${q.id}" aria-label="PDF of proposal ${esc(q.number)}">PDF</button>
          <b class="mr-amount">${m(quoteTotal(q))}</b>
        </div>`).join('')}</div>`
        : `<div class="empty small-empty">No proposals yet. Create one from the products on the <b>Order</b> tab — the accepted proposal sets the order value.</div>`}
    </section>`;

  const invoicesSection = `
    <section class="money-section">
      <h2 class="section section-with-action">Invoices <button class="btn small" data-action="new-invoice" data-project="${p.id}">${icon.plus} Invoice</button></h2>
      ${invoices.length ? `<div class="card-surface">${invoices.map(inv => {
        const s = invoiceState(inv);
        return `
        <div class="money-row" data-action="edit-invoice" data-id="${inv.id}">
          <div class="mr-main"><b>${esc(inv.title || 'Invoice')}</b><span class="muted small">${esc(inv.number)}${inv.issue_date ? ` · issued ${esc(fmtDate(inv.issue_date))}` : ''}${s === 'paid' && inv.paid_date ? ` · paid ${esc(fmtDate(inv.paid_date))}` : inv.due_date && s !== 'cancelled' && s !== 'draft' ? ` · due ${esc(fmtDate(inv.due_date))}` : ''}</span></div>
          ${invoiceChip(inv)}
          ${s === 'sent' || s === 'overdue' ? `<button class="btn small" data-action="invoice-paid" data-id="${inv.id}">${icon.check} Paid</button>` : ''}
          <button class="btn small pdf-btn" data-action="pdf-invoice" data-id="${inv.id}" aria-label="PDF of invoice ${esc(inv.number)}">PDF</button>
          <b class="mr-amount ${s === 'cancelled' ? 'struck' : ''}">${m(inv.amount)}</b>
        </div>`;
      }).join('')}</div>`
        : `<div class="empty small-empty">No invoices yet. Bill a deposit, milestones, or the full amount.</div>`}
    </section>`;

  const costsSection = `
    <section class="money-section">
      <h2 class="section section-with-action">Other costs <button class="btn small" data-action="new-cost" data-project="${p.id}">${icon.plus} Cost</button></h2>
      <p class="muted small">Supplier costs come from the products (Order tab) and shipping costs from Shipping. Add anything else here — samples, materials, travel…</p>
      ${costs.length ? `<div class="card-surface">${costs.map(c => `
        <div class="money-row" data-action="edit-cost" data-id="${c.id}">
          <div class="mr-main"><b>${esc(c.description)}</b><span class="muted small">${esc(label(COST_CATEGORIES, c.category))}${c.vendor ? ` · ${esc(c.vendor)}` : ''} · ${esc(fmtDate(c.date))}</span></div>
          <button class="chip-toggle ${c.paid ? 'on' : ''}" data-action="cost-paid" data-id="${c.id}">${c.paid ? `${icon.check} Paid` : 'Unpaid'}</button>
          <b class="mr-amount">${m(c.amount)}</b>
        </div>`).join('')}</div>`
        : `<div class="empty small-empty">No other costs.</div>`}
    </section>`;

  return `
    <div class="toolbar"><span class="muted small">All amounts in ${esc(p.currency)}, excluding VAT. Change the currency in <button class="link-btn" data-action="edit-project" data-id="${p.id}">project settings</button>.</span></div>
    ${summary}
    <div class="two-col">
      <div>${invoicesSection}${quotesSection}</div>
      <div>${costsSection}
        <h2 class="section">Documents</h2>
        ${docCard(p, 'money', { title: 'Money documents', hint: 'Supplier invoices, receipts, payment confirmations, signed proposals.' })}
      </div>
    </div>`;
}

// ---------------------------------------------------------------------
// Money screen (all projects in the selected company scope)
// ---------------------------------------------------------------------

export function viewMoney() {
  const projects = store.all('projects').filter(p => inScope(p.company_id));
  const ids = new Set(projects.map(p => p.id));
  const cur = r => (store.get('projects', r.project_id) || {}).currency || 'EUR';
  const invoices = store.all('invoices').filter(i => ids.has(i.project_id));
  const costs = store.all('costs').filter(c => ids.has(c.project_id));
  const monthStart = todayStr().slice(0, 8) + '01';

  const open = invoices.filter(i => i.status === 'sent');
  const overdue = open.filter(i => invoiceState(i) === 'overdue');
  const paidThisMonth = invoices.filter(i => i.status === 'paid' && (i.paid_date || '') >= monthStart);
  const costsThisMonth = costs.filter(c => (c.date || '') >= monthStart);
  const unpaidCosts = costs.filter(c => !c.paid);

  const stats = `
    <div class="money-stats">
      ${statCard('Outstanding', moneyList(totalsByCurrency(open, i => i.amount, cur), '0'), `${open.length} unpaid invoice${open.length === 1 ? '' : 's'}`)}
      ${statCard('Overdue', moneyList(totalsByCurrency(overdue, i => i.amount, cur), '0'), overdue.length ? `${overdue.length} invoice${overdue.length === 1 ? '' : 's'}` : 'nothing overdue', overdue.length ? 'bad' : '')}
      ${statCard('Received this month', moneyList(totalsByCurrency(paidThisMonth, i => i.amount, cur), '0'))}
      ${statCard('Costs this month', moneyList(totalsByCurrency(costsThisMonth, c => c.amount, cur), '0'), unpaidCosts.length ? `${unpaidCosts.length} unpaid cost${unpaidCosts.length === 1 ? '' : 's'}` : '')}
    </div>`;

  const openSorted = open.slice().sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'));
  const unpaidList = openSorted.length ? `<div class="card-surface">${openSorted.map(inv => {
    const p = store.get('projects', inv.project_id);
    const client = p && store.get('clients', p.client_id);
    return `
      <a class="money-row" href="#/project/${p.id}/money">
        <span class="bar-dot" style="background:${esc(companyColor(p.company_id))}"></span>
        <div class="mr-main"><b>${esc(client ? client.name : p.name)} — ${esc(inv.title || inv.number)}</b><span class="muted small">${esc(inv.number)} · ${esc(p.name)}</span></div>
        ${inv.due_date ? dueChip(inv.due_date) : ''}
        <button class="btn small" data-action="invoice-paid" data-id="${inv.id}">${icon.check} Paid</button>
        <b class="mr-amount">${esc(money(inv.amount, p.currency))}</b>
      </a>`;
  }).join('')}</div>` : `<div class="empty small-empty">No unpaid invoices. 🎉</div>`;

  // Profit per project (current + completed in the last part of the year)
  const rows = projects
    .map(p => ({ p, f: projectFinance(p.id) }))
    .filter(x => x.f.hasAny)
    .sort((a, b) => (isLive(b.p) - isLive(a.p)) || a.p.name.localeCompare(b.p.name));
  const profitTable = rows.length ? `
    <div class="card-surface table-wrap">
      <table class="money-table">
        <thead><tr><th>Project</th><th>Order value</th><th>Costs</th><th>Profit</th><th>Invoiced</th><th>Paid</th></tr></thead>
        <tbody>${rows.map(({ p, f }) => {
          const m = v => esc(money(v, p.currency));
          return `<tr>
            <td><a href="#/project/${p.id}/money"><span class="dot" style="background:${esc(companyColor(p.company_id))}"></span> ${esc(p.name)}</a>${isLive(p) ? '' : ' <span class="muted small">(done)</span>'}</td>
            <td>${f.budget ? m(f.budget) : '<span class="muted">—</span>'}</td>
            <td>${m(f.costs)}</td>
            <td class="${f.revenue ? (f.profit < 0 ? 'bad-text' : 'good-text') : ''}">${f.revenue ? `${m(f.profit)}${f.margin != null ? ` <small>${f.margin}%</small>` : ''}` : '<span class="muted">—</span>'}</td>
            <td>${m(f.invoiced)}</td>
            <td>${m(f.paid)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>` : `<div class="empty small-empty">Add quotes, costs and invoices to a project (project → Money) to see profit here.</div>`;

  return `
    ${companySegmented()}
    <div class="page-head"><div><h1>Money</h1><div class="sub">${esc(scopeName())} · totals are per currency</div></div></div>
    ${stats}
    <h2 class="section">Unpaid invoices</h2>
    ${unpaidList}
    <h2 class="section">Profit by project</h2>
    ${profitTable}
    ${!projects.length ? emptyState('No projects yet', '') : ''}`;
}

// Short billing summary for a client page.
export function clientBilling(clientId) {
  const ids = new Set(store.all('projects').filter(p => p.client_id === clientId).map(p => p.id));
  const cur = r => (store.get('projects', r.project_id) || {}).currency || 'EUR';
  const inv = store.all('invoices').filter(i => ids.has(i.project_id));
  if (!inv.length) return '';
  const open = inv.filter(i => i.status === 'sent');
  const paid = inv.filter(i => i.status === 'paid');
  return `
    <h2 class="section">Billing</h2>
    <div class="card-surface pad billing">
      <div><span class="muted small">Outstanding</span>${moneyList(totalsByCurrency(open, i => i.amount, cur), '0')}</div>
      <div><span class="muted small">Paid to date</span>${moneyList(totalsByCurrency(paid, i => i.amount, cur), '0')}</div>
      ${open.some(i => invoiceState(i) === 'overdue') ? `<div class="bad-text small">Has overdue invoices</div>` : ''}
    </div>`;
}

