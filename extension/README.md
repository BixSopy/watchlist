# Watchlist Ciné — Suivi auto (extension navigateur)

Marque automatiquement ta progression (saison/épisode) dans Watchlist Ciné Premium pendant
que tu regardes, sans action manuelle. Même jeton que la synchro Plex/Tautulli.

## Couverture par plateforme

| Plateforme | État |
|---|---|
| Netflix | **Fonctionnel**, vérifié sur un vrai compte (saison/épisode via `netflix.falcorCache`, titre via `[data-uia="video-title"]`) |
| Prime Video | Diagnostic seulement — rien n'est encore envoyé à la watchlist |
| Disney+ | Diagnostic seulement |
| Max (ex-HBO Max) | Diagnostic seulement |
| Crunchyroll | Diagnostic seulement |

"Diagnostic seulement" = le script tourne et logge dans la console (`[WL:<plateforme>]`)
ce qu'il trouve sur la page, mais ne met encore rien à jour. Netflix a demandé 3 allers-retours
avec de vraies données de console pour trouver le bon mécanisme (aucune de ces plateformes
n'a d'API publique) — même principe ici : le diagnostic sert à obtenir un exemple réel, pas
à deviner à l'aveugle un mécanisme qui échouerait silencieusement.

## Installation (Chrome / Edge / Brave)

1. `chrome://extensions`
2. Active le **Mode développeur** (coin supérieur droit)
3. **Charger l'extension non empaquetée** → sélectionne le dossier `extension/`
4. Clique sur l'icône de l'extension → colle le jeton généré depuis l'app
   (Réglages › Suivi auto (Netflix, Plex...) › Générer mon jeton)

## Vérifier Netflix (fonctionnel)

1. Lance un épisode sur Netflix (`netflix.com/watch/...`)
2. F12 → Console, filtre sur **WL**
3. Tu dois voir `[WL] detecte : <Titre> S<saison>E<épisode>`

## Passer une plateforme diagnostic → fonctionnelle

1. Regarde un épisode/film sur la plateforme concernée (Prime Video, Disney+, Max ou Crunchyroll)
2. F12 → Console, filtre sur `WL:` + le nom de la plateforme (ex. `WL:primevideo`)
3. Copie tout ce qui s'affiche (ou capture d'écran) et envoie-le — ça permet d'écrire
   l'extraction réelle pour cette plateforme, comme ça a été fait pour Netflix

## Pourquoi pas de clé TMDB ni de login dans l'extension

La correspondance se fait par **titre** (`mark_watched_by_title` côté Supabase, bornée à
ta propre watchlist) plutôt que par tmdb_id — ça évite d'exposer une clé API ou de gérer
une session de connexion dans l'extension. Si le titre affiché diffère trop de celui dans
ta watchlist, la mise à jour est silencieusement ignorée (aucun risque de modifier le
mauvais titre).
