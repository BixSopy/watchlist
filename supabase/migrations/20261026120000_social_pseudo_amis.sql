-- =============================================================================================
-- 20261026120000_social_pseudo_amis.sql — Social, étape 1 : pseudo + amis par lien / QR code
-- Cadrage validé par Pierre le 26/10/2026. NE PAS APPLIQUER en production sans son feu vert explicite.
--
-- Principe :
--  * Pas d'annuaire, pas de recherche : on devient amis uniquement via /u/<pseudo>?i=<code>, puis
--    l'autre accepte. Amitié réciproque (une ligne par paire, a < b).
--  * Le pseudo est porté par le PROFIL (profiles.id), compatible avec le multi-profil futur.
--  * Aucune écriture directe : tout passe par des fonctions SECURITY DEFINER, search_path vide,
--    statut renvoyé en jsonb (même patron que create_share). Lecture directe des tables limitée aux
--    lignes dont le profil appelant est partie prenante (RLS).
--  * Réponses neutres : un bloqué, un code faux ou un pseudo inconnu reçoivent la même réponse.
--  * Ce qu'un ami voit : social_settings (liste et progression visibles, notes masquées par défaut).
--    Les notes texte (overview/tags), titres détectés, appareils et e-mail ne sont JAMAIS exposés.
--  * Limites : 20 demandes / jour / profil, 200 amis max, 5 nouveaux liens / jour,
--    3 codes faux / minute / pseudo (compteur agrégé, aucune IP stockée).
--  * Suppression de compte : tout part en cascade via les clés étrangères sur profiles.
--  * Rejouable (idempotente).
-- =============================================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- Pseudo et code d'invitation sur le profil ----------
alter table public.profiles add column if not exists handle text;
alter table public.profiles add column if not exists handle_changed_at timestamptz;
alter table public.profiles add column if not exists invite_code text;
alter table public.profiles drop constraint if exists profiles_handle_format;
alter table public.profiles add constraint profiles_handle_format check (
  handle is null or (handle ~ '^[a-z0-9._]{3,20}$' and handle !~ '^\.' and handle !~ '\.$' and handle !~ '\.\.'));
alter table public.profiles drop constraint if exists profiles_invite_code_format;
alter table public.profiles add constraint profiles_invite_code_format check (invite_code is null or invite_code ~ '^[A-Za-z0-9]{12}$');
create unique index if not exists profiles_handle_key on public.profiles(handle);
create unique index if not exists profiles_invite_code_key on public.profiles(invite_code);
-- Les droits par colonne existants (update name, avatar, avatar_color, plex_webhook_token) ne couvrent
-- PAS handle / handle_changed_at / invite_code : seules les fonctions ci-dessous peuvent les écrire.

-- ---------- Pseudos réservés (permanents, ou anciens pseudos pendant 30 jours) ----------
create table if not exists public.reserved_handles (
  handle       text primary key,
  until        timestamptz,                                       -- null = permanent
  reserved_for uuid references public.profiles(id) on delete cascade  -- ancien propriétaire (peut le reprendre)
);
alter table public.reserved_handles enable row level security;
revoke all on table public.reserved_handles from anon, authenticated;
insert into public.reserved_handles(handle) values
  ('admin'),('administrator'),('root'),('cinepisode'),('support'),('help'),('aide'),('api'),('u'),('s'),
  ('login'),('logout'),('signup'),('settings'),('reglages'),('moderator'),('moderateur'),('mod'),('staff'),
  ('team'),('equipe'),('official'),('officiel'),('contact'),('privacy'),('legal'),('security'),('system'),
  ('null'),('undefined'),('anonymous'),('me'),('moi'),('www'),('mail'),('tvtime'),
  ('connard'),('salope'),('encule'),('pute'),('merde'),('nazi'),('hitler'),('fuck'),('shit'),('bitch'),
  ('cunt'),('nigger'),('nigga'),('faggot'),('pd'),('retard')
on conflict (handle) do nothing;

-- ---------- Amitiés (une ligne par paire) ----------
create table if not exists public.friendships (
  a          uuid not null references public.profiles(id) on delete cascade,
  b          uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (a, b),
  check (a < b)
);
create index if not exists friendships_b_idx on public.friendships(b);

