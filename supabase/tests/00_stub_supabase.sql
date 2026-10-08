-- Imitation minimale de l'environnement Supabase pour tester les migrations en local
-- (Postgres nu, aucun accès au vrai projet). Utilisé par scripts/test-migrations.sh.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role supabase_auth_admin nologin;
create schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create schema auth authorization supabase_auth_admin;
grant usage on schema auth to anon, authenticated, service_role, postgres;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  email_confirmed_at timestamptz,
  created_at timestamptz default now()
);
create table auth.identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade
);
create table auth.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade
);
alter table auth.users owner to supabase_auth_admin;
alter table auth.identities owner to supabase_auth_admin;
alter table auth.sessions owner to supabase_auth_admin;
grant all on auth.users, auth.identities, auth.sessions to postgres;

-- Comme Supabase : les revendications du JWT sont dans request.jwt.claims
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;
grant execute on function auth.jwt(), auth.uid() to anon, authenticated, service_role;

grant usage on schema public to anon, authenticated, service_role;
-- Privilèges par défaut identiques au projet réel (constatés le 08/10/2026)
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
