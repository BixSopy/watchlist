-- =============================================================================
-- Watchlist Ciné Premium — schéma PostgreSQL Supabase (état cible)
-- Projet : batfulcvvquffgfeppcx (eu-central-1, Postgres 17)
--
-- Reflète la base après les migrations
-- supabase/migrations/20260925151457_nettoyage_et_securite.sql,
-- supabase/migrations/20261006000550_plex_webhook_token_and_mark_watched.sql,
-- supabase/migrations/20261006054213_mark_watched_by_title.sql,
-- supabase/migrations/20261008100000_ouverture_publique.sql (quotas, cache, suppression
-- de compte, garde-fous de taille ; recopiée telle quelle en fin de fichier) et
-- supabase/migrations/20261008120000_mark_watched_fiable.sql (correspondance par titre fiable) et
-- supabase/migrations/20261008150000_import_historique.sql et
-- supabase/migrations/20261008160000_titres_detectes.sql (titres détectés par l'extension, onglet
-- « Détectés ») et supabase/migrations/20261008210000_feedback.sql (avis des utilisateurs) et
-- supabase/migrations/20261008220000_tmdb_quota_8000.sql (quota TMDB 8 000/jour) ;
-- recopiées telles quelles en fin de fichier.
-- Sert de référence pour recréer le projet ; ne pas exécuter sur la base existante.
-- Tables : profiles, watchlist_items, keep_alive, api_quota_limits, api_usage,
-- api_usage_global, api_cache, detected_media, feedback. Aucun reste de laco-app
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
-- Au plus une ligne par heure : l'insertion est ouverte à anon (clé publique), sans cette
-- limite n'importe qui pourrait remplir la base (migration 20261008100000, section 6).
create unique index keep_alive_une_par_heure
  on public.keep_alive ((date_trunc('hour', pinged_at at time zone 'utc')));

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
-- FONCTIONS : normalize_title_for_match + mark_watched_by_title — extension navigateur
-- Variante par titre de mark_watched_by_token() (pas de tmdb_id côté extension, clé TMDB
-- jamais exposée). État après 20261008120000_mark_watched_fiable.sql : titre normalisé
-- (minuscules, accents, ponctuation, article initial, année entre parenthèses), égalité
-- exacte uniquement, type vérifié, résultat jsonb (updated / already_up_to_date / not_found /
-- ambiguous / invalid_token / invalid_input).
-- -----------------------------------------------------------------------------
create or replace function public.normalize_title_for_match(p_title text)
returns text
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v text;
begin
  if p_title is null then
    return null;
  end if;
  -- Ligatures (plusieurs lettres), puis accents latins (majuscules et minuscules, indépendant de la
  -- locale de la base), puis minuscules.
  v := replace(replace(replace(replace(replace(p_title, 'Œ', 'oe'), 'œ', 'oe'), 'Æ', 'ae'), 'æ', 'ae'), 'ß', 'ss');
  v := translate(v,
    'ÀÁÂÃÄÅĀĂĄÇĆĈĊČĎĐÈÉÊËĒĔĖĘĚĜĞĠĢĤĦÌÍÎÏĨĪĬĮİĴĶĹĻĽĿŁÑŃŅŇÒÓÔÕÖØŌŎŐŔŖŘŚŜŞŠŢŤŦÙÚÛÜŨŪŬŮŰŲŴÝŸŶŹŻŽ'
    || 'àáâãäåāăąçćĉċčďđèéêëēĕėęěĝğġģĥħìíîïĩīĭįıĵķĺļľŀłñńņňòóôõöøōŏőŕŗřśŝşšţťŧùúûüũūŭůűųŵýÿŷźżž',
    'AAAAAAAAACCCCCDDEEEEEEEEEGGGGHHIIIIIIIIIJKLLLLLNNNNOOOOOOOOORRRSSSSTTTUUUUUUUUUUWYYYZZZ'
    || 'aaaaaaaaacccccddeeeeeeeeegggghhiiiiiiiiijklllllnnnnooooooooorrrsssstttuuuuuuuuuuwyyyzzz');
  v := lower(v);
  -- Année entre parenthèses ou crochets en fin de titre : « Dune (2021) » -> « Dune ».
  -- (Une année nue n'est PAS retirée : « 1917 », « Blade Runner 2049 » sont des titres.)
  v := regexp_replace(v, '\s*[\(\[]\s*(18|19|20)[0-9]{2}\s*[\)\]]\s*$', '');
  -- Ponctuation et espaces (liste explicite : même résultat quelle que soit la locale) -> espace.
  -- Les lettres de toutes les écritures (japonais, etc.) et les chiffres sont conservés.
  v := regexp_replace(v, '[][[:space:]!"#$%&''()*+,./:;<=>?@\\^_`{|}~’‘‛`´“”„«»‹›¡¿…–—―·•°-]+', ' ', 'g');
  v := btrim(v);
  -- Article initial (anglais, français) : « The Office » = « Office », « L'Odyssée » = « Odyssée ».
  -- Jamais si le titre ne contient que l'article (« Les » reste « les »).
  v := regexp_replace(v, '^(the|le|la|les|l) (.)', '\2');
  return nullif(v, '');
end;
$$;

revoke all on function public.normalize_title_for_match(text) from public;
revoke all on function public.normalize_title_for_match(text) from anon, authenticated;


-- mark_watched_by_title : extension navigateur (Netflix). Correspondance exacte sur le titre
-- normalisé, type vérifié, aucune modification si 0 ou plusieurs titres correspondent.
create or replace function public.mark_watched_by_title(
  p_token text,
  p_title text,
  p_season integer,
  p_episode integer,
  p_type text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid;
  v_norm text;
  v_is_episode boolean;
  v_count integer;
  v_item record;
  v_updated integer;
begin
  if p_token is null or p_token = '' then
    return jsonb_build_object('status', 'invalid_token');
  end if;

  select id into v_profile_id from public.profiles where plex_webhook_token = p_token;
  if v_profile_id is null then
    return jsonb_build_object('status', 'invalid_token');
  end if;

  -- Type : explicite (extension 0.4.0+) ou déduit (extension 0.3.0 : saison+épisode = épisode)
  if p_type is null then
    v_is_episode := p_season is not null and p_episode is not null;
  elsif p_type = 'episode' then
    v_is_episode := true;
  elsif p_type = 'movie' then
    v_is_episode := false;
  else
    return jsonb_build_object('status', 'invalid_input');
  end if;

  v_norm := public.normalize_title_for_match(p_title);
  if v_norm is null or length(p_title) > 300
     or (v_is_episode and (p_season is null or p_episode is null or p_season < 0 or p_episode < 0))
     or (not v_is_episode and (p_season is not null or p_episode is not null)) then
    return jsonb_build_object('status', 'invalid_input');
  end if;

  -- Titres candidats : même profil, non supprimés, bon type, même titre normalisé
  select count(*) into v_count
  from public.watchlist_items w
  where w.profile_id = v_profile_id
    and w.deleted = false
    and (case when v_is_episode then w.type in ('serie', 'anime') else w.type = 'film' end)
    and public.normalize_title_for_match(w.title) = v_norm;

  if v_count = 0 then
    return jsonb_build_object('status', 'not_found', 'title', p_title, 'season', p_season, 'episode', p_episode);
  elsif v_count > 1 then
    return jsonb_build_object('status', 'ambiguous', 'title', p_title, 'season', p_season, 'episode', p_episode, 'count', v_count);
  end if;

  select w.id, w.title, w.saison, w.episode, w.status into v_item
  from public.watchlist_items w
  where w.profile_id = v_profile_id
    and w.deleted = false
    and (case when v_is_episode then w.type in ('serie', 'anime') else w.type = 'film' end)
    and public.normalize_title_for_match(w.title) = v_norm;

  if v_is_episode then
    -- Episode vu : avance la progression, jamais en arrière (un revisionnage ne fait pas régresser)
    update public.watchlist_items
    set saison = p_season,
        episode = p_episode,
        status = case when status in ('avoir', 'todo') then 'encours' else status end
    where id = v_item.id
      and (saison is null or episode is null
           or p_season > saison
           or (p_season = saison and p_episode > episode)
           or (p_season = saison and p_episode = episode and status in ('avoir', 'todo')));
  else
    -- Film vu : terminé
    update public.watchlist_items
    set status = 'termine'
    where id = v_item.id and status <> 'termine';
  end if;

  get diagnostics v_updated = row_count;
  if v_updated > 0 then
    return jsonb_build_object('status', 'updated', 'title', v_item.title, 'season', p_season, 'episode', p_episode);
  end if;
  return jsonb_build_object('status', 'already_up_to_date', 'title', v_item.title,
    'season', case when v_is_episode then v_item.saison end,
    'episode', case when v_is_episode then v_item.episode end);
end;
$$;

revoke all on function public.mark_watched_by_title(text, text, integer, integer, text) from public;
grant execute on function public.mark_watched_by_title(text, text, integer, integer, text) to anon, authenticated;

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
--    tmdb : appels réels à TMDB via /api/tmdb (hits du cache mémoire serveur gratuits) ;
--    omdb : uniquement les appels réels à OMDb (les réponses en cache ne comptent pas).
--    La clé OMDb gratuite autorise 1 000 requêtes/jour : 900 laissent une marge.
-- -----------------------------------------------------------------------------
create table if not exists public.api_quota_limits (
  bucket          text primary key check (bucket ~ '^[a-z_]{1,32}$'),
  per_user_daily  integer not null check (per_user_daily > 0),
  global_daily    integer check (global_daily > 0)
);
insert into public.api_quota_limits (bucket, per_user_daily, global_daily) values
  ('tmdb', 8000, null),
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
-- Ajuster un quota : update public.api_quota_limits set per_user_daily = 8000 where bucket = 'tmdb';
-- -----------------------------------------------------------------------------

-- =============================================================================
-- MIGRATION 20261008150000_import_historique.sql (recopiée telle quelle)
-- =============================================================================
-- Extension navigateur 0.5.0 : import de l'historique Netflix (et du fichier CSV Netflix).
--
-- Principe (vie privée) : l'historique Netflix ne quitte jamais le navigateur. L'extension
-- récupère la liste des titres de l'utilisateur (titre normalisé, type, progression, tmdb_id),
-- fait la correspondance elle-même, montre un aperçu, et n'envoie à Supabase QUE les
-- changements que l'utilisateur a cochés puis validés (« Appliquer ») : identifiant du titre +
-- saison/épisode, ou fiche TMDB d'un nouveau titre à ajouter. Pas de dates de visionnage,
-- pas de liste complète de ce qui a été regardé.
--
-- Trois fonctions, toutes authentifiées par le jeton de suivi (profiles.plex_webhook_token, le
-- même que Tautulli et l'extension), SECURITY DEFINER, search_path figé, bornées au profil du
-- jeton, exécutables par anon et authenticated. Le jeton est vérifié en un seul endroit,
-- extension_profile_for_token() (non appelable par les clients) : le jour où l'extension aura un
-- jeton par appareil (appairage sans copier-coller), seule cette fonction changera.
--
--  1. extension_list_titles(p_token) : titres non supprimés du profil (5 000 max) avec leur titre
--     normalisé (public.normalize_title_for_match) pour la correspondance côté extension.
--  2. extension_apply_import(p_token, p_updates, p_inserts) : applique un lot.
--       - p_updates : tableau (500 max) de {id, kind: 'episode'|'movie', season, episode}.
--         Mêmes règles que mark_watched_by_title : un épisode ne touche qu'une série/un anime,
--         un film qu'un film ; la progression n'avance que vers l'avant ; « à voir »/« à faire »
--         passe « en cours » ; un film passe « terminé ». Propriété revérifiée ligne par ligne.
--       - p_inserts : tableau (200 max) de nouveaux titres (fiche TMDB) : {tmdb_id, tmdb_type,
--         type, status: 'encours'|'termine', title, year, poster_path, overview, tmdb_score,
--         saison, episode, anime_genre}. Rien n'est ajouté si le même tmdb_id (même type TMDB)
--         est déjà dans la liste (non supprimé) : résultat « duplicate ».
--       - résultat par élément : updated | already_up_to_date | not_found | invalid, et
--         inserted | duplicate | invalid.
--  3. consume_api_quota_by_token(p_token, p_bucket, p_cost) : même quota quotidien que
--     consume_api_quota() (bucket « tmdb », compte du propriétaire du jeton), utilisé par le proxy
--     /api/tmdb quand l'extension cherche sur TMDB les titres absents de la liste. Le proxy
--     refuse la requête si cette fonction ne répond pas (pas de mode dégradé pour le jeton).
--
-- Aucune nouvelle table. Rejouable sans erreur (idempotente).

-- ---------------------------------------------------------------------------------------------
-- 0. Couche d'authentification de l'extension (un seul endroit à changer)
--    Aujourd'hui : jeton de suivi du profil (profiles.plex_webhook_token, 48 caractères hexa).
--    Plus tard (appairage par appareil, révocable) : seule cette fonction changera.
--    Non appelable directement par les clients.
-- ---------------------------------------------------------------------------------------------
create or replace function public.extension_profile_for_token(p_token text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id from public.profiles p
  where p_token ~ '^[0-9a-f]{48}$' and p.plex_webhook_token = p_token
  limit 1
$$;

revoke all on function public.extension_profile_for_token(text) from public;
revoke all on function public.extension_profile_for_token(text) from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 1. Titres de la liste, pour la correspondance côté extension
-- ---------------------------------------------------------------------------------------------
create or replace function public.extension_list_titles(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid;
  v_items jsonb;
begin
  v_profile_id := public.extension_profile_for_token(p_token);
  if v_profile_id is null then
    return jsonb_build_object('status', 'invalid_token');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', w.id,
           'title', w.title,
           'norm', public.normalize_title_for_match(w.title),
           'type', w.type,
           'status', w.status,
           'season', w.saison,
           'episode', w.episode,
           'tmdb_id', w.tmdb_id,
           'tmdb_type', w.tmdb_type,
           'year', w.year,
           'poster_path', w.poster_path
         ) order by w.added_at desc), '[]'::jsonb)
    into v_items
  from (
    select * from public.watchlist_items
    where profile_id = v_profile_id and deleted = false
    order by added_at desc
    limit 5000
  ) w;

  return jsonb_build_object('status', 'ok', 'items', v_items);
end;
$$;

revoke all on function public.extension_list_titles(text) from public;
grant execute on function public.extension_list_titles(text) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. Application d'un lot validé par l'utilisateur
-- ---------------------------------------------------------------------------------------------
create or replace function public.extension_apply_import(
  p_token text,
  p_updates jsonb default '[]'::jsonb,
  p_inserts jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid;
  v_u jsonb;
  v_i jsonb;
  v_id uuid;
  v_kind text;
  v_season integer;
  v_episode integer;
  v_rows integer;
  v_out_u jsonb := '[]'::jsonb;
  v_out_i jsonb := '[]'::jsonb;
  v_tmdb_id integer;
  v_tmdb_type text;
  v_type text;
  v_status text;
  v_title text;
  v_year text;
  v_poster text;
  v_overview text;
  v_score double precision;
  v_genre text;
  v_new_id uuid;
begin
  v_profile_id := public.extension_profile_for_token(p_token);
  if v_profile_id is null then
    return jsonb_build_object('status', 'invalid_token');
  end if;

  p_updates := coalesce(p_updates, '[]'::jsonb);
  p_inserts := coalesce(p_inserts, '[]'::jsonb);
  if jsonb_typeof(p_updates) <> 'array' or jsonb_typeof(p_inserts) <> 'array'
     or jsonb_array_length(p_updates) > 500 or jsonb_array_length(p_inserts) > 200 then
    return jsonb_build_object('status', 'invalid_input');
  end if;

  -- ---------- Mises à jour de titres existants ----------
  for v_u in select value from jsonb_array_elements(p_updates) loop
    begin
      if jsonb_typeof(v_u) <> 'object' or jsonb_typeof(v_u -> 'id') <> 'string' then
        raise exception using errcode = '22023';
      end if;
      v_id := (v_u ->> 'id')::uuid;
      v_kind := coalesce(v_u ->> 'kind', '');
      v_season := case when jsonb_typeof(v_u -> 'season') = 'number' then (v_u ->> 'season')::integer end;
      v_episode := case when jsonb_typeof(v_u -> 'episode') = 'number' then (v_u ->> 'episode')::integer end;
      if v_kind = 'episode' then
        if v_season is null or v_episode is null or v_season < 0 or v_episode < 0
           or v_season > 100000 or v_episode > 100000 then
          raise exception using errcode = '22023';
        end if;
      elsif v_kind <> 'movie' then
        raise exception using errcode = '22023';
      end if;
    exception when others then
      v_out_u := v_out_u || jsonb_build_object('id', v_u -> 'id', 'result', 'invalid');
      continue;
    end;

    -- Propriété et type revérifiés : le titre doit appartenir au profil du jeton
    if not exists (select 1 from public.watchlist_items w
                   where w.id = v_id and w.profile_id = v_profile_id and w.deleted = false
                     and (case when v_kind = 'episode' then w.type in ('serie', 'anime') else w.type = 'film' end)) then
      v_out_u := v_out_u || jsonb_build_object('id', v_id, 'result', 'not_found');
      continue;
    end if;

    if v_kind = 'episode' then
      update public.watchlist_items
      set saison = v_season,
          episode = v_episode,
          status = case when status in ('avoir', 'todo') then 'encours' else status end
      where id = v_id and profile_id = v_profile_id
        and (saison is null or episode is null
             or v_season > saison
             or (v_season = saison and v_episode > episode)
             or (v_season = saison and v_episode = episode and status in ('avoir', 'todo')));
    else
      update public.watchlist_items
      set status = 'termine'
      where id = v_id and profile_id = v_profile_id and status <> 'termine';
    end if;
    get diagnostics v_rows = row_count;
    v_out_u := v_out_u || jsonb_build_object('id', v_id,
      'result', case when v_rows > 0 then 'updated' else 'already_up_to_date' end);
  end loop;

  -- ---------- Nouveaux titres (fiche TMDB) ----------
  for v_i in select value from jsonb_array_elements(p_inserts) loop
    begin
      if jsonb_typeof(v_i) <> 'object' or jsonb_typeof(v_i -> 'tmdb_id') <> 'number' then
        raise exception using errcode = '22023';
      end if;
      v_tmdb_id := (v_i ->> 'tmdb_id')::integer;
      v_tmdb_type := coalesce(v_i ->> 'tmdb_type', '');
      v_type := coalesce(v_i ->> 'type', '');
      v_status := coalesce(v_i ->> 'status', '');
      v_title := btrim(coalesce(v_i ->> 'title', ''));
      v_year := nullif(btrim(coalesce(v_i ->> 'year', '')), '');
      v_poster := nullif(v_i ->> 'poster_path', '');
      v_overview := coalesce(v_i ->> 'overview', '');
      v_score := case when jsonb_typeof(v_i -> 'tmdb_score') = 'number' then (v_i ->> 'tmdb_score')::double precision end;
      v_genre := nullif(v_i ->> 'anime_genre', '');
      v_season := case when jsonb_typeof(v_i -> 'saison') = 'number' then (v_i ->> 'saison')::integer end;
      v_episode := case when jsonb_typeof(v_i -> 'episode') = 'number' then (v_i ->> 'episode')::integer end;

      if v_tmdb_id is null or v_tmdb_id <= 0
         or v_title = '' or length(v_title) > 500
         or (v_year is not null and v_year !~ '^[0-9]{4}$')
         or (v_poster is not null and v_poster !~ '^/[A-Za-z0-9_.-]{1,200}$')
         or length(v_overview) > 10000
         or (v_score is not null and (v_score < 0 or v_score > 10))
         or v_status not in ('encours', 'termine')
         or (v_genre is not null and v_genre not in ('shonen', 'seinen', 'shojo', 'isekai', 'slice', 'autre')) then
        raise exception using errcode = '22023';
      end if;
      if v_tmdb_type = 'movie' then
        -- Film : terminé, sans saison/épisode ni genre anime
        if v_type <> 'film' or v_status <> 'termine' or v_season is not null or v_episode is not null or v_genre is not null then
          raise exception using errcode = '22023';
        end if;
      elsif v_tmdb_type = 'tv' then
        if v_type not in ('serie', 'anime') or v_season is null or v_episode is null
           or v_season < 0 or v_episode < 0 or v_season > 100000 or v_episode > 100000
           or (v_type = 'serie' and v_genre is not null) then
          raise exception using errcode = '22023';
        end if;
      else
        raise exception using errcode = '22023';
      end if;
    exception when others then
      v_out_i := v_out_i || jsonb_build_object('tmdb_id', v_i -> 'tmdb_id', 'result', 'invalid');
      continue;
    end;

    -- Pas de doublon : même fiche TMDB déjà dans la liste (y compris ajoutée plus haut dans ce lot)
    if exists (select 1 from public.watchlist_items w
               where w.profile_id = v_profile_id and w.deleted = false
                 and w.tmdb_id = v_tmdb_id and w.tmdb_type = v_tmdb_type) then
      v_out_i := v_out_i || jsonb_build_object('tmdb_id', v_tmdb_id, 'result', 'duplicate');
      continue;
    end if;

    insert into public.watchlist_items (local_id, profile_id, tmdb_id, tmdb_type, type, status, title, year,
                                        poster_path, tmdb_score, overview, tags, saison, episode, total_ep,
                                        anime_genre, has_new_ep, deleted)
    values ('nf' || replace(gen_random_uuid()::text, '-', ''), v_profile_id, v_tmdb_id, v_tmdb_type, v_type,
            v_status, v_title, coalesce(v_year, ''), v_poster, v_score, v_overview, '{}', v_season, v_episode, null,
            v_genre, false, false)
    returning id into v_new_id;
    v_out_i := v_out_i || jsonb_build_object('tmdb_id', v_tmdb_id, 'result', 'inserted', 'id', v_new_id);
  end loop;

  return jsonb_build_object('status', 'ok', 'updates', v_out_u, 'inserts', v_out_i);
end;
$$;

revoke all on function public.extension_apply_import(text, jsonb, jsonb) from public;
grant execute on function public.extension_apply_import(text, jsonb, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. Quota TMDB du propriétaire du jeton (proxy /api/tmdb appelé par l'extension)
-- ---------------------------------------------------------------------------------------------
create or replace function public.consume_api_quota_by_token(p_token text, p_bucket text, p_cost integer default 1)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid;
  v_day    date := (now() at time zone 'utc')::date;
  v_lim    public.api_quota_limits%rowtype;
  v_user   integer;
  v_global integer;
begin
  select p.account_id into v_uid from public.profiles p where p.id = public.extension_profile_for_token(p_token);
  if v_uid is null then
    return jsonb_build_object('allowed', false, 'scope', 'invalid_token');
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

  return jsonb_build_object('allowed', true, 'used', v_user, 'limit', v_lim.per_user_daily);
end;
$$;

revoke all on function public.consume_api_quota_by_token(text, text, integer) from public;
grant execute on function public.consume_api_quota_by_token(text, text, integer) to anon, authenticated;

notify pgrst, 'reload schema';

-- =============================================================================
-- MIGRATION 20261008160000_titres_detectes.sql (recopiée telle quelle)
-- =============================================================================
-- Titres détectés par l'extension (historique Netflix, fichier CSV Netflix, détection en direct ;
-- plus tard Crunchyroll et Prime), affichés dans l'onglet « Détectés » de Cinepisode.
--
-- Nouveau fonctionnement (remplace l'aperçu dans une page de l'extension) :
--   1. l'extension lit l'historique (dans le navigateur), regroupe par titre et envoie ce qu'elle a
--      détecté avec extension_push_detections(p_token, p_items) : titre, film/série, dernier
--      épisode vu, date, pourcentage vu. Rien d'autre (pas d'identifiant Netflix, pas de liste
--      d'épisodes) ;
--   2. Cinepisode (session de l'utilisateur, RLS) lit ses détections, fait la correspondance avec
--      la liste, cherche les nouveaux titres sur TMDB (proxy habituel, quota du compte) et ajoute
--      ou met à jour les titres choisis avec le code d'ajout normal du site ;
--   3. chaque détection passe ensuite à « added » ou « ignored », ou est effacée.
--
-- Table public.detected_media :
--   - une ligne par (compte, film/série, titre normalisé, saison, épisode) : une même détection
--     renvoyée plusieurs fois ne crée pas de doublon, on garde la date de visionnage la plus récente ;
--   - RLS : le propriétaire (auth.uid() = user_id) peut lire, changer l'état (colonne state
--     seulement) et effacer ses lignes ; personne ne peut en insérer directement : seule la
--     fonction à jeton extension_push_detections() écrit (1 000 éléments par appel au plus,
--     20 000 lignes par compte au plus) ;
--   - un titre ignoré le reste : une nouvelle détection du même titre arrive directement « ignored ».
--
-- Le jeton reste vérifié en un seul endroit : extension_profile_for_token() (migration
-- 20261008150000), à remplacer le jour où l'extension aura un jeton par appareil.
--
-- Surface réduite : les fonctions de la migration 20261008150000 qui servaient à l'ancienne page
-- de l'extension (extension_list_titles, extension_apply_import, consume_api_quota_by_token)
-- sont supprimées. Les recherches TMDB se font désormais depuis le site avec la session.
--
-- Rejouable sans erreur (idempotente).

-- ---------------------------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------------------------
create table if not exists public.detected_media (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  source           text not null check (source in ('netflix', 'netflix_csv', 'crunchyroll', 'prime', 'live')),
  raw_title        text not null check (length(raw_title) between 1 and 500),
  normalized_title text not null check (length(normalized_title) between 1 and 500),
  media_type       text not null check (media_type in ('movie', 'show')),
  season           integer check (season is null or season between 0 and 100000),
  episode          integer check (episode is null or episode between 0 and 100000),
  watched_at       timestamptz,
  progress_pct     smallint check (progress_pct is null or progress_pct between 0 and 100),
  state            text not null default 'pending' check (state in ('pending', 'added', 'ignored')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (media_type = 'show' or (season is null and episode is null))
);

-- Clé indépendante de la source : la même détection venue de Netflix puis du CSV = une seule ligne
create unique index if not exists detected_media_cle
  on public.detected_media (user_id, media_type, normalized_title, coalesce(season, -1), coalesce(episode, -1));
create index if not exists detected_media_user_state on public.detected_media (user_id, state);

drop trigger if exists tr_detected_media_updated_at on public.detected_media;
create trigger tr_detected_media_updated_at
  before update on public.detected_media
  for each row execute function public.update_timestamp();

-- ---------------------------------------------------------------------------------------------
-- 2. RLS et droits : lecture / changement d'état / effacement par le propriétaire uniquement
-- ---------------------------------------------------------------------------------------------
alter table public.detected_media enable row level security;

drop policy if exists "detected_media select owner" on public.detected_media;
drop policy if exists "detected_media update owner" on public.detected_media;
drop policy if exists "detected_media delete owner" on public.detected_media;
create policy "detected_media select owner" on public.detected_media
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "detected_media update owner" on public.detected_media
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "detected_media delete owner" on public.detected_media
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on table public.detected_media from public, anon, authenticated;
grant select, delete on table public.detected_media to authenticated;
grant update (state) on table public.detected_media to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. Envoi des détections par l'extension (jeton de suivi)
--    p_items : tableau (1 000 max) de
--      {source, title, type: 'movie'|'show', season, episode, watched_at (ms), progress_pct}
--    Résultat : {status:'ok', inserted, updated, unchanged, invalid} | invalid_token | invalid_input | limit
-- ---------------------------------------------------------------------------------------------
create or replace function public.extension_push_detections(p_token text, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid;
  v_user_id uuid;
  v_it jsonb;
  v_source text;
  v_title text;
  v_norm text;
  v_type text;
  v_season integer;
  v_episode integer;
  v_watched timestamptz;
  v_pct smallint;
  v_state text;
  v_inserted boolean;
  v_n_ins integer := 0;
  v_n_upd integer := 0;
  v_n_same integer := 0;
  v_n_bad integer := 0;
begin
  v_profile_id := public.extension_profile_for_token(p_token);
  if v_profile_id is null then
    return jsonb_build_object('status', 'invalid_token');
  end if;
  select p.account_id into v_user_id from public.profiles p where p.id = v_profile_id;
  if v_user_id is null then
    return jsonb_build_object('status', 'invalid_token');
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 1000 then
    return jsonb_build_object('status', 'invalid_input');
  end if;
  if (select count(*) from public.detected_media d where d.user_id = v_user_id) + jsonb_array_length(p_items) > 20000 then
    return jsonb_build_object('status', 'limit', 'limit', 20000);
  end if;

  for v_it in select value from jsonb_array_elements(p_items) loop
    begin
      if jsonb_typeof(v_it) <> 'object' or jsonb_typeof(v_it -> 'title') <> 'string' then
        raise exception using errcode = '22023';
      end if;
      v_source := coalesce(v_it ->> 'source', '');
      v_title := btrim(v_it ->> 'title');
      v_type := coalesce(v_it ->> 'type', '');
      v_season := case when jsonb_typeof(v_it -> 'season') = 'number' then (v_it ->> 'season')::integer end;
      v_episode := case when jsonb_typeof(v_it -> 'episode') = 'number' then (v_it ->> 'episode')::integer end;
      v_watched := case when jsonb_typeof(v_it -> 'watched_at') = 'number'
                        then to_timestamp((v_it ->> 'watched_at')::double precision / 1000.0) end;
      v_pct := case when jsonb_typeof(v_it -> 'progress_pct') = 'number'
                    then round((v_it ->> 'progress_pct')::numeric)::smallint end;
      if v_source not in ('netflix', 'netflix_csv', 'crunchyroll', 'prime', 'live')
         or v_title = '' or length(v_title) > 500
         or v_type not in ('movie', 'show')
         or (v_type = 'movie' and (v_season is not null or v_episode is not null))
         or (v_season is not null and (v_season < 0 or v_season > 100000))
         or (v_episode is not null and (v_episode < 0 or v_episode > 100000))
         or (v_pct is not null and (v_pct < 0 or v_pct > 100)) then
        raise exception using errcode = '22023';
      end if;
      -- Date hors bornes (avant 2000 ou dans le futur) : ignorée, la détection reste valable
      if v_watched is not null and (v_watched < '2000-01-01'::timestamptz or v_watched > now() + interval '1 day') then
        v_watched := null;
      end if;
      v_norm := public.normalize_title_for_match(v_title);
      if v_norm is null or v_norm = '' or length(v_norm) > 500 then
        raise exception using errcode = '22023';
      end if;
    exception when others then
      v_n_bad := v_n_bad + 1;
      continue;
    end;

    -- Titre déjà ignoré par l'utilisateur : il le reste
    v_state := case when exists (select 1 from public.detected_media d
                                 where d.user_id = v_user_id and d.media_type = v_type
                                   and d.normalized_title = v_norm and d.state = 'ignored')
                    then 'ignored' else 'pending' end;

    v_inserted := null;
    insert into public.detected_media as d (user_id, source, raw_title, normalized_title, media_type,
                                            season, episode, watched_at, progress_pct, state)
    values (v_user_id, v_source, v_title, v_norm, v_type, v_season, v_episode, v_watched, v_pct, v_state)
    on conflict (user_id, media_type, normalized_title, coalesce(season, -1), coalesce(episode, -1))
    do update set source = excluded.source,
                  raw_title = excluded.raw_title,
                  watched_at = excluded.watched_at,
                  progress_pct = excluded.progress_pct
      where excluded.watched_at is not null and (d.watched_at is null or excluded.watched_at > d.watched_at)
    returning (xmax = 0) into v_inserted;

    if v_inserted is null then
      v_n_same := v_n_same + 1;
    elsif v_inserted then
      v_n_ins := v_n_ins + 1;
    else
      v_n_upd := v_n_upd + 1;
    end if;
  end loop;

  return jsonb_build_object('status', 'ok', 'inserted', v_n_ins, 'updated', v_n_upd,
                            'unchanged', v_n_same, 'invalid', v_n_bad);
end;
$$;

revoke all on function public.extension_push_detections(text, jsonb) from public;
grant execute on function public.extension_push_detections(text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. Fonctions de l'ancienne page de l'extension, devenues inutiles
-- ---------------------------------------------------------------------------------------------
drop function if exists public.extension_list_titles(text);
drop function if exists public.extension_apply_import(text, jsonb, jsonb);
drop function if exists public.consume_api_quota_by_token(text, text, integer);

notify pgrst, 'reload schema';

-- =============================================================================
-- MIGRATION 20261008210000_feedback.sql (recopiée telle quelle)
-- =============================================================================
-- =============================================================================
-- Avis des utilisateurs (« Donner mon avis ») : table public.feedback + fonctions serveur.
-- Projet Supabase : batfulcvvquffgfeppcx
--
-- Fonctionnement :
--   1. le site envoie l'avis à la fonction Vercel /api/feedback (jamais directement à Supabase) ;
--   2. /api/feedback valide, filtre les robots (champ piège, délai minimum), calcule une empreinte
--      d'IP (HMAC tronqué, renouvelé chaque jour, jamais l'IP en clair), puis appelle
--      submit_feedback() avec la clé secrète (rôle service_role) ;
--   3. submit_feedback() revérifie tout, applique les limites (par profil, par empreinte d'IP et
--      globale), enregistre l'avis et indique si un email de notification peut partir ;
--   4. /api/feedback envoie l'email (Resend) puis appelle feedback_mark_notified().
--
-- Confidentialité :
--   - RLS activée et AUCUNE politique : aucun client (anon, authenticated) ne peut lire, écrire
--     ni effacer la table ; seules les fonctions ci-dessous (service_role) et le tableau de bord
--     Supabase y accèdent ;
--   - profile_id facultatif (avis envoyé connecté) ; supprimer son compte efface ses avis (cascade) ;
--   - ip_hash sert uniquement aux limites : effacé après 2 jours ;
--   - conservation : 24 mois, puis suppression automatique (ménage à chaque nouvel avis).
--
-- Limites (modifiables ici) : 5 avis par heure et 20 par jour, par profil et par empreinte d'IP ;
-- 300 avis par jour au total ; emails de notification limités à 30 par jour (l'offre gratuite
-- Resend, 100 emails/jour, sert aussi aux emails de compte : ils doivent rester prioritaires).
--
-- Rejouable sans erreur (idempotente). Transactionnelle.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Table
-- -----------------------------------------------------------------------------
create table if not exists public.feedback (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  profile_id   uuid references public.profiles(id) on delete cascade,
  kind         text not null check (kind in ('idea', 'bug', 'other')),
  message      text not null check (length(btrim(message)) between 1 and 2000),
  reply_email  text check (reply_email is null or (length(reply_email) <= 254 and reply_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  page         text check (page is null or length(page) <= 200),
  app_version  text check (app_version is null or length(app_version) <= 40),
  user_agent   text check (user_agent is null or length(user_agent) <= 80),
  locale       text check (locale is null or locale ~ '^[a-z]{2}$'),
  ip_hash      text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{32,64}$'),
  notified_at  timestamptz
);
create index if not exists feedback_created_idx on public.feedback (created_at);
create index if not exists feedback_profile_idx on public.feedback (profile_id, created_at) where profile_id is not null;
create index if not exists feedback_ip_idx      on public.feedback (ip_hash, created_at) where ip_hash is not null;

-- -----------------------------------------------------------------------------
-- 2. RLS et droits : aucun accès client
-- -----------------------------------------------------------------------------
alter table public.feedback enable row level security;
revoke all on table public.feedback from public, anon, authenticated;
grant select, delete on table public.feedback to service_role;

-- -----------------------------------------------------------------------------
-- 3. Enregistrement d'un avis (appelée uniquement par /api/feedback, clé secrète)
--    p_account_id : compte de la session vérifiée par le serveur (null = sans compte)
--    Résultat : {status:'ok', id, notify} | {status:'invalid', field} |
--               {status:'rate_limited', scope:'profile'|'ip'|'global'}
-- -----------------------------------------------------------------------------
create or replace function public.submit_feedback(
  p_account_id  uuid,
  p_ip_hash     text,
  p_kind        text,
  p_message     text,
  p_reply_email text,
  p_page        text,
  p_app_version text,
  p_user_agent  text,
  p_locale      text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_msg     text := btrim(coalesce(p_message, ''));
  v_email   text := nullif(lower(btrim(coalesce(p_reply_email, ''))), '');
  v_ip      text := nullif(lower(btrim(coalesce(p_ip_hash, ''))), '');
  v_hour    integer;
  v_day     integer;
  v_global  integer;
  v_id      uuid;
begin
  if p_kind is null or p_kind not in ('idea', 'bug', 'other') then
    return jsonb_build_object('status', 'invalid', 'field', 'kind');
  end if;
  if length(v_msg) < 3 or length(v_msg) > 2000 then
    return jsonb_build_object('status', 'invalid', 'field', 'message');
  end if;
  if v_email is not null and (length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    return jsonb_build_object('status', 'invalid', 'field', 'reply_email');
  end if;
  if v_ip is not null and v_ip !~ '^[0-9a-f]{32,64}$' then
    return jsonb_build_object('status', 'invalid', 'field', 'ip_hash');
  end if;
  if p_locale is not null and p_locale !~ '^[a-z]{2}$' then
    return jsonb_build_object('status', 'invalid', 'field', 'locale');
  end if;

  if p_account_id is not null then
    select id into v_profile from public.profiles where account_id = p_account_id;
  end if;

  -- Un avis à la fois : les compteurs ci-dessous restent justes en cas d'envois simultanés
  perform pg_advisory_xact_lock(hashtext('public.submit_feedback'));

  if v_profile is not null then
    select count(*) filter (where created_at > now() - interval '1 hour'), count(*)
      into v_hour, v_day
      from public.feedback where profile_id = v_profile and created_at > now() - interval '1 day';
    if v_hour >= 5 or v_day >= 20 then
      return jsonb_build_object('status', 'rate_limited', 'scope', 'profile');
    end if;
  end if;
  if v_ip is not null then
    select count(*) filter (where created_at > now() - interval '1 hour'), count(*)
      into v_hour, v_day
      from public.feedback where ip_hash = v_ip and created_at > now() - interval '1 day';
    if v_hour >= 5 or v_day >= 20 then
      return jsonb_build_object('status', 'rate_limited', 'scope', 'ip');
    end if;
  end if;
  select count(*) into v_global from public.feedback where created_at > now() - interval '1 day';
  if v_global >= 300 then
    return jsonb_build_object('status', 'rate_limited', 'scope', 'global');
  end if;

  insert into public.feedback (profile_id, kind, message, reply_email, page, app_version, user_agent, locale, ip_hash)
  values (v_profile, p_kind, v_msg, v_email,
          nullif(left(btrim(coalesce(p_page, '')), 200), ''),
          nullif(left(btrim(coalesce(p_app_version, '')), 40), ''),
          nullif(left(btrim(coalesce(p_user_agent, '')), 80), ''),
          p_locale, v_ip)
  returning id into v_id;

  -- Ménage (pas de pg_cron sur ce projet) : empreintes d'IP après 2 jours, avis après 24 mois
  update public.feedback set ip_hash = null
   where ip_hash is not null and created_at < now() - interval '2 days';
  delete from public.feedback where created_at < now() - interval '24 months';

  return jsonb_build_object('status', 'ok', 'id', v_id,
    'notify', (select count(*) from public.feedback
                where notified_at is not null and notified_at > now() - interval '1 day') < 30);
end;
$$;

-- Email de notification envoyé : date enregistrée (sert aussi au plafond quotidien d'emails)
create or replace function public.feedback_mark_notified(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.feedback set notified_at = now() where id = p_id and notified_at is null;
$$;

revoke all on function public.submit_feedback(uuid, text, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.submit_feedback(uuid, text, text, text, text, text, text, text, text) to service_role;
revoke all on function public.feedback_mark_notified(uuid) from public, anon, authenticated;
grant execute on function public.feedback_mark_notified(uuid) to service_role;

commit;

notify pgrst, 'reload schema';
