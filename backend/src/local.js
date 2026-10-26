import { SignJWT, jwtVerify } from 'jose';
import { createWorker, HttpError, readLimitedBody } from './index.js';

const ORIGIN = 'http://127.0.0.1:8787';
const COOKIE = 'portfolio_local_session';
const CSRF_COOKIE = 'portfolio_local_login';
const SESSION_SECONDS = 6 * 60 * 60;
const encoder = new TextEncoder();

function signingKey(env) {
  if (typeof env.LOCAL_ADMIN_PASSWORD !== 'string' || env.LOCAL_ADMIN_PASSWORD.length < 24
    || typeof env.ADMIN_EMAIL !== 'string' || !/^[^\s@:]+@[^\s@]+\.[^\s@]+$/.test(env.ADMIN_EMAIL)) {
    throw new HttpError(503, 'Configure ADMIN_EMAIL and a LOCAL_ADMIN_PASSWORD of at least 24 characters in .dev.vars.');
  }
  return encoder.encode(env.LOCAL_ADMIN_PASSWORD);
}

async function authenticateLocal(request, env) {
  const key = signingKey(env);
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!token || token.length > 4_096) throw new HttpError(401, 'Connectez-vous à votre administration locale.');
  let payload;
  try {
    ({ payload } = await jwtVerify(token, key, {
      algorithms: ['HS256'], issuer: ORIGIN, audience: 'portfolio-admin-local', requiredClaims: ['exp', 'sub'],
    }));
  } catch {
    throw new HttpError(401, 'Votre session locale a expiré ou est invalide.');
  }
  if (payload.sub !== env.ADMIN_EMAIL) throw new HttpError(401, 'Votre session locale est invalide.');
  return { email: env.ADMIN_EMAIL };
}

function response(body, status = 200, headers = {}) {
  return new Response(body, { status, headers: {
    'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    ...headers,
  } });
}