-- ---------- Demandes ----------
create table if not exists public.friend_requests (
  id           uuid primary key default extensions.gen_random_uuid(),
  from_profile uuid not null references public.profiles(id) on delete cascade,
  to_profile   uuid not null references public.profiles(id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending', 'declined')),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '30 days',
  unique (from_profile, to_profile),
  check (from_profile <> to_profile)
);
create index if not exists friend_requests_to_idx on public.friend_requests(to_profile) where status = 'pending';

-- ---------- Blocages ----------
create table if not exists public.blocks (
  blocker    uuid not null references public.profiles(id) on delete cascade,
  blocked    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);
create index if not exists blocks_blocked_idx on public.blocks(blocked);

-- ---------- Ce que mes amis voient ----------
create table if not exists public.social_settings (
  profile_id    uuid primary key references public.profiles(id) on delete cascade,
  show_list     boolean not null default true,
  show_progress boolean not null default true,
  show_ratings  boolean not null default false,
  show_activity boolean not null default true,   -- branché à l'étape 2 (fil d'activité)
  updated_at    timestamptz not null default now()
);

-- ---------- Compteurs anti-abus (agrégés, sans IP) ----------
create table if not exists public.social_rate (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind       text not null check (kind in ('request', 'rotate', 'bad_code')),
  created_at timestamptz not null default now()
);
create index if not exists social_rate_idx on public.social_rate(profile_id, kind, created_at);
alter table public.social_rate enable row level security;
revoke all on table public.social_rate from anon, authenticated;

-- ---------- RLS : lecture seule de ce qui me concerne, aucune écriture directe ----------
alter table public.friendships     enable row level security;
alter table public.friend_requests enable row level security;
alter table public.blocks          enable row level security;
alter table public.social_settings enable row level security;
revoke all on table public.friendships, public.friend_requests, public.blocks, public.social_settings from anon, authenticated;
grant select on table public.friendships, public.friend_requests, public.blocks, public.social_settings to authenticated;

drop policy if exists friendships_select_mine on public.friendships;
create policy friendships_select_mine on public.friendships for select to authenticated using (
  exists (select 1 from public.profiles p where p.account_id = (select auth.uid()) and p.id in (a, b)));
drop policy if exists friend_requests_select_mine on public.friend_requests;
create policy friend_requests_select_mine on public.friend_requests for select to authenticated using (
  exists (select 1 from public.profiles p where p.account_id = (select auth.uid()) and p.id in (from_profile, to_profile)));
drop policy if exists blocks_select_mine on public.blocks;
create policy blocks_select_mine on public.blocks for select to authenticated using (
  exists (select 1 from public.profiles p where p.account_id = (select auth.uid()) and p.id = blocker));
drop policy if exists social_settings_select_mine on public.social_settings;
create policy social_settings_select_mine on public.social_settings for select to authenticated using (
  exists (select 1 from public.profiles p where p.account_id = (select auth.uid()) and p.id = profile_id));

