# Plan d'acquisition 30 jours — Cinépisode

> Rattaché à la PR #102 (`chatgpt/acquisition-30j`), qui annonçait ce chantier et précisait :
> « le plan opérationnel sera proposé séparément pour revue ». Ce document est ce plan.
> **Aucune action (publication, dépense, activation d'outil) n'est lancée sans validation de
> Pierre** — ce fichier est une proposition, pas un historique d'actions déjà faites.

## 1) Point de départ (chiffres réels, mesurés le 06/11/2026)

| Mesure | Valeur | Source |
|---|---|---|
| Comptes inscrits | **7** | `auth.users`, Supabase |
| Première inscription | 16/04/2026 | idem |
| Dernière inscription | 24/10/2026 | idem |
| Rythme actuel | ≈ 1 inscription/mois sur 6 mois | calcul |
| Items en liste (tous comptes) | 631 | `watchlist_items` |
| Engagement moyen | ≈ 90 items/compte | calcul — très engagé pour ceux qui restent |
| Amitiés actives | 5 | `friendships` |
| Recommandations envoyées | 5 | `recommendations` |
| Trafic du site (visites, provenance) | **Inconnu** | Vercel Web Analytics n'est pas activé sur le projet — aucune donnée de trafic exploitable aujourd'hui |

**Lecture honnête** : il n'y a pas encore d'acquisition, seulement de l'entourage proche. La base
est trop petite pour qu'un effet réseau (amis, recos, QR) se déclenche — ces fonctions existent
et sont prêtes, mais n'ont rien à amplifier tant qu'il n'y a pas plus d'utilisateurs. L'objectif
de ce plan n'est donc pas une explosion, c'est **sortir de la phase « entourage » en 30 jours**
avec un budget de 0 €.

## 2) Positionnement

| Angle | Pourquoi il marche maintenant |
|---|---|
| **Gratuit, sans pub, sans pistage, hébergé UE** | Différenciant réel face à Trakt (freemium), TV Forecast (payant au-delà de 5 séries), Moviebase (stats VIP) |
| **Alternative à TV Time** | TV Time a fermé/ferme en 2026 — des communautés cherchent activement un remplaçant *maintenant* (vu dans mes recherches : threads "TV Time alternative" très actifs) |
| **Films + séries + anime au même endroit** | Comme Simkl, mais sans le compromis pub/paywall |

Message central court (FR) : **« Suivi de films, séries et anime, gratuit et sans pub, hébergé en
Europe. »** — à décliner selon la plateforme (banque de messages, section 6).

## 3) Cible prioritaire

Francophones qui :
- cherchent activement une alternative suite à la fermeture de TV Time,
- ou râlent sur les paywalls/pubs de Trakt, Moviebase, TV Forecast,
- fréquentent les communautés séries/cinéma/anime FR (forums, Reddit, Discord).

## 4) Canaux (classés par coût = 0 €, effort croissant)

| Canal | Action concrète | Qui l'exécute | Statut |
|---|---|---|---|
| **Annuaires d'alternatives** (AlternativeTo.net, Slant, etc.) | Soumettre Cinépisode comme alternative à Trakt/Letterboxd/TV Time/Simkl — trafic à forte intention, zéro coût, zéro dépendance technique | Pierre (compte à créer sur le site) | Prêt — fiche rédigée en section 6 |
| **Réseau personnel direct** | Inviter l'entourage via le lien/QR déjà existant dans l'app | Pierre | Dispo immédiatement, aucune dépendance |
| **Reddit** (r/france, subs séries/anime FR, threads "TV Time alternative") | Repérer les fils pertinents, répondre avec un message utile (pas un pitch brut) | Pierre (manuel — voir note ci-dessous) | Manuel pour l'instant |
| **X/Twitter** | Idem, sur les fils "TV Time ferme"/alternatives | Pierre (manuel — lien transmis à Claude qui rédige la réponse) | Manuel pour l'instant |
| **Forums FR spécialisés** (forums séries/cinéma, sous-forums Allociné, Betaseries communauté) | Présentation courte dans les fils "logiciel pour suivre mes séries" | Pierre | À tester semaine 2 |

**Note sur Reddit/X** : la veille automatisée est **en pause** (API Reddit bloquée par un bug
captcha côté Reddit, aucun connecteur X disponible — voir échanges précédents). Ce plan part donc
sur une recherche manuelle par Pierre, avec rédaction de la réponse par Claude une fois le lien
transmis. Pas de bot, pas de publication automatique.

## 5) Calendrier (4 semaines)

| Semaine | Objectif | Actions |
|---|---|---|
| **S1** | Préparer le terrain | Soumission AlternativeTo + 2-3 annuaires similaires (fiches prêtes en section 6) ; vérifier que les 7 comptes actuels ont bien testé le lien d'invitation QR |
| **S2** | Premiers contacts communautaires | Pierre identifie 5-10 fils Reddit/forums "TV Time alternative" ou "logiciel suivi séries gratuit" ; Claude rédige une réponse par fil, adaptée au ton et à la limite de caractères |
| **S3** | Mesure et ajustement | Point sur les inscriptions (requête Supabase) ; on garde ce qui convertit, on arrête ce qui ne donne rien après ~10 tentatives |
| **S4** | Consolidation | Relance des canaux qui ont fonctionné ; bilan chiffré à Pierre pour décider de la suite (budget pub ? autre canal ?) |

## 6) Banque de messages (prêts à adapter)

**Version longue (forum/Reddit, pas de limite stricte)** :
> Si tu cherches une alternative à TV Time : Cinépisode fait suivi de films + séries + anime au
> même endroit, gratuit, sans pub, sans pistage, hébergé en Europe. Pas d'abonnement caché derrière
> les stats ou l'export. https://cinepisode.com

**Version courte (X, 280 caractères)** :
> TV Time ferme ? Cinépisode suit tes films/séries/anime, gratuit, sans pub, sans pistage, hébergé
> en Europe. https://cinepisode.com

**Fiche annuaire (AlternativeTo-style)** :
> **Cinépisode** — Suivi de films, séries et anime gratuit, sans publicité, sans pistage, hébergé
> dans l'UE. Alternative à Trakt, TV Time, Letterboxd, Simkl. https://cinepisode.com

Chaque réponse réelle sera ajustée au fil précis (ton, contexte, langue) par Claude au moment où
Pierre transmet le lien — ces versions sont des bases, pas des copier-coller tels quels.

## 7) KPI à suivre chaque semaine

| KPI | Comment le mesurer | Référence actuelle |
|---|---|---|
| Nouvelles inscriptions | Requête `auth.users` (déjà fait pour ce document) | 7 au 06/11 |
| Items ajoutés par nouvel utilisateur (engagement) | Requête `watchlist_items` | ≈ 90/compte en moyenne historique |
| Amitiés/recos créées | `friendships`, `recommendations` | 5 / 5 |
| Trafic et provenance | **Nécessite d'activer Vercel Web Analytics** — décision à prendre par Pierre (vérifier les conditions tarifaires avant d'activer) | Non disponible aujourd'hui |

## 8) Hors périmètre (rappel du cadrage #102)

- Aucun changement de code, aucune nouvelle fonctionnalité.
- Aucune publicité payante, aucun achat.
- Aucune publication automatique : chaque message est posté par Pierre lui-même.
- Pas de chevauchement avec les chantiers landing/logo (Claude) ou vidéo/extension (Grok).

## 9) Décisions à prendre par Pierre

1. Valider ou ajuster le calendrier et les canaux ci-dessus avant toute action.
2. Activer ou non Vercel Web Analytics (impact tarifaire à vérifier avant).
3. Créer les comptes nécessaires sur les annuaires d'alternatives (AlternativeTo, etc.) — Claude
   peut rédiger les fiches, pas créer les comptes à la place de Pierre.
