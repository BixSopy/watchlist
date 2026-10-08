'use strict';
/*
 * Identité de l'app centralisée dans brand.config.json : les fichiers générés doivent être à
 * jour, les gabarits d'emails Supabase doivent contenir les bonnes variables, et aucun texte
 * visible ne doit coder en dur l'ancien domaine.
 * Lancer : node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const brand = JSON.parse(read('brand.config.json'));
const TPL = ['confirmation', 'invite', 'magic_link', 'email_change', 'recovery', 'reauthentication',
  'password_changed_notification', 'email_changed_notification'];

test('les fichiers générés depuis brand.config.json sont à jour', () => {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/build-brand.mjs'), '--check'], { stdio: 'pipe' });
});

test('le nom, le domaine et le contact viennent de brand.config.json', () => {
  const html = read('index.html');
  assert.match(html, new RegExp('<title>' + brand.name + '</title>'));
  assert.match(html, new RegExp('<meta property="og:url" content="' + brand.baseUrl + '/">'));
  const manifest = JSON.parse(read('manifest.json'));
  assert.strictEqual(manifest.name, brand.name);
  assert.strictEqual(manifest.short_name, brand.shortName);
  assert.match(read('js/00-brand.js'), new RegExp('"baseUrl":"' + brand.baseUrl + '"'));
  for (const f of ['confidentialite.html', 'conditions.html']) {
    assert.ok(read(f).includes(brand.contactEmail), f + ' : contact');
    assert.ok(read(f).includes(brand.name), f + ' : nom');
  }
  assert.strictEqual(JSON.parse(read('supabase/templates/subjects.json')).smtp.senderEmail, brand.senderEmail);
});

test('aucun texte visible ne code en dur un domaine de déploiement', () => {
  const files = ['index.html', 'confidentialite.html', 'conditions.html', 'manifest.json', 'js/00-brand.js',
    ...fs.readdirSync(path.join(ROOT, 'js')).map(f => 'js/' + f),
    ...TPL.map(t => 'supabase/templates/' + t + '.html'), 'supabase/templates/subjects.json'];
  for (const f of files) assert.doesNotMatch(read(f), /vercel\.app/, f);
  /* le domaine de production n'apparaît que via la configuration générée */
  for (const f of fs.readdirSync(path.join(ROOT, 'js')).filter(f => f !== '00-brand.js')) {
    assert.ok(!read('js/' + f).includes(new URL(brand.baseUrl).hostname), 'js/' + f);
  }
});

test('les gabarits d\'emails utilisent les variables Supabase attendues', () => {
  const needs = {
    confirmation: ['.TokenHash', '.Token', 'type=email', 'action=signup', '.RedirectTo', '.SiteURL'],
    invite: ['.TokenHash', 'type=invite', '.RedirectTo'],
    magic_link: ['.TokenHash', '.Token', 'type=email', 'action=magiclink'],
    email_change: ['.TokenHash', '.Token', '.NewEmail', 'type=email_change'],
    recovery: ['.TokenHash', '.Token', 'type=recovery', 'action=recovery'],
    reauthentication: ['.Token'],
    password_changed_notification: ['.Email', '.SiteURL'],
    email_changed_notification: ['.OldEmail', '.Email', '.SiteURL'],
  };
  for (const t of TPL) {
    const h = read('supabase/templates/' + t + '.html');
    for (const v of needs[t]) assert.ok(h.includes(v), t + ' : ' + v);
    assert.doesNotMatch(h, /\[\[|\]\]/, t + ' : marqueur [[…]] non remplacé');
    assert.doesNotMatch(h, /<!--(?!\[)/, t + ' : commentaire HTML (supprimé par Supabase)');
    assert.doesNotMatch(h, /<script|<img[^>]+src="http/i, t + ' : pas de script ni d\'image distante');
    assert.doesNotMatch(h, /\{\{\s*\.ConfirmationURL/, t + ' : lien à jeton (token_hash) attendu');
    assert.ok(h.includes(brand.name), t + ' : nom de l\'app');
    /* les liens sont échappés pour html/template (&amp; dans les attributs href) */
    for (const m of h.matchAll(/href="([^"]*token_hash[^"]*)"/g)) assert.doesNotMatch(m[1], /&(?!amp;)/, t);
  }
  const subjects = JSON.parse(read('supabase/templates/subjects.json'));
  for (const t of TPL) assert.ok(subjects[t] && subjects[t].subject.includes(brand.name), t + ' : sujet');
});

test('CSP : Turnstile autorisé, rien d\'autre d\'ouvert ; redirections de domaine inactives par défaut', () => {
  const vercel = JSON.parse(read('vercel.json'));
  const csp = vercel.headers[0].headers.find(h => h.key === 'Content-Security-Policy').value;
  assert.match(csp, /script-src 'self' https:\/\/challenges\.cloudflare\.com;/);
  assert.match(csp, /frame-src https:\/\/challenges\.cloudflare\.com;/);
  assert.match(csp, /form-action 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.strictEqual(vercel.headers[0].headers.find(h => h.key === 'Referrer-Policy').value, 'strict-origin');
  assert.deepStrictEqual(vercel.regions, ['fra1']);
  assert.strictEqual(vercel.cleanUrls, true);
  if (!(brand.domains && brand.domains.redirects)) assert.strictEqual(vercel.redirects, undefined);
  const ignore = read('.vercelignore');
  for (const f of ['confidentialite.html', 'conditions.html']) assert.match(ignore, new RegExp('^!' + f.replace('.', '\\.') + '$', 'm'));
});
