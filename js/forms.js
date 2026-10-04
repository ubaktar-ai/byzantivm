// Create/edit sheets for projects, tasks (with comments), clients and contacts.
import {
  STAGES, PRIORITIES, PROJECT_STATUSES, CURRENCIES, esc, icon, toast, openSheet, closeSheet,
  sheetHeader, options, todayStr, timeAgo, avatar, label, $,
} from './lib.js';
import {
  store, companies, profiles, me, tasksOf, commentsOf, projectsOfClient, nextSortOrder, attachmentsWhere,
} from './store.js';
import { fileStrip, removeProjectFiles } from './files.js';
import { docsReady, companyCurrency, ordersReady } from './money.js';
import { ui } from './ui-state.js';

const go = hash => { location.hash = hash; };

// ---------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------

export function openProjectSheet(existing, defaults = {}) {
  const companyId = defaults.company_id || (ui.company !== 'all' ? ui.company : companies()[0]?.id);
  const p = existing || {
    name: '', description: '',
    company_id: companyId,
    client_id: defaults.client_id || null,
    stage: defaults.stage || 'inquiry', status: 'active', currency: companyCurrency(store.get('companies', companyId)),
    lead_id: me()?.id || null, start_date: todayStr(), due_date: null,
  };
  const clients = store.all('clients').sort((a, b) => a.name.localeCompare(b.name));
  const people = profiles();

  openSheet(`
    <form>
      ${sheetHeader(existing ? 'Edit project' : 'New project')}
      <div class="fields">
        <label class="field"><span>Project name</span><input name="name" value="${esc(p.name)}" required autofocus placeholder="e.g. Brickell penthouse — dining room"></label>
        <div class="field-row">
          <label class="field"><span>Company</span><select name="company_id">${options(companies().map(c => ({ id: c.id, label: c.name })), p.company_id)}</select></label>
          <label class="field"><span>Client</span>
            <select name="client_id" id="client-select">
              ${options(clients.map(c => ({ id: c.id, label: c.name })), p.client_id, { empty: '— No client —' })}
              <option value="__new__">+ New client…</option>
            </select>
          </label>
        </div>
        <label class="field" id="new-client-field" hidden><span>New client name</span><input name="new_client" placeholder="Client company name"></label>
        <div class="field-row">
          <label class="field"><span>Stage</span><select name="stage">${options(STAGES, p.stage)}</select></label>
          <label class="field"><span>Status</span><select name="status">${options(PROJECT_STATUSES, p.status)}</select></label>
        </div>
        <div class="field-row">
          <label class="field"><span>Project lead</span><select name="lead_id">${options(people.map(x => ({ id: x.id, label: x.full_name || x.email })), p.lead_id, { empty: '— Nobody —' })}</select></label>
          <label class="field"><span>Currency</span><select name="currency">${options(CURRENCIES, p.currency)}</select></label>
        </div>
        <div class="field-row">
          <label class="field"><span>Start date</span><input type="date" name="start_date" value="${esc(p.start_date || '')}"></label>
          <label class="field"><span>Deadline</span><input type="date" name="due_date" value="${esc(p.due_date || '')}"></label>
        </div>
        ${ordersReady() ? `<div class="field-row">
          <label class="field"><span>Deposit %</span><input name="deposit_pct" value="${esc(String(Number(p.deposit_pct ?? 50)))}" inputmode="decimal"></label>
          <span></span>
        </div>
        <label class="field"><span>Delivery address <small class="muted">(leave empty to use the client's address)</small></span><textarea name="delivery_address" rows="3">${esc(p.delivery_address || '')}</textarea></label>` : ''}
        <label class="field"><span>Inquiry / description</span><textarea name="description" placeholder="What the client asked for, references, links…">${esc(p.description)}</textarea></label>
      </div>
      <footer>
        ${existing ? `<button type="button" class="btn danger" data-delete>Delete</button>` : ''}
        <span class="spacer"></span>
        <button type="button" class="btn" data-close>Cancel</button>
        <button type="submit" class="btn primary">${existing ? 'Save' : 'Create project'}</button>
      </footer>
    </form>`, {
    onOpen(sheet) {
      // New projects follow their company's currency (Byzantivm: USD, Demya: EUR).
      if (!existing) $('[name=company_id]', sheet).addEventListener('change', e => {
        $('[name=currency]', sheet).value = companyCurrency(store.get('companies', e.target.value));
      });
      const sel = $('#client-select', sheet);
      sel.addEventListener('change', () => {
        const isNew = sel.value === '__new__';
        $('#new-client-field', sheet).hidden = !isNew;
        if (isNew) $('[name=new_client]', sheet).focus();
      });
      const del = sheet.querySelector('[data-delete]');
      if (del) del.addEventListener('click', async () => {
        const n = tasksOf(existing.id).length;
        if (!confirm(`Delete “${existing.name}”${n ? ` and its ${n} task${n === 1 ? '' : 's'}` : ''}? This can't be undone.`)) return;
        closeSheet();
        go('#/projects');
        await removeProjectFiles(existing.id);
        await store.remove('projects', existing.id).catch(() => {});
        toast('Project deleted');
      });
    },
    async onSubmit(fd) {
      let clientId = fd.get('client_id') || null;
      if (clientId === '__new__') {
        const name = String(fd.get('new_client') || '').trim();
        if (!name) { toast('Enter the new client’s name'); return false; }
        const c = await store.insert('clients', { name });
        clientId = c.id;
      }
      const data = {
        name: String(fd.get('name')).trim(),
        company_id: fd.get('company_id'),
        client_id: clientId,
        stage: fd.get('stage'),
        status: fd.get('status'),
        lead_id: fd.get('lead_id') || null,
        currency: fd.get('currency'),
        start_date: fd.get('start_date') || null,
        due_date: fd.get('due_date') || null,
        description: fd.get('description'),
      };
      if (ordersReady()) {
        data.deposit_pct = Math.min(100, Math.max(0, parseFloat(String(fd.get('deposit_pct') || '50').replace(',', '.')) || 0));
        data.delivery_address = String(fd.get('delivery_address') || '').trim();
      }
      if (!data.name) return false;
      if (existing) {
        store.update('projects', existing.id, data).catch(() => {});
      } else {
        const row = { ...data, sort_order: nextSortOrder(store.all('projects').filter(x => x.stage === data.stage)) };
        const pending = store.insert('projects', row);
        pending.then(saved => go(`#/project/${saved.id}`)).catch(() => {});
      }
    },
  });
}

