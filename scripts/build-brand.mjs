#!/usr/bin/env node
/*
 * Génère tous les fichiers qui portent l'identité de l'app à partir de brand.config.json
 * (source unique : nom, domaine, email de contact, couleurs, polices, logo).
 *
 *   node scripts/build-brand.mjs          régénère les fichiers
 *   node scripts/build-brand.mjs --check  n'écrit rien, échoue si un fichier n'est pas à jour
 *                                         (lancé par les tests : tests/brand.test.js)
 *
 * Fichiers produits :
 *   js/00-brand.js                        constantes BRAND lues par l'app
 *   manifest.json                         manifeste PWA
 *   index.html                            blocs <!--brand:…--> et /*brand:css*\/ uniquement
 *   vercel.json                           valeur de l'en-tête X-Robots-Tag uniquement
 *   confidentialite.html, conditions.html pages légales (sources : branding/legal/)
 *   supabase/templates/*.html             emails d'authentification (sources : branding/emails/)
 *   supabase/templates/subjects.json      objets des emails
 *
 * Syntaxe des sources : [[cle]] ou [[cle.sous_cle]] = valeur de brand.config.json (échappée HTML).
 * Les variables Supabase ({{ .ConfirmationURL }}, {{ .Token }}…) sont laissées telles quelles.
 * Aucune dépendance npm.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const rel = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(rel(p), 'utf8');

const brand = JSON.parse(read('brand.config.json'));
const GENERATED = 'Fichier généré par scripts/build-brand.mjs depuis brand.config.json — ne pas modifier à la main.';

/* ---------- utilitaires ---------- */
function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function lookup(obj, key) {
  return key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function hexToRgb(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error('Couleur hexadécimale attendue (#rrggbb) : ' + hex);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(',');
}
/* Remplace [[cle]] ; `raw` = valeurs déjà HTML (non échappées) */
function fill(tpl, raw = {}) {
  return tpl.replace(/\[\[([a-zA-Z0-9_.]+)\]\]/g, (m, key) => {
    if (Object.prototype.hasOwnProperty.call(raw, key)) return raw[key];
    const v = lookup(brand, key);
    if (v === undefined || v === null || typeof v === 'object') throw new Error('Clé de marque inconnue : ' + key);
    return escHtml(v);
  });
}
function parseSource(text) {
  const i = text.indexOf('\n---\n');
  if (i < 0) throw new Error('En-tête « --- » manquant');
  const meta = {};
  for (const line of text.slice(0, i).split('\n')) {
    const m = /^([a-z]+):\s*(.*)$/.exec(line.trim());
    if (m) meta[m[1]] = m[2];
  }
  return { meta, body: text.slice(i + 5) };
}
function validate() {
  const req = ['name', 'shortName', 'tagline', 'description', 'baseUrl', 'contactEmail', 'senderName', 'senderEmail'];
  for (const k of req) if (!brand[k] || typeof brand[k] !== 'string') throw new Error('brand.config.json : « ' + k + ' » manquant');
  if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(brand.baseUrl)) throw new Error('baseUrl doit être une origine https sans chemin ni « / » final');
  for (const k of ['contactEmail', 'senderEmail']) if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(brand[k])) throw new Error(k + ' invalide');
  const dm = brand.domains || {};
  if (dm.legacyHosts && (!Array.isArray(dm.legacyHosts) || dm.legacyHosts.some(h => !/^[a-z0-9.-]+$/i.test(h)))) throw new Error('domains.legacyHosts : liste de noms d\'hôte attendue');
  for (const [k, v] of Object.entries(brand.colors)) hexToRgb(v), k;
}

/* ---------- morceaux réutilisés ---------- */
function logoSvg() { return fill(read('branding/logo-mark.svg').trim()); }
function editorLine() {
  const n = brand.editor && brand.editor.name;
  return n ? escHtml(n) + '.'
    : "particulier, éditeur non professionnel (identité communiquée à l'hébergeur conformément à l'article 6-III-2 de la loi pour la confiance dans l'économie numérique).";
}
const robots = brand.indexable ? 'index,follow' : 'noindex,nofollow';

