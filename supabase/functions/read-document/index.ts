// Supabase Edge Function "read-document"
// Reads a client inquiry or a supplier quote (PDF or photo from the "files" storage bucket) with Claude
// and returns what it found as JSON. The app shows the result for checking before anything is saved.
//
// Setup (once): add the secret ANTHROPIC_API_KEY under Edge Functions → Secrets, then deploy this file
// as a function named "read-document". See "AI document reading" in the README.
import Anthropic from 'npm:@anthropic-ai/sdk@^0.131.0';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { encodeBase64 } from 'jsr:@std/encoding@1/base64';

const MODEL = 'claude-opus-5-5';
const MAX_BYTES = 25 * 1024 * 1024;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// ---------- What to look for ----------

const str = { type: 'string' };
const numb = { type: 'number' };
const obj = (properties: Record<string, unknown>) => ({
  type: 'object', properties, required: Object.keys(properties), additionalProperties: false,
});

const SCHEMAS = {
  inquiry: obj({
    client: obj({ company: str, contact_name: str, email: str, phone: str, address: str, country: str, vat_number: str }),
    project_name: str,
    summary: str,
    budget: str,
    delivery_address: str,
    deadline: str,
    currency: str,
    products: { type: 'array', items: obj({ name: str, quantity: numb, dimensions: str, materials: str, notes: str }) },
  }),
  supplier: obj({
    supplier: str,
    quote_number: str,
    currency: str,
    lines: { type: 'array', items: obj({ description: str, quantity: numb, unit_cost: numb, dimensions: str, materials: str }) },
    shipping_cost: numb,
    notes: str,
  }),
};

const SYSTEM = `You help a small company that makes made-to-order furniture and lighting (Byzantivm in Miami, USA and Demya in Amstelveen, the Netherlands). You read documents they receive and copy the facts into a fixed JSON form. Copy what the document says; do not invent anything. Use an empty string for text you cannot find and 0 for numbers you cannot find. Documents may be in English, Dutch or another language; write the values in the document's language, except currency codes (ISO, e.g. EUR or USD) and dates (YYYY-MM-DD).`;

const PROMPTS = {
  inquiry: `This is a client's inquiry (an email, letter, brief, sketch or photo). Fill in:
- client: the client's company (or their name if private), contact person, email, phone, postal address, country and VAT/tax number if given. Not the furniture company's own details.
- project_name: a short name for this order, e.g. "Penthouse dining room" or "Hotel lobby lighting".
- summary: the client's request in 1–4 short sentences, including style wishes, references and anything special.
- budget: the client's budget as written, or "".
- delivery_address: where the products must be delivered, if different from or more specific than the client's address.
- deadline: the date the client needs the products (YYYY-MM-DD), or "".
- currency: the currency the client mentions, or "".
- products: every distinct piece the client asks for, one entry per product type, with quantity (1 if not stated), dimensions, materials/finish and short notes.`,
  supplier: `This is a quote, price list or pro-forma invoice from a supplier or workshop to the furniture company. Fill in:
- supplier: the supplier's or workshop's name.
- quote_number: the quote/offer/invoice number.
- currency: the currency of the prices.
- lines: one entry per priced product line, with description, quantity, unit_cost (price per piece, excluding VAT; if only a line total is given, divide it by the quantity), dimensions and materials/finish.
- shipping_cost: any separate transport/delivery/crating cost, excluding VAT, or 0.
- notes: lead time, validity, payment terms or other conditions, briefly.
Do not include VAT, discounts or totals as lines; apply discounts that belong to a line to its unit cost.`,
};

// ---------- Request ----------

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY is not set in Supabase (Edge Functions → Secrets).' }, 500);

  let body: { path?: unknown; mode?: unknown };
  try { body = await req.json(); } catch { return json({ error: 'Invalid request' }, 400); }
  const path = typeof body.path === 'string' ? body.path : '';
  const mode = body.mode === 'inquiry' || body.mode === 'supplier' ? body.mode : null;
  if (!path || path.includes('..') || !mode) return json({ error: 'Invalid request' }, 400);

  // Act as the signed-in user: only team members get through, and storage rules still apply.
  const publishable = Deno.env.get('SUPABASE_ANON_KEY') || req.headers.get('apikey') || '';
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, publishable, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: member, error: memberError } = await sb.rpc('is_team_member');
  if (memberError || !member) return json({ error: 'Please sign in with a team account.' }, 403);

  const { data: file, error: fileError } = await sb.storage.from('files').download(path);
  if (fileError || !file) return json({ error: 'The file could not be found.' }, 404);
  if (file.size > MAX_BYTES) return json({ error: 'The file is too large to read (over 25 MB).' }, 413);

  const mime = file.type || (path.toLowerCase().endsWith('.pdf') ? 'application/pdf' : '');
  const data = encodeBase64(new Uint8Array(await file.arrayBuffer()));
  let block;
  if (mime === 'application/pdf') {
    block = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } };
  } else if (/^image\/(jpeg|png|gif|webp)$/.test(mime)) {
    block = { type: 'image', source: { type: 'base64', media_type: mime, data } };
  } else {
    return json({ error: 'Only PDFs and JPEG/PNG photos can be read.' }, 415);
  }

  const client = new Anthropic({ apiKey });
  try {
    // deno-lint-ignore no-explicit-any
    const params: any = {
      model: MODEL,
      max_tokens: 16000,
      // If the model declines (a rare false positive), the API retries on a suitable fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMAS[mode] } },
      system: SYSTEM,
      messages: [{ role: 'user', content: [block, { type: 'text', text: PROMPTS[mode] }] }],
    };
    const msg = await client.beta.messages.create(params);
    if (msg.stop_reason === 'refusal') return json({ error: 'The AI declined to read this document.' }, 422);
    if (msg.stop_reason === 'max_tokens') return json({ error: 'The document is too long to read in one go.' }, 422);
    // deno-lint-ignore no-explicit-any
    const text = msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    return json({ result: JSON.parse(text), usage: msg.usage });
  } catch (err) {
    console.error(err);
    if (err instanceof Anthropic.AuthenticationError) return json({ error: 'The Anthropic API key is not valid — check ANTHROPIC_API_KEY in Supabase.' }, 502);
    if (err instanceof Anthropic.RateLimitError) return json({ error: 'The AI is busy right now — try again in a minute.' }, 503);
    if (err instanceof Anthropic.APIError) return json({ error: `AI error: ${err.message}` }, 502);
    if (err instanceof SyntaxError) return json({ error: 'The AI answer could not be understood — try again.' }, 502);
    return json({ error: 'Something went wrong reading the document.' }, 500);
  }
});
