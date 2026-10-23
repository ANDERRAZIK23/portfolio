# Portfolio — Achraf Abderrazik

Portfolio en français basé sur le CV fourni. Site statique sans dépendance JavaScript ni étape de compilation : HTML sémantique, CSS responsive et JavaScript natif.

## Aperçu local

Avec Python 3 et Node.js installés :

```sh
npm run dev
```

Ouvrir http://127.0.0.1:4173. On peut également ouvrir `dist/index.html` directement pour consulter le site hors serveur.

```sh
npm run check
```

## Modifier le portfolio

- `dist/index.html` : contenu, parcours, compétences, coordonnées et cartes des projets.
- `dist/styles.css` : mise en page et styles adaptatifs.
- `dist/app.js` : détails des projets, filtres, navigation mobile et gestion accessible de la fenêtre de détails.
- `dist/assets/CV-Achraf-Abderrazik.pdf` : CV téléchargeable.

Les illustrations d’architecture sont des compositions graphiques explicatives, pas des captures des applications. Les liens de code source proviennent du CV. Les boutons e-mail et téléphone utilisent les applications configurées sur l’appareil du visiteur. Aucun formulaire ne simule un envoi de message.

Les polices Manrope et DM Sans sont chargées depuis Google Fonts. Si elles sont indisponibles, les polices système définies dans la feuille de styles sont utilisées.

## Interactions et animations

L’accueil propose trois domaines interactifs : back-end, full-stack et intelligence artificielle. Chaque bouton met à jour le schéma, ses technologies et son explication. Les visuels des projets ouvrent les mêmes fiches accessibles que leurs liens textuels.

Les apparitions au défilement utilisent `IntersectionObserver`. Les effets de perspective restent réservés aux pointeurs précis. Les mises à jour du défilement et du pointeur passent par `requestAnimationFrame`. Le bouton « Pause animations » arrête les mouvements continus ; la préférence système `prefers-reduced-motion` est prioritaire. Le contenu reste lisible sans JavaScript.

## Administration et statistiques

Le dossier `backend` contient une administration Cloudflare Workers avec connexion Cloudflare Access, statistiques D1 et stockage privé R2 compatible S3. Voir [le guide d’installation](backend/README.md) pour les quotas gratuits, la configuration, les tests et le déploiement.

La collecte est désactivée tant que la balise `portfolio-analytics-endpoint` reste vide dans `dist/index.html`. L’administration n’est pas hébergée par GitHub Pages. Le compte Cloudflare et les ressources doivent être créés avant son activation. Les fichiers envoyés restent privés ; aucune clé de stockage n’est placée dans le navigateur.

```sh
npm ci --prefix backend
npm test
```

## Hébergement

### GitHub Pages

Le workflow `.github/workflows/pages.yml` publie le dossier `dist` à chaque push sur `main`. Il vérifie d’abord la syntaxe JavaScript ; aucune compilation ni installation de dépendances n’est nécessaire.

1. Publier le contenu de ce dossier (`achraf-portfolio`), avec `.github`, à la racine du dépôt GitHub.
2. Dans le dépôt GitHub, ouvrir **Settings → Pages → Build and deployment** et choisir **GitHub Actions** comme source.
3. Pousser un commit sur `main`, ou lancer **Actions → Deploy portfolio to GitHub Pages → Run workflow**.
4. Consulter l’URL publiée dans **Settings → Pages** ou dans le résultat du déploiement.

Les liens vers les fichiers CSS, JavaScript et le CV sont relatifs et fonctionnent également sous le chemin d’un dépôt (`https://<utilisateur>.github.io/<depot>/`).

### Sites

Le dossier `dist` peut être servi par tout hébergeur statique. La configuration Sites se trouve dans `.openai/hosting.json`. Le site Sites est créé avec un accès privé ; ses droits d’accès sont gérés séparément du code.
