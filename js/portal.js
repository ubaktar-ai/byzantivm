// The page behind a supplier / client link (portal.html#<token>). No account: the token is the key.
// Shows the issued specs (only the details chosen for this party), and records approvals,
// change requests, sample decisions and photos through the "qc-portal" Supabase function.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { esc, toast, openSheet, sheetHeader, initSheet, $ } from './lib.js';
import { SPEC_SECTIONS, visible, fieldValue } from './qc-spec.js';

const token = location.hash.replace(/^#/, '');
const root = $('#portal');
const NAME_KEY = `portal-name:${token.slice(0, 12)}`; // per link, so testing both links on one device doesn't mix names
let data = null;

const getName = () => { try { return localStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; } };
const setName = v => { try { localStorage.setItem(NAME_KEY, v); } catch (e) { /* private mode */ } };
const day = iso => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const when = iso => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

async function call(action, body = {}) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/qc-portal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ token, action, ...body }),
  }).catch(() => null);
  if (!res) throw new Error('No connection — please try again.');
  let out = {};
  try { out = await res.json(); } catch (e) { /* not JSON */ }
  if (!res.ok || out.error) throw new Error(out.error || 'Something went wrong — please try again.');
  return out;
}

// ---------- Rendering ----------

const PARTY = { internal: 'Us', supplier: 'Supplier', client: 'Client' };
const PURPOSES = [['production', 'Production photos'], ['packing', 'Packing photos (ready for collection)'], ['sample', 'Sample photos']];

function pics(ids) {
  return ids.map(id => data.files[id]).filter(Boolean).map(f => /^image\//.test(f.mime)
    ? `<a href="${esc(f.url)}" target="_blank" rel="noopener"><img class="qc-thumb" src="${esc(f.url)}" alt="${esc(f.name)}" loading="lazy"></a>`
    : `<a class="qc-thumb file" href="${esc(f.url)}" target="_blank" rel="noopener">${esc((f.name.split('.').pop() || 'file').toUpperCase())}</a>`).join('');
}

function lastBy(list, party) { return list.filter(a => a.party === party).pop() || null; }

function approvalLine(a, party) {
  if (!a) return `⏳ ${PARTY[party]}: waiting`;
  const ok = a.decision === 'approved';
  return `${ok ? '✅' : '❌'} ${PARTY[party]}: ${ok ? (party === 'supplier' ? 'confirmed' : 'approved') : 'not approved'}${a.person ? ` — ${esc(a.person)}` : ''} · ${esc(when(a.at))}`;
}

