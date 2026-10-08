# Cinepisode — Suivi auto (extension navigateur)

Marque automatiquement ta progression (saison/épisode) dans Cinepisode pendant
que tu regardes, sans action manuelle. Même jeton que la synchro Plex/Tautulli.

Textes de l'extension en français et en anglais (`_locales/fr`, `_locales/en`, choisis par
Chrome selon la langue du navigateur, anglais par défaut). L'extension n'écrit rien dans la
console : le titre regardé n'a pas à y apparaître.

*English: automatically marks your progress (season/episode) in Cinepisode while you watch.
Install: `chrome://extensions` → Developer mode → Load unpacked → `extension/`, then paste the
token from Cinepisode (Settings › Auto-tracking (Netflix, Plex...) › Generate my token).*

## Historique et onglet « Détectés » (0.5.0)

L'extension **ne fait que détecter et envoyer** ; le tri se fait dans Cinepisode, onglet
« Détectés » (`https://cinepisode.com/#detectes`, `js/21-detected.js`). Dans la fenêtre de
l'extension (section « Historique ») :

- **« Importer mon historique Netflix »** : lu par le service worker dans un onglet `netflix.com`
  de ce navigateur (ouvert en arrière-plan s'il n'y en a pas), avec ta session Netflix, profil
  actif. Endpoint `api/aui/pathEvaluator` (`["aui","viewingActivity",page,100]`), puis une fiche
  par série (`nq/website/memberapi/release/metadata`, repli `api/shakti/mre/metadata`) pour les
  numéros exacts de saison et d'épisode. Réimport : seuls les visionnages plus récents que le
  dernier import (moins 3 jours) sont relus. La progression s'affiche dans la fenêtre (elle
  peut être fermée pendant l'import) ;
- **« Importer le fichier CSV Netflix »** (`NetflixViewingHistory.csv`, Compte › Profil ›
  Activité de visionnage › « Télécharger tout »), 20 Mo au plus : formats français et anglais
  (« Série : Saison 2 : Titre », « Show: Season 2: Title », « Série limitée », « Partie 2 »...).
  Le CSV ne donne pas les numéros d'épisode : on compte les épisodes différents vus dans la saison
  la plus avancée (affiché « ≈ » dans l'onglet). Depuis la petite fenêtre, le choix du fichier
  ouvre la page de l'extension dans un onglet (la fenêtre se fermerait pendant le choix) ;
- **les détections en direct** restées sans correspondance (« Pas dans ta liste », « Plusieurs
  titres ») sont envoyées de la même façon (source `live`).

Envoi : RPC `extension_push_detections(p_token, p_items)` (migration
`20261008160000_titres_detectes.sql`), par lots de 1 000. **Une ligne par titre** (épisode le
plus avancé), avec seulement : source (`netflix`, `netflix_csv`, `live`, `crunchyroll`, `prime`), titre, film/série, saison, épisode, date du visionnage, pourcentage vu. Aucun identifiant
Netflix, aucun nom de profil. Le serveur normalise le titre, dédoublonne (même titre + saison +
épisode : le visionnage le plus récent gagne) et garde « Ignoré » définitif pour ce titre.
L'onglet « Détectés » s'ouvre à la fin si quelque chose de nouveau est arrivé.

Dans l'onglet « Détectés » (connecté, session Supabase, RLS) : un groupe par titre (toutes
sources), filtres « Nouveaux », « Mises à jour », « Ambigus », cases à cocher, « Tout
sélectionner », « Ajouter la sélection », « Tout ajouter », « Ignorer », « Tout effacer », badge du
nombre de titres en attente. Recherche TMDB par le proxy habituel du site (quota du compte),
ajouts et mises à jour par le code d'ajout normal (`makeEntry`, `js/07-add-edit.js`) : les titres
ajoutés sont identiques à un ajout manuel et partent à la synchro comme d'habitude. La
progression ne fait qu'avancer ; série « en cours » au dernier épisode vu, ou « terminée » si
c'est le dernier épisode d'une série finie (TMDB) ; film « terminé ».

