// Calendar (month view + day list) and Timeline (projects as bars over the weeks).
import { esc, icon, todayStr, addDays, parseDate, dateStr, daysUntil, money, label, STAGES } from '../lib.js';
import { store, deliverablesOf } from '../store.js';
import { ui, inScope } from '../ui-state.js';
import { companySegmented, companyColor, scopeName, emptyState } from './common.js';

const TYPES = [
  { id: 'task', label: 'Tasks' },
  { id: 'project', label: 'Deadlines' },
  { id: 'deliverable', label: 'Deliverables' },
  { id: 'invoice', label: 'Invoices' },
];

const shown = type => !(ui.calHidden || []).includes(type);

// ---------- Events ----------

function collectEvents(from, to) {
  const inRange = d => d && d >= from && d <= to;
  const out = [];
  const projects = new Map(store.all('projects').filter(p => inScope(p.company_id)).map(p => [p.id, p]));
  const mineOnly = ui.calMine;

  if (shown('task')) store.all('tasks').forEach(t => {
    const p = projects.get(t.project_id);
    if (!p || !inRange(t.due_date) || (mineOnly && t.assignee_id !== store.user?.id)) return;
    out.push({ type: 'task', date: t.due_date, id: t.id, title: t.title, sub: p.name, color: companyColor(p.company_id), done: t.done, p });
  });
  if (shown('project')) projects.forEach(p => {
    if (!inRange(p.due_date) || p.status === 'cancelled') return;
    out.push({ type: 'project', date: p.due_date, id: p.id, title: `${p.name} deadline`, sub: label(STAGES, p.stage), color: companyColor(p.company_id), done: p.status === 'completed', p });
  });
  if (shown('deliverable')) store.all('deliverables').forEach(d => {
    const p = projects.get(d.project_id);
    if (!p || !inRange(d.due_date) || d.status === 'cancelled') return;
    out.push({ type: 'deliverable', date: d.due_date, id: d.id, title: d.name, sub: p.name, color: companyColor(p.company_id), done: d.status === 'approved', p });
  });
  if (shown('invoice')) store.all('invoices').forEach(inv => {
    const p = projects.get(inv.project_id);
    if (!p || !inRange(inv.due_date) || inv.status === 'draft' || inv.status === 'cancelled') return;
    out.push({ type: 'invoice', date: inv.due_date, id: inv.id, title: `${inv.number || 'Invoice'} due`, sub: `${money(inv.amount, p.currency)} · ${p.name}`, color: companyColor(p.company_id), done: inv.status === 'paid', p });
  });
  const order = { project: 0, deliverable: 1, invoice: 2, task: 3 };
  return out.sort((a, b) => a.date.localeCompare(b.date) || order[a.type] - order[b.type] || a.done - b.done);
}

function eventAttrs(e) {
  if (e.type === 'task') return `data-action="edit-task" data-id="${e.id}"`;
  const tab = e.type === 'deliverable' ? 'deliverables' : e.type === 'invoice' ? 'money' : 'tasks';
  return `data-action="go" data-href="#/project/${e.p.id}/${tab}"`;
}

const typeIcon = { task: '●', project: '◆', deliverable: '▲', invoice: '€' };

// ---------- Screen ----------

export function viewCalendar() {
  const mode = ui.calMode || 'month';
  const head = `
    ${companySegmented()}
    <div class="page-head">
      <div><h1>Calendar</h1><div class="sub">${esc(scopeName())}</div></div>
      <div class="head-actions">
        <div class="segmented">
          <button type="button" data-action="cal-mode" data-id="month" aria-pressed="${mode === 'month'}">Month</button>
          <button type="button" data-action="cal-mode" data-id="timeline" aria-pressed="${mode === 'timeline'}">Timeline</button>
        </div>
      </div>
    </div>`;
  return head + (mode === 'timeline' ? timeline() : month());
}

