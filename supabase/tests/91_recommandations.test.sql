-- Tests de la migration 20261029120000_social_recommandations.sql
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.check(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'ÉCHEC : %', p_msg; end if;
  raise notice 'ok - %', p_msg;
end $$;
grant execute on function pg_temp.check(boolean, text) to anon, authenticated;
create temp table t_rc(k text primary key, v jsonb);
grant all on t_rc to anon, authenticated;
create or replace function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p)::text, false)
$$;
grant execute on function pg_temp.as_user(uuid) to anon, authenticated;
set client_min_messages = notice;

-- ---------- Surface ----------
select pg_temp.check((select relrowsecurity from pg_class where oid = 'public.recommendations'::regclass), 'RLS activée');
select pg_temp.check(not has_table_privilege('authenticated', 'public.recommendations', 'select')
  and not has_table_privilege('authenticated', 'public.recommendations', 'insert')
  and not has_table_privilege('anon', 'public.recommendations', 'select'), 'aucun accès direct à la table');
select pg_temp.check(not has_function_privilege('anon', 'public.send_recommendation(uuid,uuid[],integer,text,text,text,text,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.watch_together(uuid,uuid[],text)', 'execute')
  and has_function_privilege('authenticated', 'public.watch_together(uuid,uuid[],text)', 'execute')
  and has_function_privilege('authenticated', 'public.get_my_recommendations(uuid)', 'execute'), 'fonctions : authenticated seulement');
select pg_temp.check((select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc where pronamespace = 'public'::regnamespace
  and proname in ('send_recommendation', 'get_my_recommendations', 'respond_recommendation', 'mark_recommendations_seen',
                  'set_reco_pref', 'export_my_recommendations', 'watch_together')), 'SECURITY DEFINER + search_path figé');
select pg_temp.check((select count(distinct x.indkey[0]) = 2 from pg_index x where x.indrelid = 'public.recommendations'::regclass
  and x.indkey[0] in (select attnum from pg_attribute where attrelid = 'public.recommendations'::regclass and attname in ('from_profile', 'to_profile'))),
  'index sur les deux clés étrangères');

-- ---------- Données : Ana (A), Bea (B, amie), Cyr (C, ami, liste privée), Dan (D, pas ami) ----------
insert into auth.users (id, email, email_confirmed_at) values
  ('b17b0000-1111-1111-1111-111111111111', 'ana@exemple.fr', now()),
  ('b17b0000-2222-2222-2222-222222222222', 'bea@exemple.fr', now()),
  ('b17b0000-3333-3333-3333-333333333333', 'cyr@exemple.fr', now()),
  ('b17b0000-4444-4444-4444-444444444444', 'dan@exemple.fr', now());
insert into public.profiles (id, account_id, name) values
  ('b17b0000-0000-0000-0000-00000000000a', 'b17b0000-1111-1111-1111-111111111111', 'Ana'),
  ('b17b0000-0000-0000-0000-00000000000b', 'b17b0000-2222-2222-2222-222222222222', 'Bea'),
  ('b17b0000-0000-0000-0000-00000000000c', 'b17b0000-3333-3333-3333-333333333333', 'Cyr'),
  ('b17b0000-0000-0000-0000-00000000000d', 'b17b0000-4444-4444-4444-444444444444', 'Dan');
insert into public.friendships(a, b) values
  ('b17b0000-0000-0000-0000-00000000000a', 'b17b0000-0000-0000-0000-00000000000b'),
  ('b17b0000-0000-0000-0000-00000000000a', 'b17b0000-0000-0000-0000-00000000000c');
