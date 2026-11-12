# Landing 3D précalculée : scénario détaillé (v0, à relire)

Principe : une scène Blender unique (Studio Display XDR, iPad Pro, téléphone) rendue en **séquences d'images**, jouées au
défilement par la page. Le HTML reste vivant par-dessus : textes, boutons, création de compte, FAQ, et **les écrans des
appareils** (réutilisation de `experience/screens.js`, déjà écrit). Rien n'est rendu avant validation de ce document.

## 1. Direction artistique
- **Fond** : noir d'espace profond, très légère nébuleuse bleu-indigo (jamais de gris laiteux). Étoiles fines, quelques poussières lumineuses.
- **Lumière** : un rim indigo `#5b4fe0` à gauche, un liseré turquoise `#1fb8a3` à droite, une clé blanc froid douce. Reflets nets sur l'alu bleu nuit des appareils, jamais de lueur sur tout l'écran.
- **Voyage** : traînées en dégradé de marque (tête blanche → turquoise → bleu `#2f8fd1` → indigo), courtes et nettes, avec flou de mouvement ; pas de voile blanc.
- **Caméra** : focale 35-50 mm, profondeur de champ réelle sur les affiches du tunnel, léger roulis (≤ 6°) uniquement sur le grand saut.
- **Typo** : Inter (déjà en `/fonts/`), un mot géant en fond par étape (idée Craft Anything), textes d'interface en IBM Plex Mono.
- **Aucun logo** sur les appareils (modèles génériques).

## 2. Découpage de la séquence
Une « pause » = la caméra quasi immobile (dérive très lente), l'écran de l'appareil est vivant (HTML). Un « voyage » = séquence d'images.

| # | Type | Durée | Image/s | Ce qu'on voit | Texte à l'écran |
|---|---|---|---|---|---|
| 0 | Voyage d'ouverture | 2,4 s | 30 | traînées de lumière, le Studio Display apparaît dans la nuit | « Tout ce que tu regardes, enfin au même endroit. » (arrive à la fin) |
| 1 | **Pause 1** | scroll 3,4 écrans | live | Studio Display, vue 3/4 gauche. Écran : lecteur Severance, progression jusqu'à 80 %, « Vu, automatiquement » | « Tu regardes. Il coche. » |
| 2 | Voyage 1→2 | 1,7 s | 30 | caméra recule, monte, contourne l'écran par la gauche, plonge vers l'écran vu de côté | - |
| 3 | **Pause 2 (séquence cuite)** | 3,0 s scrubbables | 30 | l'écran affiche « Détectés ». Des affiches arrivent des profondeurs à vitesse lumière et se rangent dans la liste, une à une | « Ton historique arrive tout seul. » |
| 4 | Voyage 2→3 | 1,7 s | 30 | traînées, l'iPad arrive de la droite, légèrement en contre-plongée | - |
| 5 | **Pause 3** | scroll 5,2 écrans | live | iPad Pro bleu marine, 3 états : filtres Films/Séries/Anime → Reprendre → Mes chiffres | 3 phrases (voir `experience/data.js`) |
| 6 | **Grand saut 3→4** | 3,3 s | 30 | tunnel de 72 affiches sur 4 anneaux qui tournent en sens inverses autour de la caméra, pétales inclinés, flou de profondeur ; les anneaux se resserrent autour du téléphone | - |
| 7 | **Pause 4** | scroll 4,0 écrans | live | téléphone, liste synchronisée puis récap en story ; anneaux d'affiches en orbite lente derrière | « Synchronisé, sur tous tes écrans. » / « Ton récap en story. » |
| 8 | Voyage 4→5 | 1,7 s | 30 | caméra recule, les trois appareils se révèlent ensemble | - |
| 9 | **Pause 5** | scroll 3,4 écrans | live | les trois appareils réunis, caméra légèrement en hauteur | « Commence ta liste ce soir. » + 3 pastilles + bouton compte |
| 10 | Après | - | - | FAQ et pied de page par-dessus la scène | - |

Total d'images à rendre : ouverture 72 + trois voyages normaux 3 × 51 + pause 2 cuite 90 + grand saut 99 + voyage 4→5 51 = **465 images**.

## 3. Comportement au défilement (inchangé par rapport à la v3)
- Dans une pause : la progression anime l'écran de l'appareil (HTML) ; la caméra ne bouge qu'à peine (dérive + parallaxe souris en CSS).
- Entre deux pauses, la **tension** fait avancer les 12 premières images du voyage (la caméra recule, assombrissement) ; passé ~60 % de l'écart, le voyage se joue tout seul, défilement verrouillé. Revenir avant le seuil rejoue les images à l'envers.
- Les voyages se jouent aussi à l'envers (remonter), clavier PageUp/PageDown, ancres 01-05.
- Animations réduites : fondu entre les images de pause, sans voyage.

## 4. Poids et chargement
| Élément | Détail | Poids visé |
|---|---|---|
| Images de voyage | 1280 × 720, AVIF (repli WebP) ≈ 18-25 Ko | ~9 Mo au total |
| Images de pause | 1920 × 1080, écran en « trou » (alpha) pour y glisser le HTML vivant | ~1,5 Mo |
| Ouverture | image de pause 1 + 12 images basse définition d'abord | < 1,5 Mo |
| Chargement | par segment, dans l'ordre du défilement, en arrière-plan ; sans les images de voyage la page reste complète (fondus entre pauses) | - |
Aucune dépendance au GPU du visiteur : la page tourne même en rendu logiciel (le problème de la v2).

## 5. Ce qu'il faut côté Blender (au PC perso)
1. Importer les trois `.glb` (ou `.blend`) : iPad, téléphone, Studio Display. Allègement préalable du Studio Display (122 900 → < 40 000 triangles, perforations en texture).
2. Dépliage UV 0-1 des maillages `Ecran` (absents des fichiers) : je le fais par script.
3. Affiches : 15 images TMDB (les mêmes que `experience/data.js`) téléchargées sur le PC perso (le script les récupère) pour les anneaux et la pause 2.
4. Rendu Cycles GPU, ~128 échantillons + débruitage, motion blur activé sur les voyages.
5. Export : `frames/` + `poses.json` (quatre coins de l'écran de chaque appareil, image par image dans les pauses, pour caler le HTML vivant).

## 6. Risques à connaître
- Les affiches de films sont des œuvres protégées ; les incorporer à des images rendues relève du même usage que sur le site actuel (affichage de TMDB), avec la mention TMDB déjà en pied de page.
- Le calage des écrans vivants sur le rendu demande de bons `poses.json` ; si le résultat est décalé, repli : on cuit aussi l'écran dans l'image (moins vivant).
- Si les ~465 images paraissent lourdes, on réduit la définition ou la durée des voyages.

## 7. À valider (réponds à ce qui te concerne)
1. Durées des voyages (1,7 s normal, 3,3 s grand saut) : bien ?
2. Direction artistique : noir d'espace avec indigo/turquoise, ou plus clair / plus coloré ?
3. Le **mot géant** par étape en fond : oui / non ?
4. L'étape 2 « les affiches arrivent dans la liste » : on la cuit dans l'image (plus beau, moins vivant) ?
5. L'étape 5 : les trois appareils côte à côte, ou un seul au centre ?
6. Références Awwwards qui t'ont plu (pour ajuster le style) ?
