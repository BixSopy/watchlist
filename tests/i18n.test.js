'use strict';
/*
 * Langues de l'interface (js/i18n/<code>.js + js/00-i18n.js) : mêmes clés et mêmes variables dans
 * chaque dictionnaire, aucune clé utilisée qui n'existe pas, et rien qui masque la fonction t().
 * Les emails sont rendus dans chaque langue par scripts/email-preview (Go, comme Supabase).
 * Lancer : node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const LANGS = fs.readdirSync(path.join(ROOT, 'js/i18n')).filter(f => /^[a-z]{2}\.js$/.test(f)).map(f => f.slice(0, 2)).sort();
const DICTS = (() => {
  const ctx = { window: {} };
  vm.createContext(ctx);
  for (const l of LANGS) vm.runInContext(read('js/i18n/' + l + '.js'), ctx);
  return ctx.window.I18N_DICTS;
})();
const keys = l => Object.keys(DICTS[l]).filter(k => k !== '$meta').sort();
const vars = s => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
const APP_JS = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f);

test('français et anglais uniquement, chacun déclaré dans son propre fichier', () => {
  assert.deepStrictEqual(LANGS, ['en', 'fr']);
  for (const l of LANGS) assert.ok(DICTS[l], l);
});

test('mêmes clés, mêmes variables et mêmes métadonnées dans chaque langue', () => {
  const ref = keys('fr');
  assert.ok(ref.length > 300, 'dictionnaire complet');
  for (const l of LANGS) {
    assert.deepStrictEqual(keys(l), ref, l + ' : clés différentes du français');
    assert.deepStrictEqual(Object.keys(DICTS[l].$meta).sort(), Object.keys(DICTS.fr.$meta).sort(), l + ' : $meta');
    for (const k of ref) {
      assert.strictEqual(typeof DICTS[l][k], 'string', l + ' ' + k);
      assert.ok(DICTS[l][k].trim(), l + ' ' + k + ' : vide');
      assert.deepStrictEqual(vars(DICTS[l][k]), vars(DICTS.fr[k]), l + ' ' + k + ' : variables {…}');
    }
    const m = DICTS[l].$meta;
    assert.doesNotThrow(() => new Intl.NumberFormat(m.locale), l + ' : locale Intl');
    assert.match(m.tmdb, /^[a-z]{2}-[A-Z]{2}$/);
    assert.match(m.region, /^[A-Z]{2}$/);
  }
  /* pluriels : .one et .other vont toujours ensemble */
  for (const k of ref.filter(k => /\.(one|other)$/.test(k))) {
    const base = k.replace(/\.(one|other)$/, '');
    assert.ok(DICTS.fr[base + '.one'] && DICTS.fr[base + '.other'], base);
  }
});

test('le dictionnaire anglais est réellement traduit', () => {
  const same = keys('en').filter(k => DICTS.en[k] === DICTS.fr[k] && /[a-zà-ÿ]{4,}/i.test(DICTS.en[k]));
  /* mots identiques dans les deux langues (Contact, Plex, Anime…) seulement */
  assert.ok(same.length < 35, 'valeurs non traduites : ' + same.join(', '));
  const accents = keys('en').filter(k => /[éèêàùç]/.test(DICTS.en[k]) && !/Pokémon|Français/.test(DICTS.en[k]));
  assert.deepStrictEqual(accents, [], 'texte français dans en.js');
});

