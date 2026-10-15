// Supabase Edge Function "product-finder"
// Turns what a client sends (photos, scans, PDFs and the text of their email) into products, then looks each
// product up online: the original brand's item, its details, its retail price and a few pictures. The app shows
// the original next to "our version" (the original plus what the client wants changed) before anything is saved.
//
// Two steps, each well inside the 150-second limit of an Edge Function:
//   mode "read":     files + email text  -> the products the client wants, with their requested changes
//   mode "research": one product         -> the original item found online
// Setup: the same ANTHROPIC_API_KEY secret as "read-document"; deploy as "product-finder" (Verify JWT on).
import Anthropic from 'npm:@anthropic-ai/sdk@^0.131.0';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { encodeBase64 } from 'jsr:@std/encoding@1/base64';

const MODEL = 'claude-opus-5-5';
const MAX_FILE = 20 * 1024 * 1024;
const MAX_IMAGE = 4 * 1024 * 1024;
const DEADLINE_MS = 125_000; // stop well before the 150 s limit

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const text = (v: unknown, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : '');

// The app's spec fields (js/qc-spec.js) the AI may fill in: key -> what it means.
const SPEC_KEYS: Record<string, string> = {
  market: "General — Installed in (one of: US, EU)",
  fixture_type: "General — Fixture type (e.g. Pendant / Chandelier / Wall light / Ceiling / flush mount)",
  overall_size: "Dimensions & weight — Overall size (W × D × H)",
  diameter: "Dimensions & weight — Diameter",
  overall_drop: "Dimensions & weight — Overall drop (ceiling to bottom)",
  weight: "Dimensions & weight — Weight per piece",
  body_material: "Materials — Body material (e.g. Solid brass / Brass-plated steel / Aluminium / Steel)",
  material_detail: "Materials — Additional details",
  glass: "Materials — Diffuser (e.g. None / Hand-blown clear glass / Hand-blown opal glass / Frosted / acid-etched glass)",
  glass_detail: "Materials — Additional details",
  shade: "Materials — Shade (fabric, paper, metal…)",
  other_materials: "Materials — Other materials",
  finish: "Finishes — Main finish",
  finish_code: "Finishes — Finish code",
  sheen: "Finishes — Sheen / texture (e.g. Matte / Satin / Semi-gloss / Polished)",
  coating: "Finishes — Protective coating (e.g. Lacquered / Unlacquered (living finish) / Powder coated / Oiled)",
  secondary_finish: "Finishes — Canopy / rod / cable / details finish",
  source_type: "Light source — Light source (one of: bulb, led)",
  socket: "Light source — Socket type",
  socket_count: "Light source — Number of sockets",
  max_wattage: "Light source — Max. wattage per socket",
  bulbs_included: "Light source — Bulbs included (yes or no)",
  bulb_spec: "Light source — Bulb spec",
  led_brand: "Light source — LED brand & model",
  led_power: "Light source — LED power",
  cct: "Light source — Colour temperature (e.g. 2200K / 2400K / 2700K / 3000K)",
  cri: "Light source — CRI (e.g. ≥80 / ≥90 / ≥95 / ≥97)",
  r9: "Light source — R9",
  lumens: "Light source — Light output",
  light_direction: "Light source — Light direction / effect (e.g. Downlight / Uplight / Up & down / Diffuse — all around)",
  beam_angle: "Light source — Beam angle (e.g. 10° / 15° / 24° / 30°)",
  binning: "Light source — Colour consistency (binning) (e.g. ≤2 SDCM / ≤3 SDCM / ≤5 SDCM)",
  lifetime: "Light source — Lifetime",
  voltage: "Electrical & driver — Voltage (e.g. 120V / 277V / 120–277V / 230V)",
  frequency: "Electrical & driver — Frequency (e.g. 60 Hz / 50 Hz / 50/60 Hz)",
  driver_brand: "Electrical & driver — Driver / transformer brand (e.g. eldoLED / Lutron / Mean Well / Tridonic)",
  driver: "Electrical & driver — Driver / transformer model",
  driver_type: "Electrical & driver — Driver type (e.g. Constant current / Constant voltage / Electronic transformer / Magnetic transformer)",
  driver_output: "Electrical & driver — Driver output",
  driver_location: "Electrical & driver — Driver location (e.g. In canopy / In fixture body / Remote — supplied loose / Remote — by others)",
  flicker_free: "Electrical & driver — Flicker-free (yes or no)",
  dimming: "Dimming — Dimming (one of: onoff, phase, elv, 0-10v, dali, lutron, other)",
  lutron_system: "Dimming — Lutron system (e.g. Hi-lume / EcoSystem / RadioRA 3 / HomeWorks)",
  dimming_other: "Dimming — Dimming system",
  dimmer: "Dimming — Tested with dimmer / controller",
  dim_range: "Dimming — Dims down to (e.g. 10% / 5% / 1% / 0.1%)",
  dim_to_warm: "Dimming — Dim-to-warm (yes or no)",
  dimming_notes: "Dimming — Dimming notes",
  certification: "Certification & safety — Certification (e.g. UL listed / ETL listed / cUL / cETL (Canada) / UL + cUL)",
  location_rating: "Certification & safety — Location rating (e.g. Dry / Damp / Wet)",
  ip_rating: "Certification & safety — IP rating (e.g. IP20 / IP44 / IP54 / IP65)",
  wiring: "Certification & safety — Wiring / earthing",
  suspension: "Cable & mounting — Suspension (e.g. Cable / Rod(s) / Chain / Fixed / flush)",
  cable_length: "Cable & mounting — Cable / rod / chain length",
  cable_type: "Cable & mounting — Cable type & colour (e.g. Black braided fabric / Gold braided fabric / Clear PVC / Black PVC)",
  adjustable: "Cable & mounting — Height adjustable on site (yes or no)",
  canopy: "Cable & mounting — Canopy size & finish",
  junction_box: "Cable & mounting — Junction box",
};
const KEY_LIST = Object.entries(SPEC_KEYS).map(([k, v]) => `- ${k}: ${v}`).join('\n');

