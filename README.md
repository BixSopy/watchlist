# Watchlist Ciné Premium

Suivi perso pour films, séries, anime avec aesthetic OLED dark inspiré de Plex.

## ✨ Features

- 🎬 Recherche TMDB (films, séries, anime)
- ⭐ Notation 1-5 étoiles + notes perso
- 🏷️ Filtres statut + genre + tri
- 💾 Stockage local (IndexedDB + localStorage) + synchronisation Supabase optionnelle
- 📊 Stats footer en temps réel
- 🔄 Export / Import JSON (merge sans doublon)
- 🎞️ Discovery rows — 30 résultats, cards dynamiques
- ⚡ Progressive loading — 15 items + "Charger plus"
- 🔢 Recommandations numérotées
- 🌙 Dark mode OLED (`#0a0a0c`)
- 🔍 Search modal avec 3 filtres (type, tri, année)
- 🎯 Notation bloquée sur statut "À voir"

## 🛠 Tech Stack

- Frontend : HTML5 + CSS3 + Vanilla JS (zero framework)
- Storage  : IndexedDB (watchlist) + localStorage (prefs)
- API      : TMDB v3 + OMDb via fonctions serverless Vercel (`/api`, clés côté serveur)
- Hosting  : Vercel (statique + fonctions `/api`)

## 🔒 Confidentialité

- Dépôt privé, site non indexé (`noindex`), aucune police ni script tiers :
  supabase-js est embarqué dans `vendor/` (version figée, contrôle d'intégrité SRI),
  les polices sont servies depuis `fonts/`.
- En-têtes de sécurité dans `vercel.json` (CSP stricte, `Referrer-Policy: no-referrer`,
  `Permissions-Policy`, `frame-ancestors 'none'`…).
- `.vercelignore` (liste blanche) : seuls `index.html`, `js/`, `api/`, `vendor/` et `fonts/` sont publiés.
- Inscription désactivée dans l'interface (compte unique).

## 💻 Usage local

```bash
npx vercel dev          # sert index.html et les fonctions /api (variables dans .env.local, non versionné)
node --test tests/      # tests des fonctions /api (fetch simulé)
```

Un simple serveur statique (`python3 -m http.server`) suffit pour l'interface, mais le
catalogue TMDB ne répondra pas sans les fonctions `/api`.

## 📝 Utilisation

1. **Ajouter** → 🔍 Recherche TMDB → sélection → `Ajouter X sélectionné(s)`
2. **Éditer** → ✏️ Statut / Note (1-5★) / Notes texte
3. **Filtrer** → Barre statut + Genre + Recherche locale
4. **Discovery** → Rows thématiques avec scroll horizontal
5. **Exporter** → ⬇ JSON téléchargé (backup local)
6. **Importer** → ⬆ Upload JSON (merge automatique, sans doublon)

## 📅 Versions

- **v1.0** — Features core Session 6 : progressive loading, discovery rows, search modal 3 filtres, animations premium, notation locked
- **v1.1** — Deploy Vercel + export/import + stats footer (Session 7)
- **v1.2** — Mobile responsive (Session 8, post-hosting)

## 🚀 Roadmap

- [ ] Version mobile responsive
- [ ] Dossiers / Sagas (groupement collections)
- [ ] Stats dashboard (graphiques par genre, année, note)
- [ ] Service Worker (PWA offline)
- [ ] Letterboxd sync

## ⚙️ Configuration

Aucune clé TMDB ni OMDb n'est présente côté client. Les appels passent par deux
fonctions serverless Vercel (`api/tmdb.js`, `api/omdb.js`) qui :

- exigent une session Supabase valide (en-tête `Authorization: Bearer <access_token>`,
  vérifié auprès de `/auth/v1/user`) ;
- n'acceptent qu'une liste blanche de chemins et de paramètres (pas de proxy ouvert) ;
- ne mettent jamais les erreurs en cache.

Variables d'environnement Vercel (Production **et** Preview) :

| Variable | Obligatoire | Rôle |
|---|---|---|
| `TMDB_API_KEY` | oui | Clé TMDB v3 (ou jeton de lecture v4) |
| `OMDB_API_KEY` | oui | Clé OMDb |
| `SUPABASE_ANON_KEY` | oui | Clé publique (anon/publishable) du projet, pour vérifier les sessions |
| `SUPABASE_URL` | non | URL du projet Supabase (valeur par défaut : celle de l'app) |
| `ALLOWED_EMAILS` | non | Liste d'emails autorisés, séparés par des virgules |

Côté client (`js/01-config.js`) : `TB='/api/tmdb'` (proxy), `IB='https://image.tmdb.org/t/p/'` (images, direct).
