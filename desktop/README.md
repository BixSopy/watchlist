# Watchlist — app de bureau (Windows)

Coquille Tauri minimale : la fenêtre affiche directement `https://watchlist-omega-three.vercel.app`
(aucun code web dupliqué ici — tout changement déployé sur Vercel apparaît instantanément dans
l'app, sans rebuild). Seule la coquille native (icône, fenêtre, mise à jour automatique) vit dans
ce dossier.

## Mise en place (une seule fois)

Deux secrets à ajouter manuellement — je ne peux pas les créer à ta place :

### 1. Secret GitHub Actions (build + signature des releases)

Repo `BixSopy/watchlist` → **Settings → Secrets and variables → Actions → New repository secret**

| Nom | Valeur |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Clé privée générée pour ce projet (fournie séparément — ne jamais la committer) |

(Pas besoin de `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` : la clé n'a pas de mot de passe.)

### 2. Variable d'environnement Vercel (distribution publique des releases)

Le dépôt est privé, donc les assets d'une Release GitHub ne sont pas téléchargeables sans
authentification — `/api/releases` (voir `api/releases.js` à la racine) les republie publiquement
en s'authentifiant côté serveur. Il faut un token GitHub en lecture seule :

1. https://github.com/settings/personal-access-tokens/new → **Fine-grained token**
2. Resource owner : `BixSopy`, Repository access : **Only select repositories → watchlist**
3. Permissions → Repository permissions → **Contents : Read-only** (rien d'autre)
4. Générer, puis dans Vercel (projet `watchlist`) → Settings → Environment Variables :
   `GITHUB_TOKEN` = le token généré (target: Production + Preview)
5. Redéployer pour que la variable prenne effet.

## Cuire une release

```bash
git tag desktop-v1.0.0
git push origin desktop-v1.0.0
```

Le workflow `.github/workflows/desktop-release.yml` compile l'installateur Windows (MSI + NSIS),
le signe, crée la Release GitHub (`desktop-v1.0.0`) et y attache `latest.json`. Les utilisateurs
téléchargent l'installateur une fois ; ensuite l'app se met à jour toute seule au démarrage
(vérifie `/api/releases?f=manifest`, télécharge et s'installe si une version plus récente existe).

Pour une nouvelle version : remonter `version` dans `src-tauri/tauri.conf.json` ET dans
`src-tauri/Cargo.toml`, committer, puis retaguer (`desktop-v1.0.1`, etc.).

## Limites actuelles

- Windows uniquement (macOS/Linux : ajouter des jobs `macos-latest`/`ubuntu-latest` au workflow
  le jour où le besoin existe — même config, juste plus de runners).
- Nécessite une connexion internet au lancement (la fenêtre charge le site en ligne).
- Icône générée à partir de la marque du logo actuel (`desktop/src-tauri/icons/`) — à régénérer
  via `npx @tauri-apps/cli icon <source.png>` si le logo change.
