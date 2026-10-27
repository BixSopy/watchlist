-- =============================================================================================
-- 20261027200000_mfa_recovery_codes.sql — Codes de secours pour la double authentification (TOTP)
-- NON APPLIQUÉE. À relire et valider par Pierre avant toute application.
--
-- Contexte : Supabase Auth gère nativement l'enrôlement/vérification TOTP (auth.mfa.*, gratuit,
-- déjà actif sur le projet) — rien à faire côté base pour ça. Mais Supabase ne fournit pas de
-- codes de secours : si l'utilisateur perd son appareil (plus d'appli d'authentification), il
-- est bloqué. Cette migration ajoute UNIQUEMENT le stockage des codes de secours (empreinte
-- SHA-256 côté client, jamais le code en clair ici) ; elle ne touche à AUCUNE table du schéma
-- `auth` (pas de suppression de facteur ici — ça reste `supabase.auth.mfa.unenroll()`, qui exige
-- déjà un niveau d'assurance aal2, obtenu en vérifiant un nouveau facteur après un code de
-- secours valide ; voir js/37-mfa.js pour le détail du flux).
--
-- Principe :
--  * Une ligne par code de secours (10 générés à l'activation, à usage unique).
--  * Le code n'est JAMAIS vu par le serveur : le navigateur calcule son empreinte SHA-256
--    (Web Crypto, `crypto.subtle.digest`) avant tout envoi ; seule l'empreinte est stockée.
--  * Consommer un code le marque utilisé mais NE supprime PAS les autres : si l'utilisateur est
--    interrompu avant d'avoir reconfiguré un nouvel appareil, il peut retenter avec un autre code
--    à sa prochaine connexion plutôt que de se retrouver bloqué.
--  * Regénérer un lot (après reconfiguration, ou depuis les réglages) supprime tout l'ancien lot.
--  * Table fermée à double tour : RLS activée ET forcée, aucune policy, aucun droit direct
--    accordé à `authenticated`/`anon` — tout passe par les fonctions SECURITY DEFINER ci-dessous,
--    elles-mêmes strictement scopées à auth.uid().
--  * Rejouable (idempotente). Aucune donnée supprimée par cette migration elle-même.
-- =============================================================================================

create table if not exists public.mfa_recovery_codes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  code_hash  bytea not null,                    -- sha256(code), calculé dans le navigateur
  used_at    timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, code_hash)
);

create index if not exists mfa_recovery_codes_user_idx on public.mfa_recovery_codes(user_id);

alter table public.mfa_recovery_codes enable row level security;
alter table public.mfa_recovery_codes force row level security;

-- Aucune policy : table fermée par défaut (y compris pour son propriétaire). Tout passe par les
-- fonctions ci-dessous.
revoke all on table public.mfa_recovery_codes from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 1. Régénère le lot de codes de secours de l'utilisateur connecté (remplace l'ancien lot).
--    p_hashes : exactement 10 empreintes SHA-256 en hexadécimal (64 caractères), calculées côté
--    client. Le code en clair n'existe jamais ici.
-- ---------------------------------------------------------------------------------------------
create or replace function public.mfa_recovery_store(p_hashes text[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_h text;
begin
  if v_uid is null then return jsonb_build_object('status', 'not_authenticated'); end if;
  if p_hashes is null or array_length(p_hashes, 1) is distinct from 10 then
    return jsonb_build_object('status', 'invalid_input');
  end if;
  foreach v_h in array p_hashes loop
    if v_h !~ '^[0-9a-f]{64}$' then return jsonb_build_object('status', 'invalid_input'); end if;
  end loop;

  delete from public.mfa_recovery_codes where user_id = v_uid;
  insert into public.mfa_recovery_codes(user_id, code_hash)
    select v_uid, decode(h, 'hex') from unnest(p_hashes) as h;

  return jsonb_build_object('status', 'ok', 'count', 10);
end;
$$;
revoke all on function public.mfa_recovery_store(text[]) from public, anon;
grant execute on function public.mfa_recovery_store(text[]) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. Consomme un code de secours (empreinte hex) pour l'utilisateur connecté. Ne supprime que le
--    code utilisé — les autres restent valides tant qu'un nouveau lot n'est pas régénéré.
-- ---------------------------------------------------------------------------------------------
create or replace function public.mfa_recovery_consume_check(p_hash text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then return jsonb_build_object('status', 'not_authenticated'); end if;
  if p_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('status', 'invalid_input'); end if;

  update public.mfa_recovery_codes
     set used_at = now()
   where user_id = v_uid and code_hash = decode(p_hash, 'hex') and used_at is null
  returning id into v_id;

  if v_id is null then return jsonb_build_object('status', 'invalid_or_used'); end if;
  return jsonb_build_object('status', 'ok');
end;
$$;
revoke all on function public.mfa_recovery_consume_check(text) from public, anon;
grant execute on function public.mfa_recovery_consume_check(text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. Nombre de codes de secours encore valides (affichage réglages, relance de régénération).
-- ---------------------------------------------------------------------------------------------
create or replace function public.mfa_recovery_count()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('status', 'ok', 'count',
    (select count(*) from public.mfa_recovery_codes where user_id = auth.uid() and used_at is null))
$$;
revoke all on function public.mfa_recovery_count() from public, anon;
grant execute on function public.mfa_recovery_count() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. Vide le lot (double authentification désactivée : plus aucun code n'a de sens).
-- ---------------------------------------------------------------------------------------------
create or replace function public.mfa_recovery_clear()
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  delete from public.mfa_recovery_codes where user_id = auth.uid();
  select jsonb_build_object('status', 'ok');
$$;
revoke all on function public.mfa_recovery_clear() from public, anon;
grant execute on function public.mfa_recovery_clear() to authenticated;
