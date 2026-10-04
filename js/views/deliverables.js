// Deliverables & client feedback rounds (project → Deliverables tab), plus their sheets.
import { esc, icon, todayStr, fmtDate, daysUntil, toast, openSheet, closeSheet, sheetHeader, options, $ } from '../lib.js';
import { store, deliverablesOf, roundsOf, attachmentsWhere, nextSortOrder, productsOf, drawingOf } from '../store.js';
import { fileStrip, uploadFiles, docCard } from '../files.js';
import { dueChip, emptyState } from './common.js';

export const ROUND_STATUSES = [
  { id: 'awaiting', label: 'Waiting for client' },
  { id: 'changes_requested', label: 'Changes requested' },
  { id: 'approved', label: 'Approved' },
];
const DELIVERABLE_STATUSES = [
  { id: 'in_progress', label: 'In progress' },
  { id: 'approved', label: 'Approved' },
  { id: 'cancelled', label: 'Cancelled' },
];

const roundLabel = id => (ROUND_STATUSES.find(s => s.id === id) || {}).label || id;

function daysSince(date) {
  const n = -daysUntil(date);
  return n <= 0 ? 'today' : n === 1 ? '1 day ago' : `${n} days ago`;
}

// ---------- Tab ----------

// Drawings tab: one drawing (with approval rounds) per product, plus any other drawings.
export function drawingsTab(p) {
  const products = productsOf(p.id);
  const others = deliverablesOf(p.id).filter(d => !d.item_id || !store.get('items', d.item_id));
  const dep = store.all('invoices').filter(i => i.project_id === p.id && i.kind === 'deposit' && i.status !== 'cancelled').pop();
  const gate = dep && dep.status !== 'paid'
    ? `<div class="notice warn">Waiting for the deposit (${esc(dep.number)}) — drawings start once it's paid.
         <button class="btn small" data-action="wf" data-step="deposit-paid" data-id="${p.id}">Deposit received</button></div>`
    : '';
  const head = `
    <div class="toolbar">
      <span class="muted small">Send each product's drawing to the client, record their feedback, and repeat until approved.</span>
    </div>`;
  if (!products.length && !others.length) {
    return gate + head + emptyState('No products yet', 'Add products on the Order tab — each one gets its own drawing and approval.',
      `<a class="btn primary" href="#/project/${p.id}/order">Go to products</a>
       <button class="btn" data-action="new-deliverable" data-project="${p.id}">${icon.plus} Other drawing</button>`) + docCard(p, 'drawing', { title: 'References & sketches', hint: 'Photos and sketches from the client, inspiration images, workshop drawings — anything the drawings are based on.' });
  }
  const approved = products.filter(i => { const d = drawingOf(i.id); return d && d.status === 'approved'; }).length;
  return gate + head + `
    <div class="muted small deliv-summary">${approved} of ${products.length} product drawing${products.length === 1 ? '' : 's'} approved</div>
    <div class="deliv-list">
      ${products.map(i => {
        const d = drawingOf(i.id);
        if (d) return deliverableCard(d, i);
        return `
          <article class="deliv card-surface">
            <header class="deliv-head"><div class="deliv-title"><h3>${esc(i.name)}${Number(i.quantity) !== 1 ? ` <span class="muted">× ${esc(String(Number(i.quantity)))}</span>` : ''}</h3>
              <p class="muted">${esc([i.dimensions, i.materials].filter(Boolean).join(' · '))}</p></div></header>
            <div class="muted small">No drawing sent yet.</div>
            <div class="deliv-actions"><button class="btn primary" data-action="send-drawing" data-id="${i.id}">${icon.send} Send drawing to client</button></div>
          </article>`;
      }).join('')}
      ${others.map(d => deliverableCard(d)).join('')}
    </div>
    <div class="toolbar"><button class="btn" data-action="new-deliverable" data-project="${p.id}">${icon.plus} Other drawing</button></div>
    ${docCard(p, 'drawing', { title: 'References & sketches', hint: 'Photos and sketches from the client, inspiration images, workshop drawings — anything the drawings are based on.' })}`;
}

// Start the drawing for a product (created on first send).
export async function sendDrawing(item) {
  let d = drawingOf(item.id);
  if (!d) {
    d = await store.insert('deliverables', {
      project_id: item.project_id, item_id: item.id, name: item.name, max_rounds: 3, status: 'in_progress',
      description: '', sort_order: nextSortOrder(deliverablesOf(item.project_id)),
    });
  }
  openSendRoundSheet(d);
}

