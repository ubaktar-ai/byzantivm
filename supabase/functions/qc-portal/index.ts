// Supabase Edge Function "qc-portal"
// Serves the private supplier / client links (portal.html#<token>). No account is needed: the long random
// token in the link is the key, and it only opens that one order. What the visitor can see is limited to the
// details ticked for their party; what they send is recorded permanently with their name and the time.
//
// Setup (once): deploy this file as a function named "qc-portal" with "Verify JWT" turned OFF
// (visitors have no account). It uses the built-in SUPABASE_DB_URL, SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY secrets — nothing to add.
import postgres from 'npm:postgres@3.4.5';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { decodeBase64 } from 'jsr:@std/encoding@1/base64';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 3 });
const storage = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
}).storage.from('files');

const MAX_FILE = 25 * 1024 * 1024;
const OK_MIME = /^(image\/(jpeg|png|webp|gif|heic|heif)|application\/pdf|video\/(mp4|quicktime))$/;
const text = (v: unknown, max = 4000) => String(v ?? '').trim().slice(0, max);
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

// A field is shown to a party when its visibility includes them ('cs', 'c' or 's').
const shows = (v: string | undefined, party: string) => !!v && (v === 'cs' || v === (party === 'client' ? 'c' : 's'));

async function signed(paths: string[]): Promise<Record<string, string>> {
  if (!paths.length) return {};
  const { data } = await storage().createSignedUrls(paths, 3600);
  const out: Record<string, string> = {};
  (data || []).forEach((d: Row) => { if (d.signedUrl) out[d.path] = d.signedUrl; });
  return out;
}

