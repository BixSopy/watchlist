-- Tests de la migration 20261105153331_signup_ref.sql sur Postgres local.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.check(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'ÉCHEC : %', p_msg; end if;
  raise notice 'ok - %', p_msg;
end $$;

select pg_temp.check(exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'profiles' and column_name = 'signup_ref'
), 'colonne profiles.signup_ref présente');

select pg_temp.check(exists (
  select 1 from pg_constraint
  where conrelid = 'public.profiles'::regclass and conname = 'profiles_signup_ref_format'
), 'contrainte de format signup_ref');

select pg_temp.check(
  not has_column_privilege('authenticated', 'public.profiles', 'signup_ref', 'insert')
  and not has_column_privilege('authenticated', 'public.profiles', 'signup_ref', 'update'),
  'authenticated ne peut ni insérer ni modifier signup_ref'
);

select pg_temp.check((
  select prosecdef and proconfig @> array['search_path=""']
  from pg_proc where pronamespace = 'public'::regnamespace and proname = 'profiles_set_signup_ref'
), 'trigger d''insertion SECURITY DEFINER + search_path figé');

-- Compte avec un code valide dans les métadonnées Auth
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('dddddddd-4444-4444-4444-444444444444', 'ref@exemple.fr', now(), '{"lang":"fr","ref":"x12"}'::jsonb),
  ('eeeeeeee-5555-5555-5555-555555555555', 'bad@exemple.fr', now(), '{"ref":"BAD CODE!!"}'::jsonb),
  ('ffffffff-6666-6666-6666-666666666666', 'none@exemple.fr', now(), '{"lang":"en"}'::jsonb);

insert into public.profiles (id, account_id, name) values
  ('dddddddd-0000-0000-0000-00000000000d', 'dddddddd-4444-4444-4444-444444444444', 'Ref'),
  ('eeeeeeee-0000-0000-0000-00000000000e', 'eeeeeeee-5555-5555-5555-555555555555', 'Bad'),
  ('ffffffff-0000-0000-0000-00000000000f', 'ffffffff-6666-6666-6666-666666666666', 'None');

select pg_temp.check((select signup_ref = 'x12' from public.profiles where id = 'dddddddd-0000-0000-0000-00000000000d'),
  'ref valide copié depuis raw_user_meta_data');
select pg_temp.check((select signup_ref is null from public.profiles where id = 'eeeeeeee-0000-0000-0000-00000000000e'),
  'ref invalide ignoré');
select pg_temp.check((select signup_ref is null from public.profiles where id = 'ffffffff-0000-0000-0000-00000000000f'),
  'sans ref : null');

-- Gel : on ne peut pas écraser un signup_ref déjà posé
update public.profiles set signup_ref = 'hack' where id = 'dddddddd-0000-0000-0000-00000000000d';
select pg_temp.check((select signup_ref = 'x12' from public.profiles where id = 'dddddddd-0000-0000-0000-00000000000d'),
  'signup_ref gelé après pose');

-- Format refusé au niveau contrainte
insert into auth.users (id, email, email_confirmed_at) values
  ('99999999-9999-9999-9999-999999999999', 'fmt@exemple.fr', now());
do $$
begin
  begin
    insert into public.profiles (id, account_id, name, signup_ref) values
      ('99999999-0000-0000-0000-000000000099', '99999999-9999-9999-9999-999999999999', 'Fmt', 'NO');
    raise exception 'ÉCHEC : contrainte format aurait dû refuser';
  exception when check_violation then
    raise notice 'ok - contrainte refuse un format invalide';
  end;
end $$;
