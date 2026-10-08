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

## Sécurité des messages

`content/netflix-main.js` (monde MAIN, accès à `window.netflix`) envoie la détection à
`content/netflix-bridge.js` (monde isolé) par `window.postMessage`, adressé à l'origine exacte de
la page (jamais `'*'`). Le relai n'accepte que les messages de la même fenêtre (`event.source`),
de l'origine `https://www.netflix.com` (`event.origin`) et de la forme exacte attendue (titre
texte de 300 caractères maximum, saison et épisode entiers ou vides). Le service worker revérifie
l'expéditeur (cette extension, onglet Netflix) et la forme avant d'appeler Supabase.

## Installation (Chrome / Edge / Brave)

1. `chrome://extensions`
2. Active le **Mode développeur** (coin supérieur droit)
3. **Charger l'extension non empaquetée** → sélectionne le dossier `extension/`
4. Clique sur l'icône de l'extension → colle le jeton généré depuis l'app
   (Réglages › Suivi auto (Netflix, Plex...) › Générer mon jeton)

## Vérifier Netflix

1. Lance un épisode d'une série de ta watchlist sur Netflix (`netflix.com/watch/...`)
2. Après quelques secondes, la saison et l'épisode se mettent à jour dans Cinepisode
   (à la prochaine synchronisation)

## Pourquoi pas de clé TMDB ni de login dans l'extension

La correspondance se fait par **titre** (`mark_watched_by_title` côté Supabase, bornée à
ta propre watchlist) plutôt que par tmdb_id — ça évite d'exposer une clé API ou de gérer
une session de connexion dans l'extension. Si le titre affiché diffère trop de celui dans
ta watchlist, la mise à jour est silencieusement ignorée (aucun risque de modifier le
mauvais titre).
