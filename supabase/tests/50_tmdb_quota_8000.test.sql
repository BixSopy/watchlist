-- Vérifie la migration 20261008220000_tmdb_quota_8000.sql
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create or replace function pg_temp.check(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'ÉCHEC : %', p_msg; end if;
  raise notice 'ok - %', p_msg;
end $$;
set client_min_messages = notice;

select pg_temp.check(
  (select per_user_daily from public.api_quota_limits where bucket = 'tmdb') = 8000,
  'quota tmdb par compte = 8000');
select pg_temp.check(
  (select global_daily from public.api_quota_limits where bucket = 'tmdb') is null,
  'quota tmdb : pas de plafond global');
-- OMDb n'est pas modifié par cette migration ; on ne vérifie pas ses valeurs ici car
-- 10_ouverture_publique.test.sql les abaisse temporairement dans la même base de test.
