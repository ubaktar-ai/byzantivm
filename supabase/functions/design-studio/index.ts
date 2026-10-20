// Supabase Edge Function "design-studio"
// Serves the private design links for designers (design.html#<token>). No account: the long random token in the
// link is the key. The designer uploads a sketch, references and a photo of the room; Claude reads the brief and
// writes three concept directions, and Google's Gemini image model draws each one and can show a concept in the room.
// Every image the AI makes counts against the link's limit, so a link can't run up the bill.
//
// Setup (once): add the secret GEMINI_API_KEY (ANTHROPIC_API_KEY is already there from "AI document reading"),
// then deploy this file as a function named "design-studio" with "Verify JWT" turned OFF. See "Design studio" in the README.
import Anthropic from 'npm:@anthropic-ai/sdk@^0.131.0';
import postgres from 'npm:postgres@3.4.5';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { decodeBase64, encodeBase64 } from 'jsr:@std/encoding@1/base64';

const MODEL = 'claude-opus-5-5';
// Google renames its image models often: set the secret GEMINI_IMAGE_MODEL to switch without changing this file.
const IMAGE_MODEL = Deno.env.get('GEMINI_IMAGE_MODEL') || 'gemini-3.1-flash-image';
const MAX_FILE = 10 * 1024 * 1024;
const OK_MIME = /^image\/(jpeg|png|webp)$/;
const RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];

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

const text = (v: unknown, max = 2000) => String(v ?? '').trim().slice(0, max);
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

class Problem extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

async function signed(paths: string[]): Promise<Record<string, string>> {
  if (!paths.length) return {};
  const { data } = await storage().createSignedUrls(paths, 3600);
  const out: Record<string, string> = {};
  (data || []).forEach((d: Row) => { if (d.signedUrl) out[d.path] = d.signedUrl; });
  return out;
}

async function readImage(path: string) {
  const { data, error } = await storage().download(path);
  if (error || !data) throw new Problem('An uploaded image could not be found — please upload it again.', 404);
  const mime = data.type && OK_MIME.test(data.type) ? data.type : path.endsWith('.png') ? 'image/png' : path.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
  return { mime, data: encodeBase64(new Uint8Array(await data.arrayBuffer())) };
}

async function saveImage(link: Row, img: { mime: string; data: string }) {
  const ext = img.mime === 'image/png' ? 'png' : img.mime === 'image/webp' ? 'webp' : 'jpg';
  const path = `design/${link.id}/out/${crypto.randomUUID()}.${ext}`;
  const { error } = await storage().upload(path, decodeBase64(img.data), { contentType: img.mime, upsert: false });
  if (error) throw new Problem('The image could not be saved — please try again.', 502);
  return path;
}

// Images are budgeted per link. Reserve before asking the AI; give back what wasn't made.
async function spend(link: Row, n: number) {
  const [row] = await sql`update public.design_links set images_used = images_used + ${n}
    where id = ${link.id} and revoked_at is null and images_used + ${n} <= image_limit returning images_used`;
  if (!row) throw new Problem('This link has made all the images it is allowed to. Please ask Demya for more.', 429);
}
async function refund(link: Row, n: number) {
  if (n > 0) await sql`update public.design_links set images_used = greatest(0, images_used - ${n}) where id = ${link.id}`;
}

const nearestRatio = (w: number, h: number) => {
  if (!(w > 0 && h > 0)) return '4:3';
  const r = w / h;
  return RATIOS.reduce((best, x) => {
    const [a, b] = x.split(':').map(Number);
    const [c, d] = best.split(':').map(Number);
    return Math.abs(Math.log(a / b / r)) < Math.abs(Math.log(c / d / r)) ? x : best;
  }, '1:1');
};

// ---------- Gemini (images) ----------

