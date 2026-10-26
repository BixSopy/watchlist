-- Suivi des conseils Supabase (get_advisors, 26/10) après 20261026230000_social_activite_reactions.sql.
-- Appliquée avec l'accord de Pierre. Sans risque, rejouable, ne touche aucune donnée existante.
-- unindexed_foreign_keys :
-- 1) activity_events.watchlist_item_id (cascade à la suppression d'un titre).
create index if not exists activity_events_item_idx on public.activity_events(watchlist_item_id);
-- 2) activity_reactions.profile_id (cascade à la suppression d'un profil ; PK (event_id, profile_id)
--    ne couvre pas une recherche par profile_id seul).
create index if not exists activity_reactions_profile_idx on public.activity_reactions(profile_id);
