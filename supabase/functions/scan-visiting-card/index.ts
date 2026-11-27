import { createClient } from 'npm:@supabase/supabase-js@2.119.2';
import { encodeBase64 } from 'jsr:@std/encoding@1/base64';
import { cardImageType, validateCardOutput, visionPayload } from '../_shared/visiting-card.js';

const project = Deno.env.get('SUPABASE_URL') ?? '';
const anonymousKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const service = createClient(project, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
  auth: { persistSession: false, autoRefreshToken: false },
});
const allowedOrigin = Deno.env.get('AVI_CARD_ALLOWED_ORIGIN') ?? 'https://avi-salesconnect.netlify.app';
const maxImageBytes = 10 * 1024 * 1024;
const maxOcrBytes = 2 * 1024 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function boundedForm(request: Request, limit: number) {
  if (!request.body || Number(request.headers.get('content-length')) > limit) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) { await reader.cancel(); return null; }
      chunks.push(new Uint8Array(chunk.value));
    }
    return await new Response(new Blob(chunks), {
      headers: { 'content-type': request.headers.get('content-type') ?? '' },
    }).formData();
  } finally {
    reader.releaseLock();
  }
}

Deno.serve(async request => {
  if (request.headers.has('origin') && request.headers.get('origin') !== allowedOrigin) {
    return new Response(null, { status: 403 });
  }
  const headers = {
    'access-control-allow-origin': allowedOrigin,
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, x-avi-organization, x-avi-card-action',
    'access-control-allow-methods': 'POST, OPTIONS',
    'content-type': 'application/json',
    'cache-control': 'no-store',
    vary: 'Origin',
  };
  const reply = (status: number, body: object) => new Response(JSON.stringify(body), { headers, status });
  if (request.method === 'OPTIONS') return new Response(null, { headers, status: 204 });
  if (request.method !== 'POST') return reply(405, { error: 'Method unavailable.' });

  const token = request.headers.get('authorization') ?? '';
  const organization = request.headers.get('x-avi-organization')?.toLowerCase() ?? '';
  const action = request.headers.get('x-avi-card-action');
  if (!token.startsWith('Bearer ')) return reply(401, { error: 'Sign in to scan a visiting card.' });
  if (!uuid.test(organization) || (action !== 'extract' && action !== 'upload')) return reply(400, { error: 'Invalid card request.' });

  try {
    const client = createClient(project, anonymousKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: token } },
    });
    const user = await client.auth.getUser(token.slice(7));
    if (user.error || !user.data.user) return reply(401, { error: 'Sign in again to scan a visiting card.' });
    const permission = await client.rpc('authorize_card_request', { p_org: organization, p_action: action });
    if (permission.error) return permission.error.code === 'PT429'
      ? reply(429, { error: 'Card scan limit reached. Try again later.' })
      : reply(403, { error: 'Visiting card scanning is unavailable for this account.' });

    const apiKey = action === 'extract' ? Deno.env.get('OPENAI_API_KEY') : undefined;
    if (action === 'extract' && !apiKey) {
      return reply(503, { error: 'Automatic extraction is unavailable. Enter the details manually to keep this card attached.' });
    }
    const limit = action === 'extract' ? maxOcrBytes : maxImageBytes;
    const form = await boundedForm(request, 2 * limit + 32768).catch(() => null);
    if (!form) return reply(400, { error: 'The card images could not be read or exceed the file size limit.' });
    const images = [];
    for (const side of ['front', 'back']) {
      const file = form.get(side);
      if (side === 'back' && file === null) continue;
      if (!(file instanceof File) || file.size < 12 || file.size > limit) {
        return reply(400, { error: 'Supply a front image and keep each card within the file size limit.' });
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const type = cardImageType(bytes);
      if (!type || (action === 'extract' && type.mime !== 'image/jpeg')) {
        return reply(400, { error: 'Choose a valid JPG, PNG, WEBP or HEIC card image.' });
      }
      images.push({ side, bytes, ...type });
    }

    if (action === 'upload') {
      const uploadKey = crypto.randomUUID();
      const folder = organization + '/' + user.data.user.id + '/' + uploadKey;
      const bucket = service.storage.from('lead-cards');
      const uploaded: string[] = [];
      const extensions: Record<string, string> = {};
      for (const image of images) {
        const path = folder + '/' + image.side + '.' + image.extension;
        const result = await bucket.upload(path, image.bytes, { contentType: image.mime, upsert: false });
        if (result.error) {
          if (uploaded.length) await bucket.remove(uploaded);
          return reply(503, { error: 'Unable to keep the original card. Try saving again.' });
        }
        extensions[image.side] = image.extension;
        uploaded.push(path);
      }
      return reply(200, { upload_key: uploadKey, ...extensions });
    }

    const payload = visionPayload(images.map(image => 'data:image/jpeg;base64,' + encodeBase64(image.bytes)));
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(35_000),
      headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) return reply(502, { error: 'Automatic extraction is temporarily unavailable. You can enter the details manually.' });
    const output = await response.json();
    const message = output.status === 'completed' && output.output?.find((item: { type: string }) => item.type === 'message');
    const content = message?.content?.find((item: { type: string }) => item.type === 'output_text')?.text;
    const fields = content ? validateCardOutput(JSON.parse(content)) : null;
    return fields ? reply(200, { fields }) : reply(422, { error: 'We could not read this card clearly. Retake the photo or enter the details manually.' });
  } catch {
    return reply(503, { error: 'The visiting card service is temporarily unavailable. Try again or use manual entry.' });
  }
});