// ---------------------------------------------------------------------
// Task (+ comments)
// ---------------------------------------------------------------------

export function openTaskSheet(existing, defaults = {}) {
  const projects = store.all('projects');
  if (!projects.length) {
    toast('Create a project first');
    openProjectSheet();
    return;
  }
  const t = existing || {
    title: '', notes: '', priority: 'medium', due_date: defaults.due_date || null, done: false,
    stage: defaults.stage || (defaults.project_id ? store.get('projects', defaults.project_id)?.stage : null) || 'inquiry',
    assignee_id: defaults.assignee_id !== undefined ? defaults.assignee_id : me()?.id || null,
    project_id: defaults.project_id || guessProject(),
  };
  const people = profiles();

  const projectOpts = companies().map(c => {
    const ps = projects
      .filter(p => p.company_id === c.id && (p.status === 'active' || p.status === 'on_hold' || p.id === t.project_id))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!ps.length) return '';
    return `<optgroup label="${esc(c.name)}">${ps.map(p => `<option value="${p.id}" ${p.id === t.project_id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</optgroup>`;
  }).join('');

  let unsubscribe = null;

  openSheet(`
    <form class="${existing ? 'with-side' : ''}">
      ${sheetHeader(existing ? 'Task' : 'New task')}
      <div class="sheet-body">
        <div class="fields">
          <label class="field"><span>Title</span><input name="title" value="${esc(t.title)}" required autofocus placeholder="What needs to be done?"></label>
          <label class="field"><span>Project</span><select name="project_id" required>${projectOpts}</select></label>
          <div class="field-row">
            <label class="field"><span>Phase</span><select name="stage">${options(STAGES, t.stage)}</select></label>
            <label class="field"><span>Priority</span><select name="priority">${options(PRIORITIES, t.priority)}</select></label>
          </div>
          <div class="field-row">
            <label class="field"><span>Assigned to</span><select name="assignee_id">${options(people.map(x => ({ id: x.id, label: x.full_name || x.email })), t.assignee_id, { empty: '— Unassigned —' })}</select></label>
            <label class="field"><span>Due date</span><input type="date" name="due_date" value="${esc(t.due_date || '')}"></label>
          </div>
          <label class="field"><span>Notes</span><textarea name="notes" placeholder="Details, links, references…">${esc(t.notes)}</textarea></label>
          ${existing ? `<div class="field"><span>Files</span><div id="task-files"></div></div>` : ''}
          <label class="toggle"><input type="checkbox" name="done" ${t.done ? 'checked' : ''}><span>Done</span></label>
        </div>
        ${existing ? `
          <aside class="side">
            <h3 class="side-title">${icon.chat} Comments</h3>
            <div class="comments" id="comments"></div>
            <div class="mention-picker" id="mention-picker" hidden></div>
            <div class="comment-box">
              <textarea id="comment-input" rows="2" placeholder="Write a comment… type @ to mention"></textarea>
              <button type="button" class="btn primary icon-btn" id="comment-send" aria-label="Send comment">${icon.send}</button>
            </div>
          </aside>` : ''}
      </div>
      <footer>
        ${existing ? `<button type="button" class="btn danger" data-delete>Delete</button>` : ''}
        <span class="spacer"></span>
        <button type="button" class="btn" data-close>Cancel</button>
        <button type="submit" class="btn primary">${existing ? 'Save' : 'Add task'}</button>
      </footer>
    </form>`, {
    wide: !!existing,
    onOpen(sheet) {
      if (!existing) return;
      const renderComments = () => {
        const box = $('#comments', sheet);
        if (!box) return;
        const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 20;
        const list = commentsOf(existing.id);
        box.innerHTML = list.length ? list.map(c => commentHtml(c)).join('') : `<div class="muted small">No comments yet.</div>`;
        if (atBottom) box.scrollTop = box.scrollHeight;
      };
      const renderFiles = () => {
        const box = $('#task-files', sheet);
        if (box) box.innerHTML = fileStrip(attachmentsWhere('task_id', existing.id), { project_id: existing.project_id, task_id: existing.id });
      };
      renderComments();
      renderFiles();
      $('#comments', sheet).scrollTop = 1e6;
      unsubscribe = store.onChange(() => {
        if (!store.get('tasks', existing.id)) { closeSheet(); return; }
        renderComments();
        renderFiles();
      });
      wireCommentBox(sheet, existing);

      sheet.querySelector('[data-delete]').addEventListener('click', () => {
        closeSheet();
        deleteTask(existing);
      });
    },
    onClose() { unsubscribe && unsubscribe(); },
    onSubmit(fd) {
      const done = fd.get('done') === 'on';
      const data = {
        title: String(fd.get('title')).trim(),
        project_id: fd.get('project_id'),
        stage: fd.get('stage'),
        priority: fd.get('priority'),
        assignee_id: fd.get('assignee_id') || null,
        due_date: fd.get('due_date') || null,
        notes: fd.get('notes'),
        done,
      };
      if (!data.title) return false;
      if (existing) {
        const current = store.get('tasks', existing.id) || existing;
        if (done !== current.done) data.completed_at = done ? new Date().toISOString() : null;
        if (data.stage !== current.stage || data.project_id !== current.project_id) {
          data.sort_order = nextSortOrder(tasksOf(data.project_id).filter(x => x.stage === data.stage && x.id !== existing.id));
        }
        store.update('tasks', existing.id, data).catch(() => {});
      } else {
        data.completed_at = done ? new Date().toISOString() : null;
        data.sort_order = nextSortOrder(tasksOf(data.project_id).filter(x => x.stage === data.stage));
        store.insert('tasks', data).then(() => toast('Task added')).catch(() => {});
      }
    },
  });
}

function guessProject() {
  const m = location.hash.match(/^#\/project\/([^/]+)/);
  if (m && store.get('projects', m[1])) return m[1];
  const live = store.all('projects').filter(p => p.status === 'active' && (ui.company === 'all' || p.company_id === ui.company));
  return (live[0] || store.all('projects')[0]).id;
}

export function toggleTaskDone(task) {
  const done = !task.done;
  store.update('tasks', task.id, { done, completed_at: done ? new Date().toISOString() : null }).catch(() => {});
  if (done) toast('Marked done', { label: 'Undo', run: () => store.update('tasks', task.id, { done: false, completed_at: null }).catch(() => {}) });
}

export function deleteTask(task) {
  const files = attachmentsWhere('task_id', task.id);
  if (files.length) {
    if (!confirm(`Delete “${task.title}” and its ${files.length} file${files.length === 1 ? '' : 's'}?`)) return;
    store.remove('tasks', task.id).then(() => {
      store.backend.removeFiles(files.map(f => f.path)).catch(() => {});
      toast('Task deleted');
    }).catch(() => {});
    return;
  }
  const comments = commentsOf(task.id);
  store.remove('tasks', task.id).then(() => {
    toast('Task deleted', {
      label: 'Undo',
      run: async () => {
        const { created_at, updated_at, ...row } = task;
        await store.insert('tasks', row);
        for (const c of comments) {
          const { updated_at: _u, ...cr } = c;
          await store.insert('comments', cr).catch(() => {});
        }
      },
    });
  }).catch(() => {});
}

// ---------- Comments ----------

function commentHtml(c) {
  const author = store.get('profiles', c.author_id);
  const mine = c.author_id === store.user?.id;
  return `
    <div class="comment">
      ${avatar(author, 28)}
      <div class="comment-main">
        <div class="comment-meta"><b>${esc(author ? author.full_name || author.email : 'Someone')}</b> <span>${esc(timeAgo(c.created_at))}</span>
          ${mine ? `<button type="button" class="link-btn" data-del-comment="${c.id}">Delete</button>` : ''}
        </div>
        <div class="comment-body">${renderMentions(c.body)}</div>
      </div>
    </div>`;
}

function renderMentions(body) {
  let html = esc(body);
  profiles().forEach(p => {
    const name = p.full_name || p.email;
    if (!name) return;
    html = html.split(esc('@' + name)).join(`<span class="mention">@${esc(name)}</span>`);
  });
  return html.replace(/\n/g, '<br>');
}

function wireCommentBox(sheet, task) {
  const input = $('#comment-input', sheet);
  const picker = $('#mention-picker', sheet);
  const send = $('#comment-send', sheet);

  const mentionQuery = () => {
    const before = input.value.slice(0, input.selectionStart);
    const m = before.match(/(?:^|\s)@([^\s@]*)$/);
    return m ? m[1] : null;
  };

  const updatePicker = () => {
    const q = mentionQuery();
    if (q === null) { picker.hidden = true; return; }
    const matches = profiles().filter(p => (p.full_name || p.email).toLowerCase().includes(q.toLowerCase())).slice(0, 6);
    if (!matches.length) { picker.hidden = true; return; }
    picker.innerHTML = matches.map(p => `<button type="button" class="chip-btn" data-mention="${p.id}">${avatar(p, 20)} ${esc(p.full_name || p.email)}</button>`).join('');
    picker.hidden = false;
  };

  input.addEventListener('input', updatePicker);
  input.addEventListener('click', updatePicker);
  picker.addEventListener('click', e => {
    const b = e.target.closest('[data-mention]');
    if (!b) return;
    const p = store.get('profiles', b.dataset.mention);
    const pos = input.selectionStart;
    const before = input.value.slice(0, pos).replace(/@([^\s@]*)$/, `@${p.full_name || p.email} `);
    input.value = before + input.value.slice(pos);
    input.focus();
    input.setSelectionRange(before.length, before.length);
    picker.hidden = true;
  });

  const submit = () => {
    const body = input.value.trim();
    if (!body) return;
    const mentions = profiles().filter(p => body.includes('@' + (p.full_name || p.email))).map(p => p.id);
    input.value = '';
    picker.hidden = true;
    store.insert('comments', { project_id: task.project_id, task_id: task.id, body, mentions, author_id: store.user.id })
      .catch(() => { input.value = body; });
    requestAnimationFrame(() => { const box = $('#comments', sheet); if (box) box.scrollTop = box.scrollHeight; });
  };
  send.addEventListener('click', submit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
  });

  $('#comments', sheet).addEventListener('click', e => {
    const b = e.target.closest('[data-del-comment]');
    if (b && confirm('Delete this comment?')) store.remove('comments', b.dataset.delComment).catch(() => {});
  });
}

// ---------------------------------------------------------------------
// Client & contact
// ---------------------------------------------------------------------

export function openClientSheet(existing) {
  const c = existing || { name: '', email: '', phone: '', website: '', address: '', notes: '' };
  openSheet(`
    <form>
      ${sheetHeader(existing ? 'Edit client' : 'New client')}
      <div class="fields">
        <label class="field"><span>Client name</span><input name="name" value="${esc(c.name)}" required autofocus placeholder="Company or person"></label>
        <div class="field-row">
          <label class="field"><span>Email</span><input type="email" name="email" value="${esc(c.email)}" autocomplete="off"></label>
          <label class="field"><span>Phone</span><input type="tel" name="phone" value="${esc(c.phone)}"></label>
        </div>
        <label class="field"><span>Website</span><input name="website" value="${esc(c.website)}" placeholder="example.com" autocapitalize="off"></label>
        <label class="field"><span>Address</span><textarea name="address" rows="2">${esc(c.address)}</textarea></label>
        ${docsReady() ? `<label class="field"><span>VAT number</span><input name="tax_id" value="${esc(c.tax_id || '')}" autocapitalize="characters"></label>` : ''}
        <label class="field"><span>Notes</span><textarea name="notes" placeholder="Billing details, preferences, history…">${esc(c.notes)}</textarea></label>
      </div>
      <footer>
        ${existing ? `<button type="button" class="btn danger" data-delete>Delete</button>` : ''}
        <span class="spacer"></span>
        <button type="button" class="btn" data-close>Cancel</button>
        <button type="submit" class="btn primary">${existing ? 'Save' : 'Add client'}</button>
      </footer>
    </form>`, {
    onOpen(sheet) {
      const del = sheet.querySelector('[data-delete]');
      if (del) del.addEventListener('click', async () => {
        const n = projectsOfClient(existing.id).length;
        if (!confirm(`Delete client “${existing.name}” and their contacts?${n ? ` Their ${n} project${n === 1 ? '' : 's'} will be kept without a client.` : ''}`)) return;
        closeSheet();
        go('#/clients');
        await store.remove('clients', existing.id).catch(() => {});
        toast('Client deleted');
      });
    },
    onSubmit(fd) {
      const keys = ['name', 'email', 'phone', 'website', 'address', 'notes', ...(docsReady() ? ['tax_id'] : [])];
      const data = Object.fromEntries(keys.map(k => [k, String(fd.get(k) || '').trim()]));
      if (!data.name) return false;
      if (existing) store.update('clients', existing.id, data).catch(() => {});
      else store.insert('clients', data).then(saved => go(`#/client/${saved.id}`)).catch(() => {});
    },
  });
}

