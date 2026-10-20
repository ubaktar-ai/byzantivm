// Design studio links (Team screen): a private link per designer (design.html#<token>), and what designers sent.
// The page itself and the AI images are served by the "design-studio" Supabase function.
import { esc, fmtDate, openSheet, sheetHeader, options, toast, $ } from '../lib.js';
import { store, companies } from '../store.js';
import { newToken } from './qc-more.js';

const byNewest = (a, b) => (a.created_at < b.created_at ? 1 : -1);
export const designUrl = link => `${location.origin}${location.pathname.replace(/[^/]*$/, '')}design.html#${link.token}`;
const companyName = id => (companies().find(c => c.id === id) || {}).name || id;

export function designLinksCard() {
  if (store.missing.has('design_links')) {
    return `
      <div class="card-surface pad">
        <h3 class="card-title">Design studio links</h3>
        <p class="notice warn small">To make design links for designers, run <code>supabase/migrations/012_design_studio.sql</code> in the Supabase SQL Editor (see “Design studio” in the README).</p>
      </div>`;
  }
  const links = store.all('design_links').sort(byNewest);
  const requests = store.all('design_requests').sort(byNewest);
  const sent = requests.filter(r => r.status === 'sent');
  const drafts = requests.length - sent.length;
  return `
    <div class="card-surface pad">
      <h3 class="card-title">Design studio links</h3>
      ${store.backend.mode === 'cloud' ? '' : '<p class="notice warn small">Links only work with the team database, not in demo mode.</p>'}
      <p class="muted small">A private link for a designer (no account needed). They upload a sketch, references and a photo of the room, get three concept images from the AI, can see one in their room, and send their choice to you. Each AI image costs a few cents, so every link has an image limit.</p>
      ${links.length ? `<div class="qc-rows">${links.map(l => `
        <div class="qc-row static">
          <span><b>${esc(l.label || 'Designer')}</b><span class="muted small"> · ${esc(companyName(l.company_id))} · ${l.images_used} of ${l.image_limit} images · made ${esc(fmtDate(l.created_at.slice(0, 10)))}</span></span>
          ${l.revoked_at ? '<span class="chip">Switched off</span>' : `<span class="qc-actions" style="margin:0">
            <button class="btn small" data-action="design-link-share" data-id="${l.id}">Share</button>
            <button class="btn small" data-action="design-link-more" data-id="${l.id}">+ Images</button>
            <button class="btn small" data-action="design-link-revoke" data-id="${l.id}">Switch off</button></span>`}
        </div>`).join('')}</div>` : ''}
      ${sent.length ? `<h4 class="price-links-title">Sent by designers</h4><div class="qc-rows">${sent.map(r => {
        const link = store.get('design_links', r.link_id);
        const c = (r.concepts || [])[r.chosen] || {};
        return `<button type="button" class="qc-row" data-action="design-request-view" data-id="${r.id}">
          <span><b>${esc(r.person || (link && link.label) || 'Designer')}</b>${r.studio ? ` · ${esc(r.studio)}` : ''}<span class="muted small"> · ${esc(r.brief.piece || 'Design')}${c.title ? `, chose ${esc(c.title)}` : ''}</span></span>
          <span class="muted small">${esc(fmtDate((r.sent_at || r.created_at).slice(0, 10)))}</span></button>`;
      }).join('')}</div>` : ''}
      ${drafts ? `<p class="muted small">${drafts} design${drafts === 1 ? '' : 's'} started but not sent yet. <button type="button" class="btn small ghost" data-action="design-drafts">Show</button></p>` : ''}
      <div class="qc-actions">${store.backend.mode === 'cloud' ? '<button class="btn small" data-action="design-link-new">New design link</button>' : ''}</div>
    </div>`;
}

function openNewLink() {
  const demya = companies().find(c => /demya/i.test(c.name)) || companies()[0];
  openSheet(`
    <form>
      ${sheetHeader('New design link')}
      <div class="fields">
        <label class="field"><span>Who is it for?</span><input name="label" required placeholder="e.g. Studio Noord — Anna"></label>
        <div class="field-row">
          <label class="field"><span>Company</span><select name="company_id">${options(companies().map(c => ({ id: c.id, label: c.name })), demya && demya.id)}</select></label>
          <label class="field"><span>Image limit</span><input name="image_limit" inputmode="numeric" value="60"></label>
        </div>
        <p class="muted small">Each design uses about 3–6 images (three concepts, plus one for each “see it in my room” or change). At roughly $0.07 per image, 60 images is about $4. Links need the one-time “design-studio” setup in Supabase (see the README).</p>
      </div>
      <footer><span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">Create link</button></footer>
    </form>`, {
    async onSubmit(fd) {
      const limit = Math.max(0, Math.min(1000, parseInt(String(fd.get('image_limit') || '60'), 10) || 0));
      let link;
      try {
        link = await store.insert('design_links', { token: newToken(), label: String(fd.get('label') || '').trim(), company_id: fd.get('company_id'), image_limit: limit });
      } catch (err) { return false; }
      setTimeout(() => shareDesignLink(store.get('design_links', link.id) || link), 50);
    },
  });
}

