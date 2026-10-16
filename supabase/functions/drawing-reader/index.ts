// Supabase Edge Function "drawing-reader"
// Reads a client's project documents — a luminaire schedule (PDF text or Excel rows) and drawing sets (page
// pictures) — and finds the lights the company is asked to make. The app sends the content itself (page text,
// spreadsheet rows, page pictures), split into small calls so each stays well inside the 150-second limit:
//   mode "schedule": text of schedule pages / sheets -> the rows meant for us (code, description, location…)
//   mode "marks":    1–3 page pictures + the list    -> where each of our lights is drawn (page + area)
// Nothing is saved here; the app shows everything for checking first.
// Setup: the same ANTHROPIC_API_KEY secret as "read-document"; deploy as "drawing-reader" (Verify JWT on).
import Anthropic from 'npm:@anthropic-ai/sdk@^0.131.0';
import { createClient } from 'npm:@supabase/supabase-js@2';

const MODEL = 'claude-opus-5-5';
const DEADLINE_MS = 125_000;
const MAX_TEXT = 120_000;
const MAX_PAGES = 3;
const MAX_SCHEDULE_PAGES = 8;
const MAX_IMAGE_B64 = 5_000_000;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const text = (v: unknown, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : '');

const str = { type: 'string' };
const num = { type: 'number' };
const obj = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });

const SCHEDULE_SCHEMA = obj({
  mark_hint: str, // how the documents say our items are marked on drawings, e.g. "red letter B", or ""
  items: { type: 'array', items: obj({
    code: str,          // the type / tag, e.g. "LT60"
    name: str,          // short product name, e.g. "Tiered globe pendant"
    description: str,   // the description as written
    location: str,      // where it goes
    mounting: str,
    quantity: num,      // 0 when not given
    size: str, finish: str, cct: str, voltage: str, dimming: str,
    notes: str,         // other notes, including the drawing / page references as written
    source: str,        // which document and page it was found on
  }) },
});

const MARKS_SCHEMA = obj({
  lights: { type: 'array', items: obj({
    page: { type: 'integer' },   // the number of the picture above (1, 2, 3)
    code: str,                   // the matching code from the list, or "" if it matches none
    marked: { type: 'boolean' }, // true when it carries the company's mark
    description: str,            // what the light looks like, one short sentence
    box: { type: 'array', items: { type: 'integer' } }, // [left, top, right, bottom] of the light, 0–1000
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  }) },
});

const SYSTEM = `You help Byzantivm (Miami, USA) and Demya (Amstelveen, the Netherlands), two small companies that make made-to-order decorative lighting. Lighting designers and architects send them project documents: luminaire schedules and drawing sets (renderings, mood boards, plans) in which the lights for the company are marked. You find exactly those lights. Copy facts only from the documents; never invent codes, sizes or quantities. Use "" or 0 when something isn't given (schedules often say TBD — keep TBD as "").`;