async function load(link: Row) {
  const [project] = await sql`select p.id, p.name, p.order_no, p.company_id, c.name as client_name
    from public.projects p left join public.clients c on c.id = p.client_id where p.id = ${link.project_id}`;
  if (!project) return null;
  const [company] = await sql`select name, legal_name, color, logo_path from public.companies where id = ${project.company_id}`;
  const ids: string[] = link.item_ids || [];
  const items = await sql`select id, name, item_no, quantity, supplier, spec, sort_order, created_at from public.items
    where project_id = ${project.id} and category = 'lighting' ${ids.length ? sql`and id in ${sql(ids)}` : sql``}
    order by sort_order, created_at`;
  const allItems = await sql`select id from public.items where project_id = ${project.id} order by sort_order, created_at`;
  const position = new Map(allItems.map((r: Row, i: number) => [r.id, String(i + 1).padStart(2, '0')]));
  const itemIds = items.map((i: Row) => i.id);
  const versions = itemIds.length ? await sql`select distinct on (item_id) * from public.spec_versions
    where item_id in ${sql(itemIds)} order by item_id, version_no desc` : [];
  const vIds = versions.map((v: Row) => v.id);
  const approvals = vIds.length ? await sql`select version_id, party, decision, person, method, note, created_at
    from public.qc_approvals where version_id in ${sql(vIds)} order by created_at` : [];
  const samples = itemIds.length ? await sql`select * from public.qc_samples where item_id in ${sql(itemIds)} order by created_at` : [];
  const sIds = samples.map((s: Row) => s.id);
  const sampleUps = sIds.length ? await sql`select sample_id, status, person, note, created_at from public.qc_sample_updates
    where sample_id in ${sql(sIds)} order by created_at` : [];
  const inspections = itemIds.length ? await sql`select item_id, stage, outcome, photos, results, created_at from public.qc_inspections
    where item_id in ${sql(itemIds)} and stage in ('final','packing') order by created_at` : [];
  const requests = await sql`select r.id, r.item_id, r.description, r.person, r.created_at,
      (select u.status from public.qc_request_updates u where u.request_id = r.id order by u.created_at desc limit 1) as status
    from public.qc_requests r where r.project_id = ${project.id} and r.party = ${link.party} order by r.created_at`;
  const submissions = link.party === 'supplier' ? await sql`select item_id, purpose, person, note, photos, created_at
    from public.qc_submissions where link_id = ${link.id} order by created_at` : [];

  // Files to show → signed links
  const wanted = new Set<string>();
  const out = items.map((it: Row) => {
    const v = versions.find((x: Row) => x.item_id === it.id);
    const show = { ...((v && v.spec._show) || {}), ...((it.spec && it.spec._show) || {}) };
    const spec: Row = {};
    if (v) {
      for (const [k, val] of Object.entries(v.spec)) {
        if (k.startsWith('_')) continue;
        if (!shows(show[k], link.party)) continue;
        spec[k] = val;
        // Uploaded documents (datasheets) need a download link too.
        if (Array.isArray(val)) val.forEach((a: Row) => { if (a && /^[0-9a-f-]{36}$/i.test(String(a.id))) wanted.add(a.id); });
      }
    }
    // Which sections apply (bulb vs LED, dimmable…) — used for layout only, never shown unless ticked above.
    const layout: Row = {};
    if (v) for (const k of ['market', 'source_type', 'dimming']) if (v.spec[k] !== undefined) layout[k] = v.spec[k];
    const images = (v && v.spec._images) || {};
    const outcome: string[] = [];
    for (const stg of ['final', 'packing']) {
      const last = inspections.filter((i: Row) => i.item_id === it.id && i.stage === stg).pop();
      if (last) outcome.push(...(last.photos || []), ...(last.results || []).filter((r: Row) => r.result === 'pass').flatMap((r: Row) => r.photos || []));
    }
    const pics = { vision: images.vision || [], offer: images.offer || [], outcome: [...new Set(outcome)] };
    Object.values(pics).flat().forEach(id => wanted.add(id as string));
    const its = samples.filter((s: Row) => s.item_id === it.id).map((s: Row) => {
      s.photos.forEach((id: string) => wanted.add(id));
      return { id: s.id, title: s.title, description: s.description, carrier: s.carrier, tracking: s.tracking, sent_on: s.sent_on, photos: s.photos,
        updates: sampleUps.filter((u: Row) => u.sample_id === s.id) };
    });
    return {
      id: it.id, name: it.name, item_no: it.item_no || position.get(it.id), quantity: Number(it.quantity),
      supplier: link.party === 'supplier' ? it.supplier : undefined,
      version: v ? { id: v.id, no: v.version_no, issued_at: v.created_at, change_reason: v.change_reason } : null,
      spec, layout, pictures: pics, samples: its,
      // Notes stay private: each party only gets back its own.
      approvals: v ? approvals.filter((a: Row) => a.version_id === v.id).map((a: Row) => ({ party: a.party, decision: a.decision, person: a.person, at: a.created_at, ...(a.party === link.party ? { note: a.note } : {}) })) : [],
      requests: requests.filter((r: Row) => r.item_id === it.id).map((r: Row) => ({ description: r.description, person: r.person, at: r.created_at, status: r.status || 'open' })),
      submissions: submissions.filter((s: Row) => s.item_id === it.id).map((s: Row) => ({ purpose: s.purpose, person: s.person, note: s.note, count: s.photos.length, at: s.created_at })),
    };
  });
  const atts = wanted.size ? await sql`select id, path, name, mime from public.attachments where id in ${sql([...wanted])} and project_id = ${project.id}` : [];
  const urls = await signed(atts.map((a: Row) => a.path));
  const files: Record<string, Row> = {};
  atts.forEach((a: Row) => { files[a.id] = { name: a.name, mime: a.mime, url: urls[a.path] || '' }; });
  const logo = company && company.logo_path ? (await signed([company.logo_path]))[company.logo_path] || '' : '';
  return {
    party: link.party, label: link.label,
    company: { name: company ? company.legal_name || company.name : '', color: company ? company.color : '#333', logo },
    order: { name: project.name, order_no: project.order_no, client: project.client_name || '' },
    items: out, files,
  };
}

// ---------- Price requests (purpose 'quote') ----------
// The supplier sees pictures and every detail meant for suppliers, the client's changes and the original's
// materials — never the original's price or shop link, our prices, or the client.
const SUPPLIER_ONLY = ['tolerance', 'material_detail', 'driver_type', 'driver_output', 'driver_distance', 'driver_access', 'wiring',
  'mounting_hardware', 'packaging', 'label_tag', 'install_manual', 'wiring_diagram', 'test_report', 'sticker_position'];
