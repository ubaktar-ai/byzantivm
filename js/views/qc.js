// Quality control (lighting): spec versions with client approval and supplier confirmation,
// inspections with checklists and photos, an issues log, and checks that block production / shipping.
// Everything saved here is permanent: new information is added, nothing is edited or deleted.
import { esc, icon, todayStr, fmtDate, toast, openSheet, sheetHeader, options, label, $, $$ } from '../lib.js';
import { store, productsOf, personName, me } from '../store.js';
import {
  SPEC_SECTIONS, defaultSpec, visible, fieldValue, productFacts, specRows, specDiff, checklist,
  STAGES as QC_STAGES, INSPECTORS, IMAGE_GROUPS, showOf, templateShow, ALL_FIELDS,
} from '../qc-spec.js';
import {
  samplesBlock, requestsBlock, submissionsBlock, linksBlock, openRequests, requestsOf, requestStatus, moreAction, moreHistory,
} from './qc-more.js';
import { uploadFiles } from '../files.js';
import { emptyState } from './common.js';

// ---------- Data helpers ----------

export const qcReady = () => store.loaded && !store.missing.has('spec_versions') && !store.missing.has('qc_samples');
export const byCreated = (a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0);
export const lightingOf = pid => productsOf(pid).filter(i => i.category === 'lighting');
export const guessCategory = name => (/light|lamp|pendant|chandelier|sconce|lumin|lantern|bulb|led\b|spot|downlight/i.test(name || '') ? 'lighting' : 'furniture');

export const companyOf = p => (p && store.get('companies', p.company_id)) || {};
export const templateOf = p => companyOf(p).qc_template || {};
// "01", "02"… by position unless the product has its own item no.
export const itemNo = it => it.item_no || String(productsOf(it.project_id).findIndex(x => x.id === it.id) + 1).padStart(2, '0');
export function nextOrderNo(companyId) {
  const c = store.get('companies', companyId);
  const code = (c ? c.name : 'ORD').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'ORD';
  const prefix = `${code}-O-${new Date().getFullYear()}-`;
  const used = store.all('projects').map(p => p.order_no || '').filter(n => n.startsWith(prefix)).map(n => parseInt(n.slice(prefix.length), 10) || 0);
  return prefix + String((used.length ? Math.max(...used) : 0) + 1).padStart(3, '0');
}

export const versionsOf = itemId => store.all('spec_versions').filter(v => v.item_id === itemId).sort((a, b) => a.version_no - b.version_no);
export const latestVersion = itemId => versionsOf(itemId).pop() || null;
export const approvalsOf = versionId => store.all('qc_approvals').filter(a => a.version_id === versionId).sort(byCreated);
export const lastDecision = (versionId, party) => approvalsOf(versionId).filter(a => a.party === party).pop() || null;
export const inspectionsOf = itemId => store.all('qc_inspections').filter(i => i.item_id === itemId).sort(byCreated);
export const issuesOf = pid => store.all('qc_issues').filter(i => i.project_id === pid).sort((a, b) => a.number - b.number);
const updatesOf = issueId => store.all('qc_issue_updates').filter(u => u.issue_id === issueId).sort(byCreated);
export const issueStatus = issue => (updatesOf(issue.id).pop() || { status: 'open' }).status;
const RESOLVED = ['verified', 'accepted', 'closed'];
export const isOpenIssue = issue => !RESOLVED.includes(issueStatus(issue));
const overridesOf = (pid, gate) => store.all('qc_overrides').filter(o => o.project_id === pid && (!gate || o.gate === gate)).sort(byCreated);

export const ISSUE_STATUSES = [
  { id: 'open', label: 'Open' },
  { id: 'fixing', label: 'Being fixed' },
  { id: 'fixed', label: 'Fixed — to check' },
  { id: 'verified', label: 'Checked & resolved' },
  { id: 'accepted', label: 'Accepted as is' },
  { id: 'closed', label: 'Closed' },
];
const SEVERITIES = [{ id: 'minor', label: 'Minor' }, { id: 'major', label: 'Major' }, { id: 'critical', label: 'Critical' }];
export const RESPONSIBLE = [{ id: 'supplier', label: 'Supplier' }, { id: 'us', label: 'Us' }, { id: 'client', label: 'Client' }, { id: 'carrier', label: 'Carrier / transport' }];
export const METHODS = ['Email', 'WhatsApp', 'Signed PDF', 'In person', 'Phone', 'Other'];

// What gets frozen in a version. Visibility (_show) is copied completely so a version is readable on its own,
// but the current choice on the product wins when showing it (it's about presentation, not the product).
export const snapshot = it => {
  const t = templateOf(store.get('projects', it.project_id));
  const spec = { ...(it.spec || {}) };
  spec._show = Object.fromEntries(ALL_FIELDS.map(f => [f.key, showOf(spec, f.key, t)]));
  return { ...spec, _product: productFacts(it) };
};
// A version's spec with today's visibility choices applied.
export const viewSpec = (version, item) => (version
  ? { ...version.spec, _show: { ...(version.spec._show || {}), ...((item && item.spec && item.spec._show) || {}) } }
  : snapshot(item));
export const when = iso => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
export const who = id => (personName(id) || 'Someone').split(' ')[0];
export const stamp = r => `${esc(when(r.created_at))} · ${esc(who(r.created_by))}`;

export function specState(it) {
  const latest = latestVersion(it.id);
  return {
    latest,
    client: latest && lastDecision(latest.id, 'client'),
    supplier: latest && lastDecision(latest.id, 'supplier'),
    internal: latest && lastDecision(latest.id, 'internal'),
    changes: latest ? specDiff(latest.spec, snapshot(it)) : [],
  };
}

// ---------- Checks that block production / shipping (can be overridden with a recorded reason) ----------

export function gateProblems(p, gate) {
  if (!qcReady()) return [];
  const out = [];
  for (const it of lightingOf(p.id)) {
    const st = specState(it);
    const v = st.latest ? `v${st.latest.version_no}` : '';
    if (gate === 'production') {
      if (!st.latest) { out.push(`${it.name}: no spec issued yet`); continue; }
      if (!st.internal || st.internal.decision !== 'approved') out.push(`${it.name}: spec ${v} not approved by us`);
      if (!st.client || st.client.decision !== 'approved') out.push(`${it.name}: spec ${v} not approved by the client`);
      if (!st.supplier || st.supplier.decision !== 'approved') out.push(`${it.name}: spec ${v} not confirmed by the supplier`);
      if (st.changes.length) out.push(`${it.name}: ${st.changes.length} change${st.changes.length === 1 ? '' : 's'} not issued as a new spec version yet`);
    } else {
      const last = stg => inspectionsOf(it.id).filter(i => i.stage === stg && (!st.latest || i.version_id === st.latest.id)).pop();
      const fin = last('final');
      const pack = last('packing');
      if (!fin) out.push(`${it.name}: no final inspection${v ? ` of spec ${v}` : ''}`);
      else if (fin.outcome !== 'pass') out.push(`${it.name}: last final inspection failed`);
      if (!pack) out.push(`${it.name}: packing not checked yet (packed & ready for collection)`);
      else if (pack.outcome !== 'pass') out.push(`${it.name}: last packing check failed`);
    }
    openRequests(p.id).filter(r => r.item_id === it.id).forEach(r => out.push(`${it.name}: change request from the ${r.party === 'us' ? 'team' : r.party} is still open`));
  }
  if (gate === 'shipping') issuesOf(p.id).filter(isOpenIssue).forEach(i => out.push(`Issue #${i.number} “${i.title}” is not resolved`));
  return out;
}

// Resolves true when the step may go ahead (all checks pass, or someone overrides with a reason).
export function passGate(p, gate) {
  const problems = gateProblems(p, gate);
  if (!problems.length || overridesOf(p.id, gate).length) return Promise.resolve(true);
  const what = gate === 'production' ? 'start production' : 'ship';
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    openSheet(`
      <form>
        ${sheetHeader(`Not ready to ${what}`)}
        <div class="fields">
          <p>Quality control isn't complete for this order:</p>
          <ul class="qc-problems">${problems.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
          <details class="qc-override">
            <summary>Go ahead anyway (override)</summary>
            <label class="field"><span>Reason — saved permanently with your name and the time</span>
              <textarea name="reason" rows="3" minlength="5" placeholder="e.g. Client asked to ship today; finish touch-up agreed on site"></textarea></label>
            <button type="submit" class="btn danger">Override &amp; ${esc(what)}</button>
          </details>
        </div>
        <footer>
          <a class="btn" href="#/project/${p.id}/qc" data-close>Open quality control</a>
          <span class="spacer"></span>
          <button type="button" class="btn primary" data-close>OK</button>
        </footer>
      </form>`, {
      async onSubmit(fd) {
        const reason = String(fd.get('reason') || '').trim();
        if (reason.length < 5) { toast('Write a reason for the override'); return false; }
        try {
          await store.insert('qc_overrides', { project_id: p.id, gate, reason });
        } catch (err) { finish(false); return; }
        finish(true);
      },
      onClose() { finish(false); },
    });
  });
}

