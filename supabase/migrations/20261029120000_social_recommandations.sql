-- =============================================================================================
-- Social, étape 3 : « Recommander à un ami » et « On regarde quoi ? »
--  * recommendations : un titre envoyé par un profil à un ami (message facultatif ≤ 140 caractères).
--    Aucun accès direct : lecture et écriture uniquement par les fonctions ci-dessous.
--  * Garde-fous : amis seulement, blocages dans les deux sens, 30 envois / 24 h / profil,
--    10 destinataires max par envoi, le destinataire peut refuser les recommandations
--    (social_settings.accept_recos). Réponses neutres : l'expéditeur ne sait jamais si un
--    destinataire l'a bloqué ou refuse les recommandations.
--  * watch_together : uniquement les titres EN COMMUN dans les listes « à voir » d'au moins deux
--    participants et vus par aucun d'eux. Jamais la liste complète d'un ami, et seulement pour les
--    amis qui laissent leur liste visible (social_settings.show_list).
--  * RGPD : export_my_recommendations (envoyées + reçues). Suppression de compte : cascade via
--    profiles (on delete cascade sur les deux clés étrangères).
--  * Rejouable (idempotente).
-- =============================================================================================

create table if not exists public.recommendations (
  id           uuid primary key default gen_random_uuid(),
  from_profile uuid not null references public.profiles(id) on delete cascade,
  to_profile   uuid not null references public.profiles(id) on delete cascade,
  tmdb_id      integer not null check (tmdb_id > 0),
  tmdb_type    text not null check (tmdb_type in ('movie', 'tv')),
  media_type   text not null default 'film' check (media_type in ('film', 'serie', 'anime')),
  title        text not null check (char_length(title) between 1 and 300),
  year         text check (year is null or char_length(year) <= 10),
  poster_path  text check (poster_path is null or poster_path ~ '^/[A-Za-z0-9._-]{1,100}$'),
  message      text check (message is null or char_length(message) <= 140),
  status       text not null default 'new' check (status in ('new', 'seen', 'added', 'dismissed')),
  thanked_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint recommendations_not_self check (from_profile <> to_profile),
  constraint recommendations_unique unique (from_profile, to_profile, tmdb_type, tmdb_id)
);
-- Index sur les deux clés étrangères (conseiller Supabase) + lecture boîte de réception / quota
create index if not exists recommendations_to_idx on public.recommendations(to_profile, created_at desc);
create index if not exists recommendations_from_idx on public.recommendations(from_profile, created_at desc);

alter table public.recommendations enable row level security;
revoke all on table public.recommendations from public, anon, authenticated;
-- RLS sans politique = aucune ligne visible en direct ; tout passe par les fonctions SECURITY DEFINER.

alter table public.social_settings add column if not exists accept_recos boolean not null default true;

