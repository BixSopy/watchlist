-- =============================================================================
-- Ouverture publique : quotas d'API par compte, cache partagé OMDb, suppression de
-- compte en libre-service, garde-fous de taille sur les données synchronisées.
-- Projet Supabase : batfulcvvquffgfeppcx
--
-- ORDRE : à exécuter APRÈS 20260925151457_nettoyage_et_securite.sql (déjà appliqué en
-- base le 08/10/2026 d'après une vérification en lecture seule, même s'il n'apparaît pas
-- dans l'historique des migrations) et après les deux migrations du 06/10.
-- Compatible avec la version actuellement en production : peut être lancée AVANT le
-- déploiement de la PR « feat/ouverture-publique » (l'ancienne app n'utilise aucun des
-- objets créés ici, et les nouveaux garde-fous acceptent toutes les données existantes).
--
-- À lancer dans le SQL Editor (rôle postgres), en une seule fois. Transactionnelle et
-- idempotente : en cas d'erreur rien n'est appliqué, et la relancer ne casse rien.
--
-- Rappel : sur ce projet, les privilèges par défaut donnent EXECUTE à anon et
-- authenticated sur toute nouvelle fonction, et tous les droits sur toute nouvelle
-- table. Chaque objet créé ici retire donc explicitement ces droits.
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