function shareDesignLink(link) {
  const url = designUrl(link);
  const text = `Here’s a private link to design a custom piece with ${companyName(link.company_id)}: upload a sketch and a photo of the room, and you’ll see concept images in about a minute.`;
  openSheet(`
    <div>
      ${sheetHeader(`Design link — ${link.label || 'Designer'}`)}
      <div class="fields">
        <input class="link-box" readonly value="${esc(url)}">
        <p class="muted small">Anyone with this link can make AI images until its limit (${link.image_limit - link.images_used} left), so share it only with this designer. You can switch it off any time.</p>
      </div>
      <footer><span class="spacer"></span>
        <a class="btn" href="${esc(url)}" target="_blank" rel="noopener">Open</a>
        <button type="button" class="btn" data-copy>Copy</button>
        ${navigator.share ? '<button type="button" class="btn primary" data-share>Share…</button>' : ''}
      </footer>
    </div>`, {
    onOpen(sheet) {
      $('[data-copy]', sheet).addEventListener('click', () => {
        (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast('Link copied')).catch(() => { $('.link-box', sheet).select(); toast('Select and copy the link'); });
      });
      const s = $('[data-share]', sheet);
      if (s) s.addEventListener('click', () => navigator.share({ title: 'Design studio', text, url }).catch(() => {}));
    },
  });
}

const pic = (path, caption) => (path ? `<figure><a data-path-link="${esc(path)}"><img data-path="${esc(path)}" alt="${esc(caption)}"></a><figcaption>${esc(caption)}</figcaption></figure>` : '');

function openRequest(r) {
  const link = store.get('design_links', r.link_id);
  const b = r.brief || {};
  const facts = [['Piece', b.piece], ['Quantity', b.quantity], ['Size', b.size], ['Materials and finish', b.materials], ['Where it goes', b.placement],
    ['Notes', b.notes], ['Needed by', b.needed_by], ['Budget', b.budget], ['Delivery country', b.country]].filter(([, v]) => String(v || '').trim());
  const concepts = r.concepts || [];
  openSheet(`
    <div>
      ${sheetHeader(`${b.piece || 'Design'} — ${r.person || (link && link.label) || 'Designer'}`)}
      <div class="fields">
        ${r.status === 'sent' ? `<p class="small"><b>${esc(r.person)}</b>${r.studio ? `, ${esc(r.studio)}` : ''} · <a href="mailto:${esc(r.email)}">${esc(r.email)}</a> · sent ${esc(fmtDate(r.sent_at.slice(0, 10)))}${link ? ` · link: ${esc(link.label)}` : ''}</p>`
          : `<p class="notice small">Not sent yet${link ? ` · link: ${esc(link.label)}` : ''}.</p>`}
        ${r.note ? `<p class="notice small">“${esc(r.note)}”</p>` : ''}
        ${r.summary ? `<p class="small">${esc(r.summary)}</p>` : ''}
        ${facts.length ? `<dl class="facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
        <h4 class="price-links-title">What they sent</h4>
        <div class="design-team-pics">${(r.inputs || []).map(i => pic(i.path, i.role === 'room' ? 'Room' : i.name || 'Reference')).join('') || '<span class="muted small">No photos</span>'}</div>
        <h4 class="price-links-title">Concepts</h4>
        <div class="design-team-pics">${concepts.map((c, i) => `${pic(c.path, `${String.fromCharCode(65 + i)} · ${c.title}${r.chosen === i ? ' ✓ chosen' : ''}`)}${pic(c.room_path, `${String.fromCharCode(65 + i)} in the room`)}`).join('')}</div>
        ${concepts[r.chosen] ? `<p class="muted small"><b>${esc(concepts[r.chosen].title)}:</b> ${esc(concepts[r.chosen].description)}</p>` : ''}
      </div>
      <footer><span class="spacer"></span><button type="button" class="btn" data-close>Close</button></footer>
    </div>`, {
    wide: true,
    onOpen(sheet) {
      // Full-size pictures open in a new tab once their temporary link is loaded.
      sheet.addEventListener('click', e => {
        const a = e.target.closest('[data-path-link]');
        const img = a && $('img', a);
        if (img && img.src) window.open(img.src, '_blank', 'noopener');
      });
    },
  });
}

function openDrafts() {
  const drafts = store.all('design_requests').filter(r => r.status !== 'sent').sort(byNewest);
  openSheet(`
    <div>
      ${sheetHeader('Designs not sent yet')}
      <div class="fields"><div class="qc-rows">${drafts.map(r => {
        const link = store.get('design_links', r.link_id);
        return `<button type="button" class="qc-row" data-draft="${r.id}"><span><b>${esc((link && link.label) || 'Designer')}</b><span class="muted small"> · ${esc((r.brief || {}).piece || 'Design')} · ${(r.concepts || []).length} concepts</span></span><span class="muted small">${esc(fmtDate(r.created_at.slice(0, 10)))}</span></button>`;
      }).join('')}</div></div>
      <footer><span class="spacer"></span><button type="button" class="btn" data-close>Close</button></footer>
    </div>`, {
    onOpen(sheet) {
      sheet.addEventListener('click', e => {
        const d = e.target.closest('[data-draft]');
        const r = d && store.get('design_requests', d.dataset.draft);
        if (r) openRequest(r);
      });
    },
  });
}

export function designAction(action, el) {
  const id = el.dataset.id;
  switch (action) {
    case 'design-link-new': openNewLink(); break;
    case 'design-link-share': { const l = store.get('design_links', id); if (l) shareDesignLink(l); break; }
    case 'design-link-more': {
      const l = store.get('design_links', id);
      const n = l && parseInt(prompt(`How many more images for ${l.label || 'this link'}? (${l.image_limit - l.images_used} left now)`, '30') || '', 10);
      if (l && n > 0) store.update('design_links', id, { image_limit: l.image_limit + Math.min(n, 1000) }).then(() => toast('Images added')).catch(() => {});
      break;
    }
    case 'design-link-revoke':
      if (confirm('Switch this link off? It stops working straight away.')) store.update('design_links', id, { revoked_at: new Date().toISOString() }).then(() => toast('Link switched off')).catch(() => {});
      break;
    case 'design-request-view': { const r = store.get('design_requests', id); if (r) openRequest(r); break; }
    case 'design-drafts': openDrafts(); break;
  }
}
