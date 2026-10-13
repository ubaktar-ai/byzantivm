// Quality control, part 2: samples (with tracking), change requests, photos sent in through links,
// supplier/client links, the per-company report template, and the specification cards screen.
import { esc, icon, todayStr, fmtDate, toast, openSheet, sheetHeader, options, label, $ } from '../lib.js';
import { store, productsOf } from '../store.js';
import { SPEC_SECTIONS, SHOW_OPTIONS, templateShow, specRows, IMAGE_GROUPS } from '../qc-spec.js';
import {
  byCreated, chip, stamp, when, who, thumbs, photoPicker, wirePhotos, wireSheetActions, lightingOf, latestVersion,
  inspectionsOf, viewSpec, itemNo, lastDecision, templateOf, openSpecSheet, decisionText, specState,
} from './qc.js';
import { CARRIERS, trackingUrl } from './shipping.js';

// ---------- Samples ----------

export const SAMPLE_STATUSES = [
  { id: 'sent', label: 'Sent' }, { id: 'received', label: 'Received by client' },
  { id: 'approved', label: 'Approved' }, { id: 'rejected', label: 'Rejected' }, { id: 'note', label: 'Note' },
];
export const samplesOf = itemId => store.all('qc_samples').filter(s => s.item_id === itemId).sort(byCreated);
const sampleUpdates = id => store.all('qc_sample_updates').filter(u => u.sample_id === id).sort(byCreated);
export const sampleStatus = smp => (sampleUpdates(smp.id).filter(u => u.status !== 'note').pop() || { status: 'sent' }).status;
export const sampleDecision = smp => sampleUpdates(smp.id).filter(u => u.status === 'approved' || u.status === 'rejected').pop() || null;
const statusChip = st => chip(esc(label(SAMPLE_STATUSES, st)), st === 'approved' ? 'good' : st === 'rejected' ? 'bad' : '');

