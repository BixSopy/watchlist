# Cinepisode — Suivi auto (extension navigateur)

Marque automatiquement ta progression (saison/épisode) dans Cinepisode pendant
que tu regardes, sans action manuelle. Même jeton que la synchro Plex/Tautulli.

Textes de l'extension en français et en anglais (`_locales/fr`, `_locales/en`, choisis par
Chrome selon la langue du navigateur, anglais par défaut). L'extension n'écrit rien dans la
console : le titre regardé n'a pas à y apparaître.

*English: automatically marks your progress (season/episode) in Cinepisode while you watch.
Install: `chrome://extensions` → Developer mode → Load unpacked → `extension/`, then paste the
token from Cinepisode (Settings › Auto-tracking (Netflix, Plex...) › Generate my token).*

## Historique et titres détectés (0.5.0)

Bouton « Ouvrir la page des titres détectés » dans la fenêtre de l'extension : une page de
l'extension (`import.html`, onglet à part) qui rassemble tout ce qui a été détecté :

- **l'historique Netflix** (« Importer mon historique Netflix ») : lu dans un onglet `netflix.com`
  de ce navigateur (ouvert en arrière-plan s'il n'y en a pas), avec ta session Netflix, profil
  actif. Endpoint `api/aui/pathEvaluator` (`["aui","viewingActivity",page,100]`), puis une fiche
  par série (`nq/website/memberapi/release/metadata`, repli `api/shakti/mre/metadata`) pour les
  numéros exacts de saison et d'épisode. Un épisode commencé mais pas fini (position connue
  < 80 %) n'est pas compté. Réimport : seuls les visionnages plus récents que le dernier import
  sont relus ;
- **le fichier CSV Netflix** (`NetflixViewingHistory.csv`, Compte › Profil › Activité de
  visionnage › « Télécharger tout »), lu dans la page : formats français et anglais
  (« Série : Saison 2 : Titre », « Show: Season 2: Title », « Série limitée », « Partie 2 »...).
  Le CSV ne donne pas les numéros d'épisode : on compte les épisodes différents vus dans la
  saison la plus avancée (affiché « ≈ ») ;
- **les détections en direct** restées sans correspondance (« Pas dans ta liste », « Plusieurs
  titres ») : gardées localement (`wlLive`, 200 au plus) par le service worker.

Chaque titre apparaît une seule fois (clé = titre normalisé + film/série, quelle que soit la
source), avec des filtres « Nouveaux », « Mises à jour », « Ambigus », « Déjà à jour », des cases à
cocher, « Tout sélectionner », « Ignorer » (définitif) et « Appliquer la sélection ».

- **Mise à jour** : le titre est dans ta liste (même correspondance exacte que
  `mark_watched_by_title`, ou même fiche TMDB) et la progression avance : coché par défaut.
- **Nouveau** : absent de ta liste ; son nom est cherché sur TMDB via le proxy de cinepisode.com
  (jeton dans l'en-tête `X-Cinepisode-Token`, même quota quotidien que le site). Coché par défaut
  seulement si une fiche ressort sans ambiguïté ; sinon une liste déroulante propose les
  candidats. Série ajoutée « en cours » au dernier épisode vu, ou « terminée » si c'est le dernier
  épisode d'une série finie (d'après TMDB) ; film ajouté « terminé ». Mêmes champs qu'un ajout
  manuel (fiche TMDB, affiche, année, note, résumé, genre anime).
- **Ambigu** : plusieurs titres de ta liste portent ce nom (tu choisis lequel), ou plusieurs
  fiches TMDB possibles.

**Rien n'est écrit dans Cinepisode avant le clic sur « Appliquer »**, qui appelle
`extension_apply_import()` (migration `20261008150000_import_historique.sql`) avec seulement les
lignes cochées. Les titres ajoutés ou mis à jour apparaissent dans l'app à la synchronisation
suivante (30 s maximum).

Vie privée : l'historique Netflix (dates, liste complète) reste dans ce navigateur
(`chrome.storage.local`, clés `wlDetected`, `wlImportMeta`). Partent du navigateur : la lecture de
ta liste (jeton), le **nom** des titres absents de ta liste (recherche TMDB via cinepisode.com),
et, au clic sur « Appliquer », les changements cochés.

### Permissions (0.5.0)

| Permission | Pourquoi |
|---|---|
| `storage` | jeton, dernière détection, titres détectés (local) |
| `scripting` | lire l'historique dans l'onglet `netflix.com` (requêtes même origine, au clic seulement) |
| `https://www.netflix.com/*` | idem (avant : seulement `netflix.com/watch/*` pour la détection en direct) |
| `https://cinepisode.com/*` | recherche TMDB des titres absents de la liste, via le proxy du site (clé TMDB côté serveur) |
| `https://batfulcvvquffgfeppcx.supabase.co/*` | inchangé : lecture de la liste et enregistrement |

Pas de permission `tabs`, `history` ni `cookies`. Pages de l'extension sous CSP stricte
(`script-src 'self'`, `connect-src` limité à Supabase et cinepisode.com, `img-src` à
image.tmdb.org), aucun script en ligne, aucun `innerHTML`.

### Crédit

La façon de lire l'historique Netflix (endpoint `aui/pathEvaluator`, structure des éléments,
adresses des fiches) s'inspire de [Universal Trakt Scrobbler](https://github.com/trakt-tools/universal-trakt-scrobbler)
(`src/services/netflix/NetflixApi.ts`). Le code de `lib/import.js` est réécrit pour Cinepisode.

