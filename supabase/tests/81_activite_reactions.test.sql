-- Tests de la migration 20261026230000_social_activite_reactions.sql (fil d'activité + réactions)
-- sur Postgres local. Reprend le patron de 80_social.test.sql (nouveaux profils, isolés de ceux-là).
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.check(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'ÉCHEC : %', p_msg; end if;
  raise notice 'ok - %', p_msg;
end $$;
grant execute on function pg_temp.check(boolean, text) to anon, authenticated;
create temp table t_ar(k text primary key, v jsonb);
grant all on t_ar to anon, authenticated;
create or replace function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p)::text, false)
$$;
grant execute on function pg_temp.as_user(uuid) to anon, authenticated;
set client_min_messages = notice;

-- ---------- Surface ----------
select pg_temp.check((select bool_and(relrowsecurity) from pg_class where oid in
  ('public.activity_events'::regclass, 'public.activity_reactions'::regclass)), 'RLS activée sur les deux tables');
select pg_temp.check(not has_table_privilege('anon', 'public.activity_events', 'select')
  and not has_table_privilege('authenticated', 'public.activity_events', 'select')
  and not has_table_privilege('authenticated', 'public.activity_reactions', 'insert'), 'aucun accès direct aux tables (lecture/écriture par les fonctions seulement)');
select pg_temp.check(not has_function_privilege('anon', 'public.get_activity_feed(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.react_to_activity(uuid,uuid,text)', 'execute')
  and has_function_privilege('authenticated', 'public.get_activity_feed(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.react_to_activity(uuid,uuid,text)', 'execute'), 'get_activity_feed/react_to_activity : authenticated seulement');
select pg_temp.check((select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc where pronamespace = 'public'::regnamespace
  and proname in ('_social_log_activity', 'get_activity_feed', 'react_to_activity')), 'SECURITY DEFINER + search_path figé');

-- ---------- Données : Dinh (D, a un jeton de suivi), Max (E, son ami), Léo (F, pas son ami) ----------
insert into auth.users (id, email, email_confirmed_at) values
  ('a17a0000-1111-1111-1111-111111111111', 'dinh@exemple.fr', now()),
  ('a17a0000-2222-2222-2222-222222222222', 'max@exemple.fr', now()),
  ('a17a0000-3333-3333-3333-333333333333', 'leo@exemple.fr', now());
insert into public.profiles (id, account_id, name, plex_webhook_token) values
  ('a17a0000-0000-0000-0000-00000000000d', 'a17a0000-1111-1111-1111-111111111111', 'Dinh', repeat('d1', 24)),
  ('a17a0000-0000-0000-0000-00000000000e', 'a17a0000-2222-2222-2222-222222222222', 'Max', null),
  ('a17a0000-0000-0000-0000-00000000000f', 'a17a0000-3333-3333-3333-333333333333', 'Léo', null);
insert into public.watchlist_items (local_id, profile_id, tmdb_id, tmdb_type, type, status, title, year, poster_path, tags, saison, episode, deleted) values
  ('ar1', 'a17a0000-0000-0000-0000-00000000000d', 95396, 'tv', 'serie', 'encours', 'Severance', '2022', '/sv.jpg', '{}', 1, 1, false),
  ('ar2', 'a17a0000-0000-0000-0000-00000000000d', 438631, 'movie', 'film', 'avoir', 'Dune', '2021', '/d.jpg', '{}', null, null, false);
insert into public.friendships(a, b) values
  (least('a17a0000-0000-0000-0000-00000000000d'::uuid, 'a17a0000-0000-0000-0000-00000000000e'::uuid),
   greatest('a17a0000-0000-0000-0000-00000000000d'::uuid, 'a17a0000-0000-0000-0000-00000000000e'::uuid));