const trackLink = (carrier, code) => {
  if (!code) return '';
  const url = trackingUrl(carrier, code);
  return url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(code)}</a>` : esc(code);
};

export function samplesBlock(it) {
  const list = samplesOf(it.id);
  return `
    <section class="qc-block">
      <h4>Samples</h4>
      ${list.length ? `<div class="qc-rows">${list.map(smp => `
        <button type="button" class="qc-row" data-action="qc-sample-view" data-id="${smp.id}">
          <span>${esc(smp.title)}<span class="muted small"> · sent ${esc(fmtDate(smp.sent_on || smp.created_at.slice(0, 10)))}${smp.tracking ? ` · ${esc(smp.carrier)} ${esc(smp.tracking)}` : ''}</span></span>
          ${statusChip(sampleStatus(smp))}
        </button>`).join('')}</div>` : '<p class="small muted">No samples sent.</p>'}
      <div class="qc-actions"><button class="btn small" data-action="qc-sample-new" data-id="${it.id}">${icon.send} Send a sample</button></div>
    </section>`;
}

function openSampleSheet(it) {
  const bag = { photos: [] };
  openSheet(`
    <form>
      ${sheetHeader(`Send a sample — ${it.name}`)}
      <div class="fields">
        <label class="field"><span>Sample</span><input name="title" required placeholder="e.g. Satin brass finish plate, 3000K LED module"></label>
        <label class="field"><span>Details</span><textarea name="description" rows="2" placeholder="What the client should check"></textarea></label>
        <div class="field"><span>Photos of the sample we're sending</span>${photoPicker('photos', 'Add photos', true)}</div>
        <div class="field-row three">
          <label class="field"><span>Carrier</span><input name="carrier" list="qc-carriers" autocomplete="off"></label>
          <label class="field"><span>Tracking number</span><input name="tracking" autocapitalize="characters" autocomplete="off"></label>
          <label class="field"><span>Sent on</span><input type="date" name="sent_on" value="${todayStr()}"></label>
        </div>
        <datalist id="qc-carriers">${CARRIERS.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
        <p class="notice small">🔒 Permanent record. The client's approval or rejection is added to it later.</p>
      </div>
      <footer><span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">Save sample</button></footer>
    </form>`, {
    onOpen(sheet) { wirePhotos(sheet, { project_id: it.project_id, item_id: it.id }, bag); },
    async onSubmit(fd) {
      try {
        await store.insert('qc_samples', {
          project_id: it.project_id, item_id: it.id, item_name: it.name,
          title: String(fd.get('title')).trim(), description: String(fd.get('description') || '').trim(), photos: bag.photos,
          carrier: String(fd.get('carrier') || '').trim(), tracking: String(fd.get('tracking') || '').trim(), sent_on: fd.get('sent_on') || null,
        });
      } catch (err) { return false; }
      toast('Sample recorded');
    },
  });
}

function openSampleView(smp) {
  const ups = sampleUpdates(smp.id);
  const st = sampleStatus(smp);
  const bag = { photos: [] };
  openSheet(`
    <form>
      ${sheetHeader(`Sample — ${smp.title}`)}
      <div class="fields">
        <p class="small">${statusChip(st)} ${esc(smp.item_name)} · sent ${esc(fmtDate(smp.sent_on || smp.created_at.slice(0, 10)))}${smp.tracking ? ` · ${esc(smp.carrier)} ${trackLink(smp.carrier, smp.tracking)}` : ''}</p>
        ${smp.description ? `<p class="prewrap">${esc(smp.description)}</p>` : ''}
        ${smp.photos.length ? `<div class="qc-thumbs">${thumbs(smp.photos)}</div>` : ''}
        <p class="muted small">🔒 Recorded ${stamp(smp)}</p>
        <h4>History</h4>
        ${ups.length ? `<div class="qc-history">${ups.map(u => `
          <div class="qc-hist"><span class="muted small">${esc(when(u.created_at))} · ${esc(u.created_by ? who(u.created_by) : u.person || 'Via link')}</span>
            <span><b>${esc(label(SAMPLE_STATUSES, u.status))}</b>${u.person ? ` (${esc(u.person)})` : ''}${u.note ? ` — ${esc(u.note)}` : ''}</span>
            ${u.photos.length ? `<div class="qc-thumbs">${thumbs(u.photos)}</div>` : ''}</div>`).join('')}</div>` : '<p class="muted small">No answer from the client yet.</p>'}
        <h4>Add an update</h4>
        <div class="field-row">
          <label class="field"><span>Status</span><select name="status">${options(SAMPLE_STATUSES.filter(x => x.id !== 'sent'), st === 'sent' ? 'received' : 'approved')}</select></label>
          <label class="field"><span>Who (client contact)</span><input name="person"></label>
        </div>
        <label class="field"><span>Note</span><input name="note" placeholder="e.g. Approved by email, prefers slightly darker patina"></label>
        ${photoPicker('photos')}
      </div>
      <footer><span class="spacer"></span><button type="button" class="btn" data-close>Close</button><button type="submit" class="btn primary">Add update</button></footer>
    </form>`, {
    wide: true,
    onOpen(sheet) { wirePhotos(sheet, { project_id: smp.project_id, item_id: smp.item_id }, bag); },
    async onSubmit(fd) {
      const status = fd.get('status');
      const note = String(fd.get('note') || '').trim();
      if (status === 'rejected' && !note) { toast('Write why the sample was rejected'); return false; }
      try {
        await store.insert('qc_sample_updates', { project_id: smp.project_id, sample_id: smp.id, status, person: String(fd.get('person') || '').trim(), note, photos: bag.photos });
      } catch (err) { return false; }
      toast(status === 'approved' ? 'Sample approved ✅' : status === 'rejected' ? 'Sample rejected — recorded' : 'Update added');
    },
  });
}

// ---------- Change requests (supplier, client or us) ----------

const REQUEST_STATUSES = [{ id: 'open', label: 'New' }, { id: 'accepted', label: 'Accepted — spec being updated' }, { id: 'declined', label: 'Declined' }, { id: 'done', label: 'Done — new version issued' }];
export const requestsOf = pid => store.all('qc_requests').filter(r => r.project_id === pid).sort(byCreated);
const requestUpdates = id => store.all('qc_request_updates').filter(u => u.request_id === id).sort(byCreated);
export const requestStatus = r => (requestUpdates(r.id).pop() || { status: 'open' }).status;
export const openRequests = pid => requestsOf(pid).filter(r => ['open', 'accepted'].includes(requestStatus(r)));
const partyName = party => (party === 'us' ? 'Us' : party === 'client' ? 'Client' : 'Supplier');

export function requestsBlock(it) {
  const list = requestsOf(it.project_id).filter(r => r.item_id === it.id);
  return `
    <section class="qc-block">
      <h4>Change requests</h4>
      ${list.length ? `<div class="qc-rows">${list.slice().reverse().map(r => {
        const st = requestStatus(r);
        return `
        <button type="button" class="qc-row" data-action="qc-request-view" data-id="${r.id}">
          <span><b>${esc(partyName(r.party))}</b>${r.person ? ` (${esc(r.person)})` : ''}: ${esc(r.description.slice(0, 90))}${r.description.length > 90 ? '…' : ''}</span>
          <span class="muted small">${esc(fmtDate(r.created_at.slice(0, 10)))}</span>
          ${chip(esc(label(REQUEST_STATUSES, st)), st === 'open' ? 'warn' : st === 'declined' ? '' : st === 'done' ? 'good' : '')}
        </button>`;
      }).join('')}</div>` : '<p class="small muted">No change requests. After approval, changes can only be made through a request.</p>'}
      <div class="qc-actions"><button class="btn small" data-action="qc-request-new" data-id="${it.id}">Record a change request</button></div>
    </section>`;
}

function openRequestSheet(it) {
  const bag = { photos: [] };
  const v = latestVersion(it.id);
  openSheet(`
    <form>
      ${sheetHeader(`Change request — ${it.name}`)}
      <div class="fields">
        <div class="field-row">
          <label class="field"><span>From</span><select name="party">${options([{ id: 'client', label: 'Client' }, { id: 'supplier', label: 'Supplier' }, { id: 'us', label: 'Us' }], 'client')}</select></label>
          <label class="field"><span>Name</span><input name="person"></label>
        </div>
        <label class="field"><span>What should change, and why</span><textarea name="description" rows="3" required placeholder="e.g. Supplier: glass only available in 4 mm (spec says 5 mm)"></textarea></label>
        ${photoPicker('photos')}
        <p class="notice small">🔒 Permanent. ${v ? `Spec v${v.version_no} stays as it is until you issue a new version — which then needs approval from us, the supplier and the client.` : ''}</p>
      </div>
      <footer><span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">Save request</button></footer>
    </form>`, {
    onOpen(sheet) { wirePhotos(sheet, { project_id: it.project_id, item_id: it.id }, bag); },
    async onSubmit(fd) {
      try {
        await store.insert('qc_requests', {
          project_id: it.project_id, item_id: it.id, item_name: it.name, version_id: v ? v.id : null,
          party: fd.get('party'), person: String(fd.get('person') || '').trim(), description: String(fd.get('description')).trim(), photos: bag.photos,
        });
      } catch (err) { return false; }
      toast('Change request recorded');
    },
  });
}

function openRequestView(r) {
  const st = requestStatus(r);
  const ups = requestUpdates(r.id);
  const v = store.get('spec_versions', r.version_id);
  const it = store.get('items', r.item_id);
  openSheet(`
    <form>
      ${sheetHeader(`Change request — ${r.item_name || 'order'}`)}
      <div class="fields">
        <p class="small">${chip(esc(label(REQUEST_STATUSES, st)), st === 'open' ? 'warn' : '')} From <b>${esc(partyName(r.party))}</b>${r.person ? ` (${esc(r.person)})` : ''}${v ? ` · about spec v${v.version_no}` : ''}${r.link_id ? ' · sent through their link' : ''}</p>
        <p class="prewrap">${esc(r.description)}</p>
        ${r.photos.length ? `<div class="qc-thumbs">${thumbs(r.photos)}</div>` : ''}
        <p class="muted small">🔒 Received ${esc(when(r.created_at))}</p>
        ${ups.length ? `<h4>History</h4><div class="qc-history">${ups.map(u => `<div class="qc-hist"><span class="muted small">${esc(when(u.created_at))} · ${esc(who(u.created_by))}</span><span><b>${esc(label(REQUEST_STATUSES, u.status))}</b>${u.note ? ` — ${esc(u.note)}` : ''}</span></div>`).join('')}</div>` : ''}
        ${st === 'open' || st === 'accepted' ? `
          <label class="field"><span>Note (shown on the record)</span><input name="note" placeholder="e.g. OK — client agreed by phone, issuing v3"></label>
          <p class="muted small">Accepting opens the spec so you can make the change; then issue the new version — the client, the supplier and we approve it again.</p>` : ''}
      </div>
      <footer>
        <span class="spacer"></span>
        <button type="button" class="btn" data-close>Close</button>
        ${st === 'open' ? `<button type="submit" class="btn" value="declined">Decline</button><button type="submit" class="btn primary" value="accepted">Accept &amp; edit spec</button>` : ''}
        ${st === 'accepted' && it ? `<button type="submit" class="btn primary" value="edit">Edit spec</button>` : ''}
      </footer>
    </form>`, {
    wide: true,
    onOpen(sheet) { wireSheetActions(sheet); },
    async onSubmit(fd, form, submitter) {
      const what = submitter && submitter.value;
      const note = String(fd.get('note') || '').trim();
      if (what === 'declined' && !note) { toast('Write why the request is declined'); return false; }
      if (what === 'accepted' || what === 'declined') {
        try { await store.insert('qc_request_updates', { project_id: r.project_id, request_id: r.id, status: what, note }); } catch (err) { return false; }
      }
      if ((what === 'accepted' || what === 'edit') && it) setTimeout(() => openSpecSheet(store.get('items', it.id)), 50);
      else toast('Request declined — recorded');
    },
  });
}

// ---------- Photos sent in through links ----------

const PURPOSES = [{ id: 'production', label: 'Production photos' }, { id: 'packing', label: 'Packing photos' }, { id: 'sample', label: 'Sample photos' }, { id: 'other', label: 'Photos' }];

export function submissionsBlock(it) {
  const list = store.all('qc_submissions').filter(s => s.item_id === it.id).sort(byCreated).reverse();
  if (!list.length) return '';
  return `<p class="small muted" style="margin-top:8px">Sent in through links:</p><div class="qc-rows">${list.map(s => `
    <button type="button" class="qc-row" data-action="qc-sub-view" data-id="${s.id}">
      <span>${esc(label(PURPOSES, s.purpose))} · ${esc(s.party === 'client' ? 'client' : 'supplier')}${s.person ? ` (${esc(s.person)})` : ''}${s.note ? ` — ${esc(s.note.slice(0, 60))}` : ''}</span>
      <span class="muted small">${s.photos.length} file${s.photos.length === 1 ? '' : 's'} · ${esc(fmtDate(s.created_at.slice(0, 10)))}</span>
    </button>`).join('')}</div>`;
}

function openSubmissionView(s) {
  openSheet(`
    <div>
      ${sheetHeader(`${label(PURPOSES, s.purpose)} — ${s.item_name || 'order'}`)}
      <div class="fields">
        <p class="small">From the ${esc(s.party)}${s.person ? ` (${esc(s.person)})` : ''} · ${esc(when(s.created_at))}</p>
        ${s.note ? `<p class="prewrap">${esc(s.note)}</p>` : ''}
        <div class="qc-thumbs">${thumbs(s.photos)}</div>
        <p class="muted small">Use these as proof in an inspection, or report an issue if something is wrong.</p>
      </div>
      <footer><span class="spacer"></span><button type="button" class="btn primary" data-close>Close</button></footer>
    </div>`, { wide: true });
}

// ---------- Links for the supplier and the client ----------

export const linksOf = pid => store.all('qc_links').filter(l => l.project_id === pid).sort(byCreated);
export const portalUrl = link => `${location.origin}${location.pathname.replace(/[^/]*$/, '')}portal.html#${link.token}`;

export function linksBlock(p) {
  const links = linksOf(p.id);
  const items = new Map(productsOf(p.id).map(i => [i.id, i]));
  const sent = store.all('qc_submissions').filter(s => s.project_id === p.id && !s.item_id);
  return `
    <h2 class="section">Links for the supplier &amp; client</h2>
    <div class="card-surface pad">
      ${store.backend.mode === 'cloud' ? '' : '<p class="notice warn small">Links only work with the team database, not in demo mode.</p>'}
      <p class="muted small">A private link (no account needed). The <b>supplier</b> confirms each spec, sends production, sample and packing photos, and asks for changes. The <b>client</b> approves specs and samples. Everything they send is recorded here with the time and their name.</p>
      ${links.length ? `<div class="qc-rows">${links.map(l => `
        <div class="qc-row static">
          <span><b>${l.party === 'client' ? 'Client' : 'Supplier'}</b>${l.label ? ` — ${esc(l.label)}` : ''}<span class="muted small"> · ${l.item_ids.length ? l.item_ids.map(id => esc((items.get(id) || {}).name || 'removed')).join(', ') : 'all lights'} · made ${esc(fmtDate(l.created_at.slice(0, 10)))}</span></span>
          ${l.revoked_at ? chip('Switched off') : `<span class="qc-actions" style="margin:0">
            <button class="btn small" data-action="qc-link-share" data-id="${l.id}">Share</button>
            <button class="btn small" data-action="qc-link-revoke" data-id="${l.id}">Switch off</button></span>`}
        </div>`).join('')}</div>` : ''}
      ${sent.length ? `<div class="qc-rows">${sent.map(s => `<button type="button" class="qc-row" data-action="qc-sub-view" data-id="${s.id}"><span>${esc(label(PURPOSES, s.purpose))} for the whole order · ${esc(s.person || s.party)}</span><span class="muted small">${s.photos.length} files</span></button>`).join('')}</div>` : ''}
      <div class="qc-actions">
        <button class="btn small" data-action="qc-link-new" data-party="supplier" data-id="${p.id}">New supplier link</button>
        <button class="btn small" data-action="qc-link-new" data-party="client" data-id="${p.id}">New client link</button>
      </div>
    </div>`;
}

function newToken() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

function openLinkSheet(p, party) {
  const lights = lightingOf(p.id);
  const suppliers = [...new Set(lights.map(i => i.supplier).filter(Boolean))];
  openSheet(`
    <form>
      ${sheetHeader(`New ${party} link — ${p.name}`)}
      <div class="fields">
        <label class="field"><span>Name (for you)</span><input name="label" value="${party === 'supplier' && suppliers.length === 1 ? esc(suppliers[0]) : ''}" placeholder="${party === 'supplier' ? 'e.g. Atelier Lumen' : 'e.g. Ana Silva'}"></label>
        <div class="field"><span>Products on this link</span>
          ${lights.map(i => `<label class="check-line"><input type="checkbox" name="item" value="${i.id}" ${party === 'client' || !suppliers.length || i.supplier === suppliers[0] || suppliers.length > 1 ? 'checked' : ''}> ${esc(itemNo(i))} · ${esc(i.name)}${i.supplier ? ` <span class="muted small">· ${esc(i.supplier)}</span>` : ''}</label>`).join('')}
        </div>
        <p class="muted small">Only the details ticked for the ${party} on each spec are shown. Links need the one-time “qc-portal” setup in Supabase (see the README).</p>
      </div>
      <footer><span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">Create link</button></footer>
    </form>`, {
    async onSubmit(fd) {
      const ids = fd.getAll('item');
      if (!ids.length) { toast('Choose at least one product'); return false; }
      let link;
      try {
        link = await store.insert('qc_links', { project_id: p.id, token: newToken(), party, item_ids: ids.length === lights.length ? [] : ids, label: String(fd.get('label') || '').trim() });
      } catch (err) { return false; }
      setTimeout(() => shareLink(store.get('qc_links', link.id) || link), 50);
    },
  });
}

function shareLink(link) {
  const url = portalUrl(link);
  const p = store.get('projects', link.project_id);
  const text = link.party === 'supplier'
    ? `Production specs for ${p ? p.name : 'our order'}${p && p.order_no ? ` (${p.order_no})` : ''}: please check and confirm each item, and send photos. Any change must be requested here.`
    : `Specs for ${p ? p.name : 'your order'}${p && p.order_no ? ` (${p.order_no})` : ''}: please review and approve.`;
  openSheet(`
    <div>
      ${sheetHeader(`${link.party === 'client' ? 'Client' : 'Supplier'} link`)}
      <div class="fields">
        <input class="link-box" readonly value="${esc(url)}">
        <p class="muted small">Anyone with this link can see these specs and send answers, so share it only with the right person. You can switch it off any time.</p>
      </div>
      <footer><span class="spacer"></span>
        <button type="button" class="btn" data-copy>Copy</button>
        ${navigator.share ? '<button type="button" class="btn primary" data-share>Share…</button>' : ''}
      </footer>
    </div>`, {
    onOpen(sheet) {
      $('[data-copy]', sheet).addEventListener('click', () => {
        (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast('Link copied')).catch(() => { $('.link-box', sheet).select(); toast('Select and copy the link'); });
      });
      const s = $('[data-share]', sheet);
      if (s) s.addEventListener('click', () => navigator.share({ title: 'Specs', text, url }).catch(() => {}));
    },
  });
}

// ---------- Report template per company ----------

function openTemplateSheet(company) {
  const t = company.qc_template || {};
  openSheet(`
    <form>
      ${sheetHeader(`QC report template — ${company.name}`)}
      <div class="fields">
        <p class="muted small">For new specs of ${esc(company.name)}: which details appear on the client and supplier specification cards. Each spec can still change it per detail. “Not used” hides the detail in the spec form. Details that are left empty never appear.</p>
        ${SPEC_SECTIONS.map(sec => `
          <details class="spec-sec" open><summary>${esc(sec.title)}</summary>
            <div class="tmpl-grid">${sec.fields.filter(f => f.key !== 'market').map(f => `
              <label class="tmpl-row"><span>${esc(f.label)}</span><select name="${f.key}">${options(SHOW_OPTIONS, templateShow(t, f.key))}</select></label>`).join('')}</div>
          </details>`).join('')}
      </div>
      <footer><span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">Save template</button></footer>
    </form>`, {
    wide: true,
    onSubmit(fd) {
      const fields = {};
      SPEC_SECTIONS.forEach(sec => sec.fields.forEach(f => { if (fd.has(f.key)) fields[f.key] = fd.get(f.key); }));
      store.update('companies', company.id, { qc_template: { ...t, fields } }).then(() => toast('Template saved')).catch(() => {});
    },
  });
}

// ---------- Specification cards: every product of the order together ----------

// Outcome pictures: photos of the newest final and packing inspections.
export function outcomePhotos(itemId) {
  const ids = [];
  ['final', 'packing'].forEach(stg => {
    const i = inspectionsOf(itemId).filter(x => x.stage === stg).pop();
    if (i) ids.push(...(i.photos || []), ...(i.results || []).filter(r => r.result === 'pass').flatMap(r => r.photos || []));
  });
  return [...new Set(ids)];
}

function imageCell(title, ids) {
  return `<div class="lc-img"><span class="muted small">${esc(title)}</span>
    ${ids.length ? `<div class="qc-thumbs">${thumbs(ids.slice(0, 4))}${ids.length > 4 ? `<span class="qc-thumb more">+${ids.length - 4}</span>` : ''}</div>` : '<div class="lc-placeholder">No image yet</div>'}</div>`;
}

// Uploaded datasheets (LED, driver…) as buttons that open the file.
function datasheets(spec) {
  const list = SPEC_SECTIONS.flatMap(sec => sec.fields).filter(f => f.type === 'files' && Array.isArray(spec[f.key]) && spec[f.key].length);
  if (!list.length) return '';
  return `<div class="lc-docs small">${list.map(f => `<span><b>${esc(f.label)}:</b> ${spec[f.key].map(a =>
    `<button type="button" class="link" data-action="open-file" data-id="${esc(a.id)}">${esc(a.name)}</button>`).join(', ')}</span>`).join('')}</div>`;
}

function lineCard(p, it) {
  const v = latestVersion(it.id);
  const spec = viewSpec(v, it);
  const images = spec._images || {};
  const rows = specRows(spec, 'client', templateOf(p)).flatMap(sec => sec.rows).slice(0, 12);
  const samples = samplesOf(it.id);
  const st = specState(it);
  return `
    <article class="card-surface qc-card line-card">
      <header class="qc-card-head">
        <div>
          <div class="muted small">${p.order_no ? `${esc(p.order_no)} · ` : ''}Item ${esc(itemNo(it))}</div>
          <h3>${esc(it.name)} <span class="muted">× ${esc(String(Number(it.quantity) || 1))}</span></h3>
          <div class="muted small">${esc([(spec.location_tag || ''), it.supplier].filter(Boolean).join(' · '))}</div>
        </div>
        <div class="qc-chips">${v ? chip(`Spec v${v.version_no}`) : chip('Draft — not issued', 'warn')}</div>
      </header>
      <div class="lc-images">
        ${imageCell(IMAGE_GROUPS[0].label, images.vision || [])}
        ${imageCell(IMAGE_GROUPS[1].label, images.offer || [])}
        ${imageCell('Outcome', outcomePhotos(it.id))}
      </div>
      ${rows.length ? `<dl class="facts lc-facts">${rows.map(([k, val]) => `<dt>${esc(k)}</dt><dd>${esc(val)}</dd>`).join('')}</dl>` : '<p class="muted small">No details filled in yet.</p>'}
      ${datasheets(spec)}
      ${samples.length ? `<p class="small"><b>Samples:</b> ${samples.map(smp => `${esc(smp.title)} — ${esc(label(SAMPLE_STATUSES, sampleStatus(smp)).toLowerCase())}`).join('; ')}</p>` : ''}
      <div class="lc-approvals small">
        <span>${decisionText(st.internal, 'internal')}</span>
        <span>${decisionText(st.supplier, 'supplier')}</span>
        <span>${decisionText(st.client, 'client')}</span>
      </div>
      <div class="qc-actions">
        <button class="btn small" data-action="qc-card-pdf" data-party="client" data-id="${it.id}">Client PDF</button>
        <button class="btn small" data-action="qc-card-pdf" data-party="supplier" data-id="${it.id}">Supplier PDF</button>
        <button class="btn small" data-action="qc-spec" data-id="${it.id}">${icon.edit} Spec</button>
      </div>
    </article>`;
}

export function lineCardsView(p) {
  const lights = lightingOf(p.id);
  const client = store.get('clients', p.client_id);
  return `
    <div class="card-surface pad qc-order-head">
      <div class="qc-order-link static">
        <span class="muted small">Order</span>
        <b>${p.order_no ? esc(p.order_no) : 'No order no. yet'}</b>
        <span>${esc(p.name)}${client ? ` · ${esc(client.name)}` : ''}</span>
      </div>
      <div class="qc-actions" style="margin:0">
        ${p.order_no ? '' : `<button class="btn small" data-action="qc-order-no" data-id="${p.id}">Give it an order no.</button>`}
        ${lights.length ? `<button class="btn small primary" data-action="qc-cards-pdf" data-party="client" data-id="${p.id}">All specification cards — client PDF</button>
        <button class="btn small" data-action="qc-cards-pdf" data-party="supplier" data-id="${p.id}">All — supplier PDF</button>` : ''}
        <a class="btn small" href="#/project/${p.id}/qc">Quality control</a>
      </div>
    </div>
    ${lights.length ? `<div class="line-cards">${lights.map(it => lineCard(p, it)).join('')}</div>`
      : '<div class="empty">No lighting products in this order yet.</div>'}`;
}

// ---------- What needs attention (Overview) ----------

// New change requests, "not approved" answers on current versions, and photos sent in through links this week.
export function qcInbox(projects) {
  const ids = new Set(projects.map(p => p.id));
  const out = [];
  const week = new Date(Date.now() - 7 * 864e5).toISOString();
  store.all('qc_requests').filter(r => ids.has(r.project_id) && requestStatus(r) === 'open')
    .forEach(r => out.push({ at: r.created_at, pid: r.project_id, text: `Change request from the ${r.party === 'us' ? 'team' : r.party}${r.person ? ` (${r.person})` : ''}: ${r.description}`, item: r.item_name, bad: true }));
  store.all('items').filter(it => ids.has(it.project_id) && it.category === 'lighting').forEach(it => {
    const v = latestVersion(it.id);
    if (!v) return;
    ['client', 'supplier'].forEach(party => {
      const a = lastDecision(v.id, party);
      if (a && a.decision === 'rejected') out.push({ at: a.created_at, pid: it.project_id, text: `${party === 'client' ? 'Client' : 'Supplier'} didn't approve v${v.version_no}${a.note ? `: ${a.note}` : ''}`, item: it.name, bad: true });
    });
  });
  store.all('qc_submissions').filter(s => ids.has(s.project_id) && s.created_at > week)
    .forEach(s => out.push({ at: s.created_at, pid: s.project_id, text: `${label(PURPOSES, s.purpose)} from the ${s.party}${s.person ? ` (${s.person})` : ''}`, item: s.item_name }));
  return out.sort((a, b) => (a.at < b.at ? 1 : -1));
}

// ---------- History entries & actions ----------

export function moreHistory(pid) {
  const rows = [];
  const add = (r, text) => rows.push({ at: r.created_at, by: r.created_by, person: r.person, text });
  store.all('qc_samples').filter(x => x.project_id === pid).forEach(x => add(x, `sent sample <b>${esc(x.title)}</b> for <b>${esc(x.item_name)}</b>${x.tracking ? ` (${esc(x.carrier)} ${esc(x.tracking)})` : ''}`));
  store.all('qc_sample_updates').filter(x => x.project_id === pid).forEach(x => add(x, `sample <b>${esc(x.title)}</b>: ${esc(label(SAMPLE_STATUSES, x.status).toLowerCase())}${x.note ? ` — “${esc(x.note)}”` : ''}`));
  store.all('qc_requests').filter(x => x.project_id === pid).forEach(x => add(x, `asked for a change (${esc(partyName(x.party).toLowerCase())}) on <b>${esc(x.item_name || 'the order')}</b>: “${esc(x.description.slice(0, 120))}”`));
  store.all('qc_request_updates').filter(x => x.project_id === pid).forEach(x => add(x, `${esc(label(REQUEST_STATUSES, x.status).toLowerCase())}: ${esc(x.title)}${x.note ? ` — “${esc(x.note)}”` : ''}`));
  store.all('qc_submissions').filter(x => x.project_id === pid).forEach(x => add(x, `sent ${esc(label(PURPOSES, x.purpose).toLowerCase())} (${x.photos.length}) via the ${esc(x.party)} link`));
  return rows;
}

export function moreAction(action, el) {
  const id = el.dataset.id;
  switch (action) {
    case 'qc-sample-new': { const it = store.get('items', id); if (it) openSampleSheet(it); break; }
    case 'qc-sample-view': { const smp = store.get('qc_samples', id); if (smp) openSampleView(smp); break; }
    case 'qc-request-new': { const it = store.get('items', id); if (it) openRequestSheet(it); break; }
    case 'qc-request-view': { const r = store.get('qc_requests', id); if (r) openRequestView(r); break; }
    case 'qc-sub-view': { const s = store.get('qc_submissions', id); if (s) openSubmissionView(s); break; }
    case 'qc-link-new': { const p = store.get('projects', id); if (p) openLinkSheet(p, el.dataset.party); break; }
    case 'qc-link-share': { const l = store.get('qc_links', id); if (l) shareLink(l); break; }
    case 'qc-link-revoke': {
      if (confirm('Switch this link off? It stops working straight away.')) store.update('qc_links', id, { revoked_at: new Date().toISOString() }).then(() => toast('Link switched off')).catch(() => {});
      break;
    }
    case 'qc-template': { const c = store.get('companies', id); if (c) openTemplateSheet(c); break; }
  }
}