// One line for the Next-step card.
export function qcLine(p) {
  if (!qcReady()) return '';
  const lights = lightingOf(p.id);
  if (!lights.length) return '';
  const st = lights.map(specState);
  const approved = st.filter(s => s.client && s.client.decision === 'approved').length;
  const confirmed = st.filter(s => s.supplier && s.supplier.decision === 'approved').length;
  const open = issuesOf(p.id).filter(isOpenIssue).length;
  return `<p class="small qc-line">💡 Lighting QC: specs approved by client <b>${approved}/${lights.length}</b> · confirmed by supplier <b>${confirmed}/${lights.length}</b>${open ? ` · <b class="bad-text">${open} open issue${open === 1 ? '' : 's'}</b>` : ''} · <a href="#/project/${p.id}/qc">Open QC</a></p>`;
}

// ---------- QC tab ----------

export const chip = (text, cls = '') => `<span class="chip qc-chip ${cls}">${text}</span>`;

export function decisionText(a, party) {
  if (!a) return party === 'client' ? '⏳ Waiting for client approval' : party === 'internal' ? '⏳ Waiting for our approval' : '⏳ Waiting for supplier confirmation';
  const ok = a.decision === 'approved';
  const verb = party === 'client' ? (ok ? 'Approved by client' : 'Rejected by client')
    : party === 'internal' ? (ok ? 'Approved by us' : 'Not approved by us')
    : (ok ? 'Confirmed by supplier' : 'Supplier can’t make it as specified');
  return `${ok ? '✅' : '❌'} ${verb}${a.person ? ` (${esc(a.person)}${a.method ? `, ${esc(a.method.toLowerCase())}` : ''})` : ''} · ${esc(when(a.created_at))}`;
}

function gateCard(p, gate) {
  const problems = gateProblems(p, gate);
  const ov = overridesOf(p.id, gate).pop();
  const title = gate === 'production' ? 'Production check' : 'Shipping check';
  const state = !problems.length ? `<span class="good-text">✅ Ready</span>` : ov ? `<span class="warn-text">⚠️ Overridden</span>` : `<span class="bad-text">⛔ Not ready</span>`;
  return `
    <div class="qc-gate">
      <div class="qc-gate-head"><b>${title}</b> ${state}</div>
      ${problems.length ? `<ul class="qc-problems small">${problems.slice(0, 6).map(x => `<li>${esc(x)}</li>`).join('')}${problems.length > 6 ? `<li>…and ${problems.length - 6} more</li>` : ''}</ul>` : ''}
      ${ov ? `<p class="small muted">Overridden ${stamp(ov)}: “${esc(ov.reason)}”</p>` : ''}
    </div>`;
}

function lightCard(p, it) {
  const st = specState(it);
  const v = st.latest;
  const insps = inspectionsOf(it.id);
  const issues = issuesOf(p.id).filter(i => i.item_id === it.id);
  const open = issues.filter(isOpenIssue);
  const lastOf = stg => insps.filter(i => i.stage === stg).pop();
  const lastFinal = lastOf('final');
  const lastPack = lastOf('packing');
  const tag = (it.spec || {}).location_tag;
  const allApproved = v && ['internal', 'supplier', 'client'].every(k => st[k] && st[k].decision === 'approved');
  return `
    <article class="card-surface qc-card" data-item="${it.id}">
      <header class="qc-card-head">
        <div>
          <div class="muted small">Item ${esc(itemNo(it))}${p.order_no ? ` · ${esc(p.order_no)}` : ''}</div>
          <h3>${esc(it.name)}${Number(it.quantity) !== 1 ? ` <span class="muted">× ${esc(String(Number(it.quantity) || 1))}</span>` : ''}</h3>
          <div class="muted small">${esc([tag, it.supplier].filter(Boolean).join(' · ') || 'No location tag or supplier yet')}</div>
        </div>
        <div class="qc-chips">
          ${v ? chip(`Spec v${v.version_no}${allApproved ? ' ✓ approved' : ''}`, allApproved ? 'good' : '') : chip('No spec yet', 'warn')}
          ${lastFinal ? chip(lastFinal.outcome === 'pass' ? 'Final QC passed' : 'Final QC failed', lastFinal.outcome === 'pass' ? 'good' : 'bad') : ''}
          ${lastPack ? chip(lastPack.outcome === 'pass' ? 'Packed ✓' : 'Packing failed', lastPack.outcome === 'pass' ? 'good' : 'bad') : ''}
          ${open.length ? chip(`${open.length} open issue${open.length === 1 ? '' : 's'}`, 'bad') : ''}
        </div>
      </header>

      <section class="qc-block">
        <h4>Specification</h4>
        ${v ? `
          <p class="small">Spec <b>v${v.version_no}</b> issued ${stamp(v)}${v.change_reason ? ` — “${esc(v.change_reason)}”` : ''}</p>
          <p class="small">${decisionText(st.internal, 'internal')}</p>
          <p class="small">${decisionText(st.supplier, 'supplier')}</p>
          <p class="small">${decisionText(st.client, 'client')}</p>
          ${st.changes.length ? `<p class="notice warn small">${st.changes.length} change${st.changes.length === 1 ? '' : 's'} since v${v.version_no} (${esc(st.changes.slice(0, 3).map(c => c.label).join(', '))}${st.changes.length > 3 ? '…' : ''}) — issue them as v${v.version_no + 1}; it then needs approval from us, the supplier and the client again.</p>` : ''}`
          : `<p class="small muted">Fill in the spec, then issue v1. Production needs the same version approved by us, the supplier and the client.</p>`}
        <div class="qc-actions">
          <button class="btn small" data-action="qc-spec" data-id="${it.id}">${icon.edit} ${Object.keys(it.spec || {}).length ? 'Edit spec' : 'Fill in spec'}</button>
          ${!v || st.changes.length ? `<button class="btn small primary" data-action="qc-issue-version" data-id="${it.id}">Issue v${v ? v.version_no + 1 : 1}${v ? ' (change)' : ''}</button>` : ''}
          ${v ? `
            <button class="btn small" data-action="qc-approval" data-party="internal" data-id="${it.id}">Our approval</button>
            <button class="btn small" data-action="qc-approval" data-party="supplier" data-id="${it.id}">Supplier confirmation</button>
            <button class="btn small" data-action="qc-approval" data-party="client" data-id="${it.id}">Client approval</button>
            <button class="btn small" data-action="qc-versions" data-id="${it.id}">Versions (${versionsOf(it.id).length})</button>` : ''}
          <button class="btn small" data-action="qc-card-pdf" data-party="client" data-id="${it.id}">Client spec card PDF</button>
          <button class="btn small" data-action="qc-card-pdf" data-party="supplier" data-id="${it.id}">Supplier spec card PDF</button>
          <button class="btn small" data-action="tear-edit" data-id="${it.id}">Tear sheet</button>
        </div>
      </section>

      ${samplesBlock(it)}
      ${requestsBlock(it)}

      <section class="qc-block">
        <h4>Inspections</h4>
        ${insps.length ? `<div class="qc-rows">${insps.slice().reverse().map(i => `
          <button type="button" class="qc-row" data-action="qc-view-inspection" data-id="${i.id}">
            <span>${esc(label(QC_STAGES, i.stage))} · ${esc(label(INSPECTORS, i.inspector))}${i.inspector_name ? ` (${esc(i.inspector_name)})` : ''}</span>
            <span class="muted small">${esc(fmtDate(i.inspected_on || i.created_at.slice(0, 10)))}</span>
            ${chip(i.outcome === 'pass' ? 'Pass' : 'Fail', i.outcome === 'pass' ? 'good' : 'bad')}
          </button>`).join('')}</div>` : `<p class="small muted">No inspections yet.</p>`}
        ${submissionsBlock(it)}
        <div class="qc-actions">
          <button class="btn small" data-action="qc-inspect" data-id="${it.id}">${icon.check} New inspection</button>
          <button class="btn small" data-action="qc-new-issue" data-id="${it.id}">Report issue</button>
        </div>
      </section>
    </article>`;
}

