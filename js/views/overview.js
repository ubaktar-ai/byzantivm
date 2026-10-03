import { STAGES, esc, icon, addDays, todayStr, daysUntil } from '../lib.js';
import { store, companies, me, isOverdue, isLive, progress, byDueThenPriority } from '../store.js';
import { ui, inScope } from '../ui-state.js';
import { taskRow, companySegmented, companyColor, dueChip, emptyState } from './common.js';
import { waitingOnClients, daysSince } from './deliverables.js';

export function viewOverview() {
  const now = new Date();
  const h = now.getHours();
  const greet = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const first = (me()?.full_name || '').split(' ')[0];
  const dateLine = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  const projects = store.all('projects').filter(p => inScope(p.company_id));
  const projectIds = new Set(projects.map(p => p.id));
  const tasks = store.all('tasks').filter(t => projectIds.has(t.project_id));

  const cards = companies().filter(c => inScope(c.id)).map(c => {
    const ps = projects.filter(p => p.company_id === c.id);
    const ids = new Set(ps.map(p => p.id));
    const ts = tasks.filter(t => ids.has(t.project_id));
    const live = ps.filter(p => p.status === 'active').length;
    const open = ts.filter(t => !t.done).length;
    const overdue = ts.filter(isOverdue).length;
    const review = ps.filter(p => p.status === 'active' && p.stage === 'client_review').length;
    return `
      <div class="company-card card-surface" style="--c:${esc(c.color)}">
        <h3>${esc(c.name)} ${ui.company === c.id ? '' : `<button class="btn small ghost" data-action="set-company" data-id="${esc(c.id)}">Focus</button>`}</h3>
        <div class="stats">
          <a class="stat" href="#/projects"><b>${live}</b><span>Active projects</span></a>
          <a class="stat" href="#/tasks"><b>${open}</b><span>Open tasks</span></a>
          <div class="stat ${overdue ? 'bad' : ''}"><b>${overdue}</b><span>Overdue tasks</span></div>
          <div class="stat"><b>${review}</b><span>With client</span></div>
        </div>
      </div>`;
  }).join('');

  if (!projects.length) {
    return `
      ${companySegmented()}
      <div class="page-head"><div><h1>${greet}${first ? `, ${esc(first)}` : ''}</h1><div class="sub">${esc(dateLine)}</div></div></div>
      <div class="company-cards">${cards}</div>
      <h2 class="section">Get started</h2>
      ${emptyState('No projects yet', 'Add a client and your first project to get going.',
        `<button class="btn primary" data-action="new-project">${icon.plus} New project</button>
         <button class="btn" data-action="new-client">${icon.plus} New client</button>
         ${store.backend.mode === 'demo' ? `<button class="btn" data-action="load-sample">Load sample data</button>` : ''}`)}`;
  }

  const horizon = addDays(todayStr(), 7);
  const myId = store.user?.id;
  const mine = tasks.filter(t => !t.done && t.assignee_id === myId).sort(byDueThenPriority).slice(0, 10);
  const teamSoon = tasks.filter(t => !t.done && t.assignee_id !== myId && t.due_date && t.due_date <= horizon).sort(byDueThenPriority).slice(0, 8);

  const liveProjects = projects.filter(p => p.status === 'active');
  const stageCounts = STAGES.map(s => ({ ...s, n: liveProjects.filter(p => p.stage === s.id).length }));
  const maxN = Math.max(1, ...stageCounts.map(s => s.n));

  const deadlines = projects
    .filter(p => isLive(p) && p.due_date && daysUntil(p.due_date) <= 21)
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
    .slice(0, 8);

  return `
    ${companySegmented()}
    <div class="page-head">
      <div><h1>${greet}${first ? `, ${esc(first)}` : ''}</h1><div class="sub">${esc(dateLine)}</div></div>
      <div class="head-actions">
        <button class="btn" data-action="new-project">${icon.plus} New project</button>
      </div>
    </div>
    <div class="company-cards">${cards}</div>

    <div class="two-col">
      <div>
        <h2 class="section">My tasks</h2>
        ${mine.length ? `<div class="task-list card-surface">${mine.map(t => taskRow(t)).join('')}</div>`
          : emptyState('Nothing assigned to you', '', `<button class="btn" data-action="new-task">${icon.plus} New task</button>`)}
        ${teamSoon.length ? `
          <h2 class="section">Team — due in the next 7 days</h2>
          <div class="task-list card-surface">${teamSoon.map(t => taskRow(t)).join('')}</div>` : ''}
      </div>
      <div>
        ${(() => {
          const waiting = waitingOnClients(p => inScope(p.company_id));
          if (!waiting.length) return '';
          return `
            <h2 class="section">Waiting on clients</h2>
            <div class="card-surface">${waiting.slice(0, 8).map(({ d, p, r }) => `
              <a class="project-mini" href="#/project/${p.id}/deliverables">
                <div class="row"><b><span class="dot" style="background:${esc(companyColor(p.company_id))}"></span> ${esc(d.name)}</b>
                  <span class="chip ${r.sent_date && daysUntil(r.sent_date) <= -5 ? 'soon' : ''}">${esc(r.sent_date ? daysSince(r.sent_date) : 'sent')}</span></div>
                <div class="row sub-row"><span>${esc(p.name)}${store.get('clients', p.client_id) ? ` · ${esc(store.get('clients', p.client_id).name)}` : ''}</span><span>Round ${r.round_no} of ${d.max_rounds}</span></div>
              </a>`).join('')}</div>`;
        })()}
        <h2 class="section">Pipeline</h2>
        <a class="card-surface pipeline-summary" href="#/projects">
          ${stageCounts.map(s => `
            <div class="ps-row">
              <span class="ps-label">${esc(s.label)}</span>
              <span class="ps-bar"><span style="width:${(s.n / maxN) * 100}%"></span></span>
              <b>${s.n}</b>
            </div>`).join('')}
        </a>
        <h2 class="section">Upcoming deadlines</h2>
        ${deadlines.length ? `<div class="card-surface">${deadlines.map(p => {
          const pr = progress(p.id);
          const client = store.get('clients', p.client_id);
          return `
            <a class="project-mini" href="#/project/${p.id}">
              <div class="row"><b><span class="dot" style="background:${esc(companyColor(p.company_id))}"></span> ${esc(p.name)}</b>${dueChip(p.due_date)}</div>
              <div class="row sub-row"><span>${esc(client ? client.name : 'No client')}</span><span>${pr.done}/${pr.total} tasks</span></div>
              <div class="progress"><span style="width:${pr.pct}%;background:${esc(companyColor(p.company_id))}"></span></div>
            </a>`;
        }).join('')}</div>` : `<div class="empty small-empty">No deadlines in the next 3 weeks.</div>`}
      </div>
    </div>`;
}

