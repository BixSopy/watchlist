# Watchlist Ciné — Suivi auto (extension navigateur)

Marque automatiquement ta progression (saison/épisode) dans Watchlist Ciné Premium pendant
que tu regardes sur Netflix, sans action manuelle. Même jeton que la synchro Plex/Tautulli.

**Couverture actuelle : Netflix uniquement.** Prime Video/Disney+/etc. demandent chacun
leur propre script de détection — pas encore fait.

## Installation (Chrome / Edge / Brave)

1. `chrome://extensions`
2. Active le **Mode développeur** (coin supérieur droit)
3. **Charger l'extension non empaquetée** → sélectionne le dossier `extension/`
4. Clique sur l'icône de l'extension → colle le jeton généré depuis l'app
   (Réglages › Suivi Plex (via Tautulli) › Générer mon URL webhook)

## Vérifier que ça marche

1. Lance un épisode sur Netflix (`netflix.com/watch/...`)
2. Ouvre la console développeur (F12 → onglet Console)
3. Tu dois voir des lignes `[WL] document.title brut : ...` et soit `[WL] parse reussi`
   soit `[WL] format non reconnu`

**Si tu vois "format non reconnu"** : copie la ligne `document.title brut` telle quelle
et renvoie-la — le format exact du titre Netflix n'a pas pu être vérifié en amont (pas
d'accès à un vrai compte Netflix pendant le développement), la regex dans
`content/netflix.js` se corrige en quelques minutes une fois qu'on a un exemple réel.

## Pourquoi pas de clé TMDB ni de login dans l'extension

La correspondance se fait par **titre** (`mark_watched_by_title` côté Supabase, bornée à
ta propre watchlist) plutôt que par tmdb_id — ça évite d'exposer une clé API ou de gérer
une session de connexion dans l'extension. Si le titre affiché par Netflix diffère trop de
celui dans ta watchlist, la mise à jour est silencieusement ignorée (aucun risque de
modifier le mauvais titre).
