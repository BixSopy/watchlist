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
 *   index.html                            blocs <!--brand:…-->, <!--i18n:scripts--> et /*brand:css*\/ uniquement
 *   vercel.json                           en-tête X-Robots-Tag et réécritures /fr, /en uniquement
 *   robots.txt, sitemap.xml               (avec les variantes de langue hreflang)
 *   pages légales                         une par langue (sources : branding/legal/<langue>/),
 *                                         ex. confidentialite.html + conditions.html (fr), privacy.html + terms.html (en)
 *   supabase/templates/*.html             emails d'authentification, toutes les langues dans un seul
 *                                         modèle (sources : branding/emails/<langue>/)
 *   supabase/templates/subjects.json      objets des emails (bilingues)
 *
 * Langues : une par dictionnaire js/i18n/<code>.js (textes de l'app + $meta : locale, accroche,
 * chemins des pages légales…). Ajouter une langue = ajouter ce fichier puis relancer ce script ;
 * emails et pages légales de cette langue sont optionnels (repli : langue par défaut / anglais).
 *
 * Syntaxe des sources : [[cle]] ou [[cle.sous_cle]] = valeur de brand.config.json (échappée HTML).
 * Les variables Supabase ({{ .ConfirmationURL }}, {{ .Token }}…) sont laissées telles quelles.
 * Aucune dépendance npm.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const rel = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(rel(p), 'utf8');

const brand = JSON.parse(read('brand.config.json'));
const GENERATED = 'Fichier généré par scripts/build-brand.mjs depuis brand.config.json — ne pas modifier à la main.';

/* ---------- langues ---------- */
/* Dictionnaires de l'app (js/i18n/<code>.js) évalués dans un bac à sable : la liste des langues,
   leurs métadonnées ($meta) et les textes partagés (pied de page, emails, pages légales). */
function loadDicts() {
  const dir = rel('js/i18n');
  const dicts = {};
  for (const f of fs.readdirSync(dir).sort()) {
    const m = /^([a-z]{2})\.js$/.exec(f);
    if (!m) continue;
    const sandbox = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(dir, f), 'utf8'), sandbox, { filename: f });
    const d = sandbox.window.I18N_DICTS && sandbox.window.I18N_DICTS[m[1]];
    if (!d || !d.$meta) throw new Error('js/i18n/' + f + ' : dictionnaire « ' + m[1] + ' » ou $meta introuvable');
    dicts[m[1]] = d;
  }
  return dicts;
}
const DICTS = loadDicts();
/* Langue par défaut : celle des emails quand le compte n'a pas de langue (comptes existants),
   et des textes statiques avant exécution du JS */
