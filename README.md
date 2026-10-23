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

## Hébergement

Le dossier `dist` peut être servi par tout hébergeur statique. La configuration Sites se trouve dans `.openai/hosting.json`. Le site Sites est créé avec un accès privé ; ses droits d’accès sont gérés séparément du code.
