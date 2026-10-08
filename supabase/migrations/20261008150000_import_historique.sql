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