const str = { type: 'string' };
const num = { type: 'number' };
const obj = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const specList = { type: 'array', items: obj({ key: { type: 'string', enum: Object.keys(SPEC_KEYS) }, value: str }) };

const READ_SCHEMA = obj({
  client_name: str,
  summary: str,
  products: {
    type: 'array',
    items: obj({
      name: str,
      quantity: num,
      category: { type: 'string', enum: ['lighting', 'furniture', 'other'] },
      seen: str,                 // what the client showed or described, in a sentence
      brand_guess: str,
      model_guess: str,
      product_url: str,          // a link given by the client, or ""
      search_query: str,         // the best web search to find the original
      changes: specList,         // what the client wants different from the original (our version)
      change_notes: str,         // changes that don't fit a field
    }),
  },
});

const SAVE_TOOL = {
  name: 'save_original',
  description: 'Save the original product you found online (or found=false if you could not identify it). Call this exactly once, at the end.',
  strict: true,
  input_schema: obj({
    found: { type: 'boolean' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    brand: str,
    model: str,
    designer: str,
    product_url: str,
    description: str,
    retail_price: num,          // 0 if no price was found
    currency: str,              // ISO code, e.g. USD or EUR
    price_note: str,            // where the price comes from, variant it applies to, date
    specs: specList,
    image_urls: { type: 'array', items: str },
    sources: { type: 'array', items: str },
    notes: str,
  }),
};

const SYSTEM = `You help Byzantivm (Miami, USA) and Demya (Amstelveen, the Netherlands), two small companies that make made-to-order lighting and furniture. Clients often send a picture or link of a designer product they saw online and ask for it, sometimes changed (another size, finish or dimming system). The team makes its own version and needs the original's facts to quote and specify it.
Rules: copy facts only from what you were given or what you found on reliable pages (the brand's own site first, then authorised retailers). Never invent a model, a spec or a price; leave values empty when unsure. Write measurements with units as on the source (mm/cm/in), voltages like 120V or 220–240V, colour temperatures like 2700K.`;

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY is not set in Supabase (Edge Functions → Secrets).' }, 500);

  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Invalid request' }, 400); }
  const mode = body && (body.mode === 'read' || body.mode === 'research') ? body.mode : null;
  if (!mode) return json({ error: 'Invalid request' }, 400);

  // Act as the signed-in user: only team members get through, and storage rules still apply.
  const publishable = Deno.env.get('SUPABASE_ANON_KEY') || req.headers.get('apikey') || '';
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, publishable, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: member, error: memberError } = await sb.rpc('is_team_member');
  if (memberError || !member) return json({ error: 'Please sign in with a team account.' }, 403);

  // The client's files (from the app's storage) as content blocks.
  // deno-lint-ignore no-explicit-any
  const files: any[] = [];
  const paths = (Array.isArray(body.paths) ? body.paths : []).filter((p: unknown) => typeof p === 'string' && p && !p.includes('..')).slice(0, 6);
  for (const path of paths) {
    const { data: file } = await sb.storage.from('files').download(path);
    if (!file || file.size > MAX_FILE) continue;
    const mime = file.type || (path.toLowerCase().endsWith('.pdf') ? 'application/pdf' : '');
    const data = encodeBase64(new Uint8Array(await file.arrayBuffer()));
    if (mime === 'application/pdf') files.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } });
    else if (/^image\/(jpeg|png|gif|webp)$/.test(mime)) files.push({ type: 'image', source: { type: 'base64', media_type: mime, data } });
  }

  const started = Date.now();
  const client = new Anthropic({ apiKey });
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), DEADLINE_MS);
  try {
    if (mode === 'read') {
      const email = text(body.text, 12000);
      if (!files.length && !email.trim()) return json({ error: 'Add a picture, a PDF or the text of the email.' }, 400);
      const prompt = `The client sent the ${files.length ? 'files above' : 'message below'}${files.length && email ? ' and this message' : ''}.
${email ? `\n--- Message ---\n${email}\n--- End ---\n` : ''}${text(body.link, 500) ? `\nProduct link given: ${text(body.link, 500)}\n` : ''}
List every product the client wants (one entry per distinct product). For each:
- name: a short product name for the order, e.g. "Pendant — opal glass globe".
- quantity (1 if not stated), category.
- seen: what the client showed or described, in one sentence.
- brand_guess / model_guess: only if the brand or model is named, printed or clearly recognisable; otherwise "".
- product_url: a link the client gave for it, or "".
- search_query: the best web search to find the original item (brand + model if known, otherwise a precise description).
- changes: ONLY what the client wants different from or in addition to the original (their size, finish, dimming, voltage, colour temperature…), using these field keys:
${KEY_LIST}
- change_notes: wishes that don't fit a field.
Also client_name (the client's company or name, or "") and summary (the request in 1–3 sentences).`;
      // deno-lint-ignore no-explicit-any
      const params: any = {
        model: MODEL, max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: READ_SCHEMA } },
        system: SYSTEM,
        messages: [{ role: 'user', content: [...files, { type: 'text', text: prompt }] }],
      };
      const msg = await client.beta.messages.create(params, { signal: abort.signal });
      if (msg.stop_reason === 'refusal') return json({ error: 'The AI declined to read this. Try a different picture or text.' }, 422);
      // deno-lint-ignore no-explicit-any
      const out = msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
      return json({ result: JSON.parse(out), usage: msg.usage });
    }

    // ---- research: find the original online ----
    const p = body.product || {};
    const brief = [
      `Product: ${text(p.name, 200)}`,
      text(p.seen, 600) && `What the client showed: ${text(p.seen, 600)}`,
      text(p.brand_guess, 120) && `Brand (guess): ${text(p.brand_guess, 120)}`,
      text(p.model_guess, 160) && `Model (guess): ${text(p.model_guess, 160)}`,
      text(p.product_url, 500) && `Link from the client: ${text(p.product_url, 500)}`,
      text(p.search_query, 300) && `Suggested search: ${text(p.search_query, 300)}`,
      `Prices preferably in ${text(body.currency, 3) || 'USD'}${text(body.market, 2) === 'EU' ? ' (European store)' : ' (US store)'}.`,
    ].filter(Boolean).join('\n');
    const prompt = `${files.length ? 'The pictures above are what the client sent.\n' : ''}${brief}

Find the ORIGINAL product online: identify the brand and model (open the link first if there is one), then read the brand's product page or spec sheet. Be quick: a few searches and page reads are enough.
Then call save_original once with:
- brand, model, designer, product_url (the brand's page if possible), a 1–3 sentence description.
- retail_price: the list price of the variant closest to what the client wants, as a number (0 if none found), with currency and price_note (where from, which variant).
- specs: the original's facts mapped to these field keys (only what the sources state):
${KEY_LIST}
- image_urls: up to 3 direct image file URLs (jpg/png/webp) of the product from the page you used.
- sources: the pages you used. notes: anything uncertain.
If you cannot identify it with reasonable confidence, call save_original with found=false and say why in notes.`;
    // deno-lint-ignore no-explicit-any
    const messages: any[] = [{ role: 'user', content: [...files, { type: 'text', text: prompt }] }];
    // deno-lint-ignore no-explicit-any
    let saved: any = null;
    for (let turn = 0; turn < 4 && !saved; turn++) {
      // deno-lint-ignore no-explicit-any
      const params: any = {
        model: MODEL, max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
        output_config: { effort: 'low' },
        system: SYSTEM,
        tools: [
          { type: 'web_search_20260209', name: 'web_search', max_uses: 4 },
          { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 4 },
          SAVE_TOOL,
        ],
        messages,
      };
      const msg = await client.beta.messages.create(params, { signal: abort.signal });
      // deno-lint-ignore no-explicit-any
      const call = msg.content.find((b: any) => b.type === 'tool_use' && b.name === 'save_original');
      // deno-lint-ignore no-explicit-any
      if (call) { saved = (call as any).input; break; }
      if (msg.stop_reason === 'refusal') return json({ error: 'The AI declined this search.' }, 422);
      messages.push({ role: 'assistant', content: msg.content });
      if (msg.stop_reason !== 'pause_turn') {
        messages.push({ role: 'user', content: [{ type: 'text', text: 'Now call save_original with what you found (found=false if you could not identify it).' }] });
      }
    }
    if (!saved) return json({ error: 'The search took too long — try again, or add a link to the product.' }, 504);

    // Fetch a few product pictures here (the browser can't, because of other sites' rules).
    const urls = Date.now() - started < 135_000 ? (Array.isArray(saved.image_urls) ? saved.image_urls : []).slice(0, 3) : [];
    const images = (await Promise.all(urls.map((u: unknown) => fetchImage(String(u))))).filter(Boolean);
    return json({ result: { ...saved, images } });
  } catch (err) {
    console.error(err);
    if (abort.signal.aborted) return json({ error: 'The search took too long — try again, or add a link to the product.' }, 504);
    if (err instanceof Anthropic.AuthenticationError) return json({ error: 'The Anthropic API key is not valid — check ANTHROPIC_API_KEY in Supabase.' }, 502);
    if (err instanceof Anthropic.RateLimitError) return json({ error: 'The AI is busy right now — try again in a minute.' }, 503);
    if (err instanceof Anthropic.APIError) return json({ error: `AI error: ${err.message}` }, 502);
    if (err instanceof SyntaxError) return json({ error: 'The AI answer could not be understood — try again.' }, 502);
    return json({ error: 'Something went wrong — try again.' }, 500);
  } finally {
    clearTimeout(timer);
  }
});

// A product picture from a public web page: https only, no private addresses, images up to 4 MB.
async function fetchImage(url: string) {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:' || /^(localhost|\d+\.\d+\.\d+\.\d+|\[.*\])$/i.test(u.hostname) || !u.hostname.includes('.')) return null;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 7000);
  try {
    const res = await fetch(u, { signal: ctl.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (Studio product finder)' } });
    const mime = (res.headers.get('content-type') || '').split(';')[0].trim();
    if (!res.ok || !/^image\/(jpeg|png|webp)$/.test(mime)) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (!buf.length || buf.length > MAX_IMAGE) return null;
    const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
    return { name: `original-${crypto.randomUUID().slice(0, 8)}.${ext}`, mime, data: encodeBase64(buf) };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
