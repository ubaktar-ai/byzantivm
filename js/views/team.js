import { esc, icon, avatar, PERSON_COLORS, CURRENCIES, openSheet, sheetHeader, options, toast, uuid, $ } from '../lib.js';
import { docsReady, countryReady, companyCountry, companyCurrency } from '../money.js';
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
              ${docsReady() ? `<button type="button" class="btn" data-action="edit-company" data-id="${esc(c.id)}">Document details</button>` : ''}
            </div>`).join('')}
          <div class="head-actions"><button class="btn" type="submit">Save companies</button></div>
        </form>
        ${docsReady() ? `<p class="muted small">Document details (address, tax number, bank, logo) are printed on PDF quotes and invoices.</p>`
          : `<p class="notice warn small">To print PDF quotes and invoices, the database needs a small update: run <code>supabase/migrations/002_documents.sql</code> in the Supabase SQL Editor.</p>`}
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

// ---------- Company document details (printed on PDFs) ----------

const LANGS = [{ id: 'en', label: 'English' }, { id: 'nl', label: 'Nederlands' }];
const COUNTRIES = [{ id: 'NL', label: 'Netherlands' }, { id: 'US', label: 'United States' }];

export function openCompanySheet(company) {
  const c = company;
  let unsubscribe = null;
  const logoBox = co => co.logo_path
    ? `<div class="logo-preview"><img data-path="${esc(co.logo_path)}" alt="Logo"></div><button type="button" class="btn small danger" data-remove-logo>Remove logo</button>`
    : `<span class="muted small">No logo yet — PNG with a transparent background works best.</span>`;
  openSheet(`
    <form>
      ${sheetHeader(`${c.name} — document details`)}
      <div class="fields">
        <div class="field"><span>Logo</span>
          <div class="logo-row"><div id="logo-box">${logoBox(c)}</div>
            <label class="btn">${icon.upload}<span>Upload logo</span><input type="file" accept="image/*" hidden id="logo-input"></label>
          </div>
        </div>
        ${countryReady() ? `<div class="field-row">
          <label class="field"><span>Country</span><select name="country" id="company-country">${options(COUNTRIES, companyCountry(c))}</select></label>
          <label class="field"><span>Default currency</span><select name="default_currency">${options(CURRENCIES, companyCurrency(c))}</select></label>
        </div>` : ''}
        <label class="field"><span>Legal / trade name</span><input name="legal_name" value="${esc(c.legal_name || '')}" data-ph-nl="${esc(c.name)} (as registered with the KvK)" data-ph-us="${esc(c.name)} Inc. / LLC"></label>
        <label class="field"><span>Address</span><textarea name="address" rows="3" data-ph-nl="Street 1\n1234 AB City\nNederland" data-ph-us="100 Street, Suite 200\nMiami, FL 33131\nUnited States">${esc(c.address || '')}</textarea></label>
        <div class="field-row">
          <label class="field"><span>Email</span><input type="email" name="email" value="${esc(c.email || '')}" autocomplete="off"></label>
          <label class="field"><span>Phone</span><input type="tel" name="phone" value="${esc(c.phone || '')}"></label>
        </div>
        <label class="field"><span>Website</span><input name="website" value="${esc(c.website || '')}" autocapitalize="off"></label>
        <div class="field-row">
          <label class="field"><span data-nl="VAT number (btw-id)" data-us="EIN (optional — printed on documents)">VAT number (btw-id)</span><input name="tax_id" value="${esc(c.tax_id || '')}" autocapitalize="characters" data-ph-nl="NL000000000B00" data-ph-us="00-0000000"></label>
          <label class="field"><span data-nl="Chamber of Commerce (KvK)" data-us="State registration no. (optional)">Chamber of Commerce (KvK)</span><input name="registration" value="${esc(c.registration || '')}" data-ph-nl="12345678" data-ph-us="Florida document no."></label>
        </div>
        <div class="field-row">
          <label class="field"><span>Bank</span><input name="bank_name" value="${esc(c.bank_name || '')}"></label>
          <label class="field"><span data-nl="BIC" data-us="Routing no. (ABA) / SWIFT">BIC</span><input name="swift" value="${esc(c.swift || '')}" autocapitalize="characters"></label>
        </div>
        <label class="field"><span data-nl="IBAN" data-us="Account number">IBAN</span><input name="iban" value="${esc(c.iban || '')}" autocapitalize="characters" data-ph-nl="NL00 BANK 0000 0000 00" data-ph-us=""></label>
        <div class="field-row">
          <label class="field"><span data-nl="Default VAT %" data-us="Default sales tax %">Default VAT %</span><input name="default_vat" value="${esc(String(Number(c.default_vat) || 0))}" inputmode="decimal"></label>
          <label class="field" data-nl-only><span>Default PDF language</span><select name="doc_language">${options(LANGS, c.doc_language || 'en')}</select></label>
        </div>
        <label class="field"><span>Payment terms (printed on every quote & invoice)</span><textarea name="payment_terms" rows="2" placeholder="e.g. Payment within 30 days. 50% deposit before work starts.">${esc(c.payment_terms || '')}</textarea></label>
      </div>
      <footer>
        <span class="spacer"></span>
        <button type="button" class="btn" data-close>Cancel</button>
        <button type="submit" class="btn primary">Save</button>
      </footer>
    </form>`, {
    onOpen(sheet) {
      // Labels and examples follow the company's country.
      const applyCountry = country => {
        const k = country === 'US' ? 'us' : 'nl';
        sheet.querySelectorAll('[data-nl]').forEach(el => { el.textContent = el.dataset[k]; });
        sheet.querySelectorAll('[data-ph-nl]').forEach(el => { el.placeholder = el.dataset[k === 'us' ? 'phUs' : 'phNl']; });
        sheet.querySelectorAll('[data-nl-only]').forEach(el => { el.hidden = country === 'US'; });
      };
      const countrySel = $('#company-country', sheet);
      applyCountry(countrySel ? countrySel.value : companyCountry(c));
      if (countrySel) countrySel.addEventListener('change', () => {
        applyCountry(countrySel.value);
        $('[name=default_currency]', sheet).value = countrySel.value === 'US' ? 'USD' : 'EUR';
      });
      const box = $('#logo-box', sheet);
      const refresh = () => { const cur = store.get('companies', c.id); if (cur) box.innerHTML = logoBox(cur); };
      unsubscribe = store.onChange(refresh);
      $('#logo-input', sheet).addEventListener('change', async e => {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) { toast('Please use a logo under 5 MB'); return; }
        const ext = (/\.([a-z0-9]+)$/i.exec(file.name) || [, 'png'])[1].toLowerCase();
        const path = `company/${c.id}/logo-${uuid()}.${ext}`;
        const old = (store.get('companies', c.id) || {}).logo_path;
        try {
          toast('Uploading logo…');
          await store.backend.uploadFile(path, file, file.type || 'image/png');
          await store.update('companies', c.id, { logo_path: path });
          if (old) store.backend.removeFiles([old]).catch(() => {});
          toast('Logo saved');
        } catch (err) {
          toast(`Logo upload failed: ${err.message || err}`);
        }
      });
      box.addEventListener('click', async e => {
        if (!e.target.closest('[data-remove-logo]')) return;
        const old = (store.get('companies', c.id) || {}).logo_path;
        await store.update('companies', c.id, { logo_path: '' }).catch(() => {});
        if (old) store.backend.removeFiles([old]).catch(() => {});
      });
    },
    onClose() { unsubscribe && unsubscribe(); },
    onSubmit(fd) {
      const data = Object.fromEntries(['legal_name', 'address', 'email', 'phone', 'website', 'tax_id', 'registration', 'bank_name', 'iban', 'swift', 'payment_terms', 'doc_language']
        .map(k => [k, String(fd.get(k) || '').trim()]));
      data.iban = data.iban.toUpperCase();
      data.swift = data.swift.toUpperCase();
      if (countryReady()) {
        data.country = fd.get('country') === 'US' ? 'US' : 'NL';
        data.default_currency = fd.get('default_currency') === 'USD' ? 'USD' : 'EUR';
        if (data.country === 'US') data.doc_language = 'en';
      }
      data.default_vat = Math.min(100, Math.max(0, parseFloat(String(fd.get('default_vat') || '0').replace(',', '.')) || 0));
      store.update('companies', c.id, data).then(() => toast('Document details saved')).catch(() => {});
    },
  });
}