-- ---------- Envoyer ----------
create or replace function public.send_recommendation(p_profile_id uuid, p_to uuid[], p_tmdb_id integer, p_tmdb_type text,
  p_media_type text, p_title text, p_year text default null, p_poster_path text default null, p_message text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_to uuid[]; v_used integer; v_msg text; v_n integer := 0; r uuid;
begin
  if not public._social_owns(p_profile_id) then return jsonb_build_object('status', 'not_authenticated'); end if;
  select coalesce(array_agg(distinct x), '{}') into v_to from unnest(coalesce(p_to, '{}')) x where x is not null and x <> p_profile_id;
  if cardinality(v_to) = 0 then return jsonb_build_object('status', 'no_recipient'); end if;
  if cardinality(v_to) > 10 then return jsonb_build_object('status', 'too_many'); end if;
  if p_tmdb_id is null or p_tmdb_id <= 0 or p_tmdb_type not in ('movie', 'tv') or coalesce(btrim(p_title), '') = ''
     or (p_poster_path is not null and p_poster_path !~ '^/[A-Za-z0-9._-]{1,100}$') then
    return jsonb_build_object('status', 'invalid');
  end if;
  v_msg := nullif(btrim(coalesce(p_message, '')), '');
  if v_msg is not null and char_length(v_msg) > 140 then return jsonb_build_object('status', 'message_too_long'); end if;
  -- Quota : 30 destinataires / 24 h glissantes
  select count(*) into v_used from public.recommendations where from_profile = p_profile_id and created_at > now() - interval '24 hours';
  if v_used + cardinality(v_to) > 30 then return jsonb_build_object('status', 'rate_limited', 'left', greatest(0, 30 - v_used)); end if;
  foreach r in array v_to loop
    -- amis seulement ; blocage ou refus des recommandations : ignoré en silence (réponse neutre)
    continue when not exists (select 1 from public.friendships f where f.a = least(p_profile_id, r) and f.b = greatest(p_profile_id, r));
    continue when exists (select 1 from public.blocks b where (b.blocker = r and b.blocked = p_profile_id) or (b.blocker = p_profile_id and b.blocked = r));
    continue when exists (select 1 from public.social_settings s where s.profile_id = r and not s.accept_recos);
    insert into public.recommendations(from_profile, to_profile, tmdb_id, tmdb_type, media_type, title, year, poster_path, message)
    values (p_profile_id, r, p_tmdb_id, p_tmdb_type,
            case when p_media_type in ('film', 'serie', 'anime') then p_media_type when p_tmdb_type = 'movie' then 'film' else 'serie' end,
            left(btrim(p_title), 300), left(p_year, 10), p_poster_path, v_msg)
    on conflict (from_profile, to_profile, tmdb_type, tmdb_id) do update
      set message = excluded.message, status = 'new', thanked_at = null, created_at = now(), updated_at = now();
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('status', 'sent', 'count', cardinality(v_to));
end $$;

-- ---------- Boîte de réception (+ remerciements reçus) ----------
create or replace function public.get_my_recommendations(p_profile_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public._social_owns(p_profile_id) then return jsonb_build_object('status', 'not_authenticated'); end if;
  return jsonb_build_object('status', 'ok',
    'accept_recos', coalesce((select s.accept_recos from public.social_settings s where s.profile_id = p_profile_id), true),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'from', public._social_card(x.from_profile),
        'tmdb_id', x.tmdb_id, 'tmdb_type', x.tmdb_type, 'type', x.media_type, 'title', x.title, 'year', x.year,
        'poster_path', x.poster_path, 'message', x.message, 'status', x.status, 'thanked', x.thanked_at is not null,
        'created_at', x.created_at) order by x.created_at desc)
      from (select r.* from public.recommendations r
             where r.to_profile = p_profile_id and r.status in ('new', 'seen') and r.created_at > now() - interval '90 days'
               and exists (select 1 from public.friendships f where f.a = least(r.from_profile, r.to_profile) and f.b = greatest(r.from_profile, r.to_profile))
             order by r.created_at desc limit 50) x), '[]'::jsonb),
    'unread', (select count(*) from public.recommendations r where r.to_profile = p_profile_id and r.status = 'new'
               and exists (select 1 from public.friendships f where f.a = least(r.from_profile, r.to_profile) and f.b = greatest(r.from_profile, r.to_profile))),
    'thanks', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'by', public._social_card(x.to_profile), 'title', x.title,
        'poster_path', x.poster_path, 'at', x.thanked_at) order by x.thanked_at desc)
      from (select r.* from public.recommendations r where r.from_profile = p_profile_id and r.thanked_at > now() - interval '30 days'
             order by r.thanked_at desc limit 20) x), '[]'::jsonb));
end $$;

