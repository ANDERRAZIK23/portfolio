import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { exportJWK, generateKeyPair, jwtVerify, SignJWT } from 'jose';
import worker, { parseCollectEvent, readLimitedBody, validateFileName, visitorIdentifier } from '../src/index.js';
import { createBucket, createDatabase } from './fixtures.js';

const ADMIN_ORIGIN = 'https://admin.imachraf.tech';
const SITE_ORIGIN = 'https://imachraf.tech';
const TEAM_DOMAIN = 'portfolio-tests.cloudflareaccess.com';
const ADMIN_EMAIL = 'owner@example.com';
const AUDIENCE = 'test-admin-audience';
const FILE_UPLOAD_SECRET = 'a-test-upload-secret-with-at-least-thirty-two-characters';
const UPLOAD_PART_SIZE = 10 * 1024 * 1024;
const MAX_FILE_SIZE = 200 * 1024 * 1024;
let privateKey;
let validToken;
let schema;
const originalFetch = globalThis.fetch;

before(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  const publicKey = await exportJWK(pair.publicKey);
  publicKey.kid = 'portfolio-test-key';
  globalThis.fetch = async (url) => {
    assert.equal(String(url), `https://${TEAM_DOMAIN}/cdn-cgi/access/certs`);
    return Response.json({ keys: [publicKey] });
  };
  validToken = await token();
  schema = await readFile(new URL('../migrations/0001_analytics.sql', import.meta.url), 'utf8');
});

after(() => {
  globalThis.fetch = originalFetch;
});

async function token(claims = {}, options = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ email: ADMIN_EMAIL, ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'portfolio-test-key' })
    .setIssuer(options.issuer ?? `https://${TEAM_DOMAIN}`)
    .setAudience(options.audience ?? AUDIENCE)
    .setSubject('test-user')
    .setIssuedAt(now)
    .setExpirationTime(options.expiration ?? now + 300)
    .sign(privateKey);
}

function environment(t) {
  const DB = createDatabase(schema);
  t.after(() => DB.sqlite.close());
  return {
    DB,
    FILES: createBucket(),
    ASSETS: { fetch: async () => new Response('<html>Private admin</html>', { headers: { 'Content-Type': 'text/html' } }) },
    COLLECT_LIMITER: { limit: async () => ({ success: true }) },
    SITE_ORIGIN,
    ADMIN_EMAIL,
    ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
    ACCESS_AUD: AUDIENCE,
    ANALYTICS_SALT: 'a-test-secret-with-at-least-thirty-two-characters',
    FILE_UPLOAD_SECRET,
  };
}

function adminRequest(path, options = {}) {
  const headers = new Headers(options.headers);
  headers.set('Cf-Access-Jwt-Assertion', options.token ?? validToken);
  return new Request(`${ADMIN_ORIGIN}${path}`, { ...options, headers });
}

async function fetchWorker(request, env) {
  const tasks = [];
  const response = await worker.fetch(request, env, { waitUntil: (task) => tasks.push(task) });
  await Promise.all(tasks);
  return response;
}

test('every admin route requires a signed Access token, including assets and downloads', async (t) => {
  const env = environment(t);
  for (const path of ['/', '/admin.js', '/api/session', '/api/stats', '/api/files', '/api/files/private.txt',
    '/api/uploads', '/api/uploads/parts/1', '/api/uploads/complete']) {
    const response = await fetchWorker(new Request(`${ADMIN_ORIGIN}${path}`), env);
    assert.equal(response.status, 401, path);
    assert.match(response.headers.get('cache-control'), /(?:^|,\s*)no-store(?:,|$)/, path);
    assert.equal(response.headers.get('access-control-allow-origin'), null, path);
  }
});