async function loginPage(env, error = '', status = 200) {
  const csrf = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setIssuer(ORIGIN)
    .setAudience('portfolio-local-login').setJti(crypto.randomUUID()).setIssuedAt().setExpirationTime('10m').sign(signingKey(env));
  return response(`<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="robots" content="noindex, nofollow">
  <title>Connexion — Administration locale</title>
  <style>
    :root{color-scheme:dark;--bg:#101212;--surface:#191c1b;--lime:#d4f58b;--lilac:#bda6f5;--text:#f1f3ed;--muted:#a1aaa3;--line:#ffffff16}
    *{box-sizing:border-box}
    body{margin:0;background:var(--bg);color:var(--text);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
    a{color:inherit;text-decoration:none}
    a:focus-visible,input:focus-visible,button:focus-visible{outline:2px solid var(--lime);outline-offset:5px}
    h1,h2,p{margin:0}
    ::selection{background:var(--lime);color:var(--bg)}
    .login-shell{min-height:100svh;max-width:1600px;margin:auto;padding:34px 52px 0;display:flex;flex-direction:column}
    .masthead{display:flex;align-items:center;justify-content:space-between;gap:24px}
    .brand{display:inline-flex;align-items:center;gap:15px;font-size:19px;font-weight:650;letter-spacing:-.7px}
    .brand-mark{font-size:51px;font-weight:750;line-height:1;letter-spacing:-5px;color:var(--lime);padding:0 4px 6px 0}
    .brand-mark span{color:var(--lilac)}
    .brand-domain{color:var(--muted);font-weight:400}
    .private-badge{display:flex;align-items:center;gap:9px;padding:8px 12px;border:1px solid var(--line);border-radius:30px;color:#bdc7b8;font-size:11px;letter-spacing:.3px}
    .private-badge::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--lime);box-shadow:0 0 12px #d4f58b55}
    main{flex:1;display:grid;grid-template-columns:minmax(0,1.2fr) minmax(340px,.8fr);align-items:center;gap:80px;padding:64px 5% 60px}
    .editorial{position:relative;min-width:0}
    .eyebrow{font-size:10px;font-weight:550;letter-spacing:2px;text-transform:uppercase;color:var(--muted)}
    .editorial>.eyebrow{display:flex;align-items:center;gap:12px;color:var(--lime);margin-bottom:22px}
    .editorial>.eyebrow::before{content:"";width:28px;height:1px;background:var(--lime)}
    h1{font-size:clamp(45px,5.5vw,78px);font-weight:550;line-height:1.08;letter-spacing:-4px;text-wrap:balance}
    h1 span{color:var(--lime)}
    .intro{max-width:380px;margin-top:22px;font-size:15px;line-height:1.85;color:var(--muted)}
    .scene{height:280px;width:min(100%,380px);position:relative;margin:12px 0 0;perspective:950px;pointer-events:none;isolation:isolate}
    .scene::before{content:"";position:absolute;width:230px;height:65px;left:70px;bottom:20px;background:radial-gradient(ellipse,#d4f58b19,transparent 70%);filter:blur(12px);transform:rotate(-13deg)}
    .orbit{position:absolute;left:9px;top:66px;width:345px;height:145px;border:1px solid #bda6f570;border-radius:50%;transform:rotate(-25deg);box-shadow:0 0 18px #bda6f50a,inset 0 0 18px #bda6f50a}
    .orbit::after{content:"";position:absolute;width:7px;height:7px;background:var(--lilac);border-radius:50%;top:18px;right:44px;box-shadow:0 0 18px #bda6f570}
    .cube-stage{position:absolute;width:130px;height:130px;top:76px;left:120px;transform-style:preserve-3d;animation:float 8s ease-in-out infinite}
    .cube{position:absolute;width:100%;height:100%;transform-style:preserve-3d;transform:rotateX(-23deg) rotateY(-32deg) rotateZ(5deg)}
    .face{position:absolute;inset:0;border:1px solid #d4f58b80;background:linear-gradient(135deg,#d4f58b24,#d4f58b07);box-shadow:inset 0 0 28px #d4f58b07}
    .front{transform:translateZ(65px);background:linear-gradient(140deg,#d4f58b3d,#d4f58b0b)}
    .back{transform:rotateY(180deg) translateZ(65px)}
    .right{transform:rotateY(90deg) translateZ(65px);background:linear-gradient(120deg,#d4f58b18,#bda6f518)}
    .left{transform:rotateY(-90deg) translateZ(65px)}
    .top{transform:rotateX(90deg) translateZ(65px);background:linear-gradient(135deg,#e5ffb943,#d4f58b14)}
    .bottom{transform:rotateX(-90deg) translateZ(65px)}
    .cube-core{position:absolute;inset:43px;border:1px solid #e5ffb980;background:#d4f58b20;box-shadow:0 0 30px #d4f58b20;transform:translateZ(0)}
    .capabilities{display:flex;gap:9px;flex-wrap:wrap;margin-top:3px}
    .capabilities span{display:inline-flex;align-items:center;gap:8px;padding:7px 11px;border:1px solid var(--line);border-radius:6px;color:#b8c0b7;font-size:11px}
    .capabilities span::before{content:"";width:4px;height:4px;background:var(--lilac);border-radius:1px}
    .login-card{width:100%;max-width:440px;justify-self:end;padding:36px;background:linear-gradient(145deg,#1d211f,var(--surface));border:1px solid #ffffff19;border-radius:20px;box-shadow:0 24px 80px #00000024,inset 0 1px #ffffff05}
    .card-symbol{display:grid;place-items:center;width:45px;height:45px;margin-bottom:28px;border:1px solid #d4f58b25;border-radius:12px;background:#d4f58b09}
    .lock{position:relative;width:15px;height:12px;border:1.5px solid var(--lime);border-radius:3px;margin-top:5px}
    .lock::before{content:"";position:absolute;width:8px;height:9px;left:2px;top:-8px;border:1.5px solid var(--lime);border-bottom:0;border-radius:7px 7px 0 0}
    .lock::after{content:"";position:absolute;width:2px;height:4px;left:5px;top:3px;background:var(--lime);border-radius:1px}
    .login-card>.eyebrow{color:#a5b299;margin-bottom:10px;letter-spacing:1.6px}
    h2{font-size:28px;font-weight:550;line-height:1.3;letter-spacing:-1px}
    .card-description{margin-top:11px;font-size:13px;line-height:1.8;color:var(--muted)}
    form{margin-top:30px}
    label{display:block;margin:20px 0 9px;font-size:12px;font-weight:500;color:#d3d9d0}
    input,button{width:100%;font:inherit;border-radius:8px}
    input{min-height:49px;padding:11px 13px;background:#111512;border:1px solid #ffffff20;color:var(--text);transition:border-color .2s,box-shadow .2s}
    input:hover{border-color:#ffffff40}
    input:focus{border-color:#d4f58b80;box-shadow:0 0 0 3px #d4f58b08}
    input:autofill{-webkit-text-fill-color:var(--text);box-shadow:inset 0 0 0 100px #111512}
    button{display:flex;align-items:center;justify-content:space-between;min-height:49px;margin-top:28px;padding:12px 16px;background:var(--lime);border:1px solid var(--lime);color:#23301a;font-size:13px;font-weight:650;cursor:pointer;transition:background .2s,transform .2s}
    button:hover{background:#e0faa8;transform:translateY(-1px)}
    button:active{transform:none}
    button:disabled{cursor:not-allowed;opacity:.5;transform:none}
    button span{font-size:20px;font-weight:400;line-height:1}
    .local-note{margin-top:24px;padding-top:20px;border-top:1px solid var(--line);color:#929d92;font-size:11px;line-height:1.8}
    .error{margin-top:22px;padding:12px 14px;background:#ffb4a609;border:1px solid #ffb4a630;border-radius:8px;color:#ffc5ba;font-size:12px;line-height:1.7}
    footer{display:flex;justify-content:space-between;gap:20px;min-height:70px;padding:22px 0;border-top:1px solid var(--line);color:#879186;font-size:11px}
    footer span span{padding:0 10px;color:#556150}
    @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
    @media(min-width:1600px){main{gap:120px}}
    @media(max-width:1000px){.login-shell{padding-inline:32px}main{gap:40px;padding:60px 0}.scene{transform:scale(.9);transform-origin:left center}h1{letter-spacing:-2.8px}.login-card{padding:30px}}
    @media(max-width:760px){.login-shell{padding:25px 24px 0}.masthead{gap:12px}.brand{font-size:17px;gap:11px}.brand-mark{font-size:43px}.private-badge{font-size:10px;padding:7px 10px}main{grid-template-columns:minmax(0,1fr);gap:32px;padding:46px 0 40px}.editorial{text-align:center}.editorial>.eyebrow{justify-content:center;margin-bottom:17px}h1{font-size:48px;letter-spacing:-2.6px}.intro{margin:17px auto 0;font-size:14px;max-width:340px}.scene{height:215px;margin:-8px auto 0;transform:scale(.8);transform-origin:center center}.capabilities{justify-content:center;margin-top:-17px}.login-card{grid-row:1;justify-self:center;max-width:460px;padding:29px}.card-symbol{margin-bottom:23px}footer{font-size:10px;flex-wrap:wrap;gap:7px;min-height:70px;padding-block:20px}}
    @media(max-width:380px){.login-shell{padding-inline:18px}.private-badge{font-size:9px;padding-inline:8px}.brand{font-size:15px}h1{font-size:43px}.scene{margin-left:-10px;width:330px;transform:scale(.73)}.login-card{padding:24px}h2{font-size:26px}}
    @media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
  </style>
</head>
<body>
  <div class="login-shell">
    <header class="masthead">
      <a class="brand" href="https://imachraf.tech" aria-label="Achraf, voir le portfolio"><span class="brand-mark" aria-hidden="true">a<span>.</span></span><span>achraf<span class="brand-domain">.tech</span></span></a>
      <span class="private-badge">Espace privé</span>
    </header>
    <main>
      <section class="editorial" aria-labelledby="welcome-title">
        <p class="eyebrow">Votre espace de travail</p>
        <h1 id="welcome-title">Un espace<br>à vous<span>.</span></h1>
        <p class="intro">Votre portfolio, côté coulisses. Retrouvez vos documents et gardez un œil sur votre audience.</p>
        <div class="scene" aria-hidden="true"><div class="orbit"></div><div class="cube-stage"><div class="cube"><span class="face front"></span><span class="face back"></span><span class="face right"></span><span class="face left"></span><span class="face top"></span><span class="face bottom"></span><span class="cube-core"></span></div></div></div>
        <div class="capabilities"><span>Fichiers privés</span><span>Statistiques</span></div>
      </section>
      <section class="login-card" aria-labelledby="login-title">
        <div class="card-symbol" aria-hidden="true"><span class="lock"></span></div>
        <p class="eyebrow">Administration locale</p>
        <h2 id="login-title">Heureux de vous revoir.</h2>
        <p class="card-description">Connectez-vous pour gérer vos fichiers et consulter les statistiques locales.</p>
        ${error ? `<p class="error" role="alert">${error}</p>` : ''}
        <form action="/login" method="post">
          <input type="hidden" name="csrf" value="${csrf}">
          <label for="email">Adresse e-mail</label>
          <input id="email" name="email" type="email" autocomplete="username" required>
          <label for="password">Mot de passe local</label>
          <input id="password" name="password" type="password" autocomplete="current-password" required>
          <button type="submit">Se connecter <span aria-hidden="true">↗</span></button>
        </form>
        <p class="local-note">Accès réservé à votre administration sur cet ordinateur.</p>
      </section>
    </main>
    <footer><span>Achraf Abderrazik <span>/</span> Administration</span><span>Votre portfolio, côté coulisses.</span></footer>
  </div>
</body>
</html>`, status, { 'Set-Cookie': `${CSRF_COOKIE}=${csrf}; HttpOnly; SameSite=Strict; Path=/login; Max-Age=600` });
}