function issueRow(i) {
  const s = issueStatus(i);
  return `
    <button type="button" class="qc-row" data-action="qc-view-issue" data-id="${i.id}">
      <span><b>#${i.number}</b> ${esc(i.title)}${i.item_name ? ` <span class="muted small">· ${esc(i.item_name)}</span>` : ''}</span>
      <span class="muted small">${esc(label(SEVERITIES, i.severity))}${i.due_date ? ` · due ${esc(fmtDate(i.due_date))}` : ''}</span>
      ${chip(esc(label(ISSUE_STATUSES, s)), RESOLVED.includes(s) ? 'good' : 'bad')}
    </button>`;
}

// Every QC record of the order, newest first — the permanent audit trail.
function historyEntries(pid) {
  const rows = [];
  const add = (r, text) => rows.push({ at: r.created_at, by: r.created_by, text });
  store.all('spec_versions').filter(v => v.project_id === pid).forEach(v => add(v, `issued <b>${esc(v.item_name)}</b> spec v${v.version_no}${v.change_reason ? ` — “${esc(v.change_reason)}”` : ''}`));
  store.all('qc_approvals').filter(a => a.project_id === pid).forEach(a => {
    const ver = store.get('spec_versions', a.version_id);
    const what = ver ? `<b>${esc(ver.item_name)}</b> v${ver.version_no}` : 'a spec';
    add(a, `recorded: ${a.party === 'internal' ? 'we' : a.party} ${a.decision === 'approved' ? (a.party === 'supplier' ? 'confirmed' : 'approved') : 'rejected'} ${what}${a.person ? ` (${esc(a.person)}, ${esc(a.method || '')})` : ''}${a.note ? ` — “${esc(a.note)}”` : ''}`);
  });
  store.all('qc_inspections').filter(i => i.project_id === pid).forEach(i => add(i, `saved a ${esc(label(QC_STAGES, i.stage).toLowerCase())} inspection of <b>${esc(i.item_name)}</b>: ${i.outcome === 'pass' ? '<span class="good-text">pass</span>' : '<span class="bad-text">fail</span>'}`));
  store.all('qc_issues').filter(i => i.project_id === pid).forEach(i => add(i, `reported issue <b>#${i.number} ${esc(i.title)}</b>`));
  store.all('qc_issue_updates').filter(u => u.project_id === pid).forEach(u => add(u, `updated ${esc(u.title)}: ${esc(label(ISSUE_STATUSES, u.status))}${u.note ? ` — “${esc(u.note)}”` : ''}`));
  store.all('qc_overrides').filter(o => o.project_id === pid).forEach(o => add(o, `<b class="warn-text">overrode the ${o.gate} check</b> — “${esc(o.reason)}”`));
  moreHistory(pid).forEach(r => rows.push(r));
  return rows.sort((a, b) => (a.at < b.at ? 1 : -1));
}

export function qcTab(p) {
  if (!qcReady()) {
    return `<div class="notice warn">The database needs an update before quality control can be used: run <code>supabase/migrations/008_quality_control.sql</code> and then <code>009_qc_line_cards.sql</code> in the Supabase SQL Editor.</div>`;
  }
  const lights = lightingOf(p.id);
  const others = productsOf(p.id).filter(i => i.category !== 'lighting');
  const issues = issuesOf(p.id);
  const itemIds = new Set(productsOf(p.id).map(i => i.id));
  const removed = [...new Map(store.all('spec_versions').filter(v => v.project_id === p.id && !itemIds.has(v.item_id)).map(v => [v.item_id, v])).values()];
  const history = historyEntries(p.id);
  const client = store.get('clients', p.client_id);
  const newRequests = openRequests(p.id).filter(r => requestStatus(r) === 'open');

  return `
    <div class="card-surface pad qc-order-head">
      <a class="qc-order-link" href="#/project/${p.id}/linecards">
        <span class="muted small">Order</span>
        <b>${p.order_no ? esc(p.order_no) : 'No order no. yet'}</b>
        <span>${esc(p.name)}${client ? ` · ${esc(client.name)}` : ''}</span>
        <span class="small">${lights.length} specification card${lights.length === 1 ? '' : 's'} →</span>
      </a>
      ${p.order_no ? '' : `<button class="btn small" data-action="qc-order-no" data-id="${p.id}">Give it an order no.</button>`}
    </div>
    ${newRequests.length ? `<div class="notice warn">📨 ${newRequests.length} new change request${newRequests.length === 1 ? '' : 's'} — see below.</div>` : ''}
    <div class="toolbar"><span class="muted small">🔒 Spec versions, approvals, samples, inspections, issues, requests and overrides are permanent — saved with the date and who did it, and can't be edited or deleted.</span></div>
    ${lights.length ? `<div class="card-surface pad qc-gates">${gateCard(p, 'production')}${gateCard(p, 'shipping')}</div>` : ''}
    ${lights.length ? lights.map(it => lightCard(p, it)).join('') : emptyState('No lighting products in this order', 'Quality control works per lighting product. Mark a product as Lighting below or in its product settings.')}
    ${others.length ? `
      <h2 class="section">Other products</h2>
      <div class="card-surface qc-rows">${others.map(i => `
        <div class="qc-row static"><span>${esc(i.name)} <span class="muted small">· ${esc(i.category === 'other' ? 'other' : 'furniture')}</span></span>
          <button class="btn small" data-action="qc-make-lighting" data-id="${i.id}">Mark as lighting</button></div>`).join('')}</div>
      <p class="muted small">A furniture checklist can be added later.</p>` : ''}
    ${removed.length ? `<p class="muted small">History kept for removed products: ${removed.map(v => esc(v.item_name)).join(', ')}.</p>` : ''}

    ${linksBlock(p)}

    <h2 class="section section-with-action">Issues <button class="btn small" data-action="qc-new-issue" data-project="${p.id}">${icon.plus} Report issue</button></h2>
    ${issues.length ? `<div class="card-surface qc-rows">${issues.map(issueRow).join('')}</div>` : `<div class="empty small-empty">No issues reported.</div>`}

    <h2 class="section">History</h2>
    ${history.length ? `<div class="card-surface qc-history">${history.slice(0, 80).map(h => `
      <div class="qc-hist"><span class="muted small">${esc(when(h.at))}</span><span><b>${esc(h.by ? who(h.by) : h.person || 'Via link')}</b> ${h.text}</span></div>`).join('')}
      ${history.length > 80 ? `<p class="muted small">Showing the latest 80 of ${history.length} records.</p>` : ''}</div>`
      : `<div class="empty small-empty">Nothing recorded yet.</div>`}`;
}

// ---------- Spec editor (the working draft; issuing a version makes it permanent) ----------

