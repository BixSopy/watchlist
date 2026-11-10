-- =============================================================================================
-- 20261110120000_calendrier_abonnement.sql — Abonnement calendrier (lien .ics /cal/<jeton>)
-- Validé par Pierre le 10/11/2026 (« je valide tout le reste ») ; NE PAS APPLIQUER en production
-- sans son feu vert explicite sur la migration elle-même.
--
-- Principe (même patron que les liens de partage, 20261013150000_partage_lecture_seule.sql) :
--  * Opt-in : aucun flux tant que l'utilisateur ne crée pas son lien, depuis l'onglet Calendrier.
--  * Un lien par profil. Jeton de 128 bits (base64url, 22 caractères), généré côté base.
--    « Nouveau lien » remplace le jeton (l'ancien ne renvoie plus rien) ; « Désactiver » supprime.
--  * Les applis de calendrier (Google, Apple, Outlook) récupèrent le flux sans session : la seule
--    lecture publique est get_calendar_feed(jeton), qui ne renvoie que ce qu'il faut pour les
--    événements (titre, type, date du prochain épisode). Jamais : e-mail, notes, tags, résumé,
--    identifiants internes autres que la clé locale de l'élément (UID stable des événements).
--  * Données : watchlist_items.next_air (date du prochain épisode, déjà calculée et synchronisée
--    par le client, js/14-suivi.js) — aucun appel TMDB côté serveur, rien de nouveau n'est stocké.
--  * last_fetched_at : écrit au plus une fois par heure (affiché « dernière lecture par ton
--    calendrier ») ; ni IP, ni user-agent.
--  * Rejouable (idempotente). search_path vide dans toutes les fonctions : noms qualifiés.
-- =============================================================================================

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.calendar_feeds (
  profile_id      uuid primary key references public.profiles(id) on delete cascade,
  token           text not null unique check (token ~ '^[A-Za-z0-9_-]{22}$'),
  lang            text not null default 'fr' check (lang ~ '^[a-z]{2}$'),
  created_at      timestamptz not null default now(),
  last_fetched_at timestamptz
);

alter table public.calendar_feeds enable row level security;
revoke all on table public.calendar_feeds from anon, authenticated;   -- tout passe par les fonctions

-- ---------- Mon lien (écran Calendrier) ----------
create or replace function public.calendar_feed_get(p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare f public.calendar_feeds;
begin
  if not public._social_owns(p_profile_id) then return jsonb_build_object('status', 'not_authenticated'); end if;
  select * into f from public.calendar_feeds where profile_id = p_profile_id;
  if not found then return jsonb_build_object('status', 'ok', 'feed', null); end if;
  return jsonb_build_object('status', 'ok', 'feed', jsonb_build_object(
    'token', f.token, 'lang', f.lang, 'created_at', f.created_at, 'last_fetched_at', f.last_fetched_at));
end $$;

-- ---------- Créer / remplacer le lien (l'ancien jeton cesse aussitôt de fonctionner) ----------
create or replace function public.calendar_feed_rotate(p_profile_id uuid, p_lang text default 'fr')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_tok text; v_lang text; f public.calendar_feeds;
begin
  if not public._social_owns(p_profile_id) then return jsonb_build_object('status', 'not_authenticated'); end if;
  if exists (select 1 from public.calendar_feeds c where c.profile_id = p_profile_id and c.created_at > now() - interval '10 seconds') then
    return jsonb_build_object('status', 'rate_limited');
  end if;
  v_lang := case when p_lang ~ '^[a-z]{2}$' then p_lang else 'fr' end;
  v_tok := translate(rtrim(encode(extensions.gen_random_bytes(16), 'base64'), '='), '+/', '-_');
  insert into public.calendar_feeds (profile_id, token, lang) values (p_profile_id, v_tok, v_lang)
  on conflict (profile_id) do update set token = excluded.token, lang = excluded.lang, created_at = now(), last_fetched_at = null
  returning * into f;
  return jsonb_build_object('status', 'ok', 'feed', jsonb_build_object(
    'token', f.token, 'lang', f.lang, 'created_at', f.created_at, 'last_fetched_at', f.last_fetched_at));
end $$;

-- ---------- Désactiver ----------
create or replace function public.calendar_feed_revoke(p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public._social_owns(p_profile_id) then return jsonb_build_object('status', 'not_authenticated'); end if;
  delete from public.calendar_feeds where profile_id = p_profile_id;
  return jsonb_build_object('status', 'ok');
end $$;

-- ---------- Lecture publique par jeton (api/calendar.js, clé publique) ----------
-- Inconnu, remplacé ou désactivé : null (même réponse). Prochains épisodes datés à partir de
-- 7 jours en arrière (l'événement reste visible quelques jours), 300 au plus.
create or replace function public.get_calendar_feed(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare f public.calendar_feeds; v_items jsonb;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{22}$' then return null; end if;
  select * into f from public.calendar_feeds where token = p_token;
  if not found then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('uid', w.local_id, 'title', w.title, 'type', w.type, 'date', w.next_air)
           order by w.next_air, w.title), '[]'::jsonb)
    into v_items
    from (select i.local_id, i.title, i.type, i.next_air from public.watchlist_items i
           where i.profile_id = f.profile_id and not coalesce(i.deleted, false)
             and i.type in ('serie', 'anime') and i.status in ('encours', 'avoir', 'todo')
             and i.next_air ~ '^\d{4}-\d{2}-\d{2}$'
             and i.next_air >= to_char(current_date - 7, 'YYYY-MM-DD')
           order by i.next_air limit 300) w;
  if f.last_fetched_at is null or f.last_fetched_at < now() - interval '1 hour' then
    update public.calendar_feeds set last_fetched_at = now() where profile_id = f.profile_id;
  end if;
  return jsonb_build_object('lang', f.lang, 'items', v_items);
end $$;

-- ---------- Droits ----------
revoke all on function public.calendar_feed_get(uuid), public.calendar_feed_rotate(uuid, text), public.calendar_feed_revoke(uuid) from public, anon;
grant execute on function public.calendar_feed_get(uuid), public.calendar_feed_rotate(uuid, text), public.calendar_feed_revoke(uuid) to authenticated;
revoke all on function public.get_calendar_feed(text) from public;
grant execute on function public.get_calendar_feed(text) to anon, authenticated;