async function login(request, env) {
  const key = signingKey(env);
  if (request.method === 'GET') return loginPage(env);
  if (request.method !== 'POST') return response('Méthode non autorisée.', 405, { Allow: 'GET, POST' });
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/x-www-form-urlencoded') {
    throw new HttpError(415, 'Utilisez le formulaire de connexion.');
  }
  if (!env.COLLECT_LIMITER || typeof env.COLLECT_LIMITER.limit !== 'function') {
    throw new HttpError(503, 'La limitation des tentatives de connexion doit être configurée.');
  }
  if (!(await env.COLLECT_LIMITER.limit({ key: 'local-login' })).success) {
    return loginPage(env, 'Trop de tentatives. Réessaie dans une minute.', 429);
  }
  const form = new URLSearchParams(new TextDecoder().decode(await readLimitedBody(request, 2_048)));
  const csrf = form.get('csrf');
  const cookie = (request.headers.get('Cookie') || '').split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${CSRF_COOKIE}=`))?.slice(CSRF_COOKIE.length + 1);
  if (!csrf || csrf.length > 1_024 || csrf !== cookie) {
    return loginPage(env, 'Le formulaire a expiré. Réessaie depuis cette page.', 403);
  }
  try {
    await jwtVerify(csrf, key, {
      algorithms: ['HS256'], issuer: ORIGIN, audience: 'portfolio-local-login', requiredClaims: ['exp', 'jti'],
    });
  } catch {
    return loginPage(env, 'Le formulaire a expiré. Réessaie depuis cette page.', 403);
  }
  const [actual, expected] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(`${form.get('email')}:${form.get('password')}`)),
    crypto.subtle.digest('SHA-256', encoder.encode(`${env.ADMIN_EMAIL}:${env.LOCAL_ADMIN_PASSWORD}`)),
  ]);
  const actualBytes = new Uint8Array(actual);
  const expectedBytes = new Uint8Array(expected);
  let difference = 0;
  for (let index = 0; index < actualBytes.length; index++) difference |= actualBytes[index] ^ expectedBytes[index];
  if (difference !== 0) return loginPage(env, 'Adresse e-mail ou mot de passe incorrect.', 401);
  const token = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setIssuer(ORIGIN)
    .setAudience('portfolio-admin-local').setSubject(env.ADMIN_EMAIL).setIssuedAt().setExpirationTime(`${SESSION_SECONDS}s`).sign(key);
  return response(null, 303, {
    Location: '/', 'Set-Cookie': `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}`,
  });
}

const localWorker = createWorker(authenticateLocal);

export default {
  async fetch(request, env, context) {
    const url = new URL(request.url);
    if (url.origin !== ORIGIN) return response('Administration disponible uniquement sur http://127.0.0.1:8787.', 403);
    try {
      if (url.pathname === '/login') return await login(request, env);
      if (url.pathname === '/cdn-cgi/access/logout') {
        return response(null, 303, { Location: '/login', 'Set-Cookie': `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` });
      }
      const result = await localWorker.fetch(request, env, context);
      if (result.status === 401 && !url.pathname.startsWith('/api/')) return response(null, 303, { Location: '/login' });
      return result;
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      return response(error.message, error.status, { 'Content-Type': 'text/plain; charset=utf-8', ...error.headers });
    }
  },
};
