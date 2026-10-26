import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SignJWT } from 'jose';
import worker from '../src/local.js';

const origin = 'http://127.0.0.1:8787';
const email = 'owner@example.com';
const password = 'local-test-password-of-at-least-24-characters';
const env = {
  ADMIN_EMAIL: email,
  LOCAL_ADMIN_PASSWORD: password,
  COLLECT_LIMITER: { limit: async () => ({ success: true }) },
  ASSETS: { fetch: async () => new Response('Private local admin') },
};

function request(path = '/', cookie) {
  return new Request(origin + path, { headers: cookie ? { Cookie: cookie } : {} });
}

async function loginRequest(values = {}, requestOrigin = origin) {
  const form = await worker.fetch(request('/login'), env);
  const csrf = (await form.text()).match(/name="csrf" value="([^"]+)"/)[1];
  const headers = { Cookie: form.headers.get('Set-Cookie').split(';')[0] };
  if (requestOrigin !== null) headers.Origin = requestOrigin;
  return new Request(origin + '/login', {
    method: 'POST', headers, body: new URLSearchParams({ email, password, csrf, ...values }),
  });
}

async function login() {
  const result = await worker.fetch(await loginRequest(), env);
  assert.equal(result.status, 303);
  assert.equal(result.headers.get('Location'), '/');
  const cookie = result.headers.get('Set-Cookie');
  assert.match(cookie, /HttpOnly; SameSite=Strict; Path=\//);
  assert.doesNotMatch(cookie, new RegExp(password));
  return cookie.split(';')[0];
}

test('local admin rejects external hosts and alternate ports', async () => {
  for (const url of ['https://admin.imachraf.tech', 'http://attacker.example:8787', 'http://127.0.0.1:9000']) {
    assert.equal((await worker.fetch(new Request(url), env)).status, 403);
  }
});

test('local admin fails closed when credentials have not been configured', async () => {
  for (const configuration of [{}, { ...env, LOCAL_ADMIN_PASSWORD: 'short' }]) {
    assert.equal((await worker.fetch(request('/login'), configuration)).status, 503);
    assert.equal((await worker.fetch(request('/api/session'), configuration)).status, 503);
  }
});

test('unauthenticated navigation opens the login form without an HTTP Basic challenge', async () => {
  const page = await worker.fetch(request(), env);
  assert.equal(page.status, 303);
  assert.equal(page.headers.get('Location'), '/login');
  assert.equal(page.headers.get('WWW-Authenticate'), null);
  const form = await worker.fetch(request('/login'), env);
  assert.equal(form.status, 200);
  assert.match(await form.text(), /<form action="\/login" method="post">/);
  for (const path of ['/api/session', '/api/stats', '/api/files', '/api/files/private.txt']) {
    const result = await worker.fetch(request(path), env);
    assert.equal(result.status, 401);
    assert.equal(result.headers.get('Cache-Control'), 'no-store');
  }
});

test('login rejects wrong credentials, forged form tokens and excessive attempts', async () => {
  for (const values of [{ password: 'wrong' }, { email: 'someone@example.com' }]) {
    const result = await worker.fetch(await loginRequest(values), env);
    assert.equal(result.status, 401);
    assert.doesNotMatch(result.headers.get('Set-Cookie'), /portfolio_local_session=/);
  }
  assert.equal((await worker.fetch(await loginRequest({ csrf: 'forged' }), env)).status, 403);
  const external = new Request(origin + '/login', { method: 'POST', headers: { Origin: 'https://attacker.example' }, body: new URLSearchParams({ email, password }) });
  assert.equal((await worker.fetch(external, env)).status, 403);
  assert.equal((await worker.fetch(await loginRequest(), { ...env, COLLECT_LIMITER: { limit: async () => ({ success: false }) } })).status, 429);
  const oversized = new Request(origin + '/login', { method: 'POST', headers: { Origin: origin }, body: new URLSearchParams({ password: 'a'.repeat(3_000) }) });
  assert.equal((await worker.fetch(oversized, env)).status, 413);
});

test('signed local sessions serve the real admin and expire on logout in the browser', async () => {
  const cookie = await login();
  const session = await worker.fetch(request('/api/session', cookie), env);
  assert.equal(session.status, 200);
  assert.deepEqual(await session.json(), { email });
  assert.equal(await (await worker.fetch(request('/', cookie), env)).text(), 'Private local admin');
  const logout = await worker.fetch(request('/cdn-cgi/access/logout', cookie), env);
  assert.equal(logout.status, 303);
  assert.match(logout.headers.get('Set-Cookie'), /Max-Age=0/);
});

test('forged and expired session cookies cannot access private APIs', async () => {
  const key = new TextEncoder().encode(password);
  const expired = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setIssuer(origin)
    .setAudience('portfolio-admin-local').setSubject(email).setExpirationTime('0s').sign(key);
  for (const token of ['forged', expired]) {
    assert.equal((await worker.fetch(request('/api/session', `portfolio_local_session=${token}`), env)).status, 401);
  }
});

test('valid form tokens allow login when embedded browsers omit or anonymize Origin', async () => {
  for (const requestOrigin of [null, 'null']) {
    const result = await worker.fetch(await loginRequest({}, requestOrigin), env);
    assert.equal(result.status, 303);
    assert.match(result.headers.get('Set-Cookie'), /portfolio_local_session=/);
  }
});

test('login tokens must belong to the browser cookie and must not be expired', async () => {
  const first = await loginRequest();
  const second = await loginRequest();
  const headers = new Headers(first.headers);
  headers.set('Cookie', second.headers.get('Cookie'));
  const mismatched = new Request(first, { headers });
  assert.equal((await worker.fetch(mismatched, env)).status, 403);
  const expired = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setIssuer(origin)
    .setAudience('portfolio-local-login').setJti('expired').setExpirationTime('0s').sign(new TextEncoder().encode(password));
  const expiredRequest = new Request(origin + '/login', {
    method: 'POST', headers: { Cookie: `portfolio_local_login=${expired}` },
    body: new URLSearchParams({ email, password, csrf: expired }),
  });
  assert.equal((await worker.fetch(expiredRequest, env)).status, 403);
});
