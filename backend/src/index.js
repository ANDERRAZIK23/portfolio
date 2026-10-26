import { createRemoteJWKSet, jwtVerify } from 'jose';

const COLLECT_BODY_LIMIT = 2_048;
const FILE_BODY_LIMIT = 20 * 1024 * 1024;
const FILE_KEY = /^files\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BOT_AGENT = /bot\b|spider|crawler|headless|slurp|bingpreview|facebookexternalhit|uptimerobot|lighthouse|pagespeed|curl\/|wget\//i;
const jwksByIssuer = new Map();
const encoder = new TextEncoder();

export class HttpError extends Error {
  constructor(status, message, headers = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

function secureResponse(response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('Pragma', 'no-cache');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('Strict-Transport-Security', 'max-age=31536000');
  headers.set('Content-Security-Policy', [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self'",
    "font-src 'self'",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; '));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function configuredOrigin(value) {
  if (typeof value !== 'string') {
    throw new HttpError(503, 'The portfolio origin has not been configured.');
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(503, 'The portfolio origin is invalid.');
  }
  if (url.protocol !== 'https:' || url.origin !== value) {
    throw new HttpError(503, 'The portfolio origin must be an HTTPS origin without a path.');
  }
  return url;
}

function database(env) {
  if (!env.DB || typeof env.DB.prepare !== 'function' || typeof env.DB.batch !== 'function') {
    throw new HttpError(503, 'The analytics database has not been configured.');
  }
  return env.DB;
}

function bucket(env) {
  if (!env.FILES || typeof env.FILES.list !== 'function' || typeof env.FILES.put !== 'function'
    || typeof env.FILES.get !== 'function' || typeof env.FILES.delete !== 'function') {
    throw new HttpError(503, 'Private file storage has not been configured.');
  }
  return env.FILES;
}

export async function authenticate(request, env) {
  const teamDomain = env.ACCESS_TEAM_DOMAIN;
  if (typeof teamDomain !== 'string'
    || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/i.test(teamDomain)
    || typeof env.ACCESS_AUD !== 'string' || !env.ACCESS_AUD.trim() || /REPLACE[_-]/i.test(env.ACCESS_AUD)
    || typeof env.ADMIN_EMAIL !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.ADMIN_EMAIL)
    || /REPLACE[_-]/i.test(env.ADMIN_EMAIL)) {
    throw new HttpError(503, 'Administrator authentication has not been configured.');
  }
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || token.length > 16_384) {
    throw new HttpError(401, 'Sign in through Cloudflare Access to continue.');
  }
  const issuer = `https://${teamDomain.toLowerCase()}`;
  let jwks = jwksByIssuer.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    jwksByIssuer.set(issuer, jwks);
  }
  let payload;
  try {
    ({ payload } = await jwtVerify(token, jwks, {
      issuer,
      audience: env.ACCESS_AUD,
      algorithms: ['RS256'],
      requiredClaims: ['exp', 'sub', 'email'],
    }));
  } catch {
    throw new HttpError(401, 'The administrator session is invalid or expired.');
  }
  if (typeof payload.email !== 'string'
    || payload.email.toLowerCase() !== env.ADMIN_EMAIL.toLowerCase()) {
    throw new HttpError(403, 'This account is not allowed to administer the portfolio.');
  }
  return { email: payload.email };
}

export async function readLimitedBody(request, maxBytes) {
  const length = request.headers.get('Content-Length');
  if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))) {
    throw new HttpError(400, 'The request body length is invalid.');
  }
  if (length !== null && Number(length) > maxBytes) {
    throw new HttpError(413, 'The request body exceeds the size limit.');
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new HttpError(413, 'The request body exceeds the size limit.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (length !== null && Number(length) !== total) {
    throw new HttpError(400, 'The request body length does not match its contents.');
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export function parseCollectEvent(value, siteOrigin) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || typeof value.path !== 'string' || value.path.length > 512
    || !value.path.startsWith('/') || value.path.startsWith('//')
    || /[\\\u0000-\u001f\u007f]/.test(value.path)
    || typeof value.referrer !== 'string' || value.referrer.length > 1_024) {
    throw new HttpError(400, 'Provide a valid page path and referrer.');
  }
  const site = new URL(siteOrigin);
  const page = new URL(value.path, site);
  if (page.origin !== site.origin || page.pathname.length > 512) {
    throw new HttpError(400, 'The page path must belong to the portfolio.');
  }
  let referrer = 'direct';
  if (value.referrer) {
    let referrerUrl;
    try {
      referrerUrl = new URL(value.referrer);
    } catch {
      throw new HttpError(400, 'The referrer must be a valid URL.');
    }
    if (!['http:', 'https:'].includes(referrerUrl.protocol)) {
      throw new HttpError(400, 'The referrer must use HTTP or HTTPS.');
    }
    const hostname = referrerUrl.hostname.toLowerCase();
    if (!hostname || hostname.length > 253) {
      throw new HttpError(400, 'The referrer hostname is invalid.');
    }
    if (hostname.replace(/^www\./, '') !== site.hostname.replace(/^www\./, '')) {
      referrer = hostname;
    }
  }
  return { path: page.pathname, referrer };
}