// Datasheets etc. as download links (html).
function fileLinks(list) {
  return (Array.isArray(list) ? list : []).map(a => {
    const f = data.files[a.id];
    return f && f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(a.name)}</a>` : esc(a.name);
  }).join(', ');
}

// Built-in logos, used until a logo is uploaded in the app.
const builtInLogo = name => (/byzant/i.test(name) ? 'icons/logo-byzantivm.svg' : /demya/i.test(name) ? 'icons/logo-demya.png' : '');

function itemCard(it) {
  const me = data.party;
  const v = it.version;
  const mine = lastBy(it.approvals, me);
  const s = it.spec;
  const shape = { ...(it.layout || {}), ...s }; // layout facts decide which fields apply; only `s` is shown
  const sections = v ? SPEC_SECTIONS.map(sec => ({
    title: sec.title,
    rows: sec.fields.filter(f => f.type !== 'lines' && s[f.key] !== undefined && visible(f, shape))
      .map(f => [f.label, f.type === 'files' ? fileLinks(s[f.key]) : esc(fieldValue(f, s))]).filter(([, val]) => val),
    lines: sec.fields.filter(f => f.type === 'lines' && s[f.key] !== undefined).flatMap(f => String(s[f.key] || '').split('\n').map(x => x.trim()).filter(Boolean)),
  })).filter(sec => sec.rows.length || sec.lines.length) : [];
  const group = (title, ids) => `<div class="lc-img"><span class="muted small">${esc(title)}</span>${ids.length ? `<div class="qc-thumbs">${pics(ids)}</div>` : '<div class="lc-placeholder">No image yet</div>'}</div>`;

  return `
    <article class="card-surface qc-card portal-card" data-item="${esc(it.id)}">
      <header class="qc-card-head">
        <div>
          <div class="muted small">Item ${esc(it.item_no || '')}${data.order.order_no ? ` · ${esc(data.order.order_no)}` : ''}</div>
          <h3>${esc(it.name)} <span class="muted">× ${esc(String(it.quantity || 1))}</span></h3>
          ${v ? `<div class="muted small">Version ${v.no} · issued ${esc(day(v.issued_at))}${v.change_reason ? ` — ${esc(v.change_reason)}` : ''}</div>` : ''}
        </div>
      </header>
      ${!v ? '<p class="muted">This item’s specification hasn’t been issued yet.</p>' : `
        <div class="lc-images">${group('Received from client', it.pictures.vision)}${group('Proposed', it.pictures.offer)}${group('Outcome', it.pictures.outcome)}</div>
        ${sections.map(sec => `
          <h4 class="portal-sec">${esc(sec.title)}</h4>
          ${sec.rows.length ? `<dl class="facts">${sec.rows.map(([k, val]) => `<dt>${esc(k)}</dt><dd>${val}</dd>`).join('')}</dl>` : ''}
          ${sec.lines.length ? `<ol class="small">${sec.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ol>` : ''}`).join('')}
        ${it.samples.length ? `<h4 class="portal-sec">Samples</h4>${it.samples.map(smp => {
          const dec = smp.updates.filter(u => u.status === 'approved' || u.status === 'rejected').pop();
          return `<div class="portal-sample">
            <div><b>${esc(smp.title)}</b> <span class="muted small">· sent ${esc(day(smp.sent_on))}${smp.tracking ? ` · ${esc(smp.carrier)} ${esc(smp.tracking)}` : ''}</span></div>
            ${smp.description ? `<div class="small">${esc(smp.description)}</div>` : ''}
            ${smp.photos.length ? `<div class="qc-thumbs">${pics(smp.photos)}</div>` : ''}
            ${dec ? `<div class="small">${dec.status === 'approved' ? '✅ Approved' : '❌ Rejected'}${dec.person ? ` by ${esc(dec.person)}` : ''} · ${esc(when(dec.created_at))}${dec.note ? ` — ${esc(dec.note)}` : ''}</div>`
              : me === 'client' ? `<div class="qc-actions"><button class="btn small primary" data-sample="${esc(smp.id)}" data-decision="approved">Approve sample</button><button class="btn small" data-sample="${esc(smp.id)}" data-decision="rejected">Reject</button></div>` : '<div class="small muted">Waiting for the client’s answer</div>'}
          </div>`;
        }).join('')}` : ''}
        <h4 class="portal-sec">Approval</h4>
        <div class="lc-approvals small">${['internal', 'supplier', 'client'].map(p => `<span>${approvalLine(lastBy(it.approvals, p), p)}</span>`).join('')}</div>
        <div class="portal-actions">
          ${mine && mine.decision === 'approved'
            ? `<p class="notice small">You ${me === 'supplier' ? 'confirmed' : 'approved'} version ${v.no} on ${esc(day(mine.at))}. It can't be changed any more — if something needs to change, use <b>Request a change</b>.</p>`
            : `<button class="btn primary" data-decide="approved" data-version="${esc(v.id)}">${me === 'supplier' ? 'Confirm — we will make it exactly as specified' : `Approve version ${v.no}`}</button>
               <button class="btn" data-decide="rejected" data-version="${esc(v.id)}">${me === 'supplier' ? 'We can’t make it as specified' : 'Not approved — changes needed'}</button>`}
          <button class="btn" data-request>Request a change</button>
          ${me === 'supplier' ? '<button class="btn" data-send>Send photos</button>' : ''}
        </div>
        ${it.requests.length ? `<h4 class="portal-sec">Your change requests</h4><ul class="small">${it.requests.map(r => `<li>${esc(day(r.at))}: ${esc(r.description)} — <b>${esc({ open: 'received', accepted: 'accepted, being updated', declined: 'declined', done: 'done — see the new version' }[r.status] || r.status)}</b></li>`).join('')}</ul>` : ''}
        ${it.submissions.length ? `<h4 class="portal-sec">Photos you sent</h4><ul class="small">${it.submissions.map(x => `<li>${esc(day(x.at))}: ${esc((PURPOSES.find(p => p[0] === x.purpose) || ['', 'Photos'])[1])} (${x.count})${x.note ? ` — ${esc(x.note)}` : ''}</li>`).join('')}</ul>` : ''}`}
    </article>`;
}

function render() {
  const d = data;
  document.title = `${d.order.order_no ? `${d.order.order_no} · ` : ''}${d.order.name}`;
  root.innerHTML = `
    <header class="portal-head" style="--c:${esc(d.company.color || '#333')}">
      ${d.company.logo || builtInLogo(d.company.name) ? `<img class="portal-logo" src="${esc(d.company.logo || builtInLogo(d.company.name))}" alt="${esc(d.company.name)}">` : `<b class="portal-company">${esc(d.company.name)}</b>`}
      <div>
        <div class="muted small">${d.party === 'supplier' ? 'Production specifications' : 'Specifications for approval'}</div>
        <h1>${esc(d.order.name)}</h1>
        <div class="muted small">${d.order.order_no ? `Order ${esc(d.order.order_no)}` : ''}${d.order.client ? ` · ${esc(d.order.client)}` : ''}</div>
      </div>
    </header>
    <div class="card-surface pad portal-intro">
      <label class="field"><span>Your name</span><input id="portal-name" value="${esc(getName())}" placeholder="Saved with everything you send" autocomplete="name"></label>
      <p class="muted small">${d.party === 'supplier'
        ? 'Please check every item and confirm before production starts. Make each product exactly as specified. After you confirm, nothing may be changed — if something has to change, send a change request here; we will confirm it with the client and send a new version.'
        : 'Please review each item. Approve it, or tell us what should change. Production starts only when the same version is approved by you, by us and by the workshop.'}
        Everything you send is saved with your name and the time.</p>
    </div>
    ${d.items.length ? d.items.map(itemCard).join('') : '<div class="empty">Nothing to show yet.</div>'}
    <p class="muted small portal-foot">${esc(d.company.name)}</p>`;
}

async function reload() {
  try {
    data = await call('load');
    render();
  } catch (err) {
    root.innerHTML = `<div class="card-surface pad portal-error"><h1>Link not available</h1><p>${esc(err.message)}</p></div>`;
  }
}

// ---------- Actions ----------

function needName() {
  const name = ($('#portal-name') && $('#portal-name').value.trim()) || getName();
  if (!name) {
    toast('Please fill in your name first');
    const el = $('#portal-name');
    if (el) { el.focus(); el.scrollIntoView({ block: 'center' }); }
    return null;
  }
  setName(name);
  return name;
}

// Photos are scaled down before sending (max 2000 px); other files are sent as they are.
async function prepare(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  try {
    const url = URL.createObjectURL(file);
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });
    URL.revokeObjectURL(url);
    const scale = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
    if (scale === 1 && file.size < 1.5e6) return file;
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } catch (e) { return file; }
}

