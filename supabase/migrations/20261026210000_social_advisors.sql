-- Suivi des conseils Supabase (get_advisors, 26/10) après 20261026120000_social_pseudo_amis.sql.
-- NON APPLIQUÉE : attend l'accord de Pierre. Sans risque, rejouable, ne touche aucune donnée existante.
-- 1) unindexed_foreign_keys : index sur reserved_handles.reserved_for (cascade à la suppression d'un profil).
create index if not exists reserved_handles_reserved_for_idx on public.reserved_handles(reserved_for) where reserved_for is not null;
-- 2) no_primary_key : clé primaire technique sur social_rate (journal des limites de débit, purgé après 2 jours).
alter table public.social_rate add column if not exists id bigint generated always as identity;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.social_rate'::regclass and contype = 'p') then
    alter table public.social_rate add constraint social_rate_pkey primary key (id);
  end if;
end $$;
