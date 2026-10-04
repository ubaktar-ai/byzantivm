# Studio — Byzantivm & Demya

A project-management app for the Byzantivm and Demya creative studios, built for iPad.
**Byzantivm** is a US S-corp in Miami (USD, no VAT). **Demya** is a Dutch sole proprietorship (eenmanszaak) that works in EUR and charges Dutch VAT (btw).
It's an installable web app (PWA): team members add it to their iPad home screen and
it opens full-screen like a native app. Everyone signs in, and changes show up live for the whole team.

## What's in it

- **Two companies, one app**: switch between All, Byzantivm, or Demya. Every screen follows the switch.
- **Overview**: stats per company, your tasks, the team's tasks due this week, the project pipeline, and upcoming deadlines.
- **Order workflow** for made-to-order furniture & lighting. Every project moves through
  **Inquiry → Costing → Proposal → Deposit → Drawings → Client approval → Production → Balance → Shipping → Delivered**.
  The project's **Next step** card says what's due and has one-tap buttons:
  - create the proposal from the products (PROPOSAL / OFFERTE PDF)
  - client accepted → 50% deposit invoice (the % is set per project)
  - deposit received → drawings
  - all drawings approved → production
  - production finished → balance invoice
  - balance received → shipping
  - shipped → delivered

  Drawings wait for the deposit and shipping waits for the balance; the app warns if you go ahead early.
- **Products** in each order: quantity, dimensions, materials and finish, weight, the **supplier/workshop and their quoted cost**,
  your **price** (with markup %), and the margin per product and for the whole order.
- **Drawings**: each product gets its own drawing with approval rounds (send → client feedback → revise → approved),
  with files on every round. When all drawings have been sent, the project moves to *Client approval*.
