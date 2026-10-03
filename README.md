# Studio — Byzantivm & Demya

A project-management app for the Byzantivm and Demya creative studios, built for iPad.
It's an installable web app (PWA): team members add it to their iPad home screen and
it opens full-screen like a native app. Everyone signs in, and changes show up live for the whole team.

## What's in it (step 1 of 4)

- **Two companies, one app**: switch between All, Byzantivm, or Demya. Every screen follows the switch.
- **Overview**: stats per company, your tasks, the team's tasks due this week, the project pipeline, and upcoming deadlines.
- **Projects**: a pipeline board across the agency stages
  **Brief → Concept → Design → Client review → Revisions → Delivered**.
  Press and hold a card to move it. There's also a list view and a status filter (current / completed / cancelled).
- **Project page**: a stage stepper, a task board by phase, and a details tab (brief, team, facts, client contacts).
  Each project has its own currency (₺, $, €, £).
- **Tasks**: phase, priority, assignee, due date, notes, done/undo, and **comments with @mentions**.
  The Tasks screen shows *My tasks* / everyone / a specific person, grouped by Overdue / Today / Next 7 days.
- **Clients**: company details, contacts with tap-to-email and tap-to-call, and all of a client's projects across both companies.
- **Team & settings**: your name and colour, the team list (who may sign in), company names and colours.
- **Activity log**: the database already records who created, moved, or completed what. The feed screen comes in step 4.

Coming next: **(2)** deliverables with client feedback rounds, plus file and photo uploads ·
**(3)** quotes → costs → invoices and profit per project · **(4)** calendar, timeline, and activity feed.
The database tables for all of these are already created by `supabase/schema.sql`.

## One-time setup

### 1. Create the database (Supabase)

1. Open your Supabase project → **SQL Editor** → **New query**.
2. Paste the whole of [`supabase/schema.sql`](supabase/schema.sql).
3. **Near the bottom, replace `YOUR_EMAIL@example.com` with your own email**, then click **Run**.
   This puts you on the team. Nobody else can see any data until you add them in the app.
4. **Authentication → URL Configuration**: set **Site URL** to the address where the app is hosted (step 3 below),
   so confirmation and password-reset emails link back to the app.

The script is safe to run again later. It only creates things that are missing.

### 2. Connect the app

In [`js/config.js`](js/config.js), paste the project's **anon public** key
(Supabase → Project Settings → API → *Project API keys* → `anon` `public`):

```js
export const SUPABASE_URL = 'https://ehvzfpnsiklpjgweeijf.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJ...';
```

The anon key is designed to be public. The data is protected by the database's row-level security rules,
which only let signed-in emails on the team list read or write. **Never** put the `service_role` key in the app.

### 3. Host it

This is a static site with no build step. You can use any of these:
- **Cloudflare Pages / Netlify / Vercel**: connect this GitHub repo, with no build command and `/` as the output directory. (Free.)
- **GitHub Pages**: Settings → Pages → Deploy from a branch → `/ (root)`. Private repos need a paid GitHub plan.

### 4. Install on each iPad

Open the app's address in **Safari** → **Share** → **Add to Home Screen**.

### 5. Add your team

Sign in → **Team** → add each teammate's email. They then open the app, tap **Create account** with that email,
confirm the email, and sign in.

## Demo mode

Without a key, or by tapping **Try demo mode** on the sign-in screen, the app runs with data stored only on that device.
Use **Load sample data** to look around. Sign out from the Team screen to leave demo mode.

## Project layout

| Path | Purpose |
| --- | --- |
| `index.html`, `styles.css` | App shell and styles (light/dark, iPad, phone) |
| `js/main.js` | Startup, sign-in flow, routing, actions, drag & drop, live-update handling |
| `js/backend.js` | Supabase backend and the on-device demo backend (same interface) |
| `js/store.js` | In-memory data with optimistic saves and live updates from teammates |
| `js/forms.js` | Create/edit sheets: projects, tasks (with comments), clients, contacts |
| `js/views/*.js` | Screens: overview, projects, project, clients, tasks, team, sign-in |
| `js/config.js` | Supabase URL and anon key |
| `supabase/schema.sql` | Database tables, security rules, activity log, live updates, file storage |
| `vendor/supabase.js` | Supabase JS client v2.117.2 (MIT), bundled so the app needs no CDN |
| `sw.js` | Offline caching of the app files. **Bump `VERSION` when you change any file.** |
