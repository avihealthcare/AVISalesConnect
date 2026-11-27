import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCardPhone, readCardFields } from '../../apps/web/src/cardText.ts';
import { cardImageType } from '../../supabase/functions/_shared/visiting-card.js';

const side = (...text) => text.map(item => ({text:item, confidence:95}));

test('visiting card combines front and back and flags uncertain or conflicting details', () => {
  const fields = readCardFields([
    side('Dr. Synthetic Doctor, MBBS', 'Synthetic Hospital', 'Consultant Neonatologist', '+91 90000 00001', '1 Synthetic Road', 'Mumbai 400001'),
    side('Secondary Clinic','022-2345-6789','clinic@example.invalid','www.synthetic.example','Maharashtra','Pune 411001'),
  ]);
  assert.equal(fields.contact.value, 'Synthetic Doctor');
  assert.equal(fields.salutation.value, 'Dr.');
  assert.equal(fields.qualifications.value, 'MBBS');
  assert.deepEqual(fields.customer, {value:'Synthetic Hospital', confidence:'low'});
  assert.deepEqual(fields.department, {value:'Neonatology', confidence:'low'});
  assert.equal(fields.city.value, 'Mumbai');
  assert.equal(fields.state.value, 'Maharashtra');
  assert.equal(fields.pincode.value, '400001');
  assert.equal(fields.pincode.confidence, 'low');
  assert.equal(fields.mobile.value, '+919000000001');
  assert.equal(fields.alternate_mobile.value, '+912223456789');
  assert.equal(fields.email.value, 'clinic@example.invalid');
  assert.equal(fields.website.value, 'www.synthetic.example');
  assert.match(fields.hospital_address.value, /Synthetic Road/);
  assert.equal(normalizeCardPhone('0044 20 7946 0958'), '+442079460958');
  assert.equal(normalizeCardPhone('unknown'), null);
  assert.deepEqual(readCardFields([[{text:'Dr. Unreadable',confidence:10}],[]]), {});
  const second = readCardFields([side('Synthetic Sharma','Biomedical Engineer','Mumbai, Maharashtra 400001','Mobile: 9876 543210')]);
  assert.deepEqual(second.contact,{value:'Synthetic Sharma',confidence:'low'});
  assert.equal(second.city.value,'Mumbai');
  assert.equal(second.pincode.value,'400001');
});

test('visiting-card intake checks raw image signatures independently of filenames', () => {
  const sample = hex => new Uint8Array(Buffer.from(hex, 'hex'));
  assert.equal(cardImageType(sample('ffd8ffe000104a4649460001')).extension, 'jpg');
  assert.equal(cardImageType(sample('89504e470d0a1a0a0000000d')).extension, 'png');
  assert.equal(cardImageType(Buffer.from('RIFF0000WEBP')).extension, 'webp');
  assert.equal(cardImageType(sample('00000018667479706d69663100000000686569636d696166')).extension, 'heic');
  assert.equal(cardImageType(sample('000000186674797061766966000000006d6966316d696166')), null);
  assert.equal(cardImageType(Buffer.from('<svg><script>')), null);
});
