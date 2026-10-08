-- =============================================================================
-- Avis des utilisateurs (« Donner mon avis ») : table public.feedback + fonctions serveur.
-- Projet Supabase : batfulcvvquffgfeppcx
--
-- Fonctionnement :
--   1. le site envoie l'avis à la fonction Vercel /api/feedback (jamais directement à Supabase) ;
--   2. /api/feedback valide, filtre les robots (champ piège, délai minimum), calcule une empreinte
--      d'IP (HMAC tronqué, renouvelé chaque jour, jamais l'IP en clair), puis appelle
--      submit_feedback() avec la clé secrète (rôle service_role) ;
--   3. submit_feedback() revérifie tout, applique les limites (par profil, par empreinte d'IP et
--      globale), enregistre l'avis et indique si un email de notification peut partir ;
--   4. /api/feedback envoie l'email (Resend) puis appelle feedback_mark_notified().
--
-- Confidentialité :
--   - RLS activée et AUCUNE politique : aucun client (anon, authenticated) ne peut lire, écrire
--     ni effacer la table ; seules les fonctions ci-dessous (service_role) et le tableau de bord
--     Supabase y accèdent ;
--   - profile_id facultatif (avis envoyé connecté) ; supprimer son compte efface ses avis (cascade) ;
--   - ip_hash sert uniquement aux limites : effacé après 2 jours ;
--   - conservation : 24 mois, puis suppression automatique (ménage à chaque nouvel avis).
--
-- Limites (modifiables ici) : 5 avis par heure et 20 par jour, par profil et par empreinte d'IP ;
-- 300 avis par jour au total ; emails de notification limités à 30 par jour (l'offre gratuite
-- Resend, 100 emails/jour, sert aussi aux emails de compte : ils doivent rester prioritaires).
--
-- Rejouable sans erreur (idempotente). Transactionnelle.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Table
-- -----------------------------------------------------------------------------
create table if not exists public.feedback (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  profile_id   uuid references public.profiles(id) on delete cascade,
  kind         text not null check (kind in ('idea', 'bug', 'other')),
  message      text not null check (length(btrim(message)) between 1 and 2000),
  reply_email  text check (reply_email is null or (length(reply_email) <= 254 and reply_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  page         text check (page is null or length(page) <= 200),
  app_version  text check (app_version is null or length(app_version) <= 40),
  user_agent   text check (user_agent is null or length(user_agent) <= 80),
  locale       text check (locale is null or locale ~ '^[a-z]{2}$'),
  ip_hash      text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{32,64}$'),
  notified_at  timestamptz
);
create index if not exists feedback_created_idx on public.feedback (created_at);
create index if not exists feedback_profile_idx on public.feedback (profile_id, created_at) where profile_id is not null;
create index if not exists feedback_ip_idx      on public.feedback (ip_hash, created_at) where ip_hash is not null;

-- -----------------------------------------------------------------------------
-- 2. RLS et droits : aucun accès client
-- -----------------------------------------------------------------------------
alter table public.feedback enable row level security;
revoke all on table public.feedback from public, anon, authenticated;
grant select, delete on table public.feedback to service_role;

-- -----------------------------------------------------------------------------
-- 3. Enregistrement d'un avis (appelée uniquement par /api/feedback, clé secrète)
--    p_account_id : compte de la session vérifiée par le serveur (null = sans compte)
--    Résultat : {status:'ok', id, notify} | {status:'invalid', field} |
--               {status:'rate_limited', scope:'profile'|'ip'|'global'}
-- -----------------------------------------------------------------------------
create or replace function public.submit_feedback(
  p_account_id  uuid,
  p_ip_hash     text,
  p_kind        text,
  p_message     text,
  p_reply_email text,
  p_page        text,
  p_app_version text,
  p_user_agent  text,
  p_locale      text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_msg     text := btrim(coalesce(p_message, ''));
  v_email   text := nullif(lower(btrim(coalesce(p_reply_email, ''))), '');
  v_ip      text := nullif(lower(btrim(coalesce(p_ip_hash, ''))), '');
  v_hour    integer;
  v_day     integer;
  v_global  integer;
  v_id      uuid;
begin
  if p_kind is null or p_kind not in ('idea', 'bug', 'other') then
    return jsonb_build_object('status', 'invalid', 'field', 'kind');
  end if;
  if length(v_msg) < 3 or length(v_msg) > 2000 then
    return jsonb_build_object('status', 'invalid', 'field', 'message');
  end if;
  if v_email is not null and (length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    return jsonb_build_object('status', 'invalid', 'field', 'reply_email');
  end if;
  if v_ip is not null and v_ip !~ '^[0-9a-f]{32,64}$' then
    return jsonb_build_object('status', 'invalid', 'field', 'ip_hash');
  end if;
  if p_locale is not null and p_locale !~ '^[a-z]{2}$' then
    return jsonb_build_object('status', 'invalid', 'field', 'locale');
  end if;

  if p_account_id is not null then
    select id into v_profile from public.profiles where account_id = p_account_id;
  end if;

  -- Un avis à la fois : les compteurs ci-dessous restent justes en cas d'envois simultanés
  perform pg_advisory_xact_lock(hashtext('public.submit_feedback'));

  if v_profile is not null then
    select count(*) filter (where created_at > now() - interval '1 hour'), count(*)
      into v_hour, v_day
      from public.feedback where profile_id = v_profile and created_at > now() - interval '1 day';
    if v_hour >= 5 or v_day >= 20 then
      return jsonb_build_object('status', 'rate_limited', 'scope', 'profile');
    end if;
  end if;
  if v_ip is not null then
    select count(*) filter (where created_at > now() - interval '1 hour'), count(*)
      into v_hour, v_day
      from public.feedback where ip_hash = v_ip and created_at > now() - interval '1 day';
    if v_hour >= 5 or v_day >= 20 then
      return jsonb_build_object('status', 'rate_limited', 'scope', 'ip');
    end if;
  end if;
  select count(*) into v_global from public.feedback where created_at > now() - interval '1 day';
  if v_global >= 300 then
    return jsonb_build_object('status', 'rate_limited', 'scope', 'global');
  end if;

  insert into public.feedback (profile_id, kind, message, reply_email, page, app_version, user_agent, locale, ip_hash)
  values (v_profile, p_kind, v_msg, v_email,
          nullif(left(btrim(coalesce(p_page, '')), 200), ''),
          nullif(left(btrim(coalesce(p_app_version, '')), 40), ''),
          nullif(left(btrim(coalesce(p_user_agent, '')), 80), ''),
          p_locale, v_ip)
  returning id into v_id;

  -- Ménage (pas de pg_cron sur ce projet) : empreintes d'IP après 2 jours, avis après 24 mois
  update public.feedback set ip_hash = null
   where ip_hash is not null and created_at < now() - interval '2 days';
  delete from public.feedback where created_at < now() - interval '24 months';

  return jsonb_build_object('status', 'ok', 'id', v_id,
    'notify', (select count(*) from public.feedback
                where notified_at is not null and notified_at > now() - interval '1 day') < 30);
end;
$$;

-- Email de notification envoyé : date enregistrée (sert aussi au plafond quotidien d'emails)
create or replace function public.feedback_mark_notified(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.feedback set notified_at = now() where id = p_id and notified_at is null;
$$;

revoke all on function public.submit_feedback(uuid, text, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.submit_feedback(uuid, text, text, text, text, text, text, text, text) to service_role;
revoke all on function public.feedback_mark_notified(uuid) from public, anon, authenticated;
grant execute on function public.feedback_mark_notified(uuid) to service_role;

commit;

notify pgrst, 'reload schema';
