// The page behind a designer's design link (design.html#<token>). No account: the token is the key.
// The designer describes a piece and uploads a sketch, references and a photo of the room. The "design-studio"
// Supabase function returns three concept images, can show a concept in the room or change it, and sends the
// chosen one to us.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { esc, toast, openSheet, sheetHeader, initSheet, $ } from './lib.js';

const token = location.hash.replace(/^#/, '');
const root = $('#portal');
const NAME_KEY = `design-person:${token.slice(0, 12)}`;
const MAX_SIDE = 2000;  // photos are scaled down to this many pixels on the long side before uploading
const MAX_REFS = 6;
const PIECES = ['Pendant light', 'Wall light', 'Ceiling light', 'Floor lamp', 'Table lamp', 'Chandelier', 'Table', 'Chair', 'Sofa', 'Cabinet', 'Other'];
const FIELDS = ['piece', 'quantity', 'size', 'materials', 'placement', 'notes', 'needed_by', 'budget', 'country'];

let data = null;   // what 'load' returned
let open = null;   // id of the design on screen, 'new' for the form, null for the list
let busy = '';     // what the AI is doing right now
let busyTimer = null;
const roomView = new Set(); // "<request id>:<index>" of concepts showing the room picture
const emptyDraft = () => ({ brief: { piece: PIECES[0], quantity: '1' }, refs: [], room: null });
let draft = emptyDraft(); // the form, kept while the page re-renders

const getPerson = () => { try { return JSON.parse(localStorage.getItem(NAME_KEY) || '{}'); } catch (e) { return {}; } };
const setPerson = v => { try { localStorage.setItem(NAME_KEY, JSON.stringify(v)); } catch (e) { /* private mode */ } };
const day = iso => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const letter = i => String.fromCharCode(65 + i);

async function call(action, body = {}) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/design-studio`, {
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

// ---------- Photos: scaled down and turned into JPEG on the device ----------

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`“${file.name}” could not be opened — please use a JPEG or PNG photo.`)); };
    img.src = url;
  });
}

async function prepare(file) {
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; // sketches saved as transparent PNGs stay readable
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.86));
  if (!blob) throw new Error(`“${file.name}” could not be read.`);
  return { blob, width: canvas.width, height: canvas.height };
}

const toBase64 = blob => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1]);
  r.onerror = () => reject(new Error('A photo could not be read.'));
  r.readAsDataURL(blob);
});

// ---------- Rendering ----------

const builtInLogo = name => (/byzant/i.test(name) ? 'icons/logo-byzantivm.svg' : /demya/i.test(name) ? 'icons/logo-demya.png' : '');

function head() {
  const c = data.company;
  const logo = c.logo || builtInLogo(c.name);
  return `
    <header class="portal-head" style="--c:${esc(c.color)}">
      ${logo ? `<img class="portal-logo" src="${esc(logo)}" alt="${esc(c.name)}">` : ''}
      <div>
        <div class="portal-company"><b>${esc(c.name)}</b> · Design studio</div>
        <div class="muted small">${data.label ? `For ${esc(data.label)} · ` : ''}${data.images_left} images left on this link</div>
      </div>
    </header>`;
}

function picks(kind) {
  const list = kind === 'room' ? (draft.room ? [draft.room] : []) : draft.refs;
  return list.map((p, i) => `
    <div class="design-pick">
      <img src="${esc(p.url)}" alt="${esc(p.file.name)}">
      <button type="button" class="btn small" data-unpick="${kind}:${i}" aria-label="Remove ${esc(p.file.name)}">✕</button>
    </div>`).join('');
}

function newForm() {
  const b = draft.brief;
  const val = k => esc(b[k] || '');
  return `
    <section class="portal-intro">
      <h1>Start a custom piece</h1>
      <p class="muted">Tell us what you have in mind. A sketch, a few reference photos or a short description is enough. You’ll get three concept images in about a minute, and a photo of the room lets you see a concept in place.</p>
    </section>
    <form id="new-design" class="card-surface pad design-form">
      <div class="field"><span>Sketch or reference photos (up to ${MAX_REFS})</span>
        <div class="design-picks" data-picks="refs">${picks('refs')}</div>
        <label class="btn design-add">+ Add photos<input type="file" accept="image/*" multiple hidden data-pick="refs"></label>
      </div>
      <div class="field"><span>Photo of the room (optional)</span>
        <div class="design-picks" data-picks="room">${picks('room')}</div>
        <label class="btn design-add">${draft.room ? 'Replace room photo' : '+ Add room photo'}<input type="file" accept="image/*" hidden data-pick="room"></label>
        <span class="muted small">Shoot straight on, with the lights on, showing where the piece will go.</span>
      </div>
      <div class="field-row">
        <label class="field"><span>Type of piece</span><select name="piece">${PIECES.map(p => `<option ${b.piece === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label>
        <label class="field"><span>Quantity</span><input name="quantity" inputmode="numeric" value="${val('quantity')}"></label>
      </div>
      <label class="field"><span>Size</span><input name="size" value="${val('size')}" placeholder="e.g. about 90 cm across, drop to 75 cm above the table"></label>
      <label class="field"><span>Materials and finish</span><input name="materials" value="${val('materials')}" placeholder="e.g. brushed brass, matte white inside, warm light"></label>
      <label class="field"><span>Where it goes</span><input name="placement" value="${val('placement')}" placeholder="e.g. above the dining table, centred"></label>
      <label class="field"><span>Anything else we should know</span><textarea name="notes" rows="3" placeholder="e.g. low and calm, like the sketch. Dimmable. The ceiling is 3.1 m high.">${val('notes')}</textarea></label>
      <div class="field-row">
        <label class="field"><span>Needed on site by</span><input name="needed_by" value="${val('needed_by')}" placeholder="e.g. March 2027"></label>
        <label class="field"><span>Budget per piece</span><input name="budget" value="${val('budget')}" placeholder="e.g. € 3,000–5,000, or not sure"></label>
      </div>
      <label class="field"><span>Delivery country</span><input name="country" value="${val('country')}" placeholder="e.g. Netherlands"></label>
      <div class="portal-actions">
        <button type="submit" class="btn primary" ${data.images_left < 3 ? 'disabled' : ''}>Show me concepts</button>
        ${data.requests.length ? '<button type="button" class="btn" data-list>Back to my designs</button>' : ''}
      </div>
      ${data.images_left < 3 ? '<p class="notice warn small">This link has used its images. Please ask us for more.</p>' : '<p class="muted small">Free, and nothing is ordered yet.</p>'}
    </form>`;
}

function list() {
  return `
    <section class="portal-intro">
      <h1>Your designs</h1>
      <div class="portal-actions"><button class="btn primary" data-new>Start a new piece</button></div>
    </section>
    <div class="design-list">${data.requests.map(r => {
      const pic = r.concepts[r.chosen ?? 0] || r.concepts[0];
      return `
        <button type="button" class="card-surface design-row" data-open="${esc(r.id)}">
          ${pic && pic.url ? `<img src="${esc(pic.url)}" alt="">` : '<span class="design-row-ph"></span>'}
          <span><b>${esc(r.brief.piece || 'Design')}</b>${r.brief.placement ? ` · ${esc(r.brief.placement)}` : ''}
            <span class="muted small">${esc(day(r.created_at))} · ${r.concepts.length} concepts · ${r.status === 'sent' ? 'sent to us' : 'not sent yet'}</span></span>
        </button>`;
    }).join('')}</div>`;
}

function conceptCard(r, c, i) {
  const key = `${r.id}:${i}`;
  const inRoom = c.room_url && roomView.has(key);
  const sent = r.status === 'sent';
  const hasRoom = r.inputs.some(x => x.role === 'room');
  return `
    <article class="card-surface design-concept${sent && r.chosen === i ? ' chosen' : ''}">
      <div class="design-img">
        <a href="${esc(inRoom ? c.room_url : c.url)}" target="_blank" rel="noopener"><img src="${esc(inRoom ? c.room_url : c.url)}" alt="${esc(`${c.title}${inRoom ? ' in your room' : ''}`)}" loading="lazy"></a>
        ${c.room_url ? `<div class="design-toggle" role="group" aria-label="Picture">
          <button type="button" class="btn small${inRoom ? '' : ' primary'}" data-view="${esc(key)}" data-room="" aria-pressed="${!inRoom}">Concept</button>
          <button type="button" class="btn small${inRoom ? ' primary' : ''}" data-view="${esc(key)}" data-room="1" aria-pressed="${!!inRoom}">In your room</button>
        </div>` : ''}
      </div>
      <div class="pad design-body">
        <h3>${letter(i)} · ${esc(c.title)}${sent && r.chosen === i ? ' <span class="chip">Chosen</span>' : ''}</h3>
        <p class="small">${esc(c.description)}</p>
        ${c.tags.length ? `<div class="design-tags">${c.tags.map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : ''}
        ${sent ? '' : `<div class="design-actions">
          ${hasRoom && !c.room_url ? `<button type="button" class="btn small" data-room-render="${i}" ${busy ? 'disabled' : ''}>See it in my room</button>` : ''}
          <button type="button" class="btn small" data-revise="${i}" ${busy ? 'disabled' : ''}>Change…</button>
          <button type="button" class="btn small primary" data-choose="${i}" ${busy ? 'disabled' : ''}>Choose this one</button>
        </div>`}
      </div>
    </article>`;
}

function designView(r) {
  const sent = r.status === 'sent';
  return `
    <section class="portal-intro">
      <div><button type="button" class="btn small ghost" data-list>← My designs</button></div>
      <h1>${esc(r.brief.piece || 'Your design')}: ${sent ? 'sent' : 'three directions'}</h1>
      ${r.summary ? `<p class="muted">${esc(r.summary)}</p>` : ''}
      ${r.inputs.length ? `<div class="design-sent-pics">${r.inputs.map(x => `<img src="${esc(x.url)}" alt="${esc(x.role === 'room' ? 'Your room' : x.name)}" title="${esc(x.role === 'room' ? 'Your room' : x.name)}">`).join('')}</div>` : ''}
    </section>
    ${sent ? `<p class="notice small">Sent to ${esc(data.company.name)} on ${esc(day(r.sent_at))} by ${esc(r.person)}. We’ll come back to you with a drawing with exact sizes, a price and a timeline.</p>`
      : '<p class="muted small">These show the direction, not the final piece. Exact sizes and details come with our drawing.</p>'}
    ${busy ? busyBar() : ''}
    <div class="design-grid">${r.concepts.map((c, i) => conceptCard(r, c, i)).join('')}</div>`;
}

const busyBar = () => `<div class="card-surface pad design-busy" role="status"><div class="spinner"></div><span>${esc(busy)}</span></div>`;

function render() {
  if (!data) return;
  const r = open && open !== 'new' ? data.requests.find(x => x.id === open) : null;
  const body = r ? designView(r)
    : busy ? `<section class="portal-intro"><h1>Working on your concepts</h1></section>${busyBar()}`
    : open === 'new' || !data.requests.length ? newForm() : list();
  root.innerHTML = `${head()}${body}<p class="muted small portal-foot">Questions? Reply to the message this link came with.</p>`;
}

function setBusy(now, later, after = 20000) {
  clearTimeout(busyTimer);
  busy = now;
  render();
  if (later) busyTimer = setTimeout(() => { if (busy) { busy = later; render(); } }, after);
}
function done() { clearTimeout(busyTimer); busy = ''; render(); }

function replaceRequest(out) {
  const i = data.requests.findIndex(x => x.id === out.request.id);
  if (i >= 0) data.requests[i] = out.request; else data.requests.unshift(out.request);
  if (out.images_left !== undefined) data.images_left = out.images_left;
}

async function reload() {
  try {
    data = await call('load');
    render();
  } catch (err) {
    root.innerHTML = `<div class="card-surface pad portal-error"><h1>This link doesn’t work</h1><p>${esc(err.message)}</p></div>`;
  }
}

// ---------- Actions ----------

function saveForm() {
  const form = $('#new-design');
  if (!form) return;
  const fd = new FormData(form);
  FIELDS.forEach(k => { draft.brief[k] = String(fd.get(k) || '').trim(); });
}

async function makeConcepts() {
  saveForm();
  const brief = { ...draft.brief };
  if (!draft.refs.length && !brief.notes && !brief.materials) { toast('Add a sketch or a reference photo, or describe the piece'); return; }
  const files = [...draft.refs.map(p => [p, 'reference']), ...(draft.room ? [[draft.room, 'room']] : [])];
  try {
    for (const [n, [p]] of files.entries()) {
      if (p.path) continue; // already uploaded on an earlier try
      setBusy(`Uploading photos (${n + 1} of ${files.length})…`);
      const img = await prepare(p.file);
      const up = await call('upload', { mime: 'image/jpeg', data: await toBase64(img.blob) });
      Object.assign(p, { path: up.path, width: img.width, height: img.height });
    }
    setBusy('Reading your brief and photos…', 'Drawing three concepts. This takes about a minute…');
    const out = await call('concepts', { brief, inputs: files.map(([p, role]) => ({ path: p.path, name: p.file.name, role, width: p.width, height: p.height })) });
    replaceRequest(out);
    open = out.request.id;
    draft.refs.concat(draft.room ? [draft.room] : []).forEach(p => URL.revokeObjectURL(p.url));
    draft = emptyDraft();
  } catch (err) {
    toast(err.message);
  }
  done();
}

async function concept(action, r, i, extra = {}) {
  setBusy(action === 'room' ? 'Placing it in your room. This takes up to a minute…' : 'Making the change. This takes up to a minute…');
  try {
    const out = await call(action, { request_id: r.id, index: i, ...extra });
    replaceRequest(out);
    if (action === 'room') roomView.add(`${r.id}:${i}`);
    else toast('Added as a new concept at the end');
  } catch (err) {
    toast(err.message);
  }
  done();
}

function chooseSheet(r, i) {
  const me = getPerson();
  const c = r.concepts[i];
  openSheet(`
    <form>
      ${sheetHeader(`Send ${letter(i)} · ${c.title}`)}
      <div class="fields">
        <p class="muted small">We’ll come back to you with a drawing with exact sizes, a price and a timeline. Nothing is ordered yet.</p>
        <label class="field"><span>Your name</span><input name="person" value="${esc(me.person || '')}" required autocomplete="name"></label>
        <label class="field"><span>Email</span><input type="email" name="email" value="${esc(me.email || '')}" required autocomplete="email" autocapitalize="off"></label>
        <label class="field"><span>Studio</span><input name="studio" value="${esc(me.studio || '')}" autocomplete="organization"></label>
        <label class="field"><span>Anything to add? (optional)</span><textarea name="note" rows="3" placeholder="e.g. Love A, but a little smaller"></textarea></label>
      </div>
      <footer><span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">Send to ${esc(data.company.name)}</button></footer>
    </form>`, {
    async onSubmit(fd) {
      const person = { person: String(fd.get('person') || '').trim(), email: String(fd.get('email') || '').trim(), studio: String(fd.get('studio') || '').trim() };
      setPerson(person);
      try {
        replaceRequest(await call('send', { request_id: r.id, chosen: i, note: fd.get('note'), ...person }));
      } catch (err) {
        toast(err.message);
        return false;
      }
      toast('Sent — thank you');
      render();
    },
  });
}

function reviseSheet(r, i) {
  const c = r.concepts[i];
  openSheet(`
    <form>
      ${sheetHeader(`Change ${letter(i)} · ${c.title}`)}
      <div class="fields">
        <label class="field"><span>What should change?</span><textarea name="note" rows="3" required placeholder="e.g. Make it deeper, in dark bronze"></textarea></label>
        <p class="muted small">The changed version is added as a new concept, so you can compare them.</p>
      </div>
      <footer><span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">Make the change</button></footer>
    </form>`, {
    onSubmit(fd) { setTimeout(() => concept('revise', r, i, { note: fd.get('note') }), 0); },
  });
}

root.addEventListener('submit', e => {
  if (e.target.id !== 'new-design') return;
  e.preventDefault();
  if (!busy) makeConcepts();
});

root.addEventListener('change', e => {
  const pick = e.target.closest('[data-pick]');
  if (!pick) return;
  const kind = pick.dataset.pick;
  const files = [...pick.files].filter(f => /^image\//.test(f.type) || /\.(heic|heif)$/i.test(f.name));
  pick.value = '';
  if (!files.length) return;
  saveForm();
  const wrap = f => ({ file: f, url: URL.createObjectURL(f) });
  if (kind === 'room') {
    if (draft.room) URL.revokeObjectURL(draft.room.url);
    draft.room = wrap(files[0]);
  } else {
    const room = MAX_REFS - draft.refs.length;
    if (files.length > room) toast(`Up to ${MAX_REFS} sketches or reference photos`);
    draft.refs.push(...files.slice(0, room).map(wrap));
  }
  render();
});

root.addEventListener('click', e => {
  const r = open && open !== 'new' && data ? data.requests.find(x => x.id === open) : null;
  const t = e.target;
  if (t.closest('[data-new]')) { open = 'new'; render(); return; }
  if (t.closest('[data-list]')) { saveForm(); open = null; render(); return; }
  const o = t.closest('[data-open]');
  if (o) { open = o.dataset.open; render(); window.scrollTo(0, 0); return; }
  const un = t.closest('[data-unpick]');
  if (un) {
    saveForm();
    const [kind, i] = un.dataset.unpick.split(':');
    const gone = kind === 'room' ? draft.room : draft.refs.splice(Number(i), 1)[0];
    if (kind === 'room') draft.room = null;
    if (gone) URL.revokeObjectURL(gone.url);
    render();
    return;
  }
  const v = t.closest('[data-view]');
  if (v) { if (v.dataset.room) roomView.add(v.dataset.view); else roomView.delete(v.dataset.view); render(); return; }
  if (!r || busy) return;
  const room = t.closest('[data-room-render]');
  if (room) { concept('room', r, Number(room.dataset.roomRender)); return; }
  const rev = t.closest('[data-revise]');
  if (rev) { reviseSheet(r, Number(rev.dataset.revise)); return; }
  const ch = t.closest('[data-choose]');
  if (ch) chooseSheet(r, Number(ch.dataset.choose));
});

initSheet();
if (!token) root.innerHTML = '<div class="card-surface pad portal-error"><h1>Link not complete</h1><p>Please open the full link you received.</p></div>';
else reload();
