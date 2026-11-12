# Brief : landing 3D « voyage dans l'espace » (inspirée d'igloo.inc)

Version 2 (12/11/2026), remplace le prototype « bobine » rejeté par Pierre. Servie sur `/experience`
(dossier `experience/`). Ne remplace pas la landing actuelle (`index.html`, `landing/`, `js/23-landing.js`).
On reprend le principe d'animation d'igloo.inc (une scène plein écran pilotée au défilement), jamais ses
contenus, formes ni son code.

## 1. Décisions de Pierre

- Version **ordinateur uniquement** pour l'instant (écran < 820 px : lecture normale, sans scène). Le téléphone
  reste un **appareil** de l'étape 4.
- Niveau « supra premium », aucun sacrifice de qualité : on part du maximum et on ne dégrade qu'en dessous de
  ~50 images/s.
- Fond noir d'espace (profondeur, parallaxe) ; on voyage entre les étapes ; les appareils ne sont pas visibles à l'avance.
- Textes : grand titre « dans l'espace » (HTML, décalage de parallaxe par rapport à une ancre 3D), phrase courte
  fixe en bas à gauche, affichés seulement pendant les pauses, masqués dès que la tension monte.
- Pas de son par défaut.

## 2. Les 5 étapes

| # | Appareil | Contenu de l'écran (dessiné par nous) | Texte |
|---|---|---|---|
| 1 | Ordinateur | lecteur Severance, progression jusqu'à 80 % → « Vu, automatiquement » (ouverture : « Tout ce que tu regardes, enfin au même endroit. ») | Tu regardes. Il coche. |
| 2 | Même ordinateur + extension | des affiches arrivent des profondeurs (courbes) et remplissent la liste « Détectés » | Ton historique arrive tout seul. |
| 3 | Tablette | 3 états : filtres Films / Séries / Anime → Reprendre + nouveaux épisodes → mes chiffres + « Pour toi » | Une seule liste / Reprends pile où tu t'es arrêté / Tes chiffres. Ta prochaine envie. |
| 4 | Téléphone (grande étape visuelle) | liste synchronisée puis récap en story ; **4 anneaux de 72 affiches** en orbite lente autour | Synchronisé, sur tous tes écrans / Ton récap en story. |
| 5 | Les trois appareils | 3 pastilles de configuration + vrai lien « Créer mon compte » (HTML) | Commence ta liste ce soir. |

Après l'étape 5 : FAQ (6 questions) et pied de page, en sections classiques qui recouvrent la scène.

## 3. Défilement hybride et sauts

- Défilement natif ; la course = somme des étapes + **un écran d'écart** entre deux étapes. Dans une étape, la
  progression anime l'écran de l'appareil (réversible).
- Dans l'écart, la **tension** monte (assombrissement, recul, champ de vision élargi, traînées) ; passé **~60 %**
  (ou coup de molette rapide) le **saut part seul** : défilement verrouillé, inertie absorbée ~350 ms. Revenir avant
  le seuil détend la scène ; remonter avant le début d'une étape déclenche le saut inverse.
- Clavier : PageDown / Espace = étape suivante, PageUp / Maj+Espace = précédente, Début / Fin ; ancres 01-05 en bas à droite.
- **Saut normal** (~1,05 s) : traînées de lumière dégradé Cinepisode (indigo #5b4fe0 → bleu #2f8fd1 → turquoise #1fb8a3,
  tête blanche), flash à la coupure, décor et appareils changent, la caméra arrive de loin en décélérant.
- **Grand saut** tablette ↔ téléphone (~2,6 s) : tunnel de 72 affiches sur 4 anneaux cylindriques qui tournent en sens
  inverses autour de la caméra, inclinées en pétales, roulis ≤ 6°, flou de profondeur ; à l'arrivée les anneaux se
  resserrent autour du téléphone et gardent une orbite lente.
- **Animations réduites** : mêmes scènes, saut remplacé par un fondu court, ni traînées, ni parallaxe, ni anneaux.

## 4. Socle technique

- **Three.js r170 servi localement** (`experience/three/`), CSP `script-src 'self'` : pas de CDN, pas d'import map,
  aucun script en ligne. Seule requête externe : affiches TMDB (`img-src` déjà autorisé), chargées **au premier
  geste** de défilement ; affiches générées aux couleurs de la marque en attendant.
- Fichiers : `data.js` (étapes, textes, pastilles), `fx.js` (nébuleuse, poussière 3 couches, traînées instanciées,
  affiches instanciées, passe finale), `screens.js` (atlas d'affiches, écrans dessinés en canvas puis plaqués en 3D,
  donc avec lueur et reflets), `app.js` (scène, appareils, défilement hybride, sauts, anneaux, textes, son, qualité).
- Rendu : cible demi-flottante MSAA ×4, lueur (UnrealBloom), passe finale (aberration chromatique, flou radial
  pendant les sauts, vignettage, grain, flash), ton ACES ; densité de pixels native plafonnée à 2.
- Niveaux `max` → `high` → `std`, dégradation seulement si < ~50 i/s soutenus ; `?q=max|high|std` verrouille,
  `?debug` affiche cadence, niveau, étape, tension, appels de rendu.
- Appareils : formes PBR provisoires (RoundedBox + plan d'écran arrondi + reflet de vitre). À remplacer par des GLB
  (Blender) : 3 modèles, maillage `screen` à UV 0-1, sans logo, ~50 k / 30 k triangles. Poids total visé ≤ 8 Mo, ouverture < 1,5 Mo.
- Rendu suspendu quand l'onglet est caché et quand la FAQ recouvre la scène ; repli en lecture normale sans WebGL.

## 5. Étapes restantes

1. Valider la cadence sur de vrais GPU (non mesurable ici : rendu logiciel). Seuil de dégradation à ajuster selon les mesures.
2. Modèles 3D Blender (GLB) à la place des formes provisoires.
3. ~40-60 affiches réelles (le tunnel en répète 15 pour l'instant).
4. Traductions (français seulement ; le site compte 10 langues) et version visiteur mobile.
5. Décision d'intégration à la landing actuelle (chantier coordonné, voir COORDINATION.md).
