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
/* clés sans catégorie plurielle : fr/en ont .one/.other, ru .one/.few/.many/.other, ar 6 catégories, zh seulement .other */
const PLURAL_RE = /\.(zero|one|two|few|many|other)$/;
const baseKeys = l => [...new Set(keys(l).map(k => k.replace(PLURAL_RE, '')))].sort();
const CATS = l => new Intl.PluralRules(DICTS[l].$meta.locale).resolvedOptions().pluralCategories;
const vars = s => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
/* formes plurielles : {n} peut figurer (ru/ar/hi : « {n} … » exigé dans toutes les formes) même si la source française n'en a pas */
const varsPl = (k, s) => PLURAL_RE.test(k) ? vars(s).filter(v => v !== 'n') : vars(s);
const APP_JS = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f);

test('10 langues (les plus parlées), chacune déclarée dans son propre fichier', () => {
  assert.deepStrictEqual(LANGS, ['ar', 'bn', 'en', 'es', 'fr', 'hi', 'pt', 'ru', 'ur', 'zh']);
  for (const l of LANGS) assert.ok(DICTS[l], l);
});

test('mêmes clés, mêmes variables et mêmes métadonnées dans chaque langue', () => {
  const ref = keys('fr');
  assert.ok(ref.length > 300, 'dictionnaire complet');
  const refBase = baseKeys('fr');
  for (const l of LANGS) {
    assert.deepStrictEqual(baseKeys(l), refBase, l + ' : clés différentes du français');
    assert.deepStrictEqual(Object.keys(DICTS[l].$meta).sort(), Object.keys(DICTS.fr.$meta).sort(), l + ' : $meta');
    for (const k of keys(l)) {
      assert.strictEqual(typeof DICTS[l][k], 'string', l + ' ' + k);
      assert.ok(DICTS[l][k].trim(), l + ' ' + k + ' : vide');
      const frKey = PLURAL_RE.test(k) && !(k in DICTS.fr) ? k.replace(PLURAL_RE, '.other') : k;
      assert.deepStrictEqual(varsPl(k, DICTS[l][k]), varsPl(k, DICTS.fr[frKey]), l + ' ' + k + ' : variables {…}');
    }
    const m = DICTS[l].$meta;
    assert.doesNotThrow(() => new Intl.NumberFormat(m.locale), l + ' : locale Intl');
    assert.match(m.tmdb, /^[a-z]{2}-[A-Z]{2}$/);
    assert.match(m.region, /^[A-Z]{2}$/);
    assert.match(m.dir, /^(ltr|rtl)$/);
    assert.ok(Number.isInteger(m.rank), l + ' : rank');
    assert.match(m.justwatch, /^https:\/\/www\.justwatch\.com\/[a-z]{2}\/[^/]+\?q=$/, l + ' : justwatch');
  }
  assert.deepStrictEqual(LANGS.filter(l => DICTS[l].$meta.dir === 'rtl'), ['ar', 'ur']);
  assert.strictEqual(new Set(LANGS.map(l => DICTS[l].$meta.rank)).size, LANGS.length, 'rangs uniques');
  /* pluriels : toutes les catégories de la langue (Intl.PluralRules), 'other' toujours ; many facultatif en es/pt/fr */
  const optional = new Set(['many']);
  for (const l of LANGS) {
    const bases = [...new Set(keys(l).filter(k => PLURAL_RE.test(k)).map(k => k.replace(PLURAL_RE, '')))];
    assert.strictEqual(bases.length, [...new Set(keys('fr').filter(k => PLURAL_RE.test(k)).map(k => k.replace(PLURAL_RE, '')))].length, l + ' : groupes pluriels');
    const want = CATS(l).filter(c => !(optional.has(c) && ['es', 'pt', 'fr', 'en'].includes(l)));
    for (const b of bases) assert.deepStrictEqual(want.filter(c => !((b + '.' + c) in DICTS[l])), [], l + ' ' + b + ' : catégories plurielles manquantes');
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

test('index.html : le chargeur de langues (synchrone) précède js/00-i18n.js, après tout le balisage traduit', () => {
  const html = read('index.html');
  const pos = s => { const i = html.indexOf(s); assert.ok(i >= 0, s); return i; };
  const foot = pos('<!--/brand:footer-->');
  const brand = pos('<script defer src="js/00-brand.js">');
  const loader = pos('<script src="js/00-i18n-load.js"></script>');
  const i18n = pos('<script defer src="js/00-i18n.js">');
  assert.ok(foot < brand && brand < loader && loader < i18n);
  assert.doesNotMatch(html, /src="js\/i18n\/[a-z]{2}\.js"/, 'plus aucun dictionnaire chargé en dur');
  assert.ok(i18n < pos('<script defer src="js/01-config.js">'));
  assert.ok(html.lastIndexOf('data-i18n') < i18n, 'aucun élément traduit après les scripts');
});

/* Exécute le chargeur dans un faux navigateur : renvoie la langue choisie et les dictionnaires écrits */
function runLoader({ search = '', pathname = '/', saved = null, langs = ['fr-FR'] } = {}) {
  const store = saved ? { wl_lang: saved } : {};
  let written = '';
  const ctx = { URLSearchParams, location: { search, pathname }, navigator: { languages: langs },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } },
    document: { write: s => { written += s; } } };
  vm.createContext(ctx);
  vm.runInContext(read('js/00-i18n-load.js') + '\nthis.__lang=LANG;this.__langs=I18N_LANGS;', ctx);
  return { lang: ctx.__lang, langs: JSON.parse(JSON.stringify(ctx.__langs)), files: [...written.matchAll(/src="js\/i18n\/([a-z]{2})\.js"/g)].map(m => m[1]), store };
}

test('chargeur : liste des langues = $meta de chaque dictionnaire (nom, ordre, sens)', () => {
  const { langs } = runLoader();
  assert.deepStrictEqual(Object.keys(langs).sort(), LANGS);
  for (const l of LANGS) {
    const m = DICTS[l].$meta;
    assert.deepStrictEqual(langs[l], { name: m.name, rank: m.rank || 99, dir: m.dir === 'rtl' ? 'rtl' : 'ltr' }, l);
  }
});

test('chargeur : même règle de choix qu\'avant, et seulement la langue active + anglais + français', () => {
  assert.strictEqual(runLoader({ langs: ['fr-FR'] }).lang, 'fr');
  assert.deepStrictEqual(runLoader({ langs: ['fr-FR'] }).files, ['fr', 'en']);
  assert.deepStrictEqual(runLoader({ langs: ['en-US'] }).files, ['en', 'fr']);
  const ru = runLoader({ langs: ['ru-RU', 'fr'] });
  assert.strictEqual(ru.lang, 'ru');
  assert.deepStrictEqual(ru.files, ['ru', 'en', 'fr']);
  assert.strictEqual(runLoader({ langs: ['xx', 'de-DE'] }).lang, 'en', 'langue inconnue : anglais');
  assert.strictEqual(runLoader({ saved: 'zh', langs: ['fr'] }).lang, 'zh', 'choix enregistré avant le navigateur');
  const forced = runLoader({ search: '?lang=ar', saved: 'zh' });
  assert.strictEqual(forced.lang, 'ar', '?lang= avant le choix enregistré');
  assert.strictEqual(forced.store.wl_lang, 'ar', 'et mémorisé');
  assert.strictEqual(runLoader({ pathname: '/en', langs: ['fr'] }).lang, 'en', '/en dans l\'adresse');
});

test('TMDB est interrogé dans la langue et le pays de l\'interface', () => {
  const api = read('js/04-tmdb-api.js').replace(/\/\*[\s\S]*?\*\//g, '') + read('js/05-render.js') + read('js/06-discovery.js') + read('js/07-add-edit.js') + read('js/08-plex.js') + read('js/19-search-modal.js');
  assert.doesNotMatch(api, /language=fr-FR/, 'langue TMDB codée en dur');
  assert.doesNotMatch(api, /results\.FR\b|\['FR'\]/, 'pays codé en dur pour les plateformes');
  assert.match(api, /TMDB_LANG/);
});

test('emails : chaque modèle se rend dans les 10 langues (repli français sans langue)', { skip: spawnSync('go', ['version']).status !== 0 && 'Go absent' }, () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-'));
  const res = execFileSync('go', ['run', 'scripts/email-preview/main.go', out], { cwd: ROOT, encoding: 'utf8' });
  const lines = res.trim().split('\n');
  assert.strictEqual(lines.length, 80, '8 modèles × 10 langues');
  for (const l of LANGS) {
    for (const f of fs.readdirSync(out).filter(f => f.startsWith(l + '-'))) {
      assert.match(fs.readFileSync(path.join(out, f), 'utf8'), new RegExp('<html lang="' + l + '" dir="' + (['ar', 'ur'].includes(l) ? 'rtl' : 'ltr') + '"'), f);
    }
  }
  assert.match(fs.readFileSync(path.join(out, 'en-recovery.html'), 'utf8'), /Reset/);
  assert.match(fs.readFileSync(path.join(out, 'fr-recovery.html'), 'utf8'), /Réinitialise/);
});

/* Moteur dans une langue donnée : pluriels à 4 ou 6 formes, sens de lecture, isolation bidi */
function engine(lang) {
  const attrs = {};
  const ctx = {
    window: {}, console, URLSearchParams, Intl, Object, JSON, String, Number, Math, Date, Array,
    location: { search: '?lang=' + lang, pathname: '/', href: 'http://x/?lang=' + lang },
    localStorage: { getItem: () => null, setItem() {} }, sessionStorage: { getItem: () => null, setItem() {} },
    navigator: { languages: [lang], language: lang },
    BRAND: { legal: {}, defaultLang: 'fr', baseUrl: 'http://x', name: 'Cinepisode' },
    esc: s => String(s),
    document: { documentElement: { set lang(v) { attrs.lang = v; }, set dir(v) { attrs.dir = v; } }, querySelector: () => null, querySelectorAll: () => [], write() {} },
  };
  vm.createContext(ctx);
  vm.runInContext(read('js/00-i18n-load.js'), ctx);
  for (const l of LANGS) vm.runInContext(read('js/i18n/' + l + '.js'), ctx);
  vm.runInContext(read('js/00-i18n.js') + '\nthis.__t=t;this.__tn=tn;this.__rtl=IS_RTL;', ctx);
  return { t: ctx.__t, tn: ctx.__tn, rtl: ctx.__rtl, attrs };
}
test('pluriels : russe (one/few/many), arabe (zero…other), chinois (other seul)', () => {
  const k = 'gd.shows'; /* « {n} série(s) » */
  assert.ok(('gd.shows.one' in DICTS.fr) && ('gd.shows.many' in DICTS.ru) && ('gd.shows.zero' in DICTS.ar) && !('gd.shows.one' in DICTS.zh));
  const ru = engine('ru'), ar = engine('ar'), zh = engine('zh'), fr = engine('fr');
  for (const n of [0, 1, 2, 3, 5, 11, 21, 22, 25, 100, 101]) {
    for (const e of [ru, ar, zh, fr]) assert.ok(!e.tn(k, n).includes('{'), 'variable restante pour n=' + n);
  }
  assert.notStrictEqual(ru.tn(k, 1), ru.tn(k, 2));
  assert.notStrictEqual(ru.tn(k, 2), ru.tn(k, 5));
  assert.strictEqual(ru.tn(k, 21), ru.tn(k, 1).replace('1', '21'), 'ru : 21 prend la forme de 1');
  assert.notStrictEqual(ar.tn(k, 2), ar.tn(k, 3));
  assert.notStrictEqual(ar.tn(k, 3), ar.tn(k, 11));
});
test('sens de lecture : dir="rtl" pour l\'arabe et l\'ourdou seulement, titres isolés en RTL', () => {
  for (const l of LANGS) {
    const e = engine(l);
    assert.strictEqual(e.attrs.lang, l);
    assert.strictEqual(e.attrs.dir, ['ar', 'ur'].includes(l) ? 'rtl' : 'ltr', l);
    assert.strictEqual(e.rtl, ['ar', 'ur'].includes(l));
  }
  const key = Object.keys(DICTS.fr).find(k => /\{title\}/.test(DICTS.fr[k]) && !/<|href/.test(DICTS.fr[k]));
  assert.match(engine('ar').t(key, { title: 'Dune' }), /⁨Dune⁩/, 'FSI/PDI autour du titre latin en RTL');
  assert.doesNotMatch(engine('fr').t(key, { title: 'Dune' }), /⁨/, 'aucun caractère bidi en LTR');
});
test('aucun caractère de contrôle bidi ni chiffres non latins dans les dictionnaires', () => {
  const bad = [];
  for (const l of LANGS) for (const k of keys(l)) {
    const v = DICTS[l][k];
    if (/[‎‏‪-‮⁦-⁩]/.test(v)) bad.push(l + ' ' + k + ' : bidi');
    if (/[٠-٩۰-۹০-৯०-९]/.test(v)) bad.push(l + ' ' + k + ' : chiffres non latins');
  }
  assert.deepStrictEqual(bad, []);
});