const DEFAULT_LANG = (brand.i18n && brand.i18n.default) || 'fr';
if (!DICTS[DEFAULT_LANG]) throw new Error('Langue par défaut « ' + DEFAULT_LANG + ' » sans dictionnaire js/i18n/' + DEFAULT_LANG + '.js');
const LANGS = [DEFAULT_LANG, ...Object.keys(DICTS).filter(l => l !== DEFAULT_LANG).sort()];
const FALLBACK_LANG = DICTS.en ? 'en' : DEFAULT_LANG;
function T(lang, key, vars) {
  let s;
  for (const l of [lang, FALLBACK_LANG, DEFAULT_LANG]) if (DICTS[l] && Object.prototype.hasOwnProperty.call(DICTS[l], key)) { s = DICTS[l][key]; break; }
  if (s === undefined) throw new Error('Clé de traduction inconnue : ' + key);
  return vars ? String(s).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : s;
}
function langMeta(lang) {
  const m = DICTS[lang].$meta;
  return { ...m, tagline: m.tagline || brand.tagline, description: m.description || brand.description };
}
const LEGAL_KINDS = ['privacy', 'terms'];
const hasLegal = (lang) => LEGAL_KINDS.every(k => fs.existsSync(rel('branding/legal/' + lang + '/' + k + '.html')));
const LEGAL_LANGS = LANGS.filter(hasLegal);
if (!LEGAL_LANGS.includes(DEFAULT_LANG)) throw new Error('Pages légales manquantes pour la langue par défaut (branding/legal/' + DEFAULT_LANG + '/)');
/* Chemins des pages légales d'une langue (sans sources : ceux de l'anglais, sinon du défaut) */
function legalPaths(lang) {
  const l = hasLegal(lang) ? lang : (hasLegal(FALLBACK_LANG) ? FALLBACK_LANG : DEFAULT_LANG);
  const p = DICTS[l].$meta.legal || {};
  for (const k of LEGAL_KINDS) if (!/^\/[a-z0-9-]+$/.test(p[k] || '')) throw new Error('js/i18n/' + l + '.js : $meta.legal.' + k + ' invalide');
  return p;
}
const EMAIL_LANGS = LANGS.filter(l => fs.existsSync(rel('branding/emails/' + l)));

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
function editorLine(lang = DEFAULT_LANG) {
  const n = brand.editor && brand.editor.name;
  return n ? escHtml(n) + '.' : escHtml(T(lang, 'legal.page.editor'));
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
function emailBody(body, lang) {
  let out = body
    .replace(/\[\[button\|\|([^|]+)\|\|([^\]]+)\]\]/g, (m, label, href) =>
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 24px;"><tr><td align="center" bgcolor="${C.accent}" style="background-color:${C.accent};border-radius:12px;">` +
      `<a href="${href}" target="_blank" style="display:inline-block;padding:14px 30px;font-family:${F.display};font-size:15px;line-height:20px;font-weight:700;color:${C.onAccent};text-decoration:none;border-radius:12px;">${label}</a></td></tr></table>`)
    .replace(/\[\[code\|\|([^\]]+)\]\]/g, (m, code) =>
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 8px;"><tr><td class="wl-code" align="center" bgcolor="${C.surface2}" style="background-color:${C.surface2};border:1px dashed ${C.border};border-radius:14px;padding:16px 12px;font-family:${F.mono};font-size:30px;line-height:36px;letter-spacing:8px;font-weight:600;color:#ffffff;">${code}</td></tr></table>`)
    .replace(/\[\[fallback\|\|([^\]]+)\]\]/g, (m, href) =>
      `<p style="margin:18px 0 0;padding-top:16px;border-top:1px solid ${C.border};font-family:${F.body};font-size:12px;line-height:18px;color:${C.textFaint};word-break:break-all;">${escHtml(T(lang, 'mail.fallback'))}<br><a href="${href}" target="_blank" style="color:${C.textMuted};text-decoration:underline;">${href}</a></p>`)
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

/* Un modèle Supabase par type d'email : chaque langue y est un document complet, choisi par
   {{ .Data.lang }} (user_metadata.lang, écrit par l'app à l'inscription et au changement de
   langue). Sans langue (comptes créés avant l'anglais) ou langue inconnue : langue par défaut.
   « with » protège d'un .Data absent ; printf évite de comparer une valeur nil. */
function emailLangSwitch(docs) {
  const others = EMAIL_LANGS.filter(l => l !== DEFAULT_LANG);
  if (!others.length) return docs[DEFAULT_LANG];
  let out = '{{ $lang := "" }}{{ with .Data }}{{ $lang = printf "%v" .lang }}{{ end }}';
  others.forEach((l, i) => { out += (i ? '{{ else if eq $lang "' + l + '" }}' : '{{ if eq $lang "' + l + '" }}') + docs[l]; });
  return out + '{{ else }}' + docs[DEFAULT_LANG] + '{{ end }}';
}
/* Objet bilingue : l'objet n'est pas conditionnel dans le tableau de bord, on met les langues
   à la suite (langue par défaut d'abord), le nom de l'app une seule fois à la fin. */
