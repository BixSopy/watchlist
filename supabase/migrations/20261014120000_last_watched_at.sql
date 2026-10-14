-- Sépare "dernière modification technique" (updated_at, sert à la résolution de conflits de
-- synchro) de "dernière fois réellement regardé" (last_watched_at, nullable — null tant qu'aucun
-- visionnage réel n'a encore été enregistré). updated_at continue d'être touché par des actions
-- sans rapport avec le visionnage (rappel, détection de saga, détachement de compte) ; la carte
-- "Reprendre" (js/05-render.js, heroAgo) doit donc lire last_watched_at en priorité et ne plus se
-- fier à updated_at pour l'affichage "Vu il y a...".

begin;

alter table public.watchlist_items
  add column if not exists last_watched_at timestamptz;

commit;
