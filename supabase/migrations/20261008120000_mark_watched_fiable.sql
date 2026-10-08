-- Extension navigateur : correspondance par titre fiable pour mark_watched_by_title().
--
-- Avant : correspondance exacte (casse/espaces) puis, à défaut, correspondance PARTIELLE dans les
-- deux sens (« contient »), le titre le plus court gagnant. Un titre court de la liste (« Up »,
-- « You ») attrapait donc n'importe quel titre qui le contient, les caractères % et _ servaient de
-- jokers, et un film pouvait recevoir une saison/un épisode (ou une série passer « terminé »).
--
-- Après :
--  - titres comparés après normalisation (public.normalize_title_for_match) : minuscules, accents
--    retirés, ponctuation retirée, article initial retiré (the, le, la, les, l'), année entre
--    parenthèses/crochets en fin de titre retirée (« Dune (2021) ») ;
--  - correspondance EXACTE uniquement sur ce titre normalisé : plus aucune correspondance partielle
--    (aucun LIKE) ;
--  - type vérifié : un épisode ne touche qu'une série/un anime, un film qu'un film. Le type vient du
--    nouveau paramètre p_type ('episode' | 'movie'), ou est déduit de la présence d'une saison et
--    d'un épisode quand il est absent (extension 0.3.0, compatibilité) ;
--  - 0 titre trouvé : rien modifié ; plusieurs titres trouvés : rien modifié (« ambiguous ») ;
--  - la progression n'avance toujours que vers l'avant ;
--  - résultat structuré (jsonb) affichable par l'extension :
--      {"status": "updated" | "already_up_to_date" | "not_found" | "ambiguous" | "invalid_token"
--                 | "invalid_input", "title": ..., "season": ..., "episode": ..., "count": ...}
--
-- Compatibilité : l'ancienne signature (4 paramètres, résultat booléen) est remplacée par une
-- signature à 5 paramètres dont le dernier (p_type) a une valeur par défaut : un appel REST de
-- l'extension 0.3.0 ({p_token, p_title, p_season, p_episode}) aboutit toujours à cette fonction.
-- L'extension 0.3.0 ignore le résultat (elle ne l'affiche pas). L'extension 0.4.0 sait aussi parler
-- à l'ancienne fonction tant que cette migration n'est pas appliquée.
-- mark_watched_by_token() (Tautulli/Plex, par tmdb_id) n'est pas modifiée.
--
-- Rejouable sans erreur (idempotente).

-- ---------------------------------------------------------------------------------------------
-- Normalisation d'un titre (pure, sans extension : pas besoin d'installer unaccent)
-- ---------------------------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------------------------
-- mark_watched_by_title : remplace l'ancienne version (4 paramètres, booléen)
-- ---------------------------------------------------------------------------------------------
drop function if exists public.mark_watched_by_title(text, text, integer, integer);

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

-- PostgREST : prendre en compte la nouvelle signature sans attendre
notify pgrst, 'reload schema';
