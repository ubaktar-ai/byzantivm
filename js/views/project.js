import { STAGES, CURRENCIES, esc, icon, avatar, fmtDate, label, stageIndex } from '../lib.js';
import { store, tasksOf, progress, contactsOf, commentCount, deliverablesOf, attachmentsWhere } from '../store.js';
import { deliverablesTab } from './deliverables.js';
import { moneyTab } from './money.js';
import { activityEntries, activityItem } from './activity.js';
import { fileTile, uploadButton, isImage } from '../files.js';
import { ui } from '../ui-state.js';
import { companyChip, statusChip, dueChip, prioDot, companyColor, taskRow, emptyState } from './common.js';

export function viewProject(id, tab = 'tasks') {
  const p = store.get('projects', id);
  if (!p) {
    return store.loaded
      ? emptyState('Project not found', 'It may have been deleted.', `<a class="btn" href="#/projects">Back to projects</a>`)
      : '';
  }
  const client = store.get('clients', p.client_id);
  const lead = store.get('profiles', p.lead_id);
  const pr = progress(p.id);
  const color = companyColor(p.company_id);
  const current = stageIndex(p.stage);

  const stepper = `
    <div class="stepper" role="list" aria-label="Project stage">
      ${STAGES.map((s, i) => `
        <button type="button" role="listitem" class="step ${i < current ? 'past' : ''} ${i === current ? 'current' : ''}"
          data-action="set-project-stage" data-id="${p.id}" data-stage="${s.id}" aria-current="${i === current ? 'step' : 'false'}">
          <span class="step-dot">${i < current ? icon.check : i + 1}</span><span class="step-label">${esc(s.label)}</span>
        </button>`).join('')}
    </div>`;

  const nDeliv = deliverablesOf(p.id).length;
  const nFiles = attachmentsWhere('project_id', p.id).length;
  const tabs = [
    { id: 'tasks', label: `Tasks <span class="tab-count">${pr.total}</span>` },
    { id: 'deliverables', label: `Deliverables${nDeliv ? ` <span class="tab-count">${nDeliv}</span>` : ''}` },
    { id: 'files', label: `Files${nFiles ? ` <span class="tab-count">${nFiles}</span>` : ''}` },
    { id: 'money', label: 'Money' },
    { id: 'details', label: 'Details' },
  ];
  const body = tab === 'details' ? detailsTab(p, client, pr)
    : tab === 'deliverables' ? deliverablesTab(p)
    : tab === 'files' ? filesTab(p)
    : tab === 'money' ? moneyTab(p)
    : tasksTab(p);

  return `
    <a class="crumbs" href="#/projects">${icon.back}Projects</a>
    <div class="page-head project-head" style="--c:${esc(color)}">
      <div>
        <h1>${esc(p.name)}</h1>
        <div class="chips-line">
          ${companyChip(p.company_id)}
          ${client ? `<a class="chip link-chip" href="#/client/${client.id}">${esc(client.name)}</a>` : ''}
          ${statusChip(p.status)}
          ${p.due_date ? `<span class="chip-label">Deadline</span>${dueChip(p.due_date, p.status === 'completed')}` : ''}
          ${lead ? `<span class="lead">${avatar(lead, 24)} ${esc(lead.full_name || lead.email)}</span>` : ''}
        </div>
      </div>
      <div class="head-actions">
        <button class="btn" data-action="edit-project" data-id="${p.id}">${icon.edit} Edit</button>
        <button class="btn primary" data-action="new-task" data-project="${p.id}">${icon.plus} Task</button>
      </div>
    </div>
    ${stepper}
    <div class="tabs" role="tablist">
      ${tabs.map(t => `<a role="tab" href="#/project/${p.id}/${t.id}" aria-selected="${tab === t.id}">${t.label}</a>`).join('')}
    </div>
    ${body}`;
}

function tasksTab(p) {
  const tasks = tasksOf(p.id);
  const mode = ui.taskBoardMode || 'board';
  const toggle = `
    <div class="toolbar">
      <div class="segmented">
        <button type="button" data-action="task-board-mode" data-id="board" aria-pressed="${mode === 'board'}">Board</button>
        <button type="button" data-action="task-board-mode" data-id="list" aria-pressed="${mode === 'list'}">List</button>
      </div>
      <span class="muted small">Tip: press and hold a card to move it to another phase.</span>
    </div>`;

  if (mode === 'list') {
    const groups = STAGES.map(s => ({ s, items: tasks.filter(t => t.stage === s.id).sort((a, b) => a.done - b.done || (a.sort_order || 0) - (b.sort_order || 0)) }))
      .filter(g => g.items.length);
    return toggle + (groups.length
      ? `<div class="task-list card-surface">${groups.map(g => `<div class="group-label">${esc(g.s.label)} · ${g.items.length}</div>${g.items.map(t => taskRow(t, { showProject: false })).join('')}`).join('')}</div>`
      : emptyState('No tasks yet', '', `<button class="btn primary" data-action="new-task" data-project="${p.id}">${icon.plus} Add task</button>`));
  }

  return toggle + `
    <div class="board" data-board="tasks">
      ${STAGES.map(s => {
        const col = tasks.filter(t => t.stage === s.id).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
        const open = col.filter(t => !t.done).length;
        return `
          <section class="column ${p.stage === s.id ? 'current-stage' : ''}" data-stage="${s.id}">
            <div class="column-head"><span>${esc(s.label)}</span><span class="count">${open}${col.length !== open ? `<small>/${col.length}</small>` : ''}</span></div>
            <div class="column-cards">${col.map(taskCard).join('')}</div>
            <button class="btn small add-in-col" data-action="new-task" data-project="${p.id}" data-stage="${s.id}">${icon.plus} Task</button>
          </section>`;
      }).join('')}
    </div>`;
}