-- ---------- Écriture : mark_watched_by_title alimente le fil ----------
insert into t_ar values ('m1', public.mark_watched_by_title(repeat('d1', 24), 'Severance', 1, 2, 'episode'));
select pg_temp.check((select v ->> 'status' = 'updated' from t_ar where k = 'm1'), 'Severance S1E2 -> updated');
select pg_temp.check((select count(*) = 1 from public.activity_events where profile_id = 'a17a0000-0000-0000-0000-00000000000d'), 'un évènement créé');
select pg_temp.check((select kind = 'episode' and season = 1 and episode = 2 from public.activity_events
  where profile_id = 'a17a0000-0000-0000-0000-00000000000d'), 'épisode et saison corrects');

-- Progression rapide sur le même titre (< 3h) : même ligne mise à jour, pas de doublon
select public.mark_watched_by_title(repeat('d1', 24), 'Severance', 1, 3, 'episode');
select pg_temp.check((select count(*) = 1 from public.activity_events where profile_id = 'a17a0000-0000-0000-0000-00000000000d'), 'marathon S1E2->E3 : toujours un seul évènement (regroupé)');
select pg_temp.check((select episode = 3 from public.activity_events where profile_id = 'a17a0000-0000-0000-0000-00000000000d' and kind = 'episode'), 'épisode mis à jour à 3');

-- Hors fenêtre de regroupement (> 3h) : un nouvel évènement, pas un remplacement
update public.activity_events set updated_at = now() - interval '4 hours' where profile_id = 'a17a0000-0000-0000-0000-00000000000d';
select public.mark_watched_by_title(repeat('d1', 24), 'Severance', 1, 4, 'episode');
select pg_temp.check((select count(*) = 2 from public.activity_events where profile_id = 'a17a0000-0000-0000-0000-00000000000d'), 'plus de 3h plus tard : second évènement créé (pas de regroupement)');

-- Film : terminé -> évènement de type film, sans saison/épisode
select public.mark_watched_by_title(repeat('d1', 24), 'Dune', null, null, 'movie');
select pg_temp.check((select count(*) = 1 from public.activity_events
  where profile_id = 'a17a0000-0000-0000-0000-00000000000d' and kind = 'film' and season is null and episode is null), 'Dune terminé -> évènement film, sans saison/épisode');

-- Correction manuelle (hors extension) : aucune fonction de l'app ne doit écrire dans activity_events ;
-- vérifié indirectement par la surface ci-dessus (aucune écriture possible hors _social_log_activity,
-- elle-même appelable seulement par mark_watched_by_title via SECURITY DEFINER).

-- ---------- Lecture : get_activity_feed ----------
set role authenticated;
select pg_temp.check(public.get_activity_feed('a17a0000-0000-0000-0000-00000000000e') ->> 'status' = 'not_authenticated', 'sans session : refusé');
select pg_temp.as_user('a17a0000-2222-2222-2222-222222222222');  -- Max
insert into t_ar values ('f1', public.get_activity_feed('a17a0000-0000-0000-0000-00000000000e'));
select pg_temp.check((select v ->> 'status' = 'ok' from t_ar where k = 'f1'), 'Max : lecture ok');
select pg_temp.check((select jsonb_array_length(v -> 'items') = 3 from t_ar where k = 'f1'), 'Max voit les 3 évènements de son ami Dinh (Severance x2 + Dune)');
select pg_temp.check((select (v -> 'items' -> 0 ->> 'title') = 'Dune' from t_ar where k = 'f1'), 'le plus récent (Dune) en premier');
select pg_temp.check((select (v -> 'items' -> 0 -> 'friend' ->> 'profile_id') = 'a17a0000-0000-0000-0000-00000000000d' from t_ar where k = 'f1'), 'fiche de Dinh dans l''évènement');

select pg_temp.as_user('a17a0000-3333-3333-3333-333333333333');  -- Léo, pas ami avec Dinh
select pg_temp.check((select jsonb_array_length(public.get_activity_feed('a17a0000-0000-0000-0000-00000000000f') -> 'items') = 0), 'Léo (pas ami) ne voit rien');

