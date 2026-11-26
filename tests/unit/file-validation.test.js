import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { inspectUpload, readReservedUpload } from '../../packages/domain/file-validation.js';

const examples = [
  ['application/pdf', [0x25, 0x50, 0x44, 0x46, 0x2d]],
  ['image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  ['image/jpeg', [0xff, 0xd8, 0xff]],
];

test('upload inspection recognizes approved byte signatures but requires scanning', () => {
  for (const [mime, signature] of examples) {
    const bytes = Uint8Array.from(signature);
    assert.deepEqual(inspectUpload({ bytes, declaredMime: mime, purpose: 'receipt' }),
      { detectedMime: mime, sizeBytes: signature.length, scanStatus: 'pending' });
    assert.throws(() => inspectUpload({ bytes, declaredMime: 'application/octet-stream', purpose: 'receipt' }));
    assert.throws(() => inspectUpload({ bytes: bytes.slice(0, -1), declaredMime: mime, purpose: 'receipt' }));
  }
  assert.throws(() => inspectUpload({ bytes: Uint8Array.from([0x4d,0x5a]), declaredMime: 'application/pdf', purpose: 'receipt' }));
  assert.throws(() => inspectUpload({ bytes: new Uint8Array(), declaredMime: 'image/png', purpose: 'receipt' }));
  assert.throws(() => inspectUpload({ bytes: Uint8Array.from(examples[0][1]), declaredMime: 'application/pdf', purpose: 'other' }));
});

test('upload inspection enforces separate receipt and document byte limits', () => {
  const pdf = size => { const bytes = new Uint8Array(size); bytes.set(examples[0][1]); return bytes; };
  const mib = 1024 * 1024;
  assert.equal(inspectUpload({ bytes: pdf(10 * mib), declaredMime: 'application/pdf', purpose: 'receipt' }).sizeBytes, 10 * mib);
  assert.throws(() => inspectUpload({ bytes: pdf(10 * mib + 1), declaredMime: 'application/pdf', purpose: 'receipt' }));
  assert.equal(inspectUpload({ bytes: pdf(25 * mib), declaredMime: 'application/pdf', purpose: 'business_document' }).sizeBytes, 25 * mib);
  assert.throws(() => inspectUpload({ bytes: pdf(25 * mib + 1), declaredMime: 'application/pdf', purpose: 'business_document' }));
});

test('reserved upload validates chunked bytes and hashes the exact validated buffer', async () => {
  const bytes = Uint8Array.from([...examples[0][1], 0x31, 0x2e, 0x34]);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.slice(0, 2));
      controller.enqueue(bytes.slice(2));
      controller.close();
    },
  });
  const result = await readReservedUpload({
    stream, declaredMime: 'application/pdf', declaredSize: bytes.length, purpose: 'receipt',
  });
  assert.deepEqual(result.bytes, bytes);
  assert.equal(result.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(result.scanStatus, 'pending');
  assert.equal(stream.locked, false);
});

test('reserved upload cancels oversized bodies and rejects truncated or mismatched data', async () => {
  const bytes = Uint8Array.from(examples[0][1]);
  const metadata = { declaredMime: 'application/pdf', declaredSize: bytes.length, purpose: 'receipt' };
  let cancelled = false;
  const oversized = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.enqueue(Uint8Array.of(0));
    },
    cancel() { cancelled = true; },
  });
  await assert.rejects(readReservedUpload({ ...metadata, stream: oversized }), /does not match the reservation/);
  assert.equal(cancelled, true);
  assert.equal(oversized.locked, false);

  const streamOf = chunk => new ReadableStream({
    start(controller) {
      controller.enqueue(chunk);
      controller.close();
    },
  });
  await assert.rejects(readReservedUpload({ ...metadata, stream: streamOf(bytes.slice(1)) }), /does not match the reservation/);
  await assert.rejects(readReservedUpload({ ...metadata, stream: streamOf(new Uint8Array(bytes.length)) }), /allowed signature/);
  await assert.rejects(readReservedUpload({ ...metadata, declaredSize: 10485761, stream: streamOf(bytes) }), /size is not allowed/);
});
