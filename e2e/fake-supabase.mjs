/* Supabase simulé (Auth + REST) pour les tests de bout en bout, branché via page.route().
   Reproduit les réponses de GoTrue / PostgREST utilisées par l'app (formats supabase-js v2). */
const SUPA = 'https://batfulcvvquffgfeppcx.supabase.co';

function b64url(o) { return Buffer.from(JSON.stringify(o)).toString('base64url'); }
/* aal2 : uniquement juste après un mfa.verify() réussi (voir /factors/:id/verify plus bas) —
   jamais après le seul mot de passe, même si un facteur est enrôlé. */
function jwt(user, aal = 'aal1') {
  const now = Math.floor(Date.now() / 1000);
  return b64url({ alg: 'HS256', typ: 'JWT' }) + '.' + b64url({
    sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', exp: now + 3600, iat: now,
    amr: [{ method: 'password', timestamp: now }], session_id: 's-' + user.id, aal,
  }) + '.c2lnbmF0dXJl';
}
/* Petit SVG de substitution (pas un vrai QR TOTP : la vérification se fait avec le code magique
   123456, comme les autres codes à 6 chiffres de ce fichier) pour vérifier visuellement l'écran. */
/* data:image/svg+xml,<svg> est embarqué tel quel par supabase-js (pas d'URL-encodage) : un '#'
   littéral (ex. fill="#fff") couperait l'URI à cette position (identifiant de fragment). */
const FAKE_QR_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="white"/>' +
  '<g fill="black">' + Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, (_, c) => ((r * 9 + c * 5) % 7 < 3)
    ? `<rect x="${6 + c * 10}" y="${6 + r * 10}" width="8" height="8"/>` : '').join('')).join('') + '</g></svg>';