test('toutes les clés utilisées par l\'app existent (t, tn, data-i18n, data-i18n-attr)', () => {
  const fr = DICTS.fr, missing = [];
  for (const f of APP_JS) {
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of src.matchAll(/\bt\(\s*'([^'\\]+)'\s*[,)]/g)) if (!(m[1] in fr)) missing.push(f + ' : ' + m[1]);
    for (const m of src.matchAll(/\btn\(\s*'([^'\\]+)'/g)) if (!(m[1] + '.other' in fr)) missing.push(f + ' : ' + m[1] + '.other');
  }
  const html = read('index.html');
  for (const m of html.matchAll(/data-i18n="([^"]+)"/g)) if (!(m[1] in fr)) missing.push('index.html : ' + m[1]);
  for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) {
    for (const pair of m[1].split(';')) { const k = pair.split(':')[1].trim(); if (!(k in fr)) missing.push('index.html : ' + k); }
  }
  assert.deepStrictEqual(missing, []);
});

test('aucune variable locale ne s\'appelle t (elle masquerait la fonction de traduction)', () => {
  const bad = [];
  for (const f of APP_JS) {
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''");
    const checks = [
      /\b(?:var|let|const)\s+t\s*[=,;]/,
      /\b(?:var|let|const)\s+[^;]*,\s*t\s*[=,;]/,
      /\bfunction\s*[\w$]*\s*\(\s*(?:[^)]*,\s*)?t\s*[,)]/,
      /\(\s*(?:[^()]*,\s*)?t\s*(?:,[^()]*)?\)\s*=>/,
      /(?:^|[^\w$.])t\s*=>/,
      /\bcatch\s*\(\s*t\s*\)/,
    ];
    if (f === 'js/00-i18n.js') continue; /* définit t() */
    for (const re of checks) { const m = src.match(re); if (m) bad.push(f + ' : ' + m[0]); }
  }
  assert.deepStrictEqual(bad, []);
});

test('index.html charge les dictionnaires puis js/00-i18n.js, après tout le balisage traduit', () => {
  const html = read('index.html');
  const pos = s => { const i = html.indexOf(s); assert.ok(i >= 0, s); return i; };
  const foot = pos('<!--/brand:footer-->');
  const brand = pos('<script src="js/00-brand.js">');
  const i18n = pos('<script src="js/00-i18n.js">');
  assert.ok(foot < brand && brand < i18n, 'scripts après le pied de page');
  for (const l of LANGS) { const p = pos('<script src="js/i18n/' + l + '.js">'); assert.ok(brand < p && p < i18n, l); }
  assert.ok(i18n < pos('<script src="js/01-config.js">'));
  assert.ok(html.lastIndexOf('data-i18n') < i18n, 'aucun élément traduit après les scripts');
});

test('TMDB est interrogé dans la langue et le pays de l\'interface', () => {
  const api = read('js/04-tmdb-api.js').replace(/\/\*[\s\S]*?\*\//g, '') + read('js/05-render.js') + read('js/06-discovery.js') + read('js/07-add-edit.js') + read('js/08-plex.js') + read('js/19-search-modal.js');
  assert.doesNotMatch(api, /language=fr-FR/, 'langue TMDB codée en dur');
  assert.doesNotMatch(api, /results\.FR\b|\['FR'\]/, 'pays codé en dur pour les plateformes');
  assert.match(api, /TMDB_LANG/);
});

test('emails : chaque modèle se rend en français et en anglais (repli français sans langue)', { skip: spawnSync('go', ['version']).status !== 0 && 'Go absent' }, () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-'));
  const res = execFileSync('go', ['run', 'scripts/email-preview/main.go', out], { cwd: ROOT, encoding: 'utf8' });
  const lines = res.trim().split('\n');
  assert.strictEqual(lines.length, 16, '8 modèles × 2 langues');
  for (const l of ['fr', 'en']) {
    for (const f of fs.readdirSync(out).filter(f => f.startsWith(l + '-'))) {
      assert.match(fs.readFileSync(path.join(out, f), 'utf8'), new RegExp('<html lang="' + l + '"'), f);
    }
  }
  assert.match(fs.readFileSync(path.join(out, 'en-recovery.html'), 'utf8'), /Reset/);
  assert.match(fs.readFileSync(path.join(out, 'fr-recovery.html'), 'utf8'), /Réinitialise/);
});
