/* Données de la landing 3D : affiches de démonstration (déjà utilisées par la landing actuelle),
   textes de chaque étape (titre grand dans l'espace + phrase fixe), longueurs de défilement. */

/* [titre, chemin TMDB]. Type : f = film, s = série, a = anime (sert aux filtres de la tablette). */
export const POSTERS = [
  ['Stranger Things', '/iGZkjG3BDTuWsWu9Cdmh2jh3q7d.jpg', 's'],
  ['Arcane', '/ypS7R36Vjcn51zZsXsta5onnaCo.jpg', 'a'],
  ['Oppenheimer', '/boAUuJBeID7VNp4L7LNMQs8mfQS.jpg', 'f'],
  ['Wednesday', '/1UzED7WZJgzEIeVz1xiuZ1529nb.jpg', 's'],
  ['Shōgun', '/7O4iVfOMQmdCSxhOg1WnzG1AgYT.jpg', 's'],
  ['Squid Game', '/heV89pC6pv5fz1plikfyQxYuE4L.jpg', 's'],
  ['Frieren', '/j8K7vgF3Kp5T6EwJvez9B4it6CB.jpg', 'a'],
  ['Dune', '/qpyaW4xUPeIiYA5ckg5zAZFHvsb.jpg', 'f'],
  ['Severance', '/xmjW474DJ27bqTYNvS4MvraJgiQ.jpg', 's'],
  ['The Boys', '/4Tw8TB9ikrcgzJgR0LOvgfnXD74.jpg', 's'],
  ['The Bear', '/iaJfffjCqXATU5msr4PAgOWLMl4.jpg', 's'],
  ['The Last of Us', '/4pMd9VAdqm96KA2W4X8yetgc7EF.jpg', 's'],
  ['One Piece', '/dB4EDhre2dsC2kxYDavyKWqLQwi.jpg', 'a'],
  ['Spider-Verse', '/hvfwCeSTgsExmz9l31dKkfR83DH.jpg', 'f'],
  ['Dune : Deuxième partie', '/iRNbRAIGQQr5diGnjpwJFm0dgt4.jpg', 'f'],
];

/* P : longueur de l'étape en hauteurs d'écran (le défilement anime l'écran de l'appareil).
   segs : [début, fin] en part de l'étape. <em> = mots en dégradé de marque. */
export const STEPS = [
  { P: 3.4, segs: [
    { a: 0, b: 0.15, k: 'Cinepisode', title: 'Tout ce que tu regardes, <em>enfin au même endroit.</em>', phrase: 'Films, séries et anime. Gratuit, sans pub, sans pistage.' },
    { a: 0.15, b: 1, k: '01 — Suivi automatique', title: 'Tu regardes. <em>Il coche.</em>', phrase: 'À 80 %, l’épisode est marqué vu. Rien à faire.' },
  ] },
  { P: 3.4, segs: [
    { a: 0, b: 1, k: '02 — Extension', title: 'Ton historique <em>arrive tout seul.</em>', phrase: 'L’extension repère ce que tu regardes sur Netflix, Prime Video, Disney+, Crunchyroll et Apple TV, et te le propose dans « Détectés ».' },
  ] },
  { P: 5.2, segs: [
    { a: 0, b: 0.34, k: '03 — Ta liste', title: 'Films, séries, anime. <em>Une seule liste.</em>', phrase: 'Les vraies affiches, les sagas regroupées, et sur chaque fiche les notes IMDb, Rotten Tomatoes et Metacritic.' },
    { a: 0.34, b: 0.67, k: '03 — Reprendre', title: 'Reprends pile <em>où tu t’es arrêté.</em>', phrase: 'Le bouton Reprendre en un geste, les nouveaux épisodes signalés, la date du prochain épisode.' },
    { a: 0.67, b: 1, k: '03 — Stats et découvertes', title: 'Tes chiffres. <em>Ta prochaine envie.</em>', phrase: 'Ce que tu as vu, en chiffres, et des recommandations tirées de ta liste.' },
  ] },
  { P: 4.0, segs: [
    { a: 0, b: 0.5, k: '04 — Partout', title: 'Synchronisé, <em>sur tous tes écrans.</em>', phrase: 'Ordinateur, tablette, téléphone : la même liste, à jour en un instant.' },
    { a: 0.5, b: 1, k: '04 — Récap et confidentialité', title: 'Ton récap <em>en story.</em>', phrase: 'Tes données restent chez toi.' },
  ] },
  { P: 3.4, segs: [
    { a: 0, b: 1, k: '05 — C’est parti', title: 'Commence ta liste <em>ce soir.</em>', phrase: 'Crée ton compte en quelques secondes avec ton adresse email. Gratuit, sans pub, sans pistage.' },
  ] },
];

/* Les 3 pastilles de configuration (étape 5) */
export const SETUP = [
  ['J’ajoute l’extension', 'Un clic sur le Chrome Web Store, c’est tout.'],
  ['Mon historique arrive tout seul', 'Netflix, Prime Video, Crunchyroll : importés sans rien taper.'],
  ['Je regarde, ça se coche', 'À 80 %, l’épisode est marqué vu. Rien à faire.'],
];

/* Sauts : [de, vers, grand]. Le grand saut (tablette → téléphone) est le tunnel d'affiches. */
export const GRAND = (from, to) => (from === 2 && to === 3) || (from === 3 && to === 2);
