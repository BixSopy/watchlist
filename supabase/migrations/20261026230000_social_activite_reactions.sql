-- =============================================================================================
-- 20261026230000_social_activite_reactions.sql — Social, étape 2 : fil d'activité + réactions
-- Cadrage validé par Pierre le 26/10/2026. NE PAS APPLIQUER en production sans son feu vert explicite.
--
-- Principe :
--  * Le fil n'est alimenté QUE par les progressions automatiques en direct : mark_watched_by_title
--    (extension navigateur, Netflix/Crunchyroll/Prime Video, seuil 80 % côté extension). Une
--    correction manuelle dans l'app ne génère jamais d'activité. La détection de nouveaux titres
--    (onglet « Détectés », extension_push_detections + validation manuelle de l'utilisateur) non
--    plus : seule la progression continue sur un titre déjà suivi compte.
--  * Regroupement : une progression sur un titre déjà présent dans les 3 dernières heures met à
--    jour la même ligne (saison/épisode, horodatage) au lieu d'en créer une nouvelle — un
--    marathon ne spamme pas le fil des amis.
--  * Visibilité : exactement les amis (table friendships), filtrés par social_settings.show_activity
--    de l'auteur (vrai par défaut). Un blocage retire déjà la ligne friendships (étape 1) : rien
--    à vérifier en plus ici. Le fil ne montre jamais plus que ce qu'un ami voit déjà sur la fiche
--    ami (titre, affiche, progression) — juste présenté dans l'ordre chronologique.
--  * Fenêtre : 30 jours, plafonnée à 25 entrées affichées (les plus récentes). Pas de pagination.
--  * Réactions : un emoji fixe parmi 6 (👍 ❤️ 🔥 😮 😂 🍿), un seul par personne par activité
--    (retaper le même retire la réaction, en taper un autre la remplace). Réservé à qui voit déjà
--    l'activité (ami avec show_activity, ou l'auteur lui-même) — réponse neutre sinon.
--  * Rejouable (idempotente).
-- =============================================================================================

-- ---------- Évènements d'activité ----------
create table if not exists public.activity_events (
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
create index if not exists activity_events_profile_recent_idx on public.activity_events(profile_id, updated_at desc);

alter table public.activity_events enable row level security;
revoke all on table public.activity_events from anon, authenticated;   -- lecture/écriture uniquement via les fonctions ci-dessous

-- ---------- Réactions (une par personne par évènement) ----------
create table if not exists public.activity_reactions (
  event_id   uuid not null references public.activity_events(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  emoji      text not null check (emoji in ('👍', '❤️', '🔥', '😮', '😂', '🍿')),
  created_at timestamptz not null default now(),
  primary key (event_id, profile_id)
);

alter table public.activity_reactions enable row level security;
revoke all on table public.activity_reactions from anon, authenticated;

-- =============================================================================================
-- Écriture : appelée en interne par mark_watched_by_title sur une progression effective.
-- =============================================================================================
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

-- =============================================================================================
-- mark_watched_by_title : même corps que 20261026180000_retrait_tautulli.sql (dernière version en
-- vigueur), seul ajout : _social_log_activity sur une progression effective.
-- =============================================================================================
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

-- =============================================================================================
-- NOTE : extension_apply_import n'existe plus (supprimée par 20261008160000_titres_detectes.sql,
-- remplacée par extension_push_detections + validation manuelle dans l'onglet « Détectés »).
-- schema.sql la montre encore définie avant son propre drop plus loin dans le même fichier — seul
-- mark_watched_by_title ci-dessus est le mécanisme continu et automatique à brancher.
-- =============================================================================================
-- Lecture : fil d'activité des amis (30 jours, plafonné à 25 entrées, pas de pagination)
-- =============================================================================================
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

-- =============================================================================================
-- Écriture : réagir (un tap = pose/remplace, retaper le même retire). Réponse neutre si
-- l'activité n'existe pas, n'est plus visible (bloqué/pas ami) ou si son auteur masque son activité.
-- =============================================================================================
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
