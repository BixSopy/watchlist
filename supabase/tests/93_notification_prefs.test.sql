-- Tests de la migration 20261107100000_notification_prefs.sql sur Postgres local.
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
select pg_temp.check((select relrowsecurity from pg_class where oid = 'public.notification_prefs'::regclass), 'RLS activée');
select pg_temp.check(not has_table_privilege('anon', 'public.notification_prefs', 'select')
  and not has_table_privilege('authenticated', 'public.notification_prefs', 'insert')
  and not has_table_privilege('authenticated', 'public.notification_prefs', 'update'), 'anon : aucun accès ; authenticated : lecture seule, aucune écriture directe');
select pg_temp.check(not has_function_privilege('anon', 'public.set_notification_prefs(uuid,boolean,boolean)', 'execute')
  and not has_function_privilege('anon', 'public.get_my_notification_prefs(uuid)', 'execute'), 'anon : aucun accès aux fonctions');
select pg_temp.check((select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc where pronamespace = 'public'::regnamespace
  and proname in ('set_notification_prefs', 'get_my_notification_prefs')), 'SECURITY DEFINER + search_path figé');

-- ---------- Données : Léa (A), Tom (B) ----------
insert into auth.users (id, email, email_confirmed_at) values
  ('12121212-1111-1111-1111-111111111111', 'lea@exemple.fr', now()),
  ('34343434-2222-2222-2222-222222222222', 'tom@exemple.fr', now());
insert into public.profiles (id, account_id, name) values
  ('12121212-0000-0000-0000-00000000000a', '12121212-1111-1111-1111-111111111111', 'Léa'),
  ('34343434-0000-0000-0000-00000000000b', '34343434-2222-2222-2222-222222222222', 'Tom');

set role authenticated;
select pg_temp.check(public.set_notification_prefs('12121212-0000-0000-0000-00000000000a', true, true) ->> 'status' = 'not_authenticated', 'sans session : refusé');
select pg_temp.check(public.get_my_notification_prefs('12121212-0000-0000-0000-00000000000a') ->> 'status' = 'not_authenticated', 'lecture sans session : refusée');

select pg_temp.as_user('12121212-1111-1111-1111-111111111111');
select pg_temp.check(public.set_notification_prefs('34343434-0000-0000-0000-00000000000b', true, true) ->> 'status' = 'not_authenticated', 'profil d''un autre compte : refusé');

select pg_temp.check((public.get_my_notification_prefs('12121212-0000-0000-0000-00000000000a') -> 'prefs' ->> 'releases') = 'false'
  and (public.get_my_notification_prefs('12121212-0000-0000-0000-00000000000a') -> 'prefs' ->> 'newsletter') = 'false', 'par défaut (ligne absente) : les deux à false');

select pg_temp.check((public.set_notification_prefs('12121212-0000-0000-0000-00000000000a', true, null) -> 'prefs' ->> 'releases') = 'true', 'releases activé');
select pg_temp.check((select count(*) = 1 from public.notification_prefs), 'une seule ligne créée');
select pg_temp.check((public.get_my_notification_prefs('12121212-0000-0000-0000-00000000000a') -> 'prefs' ->> 'newsletter') = 'false', 'newsletter inchangé (p_newsletter null)');

select pg_temp.check((public.set_notification_prefs('12121212-0000-0000-0000-00000000000a', null, true) -> 'prefs' ->> 'newsletter') = 'true', 'newsletter activé, sans toucher releases');
select pg_temp.check((public.get_my_notification_prefs('12121212-0000-0000-0000-00000000000a') -> 'prefs' ->> 'releases') = 'true', 'releases toujours activé');

select pg_temp.check((public.set_notification_prefs('12121212-0000-0000-0000-00000000000a', false, false) -> 'prefs' ->> 'releases') = 'false', 'les deux désactivables');

-- ---------- Suppression de compte : cascade ----------
reset role;
delete from public.profiles where id = '12121212-0000-0000-0000-00000000000a';
select pg_temp.check((select count(*) = 0 from public.notification_prefs), 'suppression du profil : préférences supprimées en cascade');