async function gemini(prompt: string, images: { mime: string; data: string }[], aspect: string) {
  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) throw new Problem('GEMINI_API_KEY is not set in Supabase (Edge Functions → Secrets).', 500);
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [...images.map(i => ({ inlineData: { mimeType: i.mime, data: i.data } })), { text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect } },
    }),
    signal: AbortSignal.timeout(90_000),
  }).catch(err => { console.error(err); throw new Problem('The image AI took too long — please try again.', 504); });
  const out: Row = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(res.status, JSON.stringify(out).slice(0, 2000));
    if (res.status === 400 && /api key/i.test(out?.error?.message || '')) throw new Problem('The Gemini API key is not valid — check GEMINI_API_KEY in Supabase.', 502);
    if (res.status === 404) throw new Problem(`The image model "${IMAGE_MODEL}" was not found — set GEMINI_IMAGE_MODEL in Supabase to a current model.`, 502);
    // Google's free tier allows no image generation ("free_tier… limit: 0"): billing must be on for the key.
    if (res.status === 429 && /free_tier/.test(out?.error?.message || '')) throw new Problem('The image AI isn’t switched on yet: turn on billing for the Gemini API key (Google AI Studio → Billing).', 502);
    if (res.status === 429) throw new Problem('The image AI is busy right now — try again in a minute.', 503);
    throw new Problem(`Image AI error: ${out?.error?.message || res.status}`, 502);
  }
  const parts: Row[] = out?.candidates?.[0]?.content?.parts || [];
  const part = parts.find(p => (p.inlineData || p.inline_data)?.data);
  if (!part) {
    console.error('No image', JSON.stringify(out).slice(0, 2000));
    throw new Problem('The image AI didn’t make a picture this time — please try again, or describe it differently.', 422);
  }
  const d = part.inlineData || part.inline_data;
  return { mime: OK_MIME.test(d.mimeType || d.mime_type) ? (d.mimeType || d.mime_type) : 'image/png', data: d.data as string };
}

const PHOTO_STYLE = 'Photorealistic product photograph of one finished, buildable piece: true-to-life materials and finishes, '
  + 'soft studio light on a plain warm-grey background, the whole piece in view, nothing else in the picture. No text, labels, logos or watermarks.';

// ---------- Claude (reading the brief, writing the directions) ----------

const str = { type: 'string' };
const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['summary', 'concepts'],
  properties: {
    summary: str,
    concepts: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['title', 'description', 'tags', 'prompt'],
        properties: { title: str, description: str, tags: { type: 'array', items: str }, prompt: str },
      },
    },
  },
};

const SYSTEM = `You are a senior designer at Demya, a studio in the Netherlands that makes made-to-order lighting and furniture for interior designers and architects. A designer has sent a brief, sometimes with a sketch, reference photos and a photo of the room. You turn it into three concept directions that a workshop could really make.`;

const briefText = (b: Row) => [
  ['Piece', b.piece], ['Quantity', b.quantity], ['Size', b.size], ['Materials and finish', b.materials],
  ['Where it goes', b.placement], ['Notes', b.notes], ['Needed by', b.needed_by], ['Budget', b.budget], ['Delivery country', b.country],
].filter(([, v]) => String(v || '').trim()).map(([k, v]) => `${k}: ${v}`).join('\n');

