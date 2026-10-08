-- Tests de la migration 20261008210000_feedback.sql (avis des utilisateurs) sur Postgres local.
-- Chaque assertion lève une exception en cas d'échec (psql -v ON_ERROR_STOP=1).
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create or replace function pg_temp.check(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'ÉCHEC : %', p_msg; end if;
  raise notice 'ok - %', p_msg;
end $$;
grant execute on function pg_temp.check(boolean, text) to anon, authenticated, service_role;
-- Lecture directe de la table : doit être refusée aux clients
create or replace function pg_temp.denied(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when insufficient_privilege then
  return true;
end $$;
grant execute on function pg_temp.denied(text) to anon, authenticated, service_role;
set client_min_messages = notice;

-- ---------- Surface : RLS, droits, fonctions ----------
select pg_temp.check((select relrowsecurity from pg_class where oid = 'public.feedback'::regclass), 'RLS activée sur feedback');
select pg_temp.check(not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'feedback'), 'aucune politique RLS (aucun accès client)');
select pg_temp.check(not has_table_privilege('anon', 'public.feedback', 'select')
  and not has_table_privilege('anon', 'public.feedback', 'insert')
  and not has_table_privilege('anon', 'public.feedback', 'update')
  and not has_table_privilege('anon', 'public.feedback', 'delete'), 'anon : aucun droit sur la table');
select pg_temp.check(not has_table_privilege('authenticated', 'public.feedback', 'select')
  and not has_table_privilege('authenticated', 'public.feedback', 'insert')
  and not has_table_privilege('authenticated', 'public.feedback', 'update')
  and not has_table_privilege('authenticated', 'public.feedback', 'delete'), 'authenticated : aucun droit sur la table');
select pg_temp.check(not has_function_privilege('anon', 'public.submit_feedback(uuid,text,text,text,text,text,text,text,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.submit_feedback(uuid,text,text,text,text,text,text,text,text)', 'execute')
  and has_function_privilege('service_role', 'public.submit_feedback(uuid,text,text,text,text,text,text,text,text)', 'execute'), 'submit_feedback : serveur uniquement (service_role)');
select pg_temp.check(not has_function_privilege('anon', 'public.feedback_mark_notified(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.feedback_mark_notified(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.feedback_mark_notified(uuid)', 'execute'), 'feedback_mark_notified : serveur uniquement');
select pg_temp.check((select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc
  where pronamespace = 'public'::regnamespace and proname in ('submit_feedback', 'feedback_mark_notified')), 'SECURITY DEFINER + search_path figé');

-- ---------- Données ----------
insert into auth.users (id, email, email_confirmed_at) values
  ('99999999-9999-9999-9999-999999999999', 'g@exemple.fr', now());
insert into public.profiles (id, account_id, name) values
  ('99999999-0000-0000-0000-000000000009', '99999999-9999-9999-9999-999999999999', 'G');

-- ---------- Clients : lecture et écriture refusées ----------
set role anon;
select pg_temp.check(pg_temp.denied('select count(*) from public.feedback'), 'anon : lecture refusée');
select pg_temp.check(pg_temp.denied($q$insert into public.feedback (kind, message) values ('idea', 'spam')$q$), 'anon : insertion directe refusée');
select pg_temp.check(pg_temp.denied($q$select public.submit_feedback(null, null, 'idea', 'Salut !', null, null, null, null, null)$q$), 'anon : submit_feedback refusée');
reset role;
select set_config('request.jwt.claims', '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}', false);
set role authenticated;
select pg_temp.check(pg_temp.denied('select count(*) from public.feedback'), 'authenticated : lecture refusée (même ses propres avis)');
select pg_temp.check(pg_temp.denied($q$select public.submit_feedback('99999999-9999-9999-9999-999999999999', null, 'idea', 'Salut !', null, null, null, null, null)$q$), 'authenticated : submit_feedback refusée');
reset role;
select set_config('request.jwt.claims', '', false);

-- ---------- Validation ----------
set role service_role;
select pg_temp.check(public.submit_feedback(null, null, 'spam', 'Bonjour', null, null, null, null, null) = '{"status":"invalid","field":"kind"}'::jsonb, 'type inconnu refusé');
select pg_temp.check(public.submit_feedback(null, null, 'idea', '   a  ', null, null, null, null, null) ->> 'field' = 'message', 'message trop court refusé');
select pg_temp.check(public.submit_feedback(null, null, 'idea', repeat('x', 2001), null, null, null, null, null) ->> 'field' = 'message', 'message de plus de 2 000 caractères refusé');
select pg_temp.check(public.submit_feedback(null, null, 'idea', 'Bonjour', 'pas-un-email', null, null, null, null) ->> 'field' = 'reply_email', 'email de réponse invalide refusé');
select pg_temp.check(public.submit_feedback(null, 'IP-EN-CLAIR 1.2.3.4', 'idea', 'Bonjour', null, null, null, null, null) ->> 'field' = 'ip_hash', 'IP en clair refusée (empreinte hexadécimale uniquement)');
select pg_temp.check(public.submit_feedback(null, null, 'idea', 'Bonjour', null, null, null, null, 'fr-FR') ->> 'field' = 'locale', 'langue mal formée refusée');

-- ---------- Enregistrement ----------
select pg_temp.check((public.submit_feedback('99999999-9999-9999-9999-999999999999', repeat('a', 32), 'bug', '  Le bouton ne marche pas  ',
  ' Moi@Exemple.FR ', '/en', 'abc1234', 'Chrome 154 · Android', 'en') ->> 'status') = 'ok', 'avis valide enregistré (compte connecté)');
reset role;
select pg_temp.check((select profile_id = '99999999-0000-0000-0000-000000000009' and message = 'Le bouton ne marche pas'
  and reply_email = 'moi@exemple.fr' and kind = 'bug' and locale = 'en' and notified_at is null
  from public.feedback order by created_at desc limit 1), 'profil retrouvé côté serveur, message rogné, email en minuscules');
set role service_role;
select pg_temp.check((select (r ->> 'status') = 'ok' and (r ->> 'notify')::boolean
  from public.submit_feedback(null, null, 'idea', 'Sans compte, sans IP', null, null, null, null, null) r), 'avis sans compte accepté, notification autorisée');

-- ---------- Limites ----------
-- par profil : 5 par heure (1 déjà envoyé)
select public.submit_feedback('99999999-9999-9999-9999-999999999999', null, 'idea', 'Idée ' || g, null, null, null, null, null) from generate_series(1, 4) g;
select pg_temp.check(public.submit_feedback('99999999-9999-9999-9999-999999999999', null, 'idea', 'Encore une', null, null, null, null, null)
  = '{"status":"rate_limited","scope":"profile"}'::jsonb, 'profil : 6e avis dans l''heure refusé');
-- par empreinte d'IP : 5 par heure (1 déjà envoyé avec repeat('a', 32))
select public.submit_feedback(null, repeat('a', 32), 'other', 'Autre ' || g, null, null, null, null, null) from generate_series(1, 4) g;
select pg_temp.check(public.submit_feedback(null, repeat('a', 32), 'other', 'Encore', null, null, null, null, null)
  = '{"status":"rate_limited","scope":"ip"}'::jsonb, 'empreinte d''IP : 6e avis dans l''heure refusé');
select pg_temp.check(public.submit_feedback(null, repeat('b', 32), 'other', 'Autre appareil', null, null, null, null, null) ->> 'status' = 'ok', 'une autre empreinte d''IP n''est pas bloquée');
reset role;
select pg_temp.check((select count(*) = 1 from public.feedback where ip_hash = repeat('a', 32) and profile_id is not null), 'avis rattaché au profil et à l''empreinte');

-- plafond d'emails : 30 notifications par jour
update public.feedback set notified_at = now() where id in (select id from public.feedback limit 5);
insert into public.feedback (kind, message, notified_at) select 'idea', 'n' || g, now() from generate_series(1, 25) g;
set role service_role;
select pg_temp.check((select (r ->> 'status') = 'ok' and not (r ->> 'notify')::boolean
  from public.submit_feedback(null, null, 'idea', 'Trente et unième', null, null, null, null, null) r), 'au-delà de 30 emails par jour : enregistré, sans notification');
select public.feedback_mark_notified((select id from public.feedback where message = 'Trente et unième'));
reset role;
select pg_temp.check((select notified_at is not null from public.feedback where message = 'Trente et unième'), 'feedback_mark_notified enregistre la date d''envoi');

-- plafond global : 300 avis par jour
insert into public.feedback (kind, message) select 'idea', 'g' || g from generate_series(1, 300) g;
set role service_role;
select pg_temp.check(public.submit_feedback(null, repeat('c', 32), 'idea', 'Trop tard', null, null, null, null, null)
  = '{"status":"rate_limited","scope":"global"}'::jsonb, 'plus de 300 avis dans la journée : refusé');
reset role;
delete from public.feedback where message ~ '^(g|n)[0-9]+$';

-- ---------- Ménage : empreintes après 2 jours, avis après 24 mois ----------
insert into public.feedback (kind, message, ip_hash, created_at) values
  ('idea', 'Vieux de 3 jours', repeat('d', 32), now() - interval '3 days'),
  ('idea', 'Vieux de 25 mois', null, now() - interval '25 months');
set role service_role;
select public.submit_feedback(null, null, 'idea', 'Déclenche le ménage', null, null, null, null, null);
reset role;
select pg_temp.check((select ip_hash is null from public.feedback where message = 'Vieux de 3 jours'), 'empreinte d''IP effacée après 2 jours');
select pg_temp.check(not exists (select 1 from public.feedback where message = 'Vieux de 25 mois'), 'avis de plus de 24 mois supprimé');

-- ---------- Suppression du compte : ses avis partent avec le profil ----------
delete from public.profiles where id = '99999999-0000-0000-0000-000000000009';
select pg_temp.check(not exists (select 1 from public.feedback where profile_id is not null), 'suppression du profil : avis effacés (cascade)');