export function fieldHtml(f, s, template, { toggles: customToggles } = {}) {
  const v = s[f.key] ?? '';
  const id = `spec-${f.key}`;
  let input;
  if (f.type === 'select') input = `<select name="${f.key}" id="${id}">${options(f.options, v, { empty: '—' })}</select>`;
  else if (f.type === 'yesno') input = `<select name="${f.key}" id="${id}">${options([{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }], v, { empty: '—' })}</select>`;
  else if (f.type === 'textarea' || f.type === 'lines') input = `<textarea name="${f.key}" id="${id}" rows="${f.type === 'lines' ? 4 : 2}" placeholder="${f.type === 'lines' ? 'e.g. Engrave client logo on canopy\nGlass bubbles allowed, no scratches' : ''}">${esc(v)}</textarea>`;
  else if (f.type === 'list') {
    // A picker with the usual choices plus "Other" to type your own (no floating suggestion boxes).
    const list = typeof f.list === 'function' ? f.list(s) : f.list;
    const custom = String(v).trim() !== '' && !list.includes(v);
    input = `<div class="pick-other">
      <select name="${f.key}__pick" id="${id}">${pickOptions(list, v)}</select>
      <input name="${f.key}" value="${esc(v)}" placeholder="Type your own" autocomplete="off" ${custom ? '' : 'hidden'}>
    </div>`;
  } else if (f.type === 'files') input = photoPicker(`file_${f.key}`, 'Upload datasheet');
  else input = `<input name="${f.key}" id="${id}" value="${esc(v)}" ${f.type === 'number' ? 'inputmode="decimal"' : ''} placeholder="${esc(f.placeholder || '')}" autocomplete="off">`;
  // Who sees this detail on their sheet (only filled-in details are ever printed).
  const show = showOf(s, f.key, template);
  const toggles = customToggles ? customToggles(f) : `<span class="vis-toggles" title="Show on the client / supplier sheet">
    <label class="vis"><input type="checkbox" name="vis_c_${f.key}" ${show === 'cs' || show === 'c' ? 'checked' : ''}><span>Client</span></label>
    <label class="vis"><input type="checkbox" name="vis_s_${f.key}" ${show === 'cs' || show === 's' ? 'checked' : ''}><span>Supplier</span></label></span>`;
  const unused = templateShow(template, f.key) === 'off' && !fieldValue(f, s);
  return `<div class="field ${f.type === 'lines' || f.type === 'textarea' ? 'wide' : ''}" data-field="${f.key}" ${visible(f, s) && !unused ? '' : 'hidden'}>
    <div class="field-head"><label for="${id}">${esc(f.label)}</label>${toggles}</div>${input}</div>`;
}

function pickOptions(list, v) {
  const custom = String(v ?? '').trim() !== '' && !list.includes(v);
  return `<option value="">—</option>${list.map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}
    <option value="__other" ${custom ? 'selected' : ''}>Other — type your own…</option>`;
}

// Keep a picker and its "own value" box in step.
function setPick(form, key, value) {
  const sel = form.elements[`${key}__pick`];
  const box = form.elements[key];
  if (!sel || !box) return;
  box.value = value;
  const known = [...sel.options].some(o => o.value === value && value !== '__other');
  sel.value = known ? value : value ? '__other' : '';
  box.hidden = known || !value;
}

function readDraft(key) {
  try {
    const d = JSON.parse(localStorage.getItem(key) || 'null');
    // Drafts older than two weeks are dropped.
    if (d && d.spec && Date.now() - d.at < 14 * 864e5) return d.spec;
    localStorage.removeItem(key);
  } catch {}
  return null;
}

const FILE_FIELDS = SPEC_SECTIONS.flatMap(sec => sec.fields).filter(f => f.type === 'files');

// Detail fields of a spec form: "Other" pickers and fields that only apply to some lights (bulb vs LED, dimming…).
export function wireSpecFields(form, spec, template) {
  const refresh = () => {
    const cur = readSpec(form, spec);
    SPEC_SECTIONS.forEach(sec => sec.fields.forEach(f => {
      const wrap = $(`[data-field="${f.key}"]`, form);
      const unused = templateShow(template, f.key) === 'off' && !cur[f.key];
      if (wrap) wrap.hidden = !visible(f, cur) || unused;
      if (typeof f.list === 'function') {
        const sel = form.elements[`${f.key}__pick`];
        if (sel) {
          const typing = sel.value === '__other';
          sel.innerHTML = pickOptions(f.list(cur), cur[f.key]);
          if (typing && !cur[f.key]) sel.value = '__other';
          else setPick(form, f.key, cur[f.key] || '');
        }
      }
    }));
  };
  form.addEventListener('change', e => {
    const t = e.target;
    if (t.name && t.name.endsWith('__pick')) {
      const key = t.name.slice(0, -6);
      const box = form.elements[key];
      if (t.value === '__other') {
        box.hidden = false;
        if ([...t.options].some(o => o.value === box.value)) box.value = '';
        box.focus();
      } else {
        box.hidden = true;
        box.value = t.value;
      }
    }
    refresh();
  });
}

export function readSpec(form, base, bag) {
  const out = { ...base, _show: { ...(base._show || {}) } };
  SPEC_SECTIONS.forEach(sec => sec.fields.forEach(f => {
    const el = form.elements[f.key];
    if (f.type === 'files') {
      if (bag) out[f.key] = (bag[`file_${f.key}`] || []).map(id => store.get('attachments', id)).filter(Boolean)
        .map(a => ({ id: a.id, name: a.name, path: a.path, mime: a.mime }));
    } else if (el) out[f.key] = String(el.value || '').trim();
    const c = form.elements[`vis_c_${f.key}`], sp = form.elements[`vis_s_${f.key}`];
    if (c && sp) out._show[f.key] = c.checked && sp.checked ? 'cs' : c.checked ? 'c' : sp.checked ? 's' : 'none';
  }));
  return out;
}

export function openSpecSheet(it) {
  const p = store.get('projects', it.project_id);
  if (!p) return;
  const template = templateOf(p);
  // Unsaved typing survives the app being reloaded (e.g. iPad freeing memory after using the camera).
  const draftKey = `spec-draft:${it.id}`;
  const draft = readDraft(draftKey);
  // A new spec starts empty — only what you choose gets filled in.
  const spec = draft ? { ...draft } : { ...defaultSpec(), ...(it.spec || {}) };
  const latest = latestVersion(it.id);
  const bag = {};
  IMAGE_GROUPS.forEach(g => { bag[`img_${g.id}`] = [...((spec._images || {})[g.id] || [])]; });
  FILE_FIELDS.forEach(f => { bag[`file_${f.key}`] = (Array.isArray(spec[f.key]) ? spec[f.key] : []).map(a => a.id); });
  let stopDraft = () => {};
  openSheet(`
    <form class="spec-form">
      ${sheetHeader(`Spec — ${it.name}`)}
      <div class="fields">
        <p class="muted small">${p.order_no ? `Order ${esc(p.order_no)} · ` : ''}Item ${esc(itemNo(it))} · ${esc(it.name)} × ${esc(String(Number(it.quantity) || 1))}${it.supplier ? ` · ${esc(it.supplier)}` : ''} — name, item no., quantity and supplier are set on the product.
          ${latest ? `Last issued: <b>v${latest.version_no}</b>. Changes you save here stay a draft until you issue v${latest.version_no + 1}.` : 'This is a draft until you issue v1.'}</p>
        ${draft ? `<p class="notice warn">Your unsaved changes from before were restored. <button type="button" class="btn small" data-discard-draft>Discard them</button></p>` : ''}
        <p class="muted small">Tick <b>Client</b> / <b>Supplier</b> to choose what appears on each party's specification card. Empty details never appear.</p>
        <details class="spec-sec" open>
          <summary>Pictures</summary>
          <div class="spec-images">${IMAGE_GROUPS.map(g => `
            <div class="spec-img-group"><b>${esc(g.label)}</b> <span class="muted small">${esc(g.hint)}</span>
              ${photoPicker(`img_${g.id}`, 'Add images', true)}</div>`).join('')}
            <p class="muted small">The outcome pictures come from the final and packing inspections.</p>
          </div>
        </details>
        ${SPEC_SECTIONS.map((sec, i) => `
          <details class="spec-sec" ${i < 1 ? 'open' : ''}>
            <summary>${esc(sec.title)}</summary>
            <div class="spec-grid">${sec.fields.map(f => fieldHtml(f, spec, template)).join('')}</div>
          </details>`).join('')}
      </div>
      <footer>
        <span class="spacer"></span>
        <button type="submit" class="btn primary" data-issue style="order:2">Save &amp; issue v${latest ? latest.version_no + 1 : 1}…</button>
        <button type="button" class="btn" data-close style="order:0">Cancel</button>
        <button type="submit" class="btn" style="order:1">Save draft</button>
      </footer>
    </form>`, {
    wide: true,
    onOpen(sheet) {
      const form = $('form', sheet);
      wirePhotos(sheet, { project_id: it.project_id, item_id: it.id }, bag, { removable: true, images: true });
      wireSpecFields(form, spec, template);
      const keepDraft = () => {
        const cur = readSpec(form, spec, bag);
        cur._images = Object.fromEntries(IMAGE_GROUPS.map(g => [g.id, bag[`img_${g.id}`] || []]));
        try { localStorage.setItem(draftKey, JSON.stringify({ at: Date.now(), spec: cur })); } catch {}
      };
      if (draft) sheet.dataset.dirty = '1';
      bag.onChange = () => { sheet.dataset.dirty = '1'; keepDraft(); };
      form.addEventListener('input', keepDraft);
      const timer = setInterval(() => { if (sheet.dataset.dirty) keepDraft(); }, 3000);
      stopDraft = () => clearInterval(timer);
      $('[data-discard-draft]', form)?.addEventListener('click', () => {
        try { localStorage.removeItem(draftKey); } catch {}
        delete sheet.dataset.dirty;
        openSpecSheet(store.get('items', it.id));
      });
      form.addEventListener('change', keepDraft);
    },
    onClose() {
      stopDraft();
      try { localStorage.removeItem(draftKey); } catch {}
    },
    async onSubmit(fd, form, submitter) {
      const next = readSpec(form, spec, bag);
      next._images = Object.fromEntries(IMAGE_GROUPS.map(g => [g.id, bag[`img_${g.id}`] || []]));
      try { await store.update('items', it.id, { spec: next }); } catch (err) { return false; }
      if (submitter && submitter.hasAttribute('data-issue')) setTimeout(() => openIssueVersionSheet(store.get('items', it.id)), 50);
      else toast('Spec draft saved');
    },
  });
}

