#!/usr/bin/env node
/* Build de déploiement (Vercel : buildCommand de vercel.json) — SEULE étape de build du projet.
   Copie les fichiers statiques du site dans dist-site/ (outputDirectory) en minifiant les scripts
   (js/, js/i18n/) et les feuilles de style (css/app.css, landing/landing.css) avec esbuild.
   Les sources restent lisibles et inchangées dans le dépôt : les tests et le développement local
   (npx vercel dev, serveur statique) continuent de servir les fichiers non minifiés.

   Choix de prudence :
   - minification SANS renommage des identifiants (espaces, commentaires, syntaxe seulement) : les scripts
     sont des scripts classiques qui partagent leurs fonctions par l'espace global (et des gestionnaires
     onclick=""), renommer casserait tout. Le gain d'un renommage local n'est que de ~3 % du poids.
   - /vendor/ n'est jamais modifié (intégrité SRI dans index.html).
   - un fichier qui ne se minifie pas, ou ressort plus gros, est copié tel quel (jamais de déploiement cassé).
   - esbuild absent : tout est copié tel quel, avec un avertissement clair dans le journal de build. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist-site');
const FILES = ['index.html', 'conditions.html', 'confidentialite.html', 'privacy.html', 'terms.html', 'robots.txt', 'sitemap.xml', 'manifest.json', 'sw.js'];
const DIRS = ['js', 'css', 'landing', 'fonts', 'icons', 'sounds', 'og', 'vendor'];
const MIN = {js: /^js\/(i18n\/)?[^/]+\.js$/, css: /^(css\/app|landing\/landing)\.css$/};

let esbuild = null;
try { esbuild = await import('esbuild'); } catch (e) { console.warn('[build-static] ATTENTION : esbuild introuvable, fichiers copiés SANS minification (' + e.message + ')'); }

const stats = {js: [0, 0, 0], css: [0, 0, 0]};
function emit(rel) {
  const src = path.join(ROOT, rel), dst = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(dst), {recursive: true});
  const kind = MIN.js.test(rel) ? 'js' : MIN.css.test(rel) ? 'css' : null;
  if (kind && esbuild) {
    try {
      const code = fs.readFileSync(src, 'utf8');
      const out = esbuild.transformSync(code, {loader: kind, minifyWhitespace: true, minifySyntax: true, legalComments: 'none'}).code;
      if (out.length < code.length) {
        fs.writeFileSync(dst, out);
        stats[kind][0]++; stats[kind][1] += Buffer.byteLength(code); stats[kind][2] += Buffer.byteLength(out);
        return;
      }
    } catch (e) { console.warn('[build-static] ' + rel + ' non minifié : ' + e.message); }
  }
  fs.copyFileSync(src, dst);
}
function walk(dir) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), {withFileTypes: true})) {
    const rel = dir + '/' + e.name;
    if (e.isDirectory()) walk(rel); else emit(rel);
  }
}
fs.rmSync(OUT, {recursive: true, force: true});
for (const f of FILES) emit(f);
for (const d of DIRS) walk(d);
for (const k of ['js', 'css']) {
  const [n, a, b] = stats[k];
  console.log('[build-static] ' + k + ' : ' + n + ' fichiers minifiés, ' + a + ' → ' + b + ' octets');
}
