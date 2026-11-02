/* Fenêtre Ajouter / Modifier (fiche « A ») : structure, autosave en édition, toast « Annuler » */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('fiche : champs historiques gardés (mêmes id) pour les autres modules', () => {
  const html = read('index.html');
  ['addMbk', 'mtitle', 'tinput', 'tdd', 'sprev', 'spimg', 'sptitle', 'spmeta', 'ftype', 'fstat', 'fanimegenre', 'agField', 'ept', 'fsai', 'fepi', 'ftotep', 'stars', 'ftmdb', 'fyear', 'tagsWrap', 'fsaga', 'sagaSuggest', 'sbtn'].forEach((id) => {
    assert.ok(html.includes('id="' + id + '"'), 'id manquant : ' + id);
  });
  assert.match(html, /id="ftype" value="film"/);
  assert.match(html, /data-st="avoir"[\s\S]*data-st="encours"[\s\S]*data-st="termine"/);
  assert.match(html, /class="fx-tmdb"[\s\S]{0,200}tmdb-logo\.svg/, 'attribution TMDB sur la fiche');
});

test('fiche : plus de style.display sur le genre anime (section repliable .on)', () => {
  assert.doesNotMatch(read('js/07-add-edit.js'), /agField'\)\.style\.display/);
  assert.doesNotMatch(read('js/12-folders.js'), /agField'\)\.style\.display/);
});

test('édition : autosave différé, sans son, toast avec bouton Annuler à la fermeture', () => {
  const js = read('js/07-add-edit.js');
  const auto = js.slice(js.indexOf('function _ficheAutosave'), js.indexOf('function _ficheUndo'));
  assert.ok(auto.includes('dbPut(entry,null)'));
  assert.doesNotMatch(auto, /sfx\(/, "pas de son à chaque enregistrement");
  assert.match(js, /_fx\.timer=setTimeout\(_ficheAutosave,400\)/);
  assert.match(js, /function closeAdd\(\)\{_ficheFinish\(\);/);
  assert.match(js, /toast\(t\('add\.updated',\{title:entry\.title\}\),'ok',\{label:t\('common\.cancel'\),fn:/);
  assert.match(js, /if\(editId\)\{sfx\('close'\);closeAdd\(\);return;\}/, 'Terminé ferme simplement');
});

test('note : une étoile sur « À voir » passe en « Terminé »', () => {
  const js = read('js/07-add-edit.js');
  assert.match(js, /if\(v&&_fxEl\('fstat'\)\.value==='avoir'\)\{setSelVal\('fstat','termine'\);_fxHint\(t\('add\.autoDone'\),true\);\}/);
});

test('toast : bouton d\'action facultatif, affiché plus longtemps', () => {
  const js = read('js/03-dom-utils.js');
  assert.match(js, /var act=arguments\[2\];/);
  assert.match(js, /act\?6000:2800/);
});

test('mobile : la fiche est une feuille ancrée en bas', () => {
  const html = read('index.html');
  assert.match(html, /#addMbk\.mbk\{align-items:flex-end;padding:0\}/);
  assert.match(html, /border-radius:24px 24px 0 0/);
});