> MIT License — Copyright (c) 2020 trakt-tools
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software
> and associated documentation files (the "Software"), to deal in the Software without
> restriction, including without limitation the rights to use, copy, modify, merge, publish,
> distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
> Software is furnished to do so, subject to the following conditions: The above copyright notice
> and this permission notice shall be included in all copies or substantial portions of the
> Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
> INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE
> AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
> DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Polices : IBM Plex Sans (SIL Open Font License, `fonts/OFL-ibm-plex.txt`), comme sur le site.

## Couverture par plateforme

| Plateforme | État |
|---|---|
| Netflix | **Fonctionnel**, vérifié sur un vrai compte (saison/épisode via `netflix.falcorCache`, titre via `[data-uia="video-title"]`) |
| Prime Video, Disney+, Max, Crunchyroll | Pas encore pris en charge |

Les scripts de diagnostic (exploration de la page dans la console, `content/diagnostic*.js` et les
scripts « diagnostic seulement » de Prime Video, Disney+, Max et Crunchyroll) ont été retirés en
version 0.3.0 : l'extension ne s'exécute plus que sur `netflix.com/watch/*`. Ils restent dans
l'historique git si une nouvelle plateforme doit être étudiée.

## Quand un titre est marqué vu (0.4.0)

Plus jamais au simple lancement d'un épisode :

- **épisode** : à **80 %** de sa durée, ou dès que Netflix affiche le générique de fin / le
  bouton « Épisode suivant » (seulement après 50 %, pour ne pas confondre avec la transition
  vers l'épisode suivant) ;
- **film** : à **90 %**, ou au générique de fin après 80 % ;
- dans tous les cas après au moins 20 secondes de lecture réellement observée sur cette vidéo
  (un saut dans la barre de progression ne compte pas). Un épisode suivant lancé
  automatiquement puis arrêté au bout de quelques secondes n'est donc pas marqué.

Les sélecteurs du générique de fin (`next-episode-seamless-button`, `watch-credits-seamless-button`,
`postplay`) sont un bonus : s'ils changent côté Netflix, le seuil de 80 % suffit.

## Fenêtre de l'extension : dernière détection

Un clic sur l'icône affiche la dernière détection et la réponse du serveur, en clair :
« Mis à jour : Dark S2E3 », « Déjà à jour : Dark S2E3 », « Pas dans ta liste : X »,
« Plusieurs titres correspondent à « Lupin », rien modifié », « Jeton invalide »,
« Aucun jeton enregistré », « Cinepisode injoignable »... Ce résultat est gardé dans
`chrome.storage.local` (clé `wlLast`, sans le jeton) et effacé quand un nouveau jeton est enregistré.

## Sécurité des messages

`content/netflix-main.js` (monde MAIN, accès à `window.netflix`) envoie la détection à
`content/netflix-bridge.js` (monde isolé) par `window.postMessage`, adressé à l'origine exacte de
la page (jamais `'*'`). Le relai n'accepte que les messages de la même fenêtre (`event.source`),
de l'origine `https://www.netflix.com` (`event.origin`) et de la forme exacte attendue (type
`episode` ou `movie`, titre texte de 300 caractères maximum, saison et épisode entiers pour un
épisode, vides pour un film). Le service worker revérifie
l'expéditeur (cette extension, onglet Netflix) et la forme avant d'appeler Supabase.

## Installation (Chrome / Edge / Brave)

1. `chrome://extensions`
2. Active le **Mode développeur** (coin supérieur droit)
3. **Charger l'extension non empaquetée** → sélectionne le dossier `extension/`
4. Clique sur l'icône de l'extension → colle le jeton généré depuis l'app
   (Réglages › Suivi auto (Netflix, Plex...) › Générer mon jeton)

## Vérifier Netflix

1. Lance un épisode d'une série de ta watchlist sur Netflix (`netflix.com/watch/...`)
2. Regarde-le jusqu'à 80 % (ou jusqu'au générique de fin) : la fenêtre de l'extension affiche
   « Mis à jour : Titre S1E3 », et la saison et l'épisode se mettent à jour dans Cinepisode
   (à la prochaine synchronisation, 30 s maximum)

## Pourquoi pas de clé TMDB ni de login dans l'extension

La correspondance se fait par **titre** (`mark_watched_by_title` côté Supabase, bornée à
ta propre watchlist) plutôt que par tmdb_id — ça évite d'exposer une clé API ou de gérer
une session de connexion dans l'extension.

Depuis la migration `20261008120000_mark_watched_fiable.sql`, la comparaison est **exacte après
normalisation** : majuscules, accents, ponctuation, article de tête (the, le, la, les, l') et
année entre parenthèses en fin de titre sont ignorés (« L’Odyssée (2021) » = « odyssee »), mais
plus aucune correspondance partielle (« Grown Ups » ne touche plus le film « Up »). Un épisode
ne modifie qu'une série ou un anime, un film qu'un film. Si plusieurs titres correspondent, rien
n'est modifié. La progression ne recule jamais (revoir un ancien épisode ne change rien).

Compatibilité : l'extension 0.3.0 continue de fonctionner avec la nouvelle fonction, et la 0.4.0
fonctionne aussi avec l'ancienne (elle réessaie sans `p_type`, et affiche alors un résultat
simplifié).