/* ---------- emails ---------- */
const C = brand.colors, F = brand.fonts;
const EMAIL_STYLES = {
  h1: `margin:0 0 14px;font-family:${F.display};font-size:25px;line-height:33px;font-weight:800;letter-spacing:-0.3px;color:#ffffff;`,
  p: `margin:0 0 16px;font-family:${F.body};font-size:15px;line-height:24px;color:${C.text};`,
  'p.muted': `margin:0 0 12px;font-family:${F.body};font-size:14px;line-height:22px;color:${C.textMuted};`,
  'p.small': `margin:22px 0 0;font-family:${F.body};font-size:12.5px;line-height:20px;color:${C.textFaint};`,
  strong: 'color:#ffffff;font-weight:600;',
  a: `color:${C.accent};text-decoration:underline;`,
};
function emailBody(body) {
  let out = body
    .replace(/\[\[button\|\|([^|]+)\|\|([^\]]+)\]\]/g, (m, label, href) =>
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 24px;"><tr><td align="center" bgcolor="${C.accent}" style="background-color:${C.accent};border-radius:12px;">` +
      `<a href="${href}" target="_blank" style="display:inline-block;padding:14px 30px;font-family:${F.display};font-size:15px;line-height:20px;font-weight:700;color:${C.onAccent};text-decoration:none;border-radius:12px;">${label}</a></td></tr></table>`)
    .replace(/\[\[code\|\|([^\]]+)\]\]/g, (m, code) =>
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 8px;"><tr><td class="wl-code" align="center" bgcolor="${C.surface2}" style="background-color:${C.surface2};border:1px dashed ${C.border};border-radius:14px;padding:16px 12px;font-family:${F.mono};font-size:30px;line-height:36px;letter-spacing:8px;font-weight:600;color:#ffffff;">${code}</td></tr></table>`)
    .replace(/\[\[fallback\|\|([^\]]+)\]\]/g, (m, href) =>
      `<p style="margin:18px 0 0;padding-top:16px;border-top:1px solid ${C.border};font-family:${F.body};font-size:12px;line-height:18px;color:${C.textFaint};word-break:break-all;">Le bouton ne fonctionne pas&nbsp;? Copie ce lien dans ton navigateur&nbsp;:<br><a href="${href}" target="_blank" style="color:${C.textMuted};text-decoration:underline;">${href}</a></p>`)
    .replace(/<h1>/g, `<h1 class="wl-h1" style="${EMAIL_STYLES.h1}">`)
    .replace(/<p class="muted">/g, `<p style="${EMAIL_STYLES['p.muted']}">`)
    .replace(/<p class="small">/g, `<p style="${EMAIL_STYLES['p.small']}">`)
    .replace(/<p>/g, `<p style="${EMAIL_STYLES.p}">`)
    .replace(/<strong>/g, `<strong style="${EMAIL_STYLES.strong}">`)
    .replace(/<a href="mailto:/g, `<a style="${EMAIL_STYLES.a}" href="mailto:`);
  return fill(out);
}

/* Ordre et correspondance avec le tableau de bord Supabase (Authentication › Emails) */
export const EMAIL_TEMPLATES = [
  { file: 'confirmation', dashboard: 'Confirm sign up', apiKey: 'confirmation' },
  { file: 'invite', dashboard: 'Invite user', apiKey: 'invite' },
  { file: 'magic_link', dashboard: 'Magic link', apiKey: 'magic_link' },
  { file: 'email_change', dashboard: 'Change email address', apiKey: 'email_change' },
  { file: 'recovery', dashboard: 'Reset password', apiKey: 'recovery' },
  { file: 'reauthentication', dashboard: 'Reauthentication', apiKey: 'reauthentication' },
  { file: 'password_changed_notification', dashboard: 'Password changed (notification de sécurité)', apiKey: 'password_changed_notification' },
  { file: 'email_changed_notification', dashboard: 'Email address changed (notification de sécurité)', apiKey: 'email_changed_notification' },
];

function buildEmails(out) {
  const layout = read('branding/emails/_layout.html');
  const subjects = {};
  for (const t of EMAIL_TEMPLATES) {
    const { meta, body } = parseSource(read('branding/emails/' + t.file + '.html'));
    const subject = fill(meta.subject).replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
    subjects[t.file] = { dashboard: t.dashboard, subject };
    const html = fill(layout, {
      title: escHtml(subject.replace(/\{\{[^}]*\}\}/g, '').replace(/^\s*[·-]\s*/, '').trim()),
      preheader: fill(meta.preheader || ''),
      content: emailBody(body.trim()),
    });
    out['supabase/templates/' + t.file + '.html'] = html;
  }
  out['supabase/templates/subjects.json'] = JSON.stringify({ $comment: GENERATED,
    smtp: { senderEmail: brand.senderEmail, senderName: brand.senderName, host: 'smtp.resend.com', port: 465, username: 'resend' },
    ...subjects }, null, 2) + '\n';
}

/* ---------- pages légales ---------- */
function buildLegal(out) {
  const layout = read('branding/legal/_layout.html');
  for (const name of ['confidentialite', 'conditions']) {
    const { meta, body } = parseSource(read('branding/legal/' + name + '.html'));
    out[name + '.html'] = '<!-- ' + GENERATED + ' -->\n' + fill(layout, {
      title: escHtml(meta.title), updated: escHtml(meta.updated), robots,
      logoSvg: logoSvg(), editorLine: editorLine(),
      content: fill(body, { editorLine: editorLine() }),
    });
  }
}

/* ---------- app ---------- */
function buildApp(out) {
  const pub = {
    name: brand.name, shortName: brand.shortName, wordmark: brand.wordmark, tagline: brand.tagline,
    baseUrl: brand.baseUrl, contactEmail: brand.contactEmail,
    legal: { privacy: '/confidentialite', terms: '/conditions' },
  };
  out['js/00-brand.js'] = '/* MODULE: Identité de l\'app (nom, domaine, contact). ' + GENERATED + ' */\n' +
    'var BRAND=Object.freeze(' + JSON.stringify(pub) + ');\n';

  out['manifest.json'] = JSON.stringify({
    name: brand.name, short_name: brand.shortName, description: brand.description,
    start_url: '/', scope: '/', display: 'standalone',
    background_color: C.themeColor, theme_color: C.themeColor, orientation: 'any', lang: 'fr',
    icons: [
      { src: brand.logo.icon192, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: brand.logo.icon512, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: brand.logo.maskable512, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }, null, 2) + '\n';

  const blocks = {
    head: '\n' + [
      `<title>${escHtml(brand.name)}</title>`,
      `<meta name="description" content="${escHtml(brand.description)}">`,
      `<meta name="robots" content="${robots}">`,
      '<meta name="referrer" content="strict-origin">',
      '<link rel="manifest" href="/manifest.json">',
      `<meta name="theme-color" content="${C.themeColor}">`,
      `<link rel="icon" href="${escHtml(brand.logo.icon192)}">`,
      `<link rel="apple-touch-icon" href="${escHtml(brand.logo.appleTouch)}">`,
      '<meta name="apple-mobile-web-app-capable" content="yes">',
      '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
      `<meta name="apple-mobile-web-app-title" content="${escHtml(brand.shortName)}">`,
      `<meta property="og:type" content="website">`,
      `<meta property="og:site_name" content="${escHtml(brand.name)}">`,
      `<meta property="og:title" content="${escHtml(brand.name + ' · ' + brand.tagline)}">`,
      `<meta property="og:description" content="${escHtml(brand.description)}">`,
      `<meta property="og:url" content="${escHtml(brand.baseUrl)}/">`,
      `<meta property="og:image" content="${escHtml(brand.baseUrl + brand.logo.icon512)}">`,
      `<meta property="og:locale" content="fr_FR">`,
      `<meta name="twitter:card" content="summary">`,
      ...(brand.indexable ? [`<link rel="canonical" href="${escHtml(brand.baseUrl)}/">`] : []),
    ].join('\n') + '\n',
    logo: `<div class="logo">${logoSvg().replace(/ fill="[^"]*"/, ' style="fill:var(--accent)"').replace(/ fill="[^"]*"/, ' style="fill:var(--on-accent)"')}${escHtml(brand.wordmark.main)}<em>${escHtml(brand.wordmark.accent)}</em></div>`,
    footer: '\n<footer class="app-foot">\n' +
      `  <div class="app-foot-row">${escHtml(brand.name)} &nbsp;·&nbsp; <span id="statsFooter">—</span></div>\n` +
      '  <nav class="app-foot-links" aria-label="Informations légales"><a href="/confidentialite">Confidentialité</a><a href="/conditions">Conditions &amp; mentions légales</a>' +
      `<a href="mailto:${escHtml(brand.contactEmail)}">Contact</a></nav>\n` +
      '  <div class="app-foot-tmdb"><img src="/icons/tmdb-logo.svg" alt="TMDB" width="92" height="12" loading="lazy"><span>This product uses the TMDB API but is not endorsed or certified by TMDB.</span></div>\n' +
      '</footer>\n',
  };
  const cssVars = [
    `--bg:${C.bg}`, `--accent:${C.accent}`, `--accent-rgb:${hexToRgb(C.accent)}`, `--accent-hover:${C.accentHover}`,
    '--accent-dim:rgba(var(--accent-rgb),0.12)', '--accent-dim2:rgba(var(--accent-rgb),0.35)', `--on-accent:${C.onAccent}`,
  ].join(';') + ';';

  let html = read('index.html');
  for (const [name, content] of Object.entries(blocks)) {
    const re = new RegExp('<!--brand:' + name + '-->[\\s\\S]*?<!--/brand:' + name + '-->');
    if (!re.test(html)) throw new Error('index.html : bloc <!--brand:' + name + '--> introuvable');
    html = html.replace(re, () => '<!--brand:' + name + '-->' + content + '<!--/brand:' + name + '-->');
  }
  const cssRe = /\/\*brand:css\*\/[\s\S]*?\/\*\/brand:css\*\//;
  if (!cssRe.test(html)) throw new Error('index.html : bloc /*brand:css*/ introuvable');
  html = html.replace(cssRe, () => '/*brand:css*/' + cssVars + '/*/brand:css*/');
  out['index.html'] = html;

  const vercel = JSON.parse(read('vercel.json'));
  for (const h of vercel.headers) for (const kv of h.headers) {
    if (kv.key === 'X-Robots-Tag') kv.value = brand.indexable ? 'index, follow' : 'noindex, nofollow, noarchive';
  }
  /* Redirections de domaine (désactivées tant que domains.redirects=false) */
  const dm = brand.domains || {};
  const apex = new URL(brand.baseUrl).hostname;
  delete vercel.redirects;
  if (dm.redirects) {
    const redirects = [];
    if (dm.www && !apex.startsWith('www.')) redirects.push({ source: '/:path*', has: [{ type: 'host', value: 'www.' + apex }], destination: brand.baseUrl + '/:path*', permanent: true });
    /* /api/ reste servi sur les anciens domaines : l'app de bureau y vérifie ses mises à jour */
    for (const h of dm.legacyHosts || []) redirects.push({ source: '/:path((?!api/).*)', has: [{ type: 'host', value: h }], destination: brand.baseUrl + '/:path', permanent: false });
    const ordered = {};
    for (const [k, v] of Object.entries(vercel)) { ordered[k] = v; if (k === 'cleanUrls') ordered.redirects = redirects; }
    if (!ordered.redirects) ordered.redirects = redirects;
    out['vercel.json'] = JSON.stringify(ordered, null, 2) + '\n';
  } else {
    out['vercel.json'] = JSON.stringify(vercel, null, 2) + '\n';
  }
}

/* ---------- exécution ---------- */
function main() {
  validate();
  const out = {};
  buildApp(out);
  buildLegal(out);
  buildEmails(out);
  const stale = [];
  for (const [file, content] of Object.entries(out)) {
    const p = rel(file);
    const cur = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
    if (cur === content) continue;
    stale.push(file);
    if (!CHECK) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); }
  }
  if (CHECK) {
    if (stale.length) {
      console.error('Fichiers de marque pas à jour (lancer node scripts/build-brand.mjs) :\n  ' + stale.join('\n  '));
      process.exit(1);
    }
    console.log('Marque : ' + Object.keys(out).length + ' fichiers à jour.');
  } else {
    console.log(stale.length ? 'Régénéré :\n  ' + stale.join('\n  ') : 'Rien à régénérer.');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
export { brand, fill, main };
