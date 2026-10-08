-- =============================================================================
-- Watchlist Ciné Premium — schéma PostgreSQL Supabase (état cible)
-- Projet : batfulcvvquffgfeppcx (eu-central-1, Postgres 17)
--
-- Reflète la base après les migrations
-- supabase/migrations/20260925151457_nettoyage_et_securite.sql,
-- supabase/migrations/20261006000550_plex_webhook_token_and_mark_watched.sql,
-- supabase/migrations/20261006054213_mark_watched_by_title.sql et
-- supabase/migrations/20261008100000_ouverture_publique.sql (quotas, cache, suppression
-- de compte, garde-fous de taille ; recopiée telle quelle en fin de fichier).
-- Sert de référence pour recréer le projet ; ne pas exécuter sur la base existante.
-- Tables : profiles, watchlist_items, keep_alive, api_quota_limits, api_usage,
-- api_usage_global, api_cache. Aucun reste de laco-app
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

-- =============================================================================
-- Ouverture publique — copie de supabase/migrations/20261008100000_ouverture_publique.sql
-- =============================================================================
begin;

-- 0. Pré-requis : le nettoyage du 25/09 doit être en place (1 profil par compte).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass and conname = 'profiles_account_id_key'
  ) then
    raise exception 'Appliquer d''abord 20260925151457_nettoyage_et_securite.sql (contrainte profiles_account_id_key absente)';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 1. Quotas quotidiens par compte (et global pour OMDb)
--    Les limites vivent dans api_quota_limits : les ajuster par un simple UPDATE.
--    tmdb : chaque requête au proxy /api/tmdb (cache compris) ;
--    omdb : uniquement les appels réels à OMDb (les réponses en cache ne comptent pas).
--    La clé OMDb gratuite autorise 1 000 requêtes/jour : 900 laissent une marge.
-- -----------------------------------------------------------------------------
create table if not exists public.api_quota_limits (
  bucket          text primary key check (bucket ~ '^[a-z_]{1,32}$'),
  per_user_daily  integer not null check (per_user_daily > 0),
  global_daily    integer check (global_daily > 0)
);
insert into public.api_quota_limits (bucket, per_user_daily, global_daily) values
  ('tmdb', 4000, null),
  ('omdb', 150, 900)
on conflict (bucket) do nothing;

create table if not exists public.api_usage (
  account_id  uuid    not null references auth.users (id) on delete cascade,
  day         date    not null,
  bucket      text    not null references public.api_quota_limits (bucket) on delete cascade,
  count       integer not null default 0,
  primary key (account_id, day, bucket)
);
create index if not exists api_usage_day_idx on public.api_usage (day);

create table if not exists public.api_usage_global (
  day     date    not null,
  bucket  text    not null references public.api_quota_limits (bucket) on delete cascade,
  count   integer not null default 0,
  primary key (day, bucket)
);

-- Aucune politique RLS : seules les fonctions SECURITY DEFINER ci-dessous y touchent.
alter table public.api_quota_limits enable row level security;
alter table public.api_usage        enable row level security;
alter table public.api_usage_global enable row level security;
revoke all on table public.api_quota_limits, public.api_usage, public.api_usage_global from anon, authenticated;

-- Consomme p_cost unités du quota du jour (UTC) pour l'utilisateur du JWT.
-- Appelée par le proxy Vercel AVEC le jeton de l'utilisateur : auth.uid() ne peut pas
-- être usurpé. Un appel direct depuis le navigateur ne fait qu'augmenter son propre
-- compteur. Au-delà de la limite, les compteurs n'augmentent plus (un abuseur ne peut
-- donc pas consommer plus que sa part du quota global OMDb).
create or replace function public.consume_api_quota(p_bucket text, p_cost integer default 1)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_day    date := (now() at time zone 'utc')::date;
  v_lim    public.api_quota_limits%rowtype;
  v_user   integer;
  v_global integer;
