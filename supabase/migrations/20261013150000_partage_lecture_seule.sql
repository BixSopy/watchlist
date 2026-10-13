-- =============================================================================================
-- 20261013150000_partage_lecture_seule.sql — Partage en lecture seule (liens /s/<jeton>)
-- Validée sur maquette par Pierre ; NE PAS APPLIQUER en production sans son feu vert final.
--
-- Principe :
--  * Opt-in : rien n'est public tant que l'utilisateur ne crée pas de lien.
--  * Jeton de 128 bits (base64url, 22 caractères), généré côté base (extensions.gen_random_bytes).
--  * Révocation : revoked_at non nul => le lien ne renvoie plus rien, immédiatement et pour toujours.
--  * La table n'est lisible que par son propriétaire ; l'écriture passe uniquement par
--    create_share / revoke_share. Le public ne lit QUE get_public_share (champs publics).
--  * Jamais exposés : e-mail, identifiants internes, notes texte (overview/tags), titres détectés,
--    appareils, historique d'import.
--  * Limites : 10 liens actifs par profil, 20 créations par heure et par compte.
--  * Rejouable (idempotente). search_path vide dans toutes les fonctions : noms qualifiés.
-- =============================================================================================

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
