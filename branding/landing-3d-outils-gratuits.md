# Landing 3D : outils, formats et ressources gratuits repérés (nuit du 12/11/2026)

Recherche demandée par Pierre. Les liens sont ceux des pages consultées ; les licences sont à revérifier
sur la page de chaque ressource avant usage. Limite de l'environnement de cette nuit : les domaines
polyhaven.com, nasa.gov et solarsystemscope.com ne sont pas joignables depuis la session (seuls les
registres npm / PyPI le sont). Je n'ai donc **pu télécharger aucune texture ni aucun modèle** : la
nébuleuse de cette version est dessinée par code. À faire côté Pierre : télécharger à la main (voir §2).

## 1. Ce qui est déjà adopté dans cette version (zéro dépendance de plus)

| Choix | Pourquoi |
|---|---|
| Démarrage au niveau le plus léger, montée de niveau seulement si la cadence suit | recommandation commune des guides de performance WebGL ; évite le 30-60 s de chargement |
| Pas de `compileAsync` bloquant au démarrage | un seul gros lot de shaders bloquait tout sur les petits GPU |
| Sonde « GPU logiciel » (SwiftShader, llvmpipe, Basic Render Driver) → lecture normale | un navigateur sans accélération matérielle rendrait la scène à 1-3 i/s |
| Garde-fou à 6 s (moins de 12 images rendues → lecture normale) | jamais d'écran noir qui attend |
| Nébuleuse dessinée une fois en texture ; vignette, grain et flash en CSS | coût GPU quasi nul |
| Brouillard exponentiel pour révéler les appareils à l'arrivée | pas de coupure, pas de chargement anticipé visible |

## 2. Ressources gratuites (CC0 / domaine public) pour passer au niveau supérieur

- **Poly Haven** : HDRI, textures et modèles 3D, tous CC0, usage commercial sans attribution
  ([licence](https://polyhaven.com/license), [catalogue](https://polyhaven.com/all)). Utile : un HDRI « nuit » pour les
  reflets des appareils (à la place de RoomEnvironment), des matières métal brossé / verre. Compresser en KTX2 / WebP avant publication.
- **ambientCG** : textures PBR CC0 (indiqué CC0 par des comparatifs tiers ; vérifier sur le site).
- **Images NASA / ESA / Webb** pour une vraie nébuleuse en fond : conditions de réutilisation **non vérifiées** par ma recherche
  (certaines images sont en domaine public, d'autres sous CC BY). À vérifier image par image avant usage.
- **Modèles d'appareils** : agrégateurs CC0 repérés ([3DValley](https://3dvalley.com/3d-models), [Grab3D](https://grab3d.com/free-gltf-models/),
  [Meshy](https://www.meshy.ai/tags/cc0)). Attention : un modèle qui ressemble à un appareil de marque pose un problème de marque ;
  CC0 ne couvre que les droits du publicant. Préférer la piste Blender (modèles génériques, sans logo).
- **Paquet npm [`@pmndrs/assets`](https://www.npmjs.com/package/@pmndrs/assets)** (« base64 encoded CC0 assets ») : HDRI de Poly Haven déjà empaquetés,
  joignable depuis cette session (registre npm). Piste concrète pour un HDRI sans téléchargement manuel.

## 3. Outils de code

| Outil | Rôle | Licence / statut | Verdict |
|---|---|---|---|
| [`@pmndrs/detect-gpu`](https://github.com/pmndrs/detect-gpu) | classe le GPU (tier 0-3) d'après des benchmarks GFXBench, pour choisir la qualité **avant** de rendre | MIT ; les données de benchmark se chargent depuis unpkg par défaut → à héberger soi-même (CSP `connect-src 'self'`) | **recommandé** à terme ; la mesure réelle des images (déjà en place) reste le juge final |
| [GSAP + ScrollTrigger](https://css-tricks.com/gsap-is-now-completely-free-even-for-commercial-use/) | séquençage et défilement | gratuit, usage commercial inclus depuis avril 2025 ([annonce Webflow](https://webflow.com/updates/gsap-becomes-free)) | utile si on veut une timeline éditable ; le défilement maison actuel suffit |
| [Lenis](https://adamarant.com/en/blog/immersive-web-stack-in-2026-lenis-gsap-and-what-to-skip) | défilement lissé (~3 ko) | libre | optionnel ; notre lissage exponentiel fait déjà ce travail |
| [`postprocessing` (pmndrs)](https://github.com/pmndrs/postprocessing) | fusionne les effets en une seule passe plein écran | libre ; pas de benchmark public face à EffectComposer ([forum](https://discourse.threejs.org/t/pmndrs-post-processing-how-to-get-selective-bloom/58452)) | à tester sur vrai GPU ; la lueur sélective y est plus coûteuse |
| [`gltf-pipeline`](https://www.npmjs.com/package/gltf-pipeline) / gltf-transform + meshopt, KTX2 | compression des modèles et textures (Draco annoncé -80 à -90 %, chiffre non vérifié) | libres | **obligatoires** dès qu'on charge des GLB (budget 8 Mo) |
| Blender + MCP | modèles d'appareils génériques (`screen` à UV 0-1, sans logo) | gratuit | piste de Pierre, inchangée |
| [Theatre.js](https://www.theatrejs.org/) | éditeur de timeline 3D | licence non vérifiée par ma recherche | à examiner si on veut régler les trajectoires à la main |

## 4. Autre approche à garder en tête : précalculer

Si la fluidité temps réel reste imprévisible sur les machines des visiteurs, on peut précalculer les sauts (Blender, rendu hors ligne)
et les faire défiler comme une séquence d'images au scroll : aucune dépendance au GPU du visiteur, qualité de cinéma. Coûts : poids
(séquence de frames, `media-src 'none'` de la CSP interdit la vidéo), temps de rendu CPU (non testé), et perte de l'interactivité
des écrans. Non retenu cette nuit (trop incertain à vérifier sans GPU) ; à reconsidérer si le temps réel ne tient pas.

## 5. Sources
- [WebGL performance on low-end devices: a three.js case study](https://dark-moon.org/blog/webgl-performance-low-end-devices/) : qualité adaptative par paliers, test sur vrais appareils plutôt qu'en émulation.
- [Poly Haven : licence](https://polyhaven.com/license), [detect-gpu](https://github.com/pmndrs/detect-gpu), [GSAP gratuit](https://webflow.com/updates/gsap-becomes-free).
