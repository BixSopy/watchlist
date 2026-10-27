-- Tests de la migration 20261027200000_mfa_recovery_codes.sql (codes de secours MFA) sur Postgres local.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.check(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'ÉCHEC : %', p_msg; end if;
  raise notice 'ok - %', p_msg;
end $$;
grant execute on function pg_temp.check(boolean, text) to anon, authenticated;
set client_min_messages = notice;

-- 10 fausses empreintes hex (64 caractères), distinctes, pour simuler un lot de codes de secours.
create or replace function pg_temp.fake_batch(p_seed text) returns text[] language sql as $$
  select array_agg(lpad(p_seed || n::text, 64, '0')) from generate_series(1, 10) n
$$;
grant execute on function pg_temp.fake_batch(text) to anon, authenticated;

-- ---------- Surface ----------
select pg_temp.check((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.mfa_recovery_codes'::regclass), 'RLS activée et forcée');
select pg_temp.check(not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mfa_recovery_codes'), 'aucune policy : table fermée même pour son propriétaire');
select pg_temp.check(not has_table_privilege('anon', 'public.mfa_recovery_codes', 'select')
  and not has_table_privilege('authenticated', 'public.mfa_recovery_codes', 'select')
  and not has_table_privilege('authenticated', 'public.mfa_recovery_codes', 'insert')
  and not has_table_privilege('authenticated', 'public.mfa_recovery_codes', 'delete'), 'aucun accès direct à la table, même authentifié');
select pg_temp.check(not has_function_privilege('anon', 'public.mfa_recovery_store(text[])', 'execute')
  and not has_function_privilege('anon', 'public.mfa_recovery_consume_check(text)', 'execute')
  and not has_function_privilege('anon', 'public.mfa_recovery_count()', 'execute')
  and not has_function_privilege('anon', 'public.mfa_recovery_clear()', 'execute'), 'anon : aucun accès aux fonctions');
select pg_temp.check((select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc where pronamespace = 'public'::regnamespace
  and proname in ('mfa_recovery_store', 'mfa_recovery_consume_check', 'mfa_recovery_count', 'mfa_recovery_clear')), 'SECURITY DEFINER + search_path figé');

-- ---------- Données : deux comptes ----------
insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-aaaa-aaaa-aaaa-111111111111', 'u1@exemple.fr', now()),
  ('22222222-bbbb-bbbb-bbbb-222222222222', 'u2@exemple.fr', now());

-- ---------- Sans session ----------
set role authenticated;
select pg_temp.check(public.mfa_recovery_store(pg_temp.fake_batch('a')) ->> 'status' = 'not_authenticated', 'store sans session : refusé');
select pg_temp.check(public.mfa_recovery_consume_check(lpad('a1', 64, '0')) ->> 'status' = 'not_authenticated', 'consume sans session : refusé');
reset role;

-- ---------- Entrée invalide ----------
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-aaaa-aaaa-aaaa-111111111111"}', false);
select pg_temp.check(public.mfa_recovery_store(array['abc']) ->> 'status' = 'invalid_input', 'moins de 10 codes : refusé');
select pg_temp.check(public.mfa_recovery_store(array_cat(pg_temp.fake_batch('a'), array['zz'])) ->> 'status' = 'invalid_input', '11 codes : refusé');
select pg_temp.check(public.mfa_recovery_store(array_fill('pas-hexa'::text, array[10])) ->> 'status' = 'invalid_input', 'format non hexadécimal : refusé');
select pg_temp.check(public.mfa_recovery_consume_check('pas-hexa') ->> 'status' = 'invalid_input', 'consume : format invalide refusé');
reset role;

-- ---------- Régénération, consommation, isolation ----------
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-aaaa-aaaa-aaaa-111111111111"}', false);
select pg_temp.check(public.mfa_recovery_store(pg_temp.fake_batch('a')) ->> 'status' = 'ok', 'u1 : lot de 10 codes créé');
select pg_temp.check((public.mfa_recovery_count() ->> 'count')::int = 10, 'u1 : 10 codes valides');
select pg_temp.check(public.mfa_recovery_consume_check(lpad('a1', 64, '0')) ->> 'status' = 'ok', 'u1 : premier code consommé');
select pg_temp.check(public.mfa_recovery_consume_check(lpad('a1', 64, '0')) ->> 'status' = 'invalid_or_used', 'u1 : rejeu du même code refusé');
select pg_temp.check((public.mfa_recovery_count() ->> 'count')::int = 9, 'u1 : un seul code consommé, les 9 autres restent valides');
select pg_temp.check(public.mfa_recovery_consume_check(lpad('a2', 64, '0')) ->> 'status' = 'ok', 'u1 : un autre code du même lot reste utilisable après coup');
reset role;

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-bbbb-bbbb-bbbb-222222222222"}', false);
select pg_temp.check((public.mfa_recovery_count() ->> 'count')::int = 0, 'u2 : aucun code (RLS : ne voit pas le lot de u1)');
select pg_temp.check(public.mfa_recovery_consume_check(lpad('a3', 64, '0')) ->> 'status' = 'invalid_or_used', 'u2 : ne peut pas consommer un code appartenant à u1');
reset role;

-- ---------- Régénération : l'ancien lot disparaît ----------
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-aaaa-aaaa-aaaa-111111111111"}', false);
select pg_temp.check(public.mfa_recovery_store(pg_temp.fake_batch('b')) ->> 'status' = 'ok', 'u1 : régénération d''un nouveau lot');
select pg_temp.check((public.mfa_recovery_count() ->> 'count')::int = 10, 'u1 : nouveau lot complet');
select pg_temp.check(public.mfa_recovery_consume_check(lpad('a3', 64, '0')) ->> 'status' = 'invalid_or_used', 'u1 : un code de l''ancien lot (jamais consommé) ne marche plus après régénération');
select pg_temp.check(public.mfa_recovery_consume_check(lpad('b1', 64, '0')) ->> 'status' = 'ok', 'u1 : un code du nouveau lot fonctionne');
reset role;

-- ---------- Désactivation : mfa_recovery_clear() ----------
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-bbbb-bbbb-bbbb-222222222222"}', false);
select pg_temp.check(public.mfa_recovery_store(pg_temp.fake_batch('c')) ->> 'status' = 'ok', 'u2 : lot créé');
select pg_temp.check(public.mfa_recovery_clear() ->> 'status' = 'ok', 'u2 : vidage');
select pg_temp.check((public.mfa_recovery_count() ->> 'count')::int = 0, 'u2 : plus aucun code après vidage');
reset role;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-aaaa-aaaa-aaaa-111111111111"}', false);
select pg_temp.check((public.mfa_recovery_count() ->> 'count')::int > 0, 'u1 : vidage de u2 ne touche pas le lot de u1');
reset role;

-- ---------- Suppression du compte : cascade ----------
delete from auth.users where id = '11111111-aaaa-aaaa-aaaa-111111111111';
select pg_temp.check(not exists (select 1 from public.mfa_recovery_codes where user_id = '11111111-aaaa-aaaa-aaaa-111111111111'), 'suppression du compte : codes supprimés (cascade)');
