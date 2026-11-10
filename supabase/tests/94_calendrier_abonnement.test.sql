-- Tests de la migration 20261110120000_calendrier_abonnement.sql sur Postgres local.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.check(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'ÉCHEC : %', p_msg; end if;
  raise notice 'ok - %', p_msg;
end $$;
grant execute on function pg_temp.check(boolean, text) to anon, authenticated;
create or replace function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p)::text, false)
$$;
grant execute on function pg_temp.as_user(uuid) to anon, authenticated;
set client_min_messages = notice;

-- ---------- Surface ----------
select pg_temp.check((select relrowsecurity from pg_class where oid = 'public.calendar_feeds'::regclass), 'RLS activée');
select pg_temp.check(not has_table_privilege('anon', 'public.calendar_feeds', 'select')
  and not has_table_privilege('authenticated', 'public.calendar_feeds', 'select')
  and not has_table_privilege('authenticated', 'public.calendar_feeds', 'insert'), 'aucun accès direct à la table (jetons jamais listables)');
select pg_temp.check(not has_function_privilege('anon', 'public.calendar_feed_rotate(uuid,text)', 'execute')
  and not has_function_privilege('anon', 'public.calendar_feed_get(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.calendar_feed_revoke(uuid)', 'execute'), 'anon : pas de gestion de lien');
select pg_temp.check(has_function_privilege('anon', 'public.get_calendar_feed(text)', 'execute'), 'anon : lecture du flux par jeton');
select pg_temp.check((select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc where pronamespace = 'public'::regnamespace
  and proname in ('calendar_feed_get', 'calendar_feed_rotate', 'calendar_feed_revoke', 'get_calendar_feed')), 'SECURITY DEFINER + search_path figé');

-- ---------- Données : Léa (A), Tom (B) ----------
insert into auth.users (id, email, email_confirmed_at) values
  ('56565656-1111-1111-1111-111111111111', 'lea.cal@exemple.fr', now()),
  ('78787878-2222-2222-2222-222222222222', 'tom.cal@exemple.fr', now());
insert into public.profiles (id, account_id, name) values
  ('56565656-0000-0000-0000-00000000000a', '56565656-1111-1111-1111-111111111111', 'Léa'),
  ('78787878-0000-0000-0000-00000000000b', '78787878-2222-2222-2222-222222222222', 'Tom');
insert into public.watchlist_items (local_id, profile_id, type, status, title, overview, tags, next_air, deleted) values
  ('s1', '56565656-0000-0000-0000-00000000000a', 'serie', 'encours', 'Severance', 'note privée', '{secret}', to_char(current_date + 3, 'YYYY-MM-DD'), false),
  ('s2', '56565656-0000-0000-0000-00000000000a', 'anime', 'encours', 'Frieren', null, '{}', to_char(current_date - 2, 'YYYY-MM-DD'), false),
  ('s3', '56565656-0000-0000-0000-00000000000a', 'serie', 'encours', 'Vieille date', null, '{}', to_char(current_date - 30, 'YYYY-MM-DD'), false),
  ('s4', '56565656-0000-0000-0000-00000000000a', 'serie', 'encours', 'Supprimée', null, '{}', to_char(current_date + 1, 'YYYY-MM-DD'), true),
  ('s5', '56565656-0000-0000-0000-00000000000a', 'serie', 'termine', 'Finie', null, '{}', to_char(current_date + 1, 'YYYY-MM-DD'), false),
  ('s6', '56565656-0000-0000-0000-00000000000a', 'serie', 'encours', 'Date bizarre', null, '{}', 'bientôt', false),
  ('f1', '56565656-0000-0000-0000-00000000000a', 'film', 'avoir', 'Un film', null, '{}', to_char(current_date + 5, 'YYYY-MM-DD'), false),
  ('t1', '78787878-0000-0000-0000-00000000000b', 'serie', 'encours', 'Série de Tom', null, '{}', to_char(current_date + 1, 'YYYY-MM-DD'), false);

