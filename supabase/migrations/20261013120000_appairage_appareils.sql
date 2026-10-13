-- =============================================================================================
-- 20261013120000_appairage_appareils.sql — Appairage site -> extension, jeton par appareil
-- NON APPLIQUÉE. À relire et valider par Pierre avant toute application.
--
-- Principe :
--  * Une ligne par appareil (navigateur où l'extension est installée), liée à un profil.
--  * Le jeton (32 octets aléatoires, 64 hexa, préfixe "cpd_") n'est JAMAIS stocké en clair :
--    seule son empreinte SHA-256 est en base. Il est renvoyé une seule fois au site qui le
--    transmet aussitôt à l'extension (chrome.runtime.sendMessage, externally_connectable).
--  * Révocation : revoked_at non nul => le jeton est refusé immédiatement partout.
--  * L'ancien jeton de suivi (profiles.plex_webhook_token) reste accepté pendant la transition
--    (extension <= 0.7.3 et Tautulli). Il pourra être retiré pour l'extension plus tard.
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
    return jsonb_build_object('status', 'updated', 'title', v_item.title, 'season', p_season, 'episode', p_episode);
  end if;
  return jsonb_build_object('status', 'already_up_to_date', 'title', v_item.title,
    'season', case when v_is_episode then v_item.saison end,
    'episode', case when v_is_episode then v_item.episode end);
end;
$$;

revoke all on function public.mark_watched_by_title(text, text, integer, integer, text) from public;
grant execute on function public.mark_watched_by_title(text, text, integer, integer, text) to anon, authenticated;