begin
  if v_uid is null then
    raise exception 'authentification requise' using errcode = '28000';
  end if;
  if p_cost is null or p_cost < 1 or p_cost > 100 then
    raise exception 'coût invalide' using errcode = '22023';
  end if;
  select * into v_lim from public.api_quota_limits where bucket = p_bucket;
  if not found then
    raise exception 'quota inconnu' using errcode = '22023';
  end if;

  insert into public.api_usage as u (account_id, day, bucket, count)
  values (v_uid, v_day, p_bucket, p_cost)
  on conflict (account_id, day, bucket)
    do update set count = u.count + excluded.count
    where u.count < v_lim.per_user_daily
  returning u.count into v_user;

  if v_user is null or v_user > v_lim.per_user_daily then
    return jsonb_build_object('allowed', false, 'scope', 'user', 'limit', v_lim.per_user_daily);
  end if;

  if v_lim.global_daily is not null then
    insert into public.api_usage_global as g (day, bucket, count)
    values (v_day, p_bucket, p_cost)
    on conflict (day, bucket)
      do update set count = g.count + excluded.count
      where g.count < v_lim.global_daily
    returning g.count into v_global;
    if v_global is null or v_global > v_lim.global_daily then
      return jsonb_build_object('allowed', false, 'scope', 'global', 'limit', v_lim.global_daily);
    end if;
  end if;

  -- Ménage occasionnel (≈ 1 appel sur 200), pas de pg_cron sur ce projet.
  if random() < 0.005 then
    perform public.api_housekeeping();
  end if;

  return jsonb_build_object('allowed', true, 'used', v_user, 'limit', v_lim.per_user_daily);
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Cache partagé des réponses OMDb (et autres réponses publiques du proxy)
--    Lu et écrit uniquement par le serveur avec la clé secrète (service_role) :
--    un utilisateur ne peut pas y injecter de fausses données. Si la clé secrète
--    n'est pas configurée dans Vercel, le proxy se contente de son cache mémoire.
-- -----------------------------------------------------------------------------
create table if not exists public.api_cache (
  key         text primary key check (length(key) between 1 and 200),
  body        jsonb not null check (octet_length(body::text) <= 16384),
  expires_at  timestamptz not null,
  updated_at  timestamptz not null default now()
);
create index if not exists api_cache_expires_idx on public.api_cache (expires_at);
alter table public.api_cache enable row level security;
revoke all on table public.api_cache from anon, authenticated;
grant select, insert, update, delete on table public.api_cache to service_role;

-- Ménage : compteurs de plus de 3 jours, compteurs globaux de plus de 30 jours,
-- entrées de cache expirées. Appelée de temps en temps par consume_api_quota().
create or replace function public.api_housekeeping()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.api_usage        where day < (now() at time zone 'utc')::date - 3;
  delete from public.api_usage_global where day < (now() at time zone 'utc')::date - 30;
  delete from public.api_cache        where expires_at < now();
$$;
revoke all on function public.api_housekeeping() from public, anon, authenticated;