// ---------- Issue a version (permanent) ----------

function diffHtml(changes) {
  return `<table class="qc-diff"><tbody>${changes.map(c => `
    <tr><th>${esc(c.label)}</th><td><s>${esc(c.from || '—')}</s></td><td>→</td><td><b>${esc(c.to || '—')}</b></td></tr>`).join('')}</tbody></table>`;
}

export function openIssueVersionSheet(it) {
  if (!it) return;
  const latest = latestVersion(it.id);
  const snap = snapshot(it);
  const changes = latest ? specDiff(latest.spec, snap) : [];
  const n = latest ? latest.version_no + 1 : 1;
  if (latest && !changes.length) { toast(`Nothing changed since v${latest.version_no}`); return; }
  const reqs = openRequests(it.project_id).filter(r => r.item_id === it.id);
  openSheet(`
    <form>
      ${sheetHeader(`Issue spec v${n} — ${it.name}`)}
      <div class="fields">
        ${latest ? `<p><b>Change request</b>: ${changes.length} change${changes.length === 1 ? '' : 's'} compared with v${latest.version_no}.</p>${diffHtml(changes)}
          <p class="muted small">Approvals of v${latest.version_no} don't carry over: v${n} needs approval from us, the supplier and the client again.</p>`
          : `<p>v1 becomes the reference: we approve it, the supplier confirms it, the client approves it, and every inspection checks against it.</p>`}
        ${reqs.length ? `<label class="field"><span>Answers change request</span><select name="request_id"><option value="">—</option>${reqs.map(r => `<option value="${r.id}" selected>${esc(r.party === 'us' ? 'Us' : r.party === 'client' ? 'Client' : 'Supplier')}: ${esc(r.description.slice(0, 80))}</option>`).join('')}</select></label>` : ''}
        ${latest ? `
          <div class="field-row">
            <label class="field"><span>Requested by</span><select name="requested_by">${options(RESPONSIBLE.slice(0, 3), 'client')}</select></label>
          </div>
          <label class="field"><span>Reason for the change</span><textarea name="change_reason" rows="2" required placeholder="e.g. Client asked for 2700K instead of 3000K (email 12 Oct)"></textarea></label>` : ''}
        <p class="notice small">🔒 Once issued, v${n} is permanent — it can't be edited or deleted.</p>
      </div>
      <footer><span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">Issue v${n}</button></footer>
    </form>`, {
    async onSubmit(fd) {
      const reason = String(fd.get('change_reason') || '').trim();
      if (latest && !reason) { toast('Write the reason for the change'); return false; }
      let v;
      const requestId = fd.get('request_id') || null;
      try {
        v = await store.insert('spec_versions', {
          project_id: it.project_id, item_id: it.id, item_name: it.name, spec: snap,
          change_reason: reason, requested_by: latest ? fd.get('requested_by') : '', request_id: requestId,
        });
      } catch (err) { return false; }
      if (requestId) store.insert('qc_request_updates', { project_id: it.project_id, request_id: requestId, status: 'done', note: `Issued as spec v${v.version_no || n}` }).catch(() => {});
      toast(`Spec v${v.version_no || n} issued — get it approved`, { label: 'Spec card PDF', run: () => makeQcPdf('card', it.id, 'client') });
    },
  });
}

// ---------- Versions (read only) ----------

function versionHtml(v, prev) {
  const changes = prev ? specDiff(prev.spec, v.spec) : [];
  const appr = approvalsOf(v.id);
  return `
    <div class="qc-version">
      <p class="small">Issued ${stamp(v)}${v.change_reason ? `<br>Reason: “${esc(v.change_reason)}”${v.requested_by ? ` (requested by ${esc(label(RESPONSIBLE, v.requested_by).toLowerCase())})` : ''}` : ''}</p>
      ${appr.length ? `<ul class="qc-approvals small">${appr.map(a => `<li>${decisionText(a, a.party)}${a.note ? ` — “${esc(a.note)}”` : ''}${a.files && a.files.length ? ` · ${a.files.length} proof file${a.files.length === 1 ? '' : 's'}` : ''}</li>`).join('')}</ul>` : '<p class="small muted">No approvals recorded.</p>'}
      ${changes.length ? `<h4>Changes from v${prev.version_no}</h4>${diffHtml(changes)}` : ''}
      ${specRows(v.spec).map(sec => `
        <h4>${esc(sec.title)}</h4>
        <dl class="facts">${sec.rows.map(([k, val]) => `<dt>${esc(k)}</dt><dd>${esc(val)}</dd>`).join('')}</dl>
        ${sec.lines.length ? `<ol class="small">${sec.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ol>` : ''}`).join('')}
    </div>`;
}

function openVersionsSheet(it) {
  const vs = versionsOf(it.id);
  if (!vs.length) return;
  let cur = vs.length - 1;
  openSheet(`
    <div>
      ${sheetHeader(`Spec versions — ${it.name}`)}
      <div class="fields">
        <div class="segmented qc-vtabs">${vs.map((v, i) => `<button type="button" data-v="${i}" aria-pressed="${i === cur}">v${v.version_no}</button>`).join('')}</div>
        <div id="qc-version-body">${versionHtml(vs[cur], vs[cur - 1])}</div>
      </div>
      <footer>
        <button type="button" class="btn" data-pdf="client">Client spec card PDF</button>
        <button type="button" class="btn" data-pdf="supplier">Supplier spec card PDF</button>
        <span class="spacer"></span><button type="button" class="btn primary" data-close>Close</button>
      </footer>
    </div>`, {
    wide: true,
    onOpen(sheet) {
      $$('[data-v]', sheet).forEach(b => b.addEventListener('click', () => {
        cur = Number(b.dataset.v);
        $$('[data-v]', sheet).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        $('#qc-version-body', sheet).innerHTML = versionHtml(vs[cur], vs[cur - 1]);
      }));
      $$('[data-pdf]', sheet).forEach(b => b.addEventListener('click', () => makeQcPdf('version', vs[cur].id, b.dataset.pdf)));
    },
  });
}

// ---------- Photos / proof inside QC sheets (uploaded at once, permanent) ----------

export function photoPicker(name, labelText = 'Add photos', imagesOnly = false) {
  return `<div class="qc-photos" data-photos="${name}"><div class="qc-thumbs"></div>
    <label class="btn small upload-btn">${icon.upload}<span>${esc(labelText)}</span><input type="file" multiple hidden accept="${imagesOnly ? 'image/*' : 'image/*,application/pdf,video/*'}" data-qc-photos="${name}"></label></div>`;
}

// Uploads go straight into permanent QC storage; `removable` only takes a picture off this list.
export function wirePhotos(dialog, target, bag, { removable = false } = {}) {
  const sheet = dialog.firstElementChild; // the dialog itself is reused by every sheet
  const draw = name => {
    const box = $(`[data-photos="${name}"] .qc-thumbs`, sheet);
    if (!box) return;
    box.innerHTML = (bag[name] || []).map(id => {
      const a = store.get('attachments', id);
      if (!a) return '';
      const t = /^image\//.test(a.mime) ? `<img class="qc-thumb" data-path="${esc(a.path)}" alt="">` : `<span class="qc-thumb file">${esc((a.name.split('.').pop() || 'file').toUpperCase())}</span>`;
      return removable ? `<span class="qc-thumb-wrap">${t}<button type="button" class="qc-thumb-x" data-remove="${esc(name)}" data-id="${a.id}" aria-label="Remove">×</button></span>` : t;
    }).join('');
  };
  sheet.addEventListener('click', e => {
    const x = e.target.closest('[data-remove]');
    if (!x) return;
    bag[x.dataset.remove] = (bag[x.dataset.remove] || []).filter(id => id !== x.dataset.id);
    draw(x.dataset.remove);
  });
  sheet.addEventListener('change', async e => {
    const input = e.target.closest('[data-qc-photos]');
    if (!input || !input.files.length) return;
    e.stopPropagation();
    const name = input.dataset.qcPhotos;
    const files = [...input.files];
    input.value = '';
    const btn = input.closest('.upload-btn');
    btn && btn.classList.add('busy');
    try {
      const saved = await uploadFiles(files, { ...target, kind: 'qc' });
      bag[name] = [...(bag[name] || []), ...saved.map(a => a.id)];
      draw(name);
      bag.onChange && bag.onChange();
    } finally { btn && btn.classList.remove('busy'); }
  });
  Object.keys(bag).forEach(k => typeof bag[k] !== 'function' && draw(k));
  return draw;
}

export const thumbs = ids => (ids || []).map(id => store.get('attachments', id)).filter(Boolean).map(a => `
  <button type="button" class="qc-thumb-btn" data-action="open-file" data-id="${a.id}">${/^image\//.test(a.mime) ? `<img class="qc-thumb" data-path="${esc(a.path)}" alt="">` : `<span class="qc-thumb file">${esc((a.name.split('.').pop() || 'file').toUpperCase())}</span>`}</button>`).join('');

// ---------- Client approval / supplier confirmation (permanent) ----------

function openApprovalSheet(it, party) {
  const v = latestVersion(it.id);
  if (!v) { toast('Issue the spec first'); return; }
  const client = party === 'client';
  const internal = party === 'internal';
  const p = store.get('projects', it.project_id);
  const c = p && store.get('clients', p.client_id);
  const myName = (me() || {}).full_name || '';
  const bag = { proof: [] };
  openSheet(`
    <form>
      ${sheetHeader(`${client ? 'Client approval' : internal ? 'Our approval' : 'Supplier confirmation'} — ${it.name} v${v.version_no}`)}
      <div class="fields">
        <div class="segmented qc-decision">
          <label><input type="radio" name="decision" value="approved" checked> ${client || internal ? 'Approved' : 'Confirmed — will make it exactly as specified'}</label>
          <label><input type="radio" name="decision" value="rejected"> ${client || internal ? 'Not approved / changes needed' : 'Can’t make it as specified'}</label>
        </div>
        <div class="field-row">
          <label class="field"><span>${client ? 'Approved by (name)' : internal ? 'Approved by' : 'Confirmed by (name at supplier)'}</span><input name="person" required value="${client && c ? esc(c.name || '') : internal ? esc(myName) : esc(it.supplier || '')}"></label>
          <label class="field"><span>How</span><select name="method">${(internal ? ['In the app', ...METHODS] : METHODS).map(m => `<option>${esc(m)}</option>`).join('')}</select></label>
        </div>
        <label class="field"><span>Note ${client ? '' : '(what they can’t do, if anything)'}</span><textarea name="note" rows="2" placeholder="${client ? 'e.g. Approved by email 13 Oct, see attachment' : 'e.g. Glass only available in 4 mm, not 5 mm'}"></textarea></label>
        <div class="field"><span>Proof (email screenshot, signed PDF…)</span>${photoPicker('proof', 'Add proof')}</div>
        <p class="notice small">🔒 This record is permanent and saved with your name and the time.</p>
      </div>
      <footer><span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">Save</button></footer>
    </form>`, {
    onOpen(sheet) { wirePhotos(sheet, { project_id: it.project_id, item_id: it.id }, bag); },
    async onSubmit(fd) {
      const decision = fd.get('decision');
      const note = String(fd.get('note') || '').trim();
      if (decision === 'rejected' && !note) { toast('Write what needs to change'); return false; }
      try {
        await store.insert('qc_approvals', {
          project_id: it.project_id, item_id: it.id, version_id: v.id, party, decision,
          person: String(fd.get('person') || '').trim(), method: fd.get('method'), note, files: bag.proof,
        });
      } catch (err) { return false; }
      toast(decision === 'approved' ? (client ? 'Client approval recorded' : internal ? 'Our approval recorded' : 'Supplier confirmation recorded') : 'Recorded — update the spec and issue a new version');
    },
  });
}

// ---------- Inspection (checklist; permanent once saved) ----------

const draftKey = (itemId, stage) => `qc-inspection:${itemId}:${stage}`;
const loadDraft = key => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } };
const saveDraft = (key, d) => { try { localStorage.setItem(key, JSON.stringify(d)); } catch (e) { /* ignore */ } };
const dropDraft = key => { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } };

