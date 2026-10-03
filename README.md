# Studio — Byzantivm & Demya

A project-management app for the Byzantivm and Demya creative studios, built for iPad.
It's an installable web app (PWA): team members add it to their iPad home screen and
it opens full-screen like a native app. Everyone signs in, and changes show up live for the whole team.

## What's in it

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
- **Deliverables & feedback rounds** (project → Deliverables): set how many revision rounds are included,
  then **Send to client**, followed by **Record client feedback** (waiting / changes requested / approved) for each round.
  Files are attached to each round. The app warns when a round goes past what's included, and offers to move the
  project to *Client review* or *Revisions* when that fits. The Overview lists everything **waiting on clients** and for how long.
- **Files & photos**: upload from the iPad camera, photo library, or Files. Big photos are shrunk to 2400px automatically.
  Files can belong to a project, a task, or a feedback round. They're kept in a private storage bucket and only
  shown to the team through temporary links. The project → Files tab gathers everything.
- **Money** (project → Money tab):
  - **Quotes** with line items. An *approved* quote sets the project budget.
  - **Costs** (freelancers, printing, licences…) with paid/unpaid.
  - **Invoices** for milestones, with quick-fill buttons (30% / 50% deposit, remaining amount), draft/sent/paid, and automatic *overdue*.
  - A summary on top: budget, costs, profit and margin, invoiced, paid, and outstanding.
  - Numbers are suggested per company (`BYZ-2026-001`, `DEM-Q-2026-001`). Amounts accept Turkish or English formats (`1.250,50` or `1,250.50`).
- **Money screen**: outstanding and overdue invoices, money received and costs this month, unpaid invoices with a one-tap *Paid*,
  and profit per project. Totals are kept **per currency** and never mixed. Overdue invoices also show on the Overview,
  and each client page shows what that client owes.
- **Calendar**:
  - **Month** view with task due dates, project deadlines, deliverable due dates, and invoice due dates.
    You can switch each type on or off, or show only your own tasks.
  - Tap a day to see its list, and add a task due that day.
  - **Timeline** shows every project as a bar from start to deadline, with deliverable due dates as ◆ and a red *today* line.
    Late projects are outlined in red.
- **Activity feed**: a live record of who did what, for example *"Elena moved Logo concepts to Design"* or
  *"Umut marked invoice BYZ-2026-002 paid"*. You can filter it by person. Recent activity also shows on the Overview and on each project's Details tab.
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
| `js/forms.js` | Create/edit sheets: projects, tasks (with comments and files), clients, contacts |
| `js/files.js` | File uploads (photo downscaling), thumbnails, viewer, delete |
| `js/money.js` | Quote / cost / invoice sheets, totals, numbering, amount parsing |
| `js/views/*.js` | Screens: overview, projects, project, deliverables, money, calendar & timeline, activity, clients, tasks, team, sign-in |
| `js/config.js` | Supabase URL and anon key |
| `supabase/schema.sql` | Database tables, security rules, activity log, live updates, file storage |
| `vendor/supabase.js` | Supabase JS client v2.117.2 (MIT), bundled so the app needs no CDN |
| `sw.js` | Offline caching of the app files. **Bump `VERSION` when you change any file.** |