insert into public.social_settings(profile_id, show_list) values ('b17b0000-0000-0000-0000-00000000000c', false);
insert into public.watchlist_items (local_id, profile_id, tmdb_id, tmdb_type, type, status, title, year, poster_path, tags, deleted) values
  ('wa1', 'b17b0000-0000-0000-0000-00000000000a', 438631, 'movie', 'film', 'avoir', 'Dune', '2021', '/d.jpg', '{}', false),
  ('wa2', 'b17b0000-0000-0000-0000-00000000000a', 95396, 'tv', 'serie', 'avoir', 'Severance', '2022', '/s.jpg', '{}', false),
  ('wa3', 'b17b0000-0000-0000-0000-00000000000a', 1, 'movie', 'film', 'termine', 'Vu par Ana', '2000', null, '{}', false),
  ('wa4', 'b17b0000-0000-0000-0000-00000000000a', 2, 'movie', 'film', 'avoir', 'Seulement Ana', '2000', null, '{}', false),
  ('wa5', 'b17b0000-0000-0000-0000-00000000000a', 4, 'tv', 'anime', 'avoir', 'Frieren', '2023', null, '{}', false),
  ('wb1', 'b17b0000-0000-0000-0000-00000000000b', 438631, 'movie', 'film', 'todo', 'Dune', '2021', '/d.jpg', '{}', false),
  ('wb2', 'b17b0000-0000-0000-0000-00000000000b', 95396, 'tv', 'serie', 'encours', 'Severance', '2022', '/s.jpg', '{}', false),
  ('wb3', 'b17b0000-0000-0000-0000-00000000000b', 1, 'movie', 'film', 'avoir', 'Vu par Ana', '2000', null, '{}', false),
  ('wb4', 'b17b0000-0000-0000-0000-00000000000b', 3, 'movie', 'film', 'avoir', 'Seulement Bea', '2000', null, '{}', false),
  ('wb5', 'b17b0000-0000-0000-0000-00000000000b', 4, 'tv', 'anime', 'avoir', 'Frieren', '2023', null, '{}', false),
  ('wc1', 'b17b0000-0000-0000-0000-00000000000c', 438631, 'movie', 'film', 'avoir', 'Dune', '2021', '/d.jpg', '{}', false);

set role authenticated;
-- ---------- Pas propriétaire ----------
select pg_temp.as_user('b17b0000-4444-4444-4444-444444444444');
select pg_temp.check(public.send_recommendation('b17b0000-0000-0000-0000-00000000000a', array['b17b0000-0000-0000-0000-00000000000b'::uuid], 1, 'movie', 'film', 'X')
  ->> 'status' = 'not_authenticated', 'envoyer au nom d''un autre profil : refusé');
select pg_temp.check(public.watch_together('b17b0000-0000-0000-0000-00000000000a', array['b17b0000-0000-0000-0000-00000000000b'::uuid]) ->> 'status' = 'not_authenticated',
  'watch_together au nom d''un autre profil : refusé');

-- ---------- Envoyer ----------
select pg_temp.as_user('b17b0000-1111-1111-1111-111111111111');  -- Ana
insert into t_rc values ('s1', public.send_recommendation('b17b0000-0000-0000-0000-00000000000a',
  array['b17b0000-0000-0000-0000-00000000000b', 'b17b0000-0000-0000-0000-00000000000d']::uuid[], 438631, 'movie', 'film', 'Dune', '2021', '/d.jpg', '  À voir au cinéma !  '));
select pg_temp.check((select v ->> 'status' = 'sent' and (v ->> 'count')::int = 2 from t_rc where k = 's1'), 'réponse neutre : « envoyé » à 2 (même pour un non-ami)');
reset role;
select pg_temp.check((select count(*) = 1 from public.recommendations), 'une seule ligne : le non-ami est ignoré');
select pg_temp.check((select message = 'À voir au cinéma !' from public.recommendations), 'message nettoyé');
set role authenticated;
select pg_temp.check(public.send_recommendation('b17b0000-0000-0000-0000-00000000000a', array['b17b0000-0000-0000-0000-00000000000b'::uuid], 1, 'movie', 'film', 'X', null, null, repeat('a', 141))
  ->> 'status' = 'message_too_long', 'message > 140 : refusé');
select pg_temp.check(public.send_recommendation('b17b0000-0000-0000-0000-00000000000a', array['b17b0000-0000-0000-0000-00000000000b'::uuid], 1, 'movie', 'film', 'X', null, '../../x')
  ->> 'status' = 'invalid', 'affiche invalide : refusée');
select pg_temp.check(public.send_recommendation('b17b0000-0000-0000-0000-00000000000a', array['b17b0000-0000-0000-0000-00000000000a'::uuid], 1, 'movie', 'film', 'X')
  ->> 'status' = 'no_recipient', 'à soi-même : refusé');
select public.send_recommendation('b17b0000-0000-0000-0000-00000000000a', array['b17b0000-0000-0000-0000-00000000000b'::uuid], 438631, 'movie', 'film', 'Dune', '2021', '/d.jpg', 'Encore !');
reset role;
select pg_temp.check((select count(*) = 1 and max(message) = 'Encore !' from public.recommendations), 'renvoi du même titre : une seule ligne, message mis à jour');
set role authenticated;

