-- Tests de la migration 20261029100000_detected_block_title.sql (« ne plus jamais détecter »)
-- sur Postgres local.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.check(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'ÉCHEC : %', p_msg; end if;
  raise notice 'ok - %', p_msg;
end $$;
grant execute on function pg_temp.check(boolean, text) to anon, authenticated;
create temp table t_db(k text primary key, v text);
grant all on t_db to anon, authenticated;
create or replace function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p)::text, false)
$$;
grant execute on function pg_temp.as_user(uuid) to anon, authenticated;
set client_min_messages = notice;

-- ---------- Surface ----------
select pg_temp.check((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.detected_blocklist'::regclass), 'RLS activée et forcée');
select pg_temp.check(not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'detected_blocklist'), 'aucune policy : table fermée même pour son propriétaire');
select pg_temp.check(not has_table_privilege('authenticated', 'public.detected_blocklist', 'select')
  and not has_table_privilege('authenticated', 'public.detected_blocklist', 'insert'), 'authenticated : aucun accès direct à la table');
select pg_temp.check(not has_function_privilege('anon', 'public.detected_block_title(uuid[])', 'execute'), 'anon : aucun accès à la fonction');
select pg_temp.check((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where pronamespace = 'public'::regnamespace
  and proname = 'detected_block_title'), 'SECURITY DEFINER + search_path figé');

-- ---------- Données : deux comptes, jetons de suivi (ancien format, comme 60_appairage) ----------
insert into auth.users (id, email, email_confirmed_at) values
  ('33333333-cccc-cccc-cccc-333333333333', 'u1@exemple.fr', now()),
  ('44444444-dddd-dddd-dddd-444444444444', 'u2@exemple.fr', now());
insert into public.profiles (id, account_id, name, plex_webhook_token) values
  ('33333333-0000-0000-0000-00000000000c', '33333333-cccc-cccc-cccc-333333333333', 'U1', repeat('c3', 24)),
  ('44444444-0000-0000-0000-00000000000d', '44444444-dddd-dddd-dddd-444444444444', 'U2', repeat('d4', 24));

-- ---------- Détection initiale : deux épisodes de « Severance », un film ----------
set role anon;
select public.extension_push_detections(repeat('c3', 24),
  '[{"source":"netflix","title":"Severance","type":"show","season":1,"episode":2},
    {"source":"netflix","title":"Severance","type":"show","season":1,"episode":3},
    {"source":"netflix","title":"Dune","type":"movie"}]'::jsonb);
reset role;
select pg_temp.check((select count(*) from public.detected_media where user_id = '33333333-cccc-cccc-cccc-333333333333' and state = 'pending') = 3, '3 détections en attente');

-- ---------- Ignorer (comme le site : update direct, pas de blocage) un seul épisode ----------
insert into t_db select 's1e2', id::text from public.detected_media
  where user_id = '33333333-cccc-cccc-cccc-333333333333' and normalized_title = public.normalize_title_for_match('Severance') and episode = 2;
set role authenticated;
select pg_temp.as_user('33333333-cccc-cccc-cccc-333333333333');
update public.detected_media set state = 'ignored' where id = (select v::uuid from t_db where k = 's1e2');
reset role;
select pg_temp.check((select state from public.detected_media where id = (select v::uuid from t_db where k = 's1e2')) = 'ignored', 'épisode ignoré');
select pg_temp.check((select state from public.detected_media where user_id = '33333333-cccc-cccc-cccc-333333333333' and episode = 3) = 'pending', 'ignorer un épisode ne touche pas les autres (pas encore de blocage)');

-- ---------- Nouvel épisode détecté : pas bloqué, arrive bien en attente ----------
set role anon;
select public.extension_push_detections(repeat('c3', 24), '[{"source":"netflix","title":"Severance","type":"show","season":1,"episode":4}]'::jsonb);
reset role;
select pg_temp.check((select state from public.detected_media where user_id = '33333333-cccc-cccc-cccc-333333333333' and episode = 4) = 'pending', 'un nouvel épisode d''un titre juste « ignoré » (pas bloqué) revient en attente');

-- ---------- « Ne plus jamais me proposer ce titre » ----------
set role authenticated;
select pg_temp.as_user('44444444-dddd-dddd-dddd-444444444444');
select pg_temp.check(public.detected_block_title(array[(select v::uuid from t_db where k = 's1e2')]) ->> 'status' = 'ok', 'un autre compte : aucune erreur mais rien ne lui appartient');
reset role;
select pg_temp.check(not exists (select 1 from public.detected_blocklist where user_id = '44444444-dddd-dddd-dddd-444444444444'), 'u2 ne peut pas bloquer un titre en donnant l''id de u1');

set role authenticated;
select pg_temp.as_user('33333333-cccc-cccc-cccc-333333333333');
select pg_temp.check(public.detected_block_title(array[(select v::uuid from t_db where k = 's1e2')]) ->> 'status' = 'ok', 'u1 : blocage de Severance');
reset role;
select pg_temp.check(exists (select 1 from public.detected_blocklist where user_id = '33333333-cccc-cccc-cccc-333333333333' and media_type = 'show' and normalized_title = public.normalize_title_for_match('Severance')), 'entrée créée dans la liste de blocage');
select pg_temp.check((select state from public.detected_media where user_id = '33333333-cccc-cccc-cccc-333333333333' and episode = 3) = 'ignored', 'épisode 3 (en attente, pas sélectionné) aussi basculé ignored par le blocage');
select pg_temp.check((select state from public.detected_media where user_id = '33333333-cccc-cccc-cccc-333333333333' and episode = 4) = 'ignored', 'épisode 4 aussi');
select pg_temp.check((select state from public.detected_media where user_id = '33333333-cccc-cccc-cccc-333333333333' and normalized_title = public.normalize_title_for_match('Dune')) = 'pending', 'Dune (autre titre) non affecté');

-- ---------- Nouvelle détection d'un titre bloqué : direct ignored ----------
set role anon;
select public.extension_push_detections(repeat('c3', 24), '[{"source":"netflix","title":"Severance","type":"show","season":2,"episode":1}]'::jsonb);
reset role;
select pg_temp.check((select state from public.detected_media where user_id = '33333333-cccc-cccc-cccc-333333333333' and season = 2 and episode = 1) = 'ignored', 'nouvel épisode d''un titre bloqué : direct ignored');

-- ---------- Isolation : le blocage de u1 ne touche pas u3 ----------
insert into auth.users (id, email, email_confirmed_at) values
  ('55555555-eeee-eeee-eeee-555555555555', 'u3@exemple.fr', now());
insert into public.profiles (id, account_id, name, plex_webhook_token) values
  ('55555555-0000-0000-0000-00000000000e', '55555555-eeee-eeee-eeee-555555555555', 'U3', repeat('e5', 24));
set role anon;
select public.extension_push_detections(repeat('e5', 24), '[{"source":"netflix","title":"Severance","type":"show","season":1,"episode":1}]'::jsonb);
reset role;
select pg_temp.check((select state from public.detected_media where user_id = '55555555-eeee-eeee-eeee-555555555555') = 'pending', 'u3 : Severance pas bloqué chez lui');

-- ---------- Suppression du compte : cascade ----------
delete from auth.users where id = '33333333-cccc-cccc-cccc-333333333333';
select pg_temp.check(not exists (select 1 from public.detected_blocklist where user_id = '33333333-cccc-cccc-cccc-333333333333'), 'suppression du compte : liste de blocage supprimée (cascade)');
