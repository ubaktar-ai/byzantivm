// Supabase Edge Function "social-writer"
// Writes Demya's LinkedIn and Instagram posts, suggests a week of post ideas from real projects,
// and drafts personal connection / follow-up messages. Nothing is posted or sent: the app shows
// every draft for editing and approval first.
//
// Setup (once): the same ANTHROPIC_API_KEY secret as "read-document", then deploy this file as a
// function named "social-writer". See "Social posts with AI" in the README.
import Anthropic from 'npm:@anthropic-ai/sdk@^0.131.0';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { encodeBase64 } from 'jsr:@std/encoding@1/base64';

const MODEL = 'claude-opus-5-5';
const MAX_PHOTOS = 4;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// ---------- Answer formats ----------

const str = { type: 'string' };
const obj = (properties: Record<string, unknown>) => ({
  type: 'object', properties, required: Object.keys(properties), additionalProperties: false,
});
const platform = { type: 'string', enum: ['linkedin', 'instagram'] };

const SCHEMAS = {
  posts: obj({ posts: { type: 'array', items: obj({ platform, title: str, body: str, hashtags: str }) } }),
  ideas: obj({ ideas: { type: 'array', items: obj({ title: str, angle: str, platform, project_id: str }) } }),
  message: obj({ message: str }),
};

const SYSTEM = `You write social media for Demya, a small studio in Amstelveen, the Netherlands, that designs and makes made-to-order furniture and lighting (tables, cabinets, sofas, lights) for interior architects, hotels and restaurants, offices and private homes. The pieces are made by Dutch and European workshops.

Goal: grow Demya's network and reputation with interior architects, designers, developers and hospitality owners, so they think of Demya for custom pieces.

Rules:
- Use only facts given to you (project details, products, materials, photos). Never invent clients, numbers, awards, quotes or results.
- Never name a client unless their name is given in the brief.
- Sound like a craftsperson who is proud of the work: specific, warm, confident, never salesy. No engagement bait ("Agree?", "Like if…"), no clichés like "elevate your space" or "in today's fast-paced world", no exclamation-mark chains, at most two emoji.
- Write in the language asked for (en = English, nl = Dutch).
- Put hashtags only in the "hashtags" field, space-separated, each starting with #. Not in the body.`;

const PLATFORM_GUIDE = `LinkedIn: 80–200 words. A first line that makes a professional stop scrolling (a detail, a problem solved, a decision). Short paragraphs. Talk about the making, the material choices, the collaboration with the architect or workshop. End with an open, genuine question or a quiet invitation to get in touch. 3–5 hashtags.
Instagram: 40–120 words, visual and sensory, the first line works on its own. 8–15 hashtags mixing niche (#customfurniture #madetomeasure), material (#walnut #travertine) and local (#dutchdesign #amsterdaminteriors) tags.`;

// ---------- Small input helpers (the browser sends these; keep them bounded) ----------

