# Cinepisode — Suivi auto (extension navigateur)

Marque automatiquement ta progression (saison/épisode) dans Cinepisode pendant
que tu regardes, sans action manuelle. Même jeton que la synchro Plex/Tautulli.

Textes de l'extension en français et en anglais (`_locales/fr`, `_locales/en`, choisis par
Chrome selon la langue du navigateur, anglais par défaut). L'extension n'écrit rien dans la
console : le titre regardé n'a pas à y apparaître.

*English: automatically marks your progress (season/episode) in Cinepisode while you watch.
Install: `chrome://extensions` → Developer mode → Load unpacked → `extension/`, then paste the
token from Cinepisode (Settings › Auto-tracking (Netflix, Plex...) › Generate my token).*

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
