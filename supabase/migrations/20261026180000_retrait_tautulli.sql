-- Retrait du suivi Plex/Tautulli : trop complexe à configurer côté utilisateur (plusieurs
-- agents webhook, gabarits JSON à coller à la main) et peu fiable (le format du gabarit casse
-- silencieusement selon la version de Tautulli). mark_watched_by_title() — utilisée par
-- l'extension navigateur, le vrai mécanisme de suivi auto du produit — n'est pas touchée.
-- Le jeton (profiles.plex_webhook_token) reste en place : il authentifie aussi l'extension.

drop function if exists public.mark_watched_by_token(text, integer, integer, integer);