export function classifyDevice(userAgent) {
  if (/ipad|tablet|android(?!.*mobile)/i.test(userAgent)) return 'tablet';
  if (/mobile|iphone|ipod|android/i.test(userAgent)) return 'mobile';
  return 'desktop';
}

export async function visitorIdentifier(ip, day, salt) {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(salt), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(`${day}\n${ip}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

async function collect(request, env, site) {
  if (request.headers.get('Origin') !== site.origin) {
    throw new HttpError(403, 'Analytics requests must originate from the portfolio.');
  }
  if (request.method === 'OPTIONS') {
    const requestedHeaders = request.headers.get('Access-Control-Request-Headers');
    if (request.headers.get('Access-Control-Request-Method') !== 'POST'
      || (requestedHeaders && requestedHeaders.split(',').some((header) => header.trim().toLowerCase() !== 'content-type'))) {
      throw new HttpError(403, 'The analytics preflight request is not allowed.');
    }
    return new Response(null, { status: 204 });
  }
  if (request.method !== 'POST') {
    throw new HttpError(405, 'Use POST to collect a page view.', { Allow: 'POST, OPTIONS' });
  }
  const db = database(env);
  if (!env.COLLECT_LIMITER || typeof env.COLLECT_LIMITER.limit !== 'function') {
    throw new HttpError(503, 'Analytics rate limiting has not been configured.');
  }
  if (typeof env.ANALYTICS_SALT !== 'string' || env.ANALYTICS_SALT.length < 32) {
    throw new HttpError(503, 'The analytics privacy secret has not been configured.');
  }
  const userAgent = request.headers.get('User-Agent') || '';
  if (request.headers.get('DNT') === '1' || request.headers.get('Sec-GPC') === '1' || BOT_AGENT.test(userAgent)) {
    return new Response(null, { status: 204 });
  }
  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip || ip.length > 64 || !/^[0-9a-f:.]+$/i.test(ip)) {
    throw new HttpError(503, 'The visitor network address is unavailable.');
  }
  const limit = await env.COLLECT_LIMITER.limit({ key: ip });
  if (!limit.success) {
    throw new HttpError(429, 'Too many analytics requests. Try again later.', { 'Retry-After': '60' });
  }
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new HttpError(415, 'Analytics requests must contain JSON.');
  }
  const body = await readLimitedBody(request, COLLECT_BODY_LIMIT);
  let value;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  } catch {
    throw new HttpError(400, 'The analytics request must contain valid UTF-8 JSON.');
  }
  const { path, referrer } = parseCollectEvent(value, site.origin);
  const day = new Date().toISOString().slice(0, 10);
  const visitorId = await visitorIdentifier(ip, day, env.ANALYTICS_SALT);
  const country = typeof request.cf?.country === 'string' && /^[A-Z]{2}$/.test(request.cf.country)
    ? request.cf.country : 'ZZ';
  const device = classifyDevice(userAgent);
  await db.batch([
    db.prepare('INSERT INTO analytics_visitors (day, visitor_id) VALUES (?, ?) ON CONFLICT (day, visitor_id) DO NOTHING')
      .bind(day, visitorId),
    db.prepare(`INSERT INTO analytics_metrics (day, path, referrer, country, device, views)
      VALUES (?, ?, ?, ?, ?, 1)
      ON CONFLICT (day, path, referrer, country, device) DO UPDATE SET views = views + 1`)
      .bind(day, path, referrer, country, device),
  ]);
  return new Response(null, { status: 204 });
}

export async function getStats(url, env) {
  const value = url.searchParams.get('days');
  if (value !== null && !['7', '30', '90'].includes(value)) {
    throw new HttpError(400, 'Choose an analytics period of 7, 30, or 90 days.');
  }
  const periodDays = value === null ? 30 : Number(value);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const end = today.toISOString().slice(0, 10);
  const start = new Date(today.getTime() - (periodDays - 1) * 86_400_000).toISOString().slice(0, 10);
  const db = database(env);
  const bounds = 'WHERE day >= ? AND day <= ?';
  const [viewsResult, visitorsResult, countriesResult, referrersResult, devicesResult, pagesResult] = await db.batch([
    db.prepare(`SELECT day, SUM(views) AS views FROM analytics_metrics ${bounds} GROUP BY day ORDER BY day`).bind(start, end),
    db.prepare(`SELECT day, COUNT(*) AS visitors FROM analytics_visitors ${bounds} GROUP BY day ORDER BY day`).bind(start, end),
    db.prepare(`SELECT country, SUM(views) AS views FROM analytics_metrics ${bounds} GROUP BY country ORDER BY views DESC, country LIMIT 20`).bind(start, end),
    db.prepare(`SELECT referrer, SUM(views) AS views FROM analytics_metrics ${bounds} GROUP BY referrer ORDER BY views DESC, referrer LIMIT 20`).bind(start, end),
    db.prepare(`SELECT device, SUM(views) AS views FROM analytics_metrics ${bounds} GROUP BY device ORDER BY views DESC, device`).bind(start, end),
    db.prepare(`SELECT path, SUM(views) AS views FROM analytics_metrics ${bounds} GROUP BY path ORDER BY views DESC, path LIMIT 50`).bind(start, end),
  ]);
  const viewsByDay = new Map(viewsResult.results.map((row) => [row.day, Number(row.views)]));
  const visitorsByDay = new Map(visitorsResult.results.map((row) => [row.day, Number(row.visitors)]));
  const days = Array.from({ length: periodDays }, (_, index) => {
    const day = new Date(today.getTime() - (periodDays - index - 1) * 86_400_000).toISOString().slice(0, 10);
    return { day, views: viewsByDay.get(day) ?? 0, visitors: visitorsByDay.get(day) ?? 0 };
  });
  return {
    periodDays,
    totalViews: days.reduce((total, day) => total + day.views, 0),
    // Identifiers rotate daily: this is a sum of daily visitors, not cross-day tracking.
    uniqueVisitors: days.reduce((total, day) => total + day.visitors, 0),
    days,
    countries: countriesResult.results,
    referrers: referrersResult.results,
    devices: devicesResult.results,
    pages: pagesResult.results,
  };
}

export function validateFileName(value) {
  if (typeof value !== 'string') throw new HttpError(400, 'Provide a file name.');
  const name = value.normalize('NFC').trim();
  if (!name || [...name].length > 180 || /[\\/\u0000-\u001f\u007f-\u009f]/.test(name)
    || name === '.' || name === '..') {
    throw new HttpError(400, 'File names must be 1–180 characters and contain no slashes or control characters.');
  }
  return name;
}

function fileMetadata(object) {
  if (!object.customMetadata || typeof object.customMetadata.name !== 'string') {
    throw new Error('A stored file is missing its name metadata.');
  }
  return {
    key: object.key,
    name: validateFileName(object.customMetadata.name),
    size: object.size,
    uploaded: object.uploaded.toISOString(),
  };
}

function requireSameOrigin(request, url) {
  if (request.headers.get('Origin') !== url.origin) {
    throw new HttpError(403, 'File changes must originate from this administrator page.');
  }
}

async function files(request, url, env) {
  if (request.method === 'POST' || request.method === 'DELETE') requireSameOrigin(request, url);
  const storage = bucket(env);
  if (url.pathname === '/api/files') {
    if (request.method === 'GET') {
      const cursor = url.searchParams.get('cursor');
      if (cursor !== null && (!cursor || cursor.length > 2_048)) {
        throw new HttpError(400, 'The file pagination cursor is invalid.');
      }
      const options = { prefix: 'files/', limit: 50, include: ['customMetadata'] };
      if (cursor !== null) options.cursor = cursor;
      const result = await storage.list(options);
      return json({
        files: result.objects.map(fileMetadata),
        cursor: result.truncated ? result.cursor : null,
        hasMore: result.truncated,
      });
    }
    if (request.method === 'POST') {
      const header = request.headers.get('X-File-Name');
      if (!header || header.length > 2_200) throw new HttpError(400, 'Provide an encoded X-File-Name header.');
      let decodedName;
      try {
        decodedName = decodeURIComponent(header);
      } catch {
        throw new HttpError(400, 'The file name must be URI encoded.');
      }
      const name = validateFileName(decodedName);
      const body = await readLimitedBody(request, FILE_BODY_LIMIT);
      const key = `files/${crypto.randomUUID()}`;
      const object = await storage.put(key, body, {
        httpMetadata: { contentType: 'application/octet-stream' },
        customMetadata: { name },
      });
      if (!object) throw new Error('Private file storage did not confirm the upload.');
      return json(fileMetadata(object), 201);
    }
    throw new HttpError(405, 'Use GET to list files or POST to upload.', { Allow: 'GET, POST' });
  }
  let key;
  try {
    key = decodeURIComponent(url.pathname.slice('/api/files/'.length));
  } catch {
    throw new HttpError(400, 'The file key is invalid.');
  }
  if (!FILE_KEY.test(key)) throw new HttpError(400, 'The file key is invalid.');
  if (request.method === 'GET') {
    const object = await storage.get(key);
    if (!object) throw new HttpError(404, 'The requested file was not found.');
    const { name } = fileMetadata(object);
    const encodedName = encodeURIComponent(name).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    return new Response(object.body, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(object.size),
        'Content-Disposition': `attachment; filename="download"; filename*=UTF-8''${encodedName}`,
      },
    });
  }
  if (request.method === 'DELETE') {
    await storage.delete(key);
    return new Response(null, { status: 204 });
  }
  throw new HttpError(405, 'Use GET to download a file or DELETE to remove it.', { Allow: 'GET, DELETE' });
}

async function admin(request, url, env, authenticateRequest) {
  const session = await authenticateRequest(request, env);
  if (url.pathname === '/api/session' && request.method === 'GET') return json(session);
  if (url.pathname === '/api/stats' && request.method === 'GET') return json(await getStats(url, env));
  if (url.pathname === '/api/files' || url.pathname.startsWith('/api/files/')) {
    return files(request, url, env);
  }
  if (url.pathname.startsWith('/api/')) throw new HttpError(404, 'The requested API route was not found.');
  if (!['GET', 'HEAD'].includes(request.method)) {
    throw new HttpError(405, 'Use GET or HEAD to open administrator pages.', { Allow: 'GET, HEAD' });
  }
  if (!env.ASSETS || typeof env.ASSETS.fetch !== 'function') {
    throw new HttpError(503, 'The administrator interface has not been configured.');
  }
  return env.ASSETS.fetch(request);
}

export function createWorker(authenticateRequest = authenticate) {
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      const collector = url.pathname === '/api/collect';
      let origin;
      let response;
      try {
        if (collector) {
          const site = configuredOrigin(env.SITE_ORIGIN);
          if (request.headers.get('Origin') === site.origin) origin = site.origin;
          response = await collect(request, env, site);
        } else {
          response = await admin(request, url, env, authenticateRequest);
        }
      } catch (error) {
        if (error instanceof HttpError) {
          response = json({ error: error.message }, error.status, error.headers);
        } else {
          // Do not log request headers, tokens, addresses, or file contents.
          console.error('The portfolio backend encountered an unexpected error.', error instanceof Error ? error.name : 'UnknownError');
          response = json({ error: 'The request could not be completed. Please try again.' }, 500);
        }
      }
      if (collector) {
        const headers = new Headers(response.headers);
        headers.set('Vary', 'Origin');
        if (origin) {
          for (const [name, value] of Object.entries(corsHeaders(origin))) headers.set(name, value);
        }
        response = new Response(response.body, { status: response.status, statusText: response.statusText, headers });
      }
      return secureResponse(response);
    },

    async scheduled(_controller, env) {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const cutoff = new Date(today.getTime() - 89 * 86_400_000).toISOString().slice(0, 10);
      const db = database(env);
      await db.batch([
        db.prepare('DELETE FROM analytics_visitors WHERE day < ?').bind(cutoff),
        db.prepare('DELETE FROM analytics_metrics WHERE day < ?').bind(cutoff),
      ]);
    },
  };
}

export default createWorker();
