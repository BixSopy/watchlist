-- Tests de la migration 20261008100000_ouverture_publique.sql sur Postgres local.
-- Chaque assertion lève une exception en cas d'échec (psql -v ON_ERROR_STOP=1).
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create or replace function pg_temp.as_user(p_uid uuid, p_amr_age_s integer default 60) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_uid, 'role', 'authenticated',
    'amr', json_build_array(json_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint - p_amr_age_s))
  )::text, false);
end $$;
create or replace function pg_temp.check(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'ÉCHEC : %', p_msg; end if;
  raise notice 'ok - %', p_msg;
end $$;
set client_min_messages = notice;

-- Données : deux comptes avec profil et titres
insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'a@exemple.fr', now()),
  ('22222222-2222-2222-2222-222222222222', 'b@exemple.fr', now());
insert into auth.identities (user_id) values ('11111111-1111-1111-1111-111111111111');
insert into auth.sessions (user_id) values ('11111111-1111-1111-1111-111111111111');
insert into public.profiles (id, account_id, name, plex_webhook_token) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'A', repeat('ab', 24)),
  ('bbbbbbbb-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'B', null);
insert into public.watchlist_items (local_id, profile_id, type, title) values
  ('l1', 'aaaaaaaa-0000-0000-0000-000000000001', 'film', 'Matrix'),
  ('l2', 'aaaaaaaa-0000-0000-0000-000000000001', 'serie', 'Dark'),
  ('l1', 'bbbbbbbb-0000-0000-0000-000000000002', 'film', 'Alien');

-- ---------- Droits ----------
select pg_temp.check(not has_function_privilege('anon', 'public.consume_api_quota(text,integer)', 'execute'), 'anon ne peut pas appeler consume_api_quota');
select pg_temp.check(has_function_privilege('authenticated', 'public.consume_api_quota(text,integer)', 'execute'), 'authenticated peut appeler consume_api_quota');
select pg_temp.check(not has_function_privilege('anon', 'public.delete_my_account()', 'execute'), 'anon ne peut pas appeler delete_my_account');
select pg_temp.check(not has_function_privilege('authenticated', 'public.watchlist_items_limite()', 'execute'), 'fonction de trigger non appelable');
select pg_temp.check(not has_function_privilege('authenticated', 'public.api_housekeeping()', 'execute'), 'ménage non appelable par les utilisateurs');
select pg_temp.check(not has_table_privilege('authenticated', 'public.api_cache', 'select'), 'api_cache illisible pour authenticated');
select pg_temp.check(not has_table_privilege('anon', 'public.api_cache', 'insert'), 'api_cache non modifiable par anon');
select pg_temp.check(has_table_privilege('service_role', 'public.api_cache', 'insert'), 'service_role écrit dans api_cache');
select pg_temp.check(not has_table_privilege('authenticated', 'public.api_usage', 'update'), 'api_usage non modifiable directement');
select pg_temp.check(not has_column_privilege('authenticated', 'public.profiles', 'is_manager', 'update'), 'is_manager non modifiable');
select pg_temp.check(not has_column_privilege('authenticated', 'public.profiles', 'account_id', 'update'), 'account_id non modifiable');
select pg_temp.check(has_column_privilege('authenticated', 'public.profiles', 'plex_webhook_token', 'update'), 'plex_webhook_token modifiable');
select pg_temp.check(has_column_privilege('authenticated', 'public.profiles', 'account_id', 'insert'), 'insertion du profil (account_id) possible');
select pg_temp.check(has_function_privilege('anon', 'public.mark_watched_by_token(text,integer,integer,integer)', 'execute'), 'webhook Plex toujours appelable (anon)');

-- ---------- Quotas ----------
set role authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select pg_temp.check((public.consume_api_quota('tmdb') ->> 'allowed')::boolean, 'quota tmdb : 1er appel autorisé');
select pg_temp.check((public.consume_api_quota('tmdb', 5) ->> 'used')::int = 6, 'quota tmdb : compteur cumulé');
reset role;
update public.api_quota_limits set per_user_daily = 3, global_daily = 4 where bucket = 'omdb';
set role authenticated;
select pg_temp.check((public.consume_api_quota('omdb') ->> 'allowed')::boolean, 'omdb 1/3');
select pg_temp.check((public.consume_api_quota('omdb') ->> 'allowed')::boolean, 'omdb 2/3');
select pg_temp.check((public.consume_api_quota('omdb') ->> 'allowed')::boolean, 'omdb 3/3');
select pg_temp.check(not (public.consume_api_quota('omdb') ->> 'allowed')::boolean, 'omdb 4e appel refusé (scope user)');
select pg_temp.check(public.consume_api_quota('omdb') ->> 'scope' = 'user', 'refus attribué au quota utilisateur');
reset role;
select pg_temp.check((select count from public.api_usage where bucket = 'omdb') = 3, 'compteur utilisateur bloqué à la limite');
select pg_temp.check((select count from public.api_usage_global where bucket = 'omdb') = 3, 'compteur global non gonflé par les refus');
set role authenticated;
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select pg_temp.check((public.consume_api_quota('omdb') ->> 'allowed')::boolean, 'compte B : 1er appel omdb (global 4/4)');
select pg_temp.check(public.consume_api_quota('omdb') ->> 'scope' = 'global', 'compte B : quota global OMDb atteint');
do $$ begin
  perform public.consume_api_quota('inconnu');
  raise exception 'ÉCHEC : bucket inconnu accepté';
exception when invalid_parameter_value then raise notice 'ok - bucket inconnu refusé';
end $$;
do $$ begin
  perform public.consume_api_quota('tmdb', 1000);
  raise exception 'ÉCHEC : coût démesuré accepté';
exception when invalid_parameter_value then raise notice 'ok - coût hors bornes refusé';
end $$;
select set_config('request.jwt.claims', '', false);
do $$ begin
  perform public.consume_api_quota('tmdb');
  raise exception 'ÉCHEC : appel sans utilisateur accepté';
exception when invalid_authorization_specification then raise notice 'ok - quota sans session refusé';
end $$;
do $$ begin
  perform * from public.api_usage;
  raise exception 'ÉCHEC : api_usage lisible';
exception when insufficient_privilege then raise notice 'ok - api_usage illisible en direct';
end $$;

-- ---------- Ménage ----------
reset role;
insert into public.api_usage (account_id, day, bucket, count) values ('22222222-2222-2222-2222-222222222222', current_date - 10, 'tmdb', 5);
insert into public.api_cache (key, body, expires_at) values ('omdb:tt1', '{}', now() - interval '1 hour'), ('omdb:tt2', '{}', now() + interval '1 day');
select public.api_housekeeping();
select pg_temp.check(not exists (select 1 from public.api_usage where day < current_date - 3), 'ménage : vieux compteurs effacés');
select pg_temp.check((select array_agg(key) from public.api_cache) = array['omdb:tt2'], 'ménage : cache expiré effacé, cache valide conservé');
set role authenticated;

-- ---------- Création du profil comme le fait l'app ----------
reset role;
insert into auth.users (id, email, email_confirmed_at) values ('33333333-3333-3333-3333-333333333333', 'c@exemple.fr', now());
set role authenticated;
select pg_temp.as_user('33333333-3333-3333-3333-333333333333');
insert into public.profiles (account_id, name) values ('33333333-3333-3333-3333-333333333333', 'Moi');
select pg_temp.check((select count(*) from public.profiles) = 1, 'nouveau compte : profil créé, RLS ne montre que le sien');
do $$ begin
  insert into public.profiles (account_id, name) values ('22222222-2222-2222-2222-222222222222', 'Pirate');
  raise exception 'ÉCHEC : profil créé pour un autre compte';
exception when insufficient_privilege then raise notice 'ok - impossible de créer un profil pour un autre compte (RLS)';
end $$;

-- ---------- Garde-fous de taille ----------
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
do $$ begin
  insert into public.watchlist_items (local_id, profile_id, type, title)
  values ('big', 'bbbbbbbb-0000-0000-0000-000000000002', 'film', repeat('x', 501));
  raise exception 'ÉCHEC : titre de 501 caractères accepté';
exception when check_violation then raise notice 'ok - titre trop long refusé';
end $$;
do $$ begin
  update public.profiles set plex_webhook_token = '1234' where account_id = auth.uid();
  raise exception 'ÉCHEC : jeton faible accepté';
exception when check_violation then raise notice 'ok - jeton de suivi faible refusé';
end $$;
do $$ begin
  update public.profiles set is_manager = true where account_id = auth.uid();
  raise exception 'ÉCHEC : is_manager modifiable';
exception when insufficient_privilege then raise notice 'ok - is_manager protégé';
end $$;
update public.profiles set plex_webhook_token = repeat('cd', 24) where account_id = auth.uid();
select pg_temp.check((select plex_webhook_token from public.profiles where account_id = auth.uid()) = repeat('cd', 24), 'jeton valide accepté');
insert into public.watchlist_items (local_id, profile_id, type, title, tags)
values ('ok2', 'bbbbbbbb-0000-0000-0000-000000000002', 'serie', 'Severance', array['a','b']);
select pg_temp.check(true, 'insertion normale acceptée (RLS + trigger de limite)');
-- RLS : B ne voit pas les titres de A
select pg_temp.check((select count(*) from public.watchlist_items) = 2, 'RLS : B ne voit que ses 2 titres');

-- ---------- Suppression de compte ----------
select pg_temp.as_user('11111111-1111-1111-1111-111111111111', 3600);
do $$ begin
  perform public.delete_my_account();
  raise exception 'ÉCHEC : suppression acceptée avec une connexion vieille d''1 h';
exception when insufficient_privilege then raise notice 'ok - suppression refusée sans authentification récente';
end $$;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false);
do $$ begin
  perform public.delete_my_account();
  raise exception 'ÉCHEC : suppression acceptée sans amr';
