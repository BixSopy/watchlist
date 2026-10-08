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
