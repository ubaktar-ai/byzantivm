import { STAGES, esc, icon, avatar } from '../lib.js';
import { store, progress, tasksOf, isOverdue } from '../store.js';
import { ui, inScope } from '../ui-state.js';
import { companySegmented, companyColor, companyChip, stageChip, statusChip, dueChip, scopeName, emptyState } from './common.js';

const STATUS_FILTERS = [
  { id: 'live', label: 'Current', test: p => p.status === 'active' || p.status === 'on_hold' },
  { id: 'completed', label: 'Completed', test: p => p.status === 'completed' },
  { id: 'cancelled', label: 'Cancelled', test: p => p.status === 'cancelled' },
  { id: 'all', label: 'All', test: () => true },
];

export function filteredProjects() {
  const f = STATUS_FILTERS.find(x => x.id === ui.projectStatus) || STATUS_FILTERS[0];
  return store.all('projects').filter(p => inScope(p.company_id) && f.test(p));
}

export function projectCard(p, { draggable = false } = {}) {
  const pr = progress(p.id);
  const client = store.get('clients', p.client_id);
  const lead = store.get('profiles', p.lead_id);
  const overdue = tasksOf(p.id).filter(isOverdue).length;
  const color = companyColor(p.company_id);
  return `
    <a class="project-card card-surface ${draggable ? 'draggable' : ''}" href="#/project/${p.id}" style="--c:${esc(color)}"
       ${draggable ? `data-drag="projects" data-id="${p.id}"` : ''} draggable="false">
      <div class="pc-top">
        <span class="pc-client">${esc(client ? client.name : 'No client')}</span>
        ${lead ? avatar(lead, 24) : ''}
      </div>
      <h3>${esc(p.name)}</h3>
      <div class="progress"><span style="width:${pr.pct}%;background:var(--c)"></span></div>
      <div class="pc-meta">
        <span>${pr.done}/${pr.total} tasks${overdue ? ` · <b class="bad-text">${overdue} late</b>` : ''}</span>
        ${statusChip(p.status)}
        ${p.due_date ? dueChip(p.due_date, p.status === 'completed') : ''}
      </div>
    </a>`;
}

export function viewProjects() {
  const projects = filteredProjects();
  const mode = ui.projectsView;

  const toolbar = `
    <div class="toolbar">
      <div class="segmented">
        <button type="button" data-action="projects-view" data-id="pipeline" aria-pressed="${mode === 'pipeline'}">Pipeline</button>
        <button type="button" data-action="projects-view" data-id="list" aria-pressed="${mode === 'list'}">List</button>
      </div>
      <div class="segmented">
        ${STATUS_FILTERS.map(f => `<button type="button" data-action="project-status" data-id="${f.id}" aria-pressed="${ui.projectStatus === f.id}">${f.label}</button>`).join('')}
      </div>
    </div>`;

  let body;
  if (!store.all('projects').some(p => inScope(p.company_id))) {
    body = emptyState('No projects yet', 'Projects move through Brief → Concept → Design → Client review → Revisions → Delivered.',
      `<button class="btn primary" data-action="new-project">${icon.plus} New project</button>`);
  } else if (mode === 'pipeline') {
    body = `
      <div class="board" data-board="projects">
        ${STAGES.map(s => {
          const col = projects.filter(p => p.stage === s.id).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
          return `
            <section class="column" data-stage="${s.id}">
              <div class="column-head"><span>${esc(s.label)}</span><span class="count">${col.length}</span></div>
              <div class="column-cards">${col.map(p => projectCard(p, { draggable: true })).join('')}</div>
              <button class="btn small add-in-col" data-action="new-project" data-stage="${s.id}">${icon.plus} Project</button>
            </section>`;
        }).join('')}
      </div>`;
  } else {
    const sorted = projects.slice().sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999') || a.name.localeCompare(b.name));
    body = sorted.length ? `
      <div class="card-surface table-list">
        ${sorted.map(p => {
          const pr = progress(p.id);
          const client = store.get('clients', p.client_id);
          return `
            <a class="list-row" href="#/project/${p.id}">
              <span class="bar" style="background:${esc(companyColor(p.company_id))}"></span>
              <div class="lr-main"><b>${esc(p.name)}</b><span>${esc(client ? client.name : 'No client')}</span></div>
              <div class="lr-chips">${ui.company === 'all' ? companyChip(p.company_id) : ''}${stageChip(p.stage)}${statusChip(p.status)}</div>
              <div class="lr-progress"><div class="progress"><span style="width:${pr.pct}%;background:${esc(companyColor(p.company_id))}"></span></div><small>${pr.done}/${pr.total}</small></div>
              <div class="lr-due">${dueChip(p.due_date, p.status === 'completed')}</div>
            </a>`;
        }).join('')}
      </div>` : emptyState('No projects match this filter', '');
  }

  return `
    ${companySegmented()}
    <div class="page-head">
      <div><h1>Projects</h1><div class="sub">${esc(scopeName())}</div></div>
      <div class="head-actions"><button class="btn primary" data-action="new-project">${icon.plus} New project</button></div>
    </div>
    ${toolbar}
    ${body}`;
}
