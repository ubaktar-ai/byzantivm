import { esc, icon, todayStr, addDays } from '../lib.js';
import { store, profiles, isOverdue, byDueThenPriority } from '../store.js';
import { ui, inScope } from '../ui-state.js';
import { taskRow, companySegmented, emptyState } from './common.js';

export function viewTasks() {
  const q = (ui.taskSearch || '').trim().toLowerCase();
  const myId = store.user?.id;

  let tasks = store.all('tasks').filter(t => {
    const p = store.get('projects', t.project_id);
    return p && inScope(p.company_id);
  });
  if (ui.taskScope === 'mine') tasks = tasks.filter(t => t.assignee_id === myId);
  else if (ui.taskScope === 'unassigned') tasks = tasks.filter(t => !t.assignee_id);
  else if (ui.taskScope !== 'everyone') tasks = tasks.filter(t => t.assignee_id === ui.taskScope);
  if (ui.taskShow === 'open') tasks = tasks.filter(t => !t.done);
  else if (ui.taskShow === 'done') tasks = tasks.filter(t => t.done);
  if (q) {
    tasks = tasks.filter(t => {
      const p = store.get('projects', t.project_id);
      const c = p && store.get('clients', p.client_id);
      return [t.title, t.notes, p && p.name, c && c.name].some(v => (v || '').toLowerCase().includes(q));
    });
  }
  tasks.sort(byDueThenPriority);

  const today = todayStr();
  const weekEnd = addDays(today, 7);
  const groups = [
    { id: 'overdue', label: 'Overdue', test: isOverdue },
    { id: 'today', label: 'Today', test: t => t.due_date === today },
    { id: 'week', label: 'Next 7 days', test: t => t.due_date > today && t.due_date <= weekEnd },
    { id: 'later', label: 'Later', test: t => t.due_date > weekEnd },
    { id: 'past', label: 'Earlier', test: t => t.due_date && t.due_date < today },
    { id: 'none', label: 'No due date', test: t => !t.due_date },
  ];
  const seen = new Set();
  const grouped = groups.map(g => {
    const items = tasks.filter(t => !seen.has(t.id) && g.test(t));
    items.forEach(t => seen.add(t.id));
    return { ...g, items };
  }).filter(g => g.items.length);

  const people = profiles();
  const scopeOptions = [
    { id: 'mine', label: 'My tasks' },
    { id: 'everyone', label: 'Everyone' },
    { id: 'unassigned', label: 'Unassigned' },
    ...people.filter(p => p.id !== myId).map(p => ({ id: p.id, label: p.full_name || p.email })),
  ];

  return `
    ${companySegmented()}
    <div class="page-head">
      <div><h1>Tasks</h1><div class="sub">${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}</div></div>
      <div class="head-actions"><button class="btn primary" data-action="new-task">${icon.plus} New task</button></div>
    </div>
    <div class="toolbar">
      <select class="filter" id="task-scope" aria-label="Whose tasks">
        ${scopeOptions.map(o => `<option value="${esc(o.id)}" ${ui.taskScope === o.id ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
      </select>
      <div class="segmented">
        ${[['open', 'Open'], ['done', 'Done'], ['all', 'All']].map(([id, l]) => `<button type="button" data-action="task-show" data-id="${id}" aria-pressed="${ui.taskShow === id}">${l}</button>`).join('')}
      </div>
      <input class="search" type="search" id="task-search" placeholder="Search tasks, projects, clients…" value="${esc(ui.taskSearch || '')}" autocomplete="off">
    </div>
    ${grouped.length ? `<div class="task-list card-surface">${grouped.map(g => `
      <div class="group-label ${g.id === 'overdue' ? 'overdue' : ''}">${esc(g.label)} · ${g.items.length}</div>
      ${g.items.map(t => taskRow(t)).join('')}`).join('')}</div>`
      : emptyState(ui.taskScope === 'mine' && ui.taskShow === 'open' && !q ? 'You’re all caught up' : 'No tasks match', '')}`;
}