function roundDots(d, rounds) {
  const total = Math.max(d.max_rounds, rounds.length);
  return `<span class="round-dots" aria-hidden="true">${Array.from({ length: total }, (_, i) => {
    const r = rounds[i];
    const over = i >= d.max_rounds;
    return `<span class="rd ${r ? r.status : 'unused'} ${over ? 'over' : ''}"></span>`;
  }).join('')}</span>`;
}

function deliverableCard(d, item = null) {
  const rounds = roundsOf(d.id);
  const latest = rounds[rounds.length - 1];
  const used = rounds.length;
  const over = used > d.max_rounds;
  const nextNo = used + 1;

  let action = '';
  if (d.status === 'in_progress') {
    if (latest && latest.status === 'awaiting') {
      action = `<button class="btn primary" data-action="edit-round" data-id="${latest.id}" data-feedback="1">Record client feedback</button>`;
    } else {
      const extra = nextNo > d.max_rounds;
      action = `<button class="btn ${extra ? 'warn-btn' : 'primary'}" data-action="send-round" data-id="${d.id}">${icon.send} ${used ? `Send round ${nextNo}` : 'Send to client'}${extra ? ` <small>(extra — ${d.max_rounds} included)</small>` : ''}</button>`;
    }
  }

  return `
    <article class="deliv card-surface ${d.status}">
      <header class="deliv-head">
        <div class="deliv-title">
          <h3>${esc(d.name)}${item && Number(item.quantity) !== 1 ? ` <span class="muted">× ${esc(String(Number(item.quantity)))}</span>` : ''}</h3>
          ${item && (item.dimensions || item.materials) ? `<p class="muted">${esc([item.dimensions, item.materials].filter(Boolean).join(' · '))}</p>` : ''}
          ${d.description ? `<p class="muted prewrap">${esc(d.description)}</p>` : ''}
        </div>
        <div class="deliv-side">
          ${d.status === 'approved' ? `<span class="chip done">${icon.check} Approved</span>` : d.status === 'cancelled' ? `<span class="chip">Cancelled</span>` : ''}
          ${d.due_date && d.status === 'in_progress' ? dueChip(d.due_date) : ''}
          <button class="btn small ghost icon-btn" data-action="edit-deliverable" data-id="${d.id}" aria-label="Edit drawing">${icon.edit}</button>
        </div>
      </header>
      <div class="rounds-meter ${over ? 'over' : ''}">
        ${roundDots(d, rounds)}
        <span>${used ? `Round ${used} of ${d.max_rounds}` : `${d.max_rounds} round${d.max_rounds === 1 ? '' : 's'} included`}${over ? ` · <b>${used - d.max_rounds} extra</b>` : ''}</span>
      </div>
      ${rounds.length ? `<ol class="rounds">${rounds.slice().reverse().map(r => roundItem(d, r)).join('')}</ol>` : ''}
      ${action ? `<div class="deliv-actions">${action}</div>` : ''}
    </article>`;
}

function roundItem(d, r) {
  const files = attachmentsWhere('round_id', r.id);
  const waiting = r.status === 'awaiting' && r.sent_date;
  return `
    <li class="round ${r.status}">
      <div class="round-head">
        <b>Round ${r.round_no}</b>
        ${r.sent_date ? `<span class="muted">sent ${esc(fmtDate(r.sent_date))}</span>` : ''}
        <span class="chip round-chip ${r.status}">${esc(roundLabel(r.status))}${waiting ? ` · ${esc(daysSince(r.sent_date))}` : ''}</span>
        ${r.received_date && r.status !== 'awaiting' ? `<span class="muted">reply ${esc(fmtDate(r.received_date))}</span>` : ''}
        <button class="link-btn" data-action="edit-round" data-id="${r.id}">Edit</button>
      </div>
      ${r.feedback ? `<blockquote class="feedback prewrap">${esc(r.feedback)}</blockquote>` : ''}
      ${files.length ? fileStrip(files, null) : ''}
    </li>`;
}

// ---------- Sheets ----------

