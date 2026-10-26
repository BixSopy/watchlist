-- Tests de la migration 20261026120000_social_pseudo_amis.sql (pseudo + amis) sur Postgres local.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.check(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'ÉCHEC : %', p_msg; end if;
  raise notice 'ok - %', p_msg;
end $$;
grant execute on function pg_temp.check(boolean, text) to anon, authenticated;
create temp table t_so(k text primary key, v jsonb);
grant all on t_so to anon, authenticated;
create or replace function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p)::text, false)
$$;
grant execute on function pg_temp.as_user(uuid) to anon, authenticated;
set client_min_messages = notice;

-- ---------- Surface ----------
select pg_temp.check((select bool_and(relrowsecurity) from pg_class where oid in
  ('public.friendships'::regclass, 'public.friend_requests'::regclass, 'public.blocks'::regclass, 'public.social_settings'::regclass,
   'public.reserved_handles'::regclass, 'public.social_rate'::regclass)), 'RLS activée sur toutes les tables');
select pg_temp.check(not has_table_privilege('anon', 'public.friendships', 'select') and not has_table_privilege('anon', 'public.friend_requests', 'select')
  and not has_table_privilege('anon', 'public.blocks', 'select') and not has_table_privilege('anon', 'public.social_settings', 'select'), 'anon : aucun accès aux tables');
select pg_temp.check(not has_table_privilege('authenticated', 'public.friendships', 'insert') and not has_table_privilege('authenticated', 'public.friend_requests', 'insert')
  and not has_table_privilege('authenticated', 'public.friend_requests', 'update') and not has_table_privilege('authenticated', 'public.blocks', 'delete')
  and not has_table_privilege('authenticated', 'public.social_settings', 'update'), 'authenticated : aucune écriture directe');
select pg_temp.check(not has_table_privilege('authenticated', 'public.reserved_handles', 'select') and not has_table_privilege('authenticated', 'public.social_rate', 'select'), 'tables internes fermées');
select pg_temp.check(not has_column_privilege('authenticated', 'public.profiles', 'handle', 'update')
  and not has_column_privilege('authenticated', 'public.profiles', 'invite_code', 'update')
  and not has_column_privilege('authenticated', 'public.profiles', 'handle', 'insert'), 'pseudo et code non modifiables en direct');
select pg_temp.check(has_function_privilege('anon', 'public.get_invite(text,text)', 'execute')
  and not has_function_privilege('anon', 'public.send_friend_request(uuid,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.get_my_social(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public._social_make_friends(uuid,uuid)', 'execute'), 'anon : seulement get_invite ; internes fermées');
select pg_temp.check((select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc where pronamespace = 'public'::regnamespace
  and proname in ('check_handle','set_handle','get_invite','rotate_invite_code','send_friend_request','respond_friend_request','remove_friend',
                  'block_profile','unblock_profile','set_social_settings','get_my_social','get_friend_view')), 'SECURITY DEFINER + search_path figé');

-- ---------- Données : Léa (A), Tom (B), Zoé (C) ----------
insert into auth.users (id, email, email_confirmed_at) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'lea@exemple.fr', now()),
  ('bbbbbbbb-2222-2222-2222-222222222222', 'tom@exemple.fr', now()),
  ('cccccccc-3333-3333-3333-333333333333', 'zoe@exemple.fr', now());