test('signed Access tokens verify the owner, audience, issuer, expiration and signature', async (t) => {
  const env = environment(t);
  const success = await fetchWorker(adminRequest('/api/session'), env);
  assert.equal(success.status, 200);
  assert.equal((await success.json()).email, ADMIN_EMAIL);

  const otherPair = await generateKeyPair('RS256');
  const forgedToken = await new SignJWT({ email: ADMIN_EMAIL })
    .setProtectedHeader({ alg: 'RS256', kid: 'portfolio-test-key' })
    .setIssuer(`https://${TEAM_DOMAIN}`)
    .setAudience(AUDIENCE)
    .setSubject('test-user')
    .setExpirationTime('5m')
    .sign(otherPair.privateKey);
  const invalidTokens = [
    await token({ email: 'someone-else@example.com' }),
    await token({}, { audience: 'another-application' }),
    await token({}, { issuer: 'https://attacker.example' }),
    await token({}, { expiration: Math.floor(Date.now() / 1000) - 60 }),
    forgedToken,
    'not-a-jwt',
  ];
  for (const accessToken of invalidTokens) {
    const response = await fetchWorker(adminRequest('/api/session', { token: accessToken }), env);
    assert.ok([401, 403].includes(response.status), `Token was accepted: ${response.status}`);
    assert.match(response.headers.get('cache-control'), /(?:^|,\s*)no-store(?:,|$)/);
  }
});

test('upload and delete require same-origin requests even with a valid admin token', async (t) => {
  const env = environment(t);
  for (const origin of [undefined, 'https://attacker.example', SITE_ORIGIN]) {
    const headers = { 'X-File-Name': 'private.txt', 'Content-Type': 'text/plain' };
    if (origin) headers.Origin = origin;
    const upload = await fetchWorker(adminRequest('/api/files', { method: 'POST', headers, body: 'secret' }), env);
    assert.equal(upload.status, 403);
    const deletion = await fetchWorker(adminRequest('/api/files/files%2F00000000-0000-4000-8000-000000000000', { method: 'DELETE', headers }), env);
    assert.equal(deletion.status, 403);
  }
  assert.equal(env.FILES.entries.size, 0);
});

test('body limits apply to streams without a Content-Length header', async () => {
  let cancelled = false;
  const oversized = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(5));
    },
    cancel() { cancelled = true; },
  });
  const request = new Request(`${ADMIN_ORIGIN}/api/files`, { method: 'POST', body: oversized, duplex: 'half' });
  await assert.rejects(readLimitedBody(request, 8));
  assert.equal(cancelled, true);

  const exactRequest = new Request(`${ADMIN_ORIGIN}/api/files`, { method: 'POST', body: '12345678' });
  assert.deepEqual(await readLimitedBody(exactRequest, 8), new TextEncoder().encode('12345678'));
});

test('collector preflight is limited to the portfolio origin and never allows credentials', async (t) => {
  const env = environment(t);
  const allowed = await fetchWorker(new Request(`${ADMIN_ORIGIN}/api/collect`, {
    method: 'OPTIONS',
    headers: { Origin: SITE_ORIGIN, 'Access-Control-Request-Method': 'POST' },
  }), env);
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get('access-control-allow-origin'), SITE_ORIGIN);
  assert.equal(allowed.headers.get('access-control-allow-credentials'), null);

  const rejected = await fetchWorker(new Request(`${ADMIN_ORIGIN}/api/collect`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://attacker.example', 'Access-Control-Request-Method': 'POST' },
  }), env);
  assert.equal(rejected.status, 403);
  assert.equal(rejected.headers.get('access-control-allow-origin'), null);
});

