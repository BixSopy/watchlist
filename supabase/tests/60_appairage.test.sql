-- Tests de la migration 20261013120000_appairage_appareils.sql (jeton par appareil) sur Postgres local.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.check(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'ÉCHEC : %', p_msg; end if;
  raise notice 'ok - %', p_msg;
end $$;
grant execute on function pg_temp.check(boolean, text) to anon, authenticated;
create temp table t_tok(k text primary key, v text);
grant all on t_tok to anon, authenticated;
set client_min_messages = notice;

-- ---------- Surface ----------
select pg_temp.check((select relrowsecurity from pg_class where oid = 'public.extension_devices'::regclass), 'RLS activée');
select pg_temp.check(not has_table_privilege('anon', 'public.extension_devices', 'select'), 'anon : aucun accès à la table');
select pg_temp.check(not has_column_privilege('authenticated', 'public.extension_devices', 'token_hash', 'select'), 'authenticated : token_hash illisible');
select pg_temp.check(has_column_privilege('authenticated', 'public.extension_devices', 'label', 'select')
  and not has_table_privilege('authenticated', 'public.extension_devices', 'insert')
  and not has_table_privilege('authenticated', 'public.extension_devices', 'update')
  and not has_table_privilege('authenticated', 'public.extension_devices', 'delete'), 'authenticated : lecture seule');
select pg_temp.check(not has_function_privilege('anon', 'public.pair_extension_device(uuid,text,text,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.revoke_extension_device(uuid)', 'execute'), 'anon : ni création ni révocation');
select pg_temp.check(not has_function_privilege('authenticated', 'public.extension_profile_for_token(text)', 'execute'), 'couche jeton toujours privée');
select pg_temp.check((select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc where pronamespace = 'public'::regnamespace
  and proname in ('pair_extension_device','revoke_extension_device','extension_unpair','extension_whoami','extension_profile_for_token')), 'SECURITY DEFINER + search_path figé');

-- ---------- Données ----------
insert into auth.users (id, email, email_confirmed_at) values
  ('dddddddd-9999-9999-9999-999999999999', 'g@exemple.fr', now()),
  ('eeeeeeee-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'h@exemple.fr', now());
insert into public.profiles (id, account_id, name, plex_webhook_token) values
  ('dddddddd-0000-0000-0000-000000000009', 'dddddddd-9999-9999-9999-999999999999', 'G', repeat('d9', 24)),
  ('eeeeeeee-0000-0000-0000-00000000000a', 'eeeeeeee-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'H', null);

-- ---------- Création ----------
set role anon;
select pg_temp.check(public.extension_whoami(repeat('d9', 24)) ->> 'profile' = 'G', 'ancien jeton de suivi toujours accepté (transition)');
reset role;
set role authenticated;
select pg_temp.check(public.pair_extension_device('dddddddd-0000-0000-0000-000000000009') ->> 'status' = 'not_authenticated', 'sans session : refusé');
select set_config('request.jwt.claims', '{"sub":"dddddddd-9999-9999-9999-999999999999"}', false);
select pg_temp.check(public.pair_extension_device('eeeeeeee-0000-0000-0000-00000000000a') ->> 'status' = 'invalid_profile', 'profil d''un autre compte : refusé');
insert into t_tok select 'g', public.pair_extension_device('dddddddd-0000-0000-0000-000000000009', '  Chrome · Windows  ', 'Chrome', 'Windows', '0.8.0') ->> 'token';
select pg_temp.check((select v ~ '^cpd_[0-9a-f]{64}$' from t_tok where k = 'g'), 'jeton cpd_ + 64 hexa renvoyé');
select pg_temp.check((select label = 'Chrome · Windows' and ext_version = '0.8.0' and last_seen_at is null from public.extension_devices), 'appareil visible par son propriétaire, libellé nettoyé');
select pg_temp.check(public.pair_extension_device('dddddddd-0000-0000-0000-000000000009', null, null, null, '1; drop') ->> 'status' = 'ok', 'second appareil créé');
select pg_temp.check((select count(*) = 1 from public.extension_devices where ext_version is null and label = 'Navigateur'), 'version invalide ignorée, libellé par défaut');
reset role;
select pg_temp.check(not exists (select 1 from public.extension_devices d join t_tok t on true where position(t.v in encode(d.token_hash, 'escape')) > 0)
  and (select token_hash = extensions.digest(v, 'sha256') from public.extension_devices d, t_tok where label = 'Chrome · Windows'), 'seule l''empreinte SHA-256 est stockée');

-- ---------- Utilisation par l'extension ----------
set role anon;
select pg_temp.check((select public.extension_whoami(v) from t_tok where k = 'g') = '{"status":"ok","profile":"G"}'::jsonb, 'whoami : jeton d''appareil reconnu');
select pg_temp.check((select public.extension_push_detections(v, '[{"source":"live","title":"Arcane","type":"show","season":1,"episode":1}]') ->> 'status' from t_tok where k = 'g') <> 'invalid_token', 'push_detections accepte le jeton d''appareil');
select pg_temp.check((select public.mark_watched_by_title(v, 'Inconnu', 1, 1) ->> 'status' from t_tok where k = 'g') = 'not_found', 'mark_watched_by_title accepte le jeton d''appareil');
select pg_temp.check(public.extension_whoami('cpd_' || repeat('0', 64)) ->> 'status' = 'invalid_token', 'jeton inconnu refusé');
select pg_temp.check(public.extension_whoami('x'' or 1=1 --') ->> 'status' = 'invalid_token', 'jeton mal formé refusé');
reset role;
select pg_temp.check((select last_seen_at = date_trunc('hour', now()) from public.extension_devices where label = 'Chrome · Windows'), 'last_seen_at arrondi à l''heure');

-- ---------- Révocation ----------
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"eeeeeeee-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}', false);
select pg_temp.check(not exists (select 1 from public.extension_devices), 'RLS : un autre compte ne voit rien');
reset role;
insert into t_tok select 'id', id::text from public.extension_devices where label = 'Chrome · Windows';
set role authenticated;
select pg_temp.check((select public.revoke_extension_device(v::uuid) ->> 'status' from t_tok where k = 'id') = 'not_found', 'un autre compte ne peut pas révoquer');
select set_config('request.jwt.claims', '{"sub":"dddddddd-9999-9999-9999-999999999999"}', false);
select pg_temp.check((select public.revoke_extension_device(v::uuid) ->> 'status' from t_tok where k = 'id') = 'revoked', 'propriétaire : révocation');
reset role;
set role anon;
select pg_temp.check((select public.extension_whoami(v) ->> 'status' from t_tok where k = 'g') = 'invalid_token', 'jeton révoqué refusé immédiatement');
select pg_temp.check((select public.extension_push_detections(v, '[]') ->> 'status' from t_tok where k = 'g') = 'invalid_token', 'push_detections refuse le jeton révoqué');
reset role;

-- ---------- Déconnexion depuis l'extension + limites ----------
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"dddddddd-9999-9999-9999-999999999999"}', false);
insert into t_tok select 'g2', public.pair_extension_device('dddddddd-0000-0000-0000-000000000009') ->> 'token';
reset role;
set role anon;
select pg_temp.check((select public.extension_unpair(v) ->> 'status' from t_tok where k = 'g2') = 'revoked', 'extension_unpair révoque son propre jeton');
select pg_temp.check((select public.extension_unpair(v) ->> 'status' from t_tok where k = 'g2') = 'invalid_token', 'extension_unpair : deuxième appel refusé');
reset role;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"dddddddd-9999-9999-9999-999999999999"}', false);
select public.pair_extension_device('dddddddd-0000-0000-0000-000000000009') from generate_series(1, 9);
select pg_temp.check(public.pair_extension_device('dddddddd-0000-0000-0000-000000000009') ->> 'status' = 'too_many_devices', '10 appareils actifs maximum');
reset role;
update public.extension_devices set revoked_at = now();
set role authenticated;
select public.pair_extension_device('dddddddd-0000-0000-0000-000000000009') from generate_series(1, 8);
select pg_temp.check(public.pair_extension_device('dddddddd-0000-0000-0000-000000000009') ->> 'status' = 'rate_limited', '20 créations / 24 h maximum');
reset role;
delete from auth.users where id = 'dddddddd-9999-9999-9999-999999999999';
select pg_temp.check(not exists (select 1 from public.extension_devices), 'suppression du compte : appareils supprimés (cascade)');
