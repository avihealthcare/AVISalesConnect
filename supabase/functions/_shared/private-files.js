import { readReservedUpload } from './file-validation.js';

const quarantine = 'avi-file-quarantine';
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

class FileRequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function checkedDatabaseResult({ data, error }) {
  if (!error) return data;
  if (error.code === '42501') throw new FileRequestError(404, 'File unavailable');
  if (error.code === 'PT409') throw new FileRequestError(409, 'File conflicts with the reserved upload');
  throw new FileRequestError(503, 'File service temporarily unavailable');
}

async function inspect(stream, metadata) {
  return readReservedUpload({
    stream,
    declaredMime: metadata.mime,
    declaredSize: metadata.size,
    purpose: metadata.purpose,
  });
}

async function readStored(storage, metadata, expectedHash) {
  const { data, error } = await storage.download(metadata.path);
  if (error || !data) throw new FileRequestError(503, 'File service temporarily unavailable');
  const result = await inspect(data.stream(), metadata).catch(() => null);
  if (!result || result.sha256 !== expectedHash) {
    throw new FileRequestError(503, 'File service temporarily unavailable');
  }
  return result.bytes;
}

/** The client must use a server credential. Never bundle this handler into the web app. */
export function createPrivateFileHandler({ client, allowedOrigin, enabled, scan }) {
  const storage = client.storage.from(quarantine);
  return async request => {
    const origin = request.headers.get('origin');
    const headers = new Headers({
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      vary: 'Origin',
    });
    const json = (value, status) => Response.json(value, { status, headers });
    if (origin && origin !== allowedOrigin) return json({ error: 'Origin not allowed' }, 403);
    if (origin) {
      headers.set('access-control-allow-origin', origin);
      headers.set('access-control-allow-headers', 'authorization, apikey, content-type, x-client-info');
      headers.set('access-control-allow-methods', 'GET, POST, OPTIONS');
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (!enabled) return json({ error: 'File service unavailable' }, 503);
    if (request.method !== 'POST' && request.method !== 'GET') {
      headers.set('allow', 'GET, POST, OPTIONS');
      return json({ error: 'Method not allowed' }, 405);
    }

    const authorization = request.headers.get('authorization') ?? '';
    if (!authorization.startsWith('Bearer ') || authorization.length > 8192) {
      return json({ error: 'Sign in to access files' }, 401);
    }
    const claims = await client.auth.getClaims(authorization.slice(7))
      .then(result => result.error ? null : result.data?.claims)
      .catch(() => null);
    if (!claims || typeof claims.sub !== 'string' || !uuid.test(claims.sub)
        || typeof claims.session_id !== 'string' || !uuid.test(claims.session_id)) {
      return json({ error: 'Sign in to access files' }, 401);
    }

    const stage = new URL(request.url).searchParams.get('stage');
    if (!stage || !uuid.test(stage)) return json({ error: 'File unavailable' }, 404);
    const actor = { p_user: claims.sub, p_session: claims.session_id, p_stage: stage };
    try {
      const downloading = request.method === 'GET';
      const metadata = checkedDatabaseResult(await client.rpc('file_worker_lookup', {
        ...actor, p_download: downloading,
      }));
      if (downloading) {
        const bytes = await readStored(storage, metadata, metadata.sha256);
        // Catch changes to permission, owner, or session during the Storage read.
        checkedDatabaseResult(await client.rpc('file_worker_lookup', { ...actor, p_download: true }));
        const name = encodeURIComponent(metadata.name).replace(/[!'()*]/g,
          character => '%' + character.charCodeAt(0).toString(16));
        headers.set('content-disposition', "attachment; filename=download; filename*=UTF-8''" + name);
        headers.set('content-type', metadata.mime);
        headers.set('content-length', String(bytes.byteLength));
        return new Response(bytes, { headers });
      }

      if (!request.body || request.headers.get('content-type') !== metadata.mime) {
        throw new FileRequestError(415, 'Upload the reserved file type');
      }
      const uploaded = await inspect(request.body, metadata).catch(() => null);
      if (!uploaded) throw new FileRequestError(422, 'File bytes do not match the reservation');
      const transition = async (action, { lease = null, verdict = null, scanner = null } = {}) =>
        checkedDatabaseResult(await client.rpc('file_worker_transition', {
          ...actor, p_hash: uploaded.sha256, p_action: action, p_lease: lease,
          p_verdict: verdict, p_scanner: scanner,
        }));

      let status = await transition('claim');
      if (status === 'claimed') {
        const put = await storage.upload(metadata.path, uploaded.bytes, {
          contentType: metadata.mime, upsert: false,
        });
        if (put.error) await readStored(storage, metadata, uploaded.sha256);
        status = await transition('stored');
      }
      if (status === 'stored' && scan) {
        const lease = crypto.randomUUID();
        status = await transition('scan', { lease });
        if (status === 'scan_acquired') {
          const result = await scan(uploaded).catch(() => null);
          if (!result || result.sha256 !== uploaded.sha256
              || !['clean', 'rejected'].includes(result.verdict)
              || typeof result.version !== 'string' || !/^[ -~]{1,80}$/.test(result.version)) {
            return json({ status: 'awaiting_scan' }, 202);
          }
          status = await transition('verdict', { lease, verdict: result.verdict, scanner: result.version });
        }
      }
      if (status === 'clean') return json({ status: 'available' }, 200);
      if (status === 'rejected') return json({ status: 'rejected' }, 200);
      return json({ status: status === 'scanning' ? 'scanning' : 'awaiting_scan' }, 202);
    } catch (error) {
      if (error instanceof FileRequestError) return json({ error: error.message }, error.status);
      return json({ error: 'File service temporarily unavailable' }, 503);
    }
  };
}
