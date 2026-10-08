# Cinepisode

Suivi perso pour films, séries, anime avec aesthetic OLED dark inspiré de Plex.
Service gratuit, sans publicité, ouvert à tous : https://cinepisode.com (l'ancienne adresse
https://watchlist-omega-three.vercel.app continue de fonctionner).

> Le dépôt garde son nom `watchlist` ; le nom public, le domaine, les couleurs et le logo se
> règlent dans **un seul fichier** : [`brand.config.json`](brand.config.json) (voir
> [Marque](#-marque-nom-domaine-couleurs-logo)).

## ✨ Features

- 🎬 Recherche TMDB (films, séries, anime)
- ⭐ Notation 1-5 étoiles + notes perso
- 🏷️ Filtres statut + genre + tri
- 👤 Comptes gratuits : inscription, confirmation par email (lien ou code), mot de passe oublié, export RGPD, suppression de compte
- 💾 Stockage local (IndexedDB + localStorage) + synchronisation Supabase multi-appareils
- 📊 Stats footer en temps réel
- 🔄 Export / Import JSON (merge sans doublon)
- 🎞️ Discovery rows — 30 résultats, cards dynamiques
- ⚡ Progressive loading — 15 items + "Charger plus"
- 🔢 Recommandations numérotées
- 🌙 Dark mode OLED (`#0a0a0c`)
- 🔍 Search modal avec 3 filtres (type, tri, année)
- 🎯 Notation bloquée sur statut "À voir"

## 🛠 Tech Stack

- Frontend : HTML5 + CSS3 + Vanilla JS (zero framework), modules `js/00-*.js` … `js/20-*.js`
- Storage  : IndexedDB (liste) + localStorage (préférences) + Supabase (synchro, comptes)
- API      : TMDB v3 + OMDb via fonctions serverless Vercel (`/api`, clés côté serveur)
- Hosting  : Vercel Hobby (statique + fonctions `/api`, région `fra1`) + Supabase Free (Francfort)
- Emails   : Supabase Auth via SMTP Resend (domaine vérifié), gabarits dans `supabase/templates/`
- Anti-robot : Cloudflare Turnstile, via la protection CAPTCHA intégrée à Supabase Auth

## 🔒 Confidentialité et sécurité

- Pages [Confidentialité](confidentialite.html) et [Conditions & mentions légales](conditions.html)
  (générées depuis `branding/legal/`), attribution TMDB dans le pied de page.
- Aucune police ni script tiers sur l'app : supabase-js est embarqué dans `vendor/` (version
  figée, SRI), les polices sont dans `fonts/`. Seule exception : le script Turnstile
  (`challenges.cloudflare.com`), chargé uniquement à l'ouverture d'un formulaire de compte
  et seulement si `TURNSTILE_SITE_KEY` est définie.
- En-têtes dans `vercel.json` : CSP stricte (Turnstile seul autorisé en `script-src` /
  `frame-src`), `Referrer-Policy: strict-origin` (Turnstile a besoin de l'origine),
  `Permissions-Policy`, `frame-ancestors 'none'`, HSTS.
- Indexation (`brand.config.json › indexable: true`) : l'accueil et les pages légales sont
  indexables **uniquement sur `cinepisode.com`** (meta robots `index`, `canonical`,
  `robots.txt`, `sitemap.xml`) ; `X-Robots-Tag: noindex` reste envoyé sur tout autre hôte
  (previews, `*.vercel.app`) et sur `/api/`.
- `.vercelignore` (liste blanche) : seuls `index.html`, les deux pages légales, `robots.txt`,
  `sitemap.xml`, `js/`, `api/`,
  `vendor/`, `fonts/`, `icons/`, `manifest.json`, `sw.js` et `vercel.json` sont publiés.
- Proxy `/api` : session Supabase obligatoire **et email confirmé**, liste blanche de chemins
  et paramètres, quotas quotidiens par compte (`consume_api_quota`, voir la migration
  `20261008100000`), cache OMDb partagé pour tenir dans les 1 000 requêtes/jour de la clé.
- Suppression de compte en libre-service (`delete_my_account()`, SECURITY DEFINER limitée à
  `auth.uid()`, exige une connexion de moins de 15 min) : aucune clé secrète côté client.

## 💻 Usage local

```bash
npx vercel dev                      # sert l'app et les fonctions /api (variables dans .env.local, non versionné)
node --test tests/                  # tests unitaires : /api (fetch simulé), comptes, marque, migrations SQL*
cd e2e && npm install && npm test   # parcours de compte dans un vrai Chrome (Supabase simulé, CSP de prod)
bash scripts/test-migrations.sh     # migrations rejouées sur un Postgres local jetable
scripts/email-previews.sh           # aperçus PNG des emails (Go + Chrome), dans ./email-previews/
```

\* le test SQL est ignoré si Postgres n'est pas installé. `e2e/` utilise le Chrome du système
(`CHROME_PATH` pour un autre navigateur ; `SCREENSHOTS=dossier` pour des captures).

## 📝 Utilisation

1. **Ajouter** → 🔍 Recherche TMDB → sélection → `Ajouter X sélectionné(s)`
2. **Éditer** → ✏️ Statut / Note (1-5★) / Notes texte
3. **Filtrer** → Barre statut + Genre + Recherche locale
4. **Discovery** → Rows thématiques avec scroll horizontal
5. **Exporter** → ⬇ JSON téléchargé (backup local)
6. **Importer** → ⬆ Upload JSON (merge automatique, sans doublon)

## 📅 Versions

- **v1.0** — Features core Session 6 : progressive loading, discovery rows, search modal 3 filtres, animations premium, notation locked
- **v1.1** — Deploy Vercel + export/import + stats footer (Session 7)
- **v1.2** — Mobile responsive (Session 8, post-hosting)

## 🚀 Roadmap

- [ ] Version mobile responsive
- [ ] Dossiers / Sagas (groupement collections)
- [ ] Stats dashboard (graphiques par genre, année, note)
- [ ] Service Worker (PWA offline)
- [ ] Letterboxd sync

## 🎨 Marque (nom, domaine, couleurs, logo)

Tout ce qui identifie l'app est dans [`brand.config.json`](brand.config.json) : nom
(`name`, `shortName`, `wordmark`), slogan, domaine de production (`baseUrl`), adresses
(`contactEmail`, `senderEmail`, `senderName`), couleurs, chemins du logo et des icônes,
polices, indexation (`indexable`), redirections de domaine (`domains`).

Pour renommer l'app, changer de domaine, de couleurs ou de logo :

1. Modifier `brand.config.json` (et, pour un nouveau logo, remplacer `branding/logo-mark.svg`
   et les PNG de `icons/` aux chemins indiqués dans `logo`).
2. Lancer `node scripts/build-brand.mjs`. Il régénère `js/00-brand.js`, `manifest.json`, les
   blocs `<!--brand:…-->` / `/*brand:css*/` d'`index.html` (titre, balises Open Graph, couleurs
   CSS, logo, pied de page), `confidentialite.html`, `conditions.html`, `vercel.json`
   (`X-Robots-Tag` par hôte, redirections), `robots.txt`, `sitemap.xml` et les gabarits
   d'emails `supabase/templates/*.html` +
   `subjects.json`.
3. Recoller les gabarits et sujets dans Supabase (voir ci-dessous) et `scripts/email-previews.sh`
   pour vérifier le rendu.

Les textes sources sont dans `branding/` (emails : `branding/emails/`, pages légales :
`branding/legal/`) avec des marqueurs `[[name]]`, `[[contactEmail]]`… ; ne jamais modifier les
fichiers générés à la main : `node --test tests/` échoue s'ils ne sont plus à jour
(`node scripts/build-brand.mjs --check`). Aucun domaine n'est codé en dur dans le code de
l'app : elle fonctionne sur n'importe quel domaine (chemins relatifs, liens d'emails basés sur
l'adresse depuis laquelle la demande a été faite).

## ⚙️ Configuration

Aucune clé TMDB ni OMDb n'est présente côté client. Les appels passent par des fonctions
serverless Vercel (`api/tmdb.js`, `api/omdb.js`, `api/config.js`) qui :

- exigent une session Supabase valide (`Authorization: Bearer <access_token>`, vérifiée auprès
  de `/auth/v1/user`) d'un compte à l'email confirmé ;
- n'acceptent qu'une liste blanche de chemins et de paramètres (pas de proxy ouvert) ;
- appliquent un quota quotidien par compte (TMDB 4 000/jour, OMDb 150/jour par compte et
  900/jour au total ; modifiables dans la table `api_quota_limits`) ;
- ne mettent jamais les erreurs en cache. Il n'y a **pas** de liste d'origines autorisées :
  rien à changer dans `/api` lors d'un changement de domaine.

Variables d'environnement Vercel (Production **et** Preview) :

| Variable | Obligatoire | Rôle |
|---|---|---|
| `TMDB_API_KEY` | oui | Clé TMDB v3 (ou jeton de lecture v4) |
| `OMDB_API_KEY` | oui | Clé OMDb (offre gratuite : 1 000 requêtes/jour) |
| `SUPABASE_ANON_KEY` | oui | Clé publique (anon/publishable) du projet, pour vérifier les sessions et appeler `consume_api_quota` |
| `SUPABASE_URL` | non | URL du projet Supabase (valeur par défaut : celle de l'app) |
| `SUPABASE_SECRET_KEY` | recommandé | Clé secrète (`sb_secret_…`, ou ancienne `service_role`) : **uniquement** pour le cache OMDb partagé (`api_cache`). Sans elle, cache en mémoire par instance seulement |
| `TURNSTILE_SITE_KEY` | recommandé | Clé de site Cloudflare Turnstile (publique). Vide = pas de CAPTCHA affiché |
| `SIGNUPS_OPEN` | non | `0` masque l'onglet « Créer un compte » (les inscriptions se ferment vraiment dans Supabase) |
| `ALLOWED_EMAILS` | non | **À vider pour l'ouverture publique.** Si renseignée, seuls ces emails accèdent au catalogue |
| `GITHUB_TOKEN` | non | Pour `api/releases.js` (mises à jour de l'app de bureau) |

## 🌍 Mise en ligne publique (à faire à la main, dans cet ordre)

Projet Supabase `batfulcvvquffgfeppcx`, projet Vercel `prj_FnDTFQQIs17MYUdwon10sPbndXQu`.

**1. Base de données** (avant ou après le déploiement, l'ancienne version est compatible)
- SQL Editor : exécuter `supabase/migrations/20261008100000_ouverture_publique.sql` en une fois.
- Facultatif : `supabase migration repair --status applied 20260925151457` (cette migration est
  déjà appliquée en base mais absente de l'historique) puis `... applied 20261008100000`.
- Advisors › Security : relancer, aucune alerte attendue sur les nouvelles fonctions.

**2. Cloudflare Turnstile** (gratuit) : créer un widget « Managed », hostnames
`cinepisode.com`, `www.cinepisode.com`, `watchlist-omega-three.vercel.app`. Noter la clé de site
et la clé secrète.

**3. Vercel › Settings › Environment Variables** : vider/supprimer `ALLOWED_EMAILS` ; ajouter
`TURNSTILE_SITE_KEY` (clé de site) et `SUPABASE_SECRET_KEY` (Supabase › Settings › API Keys ›
Secret keys) ; garder les autres. Redéployer.

**4. Supabase › Authentication** (après le déploiement de cette version)
- *Sign In / Providers › Email* : « Allow new users to sign up » **activé**, « Confirm email »
  activé, « Secure email change » activé, « Secure password change » activé, longueur minimale
  **12**, exigence « lettres minuscules, majuscules et chiffres » (ou plus), « Email OTP
  Expiration » 3600 s, longueur du code 6. « Allow anonymous sign-ins » désactivé.
  (« Prevent use of leaked passwords » n'existe que sur l'offre Pro : l'app refuse déjà les mots
  de passe trop courts ou trop courants.)
- *Attack Protection* : « Enable Captcha protection », fournisseur **Turnstile**, coller la
  **clé secrète** Turnstile. ⚠️ Seulement une fois `TURNSTILE_SITE_KEY` déployée, sinon plus
  personne ne peut se connecter.
- *URL Configuration* : Site URL = `https://cinepisode.com` ; Redirect URLs :
  `https://cinepisode.com/**`, `https://www.cinepisode.com/**`,
  `https://watchlist-omega-three.vercel.app/**` et, pour tester les previews,
  `https://*-pierre-unbekand-s-projects.vercel.app/**`.
- *Emails › SMTP Settings* : SMTP personnalisé **obligatoire** (le SMTP intégré n'envoie
  qu'aux membres de l'équipe Supabase, ~2 emails/heure). Resend exige un domaine vérifié qu'on
  possède (impossible avec `vercel.app`) : voir « Domaine cinepisode.com » plus bas.
  Ensuite *Rate Limits* : « emails envoyés » à 30/h ou plus.
- *Emails › Templates* : pour chaque modèle, coller le contenu de `supabase/templates/<fichier>.html`
  et le sujet indiqué dans `supabase/templates/subjects.json` :
  Confirm sign up = `confirmation`, Invite user = `invite`, Magic link = `magic_link`,
  Change email address = `email_change`, Reset password = `recovery`,
  Reauthentication = `reauthentication`. Dans *Security notifications* (si disponible),
  activer « Password changed » (`password_changed_notification`) et « Email address changed »
  (`email_changed_notification`).

**5. Vérifier** : créer un compte avec une adresse perso, recevoir l'email, cliquer, chercher un
titre, supprimer le compte.

## 🛒 Domaine cinepisode.com (checklist)

1. ✅ **Fait (08/10/2026)** — Vercel › projet `prj_FnDTFQQIs17MYUdwon10sPbndXQu` › Domains :
   `cinepisode.com` sert l'app, `www.cinepisode.com` redirige vers l'apex (307 ; « 308
   permanent » est préférable pour le référencement, réglable dans Domains ›
   www.cinepisode.com › Edit). Vérifier que le certificat HTTPS de `www` est bien émis.
   `watchlist-omega-three.vercel.app` reste attaché (app de bureau, anciens favoris).
2. **Supabase › Authentication › URL Configuration** : Site URL = `https://cinepisode.com` ;
   Redirect URLs : ajouter `https://cinepisode.com/**` et `https://www.cinepisode.com/**`
   (garder `https://watchlist-omega-three.vercel.app/**` et celle des previews).
3. **Resend** (offre gratuite : 3 000 emails/mois, 100/jour) : Domains › Add domain
   `cinepisode.com` ; recopier **exactement** les enregistrements affichés dans
   **Vercel › Domains › cinepisode.com › DNS Records** (en général : MX + TXT SPF sur
   `send.cinepisode.com`, TXT DKIM sur `resend._domainkey.cinepisode.com` ; parfois des
   CNAME pour les domaines récents). Ajouter aussi un DMARC : TXT `_dmarc` =
   `v=DMARC1; p=none; rua=mailto:contact@cinepisode.com` (passer à `p=quarantine` après
   quelques semaines sans souci). Cliquer « Verify ». Créer une clé API « Sending access »
   limitée à ce domaine.
4. **Supabase › Authentication › Emails › SMTP Settings** : activer ; Sender email
   `noreply@cinepisode.com`, Sender name `Cinepisode`, Host `smtp.resend.com`, Port `465`,
   Username `resend`, Password = la clé API Resend. Enregistrer, puis *Rate Limits* ›
   emails : 30/h (ou plus). Tester « Mot de passe oublié » sur son propre compte.
5. **Transfert de contact@** (gratuit, ex. ImprovMX) : créer le domaine `cinepisode.com` chez
   ImprovMX avec l'alias `contact` → `pierreunbekand67@gmail.com`, puis dans Vercel DNS :
   MX `@` `mx1.improvmx.com` (priorité 10), MX `@` `mx2.improvmx.com` (priorité 20), TXT `@`
   `v=spf1 include:spf.improvmx.com ~all`. Ces MX sont sur la racine et ceux de Resend sur
   `send.` : pas de conflit. Un seul enregistrement SPF par nom (fusionner si un autre
   service en ajoute un sur `@`).
6. **Cloudflare Turnstile** : vérifier que `cinepisode.com` et `www.cinepisode.com` figurent
   dans les hostnames du widget.
7. **Proxy `/api`** : rien à faire (pas de liste d'origines ; la CSP utilise `'self'`).
   **Référencement** (facultatif) : Google Search Console › ajouter `cinepisode.com`
   (vérification par enregistrement TXT dans Vercel DNS) et soumettre
   `https://cinepisode.com/sitemap.xml`.
8. **Facultatif, plus tard** : rediriger l'ancien domaine vers le nouveau en passant
   `domains.redirects` à `true` dans `brand.config.json` puis `node scripts/build-brand.mjs`
   (ajoute dans `vercel.json` `watchlist-omega-three.vercel.app` → cinepisode.com, sauf
   `/api/` pour l'app de bureau ; www est déjà redirigé par Vercel). ⚠️ Les listes enregistrées seulement
   sur l'appareil (sans compte) restent attachées à l'ancien domaine : prévenir les
   utilisateurs de se connecter (synchro) ou d'exporter avant d'activer la redirection.
   L'app de bureau (`desktop/src-tauri/tauri.conf.json`) pointe toujours sur l'ancienne
   adresse ; la changer demande une nouvelle version de l'app de bureau.
