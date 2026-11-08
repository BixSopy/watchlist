/* Sens de lecture RTL (arabe, ourdou) et textes non latins : utilitaires de js/03-dom-utils.js,
   carrousel « En cours » (js/25-home.js) et normalisation des titres détectés (js/21-detected.js).
   En LTR, chaque utilitaire doit rendre exactement la valeur d'avant. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

function utils(rtl, locale) {
  const ctx = { IS_RTL: rtl, LOCALE: locale || 'fr-FR', Intl, getComputedStyle: () => ({ direction: rtl ? 'rtl' : 'ltr' }) };
  vm.createContext(ctx);
  vm.runInContext(read('js/03-dom-utils.js'), ctx);
  return ctx;
}
const oldSlug = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

test('LTR : signe, flèches et texte inchangés', () => {
  const U = utils(false);
  assert.strictEqual(U.hScrollSign(), 1);
  assert.deepStrictEqual([U.arrowFwd(), U.arrowBack(), U.chevFwd(), U.chevBack()], ['→', '←', '›', '‹']);
  assert.strictEqual(U.bidiIso('What If...?'), 'What If...?');
  const el = { scrollWidth: 1000, clientWidth: 300, scrollLeft: 120 };
  assert.deepStrictEqual(Array.from(U.hScrollBounds(el)), [0, 700]);
  assert.strictEqual(U.hScrollPos(el), 120);
});

test('RTL : sens miroir, scrollLeft dans [−max, 0], titres isolés (FSI…PDI)', () => {
  const U = utils(true, 'ar');
  assert.strictEqual(U.hScrollSign(), -1);
  assert.deepStrictEqual([U.arrowFwd(), U.arrowBack(), U.chevFwd(), U.chevBack()], ['←', '→', '›', '‹']);
  assert.strictEqual(U.bidiIso('What If...?'), '⁨What If...?⁩');
  assert.strictEqual(U.bidiIso(''), '');
  const el = { scrollWidth: 1000, clientWidth: 300, scrollLeft: -450 };
  assert.deepStrictEqual(Array.from(U.hScrollBounds(el)), [-700, 0]);
  assert.strictEqual(U.hScrollPos(el), 450);
});

test('slugKey : identique à l’ancienne clé pour les titres latins, non vide pour les autres écritures', () => {
  const U = utils(false);
  for (const s of ['Harry Potter', 'Astérix', 'Le Seigneur des Anneaux – Collection', '  Fast & Furious  ', 'Ça (It)', 'X²', 'Ñandú 2', 'Mission: Impossible', '-abc-', 'Ｘ１'])
    assert.strictEqual(U.slugKey(s), oldSlug(s), s);
  const keys = ['Гарри Поттер', 'Голодные игры', 'هاري بوتر', 'ہیری پوٹر', '哈利·波特', '饥饿游戏', 'हैरी पॉटर', 'হ্যারি পটার', 'ハリー・ポッター'].map(U.slugKey);
  keys.forEach(k => assert.ok(k.length > 0, 'clé vide'));
  assert.strictEqual(new Set(keys).size, keys.length, 'aucune collision');
  assert.strictEqual(U.slugKey('Гарри Поттер'), 'гарри-поттер');
  assert.strictEqual(U.slugKey('哈利·波特'), '哈利-波特');
});

test('strCut : ne coupe ni un emoji ni une syllabe ; textCompare suit la langue de l’interface', () => {
  const U = utils(false);
  assert.strictEqual(U.strCut('abc', 20), 'abc');
  assert.strictEqual(U.strCut('😀😀😀', 2), '😀😀');
  assert.ok(!/[\uD800-\uDBFF]$/.test(U.strCut('a😀b', 2)));
  assert.strictEqual(U.strCut('नमस्ते', 2), 'नम');
  const fr = ['éclair', 'Zorro', 'abeille', 'Été'].sort(U.textCompare);
  assert.deepStrictEqual(fr, ['abeille', 'éclair', 'Été', 'Zorro']);
  const ru = utils(false, 'ru-RU');
  assert.deepStrictEqual(['Ёлки', 'Яблоко', 'Анна', 'Жизнь'].sort(ru.textCompare), ['Анна', 'Ёлки', 'Жизнь', 'Яблоко']);
});

test('carrousel « En cours » : suivant à droite en LTR, à gauche en RTL', () => {
  for (const [rtl, want] of [[false, 1], [true, -1]]) {
    const ctx = { IS_RTL: rtl, module: { exports: {} }, window: { addEventListener() {} }, document: { getElementById: () => null, querySelector: () => null, addEventListener() {} } };
    vm.createContext(ctx);
    vm.runInContext(read('js/25-home.js'), ctx);
    assert.strictEqual(ctx._cfDir(), want);
  }
  const src = read('js/25-home.js');
  assert.match(src, /if\(k==='ArrowRight'\)\{cfGo\(_heroIdx\+_cfDir\(\)\)/);
  assert.match(src, /rotateY\('\+\(-R\*s\*48\)\+'deg\)/);
});

test('titres détectés : la normalisation garde les écritures non latines (pas de clé vide)', () => {
  const D = require('../js/21-detected.js');
  const titles = ['Тьма', 'Игра в кальмара', 'الهيبة', 'تیرا', '鱿鱼游戏', '三体', 'पंचायत', 'মির্জাপুর'];
  const norm = titles.map(D.normalizeTitle);
  norm.forEach((n, i) => assert.ok(n && n.length > 0, titles[i]));
  assert.strictEqual(new Set(norm).size, titles.length);
  assert.strictEqual(D.normalizeTitle('Игра в кальмара (2021)'), 'игра в кальмара');
  assert.strictEqual(D.normalizeTitle('Stranger Things'), 'stranger things');
});