Vie privée : les titres détectés sont stockés dans Supabase (`public.detected_media`), lisibles et
modifiables seulement par leur propriétaire (RLS) ; aucune insertion directe depuis un client, seule
la RPC à jeton écrit. Un compte supprimé efface ses détections (cascade). L'extension garde
localement le jeton, la dernière détection et l'état de l'import (`wlImport`, `wlImportMeta` : date
du dernier import, jamais le jeton ni la liste des titres).

## Correctifs 0.6.2

- **Crunchyroll, historiques longs** : l'adresse `/content/v2/{compte}/watch-history` pagine
  désormais par curseur (`meta.next_page`) et refuse un numéro de page (`page=11`) avec un 400
  `content.get_watch_history_v2.invalid_value` dès ~900–1 000 éléments (constaté aussi par
  ruflas/crunchyexporter-cli, issue #4). L'extension suit `meta.next_page` (chemin relatif, ou
  adresse www / beta-api ramenée sur www.crunchyroll.com ; jamais une autre origine), s'arrête
  quand le lien est vide, la page vide ou incomplète, ou le total atteint ; le numéro de page ne
  sert plus qu'en dernier recours (réponse sans `next_page`). Pages de 100 (taille utilisée par
  les clients connus).
- **Import partiel plutôt qu'échec** : si une page après la première échoue, tout ce qui a déjà été
  lu est envoyé ; la fenêtre l'indique (« L'historique le plus ancien n'a pas pu être lu… ») avec
  « Copier le diagnostic » (`partial: true`, page et statut). La date du dernier import n'avance
  pas, pour que l'import suivant relise la partie manquante. Seul un échec sur la première page
  reste une erreur.

## Correctifs 0.6.1

- **Crunchyroll** : l'historique est lu depuis un onglet `www.crunchyroll.com` (un onglet déjà
  ouvert, sinon un onglet ouvert en arrière-plan puis refermé), par `chrome.scripting` : requêtes
  même origine avec les cookies du site, comme le site lui-même, au lieu du service worker
  (origine `chrome-extension://`, que Cloudflare ou l'API pouvaient refuser). Jeton demandé comme
  le site (sans `scope=offline_access`, paramètre anti-cache `_`, identifiant d'appareil du site
  s'il est lisible), renouvelé si l'import dure plus que sa validité (~5 min), ancienne adresse
  `/content/v1/watch-history` si la v2 est refusée.
- **Diagnostic** : en cas d'échec, la fenêtre affiche l'étape et le statut (« Étape jeton : HTTP
  401 », « Étape historique : pas de réponse… ») et un bouton « Copier le diagnostic » (version,
  plateforme, étape, statut, Cloudflare oui/non, navigateur ; jamais de jeton, cookie, identifiant
  de compte ou d'appareil). Erreurs distinctes : session absente, blocage Cloudflare, limite de
  requêtes, onglet impossible à ouvrir.
- **Site, onglet « Détectés »** : recherche TMDB plus tolérante (titres Netflix nettoyés :
  « : Saison 2 », « Partie 1 », « Série limitée », « (Limited Series) », « : Le film », « Volume 2 »,
  année ; nom avant les deux-points ; fr-FR puis en-US ; /search/multi), résultats gardés par titre,
  et recherche manuelle dans la ligne des titres sans fiche.

## Crunchyroll et Prime Video (0.6.0)

Deux plateformes de plus, **désactivées par défaut** : dans la fenêtre de l'extension, section
« Crunchyroll et Prime Video », les boutons **« Activer Crunchyroll »** et **« Activer Prime
Video »** demandent à Chrome l'accès à ces sites seulement (permissions facultatives,
`optional_host_permissions`). L'avertissement à l'installation reste donc celui de la 0.5.0
(Netflix et Cinepisode). « Désactiver » retire l'accès. Une fois une plateforme activée :

- **détection en direct** : le service worker enregistre les scripts de la plateforme
  (`chrome.scripting.registerContentScripts`, liste dans `lib/platforms.js`) et les retire si
  l'accès est retiré. Mêmes règles que Netflix (80 % / générique après 50 % pour un épisode,
  90 % / 80 % pour un film, 20 s de lecture réellement observée), communes dans `lib/watch-rules.js` ;
  - Crunchyroll : la vidéo est dans l'iframe du lecteur (`static.crunchyroll.com`,
    `content/crunchyroll-player.js`), qui envoie seulement position, durée et écran de fin à la
    page (`postMessage` vers `https://www.crunchyroll.com`, jamais `'*'`). La page
    (`content/crunchyroll.js`) vérifie l'origine de l'iframe, que l'expéditeur est bien une iframe
    de la page et la forme du message ; série, saison et épisode viennent des métadonnées JSON-LD
    (`TVEpisode`) de la page `/watch/`, ignorées si elles décrivent une autre vidéo ;
  - Prime Video (`content/prime.js`) : titre et repère lus dans le lecteur, en anglais et en
    français (« S2 E5 », « S2 É5 », « Season 2, Ep. 5 », « Saison 2, ép. 5 »…). Prime masque ses
    commandes pendant la lecture : le dernier titre lu reste associé à la vidéo tant que sa durée
    ne change pas. Rien n'est compté pendant une publicité. Suffixes « [4K/UHD] » et « - Saison 2 »
    retirés ;
