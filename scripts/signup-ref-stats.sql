-- Lecture seule : inscriptions par code d'attribution sociale (?r=…).
-- À lancer dans le SQL Editor Supabase (projet Watchlist) après application de la migration.
-- Ne modifie rien.

select coalesce(signup_ref, '(sans code)') as signup_ref,
       count(*) as signups,
       min(created_at) as first_at,
       max(created_at) as last_at
  from public.profiles
 group by 1
 order by signups desc, signup_ref;
