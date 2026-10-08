'use strict';
/*
 * Configuration PUBLIQUE de l'app : GET /api/config
 * Ne renvoie que des valeurs destinées au navigateur (jamais de secret) :
 *  - turnstileSiteKey : clé de site Cloudflare Turnstile (TURNSTILE_SITE_KEY). Vide = pas de
 *    CAPTCHA côté app (à n'activer dans Supabase qu'APRÈS avoir renseigné cette variable).
 *  - signupsOpen : false si SIGNUPS_OPEN=0 (l'écran « Créer un compte » est alors masqué ;
 *    la vraie fermeture se fait dans Supabase › Authentication › Sign In / Providers).
 * Pas de session requise. Mise en cache CDN courte (une variable modifiée dans Vercel est
 * de toute façon prise en compte au redéploiement suivant).
 */
const { fail } = require('./_lib/common');

const SITE_KEY_RE = /^[0-9A-Za-z_-]{10,100}$/;

function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return fail(res, 405, 'method_not_allowed', 'GET uniquement'); }
  const sk = String(process.env.TURNSTILE_SITE_KEY || '').trim();
  const body = {
    turnstileSiteKey: SITE_KEY_RE.test(sk) ? sk : '',
    signupsOpen: String(process.env.SIGNUPS_OPEN || '1').trim() !== '0',
  };
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');
  res.end(JSON.stringify(body));
}

module.exports = handler;
