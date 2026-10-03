import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { SupabaseBackend, LocalBackend } from './backend.js';
import { store, companies, nextSortOrder } from './store.js';
import { ui, setUi } from './ui-state.js';
import {
  $, $$, esc, toast, initSheet, openSheet, sheetHeader, addDays, todayStr, PERSON_COLORS,
} from './lib.js';
import {
  openProjectSheet, openTaskSheet, openClientSheet, openContactSheet, toggleTaskDone,
} from './forms.js';
import { authScreen } from './views/auth.js';
import { initFiles, openFileSheet } from './files.js';
import { openDeliverableSheet, openSendRoundSheet, openRoundSheet } from './views/deliverables.js';
import { viewMoney } from './views/money.js';
import { viewCalendar } from './views/calendar.js';
import { viewActivity } from './views/activity.js';
import { openQuoteSheet, openCostSheet, openInvoiceSheet, markInvoicePaid, toggleCostPaid, makePdf } from './money.js';
import { openCompanySheet } from './views/team.js';
import { viewOverview } from './views/overview.js';
import { viewProjects } from './views/projects.js';
import { viewProject } from './views/project.js';
import { viewClients, viewClient } from './views/clients.js';
import { viewTasks } from './views/tasks.js';
import { viewTeam } from './views/team.js';

const MODE_KEY = 'studio-mode';
const configured = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

// ---------------------------------------------------------------------
// Startup & authentication
// ---------------------------------------------------------------------

function showAuth(mode, opts = {}) {
  $('#app').hidden = true;
  const el = $('#auth');
  el.hidden = false;
  el.innerHTML = authScreen(mode, { configured, ...opts });
  const first = el.querySelector('input:not([value]), input[value=""]');
  if (first && mode !== 'loading') first.focus();
}

function showApp() {
  $('#auth').hidden = true;
  $('#app').hidden = false;
  render();
}

let sessionStarted = false;

async function startSession(user) {
  store.user = user;
  showAuth('loading');
  try {
    if (!(await store.backend.isTeamMember())) {
      showAuth('not-member', { email: user.email });
      return;
    }
    await store.loadAll();
    ensureProfileColor();
    sessionStarted = true;
    store.backend.subscribe((t, type, row, old) => store.applyRemote(t, type, row, old), setConnection);
    if (!location.hash.startsWith('#/')) history.replaceState(null, '', '#/overview');
    showApp();
  } catch (err) {
    console.error(err);
    showAuth('signin', { email: user.email, error: `Couldn't load data: ${err.message || err}` });
  }
}

function endSession() {
  sessionStarted = false;
  store.backend.unsubscribe();
  store.clear();
  store.user = null;
}

function ensureProfileColor() {
  // Give new team members a distinct colour the first time they sign in.
  const p = store.get('profiles', store.user.id);
  if (p && p.color === '#64748b') {
    const used = new Set(store.all('profiles').map(x => x.color));
    const color = PERSON_COLORS.find(c => !used.has(c)) || PERSON_COLORS[0];
    store.update('profiles', p.id, { color }).catch(() => {});
  }
}

async function boot() {
  initSheet();
  initFiles();
  const hash = location.hash;
  const urlError = /error_description=([^&]+)/.exec(hash);
  const isRecovery = /type=recovery/.test(hash);

  if (localStorage.getItem(MODE_KEY) === 'demo') return startDemo();
  if (!configured) return showAuth('signin'); // shows the "not connected yet" screen

  store.backend = new SupabaseBackend(SUPABASE_URL, SUPABASE_ANON_KEY);
  store.backend.onAuthChange((event, user) => {
    if (event === 'PASSWORD_RECOVERY') showAuth('recovery');
    else if (event === 'SIGNED_IN' && user && !sessionStarted && !isRecovery) startSession(user);
    else if (event === 'SIGNED_OUT') { endSession(); showAuth('signin'); }
  });

  const user = await store.backend.getUser();
  if (isRecovery && user) return showAuth('recovery');
  if (!location.hash.startsWith('#/')) history.replaceState(null, '', '#/overview');
  if (user) return startSession(user);
  showAuth('signin', urlError ? { error: decodeURIComponent(urlError[1].replace(/\+/g, ' ')) } : {});
}