export function openContactSheet(clientId, existing) {
  const c = existing || { name: '', role: '', email: '', phone: '', notes: '' };
  openSheet(`
    <form>
      ${sheetHeader(existing ? 'Edit contact' : 'New contact')}
      <div class="fields">
        <div class="field-row">
          <label class="field"><span>Name</span><input name="name" value="${esc(c.name)}" required autofocus></label>
          <label class="field"><span>Role</span><input name="role" value="${esc(c.role)}" placeholder="e.g. Marketing manager"></label>
        </div>
        <div class="field-row">
          <label class="field"><span>Email</span><input type="email" name="email" value="${esc(c.email)}" autocomplete="off"></label>
          <label class="field"><span>Phone</span><input type="tel" name="phone" value="${esc(c.phone)}"></label>
        </div>
        <label class="field"><span>Notes</span><textarea name="notes" rows="3">${esc(c.notes)}</textarea></label>
      </div>
      <footer>
        ${existing ? `<button type="button" class="btn danger" data-delete>Delete</button>` : ''}
        <span class="spacer"></span>
        <button type="button" class="btn" data-close>Cancel</button>
        <button type="submit" class="btn primary">${existing ? 'Save' : 'Add contact'}</button>
      </footer>
    </form>`, {
    onOpen(sheet) {
      const del = sheet.querySelector('[data-delete]');
      if (del) del.addEventListener('click', () => {
        if (!confirm(`Delete contact “${existing.name}”?`)) return;
        closeSheet();
        store.remove('contacts', existing.id).catch(() => {});
      });
    },
    onSubmit(fd) {
      const data = Object.fromEntries(['name', 'role', 'email', 'phone', 'notes'].map(k => [k, String(fd.get(k) || '').trim()]));
      if (!data.name) return false;
      if (existing) store.update('contacts', existing.id, data).catch(() => {});
      else store.insert('contacts', { ...data, client_id: clientId }).catch(() => {});
    },
  });
}

