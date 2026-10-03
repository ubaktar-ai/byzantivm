(() => {
  'use strict';

  // ---------- Constants ----------

  const STORAGE_KEY = 'byzantivm-demya-pm:v1';

  const TASK_STATUSES = [
    { id: 'todo', label: 'To Do' },
    { id: 'doing', label: 'In Progress' },
    { id: 'review', label: 'Review' },
    { id: 'done', label: 'Done' },
  ];

  const PRIORITIES = [
    { id: 'urgent', label: 'Urgent', rank: 0 },
    { id: 'high', label: 'High', rank: 1 },
    { id: 'medium', label: 'Medium', rank: 2 },
    { id: 'low', label: 'Low', rank: 3 },
  ];

  const PROJECT_STATUSES = [
    { id: 'planning', label: 'Planning' },
    { id: 'active', label: 'Active' },
    { id: 'on-hold', label: 'On hold' },
    { id: 'completed', label: 'Completed' },
  ];

  const DEFAULT_COMPANIES = [
    { id: 'byzantivm', name: 'Byzantivm', color: '#7c3aed' },
    { id: 'demya', name: 'Demya', color: '#0d9488' },
  ];

  // ---------- State ----------

  function freshState() {
    return {
      version: 1,
      companies: DEFAULT_COMPANIES.map(c => ({ ...c })),
      projects: [],
      tasks: [],
      ui: { company: 'all', projectFilter: 'open', taskFilter: 'open', taskPriority: 'any', boardView: 'board' },
    };
  }

  function normalize(s) {
    const base = freshState();
    if (!s || typeof s !== 'object') return base;
    return {
      ...base,
      companies: Array.isArray(s.companies) && s.companies.length ? s.companies : base.companies,
      projects: Array.isArray(s.projects) ? s.projects : [],
      tasks: Array.isArray(s.tasks) ? s.tasks : [],
      ui: { ...base.ui, ...(s.ui || {}) },
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return normalize(JSON.parse(raw));
    } catch (e) { /* fall through to fresh state */ }
    return freshState();
  }

  let state = load();

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      toast('Could not save — device storage is unavailable');
    }
  }

  function commit() { save(); render(); }

  // Ask the browser not to evict our data (helps on iPadOS).
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }

  // ---------- Helpers ----------

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function parseDate(s) {
    if (!s) return null;
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function addDays(s, n) {
    const d = parseDate(s);
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function daysUntil(s) {
    if (!s) return null;
    return Math.round((parseDate(s) - parseDate(todayStr())) / 86400000);
  }

  function fmtDate(s) {
    if (!s) return '';
    const n = daysUntil(s);
    if (n === 0) return 'Today';
    if (n === 1) return 'Tomorrow';
    if (n === -1) return 'Yesterday';
    const d = parseDate(s);
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
  }

  function initials(name) {
    return String(name || '').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
  }

  const company = id => state.companies.find(c => c.id === id);
  const project = id => state.projects.find(p => p.id === id);
  const task = id => state.tasks.find(t => t.id === id);
  const label = (list, id) => (list.find(x => x.id === id) || {}).label || id;

  function inScope(companyId) {
    return state.ui.company === 'all' || state.ui.company === companyId;
  }

  function scopedProjects() {
    return state.projects.filter(p => inScope(p.companyId));
  }

  function scopedTasks() {
    return state.tasks.filter(t => {
      const p = project(t.projectId);
      return p && inScope(p.companyId);
    });
  }

  const tasksOf = projectId => state.tasks.filter(t => t.projectId === projectId);
  const isOpen = t => t.status !== 'done';

  function isOverdue(t) {
    return isOpen(t) && t.dueDate && daysUntil(t.dueDate) < 0;
  }

  function projectProgress(p) {
    const ts = tasksOf(p.id);
    const done = ts.filter(t => t.status === 'done').length;
    return { total: ts.length, done, pct: ts.length ? Math.round((done / ts.length) * 100) : 0 };
  }

  function byDueThenPriority(a, b) {
    const da = a.dueDate || '9999-99-99';
    const db = b.dueDate || '9999-99-99';
    if (da !== db) return da < db ? -1 : 1;
    return label2rank(a.priority) - label2rank(b.priority);
  }
  const label2rank = id => (PRIORITIES.find(p => p.id === id) || { rank: 9 }).rank;

  function allAssignees() {
    return [...new Set(state.tasks.map(t => (t.assignee || '').trim()).filter(Boolean))].sort();
  }

  function setTaskStatus(t, status) {
    if (t.status === status) return;
    t.status = status;
    t.completedAt = status === 'done' ? new Date().toISOString() : null;
    t.updatedAt = new Date().toISOString();
  }

  // ---------- Toast ----------

  let toastTimer;
  function toast(msg, action) {
    const el = $('#toast');
    el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
    if (action) el.querySelector('button').onclick = () => { action.run(); el.classList.remove('show'); };
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), action ? 5000 : 2400);
  }

  // ---------- Small render pieces ----------

  function dueChip(t) {
    if (!t.dueDate) return '';
    if (t.status === 'done') return `<span class="chip">${esc(fmtDate(t.dueDate))}</span>`;
    const n = daysUntil(t.dueDate);
    const cls = n < 0 ? 'overdue' : n <= 2 ? 'soon' : '';
    return `<span class="chip ${cls}">${esc(fmtDate(t.dueDate))}</span>`;
  }

  function companyChip(cid) {
    const c = company(cid);
    if (!c) return '';
    return `<span class="chip"><span class="dot" style="background:${esc(c.color)}"></span>${esc(c.name)}</span>`;
  }

  const checkIcon = '<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>';
  const plusIcon = '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>';

  function taskRow(t, { showProject = true } = {}) {
    const p = project(t.projectId);
    const c = p && company(p.companyId);
    return `
      <div class="task-row ${t.status === 'done' ? 'is-done' : ''}" data-action="edit-task" data-id="${t.id}">
        <button class="check ${t.status === 'done' ? 'on' : ''}" data-action="toggle-done" data-id="${t.id}" aria-label="${t.status === 'done' ? 'Mark as not done' : 'Mark as done'}">${checkIcon}</button>
        <div class="body">
          <div class="title">${esc(t.title)}</div>
          <div class="meta">
            <span class="prio ${esc(t.priority)}" title="${esc(label(PRIORITIES, t.priority))} priority"></span>
            ${showProject && p ? `<span><span class="dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${esc(c ? c.color : '#999')}"></span> ${esc(p.name)}</span>` : ''}
            ${t.status !== 'todo' && t.status !== 'done' ? `<span class="chip">${esc(label(TASK_STATUSES, t.status))}</span>` : ''}
            ${t.assignee ? `<span>· ${esc(t.assignee)}</span>` : ''}
          </div>
        </div>
        ${dueChip(t)}
      </div>`;
  }

  function mobileCompanySwitch() {
    return `<div class="mobile-company">${companySegmented()}</div>`;
  }

  function companySegmented() {
    const opts = [{ id: 'all', name: 'All' }, ...state.companies];
    return `<div class="segmented" role="tablist">${opts.map(o => `
      <button type="button" data-action="set-company" data-id="${o.id}" aria-pressed="${state.ui.company === o.id}">${esc(o.name)}</button>`).join('')}</div>`;
  }

  // ---------- Views ----------

  function viewDashboard() {
    const now = new Date();
    const hour = now.getHours();
    const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const dateLine = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

    const comps = state.companies.filter(c => inScope(c.id));
    const weekAgo = Date.now() - 7 * 86400000;

    const cards = comps.map(c => {
      const ps = state.projects.filter(p => p.companyId === c.id);
      const pIds = new Set(ps.map(p => p.id));
      const ts = state.tasks.filter(t => pIds.has(t.projectId));
      const activeProjects = ps.filter(p => p.status === 'active' || p.status === 'planning').length;
      const open = ts.filter(isOpen).length;
      const overdue = ts.filter(isOverdue).length;
      const doneWeek = ts.filter(t => t.status === 'done' && t.completedAt && Date.parse(t.completedAt) >= weekAgo).length;
      return `
        <div class="company-card card-surface" style="--c:${esc(c.color)}">
          <h3>${esc(c.name)} <button class="btn small ghost" data-action="set-company" data-id="${c.id}" ${state.ui.company === c.id ? 'hidden' : ''}>Focus</button></h3>
          <div class="stats">
            <div class="stat"><b>${activeProjects}</b><span>Live projects</span></div>
            <div class="stat"><b>${open}</b><span>Open tasks</span></div>
            <div class="stat ${overdue ? 'bad' : ''}"><b>${overdue}</b><span>Overdue</span></div>
            <div class="stat"><b>${doneWeek}</b><span>Done this week</span></div>
          </div>
        </div>`;
    }).join('');

    const horizon = addDays(todayStr(), 7);
    const dueSoon = scopedTasks()
      .filter(t => isOpen(t) && t.dueDate && t.dueDate <= horizon)
      .sort(byDueThenPriority)
      .slice(0, 12);

    const live = scopedProjects()
      .filter(p => p.status === 'active' || p.status === 'planning')
      .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));

    const hasAnything = scopedProjects().length > 0;

    return `
      ${mobileCompanySwitch()}
      <div class="page-head">
        <div><h1>${greet}</h1><div class="sub">${esc(dateLine)}</div></div>
        <div class="head-actions">
          <button class="btn" data-action="new-project">${plusIcon} New project</button>
        </div>
      </div>
      <div class="company-cards">${cards}</div>

      ${!hasAnything ? `
        <h2 class="section">Get started</h2>
        <div class="empty">
          <h3>No projects yet</h3>
          <div>Create your first project, or load some sample data to look around.</div>
          <div class="head-actions">
            <button class="btn primary" data-action="new-project">${plusIcon} New project</button>
            <button class="btn" data-action="load-sample">Load sample data</button>
          </div>
        </div>` : `
        <div class="two-col">
          <div>
            <h2 class="section">Due in the next 7 days</h2>
            ${dueSoon.length
              ? `<div class="task-list card-surface">${dueSoon.map(t => taskRow(t)).join('')}</div>`
              : `<div class="empty">Nothing due this week. 🎉</div>`}
          </div>
          <div>
            <h2 class="section">Live projects</h2>
            ${live.length ? `<div class="card-surface">${live.map(p => {
              const pr = projectProgress(p);
              const c = company(p.companyId);
              return `
                <a class="project-mini" href="#/project/${p.id}">
                  <div class="row"><b>${esc(p.name)}</b><span>${pr.done}/${pr.total}</span></div>
                  <div class="progress"><span style="width:${pr.pct}%;background:${esc(c ? c.color : 'var(--accent)')}"></span></div>
                </a>`;
            }).join('')}</div>` : `<div class="empty">No active projects.</div>`}
          </div>
        </div>`}
    `;
  }

  function viewProjects() {
    const f = state.ui.projectFilter;
    const filters = [
      { id: 'open', label: 'Open' },
      ...PROJECT_STATUSES,
      { id: 'all', label: 'All' },
    ];
    let ps = scopedProjects();
    if (f === 'open') ps = ps.filter(p => p.status !== 'completed');
    else if (f !== 'all') ps = ps.filter(p => p.status === f);
    ps.sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || a.name.localeCompare(b.name));

    const scopeName = state.ui.company === 'all' ? 'All companies' : (company(state.ui.company) || {}).name;

    return `
      ${mobileCompanySwitch()}
      <div class="page-head">
        <div><h1>Projects</h1><div class="sub">${esc(scopeName)}</div></div>
        <div class="head-actions"><button class="btn primary" data-action="new-project">${plusIcon} New project</button></div>
      </div>
      <div class="toolbar">
        <div class="segmented">${filters.map(x => `<button type="button" data-action="project-filter" data-id="${x.id}" aria-pressed="${f === x.id}">${esc(x.label)}</button>`).join('')}</div>
      </div>
      ${ps.length ? `<div class="project-grid">${ps.map(p => {
        const c = company(p.companyId);
        const pr = projectProgress(p);
        const overdue = tasksOf(p.id).filter(isOverdue).length;
        return `
          <a class="project-card card-surface" href="#/project/${p.id}" style="--c:${esc(c ? c.color : '#999')}">
            <div class="row">${companyChip(p.companyId)}<span class="chip ${p.status === 'completed' ? 'done' : ''}">${esc(label(PROJECT_STATUSES, p.status))}</span></div>
            <h3>${esc(p.name)}</h3>
            ${p.description ? `<p>${esc(p.description)}</p>` : ''}
            <div class="progress"><span style="width:${pr.pct}%;background:var(--c)"></span></div>
            <div class="row">
              <span>${pr.done} of ${pr.total} tasks done${overdue ? ` · <b style="color:var(--danger)">${overdue} overdue</b>` : ''}</span>
              ${p.dueDate ? `<span>Due ${esc(fmtDate(p.dueDate))}</span>` : ''}
            </div>
          </a>`;
      }).join('')}</div>` : `
        <div class="empty">
          <h3>No projects here</h3>
          <div>${f === 'open' || f === 'all' ? 'Create a project to start tracking work.' : 'No projects with this status.'}</div>
          <div class="head-actions"><button class="btn primary" data-action="new-project">${plusIcon} New project</button></div>
        </div>`}
    `;
  }

  function viewProject(id) {
    const p = project(id);
    if (!p) {
      return `<div class="empty"><h3>Project not found</h3><div class="head-actions"><a class="btn" href="#/projects">Back to projects</a></div></div>`;
    }
    const c = company(p.companyId);
    const ts = tasksOf(p.id);
    const pr = projectProgress(p);
    const mode = state.ui.boardView;

    const board = `
      <div class="board" id="board">
        ${TASK_STATUSES.map(s => {
          const col = ts.filter(t => t.status === s.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
          return `
            <section class="column" data-status="${s.id}">
              <div class="column-head"><span>${esc(s.label)}</span><span class="count">${col.length}</span></div>
              <div class="column-cards">
                ${col.map(t => `
                  <div class="task-card ${t.status === 'done' ? 'is-done' : ''}" data-task="${t.id}" data-action="edit-task" data-id="${t.id}">
                    <div class="title">${esc(t.title)}</div>
                    <div class="meta">
                      <span class="prio ${esc(t.priority)}" title="${esc(label(PRIORITIES, t.priority))} priority"></span>
                      ${dueChip(t)}
                      ${t.assignee ? `<span class="avatar" title="${esc(t.assignee)}">${esc(initials(t.assignee))}</span>` : ''}
                    </div>
                  </div>`).join('')}
              </div>
              <button class="btn small add-in-col" data-action="new-task" data-project="${p.id}" data-status="${s.id}">${plusIcon} Add task</button>
            </section>`;
        }).join('')}
      </div>`;

    const list = ts.length ? `
      <div class="task-list card-surface">
        ${TASK_STATUSES.map(s => {
          const group = ts.filter(t => t.status === s.id).sort(byDueThenPriority);
          return group.length ? `<div class="group-label">${esc(s.label)} · ${group.length}</div>${group.map(t => taskRow(t, { showProject: false })).join('')}` : '';
        }).join('')}
      </div>` : `<div class="empty"><h3>No tasks yet</h3><div class="head-actions"><button class="btn primary" data-action="new-task" data-project="${p.id}">${plusIcon} Add task</button></div></div>`;

    return `
      <a class="crumbs" href="#/projects"><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>Projects</a>
      <div class="page-head project-head" style="--c:${esc(c ? c.color : '#999')}">
        <div>
          <h1>${esc(p.name)}</h1>
          <div class="sub" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px">
            ${companyChip(p.companyId)}
            <span class="chip ${p.status === 'completed' ? 'done' : ''}">${esc(label(PROJECT_STATUSES, p.status))}</span>
            ${p.dueDate ? `<span class="chip ${p.status !== 'completed' && daysUntil(p.dueDate) < 0 ? 'overdue' : ''}">Due ${esc(fmtDate(p.dueDate))}</span>` : ''}
            <span>${pr.done}/${pr.total} done · ${pr.pct}%</span>
          </div>
        </div>
        <div class="head-actions">
          <div class="segmented">
            <button type="button" data-action="board-view" data-id="board" aria-pressed="${mode === 'board'}">Board</button>
            <button type="button" data-action="board-view" data-id="list" aria-pressed="${mode === 'list'}">List</button>
          </div>
          <button class="btn" data-action="edit-project" data-id="${p.id}">Edit</button>
          <button class="btn primary" data-action="new-task" data-project="${p.id}">${plusIcon} Task</button>
        </div>
      </div>
      ${p.description ? `<p class="project-desc">${esc(p.description)}</p>` : ''}
      ${mode === 'board' ? board : list}
    `;
  }

  function viewTasks() {
    const ui = state.ui;
    const q = (ui.taskSearch || '').trim().toLowerCase();
    let ts = scopedTasks();
    if (ui.taskFilter === 'open') ts = ts.filter(isOpen);
    else if (ui.taskFilter === 'done') ts = ts.filter(t => t.status === 'done');
    if (ui.taskPriority !== 'any') ts = ts.filter(t => t.priority === ui.taskPriority);
    if (ui.taskAssignee) ts = ts.filter(t => (t.assignee || '') === ui.taskAssignee);
    if (q) {
      ts = ts.filter(t => {
        const p = project(t.projectId);
        return [t.title, t.notes, t.assignee, p && p.name].some(v => (v || '').toLowerCase().includes(q));
      });
    }
    ts.sort(byDueThenPriority);

    const today = todayStr();
    const weekEnd = addDays(today, 7);
    const groups = [
      { id: 'overdue', label: 'Overdue', test: t => isOverdue(t) },
      { id: 'today', label: 'Today', test: t => t.dueDate === today },
      { id: 'week', label: 'Next 7 days', test: t => t.dueDate > today && t.dueDate <= weekEnd },
      { id: 'later', label: 'Later', test: t => t.dueDate > weekEnd },
      { id: 'past', label: 'Earlier', test: t => t.dueDate && t.dueDate < today },
      { id: 'none', label: 'No due date', test: t => !t.dueDate },
    ];
    const seen = new Set();
    const grouped = groups.map(g => {
      const items = ts.filter(t => !seen.has(t.id) && g.test(t));
      items.forEach(t => seen.add(t.id));
      return { ...g, items };
    }).filter(g => g.items.length);

    const people = allAssignees();

    return `
      ${mobileCompanySwitch()}
      <div class="page-head">
        <div><h1>Tasks</h1><div class="sub">${ts.length} ${ts.length === 1 ? 'task' : 'tasks'}</div></div>
        <div class="head-actions"><button class="btn primary" data-action="new-task">${plusIcon} New task</button></div>
      </div>
      <div class="toolbar">
        <input class="search" type="search" placeholder="Search tasks, notes, people…" value="${esc(ui.taskSearch || '')}" id="task-search" autocomplete="off">
        <div class="segmented">
          ${[['open', 'Open'], ['done', 'Done'], ['all', 'All']].map(([id, l]) => `<button type="button" data-action="task-filter" data-id="${id}" aria-pressed="${ui.taskFilter === id}">${l}</button>`).join('')}
        </div>
        <select class="filter" id="task-priority" aria-label="Priority">
          <option value="any">Any priority</option>
          ${PRIORITIES.map(p => `<option value="${p.id}" ${ui.taskPriority === p.id ? 'selected' : ''}>${p.label}</option>`).join('')}
        </select>
        ${people.length ? `<select class="filter" id="task-assignee" aria-label="Assignee">
          <option value="">Anyone</option>
          ${people.map(n => `<option value="${esc(n)}" ${ui.taskAssignee === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}
        </select>` : ''}
      </div>
      ${grouped.length ? `<div class="task-list card-surface">${grouped.map(g => `
        <div class="group-label ${g.id === 'overdue' ? 'overdue' : ''}">${esc(g.label)} · ${g.items.length}</div>
        ${g.items.map(t => taskRow(t)).join('')}`).join('')}</div>`
        : `<div class="empty"><h3>No tasks match</h3><div>${state.projects.length ? 'Try a different filter, or add a task.' : 'Create a project first, then add tasks to it.'}</div></div>`}
    `;
  }

  function viewSettings() {
    return `
      <div class="page-head"><div><h1>Settings</h1></div></div>

      <div class="settings-block card-surface">
        <h3>Companies</h3>
        <p>Names and colors used throughout the app.</p>
        <form data-form="companies">
          ${state.companies.map(c => `
            <div class="company-edit">
              <label class="field"><input type="color" name="color-${c.id}" value="${esc(c.color)}" aria-label="${esc(c.name)} color"></label>
              <label class="field"><input name="name-${c.id}" value="${esc(c.name)}" required aria-label="Company name"></label>
            </div>`).join('')}
          <button class="btn" type="submit">Save companies</button>
        </form>
      </div>

      <div class="settings-block card-surface">
        <h3>Backup</h3>
        <p>Your data lives on this device. Export a backup regularly, and use Import to restore it or move it to another device.</p>
        <div class="head-actions">
          <button class="btn" data-action="export">Export backup</button>
          <label class="btn">Import backup<input type="file" accept="application/json,.json" id="import-file" hidden></label>
        </div>
      </div>

      <div class="settings-block card-surface">
        <h3>Data</h3>
        <p>${state.projects.length} projects · ${state.tasks.length} tasks</p>
        <div class="head-actions">
          <button class="btn" data-action="load-sample">Add sample data</button>
          <button class="btn danger" data-action="erase">Erase everything</button>
        </div>
      </div>
    `;
  }

  // ---------- Router / render ----------

  function route() {
    const parts = (location.hash || '#/dashboard').replace(/^#\/?/, '').split('/');
    return { name: parts[0] || 'dashboard', id: parts[1] };
  }

  function renderCompanySwitch() {
    const [c1, c2] = state.companies;
    const opts = [{ id: 'all', name: 'All companies' }, ...state.companies];
    $('#company-switch').innerHTML = opts.map(o => `
      <button type="button" role="tab" data-action="set-company" data-id="${o.id}" aria-selected="${state.ui.company === o.id}">
        <span class="dot ${o.id === 'all' ? 'all' : ''}" style="${o.id === 'all' ? `--c1:${esc(c1.color)};--c2:${esc((c2 || c1).color)}` : `background:${esc(o.color)}`}"></span>
        ${esc(o.name)}
      </button>`).join('');
  }

  function render() {
    const r = route();
    const main = $('#main');
    const oldBoard = $('#board');
    const scrollTop = main.scrollTop;
    const boardLeft = oldBoard ? oldBoard.scrollLeft : 0;
    const searchFocused = document.activeElement && document.activeElement.id === 'task-search';
    const selStart = searchFocused ? document.activeElement.selectionStart : 0;

    renderCompanySwitch();
    $$('.nav a').forEach(a => a.classList.toggle('active', a.dataset.nav === r.name || (r.name === 'project' && a.dataset.nav === 'projects')));

    const views = { dashboard: viewDashboard, projects: viewProjects, project: () => viewProject(r.id), tasks: viewTasks, settings: viewSettings };
    $('#view').innerHTML = (views[r.name] || viewDashboard)();

    // Keep scroll position when re-rendering the same screen; reset it on navigation.
    const key = r.name + '/' + (r.id || '');
    if (key === lastRoute) {
      main.scrollTop = scrollTop;
      const nb = $('#board');
      if (nb) nb.scrollLeft = boardLeft;
    } else {
      main.scrollTop = 0;
    }
    lastRoute = key;

    if (searchFocused) {
      const s = $('#task-search');
      s.focus();
      s.setSelectionRange(selStart, selStart);
    }
  }

  let lastRoute = '';

  window.addEventListener('hashchange', render);

  // ---------- Sheets (dialogs) ----------

  const sheet = $('#sheet');

  function openSheet(html, onSubmit) {
    sheet.innerHTML = html;
    const form = sheet.querySelector('form');
    form.addEventListener('submit', e => {
      e.preventDefault();
      if (onSubmit(new FormData(form), e.submitter) !== false) sheet.close();
    });
    sheet.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => sheet.close()));
    sheet.showModal();
    const first = sheet.querySelector('[autofocus]');
    // Avoid popping the iPad keyboard when editing existing items.
    if (first && !first.value) first.focus();
  }

  sheet.addEventListener('click', e => {
    if (e.target === sheet) sheet.close(); // tap on backdrop
  });

  function projectOptions(selectedId) {
    return state.companies.map(c => {
      const ps = state.projects.filter(p => p.companyId === c.id && (p.status !== 'completed' || p.id === selectedId));
      if (!ps.length) return '';
      return `<optgroup label="${esc(c.name)}">${ps.map(p => `<option value="${p.id}" ${p.id === selectedId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</optgroup>`;
    }).join('');
  }

  function openTaskSheet(existing, defaults = {}) {
    if (!state.projects.length) {
      toast('Create a project first');
      openProjectSheet();
      return;
    }
    const t = existing || {
      title: '', notes: '', status: defaults.status || 'todo', priority: 'medium', dueDate: '', assignee: '',
      projectId: defaults.projectId || guessProject(),
    };
    openSheet(`
      <form>
        <header><h2>${existing ? 'Edit task' : 'New task'}</h2><button type="button" class="btn ghost icon-btn" data-close aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></header>
        <div class="fields">
          <label class="field"><span>Title</span><input name="title" value="${esc(t.title)}" required autofocus placeholder="What needs to happen?"></label>
          <label class="field"><span>Project</span><select name="projectId" required>${projectOptions(t.projectId)}</select></label>
          <div class="field-row">
            <label class="field"><span>Status</span><select name="status">${TASK_STATUSES.map(s => `<option value="${s.id}" ${t.status === s.id ? 'selected' : ''}>${s.label}</option>`).join('')}</select></label>
            <label class="field"><span>Priority</span><select name="priority">${PRIORITIES.map(p => `<option value="${p.id}" ${t.priority === p.id ? 'selected' : ''}>${p.label}</option>`).join('')}</select></label>
          </div>
          <div class="field-row">
            <label class="field"><span>Due date</span><input type="date" name="dueDate" value="${esc(t.dueDate)}"></label>
            <label class="field"><span>Assignee</span><input name="assignee" value="${esc(t.assignee)}" list="people" placeholder="Name" autocomplete="off"></label>
          </div>
          <datalist id="people">${allAssignees().map(n => `<option value="${esc(n)}">`).join('')}</datalist>
          <label class="field"><span>Notes</span><textarea name="notes" placeholder="Details, links, checklists…">${esc(t.notes)}</textarea></label>
        </div>
        <footer>
          ${existing ? `<button type="button" class="btn danger" data-delete-task>Delete</button>` : ''}
          <span class="spacer"></span>
          <button type="button" class="btn" data-close>Cancel</button>
          <button type="submit" class="btn primary">${existing ? 'Save' : 'Add task'}</button>
        </footer>
      </form>`, fd => {
      const data = {
        title: fd.get('title').trim(),
        projectId: fd.get('projectId'),
        priority: fd.get('priority'),
        dueDate: fd.get('dueDate') || '',
        assignee: fd.get('assignee').trim(),
        notes: fd.get('notes'),
      };
      if (!data.title) return false;
      const status = fd.get('status');
      if (existing) {
        const moved = existing.projectId !== data.projectId || existing.status !== status;
        Object.assign(existing, data, { updatedAt: new Date().toISOString() });
        setTaskStatus(existing, status);
        if (moved) existing.order = nextOrder(existing.projectId, existing.status, existing.id);
      } else {
        const nt = { id: uid(), ...data, status: 'todo', completedAt: null, createdAt: new Date().toISOString() };
        setTaskStatus(nt, status);
        nt.order = nextOrder(nt.projectId, nt.status);
        state.tasks.push(nt);
        toast('Task added');
      }
      commit();
    });

    const del = sheet.querySelector('[data-delete-task]');
    if (del) del.addEventListener('click', () => {
      sheet.close();
      deleteTask(existing);
    });
  }

  function guessProject() {
    const r = route();
    if (r.name === 'project' && project(r.id)) return r.id;
    const ps = scopedProjects().filter(p => p.status !== 'completed');
    return (ps[0] || state.projects[0]).id;
  }

  function nextOrder(projectId, status, exceptId) {
    const orders = state.tasks.filter(t => t.projectId === projectId && t.status === status && t.id !== exceptId).map(t => t.order ?? 0);
    return orders.length ? Math.max(...orders) + 1 : 0;
  }

  function deleteTask(t) {
    const idx = state.tasks.indexOf(t);
    if (idx < 0) return;
    state.tasks.splice(idx, 1);
    commit();
    toast('Task deleted', { label: 'Undo', run: () => { state.tasks.splice(idx, 0, t); commit(); } });
  }

  function openProjectSheet(existing) {
    const defaultCompany = state.ui.company !== 'all' ? state.ui.company : state.companies[0].id;
    const p = existing || { name: '', description: '', companyId: defaultCompany, status: 'active', startDate: todayStr(), dueDate: '' };
    openSheet(`
      <form>
        <header><h2>${existing ? 'Edit project' : 'New project'}</h2><button type="button" class="btn ghost icon-btn" data-close aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></header>
        <div class="fields">
          <label class="field"><span>Project name</span><input name="name" value="${esc(p.name)}" required autofocus placeholder="e.g. Website redesign"></label>
          <div class="field-row">
            <label class="field"><span>Company</span><select name="companyId">${state.companies.map(c => `<option value="${c.id}" ${p.companyId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
            <label class="field"><span>Status</span><select name="status">${PROJECT_STATUSES.map(s => `<option value="${s.id}" ${p.status === s.id ? 'selected' : ''}>${s.label}</option>`).join('')}</select></label>
          </div>
          <div class="field-row">
            <label class="field"><span>Start date</span><input type="date" name="startDate" value="${esc(p.startDate)}"></label>
            <label class="field"><span>Due date</span><input type="date" name="dueDate" value="${esc(p.dueDate)}"></label>
          </div>
          <label class="field"><span>Description</span><textarea name="description" placeholder="Goals, scope, client, links…">${esc(p.description)}</textarea></label>
        </div>
        <footer>
          ${existing ? `<button type="button" class="btn danger" data-delete-project>Delete</button>` : ''}
          <span class="spacer"></span>
          <button type="button" class="btn" data-close>Cancel</button>
          <button type="submit" class="btn primary">${existing ? 'Save' : 'Create project'}</button>
        </footer>
      </form>`, fd => {
      const data = {
        name: fd.get('name').trim(),
        companyId: fd.get('companyId'),
        status: fd.get('status'),
        startDate: fd.get('startDate') || '',
        dueDate: fd.get('dueDate') || '',
        description: fd.get('description'),
      };
      if (!data.name) return false;
      if (existing) {
        Object.assign(existing, data, { updatedAt: new Date().toISOString() });
        commit();
      } else {
        const np = { id: uid(), ...data, createdAt: new Date().toISOString() };
        state.projects.push(np);
        save();
        location.hash = `#/project/${np.id}`;
        render();
      }
    });

    const del = sheet.querySelector('[data-delete-project]');
    if (del) del.addEventListener('click', () => {
      const n = tasksOf(existing.id).length;
      if (!confirm(`Delete “${existing.name}”${n ? ` and its ${n} task${n === 1 ? '' : 's'}` : ''}? This can't be undone.`)) return;
      sheet.close();
      state.projects = state.projects.filter(x => x.id !== existing.id);
      state.tasks = state.tasks.filter(t => t.projectId !== existing.id);
      save();
      location.hash = '#/projects';
      render();
      toast('Project deleted');
    });
  }

  // ---------- Actions ----------

  let suppressClickUntil = 0;

  document.addEventListener('click', e => {
    if (Date.now() < suppressClickUntil) { e.preventDefault(); e.stopPropagation(); return; }
    const el = e.target.closest('[data-action]');
    if (!el || sheet.contains(el)) return;
    const { action, id } = el.dataset;

    switch (action) {
      case 'set-company':
        state.ui.company = id;
        commit();
        break;
      case 'new-task':
        openTaskSheet(null, { projectId: el.dataset.project, status: el.dataset.status });
        break;
      case 'edit-task': {
        const t = task(id);
        if (t) openTaskSheet(t);
        break;
      }
      case 'toggle-done': {
        e.stopPropagation();
        const t = task(id);
        if (!t) break;
        const prev = t.status;
        setTaskStatus(t, t.status === 'done' ? 'todo' : 'done');
        t.order = nextOrder(t.projectId, t.status, t.id);
        commit();
        if (t.status === 'done') toast('Marked done', { label: 'Undo', run: () => { setTaskStatus(t, prev); commit(); } });
        break;
      }
      case 'new-project':
        openProjectSheet();
        break;
      case 'edit-project': {
        const p = project(id);
        if (p) openProjectSheet(p);
        break;
      }
      case 'project-filter':
        state.ui.projectFilter = id;
        commit();
        break;
      case 'task-filter':
        state.ui.taskFilter = id;
        commit();
        break;
      case 'board-view':
        state.ui.boardView = id;
        commit();
        break;
      case 'export':
        exportBackup();
        break;
      case 'load-sample':
        loadSample();
        break;
      case 'erase':
        if (confirm('Erase all projects and tasks on this device? Export a backup first if you might need them.')) {
          const companies = state.companies;
          state = freshState();
          state.companies = companies;
          commit();
          toast('All data erased');
        }
        break;
    }
  });

  document.addEventListener('input', e => {
    if (e.target.id === 'task-search') {
      state.ui.taskSearch = e.target.value;
      render(); // not saved on every keystroke
    }
  });

  document.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'task-priority') { state.ui.taskPriority = t.value; commit(); }
    else if (t.id === 'task-assignee') { state.ui.taskAssignee = t.value; commit(); }
    else if (t.id === 'import-file' && t.files[0]) importBackup(t.files[0]);
  });

  document.addEventListener('submit', e => {
    const form = e.target;
    if (form.dataset.form !== 'companies') return;
    e.preventDefault();
    const fd = new FormData(form);
    state.companies.forEach(c => {
      c.name = (fd.get(`name-${c.id}`) || c.name).trim() || c.name;
      c.color = fd.get(`color-${c.id}`) || c.color;
    });
    commit();
    toast('Companies saved');
  });

  // ---------- Backup ----------

  function exportBackup() {
    const data = JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const name = `projects-backup-${todayStr()}.json`;
    const file = new File([blob], name, { type: 'application/json' });
    // On iPad the share sheet lets you save to Files, iCloud Drive, AirDrop, etc.
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: name }).catch(() => {});
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function importBackup(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data.projects) || !Array.isArray(data.tasks)) throw new Error('bad file');
        if (!confirm(`Replace current data with this backup (${data.projects.length} projects, ${data.tasks.length} tasks)?`)) return;
        state = normalize(data);
        commit();
        toast('Backup restored');
      } catch (err) {
        toast('That file is not a valid backup');
      }
    };
    reader.readAsText(file);
  }

  // ---------- Sample data ----------

  function loadSample() {
    const t0 = todayStr();
    const d = n => addDays(t0, n);
    const [byz, dem] = state.companies;
    const mk = (companyId, name, status, dueDate, description, tasks) => {
      const p = { id: uid(), companyId, name, status, startDate: d(-20), dueDate, description, createdAt: new Date().toISOString() };
      state.projects.push(p);
      tasks.forEach(([title, st, priority, due, assignee], i) => {
        state.tasks.push({
          id: uid(), projectId: p.id, title, status: st, priority, dueDate: due === null ? '' : d(due), assignee: assignee || '',
          notes: '', order: i, createdAt: new Date().toISOString(),
          completedAt: st === 'done' ? new Date(Date.now() - (i + 1) * 86400000).toISOString() : null,
        });
      });
    };
    mk(byz.id, 'Brand refresh', 'active', d(30), 'New logo, typography and brand guidelines.', [
      ['Collect stakeholder feedback', 'done', 'medium', -6, 'Elena'],
      ['Moodboards — 3 directions', 'done', 'high', -3, 'Nikos'],
      ['Logo concepts round 1', 'review', 'high', 1, 'Nikos'],
      ['Typography pairing', 'doing', 'medium', 4, 'Elena'],
      ['Brand guidelines PDF', 'todo', 'medium', 21, ''],
      ['Print vendor quotes', 'todo', 'low', null, 'Elena'],
    ]);
    mk(byz.id, 'Q4 client onboarding', 'active', d(12), 'Onboard three new enterprise clients.', [
      ['Kickoff call — client A', 'done', 'high', -2, 'Ali'],
      ['Contract signatures', 'doing', 'urgent', -1, 'Ali'],
      ['Set up shared workspace', 'todo', 'medium', 2, 'Nikos'],
      ['Training session', 'todo', 'medium', 9, ''],
    ]);
    mk(dem.id, 'Mobile app launch', 'active', d(45), 'v1.0 of the Demya app on the App Store.', [
      ['Finalize onboarding flow', 'doing', 'high', 3, 'Selin'],
      ['Beta feedback triage', 'review', 'medium', 0, 'Mert'],
      ['App Store screenshots', 'todo', 'medium', 14, 'Selin'],
      ['Push notification setup', 'todo', 'high', 6, 'Mert'],
      ['Privacy policy update', 'done', 'urgent', -5, 'Ayşe'],
    ]);
    mk(dem.id, 'Office move', 'planning', d(60), 'Move to the new office by end of quarter.', [
      ['Shortlist movers', 'todo', 'low', 10, 'Ayşe'],
      ['Floor plan & seating', 'todo', 'medium', 20, ''],
    ]);
    commit();
    toast('Sample data added');
  }

  // ---------- Board drag & drop (touch + mouse) ----------

  const drag = { pending: null, active: null };

  document.addEventListener('pointerdown', e => {
    const card = e.target.closest('.task-card');
    if (!card || e.button > 0) return;
    const p = { card, id: card.dataset.task, x: e.clientX, y: e.clientY, pointerId: e.pointerId, type: e.pointerType };
    drag.pending = p;
    if (e.pointerType !== 'mouse') {
      // Touch: long-press to pick up, so normal swipes still scroll the board.
      card.classList.add('pressing');
      p.timer = setTimeout(() => { if (drag.pending === p) startDrag(p, p.x, p.y); }, 280);
    }
  });

  document.addEventListener('pointermove', e => {
    const p = drag.pending;
    if (p && !drag.active && e.pointerId === p.pointerId) {
      const moved = Math.hypot(e.clientX - p.x, e.clientY - p.y);
      if (p.type === 'mouse' && moved > 6) startDrag(p, e.clientX, e.clientY);
      else if (p.type !== 'mouse' && moved > 10) cancelPending();
    }
    if (drag.active && e.pointerId === drag.active.pointerId) moveDrag(e.clientX, e.clientY);
  });

  document.addEventListener('pointerup', e => {
    if (drag.active && e.pointerId === drag.active.pointerId) endDrag(true);
    else cancelPending();
  });
  document.addEventListener('pointercancel', () => { if (drag.active) endDrag(false); else cancelPending(); });

  // While dragging on touch, stop the page from scrolling.
  document.addEventListener('touchmove', e => { if (drag.active) e.preventDefault(); }, { passive: false });
  document.addEventListener('contextmenu', e => { if (drag.pending || drag.active) e.preventDefault(); });

  function cancelPending() {
    const p = drag.pending;
    if (!p) return;
    clearTimeout(p.timer);
    p.card.classList.remove('pressing');
    drag.pending = null;
  }

  function startDrag(p, x, y) {
    clearTimeout(p.timer);
    p.card.classList.remove('pressing');
    drag.pending = null;
    const rect = p.card.getBoundingClientRect();
    const ghost = p.card.cloneNode(true);
    ghost.classList.add('ghost');
    ghost.style.width = rect.width + 'px';
    document.body.appendChild(ghost);
    p.card.classList.add('dragging-src');
    const marker = document.createElement('div');
    marker.className = 'drop-marker';
    drag.active = { ...p, ghost, marker, dx: x - rect.left, dy: y - rect.top, target: null, index: 0 };
    if (navigator.vibrate) navigator.vibrate(10);
    moveDrag(x, y);
  }

  function moveDrag(x, y) {
    const a = drag.active;
    a.ghost.style.left = (x - a.dx) + 'px';
    a.ghost.style.top = (y - a.dy) + 'px';

    const under = document.elementFromPoint(x, y);
    const col = under && under.closest('.column');
    $$('.column.drop-target').forEach(c => c !== col && c.classList.remove('drop-target'));
    if (col) {
      col.classList.add('drop-target');
      const list = $('.column-cards', col);
      const cards = $$('.task-card:not(.dragging-src)', list);
      let index = cards.length;
      for (let i = 0; i < cards.length; i++) {
        const r = cards[i].getBoundingClientRect();
        if (y < r.top + r.height / 2) { index = i; break; }
      }
      a.target = col.dataset.status;
      a.index = index;
      list.insertBefore(a.marker, cards[index] || null);
    } else {
      a.target = null;
      a.marker.remove();
    }

    // Auto-scroll the board horizontally and the page vertically near edges.
    const board = $('#board');
    if (board) {
      const br = board.getBoundingClientRect();
      if (x < br.left + 40) board.scrollLeft -= 12;
      else if (x > br.right - 40) board.scrollLeft += 12;
    }
    const main = $('#main');
    if (y < 60) main.scrollTop -= 12;
    else if (y > window.innerHeight - 60) main.scrollTop += 12;
  }

  function endDrag(commitDrop) {
    const a = drag.active;
    drag.active = null;
    a.ghost.remove();
    a.marker.remove();
    a.card.classList.remove('dragging-src');
    $$('.column.drop-target').forEach(c => c.classList.remove('drop-target'));
    suppressClickUntil = Date.now() + 350;

    const t = task(a.id);
    if (!commitDrop || !a.target || !t) return;

    const column = state.tasks
      .filter(x => x.projectId === t.projectId && x.status === a.target && x.id !== t.id)
      .sort((p, q) => (p.order ?? 0) - (q.order ?? 0));
    column.splice(a.index, 0, t);
    setTaskStatus(t, a.target);
    column.forEach((x, i) => { x.order = i; });
    commit();
  }

  // ---------- Boot ----------

  if (!location.hash) history.replaceState(null, '', '#/dashboard');
  render();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