function startDemo() {
  try { localStorage.setItem(MODE_KEY, 'demo'); } catch (e) { /* ignore */ }
  store.backend = new LocalBackend();
  store.backend.getUser().then(startSession);
}

// Auth screen buttons & forms
document.addEventListener('click', e => {
  const b = e.target.closest('[data-auth]');
  if (!b) return;
  const email = $('#auth input[name=email]')?.value || '';
  const action = b.dataset.auth;
  if (action === 'demo') startDemo();
  else if (action === 'recheck') store.backend.getUser().then(u => u ? startSession(u) : showAuth('signin'));
  else if (action === 'signout') store.backend.signOut().then(() => showAuth('signin'));
  else showAuth(action, { email });
});

document.addEventListener('submit', async e => {
  const form = e.target.closest('[data-auth-form]');
  if (!form) return;
  e.preventDefault();
  const fd = new FormData(form);
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  const email = String(fd.get('email') || '').trim().toLowerCase();
  try {
    switch (form.dataset.authForm) {
      case 'signin':
        await store.backend.signIn(email, fd.get('password'));
        break; // onAuthChange → startSession
      case 'signup': {
        const { needsConfirmation } = await store.backend.signUp(email, fd.get('password'), String(fd.get('full_name')).trim());
        if (needsConfirmation) showAuth('signin', { email, message: 'Check your email and tap the confirmation link, then sign in here.' });
        break;
      }
      case 'reset':
        await store.backend.resetPassword(email);
        showAuth('signin', { email, message: 'If that email has an account, a reset link is on its way.' });
        break;
      case 'new-password':
        await store.backend.updatePassword(fd.get('password'));
        history.replaceState(null, '', '#/overview');
        startSession(await store.backend.getUser());
        break;
    }
  } catch (err) {
    showAuth(form.dataset.authForm === 'new-password' ? 'recovery' : form.dataset.authForm, { email, error: err.message || String(err) });
  } finally {
    btn.disabled = false;
  }
});

// ---------------------------------------------------------------------
// Connection status & catching up after the iPad sleeps
// ---------------------------------------------------------------------

let connection = 'live';
function setConnection(status) {
  const was = connection;
  connection = status === 'SUBSCRIBED' ? 'live' : 'reconnecting';
  if (was !== 'live' && connection === 'live' && sessionStarted) store.loadAll().catch(() => {});
  renderConnection();
}

function renderConnection() {
  const el = $('#connection');
  if (!el) return;
  if (store.backend?.mode === 'demo') { el.innerHTML = '<span class="dot demo"></span>Demo mode'; return; }
  el.innerHTML = connection === 'live' && navigator.onLine
    ? '<span class="dot ok"></span>Live'
    : '<span class="dot warn"></span>Offline — reconnecting';
}

let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (sessionStarted && store.backend.mode === 'cloud' && Date.now() - hiddenAt > 30000) store.loadAll().catch(() => {});
});
window.addEventListener('online', renderConnection);
window.addEventListener('offline', renderConnection);

// ---------------------------------------------------------------------
// Router & rendering
// ---------------------------------------------------------------------

function route() {
  const parts = (location.hash.startsWith('#/') ? location.hash.slice(2) : 'overview').split('/');
  return { name: parts[0] || 'overview', id: parts[1], sub: parts[2] };
}

let lastRouteKey = '';

