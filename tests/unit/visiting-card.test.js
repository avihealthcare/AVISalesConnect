import test from 'node:test';
import assert from 'node:assert/strict';
import { cardFields, cardImageType, normalizeCardPhone, validateCardOutput, visionPayload } from '../../supabase/functions/_shared/visiting-card.js';

test('visiting-card OCR validates structured fields and marks uncertain values for review', () => {
  const output = { readable: true, fields: Object.fromEntries(Object.keys(cardFields).map(field => [
    field, { value: null, confidence: 'low' },
  ])) };
  output.fields.contact = { value: ' Synthetic  Doctor ', confidence: 'high' };
  output.fields.mobile = { value: '09000 000 001', confidence: 'high' };
  output.fields.alternate_mobile = { value: '022-2345-6789', confidence: 'medium' };
  output.fields.pincode = { value: '40000', confidence: 'high' };
  output.fields.email = { value: 'clinic@', confidence: 'high' };
  const fields = validateCardOutput(output);
  assert.equal(fields.contact.value, 'Synthetic Doctor');
  assert.equal(fields.mobile.value, '+919000000001');
  assert.equal(fields.alternate_mobile.value, '+912223456789');
  assert.equal(fields.pincode.confidence, 'low');
  assert.equal(fields.email.confidence, 'low');
  assert.equal(normalizeCardPhone('0044 20 7946 0958'), '+442079460958');
  assert.equal(normalizeCardPhone('unknown'), null);
  assert.equal(validateCardOutput({ ...output, readable: false }), null);
  output.fields.email.confidence = 'proven';
  assert.equal(validateCardOutput(output), null);
  const payload = visionPayload(['data:image/jpeg;base64,synthetic-front', 'data:image/jpeg;base64,synthetic-back']);
  assert.equal(payload.store, false);
  assert.equal(payload.text.format.strict, true);
  assert.equal(payload.input[0].content[2].type, 'input_image');
});

test('visiting-card intake checks raw image signatures independently of filenames', () => {
  const sample = (hex) => new Uint8Array(Buffer.from(hex, 'hex'));
  assert.equal(cardImageType(sample('ffd8ffe000104a4649460001')).extension, 'jpg');
  assert.equal(cardImageType(sample('89504e470d0a1a0a0000000d')).extension, 'png');
  assert.equal(cardImageType(Buffer.from('RIFF0000WEBP')).extension, 'webp');
  assert.equal(cardImageType(sample('00000018667479706d69663100000000686569636d696166')).extension, 'heic');
  assert.equal(cardImageType(sample('000000186674797061766966000000006d6966316d696166')), null);
  assert.equal(cardImageType(Buffer.from('<svg><script>')), null);
});