function filesTab(p) {
  const all = attachmentsWhere('project_id', p.id);
  const filter = ui.fileFilter || 'all';
  const shown = all.filter(a => filter === 'all' || (filter === 'photos' ? isImage(a) : !isImage(a)));
  const toolbar = `
    <div class="toolbar">
      ${uploadButton({ project_id: p.id }, { label: 'Upload files or photos', primary: true })}
      ${all.length ? `<div class="segmented">
        ${[['all', 'All'], ['photos', 'Photos'], ['docs', 'Documents']].map(([id, l]) => `<button type="button" data-action="file-filter" data-id="${id}" aria-pressed="${filter === id}">${l}</button>`).join('')}
      </div>` : ''}
    </div>`;
  if (!all.length) {
    return toolbar + emptyState('No files yet', 'Upload briefs, references, drafts, photos from site visits — anything the team needs for this project. Files attached to tasks and feedback rounds also show up here.');
  }
  return toolbar + (shown.length ? `<div class="file-grid">${shown.map(a => fileTile(a, { context: true })).join('')}</div>` : emptyState('Nothing here', ''));
}

function taskCard(t) {
  const assignee = store.get('profiles', t.assignee_id);
  const n = commentCount(t.id);
  const nf = attachmentsWhere('task_id', t.id).length;
  return `
    <div class="task-card ${t.done ? 'is-done' : ''}" data-drag="tasks" data-id="${t.id}" data-action="edit-task">
      <div class="tc-top">
        <button class="check small ${t.done ? 'on' : ''}" data-action="toggle-done" data-id="${t.id}" aria-label="${t.done ? 'Mark as not done' : 'Mark as done'}">${icon.check}</button>
        <div class="title">${esc(t.title)}</div>
      </div>
      <div class="meta">
        ${prioDot(t.priority)}
        ${dueChip(t.due_date, t.done)}
        ${n ? `<span class="comments-count">${icon.chat}${n}</span>` : ''}
        ${nf ? `<span class="comments-count">${icon.clip}${nf}</span>` : ''}
        ${assignee ? avatar(assignee, 24) : ''}
      </div>
    </div>`;
}

function detailsTab(p, client, pr) {
  const contacts = client ? contactsOf(client.id) : [];
  const people = new Map();
  tasksOf(p.id).forEach(t => {
    if (!t.assignee_id) return;
    const e = people.get(t.assignee_id) || { open: 0, done: 0 };
    e[t.done ? 'done' : 'open']++;
    people.set(t.assignee_id, e);
  });
  return `
    <div class="two-col">
      <div>
        <div class="card-surface pad">
          <h3 class="card-title">Brief</h3>
          ${p.description ? `<p class="prewrap">${esc(p.description)}</p>` : `<p class="muted">No description yet. <button class="link-btn" data-action="edit-project" data-id="${p.id}">Add one</button></p>`}
        </div>
        ${(() => {
          if (!store.activityLoaded) { store.loadActivity().catch(() => {}); return ''; }
          const recent = activityEntries({ limit: 10, projectId: p.id });
          return recent.length ? `<div class="card-surface pad"><h3 class="card-title">Recent activity</h3><div class="act-list">${recent.map(a => activityItem(a, { showProject: false })).join('')}</div></div>` : '';
        })()}
        <div class="card-surface pad">
          <h3 class="card-title">Team on this project</h3>
          ${people.size ? `<div class="people-list">${[...people].map(([pid, c]) => {
            const prof = store.get('profiles', pid);
            return `<div class="person-row">${avatar(prof, 30)}<span>${esc(prof ? prof.full_name || prof.email : 'Former member')}</span><small>${c.open} open · ${c.done} done</small></div>`;
          }).join('')}</div>` : `<p class="muted">Assign tasks to people to see them here.</p>`}
        </div>
      </div>
      <div>
        <div class="card-surface pad">
          <h3 class="card-title">Facts</h3>
          <dl class="facts">
            <dt>Stage</dt><dd>${esc(label(STAGES, p.stage))}</dd>
            <dt>Progress</dt><dd>${pr.done} of ${pr.total} tasks (${pr.pct}%)</dd>
            <dt>Start</dt><dd>${p.start_date ? esc(fmtDate(p.start_date)) : '—'}</dd>
            <dt>Deadline</dt><dd>${p.due_date ? esc(fmtDate(p.due_date)) : '—'}</dd>
            <dt>Currency</dt><dd>${esc(label(CURRENCIES, p.currency))}</dd>
          </dl>
        </div>
        <div class="card-surface pad">
          <h3 class="card-title">Client</h3>
          ${client ? `
            <a class="client-link" href="#/client/${client.id}"><b>${esc(client.name)}</b></a>
            ${contacts.length ? contacts.map(c => `
              <div class="contact-mini">
                <b>${esc(c.name)}</b>${c.role ? ` <span class="muted">· ${esc(c.role)}</span>` : ''}
                <div class="contact-links">
                  ${c.email ? `<a href="mailto:${esc(c.email)}">${icon.mail}${esc(c.email)}</a>` : ''}
                  ${c.phone ? `<a href="tel:${esc(c.phone)}">${icon.phone}${esc(c.phone)}</a>` : ''}
                </div>
              </div>`).join('') : `<p class="muted">No contacts saved for this client.</p>`}`
            : `<p class="muted">No client linked. <button class="link-btn" data-action="edit-project" data-id="${p.id}">Choose a client</button></p>`}
        </div>
      </div>
    </div>`;
}