function render() {
  if ($('#app').hidden) return;
  const r = route();
  const main = $('#main');
  const scrollTop = main.scrollTop;
  const board = $('[data-board]');
  const boardLeft = board ? board.scrollLeft : 0;
  const active = document.activeElement;
  const focusedId = active && active.id && $('#view').contains(active) ? active.id : null;
  const caret = focusedId && active.selectionStart != null ? active.selectionStart : null;

  renderSidebar(r);
  const views = {
    overview: viewOverview,
    projects: viewProjects,
    project: () => viewProject(r.id, r.sub),
    clients: viewClients,
    client: () => viewClient(r.id),
    tasks: viewTasks,
    money: viewMoney,
    calendar: viewCalendar,
    activity: viewActivity,
    team: viewTeam,
  };
  $('#view').innerHTML = (views[r.name] || viewOverview)();

  const key = `${r.name}/${r.id || ''}`;
  if (key === lastRouteKey) {
    main.scrollTop = scrollTop;
    const nb = $('[data-board]');
    if (nb) nb.scrollLeft = boardLeft;
  } else {
    main.scrollTop = 0;
    if (r.name === 'project') scrollBoardToCurrentStage(r.id);
  }
  lastRouteKey = key;

  if (focusedId) {
    const el = document.getElementById(focusedId);
    if (el) {
      el.focus();
      if (caret != null && el.setSelectionRange) el.setSelectionRange(caret, caret);
    }
  }
}

function scrollBoardToCurrentStage(projectId) {
  const p = store.get('projects', projectId);
  const board = $('[data-board=tasks]');
  const col = board && $(`.column[data-stage="${p && p.stage}"]`, board);
  if (col) board.scrollLeft = Math.max(0, col.offsetLeft - board.offsetLeft - 8);
}

function renderSidebar(r) {
  const cs = companies();
  const opts = [{ id: 'all', name: 'All companies' }, ...cs];
  $('#company-switch').innerHTML = opts.map(o => `
    <button type="button" role="tab" data-action="set-company" data-id="${esc(o.id)}" aria-selected="${ui.company === o.id}">
      <span class="dot ${o.id === 'all' ? 'all' : ''}" style="${o.id === 'all'
        ? `--c1:${esc(cs[0]?.color || '#999')};--c2:${esc((cs[1] || cs[0])?.color || '#999')}`
        : `background:${esc(o.color)}`}"></span>
      ${esc(o.name)}
    </button>`).join('');
  const navFor = { project: 'projects', client: 'clients' };
  $$('.nav a').forEach(a => a.classList.toggle('active', a.dataset.nav === (navFor[r.name] || r.name)));
  renderConnection();
}

store.onChange(render);
window.addEventListener('hashchange', render);

// ---------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------

let suppressClickUntil = 0;