async function ask(client: Anthropic, schema: unknown, content: unknown[], signal: AbortSignal) {
  // deno-lint-ignore no-explicit-any
  const params: any = {
    model: MODEL, max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
    system: SYSTEM,
    messages: [{ role: 'user', content }],
  };
  const msg = await client.beta.messages.create(params, { signal });
  if (msg.stop_reason === 'refusal') throw Object.assign(new Error('The AI declined to read this document.'), { status: 422 });
  if (msg.stop_reason === 'max_tokens') throw Object.assign(new Error('Too much in one go — try fewer pages.'), { status: 422 });
  // deno-lint-ignore no-explicit-any
  const out = msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
  return { result: JSON.parse(out), usage: msg.usage };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY is not set in Supabase (Edge Functions → Secrets).' }, 500);

  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Invalid request' }, 400); }
  const mode = body && ['schedule', 'marks'].includes(body.mode) ? body.mode : null;
  if (!mode) return json({ error: 'Invalid request' }, 400);

  // Only team members get through.
  const publishable = Deno.env.get('SUPABASE_ANON_KEY') || req.headers.get('apikey') || '';
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, publishable, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: member, error: memberError } = await sb.rpc('is_team_member');
  if (memberError || !member) return json({ error: 'Please sign in with a team account.' }, 403);

  const company = text(body.company, 60) || 'Byzantivm';
  const client = new Anthropic({ apiKey });
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), DEADLINE_MS);
  try {
    if (mode === 'schedule') {
      const docs = text(body.text, MAX_TEXT);
      if (!docs.trim()) return json({ error: 'No text to read.' }, 400);
      // Pictures of the schedule pages, so rows whose cells wrap over several lines are read correctly.
      // deno-lint-ignore no-explicit-any
      const pics = (Array.isArray(body.pages) ? body.pages : []).slice(0, MAX_SCHEDULE_PAGES).filter((p: any) =>
        p && typeof p.data === 'string' && p.data.length < MAX_IMAGE_B64 && /^image\/(jpeg|png|webp)$/.test(p.mime || ''));
      // deno-lint-ignore no-explicit-any
      const content: any[] = [];
      // deno-lint-ignore no-explicit-any
      pics.forEach((p: any) => {
        content.push({ type: 'text', text: `Picture of ${text(p.label, 200)}:` });
        content.push({ type: 'image', source: { type: 'base64', media_type: p.mime, data: p.data } });
      });
      const prompt = `${pics.length ? 'Above are pictures of the schedule pages. ' : ''}Below is the text of the client's documents (luminaire schedules, spreadsheets, notes), page by page. Table cells are separated by " | "; cells that wrap over several lines may come out split${pics.length ? ' — use the pictures to see which text belongs to which row' : ''}.

--- Documents ---
${docs}
--- End ---

List every light that ${company} is asked to supply: rows whose manufacturer / supplier / vendor / "by" column says ${company} (any spelling or abbreviation), or that are otherwise clearly assigned to ${company}. Ignore all other manufacturers' rows.
For each: code (the type / tag / ID, e.g. LT60), a short product name (3–6 words), the description as written, location, mounting, quantity (0 if blank or TBD), size, finish, cct, voltage, dimming (each "" if blank or TBD), notes (other remarks, keeping drawing / page references such as "Ref: Bishop DS 10/07, p.12"), and source (document and page it is on).
mark_hint: if the documents say how ${company}'s items are marked on the drawings (e.g. "B"), say it; otherwise "".`;
      content.push({ type: 'text', text: prompt });
      return json(await ask(client, SCHEDULE_SCHEMA, content, abort.signal));
    }

    // mode "marks": a few page pictures at a time
    // deno-lint-ignore no-explicit-any
    const pages = (Array.isArray(body.pages) ? body.pages : []).slice(0, MAX_PAGES).filter((p: any) =>
      p && typeof p.data === 'string' && p.data.length < MAX_IMAGE_B64 && /^image\/(jpeg|png|webp)$/.test(p.mime || ''));
    if (!pages.length) return json({ error: 'No pages to look at.' }, 400);
    // deno-lint-ignore no-explicit-any
    const list = (Array.isArray(body.items) ? body.items : []).slice(0, 200).map((it: any) =>
      `- ${text(it.code, 30) || '(no code)'}: ${text(it.name, 120)} — ${text(it.description, 300)}${it.location ? ` — location: ${text(it.location, 200)}` : ''}${it.notes ? ` — ${text(it.notes, 200)}` : ''}`).join('\n');
    const mark = text(body.mark, 40) || 'the letter B';
    // deno-lint-ignore no-explicit-any
    const content: any[] = [];
    // deno-lint-ignore no-explicit-any
    pages.forEach((p: any, i: number) => {
      content.push({ type: 'text', text: `Picture ${i + 1}: ${text(p.label, 200)}` });
      content.push({ type: 'image', source: { type: 'base64', media_type: p.mime, data: p.data } });
    });
    content.push({ type: 'text', text: `These are pages of the client's drawings (renderings, mood boards, plans). ${company}'s lights are marked with ${mark} (usually a red letter placed next to the light).
${list ? `The lights ${company} is asked to supply (from the schedule):\n${list}\n` : `There is no schedule; describe each marked light.\n`}
For every marked light on these pages give: page (the picture number), code (the code from the list it matches — use the location, the room name / caption on the page and the description to decide; "" if none fits), marked=true, a short description, and box: the area of the light fitting itself (not the letter), as [left, top, right, bottom] in thousandths of the picture's width and height (0–1000), with a small margin around the fitting. When several identical fittings are marked in one picture, give one box that holds the clearest two or three of them.
Then, only if a page has no marks at all but clearly features a decorative light fitting (wall sconce, pendant, chandelier — not downlights, coves or track lights), add it with marked=false, code "" (or the matching code), a description and its box.
confidence: how sure you are of the match and the box.`});
    return json(await ask(client, MARKS_SCHEMA, content, abort.signal));
  } catch (err) {
    console.error(err);
    // deno-lint-ignore no-explicit-any
    const e = err as any;
    if (e && e.status === 422) return json({ error: e.message }, 422);
    if (abort.signal.aborted) return json({ error: 'The AI took too long — try again with fewer pages.' }, 504);
    if (err instanceof Anthropic.AuthenticationError) return json({ error: 'The Anthropic API key is not valid — check ANTHROPIC_API_KEY in Supabase.' }, 502);
    if (err instanceof Anthropic.RateLimitError) return json({ error: 'The AI is busy right now — try again in a minute.' }, 503);
    if (err instanceof Anthropic.APIError) return json({ error: `AI error: ${err.message}` }, 502);
    if (err instanceof SyntaxError) return json({ error: 'The AI answer could not be understood — try again.' }, 502);
    return json({ error: 'Something went wrong reading the documents.' }, 500);
  } finally {
    clearTimeout(timer);
  }
});
