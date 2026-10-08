-- Tests des migrations 20261008150000_import_historique.sql et 20261008160000_titres_detectes.sql
-- (titres détectés par l'extension) sur Postgres local.
-- Chaque assertion lève une exception en cas d'échec (psql -v ON_ERROR_STOP=1).
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create or replace function pg_temp.check(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'ÉCHEC : %', p_msg; end if;
  raise notice 'ok - %', p_msg;
end $$;
grant execute on function pg_temp.check(boolean, text) to anon, authenticated;
set client_min_messages = notice;

-- ---------- Surface : fonctions et droits ----------
select pg_temp.check(not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
  and proname in ('extension_list_titles', 'extension_apply_import', 'consume_api_quota_by_token')), 'anciennes fonctions de la page de l''extension supprimées');
select pg_temp.check(has_function_privilege('anon', 'public.extension_push_detections(text,jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.extension_push_detections(text,jsonb)', 'execute'), 'extension_push_detections appelable (jeton)');

select pg_temp.check((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where proname = 'extension_push_detections'), 'SECURITY DEFINER + search_path figé');
select pg_temp.check(not has_function_privilege('anon', 'public.extension_profile_for_token(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.extension_profile_for_token(text)', 'execute'), 'couche jeton non appelable par les clients');
select pg_temp.check((select relrowsecurity from pg_class where oid = 'public.detected_media'::regclass), 'RLS activée sur detected_media');
select pg_temp.check(not has_table_privilege('anon', 'public.detected_media', 'select')
  and not has_table_privilege('anon', 'public.detected_media', 'insert'), 'anon : aucun accès à la table');
select pg_temp.check(has_table_privilege('authenticated', 'public.detected_media', 'select')
  and has_table_privilege('authenticated', 'public.detected_media', 'delete')
  and not has_table_privilege('authenticated', 'public.detected_media', 'insert')
  and not has_table_privilege('authenticated', 'public.detected_media', 'update'), 'authenticated : lecture et effacement, pas d''insertion');
select pg_temp.check(has_column_privilege('authenticated', 'public.detected_media', 'state', 'update')
  and not has_column_privilege('authenticated', 'public.detected_media', 'raw_title', 'update')
  and not has_column_privilege('authenticated', 'public.detected_media', 'user_id', 'update'), 'authenticated : seule la colonne state est modifiable');

-- ---------- Données ----------
insert into auth.users (id, email, email_confirmed_at) values
  ('77777777-7777-7777-7777-777777777777', 'e@exemple.fr', now()),
  ('88888888-8888-8888-8888-888888888888', 'f@exemple.fr', now());
insert into public.profiles (id, account_id, name, plex_webhook_token) values
  ('77777777-0000-0000-0000-000000000007', '77777777-7777-7777-7777-777777777777', 'E', repeat('a7', 24)),
  ('88888888-0000-0000-0000-000000000008', '88888888-8888-8888-8888-888888888888', 'F', repeat('b8', 24));

set role anon;

-- ---------- Envoi : jeton et bornes ----------
select pg_temp.check(public.extension_push_detections(repeat('00', 24), '[]') = '{"status":"invalid_token"}'::jsonb, 'envoi : jeton inconnu -> invalid_token');
select pg_temp.check(public.extension_push_detections('x'' or 1=1 --', '[]') ->> 'status' = 'invalid_token', 'envoi : jeton mal formé -> invalid_token');
select pg_temp.check(public.extension_push_detections(null, '[]') ->> 'status' = 'invalid_token', 'envoi : jeton absent -> invalid_token');
select pg_temp.check(public.extension_push_detections(repeat('a7', 24), '{}') ->> 'status' = 'invalid_input', 'envoi : pas un tableau -> invalid_input');
select pg_temp.check(public.extension_push_detections(repeat('a7', 24), null) ->> 'status' = 'invalid_input', 'envoi : null -> invalid_input');
select pg_temp.check(public.extension_push_detections(repeat('a7', 24),
  (select jsonb_agg(jsonb_build_object('source', 'netflix', 'title', 'T' || g, 'type', 'movie')) from generate_series(1, 1001) g)) ->> 'status' = 'invalid_input',
  'envoi : plus de 1 000 éléments -> invalid_input');

-- ---------- Envoi : validation et insertion ----------
select pg_temp.check(public.extension_push_detections(repeat('a7', 24), '[
  {"source":"netflix","title":"Stranger Things","type":"show","season":2,"episode":3,"watched_at":1780000000000,"progress_pct":95},
  {"source":"netflix","title":"Dune (2021)","type":"movie","watched_at":1780000000000},
  {"source":"netflix_csv","title":"Lupin","type":"show","season":1,"episode":2},
  {"source":"live","title":"Arcane","type":"show","season":1,"episode":1,"watched_at":1780000000000,"progress_pct":40.6},
  {"source":"netflix","title":"Sans date bornée","type":"movie","watched_at":100},
  {"source":"autre","title":"Mauvaise source","type":"movie"},
  {"source":"netflix","title":"   ","type":"movie"},
  {"source":"netflix","title":"Film avec saison","type":"movie","season":1},
  {"source":"netflix","title":"Type inconnu","type":"book"},
  {"source":"netflix","title":"Saison négative","type":"show","season":-1,"episode":1},
  {"source":"netflix","title":"Pourcentage","type":"show","season":1,"episode":1,"progress_pct":140},
  {"source":"netflix","title":"Date énorme","type":"movie","watched_at":1e300},
  {"source":"netflix","title":"!!!","type":"movie"},
  "pas un objet"
]') = '{"status":"ok","inserted":5,"updated":0,"unchanged":0,"invalid":9}'::jsonb, 'envoi : 5 détections valides insérées, 9 invalides refusées');

reset role;
select pg_temp.check((select count(*) = 5 from public.detected_media where user_id = '77777777-7777-7777-7777-777777777777'), 'table : 5 lignes pour le compte du jeton');
select pg_temp.check((select normalized_title = 'dune' and season is null and state = 'pending' from public.detected_media where raw_title = 'Dune (2021)'), 'table : titre normalisé côté serveur (« Dune (2021) » -> « dune »)');
select pg_temp.check((select progress_pct = 41 from public.detected_media where raw_title = 'Arcane'), 'table : pourcentage arrondi');
select pg_temp.check((select watched_at is null from public.detected_media where raw_title = 'Sans date bornée'), 'table : date hors bornes ignorée');
set role anon;

-- ---------- Envoi : dédoublonnage (clé indépendante de la source), date la plus récente ----------
select pg_temp.check(public.extension_push_detections(repeat('a7', 24), '[
  {"source":"netflix_csv","title":"Stranger Things","type":"show","season":2,"episode":3,"watched_at":1770000000000},
  {"source":"netflix","title":"stranger things","type":"show","season":2,"episode":3,"watched_at":1790000000000,"progress_pct":100},
  {"source":"netflix","title":"Lupin","type":"show","season":1,"episode":2},
  {"source":"netflix","title":"Stranger Things","type":"show","season":2,"episode":4,"watched_at":1790000000000}
]') = '{"status":"ok","inserted":1,"updated":1,"unchanged":2,"invalid":0}'::jsonb, 'envoi : doublons fusionnés, seule une date plus récente remplace');
reset role;
select pg_temp.check((select count(*) = 1 and max(source) = 'netflix' and max(progress_pct) = 100
  and max(watched_at) = to_timestamp(1790000000) from public.detected_media where normalized_title = 'stranger things' and episode = 3), 'table : une ligne S2E3, date la plus récente gardée');

-- ---------- RLS : le propriétaire seulement ----------
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"88888888-8888-8888-8888-888888888888","role":"authenticated"}', false);
select pg_temp.check((select count(*) = 0 from public.detected_media), 'RLS : un autre compte ne voit aucune ligne');
with u as (update public.detected_media set state = 'ignored' returning 1) select pg_temp.check(count(*) = 0, 'RLS : un autre compte ne peut rien modifier') from u;
with d as (delete from public.detected_media returning 1) select pg_temp.check(count(*) = 0, 'RLS : un autre compte ne peut rien effacer') from d;
do $$ begin
  begin
    insert into public.detected_media (user_id, source, raw_title, normalized_title, media_type)
    values ('88888888-8888-8888-8888-888888888888', 'netflix', 'X', 'x', 'movie');
    raise exception 'ÉCHEC : insertion directe acceptée';
  exception when insufficient_privilege then raise notice 'ok - insertion directe refusée (même pour soi)';
  end;
end $$;

select set_config('request.jwt.claims', '{"sub":"77777777-7777-7777-7777-777777777777","role":"authenticated"}', false);
select pg_temp.check((select count(*) = 6 from public.detected_media), 'RLS : le propriétaire voit ses 6 lignes');
do $$ begin
  begin
    update public.detected_media set raw_title = 'modifié';
    raise exception 'ÉCHEC : modification d''une autre colonne acceptée';
  exception when insufficient_privilege then raise notice 'ok - seule la colonne state est modifiable';
  end;
  begin
    update public.detected_media set state = 'perdu';
    raise exception 'ÉCHEC : état inconnu accepté';
  exception when check_violation then raise notice 'ok - état inconnu refusé';
  end;
end $$;
with u as (update public.detected_media set state = 'ignored' where normalized_title = 'lupin' returning updated_at) select pg_temp.check(count(*) = 1, 'propriétaire : « Ignorer » (state = ignored)') from u;
with u as (update public.detected_media set state = 'added' where normalized_title = 'arcane' returning 1) select pg_temp.check(count(*) = 1, 'propriétaire : « Ajouter » (state = added)') from u;
reset role;

-- ---------- Titre ignoré : le reste ----------
set role anon;
select pg_temp.check(public.extension_push_detections(repeat('a7', 24), '[
  {"source":"netflix","title":"Lupin","type":"show","season":2,"episode":1,"watched_at":1790000000000}
]') ->> 'inserted' = '1', 'envoi : nouvel épisode d''un titre ignoré inséré');
reset role;
select pg_temp.check((select state = 'ignored' from public.detected_media where normalized_title = 'lupin' and season = 2), 'titre ignoré : la nouvelle détection arrive « ignored »');

-- ---------- Effacement par le propriétaire ----------
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"77777777-7777-7777-7777-777777777777","role":"authenticated"}', false);
with d as (delete from public.detected_media where state = 'pending' returning 1) select pg_temp.check(count(*) = 4, 'propriétaire : « Tout effacer » (lignes en attente)') from d;
reset role;

-- ---------- Plafond par compte ----------
insert into public.detected_media (user_id, source, raw_title, normalized_title, media_type)
select '88888888-8888-8888-8888-888888888888', 'netflix', 'T' || g, 't' || g, 'movie' from generate_series(1, 19999) g;
set role anon;
select pg_temp.check(public.extension_push_detections(repeat('b8', 24), '[{"source":"netflix","title":"A","type":"movie"},{"source":"netflix","title":"B","type":"movie"}]') ->> 'status' = 'limit', 'envoi : plafond de 20 000 lignes par compte');
select pg_temp.check(public.extension_push_detections(repeat('b8', 24), '[{"source":"netflix","title":"A","type":"movie"}]') ->> 'inserted' = '1', 'envoi : sous le plafond, accepté');
reset role;

-- ---------- Suppression du compte : lignes effacées ----------
delete from auth.users where id = '88888888-8888-8888-8888-888888888888';
select pg_temp.check((select count(*) = 0 from public.detected_media where user_id = '88888888-8888-8888-8888-888888888888'), 'compte supprimé : détections effacées (cascade)');

\echo 'Tests 30_titres_detectes passés.'
