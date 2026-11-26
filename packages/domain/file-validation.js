// Preliminary byte/type/size check for a future trusted upload worker.
// A matching signature is not malware scanning or proof of a safe file.
const MIB = 1024 * 1024;
const signatures = [
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
];

/** Only call in a trusted server after enforcing a streaming input size limit. */
export function inspectUpload({ bytes, declaredMime, purpose }) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('File bytes are required');
  const maxBytes = limitForPurpose(purpose);
  if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) throw new Error('File size is not allowed');
  const detected = signatures.find(({ bytes: signature }) => signature.every((byte, i) => bytes[i] === byte));
  if (!detected || detected.mime !== declaredMime) throw new Error('File type does not match an allowed signature');
  return { detectedMime: detected.mime, sizeBytes: bytes.byteLength, scanStatus: 'pending' };
}

function limitForPurpose(purpose) {
  if (purpose !== 'receipt' && purpose !== 'business_document') throw new Error('Unsupported file purpose');
  return (purpose === 'receipt' ? 10 : 25) * MIB;
}

/** Read only the reserved number of bytes before handing a bounded buffer to quarantine. */
export async function readReservedUpload({ stream, declaredMime, declaredSize, purpose }) {
  const reader = stream.getReader();
  try {
    if (!Number.isSafeInteger(declaredSize) || declaredSize < 1 || declaredSize > limitForPurpose(purpose)) {
      throw new Error('File size is not allowed');
    }
    const bytes = new Uint8Array(declaredSize);
    let offset = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new TypeError('File bytes are required');
      if (value.byteLength > bytes.byteLength - offset) {
        throw new Error('File size does not match the reservation');
      }
      bytes.set(value, offset);
      offset += value.byteLength;
    }
    if (offset !== declaredSize) throw new Error('File size does not match the reservation');

    const inspection = inspectUpload({ bytes, declaredMime, purpose });
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    return { ...inspection, bytes, sha256 };
  } catch (error) {
    // Start cancellation without waiting for a producer that may never acknowledge it.
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}
