// Social (Demya): LinkedIn & Instagram posts drafted with AI, a week of post ideas from real projects,
// and the people to build a network with. Claude writes through the Supabase Edge Function
// "social-writer" (supabase/functions/social-writer). Nothing is posted or sent from here: the team
// edits and approves every draft, then shares it through the LinkedIn / Instagram apps.
import {
  STAGES, esc, icon, toast, openSheet, closeSheet, sheetHeader, options, label, todayStr, addDays, $, $$,
} from './lib.js';
import { store, productsOf, nextSortOrder } from './store.js';
import { isImage, fileUrls, uploadFiles } from './files.js';
import { ui, setUi } from './ui-state.js';

export const SOCIAL_COMPANY = 'demya';

export const PLATFORMS = [
  { id: 'linkedin', label: 'LinkedIn', limit: 3000, open: text => `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(text)}` },
  { id: 'instagram', label: 'Instagram', limit: 2200, open: () => 'https://www.instagram.com/' },
];
export const POST_STATUSES = [
  { id: 'draft', label: 'Draft' },
  { id: 'approved', label: 'Ready to post' },
  { id: 'posted', label: 'Posted' },
];
export const CONTACT_STATUSES = [
  { id: 'to_connect', label: 'To connect' },
  { id: 'requested', label: 'Request sent' },
  { id: 'connected', label: 'Connected' },
  { id: 'talking', label: 'In conversation' },
  { id: 'client', label: 'Client' },
];
export const CONTACT_CATEGORIES = [
  { id: 'architect', label: 'Architect' },
  { id: 'interior', label: 'Interior designer' },
  { id: 'hospitality', label: 'Hotel / restaurant' },
  { id: 'developer', label: 'Developer / real estate' },
  { id: 'retail', label: 'Retail / showroom' },
  { id: 'press', label: 'Press / blogger' },
  { id: 'supplier', label: 'Workshop / supplier' },
  { id: 'other', label: 'Other' },
];
const CONTACT_PLATFORMS = [
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'both', label: 'Both' },
];
const LANGUAGES = [{ id: 'en', label: 'English' }, { id: 'nl', label: 'Nederlands' }];

// After a status change, when to follow up (days), unless a date is already set.
const FOLLOW_UP_AFTER = { requested: 7, connected: 3, talking: 14 };

const clean = v => String(v == null ? '' : v).trim();
const aiPhoto = a => /^image\/(jpeg|png|gif|webp)$/.test(a.mime || '');

export const socialCompany = () => store.get('companies', SOCIAL_COMPANY);
export const socialPosts = () => store.all('social_posts').filter(p => p.company_id === SOCIAL_COMPANY);
export const socialContacts = () => store.all('social_contacts').filter(c => c.company_id === SOCIAL_COMPANY);
export const socialLang = () => ui.socialLang || 'en';
export const platformChip = id => `<span class="chip pf-${esc(id)}">${esc(label(PLATFORMS, id))}</span>`;
export const postText = (body, hashtags) => [clean(body), clean(hashtags)].filter(Boolean).join('\n\n');

const demyaProjects = () => store.all('projects')
  .filter(p => p.company_id === SOCIAL_COMPANY && p.status !== 'cancelled')
  .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
const projectPhotos = projectId => store.all('attachments')
  .filter(a => a.project_id === projectId && isImage(a))
  .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

// What the AI is told about an order. The client's name is left out on purpose.
function projectBrief(p) {
  const products = productsOf(p.id);
  return [
    `Project id: ${p.id}`,
    `Name: ${p.name}`,
    `Stage: ${label(STAGES, p.stage)}${p.status === 'completed' ? ' (completed)' : ''}`,
    clean(p.description) && `Brief: ${clean(p.description).slice(0, 600)}`,
    products.length && `Products:\n${products.map(i => `- ${i.name}${Number(i.quantity) > 1 ? ` ×${Number(i.quantity)}` : ''}${[i.dimensions, i.materials].filter(x => clean(x)).length ? ` — ${[i.dimensions, i.materials].filter(x => clean(x)).join(' — ')}` : ''}`).join('\n')}`,
  ].filter(Boolean).join('\n');
}

function aiError(err) {
  if (err.demo) return 'Writing with AI works when you are signed in to the team database. In demo mode, write the post by hand.';
  if (err.notSetUp) return 'AI writing isn’t switched on yet. It needs the “social-writer” function in Supabase — see “Social posts with AI” in the README.';
  return `The AI couldn’t write this: ${err.message || err}`;
}

