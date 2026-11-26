import { createClient } from 'npm:@supabase/supabase-js@2.119.2';
import { createPrivateFileHandler } from '../_shared/private-files.js';

const client = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const allowedOrigin = Deno.env.get('AVI_FILE_ALLOWED_ORIGIN');
const configuredScanner = Deno.env.get('AVI_FILE_SCANNER_URL');
const scannerToken = Deno.env.get('AVI_FILE_SCANNER_TOKEN');
const scanner = configuredScanner ? new URL(configuredScanner) : null;
if (scanner && (scanner.protocol !== 'https:' || scanner.username || scanner.password || !scannerToken)) {
  throw new Error('Configure the approved HTTPS file scanner and its server credential');
}

async function scanFile(file: { bytes: Uint8Array; sha256: string; detectedMime: string }) {
  if (!scanner || !scannerToken) return null;
  const response = await fetch(scanner, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
    headers: {
      authorization: 'Bearer ' + scannerToken,
      'content-type': file.detectedMime,
      'x-content-sha256': file.sha256,
    },
    body: file.bytes.buffer as ArrayBuffer,
  });
  if (!response.ok || !response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return JSON.parse(text + decoder.decode());
      size += value.byteLength;
      if (size > 1024) return null;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

Deno.serve(createPrivateFileHandler({
  client,
  allowedOrigin,
  enabled: Deno.env.get('AVI_PRIVATE_FILES_ENABLED') === 'true',
  scan: scanner ? scanFile : undefined,
}));
