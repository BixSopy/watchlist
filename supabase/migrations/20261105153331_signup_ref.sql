-- =============================================================================================
-- 20261105153331_signup_ref.sql — Attribution d'inscription première partie (?r=code)
-- NON APPLIQUÉE — à appliquer après accord de Pierre.
--
-- Objectif : savoir quel lien social (X / Reddit) a amené une inscription, sans cookie ni
-- analytics tiers. Le navigateur garde ?r=<code> dans localStorage ; à l'inscription le code
-- passe dans auth.users.raw_user_meta_data.ref ; au premier INSERT dans public.profiles, un
-- trigger le copie dans profiles.signup_ref. Pas de droit INSERT/UPDATE sur cette colonne pour
-- authenticated : l'utilisateur ne peut pas la forger ni la modifier ensuite.
-- Format : a-z0-9, 2 à 12 caractères (ex. x12, rd7).
-- Rejouable (idempotente). Aucune donnée existante effacée.
-- =============================================================================================

begin;

alter table public.profiles add column if not exists signup_ref text;

alter table public.profiles drop constraint if exists profiles_signup_ref_format;
alter table public.profiles add constraint profiles_signup_ref_format check (
  signup_ref is null or signup_ref ~ '^[a-z0-9]{2,12}$'
);

create index if not exists profiles_signup_ref_idx
  on public.profiles (signup_ref)
  where signup_ref is not null;

-- Copie raw_user_meta_data.ref → signup_ref à la création du profil (SECURITY DEFINER :
-- authenticated n'a pas SELECT sur auth.users). Ne remplace jamais une valeur déjà posée.
create or replace function public.profiles_set_signup_ref()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref text;
begin
  if new.signup_ref is not null then
    return new;
  end if;
  select nullif(lower(trim(both from coalesce(u.raw_user_meta_data ->> 'ref', ''))), '')
    into v_ref
    from auth.users u
   where u.id = new.account_id;
  if v_ref is not null and v_ref ~ '^[a-z0-9]{2,12}$' then
    new.signup_ref := v_ref;
  end if;
  return new;
end;
$$;

revoke all on function public.profiles_set_signup_ref() from public, anon, authenticated;
drop trigger if exists tr_profiles_set_signup_ref on public.profiles;
create trigger tr_profiles_set_signup_ref
  before insert on public.profiles
  for each row execute function public.profiles_set_signup_ref();

-- Empêche toute modification ultérieure de signup_ref (même via service_role / SQL direct
-- hors de ce trigger, on bloque un UPDATE qui changerait la valeur une fois posée).
create or replace function public.profiles_freeze_signup_ref()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.signup_ref is distinct from new.signup_ref then
    if old.signup_ref is not null then
      new.signup_ref := old.signup_ref;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.profiles_freeze_signup_ref() from public, anon, authenticated;
drop trigger if exists tr_profiles_freeze_signup_ref on public.profiles;
create trigger tr_profiles_freeze_signup_ref
  before update on public.profiles
  for each row execute function public.profiles_freeze_signup_ref();

-- Pas de grant insert/update sur signup_ref : seuls les triggers ci-dessus l'écrivent.
-- SELECT table-level déjà accordé à authenticated (nettoyage_et_securite).

commit;

-- Vérifications conseillées (lecture seule, après application) :
--   select signup_ref, count(*) from public.profiles group by 1 order by 2 desc;
--   select column_name from information_schema.columns
--     where table_schema='public' and table_name='profiles' and column_name='signup_ref';