-- ---------- Recevoir (Bea) ----------
select pg_temp.as_user('b17b0000-2222-2222-2222-222222222222');
insert into t_rc values ('in', public.get_my_recommendations('b17b0000-0000-0000-0000-00000000000b'));
select pg_temp.check((select (v ->> 'unread')::int = 1 and jsonb_array_length(v -> 'items') = 1
  and v -> 'items' -> 0 -> 'from' ->> 'name' = 'Ana' and v -> 'items' -> 0 ->> 'poster_path' = '/d.jpg' from t_rc where k = 'in'), 'Bea voit la reco d''Ana (expéditeur, affiche)');
select pg_temp.check(public.respond_recommendation('b17b0000-0000-0000-0000-00000000000b', (select (v -> 'items' -> 0 ->> 'id')::uuid from t_rc where k = 'in'), 'thanks') ->> 'status' = 'ok', 'merci');
select pg_temp.check((public.get_my_recommendations('b17b0000-0000-0000-0000-00000000000b') ->> 'unread')::int = 0, 'après merci : plus « nouveau »');
select pg_temp.check(public.respond_recommendation('b17b0000-0000-0000-0000-00000000000b', (select (v -> 'items' -> 0 ->> 'id')::uuid from t_rc where k = 'in'), 'zzz') ->> 'status' = 'invalid', 'action inconnue : refusée');
select pg_temp.as_user('b17b0000-1111-1111-1111-111111111111');
select pg_temp.check(jsonb_array_length(public.get_my_recommendations('b17b0000-0000-0000-0000-00000000000a') -> 'thanks') = 1, 'Ana reçoit le merci de Bea');
select public.respond_recommendation('b17b0000-0000-0000-0000-00000000000a', (select (v -> 'items' -> 0 ->> 'id')::uuid from t_rc where k = 'in'), 'dismissed');
select pg_temp.as_user('b17b0000-2222-2222-2222-222222222222');
select pg_temp.check(jsonb_array_length(public.get_my_recommendations('b17b0000-0000-0000-0000-00000000000b') -> 'items') = 1, 'l''expéditeur ne peut pas modifier la reco du destinataire');
select public.respond_recommendation('b17b0000-0000-0000-0000-00000000000b', (select (v -> 'items' -> 0 ->> 'id')::uuid from t_rc where k = 'in'), 'added');
select pg_temp.check(jsonb_array_length(public.get_my_recommendations('b17b0000-0000-0000-0000-00000000000b') -> 'items') = 0, 'ajoutée à ma liste : sort de la boîte');

-- ---------- Refus des recommandations, blocage ----------
select public.set_reco_pref('b17b0000-0000-0000-0000-00000000000b', false);
select pg_temp.check((public.get_my_recommendations('b17b0000-0000-0000-0000-00000000000b') ->> 'accept_recos')::boolean = false, 'préférence lue par get_my_recommendations');
select pg_temp.as_user('b17b0000-1111-1111-1111-111111111111');
select pg_temp.check(public.send_recommendation('b17b0000-0000-0000-0000-00000000000a', array['b17b0000-0000-0000-0000-00000000000b'::uuid], 3, 'movie', 'film', 'Autre')
  ->> 'status' = 'sent', 'refus des recos : réponse neutre');
reset role;
select pg_temp.check((select count(*) = 0 from public.recommendations where tmdb_id = 3), 'refus des recos : rien enregistré');
update public.social_settings set accept_recos = true where profile_id = 'b17b0000-0000-0000-0000-00000000000b';
insert into public.blocks(blocker, blocked) values ('b17b0000-0000-0000-0000-00000000000b', 'b17b0000-0000-0000-0000-00000000000a');
set role authenticated;
select public.send_recommendation('b17b0000-0000-0000-0000-00000000000a', array['b17b0000-0000-0000-0000-00000000000b'::uuid], 5, 'movie', 'film', 'Bloqué');
select pg_temp.check((public.watch_together('b17b0000-0000-0000-0000-00000000000a', array['b17b0000-0000-0000-0000-00000000000b'::uuid]) -> 'hidden') ? 'b17b0000-0000-0000-0000-00000000000b', 'bloqué : écarté de « On regarde quoi ? »');
reset role;
select pg_temp.check((select count(*) = 0 from public.recommendations where tmdb_id = 5), 'bloqué : rien enregistré');
delete from public.blocks;
set role authenticated;