set role authenticated;
select pg_temp.check(public.calendar_feed_rotate('56565656-0000-0000-0000-00000000000a') ->> 'status' = 'not_authenticated', 'sans session : refusé');
select pg_temp.as_user('56565656-1111-1111-1111-111111111111');
select pg_temp.check(public.calendar_feed_rotate('78787878-0000-0000-0000-00000000000b') ->> 'status' = 'not_authenticated', 'profil d''un autre compte : refusé');
select pg_temp.check(public.calendar_feed_get('56565656-0000-0000-0000-00000000000a') -> 'feed' = 'null'::jsonb, 'aucun lien par défaut (opt-in)');

create temp table t_tok(n int, token text);
grant all on t_tok to authenticated, anon;
insert into t_tok select 1, public.calendar_feed_rotate('56565656-0000-0000-0000-00000000000a', 'en') -> 'feed' ->> 'token';
select pg_temp.check((select token ~ '^[A-Za-z0-9_-]{22}$' from t_tok where n = 1), 'jeton de 22 caractères base64url');
select pg_temp.check((public.calendar_feed_get('56565656-0000-0000-0000-00000000000a') -> 'feed' ->> 'token') = (select token from t_tok where n = 1), 'le lien se relit (copie depuis l''app)');
select pg_temp.check(public.calendar_feed_rotate('56565656-0000-0000-0000-00000000000a') ->> 'status' = 'rate_limited', 'nouveau lien coup sur coup : limité');

-- ---------- Lecture publique ----------
set role anon;
select pg_temp.as_user(null);
create temp table t_feed as select public.get_calendar_feed((select token from t_tok where n = 1)) as f;
select pg_temp.check((select f ->> 'lang' from t_feed) = 'en', 'langue du flux gardée');
select pg_temp.check((select array_agg(x ->> 'title' order by x ->> 'date') from t_feed, jsonb_array_elements(f -> 'items') x) = array['Frieren', 'Severance'],
  'séries/anime avec date valide, ≥ J-7, non supprimées, pas terminées, pas de film, pas les titres d''un autre profil');
select pg_temp.check((select bool_and(not (x ? 'overview') and not (x ? 'tags') and not (x ? 'profile_id') and x ->> 'uid' in ('s1', 's2')) from t_feed, jsonb_array_elements(f -> 'items') x),
  'champs publics seulement (uid, title, type, date)');
select pg_temp.check(public.get_calendar_feed('AAAAAAAAAAAAAAAAAAAAAA') is null and public.get_calendar_feed('court') is null and public.get_calendar_feed(null) is null, 'jeton inconnu ou mal formé : null');
reset role;
select pg_temp.check((select last_fetched_at is not null from public.calendar_feeds where profile_id = '56565656-0000-0000-0000-00000000000a'), 'dernière lecture notée');

-- ---------- Nouveau lien : l'ancien ne marche plus ; désactivation ----------
update public.calendar_feeds set created_at = now() - interval '1 minute';
set role authenticated;
select pg_temp.as_user('56565656-1111-1111-1111-111111111111');
insert into t_tok select 2, public.calendar_feed_rotate('56565656-0000-0000-0000-00000000000a', 'xx-YY') -> 'feed' ->> 'token';
select pg_temp.check((select token from t_tok where n = 2) <> (select token from t_tok where n = 1), 'nouveau jeton');
set role anon;
select pg_temp.check(public.get_calendar_feed((select token from t_tok where n = 1)) is null, 'ancien jeton : plus rien');
select pg_temp.check(public.get_calendar_feed((select token from t_tok where n = 2)) ->> 'lang' = 'fr', 'langue invalide : fr par défaut');
set role authenticated;
select pg_temp.check(public.calendar_feed_revoke('56565656-0000-0000-0000-00000000000a') ->> 'status' = 'ok', 'désactivation');
set role anon;
select pg_temp.check(public.get_calendar_feed((select token from t_tok where n = 2)) is null, 'lien désactivé : plus rien');

-- ---------- Suppression de compte : cascade ----------
reset role;
select pg_temp.as_user('56565656-1111-1111-1111-111111111111');
set role authenticated;
select public.calendar_feed_rotate('56565656-0000-0000-0000-00000000000a');
reset role;
delete from public.profiles where id = '56565656-0000-0000-0000-00000000000a';
select pg_temp.check((select count(*) = 0 from public.calendar_feeds), 'suppression du profil : lien supprimé en cascade');