function combineSubjects(list) {
  const suffix = ' · ' + brand.name;
  const all = list.every(s => s.endsWith(suffix));
  const parts = [...new Set(list.map(s => (all ? s.slice(0, -suffix.length) : s)))];
  return parts.join(' · ') + (all ? suffix : '');
}
function buildEmails(out) {
  const layout = read('branding/emails/_layout.html');
  const subjects = {};
  if (!EMAIL_LANGS.includes(DEFAULT_LANG)) throw new Error('Emails manquants pour la langue par défaut (branding/emails/' + DEFAULT_LANG + '/)');
  for (const t of EMAIL_TEMPLATES) {
    const docs = {}, bylang = {};
    for (const lang of EMAIL_LANGS) {
      const file = 'branding/emails/' + lang + '/' + t.file + '.html';
      if (!fs.existsSync(rel(file))) throw new Error(file + ' manquant');
      const { meta, body } = parseSource(read(file));
      const subject = fill(meta.subject).replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
      bylang[lang] = subject;
      docs[lang] = fill(layout, {
        lang,
        title: escHtml(subject.replace(/\{\{[^}]*\}\}/g, '').replace(/^\s*[·-]\s*/, '').trim()),
        preheader: fill(meta.preheader || ''),
        tagline: escHtml(langMeta(lang).tagline),
        footerReason: escHtml(T(lang, 'mail.footer.reason', { name: brand.name })),
        footerQuestion: escHtml(T(lang, 'mail.footer.question')),
        content: emailBody(body.trim(), lang),
      });
    }
    out['supabase/templates/' + t.file + '.html'] = emailLangSwitch(docs);
    const conditional = EMAIL_LANGS.length > 1
      ? '{{ $lang := "" }}{{ with .Data }}{{ $lang = printf "%v" .lang }}{{ end }}' +
        EMAIL_LANGS.filter(l => l !== DEFAULT_LANG).map((l, i) => (i ? '{{ else if eq $lang "' : '{{ if eq $lang "') + l + '" }}' + bylang[l]).join('') +
        '{{ else }}' + bylang[DEFAULT_LANG] + '{{ end }}'
      : bylang[DEFAULT_LANG];
    subjects[t.file] = { dashboard: t.dashboard, subject: combineSubjects(EMAIL_LANGS.map(l => bylang[l])), byLanguage: bylang, subjectConditional: conditional };
  }
  out['supabase/templates/subjects.json'] = JSON.stringify({ $comment: GENERATED,
    $comment_subject: '« subject » (toutes les langues à la suite) est l\'objet à coller dans Supabase. « subjectConditional » (une seule langue selon le compte) est une option non testée sur Supabase : à n\'utiliser qu\'après avoir vérifié qu\'un email de test arrive avec le bon objet.',
    defaultLanguage: DEFAULT_LANG, languages: EMAIL_LANGS,
    smtp: { senderEmail: brand.senderEmail, senderName: brand.senderName, host: 'smtp.resend.com', port: 465, username: 'resend' },
    ...subjects }, null, 2) + '\n';
}

/* ---------- pages légales ---------- */
function hreflangLinks(urls, xDefault) {
  return Object.entries(urls).map(([l, u]) => `\n<link rel="alternate" hreflang="${l}" href="${escHtml(u)}">`).join('') +
    `\n<link rel="alternate" hreflang="x-default" href="${escHtml(xDefault)}">`;
}
function legalUrls(kind) {
  const urls = {};
  for (const l of LEGAL_LANGS) urls[l] = brand.baseUrl + legalPaths(l)[kind];
  return urls;
}
function buildLegal(out) {
  const layout = read('branding/legal/_layout.html');
  for (const lang of LEGAL_LANGS) {
    const paths = legalPaths(lang);
    for (const kind of LEGAL_KINDS) {
      const { meta, body } = parseSource(read('branding/legal/' + lang + '/' + kind + '.html'));
      const urls = legalUrls(kind);
      const otherLangs = LEGAL_LANGS.filter(l => l !== lang).map(l =>
        `<a class="lang" href="${escHtml(legalPaths(l)[kind])}" hreflang="${l}" lang="${l}">${escHtml(langMeta(l).name)}</a>`).join('');
      out[paths[kind].slice(1) + '.html'] = '<!-- ' + GENERATED + ' -->\n' + fill(layout, {
        lang, title: escHtml(meta.title), updated: escHtml(meta.updated), robots,
        description: escHtml(T(lang, 'legal.page.description', { title: meta.title, name: brand.name })),
        canonical: brand.indexable ? `\n<link rel="canonical" href="${escHtml(urls[lang])}">` + hreflangLinks(urls, urls[FALLBACK_LANG] || urls[DEFAULT_LANG]) : '',
        ogLocale: escHtml(langMeta(lang).og || lang),
        logoSvg: logoSvg(), editorLine: editorLine(lang),
        back: escHtml(T(lang, 'legal.page.back')), updatedLabel: escHtml(T(lang, 'legal.page.updated')),
        otherLangs,
        privacyHref: escHtml(paths.privacy), termsHref: escHtml(paths.terms),
        privacyLabel: escHtml(T(lang, 'legal.privacy')), termsLabel: escHtml(T(lang, 'legal.terms')),
        contactLabel: escHtml(T(lang, 'footer.contact')), footerNote: escHtml(T(lang, 'legal.page.footerNote')),
        content: fill(body, { editorLine: editorLine(lang), 'legal.privacy': escHtml(paths.privacy), 'legal.terms': escHtml(paths.terms) }),
      });
    }
  }
}