const toBase64 = blob => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] || '');
  r.onerror = () => reject(new Error('Could not read the file'));
  r.readAsDataURL(blob);
});

async function uploadAll(files, itemId, status) {
  const ids = [];
  for (let i = 0; i < files.length; i++) {
    status(`Sending ${i + 1} of ${files.length}…`);
    const f = await prepare(files[i]);
    if (f.size > 25 * 1024 * 1024) throw new Error(`${files[i].name} is larger than 25 MB`);
    const out = await call('upload', { item_id: itemId, name: f.name, mime: f.type || 'application/octet-stream', data: await toBase64(f), person: getName() });
    ids.push(out.id);
  }
  return ids;
}

function formSheet({ title, intro = '', fields, submit, onSubmit }) {
  openSheet(`
    <form>
      ${sheetHeader(title)}
      <div class="fields">${intro ? `<p class="small">${intro}</p>` : ''}${fields}<p class="muted small" data-status></p></div>
      <footer><span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">${esc(submit)}</button></footer>
    </form>`, {
    async onSubmit(fd, form) {
      const status = t => { const el = $('[data-status]', form); if (el) el.textContent = t; };
      try {
        await onSubmit(fd, form, status);
      } catch (err) {
        status('');
        toast(err.message || 'Something went wrong');
        return false;
      }
      reload();
    },
  });
}