// Capture phase: swallow the click that follows a drag (also stops link navigation).
document.addEventListener('click', e => {
  if (Date.now() < suppressClickUntil) { e.preventDefault(); e.stopPropagation(); }
}, true);

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || !$('#app').contains(el)) return;
  const { action, id } = el.dataset;
  const task = () => store.get('tasks', id);

  switch (action) {
    case 'set-company': setUi({ company: id }); render(); break;
    case 'new-task': openTaskSheet(null, { project_id: el.dataset.project, stage: el.dataset.stage, due_date: el.dataset.due }); break;
    case 'go': location.hash = el.dataset.href; break;
    case 'cal-mode': setUi({ calMode: id }); render(); break;
    case 'cal-month': setUi({ calMonth: id }); render(); break;
    case 'cal-day': setUi({ calDay: id, calMonth: id.slice(0, 7) }); render(); break;
    case 'cal-type': {
      const hidden = new Set(ui.calHidden || []);
      if (hidden.has(id)) hidden.delete(id); else hidden.add(id);
      setUi({ calHidden: [...hidden] }); render(); break;
    }
    case 'cal-mine': setUi({ calMine: !ui.calMine }); render(); break;
    case 'tl-shift': setUi({ tlStart: id || null }); render(); break;
    case 'edit-task': { const t = task(); if (t) openTaskSheet(t); break; }
    case 'toggle-done': { e.stopPropagation(); const t = task(); if (t) toggleTaskDone(t); break; }
    case 'new-project': openProjectSheet(null, { stage: el.dataset.stage, client_id: el.dataset.client }); break;
    case 'edit-project': { const p = store.get('projects', id); if (p) openProjectSheet(p); break; }
    case 'set-project-stage': {
      const p = store.get('projects', id);
      if (p && p.stage !== el.dataset.stage) {
        const patch = { stage: el.dataset.stage };
        if (el.dataset.stage === 'delivered' && p.status === 'active' && confirm('Mark this project as completed too?')) patch.status = 'completed';
        store.update('projects', id, patch).catch(() => {});
      }
      break;
    }
    case 'projects-view': setUi({ projectsView: id }); render(); break;
    case 'project-status': setUi({ projectStatus: id }); render(); break;
    case 'task-board-mode': setUi({ taskBoardMode: id }); render(); break;
    case 'task-show': setUi({ taskShow: id }); render(); break;
    case 'new-client': openClientSheet(); break;
    case 'edit-client': { const c = store.get('clients', id); if (c) openClientSheet(c); break; }
    case 'new-contact': openContactSheet(el.dataset.client); break;
    case 'edit-contact': {
      if (e.target.closest('a')) break; // let mailto:/tel: links work
      const c = store.get('contacts', id);
      if (c) openContactSheet(c.client_id, c);
      break;
    }
    case 'remove-member':
      if (confirm(`Remove ${id} from the team? They will lose access immediately.`)) store.remove('team_members', id).catch(() => {});
      break;
    case 'new-deliverable': openDeliverableSheet(el.dataset.project); break;
    case 'edit-deliverable': { const d = store.get('deliverables', id); if (d) openDeliverableSheet(d.project_id, d); break; }
    case 'send-round': { const d = store.get('deliverables', id); if (d) openSendRoundSheet(d); break; }
    case 'edit-round': { const r = store.get('feedback_rounds', id); if (r) openRoundSheet(r, { feedbackMode: !!el.dataset.feedback }); break; }
    case 'open-file': { const a = store.get('attachments', id); if (a) openFileSheet(a); break; }
    case 'file-filter': setUi({ fileFilter: id }); render(); break;
    case 'new-quote': openQuoteSheet(el.dataset.project); break;
    case 'edit-quote': { const q = store.get('quotes', id); if (q) openQuoteSheet(q.project_id, q); break; }
    case 'new-invoice': openInvoiceSheet(el.dataset.project); break;
    case 'edit-invoice': { const inv = store.get('invoices', id); if (inv) openInvoiceSheet(inv.project_id, inv); break; }
    case 'invoice-paid': { e.preventDefault(); const inv = store.get('invoices', id); if (inv) markInvoicePaid(inv); break; }
    case 'new-cost': openCostSheet(el.dataset.project); break;
    case 'edit-cost': { const c = store.get('costs', id); if (c) openCostSheet(c.project_id, c); break; }
    case 'cost-paid': { const c = store.get('costs', id); if (c) toggleCostPaid(c); break; }
    case 'pdf-quote': makePdf('quote', id); break;
    case 'pdf-invoice': makePdf('invoice', id); break;
    case 'edit-company': { const c = store.get('companies', id); if (c) openCompanySheet(c); break; }
    case 'load-sample': loadSample(); break;
    case 'reset-demo':
      if (confirm('Erase all demo data on this iPad?')) { store.backend.reset(); store.loadAll(); toast('Demo data reset'); }
      break;
    case 'change-password': openPasswordSheet(); break;
    case 'sign-out':
      if (store.backend.mode === 'demo') { localStorage.removeItem(MODE_KEY); location.reload(); }
      else store.backend.signOut();
      break;
  }
});

document.addEventListener('input', e => {
  if (e.target.id === 'task-search') { setUi({ taskSearch: e.target.value }); render(); }
  else if (e.target.id === 'client-search') { setUi({ clientSearch: e.target.value }); render(); }
});