revoke all on function public.consume_api_quota(text, integer) from public, anon, authenticated;
grant execute on function public.consume_api_quota(text, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Suppression de compte en libre-service (RGPD, droit à l'effacement)
--    Efface la liste, le profil (et son jeton de suivi), les compteurs, puis
--    l'utilisateur Auth (sessions et identités suivent par cascade côté Auth).
--    Exige une authentification récente (moins de 15 min, revendication « amr » du
--    JWT) : un jeton volé et ancien ne suffit pas. L'app redemande donc le mot de
--    passe juste avant. Aucune clé service_role côté client.
-- -----------------------------------------------------------------------------
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_recent boolean;
begin
  if v_uid is null then
    raise exception 'authentification requise' using errcode = '28000';
  end if;

  select exists (
    select 1
    from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) as a
    where jsonb_typeof(a) = 'object'
      and (a ->> 'timestamp') ~ '^\d{1,12}$'
      and (a ->> 'timestamp')::bigint >= extract(epoch from now())::bigint - 900
  ) into v_recent;
  if not v_recent then
    raise exception 'reauthentication_needed' using errcode = '42501',
      hint = 'Reconnecte-toi avec ton mot de passe puis recommence.';
  end if;

  delete from public.watchlist_items
  where profile_id in (select id from public.profiles where account_id = v_uid);
  delete from public.profiles  where account_id = v_uid;
  delete from public.api_usage where account_id = v_uid;
  delete from auth.users       where id = v_uid;
end;
$$;
revoke all on function public.delete_my_account() from public, anon, authenticated;
grant execute on function public.delete_my_account() to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Garde-fous sur les données synchronisées (inscriptions ouvertes = un compte
--    malveillant ne doit pas pouvoir remplir la base de 500 Mo du plan gratuit).
--    Toutes les valeurs actuelles respectent largement ces limites (vérifié le
--    08/10/2026 : titre ≤ 65 car., résumé ≤ 957 car., 199 titres).
-- -----------------------------------------------------------------------------
alter table public.watchlist_items drop constraint if exists watchlist_items_tailles_check;
alter table public.watchlist_items add constraint watchlist_items_tailles_check check (
      length(local_id) between 1 and 64
  and length(coalesce(title, '')) <= 500
  and length(coalesce(overview, '')) <= 10000
  and length(coalesce(poster_path, '')) <= 300
  and length(coalesce(year, '')) <= 16
  and length(coalesce(anime_genre, '')) <= 32
  and length(coalesce(collection_id, '')) <= 100
  and length(coalesce(collection_name, '')) <= 300
  and length(coalesce(next_air, '')) <= 40
  and (tmdb_type is null or tmdb_type in ('movie', 'tv'))
  and coalesce(cardinality(tags), 0) <= 50
  and length(coalesce(array_to_string(tags, ','), '')) <= 2000
  and (my_rating  is null or my_rating  between 0 and 10)
  and (tmdb_score is null or tmdb_score between 0 and 10)
  and (saison   is null or saison   between 0 and 100000)
  and (episode  is null or episode  between 0 and 100000)
  and (total_ep is null or total_ep between 0 and 100000)
) not valid;
alter table public.watchlist_items validate constraint watchlist_items_tailles_check;

alter table public.profiles drop constraint if exists profiles_tailles_check;
alter table public.profiles add constraint profiles_tailles_check check (
      length(coalesce(name, '')) <= 100
  and length(coalesce(avatar, '')) <= 500
  and length(coalesce(avatar_color, '')) <= 32
  and (plex_webhook_token is null or plex_webhook_token ~ '^[0-9a-f]{48}$')
) not valid;
alter table public.profiles validate constraint profiles_tailles_check;

-- Nombre maximal de titres par profil (doublons et supprimés logiques compris).
create or replace function public.watchlist_items_limite()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.watchlist_items where profile_id = new.profile_id) >= 20000 then
    raise exception 'Limite de 20 000 titres atteinte pour ce compte' using errcode = '54000';
  end if;
  return new;
end;
$$;
revoke all on function public.watchlist_items_limite() from public, anon, authenticated;
drop trigger if exists tr_watchlist_items_limite on public.watchlist_items;
create trigger tr_watchlist_items_limite
  before insert on public.watchlist_items
  for each row execute function public.watchlist_items_limite();

-- -----------------------------------------------------------------------------
-- 5. Colonnes de profiles modifiables par l'utilisateur
--    is_manager, has_pin, pin_hash (restes de laco-app) et account_id ne sont plus
--    modifiables depuis le navigateur. L'app n'insère que (account_id, name) et ne
--    met à jour que plex_webhook_token (et éventuellement name/avatar).
-- -----------------------------------------------------------------------------
revoke insert, update on table public.profiles from authenticated;
grant insert (account_id, name) on table public.profiles to authenticated;
grant update (name, avatar, avatar_color, plex_webhook_token) on table public.profiles to authenticated;

commit;

-- -----------------------------------------------------------------------------
-- Vérifications conseillées après exécution (lecture seule) :
--   select * from public.api_quota_limits;
--   select proname, proacl from pg_proc where pronamespace = 'public'::regnamespace;
--     -- consume_api_quota / delete_my_account : EXECUTE pour authenticated seulement
--   select conname from pg_constraint where conname like '%tailles_check';
-- Ajuster un quota : update public.api_quota_limits set per_user_daily = 6000 where bucket = 'tmdb';
-- -----------------------------------------------------------------------------
