// Opt-in against a disposable ClamAV process listening on loopback.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';

const clamdPort = Number(process.env.AVI_TEST_CLAMD_PORT);
assert.ok(Number.isInteger(clamdPort) && clamdPort >= 1024 && clamdPort <= 65535,
  'Set AVI_TEST_CLAMD_PORT for the private test engine on loopback');

test('the private ClamAV adapter binds its clean and rejected verdicts to the submitted bytes', async () => {
  const token = randomBytes(32).toString('base64url');
  const port = '43311';
  const daemon = spawn(process.execPath, ['services/file-scanner/server.mjs'], {
    env: { ...process.env, AVI_FILE_SCANNER_TOKEN: token, AVI_FILE_SCANNER_PORT: port,
      AVI_CLAMD_PORT: String(clamdPort), AVI_CLAMD_SOCKET: '' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  try {
    await Promise.race([
      once(daemon.stdout, 'data', { signal: AbortSignal.timeout(5_000) }),
      once(daemon, 'exit').then(() => { throw new Error('Scanner adapter exited'); }),
    ]);
    const scan = (body, options = {}) => fetch('http://127.0.0.1:' + port + '/scan', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + token,
        'content-type': 'application/pdf',
        'x-content-sha256': createHash('sha256').update(body).digest('hex'),
        ...options,
      },
      body,
      signal: AbortSignal.timeout(18_000),
    });
    const cleanBytes = Buffer.from('%PDF-1.4\n% synthetic ClamAV test\n');
    assert.equal((await scan(cleanBytes, { authorization: 'Bearer bad' })).status, 401);
    assert.equal((await scan(cleanBytes, { 'x-content-sha256': '0'.repeat(64) })).status, 400);
    const clean = await scan(cleanBytes);
    assert.equal(clean.status, 200);
    assert.deepEqual(await clean.json().then(({ sha256, verdict }) => ({ sha256, verdict })), {
      sha256: createHash('sha256').update(cleanBytes).digest('hex'),
      verdict: 'clean',
    });

    // The standard EICAR diagnostic is inert and constructed in memory.
    const diagnostic = Buffer.from([
      'X5O!P%@AP[4', '\\PZX54(P^)7CC)7}$', 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
    ].join(''));
    const blocked = await scan(diagnostic);
    assert.equal(blocked.status, 200);
    const result = await blocked.json();
    assert.equal(result.sha256, createHash('sha256').update(diagnostic).digest('hex'));
    assert.equal(result.verdict, 'rejected');
    assert.match(result.version, /^ClamAV /);
  } finally {
    daemon.kill();
    if (daemon.exitCode === null && daemon.signalCode === null) await once(daemon, 'exit');
  }
});