export function openInspectionSheet(it, stage = null) {
  const p = store.get('projects', it.project_id);
  const v = latestVersion(it.id);
  if (!v && !Object.keys(it.spec || {}).length) {
    toast('Fill in the spec first — the inspection checklist is made from it');
    openSpecSheet(it);
    return;
  }
  if (!stage) {
    const passed = stg => inspectionsOf(it.id).some(i => i.stage === stg && i.outcome === 'pass' && (!v || i.version_id === v.id));
    stage = !v ? 'sample'
      : p && ['shipping', 'delivered'].includes(p.stage) ? 'delivery'
      : passed('final') ? 'packing'
      : 'final';
  }
  const spec = v ? v.spec : snapshot(it);
  const lines = checklist(spec, stage);
  const key = draftKey(it.id, stage);
  const d = loadDraft(key) || {};
  const res = {};
  lines.forEach(l => { res[l.key] = { result: '', measured: '', note: '', photos: [], ...(d.res && d.res[l.key]) }; });
  const bag = { overall: d.overall || [] };
  lines.forEach(l => { bag[`l_${l.key}`] = res[l.key].photos; });

  openSheet(`
    <form class="qc-inspect">
      ${sheetHeader(`Inspection — ${it.name}`)}
      <div class="fields">
        ${v ? `<p class="small">Checking against <b>spec v${v.version_no}</b> (issued ${esc(when(v.created_at))}).</p>`
          : `<p class="notice warn small">No spec has been issued yet — this checks against the current draft. Issue v1 first for a proper reference.</p>`}
        <div class="field-row three">
          <label class="field"><span>Stage</span><select name="stage">${options(QC_STAGES, stage)}</select></label>
          <label class="field"><span>Inspected by</span><select name="inspector">${options(INSPECTORS, d.inspector || 'supplier')}</select></label>
          <label class="field"><span>Name</span><input name="inspector_name" value="${esc(d.inspector_name || '')}" placeholder="person / company"></label>
        </div>
        <div class="field-row">
          <label class="field"><span>Inspection date</span><input type="date" name="inspected_on" value="${esc(d.inspected_on || todayStr())}"></label>
          <label class="field"><span>Units checked</span><input name="units_checked" inputmode="decimal" value="${esc(d.units_checked || String(Number(it.quantity) || 1))}"></label>
        </div>
        <h3 class="sheet-sub">Checklist (${lines.length})</h3>
        <div class="qc-checklist">
          ${lines.length ? '' : '<p class="muted small">No checks for this stage yet — fill in more of the spec, or choose another stage.</p>'}
          ${lines.map(l => {
            const r = res[l.key];
            return `
            <div class="qc-check" data-key="${esc(l.key)}">
              <div class="qc-check-text"><b>${esc(l.label)}</b>${l.expected ? `<span class="muted small">Spec: ${esc(l.expected)}</span>` : ''}${l.photo ? '<span class="small warn-text">📷 Photo required</span>' : ''}</div>
              <div class="segmented qc-result">
                ${[['pass', 'Pass'], ['fail', 'Fail'], ['na', 'N/A']].map(([val, t]) => `<label class="r-${val}"><input type="radio" name="r_${esc(l.key)}" value="${val}" ${r.result === val ? 'checked' : ''}> ${t}</label>`).join('')}
              </div>
              <div class="qc-check-extra">
                ${l.measure ? `<input name="m_${esc(l.key)}" value="${esc(r.measured)}" placeholder="Measured" autocomplete="off">` : ''}
                <input name="n_${esc(l.key)}" value="${esc(r.note)}" placeholder="Note" autocomplete="off">
                ${photoPicker(`l_${l.key}`, 'Photo')}
              </div>
            </div>`;
          }).join('')}
        </div>
        <h3 class="sheet-sub">Overall photos &amp; videos</h3>
        ${photoPicker('overall', 'Add photos / videos')}
        <label class="field"><span>Notes</span><textarea name="notes" rows="2">${esc(d.notes || '')}</textarea></label>
        <label class="check-line"><input type="checkbox" name="make_issues" checked> Report an issue for every failed check</label>
        <p class="notice small">🔒 When saved, this report is permanent. Your answers are kept on this device until then.</p>
      </div>
      <footer><span class="spacer"></span><button type="button" class="btn" data-close>Close</button><button type="submit" class="btn primary">Save inspection</button></footer>
    </form>`, {
    wide: true,
    onOpen(sheet) {
      const form = $('form', sheet);
      const collect = () => {
        lines.forEach(l => {
          const r = res[l.key];
          const checked = form.querySelector(`[name="r_${CSS.escape(l.key)}"]:checked`);
          r.result = checked ? checked.value : '';
          const m = form.elements[`m_${l.key}`];
          r.measured = m ? m.value.trim() : '';
          r.note = form.elements[`n_${l.key}`].value.trim();
          r.photos = bag[`l_${l.key}`] || [];
          $(`.qc-check[data-key="${CSS.escape(l.key)}"]`, form).dataset.result = r.result;
        });
        saveDraft(key, {
          res, overall: bag.overall, inspector: form.elements.inspector.value, inspector_name: form.elements.inspector_name.value,
          inspected_on: form.elements.inspected_on.value, units_checked: form.elements.units_checked.value, notes: form.elements.notes.value,
        });
      };
      bag.onChange = collect;
      wirePhotos(sheet, { project_id: it.project_id, item_id: it.id }, bag);
      form.addEventListener('input', collect);
      form.addEventListener('change', e => {
        if (e.target.name === 'stage') { collect(); setTimeout(() => openInspectionSheet(store.get('items', it.id), e.target.value), 0); return; }
        collect();
      });
      collect();
    },
    async onSubmit(fd, form) {
      const missing = lines.filter(l => !res[l.key].result);
      if (missing.length) {
        toast(`${missing.length} check${missing.length === 1 ? '' : 's'} not answered yet`);
        const el = $(`.qc-check[data-key="${CSS.escape(missing[0].key)}"]`, form);
        el && el.scrollIntoView({ block: 'center' });
        return false;
      }
      const failed = lines.filter(l => res[l.key].result === 'fail');
      const unexplained = failed.filter(l => !res[l.key].note && !res[l.key].measured && !res[l.key].photos.length);
      if (unexplained.length) { toast('Add a note or photo to each failed check'); return false; }
      const noPhoto = lines.filter(l => l.photo && res[l.key].result !== 'na' && !res[l.key].photos.length);
      if (noPhoto.length) {
        toast(`Add a photo to “${noPhoto[0].label}”`);
        const el = $(`.qc-check[data-key="${CSS.escape(noPhoto[0].key)}"]`, form);
        el && el.scrollIntoView({ block: 'center' });
        return false;
      }
      const allPhotos = [...bag.overall, ...lines.flatMap(l => res[l.key].photos)];
      const st = fd.get('stage');
      if (['final', 'packing', 'delivery'].includes(st) && !allPhotos.length) { toast('Add at least one photo — it is your proof'); return false; }
      let insp;
      try {
        insp = await store.insert('qc_inspections', {
          project_id: it.project_id, item_id: it.id, item_name: it.name, version_id: v ? v.id : null,
          stage: st, inspector: fd.get('inspector'), inspector_name: String(fd.get('inspector_name') || '').trim(),
          inspected_on: fd.get('inspected_on') || null, units_checked: Number(String(fd.get('units_checked')).replace(',', '.')) || null,
          results: lines.map(l => ({ key: l.key, label: l.label, expected: l.expected, ...res[l.key] })),
          photos: bag.overall, outcome: failed.length ? 'fail' : 'pass', notes: String(fd.get('notes') || '').trim(),
        });
      } catch (err) { return false; }
      dropDraft(key);
      if (failed.length && fd.get('make_issues') === 'on') {
        for (const l of failed) {
          const r = res[l.key];
          await store.insert('qc_issues', {
            project_id: it.project_id, item_id: it.id, item_name: it.name, inspection_id: insp.id,
            title: l.label.replace(/^Special request: /, 'Request: ').slice(0, 140), expected: l.expected,
            found: [r.measured && `Measured: ${r.measured}`, r.note].filter(Boolean).join(' — '),
            severity: 'major', responsible: 'supplier', photos: r.photos,
          }).catch(() => {});
        }
      }
      toast(failed.length ? `Inspection saved — ${failed.length} failed check${failed.length === 1 ? '' : 's'}` : 'Inspection saved — all passed ✅',
        { label: 'QC report PDF', run: () => makeQcPdf('inspection', insp.id) });
      if (st === 'packing' && !failed.length) toast('Packed & ready for collection ✅', { label: 'QC report PDF', run: () => makeQcPdf('inspection', insp.id) });
    },
  });
}