const filled = (v: unknown) => (Array.isArray(v) ? v.length > 0 : String(v ?? '').trim() !== '');

async function loadQuote(link: Row) {
  const [project] = await sql`select id, name, order_no, company_id, currency from public.projects where id = ${link.project_id}`;
  if (!project) return null;
  const [company] = await sql`select name, legal_name, color, logo_path, qc_template from public.companies where id = ${project.company_id}`;
  const tmpl: Row = (company && company.qc_template && company.qc_template.fields) || {};
  const ids: string[] = link.item_ids || [];
  const items = await sql`select id, name, item_no, quantity, spec, sort_order, created_at from public.items
    where project_id = ${project.id} and category = 'lighting' ${ids.length ? sql`and id in ${sql(ids)}` : sql``}
    order by sort_order, created_at`;
  const allItems = await sql`select id from public.items where project_id = ${project.id} order by sort_order, created_at`;
  const position = new Map(allItems.map((r: Row, i: number) => [r.id, String(i + 1).padStart(2, '0')]));
  const prices = await sql`select item_id, unit_price, currency, lead_time, notes, person, photos, created_at
    from public.supplier_prices where link_id = ${link.id} order by created_at`;
  const wanted = new Set<string>();
  const isId = (x: unknown) => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x);
  const out = items.map((it: Row) => {
    const s: Row = it.spec || {};
    const show: Row = s._show || {};
    const forSupplier = (k: string) => {
      const v = show[k] || tmpl[k] || (SUPPLIER_ONLY.includes(k) ? 's' : 'cs');
      return v === 'cs' || v === 's';
    };
    const spec: Row = {};
    for (const [k, val] of Object.entries(s)) {
      if (k.startsWith('_') || !filled(val) || !forSupplier(k)) continue;
      spec[k] = val;
      if (Array.isArray(val)) val.forEach((a: Row) => { if (a && isId(a.id)) wanted.add(a.id); });
    }
    const layout: Row = {};
    for (const k of ['market', 'source_type', 'dimming']) if (s[k] !== undefined) layout[k] = s[k];
    const o: Row | null = s._original || null;
    const original = o ? { brand: o.brand || '', model: o.model || '', designer: o.designer || '', description: o.description || '', specs: o.specs || {}, images: (o.images || []).filter(isId) } : null;
    const images: Row = s._images || {};
    const tear: Row = s._tear || {};
    const pics = [...new Set([...(images.offer || []), ...(tear.images || []), ...(original ? original.images : []), ...(images.vision || [])].filter(isId))];
    pics.forEach(id => wanted.add(id as string));
    const mine = prices.filter((r: Row) => r.item_id === it.id);
    mine.forEach((r: Row) => (r.photos || []).forEach((id: string) => wanted.add(id)));
    return {
      id: it.id, name: it.name, item_no: it.item_no || position.get(it.id), quantity: Number(it.quantity),
      spec, layout, pictures: pics,
      changes: (s._custom || []).filter((ch: Row) => ch && forSupplier(ch.key)).map((ch: Row) => ({ key: ch.key, label: ch.label, original: ch.original || '', ours: ch.ours || '' })),
      original,
      prices: mine.map((r: Row) => ({ unit_price: Number(r.unit_price), currency: r.currency, lead_time: r.lead_time, notes: r.notes, person: r.person, at: r.created_at, photos: r.photos || [] })),
    };
  });
  const atts = wanted.size ? await sql`select id, path, name, mime from public.attachments where id in ${sql([...wanted])} and project_id = ${project.id}` : [];
  const urls = await signed(atts.map((a: Row) => a.path));
  const files: Record<string, Row> = {};
  atts.forEach((a: Row) => { files[a.id] = { name: a.name, mime: a.mime, url: urls[a.path] || '' }; });
  const logo = company && company.logo_path ? (await signed([company.logo_path]))[company.logo_path] || '' : '';
  return {
    purpose: 'quote', party: 'supplier', label: link.label, currency: link.currency || project.currency || 'USD',
    company: { name: company ? company.legal_name || company.name : '', color: company ? company.color : '#333', logo },
    // The order number (or the order name) only — no client.
    order: { name: project.order_no ? '' : project.name, order_no: project.order_no, client: '' },
    items: out, files,
  };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);
  let body: Row;
  try { body = await req.json(); } catch { return json({ error: 'Invalid request' }, 400); }
  const token = text(body.token, 200);
  if (!/^[a-f0-9]{32,128}$/.test(token)) return json({ error: 'This link is not valid.' }, 404);
  const [link] = await sql`select * from public.qc_links where token = ${token}`;
  if (!link || link.revoked_at) return json({ error: 'This link has been switched off. Please ask for a new one.' }, 404);

  try {
    const action = body.action || 'load';
    const quote = link.purpose === 'quote';
    if (quote && !['load', 'price', 'upload'].includes(action)) return json({ error: 'Not allowed' }, 403);
    if (action === 'load') {
      const data = quote ? await loadQuote(link) : await load(link);
      return data ? json(data) : json({ error: 'This order no longer exists.' }, 404);
    }

    // Everything below acts on one product of this link.
    const person = text(body.person, 120);
    if (!person) return json({ error: 'Please fill in your name.' }, 400);
    const allowed = async (itemId: string): Promise<Row | null> => {
      const ids: string[] = link.item_ids || [];
      const [it] = await sql`select id, name from public.items where id = ${itemId} and project_id = ${link.project_id} and category = 'lighting'`;
      return it && (!ids.length || ids.includes(itemId)) ? (it as Row) : null;
    };

    if (action === 'price') {
      if (!quote) return json({ error: 'Not allowed' }, 403);
      const it = await allowed(text(body.item_id, 64));
      if (!it) return json({ error: 'Not found' }, 404);
      const price = Number(body.unit_price);
      if (!Number.isFinite(price) || price < 0 || price > 1e9) return json({ error: 'Please fill in a price per piece.' }, 400);
      const cur = text(body.currency, 3).toUpperCase();
      const currency = /^[A-Z]{3}$/.test(cur) ? cur : text(link.currency, 3);
      const photos = await ownFiles(link, body.photo_ids);
      await sql`insert into public.supplier_prices (project_id, item_id, item_name, link_id, party, person, unit_price, currency, lead_time, notes, photos)
        values (${link.project_id}, ${it.id}, ${it.name}, ${link.id}, 'supplier', ${person}, ${Math.round(price * 100) / 100}, ${currency},
          ${text(body.lead_time, 200)}, ${text(body.notes)}, ${sql.json(photos)})`;
      return json({ ok: true });
    }

    if (action === 'decide') {
      const it = await allowed(text(body.item_id, 64));
      if (!it) return json({ error: 'Not found' }, 404);
      const [v] = await sql`select id, version_no from public.spec_versions where item_id = ${it.id} order by version_no desc limit 1`;
      if (!v || v.id !== body.version_id) return json({ error: 'There is a newer version — please reload the page.' }, 409);
      const decision = body.decision === 'approved' ? 'approved' : 'rejected';
      const note = text(body.note);
      if (decision === 'rejected' && !note) return json({ error: 'Please write what needs to change.' }, 400);
      await sql`insert into public.qc_approvals (project_id, item_id, version_id, party, decision, person, method, note)
        values (${link.project_id}, ${it.id}, ${v.id}, ${link.party}, ${decision}, ${person}, 'Link', ${note})`;
      return json({ ok: true });
    }

    if (action === 'request') {
      const it = await allowed(text(body.item_id, 64));
      if (!it) return json({ error: 'Not found' }, 404);
      const description = text(body.description);
      if (description.length < 3) return json({ error: 'Please describe the change.' }, 400);
      const [v] = await sql`select id from public.spec_versions where item_id = ${it.id} order by version_no desc limit 1`;
      const photos = await ownFiles(link, body.photo_ids);
      await sql`insert into public.qc_requests (project_id, item_id, item_name, version_id, party, person, description, photos, link_id)
        values (${link.project_id}, ${it.id}, ${it.name}, ${v ? v.id : null}, ${link.party}, ${person}, ${description}, ${sql.json(photos)}, ${link.id})`;
      return json({ ok: true });
    }

    if (action === 'sample') {
      if (link.party !== 'client') return json({ error: 'Not allowed' }, 403);
      const [smp] = await sql`select id, item_id from public.qc_samples where id = ${text(body.sample_id, 64)} and project_id = ${link.project_id}`;
      if (!smp || !(await allowed(smp.item_id))) return json({ error: 'Not found' }, 404);
      const status = body.decision === 'approved' ? 'approved' : 'rejected';
      const note = text(body.note);
      if (status === 'rejected' && !note) return json({ error: 'Please write why.' }, 400);
      await sql`insert into public.qc_sample_updates (project_id, sample_id, status, person, note)
        values (${link.project_id}, ${smp.id}, ${status}, ${person}, ${note})`;
      return json({ ok: true });
    }

    if (action === 'upload') {
      // One file per call; returns its id to use in 'submit' or 'request'.
      const it = body.item_id ? await allowed(text(body.item_id, 64)) : null;
      if (body.item_id && !it) return json({ error: 'Not found' }, 404);
      const mime = text(body.mime, 100);
      if (!OK_MIME.test(mime)) return json({ error: 'Only photos, videos and PDFs can be sent.' }, 415);
      const bytes = decodeBase64(String(body.data || ''));
      if (!bytes.length || bytes.length > MAX_FILE) return json({ error: 'The file is empty or larger than 25 MB.' }, 413);
      const name = text(body.name, 120).normalize('NFKD').replace(/[^\w.\-]+/g, '_') || 'file';
      const path = `${link.project_id}/qc/${crypto.randomUUID()}-${name}`;
      const { error } = await storage().upload(path, bytes, { contentType: mime, upsert: false });
      if (error) return json({ error: 'Upload failed — please try again.' }, 502);
      const [att] = await sql`insert into public.attachments (project_id, item_id, kind, path, name, mime, size, created_by)
        values (${link.project_id}, ${it ? it.id : null}, 'qc', ${path}, ${text(body.name, 120) || name}, ${mime}, ${bytes.length}, null)
        returning id`;
      return json({ id: att.id });
    }

    if (action === 'submit') {
      if (link.party !== 'supplier' && body.purpose !== 'other') return json({ error: 'Not allowed' }, 403);
      const it = body.item_id ? await allowed(text(body.item_id, 64)) : null;
      if (body.item_id && !it) return json({ error: 'Not found' }, 404);
      const purpose = ['production', 'packing', 'sample', 'other'].includes(body.purpose) ? body.purpose : 'other';
      const photos = await ownFiles(link, body.photo_ids);
      if (!photos.length) return json({ error: 'Add at least one photo or file.' }, 400);
      await sql`insert into public.qc_submissions (project_id, item_id, item_name, party, person, purpose, note, photos, link_id)
        values (${link.project_id}, ${it ? it.id : null}, ${it ? it.name : ''}, ${link.party}, ${person}, ${purpose}, ${text(body.note)}, ${sql.json(photos)}, ${link.id})`;
      return json({ ok: true });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (err) {
    console.error(err);
    return json({ error: 'Something went wrong — please try again.' }, 500);
  }
});

// Only files of this order that were uploaded through a link (QC files without a team member).
async function ownFiles(link: Row, ids: unknown): Promise<string[]> {
  const list = Array.isArray(ids) ? ids.map(x => text(x, 64)).filter(x => /^[0-9a-f-]{36}$/.test(x)).slice(0, 100) : [];
  if (!list.length) return [];
  const rows = await sql`select id from public.attachments where id in ${sql(list)} and project_id = ${link.project_id}
    and kind = 'qc' and created_by is null`;
  return rows.map((r: Row) => r.id);
}