test('private files retain their bytes and safe names across upload, list, download and delete', async (t) => {
  const env = environment(t);
  const bytes = new Uint8Array([0, 1, 2, 127, 128, 255]);
  const name = 'Résumé "private".pdf';
  const upload = await fetchWorker(adminRequest('/api/files', {
    method: 'POST',
    headers: { Origin: ADMIN_ORIGIN, 'X-File-Name': encodeURIComponent(` ${name.normalize('NFD')} `) },
    body: bytes,
  }), env);
  assert.equal(upload.status, 201);
  const created = await upload.json();
  assert.match(created.key, /^files\/[0-9a-f-]{36}$/);
  assert.equal(created.name, name);
  assert.equal(created.size, bytes.byteLength);
  assert.ok(Number.isFinite(Date.parse(created.uploaded)));

  const listing = await fetchWorker(adminRequest('/api/files'), env);
  assert.deepEqual(await listing.json(), { files: [created], cursor: null, hasMore: false });
  const filePath = `/api/files/${encodeURIComponent(created.key)}`;
  assert.equal((await fetchWorker(new Request(`${ADMIN_ORIGIN}${filePath}`), env)).status, 401);

  const download = await fetchWorker(adminRequest(filePath), env);
  assert.equal(download.status, 200);
  assert.deepEqual(new Uint8Array(await download.arrayBuffer()), bytes);
  assert.equal(download.headers.get('content-type'), 'application/octet-stream');
  assert.equal(download.headers.get('content-length'), String(bytes.byteLength));
  assert.match(download.headers.get('content-disposition'), /^attachment;/);
  assert.ok(download.headers.get('content-disposition').includes(`filename*=UTF-8''${encodeURIComponent(name)}`));
  assert.match(download.headers.get('cache-control'), /no-store/);
  assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(download.headers.get('access-control-allow-origin'), null);

  const deletion = await fetchWorker(adminRequest(filePath, { method: 'DELETE', headers: { Origin: ADMIN_ORIGIN } }), env);
  assert.equal(deletion.status, 204);
  assert.equal(env.FILES.entries.size, 0);
  assert.equal((await fetchWorker(adminRequest(filePath), env)).status, 404);
  assert.deepEqual((await (await fetchWorker(adminRequest('/api/files'), env)).json()).files, []);
});

test('unsafe names, malformed encoding and oversized uploads never enter private storage', async (t) => {
  const env = environment(t);
  for (const name of ['../secret.txt', 'folder/file.txt', 'folder\\file.txt', 'report\r\nX-Test: injected', '.', '..', 'a'.repeat(181)]) {
    assert.throws(() => validateFileName(name));
    const response = await fetchWorker(adminRequest('/api/files', {
      method: 'POST',
      headers: { Origin: ADMIN_ORIGIN, 'X-File-Name': encodeURIComponent(name) },
      body: 'secret',
    }), env);
    assert.equal(response.status, 400, name);
  }
  const malformed = await fetchWorker(adminRequest('/api/files', {
    method: 'POST', headers: { Origin: ADMIN_ORIGIN, 'X-File-Name': '%E0%A4%A' }, body: 'secret',
  }), env);
  assert.equal(malformed.status, 400);
  const oversized = await fetchWorker(adminRequest('/api/files', {
    method: 'POST',
    headers: { Origin: ADMIN_ORIGIN, 'X-File-Name': 'large.bin', 'Content-Length': String(20 * 1024 * 1024 + 1) },
    body: 'secret',
  }), env);
  assert.equal(oversized.status, 413);
  assert.equal(env.FILES.entries.size, 0);
});

function uploadJsonRequest(path, value, options = {}) {
  return adminRequest(path, {
    method: 'POST',
    ...options,
    headers: { Origin: ADMIN_ORIGIN, 'Content-Type': 'application/json', ...options.headers },
    body: JSON.stringify(value),
  });
}

async function beginUpload(env, size, name = 'private.bin') {
  const response = await fetchWorker(uploadJsonRequest('/api/uploads', { name, size }), env);
  assert.equal(response.status, 201);
  const upload = await response.json();
  assert.equal(upload.partSize, UPLOAD_PART_SIZE);
  assert.equal(upload.partCount, Math.ceil(size / UPLOAD_PART_SIZE));
  assert.equal(typeof upload.token, 'string');
  return upload;
}

function uploadPartRequest(upload, partNumber, body, options = {}) {
  return adminRequest(`/api/uploads/parts/${partNumber}`, {
    method: 'PUT',
    ...options,
    headers: { Origin: ADMIN_ORIGIN, 'X-Upload-Token': upload.token, ...options.headers },
    body,
  });
}