function openInspectionView(insp) {
  const ver = store.get('spec_versions', insp.version_id);
  const issues = store.all('qc_issues').filter(i => i.inspection_id === insp.id);
  const r = insp.results || [];
  openSheet(`
    <div>
      ${sheetHeader(`${label(QC_STAGES, insp.stage)} inspection — ${insp.item_name}`)}
      <div class="fields">
        <p class="small">${chip(insp.outcome === 'pass' ? 'PASS' : 'FAIL', insp.outcome === 'pass' ? 'good' : 'bad')}
          ${esc(label(INSPECTORS, insp.inspector))}${insp.inspector_name ? ` (${esc(insp.inspector_name)})` : ''} · inspected ${esc(fmtDate(insp.inspected_on))}${insp.units_checked ? ` · ${esc(String(insp.units_checked))} units` : ''}
          · against ${ver ? `spec v${ver.version_no}` : 'the draft spec'}</p>
        <p class="muted small">🔒 Saved ${stamp(insp)} — permanent record.</p>
        <table class="qc-results"><tbody>${r.map(x => `
          <tr class="res-${esc(x.result)}"><td>${x.result === 'pass' ? '✅' : x.result === 'fail' ? '❌' : '—'}</td>
            <td><b>${esc(x.label)}</b>${x.expected ? `<br><span class="muted small">Spec: ${esc(x.expected)}</span>` : ''}${x.measured ? `<br><span class="small">Measured: ${esc(x.measured)}</span>` : ''}${x.note ? `<br><span class="small">${esc(x.note)}</span>` : ''}
            ${x.photos && x.photos.length ? `<div class="qc-thumbs">${thumbs(x.photos)}</div>` : ''}</td></tr>`).join('')}</tbody></table>
        ${insp.photos && insp.photos.length ? `<h4>Photos</h4><div class="qc-thumbs">${thumbs(insp.photos)}</div>` : ''}
        ${insp.notes ? `<h4>Notes</h4><p class="prewrap">${esc(insp.notes)}</p>` : ''}
        ${issues.length ? `<h4>Issues reported</h4><div class="qc-rows">${issues.map(issueRow).join('')}</div>` : ''}
      </div>
      <footer><span class="spacer"></span><button type="button" class="btn" data-close>Close</button><button type="button" class="btn primary" data-pdf>QC report PDF</button></footer>
    </div>`, {
    wide: true,
    onOpen(sheet) {
      $('[data-pdf]', sheet).addEventListener('click', () => makeQcPdf('inspection', insp.id));
      wireSheetActions(sheet);
    },
  });
}

// ---------- Issues (the issue is permanent; progress is added as updates) ----------

