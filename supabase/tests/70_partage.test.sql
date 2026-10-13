-- Tests de la migration 20261013150000_partage_lecture_seule.sql (liens de partage) sur Postgres local.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.check(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'ÉCHEC : %', p_msg; end if;
  raise notice 'ok - %', p_msg;
end $$;
grant execute on function pg_temp.check(boolean, text) to anon, authenticated;
create temp table t_sh(k text primary key, v jsonb);
grant all on t_sh to anon, authenticated;
set client_min_messages = notice;

-- ---------- Surface ----------
select pg_temp.check((select relrowsecurity from pg_class where oid = 'public.shares'::regclass), 'RLS activée');
select pg_temp.check(not has_table_privilege('anon', 'public.shares', 'select'), 'anon : aucun accès à la table');
select pg_temp.check(has_table_privilege('authenticated', 'public.shares', 'select')
  and not has_table_privilege('authenticated', 'public.shares', 'insert')
  and not has_table_privilege('authenticated', 'public.shares', 'update')
  and not has_table_privilege('authenticated', 'public.shares', 'delete'), 'authenticated : lecture seule de la table');
select pg_temp.check(not has_function_privilege('anon', 'public.create_share(uuid,text,text[],text[],boolean,boolean,text)', 'execute')
  and not has_function_privilege('anon', 'public.revoke_share(uuid)', 'execute')
  and has_function_privilege('anon', 'public.get_public_share(text)', 'execute'), 'anon : seulement la lecture publique');
select pg_temp.check((select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc where pronamespace = 'public'::regnamespace
  and proname in ('create_share','revoke_share','get_public_share')), 'SECURITY DEFINER + search_path figé');

-- ---------- Données ----------
insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-7777-7777-7777-777777777777', 's@exemple.fr', now()),
  ('22222222-8888-8888-8888-888888888888', 't@exemple.fr', now());
insert into public.profiles (id, account_id, name) values
  ('11111111-0000-0000-0000-000000000007', '11111111-7777-7777-7777-777777777777', 'S'),
  ('22222222-0000-0000-0000-000000000008', '22222222-8888-8888-8888-888888888888', 'T');
insert into public.watchlist_items (local_id, profile_id, tmdb_id, tmdb_type, type, status, title, year, poster_path, my_rating, overview, tags, saison, episode, deleted) values
  ('a', '11111111-0000-0000-0000-000000000007', 1, 'tv', 'anime', 'encours', 'Kingdom', '2012', '/k.jpg', 9, 'note privée', '{secret}', 5, 9, false),
  ('b', '11111111-0000-0000-0000-000000000007', 2, 'tv', 'serie', 'encours', 'Invincible', '2021', '/i.jpg', 8, null, '{}', 3, 5, false),
  ('c', '11111111-0000-0000-0000-000000000007', 3, 'movie', 'film', 'termine', 'Batman', '1993', '/b.jpg', 7, null, '{}', null, null, false),
  ('d', '11111111-0000-0000-0000-000000000007', 4, 'tv', 'anime', 'encours', 'Supprimé', '2000', null, 0, null, '{}', 1, 1, true);

-- ---------- Création ----------
set role authenticated;
select pg_temp.check(public.create_share('11111111-0000-0000-0000-000000000007', 'list') ->> 'status' = 'not_authenticated', 'sans session : refusé');
select set_config('request.jwt.claims', '{"sub":"11111111-7777-7777-7777-777777777777"}', false);
select pg_temp.check(public.create_share('22222222-0000-0000-0000-000000000008', 'list') ->> 'status' = 'invalid_profile', 'profil d''un autre compte : refusé');
select pg_temp.check(public.create_share('11111111-0000-0000-0000-000000000007', 'filtered') ->> 'status' = 'empty_filter', 'liste filtrée sans filtre : refusée');
select pg_temp.check(public.create_share('11111111-0000-0000-0000-000000000007', 'filtered', array['nope']) ->> 'status' = 'invalid_filter', 'filtre inconnu refusé');
select pg_temp.check(public.create_share('11111111-0000-0000-0000-000000000007', 'x') ->> 'status' = 'invalid_kind', 'type de partage inconnu refusé');
insert into t_sh values ('f', public.create_share('11111111-0000-0000-0000-000000000007', 'filtered', array['encours'], array['anime'], true, false, '  Pierre<script>  '));
insert into t_sh values ('p', public.create_share('11111111-0000-0000-0000-000000000007', 'profile', null, null, false, true, null));
select pg_temp.check((select v ->> 'status' = 'ok' and v ->> 'token' ~ '^[A-Za-z0-9_-]{22}$' from t_sh where k = 'f'), 'jeton 128 bits base64url renvoyé');
select pg_temp.check((select count(*) = 2 from public.shares), 'le propriétaire voit ses liens');
select pg_temp.check((select display_name = 'Pierrescript' from public.shares where kind = 'filtered'), 'pseudo nettoyé (pas de < >)');
select set_config('request.jwt.claims', '{"sub":"22222222-8888-8888-8888-888888888888"}', false);
select pg_temp.check((select count(*) = 0 from public.shares), 'un autre compte ne voit rien');
select pg_temp.check((select public.revoke_share((v ->> 'id')::uuid) ->> 'status' from t_sh where k = 'f') = 'not_found', 'un autre compte ne peut pas révoquer');
reset role;

-- ---------- Lecture publique ----------
set role anon;
select pg_temp.check((select jsonb_array_length(public.get_public_share(v ->> 'token') -> 'items') = 1
  and public.get_public_share(v ->> 'token') -> 'items' -> 0 ->> 'title' = 'Kingdom' from t_sh where k = 'f'), 'filtre En cours × Anime appliqué, supprimés exclus');
select pg_temp.check((select (public.get_public_share(v ->> 'token') -> 'items' -> 0) ?& array['title','poster_path','season','episode']
  and public.get_public_share(v ->> 'token') -> 'items' -> 0 ->> 'rating' is null from t_sh where k = 'f'), 'note masquée, progression visible');
select pg_temp.check((select bool_and(position(x in public.get_public_share(v ->> 'token')::text) = 0)
  from t_sh, unnest(array['note privée','secret','11111111','s@exemple.fr','local_id','profile_id','account_id','overview','tags']) x where k in ('f','p')), 'aucun champ privé (liste et profil)');
select pg_temp.check((select (public.get_public_share(v ->> 'token') -> 'stats' ->> 'titles')::int = 3
  and public.get_public_share(v ->> 'token') -> 'items' -> 0 ->> 'season' is null
  and public.get_public_share(v ->> 'token') -> 'items' -> 0 ->> 'rating' is not null from t_sh where k = 'p'), 'profil : stats, progression masquée, notes visibles si autorisé');
select pg_temp.check(public.get_public_share('AAAAAAAAAAAAAAAAAAAAAA') is null, 'jeton inconnu : rien');
select pg_temp.check(public.get_public_share('x'' or 1=1 --') is null, 'jeton mal formé : rien');
reset role;
select pg_temp.check((select view_count > 0 from public.shares where kind = 'filtered'), 'compteur de vues agrégé');

-- ---------- Révocation ----------
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-7777-7777-7777-777777777777"}', false);
select pg_temp.check((select public.revoke_share((v ->> 'id')::uuid) ->> 'status' from t_sh where k = 'f') = 'ok', 'révocation par le propriétaire');
select pg_temp.check((select public.revoke_share((v ->> 'id')::uuid) ->> 'status' from t_sh where k = 'f') = 'not_found', 'révocation définitive (pas deux fois)');
reset role;
set role anon;
select pg_temp.check((select public.get_public_share(v ->> 'token') is null from t_sh where k = 'f'), 'lien révoqué : plus rien, immédiatement');
reset role;

-- ---------- Limites ----------
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-7777-7777-7777-777777777777"}', false);
select public.create_share('11111111-0000-0000-0000-000000000007', 'list') from generate_series(1, 9);
select pg_temp.check(public.create_share('11111111-0000-0000-0000-000000000007', 'list') ->> 'status' = 'too_many_shares', '10 liens actifs maximum');
reset role;
update public.shares set revoked_at = now();
set role authenticated;
select pg_temp.check((select count(*) from generate_series(1, 9) g where public.create_share('11111111-0000-0000-0000-000000000007', 'list') ->> 'status' = 'ok') = 9, 'nouveaux liens après révocation');
select pg_temp.check(public.create_share('11111111-0000-0000-0000-000000000007', 'list') ->> 'status' = 'rate_limited', '20 créations par heure maximum');
reset role;