exception when insufficient_privilege then raise notice 'ok - suppression refusée sans revendication amr';
end $$;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111', 30);
select public.delete_my_account();
reset role;
select pg_temp.check(not exists (select 1 from auth.users where id = '11111111-1111-1111-1111-111111111111'), 'utilisateur Auth supprimé');
select pg_temp.check(not exists (select 1 from auth.identities where user_id = '11111111-1111-1111-1111-111111111111'), 'identités supprimées (cascade)');
select pg_temp.check(not exists (select 1 from auth.sessions where user_id = '11111111-1111-1111-1111-111111111111'), 'sessions supprimées (cascade)');
select pg_temp.check(not exists (select 1 from public.profiles where account_id = '11111111-1111-1111-1111-111111111111'), 'profil supprimé');
select pg_temp.check(not exists (select 1 from public.watchlist_items where profile_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'titres supprimés');
select pg_temp.check(not exists (select 1 from public.api_usage where account_id = '11111111-1111-1111-1111-111111111111'), 'compteurs supprimés');
select pg_temp.check((select count(*) from public.watchlist_items) = 2, 'les titres du compte B sont intacts');
select pg_temp.check(exists (select 1 from auth.users where id = '22222222-2222-2222-2222-222222222222'), 'le compte B est intact');

-- ---------- Webhook Plex inchangé ----------
set role anon;
select pg_temp.check(public.mark_watched_by_title(repeat('cd', 24), 'Severance', 1, 3) ->> 'status' = 'updated', 'mark_watched_by_title fonctionne toujours (anon + jeton)');
reset role;
select pg_temp.check((select episode from public.watchlist_items where local_id = 'ok2') = 3, 'progression mise à jour par le webhook');

-- ---------- keep_alive : une ligne par heure au plus ----------
set role anon;
insert into public.keep_alive (pinged_at) values (now());
do $$
declare v_blocked boolean := false;
begin
  begin
    insert into public.keep_alive (pinged_at) values (now()), (now()), (now());
  exception when unique_violation then v_blocked := true;
  end;
  perform pg_temp.check(v_blocked, 'keep_alive : une 2e ligne dans la même heure est refusée (pas de remplissage de la base)');
end $$;
reset role;
select pg_temp.check((select count(*) from public.keep_alive) = 1, 'keep_alive : une seule ligne enregistrée');

do $$ begin raise notice 'Tests 10_ouverture_publique passés.'; end $$;