export function openDeliverableSheet(projectId, existing) {
  const d = existing || { name: '', description: '', max_rounds: 3, due_date: null, status: 'in_progress' };
  openSheet(`
    <form>
      ${sheetHeader(existing ? 'Edit drawing' : 'New drawing')}
      <div class="fields">
        <label class="field"><span>Drawing</span><input name="name" value="${esc(d.name)}" required autofocus placeholder="e.g. Floor plan, Detail drawing"></label>
        <div class="field-row">
          <label class="field"><span>Approval rounds included</span><input type="number" name="max_rounds" min="1" max="20" value="${esc(d.max_rounds)}" required inputmode="numeric"></label>
          <label class="field"><span>Due date</span><input type="date" name="due_date" value="${esc(d.due_date || '')}"></label>
        </div>
        ${existing ? `<label class="field"><span>Status</span><select name="status">${options(DELIVERABLE_STATUSES, d.status)}</select></label>` : ''}
        <label class="field"><span>Notes</span><textarea name="description" rows="3" placeholder="Formats, sizes, what's included…">${esc(d.description)}</textarea></label>
      </div>
      <footer>
        ${existing ? `<button type="button" class="btn danger" data-delete>Delete</button>` : ''}
        <span class="spacer"></span>
        <button type="button" class="btn" data-close>Cancel</button>
        <button type="submit" class="btn primary">${existing ? 'Save' : 'Add drawing'}</button>
      </footer>
    </form>`, {
    onOpen(sheet) {
      const del = sheet.querySelector('[data-delete]');
      if (del) del.addEventListener('click', async () => {
        const n = roundsOf(existing.id).length;
        if (!confirm(`Delete “${existing.name}”${n ? ` and its ${n} round${n === 1 ? '' : 's'} (with their files)` : ''}?`)) return;
        closeSheet();
        const paths = store.all('attachments').filter(a => roundsOf(existing.id).some(r => r.id === a.round_id)).map(a => a.path);
        await store.remove('deliverables', existing.id).catch(() => {});
        if (paths.length) store.backend.removeFiles(paths).catch(() => {});
      });
    },
    onSubmit(fd) {
      const data = {
        name: String(fd.get('name')).trim(),
        max_rounds: Math.min(20, Math.max(1, parseInt(fd.get('max_rounds'), 10) || 3)),
        due_date: fd.get('due_date') || null,
        description: fd.get('description'),
      };
      if (!data.name) return false;
      if (existing) {
        data.status = fd.get('status');
        store.update('deliverables', existing.id, data).catch(() => {});
      } else {
        data.project_id = projectId;
        data.status = 'in_progress';
        data.sort_order = nextSortOrder(deliverablesOf(projectId));
        store.insert('deliverables', data).catch(() => {});
      }
    },
  });
}

// "Send round N": records that a version went to the client, with the files sent.
export function openSendRoundSheet(deliverable) {
  const rounds = roundsOf(deliverable.id);
  const nextNo = (rounds.length ? Math.max(...rounds.map(r => r.round_no)) : 0) + 1;
  const extra = nextNo > deliverable.max_rounds;
  openSheet(`
    <form>
      ${sheetHeader(`${deliverable.name} — round ${nextNo}`)}
      <div class="fields">
        ${extra ? `<div class="notice warn">This is an extra round: ${deliverable.max_rounds} ${deliverable.max_rounds === 1 ? 'was' : 'were'} included. You may want to add a cost or invoice for it.</div>` : ''}
        <label class="field"><span>Sent to client on</span><input type="date" name="sent_date" value="${todayStr()}" required></label>
        <label class="field"><span>What you sent (optional)</span>
          <span class="file-pick">
            <label class="btn">${icon.upload}<span>Choose files or photos</span><input type="file" name="files" multiple hidden></label>
            <span class="muted small" id="picked">No files chosen</span>
          </span>
        </label>
      </div>
      <footer>
        <span class="spacer"></span>
        <button type="button" class="btn" data-close>Cancel</button>
        <button type="submit" class="btn primary">${icon.send} Mark as sent</button>
      </footer>
    </form>`, {
    onOpen(sheet) {
      const input = $('input[name=files]', sheet);
      input.addEventListener('change', () => {
        $('#picked', sheet).textContent = input.files.length ? `${input.files.length} file${input.files.length === 1 ? '' : 's'} chosen` : 'No files chosen';
      });
    },
    async onSubmit(fd, form) {
      const files = [...$('input[name=files]', form).files];
      let round;
      try {
        round = await store.insert('feedback_rounds', {
          deliverable_id: deliverable.id, round_no: nextNo, sent_date: fd.get('sent_date'), status: 'awaiting',
        });
      } catch (err) {
        return false;
      }
      closeSheet();
      if (files.length) await uploadFiles(files, { project_id: deliverable.project_id, round_id: round.id });
      afterDrawingChange(deliverable.project_id);
    },
  });
}

