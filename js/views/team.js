import { esc, icon, avatar, PERSON_COLORS } from '../lib.js';
import { store, companies, me } from '../store.js';

export function viewTeam() {
  const myProfile = me();
  const members = store.all('team_members').sort((a, b) => a.email.localeCompare(b.email));
  const byEmail = new Map(store.all('profiles').map(p => [p.email, p]));
  const demo = store.backend.mode === 'demo';

  return `
    <div class="page-head"><div><h1>Team & settings</h1><div class="sub">${demo ? 'Demo mode — data is saved on this iPad only' : esc(store.user?.email || '')}</div></div></div>

    <div class="settings-grid">
      <div class="card-surface pad">
        <h3 class="card-title">Your profile</h3>
        <form data-form="profile">
          <label class="field"><span>Name shown to the team</span><input name="full_name" value="${esc(myProfile?.full_name || '')}" required></label>
          <div class="field"><span>Colour</span>
            <div class="swatches">${PERSON_COLORS.map(c => `
              <label class="swatch" style="--sw:${c}"><input type="radio" name="color" value="${c}" ${myProfile?.color === c ? 'checked' : ''}><span></span></label>`).join('')}
            </div>
          </div>
          <div class="head-actions"><button class="btn" type="submit">Save profile</button></div>
        </form>
      </div>

      <div class="card-surface pad">
        <h3 class="card-title">Team members</h3>
        <p class="muted">Only these emails can sign in and see Byzantivm & Demya data. Add someone here, then ask them to open the app and choose <b>Create account</b> with the same email.</p>
        <div class="member-list">
          ${members.map(m => {
            const p = byEmail.get(m.email);
            const isMe = m.email === (store.user?.email || '').toLowerCase();
            return `
              <div class="member-row">
                ${p ? avatar(p, 32) : `<span class="avatar pending" style="width:32px;height:32px">?</span>`}
                <div class="member-main"><b>${esc(p ? p.full_name || p.email : m.email)}</b><span class="muted small">${esc(m.email)}${p ? '' : ' · hasn’t signed up yet'}</span></div>
                ${isMe ? `<span class="chip">You</span>` : `<button class="btn small ghost danger" data-action="remove-member" data-id="${esc(m.email)}" aria-label="Remove ${esc(m.email)}">${icon.trash}</button>`}
              </div>`;
          }).join('')}
        </div>
        ${demo ? '' : `
        <form data-form="add-member" class="inline-form">
          <input type="email" name="email" placeholder="teammate@company.com" required autocomplete="off" autocapitalize="off">
          <button class="btn primary" type="submit">${icon.plus} Add</button>
        </form>`}
      </div>

      <div class="card-surface pad">
        <h3 class="card-title">Companies</h3>
        <form data-form="companies">
          ${companies().map(c => `
            <div class="company-edit">
              <input type="color" name="color-${esc(c.id)}" value="${esc(c.color)}" aria-label="${esc(c.name)} colour">
              <input name="name-${esc(c.id)}" value="${esc(c.name)}" required aria-label="Company name">
            </div>`).join('')}
          <div class="head-actions"><button class="btn" type="submit">Save companies</button></div>
        </form>
      </div>

      <div class="card-surface pad">
        <h3 class="card-title">Account</h3>
        ${demo ? `
          <p class="muted">You're trying the app in demo mode. When the Supabase key is set up, the team signs in and shares the same live data.</p>
          <div class="head-actions">
            <button class="btn" data-action="load-sample">Load sample data</button>
            <button class="btn danger" data-action="reset-demo">Reset demo data</button>
          </div>` : `
          <div class="head-actions">
            <button class="btn" data-action="change-password">Change password</button>
            <button class="btn danger" data-action="sign-out">Sign out</button>
          </div>`}
      </div>
    </div>`;
}
