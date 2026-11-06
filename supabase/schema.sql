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
-- supabase/migrations/20261008220000_tmdb_quota_8000.sql (quota TMDB 8 000/jour) et
-- supabase/migrations/20261013002047_appairage_appareils.sql (appairage, jeton par appareil) ;
-- recopiées telles quelles en fin de fichier.
-- Sert de référence pour recréer le projet ; ne pas exécuter sur la base existante.
-- Tables : profiles, watchlist_items, keep_alive, api_quota_limits, api_usage,
-- api_usage_global, api_cache, detected_media, feedback, extension_devices, shares. Aucun reste de laco-app
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
  plex_webhook_token text unique,               -- jeton de suivi auto -> mark_watched_by_title() (extension)
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
  -- Dernière fois réellement regardé (distinct de updated_at, qui sert aussi à la résolution de
  -- conflits de synchro et bouge pour des actions sans rapport avec le visionnage).
  last_watched_at    timestamptz,

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
-- FONCTIONS : normalize_title_for_match + mark_watched_by_title — extension navigateur
-- Retrait de mark_watched_by_token() (webhook Plex/Tautulli, Session 19) le 2026-10-26 :
-- trop complexe à configurer côté utilisateur et peu fiable. Le jeton de suivi
-- (profiles.plex_webhook_token) reste en place, il authentifie cette fonction-ci.
-- État après 20261008120000_mark_watched_fiable.sql : titre normalisé
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
-- Trois fonctions, toutes authentifiées par le jeton de suivi de l'extension
-- (profiles.plex_webhook_token), SECURITY DEFINER, search_path figé, bornées au profil du
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