root.addEventListener('click', e => {
  const card = e.target.closest('[data-item]');
  const itemId = card && card.dataset.item;
  const it = data && data.items.find(x => x.id === itemId);

  const decide = e.target.closest('[data-decide]');
  if (decide && it) {
    const name = needName();
    if (!name) return;
    const ok = decide.dataset.decide === 'approved';
    if (ok) {
      const what = data.party === 'supplier' ? `confirm that you will make “${it.name}” exactly as specified in version ${it.version.no}` : `approve version ${it.version.no} of “${it.name}”`;
      if (!confirm(`As ${name}, ${what}? This is saved permanently.`)) return;
      call('decide', { item_id: it.id, version_id: decide.dataset.version, decision: 'approved', person: name })
        .then(() => { toast(data.party === 'supplier' ? 'Confirmed — thank you' : 'Approved — thank you'); reload(); })
        .catch(err => toast(err.message));
      return;
    }
    formSheet({
      title: data.party === 'supplier' ? `Can’t make it as specified — ${it.name}` : `Changes needed — ${it.name}`,
      fields: `<label class="field"><span>${data.party === 'supplier' ? 'What can’t you make as specified, and what do you propose?' : 'What should change?'}</span><textarea name="note" rows="4" required></textarea></label>`,
      submit: 'Send',
      onSubmit: fd => call('decide', { item_id: it.id, version_id: decide.dataset.version, decision: 'rejected', note: fd.get('note'), person: name }),
    });
    return;
  }

  if (e.target.closest('[data-request]') && it) {
    const name = needName();
    if (!name) return;
    formSheet({
      title: `Request a change — ${it.name}`,
      intro: data.party === 'supplier' ? 'Don’t change anything until we send you a new version. We’ll check the change with the client first.' : 'We’ll check the change with the workshop and send you a new version to approve.',
      fields: `<label class="field"><span>What should change, and why?</span><textarea name="description" rows="4" required></textarea></label>
        <label class="field"><span>Photos or files (optional)</span><input type="file" name="files" multiple accept="image/*,application/pdf,video/*"></label>`,
      submit: 'Send request',
      async onSubmit(fd, form, status) {
        const ids = await uploadAll([...form.elements.files.files], it.id, status);
        await call('request', { item_id: it.id, description: fd.get('description'), photo_ids: ids, person: name });
        toast('Request sent — we’ll get back to you');
      },
    });
    return;
  }

  if (e.target.closest('[data-send]') && it) {
    const name = needName();
    if (!name) return;
    formSheet({
      title: `Send photos — ${it.name}`,
      fields: `<label class="field"><span>What are they?</span><select name="purpose">${PURPOSES.map(([id, l]) => `<option value="${id}">${esc(l)}</option>`).join('')}</select></label>
        <label class="field"><span>Photos, videos or PDFs</span><input type="file" name="files" multiple required accept="image/*,application/pdf,video/*"></label>
        <label class="field"><span>Note (optional)</span><input name="note" placeholder="e.g. All 6 units finished, test report attached"></label>`,
      submit: 'Send',
      async onSubmit(fd, form, status) {
        const files = [...form.elements.files.files];
        if (!files.length) throw new Error('Choose at least one photo or file');
        const ids = await uploadAll(files, it.id, status);
        await call('submit', { item_id: it.id, purpose: fd.get('purpose'), note: fd.get('note'), photo_ids: ids, person: name });
        toast('Sent — thank you');
      },
    });
    return;
  }

  const smpBtn = e.target.closest('[data-sample]');
  if (smpBtn) {
    const name = needName();
    if (!name) return;
    if (smpBtn.dataset.decision === 'approved') {
      if (!confirm(`As ${name}, approve this sample? This is saved permanently.`)) return;
      call('sample', { sample_id: smpBtn.dataset.sample, decision: 'approved', person: name }).then(() => { toast('Sample approved — thank you'); reload(); }).catch(err => toast(err.message));
      return;
    }
    formSheet({
      title: 'Reject sample',
      fields: '<label class="field"><span>What’s wrong with it?</span><textarea name="note" rows="3" required></textarea></label>',
      submit: 'Send',
      onSubmit: fd => call('sample', { sample_id: smpBtn.dataset.sample, decision: 'rejected', note: fd.get('note'), person: name }),
    });
  }
});

root.addEventListener('change', e => { if (e.target.id === 'portal-name') setName(e.target.value.trim()); });

initSheet();
if (!token) root.innerHTML = '<div class="card-surface pad portal-error"><h1>Link not complete</h1><p>Please open the full link you received.</p></div>';
else reload();