test('multipart uploads preserve ordered bytes and file metadata through completion and download', async (t) => {
  const env = environment(t);
  const finalBytes = new Uint8Array([0, 1, 128, 254, 255]);
  const firstBytes = new Uint8Array(UPLOAD_PART_SIZE).fill(127);
  const name = 'Fichier privé.bin';
  const upload = await beginUpload(env, firstBytes.byteLength + finalBytes.byteLength, name);
  const verified = await jwtVerify(upload.token, new TextEncoder().encode(FILE_UPLOAD_SECRET), {
    algorithms: ['HS256'], issuer: ADMIN_ORIGIN, audience: 'portfolio-file-upload', subject: ADMIN_EMAIL,
  });
  assert.equal(verified.payload.size, firstBytes.byteLength + finalBytes.byteLength);
  assert.match(verified.payload.key, /^files\/[0-9a-f-]{36}$/);
  assert.equal(verified.payload.exp - verified.payload.iat, 2 * 60 * 60);
  assert.equal(env.FILES.entries.size, 0);

  const parts = [];
  for (const [index, bytes] of [firstBytes, finalBytes].entries()) {
    const response = await fetchWorker(uploadPartRequest(upload, index + 1, bytes), env);
    assert.equal(response.status, 200);
    const part = await response.json();
    assert.equal(part.partNumber, index + 1);
    assert.equal(typeof part.etag, 'string');
    parts.push(part);
  }
  assert.deepEqual((await (await fetchWorker(adminRequest('/api/files'), env)).json()).files, []);

  const invalidParts = [
    [], [parts[0]], [parts[1], parts[0]], [parts[0], parts[0]],
    [parts[0], { ...parts[1], etag: '' }],
    [parts[0], { ...parts[1], etag: 'a'.repeat(257) }],
    [parts[0], { ...parts[1], etag: 'unsafe\nheader' }],
    [parts[0], { ...parts[1], etag: 'unsafe\u007fheader' }],
  ];
  for (const invalid of invalidParts) {
    const response = await fetchWorker(uploadJsonRequest('/api/uploads/complete', { token: upload.token, parts: invalid }), env);
    assert.equal(response.status, 400);
    assert.equal(env.FILES.entries.size, 0);
    assert.equal(env.FILES.multipartUploads.size, 1);
  }

  const response = await fetchWorker(uploadJsonRequest('/api/uploads/complete', { token: upload.token, parts }), env);
  assert.equal(response.status, 201);
  const created = await response.json();
  assert.equal(created.key, verified.payload.key);
  assert.equal(created.name, name);
  assert.equal(created.size, firstBytes.byteLength + finalBytes.byteLength);
  assert.ok(Number.isFinite(Date.parse(created.uploaded)));
  assert.equal(env.FILES.multipartUploads.size, 0);
  assert.deepEqual((await (await fetchWorker(adminRequest('/api/files'), env)).json()).files, [created]);
  const download = await fetchWorker(adminRequest(`/api/files/${encodeURIComponent(created.key)}`), env);
  assert.equal(download.status, 200);
  const received = new Uint8Array(await download.arrayBuffer());
  assert.deepEqual(received.subarray(0, firstBytes.byteLength), firstBytes);
  assert.deepEqual(received.subarray(firstBytes.byteLength), finalBytes);
  assert.equal(download.headers.get('content-length'), String(created.size));
  assert.equal(download.headers.get('content-type'), 'application/octet-stream');
});

test('multipart initialization accepts the 200 MiB boundary and rejects invalid sizes or names before creating storage', async (t) => {
  const env = environment(t);
  for (const size of [1, UPLOAD_PART_SIZE, MAX_FILE_SIZE]) {
    const upload = await beginUpload(env, size);
    const aborted = await fetchWorker(adminRequest('/api/uploads', {
      method: 'DELETE', headers: { Origin: ADMIN_ORIGIN, 'X-Upload-Token': upload.token },
    }), env);
    assert.equal(aborted.status, 204);
  }
  for (const size of [0, -1, 1.5, '100', null, Number.MAX_SAFE_INTEGER + 1]) {
    const response = await fetchWorker(uploadJsonRequest('/api/uploads', { name: 'file.bin', size }), env);
    assert.equal(response.status, 400, String(size));
  }
  const tooLarge = await fetchWorker(uploadJsonRequest('/api/uploads', { name: 'file.bin', size: MAX_FILE_SIZE + 1 }), env);
  assert.equal(tooLarge.status, 413);
  for (const name of ['../secret.bin', 'folder/file.bin', '.', 'unsafe\r\nname', 'a'.repeat(181)]) {
    const response = await fetchWorker(uploadJsonRequest('/api/uploads', { name, size: 1 }), env);
    assert.equal(response.status, 400, name);
  }
  assert.equal(env.FILES.multipartUploads.size, 0);
  assert.equal(env.FILES.entries.size, 0);
});

