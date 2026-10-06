-- Jeton webhook Plex/Tautulli par profil + fonction de marquage "vu" sans session utilisateur.
-- Le webhook (Tautulli, hors navigateur) n'a pas de JWT Supabase : la fonction SECURITY DEFINER
-- fait l'unique bypass RLS nécessaire, borné à ce qu'elle code (lookup par jeton + update ciblé).

alter table public.profiles add column plex_webhook_token text unique;

create or replace function public.mark_watched_by_token(
  p_token text,
  p_tmdb_id integer,
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
  v_updated integer;
begin
  if p_token is null or p_token = '' or p_tmdb_id is null then
    return false;
  end if;

  select id into v_profile_id from public.profiles where plex_webhook_token = p_token;
  if v_profile_id is null then
    return false;
  end if;

  if p_season is not null and p_episode is not null then
    -- Episode de serie/anime vu : avance la progression, jamais en arriere
    -- (un rewatch d'un episode deja depasse ne doit pas faire regresser le suivi).
    update public.watchlist_items
    set saison = p_season,
        episode = p_episode,
        status = case when status in ('avoir','todo') then 'encours' else status end
    where profile_id = v_profile_id
      and tmdb_id = p_tmdb_id
      and deleted = false
      and (saison is null or episode is null
           or p_season > saison
           or (p_season = saison and p_episode >= episode));
  else
    -- Film vu : marque directement termine.
    update public.watchlist_items
    set status = 'termine'
    where profile_id = v_profile_id
      and tmdb_id = p_tmdb_id
      and deleted = false
      and status <> 'termine';
  end if;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.mark_watched_by_token(text, integer, integer, integer) from public;
grant execute on function public.mark_watched_by_token(text, integer, integer, integer) to anon, authenticated;
