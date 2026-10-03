// Deliverables & client feedback rounds (project → Deliverables tab), plus their sheets.
import { esc, icon, todayStr, fmtDate, daysUntil, toast, openSheet, closeSheet, sheetHeader, options, $ } from '../lib.js';
import { store, deliverablesOf, roundsOf, attachmentsWhere, nextSortOrder } from '../store.js';
import { fileStrip, uploadFiles } from '../files.js';
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

export function deliverablesTab(p) {
  const list = deliverablesOf(p.id);
  const head = `
    <div class="toolbar">
      <button class="btn primary" data-action="new-deliverable" data-project="${p.id}">${icon.plus} Deliverable</button>
      <span class="muted small">Track each version you send the client, their feedback, and how many revision rounds are used.</span>
    </div>`;
  if (!list.length) {
    return head + emptyState('No deliverables yet', 'Add what you will hand over — e.g. “Logo”, “Brand guidelines”, “Homepage design” — and how many revision rounds are included.',
      `<button class="btn primary" data-action="new-deliverable" data-project="${p.id}">${icon.plus} Add deliverable</button>`);
  }
  const approved = list.filter(d => d.status === 'approved').length;
  return head + `
    <div class="muted small deliv-summary">${approved} of ${list.length} approved</div>
    <div class="deliv-list">${list.map(deliverableCard).join('')}</div>`;
}

function roundDots(d, rounds) {
  const total = Math.max(d.max_rounds, rounds.length);
  return `<span class="round-dots" aria-hidden="true">${Array.from({ length: total }, (_, i) => {
    const r = rounds[i];
    const over = i >= d.max_rounds;
    return `<span class="rd ${r ? r.status : 'unused'} ${over ? 'over' : ''}"></span>`;
  }).join('')}</span>`;
}

function deliverableCard(d) {
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
          <h3>${esc(d.name)}</h3>
          ${d.description ? `<p class="muted prewrap">${esc(d.description)}</p>` : ''}
        </div>
        <div class="deliv-side">
          ${d.status === 'approved' ? `<span class="chip done">${icon.check} Approved</span>` : d.status === 'cancelled' ? `<span class="chip">Cancelled</span>` : ''}
          ${d.due_date && d.status === 'in_progress' ? dueChip(d.due_date) : ''}
          <button class="btn small ghost icon-btn" data-action="edit-deliverable" data-id="${d.id}" aria-label="Edit deliverable">${icon.edit}</button>
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
      ${sheetHeader(existing ? 'Edit deliverable' : 'New deliverable')}
      <div class="fields">
        <label class="field"><span>What are you delivering?</span><input name="name" value="${esc(d.name)}" required autofocus placeholder="e.g. Logo, Brand guidelines, Homepage design"></label>
        <div class="field-row">
          <label class="field"><span>Revision rounds included</span><input type="number" name="max_rounds" min="1" max="20" value="${esc(d.max_rounds)}" required inputmode="numeric"></label>
          <label class="field"><span>Due date</span><input type="date" name="due_date" value="${esc(d.due_date || '')}"></label>
        </div>
        ${existing ? `<label class="field"><span>Status</span><select name="status">${options(DELIVERABLE_STATUSES, d.status)}</select></label>` : ''}
        <label class="field"><span>Notes</span><textarea name="description" rows="3" placeholder="Formats, sizes, what's included…">${esc(d.description)}</textarea></label>
      </div>
      <footer>
        ${existing ? `<button type="button" class="btn danger" data-delete>Delete</button>` : ''}
        <span class="spacer"></span>
        <button type="button" class="btn" data-close>Cancel</button>
        <button type="submit" class="btn primary">${existing ? 'Save' : 'Add deliverable'}</button>
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
      suggestStage(deliverable.project_id, 'client_review', 'Move the project to Client review?');
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
        store.update('deliverables', d.id, { status: 'approved' }).catch(() => {});
        toast(`${d.name} approved 🎉`);
      } else if (newStatus === 'changes_requested' && isLatest) {
        if (d.status === 'approved') store.update('deliverables', d.id, { status: 'in_progress' }).catch(() => {});
        suggestStage(d.project_id, 'revisions', 'Move the project to Revisions?');
      }
    },
  });
}

function suggestStage(projectId, stage, question) {
  const p = store.get('projects', projectId);
  if (!p || p.stage === stage || p.status !== 'active') return;
  toast(question, { label: 'Move', run: () => store.update('projects', projectId, { stage }).catch(() => {}) });
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
