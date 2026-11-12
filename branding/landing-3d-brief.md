# Brief : porter la landing page de Cinepisode au niveau d'igloo.inc

Version adaptée à Cinepisode du brief générique (10/11/2026). Le prototype qui l'applique est servi sur
`/experience` (dossier `experience/`). Il ne remplace pas encore la landing actuelle (`index.html`, `landing/`,
`js/23-landing.js`).

## 1. Objectif

Atteindre le niveau d'exécution de https://www.igloo.inc/ : une scène 3D plein écran qui se transforme au fil
du défilement. L'univers reste celui de Cinepisode : films, séries, anime, et surtout **les épisodes**. On
reprend le principe d'animation, jamais les contenus, les formes ni le code de la référence.

## 2. Moodboard retenu

| Élément | Choix pour Cinepisode |
|---|---|
| Fond | noir bleuté de salle obscure `#0a0e16`, brume `#0c111b` qui fond l'horizon |
| Lumière | faisceau de projecteur blanc chaud `#f3e6cf` ; lueur intérieure ambrée `#ffc78a` |
| Accent unique | bleu de la marque `#2f8fd1`, réservé à l'épisode « en cours » |
| Textes d'interface | IBM Plex Mono 11-12 px, blanc cassé `rgba(236,231,222,.72)`, épinglés aux 4 coins |
| Mot-marque | « cinepisode », Inter 800, blanc |
| Objet héros | **une bobine de film** faite de blocs arrondis givrés (flasques, moyeu, rayons), un tambour de pellicule sombre, et une pellicule qui se déroule jusqu'au sol, dont chaque image est un épisode (S01 · E01…) |
| Vocabulaire technique | quadrillage au sol en fil de fer, cubes filaires numérotés, polyligne reliant des blocs de la bobine avec leurs numéros |
| Atmosphère | poussière qui flotte dans le faisceau (équivalent de la neige), parallaxe caméra à la souris |
| Son | ronronnement de projecteur et cliquetis synthétisés en Web Audio, coupés par défaut |

## 3. Chorégraphie au défilement

Le défilement pilote l'animation, il ne la déclenche pas : la scène est une fonction de la progression lissée
(interpolation exponentielle), elle rejoue à l'envers quand on remonte. La toile reste fixe ; la course fait
7 hauteurs d'écran.

| Chapitre | Course | Scène | Texte |
|---|---|---|---|
| 00 Accueil | 0-12 % | bobine assemblée, rotation lente, caméra qui orbite | manifeste en haut à droite, « Fais défiler pour découvrir » |
| 01 Éparpillé | 12-36 % | les blocs se détachent (trajectoire et rotation propres à chacun), caméra en hauteur, quadrillage visible | « Tes épisodes sont partout. » (historique éparpillé entre les plateformes) |
| 02 Remis en ordre | 36-58 % | réassemblage et travelling avant | « Chaque épisode reprend sa place. » |
| 03 Ta salle | 58-80 % | la caméra entre ; les blocs forment une salle-dôme, la pellicule devient un bandeau d'écrans autour du spectateur | « Une salle à ton nom. » |
| 04 Générique | 80-100 % | sortie, la bobine se recompose, les sections classiques recouvrent la scène | « Reprends ta liste là où tu l'as laissée. » |

Courbes power3 in-out ; textes en fondu + 18 px de déplacement vertical ; compteur `00 / 04` et barre de
progression en bas à droite.

## 4. Socle technique (choix faits pour ce site)

- **Three.js r170 servi localement** (`experience/three/`) : la CSP du site n'autorise que les scripts de
  l'origine (`script-src 'self'`). Pas de CDN, pas d'import map (script en ligne interdit par la CSP) : les addons
  importent le module par chemin relatif.
- Pas de GSAP ni de Lenis : progression et lissage maison (≈ 30 lignes), moins de poids et aucune dépendance.
- Lueur : UnrealBloomPass sur ordinateur, seuil élevé pour ne faire briller que les parties émissives ; aucun
  post-traitement sur mobile.
- Géométrie procédurale (RoundedBoxGeometry) et textures dessinées en canvas : aucun modèle GLB ni image à
  télécharger.
- Mobile : moins de blocs (68 au lieu de 100), pas de lueur, densité de pixels plafonnée à 1,5, cadrage portrait
  recalculé.
- Chargement : la scène apparaît d'abord en fil de fer, puis les blocs se matérialisent un par un ; le
  pourcentage suit les vraies étapes (modules, polices, compilation des shaders, première image).
- `prefers-reduced-motion` : scène fixe, textes en lecture normale. Sans WebGL : textes seuls.
- Textes réels dans le HTML (titre h1, sections h2) pour le référencement et les lecteurs d'écran.
- Rendu suspendu quand l'onglet est caché et quand les sections finales recouvrent la scène.

## 5. Étapes restantes

1. Validation du rendu sur un vrai GPU (ordinateur, tablette, téléphone) : cadence mesurée, temps de chargement.
2. Traductions (le prototype est en français seulement ; le site compte 10 langues).
3. Intégration à la landing actuelle sans supprimer de contenu existant : à décider avec Pierre, puisque la
   landing est un chantier coordonné (voir COORDINATION.md).
