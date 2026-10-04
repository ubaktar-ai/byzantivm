// Activity feed: who did what, newest first (from the database's activity log).
import { esc, avatar, timeAgo, label, money, parseDate, dateStr, STAGES, PROJECT_STATUSES } from '../lib.js';
import { store, profiles } from '../store.js';
import { ui, inScope } from '../ui-state.js';
import { companySegmented, companyColor, scopeName, emptyState } from './common.js';

const ROUND_LABELS = { awaiting: 'waiting for client', changes_requested: 'changes requested', approved: 'approved' };

// Turn one activity row into a short sentence (HTML).
function sentence(a) {
  const d = a.details || {};
  const name = `<b>${esc(a.summary || '')}</b>`;
  const changed = d.changed || [];
  switch (a.entity) {
    case 'tasks':
      if (a.action === 'created') return `added task ${name}`;
      if (a.action === 'completed') return `completed ${name}`;
      if (a.action === 'reopened') return `reopened ${name}`;
      if (a.action === 'moved') return `moved ${name} to ${esc(label(STAGES, d.stage))}`;
      if (a.action === 'deleted') return `deleted task ${name}`;
      if (changed.includes('assignee_id')) return `reassigned ${name}`;
      if (changed.includes('due_date')) return `changed the due date of ${name}`;
      return `updated ${name}`;
    case 'projects':
      if (a.action === 'created') return `created project ${name}`;
      if (a.action === 'moved') return `moved ${name} to ${esc(label(STAGES, d.stage))}`;
      if (a.action === 'deleted') return `deleted project ${name}`;
      if (changed.includes('status')) return `marked ${name} as ${esc(label(PROJECT_STATUSES, d.status).toLowerCase())}`;
      return `updated ${name}`;
    case 'clients':
      return a.action === 'created' ? `added client ${name}` : a.action === 'deleted' ? `deleted client ${name}` : `updated client ${name}`;
    case 'comments': {
      const c = store.get('comments', a.entity_id);
      const t = c && store.get('tasks', c.task_id);
      if (a.action === 'deleted') return 'deleted a comment';
      return `commented${t ? ` on <b>${esc(t.title)}</b>` : ''}: <span class="quote">“${esc(a.summary)}”</span>`;
    }
    case 'deliverables':
      if (a.action === 'created') return `started the drawing for ${name}`;
      if (changed.includes('status') && d.status === 'approved') return `got the drawing for ${name} approved 🎉`;
      return a.action === 'deleted' ? `deleted drawing ${name}` : `updated drawing ${name}`;
    case 'feedback_rounds': {
      const r = store.get('feedback_rounds', a.entity_id);
      const del = r && store.get('deliverables', r.deliverable_id);
      const what = `${esc(a.summary)}${del ? ` of <b>${esc(del.name)}</b>` : ''}`;
      if (a.action === 'created') return `sent drawing ${what} to the client`;
      if (changed.includes('status')) return `recorded client feedback on ${what}: ${esc(ROUND_LABELS[d.status] || d.status || '')}`;
      return a.action === 'deleted' ? `deleted ${what}` : `updated ${what}`;
    }
    case 'attachments':
      return a.action === 'deleted' ? `deleted file ${name}` : `uploaded ${name}`;
    case 'quotes':
      if (a.action === 'created') return `created proposal ${name}`;
      if (changed.includes('status')) return d.status === 'approved' ? `got proposal ${name} accepted 🎉` : `marked proposal ${name} as ${esc(d.status || '')}`;
      return a.action === 'deleted' ? `deleted proposal ${name}` : `updated proposal ${name}`;
    case 'invoices': {
      const inv = store.get('invoices', a.entity_id);
      const p = inv && store.get('projects', inv.project_id);
      const amt = inv && p ? ` (${esc(money(inv.amount, p.currency))})` : '';
      if (a.action === 'created') return `created invoice ${name}${amt}`;
      if (changed.includes('status') && d.status === 'paid') return `marked invoice ${name} paid${amt} 💶`;
      if (changed.includes('status') && d.status === 'sent') return `sent invoice ${name}${amt}`;
      return a.action === 'deleted' ? `deleted invoice ${name}` : `updated invoice ${name}`;
    }
    case 'items':
      if (a.action === 'created') return `added product ${name}`;
      if (changed.includes('production')) {
        const it = store.get('items', a.entity_id);
        return it && it.production === 'ready' ? `marked ${name} ready` : `updated production of ${name}`;
      }
      if (changed.includes('unit_cost') || changed.includes('unit_price')) return `updated the cost/price of ${name}`;
      return a.action === 'deleted' ? `deleted product ${name}` : `updated product ${name}`;
    case 'shipments': {
      if (a.action === 'created') return `added shipment ${name}`;
      if (changed.includes('status') && d.status === 'shipped') return `shipped ${name} 🚚`;
      if (changed.includes('status') && d.status === 'delivered') return `delivered ${name} ✅`;
      return a.action === 'deleted' ? `deleted shipment ${name}` : `updated shipment ${name}`;
    }
    case 'costs':
      return a.action === 'created' ? `added cost ${name}` : a.action === 'deleted' ? `deleted cost ${name}` : `updated cost ${name}`;
    default:
      return `${esc(a.action)} ${esc(a.entity)} ${name}`;
  }
}