-- ---------- Quota : 30 / 24 h (1 déjà envoyée : Dune) ----------
select pg_temp.as_user('b17b0000-1111-1111-1111-111111111111');
select count(public.send_recommendation('b17b0000-0000-0000-0000-00000000000a', array['b17b0000-0000-0000-0000-00000000000b'::uuid], i, 'movie', 'film', 'T' || i))
  from generate_series(100, 128) i;
select pg_temp.check(public.send_recommendation('b17b0000-0000-0000-0000-00000000000a', array['b17b0000-0000-0000-0000-00000000000c'::uuid], 999, 'movie', 'film', 'Trop')
  ->> 'status' = 'rate_limited', 'au-delà de 30 / 24 h : refusé');
select pg_temp.check(public.send_recommendation('b17b0000-0000-0000-0000-00000000000a',
  array(select ('b17b0000-0000-0000-0000-0000000001' || i::text)::uuid from generate_series(10, 20) i), 1, 'movie', 'film', 'X')
  ->> 'status' = 'too_many', 'plus de 10 destinataires : refusé');

-- ---------- On regarde quoi ? ----------
insert into t_rc values ('w1', public.watch_together('b17b0000-0000-0000-0000-00000000000a', array['b17b0000-0000-0000-0000-00000000000b', 'b17b0000-0000-0000-0000-00000000000c']::uuid[]));
select pg_temp.check((select v ->> 'status' = 'ok' from t_rc where k = 'w1'), 'watch_together ok');
select pg_temp.check((select array(select x ->> 'title' from jsonb_array_elements(v -> 'items') x order by 1) = array['Dune', 'Frieren'] from t_rc where k = 'w1'),
  'seuls les titres en commun, vus par personne (Severance en cours chez Bea, « Vu par Ana » exclus)');
select pg_temp.check((select v -> 'hidden' = '["b17b0000-0000-0000-0000-00000000000c"]'::jsonb and (v ->> 'participants')::int = 2 from t_rc where k = 'w1'),
  'Cyr (liste privée) écarté');
select pg_temp.check((select bool_and((x ->> 'n')::int = 2) from t_rc, jsonb_array_elements(v -> 'items') x where k = 'w1'), 'Dune compté 2 fois, pas 3 (Cyr écarté)');
select pg_temp.check(not exists (select 1 from t_rc, jsonb_array_elements(v -> 'items') x where k = 'w1' and x ->> 'title' like 'Seulement%'), 'titres d''une seule liste : jamais révélés');
select pg_temp.check(jsonb_array_length(public.watch_together('b17b0000-0000-0000-0000-00000000000a', array['b17b0000-0000-0000-0000-00000000000b'::uuid], 'anime') -> 'items') = 1, 'filtre anime');
select pg_temp.check((public.watch_together('b17b0000-0000-0000-0000-00000000000a', array['b17b0000-0000-0000-0000-00000000000d'::uuid]) -> 'hidden') ? 'b17b0000-0000-0000-0000-00000000000d', 'non-ami : écarté');
select pg_temp.check(jsonb_array_length(public.watch_together('b17b0000-0000-0000-0000-00000000000a', array['b17b0000-0000-0000-0000-00000000000d'::uuid]) -> 'items') = 0, 'non-ami : aucun titre');
select pg_temp.check(public.watch_together('b17b0000-0000-0000-0000-00000000000a', array['b17b0000-0000-0000-0000-00000000000b'::uuid], 'docu') ->> 'status' = 'invalid', 'type inconnu : refusé');

-- ---------- RGPD ----------
select pg_temp.check((select jsonb_array_length(e -> 'sent') = 30 and e ? 'received' and (e ->> 'accept_recos')::boolean
  from (select public.export_my_recommendations('b17b0000-0000-0000-0000-00000000000a') e) z), 'export : envoyées et reçues');

-- ---------- Suppression de compte : cascade ----------
reset role;
delete from auth.users where id = 'b17b0000-1111-1111-1111-111111111111';
select pg_temp.check((select count(*) = 0 from public.recommendations), 'suppression du compte : recommandations supprimées (cascade)');
