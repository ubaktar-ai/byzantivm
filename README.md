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
- **Quality control for lighting** (*QC* tab): a full spec per light — pictures (received from client, proposed;
  the outcome comes from the inspections), dimensions, materials, finishes and sample numbers, bulb/socket (US & EU
  types) or integrated LED, light direction, beam angle and aiming (e.g. step light 30° facing down), voltage
  (120V, 277V, 230V…), driver, dimming (on/off, phase, ELV reverse phase, 0–10V, DALI, Lutron), certification and
  UL/ETL/CE stickers, cable & mounting, packaging and special requests.
  - **You choose what each party sees**: every detail has a *Client* and a *Supplier* switch, with a separate
    default template for Byzantivm and Demya (*Team → QC report template*). Empty details never appear.
  - **Specification cards**: order no., item no., project, client, pictures (or placeholders), the chosen details, samples and an
    approval section. Tap the order number to see all specification cards of the order; share them all as one PDF or one by one,
    in a client or a supplier version.
  - **Versions & approval**: issue v1, v2… (with a reason and a before/after list). Production needs the same version
    approved by **us, the supplier and the client**.
  - **Samples** with photos, carrier & tracking, and the client's approval or rejection.
  - **Inspections** (samples, production, final, **packed & ready for collection**, delivery) with checklists made from
    the spec, measured values and photos — stickers, light effect and every packed box need a photo. Failed checks
    become **issues**. Shipping waits for a passed final and packing check and resolved issues (override = written reason).
  - **Links for the supplier and the client** (no account): they see only the details chosen for them, confirm/approve,
    approve samples, send production/packing photos and ask for changes. After approval nothing changes without a
    request → new version → approval from all three.
  - PDFs: specification cards (client / supplier), QC report, issue report.
  - **All QC records are permanent**: the database refuses edits and deletes, and stamps who saved them and when.
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
- **Social (Demya)**: a *Social* screen for growing Demya on LinkedIn and Instagram.
  - **Posts**: a queue of drafts → *Ready to post* → *Posted*. Each post can link to an order and use that order's photos.
    **✨ Write with AI** drafts the LinkedIn and Instagram versions from the order's products, materials and photos,
    in English or Dutch. **✨ Ideas for this week** suggests posts from Demya's real orders.
    **Voice** tells the AI who Demya wants to reach and how it sounds.
  - Nothing is posted automatically. **Share with photos…** opens the iPad share sheet with the photos and text
    (the caption is also copied, because Instagram drops shared text). **Copy text** and **Open LinkedIn** also work.
  - **Network**: the people Demya wants to know (architects, interior designers, hotels, developers), with status
    *To connect → Request sent → Connected → In conversation → Client*, a follow-up date, and an AI-written
    connection note or follow-up message to send from their profile. One tap moves someone to the next step and sets the next follow-up.
    Requests are sent by hand on purpose: LinkedIn and Instagram block accounts that automate them.
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
- `007_social.sql` adds the Social screen for Demya: posts, the network list, and Demya's voice.
- `008_quality_control.sql` adds quality control: product type, spec versions, approvals, inspections, issues and overrides — all permanent.
- `009_qc_line_cards.sql` adds order & item numbers, report templates per company, approval by us, packing checks, samples with tracking, change requests and the supplier/client links.

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

### 7. Social posts with AI (optional)

**✨ Write with AI**, **✨ Ideas for this week** and the networking messages on the *Social* screen use a second
Supabase function, `social-writer`. It uses the same `ANTHROPIC_API_KEY` secret as step 6. Each draft costs about
**$0.01–0.05**; with photos it costs a little more.

1. Run [`supabase/migrations/007_social.sql`](supabase/migrations/007_social.sql) in the SQL Editor (new databases get it from `schema.sql`).
2. *Edge Functions* → **Deploy a new function** → *Via Editor*. Name it exactly `social-writer`, paste everything from
   [`supabase/functions/social-writer/index.ts`](supabase/functions/social-writer/index.ts) → **Deploy**.
3. In the function's settings, turn **off** *Verify JWT* (the function checks the caller itself, like `read-document`).

With the Supabase CLI: `supabase functions deploy social-writer --no-verify-jwt`.

The AI is told the order's name, brief, products and materials, but never the client's name. It only describes what's
in the photos and the order, and every draft is shown for editing before anything is shared.

### 8. Supplier & client links (for quality control)

The private links use a third Supabase function, `qc-portal`. It needs no API key.

1. Run [`008_quality_control.sql`](supabase/migrations/008_quality_control.sql) and then
   [`009_qc_line_cards.sql`](supabase/migrations/009_qc_line_cards.sql) in the SQL Editor (new databases get them from `schema.sql`).
