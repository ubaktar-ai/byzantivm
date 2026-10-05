// Social screen (Demya only): the post queue and the networking list.
import { esc, icon, label, todayStr, addDays } from '../lib.js';
import { store } from '../store.js';
import { isImage } from '../files.js';
import { emptyState, dueChip } from './common.js';
import {
  PLATFORMS, CONTACT_STATUSES, CONTACT_CATEGORIES, socialCompany, socialPosts, socialContacts, platformChip,
} from '../social.js';

const NEXT_STEP = { to_connect: 'Request sent', requested: 'Accepted', connected: 'Talking', talking: 'Became a client' };
const followUpDue = c => c.status !== 'client' && c.next_follow_up && c.next_follow_up <= todayStr();
const byPlanned = (a, b) => (a.scheduled_for || '9999').localeCompare(b.scheduled_for || '9999') || (a.created_at < b.created_at ? 1 : -1);

export function viewSocial(tab = 'posts') {
  if (store.missing.has('social_posts') || store.missing.has('social_contacts')) {
    return `
      <div class="page-head"><div><h1>Social</h1><div class="sub">Demya · LinkedIn & Instagram</div></div></div>
      <div class="card-surface pad">
        <p>To start, run <code>supabase/migrations/007_social.sql</code> once in Supabase → SQL Editor, then reload the app.</p>
        <p class="muted small">AI writing also needs the “social-writer” function — see “Social posts with AI” in the README.</p>
      </div>`;
  }
  const company = socialCompany();
  if (!company) return emptyState('Demya isn’t set up yet', 'Add the Demya company in the database first.');

  const posts = socialPosts();
  const contacts = socialContacts();
  const open = posts.filter(p => p.status !== 'posted').length;
  const due = contacts.filter(followUpDue).length;
  const tabs = [
    { id: 'posts', label: 'Posts', count: open },
    { id: 'network', label: 'Network', count: due },
  ];
  const actions = tab === 'network'
    ? `<button class="btn primary" data-action="new-person">${icon.plus} Add person</button>`
    : `<button class="btn" data-action="social-voice">Voice</button>
       <button class="btn" data-action="post-ideas">✨ Ideas for this week</button>
       <button class="btn primary" data-action="new-post">${icon.plus} New post</button>`;

  return `
    <div class="page-head">
      <div><h1>Social</h1><div class="sub"><span class="dot" style="background:${esc(company.color)}"></span> ${esc(company.name)} · LinkedIn & Instagram</div></div>
      <div class="head-actions">${actions}</div>
    </div>
    <div class="tabs" role="tablist">
      ${tabs.map(t => `<a role="tab" href="#/social/${t.id}" aria-selected="${tab === t.id}">${t.label}${t.count ? ` <span class="tab-count">${t.count}</span>` : ''}</a>`).join('')}
    </div>
    ${tab === 'network' ? networkTab(contacts) : postsTab(posts, company, due)}`;
}

// ---------- Posts ----------

function postsTab(posts, company, due) {
  const ready = posts.filter(p => p.status === 'approved').sort(byPlanned);
  const drafts = posts.filter(p => p.status === 'draft').sort(byPlanned);
  const monthAgo = addDays(todayStr(), -30);
  const posted = posts.filter(p => p.status === 'posted').sort((a, b) => ((a.posted_at || a.updated_at) < (b.posted_at || b.updated_at) ? 1 : -1));
  const postedRecently = posted.filter(p => (p.posted_at || p.updated_at || '').slice(0, 10) >= monthAgo).length;

  const stats = `
    <div class="money-stats">
      <div class="money-stat ${ready.length ? 'good' : ''}"><span>Ready to post</span><b>${ready.length}</b></div>
      <div class="money-stat"><span>Drafts</span><b>${drafts.length}</b></div>
      <div class="money-stat"><span>Posted, last 30 days</span><b>${postedRecently}</b><small>Aim for 2–3 a week per platform</small></div>
      <a class="money-stat ${due ? 'bad' : ''}" href="#/social/network"><span>Follow-ups due</span><b>${due}</b></a>
    </div>`;

  const voiceHint = !(company.social_voice || '').trim() ? `
    <div class="notice warn social-hint">Tell the AI who Demya wants to reach and how you sound, so posts sound like you.
      <button class="btn small" data-action="social-voice">Set the voice</button></div>` : '';

  if (!posts.length) {
    return stats + voiceHint + emptyState('No posts yet',
      'Get a week of ideas from Demya’s real orders, or start a post yourself. The AI drafts LinkedIn and Instagram versions from your project details and photos; you edit, approve, and share.',
      `<button class="btn" data-action="post-ideas">✨ Ideas for this week</button><button class="btn primary" data-action="new-post">${icon.plus} New post</button>`);
  }

  const section = (title, rows, empty) => `
    <h2 class="section">${esc(title)}</h2>
    ${rows.length ? `<div class="card-surface table-list">${rows.map(postRow).join('')}</div>` : `<div class="empty small-empty">${esc(empty)}</div>`}`;

  return stats + voiceHint
    + section('Ready to post', ready, 'Approve a draft when it’s ready to go out.')
    + section('Drafts', drafts, 'No drafts — tap “Ideas for this week”.')
    + (posted.length ? section('Posted', posted.slice(0, 15), '') : '');
}

