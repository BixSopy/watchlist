-- =============================================================================
-- Watchlist Ciné Premium — schéma PostgreSQL Supabase (état cible)
-- Projet : batfulcvvquffgfeppcx (eu-central-1, Postgres 17)
--
-- Reflète la base après la migration
-- supabase/migrations/20260925151457_nettoyage_et_securite.sql.
-- Sert de référence pour recréer le projet ; ne pas exécuter sur la base existante.
-- Tables : profiles, watchlist_items, keep_alive. Aucun reste de laco-app
-- (pas de tasks, notifications, events, notification_preferences, entries).
-- =============================================================================

-- Extensions (présentes par défaut sur Supabase)
create extension if not exists "uuid-ossp" with schema extensions;

-- -----------------------------------------------------------------------------
-- Fonction de trigger : met à jour updated_at (search_path figé)
-- -----------------------------------------------------------------------------
create or replace function public.update_timestamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

-- -----------------------------------------------------------------------------
-- TABLE : profiles — un profil par compte Supabase Auth
-- -----------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key default extensions.uuid_generate_v4(),
  account_id   uuid not null references auth.users(id) on delete cascade,
  name         text not null,
  avatar       text,
  avatar_color text default '#1e2a3a',
  has_pin      boolean default false,
  pin_hash     text,
  is_manager   boolean default true,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  constraint profiles_account_id_key unique (account_id)
);

create trigger tr_profiles_ts
  before update on public.profiles
  for each row execute function public.update_timestamp();

-- -----------------------------------------------------------------------------
-- TABLE : watchlist_items — films, séries, anime (suppression logique : deleted)
-- -----------------------------------------------------------------------------
create table public.watchlist_items (
  id                 uuid primary key default extensions.uuid_generate_v4(),
  local_id           text not null,                -- identifiant IndexedDB (clé de synchro)
  profile_id         uuid not null references public.profiles(id) on delete cascade,

  -- Métadonnées TMDB
  tmdb_id            integer,
  tmdb_type          text,                          -- movie | tv
  type               text not null check (type in ('film', 'serie', 'anime')),
  status             text not null default 'avoir'
                       check (status in ('avoir', 'encours', 'termine', 'todo')),
  title              text not null,
  year               text,
  poster_path        text,
  tmdb_score         double precision,
  overview           text,

  -- Notation et tags
  my_rating          double precision,
  tags               text[] default '{}',

  -- Séries / anime
  saison             integer,
  episode            integer,
  total_ep           integer,
  anime_genre        text,

  -- Collections / sagas
  collection_id      text,
  collection_name    text,
  tmdb_collection_id integer,

  -- Suivi des épisodes
  has_new_ep         boolean default false,
  next_air           text,

  -- Synchro
  deleted            boolean default false,
  added_at           timestamptz default now(),
  updated_at         timestamptz default now(),

  constraint watchlist_items_local_id_profile_id_key unique (local_id, profile_id)
);

create index idx_watchlist_profile_id on public.watchlist_items (profile_id);

create trigger tr_watchlist_ts
  before update on public.watchlist_items
  for each row execute function public.update_timestamp();

-- -----------------------------------------------------------------------------
-- TABLE : keep_alive — ping quotidien du workflow GitHub (évite la mise en pause)
-- -----------------------------------------------------------------------------
create table public.keep_alive (
  id        uuid primary key default extensions.uuid_generate_v4(),
  pinged_at timestamptz default now()
);

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.watchlist_items enable row level security;
alter table public.keep_alive      enable row level security;

create policy "owner profiles" on public.profiles
  for all
  using ((select auth.uid()) = account_id)
  with check ((select auth.uid()) = account_id);

create policy "owner watchlist" on public.watchlist_items
  for all
  using (exists (select 1 from public.profiles p
                 where p.id = watchlist_items.profile_id
                   and p.account_id = (select auth.uid())))
  with check (exists (select 1 from public.profiles p
                      where p.id = watchlist_items.profile_id
                        and p.account_id = (select auth.uid())));

create policy "keep_alive insert anon" on public.keep_alive
  for insert to anon
  with check (pinged_at between now() - interval '10 minutes' and now() + interval '10 minutes');

-- -----------------------------------------------------------------------------
-- Droits (Supabase accorde tout par défaut : on restreint)
-- -----------------------------------------------------------------------------
revoke all on table public.profiles, public.watchlist_items, public.keep_alive from anon, authenticated;
grant select, insert, update on table public.profiles, public.watchlist_items to authenticated;
grant insert on table public.keep_alive to anon;
