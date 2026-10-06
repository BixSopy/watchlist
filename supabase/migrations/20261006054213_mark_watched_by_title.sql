-- Variante par titre de mark_watched_by_token() : utilisée par l'extension navigateur
-- (Netflix/Prime/...), qui n'a pas de tmdb_id fiable sans appel TMDB cote client (clé API
-- jamais exposée hors serveur). Correspondance bornée au profil du jeton uniquement.

create or replace function public.mark_watched_by_title(
  p_token text,
  p_title text,
  p_season integer,
  p_episode integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid;
  v_item_id uuid;
  v_updated integer;
begin
  if p_token is null or p_token = '' or p_title is null or trim(p_title) = '' then
    return false;
  end if;

  select id into v_profile_id from public.profiles where plex_webhook_token = p_token;
  if v_profile_id is null then
    return false;
  end if;

  -- Correspondance exacte (insensible a la casse/espaces) en priorite
  select id into v_item_id
  from public.watchlist_items
  where profile_id = v_profile_id
    and deleted = false
    and lower(trim(title)) = lower(trim(p_title))
  order by added_at desc
  limit 1;

  -- A defaut, correspondance partielle (ex. variante du titre affichee par la plateforme)
  if v_item_id is null then
    select id into v_item_id
    from public.watchlist_items
    where profile_id = v_profile_id
      and deleted = false
      and (lower(title) like '%'||lower(trim(p_title))||'%' or lower(trim(p_title)) like '%'||lower(title)||'%')
    order by length(title) asc, added_at desc
    limit 1;
  end if;

  if v_item_id is null then
    return false;
  end if;

  if p_season is not null and p_episode is not null then
    update public.watchlist_items
    set saison = p_season,
        episode = p_episode,
        status = case when status in ('avoir','todo') then 'encours' else status end
    where id = v_item_id
      and (saison is null or episode is null
           or p_season > saison
           or (p_season = saison and p_episode >= episode));
  else
    update public.watchlist_items
    set status = 'termine'
    where id = v_item_id and status <> 'termine';
  end if;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.mark_watched_by_title(text, text, integer, integer) from public;
grant execute on function public.mark_watched_by_title(text, text, integer, integer) to anon, authenticated;