insert into public.profiles (id, account_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-1111-1111-1111-111111111111', 'Léa'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'bbbbbbbb-2222-2222-2222-222222222222', 'Tom'),
  ('cccccccc-0000-0000-0000-00000000000c', 'cccccccc-3333-3333-3333-333333333333', 'Zoé');
insert into public.watchlist_items (local_id, profile_id, tmdb_id, tmdb_type, type, status, title, year, poster_path, my_rating, overview, tags, saison, episode, deleted) values
  ('a1', 'aaaaaaaa-0000-0000-0000-00000000000a', 94605, 'tv', 'serie', 'encours', 'Arcane', '2021', '/a.jpg', 9, 'note privée', '{secret}', 2, 3, false),
  ('a2', 'aaaaaaaa-0000-0000-0000-00000000000a', 2, 'movie', 'film', 'termine', 'Dune', '2021', '/d.jpg', 8, null, '{}', null, null, false),
  ('a3', 'aaaaaaaa-0000-0000-0000-00000000000a', 3, 'tv', 'anime', 'encours', 'Supprimé', '2000', null, 0, null, '{}', 1, 1, true);

-- ---------- Pseudo ----------
set role authenticated;
select pg_temp.check(public.set_handle('aaaaaaaa-0000-0000-0000-00000000000a', 'lea') ->> 'status' = 'not_authenticated', 'sans session : refusé');
select pg_temp.as_user('aaaaaaaa-1111-1111-1111-111111111111');
select pg_temp.check(public.set_handle('bbbbbbbb-0000-0000-0000-00000000000b', 'tom') ->> 'status' = 'not_authenticated', 'profil d''un autre compte : refusé');
select pg_temp.check(public.check_handle('aaaaaaaa-0000-0000-0000-00000000000a', 'ab') ->> 'status' = 'invalid', 'trop court');
select pg_temp.check(public.check_handle('aaaaaaaa-0000-0000-0000-00000000000a', repeat('a', 21)) ->> 'status' = 'invalid', 'trop long');
select pg_temp.check(public.check_handle('aaaaaaaa-0000-0000-0000-00000000000a', 'lé a') ->> 'status' = 'invalid', 'accents / espaces refusés');
select pg_temp.check(public.check_handle('aaaaaaaa-0000-0000-0000-00000000000a', '.lea') ->> 'status' = 'invalid'
  and public.check_handle('aaaaaaaa-0000-0000-0000-00000000000a', 'lea.') ->> 'status' = 'invalid'
  and public.check_handle('aaaaaaaa-0000-0000-0000-00000000000a', 'l..ea') ->> 'status' = 'invalid', 'point en début / fin / doublé refusé');
select pg_temp.check(public.check_handle('aaaaaaaa-0000-0000-0000-00000000000a', 'Admin') ->> 'status' = 'reserved', 'mot réservé (insensible à la casse)');
select pg_temp.check(public.check_handle('aaaaaaaa-0000-0000-0000-00000000000a', '@Lea.Watch') ->> 'handle' = 'lea.watch', '@ retiré, minuscules');
insert into t_so values ('la', public.set_handle('aaaaaaaa-0000-0000-0000-00000000000a', '@Lea'));
select pg_temp.check((select v ->> 'status' = 'ok' and v ->> 'handle' = 'lea' and v ->> 'invite_code' ~ '^[A-Za-z0-9]{12}$' from t_so where k = 'la'), 'pseudo posé + code d''invitation 12 caractères');
select pg_temp.check((select count(*) = 1 from public.social_settings), 'réglages par défaut créés');
select pg_temp.check((select not show_ratings and show_list and show_progress from public.social_settings), 'par défaut : liste et progression visibles, notes masquées');
select pg_temp.check(public.set_handle('aaaaaaaa-0000-0000-0000-00000000000a', 'lea2') ->> 'status' = 'too_soon', 'changement bloqué pendant 30 jours');
select pg_temp.as_user('bbbbbbbb-2222-2222-2222-222222222222');
insert into t_so values ('ck', public.check_handle('bbbbbbbb-0000-0000-0000-00000000000b', 'LEA'));
select pg_temp.check((select v ->> 'status' = 'taken' and jsonb_array_length(v -> 'suggestions') = 3 from t_so where k = 'ck'), '@LEA = @lea : pris, 3 suggestions');
select pg_temp.check(public.set_handle('bbbbbbbb-0000-0000-0000-00000000000b', 'Lea') ->> 'status' = 'taken', 'unicité insensible à la casse');
select pg_temp.check(public.set_handle('bbbbbbbb-0000-0000-0000-00000000000b', 'tom') ->> 'status' = 'ok', 'Tom prend @tom');
select pg_temp.check((select count(*) = 0 from public.social_settings where profile_id = 'aaaaaaaa-0000-0000-0000-00000000000a'), 'RLS : Tom ne lit pas les réglages de Léa');
reset role;
-- Changement après 30 jours : l'ancien pseudo reste réservé 30 jours (sauf pour son ancien propriétaire)
update public.profiles set handle_changed_at = now() - interval '31 days' where id = 'bbbbbbbb-0000-0000-0000-00000000000b';
set role authenticated;
select pg_temp.check(public.set_handle('bbbbbbbb-0000-0000-0000-00000000000b', 'tom.b') ->> 'status' = 'ok', 'changement possible après 30 jours');
select pg_temp.as_user('cccccccc-3333-3333-3333-333333333333');
select pg_temp.check(public.check_handle('cccccccc-0000-0000-0000-00000000000c', 'tom') ->> 'status' = 'reserved', 'ancien pseudo réservé 30 jours');
select pg_temp.check(public.set_handle('cccccccc-0000-0000-0000-00000000000c', 'zoe') ->> 'status' = 'ok', 'Zoé prend @zoe');
reset role;
update public.profiles set handle_changed_at = now() - interval '31 days' where id = 'bbbbbbbb-0000-0000-0000-00000000000b';
set role authenticated;
select pg_temp.as_user('bbbbbbbb-2222-2222-2222-222222222222');
select pg_temp.check(public.set_handle('bbbbbbbb-0000-0000-0000-00000000000b', 'tom') ->> 'status' = 'ok', 'l''ancien propriétaire peut reprendre son pseudo');
reset role;

-- ---------- Invitation (anonyme) ----------
insert into t_so select 'code_a', to_jsonb(invite_code) from public.profiles where id = 'aaaaaaaa-0000-0000-0000-00000000000a';
insert into t_so select 'code_c', to_jsonb(invite_code) from public.profiles where id = 'cccccccc-0000-0000-0000-00000000000c';
set role anon;
select pg_temp.check((select public.get_invite('lea', v #>> '{}') ->> 'name' = 'Léa' from t_so where k = 'code_a'), 'anon : bon code → pseudo, nom, avatar');
select pg_temp.check((select not (public.get_invite('lea', v #>> '{}') ? 'account_id') and not (public.get_invite('lea', v #>> '{}') ? 'profile_id') from t_so where k = 'code_a'), 'aucun identifiant interne exposé');
select pg_temp.check(public.get_invite('inconnu', 'AAAAAAAAAAAA') is null and public.get_invite('lea', null) is null, 'pseudo inconnu / sans code : même réponse (null)');
select pg_temp.check(public.get_invite('lea', 'AAAAAAAAAAAA') is null and public.get_invite('lea', 'BBBBBBBBBBBB') is null and public.get_invite('lea', 'CCCCCCCCCCCC') is null, 'codes faux refusés');
select pg_temp.check((select public.get_invite('lea', v #>> '{}') is null from t_so where k = 'code_a'), '3 codes faux / minute : même le bon code est bloqué');
reset role;
delete from public.social_rate;

-- ---------- Demandes ----------
set role authenticated;
select pg_temp.as_user('bbbbbbbb-2222-2222-2222-222222222222');
select pg_temp.check(public.send_friend_request('bbbbbbbb-0000-0000-0000-00000000000b', 'lea', 'XXXXXXXXXXXX') ->> 'status' = 'invalid', 'code faux : refusé');
select pg_temp.check((select public.send_friend_request('bbbbbbbb-0000-0000-0000-00000000000b', 'lea', v #>> '{}') ->> 'status' = 'sent' from t_so where k = 'code_a'), 'Tom → Léa : demande envoyée');
select pg_temp.check((select public.send_friend_request('bbbbbbbb-0000-0000-0000-00000000000b', 'lea', v #>> '{}') ->> 'status' = 'sent' from t_so where k = 'code_a'), 'renvoi : idempotent');
select pg_temp.check((select count(*) = 1 from public.friend_requests), 'une seule demande');
select pg_temp.check((select public.get_friend_view('bbbbbbbb-0000-0000-0000-00000000000b', 'aaaaaaaa-0000-0000-0000-00000000000a') ->> 'status' = 'not_found'), 'pas encore amis : rien de lisible');
select pg_temp.as_user('cccccccc-3333-3333-3333-333333333333');
select pg_temp.check((select count(*) = 0 from public.friend_requests), 'RLS : Zoé ne voit pas la demande des autres');
select pg_temp.as_user('aaaaaaaa-1111-1111-1111-111111111111');
insert into t_so values ('ms', public.get_my_social('aaaaaaaa-0000-0000-0000-00000000000a'));
select pg_temp.check((select jsonb_array_length(v -> 'incoming') = 1 and v -> 'incoming' -> 0 ->> 'handle' = 'tom' from t_so where k = 'ms'), 'Léa voit la demande de @tom');
select pg_temp.as_user('cccccccc-3333-3333-3333-333333333333');
select pg_temp.check((select public.respond_friend_request((v -> 'incoming' -> 0 ->> 'id')::uuid, true) ->> 'status' = 'not_found' from t_so where k = 'ms'), 'un tiers ne peut pas accepter');
select pg_temp.as_user('aaaaaaaa-1111-1111-1111-111111111111');
select pg_temp.check((select public.respond_friend_request((v -> 'incoming' -> 0 ->> 'id')::uuid, true) ->> 'status' = 'friends' from t_so where k = 'ms'), 'Léa accepte');
select pg_temp.check((select count(*) = 1 from public.friendships) and (select count(*) = 0 from public.friend_requests), 'amitié créée, demande effacée');

-- ---------- Ce qu'un ami voit ----------
select pg_temp.as_user('bbbbbbbb-2222-2222-2222-222222222222');
insert into t_so values ('fv', public.get_friend_view('bbbbbbbb-0000-0000-0000-00000000000b', 'aaaaaaaa-0000-0000-0000-00000000000a'));
select pg_temp.check((select v ->> 'status' = 'ok' and jsonb_array_length(v -> 'items') = 2 from t_so where k = 'fv'), 'Tom voit la liste de Léa (sans les supprimés)');
select pg_temp.check((select bool_and(i ->> 'rating' is null) from t_so, jsonb_array_elements(v -> 'items') i where k = 'fv'), 'notes masquées par défaut');
select pg_temp.check((select not (v::text like '%note privée%') and not (v::text like '%secret%') from t_so where k = 'fv'), 'notes texte jamais exposées');
select pg_temp.check((select (v -> 'items' -> 0 ->> 'episode') = '3' from t_so where k = 'fv'), 'progression visible par défaut');
select pg_temp.check((select v -> 'friends' -> 0 -> 'current' ->> 'title' = 'Arcane' from (select public.get_my_social('bbbbbbbb-0000-0000-0000-00000000000b') v) x), 'liste d''amis : série en cours');
select pg_temp.as_user('aaaaaaaa-1111-1111-1111-111111111111');
select pg_temp.check(public.set_social_settings('aaaaaaaa-0000-0000-0000-00000000000a', p_show_ratings => true, p_show_progress => false) ->> 'status' = 'ok', 'Léa change ses réglages');
select pg_temp.as_user('bbbbbbbb-2222-2222-2222-222222222222');
select pg_temp.check((select (v -> 'items' -> 0 ->> 'rating') = '9' and (v -> 'items' -> 0 ->> 'episode') is null
  from (select public.get_friend_view('bbbbbbbb-0000-0000-0000-00000000000b', 'aaaaaaaa-0000-0000-0000-00000000000a') v) x), 'réglages appliqués : notes visibles, progression masquée');
select pg_temp.as_user('aaaaaaaa-1111-1111-1111-111111111111');
select public.set_social_settings('aaaaaaaa-0000-0000-0000-00000000000a', p_show_list => false);
select pg_temp.as_user('bbbbbbbb-2222-2222-2222-222222222222');
select pg_temp.check((select jsonb_array_length(v -> 'items') = 0 and not (v ->> 'show_list')::boolean
  from (select public.get_friend_view('bbbbbbbb-0000-0000-0000-00000000000b', 'aaaaaaaa-0000-0000-0000-00000000000a') v) x), 'liste masquée');
select pg_temp.as_user('cccccccc-3333-3333-3333-333333333333');
select pg_temp.check(public.get_friend_view('cccccccc-0000-0000-0000-00000000000c', 'aaaaaaaa-0000-0000-0000-00000000000a') ->> 'status' = 'not_found', 'un inconnu ne lit rien');
select pg_temp.check(public.get_friend_view('aaaaaaaa-0000-0000-0000-00000000000a', 'bbbbbbbb-0000-0000-0000-00000000000b') ->> 'status' = 'not_authenticated', 'usurper un profil : refusé');

-- ---------- Demande croisée, retrait, blocage ----------
select pg_temp.check((select public.send_friend_request('cccccccc-0000-0000-0000-00000000000c', 'lea', v #>> '{}') ->> 'status' = 'sent' from t_so where k = 'code_a'), 'Zoé → Léa');
select pg_temp.as_user('aaaaaaaa-1111-1111-1111-111111111111');
select pg_temp.check((select public.send_friend_request('aaaaaaaa-0000-0000-0000-00000000000a', 'zoe', v #>> '{}') ->> 'status' = 'friends' from t_so where k = 'code_c'), 'demandes croisées : amis directement');
select pg_temp.check(public.remove_friend('aaaaaaaa-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-00000000000c') ->> 'status' = 'ok', 'Léa retire Zoé');
select pg_temp.check(public.block_profile('aaaaaaaa-0000-0000-0000-00000000000a', 'bbbbbbbb-0000-0000-0000-00000000000b') ->> 'status' = 'ok', 'Léa bloque Tom');
select pg_temp.check((select count(*) = 0 from public.friendships), 'blocage : amitié retirée');
select pg_temp.as_user('bbbbbbbb-2222-2222-2222-222222222222');
select pg_temp.check((select public.send_friend_request('bbbbbbbb-0000-0000-0000-00000000000b', 'lea', v #>> '{}') ->> 'status' = 'sent' from t_so where k = 'code_a'), 'bloqué : réponse neutre');
select pg_temp.check((select count(*) = 0 from public.friend_requests where from_profile = 'bbbbbbbb-0000-0000-0000-00000000000b'), 'bloqué : aucune demande créée');
select pg_temp.check((select count(*) = 0 from public.blocks), 'RLS : le bloqué ne voit pas le blocage');

-- ---------- Refus silencieux ----------
select pg_temp.as_user('cccccccc-3333-3333-3333-333333333333');
select pg_temp.check((select public.send_friend_request('cccccccc-0000-0000-0000-00000000000c', 'lea', v #>> '{}') ->> 'status' = 'sent' from t_so where k = 'code_a'), 'Zoé redemande');
select pg_temp.as_user('aaaaaaaa-1111-1111-1111-111111111111');
select pg_temp.check((select public.respond_friend_request(id, false) ->> 'status' = 'declined' from public.friend_requests limit 1), 'Léa refuse');
select pg_temp.as_user('cccccccc-3333-3333-3333-333333333333');
select pg_temp.check(jsonb_array_length(public.get_my_social('cccccccc-0000-0000-0000-00000000000c') -> 'outgoing') = 1, 'refus silencieux : Zoé voit toujours « en attente »');
select pg_temp.as_user('aaaaaaaa-1111-1111-1111-111111111111');
select pg_temp.check(jsonb_array_length(public.get_my_social('aaaaaaaa-0000-0000-0000-00000000000a') -> 'incoming') = 0, 'Léa ne la voit plus');

-- ---------- Nouveau lien ----------
select pg_temp.check(public.rotate_invite_code('aaaaaaaa-0000-0000-0000-00000000000a') ->> 'status' = 'ok', 'nouveau lien');
select pg_temp.check((select public.get_invite('lea', v #>> '{}') is null from t_so where k = 'code_a'), 'l''ancien code ne marche plus');
select public.rotate_invite_code('aaaaaaaa-0000-0000-0000-00000000000a') from generate_series(1, 4);
select pg_temp.check(public.rotate_invite_code('aaaaaaaa-0000-0000-0000-00000000000a') ->> 'status' = 'rate_limited', '5 nouveaux liens par jour maximum');
reset role;

-- ---------- Limites anti-abus ----------
insert into public.social_rate(profile_id, kind) select 'cccccccc-0000-0000-0000-00000000000c', 'request' from generate_series(1, 20);
delete from public.friend_requests;
update public.profiles set invite_code = 'TomCode00001' where id = 'bbbbbbbb-0000-0000-0000-00000000000b';
set role authenticated;
select pg_temp.as_user('cccccccc-3333-3333-3333-333333333333');
select pg_temp.check(public.send_friend_request('cccccccc-0000-0000-0000-00000000000c', 'tom', 'TomCode00001') ->> 'status' = 'rate_limited', '20 demandes par jour maximum');
reset role;
delete from public.social_rate;
insert into auth.users (id) select ('9d9d9d9d-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid from generate_series(1, 200) g;
insert into public.profiles (id, account_id, name) select ('9e9e9e9e-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, ('9d9d9d9d-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'X' from generate_series(1, 200) g;
insert into public.friendships(a, b) select least(p.id, 'cccccccc-0000-0000-0000-00000000000c'::uuid), greatest(p.id, 'cccccccc-0000-0000-0000-00000000000c'::uuid)
  from public.profiles p where p.name = 'X';
set role authenticated;
select pg_temp.as_user('cccccccc-3333-3333-3333-333333333333');
select pg_temp.check(public.send_friend_request('cccccccc-0000-0000-0000-00000000000c', 'tom', 'TomCode00001') ->> 'status' = 'friend_limit', '200 amis maximum');
reset role;

-- ---------- Suppression de compte : cascade ----------
delete from auth.users where id = 'cccccccc-3333-3333-3333-333333333333';
select pg_temp.check((select count(*) = 0 from public.friendships where 'cccccccc-0000-0000-0000-00000000000c' in (a, b))
  and (select count(*) = 0 from public.social_settings where profile_id = 'cccccccc-0000-0000-0000-00000000000c'), 'suppression du compte : amitiés et réglages effacés');