document.addEventListener('change', e => {
  if (e.target.id === 'task-scope') { setUi({ taskScope: e.target.value }); render(); }
  else if (e.target.id === 'activity-person') { setUi({ activityPerson: e.target.value || null }); render(); }
});

document.addEventListener('submit', e => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  const fd = new FormData(form);
  switch (form.dataset.form) {
    case 'profile': {
      const patch = { full_name: String(fd.get('full_name')).trim() };
      if (fd.get('color')) patch.color = fd.get('color');
      store.update('profiles', store.user.id, patch).then(() => toast('Profile saved')).catch(() => {});
      break;
    }
    case 'add-member': {
      const email = String(fd.get('email')).trim().toLowerCase();
      if (store.get('team_members', email)) { toast('Already on the team'); break; }
      store.insert('team_members', { email }).then(() => toast(`${email} can now create an account`)).catch(() => {});
      form.reset();
      break;
    }
    case 'companies':
      companies().forEach(c => {
        const name = String(fd.get(`name-${c.id}`) || '').trim() || c.name;
        const color = fd.get(`color-${c.id}`) || c.color;
        if (name !== c.name || color !== c.color) store.update('companies', c.id, { name, color }).catch(() => {});
      });
      toast('Companies saved');
      break;
  }
});

function openPasswordSheet() {
  openSheet(`
    <form>
      ${sheetHeader('Change password')}
      <div class="fields">
        <label class="field"><span>New password</span><input type="password" name="password" minlength="8" required autofocus autocomplete="new-password"></label>
      </div>
      <footer><span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">Save</button></footer>
    </form>`, {
    async onSubmit(fd) {
      try {
        await store.backend.updatePassword(fd.get('password'));
        toast('Password changed');
      } catch (err) {
        toast(err.message || 'Could not change password');
        return false;
      }
    },
  });
}

// ---------------------------------------------------------------------
// Drag & drop on boards (long-press on touch, drag with mouse/trackpad)
// ---------------------------------------------------------------------

const drag = { pending: null, active: null };

document.addEventListener('pointerdown', e => {
  const card = e.target.closest('[data-drag]');
  if (!card || e.button > 0 || e.target.closest('button, input, select, textarea')) return;
  const p = { card, table: card.dataset.drag, id: card.dataset.id, x: e.clientX, y: e.clientY, pointerId: e.pointerId, type: e.pointerType };
  drag.pending = p;
  if (e.pointerType !== 'mouse') {
    card.classList.add('pressing');
    p.timer = setTimeout(() => { if (drag.pending === p) startDrag(p, p.x, p.y); }, 300);
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
  drag.active = { ...p, ghost, marker, dx: x - rect.left, dy: y - rect.top, stage: null, before: null };
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
    const cards = $$('[data-drag]:not(.dragging-src)', list);
    let before = null;
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      if (y < r.top + r.height / 2) { before = c; break; }
    }
    a.stage = col.dataset.stage;
    a.before = before;
    a.cards = cards;
    list.insertBefore(a.marker, before);
  } else {
    a.stage = null;
    a.marker.remove();
  }

  const board = $('[data-board]');
  if (board) {
    const br = board.getBoundingClientRect();
    if (x < br.left + 48) board.scrollLeft -= 14;
    else if (x > br.right - 48) board.scrollLeft += 14;
  }
  const main = $('#main');
  if (y < 70) main.scrollTop -= 12;
  else if (y > window.innerHeight - 70) main.scrollTop += 12;
}