export async function installFakeSupabase(page, opts = {}) {
  const db = {
    users: [{ id: '11111111-1111-4111-8111-111111111111', email: 'pierre@exemple.fr', password: 'Correct-Horse-42', confirmed: true }],
    profiles: [], items: [], detected: [], devices: [], shares: [], calls: [], deleted: false, ...opts,
  };
  /* Par défaut, les tests visent l'application : on passe la page d'accueil (visiteur déjà venu, liste locale).
     { landing: true } garde le parcours d'un nouveau visiteur (page d'accueil publique). */
  if (!opts.landing) await page.addInitScript(() => { try { localStorage.setItem('wl_app_guest', '1'); } catch (e) {} });
  const userJson = u => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email,
    email_confirmed_at: u.confirmed ? '2026-10-01T10:00:00Z' : null, confirmed_at: u.confirmed ? '2026-10-01T10:00:00Z' : null,
    created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z', last_sign_in_at: '2026-10-08T10:00:00Z',
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: { ...(u.metadata || {}) },
    /* data.user.factors (vérifiés uniquement) : c'est ce que supabase-js lit pour calculer nextLevel */
    factors: (u.mfaFactors || []).filter(f => f.status === 'verified').map(({ secret, ...f }) => f),
    identities: [{ id: u.id, user_id: u.id, provider: 'email', identity_id: 'i-' + u.id, identity_data: { email: u.email, sub: u.id }, created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z', last_sign_in_at: '2026-10-01T10:00:00Z' }] });
  const session = (u, aal) => ({ access_token: jwt(u, aal), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
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
      const nu = { id: '22222222-2222-4222-8222-222222222222', email: body.email, password: body.password, confirmed: false, metadata: { ...(body.data || {}) } };
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
        if (body.data) usr.metadata = { ...(usr.metadata || {}), ...body.data };
      }
      return ok(route, userJson(usr));
    }
    if (p === '/auth/v1/logout') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
    /* Double authentification TOTP (js/37-mfa.js) : facteurs du compte connecté uniquement.
       Code magique 123456 (comme /auth/v1/verify plus haut) : pas un vrai calcul TOTP. */
    if (p === '/auth/v1/factors' && req.method() === 'GET') {
      const usr = current(req); if (!usr) return err(route, 401, 'session_not_found', 'invalid JWT');
      const all = (usr.mfaFactors || []).map(({ secret, ...f }) => f);
      return ok(route, { totp: all.filter(f => f.factor_type === 'totp'), phone: [], all });
    }
    if (p === '/auth/v1/factors' && req.method() === 'POST') {
      const usr = current(req); if (!usr) return err(route, 401, 'session_not_found', 'invalid JWT');
      usr.mfaFactors = usr.mfaFactors || [];
      const f = { id: 'f-' + (usr.mfaFactors.length + 1) + '-' + usr.id.slice(0, 4), factor_type: 'totp', friendly_name: body.friendly_name || 'authenticator', status: 'unverified', secret: 'JBSWY3DPEHPK3PXP' };
      usr.mfaFactors.push(f);
      return ok(route, { id: f.id, type: 'totp', friendly_name: f.friendly_name, totp: { qr_code: FAKE_QR_SVG, secret: f.secret, uri: 'otpauth://totp/Cinepisode:' + usr.email + '?secret=' + f.secret + '&issuer=Cinepisode' } });
    }
    const chM = p.match(/^\/auth\/v1\/factors\/([^/]+)\/challenge$/);
    if (chM && req.method() === 'POST') {
      const usr = current(req); if (!usr) return err(route, 401, 'session_not_found', 'invalid JWT');
      if (!(usr.mfaFactors || []).some(f => f.id === chM[1])) return err(route, 404, 'mfa_factor_not_found', 'Factor not found');
      return ok(route, { id: 'ch-' + Date.now(), type: 'totp', expires_at: Math.floor(Date.now() / 1000) + 300 });
    }
    const vM = p.match(/^\/auth\/v1\/factors\/([^/]+)\/verify$/);
    if (vM && req.method() === 'POST') {
      const usr = current(req); if (!usr) return err(route, 401, 'session_not_found', 'invalid JWT');
      const f = (usr.mfaFactors || []).find(x => x.id === vM[1]);
      if (!f) return err(route, 404, 'mfa_factor_not_found', 'Factor not found');
      if (body.code !== '123456') return err(route, 401, 'invalid_mfa_code', 'Invalid TOTP code entered');
      f.status = 'verified';
      return ok(route, session(usr, 'aal2'));
    }
    const dM = p.match(/^\/auth\/v1\/factors\/([^/]+)$/);
    if (dM && req.method() === 'DELETE') {
      const usr = current(req); if (!usr) return err(route, 401, 'session_not_found', 'invalid JWT');
      usr.mfaFactors = (usr.mfaFactors || []).filter(f => f.id !== dM[1]);
      return ok(route, { id: dM[1] });
    }

    if (p === '/rest/v1/profiles') {
      const usr = current(req);
      if (req.method() === 'POST') { const pr = { id: 'p-' + usr.id, account_id: usr.id, name: 'Moi' }; db.profiles.push(pr); return ok(route, req.headers()['accept'] && req.headers()['accept'].includes('vnd.pgrst.object') ? { id: pr.id } : [{ id: pr.id }], 201); }
      const rows = db.profiles.filter(x => usr && x.account_id === usr.id);
      if ((req.headers()['accept'] || '').includes('vnd.pgrst.object')) return rows[0] ? ok(route, rows[0]) : err(route, 406, 'PGRST116', 'no rows');
      return ok(route, rows);
    }
    /* Appareils de l'extension (carte « Extension connectée ») : lecture seule, non révoqués */
    if (p === '/rest/v1/extension_devices') return current(req) ? ok(route, (db.devices || []).filter(d => !d.revoked_at)) : err(route, 401, '42501', 'jwt');
    if (p === '/rest/v1/watchlist_items') return ok(route, req.method() === 'GET' ? db.items : []);
    /* Titres détectés (onglet « Détectés ») : RLS simulée = lignes du compte connecté ; filtres eq / in, offset / limit */
    if (p === '/rest/v1/detected_media') {
      const usr = current(req);
      if (!usr) return err(route, 401, '42501', 'permission denied');
      const sp = u.searchParams;
      const match = r => {
        if (r.user_id !== usr.id) return false;
        for (const [k, v] of sp) {
          if (['select', 'order', 'offset', 'limit'].includes(k)) continue;
          if (v.startsWith('eq.') && String(r[k]) !== v.slice(3)) return false;
          if (v.startsWith('in.(') && !v.slice(4, -1).split(',').map(x => x.replace(/^"|"$/g, '')).includes(String(r[k]))) return false;
        }
        return true;
      };
      if (req.method() === 'GET') {
        const rows = db.detected.filter(match).sort((a, b) => (a.id < b.id ? -1 : 1));
        const off = +(sp.get('offset') || 0), lim = sp.has('limit') ? +sp.get('limit') : rows.length;
        return ok(route, rows.slice(off, off + lim).map(({ user_id, ...r }) => r));
      }
      if (req.method() === 'PATCH') {
        const keys = Object.keys(body || {});
        if (keys.some(k => k !== 'state')) return err(route, 403, '42501', 'permission denied for table detected_media');
        db.detected.filter(match).forEach(r => { r.state = body.state; });
        return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
      }
      if (req.method() === 'DELETE') {
        db.detected = db.detected.filter(r => !match(r));
        return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
      }
      return err(route, 403, '42501', 'permission denied for table detected_media');
    }
    /* Partage en lecture seule : mêmes règles que la migration 20261013150000 (RLS, RPC) */
    if (p === '/rest/v1/shares') {
      const usr = current(req);
      if (!usr) return err(route, 401, '42501', 'jwt');
      if (req.method() !== 'GET') return err(route, 403, '42501', 'permission denied for table shares');
      return ok(route, db.shares.filter(x => x.account_id === usr.id && !x.revoked_at).map(({ account_id, ...r }) => r));
    }
    if (p === '/rest/v1/rpc/create_share') {
      const usr = current(req);
      if (!usr) return ok(route, { status: 'not_authenticated' });
      if (!db.profiles.some(x => x.id === body.p_profile_id && x.account_id === usr.id)) return ok(route, { status: 'invalid_profile' });
      if (db.shares.filter(x => x.profile_id === body.p_profile_id && !x.revoked_at).length >= 10) return ok(route, { status: 'too_many_shares' });
      const tok = Array.from({ length: 22 }, (_, i) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[(db.shares.length * 7 + i * 13) % 64]).join('');
      const sh = { id: 'sh-' + (db.shares.length + 1), account_id: usr.id, profile_id: body.p_profile_id, token: tok, kind: body.p_kind,
        filter_status: body.p_filter_status, filter_types: body.p_filter_types, hide_ratings: body.p_hide_ratings, hide_progress: body.p_hide_progress,
        view_count: 0, created_at: new Date().toISOString(), revoked_at: null };
      db.shares.push(sh);
      return ok(route, { status: 'ok', id: sh.id, token: sh.token });
    }
    if (p === '/rest/v1/rpc/revoke_share') {
      const usr = current(req);
      const sh = usr && db.shares.find(x => x.id === body.p_id && x.account_id === usr.id && !x.revoked_at);
      if (!sh) return ok(route, { status: 'not_found' });
      sh.revoked_at = new Date().toISOString();
      return ok(route, { status: 'ok' });
    }
    /* Codes de secours MFA (js/37-mfa.js) : seule l'empreinte transmise par le client est vue ici,
       jamais le code en clair — exactement comme la vraie migration (20261027200000). */
    if (p === '/rest/v1/rpc/mfa_recovery_store') {
      const usr = current(req); if (!usr) return ok(route, { status: 'not_authenticated' });
      if (!Array.isArray(body.p_hashes) || body.p_hashes.length !== 10) return ok(route, { status: 'invalid_input' });
      usr.recoveryHashes = body.p_hashes.map(h => ({ hash: h, used: false }));
      return ok(route, { status: 'ok', count: 10 });
    }
    if (p === '/rest/v1/rpc/mfa_recovery_consume_check') {
      const usr = current(req); if (!usr) return ok(route, { status: 'not_authenticated' });
      const row = (usr.recoveryHashes || []).find(r => r.hash === body.p_hash && !r.used);
      if (!row) return ok(route, { status: 'invalid_or_used' });
      row.used = true;
      return ok(route, { status: 'ok' });
    }
    if (p === '/rest/v1/rpc/mfa_recovery_count') {
      const usr = current(req); if (!usr) return ok(route, { status: 'not_authenticated' });
      return ok(route, { status: 'ok', count: (usr.recoveryHashes || []).filter(r => !r.used).length });
    }
    if (p === '/rest/v1/rpc/mfa_recovery_clear') {
      const usr = current(req); if (!usr) return ok(route, { status: 'not_authenticated' });
      usr.recoveryHashes = [];
      return ok(route, { status: 'ok' });
    }
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