- **Shipping**: a delivery address per order (or the client's address), shipments with carrier, tracking
  (tappable for UPS, FedEx, DHL, PostNL, DPD and GLS), dates, packages and **shipping cost**, plus a **packing list PDF** with a signature line.
- **Documents on every tab**: upload PDFs or photos (camera, Photos or Files) where they belong — the client's
  inquiry and supplier quotes on *Order*, a supplier quote on each product, references on *Drawings*, receipts and
  supplier invoices on *Money*, bill of lading and customs papers on *Shipping*, contracts on *Details*.
  The *Files* tab shows them all, labelled with where they came from.
- **✨ Read with AI** (optional): open an uploaded inquiry and the AI fills in the client, delivery address, deadline
  and products; open a supplier quote and it fills in the supplier, quote number and the cost per product.
  You always check and correct the result before anything is saved. Needs the one-time setup below.
- **Projects screen**: a pipeline board across the 10 stages showing the product count and order value, plus a list view.
- **Tasks**: phase, priority, assignee, due date, notes, done/undo, and **comments with @mentions**.
  The Tasks screen shows *My tasks* / everyone / a specific person, grouped by Overdue / Today / Next 7 days.
- **Clients**: company details, contacts with tap-to-email and tap-to-call, and all of a client's projects across both companies.
- **Team & settings**: your name and colour, the team list (who may sign in), company names and colours.
- **Files & photos**: upload from the iPad camera, photo library, or Files. Big photos are shrunk to 2400px automatically.
  Files can belong to a project, a task, or a feedback round. They're kept in a private storage bucket and only
  shown to the team through temporary links. The project → Files tab gathers everything.
- **Money** (project → Money tab):
  - **Proposals** with line items. The *accepted* proposal sets the order value.
  - **Costs**: supplier costs come from the products and shipping costs from shipments. Add anything else (samples, materials, travel) as *other costs*.
  - **Invoices** for milestones, with quick-fill buttons (30% / 50% deposit, remaining amount), draft/sent/paid, and automatic *overdue*.
  - A summary on top: order value, costs, profit and margin, invoiced, paid, and outstanding.
  - Each invoice has a type: deposit, balance, or other.
  - Numbers are suggested per company (`BYZ-2026-001`, `DEM-Q-2026-001`). Amounts accept Dutch or English formats (`1.250,50` or `1,250.50`).
- **PDF quotes & invoices**:
  - **PDF** / **Save & PDF** create a real PDF with your logo, company and tax details, the client's details, line items,
    subtotal, tax and total, payment terms, and bank details.
  - **Byzantivm (US)**: documents in American English, with optional sales tax (the tax line is left out at 0%),
    the EIN, and account/routing numbers.
  - **Demya (NL)**: each document has a VAT choice: 21%, 9%, 0%, *reverse charge* (business clients elsewhere in the EU),
    *no Dutch VAT* (clients outside the EU), or *KOR exempt*. The required note is printed on the document.
    Reverse-charged documents show the client's VAT ID, so add it on the client's page.
    Check the right VAT treatment with your accountant.
  - Demya documents can be in **English or Nederlands**, and dates and amounts are formatted for that language.
  - On the iPad, **Share / Save** sends it by Mail, WhatsApp or AirDrop, or saves it to Files.
  - Set company details and the logo in **Team & settings → Companies → Document details**.
- **Money screen**: outstanding and overdue invoices, money received and costs this month, unpaid invoices with a one-tap *Paid*,
  and profit per project. Totals are kept **per currency** and never mixed. Overdue invoices also show on the Overview,
  and each client page shows what that client owes.
- **Calendar**:
  - **Month** view with task due dates, project deadlines, drawing due dates, and invoice due dates.
    You can switch each type on or off, or show only your own tasks.
  - Tap a day to see its list, and add a task due that day.
  - **Timeline** shows every project as a bar from start to deadline, with drawing due dates as ◆ and a red *today* line.
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

**Updating an existing database:** when a new feature needs database changes, run the matching file from
[`supabase/migrations/`](supabase/migrations) in the SQL Editor (they're safe to run more than once):
- `002_documents.sql` adds company/client document details, VAT and language, needed for PDF quotes and invoices.
- `003_currency_cleanup.sql` makes euro the default currency, limits documents to English or Dutch, and removes the unused tax-office fields.
- `004_company_country.sql` sets Byzantivm to US/USD and Demya to NL/EUR, allows only USD and EUR, and adds the VAT treatment per document.
- `005_order_workflow.sql` adds the order workflow: the new stages, products, drawings per product, deposit/balance invoice types, delivery address and shipments.
- `006_file_sections.sql` lets files belong to a tab (inquiry, supplier quote, drawings, money, shipping, documents) and to a product.

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

### 6. AI document reading (optional)

The **✨ Read with AI** button sends the document to Claude (Anthropic's AI) through a small Supabase function.
The API key stays inside Supabase — it is never in the app. Each document costs roughly **$0.02–0.10**
(a few cents; longer PDFs cost more), billed by Anthropic to your account.

1. **Get a key**: sign in at [console.anthropic.com](https://console.anthropic.com) → *Settings → Billing*: add a card
   and some credit (e.g. $10) → *API keys* → **Create key** → copy it (starts with `sk-ant-`).
2. **Store it in Supabase**: Supabase dashboard → *Edge Functions* → *Secrets* → **Add new secret**:
   name `ANTHROPIC_API_KEY`, value = the key → *Save*.
3. **Add the function**: *Edge Functions* → **Deploy a new function** → *Via Editor*. Name it exactly
   `read-document`, delete the example code, paste everything from
   [`supabase/functions/read-document/index.ts`](supabase/functions/read-document/index.ts) → **Deploy**.
4. In the function's *Details/Settings*, turn **off** *Verify JWT* and save. (The function checks
   itself that the caller is signed in and on the team list, so this is safe; Supabase's newer sign-in keys
   don't work with that switch.)

With the Supabase CLI instead: `supabase secrets set ANTHROPIC_API_KEY=sk-ant-…` and
`supabase functions deploy read-document --no-verify-jwt`.

The function uses the model `claude-opus-5-5`. If the AI declines a document (rare), Anthropic automatically retries on a
fallback model. To stop using AI, delete the secret or the function — uploading files keeps working.

## Demo mode

Without a key, or by tapping **Try demo mode** on the sign-in screen, the app runs with data stored only on that device.
Use **Load sample data** to look around. (*Read with AI* only works with the team database.) Sign out from the Team screen to leave demo mode.

## Project layout

| Path | Purpose |
| --- | --- |
| `index.html`, `styles.css` | App shell and styles (light/dark, iPad, phone) |
| `js/main.js` | Startup, sign-in flow, routing, actions, drag & drop, live-update handling |
| `js/backend.js` | Supabase backend and the on-device demo backend (same interface) |
| `js/store.js` | In-memory data with optimistic saves and live updates from teammates |
| `js/forms.js` | Create/edit sheets: projects, tasks (with comments and files), clients, contacts |
| `js/files.js` | File uploads (photo downscaling), document cards per tab, thumbnails, viewer, delete |
| `js/ai.js` | *Read with AI*: calls the `read-document` function and shows the check-before-saving sheets |
| `js/money.js` | Quote / cost / invoice sheets, totals, numbering, amount parsing |
| `js/pdf.js` | PDF quotes & invoices (jsPDF + Inter font), English / Dutch |
| `js/views/*.js` | Screens: overview, projects, project (order, drawings, money, shipping…), calendar & timeline, activity, clients, tasks, team, sign-in |
| `js/config.js` | Supabase URL and anon key |
| `supabase/schema.sql` | Database tables, security rules, activity log, live updates, file storage |
| `supabase/functions/read-document/` | Edge Function that reads an inquiry / supplier quote with Claude (key kept in Supabase secrets) |
| `vendor/supabase.js` | Supabase JS client v2.117.2 (MIT), bundled so the app needs no CDN |
| `vendor/jspdf.umd.min.js`, `vendor/fonts/` | jsPDF 4.2.1 (MIT) and the Inter font (SIL OFL), loaded only when a PDF is made |
| `sw.js` | Offline caching of the app files. **Bump `VERSION` when you change any file.** |
