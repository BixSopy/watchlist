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
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist-site');
const FILES = ['index.html', 'conditions.html', 'confidentialite.html', 'privacy.html', 'terms.html', 'robots.txt', 'sitemap.xml', 'manifest.json', 'sw.js'];
const DIRS = ['js', 'css', 'landing', 'fonts', 'icons', 'sounds', 'og', 'vendor', 'experience'];
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
/* Empreinte de contenu : chaque <script src> / <link href> local d'une page HTML publiée reçoit
   ?v=<10 premiers caractères du SHA-256 du fichier publié>. Ces URL changent à chaque modification du
   fichier, d'où un cache immuable d'un an côté navigateur (vercel.json : seulement pour les requêtes
   qui portent ?v=) et côté service worker (sw.js). /vendor/ a déjà sa version dans le nom et son SRI. */
const VERSIONED = /^\/?(js|css|landing|fonts)\/[^?#"]+\.(js|css)$/;
function fingerprint(html) {
  return html.replace(/(<(?:script|link)\b[^>]*?\s(?:src|href)=")([^"]+)(")/g, (all, a, url, z) => {
    if (!VERSIONED.test(url)) return all;
    const file = path.join(OUT, url.replace(/^\//, ''));
    if (!fs.existsSync(file)) return all;
    const v = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 10);
    return a + url + '?v=' + v + z;
  });
}

fs.rmSync(OUT, {recursive: true, force: true});
for (const f of FILES) emit(f);
for (const d of DIRS) walk(d);
let versioned = 0;
for (const f of FILES.filter(f => f.endsWith('.html'))) {
  const p = path.join(OUT, f), before = fs.readFileSync(p, 'utf8'), after = fingerprint(before);
  versioned += (after.match(/\?v=[0-9a-f]{10}"/g) || []).length;
  if (after !== before) fs.writeFileSync(p, after);
}
console.log('[build-static] empreintes : ' + versioned + ' références ?v= dans les pages');
for (const k of ['js', 'css']) {
  const [n, a, b] = stats[k];
  console.log('[build-static] ' + k + ' : ' + n + ' fichiers minifiés, ' + a + ' → ' + b + ' octets');
}