function openNewIssueSheet(pid, itemId = null) {
  const lights = lightingOf(pid);
  const bag = { photos: [] };
  openSheet(`
    <form>
      ${sheetHeader('Report an issue')}
      <div class="fields">
        <label class="field"><span>Product</span><select name="item_id"><option value="">Whole order</option>${lights.map(i => `<option value="${i.id}" ${i.id === itemId ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}</select></label>
        <label class="field"><span>What's wrong (short)</span><input name="title" required placeholder="e.g. Wrong finish — polished instead of satin brass"></label>
        <div class="field-row">
          <label class="field"><span>Should be (spec)</span><input name="expected" placeholder="e.g. Satin brass, sample #B-12"></label>
          <label class="field"><span>Found</span><input name="found" placeholder="e.g. Polished brass on 4 of 12 units"></label>
        </div>
        <label class="field"><span>Details</span><textarea name="description" rows="2"></textarea></label>
        <div class="field-row three">
          <label class="field"><span>Severity</span><select name="severity">${options(SEVERITIES, 'major')}</select></label>
          <label class="field"><span>Responsible</span><select name="responsible">${options(RESPONSIBLE, 'supplier')}</select></label>
          <label class="field"><span>Fix by</span><input type="date" name="due_date"></label>
        </div>
        <label class="field"><span>Required action</span><input name="required_action" placeholder="e.g. Refinish 4 units at supplier's cost, send photos before shipping"></label>
        <div class="field"><span>Photos</span>${photoPicker('photos')}</div>
        <p class="notice small">🔒 Issues are permanent. Progress is added as updates.</p>
      </div>
      <footer><span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">Report issue</button></footer>
    </form>`, {
    onOpen(sheet) { wirePhotos(sheet, { project_id: pid, item_id: itemId }, bag); },
    async onSubmit(fd) {
      const item = store.get('items', fd.get('item_id'));
      let issue;
      try {
        issue = await store.insert('qc_issues', {
          project_id: pid, item_id: item ? item.id : null, item_name: item ? item.name : '',
          title: String(fd.get('title')).trim(), expected: String(fd.get('expected') || '').trim(), found: String(fd.get('found') || '').trim(),
          description: String(fd.get('description') || '').trim(), severity: fd.get('severity'), responsible: fd.get('responsible'),
          due_date: fd.get('due_date') || null, required_action: String(fd.get('required_action') || '').trim(), photos: bag.photos,
        });
      } catch (err) { return false; }
      toast(`Issue #${issue.number || ''} reported`, { label: 'Issue report PDF', run: () => makeQcPdf('issue', issue.id) });
    },
  });
}

function openIssueView(issue) {
  const ups = updatesOf(issue.id);
  const s = issueStatus(issue);
  const bag = { photos: [] };
  openSheet(`
    <form>
      ${sheetHeader(`Issue #${issue.number} — ${issue.title}`)}
      <div class="fields">
        <p class="small">${chip(esc(label(ISSUE_STATUSES, s)), RESOLVED.includes(s) ? 'good' : 'bad')} ${esc(label(SEVERITIES, issue.severity))} · responsible: ${esc(label(RESPONSIBLE, issue.responsible))}${issue.item_name ? ` · ${esc(issue.item_name)}` : ''}${issue.due_date ? ` · fix by ${esc(fmtDate(issue.due_date))}` : ''}</p>
        <dl class="facts">
          ${issue.expected ? `<dt>Should be</dt><dd>${esc(issue.expected)}</dd>` : ''}
          ${issue.found ? `<dt>Found</dt><dd>${esc(issue.found)}</dd>` : ''}
          ${issue.description ? `<dt>Details</dt><dd class="prewrap">${esc(issue.description)}</dd>` : ''}
          ${issue.required_action ? `<dt>Required action</dt><dd>${esc(issue.required_action)}</dd>` : ''}
        </dl>
        ${issue.photos && issue.photos.length ? `<div class="qc-thumbs">${thumbs(issue.photos)}</div>` : ''}
        <p class="muted small">🔒 Reported ${stamp(issue)}</p>
        <h4>Updates</h4>
        ${ups.length ? `<div class="qc-history">${ups.map(u => `
          <div class="qc-hist"><span class="muted small">${esc(when(u.created_at))} · ${esc(who(u.created_by))}</span>
            <span><b>${esc(label(ISSUE_STATUSES, u.status))}</b>${u.note ? ` — ${esc(u.note)}` : ''}${u.cost ? ` · cost ${esc(String(u.cost))}${u.paid_by ? ` paid by ${esc(u.paid_by)}` : ''}` : ''}</span>
            ${u.photos && u.photos.length ? `<div class="qc-thumbs">${thumbs(u.photos)}</div>` : ''}</div>`).join('')}</div>` : '<p class="muted small">No updates yet.</p>'}
        <h4>Add an update</h4>
        <div class="field-row">
          <label class="field"><span>Status</span><select name="status">${options(ISSUE_STATUSES, s === 'open' ? 'fixing' : s)}</select></label>
          <label class="field"><span>Cost of the fix</span><input name="cost" inputmode="decimal" placeholder="optional"></label>
        </div>
        <div class="field-row">
          <label class="field"><span>Note</span><input name="note" placeholder="e.g. Supplier refinished 4 units, photos attached"></label>
          <label class="field"><span>Paid by</span><select name="paid_by"><option value="">—</option>${RESPONSIBLE.map(r => `<option>${esc(r.label)}</option>`).join('')}</select></label>
        </div>
        ${photoPicker('photos')}
      </div>
      <footer>
        <button type="button" class="btn" data-pdf>Issue report PDF</button>
        <span class="spacer"></span><button type="button" class="btn" data-close>Close</button><button type="submit" class="btn primary">Add update</button>
      </footer>
    </form>`, {
    wide: true,
    onOpen(sheet) {
      wirePhotos(sheet, { project_id: issue.project_id, item_id: issue.item_id }, bag);
      $('[data-pdf]', sheet).addEventListener('click', () => makeQcPdf('issue', issue.id));
      wireSheetActions(sheet);
    },
    async onSubmit(fd) {
      const note = String(fd.get('note') || '').trim();
      if (!note && !bag.photos.length && fd.get('status') === s) { toast('Write a note or change the status'); return false; }
      try {
        await store.insert('qc_issue_updates', {
          project_id: issue.project_id, issue_id: issue.id, status: fd.get('status'), note,
          cost: fd.get('cost') ? Number(String(fd.get('cost')).replace(',', '.')) || null : null, paid_by: fd.get('paid_by') || '', photos: bag.photos,
        });
      } catch (err) { return false; }
      toast('Update added');
      setTimeout(() => { const fresh = store.get('qc_issues', issue.id); if (fresh) openIssueView(fresh); }, 50);
      return false;
    },
  });
}

// Taps inside QC sheets (issue rows) — the app-wide handler only covers the main screen.
export function wireSheetActions(dialog) {
  dialog.firstElementChild.addEventListener('click', e => {
    const el = e.target.closest('[data-action^="qc-"]');
    if (el) qcAction(el.dataset.action, el);
  });
}

// ---------- PDFs ----------

export function makeQcPdf(kind, id, party) {
  return import('../qc-pdf.js').then(m => m.createQcPdf(kind, id, party));
}

// ---------- Actions (from the screen) ----------

export function qcAction(action, el) {
  const id = el.dataset.id;
  const item = () => store.get('items', id);
  switch (action) {
    case 'qc-spec': { const it = item(); if (it) openSpecSheet(it); break; }
    case 'qc-issue-version': { const it = item(); if (it) openIssueVersionSheet(it); break; }
    case 'qc-approval': { const it = item(); if (it) openApprovalSheet(it, el.dataset.party); break; }
    case 'qc-versions': { const it = item(); if (it) openVersionsSheet(it); break; }
    case 'qc-inspect': { const it = item(); if (it) openInspectionSheet(it); break; }
    case 'qc-view-inspection': { const i = store.get('qc_inspections', id); if (i) openInspectionView(i); break; }
    case 'qc-new-issue': { const it = item(); openNewIssueSheet(it ? it.project_id : el.dataset.project, it ? it.id : null); break; }
    case 'qc-view-issue': { const i = store.get('qc_issues', id); if (i) openIssueView(i); break; }
    case 'qc-make-lighting': store.update('items', id, { category: 'lighting' }).catch(() => {}); break;
    case 'qc-card-pdf': makeQcPdf('card', id, el.dataset.party); break;
    case 'qc-cards-pdf': makeQcPdf('cards', id, el.dataset.party); break;
    case 'qc-order-no': {
      const p = store.get('projects', id);
      if (p) store.update('projects', id, { order_no: nextOrderNo(p.company_id) }).then(() => toast('Order number added')).catch(() => {});
      break;
    }
    default: moreAction(action, el);
  }
}