export function activityEntries({ limit = 200, projectId = null } = {}) {
  return store.all('activity')
    .filter(a => {
      if (projectId) return a.project_id === projectId;
      if (ui.activityPerson && a.actor_id !== ui.activityPerson) return false;
      if (ui.company === 'all') return true;
      const p = a.project_id && store.get('projects', a.project_id);
      return p ? inScope(p.company_id) : a.entity === 'clients';
    })
    .sort((x, y) => (x.at < y.at ? 1 : -1))
    .slice(0, limit);
}

export function activityItem(a, { showProject = true } = {}) {
  const who = store.get('profiles', a.actor_id);
  const p = a.project_id && store.get('projects', a.project_id);
  return `
    <div class="act-item">
      ${who ? avatar(who, 30) : '<span class="avatar pending" style="width:30px;height:30px">?</span>'}
      <div class="act-main">
        <div><b>${esc(who ? (who.full_name || who.email).split(' ')[0] : 'Someone')}</b> ${sentence(a)}</div>
        <div class="act-meta">
          <span>${esc(timeAgo(a.at))}</span>
          ${showProject && p ? `<a href="#/project/${p.id}"><span class="dot" style="background:${esc(companyColor(p.company_id))}"></span>${esc(p.name)}</a>` : ''}
        </div>
      </div>
    </div>`;
}

function dayLabel(iso) {
  const d = dateStr(new Date(iso));
  const today = dateStr(new Date());
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (d === today) return 'Today';
  if (d === dateStr(y)) return 'Yesterday';
  return parseDate(d).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

export function viewActivity() {
  if (!store.activityLoaded) {
    store.loadActivity().catch(() => {});
    return `${companySegmented()}<div class="page-head"><div><h1>Activity</h1></div></div><div class="empty"><div class="spinner" style="margin:auto"></div></div>`;
  }
  const entries = activityEntries();
  const people = profiles();
  const groups = [];
  entries.forEach(a => {
    const l = dayLabel(a.at);
    if (!groups.length || groups[groups.length - 1].label !== l) groups.push({ label: l, items: [] });
    groups[groups.length - 1].items.push(a);
  });
  return `
    ${companySegmented()}
    <div class="page-head">
      <div><h1>Activity</h1><div class="sub">${esc(scopeName())}</div></div>
      <div class="head-actions">
        <select class="filter" id="activity-person" aria-label="Person">
          <option value="">Everyone</option>
          ${people.map(p => `<option value="${p.id}" ${ui.activityPerson === p.id ? 'selected' : ''}>${esc(p.full_name || p.email)}</option>`).join('')}
        </select>
      </div>
    </div>
    ${groups.length ? groups.map(g => `
      <h2 class="section">${esc(g.label)}</h2>
      <div class="card-surface act-list">${g.items.map(a => activityItem(a)).join('')}</div>`).join('')
      : emptyState('No activity yet', 'Changes made by the team will appear here.')}`;
}
