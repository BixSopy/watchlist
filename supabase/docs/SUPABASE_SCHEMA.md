# Schéma Supabase — Watchlist Ciné Premium

Référence SQL : [`supabase/schema.sql`](../schema.sql) (état cible).
Migrations : [`supabase/migrations/`](../migrations/) — à lancer à la main dans le SQL Editor.

## Vue d'ensemble

```
auth.users (1 compte)
  └── profiles (1:1, UNIQUE account_id)
        └── watchlist_items (1:N, UNIQUE (local_id, profile_id))
keep_alive  ← ping quotidien du workflow GitHub (isolée)
```

- Projet : `batfulcvvquffgfeppcx` (eu-central-1, Postgres 17, offre gratuite).
- RLS activée sur toutes les tables.
- Realtime non utilisé.
- Aucune clé n'est documentée ici : la clé publique (publishable/anon) est dans `app.js`
  (elle est faite pour être publique, la RLS protège les données) et dans les secrets
  GitHub / variables Vercel. La clé secrète (service role) ne doit jamais sortir du tableau
  de bord.

## `profiles`

| Colonne | Type | Notes |
|---|---|---|
| `id` | uuid | PK, `uuid_generate_v4()` |
| `account_id` | uuid | FK `auth.users(id)` ON DELETE CASCADE, **UNIQUE** |
| `name` | text | Nom affiché |
| `avatar`, `avatar_color` | text | Non utilisés par l'app pour l'instant |
| `has_pin`, `pin_hash` | bool, text | Non utilisés par l'app pour l'instant |
| `is_manager` | bool | Défaut `true`, non utilisé |
| `created_at`, `updated_at` | timestamptz | `updated_at` mis à jour par le trigger `tr_profiles_ts` |

Créé au premier login par l'app (un seul à la fois ; en cas de doublon ancien, l'app prend
le plus ancien).

## `watchlist_items`

Films, séries, anime. Colonnes principales : `local_id` (identifiant IndexedDB, clé de
synchro avec `profile_id`), métadonnées TMDB (`tmdb_id`, `tmdb_type`, `title`, `year`,
`poster_path`, `tmdb_score`, `overview`), `type` (`film`/`serie`/`anime`), `status`
(`avoir`/`encours`/`termine`/`todo`, défaut `avoir`), `my_rating`, `tags text[]`, suivi
séries (`saison`, `episode`, `total_ep`, `has_new_ep`, `next_air`), sagas
(`collection_id`, `collection_name`, `tmdb_collection_id`), synchro (`deleted`,
`added_at`, `updated_at`).

- Suppression logique uniquement (`deleted = true`), jamais de DELETE côté client.
- L'app fait ses upserts sur `(local_id, profile_id)`.
- Index : `idx_watchlist_profile_id`.

## `keep_alive`

| Colonne | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `pinged_at` | timestamptz | Défaut `now()` |

Le workflow `.github/workflows/keep-alive.yml` insère une ligne par jour à 9h UTC avec la
clé publique dans l'en-tête `apikey` (secret GitHub `SUPABASE_ANON_KEY`).

## RLS et droits

| Table | Politique | Droits |
|---|---|---|
| `profiles` | `owner profiles` : `auth.uid() = account_id` | authenticated : SELECT, INSERT, UPDATE ; anon : aucun |
| `watchlist_items` | `owner watchlist` : le profil appartient à `auth.uid()` | authenticated : SELECT, INSERT, UPDATE ; anon : aucun |
| `keep_alive` | `keep_alive insert anon` : INSERT, `pinged_at` à ± 10 min de `now()` | anon : INSERT seulement |

Seule fonction du schéma `public` : `update_timestamp()` (trigger, `search_path` figé).

## Réglages du tableau de bord (à faire à la main)

1. **Authentication → Sign In / Providers → Email** : désactiver « Allow new users to sign up »
   (le compte existant continue de fonctionner). Laisser « Confirm email » activé.
2. **Authentication → Sign In / Providers** : laisser « Allow anonymous sign-ins » désactivé.
3. **Authentication → Attack Protection** (ou Passwords) : activer « Leaked password
   protection » (HaveIBeenPwned) et fixer une longueur minimale d'au moins 12 caractères.
4. **Authentication → URL Configuration** : Site URL = URL de prod Vercel ; Redirect URLs
   limitées à ce domaine (retirer localhost et les jokers inutiles).
5. **Authentication → Multi-Factor** : activer TOTP (facultatif, recommandé).
6. **Advisors → Security** : relancer après la migration ; il ne doit rester aucune alerte
   sur les fonctions SECURITY DEFINER ni sur `search_path`.
7. **GitHub → Settings → Secrets → Actions** : vérifier que `SUPABASE_ANON_KEY` contient la
   clé publique du projet (sinon le workflow keep-alive échoue, désormais visiblement).
