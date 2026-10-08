-- Tests de la migration 20261008150000_import_historique.sql (import de l'historique Netflix) sur Postgres local.
-- Chaque assertion lève une exception en cas d'échec (psql -v ON_ERROR_STOP=1).
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create or replace function pg_temp.check(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'ÉCHEC : %', p_msg; end if;
  raise notice 'ok - %', p_msg;
end $$;
set client_min_messages = notice;

-- ---------- Droits et durcissement ----------
select pg_temp.check(has_function_privilege('anon', 'public.extension_list_titles(text)', 'execute'), 'anon peut appeler extension_list_titles (jeton)');
select pg_temp.check(has_function_privilege('anon', 'public.extension_apply_import(text,jsonb,jsonb)', 'execute'), 'anon peut appeler extension_apply_import (jeton)');
select pg_temp.check(has_function_privilege('anon', 'public.consume_api_quota_by_token(text,text,integer)', 'execute'), 'anon peut appeler consume_api_quota_by_token (jeton)');
select pg_temp.check((select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc
  where proname in ('extension_list_titles', 'extension_apply_import', 'consume_api_quota_by_token')), 'SECURITY DEFINER + search_path figé');
select pg_temp.check(not has_function_privilege('anon', 'public.extension_profile_for_token(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.extension_profile_for_token(text)', 'execute'), 'couche jeton non appelable par les clients');
select pg_temp.check((select count(*) = 3 from pg_proc where proname in ('extension_list_titles', 'extension_apply_import', 'consume_api_quota_by_token')), 'une seule signature par fonction');

-- ---------- Données ----------
insert into auth.users (id, email, email_confirmed_at) values
  ('77777777-7777-7777-7777-777777777777', 'e@exemple.fr', now()),
  ('88888888-8888-8888-8888-888888888888', 'f@exemple.fr', now());
insert into public.profiles (id, account_id, name, plex_webhook_token) values
  ('77777777-0000-0000-0000-000000000007', '77777777-7777-7777-7777-777777777777', 'E', repeat('a7', 24)),
  ('88888888-0000-0000-0000-000000000008', '88888888-8888-8888-8888-888888888888', 'F', repeat('b8', 24));
insert into public.watchlist_items (id, local_id, profile_id, type, title, status, saison, episode, tmdb_id, tmdb_type, deleted) values
  ('70000000-0000-0000-0000-000000000001', 'stranger', '77777777-0000-0000-0000-000000000007', 'serie', 'Stranger Things', 'encours', 2, 3, 66732, 'tv', false),
  ('70000000-0000-0000-0000-000000000002', 'witcher',  '77777777-0000-0000-0000-000000000007', 'serie', 'The Witcher',     'avoir',   null, null, 71912, 'tv', false),
  ('70000000-0000-0000-0000-000000000003', 'dune',     '77777777-0000-0000-0000-000000000007', 'film',  'Dune (2021)',     'avoir',   null, null, 438631, 'movie', false),
  ('70000000-0000-0000-0000-000000000004', 'old',      '77777777-0000-0000-0000-000000000007', 'serie', 'Ancienne',        'avoir',   null, null, 1, 'tv', true),
  ('80000000-0000-0000-0000-000000000001', 'strangerF','88888888-0000-0000-0000-000000000008', 'serie', 'Stranger Things', 'avoir',   null, null, 66732, 'tv', false);

set role anon;

-- ---------- Liste des titres ----------
select pg_temp.check(public.extension_list_titles(repeat('00', 24)) = '{"status":"invalid_token"}'::jsonb, 'liste : jeton inconnu -> invalid_token');
select pg_temp.check(public.extension_list_titles('x'' or 1=1 --') ->> 'status' = 'invalid_token', 'liste : jeton mal formé -> invalid_token');
select pg_temp.check(public.extension_list_titles(null) ->> 'status' = 'invalid_token', 'liste : jeton absent -> invalid_token');
select pg_temp.check((select jsonb_array_length(public.extension_list_titles(repeat('a7', 24)) -> 'items') = 3), 'liste : 3 titres non supprimés du profil (pas ceux d''un autre compte)');
select pg_temp.check((select bool_or(i ->> 'norm' = 'dune') and bool_or(i ->> 'norm' = 'witcher') and bool_or(i ->> 'norm' = 'stranger things')
  from jsonb_array_elements(public.extension_list_titles(repeat('a7', 24)) -> 'items') i), 'liste : titres normalisés renvoyés');
select pg_temp.check((select (i ->> 'season')::int = 2 and (i ->> 'episode')::int = 3 and (i ->> 'tmdb_id')::int = 66732 and i ->> 'status' = 'encours'
  from jsonb_array_elements(public.extension_list_titles(repeat('a7', 24)) -> 'items') i where i ->> 'norm' = 'stranger things'), 'liste : progression, statut et tmdb_id renvoyés');

-- ---------- Application : jeton et bornes ----------
select pg_temp.check(public.extension_apply_import(repeat('00', 24), '[]', '[]') = '{"status":"invalid_token"}'::jsonb, 'lot : jeton inconnu -> invalid_token');
select pg_temp.check(public.extension_apply_import(repeat('a7', 24), '{}', '[]') ->> 'status' = 'invalid_input', 'lot : pas un tableau -> invalid_input');
select pg_temp.check(public.extension_apply_import(repeat('a7', 24),
  (select jsonb_agg(jsonb_build_object('id', '70000000-0000-0000-0000-000000000001', 'kind', 'episode', 'season', 1, 'episode', g)) from generate_series(1, 501) g), '[]') ->> 'status' = 'invalid_input',
  'lot : plus de 500 mises à jour -> invalid_input');
select pg_temp.check(public.extension_apply_import(repeat('a7', 24), '[]',
  (select jsonb_agg(jsonb_build_object('tmdb_id', g)) from generate_series(1, 201) g)) ->> 'status' = 'invalid_input',
  'lot : plus de 200 ajouts -> invalid_input');

-- ---------- Application : mises à jour ----------
select pg_temp.check(public.extension_apply_import(repeat('a7', 24), '[
    {"id": "70000000-0000-0000-0000-000000000001", "kind": "episode", "season": 3, "episode": 1},
    {"id": "70000000-0000-0000-0000-000000000002", "kind": "episode", "season": 1, "episode": 8},
    {"id": "70000000-0000-0000-0000-000000000003", "kind": "movie"},
    {"id": "80000000-0000-0000-0000-000000000001", "kind": "episode", "season": 4, "episode": 9},
    {"id": "70000000-0000-0000-0000-000000000004", "kind": "episode", "season": 1, "episode": 1},
    {"id": "70000000-0000-0000-0000-000000000003", "kind": "episode", "season": 1, "episode": 1},
    {"id": "pas-un-uuid", "kind": "episode", "season": 1, "episode": 1},
    {"id": "70000000-0000-0000-0000-000000000001", "kind": "episode", "season": "1", "episode": 1},
    {"id": "70000000-0000-0000-0000-000000000001", "kind": "episode", "season": 1.5, "episode": 1},
    {"id": "70000000-0000-0000-0000-000000000001", "kind": "show"},
    {"id": "70000000-0000-0000-0000-000000000002", "kind": "episode", "season": 1, "episode": 2}
  ]', '[]') -> 'updates' = '[
    {"id": "70000000-0000-0000-0000-000000000001", "result": "updated"},
    {"id": "70000000-0000-0000-0000-000000000002", "result": "updated"},
    {"id": "70000000-0000-0000-0000-000000000003", "result": "updated"},
    {"id": "80000000-0000-0000-0000-000000000001", "result": "not_found"},
    {"id": "70000000-0000-0000-0000-000000000004", "result": "not_found"},
    {"id": "70000000-0000-0000-0000-000000000003", "result": "not_found"},
    {"id": "pas-un-uuid", "result": "invalid"},
    {"id": "70000000-0000-0000-0000-000000000001", "result": "invalid"},
    {"id": "70000000-0000-0000-0000-000000000001", "result": "invalid"},
    {"id": "70000000-0000-0000-0000-000000000001", "result": "invalid"},
    {"id": "70000000-0000-0000-0000-000000000002", "result": "already_up_to_date"}
  ]'::jsonb, 'lot : résultats par élément (avance, film terminé, autre compte, supprimé, mauvais type, entrées invalides, pas de recul)');

-- ---------- Application : nouveaux titres ----------
select pg_temp.check(public.extension_apply_import(repeat('a7', 24), '[]', '[
    {"tmdb_id": 1399, "tmdb_type": "tv", "type": "serie", "status": "encours", "title": "Game of Thrones", "year": "2011",
     "poster_path": "/1XS1oqL89opfnbLl8WnZY1O1uJx.jpg", "overview": "Résumé", "tmdb_score": 8.5, "saison": 2, "episode": 4},
    {"tmdb_id": 1429, "tmdb_type": "tv", "type": "anime", "status": "termine", "title": "L''Attaque des Titans", "year": "2013",
     "poster_path": null, "overview": "", "tmdb_score": null, "saison": 4, "episode": 30, "anime_genre": "shonen"},
    {"tmdb_id": 27205, "tmdb_type": "movie", "type": "film", "status": "termine", "title": "Inception", "year": "2010",
     "poster_path": "/x.jpg", "overview": "", "tmdb_score": 8.4},
    {"tmdb_id": 66732, "tmdb_type": "tv", "type": "serie", "status": "encours", "title": "Stranger Things", "year": "2016", "saison": 1, "episode": 1},
    {"tmdb_id": 1399, "tmdb_type": "tv", "type": "serie", "status": "encours", "title": "Game of Thrones", "year": "2011", "saison": 1, "episode": 1},
    {"tmdb_id": 438631, "tmdb_type": "tv", "type": "serie", "status": "encours", "title": "Pas un doublon (type TMDB différent)", "year": "", "saison": 1, "episode": 1},
    {"tmdb_id": 5, "tmdb_type": "movie", "type": "film", "status": "encours", "title": "Film en cours"},
    {"tmdb_id": 6, "tmdb_type": "movie", "type": "film", "status": "termine", "title": "Film avec saison", "saison": 1, "episode": 1},
    {"tmdb_id": 7, "tmdb_type": "tv", "type": "serie", "status": "encours", "title": "Série sans épisode"},
    {"tmdb_id": 8, "tmdb_type": "tv", "type": "film", "status": "encours", "title": "Mauvais type", "saison": 1, "episode": 1},
    {"tmdb_id": 9, "tmdb_type": "tv", "type": "serie", "status": "avoir", "title": "Mauvais statut", "saison": 1, "episode": 1},
    {"tmdb_id": 10, "tmdb_type": "tv", "type": "serie", "status": "encours", "title": "", "saison": 1, "episode": 1},
    {"tmdb_id": 11, "tmdb_type": "tv", "type": "serie", "status": "encours", "title": "Affiche piégée", "poster_path": "https://evil.example/x.jpg", "saison": 1, "episode": 1},
    {"tmdb_id": 12, "tmdb_type": "tv", "type": "serie", "status": "encours", "title": "Note hors bornes", "tmdb_score": 11, "saison": 1, "episode": 1},
    {"tmdb_id": 13, "tmdb_type": "tv", "type": "serie", "status": "encours", "title": "Genre sur une série", "anime_genre": "shonen", "saison": 1, "episode": 1},
    {"tmdb_id": "14", "tmdb_type": "tv", "type": "serie", "status": "encours", "title": "Id texte", "saison": 1, "episode": 1},
    {"tmdb_id": 15, "tmdb_type": "tv", "type": "serie", "status": "encours", "title": "Année bizarre", "year": "deux mille", "saison": 1, "episode": 1}
  ]') -> 'inserts' @> '[
    {"tmdb_id": 1399, "result": "inserted"}, {"tmdb_id": 1429, "result": "inserted"}, {"tmdb_id": 27205, "result": "inserted"},
    {"tmdb_id": 66732, "result": "duplicate"}, {"tmdb_id": 1399, "result": "duplicate"}, {"tmdb_id": 438631, "result": "inserted"},
    {"tmdb_id": 5, "result": "invalid"}, {"tmdb_id": 6, "result": "invalid"}, {"tmdb_id": 7, "result": "invalid"},
    {"tmdb_id": 8, "result": "invalid"}, {"tmdb_id": 9, "result": "invalid"}, {"tmdb_id": 10, "result": "invalid"},
    {"tmdb_id": 11, "result": "invalid"}, {"tmdb_id": 12, "result": "invalid"}, {"tmdb_id": 13, "result": "invalid"},
    {"tmdb_id": "14", "result": "invalid"}, {"tmdb_id": 15, "result": "invalid"}
  ]'::jsonb, 'lot : ajouts (insérés, doublons par tmdb_id y compris dans le lot, entrées invalides refusées)');
reset role;

-- ---------- Etat final ----------
select pg_temp.check((select saison = 3 and episode = 1 and status = 'encours' from public.watchlist_items where local_id = 'stranger'), 'Stranger Things : S3E1');
select pg_temp.check((select saison = 1 and episode = 8 and status = 'encours' from public.watchlist_items where local_id = 'witcher'), 'The Witcher : S1E8, à voir -> en cours (pas de recul ensuite)');
select pg_temp.check((select status = 'termine' and saison is null from public.watchlist_items where local_id = 'dune'), 'Dune : terminé');
select pg_temp.check((select status = 'avoir' and saison is null from public.watchlist_items where local_id = 'strangerF'), 'autre compte intact');
select pg_temp.check((select saison is null from public.watchlist_items where local_id = 'old'), 'titre supprimé intact');
select pg_temp.check((select count(*) = 1 from public.watchlist_items where profile_id = '77777777-0000-0000-0000-000000000007' and tmdb_id = 1399), 'Game of Thrones ajouté une seule fois');
select pg_temp.check((select type = 'serie' and status = 'encours' and saison = 2 and episode = 4 and year = '2011' and poster_path = '/1XS1oqL89opfnbLl8WnZY1O1uJx.jpg'
  and tmdb_score = 8.5 and overview = 'Résumé' and tags = '{}' and tmdb_type = 'tv' and deleted = false and has_new_ep = false
  and local_id ~ '^nf[0-9a-f]{32}$' and added_at is not null
  from public.watchlist_items where profile_id = '77777777-0000-0000-0000-000000000007' and tmdb_id = 1399), 'nouvelle série : mêmes champs qu''un ajout manuel');
select pg_temp.check((select type = 'anime' and status = 'termine' and anime_genre = 'shonen' and poster_path is null
  from public.watchlist_items where tmdb_id = 1429), 'nouvel anime terminé avec son genre');
select pg_temp.check((select type = 'film' and status = 'termine' and saison is null and episode is null
  from public.watchlist_items where tmdb_id = 27205), 'nouveau film terminé');
select pg_temp.check((select count(*) = 0 from public.watchlist_items where tmdb_id between 5 and 15), 'aucune entrée invalide insérée');

-- ---------- Quota par jeton ----------
set role anon;
select pg_temp.check(public.consume_api_quota_by_token(repeat('00', 24), 'tmdb', 1) = '{"allowed":false,"scope":"invalid_token"}'::jsonb, 'quota : jeton inconnu -> refusé');
select pg_temp.check(public.consume_api_quota_by_token('court', 'tmdb', 1) ->> 'scope' = 'invalid_token', 'quota : jeton mal formé -> refusé');
select pg_temp.check((public.consume_api_quota_by_token(repeat('a7', 24), 'tmdb', 1) ->> 'allowed')::boolean, 'quota : jeton valide -> autorisé');
select pg_temp.check((public.consume_api_quota_by_token(repeat('a7', 24), 'tmdb', 1) ->> 'used')::int = 2, 'quota : compté sur le compte du propriétaire');
reset role;
update public.api_usage set count = 4000 where account_id = '77777777-7777-7777-7777-777777777777' and bucket = 'tmdb';
set role anon;
select pg_temp.check(public.consume_api_quota_by_token(repeat('a7', 24), 'tmdb', 1) ->> 'scope' = 'user', 'quota : limite quotidienne partagée avec le site (4 000)');
reset role;
select pg_temp.check((select count = 4000 from public.api_usage where account_id = '77777777-7777-7777-7777-777777777777' and bucket = 'tmdb'), 'quota : un refus ne compte pas');

do $$ begin raise notice 'Tests 30_import_historique passés.'; end $$;
