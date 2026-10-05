import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { SupabaseBackend, LocalBackend } from './backend.js';
import { store, companies } from './store.js';
import { ui, setUi } from './ui-state.js';
import {
  $, $$, esc, toast, initSheet, openSheet, sheetHeader, addDays, todayStr, PERSON_COLORS,
} from './lib.js';
import {
  openProjectSheet, openTaskSheet, openClientSheet, openContactSheet, toggleTaskDone,
} from './forms.js';
import { authScreen } from './views/auth.js';
import { initFiles, openFileSheet } from './files.js';
import { openDeliverableSheet, openSendRoundSheet, openRoundSheet, sendDrawing } from './views/deliverables.js';
import { runStep, openProductSheet, cycleProduction } from './views/order.js';
import { openShipmentSheet, openDeliverySheet } from './views/shipping.js';
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
import { viewSocial } from './views/social.js';
import { openPostSheet, openIdeasSheet, openVoiceSheet, openSocialContactSheet, markPostPosted, advanceContact } from './social.js';

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
    social: () => viewSocial(r.id),
  };
  $('#view').innerHTML = (views[r.name] || viewOverview)();

  const key = `${r.name}/${r.id || ''}`;
  if (key === lastRouteKey) {
    main.scrollTop = scrollTop;
    const nb = $('[data-board]');
    if (nb) nb.scrollLeft = boardLeft;
    if (r.name === 'project') scrollStepperToCurrent();
  } else {
    main.scrollTop = 0;
    if (r.name === 'project') { scrollBoardToCurrentStage(r.id); scrollStepperToCurrent(); }
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

function scrollStepperToCurrent() {
  const bar = $('.stepper');
  const cur = bar && $('.step.current', bar);
  if (cur) bar.scrollLeft = Math.max(0, cur.offsetLeft - bar.offsetLeft - bar.clientWidth / 2 + cur.clientWidth / 2);
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
    case 'wf': { const p = store.get('projects', id); if (p) runStep(el.dataset.step, p); break; }
    case 'add-product': openProductSheet(el.dataset.project); break;
    case 'edit-product': { const it = store.get('items', id); if (it) openProductSheet(it.project_id, it); break; }
    case 'product-production': { const it = store.get('items', id); if (it) cycleProduction(it); break; }
    case 'send-drawing': { const it = store.get('items', id); if (it) sendDrawing(it).catch(() => {}); break; }
    case 'new-shipment': openShipmentSheet(el.dataset.project); break;
    case 'edit-shipment': {
      if (e.target.closest('a')) break; // tracking link opens the carrier's site
      const sh = store.get('shipments', id);
      if (sh) openShipmentSheet(sh.project_id, sh);
      break;
    }
    case 'edit-delivery': { const p = store.get('projects', id); if (p) openDeliverySheet(p); break; }
    case 'pdf-quote': makePdf('quote', id); break;
    case 'pdf-invoice': makePdf('invoice', id); break;
    case 'new-post': openPostSheet(null); break;
    case 'edit-post': {
      if (e.target.closest('a')) break; // "View" opens the live post
      const p = store.get('social_posts', id);
      if (p) openPostSheet(p);
      break;
    }
    case 'post-posted': { e.stopPropagation(); const p = store.get('social_posts', id); if (p) markPostPosted(p); break; }
    case 'post-ideas': openIdeasSheet(); break;
    case 'social-voice': openVoiceSheet(); break;
    case 'new-person': openSocialContactSheet(null); break;
    case 'edit-person': { const c = store.get('social_contacts', id); if (c) openSocialContactSheet(c); break; }
    case 'person-next': { e.stopPropagation(); const c = store.get('social_contacts', id); if (c) advanceContact(c); break; }
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

  // Company details printed on documents
  await store.update('companies', 'byzantivm', {
    country: 'US', default_currency: 'USD', legal_name: 'Byzantivm Inc.',
    address: '100 Example Avenue, Suite 200\nMiami, FL 33131\nUnited States',
    email: 'hello@byzantivm.example', phone: '+1 305 555 0100', website: 'byzantivm.example',
    tax_id: '00-0000000', registration: '', bank_name: 'Example Bank, N.A.',
    iban: '000123456789', swift: 'ABA 000000000 · SWIFT EXAMUS33', default_vat: 0, doc_language: 'en',
    payment_terms: '50% deposit on acceptance, balance before shipping. Payable by ACH or wire transfer.',
  }).catch(() => {});
  await store.update('companies', 'demya', {
    country: 'NL', default_currency: 'EUR', legal_name: 'Demya',
    address: 'Keizersgracht 100\n1015 AA Amsterdam\nNederland', email: 'info@demya.example',
    tax_id: 'NL000000000B02', registration: '87654321', bank_name: 'Voorbeeld Bank', iban: 'NL00 BANK 0000 0000 00',
    default_vat: 21, doc_language: 'nl', payment_terms: '50% aanbetaling bij akkoord, restant vóór verzending.',
  }).catch(() => {});

  const client = async (name, email, phone, address, contacts, more = {}) => {
    const c = await store.insert('clients', { name, email, phone, website: '', address, notes: '', ...more });
    for (const [n, role, em] of contacts) await store.insert('contacts', { client_id: c.id, name: n, role, email: em, phone: '', notes: '' });
    return c.id;
  };
  const aurora = await client('Aurora Hotels', 'hello@aurorahotels.example', '+1 305 555 0101', '1200 Brickell Avenue\nMiami, FL 33131\nUnited States',
    [['Sophie Jansen', 'Design director', 'sophie@aurorahotels.example'], ['Tom Bakker', 'Purchasing', 'tom@aurorahotels.example']]);
  const casa = await client('Casa Oceano', 'daniel@casaoceano.example', '+1 305 555 0144', '45 Ocean Drive\nMiami Beach, FL 33139\nUnited States',
    [['Daniel Reyes', 'Owner', 'daniel@casaoceano.example']]);
  const nord = await client('Nordlicht GmbH', 'info@nordlicht.example', '+49 30 5550 1234', 'Friedrichstraße 10\n10117 Berlin\nDeutschland',
    [['Jonas Weber', 'Office manager', 'jonas@nordlicht.example']], { tax_id: 'DE000000000' });
  const vandijk = await client('Van Dijk Interiors', 'eva@vandijk.example', '+31 20 555 0177', 'Herengracht 200\n1016 BS Amsterdam\nNederland',
    [['Eva van Dijk', 'Interior architect', 'eva@vandijk.example']]);

  // Documents: Byzantivm (US) charges no sales tax; Demya (NL) 21% btw, reverse charge for the German client.
  const docFor = (company, clientId) => company === 'byzantivm' ? { vat_rate: 0, vat_treatment: 'standard', language: 'en' }
    : clientId === nord ? { vat_rate: 0, vat_treatment: 'reverse_charge', language: 'en' } : { vat_rate: 21, vat_treatment: 'standard', language: 'nl' };

  let i = 0;
  const order = async (data, products, tasks = []) => {
    const p = await store.insert('projects', {
      description: '', status: 'active', lead_id: meId, start_date: d(-40), deposit_pct: 50, delivery_address: '',
      sort_order: i++, ...data,
    });
    const items = [];
    let k = 0;
    for (const [name, quantity, dimensions, materials, weight_kg, supplier, unit_cost, unit_price, production = 'not_started'] of products) {
      items.push(await store.insert('items', { project_id: p.id, name, quantity, dimensions, materials, weight_kg, supplier, supplier_ref: supplier ? `Q-${1000 + k * 7}` : '', unit_cost, unit_price, production, description: '', sort_order: k++ }));
    }
    let n = 0;
    for (const [title, stage, done, priority, due, who] of tasks) {
      await store.insert('tasks', { project_id: p.id, title, stage, done, priority, due_date: due === null ? null : d(due), assignee_id: who, notes: '', sort_order: n++, completed_at: done ? new Date().toISOString() : null });
    }
    return { p, items };
  };
  const proposal = async ({ p, items }, number, status, issued) => {
    const q = await store.insert('quotes', { project_id: p.id, number, title: p.name, status, issue_date: d(issued), valid_until: d(issued + 30), notes: '', ...docFor(p.company_id, p.client_id) });
    let k = 0;
    for (const it of items) await store.insert('quote_items', { quote_id: q.id, description: [it.name, it.dimensions, it.materials].filter(Boolean).join(' — '), quantity: it.quantity, unit_price: it.unit_price, sort_order: k++ });
    return items.reduce((s, it) => s + it.quantity * it.unit_price, 0);
  };
  const invoice = ({ p }, kind, number, amount, status, issued, paid = null) => store.insert('invoices', {
    project_id: p.id, kind, number, title: kind === 'deposit' ? 'Deposit (50%)' : 'Balance (50%)', amount, status,
    issue_date: d(issued), due_date: d(issued + 14), paid_date: paid === null ? null : d(paid), notes: '', ...docFor(p.company_id, p.client_id),
  });
  const drawing = async (item, rounds) => {
    const last = rounds[rounds.length - 1];
    const del = await store.insert('deliverables', { project_id: item.project_id, item_id: item.id, name: item.name, max_rounds: 3, status: last && last[2] === 'approved' ? 'approved' : 'in_progress', description: '', sort_order: 0 });
    for (const [round_no, sent, status, received, feedback] of rounds) {
      await store.insert('feedback_rounds', { deliverable_id: del.id, round_no, sent_date: d(sent), status, received_date: received === null ? null : d(received), feedback });
    }
  };

  // Byzantivm — client approval: one drawing still needs changes
  const dining = await order({ company_id: 'byzantivm', client_id: aurora, name: 'Brickell penthouse — dining room', stage: 'approval', currency: 'USD', due_date: d(55),
    delivery_address: 'Penthouse 4501, 1000 Brickell Plaza\nMiami, FL 33131\nUnited States', description: 'Dining room for the Brickell penthouse: table for 8, chairs and pendant lights.' }, [
    ['Dining table', 1, '280 × 110 × 75 cm', 'Solid walnut, oiled · brass inlay', 95, 'Atelier Hout', 3800, 6200],
    ['Dining chair', 8, '48 × 55 × 82 cm', 'Walnut frame · bouclé upholstery', 7, 'Sedia Workshop', 420, 690],
    ['Pendant light', 3, 'Ø 60 cm · drop 120 cm', 'Spun brass, opal glass', 6, 'Luce Metalworks', 380, 640],
  ], [
    ['Order bouclé swatches for Sophie', 'approval', false, 'high', 1, mark],
    ['Revise chair backrest drawing', 'drawings', true, 'high', -3, elena],
    ['Confirm table leg detail with Atelier Hout', 'approval', false, 'medium', 4, meId],
  ]);
  const diningTotal = await proposal(dining, 'BYZ-Q-2026-001', 'approved', -24);
  await invoice(dining, 'deposit', 'BYZ-2026-001', diningTotal / 2, 'paid', -21, -17);
  await drawing(dining.items[0], [[1, -12, 'approved', -9, 'Looks perfect.']]);
  await drawing(dining.items[1], [[1, -12, 'changes_requested', -8, 'Please lower the backrest by 3 cm and use the lighter bouclé.'], [2, -2, 'awaiting', null, '']]);
  await drawing(dining.items[2], [[1, -11, 'approved', -8, '']]);
  await store.insert('costs', { project_id: dining.p.id, description: 'Walnut & bouclé samples', category: 'other', vendor: 'Atelier Hout', amount: 120, paid: true, date: d(-15) });

  // Byzantivm — in production
  const desk = await order({ company_id: 'byzantivm', client_id: aurora, name: 'Aurora lobby — reception desk', stage: 'production', currency: 'USD', due_date: d(30) }, [
    ['Reception desk', 1, '420 × 90 × 110 cm', 'Travertine top · fluted oak front', 380, 'Atelier Hout', 9200, 14500, 'in_production'],
  ], [['Factory visit — check fluted panels', 'production', false, 'high', 5, meId]]);
  const deskTotal = await proposal(desk, 'BYZ-Q-2026-002', 'approved', -45);
  await invoice(desk, 'deposit', 'BYZ-2026-002', deskTotal / 2, 'paid', -42, -38);
  await drawing(desk.items[0], [[1, -34, 'changes_requested', -31, 'Make the front fluting finer.'], [2, -27, 'approved', -24, 'Approved.']]);

  // Byzantivm — costing
  await order({ company_id: 'byzantivm', client_id: casa, name: 'Casa Oceano — outdoor lounge', stage: 'costing', currency: 'USD', due_date: d(90) }, [
    ['Lounge sofa', 1, '300 × 95 × 70 cm', 'Teak · outdoor fabric', 120, 'Teak & Co', 5200, 0],
    ['Coffee table', 1, '120 × 120 × 35 cm', 'Teak · stone top', 60, 'Teak & Co', 1400, 0],
    ['Lounge chair', 2, '', 'Teak', 25, '', 0, 0],
  ], [['Get teak quote for the lounge chairs', 'costing', false, 'high', 2, mark]]);

  // Byzantivm — new inquiry
  await order({ company_id: 'byzantivm', client_id: aurora, name: 'Ocean Drive suites — lighting', stage: 'inquiry', currency: 'USD', due_date: d(120),
    description: 'Wall and bedside lights for 12 suites. Brass finish to match the lobby.' }, [], [['Call Sophie about the lighting brief', 'inquiry', false, 'medium', 1, meId]]);

  // Demya — ready to ship (German client, reverse charge)
  const nordOrder = await order({ company_id: 'demya', client_id: nord, name: 'Nordlicht HQ — meeting room', stage: 'shipping', currency: 'EUR', due_date: d(6) }, [
    ['Conference table', 1, '360 × 140 × 74 cm', 'Oak veneer · powder-coated steel', 140, 'Meubelmakerij Jansen', 4800, 7600, 'ready'],
    ['Wall light', 6, 'Ø 30 cm', 'Brushed aluminium', 2.5, 'Lichtwerk', 210, 360, 'ready'],
  ], [['Book DHL Freight pickup', 'shipping', false, 'urgent', 1, mark]]);
  const nordTotal = await proposal(nordOrder, 'DEM-Q-2026-001', 'approved', -70);
  await invoice(nordOrder, 'deposit', 'DEM-2026-001', nordTotal / 2, 'paid', -66, -60);
  await invoice(nordOrder, 'balance', 'DEM-2026-002', nordTotal / 2, 'paid', -8, -3);
  await drawing(nordOrder.items[0], [[1, -55, 'approved', -50, '']]);
  await drawing(nordOrder.items[1], [[1, -55, 'approved', -51, '']]);
  await store.insert('shipments', { project_id: nordOrder.p.id, carrier: 'DHL Freight', tracking: '', status: 'preparing', packages: '1 crate, 2 boxes', cost: 640, notes: 'Pickup at Meubelmakerij Jansen, Eindhoven.' });

  // Demya — proposal sent
  const sofa = await order({ company_id: 'demya', client_id: vandijk, name: 'Villa Amstelveen — custom sofa', stage: 'proposal', currency: 'EUR', due_date: d(75) }, [
    ['Sofa', 1, '260 × 105 × 78 cm', 'Linen · feather cushions', 85, 'Stofferij De Vries', 3100, 5200],
    ['Ottoman', 1, '90 × 60 × 42 cm', 'Linen', 18, 'Stofferij De Vries', 650, 1100],
  ], [['Follow up on the proposal with Eva', 'proposal', false, 'medium', 3, meId]]);
  await proposal(sofa, 'DEM-Q-2026-002', 'sent', -4);

  // Demya — delivered
  const cabinets = await order({ company_id: 'demya', client_id: vandijk, name: 'Herengracht apartment — cabinets', stage: 'delivered', status: 'completed', currency: 'EUR', due_date: d(-12) }, [
    ['Wall cabinet', 2, '180 × 45 × 220 cm', 'Smoked oak · fluted glass doors', 110, 'Meubelmakerij Jansen', 2100, 3600, 'ready'],
  ]);
  const cabTotal = await proposal(cabinets, 'DEM-Q-2026-000', 'approved', -110);
  await invoice(cabinets, 'deposit', 'DEM-2026-000', cabTotal / 2, 'paid', -105, -100);
  await invoice(cabinets, 'balance', 'DEM-2025-099', cabTotal / 2, 'paid', -25, -20);
  await drawing(cabinets.items[0], [[1, -90, 'approved', -85, '']]);
  await store.insert('shipments', { project_id: cabinets.p.id, carrier: 'Own transport', tracking: '', status: 'delivered', shipped_date: d(-14), delivered_date: d(-12), packages: '2 cabinets, blanket-wrapped', cost: 180, notes: '' });

  // Demya social: a post ready to go, an idea in the drafts, and people to build a network with
  await store.insert('social_posts', { company_id: 'demya', project_id: nordOrder.p.id, platform: 'linkedin', status: 'approved', language: 'en', scheduled_for: d(1),
    title: 'Nordlicht conference table leaves the workshop',
    idea: 'The 3.6 m oak conference table for Nordlicht is crated and ready to ship to Berlin.',
    body: 'Three point six metres of oak, one piece of steel, and a lot of patience.\n\nThis week the conference table for Nordlicht’s new Berlin HQ left Meubelmakerij Jansen in Eindhoven. The oak veneer top sits on a powder-coated steel base we developed with the workshop so the table could travel in one crate and be assembled on site in under an hour.\n\nArchitects: how early do you like to involve the maker when a piece has to fit a tight delivery route?',
    hashtags: '#customfurniture #dutchdesign #workplacedesign #oak #madetomeasure', sort_order: 0 });
  await store.insert('social_posts', { company_id: 'demya', project_id: sofa.p.id, platform: 'instagram', status: 'draft', language: 'en',
    title: 'Linen sample board for the Amstelveen sofa',
    idea: 'Close-up of the linen samples and feather cushion build for the Villa Amstelveen sofa.', body: '', hashtags: '', sort_order: 1 });
  await store.insert('social_contacts', { company_id: 'demya', name: 'Lotte Smit', role: 'Interior architect', organisation: 'Studio Smit', category: 'architect', platform: 'linkedin',
    status: 'to_connect', notes: 'Did the Hotel Jakarta restaurant refit. Met briefly at Dutch Design Week.' });
  await store.insert('social_contacts', { company_id: 'demya', name: 'Pieter de Boer', role: 'Owner', organisation: 'Boer & Zn Hotels', category: 'hospitality', platform: 'both',
    status: 'requested', next_follow_up: d(-1), notes: 'Opening a boutique hotel in Utrecht next year.' });
  await store.insert('social_contacts', { company_id: 'demya', name: 'Eva van Dijk', role: 'Interior architect', organisation: 'Van Dijk Interiors', category: 'interior', platform: 'linkedin',
    status: 'client', notes: 'Client — Herengracht cabinets, Villa Amstelveen sofa.' });

  const t = store.all('tasks').find(x => x.title === 'Order bouclé swatches for Sophie');
  if (t) {
    await store.insert('comments', { project_id: t.project_id, task_id: t.id, author_id: elena, body: 'Sophie prefers the lighter “Cream 02” bouclé — swatches ordered from Sedia.' });
    await store.insert('comments', { project_id: t.project_id, task_id: t.id, author_id: meId, body: '@Elena Doukas great, I’ll send the revised chair drawing once they arrive.', mentions: [elena] });
  }
  toast('Sample data added');
}

boot();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  // A new version was installed: reload once so it's used straight away.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloaded) { reloaded = true; location.reload(); }
  });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
    .then(reg => reg.update())
    .catch(() => {});
}

