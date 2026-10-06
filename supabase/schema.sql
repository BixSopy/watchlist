-- =============================================================================
-- Watchlist Ciné Premium — schéma PostgreSQL Supabase (état cible)
-- Projet : batfulcvvquffgfeppcx (eu-central-1, Postgres 17)
--
-- Reflète la base après les migrations
-- supabase/migrations/20260925151457_nettoyage_et_securite.sql,
-- supabase/migrations/20261006000550_plex_webhook_token_and_mark_watched.sql et
-- supabase/migrations/20261006054213_mark_watched_by_title.sql.
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
  plex_webhook_token text unique,               -- jeton webhook Tautulli -> mark_watched_by_token()
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
-- FONCTION : mark_watched_by_token — webhook Plex/Tautulli (Session 19)
-- Appelée hors session utilisateur (pas de JWT), authentifiée par un jeton
-- stocké sur le profil. SECURITY DEFINER borné à ce lookup + update ciblé.
-- -----------------------------------------------------------------------------
create or replace function public.mark_watched_by_token(
  p_token text,
  p_tmdb_id integer,
  p_season integer,
  p_episode integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid;
  v_updated integer;
begin
  if p_token is null or p_token = '' or p_tmdb_id is null then
    return false;
  end if;

  select id into v_profile_id from public.profiles where plex_webhook_token = p_token;
  if v_profile_id is null then
    return false;
  end if;

  if p_season is not null and p_episode is not null then
    update public.watchlist_items
    set saison = p_season,
        episode = p_episode,
        status = case when status in ('avoir','todo') then 'encours' else status end
    where profile_id = v_profile_id
      and tmdb_id = p_tmdb_id
      and deleted = false
      and (saison is null or episode is null
           or p_season > saison
           or (p_season = saison and p_episode >= episode));
  else
    update public.watchlist_items
    set status = 'termine'
    where profile_id = v_profile_id
      and tmdb_id = p_tmdb_id
      and deleted = false
      and status <> 'termine';
  end if;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.mark_watched_by_token(text, integer, integer, integer) from public;
grant execute on function public.mark_watched_by_token(text, integer, integer, integer) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- FONCTION : mark_watched_by_title — extension navigateur (Netflix/..., Session 19)
-- Variante par titre de mark_watched_by_token() : pas de tmdb_id fiable sans appel
-- TMDB côté client (clé API jamais exposée hors serveur). Correspondance bornée au
-- profil du jeton, exacte puis partielle en secours.
-- -----------------------------------------------------------------------------
create or replace function public.mark_watched_by_title(
  p_token text,
  p_title text,
  p_season integer,
  p_episode integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid;
  v_item_id uuid;
  v_updated integer;
begin
  if p_token is null or p_token = '' or p_title is null or trim(p_title) = '' then
    return false;
  end if;

  select id into v_profile_id from public.profiles where plex_webhook_token = p_token;
  if v_profile_id is null then
    return false;
  end if;

  select id into v_item_id
  from public.watchlist_items
  where profile_id = v_profile_id
    and deleted = false
    and lower(trim(title)) = lower(trim(p_title))
  order by added_at desc
  limit 1;

  if v_item_id is null then
    select id into v_item_id
    from public.watchlist_items
    where profile_id = v_profile_id
      and deleted = false
      and (lower(title) like '%'||lower(trim(p_title))||'%' or lower(trim(p_title)) like '%'||lower(title)||'%')
    order by length(title) asc, added_at desc
    limit 1;
  end if;

  if v_item_id is null then
    return false;
  end if;

  if p_season is not null and p_episode is not null then
    update public.watchlist_items
    set saison = p_season,
        episode = p_episode,
        status = case when status in ('avoir','todo') then 'encours' else status end
    where id = v_item_id
      and (saison is null or episode is null
           or p_season > saison
           or (p_season = saison and p_episode >= episode));
  else
    update public.watchlist_items
    set status = 'termine'
    where id = v_item_id and status <> 'termine';
  end if;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.mark_watched_by_title(text, text, integer, integer) from public;
grant execute on function public.mark_watched_by_title(text, text, integer, integer) to anon, authenticated;

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