// Edit a round / record the client's feedback.
export function openRoundSheet(round, { feedbackMode = false } = {}) {
  const d = store.get('deliverables', round.deliverable_id);
  if (!d) return;
  let unsubscribe = null;
  const status = feedbackMode && round.status === 'awaiting' ? 'changes_requested' : round.status;

  openSheet(`
    <form>
      ${sheetHeader(`${d.name} — round ${round.round_no}`)}
      <div class="fields">
        <div class="field"><span>Client's response</span>
          <div class="segmented big-seg" role="radiogroup">
            ${ROUND_STATUSES.map(s => `
              <label class="seg-opt ${s.id}"><input type="radio" name="status" value="${s.id}" ${status === s.id ? 'checked' : ''}><span>${esc(s.label)}</span></label>`).join('')}
          </div>
        </div>
        <div class="field-row">
          <label class="field"><span>Sent on</span><input type="date" name="sent_date" value="${esc(round.sent_date || '')}"></label>
          <label class="field"><span>Client replied on</span><input type="date" name="received_date" value="${esc(round.received_date || (feedbackMode ? todayStr() : ''))}"></label>
        </div>
        <label class="field"><span>Client feedback</span><textarea name="feedback" rows="5" ${feedbackMode ? 'autofocus' : ''} placeholder="Paste or summarise what the client asked for…">${esc(round.feedback)}</textarea></label>
        <div class="field"><span>Files for this round</span><div id="round-files"></div></div>
      </div>
      <footer>
        <button type="button" class="btn danger" data-delete>Delete round</button>
        <span class="spacer"></span>
        <button type="button" class="btn" data-close>Cancel</button>
        <button type="submit" class="btn primary">Save</button>
      </footer>
    </form>`, {
    onOpen(sheet) {
      const renderFiles = () => {
        const box = $('#round-files', sheet);
        if (box) box.innerHTML = fileStrip(attachmentsWhere('round_id', round.id), { project_id: d.project_id, round_id: round.id });
      };
      renderFiles();
      unsubscribe = store.onChange(() => {
        if (!store.get('feedback_rounds', round.id)) { closeSheet(); return; }
        renderFiles();
      });
      sheet.querySelector('[data-delete]').addEventListener('click', async () => {
        if (!confirm(`Delete round ${round.round_no} and its files?`)) return;
        closeSheet();
        const paths = attachmentsWhere('round_id', round.id).map(a => a.path);
        await store.remove('feedback_rounds', round.id).catch(() => {});
        if (paths.length) store.backend.removeFiles(paths).catch(() => {});
      });
    },
    onClose() { unsubscribe && unsubscribe(); },
    onSubmit(fd) {
      const newStatus = fd.get('status');
      const patch = {
        status: newStatus,
        sent_date: fd.get('sent_date') || null,
        received_date: newStatus === 'awaiting' ? (fd.get('received_date') || null) : (fd.get('received_date') || todayStr()),
        feedback: fd.get('feedback'),
      };
      store.update('feedback_rounds', round.id, patch).catch(() => {});
      if (newStatus === round.status) return;
      const isLatest = roundsOf(d.id).every(r => r.round_no <= round.round_no);
      if (newStatus === 'approved' && isLatest && d.status !== 'approved') {
        store.update('deliverables', d.id, { status: 'approved' }).then(() => afterDrawingChange(d.project_id)).catch(() => {});
        toast(`${d.name} approved 🎉`);
      } else if (newStatus === 'changes_requested' && isLatest) {
        if (d.status === 'approved') store.update('deliverables', d.id, { status: 'in_progress' }).catch(() => {});
      }
    },
  });
}

// Keep the project stage in step with its drawings:
// all product drawings sent → Client approval; all approved → offer to start production.
function afterDrawingChange(projectId) {
  const p = store.get('projects', projectId);
  if (!p || p.status !== 'active') return;
  const products = productsOf(projectId);
  if (!products.length) return;
  const drawings = products.map(i => drawingOf(i.id));
  const allSent = drawings.every(d => d && roundsOf(d.id).length);
  const allApproved = drawings.every(d => d && d.status === 'approved');
  if (allApproved && (p.stage === 'drawings' || p.stage === 'approval')) {
    toast('All drawings approved', { label: 'Start production', run: () => import('./order.js').then(m => m.runStep('production', store.get('projects', projectId))) });
  } else if (allSent && (p.stage === 'deposit' || p.stage === 'drawings')) {
    store.update('projects', projectId, { stage: 'approval' }).catch(() => {});
    toast('All drawings sent — waiting for client approval');
  }
}

// ---------- Overview: deliverables waiting on clients ----------

export function waitingOnClients(projectFilter) {
  const out = [];
  store.all('deliverables').forEach(d => {
    if (d.status !== 'in_progress') return;
    const p = store.get('projects', d.project_id);
    if (!p || p.status !== 'active' || !projectFilter(p)) return;
    const rounds = roundsOf(d.id);
    const latest = rounds[rounds.length - 1];
    if (latest && latest.status === 'awaiting') out.push({ d, p, r: latest });
  });
  return out.sort((a, b) => (a.r.sent_date || '').localeCompare(b.r.sent_date || ''));
}

export { daysSince };