- **« Importer mon historique Crunchyroll »** (`lib/crunchyroll.js`) : jeton d'accès de courte
  durée obtenu avec la session crunchyroll.com du navigateur (`POST /auth/v1/token`,
  `grant_type=etp_rt_cookie` ; le cookie est ajouté par le navigateur, l'extension ne le lit
  jamais ; l'en-tête `Basic` est l'identifiant public du client web de crunchyroll.com, le même
  pour tous les visiteurs), puis `GET /content/v2/{compte}/watch-history` par pages de 100
  (forme v1 `items`/`next_page` acceptée aussi). Une ligne par série : dernier épisode fini
  (`fully_watched` ou ≥ 80 %), date, pourcentage ; films (`movie_listing`) à part ; suffixes
  « (French Dub) », « (VOSTFR) »… retirés. Un identifiant d'appareil aléatoire propre à
  l'installation est envoyé (`wlDeviceId`) : Crunchyroll peut signaler une « nouvelle connexion ».
  Pause et nouvel essai si Crunchyroll limite les requêtes (429) ;
- **« Importer mon historique Prime Video »** (`lib/prime.js`) : région du compte
  (`atv-ps.primevideo.com/cdp/usage/GetAppStartupConfig`, `eu` par défaut pour la France), puis
  `www.primevideo.com/region/eu/api/getWatchHistorySettingsPage` page par page (`nextToken`),
  pourcentage vu (`enrichItemMetadata`) et, **seulement pour les éléments vus à 80 % ou plus**,
  la fiche (`atv-ps-eu.primevideo.com/cdp/catalog/GetPlaybackResources`, 3 en parallèle,
  1 500 au plus par import) : série, saison, épisode. Bandes-annonces et bonus écartés ; lectures
  courtes (épisode entamé, film non fini) jamais envoyées et sans appel de fiche.

Les deux imports sont faits par le service worker (requêtes directes avec les cookies du site,
limitées aux adresses de la plateforme), avec la même interface que Netflix (avancement, résultat,
onglet « Détectés » ouvert à la fin) et un réimport incrémental (date du dernier visionnage lu,
moins 3 jours).

**Saisons d'animés** : Crunchyroll numérote parfois autrement que TMDB (saisons découpées,
numérotation absolue, OAV). La saison est envoyée telle quelle ; dans l'onglet « Détectés », une
ligne dont l'épisode vient de Crunchyroll n'est **jamais cochée d'office** et affiche
« Numérotation Crunchyroll : vérifie la saison ». Chaque ligne affiche une pastille par source
(Netflix, Fichier Netflix, Crunchyroll, Prime Video, Vu en direct).