async function writer(body) {
  const company = socialCompany();
  const data = await store.backend.socialWriter({ voice: (company && company.social_voice) || '', language: socialLang(), ...body });
  if (!data || !data.result) throw new Error((data && data.error) || 'No answer from the AI');
  return data.result;
}

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => toast('Copied — paste it in the app'), () => toast('Couldn’t copy — select the text and copy it'));
  } else {
    toast('Couldn’t copy — select the text and copy it');
  }
}

// ---------------------------------------------------------------------
// Post
// ---------------------------------------------------------------------

export function openPostSheet(existing, defaults = {}) {
  const post = existing || {
    platform: null, status: 'draft', title: '', idea: '', body: '', hashtags: '', photo_ids: [],
    project_id: null, language: socialLang(), scheduled_for: null, posted_url: '', ...defaults,
  };
  const platforms = existing ? [existing.platform] : (defaults.platform ? [defaults.platform] : ['linkedin', 'instagram']);
  const projects = demyaProjects();
  const selected = new Set(post.photo_ids || []);
  let shareFiles = null; // photos prepared for the iPad share sheet (it must open straight from the tap)

  const photoPicker = projectId => {
    if (!projectId) return `<p class="muted small">Link an order to choose its photos.</p>`;
    const photos = projectPhotos(projectId);
    return `
      <div class="photo-pick">
        ${photos.map(a => `
          <label class="photo-opt" title="${esc(a.name)}">
            <input type="checkbox" name="photo" value="${a.id}" ${selected.has(a.id) ? 'checked' : ''}>
            <span class="file-thumb"><img data-path="${esc(a.path)}" alt="" loading="lazy"></span>
            <span class="photo-check">${icon.check}</span>
          </label>`).join('')}
        <label class="btn upload-btn photo-add">${icon.upload}<span>Add photos</span><input type="file" accept="image/*" multiple hidden data-post-upload></label>
      </div>
      ${photos.length ? '' : `<p class="muted small">No photos on this order yet — add some.</p>`}`;
  };

  const block = pf => {
    const isPost = existing || platforms.includes(pf.id);
    return `
      <div class="post-block" data-block="${pf.id}" ${isPost ? '' : 'hidden'}>
        <h3 class="sheet-sub">${platformChip(pf.id)} post</h3>
        <label class="field"><span>Text</span><textarea name="body_${pf.id}" rows="9">${esc(existing ? post.body : '')}</textarea></label>
        <label class="field"><span>Hashtags</span><input name="tags_${pf.id}" value="${esc(existing ? post.hashtags : '')}" placeholder="#dutchdesign #customfurniture"></label>
        <div class="muted small" data-count="${pf.id}"></div>
      </div>`;
  };

  openSheet(`
    <form class="post-sheet">
      ${sheetHeader(existing ? `${label(PLATFORMS, post.platform)} post` : 'New post')}
      <div class="fields">
        ${existing ? `
          <div class="post-actions">
            <button type="button" class="btn small" data-post="copy">Copy text</button>
            <button type="button" class="btn small" data-post="share">Share with photos…</button>
            <button type="button" class="btn small" data-post="open">${icon.external} Open ${esc(label(PLATFORMS, post.platform))}</button>
          </div>` : `
          <div class="field"><span>Post on</span>
            <div class="segmented big-seg two">
              ${PLATFORMS.map(pf => `<label class="seg-opt"><input type="checkbox" name="pf" value="${pf.id}" ${platforms.includes(pf.id) ? 'checked' : ''}><span>${esc(pf.label)}</span></label>`).join('')}
            </div>
          </div>`}
        <div class="field-row">
          <label class="field"><span>About the order</span>
            <select name="project_id">${options(projects.map(p => ({ id: p.id, label: p.name })), post.project_id, { empty: '— General post —' })}</select></label>
          <label class="field"><span>Language</span><select name="language">${options(LANGUAGES, post.language)}</select></label>
        </div>
        <label class="field"><span>What’s this post about?</span>
          <textarea name="idea" rows="3" placeholder="e.g. The oak conference table just left the workshop — show the joinery and the steel base.">${esc(post.idea || '')}</textarea></label>
        <div class="field"><span>Photos</span><div data-photos>${photoPicker(post.project_id)}</div></div>
        <div class="ai-row">
          <button type="button" class="btn" data-ai-write>✨ ${existing ? 'Rewrite' : 'Write'} with AI</button>
          <span class="muted small" data-ai-status></span>
        </div>
        ${PLATFORMS.map(block).join('')}
        <div class="field-row">
          <label class="field"><span>Label in the queue</span><input name="title" value="${esc(post.title)}" placeholder="e.g. Oak table — joinery close-up"></label>
          <label class="field"><span>Planned for</span><input type="date" name="scheduled_for" value="${esc(post.scheduled_for || '')}"></label>
        </div>
        <div class="field-row">
          <label class="field"><span>Status</span><select name="status">${options(POST_STATUSES, post.status)}</select></label>
          ${existing ? `<label class="field"><span>Link to the live post</span><input name="posted_url" type="url" value="${esc(post.posted_url || '')}" placeholder="https://"></label>` : ''}
        </div>
      </div>
      <footer>
        ${existing ? `<button type="button" class="btn danger" data-delete>Delete</button>` : ''}
        <span class="spacer"></span>
        <button type="button" class="btn" data-close>Cancel</button>
        <button type="submit" class="btn primary">Save</button>
      </footer>
    </form>`, {
    wide: true,
    onOpen(sheet) {
      const form = $('form', sheet);
      const checkedPlatforms = () => existing ? [existing.platform] : $$('[name=pf]:checked', form).map(i => i.value);
      const pickedPhotos = () => $$('[name=photo]:checked', form).map(i => store.get('attachments', i.value)).filter(Boolean);
      const currentText = () => postText(form.elements[`body_${post.platform}`].value, form.elements[`tags_${post.platform}`].value);

      const counts = () => PLATFORMS.forEach(pf => {
        const n = postText(form.elements[`body_${pf.id}`].value, form.elements[`tags_${pf.id}`].value).length;
        const tags = (form.elements[`tags_${pf.id}`].value.match(/#/g) || []).length;
        const el = $(`[data-count=${pf.id}]`, form);
        el.textContent = `${n} / ${pf.limit} characters${tags ? ` · ${tags} hashtag${tags === 1 ? '' : 's'}` : ''}${pf.id === 'instagram' && tags > 30 ? ' — Instagram allows 30' : ''}`;
        el.classList.toggle('bad-text', n > pf.limit || (pf.id === 'instagram' && tags > 30));
      });
      const prepareShare = async () => {
        shareFiles = null;
        const atts = pickedPhotos();
        if (!atts.length) { shareFiles = []; return; }
        try {
          const urls = await fileUrls(atts.map(a => a.path));
          const files = [];
          for (const a of atts) {
            if (!urls[a.path]) continue;
            const blob = await (await fetch(urls[a.path])).blob();
            files.push(new File([blob], a.name, { type: blob.type || a.mime }));
          }
          shareFiles = files;
        } catch (err) {
          console.warn('Could not prepare photos for sharing', err);
          shareFiles = [];
        }
      };
      const refreshPhotos = () => { $('[data-photos]', form).innerHTML = photoPicker(form.elements.project_id.value); };

      form.addEventListener('input', counts);
      form.addEventListener('change', async e => {
        const t = e.target;
        if (t.name === 'pf') PLATFORMS.forEach(pf => { $(`[data-block=${pf.id}]`, form).hidden = !checkedPlatforms().includes(pf.id); });
        if (t.name === 'project_id') { selected.clear(); refreshPhotos(); }
        if (t.name === 'photo') { if (t.checked) selected.add(t.value); else selected.delete(t.value); if (existing) prepareShare(); }
        if (t.matches('[data-post-upload]') && t.files.length) {
          const projectId = form.elements.project_id.value;
          const files = [...t.files];
          t.value = '';
          const saved = await uploadFiles(files, { project_id: projectId, kind: 'general' });
          saved.forEach(a => selected.add(a.id));
          if (form.isConnected) { refreshPhotos(); if (existing) prepareShare(); }
        }
      });
      counts();
      if (existing) prepareShare();

      $('[data-ai-write]', form).addEventListener('click', async e => {
        const btn = e.currentTarget;
        const status = $('[data-ai-status]', form);
        const pfs = checkedPlatforms();
        if (!pfs.length) { toast('Choose LinkedIn, Instagram or both'); return; }
        const project = store.get('projects', form.elements.project_id.value);
        const idea = clean(form.elements.idea.value) || clean(form.elements.title.value);
        if (!idea && !project) { toast('Say what the post is about, or link an order'); return; }
        btn.disabled = true;
        status.textContent = 'Writing… this takes 10–40 seconds.';
        try {
          const result = await writer({
            mode: 'posts',
            platforms: pfs,
            idea,
            project: project ? projectBrief(project) : '',
            photos: pickedPhotos().filter(aiPhoto).map(a => a.path),
            language: form.elements.language.value,
          });
          if (!form.isConnected) return;
          (result.posts || []).forEach(r => {
            if (!pfs.includes(r.platform)) return;
            form.elements[`body_${r.platform}`].value = clean(r.body);
            form.elements[`tags_${r.platform}`].value = clean(r.hashtags);
            if (!clean(form.elements.title.value) && clean(r.title)) form.elements.title.value = clean(r.title);
          });
          status.textContent = 'Done — read it through and make it yours before posting.';
          counts();
        } catch (err) {
          console.error(err);
          if (form.isConnected) status.innerHTML = `<span class="bad-text">${esc(aiError(err))}</span>`;
        } finally {
          btn.disabled = false;
        }
      });

      $$('[data-post]', form).forEach(b => b.addEventListener('click', () => {
        const text = currentText();
        const pf = PLATFORMS.find(x => x.id === post.platform);
        if (b.dataset.post === 'copy') copyText(text);
        else if (b.dataset.post === 'open') {
          if (pf.id === 'instagram') copyText(text);
          window.open(pf.open(text), '_blank', 'noopener');
        } else if (b.dataset.post === 'share') {
          if (shareFiles === null) { toast('Getting the photos ready — tap again in a moment'); return; }
          const data = shareFiles.length ? { files: shareFiles, text } : { text };
          // Instagram drops shared text, so the caption also goes on the clipboard to paste.
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(() => {});
          if (navigator.share && (!navigator.canShare || navigator.canShare(data))) {
            navigator.share(data).then(() => offerPosted(existing), err => { if (err.name !== 'AbortError') toast('Couldn’t share — the text is copied'); });
          } else {
            copyText(text);
          }
        }
      }));

      const del = $('[data-delete]', form);
      if (del) del.addEventListener('click', () => {
        if (!confirm('Delete this post?')) return;
        closeSheet();
        store.remove('social_posts', existing.id).catch(() => {});
      });
    },
    async onSubmit(fd) {
      const pfs = existing ? [existing.platform] : fd.getAll('pf');
      if (!pfs.length) { toast('Choose LinkedIn, Instagram or both'); return false; }
      const idea = clean(fd.get('idea'));
      const status = fd.get('status');
      const base = {
        project_id: fd.get('project_id') || null,
        language: fd.get('language'),
        idea,
        photo_ids: fd.getAll('photo'),
        scheduled_for: fd.get('scheduled_for') || null,
        status,
      };
      if (existing) {
        const patch = {
          ...base,
          title: clean(fd.get('title')) || existing.title,
          body: clean(fd.get(`body_${existing.platform}`)),
          hashtags: clean(fd.get(`tags_${existing.platform}`)),
          posted_url: clean(fd.get('posted_url')),
        };
        if (status === 'posted' && !existing.posted_at) patch.posted_at = new Date().toISOString();
        if (status !== 'posted') patch.posted_at = null;
        store.update('social_posts', existing.id, patch).catch(() => {});
        return;
      }
      const fallbackTitle = s => clean(s).split('\n')[0].split(/\s+/).slice(0, 8).join(' ');
      let order = nextSortOrder(socialPosts());
      let made = 0;
      for (const pf of pfs) {
        const body = clean(fd.get(`body_${pf}`));
        const title = clean(fd.get('title')) || fallbackTitle(idea) || fallbackTitle(body);
        if (!title && !body) continue;
        made++;
        store.insert('social_posts', {
          ...base,
          company_id: SOCIAL_COMPANY,
          platform: pf,
          title,
          body,
          hashtags: clean(fd.get(`tags_${pf}`)),
          posted_at: status === 'posted' ? new Date().toISOString() : null,
          sort_order: order++,
        }).catch(() => {});
      }
      if (!made) { toast('Write the post, or say what it’s about'); return false; }
      toast(made === 1 ? 'Post saved' : `${made} posts saved`);
    },
  });
}

function offerPosted(post) {
  if (post.status === 'posted') return;
  toast('Shared. Mark it as posted?', {
    label: 'Posted',
    run: () => store.update('social_posts', post.id, { status: 'posted', posted_at: new Date().toISOString() }).catch(() => {}),
  });
}

export function markPostPosted(post) {
  store.update('social_posts', post.id, { status: 'posted', posted_at: new Date().toISOString() })
    .then(() => toast('Marked as posted'))
    .catch(() => {});
}

// ---------------------------------------------------------------------
// A week of ideas
// ---------------------------------------------------------------------

let ideasTicket = 0;

export async function openIdeasSheet() {
  const ticket = ++ideasTicket;
  openSheet(`
    <div>
      ${sheetHeader('Ideas for this week')}
      <div class="ai-wait">
        <div class="spinner"></div>
        <p><b>Looking at Demya’s orders…</b></p>
        <p class="muted small">This usually takes 10–40 seconds.</p>
      </div>
      <footer><span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button></footer>
    </div>`, { onClose() { if (ticket === ideasTicket) ideasTicket++; } });

  const projects = demyaProjects().slice(0, 15);
  const recent = socialPosts().sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 20)
    .map(p => `- ${label(PLATFORMS, p.platform)}: ${p.title || clean(p.body).slice(0, 80)}`).join('\n');
  let result;
  try {
    result = await writer({ mode: 'ideas', count: 6, projects: projects.map(projectBrief).join('\n\n'), recent });
  } catch (err) {
    if (ticket !== ideasTicket) return;
    console.error(err);
    openSheet(`
      <div>
        ${sheetHeader('Ideas for this week')}
        <p class="ai-problem">${esc(aiError(err))}</p>
        <footer><span class="spacer"></span><button type="button" class="btn primary" data-close>OK</button></footer>
      </div>`);
    return;
  }
  if (ticket !== ideasTicket) return;
  const ideas = (result.ideas || []).filter(i => clean(i.title));
  const projectOf = i => (store.get('projects', clean(i.project_id)) || {}).company_id === SOCIAL_COMPANY ? clean(i.project_id) : '';

  openSheet(`
    <form class="ai-review">
      ${sheetHeader('Ideas for this week')}
      <div class="fields">
        <p class="muted small">Tick the ideas you like and add them to the queue, or tap “Write now” to draft one straight away.</p>
        ${ideas.length ? `<div class="ai-lines">${ideas.map((idea, i) => {
          const p = store.get('projects', projectOf(idea));
          return `
          <div class="ai-line">
            <input type="checkbox" name="pick_${i}" checked aria-label="Add this idea">
            <div class="ai-line-fields">
              <div class="idea-head">${platformChip(idea.platform)}${p ? `<span class="muted small">${esc(p.name)}</span>` : ''}</div>
              <label class="field"><span>Idea</span><input name="title_${i}" value="${esc(idea.title)}"></label>
              <label class="field"><span>What to show and say</span><textarea name="angle_${i}" rows="2">${esc(idea.angle || '')}</textarea></label>
              <div><button type="button" class="btn small" data-write="${i}">✨ Write now</button></div>
            </div>
          </div>`;
        }).join('')}</div>` : `<p class="muted small">No ideas came back — try again, or add a few orders with photos first.</p>`}
      </div>
      <footer>
        <span class="spacer"></span>
        <button type="button" class="btn" data-close>Cancel</button>
        <button type="submit" class="btn primary">Add to queue</button>
      </footer>
    </form>`, {
    wide: true,
    onOpen(sheet) {
      $$('[data-write]', sheet).forEach(b => b.addEventListener('click', () => {
        const i = Number(b.dataset.write);
        const form = $('form', sheet);
        const idea = ideas[i];
        openPostSheet(null, {
          platform: idea.platform,
          project_id: projectOf(idea) || null,
          title: clean(form.elements[`title_${i}`].value),
          idea: clean(form.elements[`angle_${i}`].value) || clean(form.elements[`title_${i}`].value),
        });
      }));
    },
    onSubmit(fd) {
      let order = nextSortOrder(socialPosts());
      let n = 0;
      ideas.forEach((idea, i) => {
        const title = clean(fd.get(`title_${i}`));
        if (fd.get(`pick_${i}`) !== 'on' || !title) return;
        n++;
        store.insert('social_posts', {
          company_id: SOCIAL_COMPANY,
          platform: idea.platform === 'instagram' ? 'instagram' : 'linkedin',
          project_id: projectOf(idea) || null,
          status: 'draft',
          title,
          idea: clean(fd.get(`angle_${i}`)),
          language: socialLang(),
          sort_order: order++,
        }).catch(() => {});
      });
      toast(n ? `Added ${n} idea${n === 1 ? '' : 's'} to the drafts` : 'Nothing added');
    },
  });
}

// ---------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------

export function openVoiceSheet() {
  const c = socialCompany();
  if (!c) { toast('Demya isn’t set up as a company yet'); return; }
  openSheet(`
    <form>
      ${sheetHeader('Demya’s voice')}
      <div class="fields">
        <p class="muted small">The AI writes every post and message in this voice. Say who you want to reach, how you sound, and what to always or never say.</p>
        <label class="field"><span>Voice and audience</span>
          <textarea name="social_voice" rows="8" placeholder="e.g. We speak to interior architects and boutique hotels in the Netherlands and Belgium. Calm, precise, proud of Dutch craftsmanship. Mention the workshop by name when we can. Never talk about price.">${esc(c.social_voice || '')}</textarea></label>
        <label class="field"><span>Write posts in</span><select name="language">${options(LANGUAGES, socialLang())}</select></label>
      </div>
      <footer><span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">Save</button></footer>
    </form>`, {
    onSubmit(fd) {
      setUi({ socialLang: fd.get('language') });
      const voice = clean(fd.get('social_voice'));
      if (voice !== (c.social_voice || '')) store.update('companies', c.id, { social_voice: voice }).then(() => toast('Voice saved')).catch(() => {});
    },
  });
}

// ---------------------------------------------------------------------
// Network contact
// ---------------------------------------------------------------------

export function openSocialContactSheet(existing) {
  const c = existing || {
    name: '', role: '', organisation: '', category: 'architect', platform: 'linkedin', profile_url: '',
    status: 'to_connect', message: '', next_follow_up: null, notes: '',
  };
  const kindFor = status => (status === 'to_connect' || status === 'requested' ? 'connect' : 'follow_up');

  openSheet(`
    <form>
      ${sheetHeader(existing ? c.name : 'Add a person')}
      <div class="fields">
        <div class="field-row">
          <label class="field"><span>Name</span><input name="name" value="${esc(c.name)}" required ${existing ? '' : 'autofocus'}></label>
          <label class="field"><span>Role</span><input name="role" value="${esc(c.role)}" placeholder="e.g. Interior architect"></label>
        </div>
        <div class="field-row">
          <label class="field"><span>Organisation</span><input name="organisation" value="${esc(c.organisation)}"></label>
          <label class="field"><span>Type</span><select name="category">${options(CONTACT_CATEGORIES, c.category)}</select></label>
        </div>
        <div class="field-row">
          <label class="field"><span>Profile link</span><input name="profile_url" type="url" value="${esc(c.profile_url)}" placeholder="https://www.linkedin.com/in/…"></label>
          <label class="field"><span>Where</span><select name="platform">${options(CONTACT_PLATFORMS, c.platform)}</select></label>
        </div>
        <div class="field-row">
          <label class="field"><span>Status</span><select name="status">${options(CONTACT_STATUSES, c.status)}</select></label>
          <label class="field"><span>Follow up on</span><input type="date" name="next_follow_up" value="${esc(c.next_follow_up || '')}"></label>
        </div>
        <label class="field"><span>Notes (what they work on, where you met, shared interests)</span><textarea name="notes" rows="3">${esc(c.notes)}</textarea></label>
        <label class="field"><span>Message</span><textarea name="message" rows="5" placeholder="Your connection note or follow-up message">${esc(c.message)}</textarea></label>
        <div class="ai-row">
          <button type="button" class="btn small" data-ai-msg>✨ <span data-ai-label>${kindFor(c.status) === 'connect' ? 'Write connection note' : 'Write follow-up'}</span></button>
          <button type="button" class="btn small" data-copy-msg>Copy message</button>
          <button type="button" class="btn small" data-open-profile>${icon.external} Open profile</button>
          <span class="muted small" data-ai-status></span>
        </div>
        <p class="muted small">Send it yourself from the profile: LinkedIn and Instagram block accounts that send requests automatically. 10–20 personal requests a day grows a network fast and safely.</p>
      </div>
      <footer>
        ${existing ? `<button type="button" class="btn danger" data-delete>Delete</button>` : ''}
        <span class="spacer"></span>
        <button type="button" class="btn" data-close>Cancel</button>
        <button type="submit" class="btn primary">Save</button>
      </footer>
    </form>`, {
    onOpen(sheet) {
      const form = $('form', sheet);
      form.elements.status.addEventListener('change', () => {
        $('[data-ai-label]', form).textContent = kindFor(form.elements.status.value) === 'connect' ? 'Write connection note' : 'Write follow-up';
      });
      $('[data-copy-msg]', form).addEventListener('click', () => {
        const m = clean(form.elements.message.value);
        if (m) copyText(m); else toast('Write a message first');
      });
      $('[data-open-profile]', form).addEventListener('click', () => {
        const url = clean(form.elements.profile_url.value);
        if (!/^https?:\/\//i.test(url)) { toast('Add their profile link first'); return; }
        const m = clean(form.elements.message.value);
        if (m && navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(m).catch(() => {});
        window.open(url, '_blank', 'noopener');
      });
      $('[data-ai-msg]', form).addEventListener('click', async e => {
        const btn = e.currentTarget;
        const status = $('[data-ai-status]', form);
        const f = form.elements;
        if (!clean(f.name.value)) { toast('Add their name first'); return; }
        btn.disabled = true;
        status.textContent = 'Writing…';
        try {
          const result = await writer({
            mode: 'message',
            kind: kindFor(f.status.value),
            contact: [
              `Name: ${clean(f.name.value)}`,
              clean(f.role.value) && `Role: ${clean(f.role.value)}`,
              clean(f.organisation.value) && `Organisation: ${clean(f.organisation.value)}`,
              `Type: ${label(CONTACT_CATEGORIES, f.category.value)}`,
              `Status: ${label(CONTACT_STATUSES, f.status.value)}`,
              clean(f.notes.value) && `Notes: ${clean(f.notes.value)}`,
            ].filter(Boolean).join('\n'),
          });
          if (!form.isConnected) return;
          f.message.value = clean(result.message);
          status.textContent = 'Make it sound like you, then send it from their profile.';
        } catch (err) {
          console.error(err);
          if (form.isConnected) status.innerHTML = `<span class="bad-text">${esc(aiError(err))}</span>`;
        } finally {
          btn.disabled = false;
        }
      });
      const del = $('[data-delete]', form);
      if (del) del.addEventListener('click', () => {
        if (!confirm(`Delete ${existing.name}?`)) return;
        closeSheet();
        store.remove('social_contacts', existing.id).catch(() => {});
      });
    },
    onSubmit(fd) {
      const row = {
        name: clean(fd.get('name')),
        role: clean(fd.get('role')),
        organisation: clean(fd.get('organisation')),
        category: fd.get('category'),
        platform: fd.get('platform'),
        profile_url: clean(fd.get('profile_url')),
        status: fd.get('status'),
        next_follow_up: fd.get('next_follow_up') || null,
        notes: clean(fd.get('notes')),
        message: clean(fd.get('message')),
      };
      if (row.status !== c.status && !row.next_follow_up && FOLLOW_UP_AFTER[row.status]) {
        row.next_follow_up = addDays(todayStr(), FOLLOW_UP_AFTER[row.status]);
      }
      if (row.status === 'client' && row.status !== c.status) row.next_follow_up = null;
      if (existing) store.update('social_contacts', existing.id, row).catch(() => {});
      else store.insert('social_contacts', { ...row, company_id: SOCIAL_COMPANY }).catch(() => {});
    },
  });
}

// One tap on the Network list: move someone to the next step.
export function advanceContact(c) {
  const i = CONTACT_STATUSES.findIndex(s => s.id === c.status);
  const next = CONTACT_STATUSES[Math.min(i + 1, CONTACT_STATUSES.length - 1)];
  if (!next || next.id === c.status) return;
  const patch = { status: next.id };
  patch.next_follow_up = FOLLOW_UP_AFTER[next.id] ? addDays(todayStr(), FOLLOW_UP_AFTER[next.id]) : null;
  store.update('social_contacts', c.id, patch).then(() => toast(`${c.name}: ${next.label}`)).catch(() => {});
}
