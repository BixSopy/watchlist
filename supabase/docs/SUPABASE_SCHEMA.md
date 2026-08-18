# Supabase Schema — Watchlist Ciné Premium

## 📊 Vue d'ensemble

Trois tables principales + une utilitaire :

```
profiles            ← Utilisateurs
  ├── watchlist_items  ← Films/séries/anime (1:N)
  └── keep_alive       ← Cron ping (isolation)
```

**URL Projet** : `https://batfulcvvquffgfeppcx.supabase.co`  
**Status** : Healthy (nano compute, free tier)  
**RLS** : Actif — isolation par utilisateur  
**Realtime** : Disponible si multi-device sync activé

---

## 📋 TABLE: `profiles`

Profils utilisateurs — authentification + préférences.

| Colonne | Type | Nullable | Notes |
|---------|------|----------|-------|
| `id` | uuid | NO | PK, auto-généré |
| `account_id` | uuid | NO | FK auth.users, UNIQUE |
| `name` | text | NO | Nom affiché |
| `avatar` | text | YES | URL image profil |
| `avatar_color` | text | YES | Couleur fond avatar |
| `has_pin` | bool | YES | Si PIN activé |
| `pin_hash` | text | YES | Hash bcrypt du PIN |
| `is_manager` | bool | YES | Administrateur |
| `created_at` | timestamp | YES | Auto (now()) |
| `updated_at` | timestamp | YES | Auto (now()) |

**RLS** : Utilisateur voit/modifie seulement son profil (`auth.uid() = account_id`)

**Usage** : Une ligne par utilisateur. Créée automatiquement au premier login.

---

## 📋 TABLE: `watchlist_items`

Films, séries, anime — le cœur de la watchlist.

### Identifiant & Propriétaire

| Colonne | Type | Nullable | Notes |
|---------|------|----------|-------|
| `id` | uuid | NO | PK Supabase |
| `local_id` | text | NO | ID local (IndexedDB) — relation multi-appareil |
| `profile_id` | uuid | NO | FK profiles — isolation utilisateur |

### Metadata TMDB

| Colonne | Type | Nullable | Notes |
|---------|------|----------|-------|
| `tmdb_id` | integer | YES | ID TMDB source |
| `tmdb_type` | text | YES | `movie`, `tv`, `anime` |
| `type` | text | NO | `film`, `série`, `anime` |
| `title` | text | NO | Titre |
| `year` | text | YES | Année sortie |
| `poster_path` | text | YES | URL poster TMDB |
| `tmdb_score` | double | YES | Note TMDB (0-10) |
| `overview` | text | YES | Synopsis |

### Notation Utilisateur

| Colonne | Type | Nullable | Notes |
|---------|------|----------|-------|
| `my_rating` | double | YES | Note utilisateur (1-5) |
| `tags` | ARRAY | YES | Catégories perso |

### Séries & Anime

| Colonne | Type | Nullable | Notes |
|---------|------|----------|-------|
| `saison` | integer | YES | S01, S02... |
| `episode` | integer | YES | E01, E02... |
| `total_ep` | integer | YES | Nombre épisodes total |
| `anime_genre` | text | YES | Genre anime spécifique |
| `has_new_ep` | boolean | YES | Nouvel épisode dispo |
| `next_air` | text | YES | Date prochain épisode |

### Collections & Sagas

| Colonne | Type | Nullable | Notes |
|---------|------|----------|-------|
| `collection_id` | text | YES | ID collection locale |
| `collection_name` | text | YES | Nom saga (ex: "MCU") |
| `tmdb_collection_id` | integer | YES | ID collection TMDB |

### Sync & Lifecycle

| Colonne | Type | Nullable | Notes |
|---------|------|----------|-------|
| `deleted` | boolean | YES | Soft delete (sync multi-device) |
| `added_at` | timestamp | YES | Date création (auto) |
| `updated_at` | timestamp | YES | Dernière modif (auto) |

**Statut valides** : `todo`, `encours`, `termine`, `avoir`

**RLS** : Utilisateur voit/modifie seulement ses items (`profile_id` match)

**Index** : `profile_id`, `status`, `tmdb_id` → perf queries

**Usage** : Sync bidirectionnelle avec IndexedDB local.

---

## 📋 TABLE: `keep_alive`

Utilitaire — ping quotidien GitHub Actions → empêche pause projet (SLA free tier).

| Colonne | Type | Nullable | Notes |
|---------|------|----------|-------|
| `id` | uuid | NO | PK |
| `pinged_at` | timestamp | YES | Dernier ping (auto) |

**RLS** : Ouvert (`true`) — cron GitHub seul accès

**Usage** : Cron pings `/rest/v1/keep_alive` chaque jour 9h UTC.

---

## 🔒 Row Level Security (RLS)

**Toutes les tables** → RLS activé.

### Policies

#### `profiles`
- **SELECT** : `auth.uid() = account_id`
- **UPDATE** : `auth.uid() = account_id`
- **DELETE** : ❌ Interdite (archive au lieu de supprimer)

#### `watchlist_items`
- **SELECT** : `profile_id` appartient à l'utilisateur
- **INSERT** : `profile_id` match l'utilisateur
- **UPDATE** : `profile_id` match l'utilisateur
- **DELETE** : Non utilisé (soft delete via `deleted=true`)

#### `keep_alive`
- **INSERT** : Ouvert (cron service)
- **SELECT/UPDATE** : ❌ Restreint

---

## 🔄 Realtime (optionnel)

Si multi-device sync (Session 9) :

1. **Dashboard Supabase** → `Database` → `Realtime`
2. Sélectionne `watchlist_items`
3. Toggle **Enable realtime**

Ça active le Realtime API pour les subscriptions.

**N'active que si** tu implémente la sync Session 9 — sinon coûte en ressources.

---

## 📈 Migrations & Backups

**Migrations** : Aucune versionnée (schéma créé manuellement Session 6-8)  
**Backups** : À configurer manuellement (Settings → Backups) si free tier le permet  
**Recovery** : Voir `supabase_schema.sql` pour recréer schéma

---

## 🔑 API Keys

### Publishable (public, safe for browser)
```
sb_publishable_AgSykBvnAW4cZmuMZJWnrA_lcFL5eT0
```
- ✅ Utilisé pour le cron GitHub (keep-alive)
- ✅ Utilisé pour fetch/insert/update via RLS
- ✅ Sûr de publier (RLS protège les données)

### Secret (backend only)
```
sb_secret_9iJTL****
```
- ❌ À ne jamais exposer
- ❌ Bypasse RLS
- ⚠️ Réservé aux migrations backend/CLI Supabase

---

## 🚀 Configuration Checklist

- [x] Tables créées
- [x] RLS activé
- [x] Index performants
- [ ] Realtime activé (optionnel, si sync multi-device)
- [ ] Backups configurés
- [ ] GitHub Actions cron `keep-alive` actif

---

## 📞 Support & Debugging

**Problème** : Realtime pas de message  
**Cause** : Table pas en Realtime, RLS bloque, auth user pas bon  
**Fix** : Dashboard → Realtime → enable table + vérifier RLS policies

**Problème** : "Row not found"  
**Cause** : RLS rejette accès (profile_id ne match pas)  
**Fix** : Vérifier `profile_id` = profil actuel via `auth.uid()`

**Problème** : Projet pause après 7j  
**Cause** : Cron GitHub pas exécuté  
**Fix** : GitHub repo → Actions → "Keep Supabase Alive" → vérifier logs