async function directions(brief: Row, refs: { mime: string; data: string }[], room: { mime: string; data: string } | null) {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Problem('ANTHROPIC_API_KEY is not set in Supabase (Edge Functions → Secrets).', 500);
  const content: Row[] = [];
  refs.forEach((r, i) => content.push({ type: 'text', text: `Reference ${i + 1} (sketch or reference photo):` }, { type: 'image', source: { type: 'base64', media_type: r.mime, data: r.data } }));
  if (room) content.push({ type: 'text', text: 'Photo of the room where the piece will go:' }, { type: 'image', source: { type: 'base64', media_type: room.mime, data: room.data } });
  content.push({ type: 'text', text: `The brief:\n${briefText(brief) || '(no text — work from the images)'}

Write:
- summary: what the designer is asking for, in 2–3 plain sentences (piece, size, materials, mood, constraints).
- concepts: exactly three distinct directions. The first stays closest to their sketch or references; the other two are clearly different but still answer the brief. For each:
  - title: one or two words, e.g. "Dome".
  - description: one or two plain sentences on the shape, materials and the light or feel it gives.
  - tags: three short facts, e.g. "Brushed brass", "About Ø 90 cm", "Down light".
  - prompt: a detailed instruction for an image model that will see the same sketch and reference photos (not the room). Describe the piece exactly: overall form, proportions and approximate size, every visible part (for lights: shade, canopy, cord or rod, diffuser, where the light comes out), materials, finishes and colours, and how it is lit. Only things that can really be made. Don't describe the background or the room.
Write in English.` });
  const client = new Anthropic({ apiKey });
  // deno-lint-ignore no-explicit-any
  const params: any = {
    model: MODEL,
    max_tokens: 8000,
    // If the model declines (a rare false positive), the API retries on a suitable fallback model.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: 'user', content }],
  };
  try {
    const msg = await client.beta.messages.create(params);
    if (msg.stop_reason === 'refusal') throw new Problem('The AI declined this brief — please describe it differently.', 422);
    // deno-lint-ignore no-explicit-any
    const out = JSON.parse(msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(''));
    const concepts = (out.concepts || []).slice(0, 3).map((c: Row) => ({
      title: text(c.title, 60), description: text(c.description, 600), tags: (c.tags || []).slice(0, 4).map((t: unknown) => text(t, 40)), prompt: text(c.prompt, 4000),
    })).filter((c: Row) => c.prompt);
    if (!concepts.length) throw new Problem('The AI didn’t come up with concepts — please try again.', 502);
    return { summary: text(out.summary, 1200), concepts };
  } catch (err) {
    if (err instanceof Problem) throw err;
    console.error(err);
    if (err instanceof Anthropic.AuthenticationError) throw new Problem('The Anthropic API key is not valid — check ANTHROPIC_API_KEY in Supabase.', 502);
    if (err instanceof Anthropic.RateLimitError) throw new Problem('The AI is busy right now — try again in a minute.', 503);
    throw new Problem('The AI could not read the brief — please try again.', 502);
  }
}

// ---------- What the page gets back ----------

async function view(link: Row, rows: Row[]) {
  const paths = rows.flatMap(r => [...(r.inputs || []).map((i: Row) => i.path), ...(r.concepts || []).flatMap((c: Row) => [c.path, c.room_path])]).filter(Boolean);
  const urls = await signed([...new Set(paths as string[])]);
  return rows.map(r => ({
    id: r.id, status: r.status, brief: r.brief, summary: r.summary, chosen: r.chosen, created_at: r.created_at, sent_at: r.sent_at,
    person: r.person, studio: r.studio, email: r.email,
    inputs: (r.inputs || []).map((i: Row) => ({ name: i.name, role: i.role, url: urls[i.path] || '' })),
    concepts: (r.concepts || []).map((c: Row) => ({ title: c.title, description: c.description, tags: c.tags || [], url: urls[c.path] || '', room_url: c.room_path ? urls[c.room_path] || '' : '' })),
  }));
}

async function load(link: Row) {
  const [company] = await sql`select name, legal_name, color, logo_path from public.companies where id = ${link.company_id}`;
  const rows = await sql`select * from public.design_requests where link_id = ${link.id} order by created_at desc limit 20`;
  const logo = company && company.logo_path ? (await signed([company.logo_path]))[company.logo_path] || '' : '';
  return {
    label: link.label,
    company: { name: company ? company.legal_name || company.name : '', color: company ? company.color : '#333', logo },
    images_left: Math.max(0, link.image_limit - link.images_used),
    requests: await view(link, rows),
  };
}