function postRow(p) {
  const project = store.get('projects', p.project_id);
  const photos = (p.photo_ids || []).map(id => store.get('attachments', id)).filter(a => a && isImage(a));
  const firstLine = (p.body || '').trim().split('\n')[0];
  const color = p.platform === 'linkedin' ? '#0a66c2' : '#d62976';
  return `
    <div class="money-row post-row" data-action="edit-post" data-id="${p.id}">
      <span class="bar-dot" style="background:${color}"></span>
      <span class="post-thumb">${photos.length ? `<img data-path="${esc(photos[0].path)}" alt="" loading="lazy">${photos.length > 1 ? `<small>+${photos.length - 1}</small>` : ''}` : ''}</span>
      <div class="mr-main">
        <b>${esc(p.title || firstLine || 'Untitled post')}</b>
        <span class="muted small">${firstLine ? esc(firstLine.slice(0, 120)) : 'No text yet — tap to write it with AI'}</span>
        <span class="chips-line">${platformChip(p.platform)}${project ? `<span class="chip">${esc(project.name)}</span>` : ''}${p.language === 'nl' ? '<span class="chip">NL</span>' : ''}</span>
      </div>
      ${p.status === 'posted'
        ? (p.posted_url ? `<a class="btn small" href="${esc(p.posted_url)}" target="_blank" rel="noopener">${icon.external} View</a>` : '')
        : `${dueChip(p.scheduled_for)}${p.status === 'approved' ? `<button type="button" class="btn small" data-action="post-posted" data-id="${p.id}">${icon.check} Posted</button>` : ''}`}
    </div>`;
}

// ---------- Network ----------

function networkTab(contacts) {
  const count = id => contacts.filter(c => c.status === id).length;
  const due = contacts.filter(followUpDue).sort((a, b) => a.next_follow_up.localeCompare(b.next_follow_up));
  const dueIds = new Set(due.map(c => c.id));

  const stats = `
    <div class="money-stats">
      <div class="money-stat"><span>To connect</span><b>${count('to_connect')}</b></div>
      <div class="money-stat"><span>Requests sent</span><b>${count('requested')}</b></div>
      <div class="money-stat good"><span>Connected</span><b>${count('connected') + count('talking') + count('client')}</b><small>${count('client')} became client${count('client') === 1 ? '' : 's'}</small></div>
      <div class="money-stat ${due.length ? 'bad' : ''}"><span>Follow-ups due</span><b>${due.length}</b></div>
    </div>
    <div class="notice social-hint">Build the list of architects, designers and hotels you want to work with. The AI drafts a personal note for each; you send it from their profile. 10–20 personal requests a day is the fastest safe pace — automated requests get accounts blocked.</div>`;

  if (!contacts.length) {
    return stats + emptyState('No one on the list yet', 'Add the people you want to know: interior architects, designers, hotel and restaurant owners, developers.',
      `<button class="btn primary" data-action="new-person">${icon.plus} Add person</button>`);
  }

  const section = (title, rows) => rows.length ? `
    <h2 class="section">${esc(title)} · ${rows.length}</h2>
    <div class="card-surface table-list">${rows.map(personRow).join('')}</div>` : '';

  return stats
    + section('Follow up now', due)
    + CONTACT_STATUSES.map(s => section(s.label, contacts.filter(c => c.status === s.id && !dueIds.has(c.id))
      .sort((a, b) => (a.next_follow_up || '9999').localeCompare(b.next_follow_up || '9999') || a.name.localeCompare(b.name)))).join('');
}

function personRow(c) {
  const sub = [c.role, c.organisation].filter(x => (x || '').trim()).join(' · ');
  const where = c.platform === 'both' ? 'LinkedIn & Instagram' : label(PLATFORMS, c.platform);
  return `
    <div class="money-row" data-action="edit-person" data-id="${c.id}">
      <span class="client-badge small">${esc((c.name || '?').slice(0, 1).toUpperCase())}</span>
      <div class="mr-main">
        <b>${esc(c.name)}</b>
        <span class="muted small">${esc(sub || label(CONTACT_CATEGORIES, c.category))}</span>
        <span class="chips-line"><span class="chip">${esc(label(CONTACT_CATEGORIES, c.category))}</span><span class="chip">${esc(where)}</span>${c.message ? '<span class="chip">Message ready</span>' : ''}</span>
      </div>
      ${c.status !== 'client' ? dueChip(c.next_follow_up) : ''}
      ${NEXT_STEP[c.status] ? `<button type="button" class="btn small" data-action="person-next" data-id="${c.id}">${icon.check} ${esc(NEXT_STEP[c.status])}</button>` : ''}
    </div>`;
}
