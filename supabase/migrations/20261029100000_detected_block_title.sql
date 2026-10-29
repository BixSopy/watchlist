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