/* ---------- app ---------- */
function landingUrls() {
  const urls = {};
  for (const l of LANGS) urls[l] = brand.baseUrl + '/' + l;
  return urls;
}
function buildApp(out) {
  const legal = {};
  for (const l of LANGS) legal[l] = { privacy: legalPaths(l).privacy, terms: legalPaths(l).terms };
  const pub = {
    name: brand.name, shortName: brand.shortName, wordmark: brand.wordmark, tagline: brand.tagline,
    baseUrl: brand.baseUrl, contactEmail: brand.contactEmail, defaultLang: DEFAULT_LANG,
    legal,
  };
  out['js/00-brand.js'] = '/* MODULE: Identité de l\'app (nom, domaine, contact). ' + GENERATED + ' */\n' +
    'var BRAND=Object.freeze(' + JSON.stringify(pub) + ');\n';

  out['manifest.json'] = JSON.stringify({
    /* Un seul manifeste pour toutes les langues : description neutre en anglais */
    name: brand.name, short_name: brand.shortName, description: langMeta(FALLBACK_LANG).description,
    start_url: '/', scope: '/', display: 'standalone',
    background_color: C.themeColor, theme_color: C.themeColor, orientation: 'any', lang: FALLBACK_LANG,
    icons: [
      { src: brand.logo.icon192, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: brand.logo.icon512, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: brand.logo.maskable512, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }, null, 2) + '\n';

  const blocks = {
    head: '\n' + [
      /* Titre descriptif pour la page d'accueil (moteurs de recherche, onglet) ; ramené au nom seul
         pour les membres par js/00-landing-gate.js, traduit par js/23-landing.js */
      `<title>${escHtml(T(DEFAULT_LANG, 'lp.meta.title', { name: brand.name }))}</title>`,
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
      `<meta property="og:locale" content="${escHtml(langMeta(DEFAULT_LANG).og || DEFAULT_LANG)}">`,
      ...LANGS.filter(l => l !== DEFAULT_LANG).map(l => `<meta property="og:locale:alternate" content="${escHtml(langMeta(l).og || l)}">`),
      `<meta name="twitter:card" content="summary">`,
      /* Accueil : /fr, /en (réécrits vers / dans vercel.json, langue forcée par js/00-i18n.js) ;
         « / » choisit la langue du visiteur (x-default) */
      ...(brand.indexable ? [`<link rel="canonical" href="${escHtml(brand.baseUrl)}/">`,
        ...hreflangLinks(landingUrls(), brand.baseUrl + '/').trim().split('\n')] : []),
    ].join('\n') + '\n',
    /* Plusieurs occurrences possibles (en-tête de l'app, page d'accueil) : toutes remplacées */
    contact: `<a class="lp-mail" href="mailto:${escHtml(brand.contactEmail)}">${escHtml(brand.contactEmail)}</a>`,
    logo: `<div class="logo">${logoSvg().replace(/ fill="[^"]*"/, ' style="fill:var(--accent)"').replace(/ fill="[^"]*"/, ' style="fill:var(--on-accent)"')}<span class="logo-word">${escHtml(brand.wordmark.main)}<em>${escHtml(brand.wordmark.accent)}</em></span></div>`,
    /* Textes dans la langue par défaut, traduits au chargement (data-i18n, data-legal : js/00-i18n.js) */
    footer: '\n<footer class="app-foot">\n' +
      `  <div class="app-foot-row">${escHtml(brand.name)} &nbsp;·&nbsp; <span id="statsFooter">—</span></div>\n` +
      `  <nav class="app-foot-links" aria-label="${escHtml(T(DEFAULT_LANG, 'footer.legalAria'))}" data-i18n-attr="aria-label:footer.legalAria">` +
      `<a href="${escHtml(legalPaths(DEFAULT_LANG).privacy)}" data-legal="privacy" data-i18n="legal.privacy">${escHtml(T(DEFAULT_LANG, 'legal.privacy'))}</a>` +
      `<a href="${escHtml(legalPaths(DEFAULT_LANG).terms)}" data-legal="terms" data-i18n="legal.terms">${escHtml(T(DEFAULT_LANG, 'legal.terms'))}</a>` +
      `<a href="mailto:${escHtml(brand.contactEmail)}" data-i18n="footer.contact">${escHtml(T(DEFAULT_LANG, 'footer.contact'))}</a></nav>\n` +
      '  <div class="app-foot-lang" id="footLang"></div>\n' +
      '  <div class="app-foot-tmdb"><img src="/icons/tmdb-logo.svg" alt="TMDB" width="92" height="12" loading="lazy"><span>This product uses the TMDB API but is not endorsed or certified by TMDB.</span></div>\n' +
      '</footer>\n',
  };
  const cssVars = [
    `--bg:${C.bg}`, `--accent:${C.accent}`, `--accent-rgb:${hexToRgb(C.accent)}`, `--accent-hover:${C.accentHover}`,
    '--accent-dim:rgba(var(--accent-rgb),0.12)', '--accent-dim2:rgba(var(--accent-rgb),0.35)', `--on-accent:${C.onAccent}`,
  ].join(';') + ';';

  let html = read('index.html');
  for (const [name, content] of Object.entries(blocks)) {
    const re = new RegExp('<!--brand:' + name + '-->[\\s\\S]*?<!--/brand:' + name + '-->', 'g');
    if (!html.includes('<!--brand:' + name + '-->')) throw new Error('index.html : bloc <!--brand:' + name + '--> introuvable');
    html = html.replace(re, () => '<!--brand:' + name + '-->' + content + '<!--/brand:' + name + '-->');
  }
  /* Dictionnaires chargés avant js/00-i18n.js (ordre : langue par défaut, puis alphabétique) */
  const i18nRe = /<!--i18n:scripts-->[\s\S]*?<!--\/i18n:scripts-->/;
  if (!i18nRe.test(html)) throw new Error('index.html : bloc <!--i18n:scripts--> introuvable');
  html = html.replace(i18nRe, () => '<!--i18n:scripts-->\n' + LANGS.map(l => `<script src="js/i18n/${l}.js"></script>`).join('\n') + '\n<!--/i18n:scripts-->');
  const cssRe = /\/\*brand:css\*\/[\s\S]*?\/\*\/brand:css\*\//;
  if (!cssRe.test(html)) throw new Error('index.html : bloc /*brand:css*/ introuvable');
  html = html.replace(cssRe, () => '/*brand:css*/' + cssVars + '/*/brand:css*/');
  out['index.html'] = html;

  /* Indexation : X-Robots-Tag noindex partout si indexable=false ; sinon seulement hors du
     domaine de production (previews, *.vercel.app) et sur /api/. Les balises meta robots
     disent « index » : l'en-tête noindex, plus restrictif, l'emporte sur les autres hôtes. */
  const vercel = JSON.parse(read('vercel.json'));
  const NOINDEX = 'noindex, nofollow, noarchive';
  const prodHost = new URL(brand.baseUrl).hostname;
  vercel.headers = vercel.headers.filter(h => !(h.headers.length === 1 && h.headers[0].key === 'X-Robots-Tag'));
  const main = vercel.headers.find(h => h.source === '/(.*)' && !h.has && !h.missing);
  main.headers = main.headers.filter(kv => kv.key !== 'X-Robots-Tag');
  if (!brand.indexable) {
    main.headers.push({ key: 'X-Robots-Tag', value: NOINDEX });
  } else {
    const at = vercel.headers.indexOf(main) + 1;
    vercel.headers.splice(at, 0,
      { source: '/(.*)', missing: [{ type: 'host', value: prodHost }], headers: [{ key: 'X-Robots-Tag', value: NOINDEX }] },
      { source: '/api/(.*)', headers: [{ key: 'X-Robots-Tag', value: NOINDEX }] });
  }
  /* robots.txt + sitemap.xml (pages publiques seulement) */
  out['robots.txt'] = '# ' + GENERATED + '\nUser-agent: *\n' +
    (brand.indexable ? 'Disallow: /api/\n\nSitemap: ' + brand.baseUrl + '/sitemap.xml\n' : 'Disallow: /\n');
  /* Chaque page avec ses variantes de langue (xhtml:link hreflang) */
  const groups = [{ urls: landingUrls(), xDefault: brand.baseUrl + '/', pages: [brand.baseUrl + '/', ...Object.values(landingUrls())] }];
  for (const kind of LEGAL_KINDS) {
    const urls = legalUrls(kind);
    groups.push({ urls, xDefault: urls[FALLBACK_LANG] || urls[DEFAULT_LANG], pages: Object.values(urls) });
  }
  out['sitemap.xml'] = '<?xml version="1.0" encoding="UTF-8"?>\n<!-- ' + GENERATED + ' -->\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
    groups.map(g => g.pages.map(u => '  <url>\n    <loc>' + escHtml(u) + '</loc>\n' +
      Object.entries(g.urls).map(([l, h]) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${escHtml(h)}"/>\n`).join('') +
      `    <xhtml:link rel="alternate" hreflang="x-default" href="${escHtml(g.xDefault)}"/>\n  </url>\n`).join('')).join('') +
    '</urlset>\n';
  /* /fr, /en… : même app (index.html), langue imposée par l'adresse */
  vercel.rewrites = [{ source: '/:lang(' + LANGS.join('|') + ')', destination: '/' }];
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
