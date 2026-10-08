-- Quota TMDB par compte : 4 000 → 8 000 appels/jour (UTC).
-- Les hits du cache mémoire du proxy /api/tmdb ne consomment plus de quota (voir api/tmdb.js) :
-- la limite porte sur les vrais appels à TMDB. OMDb inchangé (150/compte, 900 global).
-- Ajustable ensuite : update public.api_quota_limits set per_user_daily = N where bucket = 'tmdb';

begin;

update public.api_quota_limits
   set per_user_daily = 8000
 where bucket = 'tmdb'
   and per_user_daily <> 8000;

commit;