function month() {
  const today = todayStr();
  const anchor = ui.calMonth || today.slice(0, 7); // YYYY-MM
  const [y, m] = anchor.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const offset = (first.getDay() + 6) % 7; // weeks start on Monday
  const gridStart = dateStr(new Date(y, m - 1, 1 - offset));
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const events = collectEvents(days[0], days[41]);
  const byDay = new Map();
  events.forEach(e => { if (!byDay.has(e.date)) byDay.set(e.date, []); byDay.get(e.date).push(e); });
  const selected = ui.calDay && ui.calDay.slice(0, 7) === anchor ? ui.calDay : (today.slice(0, 7) === anchor ? today : dateStr(first));
  const title = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: 'short' }));
  const prev = dateStr(new Date(y, m - 2, 1)).slice(0, 7);
  const next = dateStr(new Date(y, m, 1)).slice(0, 7);

  const filters = `
    <div class="toolbar cal-toolbar">
      <div class="month-nav">
        <button class="btn icon-btn" data-action="cal-month" data-id="${prev}" aria-label="Previous month">${icon.back}</button>
        <h2 class="month-title">${esc(title)}</h2>
        <button class="btn icon-btn flip" data-action="cal-month" data-id="${next}" aria-label="Next month">${icon.back}</button>
        ${anchor !== today.slice(0, 7) ? `<button class="btn small" data-action="cal-month" data-id="${today.slice(0, 7)}">Today</button>` : ''}
      </div>
      <div class="type-filters">
        ${TYPES.map(t => `<button type="button" class="type-chip t-${t.id} ${shown(t.id) ? 'on' : ''}" data-action="cal-type" data-id="${t.id}"><span>${typeIcon[t.id]}</span>${esc(t.label)}</button>`).join('')}
        <button type="button" class="type-chip ${ui.calMine ? 'on' : ''}" data-action="cal-mine">Only my tasks</button>
      </div>
    </div>`;

  const grid = `
    <div class="cal-grid card-surface">
      ${weekdays.map(w => `<div class="cal-wd">${esc(w)}</div>`).join('')}
      ${days.map(d => {
        const list = byDay.get(d) || [];
        const other = d.slice(0, 7) !== anchor;
        return `
          <button type="button" class="cal-day ${other ? 'other' : ''} ${d === today ? 'today' : ''} ${d === selected ? 'selected' : ''}" data-action="cal-day" data-id="${d}">
            <span class="cal-num">${Number(d.slice(8))}</span>
            <span class="cal-events">
              ${list.slice(0, 3).map(e => `<span class="cal-pill t-${e.type} ${e.done ? 'done' : ''}" style="--c:${esc(e.color)}">${esc(e.title)}</span>`).join('')}
              ${list.length > 3 ? `<span class="cal-more">+${list.length - 3} more</span>` : ''}
            </span>
            ${list.length ? `<span class="cal-dots">${list.slice(0, 4).map(e => `<i style="background:${esc(e.color)}"></i>`).join('')}</span>` : ''}
          </button>`;
      }).join('')}
    </div>`;

  const dayEvents = byDay.get(selected) || [];
  const dayTitle = parseDate(selected).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const n = daysUntil(selected);
  const panel = `
    <aside class="day-panel card-surface">
      <h3>${esc(dayTitle)} <span class="muted small">${n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n === -1 ? 'Yesterday' : ''}</span></h3>
      ${dayEvents.length ? `<div class="day-list">${dayEvents.map(e => `
        <button type="button" class="day-item ${e.done ? 'done' : ''}" ${eventAttrs(e)}>
          <span class="day-ic t-${e.type}" style="--c:${esc(e.color)}">${typeIcon[e.type]}</span>
          <span class="day-main"><b>${esc(e.title)}</b><small>${esc(e.sub)}</small></span>
        </button>`).join('')}</div>` : `<p class="muted">Nothing due.</p>`}
      <button class="btn small" data-action="new-task" data-due="${selected}">${icon.plus} Task due this day</button>
    </aside>`;

  return `${filters}<div class="cal-layout">${grid}${panel}</div>`;
}

// ---------- Timeline ----------