test('multipart parts must fit the exact declared file size and part range', async (t) => {
  const env = environment(t);
  const upload = await beginUpload(env, UPLOAD_PART_SIZE + 5);
  const invalidParts = [
    { number: 3, body: new Uint8Array(5), status: 400 },
    { number: 1, body: new Uint8Array(5), status: 400 },
    { number: 2, body: new Uint8Array(4), status: 400 },
    { number: 2, body: new Uint8Array(6), status: 413 },
  ];
  for (const part of invalidParts) {
    const response = await fetchWorker(uploadPartRequest(upload, part.number, part.body), env);
    assert.equal(response.status, part.status);
  }
  const oversizedHeader = await fetchWorker(uploadPartRequest(upload, 1, 'x', {
    headers: { 'Content-Length': String(UPLOAD_PART_SIZE + 1) },
  }), env);
  assert.equal(oversizedHeader.status, 413);
  assert.equal([...env.FILES.multipartUploads.values()][0].parts.size, 0);
  assert.equal(env.FILES.entries.size, 0);
});

test('multipart abort discards uploaded parts without creating a file', async (t) => {
  const env = environment(t);
  const upload = await beginUpload(env, 3);
  assert.equal((await fetchWorker(uploadPartRequest(upload, 1, 'abc'), env)).status, 200);
  const response = await fetchWorker(adminRequest('/api/uploads', {
    method: 'DELETE', headers: { Origin: ADMIN_ORIGIN, 'X-Upload-Token': upload.token },
  }), env);
  assert.equal(response.status, 204);
  assert.equal(env.FILES.multipartUploads.size, 0);
  assert.equal(env.FILES.entries.size, 0);
});

test('every multipart mutation requires both Access authentication and the administration origin', async (t) => {
  const env = environment(t);
  const upload = await beginUpload(env, 1);
  const routes = [
    { path: '/api/uploads', method: 'POST', body: JSON.stringify({ name: 'file.bin', size: 1 }) },
    { path: '/api/uploads/parts/1', method: 'PUT', body: 'x' },
    { path: '/api/uploads/complete', method: 'POST', body: JSON.stringify({ token: upload.token, parts: [] }) },
    { path: '/api/uploads', method: 'DELETE' },
  ];
  for (const route of routes) {
    const unauthenticated = await fetchWorker(new Request(`${ADMIN_ORIGIN}${route.path}`, {
      method: route.method, body: route.body,
      headers: { Origin: ADMIN_ORIGIN, 'Content-Type': 'application/json', 'X-Upload-Token': upload.token },
    }), env);
    assert.equal(unauthenticated.status, 401);
    for (const origin of [undefined, 'https://attacker.example', SITE_ORIGIN]) {
      const headers = { 'Content-Type': 'application/json', 'X-Upload-Token': upload.token };
      if (origin) headers.Origin = origin;
      const response = await fetchWorker(adminRequest(route.path, { method: route.method, body: route.body, headers }), env);
      assert.equal(response.status, 403, `${route.method} ${route.path} ${origin}`);
    }
  }
  assert.equal(env.FILES.multipartUploads.size, 1);
  assert.equal(env.FILES.entries.size, 0);
});