2. *Edge Functions* → **Deploy a new function** → *Via Editor*. Name it exactly `qc-portal`, paste everything from
   [`supabase/functions/qc-portal/index.ts`](supabase/functions/qc-portal/index.ts) → **Deploy**.
3. In the function's settings, turn **off** *Verify JWT* — suppliers and clients have no account; the long random
   code in each link is the key, it only opens that one order, and you can switch a link off at any time.

With the Supabase CLI: `supabase functions deploy qc-portal --no-verify-jwt`.

### 9. Find products online (optional)

On a project's **Order** tab, **✨ Find products online** reads what a client sent (photos, screenshots,
scans, PDFs and the text of their email), works out which products they want and what they want changed,
then looks up each original online: brand, model, details, retail price and pictures. You check the
original next to **our version** (the original plus the client's changes) before anything is saved; the
original is kept with the product (product sheet, QC tab, tear sheet, cost report). Any product can also be
looked up later with **✨ Find the original online**.

Setup: the same `ANTHROPIC_API_KEY` secret as step 6, then deploy `supabase/functions/product-finder`
as a function named **product-finder** (Verify JWT **on**). Each lookup uses a few web searches and takes
about a minute; the Edge Function stops itself before Supabase's 150-second limit.

### 10. Supplier price requests (lights)

Run `supabase/migrations/010_supplier_prices.sql` once. Then, on a project's **QC** tab, **Supplier prices →
New price request** makes a private link for a supplier (the same `qc-portal` function as step 8). The supplier
sees, per light, the pictures, every detail meant for suppliers, what changed from the original and the
original's materials — never the original's price or shop link, your cost or selling price, or the client — and
sends a price per piece, lead time and notes. Prices arrive in the same section (also typed in by hand for
prices that came by email); **Accept** sets the product's cost and supplier. **Price request PDF** is the same
request on paper. Every price is kept permanently with the name and the date.

### 11. Client PO, payments and supplier payouts (Steps 8–10)

Run `supabase/migrations/011_payouts.sql` once (it adds the PO number on an order, the amount received on an
invoice and a *supplier payouts* list). After that, on a project's **Steps** tab:

- **8 · Client's PO → invoice**: upload the client's purchase order. The AI (the `read-document` function from
  step 6 — redeploy it so it knows POs) reads the PO number, date, total and deposit; the check screen warns when
  the total differs from the proposal. Saving accepts the proposal and makes the deposit invoice with
  *Your PO: …* on it. Without AI, type the PO number in.
- **9 · Payments → supplier payout slips**: **Payment received** records the amount and date, then makes a
  payout slip for the supplier (deposit % of the supplier's total, or the rest for the balance). The slip shows
  the supplier's prices only — never the client or your selling prices. **Paid to supplier** ticks it off.
- **10 · Ready to ship → balance**: when the lights are ready, the app asks whether the client has paid the
  balance. *Not yet* makes (or re-opens) the balance invoice; *Yes* records the payment and makes the balance
  payout slip.

Payouts are kept apart from Costs: the supplier's price already counts as product cost, so profit stays right.

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
| `js/views/qc.js`, `js/views/qc-more.js`, `js/qc-spec.js`, `js/qc-pdf.js` | Quality control: QC tab, specification cards, samples, requests, links, templates, the lighting spec & checklists, QC PDFs |
| `portal.html`, `js/portal.js` | The page behind a supplier / client link |
| `js/social.js`, `js/views/social.js` | *Social* (Demya): post queue, AI drafts and ideas, sharing, the network list |
| `js/ai.js` | *Read with AI*: calls the `read-document` function and shows the check-before-saving sheets |
| `js/money.js` | Quote / cost / invoice sheets, totals, numbering, amount parsing |
| `js/pdf.js` | PDF quotes & invoices (jsPDF + Inter font), English / Dutch |
| `js/views/*.js` | Screens: overview, projects, project (order, drawings, money, shipping…), calendar & timeline, activity, clients, tasks, team, sign-in |
| `js/config.js` | Supabase URL and anon key |
| `supabase/schema.sql` | Database tables, security rules, activity log, live updates, file storage |
| `supabase/functions/social-writer/` | Edge Function that drafts posts, post ideas and networking messages with Claude |
| `supabase/functions/qc-portal/` | Edge Function behind the supplier / client links |
| `supabase/functions/read-document/` | Edge Function that reads an inquiry / supplier quote with Claude (key kept in Supabase secrets) |
| `vendor/supabase.js` | Supabase JS client v2.117.2 (MIT), bundled so the app needs no CDN |
| `vendor/jspdf.umd.min.js`, `vendor/fonts/` | jsPDF 4.2.1 (MIT) and the Inter font (SIL OFL), loaded only when a PDF is made |
| `sw.js` | Offline caching of the app files. **Bump `VERSION` when you change any file.** |