-- ---------- Répondre : seen | added | dismissed | thanks ----------
create or replace function public.respond_recommendation(p_profile_id uuid, p_id uuid, p_action text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public._social_owns(p_profile_id) then return jsonb_build_object('status', 'not_authenticated'); end if;
  if p_action not in ('seen', 'added', 'dismissed', 'thanks') then return jsonb_build_object('status', 'invalid'); end if;
  if p_action = 'thanks' then
    update public.recommendations set thanked_at = coalesce(thanked_at, now()), status = case when status = 'new' then 'seen' else status end, updated_at = now()
     where id = p_id and to_profile = p_profile_id;
  elsif p_action = 'seen' then
    update public.recommendations set status = 'seen', updated_at = now() where id = p_id and to_profile = p_profile_id and status = 'new';
  else
    update public.recommendations set status = p_action, updated_at = now() where id = p_id and to_profile = p_profile_id;
  end if;
  return jsonb_build_object('status', 'ok');
end $$;

create or replace function public.mark_recommendations_seen(p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public._social_owns(p_profile_id) then return jsonb_build_object('status', 'not_authenticated'); end if;
  update public.recommendations set status = 'seen', updated_at = now() where to_profile = p_profile_id and status = 'new';
  return jsonb_build_object('status', 'ok');
end $$;

-- ---------- Accepter ou non les recommandations ----------
create or replace function public.set_reco_pref(p_profile_id uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public._social_owns(p_profile_id) then return jsonb_build_object('status', 'not_authenticated'); end if;
  insert into public.social_settings(profile_id, accept_recos) values (p_profile_id, coalesce(p_accept, true))
  on conflict (profile_id) do update set accept_recos = coalesce(p_accept, true), updated_at = now();
  return jsonb_build_object('status', 'ok', 'accept_recos', coalesce(p_accept, true));
end $$;

-- ---------- RGPD : tout ce qui me concerne ----------
create or replace function public.export_my_recommendations(p_profile_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public._social_owns(p_profile_id) then return jsonb_build_object('status', 'not_authenticated'); end if;
  return jsonb_build_object('status', 'ok',
    'accept_recos', coalesce((select s.accept_recos from public.social_settings s where s.profile_id = p_profile_id), true),
    'sent', coalesce((select jsonb_agg(jsonb_build_object('to', public._social_card(r.to_profile), 'tmdb_id', r.tmdb_id, 'tmdb_type', r.tmdb_type,
        'title', r.title, 'message', r.message, 'thanked_at', r.thanked_at, 'created_at', r.created_at) order by r.created_at)
      from public.recommendations r where r.from_profile = p_profile_id), '[]'::jsonb),
    'received', coalesce((select jsonb_agg(jsonb_build_object('from', public._social_card(r.from_profile), 'tmdb_id', r.tmdb_id, 'tmdb_type', r.tmdb_type,
        'title', r.title, 'message', r.message, 'status', r.status, 'thanked_at', r.thanked_at, 'created_at', r.created_at) order by r.created_at)
      from public.recommendations r where r.to_profile = p_profile_id), '[]'::jsonb));
end $$;

-- ---------- « On regarde quoi ? » ----------
-- Titres dans la liste « à voir » (avoir/todo) d'au moins deux participants (moi + amis choisis),
-- vus ou en cours chez aucun. Amis sans liste visible : écartés (renvoyés dans 'hidden').
create or replace function public.watch_together(p_profile_id uuid, p_friends uuid[], p_kind text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_ok uuid[]; v_hidden uuid[] := '{}'; v_all uuid[]; r uuid; v_items jsonb;
begin
  if not public._social_owns(p_profile_id) then return jsonb_build_object('status', 'not_authenticated'); end if;
  if p_kind is not null and p_kind not in ('film', 'serie', 'anime') then return jsonb_build_object('status', 'invalid'); end if;
  select coalesce(array_agg(distinct x), '{}') into v_ok from unnest(coalesce(p_friends, '{}')) x where x is not null and x <> p_profile_id;
  if cardinality(v_ok) = 0 then return jsonb_build_object('status', 'no_friend'); end if;
  if cardinality(v_ok) > 8 then return jsonb_build_object('status', 'too_many'); end if;
  foreach r in array v_ok loop
    if not exists (select 1 from public.friendships f where f.a = least(p_profile_id, r) and f.b = greatest(p_profile_id, r))
       or exists (select 1 from public.blocks b where (b.blocker = r and b.blocked = p_profile_id) or (b.blocker = p_profile_id and b.blocked = r))
       or exists (select 1 from public.social_settings s where s.profile_id = r and not s.show_list) then
      v_hidden := v_hidden || r;
    end if;
  end loop;
  v_ok := array(select x from unnest(v_ok) x where not x = any(v_hidden));
  v_all := v_ok || p_profile_id;
  if cardinality(v_ok) = 0 then return jsonb_build_object('status', 'ok', 'items', '[]'::jsonb, 'hidden', to_jsonb(v_hidden), 'participants', 1); end if;
  with w as (
    select i.profile_id, i.tmdb_type, i.tmdb_id, i.type, i.status, i.title, i.year, i.poster_path, i.updated_at
      from public.watchlist_items i
     where i.profile_id = any(v_all) and not coalesce(i.deleted, false) and i.tmdb_id is not null and i.tmdb_type in ('movie', 'tv')
  ), agg as (
    select w.tmdb_type, w.tmdb_id,
           count(distinct w.profile_id) filter (where w.status in ('avoir', 'todo')) as n,
           bool_or(w.status in ('encours', 'termine')) as seen,
           bool_or(w.profile_id = p_profile_id and w.status in ('avoir', 'todo')) as mine,
           (array_agg(w.type order by w.updated_at desc nulls last))[1] as type,
           (array_agg(w.title order by w.updated_at desc nulls last))[1] as title,
           (array_agg(w.year order by w.updated_at desc nulls last))[1] as year,
           (array_agg(w.poster_path order by (w.poster_path is null), w.updated_at desc nulls last))[1] as poster_path
      from w group by w.tmdb_type, w.tmdb_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('tmdb_id', a.tmdb_id, 'tmdb_type', a.tmdb_type, 'type', a.type, 'title', a.title,
           'year', a.year, 'poster_path', a.poster_path, 'n', a.n, 'mine', a.mine) order by a.n desc, a.mine desc, a.title), '[]'::jsonb)
    into v_items
    from (select * from agg where n >= 2 and not seen and (p_kind is null or type = p_kind)
           order by n desc, mine desc, title limit 60) a;
  return jsonb_build_object('status', 'ok', 'items', v_items, 'hidden', to_jsonb(v_hidden), 'participants', cardinality(v_all));
end $$;

-- ---------- Droits ----------
revoke all on function public.send_recommendation(uuid, uuid[], integer, text, text, text, text, text, text),
  public.get_my_recommendations(uuid), public.respond_recommendation(uuid, uuid, text), public.mark_recommendations_seen(uuid),
  public.set_reco_pref(uuid, boolean), public.export_my_recommendations(uuid), public.watch_together(uuid, uuid[], text)
  from public, anon;
grant execute on function public.send_recommendation(uuid, uuid[], integer, text, text, text, text, text, text),
  public.get_my_recommendations(uuid), public.respond_recommendation(uuid, uuid, text), public.mark_recommendations_seen(uuid),
  public.set_reco_pref(uuid, boolean), public.export_my_recommendations(uuid), public.watch_together(uuid, uuid[], text)
  to authenticated;
