-- =============================================================================
-- Watchlist — nettoyage des restes laco-app et durcissement de la sécurité
-- Projet Supabase : batfulcvvquffgfeppcx
--
-- ⚠️  NE PAS EXÉCUTER AVANT LE DÉPLOIEMENT DE LA PR « fix/securite-synchro-confidentialite ».
--     La suppression de la contrainte UNIQUE(local_id) globale (bloc 10) suppose que
--     l'app fait ses upserts sur (local_id, profile_id), ce que fait la nouvelle version.
--
-- À lancer dans le SQL Editor du tableau de bord (rôle postgres), en une seule fois.
-- Tout est dans une transaction : en cas d'erreur, rien n'est appliqué.
-- Idempotent : relancer le script ne casse rien (IF EXISTS / blocs DO).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Profils en double : un seul profil par compte, le plus ancien
--    (2 profils créés à la même seconde le 18/09 par une course à la connexion).
--    Les éléments de watchlist des profils en trop sont d'abord rattachés au
--    profil conservé ; en cas de même local_id des deux côtés, on garde la
--    version la plus récente.
-- -----------------------------------------------------------------------------
create temporary table _profils_doublons on commit drop as
select id as doublon_id, garde_id
from (
  select id,
         first_value(id) over (partition by account_id order by created_at nulls last, id) as garde_id,
         row_number()    over (partition by account_id order by created_at nulls last, id) as rang
  from public.profiles
) p
where rang > 1;

-- 1a. Conflit de local_id : le profil conservé a une version plus ancienne → on la retire
delete from public.watchlist_items k
using _profils_doublons d, public.watchlist_items w
where k.profile_id = d.garde_id
  and w.profile_id = d.doublon_id
  and w.local_id   = k.local_id
  and coalesce(w.updated_at, '-infinity') > coalesce(k.updated_at, '-infinity');

-- 1b. Conflit restant : la version du profil en double est plus ancienne (ou égale) → on la retire
delete from public.watchlist_items w
using _profils_doublons d, public.watchlist_items k
where w.profile_id = d.doublon_id
  and k.profile_id = d.garde_id
  and k.local_id   = w.local_id;

-- 1c. Rattachement des éléments restants au profil conservé
update public.watchlist_items w
set profile_id = d.garde_id
from _profils_doublons d
where w.profile_id = d.doublon_id;

-- 1d. Suppression des profils en trop (plus aucun élément ne les référence)
delete from public.profiles p
using _profils_doublons d
where p.id = d.doublon_id;

-- -----------------------------------------------------------------------------
-- 2. Contrainte d'unicité sur profiles.account_id (empêche la course de se reproduire)
--    L'index simple idx_profiles_account_id devient redondant avec l'index unique.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname  = 'profiles_account_id_key'
  ) then
    alter table public.profiles add constraint profiles_account_id_key unique (account_id);
  end if;
end $$;

drop index if exists public.idx_profiles_account_id;

-- -----------------------------------------------------------------------------
-- 3. Restes de laco-app : 5 fonctions SECURITY DEFINER (tâches, notifications,
--    événements) qui visent des tables absentes de ce projet. Aucun trigger ne
--    les utilise. Pas de CASCADE : si un objet inattendu en dépendait, la
--    transaction échoue et rien n'est supprimé.
-- -----------------------------------------------------------------------------
drop function if exists public.notification_enabled(p_user_id uuid, p_type text);
drop function if exists public.notify_task_assignment();
drop function if exists public.notify_event_invitation();
drop function if exists public.handle_event_reschedule();
drop function if exists public.handle_event_decline();

-- -----------------------------------------------------------------------------
-- 4. Colonne laco-app profiles.notification_preferences (event_invited,
--    task_assigned…) : seule notification_enabled() la lisait. Watchlist ne s'en
--    sert pas (les rappels Suivi sont locaux au navigateur).
-- -----------------------------------------------------------------------------
alter table public.profiles drop column if exists notification_preferences;