**Prime Video sur amazon.fr** : seule la session `www.primevideo.com` est utilisée (demander
l'accès à `amazon.fr` reviendrait à lire tout le site marchand). Se connecter une fois sur
`www.primevideo.com` dans ce navigateur suffit ; la lecture sur `amazon.fr/gp/video` n'est pas
détectée en direct.

**Export de données Amazon** (« Demander vos données » › Prime Video) : pas pris en charge pour
l'instant. Son format (fichiers `Digital.PrimeVideo.ViewingHistory`, CSV/JSON selon les périodes)
n'est pas documenté et n'a pas pu être vérifié sur un vrai export ; l'import par la session
`primevideo.com` couvre le même historique. À ajouter si un export réel est fourni.

### Permissions (0.6.0)

| Permission | Pourquoi |
|---|---|
| `storage` | jeton, dernière détection, état de l'import |
| `scripting` | lire l'historique dans l'onglet `netflix.com` (requêtes même origine, au clic seulement) |
| `https://www.netflix.com/*` | idem (avant : seulement `netflix.com/watch/*` pour la détection en direct) |
| `https://batfulcvvquffgfeppcx.supabase.co/*` | inchangé : marquage en direct et envoi des détections |
| *facultatif* `https://www.crunchyroll.com/*`, `https://static.crunchyroll.com/*` | demandé par « Activer Crunchyroll » : historique et détection en direct (page et iframe du lecteur) |
| *facultatif* `https://www.primevideo.com/*`, `https://atv-ps.primevideo.com/*`, `https://atv-ps-eu.primevideo.com/*`, `https://atv-ps-fe.primevideo.com/*` | demandé par « Activer Prime Video » : historique (site et API de la région du compte) et détection en direct |

Pas d'accès à `cinepisode.com` (l'onglet « Détectés » est simplement ouvert pour toi, sans
permission), pas de permission `tabs`, `history` ni `cookies`, aucun appel TMDB depuis
l'extension. Page de l'extension sous CSP stricte (`script-src 'self'`, `connect-src` limité à
Supabase et aux adresses Crunchyroll / Prime Video ci-dessus — sans la permission facultative,
ces requêtes restent impossibles —, `img-src 'self'`), aucun script en ligne, aucun `innerHTML`.
Nom, identifiant et clé de l'extension inchangés.

### Crédit

La façon de lire l'historique Netflix (endpoint `aui/pathEvaluator`, structure des éléments,
adresses des fiches) s'inspire de [Universal Trakt Scrobbler](https://github.com/trakt-tools/universal-trakt-scrobbler)
(`src/services/netflix/NetflixApi.ts`). Le code de `lib/import.js` est réécrit pour Cinepisode.
Idem pour Crunchyroll et Prime Video (0.6.0) : `lib/crunchyroll.js` reprend de
`src/services/crunchyroll/CrunchyrollApi.ts` le jeton `etp_rt_cookie`, la structure de
l'historique et le repérage des films / doublages ; `lib/prime.js` reprend de
`src/services/amazon-prime/AmazonPrimeApi.ts` les endpoints, le `deviceTypeID` et la structure des
réponses, et `content/prime.js` les sélecteurs du lecteur d'`AmazonPrimeParser.ts`. Code réécrit
pour Cinepisode, sous la même notice :

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

## Couverture par plateforme

| Plateforme | État |
|---|---|
| Netflix | **Fonctionnel**, vérifié sur un vrai compte (saison/épisode via `netflix.falcorCache`, titre via `[data-uia="video-title"]`) |
| Crunchyroll | **0.6.0, à activer** : historique et détection en direct ; testé sur des réponses simulées (endpoints réels non vérifiés sur un vrai compte) |
| Prime Video | **0.6.0, à activer** : historique et détection en direct (textes anglais et français) ; testé sur des réponses simulées (endpoints réels non vérifiés sur un vrai compte) |
| Disney+, Max | Pas encore pris en charge |

Les scripts de diagnostic (exploration de la page dans la console, `content/diagnostic*.js` et les
scripts « diagnostic seulement » de Prime Video, Disney+, Max et Crunchyroll) ont été retirés en
version 0.3.0 : l'extension ne s'exécutait plus que sur `netflix.com/watch/*` (Crunchyroll et Prime Video reviennent en 0.6.0, seulement si tu les actives). Ils restent dans
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
