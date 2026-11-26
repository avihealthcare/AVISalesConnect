import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
assert.ok(url?.startsWith('https://') && key?.startsWith('sb_publishable_'),
  'Configure the HTTPS project URL and its publishable key before running hosted checks');

function request(path, body) {
  const headers = { apikey: key, Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  return fetch(new URL(`/rest/v1/${path}`, url), {
    headers, method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000)
  });
}

test('anonymous callers cannot list customers, leads or opportunities through the hosted API', async () => {
  for (const relation of ['accounts', 'leads', 'opportunities']) {
    const response = await request(`${relation}?select=id&limit=1`);
    assert.ok([401, 403].includes(response.status), `${relation}: expected access denial, got ${response.status}`);
    assert.equal((await response.json()).code, '42501');
  }
});

test('anonymous callers cannot invoke the hosted pipeline command', async () => {
  const response = await request('rpc/update_opportunity_pipeline', {
    p_org: randomUUID(), p_id: randomUUID(), p_key: randomUUID(), p_version: 1,
    p_stage: 'Proposal', p_amount: '10.00', p_probability: 50, p_reason: 'Synthetic access check'
  });
  assert.ok([401, 403].includes(response.status), `Expected access denial, got ${response.status}`);
  assert.equal((await response.json()).code, '42501');
});
