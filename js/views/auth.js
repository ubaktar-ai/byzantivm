// Full-screen sign-in / sign-up / setup screens shown before the app loads.
import { esc } from '../lib.js';

const brand = `<div class="auth-brand"><img src="icons/icon.svg" alt="" width="56" height="56"><h1>Byzantivm & Demya</h1><p>Studio projects, clients and team</p></div>`;

export function authScreen(mode, { email = '', message = '', error = '', configured = true } = {}) {
  const msg = (message ? `<div class="auth-msg">${esc(message)}</div>` : '') + (error ? `<div class="auth-msg error">${esc(error)}</div>` : '');
  const demoLink = `<button type="button" class="link-btn" data-auth="demo">Try demo mode (data stays on this iPad)</button>`;

  if (!configured) {
    return `${brand}<div class="auth-card">
      <h2>Almost ready</h2>
      <p class="muted">The app isn't connected to the team database yet. Add the Supabase project key in <code>js/config.js</code> (see README), then reload.</p>
      <button type="button" class="btn primary wide" data-auth="demo">Try demo mode</button>
    </div>`;
  }

  if (mode === 'loading') {
    return `${brand}<div class="auth-card center"><div class="spinner"></div><p class="muted">Loading your studio…</p></div>`;
  }

  if (mode === 'not-member') {
    return `${brand}<div class="auth-card">
      <h2>Waiting for access</h2>
      <p class="muted">You're signed in as <b>${esc(email)}</b>, but this email isn't on the team list yet. Ask an admin to add it under <b>Team & settings</b>, then tap “Check again”.</p>
      <button type="button" class="btn primary wide" data-auth="recheck">Check again</button>
      <button type="button" class="btn wide" data-auth="signout">Sign out</button>
    </div>`;
  }

  if (mode === 'recovery') {
    return `${brand}<form class="auth-card" data-auth-form="new-password">
      <h2>Choose a new password</h2>${msg}
      <label class="field"><span>New password</span><input type="password" name="password" minlength="8" required autocomplete="new-password"></label>
      <button type="submit" class="btn primary wide">Save password</button>
    </form>`;
  }

  if (mode === 'signup') {
    return `${brand}<form class="auth-card" data-auth-form="signup">
      <h2>Create account</h2>
      <p class="muted small">Use the email an admin added to the team.</p>${msg}
      <label class="field"><span>Your name</span><input name="full_name" required autocomplete="name"></label>
      <label class="field"><span>Email</span><input type="email" name="email" value="${esc(email)}" required autocomplete="email" autocapitalize="off"></label>
      <label class="field"><span>Password</span><input type="password" name="password" minlength="8" required autocomplete="new-password" placeholder="At least 8 characters"></label>
      <button type="submit" class="btn primary wide">Create account</button>
      <button type="button" class="link-btn" data-auth="signin">I already have an account</button>
    </form>`;
  }

  if (mode === 'reset') {
    return `${brand}<form class="auth-card" data-auth-form="reset">
      <h2>Reset password</h2>${msg}
      <label class="field"><span>Email</span><input type="email" name="email" value="${esc(email)}" required autocomplete="email" autocapitalize="off"></label>
      <button type="submit" class="btn primary wide">Send reset link</button>
      <button type="button" class="link-btn" data-auth="signin">Back to sign in</button>
    </form>`;
  }

  return `${brand}<form class="auth-card" data-auth-form="signin">
    <h2>Sign in</h2>${msg}
    <label class="field"><span>Email</span><input type="email" name="email" value="${esc(email)}" required autocomplete="email" autocapitalize="off"></label>
    <label class="field"><span>Password</span><input type="password" name="password" required autocomplete="current-password"></label>
    <button type="submit" class="btn primary wide">Sign in</button>
    <div class="auth-links">
      <button type="button" class="link-btn" data-auth="signup">Create account</button>
      <button type="button" class="link-btn" data-auth="reset">Forgot password?</button>
    </div>
    ${demoLink}
  </form>`;
}