test('multipart tokens reject tampering, expiry, another owner and another administration origin', async (t) => {
  const env = environment(t);
  const upload = await beginUpload(env, 1);
  const secret = new TextEncoder().encode(FILE_UPLOAD_SECRET);
  const { payload } = await jwtVerify(upload.token, secret);
  const now = Math.floor(Date.now() / 1000);
  const expired = await new SignJWT({ key: payload.key, uploadId: payload.uploadId, size: payload.size })
    .setProtectedHeader({ alg: 'HS256' }).setIssuer(ADMIN_ORIGIN).setAudience('portfolio-file-upload')
    .setSubject(ADMIN_EMAIL).setIssuedAt(now - 600).setExpirationTime(now - 60).sign(secret);
  const segments = upload.token.split('.');
  segments[1] = Buffer.from(JSON.stringify({ ...payload, size: 2 })).toString('base64url');
  for (const invalidToken of [undefined, 'not-a-jwt', expired, segments.join('.')]) {
    const response = await fetchWorker(uploadPartRequest({ token: invalidToken ?? '' }, 1, 'x'), env);
    assert.equal(response.status, 400);
    assert.match(response.headers.get('cache-control'), /no-store/);
  }
  const otherEmail = 'another-owner@example.com';
  const otherOwner = await fetchWorker(uploadPartRequest(upload, 1, 'x', {
    token: await token({ email: otherEmail }),
  }), { ...env, ADMIN_EMAIL: otherEmail });
  assert.equal(otherOwner.status, 400);
  const otherOrigin = 'https://another-admin.example.com';
  const moved = await fetchWorker(new Request(`${otherOrigin}/api/uploads/parts/1`, {
    method: 'PUT', body: 'x',
    headers: { Origin: otherOrigin, 'Cf-Access-Jwt-Assertion': validToken, 'X-Upload-Token': upload.token },
  }), env);
  assert.equal(moved.status, 400);
  assert.equal([...env.FILES.multipartUploads.values()][0].parts.size, 0);
});

test('multipart uploads fail explicitly when their signing secret is missing or too short', async (t) => {
  const env = environment(t);
  for (const secret of [undefined, 'short-secret']) {
    const response = await fetchWorker(uploadJsonRequest('/api/uploads', { name: 'file.bin', size: 1 }), {
      ...env, FILE_UPLOAD_SECRET: secret,
    });
    assert.equal(response.status, 503);
  }
  assert.equal(env.FILES.multipartUploads.size, 0);
});

function collectRequest(event = { path: '/work?email=private@example.com#secret', referrer: 'https://google.com/search?q=private' }, options = {}) {
  const headers = {
    Origin: SITE_ORIGIN,
    'Content-Type': 'application/json',
    'CF-Connecting-IP': '192.0.2.1',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    ...options.headers,
  };
  const request = new Request(`${ADMIN_ORIGIN}/api/collect`, {
    method: 'POST', headers, body: JSON.stringify(event),
  });
  Object.defineProperty(request, 'cf', { value: { country: options.country ?? 'MA' } });
  return request;
}

test('analytics aggregate page views while keeping only daily identifiers and referrer hostnames', async (t) => {
  const env = environment(t);
  assert.equal((await fetchWorker(collectRequest(), env)).status, 204);
  assert.equal((await fetchWorker(collectRequest(), env)).status, 204);
  assert.equal((await fetchWorker(collectRequest(undefined, {
    country: 'US', headers: { 'CF-Connecting-IP': '192.0.2.2', 'User-Agent': 'Mozilla/5.0 iPhone Mobile' },
  }), env)).status, 204);

  const visitors = env.DB.sqlite.prepare('SELECT * FROM analytics_visitors').all();
  const metrics = env.DB.sqlite.prepare('SELECT * FROM analytics_metrics').all();
  assert.equal(visitors.length, 2);
  for (const visitor of visitors) assert.match(visitor.visitor_id, /^[0-9a-f]{64}$/);
  assert.equal(metrics.length, 2);
  assert.equal(metrics.reduce((total, row) => total + row.views, 0), 3);
  assert.deepEqual(new Set(metrics.map((row) => row.device)), new Set(['desktop', 'mobile']));
  for (const row of metrics) {
    assert.equal(row.path, '/work');
    assert.equal(row.referrer, 'google.com');
  }
  const stored = JSON.stringify({ visitors, metrics });
  for (const privateValue of ['192.0.2.', 'private@example.com', 'q=private', 'Mozilla/5.0']) {
    assert.ok(!stored.includes(privateValue), `Database exposed ${privateValue}`);
  }

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  env.DB.sqlite.prepare('INSERT INTO analytics_visitors VALUES (?, ?)').run(yesterday, 'b'.repeat(64));
  env.DB.sqlite.prepare('INSERT INTO analytics_metrics VALUES (?, ?, ?, ?, ?, ?)')
    .run(yesterday, '/', 'direct', 'MA', 'desktop', 7);
  const response = await fetchWorker(adminRequest('/api/stats?days=7'), env);
  assert.equal(response.status, 200);
  const stats = await response.json();
  assert.equal(stats.periodDays, 7);
  assert.equal(stats.days.length, 7);
  assert.equal(stats.totalViews, 10);
  assert.equal(stats.uniqueVisitors, 3);
  assert.deepEqual(stats.days.at(-1), { day: today, views: 3, visitors: 2 });
  assert.deepEqual(stats.days.at(-2), { day: yesterday, views: 7, visitors: 1 });
  assert.ok(stats.days.slice(0, -2).every((day) => day.views === 0 && day.visitors === 0));
  assert.deepEqual(stats.pages, [{ path: '/', views: 7 }, { path: '/work', views: 3 }]);
  assert.equal((await fetchWorker(adminRequest('/api/stats?days=365'), env)).status, 400);
});

