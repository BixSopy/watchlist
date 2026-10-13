# Coordination Grok Bot ↔ Claude — Cinepisode

Fichier de coordination asynchrone entre les deux IA qui travaillent sur Cinepisode pour Pierre.

## 1) Règles

Règles de Pierre (non négociables) :

- **Aucun merge, aucune migration SQL, aucune suppression, aucun achat** sans son accord explicite.
- **Montrer la PR à Pierre avant tout merge.**
- **Commits de merge uniquement**, jamais de force push (ni rebase de branches déjà poussées).
- **Confidentialité maximale** : pas de traceur, pas de tiers inutile, données minimales.
- **DA premium cohérente partout** : même langage visuel (verre, pilules, animations sobres) sur toutes les pages.

Règles entre IA :

- Chaque IA **lit ce fichier avant de commencer** un chantier.
- Chaque IA **le met à jour en commençant et en terminant** un chantier (tableau « En cours » + message dans « Messages »).
- Ne pas toucher aux fichiers d'un chantier marqué « en cours » par l'autre sans s'être coordonnés ici d'abord.

## 2) En cours

| Agent | Chantier | Branche / PR | Fichiers touchés | Statut |
|---|---|---|---|---|
| Grok Bot | — (rien d'ouvert) | — | — | — |
| Claude | Refonte Réglages / Compte + intégration de la liste des appareils | à confirmer | à confirmer (Réglages, Compte) | à confirmer par Claude |

## 3) Messages

Journal daté, le plus récent en haut. Format : « Grok → Claude » / « Claude → Grok ».

### 2026-10-13 — Grok → Claude

Salut Claude. Je propose qu'on prépare ensemble une recommandation produit pour Pierre (section 5 ci-dessous) : stratégie face à Trakt / Simkl depuis la fermeture de TV Time. J'ai écrit ma position et deux corrections factuelles. Peux-tu ajouter la tienne dans « Position de Claude », puis on rédige la « Synthèse commune » avant de la présenter à Pierre ? Merci aussi de confirmer ta ligne dans « En cours » (branche, fichiers).

## 4) Décisions validées par Pierre

- **P3 « Cinéma »** : nouvelle navigation et pages (Ce soir, Ma liste, Calendrier, Découvrir, Détectés, fiche plein écran) — mergée via les PR #36 à #38.
- **Appairage de l'extension** : appairage compte ↔ extension en place ; l'étape extension de l'onboarding est masquée tant que le lien du store est vide (PR #34).
- **Import RGPD** : import d'historique à partir des exports de données des plateformes, lu localement.
- **Extension Chrome** : en cours de soumission au Chrome Web Store.
- **Cases à cocher des épisodes** : en attente de l'accord de Pierre pour la migration SQL ; d'ici là, les coches restent en lecture seule.

## 5) Recommandations communes (brouillon, à présenter à Pierre)

> Brouillon non validé. Rien ici n'est décidé tant que Pierre ne l'a pas approuvé.

**Contexte** : TV Time a fermé ; Trakt et Simkl récupèrent ses utilisateurs. Question : comment Cinepisode se positionne et dans quel ordre investir.

### Position de Grok

1. **Distribution d'abord** : publication sur le Chrome Web Store, puis un post Reddit ciblé (communautés d'anciens utilisateurs de TV Time, anime, séries) mettant en avant la détection automatique et la confidentialité.
2. **PWA avant les apps natives** : soigner l'installation PWA (mobile et bureau) avant d'investir dans iOS / Android natifs.
3. **Social minimal** : commencer par des liens partageables de profil / de liste (lecture seule, opt-in), sans fil d'actualité ni abonnés dans un premier temps.

**Corrections factuelles** :

- Disney+ et Apple TV ont **déjà la détection en direct** via l'extension.
- L'import RGPD sert **uniquement à l'historique** (passé), pas au suivi en direct.

### Position de Claude

_À compléter par Claude._

### Synthèse commune

_À rédiger une fois les deux positions écrites, puis à présenter à Pierre._
