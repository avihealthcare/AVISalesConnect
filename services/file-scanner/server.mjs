import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { createConnection } from 'node:net';

const maximumBytes = 25 * 1024 * 1024;
const supportedTypes = new Set(['application/pdf', 'image/jpeg', 'image/png']);

async function queryClamd(address, command, bytes) {
  return await new Promise((resolve, reject) => {
    const socket = createConnection(address);
    const chunks = [];
    let length = 0;
    const timeout = setTimeout(() => socket.destroy(new Error('Scanner timed out')), 12_000);
    socket.once('close', () => {
      clearTimeout(timeout);
      reject(new Error('Scanner closed without a verdict'));
    });
    socket.once('error', reject);
    socket.once('connect', () => {
      socket.write('z' + command + '\0');
      if (bytes) {
        const size = Buffer.alloc(4);
        size.writeUInt32BE(bytes.length);
        socket.write(size);
        socket.write(bytes);
        socket.write(Buffer.alloc(4));
      }
    });
    socket.on('data', chunk => {
      const terminator = chunk.indexOf(0);
      const content = terminator < 0 ? chunk : chunk.subarray(0, terminator);
      length += content.length;
      if (length > 1024) {
        socket.destroy(new Error('Scanner response exceeded the limit'));
        return;
      }
      chunks.push(content);
      if (terminator >= 0) {
        resolve(Buffer.concat(chunks, length).toString('utf8'));
        socket.destroy();
      }
    });
  });
}

const token = process.env.AVI_FILE_SCANNER_TOKEN;
const port = Number(process.env.AVI_FILE_SCANNER_PORT ?? 4311);
const clamdPort = Number(process.env.AVI_CLAMD_PORT ?? 3310);
const socketPath = process.env.AVI_CLAMD_SOCKET;
const validPort = value => Number.isInteger(value) && value >= 1024 && value <= 65535;
if (!token || token.length < 32 || !validPort(port) || (!socketPath && !validPort(clamdPort))) {
  throw new Error('Configure the scanner credential and local listen addresses');
}
const authorization = Buffer.from('Bearer ' + token);
const clamd = socketPath ? { path: socketPath } : { host: '127.0.0.1', port: clamdPort };
let requests = 0;

const server = createServer({ requestTimeout: 18_000, headersTimeout: 5_000 }, async (request, response) => {
  function send(status, value) {
    response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify(value));
  }
  if (request.method !== 'POST' || request.url !== '/scan') return send(404, { error: 'Unavailable' });
  const header = Buffer.from(request.headers.authorization ?? '');
  if (header.length !== authorization.length || !timingSafeEqual(header, authorization)) {
    return send(401, { error: 'Unavailable' });
  }

  const size = Number(request.headers['content-length']);
  const expectedHash = request.headers['x-content-sha256'];
  if (!Number.isSafeInteger(size) || size < 1 || size > maximumBytes
      || !supportedTypes.has(request.headers['content-type'])
      || typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedHash)) {
    return send(400, { error: 'Invalid document scan request' });
  }
  if (requests >= 2) return send(503, { error: 'Scanner unavailable' });

  requests += 1;
  try {
    const bytes = Buffer.alloc(size);
    let offset = 0;
    for await (const chunk of request) {
      if (chunk.length > size - offset) return send(400, { error: 'Invalid document size' });
      chunk.copy(bytes, offset);
      offset += chunk.length;
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (offset !== size || sha256 !== expectedHash) return send(400, { error: 'Document integrity check failed' });
    const [result, version] = await Promise.all([
      queryClamd(clamd, 'INSTREAM', bytes),
      queryClamd(clamd, 'VERSION'),
    ]);
    if (!/^ClamAV [ -~]{1,73}$/.test(version)) return send(503, { error: 'Scanner unavailable' });
    if (result === 'stream: OK') return send(200, { sha256, verdict: 'clean', version });
    if (/^stream: [ -~]+ FOUND$/.test(result)) return send(200, { sha256, verdict: 'rejected', version });
    return send(503, { error: 'Scanner unavailable' });
  } catch {
    if (!response.destroyed) send(503, { error: 'Scanner unavailable' });
  } finally {
    requests -= 1;
  }
});

server.listen(port, '127.0.0.1', () => console.log('Private scanner adapter listening on loopback'));