function endDrag(commit) {
  const a = drag.active;
  drag.active = null;
  a.ghost.remove();
  a.marker.remove();
  a.card.classList.remove('dragging-src');
  $$('.column.drop-target').forEach(c => c.classList.remove('drop-target'));
  suppressClickUntil = Date.now() + 400;
  if (!commit || !a.stage) return;

  const row = store.get(a.table, a.id);
  if (!row) return;
  // Place between neighbours using a fractional sort order, so only this row changes.
  const order = el => (store.get(a.table, el.dataset.id) || {}).sort_order || 0;
  const idx = a.before ? a.cards.indexOf(a.before) : a.cards.length;
  const prev = a.cards[idx - 1];
  const next = a.cards[idx];
  let sort;
  if (prev && next) sort = (order(prev) + order(next)) / 2;
  else if (prev) sort = order(prev) + 1;
  else if (next) sort = order(next) - 1;
  else sort = 0;

  if (row.stage === a.stage && row.sort_order === sort) return;
  store.update(a.table, a.id, { stage: a.stage, sort_order: sort }).catch(() => {});
}

// ---------------------------------------------------------------------
// Sample data (demo mode)
// ---------------------------------------------------------------------

async function loadSample() {
  const d = n => addDays(todayStr(), n);
  const meId = store.user.id;
  const extra = [
    { id: 'aaaaaaaa-0000-4000-8000-000000000002', email: 'elena@demo.local', full_name: 'Elena Doukas', color: '#e11d48' },
    { id: 'aaaaaaaa-0000-4000-8000-000000000003', email: 'mark@demo.local', full_name: 'Mark de Vries', color: '#16a34a' },
  ];
  for (const p of extra) {
    if (!store.get('profiles', p.id)) await store.insert('profiles', p);
    if (!store.get('team_members', p.email)) await store.insert('team_members', { email: p.email });
  }
  const [elena, mark] = extra.map(p => p.id);

  const client = async (name, email, phone, contacts) => {
    const c = await store.insert('clients', { name, email, phone, website: '', address: '', notes: '' });
    for (const [n, role, em] of contacts) await store.insert('contacts', { client_id: c.id, name: n, role, email: em, phone: '', notes: '' });
    return c.id;
  };
  const aurora = await client('Aurora Hotels', 'hello@aurorahotels.example', '+31 20 555 0101', [['Sophie Jansen', 'Marketing director', 'sophie@aurorahotels.example'], ['Tom Bakker', 'Brand manager', 'tom@aurorahotels.example']]);
  const olive = await client('Olive & Stone', 'studio@oliveandstone.example', '+30 21 0555 0199', [['Maria Pappas', 'Founder', 'maria@oliveandstone.example']]);
  const nord = await client('Nordlicht GmbH', 'info@nordlicht.example', '+49 30 5550 1234', [['Jonas Weber', 'Head of product', 'jonas@nordlicht.example']]);

  const project = async (data, tasks) => {
    const p = await store.insert('projects', {
      description: '', status: 'active', lead_id: meId, start_date: d(-25), sort_order: nextSortOrder(store.all('projects')), ...data,
    });
    let i = 0;
    for (const [title, stage, done, priority, due, who] of tasks) {
      await store.insert('tasks', {
        project_id: p.id, title, stage, done, priority, due_date: due === null ? null : d(due), assignee_id: who,
        notes: '', sort_order: i++, completed_at: done ? new Date(Date.now() - i * 86400000).toISOString() : null,
      });
    }
    return p.id;
  };

  const p1 = await project({ company_id: 'byzantivm', client_id: aurora, name: 'Aurora brand refresh', stage: 'client_review', currency: 'EUR', due_date: d(18),
    description: 'New logo, typography and brand guidelines for 12 hotel properties.' }, [
    ['Kick-off workshop', 'brief', true, 'high', -20, meId],
    ['Competitor audit', 'brief', true, 'medium', -18, elena],
    ['Moodboards — 3 directions', 'concept', true, 'high', -10, elena],
    ['Logo concepts round 1', 'design', true, 'high', -4, elena],
    ['Present logo concepts', 'client_review', false, 'urgent', 1, meId],
    ['Typography pairing', 'design', false, 'medium', 5, mark],
    ['Brand guidelines PDF', 'delivered', false, 'medium', 16, null],
  ]);
  await project({ company_id: 'byzantivm', client_id: olive, name: 'Olive & Stone packaging', stage: 'design', currency: 'EUR', due_date: d(30),
    description: 'Label and box design for the new olive oil range.' }, [
    ['Dieline from printer', 'brief', true, 'medium', -12, mark],
    ['Label illustrations', 'design', false, 'high', 3, elena],
    ['Print proofs', 'revisions', false, 'medium', 20, mark],
  ]);
  await project({ company_id: 'demya', client_id: nord, name: 'Nordlicht app UI', stage: 'concept', currency: 'USD', due_date: d(45),
    description: 'UI design for the Nordlicht energy app — iOS and Android.' }, [
    ['User interviews summary', 'brief', true, 'medium', -6, meId],
    ['Wireframes — onboarding', 'concept', false, 'high', -1, mark],
    ['Design system tokens', 'design', false, 'medium', 12, elena],
  ]);
  await project({ company_id: 'demya', client_id: aurora, name: 'Aurora social campaign', stage: 'brief', currency: 'EUR', due_date: d(60),
    description: 'Summer campaign: 30 posts, 6 reels.' }, [
    ['Collect brief from Sophie', 'brief', false, 'high', 2, meId],
  ]);
  await project({ company_id: 'demya', client_id: olive, name: 'Olive & Stone website', stage: 'delivered', status: 'completed', currency: 'EUR', due_date: d(-10) }, [
    ['Launch', 'delivered', true, 'high', -10, mark],
  ]);

  const deliverable = (project_id, name, max_rounds, due, rounds, extra = {}) => store.insert('deliverables', {
    project_id, name, max_rounds, due_date: d(due), description: '', sort_order: 0, status: 'in_progress', ...extra,
  }).then(async del => {
    for (const [round_no, sent, status, received, feedback] of rounds) {
      await store.insert('feedback_rounds', { deliverable_id: del.id, round_no, sent_date: d(sent), status, received_date: received === null ? null : d(received), feedback });
    }
  });
  await deliverable(p1, 'Logo', 3, 6, [
    [1, -9, 'changes_requested', -7, 'Direction B is the favourite. Can we try the wordmark in a warmer gold, and drop the tagline?'],
    [2, -3, 'awaiting', null, ''],
  ]);
  await deliverable(p1, 'Brand guidelines PDF', 2, 16, []);
  await deliverable(p1, 'Business cards', 2, 12, [[1, -2, 'approved', -1, 'Perfect — please send to print.']], { status: 'approved' });
  const packaging = store.all('projects').find(x => x.name === 'Olive & Stone packaging');
  if (packaging) await deliverable(packaging.id, 'Label artwork', 2, 10, [[1, -6, 'awaiting', null, '']]);

  const quote = async (project_id, number, title, status, lines) => {
    const q = await store.insert('quotes', { project_id, number, title, status, issue_date: d(-28), valid_until: d(2), notes: '' });
    let i = 0;
    for (const [description, quantity, unit_price] of lines) await store.insert('quote_items', { quote_id: q.id, description, quantity, unit_price, sort_order: i++ });
  };
  const cost = (project_id, description, category, vendor, amount, paid, days) => store.insert('costs', { project_id, description, category, vendor, amount, paid, date: d(days) });
  const invoice = (project_id, number, title, amount, status, issued, due, paidDays = null) => store.insert('invoices', {
    project_id, number, title, amount, status, issue_date: d(issued), due_date: d(due), paid_date: paidDays === null ? null : d(paidDays), notes: '',
  });
  await quote(p1, 'BYZ-Q-2026-001', 'Aurora brand refresh', 'approved', [['Discovery workshop & audit', 1, 1800], ['Logo design — 3 directions, 3 rounds', 1, 4200], ['Brand guidelines (40 pages)', 1, 3000], ['Business card design', 1, 600]]);
  await cost(p1, 'Illustrator — icon set', 'freelancer', 'Nikos Papadakis', 900, true, -12);
  await cost(p1, 'Font licence — Söhne family', 'software', 'Klim Type Foundry', 420, true, -9);
  await cost(p1, 'Business card proofs', 'printing', 'PrintHaus Amsterdam', 150, false, -2);
  await invoice(p1, 'BYZ-2026-001', 'Deposit (50%)', 4800, 'paid', -27, -13, -20);
  await invoice(p1, 'BYZ-2026-002', 'Logo approval (25%)', 2400, 'sent', -16, -2);
  if (packaging) {
    await quote(packaging.id, 'BYZ-Q-2026-002', 'Packaging — 3 SKUs', 'approved', [['Label design per SKU', 3, 1200], ['Box design', 1, 1500]]);
    await cost(packaging.id, 'Print proofs', 'printing', 'PrintHaus Amsterdam', 380, false, -4);
    await invoice(packaging.id, 'BYZ-2026-003', 'Deposit (50%)', 2550, 'sent', -5, 25);
  }
  const appProject = store.all('projects').find(x => x.name === 'Nordlicht app UI');
  if (appProject) {
    await quote(appProject.id, 'DEM-Q-2026-001', 'App UI — iOS & Android', 'sent', [['UX research & wireframes', 1, 6500], ['UI design — 24 screens', 24, 450], ['Design system', 1, 4000]]);
    await cost(appProject.id, 'User testing incentives', 'other', '', 300, true, -5);
  }

  // Example document details so PDFs look complete in the demo
  await store.update('companies', 'byzantivm', {
    legal_name: 'Byzantivm B.V.', address: 'Example Street 1\n1000 AA Amsterdam\nNederland',
    email: 'hello@byzantivm.example', phone: '+31 20 555 0100', website: 'byzantivm.example',
    tax_id: 'NL000000000B01', registration: '12345678', bank_name: 'Example Bank',
    iban: 'NL00 BANK 0000 0000 00', swift: 'BANKNL2A', default_vat: 21, doc_language: 'en',
    payment_terms: 'Payment within 14 days of the invoice date. Prices exclude VAT unless stated.',
  }).catch(() => {});
  await store.update('companies', 'demya', {
    legal_name: 'Demya B.V.', address: 'Keizersgracht 100\n1015 AA Amsterdam\nNederland', email: 'info@demya.example',
    tax_id: 'NL000000000B02', registration: '87654321', bank_name: 'Voorbeeld Bank', iban: 'NL00 BANK 0000 0000 00',
    default_vat: 21, doc_language: 'nl', payment_terms: 'Betaling binnen 30 dagen na factuurdatum.',
  }).catch(() => {});
  for (const inv of store.all('invoices')) {
    await store.update('invoices', inv.id, { vat_rate: 21 }).catch(() => {});
  }
  for (const q of store.all('quotes')) {
    const proj = store.get('projects', q.project_id);
    await store.update('quotes', q.id, { vat_rate: 21, language: proj && proj.company_id === 'demya' ? 'nl' : 'en' }).catch(() => {});
  }
  await store.update('clients', aurora, { address: 'Herengracht 200\n1016 BS Amsterdam\nNederland', tax_id: 'NL000000000B03' }).catch(() => {});

  const firstTask = store.all('tasks').find(t => t.project_id === p1 && t.title === 'Present logo concepts');
  if (firstTask) {
    await store.insert('comments', { project_id: p1, task_id: firstTask.id, author_id: elena, body: 'Deck is ready in the shared folder — 3 directions, 2 colourways each.' });
    await store.insert('comments', { project_id: p1, task_id: firstTask.id, author_id: meId, body: '@Elena Doukas great, I’ll walk Sophie through it tomorrow.', mentions: [elena] });
  }
  toast('Sample data added');
}

boot();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

