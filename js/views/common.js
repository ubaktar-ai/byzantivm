// Small building blocks shared by several screens.
import { STAGES, PRIORITIES, PROJECT_STATUSES, esc, icon, fmtDate, daysUntil, label, avatar } from '../lib.js';
import { store, companies, commentCount } from '../store.js';
import { ui } from '../ui-state.js';

export function dueChip(dateStr, done = false) {
  if (!dateStr) return '';
  if (done) return `<span class="chip">${esc(fmtDate(dateStr))}</span>`;
  const n = daysUntil(dateStr);
  const cls = n < 0 ? 'overdue' : n <= 2 ? 'soon' : '';
  return `<span class="chip ${cls}">${esc(fmtDate(dateStr))}</span>`;
}

export function companyChip(companyId) {
  const c = store.get('companies', companyId);
  if (!c) return '';
  return `<span class="chip"><span class="dot" style="background:${esc(c.color)}"></span>${esc(c.name)}</span>`;
}

export function stageChip(stage) {
  return `<span class="chip stage-${esc(stage)}">${esc(label(STAGES, stage))}</span>`;
}

export function statusChip(status) {
  if (status === 'active') return '';
  return `<span class="chip ${status === 'completed' ? 'done' : ''}">${esc(label(PROJECT_STATUSES, status))}</span>`;
}

export const prioDot = p => `<span class="prio ${esc(p)}" title="${esc(label(PRIORITIES, p))} priority"></span>`;

export function companyColor(companyId) {
  const c = store.get('companies', companyId);
  return c ? c.color : '#94a3b8';
}

export function taskRow(t, { showProject = true } = {}) {
  const p = store.get('projects', t.project_id);
  const assignee = store.get('profiles', t.assignee_id);
  const nComments = commentCount(t.id);
  return `
    <div class="task-row ${t.done ? 'is-done' : ''}" data-action="edit-task" data-id="${t.id}">
      <button class="check ${t.done ? 'on' : ''}" data-action="toggle-done" data-id="${t.id}" aria-label="${t.done ? 'Mark as not done' : 'Mark as done'}">${icon.check}</button>
      <div class="body">
        <div class="title">${esc(t.title)}</div>
        <div class="meta">
          ${prioDot(t.priority)}
          ${showProject && p ? `<span class="proj"><span class="dot" style="background:${esc(companyColor(p.company_id))}"></span>${esc(p.name)}</span>` : ''}
          <span>· ${esc(label(STAGES, t.stage))}</span>
          ${nComments ? `<span class="comments-count">${icon.chat}${nComments}</span>` : ''}
        </div>
      </div>
      ${dueChip(t.due_date, t.done)}
      ${assignee ? avatar(assignee) : ''}
    </div>`;
}

export function companySegmented() {
  const opts = [{ id: 'all', name: 'All' }, ...companies()];
  return `<div class="segmented mobile-company">${opts.map(o => `
    <button type="button" data-action="set-company" data-id="${esc(o.id)}" aria-pressed="${ui.company === o.id}">${esc(o.name)}</button>`).join('')}</div>`;
}

export function scopeName() {
  if (ui.company === 'all') return 'Byzantivm & Demya';
  return (store.get('companies', ui.company) || {}).name || '';
}

export function emptyState(title, text, actions = '') {
  return `<div class="empty"><h3>${esc(title)}</h3>${text ? `<div>${esc(text)}</div>` : ''}${actions ? `<div class="head-actions">${actions}</div>` : ''}</div>`;
}