-- -----------------------------------------------------------------------------
-- 5. Ancienne table public.entries (avant watchlist_items), jamais utilisée par
--    l'app actuelle. Supprimée seulement si elle est vide, par prudence.
-- -----------------------------------------------------------------------------
do $$
declare n bigint;
begin
  if to_regclass('public.entries') is not null then
    execute 'select count(*) from public.entries' into n;
    if n = 0 then
      execute 'drop table public.entries';
    else
      raise notice 'public.entries contient % ligne(s) : table conservée, à examiner', n;
    end if;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 6. keep_alive : la politique « public keep_alive » (ALL, true/true) laissait
--    n'importe qui lire, modifier ou vider la table avec la clé publique.
--    Nouvelle règle : le rôle anon peut seulement insérer une ligne datée de
--    maintenant (± 10 min) — exactement ce que fait le workflow GitHub.
-- -----------------------------------------------------------------------------
alter table public.keep_alive enable row level security;
drop policy if exists "public keep_alive" on public.keep_alive;
drop policy if exists "keep_alive insert anon" on public.keep_alive;
create policy "keep_alive insert anon" on public.keep_alive
  for insert to anon
  with check (pinged_at between now() - interval '10 minutes' and now() + interval '10 minutes');

revoke all on table public.keep_alive from anon, authenticated;
grant insert on table public.keep_alive to anon;

-- -----------------------------------------------------------------------------
-- 7. Fonction de trigger update_timestamp() : search_path figé (alerte advisor
--    « function_search_path_mutable »). now() est dans pg_catalog, toujours visible.
-- -----------------------------------------------------------------------------
alter function public.update_timestamp() set search_path = '';

-- -----------------------------------------------------------------------------
-- 8. Droits minimaux sur les tables de l'app.
--    - anon : aucun accès (l'app n'y touche qu'une fois connectée) ;
--    - authenticated : lecture, insertion, mise à jour (suppression logique via
--      deleted=true ; jamais de DELETE ni de TRUNCATE côté client).
--    Les politiques RLS existantes (« owner profiles », « owner watchlist »)
--    restent la vraie barrière ; ces REVOKE réduisent la surface en plus.
-- -----------------------------------------------------------------------------
revoke all on table public.profiles, public.watchlist_items from anon;
revoke delete, truncate, references, trigger
  on table public.profiles, public.watchlist_items from authenticated;
grant select, insert, update on table public.profiles, public.watchlist_items to authenticated;

-- -----------------------------------------------------------------------------
-- 9. Index inutiles sur watchlist_items
--    - idx_watchlist_local_id : doublon de l'index unique (local_id, profile_id) ;
--    - idx_watchlist_deleted : partiel sur deleted=false, jamais utilisé (l'app
--      filtre par profile_id). idx_watchlist_profile_id est conservé (RLS, FK).
-- -----------------------------------------------------------------------------
drop index if exists public.idx_watchlist_local_id;
drop index if exists public.idx_watchlist_deleted;

-- -----------------------------------------------------------------------------
-- 10. Unicité de local_id : seule la paire (local_id, profile_id) doit être
--     unique. La contrainte globale UNIQUE(local_id) est retirée.
--     (Requiert la nouvelle version de l'app, voir l'avertissement en tête.)
-- -----------------------------------------------------------------------------
alter table public.watchlist_items drop constraint if exists watchlist_items_local_id_key;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.watchlist_items'::regclass
      and conname  = 'watchlist_items_local_id_profile_id_key'
  ) then
    alter table public.watchlist_items
      add constraint watchlist_items_local_id_profile_id_key unique (local_id, profile_id);
  end if;
end $$;

commit;

-- -----------------------------------------------------------------------------
-- Vérifications conseillées après exécution (lecture seule) :
--   select account_id, count(*) from public.profiles group by 1;          -- 1 ligne par compte
--   select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public';                                         -- update_timestamp seul
--   select * from pg_policies where schemaname = 'public';
--   select grantee, table_name, string_agg(privilege_type, ',')
--     from information_schema.role_table_grants
--     where table_schema = 'public' and grantee in ('anon','authenticated') group by 1, 2;
-- Puis relancer les advisors de sécurité du tableau de bord.
-- -----------------------------------------------------------------------------
