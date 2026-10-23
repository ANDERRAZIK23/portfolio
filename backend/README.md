# Administration privée du portfolio

Le portfolio reste sur GitHub Pages. Ce service Cloudflare héberge une administration séparée sur `https://admin.imachraf.tech` : statistiques D1 et fichiers privés R2 (stockage compatible S3).

## Fonctionnement

- Cloudflare Access gère la connexion par code e-mail. Le Worker vérifie aussi la signature JWT, l’émetteur, l’audience et l’adresse e-mail autorisée avant de servir toute page, statistique ou pièce jointe.
- Les fichiers restent dans un bucket privé. Téléversement, téléchargement et suppression passent par le Worker authentifié. Taille maximale : 20 Mio par fichier. Aucun jeton S3 ne passe dans le navigateur ni dans le dépôt.
- La collecte publique accepte uniquement l’origine du portfolio. Elle enregistre le chemin sans paramètres, le domaine référent, le pays et le type d’appareil. Elle n’enregistre ni adresse IP brute, ni nom de visiteur, ni user-agent brut. Un HMAC de l’IP change chaque jour UTC ; il permet une estimation des visiteurs uniques **par jour**, pas des personnes uniques sur une période. Plusieurs personnes partageant une IP peuvent être regroupées.
- La collecte respecte Do Not Track et Global Privacy Control. Les robots courants sont exclus. Les compteurs restent indicatifs : blocages, robots non reconnus, IP partagées et requêtes forgées peuvent influencer les mesures. La limitation de débit atténue les abus ; l’origine CORS ne prouve pas l’authenticité d’une requête extérieure au navigateur.
- Conservation des statistiques : 90 jours UTC, avec suppression quotidienne planifiée. Aucune mesure rétroactive des anciennes visites.

La collecte est **désactivée** dans le HTML public tant que le backend n’est pas prêt. Il n’y a ni données de démonstration ni mot de passe d’administration dans le code.

## Offre Cloudflare

Au 23 octobre 2026, R2 Standard inclut 10 Go-mois, 1 million d’opérations de classe A et 10 millions de classe B par mois, sans frais de sortie. Workers Free inclut 100 000 requêtes par jour ; D1 et Access ont aussi une offre gratuite. Les quotas ne constituent pas une garantie de facture nulle : R2 nécessite une activation par checkout et facture les dépassements. Consulter [R2](https://developers.cloudflare.com/r2/pricing/), [Workers](https://developers.cloudflare.com/workers/platform/pricing/), [D1](https://developers.cloudflare.com/d1/platform/pricing/) et [Access](https://www.cloudflare.com/sase/products/access/).

## Installation

Prérequis : Node.js 24+ (tests SQLite locaux) et un compte Cloudflare. Depuis ce dossier :

```sh
npm ci
npx wrangler login
cp wrangler.example.jsonc wrangler.jsonc
```

`wrangler.jsonc`, les fichiers `.dev.vars` et `.env` sont ignorés par Git. Le fichier exemple contient des valeurs à remplacer ; il ne représente pas un service déjà déployé.

### 1. Domaine et stockage

1. Ajouter `imachraf.tech` à Cloudflare sur l’offre DNS gratuite. Recopier et vérifier les enregistrements existants avant de remplacer les serveurs de noms au registrar par ceux assignés par Cloudflare. Conserver les quatre A GitHub Pages et le CNAME `www → anderrazik23.github.io` en mode **DNS only**. Ne pas modifier les autres services éventuels.
2. Activer R2 dans le tableau de bord ; le propriétaire doit compléter le checkout. Créer le bucket privé avec la commande ci-dessous. Laisser les accès publics `r2.dev` et les domaines publics du bucket désactivés.

```sh
npx wrangler r2 bucket create portfolio-private-files
npx wrangler d1 create portfolio-analytics
```

Remplacer `database_id` dans `wrangler.jsonc` par l’identifiant retourné par D1. Si le nom du bucket doit changer, modifier `bucket_name` aussi. La route custom domain du Worker créera l’enregistrement `admin.imachraf.tech` à son déploiement ; ne pas ajouter de CNAME GitHub pour `admin`.

### 2. Connexion privée avec Access

Dans Cloudflare Zero Trust, choisir l’offre gratuite et un nom d’équipe. Activer **One-time PIN** comme méthode de connexion, puis créer :

1. Une application Access **Self-hosted** couvrant `admin.imachraf.tech` en entier. Ajouter une règle **Allow** limitée à votre adresse e-mail exacte, avec une durée de session courte (par exemple 8 heures). Copier son **Application Audience (AUD)**.
2. Une application distincte plus spécifique couvrant exactement `admin.imachraf.tech/api/collect`, avec une règle **Bypass / Everyone**, afin que la collecte ne demande pas de connexion aux visiteurs. Cette exception doit couvrir uniquement ce chemin. Le Worker n’y expose que la collecte et son précontrôle CORS ; tous les autres chemins exigent toujours un JWT valide.

Renseigner dans `wrangler.jsonc` :

- `ADMIN_EMAIL` : la même adresse autorisée dans Access.
- `ACCESS_TEAM_DOMAIN` : `<nom-equipe>.cloudflareaccess.com`, sans protocole ni chemin.
- `ACCESS_AUD` : l’audience de la première application (administration).
- `SITE_ORIGIN` : `https://imachraf.tech`, sans slash final.

Les adresses `workers.dev` et les URL de preview sont désactivées. Même en cas d’erreur de règle Access, le Worker refuse les accès privés sans JWT valide.

### 3. Déploiement et contrôles

```sh
npm run db:migrate
openssl rand -hex 32 | npx wrangler secret put ANALYTICS_SALT
npm run deploy
```

Vérifier dans le navigateur :

1. `https://admin.imachraf.tech` affiche la connexion Access. Une autre adresse que celle autorisée doit être refusée.
2. Après connexion, les statistiques sont vides au premier déploiement. Téléverser un fichier, le télécharger et le supprimer.
3. Une fenêtre privée non connectée ne peut ni lister ni télécharger vos fichiers, même avec leur URL.
4. Le précontrôle et l’envoi à `/api/collect` depuis le portfolio ne doivent pas être redirigés vers la connexion Access.

Seulement après ces contrôles, modifier la balise dans `dist/index.html` à la racine du projet :

```html
<meta name="portfolio-analytics-endpoint" content="https://admin.imachraf.tech/api/collect">
```

Ajouter éventuellement un lien personnel vers l’administration ; son URL ne constitue pas une protection. Mettre à jour la notice de confidentialité si le fonctionnement change. Pousser ce changement sur `main` pour publier le collecteur avec GitHub Pages. Effectuer une visite réelle sans DNT/GPC, puis actualiser les statistiques.

## Vérification locale

```sh
npm test
npm run check
npm run build:check
```

Les tests exercent les signatures JWT, les refus d’accès, le stockage, la collecte et la rétention avec des ressources locales. `build:check` assemble le Worker sans le déployer ni créer de ressources. `npm run dev` nécessite votre fichier de configuration local ; la validation Access reste active en développement et n’a aucun mode de contournement.

Les changements backend nécessitent `npm run deploy` ; le workflow GitHub Pages ne déploie que le dossier `dist` du portfolio. Les fichiers R2 ne sont pas une sauvegarde : conserver une copie des documents importants.