async function ownRequest(link: Row, id: unknown) {
  const [r] = await sql`select * from public.design_requests where id = ${text(id, 64)} and link_id = ${link.id}`;
  if (!r) throw new Problem('This design could not be found.', 404);
  return r as Row;
}

// ---------- Request ----------

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);
  let body: Row;
  try { body = await req.json(); } catch { return json({ error: 'Invalid request' }, 400); }
  const token = text(body.token, 200);
  if (!/^[a-f0-9]{32,128}$/.test(token)) return json({ error: 'This link is not valid.' }, 404);
  const [link] = await sql`select * from public.design_links where token = ${token}`;
  if (!link || link.revoked_at) return json({ error: 'This link has been switched off. Please ask Demya for a new one.' }, 404);

  try {
    const action = body.action || 'load';
    if (action === 'load') return json(await load(link));

    if (action === 'upload') {
      // One image per call (scaled down on the device first); returns its path for 'concepts'.
      const mime = text(body.mime, 100);
      if (!OK_MIME.test(mime)) return json({ error: 'Only JPEG, PNG or WebP photos can be uploaded.' }, 415);
      const bytes = decodeBase64(String(body.data || ''));
      if (!bytes.length || bytes.length > MAX_FILE) return json({ error: 'The photo is empty or larger than 10 MB.' }, 413);
      const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
      const path = `design/${link.id}/in/${crypto.randomUUID()}.${ext}`;
      const { error } = await storage().upload(path, bytes, { contentType: mime, upsert: false });
      if (error) return json({ error: 'Upload failed — please try again.' }, 502);
      return json({ path });
    }

    if (action === 'concepts') {
      const b: Row = body.brief || {};
      const brief: Row = Object.fromEntries(['piece', 'quantity', 'size', 'materials', 'placement', 'notes', 'needed_by', 'budget', 'country']
        .map(k => [k, text(b[k], k === 'notes' ? 2000 : 300)]));
      const own = new RegExp(`^design/${link.id}/in/[0-9a-f-]{36}\\.(jpg|png|webp)$`);
      const inputs = (Array.isArray(body.inputs) ? body.inputs : []).slice(0, 7)
        .map((i: Row) => ({ path: text(i.path, 200), name: text(i.name, 120), role: i.role === 'room' ? 'room' : 'reference', width: Number(i.width) || 0, height: Number(i.height) || 0 }))
        .filter((i: Row) => own.test(i.path));
      const refsIn = inputs.filter((i: Row) => i.role === 'reference').slice(0, 6);
      const roomIn = inputs.find((i: Row) => i.role === 'room') || null;
      if (!refsIn.length && !brief.notes && !brief.materials) return json({ error: 'Add a sketch or a reference photo, or describe the piece.' }, 400);

      const refs = await Promise.all(refsIn.map((i: Row) => readImage(i.path)));
      const room = roomIn ? await readImage(roomIn.path) : null;
      const { summary, concepts } = await directions(brief, refs, room);

      await spend(link, concepts.length);
      const made = await Promise.allSettled(concepts.map((c: Row) => gemini(`${c.prompt}\n\n${PHOTO_STYLE}`, refs.slice(0, 3), '4:3').then(img => saveImage(link, img))));
      const ok = concepts.map((c: Row, i: number) => made[i].status === 'fulfilled' ? { ...c, path: (made[i] as PromiseFulfilledResult<string>).value, room_path: '' } : null).filter(Boolean);
      await refund(link, concepts.length - ok.length);
      if (!ok.length) {
        const why = (made.find(m => m.status === 'rejected') as PromiseRejectedResult).reason;
        throw why instanceof Problem ? why : new Problem('The image AI failed — please try again.', 502);
      }
      const [row] = await sql`insert into public.design_requests (link_id, company_id, brief, inputs, summary, concepts)
        values (${link.id}, ${link.company_id}, ${sql.json(brief)}, ${sql.json([...refsIn, ...(roomIn ? [roomIn] : [])])}, ${summary}, ${sql.json(ok)})
        returning *`;
      const [fresh] = await sql`select * from public.design_links where id = ${link.id}`;
      return json({ request: (await view(link, [row]))[0], images_left: Math.max(0, fresh.image_limit - fresh.images_used) });
    }

    if (action === 'room' || action === 'revise') {
      const r = await ownRequest(link, body.request_id);
      const index = Number(body.index);
      const c: Row | undefined = (r.concepts || [])[index];
      if (!c || !c.path) return json({ error: 'This concept could not be found.' }, 404);
      if (r.status === 'sent') return json({ error: 'This design was already sent to Demya.' }, 409);
      const concept = await readImage(c.path);
      const concepts = [...r.concepts];

      if (action === 'room') {
        const roomIn = (r.inputs || []).find((i: Row) => i.role === 'room');
        if (!roomIn) return json({ error: 'Upload a photo of the room first.' }, 400);
        const room = await readImage(roomIn.path);
        const where = text(body.placement, 300) || r.brief.placement || '';
        const prompt = `The first image is a photo of a real room. The second image shows a ${r.brief.piece || 'piece'} designed for it ("${c.title}": ${c.description}).
Place exactly this ${r.brief.piece || 'piece'} into the room${where ? `, ${where}` : ', where it would naturally go'}. Keep the room exactly as it is: the same camera angle, walls, ceiling, furniture, materials, colours and daylight; only add the piece.
Make it a realistic size${r.brief.size ? ` (${r.brief.size})` : ''} for the room, in correct perspective, with matching shadows and reflections.${/light|lamp|pendant|sconce|chandelier/i.test(`${r.brief.piece} ${c.description}`) ? ' Show it switched on, with a soft warm glow on the surfaces below it.' : ''}
Photorealistic, like a photo taken in this room. No text, labels or watermarks.`;
        await spend(link, 1);
        let path;
        try { path = await saveImage(link, await gemini(prompt, [room, concept], nearestRatio(roomIn.width, roomIn.height))); } catch (err) { await refund(link, 1); throw err; }
        concepts[index] = { ...c, room_path: path };
      } else {
        const note = text(body.note, 600);
        if (note.length < 3) return json({ error: 'Describe what to change.' }, 400);
        const prompt = `This is a product design. Change it as follows: ${note}
Keep everything else about the piece the same. ${PHOTO_STYLE}`;
        await spend(link, 1);
        let path;
        try { path = await saveImage(link, await gemini(prompt, [concept], '4:3')); } catch (err) { await refund(link, 1); throw err; }
        concepts.push({ title: `${c.title} · changed`, description: note, tags: c.tags || [], prompt: `${c.prompt}\nChange: ${note}`, path, room_path: '' });
      }
      const [row] = await sql`update public.design_requests set concepts = ${sql.json(concepts)} where id = ${r.id} returning *`;
      const [fresh] = await sql`select * from public.design_links where id = ${link.id}`;
      return json({ request: (await view(link, [row]))[0], images_left: Math.max(0, fresh.image_limit - fresh.images_used) });
    }

    if (action === 'send') {
      const r = await ownRequest(link, body.request_id);
      const chosen = Number(body.chosen);
      if (!Number.isInteger(chosen) || !(r.concepts || [])[chosen]) return json({ error: 'Choose a concept first.' }, 400);
      const person = text(body.person, 120);
      const email = text(body.email, 200);
      if (!person) return json({ error: 'Please fill in your name.' }, 400);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Please fill in a valid email address.' }, 400);
      const [row] = await sql`update public.design_requests set status = 'sent', chosen = ${chosen}, person = ${person}, email = ${email},
        studio = ${text(body.studio, 200)}, note = ${text(body.note)}, sent_at = now() where id = ${r.id} returning *`;
      return json({ request: (await view(link, [row]))[0] });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (err) {
    if (err instanceof Problem) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: 'Something went wrong — please try again.' }, 500);
  }
});