-- =============================================================================================
-- Fonctions internes (non exposées)
-- =============================================================================================
create or replace function public._social_owns(p_profile_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (select 1 from public.profiles p where p.id = p_profile_id and p.account_id = auth.uid())
$$;

create or replace function public._social_norm_handle(p text)
returns text language sql immutable set search_path = '' as $$
  select lower(btrim(regexp_replace(coalesce(p, ''), '^\s*@', '')))
$$;

-- invalid | reserved | taken | available (p_self : profil qui demande, peut reprendre son ancien pseudo)
create or replace function public._social_handle_state(p_handle text, p_self uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
begin
  if p_handle is null or p_handle !~ '^[a-z0-9._]{3,20}$' or p_handle ~ '^\.' or p_handle ~ '\.$' or p_handle ~ '\.\.' then
    return 'invalid';
  end if;
  if exists (select 1 from public.reserved_handles r where r.handle = p_handle
             and (r.until is null or r.until > now()) and r.reserved_for is distinct from p_self) then
    return 'reserved';
  end if;
  if exists (select 1 from public.profiles p where p.handle = p_handle and p.id is distinct from p_self) then
    return 'taken';
  end if;
  return 'available';
end $$;

create or replace function public._social_new_code()
returns text language sql volatile set search_path = '' as $$
  select left(regexp_replace(encode(extensions.gen_random_bytes(24), 'base64'), '[^A-Za-z0-9]', '', 'g'), 12)
$$;

create or replace function public._social_card(p_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('profile_id', p.id, 'handle', p.handle, 'name', p.name, 'avatar', p.avatar, 'avatar_color', p.avatar_color)
    from public.profiles p where p.id = p_id
$$;

create or replace function public._social_friend_count(p_id uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.friendships f where f.a = p_id or f.b = p_id
$$;

create or replace function public._social_make_friends(p1 uuid, p2 uuid)
returns void language sql volatile security definer set search_path = '' as $$
  insert into public.friendships(a, b) values (least(p1, p2), greatest(p1, p2)) on conflict do nothing;
  delete from public.friend_requests r where (r.from_profile = p1 and r.to_profile = p2) or (r.from_profile = p2 and r.to_profile = p1);
$$;

revoke all on function public._social_owns(uuid), public._social_norm_handle(text), public._social_handle_state(text, uuid),
  public._social_new_code(), public._social_card(uuid), public._social_friend_count(uuid), public._social_make_friends(uuid, uuid)
  from public, anon, authenticated;

-- =============================================================================================
-- Pseudo
-- =============================================================================================
-- Disponibilité en direct (coche verte) + 3 suggestions si pris.
create or replace function public.check_handle(p_profile_id uuid, p_handle text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_h text := public._social_norm_handle(p_handle); v_state text; v_base text; v_sug text[] := '{}'; v_c text; i int := 0;
begin
  if not public._social_owns(p_profile_id) then return jsonb_build_object('status', 'not_authenticated'); end if;
  v_state := public._social_handle_state(v_h, p_profile_id);
  if v_state in ('taken', 'reserved') then
    v_base := left(regexp_replace(v_h, '[^a-z0-9_]', '', 'g'), 16);
    if char_length(v_base) < 3 then v_base := 'fan'; end if;
    while cardinality(v_sug) < 3 and i < 12 loop
      i := i + 1;
      v_c := case i when 1 then v_base || '_tv' when 2 then v_base || to_char(now(), 'YY') when 3 then 'its.' || v_base
             else v_base || (10 + floor(random() * 990))::int end;
      if char_length(v_c) <= 20 and public._social_handle_state(v_c, p_profile_id) = 'available' and not (v_c = any(v_sug)) then
        v_sug := v_sug || v_c;
      end if;
    end loop;
  end if;
  return jsonb_build_object('status', v_state, 'handle', v_h, 'suggestions', to_jsonb(v_sug));
end $$;

create or replace function public.set_handle(p_profile_id uuid, p_handle text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_h text := public._social_norm_handle(p_handle); v_p public.profiles; v_state text;
begin
  if not public._social_owns(p_profile_id) then return jsonb_build_object('status', 'not_authenticated'); end if;
  select * into v_p from public.profiles where id = p_profile_id for update;
  if v_p.handle = v_h then return jsonb_build_object('status', 'ok', 'handle', v_h, 'invite_code', v_p.invite_code); end if;
  if v_p.handle is not null and v_p.handle_changed_at > now() - interval '30 days' then
    return jsonb_build_object('status', 'too_soon', 'next_change_at', v_p.handle_changed_at + interval '30 days');
  end if;
  v_state := public._social_handle_state(v_h, p_profile_id);
  if v_state <> 'available' then return jsonb_build_object('status', v_state); end if;
  if v_p.handle is not null then        -- l'ancien pseudo reste réservé 30 jours (pour son ancien propriétaire)
    insert into public.reserved_handles(handle, until, reserved_for) values (v_p.handle, now() + interval '30 days', p_profile_id)
      on conflict (handle) do update set until = excluded.until, reserved_for = excluded.reserved_for
      where public.reserved_handles.until is not null;
  end if;
  delete from public.reserved_handles r where r.handle = v_h and r.reserved_for = p_profile_id;
  update public.profiles set handle = v_h, handle_changed_at = now(),
         invite_code = coalesce(invite_code, public._social_new_code()) where id = p_profile_id
    returning * into v_p;
  insert into public.social_settings(profile_id) values (p_profile_id) on conflict do nothing;
  return jsonb_build_object('status', 'ok', 'handle', v_p.handle, 'invite_code', v_p.invite_code);
exception when unique_violation then
  return jsonb_build_object('status', 'taken');
end $$;

-- =============================================================================================
-- Invitation (/u/<pseudo>?i=<code>) : seule fonction ouverte aux visiteurs anonymes
-- =============================================================================================
create or replace function public.get_invite(p_handle text, p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_h text := public._social_norm_handle(p_handle); v_p public.profiles;
begin
  if v_h !~ '^[a-z0-9._]{3,20}$' or coalesce(p_code, '') !~ '^[A-Za-z0-9]{12}$' then return null; end if;
  select * into v_p from public.profiles where handle = v_h;
  if not found then return null; end if;                     -- pseudo inconnu : même réponse qu'un code faux
  if (select count(*) from public.social_rate r where r.profile_id = v_p.id and r.kind = 'bad_code'
        and r.created_at > now() - interval '1 minute') >= 3 then return null; end if;
  if v_p.invite_code is distinct from p_code then
    insert into public.social_rate(profile_id, kind) values (v_p.id, 'bad_code');
    return null;
  end if;
  return jsonb_build_object('handle', v_p.handle, 'name', v_p.name, 'avatar', v_p.avatar, 'avatar_color', v_p.avatar_color);
end $$;

create or replace function public.rotate_invite_code(p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_code text;
begin
  if not public._social_owns(p_profile_id) then return jsonb_build_object('status', 'not_authenticated'); end if;
  if (select handle from public.profiles where id = p_profile_id) is null then return jsonb_build_object('status', 'no_handle'); end if;
  if (select count(*) from public.social_rate r where r.profile_id = p_profile_id and r.kind = 'rotate'
        and r.created_at > now() - interval '1 day') >= 5 then return jsonb_build_object('status', 'rate_limited'); end if;
  insert into public.social_rate(profile_id, kind) values (p_profile_id, 'rotate');
  update public.profiles set invite_code = public._social_new_code() where id = p_profile_id returning invite_code into v_code;
  return jsonb_build_object('status', 'ok', 'invite_code', v_code);
end $$;

-- =============================================================================================
-- Demandes d'ami
-- =============================================================================================
create or replace function public.send_friend_request(p_profile_id uuid, p_handle text, p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_to public.profiles; v_req public.friend_requests;
begin
  if not public._social_owns(p_profile_id) then return jsonb_build_object('status', 'not_authenticated'); end if;
  select * into v_to from public.profiles where handle = public._social_norm_handle(p_handle);
  if not found or public.get_invite(p_handle, p_code) is null then return jsonb_build_object('status', 'invalid'); end if;
  if v_to.id = p_profile_id then return jsonb_build_object('status', 'self'); end if;
  if exists (select 1 from public.friendships f where f.a = least(p_profile_id, v_to.id) and f.b = greatest(p_profile_id, v_to.id)) then
    return jsonb_build_object('status', 'already_friends');
  end if;
  -- Bloqué (dans un sens ou dans l'autre) : réponse neutre, rien n'est créé.
  if exists (select 1 from public.blocks b where (b.blocker = v_to.id and b.blocked = p_profile_id)
                                           or (b.blocker = p_profile_id and b.blocked = v_to.id)) then
    return jsonb_build_object('status', 'sent');
  end if;
  -- Demande croisée en attente : amis tout de suite.
  if exists (select 1 from public.friend_requests r where r.from_profile = v_to.id and r.to_profile = p_profile_id
               and r.status = 'pending' and r.expires_at > now()) then
    if public._social_friend_count(p_profile_id) >= 200 or public._social_friend_count(v_to.id) >= 200 then
      return jsonb_build_object('status', 'friend_limit');
    end if;
    perform public._social_make_friends(p_profile_id, v_to.id);
    return jsonb_build_object('status', 'friends', 'friend', public._social_card(v_to.id));
  end if;
  select * into v_req from public.friend_requests r where r.from_profile = p_profile_id and r.to_profile = v_to.id;
  if found and v_req.expires_at > now() then return jsonb_build_object('status', 'sent'); end if;  -- déjà en attente (ou refusée en silence)
  if public._social_friend_count(p_profile_id) >= 200 then return jsonb_build_object('status', 'friend_limit'); end if;
  if (select count(*) from public.social_rate r where r.profile_id = p_profile_id and r.kind = 'request'
        and r.created_at > now() - interval '1 day') >= 20 then return jsonb_build_object('status', 'rate_limited'); end if;
  insert into public.social_rate(profile_id, kind) values (p_profile_id, 'request');
  delete from public.friend_requests r where r.from_profile = p_profile_id and r.to_profile = v_to.id;   -- expirée
  insert into public.friend_requests(from_profile, to_profile) values (p_profile_id, v_to.id);
  delete from public.social_rate r where r.created_at < now() - interval '2 days';                       -- ménage
  return jsonb_build_object('status', 'sent');
end $$;

create or replace function public.respond_friend_request(p_id uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_req public.friend_requests;
begin
  select * into v_req from public.friend_requests r where r.id = p_id and r.status = 'pending' and r.expires_at > now();
  if not found or not public._social_owns(v_req.to_profile) then return jsonb_build_object('status', 'not_found'); end if;
  if coalesce(p_accept, false) then
    if public._social_friend_count(v_req.to_profile) >= 200 or public._social_friend_count(v_req.from_profile) >= 200 then
      return jsonb_build_object('status', 'friend_limit');
    end if;
    perform public._social_make_friends(v_req.from_profile, v_req.to_profile);
    return jsonb_build_object('status', 'friends', 'friend', public._social_card(v_req.from_profile));
  end if;
  update public.friend_requests set status = 'declined' where id = p_id;   -- en silence : l'autre voit « en attente »
  return jsonb_build_object('status', 'declined');
end $$;

create or replace function public.remove_friend(p_profile_id uuid, p_friend uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public._social_owns(p_profile_id) then return jsonb_build_object('status', 'not_authenticated'); end if;
  delete from public.friendships f where f.a = least(p_profile_id, p_friend) and f.b = greatest(p_profile_id, p_friend);
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  return jsonb_build_object('status', 'ok');
end $$;

create or replace function public.block_profile(p_profile_id uuid, p_target uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public._social_owns(p_profile_id) then return jsonb_build_object('status', 'not_authenticated'); end if;
  if p_target is null or p_target = p_profile_id or not exists (select 1 from public.profiles where id = p_target) then
    return jsonb_build_object('status', 'not_found');
  end if;
  delete from public.friendships f where f.a = least(p_profile_id, p_target) and f.b = greatest(p_profile_id, p_target);
  delete from public.friend_requests r where (r.from_profile = p_profile_id and r.to_profile = p_target)
                                          or (r.from_profile = p_target and r.to_profile = p_profile_id);
  insert into public.blocks(blocker, blocked) values (p_profile_id, p_target) on conflict do nothing;
  return jsonb_build_object('status', 'ok');
end $$;

create or replace function public.unblock_profile(p_profile_id uuid, p_target uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public._social_owns(p_profile_id) then return jsonb_build_object('status', 'not_authenticated'); end if;
  delete from public.blocks b where b.blocker = p_profile_id and b.blocked = p_target;
  return jsonb_build_object('status', case when found then 'ok' else 'not_found' end);
end $$;

-- =============================================================================================
-- Réglages de visibilité
-- =============================================================================================
create or replace function public.set_social_settings(p_profile_id uuid, p_show_list boolean default null,
  p_show_progress boolean default null, p_show_ratings boolean default null, p_show_activity boolean default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.social_settings;
begin
  if not public._social_owns(p_profile_id) then return jsonb_build_object('status', 'not_authenticated'); end if;
  insert into public.social_settings(profile_id) values (p_profile_id) on conflict do nothing;
  update public.social_settings set show_list = coalesce(p_show_list, show_list), show_progress = coalesce(p_show_progress, show_progress),
         show_ratings = coalesce(p_show_ratings, show_ratings), show_activity = coalesce(p_show_activity, show_activity), updated_at = now()
   where profile_id = p_profile_id returning * into v;
  return jsonb_build_object('status', 'ok', 'settings', jsonb_build_object('show_list', v.show_list, 'show_progress', v.show_progress,
         'show_ratings', v.show_ratings, 'show_activity', v.show_activity));
end $$;

-- =============================================================================================
-- Lecture : mon espace social (écran Amis + export RGPD) et la fiche d'un ami
-- =============================================================================================
create or replace function public.get_my_social(p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_p public.profiles; v_s public.social_settings;
begin
  if not public._social_owns(p_profile_id) then return jsonb_build_object('status', 'not_authenticated'); end if;
  select * into v_p from public.profiles where id = p_profile_id;
  select * into v_s from public.social_settings where profile_id = p_profile_id;
  return jsonb_build_object('status', 'ok',
    'handle', v_p.handle, 'invite_code', v_p.invite_code, 'handle_changed_at', v_p.handle_changed_at,
    'next_handle_change_at', case when v_p.handle_changed_at is not null then v_p.handle_changed_at + interval '30 days' end,
    'settings', jsonb_build_object('show_list', coalesce(v_s.show_list, true), 'show_progress', coalesce(v_s.show_progress, true),
                                   'show_ratings', coalesce(v_s.show_ratings, false), 'show_activity', coalesce(v_s.show_activity, true)),
    'friends', coalesce((select jsonb_agg(public._social_card(o.id) || jsonb_build_object('since', f.created_at,
          'current', (select jsonb_build_object('title', w.title, 'type', w.type, 'poster_path', w.poster_path,
                        'season', case when coalesce(fs.show_progress, true) then w.saison end,
                        'episode', case when coalesce(fs.show_progress, true) then w.episode end)
                        from public.watchlist_items w where w.profile_id = o.id and w.status = 'encours' and not coalesce(w.deleted, false)
                          and coalesce(fs.show_list, true) order by w.updated_at desc nulls last limit 1))
          order by f.created_at desc)
        from public.friendships f
        join public.profiles o on o.id = case when f.a = p_profile_id then f.b else f.a end
        left join public.social_settings fs on fs.profile_id = o.id
        where p_profile_id in (f.a, f.b)), '[]'::jsonb),
    'incoming', coalesce((select jsonb_agg(public._social_card(r.from_profile) || jsonb_build_object('id', r.id, 'created_at', r.created_at) order by r.created_at desc)
        from public.friend_requests r where r.to_profile = p_profile_id and r.status = 'pending' and r.expires_at > now()), '[]'::jsonb),
    -- Côté expéditeur, une demande refusée reste « en attente » jusqu'à expiration (refus silencieux).
    'outgoing', coalesce((select jsonb_agg(public._social_card(r.to_profile) || jsonb_build_object('created_at', r.created_at, 'expires_at', r.expires_at) order by r.created_at desc)
        from public.friend_requests r where r.from_profile = p_profile_id and r.expires_at > now()), '[]'::jsonb),
    'blocked', coalesce((select jsonb_agg(public._social_card(b.blocked) || jsonb_build_object('since', b.created_at) order by b.created_at desc)
        from public.blocks b where b.blocker = p_profile_id), '[]'::jsonb));
end $$;

create or replace function public.get_friend_view(p_profile_id uuid, p_friend uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.social_settings; v_list boolean; v_prog boolean; v_rat boolean; v_items jsonb := '[]'::jsonb;
begin
  if not public._social_owns(p_profile_id) then return jsonb_build_object('status', 'not_authenticated'); end if;
  if not exists (select 1 from public.friendships f where f.a = least(p_profile_id, p_friend) and f.b = greatest(p_profile_id, p_friend)) then
    return jsonb_build_object('status', 'not_found');
  end if;
  select * into s from public.social_settings where profile_id = p_friend;
  v_list := coalesce(s.show_list, true); v_prog := coalesce(s.show_progress, true); v_rat := coalesce(s.show_ratings, false);
  if v_list then
    select coalesce(jsonb_agg(jsonb_build_object(
             'tmdb_id', w.tmdb_id, 'tmdb_type', w.tmdb_type, 'type', w.type,
             'status', case when w.status = 'todo' then 'avoir' else w.status end,
             'title', w.title, 'year', w.year, 'poster_path', w.poster_path,
             'season',  case when not v_prog or w.type = 'film' then null else w.saison end,
             'episode', case when not v_prog or w.type = 'film' then null else w.episode end,
             'rating',  case when v_rat then nullif(w.my_rating, 0) end)   -- notes texte : jamais
           order by w.updated_at desc nulls last), '[]'::jsonb)
      into v_items
      from (select * from public.watchlist_items i where i.profile_id = p_friend and not coalesce(i.deleted, false)
             order by i.updated_at desc nulls last limit 500) w;
  end if;
  return jsonb_build_object('status', 'ok', 'friend', public._social_card(p_friend),
    'show_list', v_list, 'show_progress', v_prog, 'show_ratings', v_rat, 'items', v_items);
end $$;

-- ---------- Droits ----------
revoke all on function public.check_handle(uuid, text), public.set_handle(uuid, text), public.get_invite(text, text),
  public.rotate_invite_code(uuid), public.send_friend_request(uuid, text, text), public.respond_friend_request(uuid, boolean),
  public.remove_friend(uuid, uuid), public.block_profile(uuid, uuid), public.unblock_profile(uuid, uuid),
  public.set_social_settings(uuid, boolean, boolean, boolean, boolean), public.get_my_social(uuid), public.get_friend_view(uuid, uuid)
  from public, anon;
grant execute on function public.check_handle(uuid, text), public.set_handle(uuid, text),
  public.rotate_invite_code(uuid), public.send_friend_request(uuid, text, text), public.respond_friend_request(uuid, boolean),
  public.remove_friend(uuid, uuid), public.block_profile(uuid, uuid), public.unblock_profile(uuid, uuid),
  public.set_social_settings(uuid, boolean, boolean, boolean, boolean), public.get_my_social(uuid), public.get_friend_view(uuid, uuid)
  to authenticated;
grant execute on function public.get_invite(text, text) to anon, authenticated;