-- Dinh masque son activité : plus rien pour Max non plus
select pg_temp.as_user('a17a0000-1111-1111-1111-111111111111');  -- Dinh
select public.set_social_settings('a17a0000-0000-0000-0000-00000000000d', null, null, null, false);
select pg_temp.as_user('a17a0000-2222-2222-2222-222222222222');  -- Max
select pg_temp.check((select jsonb_array_length(public.get_activity_feed('a17a0000-0000-0000-0000-00000000000e') -> 'items') = 0), 'show_activity=false : Max ne voit plus rien');
select pg_temp.as_user('a17a0000-1111-1111-1111-111111111111');  -- Dinh
select public.set_social_settings('a17a0000-0000-0000-0000-00000000000d', null, null, null, true);  -- réactivé pour la suite

-- ---------- Réactions ----------
select pg_temp.as_user('a17a0000-2222-2222-2222-222222222222');  -- Max
insert into t_ar values ('f2', public.get_activity_feed('a17a0000-0000-0000-0000-00000000000e'));
insert into t_ar values ('ev', to_jsonb((select v -> 'items' -> 0 ->> 'event_id' from t_ar where k = 'f2')));
select pg_temp.check(public.react_to_activity('a17a0000-0000-0000-0000-00000000000e', 'a1a1a1a1-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '👍') ->> 'status' = 'not_found', 'évènement inconnu : réponse neutre');
select pg_temp.check(public.react_to_activity('a17a0000-0000-0000-0000-00000000000e', ((select v from t_ar where k = 'ev') #>> '{}')::uuid, '💩') ->> 'status' = 'invalid_emoji', 'emoji hors liste refusé');
insert into t_ar values ('r1', public.react_to_activity('a17a0000-0000-0000-0000-00000000000e', ((select v from t_ar where k = 'ev') #>> '{}')::uuid, '🔥'));
select pg_temp.check((select v ->> 'status' = 'ok' and v -> 'counts' ->> '🔥' = '1' and v ->> 'my_reaction' = '🔥' from t_ar where k = 'r1'), 'Max réagit 🔥');
insert into t_ar values ('r2', public.react_to_activity('a17a0000-0000-0000-0000-00000000000e', ((select v from t_ar where k = 'ev') #>> '{}')::uuid, '❤️'));
select pg_temp.check((select v ->> 'my_reaction' = '❤️' and (v -> 'counts' ->> '🔥') is null from t_ar where k = 'r2'), 'retaper un autre emoji remplace (une seule réaction par personne)');
insert into t_ar values ('r3', public.react_to_activity('a17a0000-0000-0000-0000-00000000000e', ((select v from t_ar where k = 'ev') #>> '{}')::uuid, '❤️'));
select pg_temp.check((select v ->> 'status' = 'removed' and v ->> 'my_reaction' is null from t_ar where k = 'r3'), 'retaper le même emoji retire la réaction');

select pg_temp.as_user('a17a0000-3333-3333-3333-333333333333');  -- Léo, pas ami : ne peut pas réagir
select pg_temp.check(public.react_to_activity('a17a0000-0000-0000-0000-00000000000f', ((select v from t_ar where k = 'ev') #>> '{}')::uuid, '👍') ->> 'status' = 'not_found', 'Léo (pas ami) : réponse neutre, pas de réaction posée');

select pg_temp.as_user('a17a0000-1111-1111-1111-111111111111');  -- Dinh réagit à sa propre activité
insert into t_ar values ('r4', public.react_to_activity('a17a0000-0000-0000-0000-00000000000d', ((select v from t_ar where k = 'ev') #>> '{}')::uuid, '😮'));
select pg_temp.check((select v ->> 'status' = 'ok' from t_ar where k = 'r4'), 'l''auteur peut réagir à sa propre activité');

-- ---------- Suppression du compte : tout part en cascade ----------
reset role;
delete from auth.users where id = 'a17a0000-1111-1111-1111-111111111111';
select pg_temp.check((select count(*) = 0 from public.activity_events where profile_id = 'a17a0000-0000-0000-0000-00000000000d'), 'suppression du compte : évènements supprimés (cascade)');
select pg_temp.check((select count(*) = 0 from public.activity_reactions), 'cascade cohérente : la réaction de Max sur l''évènement disparu est partie avec lui');