test('analytics respect privacy signals, discard bots and apply rate limits before recording', async (t) => {
  const env = environment(t);
  for (const headers of [{ DNT: '1' }, { 'Sec-GPC': '1' }, { 'User-Agent': 'Googlebot/2.1' }]) {
    assert.equal((await fetchWorker(collectRequest(undefined, { headers }), env)).status, 204);
  }
  env.COLLECT_LIMITER = { limit: async () => ({ success: false }) };
  const limited = await fetchWorker(collectRequest(), env);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '60');
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS count FROM analytics_metrics').get().count, 0);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS count FROM analytics_visitors').get().count, 0);
});

test('collector rejects oversized streamed JSON and invalid payloads without recording them', async (t) => {
  const env = environment(t);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(1_024));
      controller.enqueue(new Uint8Array(1_025));
      controller.close();
    },
  });
  const oversized = new Request(`${ADMIN_ORIGIN}/api/collect`, {
    method: 'POST',
    headers: { Origin: SITE_ORIGIN, 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1' },
    body: stream, duplex: 'half',
  });
  assert.equal((await fetchWorker(oversized, env)).status, 413);
  for (const event of [
    { path: '//attacker.example/private', referrer: '' },
    { path: '/ok', referrer: 'javascript:alert(1)' },
    { path: '/ok', referrer: 'not a URL' },
    { path: '/ok' },
    [],
  ]) {
    assert.equal((await fetchWorker(collectRequest(event), env)).status, 400);
  }
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS count FROM analytics_metrics').get().count, 0);
});

test('visitor identifiers rotate with the UTC day and secret; internal referrers are direct', async () => {
  const id = await visitorIdentifier('192.0.2.1', '2026-10-23', 'secret-one');
  assert.match(id, /^[0-9a-f]{64}$/);
  assert.equal(await visitorIdentifier('192.0.2.1', '2026-10-23', 'secret-one'), id);
  assert.notEqual(await visitorIdentifier('192.0.2.1', '2026-10-24', 'secret-one'), id);
  assert.notEqual(await visitorIdentifier('192.0.2.1', '2026-10-23', 'secret-two'), id);
  assert.deepEqual(parseCollectEvent({ path: '/?private=value#secret', referrer: 'https://www.imachraf.tech/work?q=private' }, SITE_ORIGIN), {
    path: '/', referrer: 'direct',
  });
});

test('scheduled retention removes old visitor identifiers and metrics together', async (t) => {
  const env = environment(t);
  const oldDay = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const recentDay = new Date(Date.now() - 89 * 86_400_000).toISOString().slice(0, 10);
  for (const day of [oldDay, recentDay]) {
    env.DB.sqlite.prepare('INSERT INTO analytics_visitors VALUES (?, ?)').run(day, 'a'.repeat(64));
    env.DB.sqlite.prepare('INSERT INTO analytics_metrics VALUES (?, ?, ?, ?, ?, ?)').run(day, '/', 'direct', 'MA', 'desktop', 1);
  }
  await worker.scheduled({}, env);
  assert.deepEqual(env.DB.sqlite.prepare('SELECT day FROM analytics_visitors').all().map((row) => row.day), [recentDay]);
  assert.deepEqual(env.DB.sqlite.prepare('SELECT day FROM analytics_metrics').all().map((row) => row.day), [recentDay]);
});
