# Watchlist Ciné Premium

Suivi perso pour films, séries, anime avec aesthetic OLED dark inspiré de Plex.

## ✨ Features

- 🎬 Recherche TMDB (films, séries, anime)
- ⭐ Notation 1-5 étoiles + notes perso
- 🏷️ Filtres statut + genre + tri
- 💾 Stockage 100% local (IndexedDB + localStorage)
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
- API      : TMDB v3 (clé API client-side)
- Hosting  : Vercel (static deploy)

## 🔗 Accès

📱 **https://watchlist-[HASH].vercel.app**
*(Remplacer [HASH] par le sous-domaine Vercel réel après deploy)*

## 💻 Usage local

```bash
cd C:\Users\pierr\Downloads
node server.js
# Puis : http://localhost:9000/watchlist.html
```

Le proxy local (`node server.js`) n'est utile qu'en développement.
En production Vercel, `var PROXY=''` — les images TMDB sont directes HTTPS.

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

```javascript
// watchlist.html — ligne 631
var TKEY = '9889edf442467bddfc6bde3413a53bfc'; // TMDB API key
var TB   = 'https://api.themoviedb.org/3';      // TMDB base URL
var IB   = 'https://image.tmdb.org/t/p/';       // Images base URL
var PROXY = '';                                  // Vide en prod (localhost:9000 en dev local)
```
