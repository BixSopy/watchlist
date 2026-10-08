/* Supabase simulé (Auth + REST) pour les tests de bout en bout, branché via page.route().
   Reproduit les réponses de GoTrue / PostgREST utilisées par l'app (formats supabase-js v2). */
const SUPA = 'https://batfulcvvquffgfeppcx.supabase.co';

function b64url(o) { return Buffer.from(JSON.stringify(o)).toString('base64url'); }
function jwt(user) {
  const now = Math.floor(Date.now() / 1000);
  return b64url({ alg: 'HS256', typ: 'JWT' }) + '.' + b64url({
    sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', exp: now + 3600, iat: now,
    amr: [{ method: 'password', timestamp: now }], session_id: 's-' + user.id,
  }) + '.c2lnbmF0dXJl';
}

export async function installFakeSupabase(page, opts = {}) {
  const db = {
    users: [{ id: '11111111-1111-4111-8111-111111111111', email: 'pierre@exemple.fr', password: 'Correct-Horse-42', confirmed: true }],
    profiles: [], items: [], calls: [], deleted: false, ...opts,
  };
  const userJson = u => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email,
    email_confirmed_at: u.confirmed ? '2026-10-01T10:00:00Z' : null, confirmed_at: u.confirmed ? '2026-10-01T10:00:00Z' : null,
    created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z', last_sign_in_at: '2026-10-08T10:00:00Z',
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {},
    identities: [{ id: u.id, user_id: u.id, provider: 'email', identity_id: 'i-' + u.id, identity_data: { email: u.email, sub: u.id }, created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z', last_sign_in_at: '2026-10-01T10:00:00Z' }] });
  const session = u => ({ access_token: jwt(u), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'refresh-' + u.id, user: userJson(u) });
  const err = (route, status, code, msg, extra = {}) => route.fulfill({ status, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'x-supabase-api-version', 'x-supabase-api-version': '2024-01-01' },
    body: JSON.stringify({ code, message: msg, ...extra }) });
  const ok = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'x-supabase-api-version', 'x-supabase-api-version': '2024-01-01' }, body: JSON.stringify(body) });
  const current = req => {
    const t = (req.headers()['authorization'] || '').replace('Bearer ', '');
    try { const sub = JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).sub; return db.users.find(u => u.id === sub); } catch { return null; }
  };

  await page.route(SUPA + '/**', async route => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    const u = new URL(req.url());
    const body = req.postDataJSON ? (() => { try { return req.postDataJSON(); } catch { return null; } })() : null;
    db.calls.push({ method: req.method(), path: u.pathname, search: u.search, body });
    const p = u.pathname;

    if (p === '/auth/v1/signup') {
      if (db.users.some(x => x.email === body.email)) return ok(route, { ...userJson({ id: 'fake', email: body.email }), identities: [] });
      const nu = { id: '22222222-2222-4222-8222-222222222222', email: body.email, password: body.password, confirmed: false };
      db.users.push(nu);
      return ok(route, { ...userJson(nu), confirmation_sent_at: new Date().toISOString() });
    }
    if (p === '/auth/v1/token' && u.searchParams.get('grant_type') === 'password') {
      const usr = db.users.find(x => x.email === body.email);
      if (!usr || usr.password !== body.password) return err(route, 400, 'invalid_credentials', 'Invalid login credentials');
      if (!usr.confirmed) return err(route, 400, 'email_not_confirmed', 'Email not confirmed');
      return ok(route, session(usr));
    }
    if (p === '/auth/v1/token' && u.searchParams.get('grant_type') === 'refresh_token') {
      const usr = db.users.find(x => 'refresh-' + x.id === body.refresh_token);
      return usr ? ok(route, session(usr)) : err(route, 400, 'refresh_token_not_found', 'Invalid Refresh Token');
    }
    if (p === '/auth/v1/recover' || p === '/auth/v1/otp' || p === '/auth/v1/resend') return ok(route, {});
    if (p === '/auth/v1/verify') {
      if (body.token_hash === 'expired-token-hash') return err(route, 403, 'otp_expired', 'Email link is invalid or has expired');
      const usr = body.email ? db.users.find(x => x.email === body.email) : db.users[0];
      if (body.token && body.token !== '123456') return err(route, 403, 'otp_expired', 'Token has expired or is invalid');
      usr.confirmed = true;
      return ok(route, session(usr));
    }
    if (p === '/auth/v1/user') {
      const usr = current(req);
      if (!usr) return err(route, 401, 'session_not_found', 'invalid JWT');
      if (req.method() === 'PUT') {
        if (body.password) { if (body.password === usr.password) return err(route, 422, 'same_password', 'New password should be different'); usr.password = body.password; }
      }
      return ok(route, userJson(usr));
    }
    if (p === '/auth/v1/logout') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });

    if (p === '/rest/v1/profiles') {
      const usr = current(req);
      if (req.method() === 'POST') { const pr = { id: 'p-' + usr.id, account_id: usr.id, name: 'Moi' }; db.profiles.push(pr); return ok(route, req.headers()['accept'] && req.headers()['accept'].includes('vnd.pgrst.object') ? { id: pr.id } : [{ id: pr.id }], 201); }
      const rows = db.profiles.filter(x => usr && x.account_id === usr.id);
      if ((req.headers()['accept'] || '').includes('vnd.pgrst.object')) return rows[0] ? ok(route, rows[0]) : err(route, 406, 'PGRST116', 'no rows');
      return ok(route, rows);
    }
    if (p === '/rest/v1/watchlist_items') return ok(route, req.method() === 'GET' ? db.items : []);
    if (p === '/rest/v1/rpc/delete_my_account') {
      const usr = current(req);
      db.users = db.users.filter(x => x !== usr); db.profiles = db.profiles.filter(x => x.account_id !== usr.id); db.deleted = true;
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
    }
    return err(route, 404, 'not_found', 'stub: ' + p);
  });
  return db;
}

/* Turnstile simulé : même API que https://challenges.cloudflare.com/turnstile/v0/api.js.
   La requête passe toujours par la CSP de la page (script-src / frame-src). */
export async function installFakeTurnstile(page) {
  await page.route('https://challenges.cloudflare.com/turnstile/**', route => route.fulfill({
    status: 200, contentType: 'text/javascript',
    body: `window.turnstile={_n:0,render:function(el,o){var id='ts'+(++this._n);var d=document.createElement('div');d.className='fake-turnstile';d.dataset.sitekey=o.sitekey;el.appendChild(d);this['_cb'+id]=o.callback;setTimeout(function(){o.callback('fake-captcha-token-'+id);},30);return id;},reset:function(id){var cb=this['_cb'+id];if(cb)setTimeout(function(){cb('fake-captcha-token-'+id+'-r');},30);},remove:function(){}};`,
  }));
}
