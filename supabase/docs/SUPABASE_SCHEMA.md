# Schéma Supabase — Cinepisode (dépôt watchlist)

Référence SQL : [`supabase/schema.sql`](../schema.sql) (état cible).
Migrations : [`supabase/migrations/`](../migrations/) — à lancer à la main dans le SQL Editor.

## Vue d'ensemble

```
auth.users (inscriptions ouvertes, email confirmé obligatoire pour le catalogue)
  ├── profiles (1:1, UNIQUE account_id)
  │     └── watchlist_items (1:N, UNIQUE (local_id, profile_id), 20 000 max par profil)
  └── api_usage (compteurs quotidiens par compte et par API, ON DELETE CASCADE)
api_quota_limits   ← limites par API (tmdb, omdb), modifiables à la main
api_usage_global   ← compteur quotidien global (OMDb : 1 000/jour pour toute l'app)
api_cache          ← cache partagé des réponses OMDb (clé secrète du proxy uniquement)
keep_alive         ← ping quotidien du workflow GitHub (isolée)
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

| `api_quota_limits`, `api_usage`, `api_usage_global` | RLS sans politique | aucun droit pour anon/authenticated (accès via `consume_api_quota` seulement) |
| `api_cache` | RLS sans politique | service_role uniquement (clé secrète du proxy) |

Colonnes modifiables par l'utilisateur dans `profiles` : INSERT (`account_id`, `name`),
UPDATE (`name`, `avatar`, `avatar_color`, `plex_webhook_token`). `is_manager`, `has_pin`,
`pin_hash` ne sont plus modifiables depuis l'app. Contraintes de taille sur
`watchlist_items` (`watchlist_items_tailles_check`) et `profiles` (`profiles_tailles_check`).

Fonctions du schéma `public` (toutes `search_path = ''`) :

| Fonction | Type | Appelable par | Rôle |
|---|---|---|---|
| `update_timestamp()` | trigger | — | met à jour `updated_at` |
| `mark_watched_by_token(...)` | SECURITY DEFINER | anon (jeton) | webhook Plex/Tautulli |
| `mark_watched_by_title(p_token, p_title, p_season, p_episode, p_type)` | SECURITY DEFINER | anon (jeton) | extension navigateur : titre comparé exactement après normalisation (`normalize_title_for_match`, sans correspondance partielle), progression qui ne recule jamais ; renvoie `{status: updated / already_up_to_date / not_found / ambiguous / invalid_token / invalid_input, title, season, episode}` |
| `normalize_title_for_match(text)` | immuable | personne (interne) | minuscules, sans accents ni ponctuation, sans article de tête ni année entre parenthèses finale |
| `consume_api_quota(p_bucket, p_cost)` | SECURITY DEFINER | authenticated | décompte le quota du compte (`auth.uid()`), renvoie `{allowed, scope, used, limit}` |
| `delete_my_account()` | SECURITY DEFINER | authenticated | supprime le compte de `auth.uid()` et ses données ; exige une connexion de moins de 15 min (claim `amr`) |
| `api_housekeeping()` | SECURITY DEFINER | personne (appelée par `consume_api_quota`) | purge compteurs et cache expirés |
| `watchlist_items_limite()` | trigger | — | refuse au-delà de 20 000 titres par profil |

## Réglages du tableau de bord (à faire à la main)

Voir la section « Mise en ligne publique » et « Après l'achat de cinepisode.com » du
[README](../../README.md) : inscriptions, confirmation d'email, mots de passe, CAPTCHA
Turnstile, URL de redirection, SMTP Resend, gabarits d'emails (`supabase/templates/`).
Garder « Allow anonymous sign-ins » désactivé et relancer Advisors › Security après chaque
migration.