const text = (v: unknown, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : '');
const lang = (v: unknown) => (v === 'nl' ? 'nl' : 'en');

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY is not set in Supabase (Edge Functions → Secrets).' }, 500);

  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Invalid request' }, 400); }
  const mode = body && (body.mode === 'posts' || body.mode === 'ideas' || body.mode === 'message') ? body.mode : null;
  if (!mode) return json({ error: 'Invalid request' }, 400);

  // Act as the signed-in user: only team members get through, and storage rules still apply.
  const publishable = Deno.env.get('SUPABASE_ANON_KEY') || req.headers.get('apikey') || '';
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, publishable, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: member, error: memberError } = await sb.rpc('is_team_member');
  if (memberError || !member) return json({ error: 'Please sign in with a team account.' }, 403);

  const voice = text(body.voice, 1500);
  const language = lang(body.language);
  // deno-lint-ignore no-explicit-any
  const content: any[] = [];
  let prompt = '';

  if (mode === 'posts') {
    const platforms = (Array.isArray(body.platforms) ? body.platforms : []).filter((p: unknown) => p === 'linkedin' || p === 'instagram');
    if (!platforms.length) return json({ error: 'Choose LinkedIn, Instagram or both.' }, 400);
    const paths = (Array.isArray(body.photos) ? body.photos : [])
      .filter((p: unknown) => typeof p === 'string' && p && !p.includes('..')).slice(0, MAX_PHOTOS);
    for (const path of paths) {
      const { data: file } = await sb.storage.from('files').download(path);
      if (!file || file.size > MAX_PHOTO_BYTES || !/^image\/(jpeg|png|gif|webp)$/.test(file.type)) continue;
      content.push({ type: 'image', source: { type: 'base64', media_type: file.type, data: encodeBase64(new Uint8Array(await file.arrayBuffer())) } });
    }
    prompt = `Write one post for each of these platforms: ${platforms.join(', ')}. Language: ${language}.

${PLATFORM_GUIDE}

What the post is about:
${text(body.idea, 1500) || '(no idea given; use the project below)'}

${body.project ? `The project:\n${text(body.project, 4000)}` : 'No project linked.'}
${content.length ? `\nThe ${content.length} photo(s) above will be posted with it. Describe what is really in them; don't mention anything you can't see or weren't told.` : ''}

For each post, "title" is a short internal label (max 8 words) for the team's post queue.`;
  } else if (mode === 'ideas') {
    prompt = `Suggest ${Math.min(Math.max(Number(body.count) || 5, 1), 10)} post ideas for the coming week. Language for titles: ${language}.
Mix the platforms, and mix angles: a finished piece, behind the scenes in a workshop, a material or finish close-up, a design decision, the process from sketch to delivery, a lesson for architects about specifying custom furniture.
Base ideas on the real projects below where possible; set "project_id" to that project's id, or "" for a general idea. Avoid repeating the recent posts.

Projects:
${text(body.projects, 8000) || '(none yet)'}

Recent posts:
${text(body.recent, 3000) || '(none yet)'}

"title" is the idea in max 10 words; "angle" is 1–2 sentences on what to show and say.`;
  } else {
    const kind = body.kind === 'follow_up' ? 'follow_up' : 'connect';
    prompt = kind === 'connect'
      ? `Write a personal LinkedIn connection request note from Demya to this person. Language: ${language}. Max 280 characters, no hashtags, no sales pitch, no links. Mention something specific about them or their work if known, and why connecting makes sense.

Person:
${text(body.contact, 2000)}`
      : `Write a short, friendly follow-up message from Demya to this person, who is already a connection. Language: ${language}. 40–90 words, no hashtags, no hard sell. Give them a reason to reply (a relevant recent project, a question about their work, an offer to send material samples or meet). Use the notes to keep it personal.

Person:
${text(body.contact, 2000)}`;
  }

  content.push({ type: 'text', text: prompt });
  const system = voice ? `${SYSTEM}\n\nDemya's own voice and audience, as described by the team:\n${voice}` : SYSTEM;

  const client = new Anthropic({ apiKey });
  try {
    // deno-lint-ignore no-explicit-any
    const params: any = {
      model: MODEL,
      max_tokens: 16000,
      // If the model declines (a rare false positive), the API retries on a suitable fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMAS[mode as keyof typeof SCHEMAS] } },
      system,
      messages: [{ role: 'user', content }],
    };
    const msg = await client.beta.messages.create(params);
    if (msg.stop_reason === 'refusal') return json({ error: 'The AI declined to write this. Try rewording the idea.' }, 422);
    if (msg.stop_reason === 'max_tokens') return json({ error: 'The answer was too long. Try again.' }, 422);
    // deno-lint-ignore no-explicit-any
    const out = msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    return json({ result: JSON.parse(out), usage: msg.usage });
  } catch (err) {
    console.error(err);
    if (err instanceof Anthropic.AuthenticationError) return json({ error: 'The Anthropic API key is not valid — check ANTHROPIC_API_KEY in Supabase.' }, 502);
    if (err instanceof Anthropic.RateLimitError) return json({ error: 'The AI is busy right now — try again in a minute.' }, 503);
    if (err instanceof Anthropic.APIError) return json({ error: `AI error: ${err.message}` }, 502);
    if (err instanceof SyntaxError) return json({ error: 'The AI answer could not be understood — try again.' }, 502);
    return json({ error: 'Something went wrong writing the post.' }, 500);
  }
});