-- =============================================================================================
-- 20261013002047_appairage_appareils.sql — Appairage site -> extension, jeton par appareil
-- NON APPLIQUÉE. À relire et valider par Pierre avant toute application.
--
-- Principe :
--  * Une ligne par appareil (navigateur où l'extension est installée), liée à un profil.
--  * Le jeton (32 octets aléatoires, 64 hexa, préfixe "cpd_") n'est JAMAIS stocké en clair :
--    seule son empreinte SHA-256 est en base. Il est renvoyé une seule fois au site qui le
--    transmet aussitôt à l'extension (chrome.runtime.sendMessage, externally_connectable).
--  * Révocation : revoked_at non nul => le jeton est refusé immédiatement partout.
--  * L'ancien jeton de suivi (profiles.plex_webhook_token) reste accepté pendant la transition
--    (extension <= 0.7.3). Il pourra être retiré plus tard.
--  * Rejouable (idempotente). Aucune donnée supprimée.
-- =============================================================================================

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.extension_devices (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references auth.users(id) on delete cascade,
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  token_hash    bytea not null unique,                 -- sha256(jeton), jamais le jeton
  label         text not null default 'Navigateur' check (char_length(label) between 1 and 60),
  browser       text check (browser is null or char_length(browser) <= 40),
  os            text check (os is null or char_length(os) <= 40),
  ext_version   text check (ext_version is null or ext_version ~ '^[0-9]+(\.[0-9]+){1,3}$'),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz,                           -- arrondi à l'heure (vie privée)
  revoked_at    timestamptz
);

create index if not exists extension_devices_account_idx on public.extension_devices(account_id);

alter table public.extension_devices enable row level security;

-- Lecture seule de SES appareils (jamais token_hash : colonne non accordée).
drop policy if exists extension_devices_select_own on public.extension_devices;
create policy extension_devices_select_own on public.extension_devices
  for select to authenticated using (account_id = auth.uid());

revoke all on table public.extension_devices from public, anon, authenticated;
grant select (id, profile_id, label, browser, os, ext_version, created_at, last_seen_at, revoked_at)
  on table public.extension_devices to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 1. Création d'un appareil (appelée par le site, utilisateur connecté, après clic
--    « Autoriser cet appareil »). Renvoie le jeton en clair UNE seule fois.
--    Limites : 10 appareils actifs par compte, 20 créations / 24 h.
-- ---------------------------------------------------------------------------------------------
create or replace function public.pair_extension_device(
  p_profile_id uuid, p_label text default null, p_browser text default null,
  p_os text default null, p_ext_version text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_token text;
  v_id uuid;
begin
  if v_uid is null then return jsonb_build_object('status', 'not_authenticated'); end if;
  if not exists (select 1 from public.profiles p where p.id = p_profile_id and p.account_id = v_uid) then
    return jsonb_build_object('status', 'invalid_profile');
  end if;
  if (select count(*) from public.extension_devices d where d.account_id = v_uid and d.revoked_at is null) >= 10 then
    return jsonb_build_object('status', 'too_many_devices');
  end if;
  if (select count(*) from public.extension_devices d where d.account_id = v_uid and d.created_at > now() - interval '24 hours') >= 20 then
    return jsonb_build_object('status', 'rate_limited');
  end if;

  v_token := 'cpd_' || encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.extension_devices(account_id, profile_id, token_hash, label, browser, os, ext_version)
  values (v_uid, p_profile_id, extensions.digest(v_token, 'sha256'),
          coalesce(nullif(left(btrim(p_label), 60), ''), 'Navigateur'),
          nullif(left(btrim(p_browser), 40), ''), nullif(left(btrim(p_os), 40), ''),
          case when p_ext_version ~ '^[0-9]+(\.[0-9]+){1,3}$' then p_ext_version end)
  returning id into v_id;

  return jsonb_build_object('status', 'ok', 'device_id', v_id, 'token', v_token);
end;
$$;
revoke all on function public.pair_extension_device(uuid, text, text, text, text) from public, anon;
grant execute on function public.pair_extension_device(uuid, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. Révocation (site, utilisateur connecté) — ne supprime rien, marque revoked_at.
-- ---------------------------------------------------------------------------------------------
create or replace function public.revoke_extension_device(p_device_id uuid)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  with u as (
    update public.extension_devices d set revoked_at = now()
    where d.id = p_device_id and d.account_id = auth.uid() and d.revoked_at is null
    returning d.id)
  select jsonb_build_object('status', case when exists (select 1 from u) then 'revoked' else 'not_found' end)
$$;
revoke all on function public.revoke_extension_device(uuid) from public, anon;
grant execute on function public.revoke_extension_device(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. Déconnexion depuis l'extension elle-même (le jeton se révoque lui-même).
-- ---------------------------------------------------------------------------------------------
create or replace function public.extension_unpair(p_token text)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  with u as (
    update public.extension_devices d set revoked_at = now()
    where p_token ~ '^cpd_[0-9a-f]{64}$' and d.token_hash = extensions.digest(p_token, 'sha256')
      and d.revoked_at is null
    returning d.id)
  select jsonb_build_object('status', case when exists (select 1 from u) then 'revoked' else 'invalid_token' end)
$$;
revoke all on function public.extension_unpair(text) from public;
grant execute on function public.extension_unpair(text) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. Couche d'authentification unique de l'extension (prévue pour ce jour-là, cf. migration
--    20261008150000) : jeton d'appareil non révoqué, OU ancien jeton de suivi (transition).
--    last_seen_at mis à jour au plus une fois par heure, arrondi à l'heure.
--    Devient VOLATILE (écriture) : appelée uniquement depuis des fonctions plpgsql volatiles.
-- ---------------------------------------------------------------------------------------------
create or replace function public.extension_profile_for_token(p_token text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
begin
  if p_token ~ '^cpd_[0-9a-f]{64}$' then
    update public.extension_devices d
       set last_seen_at = date_trunc('hour', now())
     where d.token_hash = extensions.digest(p_token, 'sha256') and d.revoked_at is null
       and (d.last_seen_at is null or d.last_seen_at < date_trunc('hour', now()));
    select d.profile_id into v_profile from public.extension_devices d
     where d.token_hash = extensions.digest(p_token, 'sha256') and d.revoked_at is null;
    return v_profile;
  end if;
  if p_token ~ '^[0-9a-f]{48}$' then
    select p.id into v_profile from public.profiles p where p.plex_webhook_token = p_token limit 1;
    return v_profile;
  end if;
  return null;
end;
$$;
revoke all on function public.extension_profile_for_token(text) from public;
revoke all on function public.extension_profile_for_token(text) from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. Vérification légère pour l'extension (statut « connecté », nom du profil).
-- ---------------------------------------------------------------------------------------------
create or replace function public.extension_whoami(p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare v_profile uuid := public.extension_profile_for_token(p_token); v_name text;
begin
  if v_profile is null then return jsonb_build_object('status', 'invalid_token'); end if;
  select p.name into v_name from public.profiles p where p.id = v_profile;
  return jsonb_build_object('status', 'ok', 'profile', left(coalesce(v_name, ''), 40));
end;
$$;
revoke all on function public.extension_whoami(text) from public;
grant execute on function public.extension_whoami(text) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 6. mark_watched_by_title : passe par la couche unique (seule ligne modifiée par rapport à
--    20261008120000_mark_watched_fiable.sql : la recherche du profil par jeton).
-- ---------------------------------------------------------------------------------------------
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

  v_profile_id := public.extension_profile_for_token(p_token);
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
    perform public._social_log_activity(v_profile_id, v_item.id, case when v_is_episode then 'episode' else 'film' end, p_season, p_episode);
    return jsonb_build_object('status', 'updated', 'title', v_item.title, 'season', p_season, 'episode', p_episode);
  end if;
  return jsonb_build_object('status', 'already_up_to_date', 'title', v_item.title,
    'season', case when v_is_episode then v_item.saison end,
    'episode', case when v_is_episode then v_item.episode end);
end;
$$;

revoke all on function public.mark_watched_by_title(text, text, integer, integer, text) from public;
grant execute on function public.mark_watched_by_title(text, text, integer, integer, text) to anon, authenticated;

-- =============================================================================
-- Migration 20261013150000_partage_lecture_seule.sql (liens de partage en lecture seule)
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.shares (
  id            uuid primary key default extensions.gen_random_uuid(),
  account_id    uuid not null references auth.users(id) on delete cascade,
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  token         text not null unique check (token ~ '^[A-Za-z0-9_-]{22}$'),
  kind          text not null check (kind in ('list', 'filtered', 'profile')),
  filter_status text[] check (filter_status is null or filter_status <@ array['avoir','encours','termine']),
  filter_types  text[] check (filter_types  is null or filter_types  <@ array['film','serie','anime']),
  hide_ratings  boolean not null default true,
  hide_progress boolean not null default false,
  display_name  text check (display_name is null or char_length(display_name) between 1 and 40),
  created_at    timestamptz not null default now(),
  revoked_at    timestamptz,
  view_count    integer not null default 0          -- agrégé : ni IP, ni user-agent, ni referrer
);
create index if not exists shares_profile_active_idx on public.shares(profile_id) where revoked_at is null;
create index if not exists shares_account_created_idx on public.shares(account_id, created_at);

alter table public.shares enable row level security;
revoke all on table public.shares from anon, authenticated;
grant select on table public.shares to authenticated;          -- écriture : uniquement via les fonctions

drop policy if exists shares_select_own on public.shares;
create policy shares_select_own on public.shares
  for select to authenticated using (account_id = (select auth.uid()));

-- ---------- Création ----------
create or replace function public.create_share(
  p_profile_id uuid, p_kind text,
  p_filter_status text[] default null, p_filter_types text[] default null,
  p_hide_ratings boolean default true, p_hide_progress boolean default false,
  p_display_name text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_tok text; v_name text; v_row public.shares;
begin
  if v_uid is null then return jsonb_build_object('status', 'not_authenticated'); end if;
  if not exists (select 1 from public.profiles p where p.id = p_profile_id and p.account_id = v_uid) then
    return jsonb_build_object('status', 'invalid_profile');
  end if;
  if p_kind is null or p_kind not in ('list', 'filtered', 'profile') then return jsonb_build_object('status', 'invalid_kind'); end if;
  if p_kind = 'filtered' and coalesce(cardinality(p_filter_status), 0) + coalesce(cardinality(p_filter_types), 0) = 0 then
    return jsonb_build_object('status', 'empty_filter');
  end if;
  if (select count(*) from public.shares s where s.profile_id = p_profile_id and s.revoked_at is null) >= 10 then
    return jsonb_build_object('status', 'too_many_shares');
  end if;
  if (select count(*) from public.shares s where s.account_id = v_uid and s.created_at > now() - interval '1 hour') >= 20 then
    return jsonb_build_object('status', 'rate_limited');
  end if;
  v_name := nullif(left(btrim(regexp_replace(coalesce(p_display_name, ''), '[[:cntrl:]<>]', '', 'g')), 40), '');
  v_tok := translate(rtrim(encode(extensions.gen_random_bytes(16), 'base64'), '='), '+/', '-_');
  insert into public.shares (account_id, profile_id, token, kind, filter_status, filter_types, hide_ratings, hide_progress, display_name)
  values (v_uid, p_profile_id, v_tok, p_kind,
          case when p_kind = 'filtered' then nullif(p_filter_status, '{}') end,
          case when p_kind = 'filtered' then nullif(p_filter_types, '{}') end,
          coalesce(p_hide_ratings, true), coalesce(p_hide_progress, false), v_name)
  returning * into v_row;
  return jsonb_build_object('status', 'ok', 'id', v_row.id, 'token', v_row.token);
exception when check_violation then
  return jsonb_build_object('status', 'invalid_filter');
end $$;

-- ---------- Révocation (définitive) ----------
create or replace function public.revoke_share(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('status', 'not_authenticated'); end if;
  update public.shares set revoked_at = now() where id = p_id and account_id = v_uid and revoked_at is null;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  return jsonb_build_object('status', 'ok');
end $$;

-- ---------- Lecture publique : champs publics uniquement ----------
create or replace function public.get_public_share(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.shares; v_items jsonb; v_stats jsonb;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{22}$' then return null; end if;
  select * into s from public.shares where token = p_token and revoked_at is null;
  if not found then return null; end if;              -- inconnu ou révoqué : même réponse

  select coalesce(jsonb_agg(jsonb_build_object(
           'tmdb_id', w.tmdb_id, 'tmdb_type', w.tmdb_type, 'type', w.type,
           'status', case when w.status = 'todo' then 'avoir' else w.status end,
           'title', w.title, 'year', w.year, 'poster_path', w.poster_path,
           'season',  case when s.hide_progress or w.type = 'film' then null else w.saison end,
           'episode', case when s.hide_progress or w.type = 'film' then null else w.episode end,
           'rating',  case when s.hide_ratings then null else nullif(w.my_rating, 0) end)
         order by w.updated_at desc nulls last), '[]'::jsonb)
    into v_items
    from (select * from public.watchlist_items i
           where i.profile_id = s.profile_id and not coalesce(i.deleted, false)
             and (s.filter_status is null or (case when i.status = 'todo' then 'avoir' else i.status end) = any(s.filter_status))
             and (s.filter_types  is null or i.type = any(s.filter_types))
           order by i.updated_at desc nulls last limit 500) w;

  if s.kind = 'profile' then
    select jsonb_build_object(
             'titles', count(*),
             'finished', count(*) filter (where i.status = 'termine'),
             'episodes', coalesce(sum(case when i.type <> 'film' then greatest(coalesce(i.episode, 0), 0) end), 0),
             'top_type', mode() within group (order by i.type))
      into v_stats
      from public.watchlist_items i where i.profile_id = s.profile_id and not coalesce(i.deleted, false);
  end if;

  update public.shares set view_count = view_count + 1 where id = s.id;
  return jsonb_build_object(
    'name', coalesce(s.display_name, ''), 'kind', s.kind,
    'filter_status', to_jsonb(s.filter_status), 'filter_types', to_jsonb(s.filter_types),
    'hide_ratings', s.hide_ratings, 'hide_progress', s.hide_progress,
    'stats', v_stats, 'items', v_items);
end $$;

revoke all on function public.create_share(uuid, text, text[], text[], boolean, boolean, text) from public, anon;
revoke all on function public.revoke_share(uuid) from public, anon;
revoke all on function public.get_public_share(text) from public;
grant execute on function public.create_share(uuid, text, text[], text[], boolean, boolean, text) to authenticated;
grant execute on function public.revoke_share(uuid) to authenticated;
grant execute on function public.get_public_share(text) to anon, authenticated;

-- =============================================================================
-- NOTE : la couche sociale « pseudo + amis » (étape 1, migrations 20261026120000 et
-- 20261026210000, PR #70→#75 de Grok) n'est pas mirroirée ci-dessus dans ce fichier — c'est un
-- écart préexistant à cette section, pas introduit ici. Les tables profiles.handle/invite_code,
-- friendships, friend_requests, blocks, social_settings, reserved_handles, social_rate et leurs
-- fonctions (_social_*, check_handle, set_handle, get_invite, send_friend_request,
-- set_social_settings, get_my_social, get_friend_view, etc.) n'existent donc QUE dans les
-- migrations, pas ici. La section ci-dessous (étape 2) en dépend directement : ce fichier seul,
-- sans les migrations correspondantes, ne suffit pas à la recréer.
-- =============================================================================
-- Migration 20261026230000_social_activite_reactions.sql (fil d'activité + réactions, étape 2)
-- =============================================================================

create table public.activity_events (
  id                 uuid primary key default extensions.gen_random_uuid(),
  profile_id         uuid not null references public.profiles(id) on delete cascade,
  watchlist_item_id  uuid not null references public.watchlist_items(id) on delete cascade,
  kind               text not null check (kind in ('episode', 'film')),
  season             integer,
  episode            integer,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check ((kind = 'film' and season is null and episode is null)
      or (kind = 'episode' and season is not null and episode is not null))
);
create index activity_events_profile_recent_idx on public.activity_events(profile_id, updated_at desc);
create index activity_events_item_idx on public.activity_events(watchlist_item_id);  -- conseil Supabase (20261026240000)
alter table public.activity_events enable row level security;
revoke all on table public.activity_events from anon, authenticated;

create table public.activity_reactions (
  event_id   uuid not null references public.activity_events(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  emoji      text not null check (emoji in ('👍', '❤️', '🔥', '😮', '😂', '🍿')),
  created_at timestamptz not null default now(),
  primary key (event_id, profile_id)
);
create index activity_reactions_profile_idx on public.activity_reactions(profile_id);  -- conseil Supabase (20261026240000)
alter table public.activity_reactions enable row level security;
revoke all on table public.activity_reactions from anon, authenticated;

create or replace function public._social_log_activity(
  p_profile_id uuid, p_item_id uuid, p_kind text, p_season integer, p_episode integer
)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  update public.activity_events
     set season = p_season, episode = p_episode, updated_at = now()
   where profile_id = p_profile_id and watchlist_item_id = p_item_id
     and updated_at > now() - interval '3 hours';
  if not found then
    insert into public.activity_events(profile_id, watchlist_item_id, kind, season, episode)
    values (p_profile_id, p_item_id, p_kind, p_season, p_episode);
  end if;
end $$;
revoke all on function public._social_log_activity(uuid, uuid, text, integer, integer) from public, anon, authenticated;

-- Fil d'activité des amis : 30 jours, plafonné à 25 entrées affichées, pas de pagination.
create or replace function public.get_activity_feed(p_profile_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_items jsonb;
begin
  if not public._social_owns(p_profile_id) then return jsonb_build_object('status', 'not_authenticated'); end if;
  select coalesce(jsonb_agg(x.item order by x.updated_at desc), '[]'::jsonb) into v_items
  from (
    select e.updated_at, jsonb_build_object(
        'event_id', e.id, 'updated_at', e.updated_at, 'friend', public._social_card(e.profile_id),
        'kind', e.kind, 'season', e.season, 'episode', e.episode,
        'title', w.title, 'type', w.type, 'poster_path', w.poster_path,
        'reactions', coalesce((select jsonb_object_agg(r.emoji, r.n) from
                       (select ar.emoji, count(*) n from public.activity_reactions ar where ar.event_id = e.id group by ar.emoji) r),
                     '{}'::jsonb),
        'my_reaction', (select ar.emoji from public.activity_reactions ar
                          where ar.event_id = e.id and ar.profile_id = p_profile_id)
      ) as item
    from public.activity_events e
    join public.watchlist_items w on w.id = e.watchlist_item_id and not coalesce(w.deleted, false)
    join public.friendships f on f.a = least(p_profile_id, e.profile_id) and f.b = greatest(p_profile_id, e.profile_id)
    left join public.social_settings s on s.profile_id = e.profile_id
    where coalesce(s.show_activity, true) and e.updated_at > now() - interval '30 days'
    order by e.updated_at desc
    limit 25
  ) x;
  return jsonb_build_object('status', 'ok', 'items', v_items);
end $$;
revoke all on function public.get_activity_feed(uuid) from public, anon;
grant execute on function public.get_activity_feed(uuid) to authenticated;

-- Réagir (un tap = pose/remplace, retaper le même retire). Réponse neutre si l'activité n'existe
-- pas, n'est plus visible (bloqué/pas ami) ou si son auteur masque son activité.
create or replace function public.react_to_activity(p_profile_id uuid, p_event_id uuid, p_emoji text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_existing text; v_counts jsonb; v_status text;
begin
  if not public._social_owns(p_profile_id) then return jsonb_build_object('status', 'not_authenticated'); end if;
  if p_emoji is null or p_emoji not in ('👍', '❤️', '🔥', '😮', '😂', '🍿') then
    return jsonb_build_object('status', 'invalid_emoji');
  end if;
  select e.profile_id into v_owner from public.activity_events e where e.id = p_event_id;
  if v_owner is null then return jsonb_build_object('status', 'not_found'); end if;
  if v_owner <> p_profile_id then
    if not exists (select 1 from public.friendships f where f.a = least(p_profile_id, v_owner) and f.b = greatest(p_profile_id, v_owner))
       or not coalesce((select show_activity from public.social_settings where profile_id = v_owner), true) then
      return jsonb_build_object('status', 'not_found');
    end if;
  end if;
  select ar.emoji into v_existing from public.activity_reactions ar where ar.event_id = p_event_id and ar.profile_id = p_profile_id;
  if v_existing = p_emoji then
    delete from public.activity_reactions where event_id = p_event_id and profile_id = p_profile_id;
    v_status := 'removed';
  else
    insert into public.activity_reactions(event_id, profile_id, emoji) values (p_event_id, p_profile_id, p_emoji)
      on conflict (event_id, profile_id) do update set emoji = excluded.emoji, created_at = now();
    v_status := 'ok';
  end if;
  select coalesce(jsonb_object_agg(r.emoji, r.n), '{}'::jsonb) into v_counts
    from (select ar.emoji, count(*) n from public.activity_reactions ar where ar.event_id = p_event_id group by ar.emoji) r;
  return jsonb_build_object('status', v_status, 'counts', v_counts,
    'my_reaction', (select ar.emoji from public.activity_reactions ar where ar.event_id = p_event_id and ar.profile_id = p_profile_id));
end $$;
revoke all on function public.react_to_activity(uuid, uuid, text) from public, anon;
grant execute on function public.react_to_activity(uuid, uuid, text) to authenticated;

-- =============================================================================
-- MIGRATION 20261027200000_mfa_recovery_codes.sql (recopiée telle quelle)
-- =============================================================================
-- =============================================================================================
-- 20261027200000_mfa_recovery_codes.sql — Codes de secours pour la double authentification (TOTP)
-- NON APPLIQUÉE. À relire et valider par Pierre avant toute application.
--
-- Contexte : Supabase Auth gère nativement l'enrôlement/vérification TOTP (auth.mfa.*, gratuit,
-- déjà actif sur le projet) — rien à faire côté base pour ça. Mais Supabase ne fournit pas de
-- codes de secours : si l'utilisateur perd son appareil (plus d'appli d'authentification), il
-- est bloqué. Cette migration ajoute UNIQUEMENT le stockage des codes de secours (empreinte
-- SHA-256 côté client, jamais le code en clair ici) ; elle ne touche à AUCUNE table du schéma
-- `auth` (pas de suppression de facteur ici — ça reste `supabase.auth.mfa.unenroll()`, qui exige
-- déjà un niveau d'assurance aal2, obtenu en vérifiant un nouveau facteur après un code de
-- secours valide ; voir js/37-mfa.js pour le détail du flux).
--
-- Principe :
--  * Une ligne par code de secours (10 générés à l'activation, à usage unique).
--  * Le code n'est JAMAIS vu par le serveur : le navigateur calcule son empreinte SHA-256
--    (Web Crypto, `crypto.subtle.digest`) avant tout envoi ; seule l'empreinte est stockée.
--  * Consommer un code le marque utilisé mais NE supprime PAS les autres : si l'utilisateur est
--    interrompu avant d'avoir reconfiguré un nouvel appareil, il peut retenter avec un autre code
--    à sa prochaine connexion plutôt que de se retrouver bloqué.
--  * Regénérer un lot (après reconfiguration, ou depuis les réglages) supprime tout l'ancien lot.
--  * Table fermée à double tour : RLS activée ET forcée, aucune policy, aucun droit direct
--    accordé à `authenticated`/`anon` — tout passe par les fonctions SECURITY DEFINER ci-dessous,
--    elles-mêmes strictement scopées à auth.uid().
--  * Rejouable (idempotente). Aucune donnée supprimée par cette migration elle-même.
-- =============================================================================================

create table if not exists public.mfa_recovery_codes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  code_hash  bytea not null,                    -- sha256(code), calculé dans le navigateur
  used_at    timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, code_hash)
);

create index if not exists mfa_recovery_codes_user_idx on public.mfa_recovery_codes(user_id);

alter table public.mfa_recovery_codes enable row level security;
alter table public.mfa_recovery_codes force row level security;

-- Aucune policy : table fermée par défaut (y compris pour son propriétaire). Tout passe par les
-- fonctions ci-dessous.
revoke all on table public.mfa_recovery_codes from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 1. Régénère le lot de codes de secours de l'utilisateur connecté (remplace l'ancien lot).
--    p_hashes : exactement 10 empreintes SHA-256 en hexadécimal (64 caractères), calculées côté
--    client. Le code en clair n'existe jamais ici.
-- ---------------------------------------------------------------------------------------------
create or replace function public.mfa_recovery_store(p_hashes text[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_h text;
begin
  if v_uid is null then return jsonb_build_object('status', 'not_authenticated'); end if;
  if p_hashes is null or array_length(p_hashes, 1) is distinct from 10 then
    return jsonb_build_object('status', 'invalid_input');
  end if;
  foreach v_h in array p_hashes loop
    if v_h !~ '^[0-9a-f]{64}$' then return jsonb_build_object('status', 'invalid_input'); end if;
  end loop;

  delete from public.mfa_recovery_codes where user_id = v_uid;
  insert into public.mfa_recovery_codes(user_id, code_hash)
    select v_uid, decode(h, 'hex') from unnest(p_hashes) as h;

  return jsonb_build_object('status', 'ok', 'count', 10);
end;
$$;
revoke all on function public.mfa_recovery_store(text[]) from public, anon;
grant execute on function public.mfa_recovery_store(text[]) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. Consomme un code de secours (empreinte hex) pour l'utilisateur connecté. Ne supprime que le
--    code utilisé — les autres restent valides tant qu'un nouveau lot n'est pas régénéré.
-- ---------------------------------------------------------------------------------------------
create or replace function public.mfa_recovery_consume_check(p_hash text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then return jsonb_build_object('status', 'not_authenticated'); end if;
  if p_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('status', 'invalid_input'); end if;

  update public.mfa_recovery_codes
     set used_at = now()
   where user_id = v_uid and code_hash = decode(p_hash, 'hex') and used_at is null
  returning id into v_id;

  if v_id is null then return jsonb_build_object('status', 'invalid_or_used'); end if;
  return jsonb_build_object('status', 'ok');
end;
$$;
revoke all on function public.mfa_recovery_consume_check(text) from public, anon;
grant execute on function public.mfa_recovery_consume_check(text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. Nombre de codes de secours encore valides (affichage réglages, relance de régénération).
-- ---------------------------------------------------------------------------------------------
create or replace function public.mfa_recovery_count()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('status', 'ok', 'count',
    (select count(*) from public.mfa_recovery_codes where user_id = auth.uid() and used_at is null))
$$;
revoke all on function public.mfa_recovery_count() from public, anon;
grant execute on function public.mfa_recovery_count() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. Vide le lot (double authentification désactivée : plus aucun code n'a de sens).
-- ---------------------------------------------------------------------------------------------
create or replace function public.mfa_recovery_clear()
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  delete from public.mfa_recovery_codes where user_id = auth.uid();
  select jsonb_build_object('status', 'ok');
$$;
revoke all on function public.mfa_recovery_clear() from public, anon;
grant execute on function public.mfa_recovery_clear() to authenticated;

-- =============================================================================
-- MIGRATION 20261029100000_detected_block_title.sql (recopiée telle quelle)
-- =============================================================================
-- =============================================================================================
-- 20261029100000_detected_block_title.sql — Ignorer un détecté : option « ne plus jamais »
-- NON APPLIQUÉE. À relire et valider par Pierre avant toute application.
--
-- Avant cette migration, « Ignorer » était déjà permanent par construction : dès qu'une seule
-- ligne detected_media avait l'état 'ignored' pour un (compte, type, titre normalisé),
-- extension_push_detections() faisait arriver direct en 'ignored' toute nouvelle détection du
-- même titre — sans qu'aucun écran ne le dise ni que l'utilisateur n'ait eu le choix.
--
-- Nouveau comportement (demande de Pierre, 29/10) :
--  * « Ignorer » redevient ce qu'il semble être : ne retire que les titres sélectionnés de la
--    liste d'attente. Une détection ultérieure du même titre (nouvel épisode vu, etc.) revient
--    normalement en attente.
--  * La fenêtre de confirmation (js/21-detected.js) propose une case à cocher « Ne plus jamais
--    me proposer ce titre » : si cochée, le(s) titre(s) concerné(s) passent dans la liste de
--    blocage ci-dessous, désormais la SEULE source consultée par extension_push_detections()
--    pour décider si une nouvelle détection arrive directement 'ignored'. Une ligne 'ignored'
--    seule ne bloque plus rien.
--  * Rejouable (idempotente). Aucune donnée supprimée.
-- =============================================================================================

create table if not exists public.detected_blocklist (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  media_type       text not null check (media_type in ('movie', 'show')),
  normalized_title text not null check (length(normalized_title) between 1 and 500),
  created_at       timestamptz not null default now(),
  unique (user_id, media_type, normalized_title)
);
create index if not exists detected_blocklist_user_idx on public.detected_blocklist(user_id);

alter table public.detected_blocklist enable row level security;
alter table public.detected_blocklist force row level security;
revoke all on table public.detected_blocklist from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 1. « Ne plus jamais proposer » : ajoute le(s) titre(s) des lignes données (propriétaire
--    uniquement) à la liste de blocage, et classe aussitôt 'ignored' toutes les autres lignes
--    en attente du même (compte, type, titre normalisé) — pas seulement celles sélectionnées
--    (un autre épisode encore en attente de la même série, par exemple).
-- ---------------------------------------------------------------------------------------------
create or replace function public.detected_block_title(p_ids uuid[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('status', 'not_authenticated'); end if;
  if p_ids is null or array_length(p_ids, 1) is null then return jsonb_build_object('status', 'invalid_input'); end if;

  insert into public.detected_blocklist(user_id, media_type, normalized_title)
    select distinct d.user_id, d.media_type, d.normalized_title
    from public.detected_media d
    where d.id = any(p_ids) and d.user_id = v_uid
  on conflict (user_id, media_type, normalized_title) do nothing;

  update public.detected_media d
     set state = 'ignored', updated_at = now()
   where d.user_id = v_uid and d.state = 'pending'
     and exists (
       select 1 from public.detected_blocklist b
       where b.user_id = v_uid and b.media_type = d.media_type and b.normalized_title = d.normalized_title
     );

  return jsonb_build_object('status', 'ok');
end;
$$;
revoke all on function public.detected_block_title(uuid[]) from public, anon;
grant execute on function public.detected_block_title(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. extension_push_detections : le blocage vient maintenant de detected_blocklist, plus d'un
--    état 'ignored' préexistant. Recopiée en entier (seule la ligne « Titre déjà ignoré… » change).
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

    -- Titre dans la liste de blocage (« ne plus jamais me proposer ce titre ») : direct 'ignored'
    v_state := case when exists (select 1 from public.detected_blocklist b
                                 where b.user_id = v_user_id and b.media_type = v_type
                                   and b.normalized_title = v_norm)
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
