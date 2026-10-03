import { esc, icon } from '../lib.js';
import { store, projectsOfClient, contactsOf, isLive } from '../store.js';
import { ui, inScope } from '../ui-state.js';
import { emptyState, stageChip, statusChip, dueChip, companyColor, companyChip } from './common.js';
import { clientBilling } from './money.js';

export function viewClients() {
  const q = (ui.clientSearch || '').trim().toLowerCase();
  let clients = store.all('clients');
  // When one company is selected, show clients that have work with it (plus clients with no projects yet).
  if (ui.company !== 'all') {
    clients = clients.filter(c => {
      const ps = projectsOfClient(c.id);
      return !ps.length || ps.some(p => inScope(p.company_id));
    });
  }
  if (q) {
    clients = clients.filter(c => [c.name, c.email, c.phone, c.notes, ...contactsOf(c.id).map(x => `${x.name} ${x.email}`)]
      .some(v => (v || '').toLowerCase().includes(q)));
  }
  clients.sort((a, b) => a.name.localeCompare(b.name));

  return `
    <div class="page-head">
      <div><h1>Clients</h1><div class="sub">${clients.length} ${clients.length === 1 ? 'client' : 'clients'}</div></div>
      <div class="head-actions"><button class="btn primary" data-action="new-client">${icon.plus} New client</button></div>
    </div>
    <div class="toolbar">
      <input class="search" type="search" id="client-search" placeholder="Search clients and contacts…" value="${esc(ui.clientSearch || '')}" autocomplete="off">
    </div>
    ${clients.length ? `<div class="client-grid">${clients.map(c => {
      const ps = projectsOfClient(c.id);
      const live = ps.filter(isLive);
      const contacts = contactsOf(c.id);
      const companyIds = [...new Set(ps.map(p => p.company_id))];
      return `
        <a class="client-card card-surface" href="#/client/${c.id}">
          <div class="cc-head">
            <span class="client-badge">${esc(c.name.slice(0, 1).toUpperCase())}</span>
            <div><h3>${esc(c.name)}</h3><span class="muted small">${contacts.length ? esc(contacts.map(x => x.name).slice(0, 2).join(', ')) + (contacts.length > 2 ? ` +${contacts.length - 2}` : '') : 'No contacts'}</span></div>
          </div>
          <div class="cc-meta">
            <span>${live.length} current · ${ps.length} total</span>
            <span class="dots">${companyIds.map(id => `<span class="dot" style="background:${esc(companyColor(id))}"></span>`).join('')}</span>
          </div>
        </a>`;
    }).join('')}</div>` : (q ? emptyState('No clients match', '') :
      emptyState('No clients yet', 'Keep each client’s details, contacts and projects together.',
        `<button class="btn primary" data-action="new-client">${icon.plus} New client</button>`))}`;
}

export function viewClient(id) {
  const c = store.get('clients', id);
  if (!c) {
    return store.loaded ? emptyState('Client not found', '', `<a class="btn" href="#/clients">Back to clients</a>`) : '';
  }
  const contacts = contactsOf(c.id);
  const projects = projectsOfClient(c.id).sort((a, b) => (isLive(b) - isLive(a)) || (a.due_date || '9999').localeCompare(b.due_date || '9999'));
  const website = c.website && (/^https?:\/\//i.test(c.website) ? c.website : `https://${c.website}`);

  return `
    <a class="crumbs" href="#/clients">${icon.back}Clients</a>
    <div class="page-head">
      <div>
        <h1>${esc(c.name)}</h1>
        <div class="contact-links big">
          ${c.email ? `<a href="mailto:${esc(c.email)}">${icon.mail}${esc(c.email)}</a>` : ''}
          ${c.phone ? `<a href="tel:${esc(c.phone)}">${icon.phone}${esc(c.phone)}</a>` : ''}
          ${website ? `<a href="${esc(website)}" target="_blank" rel="noopener">${icon.globe}${esc(c.website)}</a>` : ''}
        </div>
      </div>
      <div class="head-actions">
        <button class="btn" data-action="edit-client" data-id="${c.id}">${icon.edit} Edit</button>
        <button class="btn primary" data-action="new-project" data-client="${c.id}">${icon.plus} Project</button>
      </div>
    </div>

    <div class="two-col">
      <div>
        <h2 class="section">Projects</h2>
        ${projects.length ? `<div class="card-surface table-list">${projects.map(p => `
          <a class="list-row" href="#/project/${p.id}">
            <span class="bar" style="background:${esc(companyColor(p.company_id))}"></span>
            <div class="lr-main"><b>${esc(p.name)}</b><span>${companyChip(p.company_id)}</span></div>
            <div class="lr-chips">${stageChip(p.stage)}${statusChip(p.status)}</div>
            <div class="lr-due">${dueChip(p.due_date, p.status === 'completed')}</div>
          </a>`).join('')}</div>`
          : emptyState('No projects for this client yet', '', `<button class="btn" data-action="new-project" data-client="${c.id}">${icon.plus} New project</button>`)}
        ${c.notes || c.address ? `
          <h2 class="section">Notes</h2>
          <div class="card-surface pad">
            ${c.address ? `<p class="prewrap"><b>Address</b><br>${esc(c.address)}</p>` : ''}
            ${c.notes ? `<p class="prewrap">${esc(c.notes)}</p>` : ''}
          </div>` : ''}
      </div>
      <div>
        ${clientBilling(c.id)}
        <h2 class="section section-with-action">Contacts <button class="btn small" data-action="new-contact" data-client="${c.id}">${icon.plus} Add</button></h2>
        ${contacts.length ? `<div class="card-surface">${contacts.map(x => `
          <div class="contact-row" data-action="edit-contact" data-id="${x.id}">
            <span class="client-badge small">${esc(x.name.slice(0, 1).toUpperCase())}</span>
            <div class="contact-main">
              <b>${esc(x.name)}</b>${x.role ? `<span class="muted"> · ${esc(x.role)}</span>` : ''}
              <div class="contact-links">
                ${x.email ? `<a href="mailto:${esc(x.email)}">${icon.mail}${esc(x.email)}</a>` : ''}
                ${x.phone ? `<a href="tel:${esc(x.phone)}">${icon.phone}${esc(x.phone)}</a>` : ''}
              </div>
              ${x.notes ? `<div class="muted small prewrap">${esc(x.notes)}</div>` : ''}
            </div>
          </div>`).join('')}</div>`
          : `<div class="empty small-empty">No contacts yet.</div>`}
      </div>
    </div>`;
}
