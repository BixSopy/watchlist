-- =============================================================================================
-- 20261107100000_notification_prefs.sql — Préférences de notifications (rappels de sorties +
-- newsletter), demande de Pierre le 07/11/2026. NE PAS APPLIQUER en prod sans son accord explicite.
--
-- Deux bascules indépendantes, DÉSACTIVÉES PAR DÉFAUT (opt-in, jamais opt-out) :
--  * releases   : digest hebdomadaire automatique des prochaines sorties des séries/anime suivis
--                 (statut "encours"), envoyé par un job cron (api/notifications-digest.js) qui lit
--                 directement watchlist_items.next_air (déjà calculé et synchronisé côté client,
--                 js/14-suivi.js) — aucun appel TMDB côté serveur.
--  * newsletter : canal newsletter général rédigé par Pierre depuis le dashboard Resend ; la
--                 bascule synchronise l'abonnement au Topic Resend correspondant
--                 (api/newsletter-sync.js).
-- Même patron que social_settings (20261026120000) : écriture uniquement via fonction
-- SECURITY DEFINER, search_path vide, jsonb en retour, lecture directe limitée à la ligne du
-- profil appelant (RLS). Réutilise public._social_owns (déjà déclarée, générique malgré son nom :
-- vérifie seulement que le profil appartient au compte connecté).
-- =============================================================================================

create table if not exists public.notification_prefs (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  releases   boolean not null default false,
  newsletter boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.notification_prefs enable row level security;
revoke all on table public.notification_prefs from anon, authenticated;
grant select on table public.notification_prefs to authenticated;

drop policy if exists notification_prefs_select_mine on public.notification_prefs;
create policy notification_prefs_select_mine on public.notification_prefs for select to authenticated using (
  exists (select 1 from public.profiles p where p.account_id = (select auth.uid()) and p.id = profile_id));

-- =============================================================================================
-- Écriture : bascule des deux préférences (null = inchangé)
-- =============================================================================================
create or replace function public.set_notification_prefs(p_profile_id uuid, p_releases boolean default null,
  p_newsletter boolean default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.notification_prefs;
begin
  if not public._social_owns(p_profile_id) then return jsonb_build_object('status', 'not_authenticated'); end if;
  insert into public.notification_prefs(profile_id) values (p_profile_id) on conflict do nothing;
  update public.notification_prefs set releases = coalesce(p_releases, releases), newsletter = coalesce(p_newsletter, newsletter),
         updated_at = now()
   where profile_id = p_profile_id returning * into v;
  return jsonb_build_object('status', 'ok', 'prefs', jsonb_build_object('releases', v.releases, 'newsletter', v.newsletter));
end $$;

-- =============================================================================================
-- Lecture : mes préférences (écran Réglages)
-- =============================================================================================
create or replace function public.get_my_notification_prefs(p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.notification_prefs;
begin
  if not public._social_owns(p_profile_id) then return jsonb_build_object('status', 'not_authenticated'); end if;
  select * into v from public.notification_prefs where profile_id = p_profile_id;
  return jsonb_build_object('status', 'ok',
    'prefs', jsonb_build_object('releases', coalesce(v.releases, false), 'newsletter', coalesce(v.newsletter, false)));
end $$;

-- ---------- Droits ----------
revoke all on function public.set_notification_prefs(uuid, boolean, boolean), public.get_my_notification_prefs(uuid) from public, anon;
grant execute on function public.set_notification_prefs(uuid, boolean, boolean), public.get_my_notification_prefs(uuid) to authenticated;