function timeline() {
  const today = todayStr();
  const mondayOf = s => { const d = parseDate(s); return addDays(s, -((d.getDay() + 6) % 7)); };
  const start = ui.tlStart || addDays(mondayOf(today), -14);
  const weeks = 16;
  const days = weeks * 7;
  const end = addDays(start, days - 1);
  const pct = s => ((Math.round((parseDate(s) - parseDate(start)) / 86400000)) / days) * 100;
  const clampPct = s => Math.max(0, Math.min(100, pct(s)));

  const projects = store.all('projects')
    .filter(p => inScope(p.company_id) && p.status !== 'cancelled')
    .filter(p => {
      const s = p.start_date || (p.created_at || '').slice(0, 10) || today;
      const e = p.due_date || end;
      return e >= start && s <= end && (p.status !== 'completed' || (p.due_date && p.due_date >= start));
    })
    .sort((a, b) => (a.start_date || a.created_at || '').localeCompare(b.start_date || b.created_at || ''));

  const weekHeads = Array.from({ length: weeks }, (_, i) => {
    const d = addDays(start, i * 7);
    const pd = parseDate(d);
    const label = pd.getDate() <= 7 ? pd.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : String(pd.getDate());
    return `<span class="tl-week ${pd.getDate() <= 7 ? 'month-start' : ''}" style="left:${(i * 7 / days) * 100}%">${esc(label)}</span>`;
  }).join('');

  const todayLine = today >= start && today <= end ? `<span class="tl-today" style="left:${pct(today)}%"></span>` : '';

  const rows = projects.map(p => {
    const s = p.start_date || (p.created_at || today).slice(0, 10);
    const e = p.due_date || end;
    const left = clampPct(s);
    const right = clampPct(addDays(e, 1));
    const openEnded = !p.due_date;
    const late = p.due_date && p.status !== 'completed' && daysUntil(p.due_date) < 0;
    const marks = deliverablesOf(p.id).filter(d => d.due_date && d.due_date >= start && d.due_date <= end && d.status !== 'cancelled')
      .map(d => `<span class="tl-mark ${d.status === 'approved' ? 'done' : ''}" style="left:${pct(d.due_date) + (0.5 / days) * 100}%" title="${esc(d.name)} — due ${esc(d.due_date)}"></span>`).join('');
    const client = store.get('clients', p.client_id);
    return `
      <div class="tl-row">
        <a class="tl-label" href="#/project/${p.id}">
          <b>${esc(p.name)}</b><small>${esc(client ? client.name : label(STAGES, p.stage))}</small>
        </a>
        <div class="tl-track">
          ${todayLine}
          <a class="tl-bar ${openEnded ? 'open' : ''} ${late ? 'late' : ''} ${p.status === 'completed' ? 'complete' : ''}" href="#/project/${p.id}"
             style="left:${left}%;width:${Math.max(1.2, right - left)}%;--c:${esc(companyColor(p.company_id))}">
            <span>${esc(label(STAGES, p.stage))}</span>
          </a>
          ${marks}
        </div>
      </div>`;
  }).join('');

  const nav = `
    <div class="toolbar">
      <div class="month-nav">
        <button class="btn icon-btn" data-action="tl-shift" data-id="${addDays(start, -28)}" aria-label="Earlier">${icon.back}</button>
        <h2 class="month-title">${esc(parseDate(start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))} – ${esc(parseDate(end).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }))}</h2>
        <button class="btn icon-btn flip" data-action="tl-shift" data-id="${addDays(start, 28)}" aria-label="Later">${icon.back}</button>
        ${ui.tlStart ? `<button class="btn small" data-action="tl-shift" data-id="">Today</button>` : ''}
      </div>
      <span class="muted small tl-legend"><i class="lg-bar"></i> start → deadline <i class="lg-mark"></i> deliverable due <i class="lg-today"></i> today</span>
    </div>`;

  if (!projects.length) return nav + emptyState('No projects in this period', 'Give projects a start date and deadline (Edit project) to see them here.');
  return `${nav}
    <div class="timeline card-surface">
      <div class="tl-row tl-head"><span class="tl-label"></span><div class="tl-track">${weekHeads}${todayLine}</div></div>
      ${rows}
    </div>`;
}
