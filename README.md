# grist-graphe

> **Widget pour Grist, au Système de design de l'État (DSFR).** Il dessine les acteurs d'un document Grist (personnes, structures…) et les liens qui les unissent : coopérations, financements, conseils, rattachements, participation aux mêmes groupes. Une fiche par acteur, un chemin entre deux acteurs, et une vue qui positionne chacun selon son influence et son intérêt.

Tout se règle dans Grist, sans toucher au code. Le dépôt ne contient que le code : aucune donnée réelle.

## À quoi ça sert

| Vue ou fonction | Ce qu'elle permet |
| --- | --- |
| **Graphe** | Voir le réseau d'un coup d'œil : la taille d'un acteur dépend de son nombre de liens (ou de son influence), l'épaisseur d'un lien de sa force, une flèche indique un lien à sens unique. Zoom, déplacement, survol |
| **Fiche d'un acteur** | Ses informations, ses liens classés par nature, l'ajout ou la suppression d'un lien, la saisie de son influence et de son intérêt. Ses voisins sont mis en avant dans le graphe |
| **Chemin** | Le plus court chemin entre deux acteurs : par qui passer pour atteindre telle structure ? |
| **Positions** | La matrice influence / intérêt des parties prenantes : associer étroitement, satisfaire, informer, surveiller |
| **Liste** | Les acteurs (du plus au moins connecté) et tous les liens en tableaux : l'alternative accessible au graphe |
| **Filtres** | Par catégorie d'acteurs et par nature de lien ; les acteurs les plus connectés et les acteurs isolés |

Les liens viennent de trois sources, que l'on peut combiner :

1. **Liens saisis** dans une table `Liens` : *De*, *Vers*, *Type* (coopère avec, finance, conseille…), *Force* (1 à 3), *Sens* (réciproque ou à sens unique), *Note*. Le widget la crée à la demande.
2. **Rattachements** : les références entre acteurs deviennent des liens, par exemple la structure d'une personne ou la structure mère d'une structure.
3. **Participation commune** : deux acteurs cités dans une même ligne (les membres d'un groupe) ou dans des lignes qui partagent une même valeur (les présents à une même rencontre) sont reliés ; la force augmente avec le nombre d'occasions partagées.

Démonstration avec des données fictives (rien n'est enregistré) : <https://lab17bis.github.io/grist-graphe/v1/>

## Le brancher en 3 minutes

1. **Ouvrir le document Grist** qui contient les acteurs, par exemple les tables `Structures` et `Personnes` partagées par les outils de la même famille.
2. **Ajouter le widget** : *Ajouter › Ajouter un widget à la page › Personnalisé*, de préférence sur la table `Personnes` ou `Structures`. Dans le panneau de droite, choisissez *URL personnalisée*, saisissez `https://lab17bis.github.io/grist-graphe/v1/` et donnez l'**accès complet au document**.
3. **Vérifier les réglages** (bouton *Réglages*) : le widget reconnaît seul les tables `Structures`, `Personnes`, `Acteurs` ou `Partenaires` et la table `Liens`. Cliquez sur *Créer la table Liens* pour commencer à saisir des liens.

Le widget suit la ligne sélectionnée dans Grist : choisir une personne dans un tableau ouvre sa fiche dans le graphe, et inversement.

## Le régler

Les réglages sont enregistrés **avec le widget** (propres à la vue) :

- **Tables d'acteurs** : pour chacune, la colonne du nom, la colonne du type et un libellé (« Structures », « Personnes »…). Chaque table a sa forme : carré arrondi, rond, losange, triangle.
- **Table des liens**, **rattachements** (oui ou non) et **sources de participation commune** : table, colonne qui cite les acteurs (référence multiple, liste de choix ou texte séparé par des virgules), regroupement facultatif. Une source peut ne retenir que certaines lignes : dans les options du widget, `"condition": { "colonne": "Type", "operateur": "different", "valeur": "Plénière" }` écarte par exemple les plénières, où tout le monde se croise.
- **Affichage** : couleur selon la table ou selon le type, taille selon le nombre de liens ou l'influence, noms toujours affichés, acteurs isolés masqués.

Pour la vue *Positions*, le widget propose d'ajouter les colonnes `Influence` et `Interet` (entiers de 0 à 5) aux tables d'acteurs. Elles se renseignent dans la fiche de chaque acteur.

## Le reprendre et l'adapter

- **L'utiliser tel quel** : ajoutez le widget dans Grist. Aucune installation n'est nécessaire.
- **L'héberger chez vous** : copiez le dépôt (*Fork*), activez GitHub Pages ou déposez les fichiers sur un serveur web statique, puis changez l'adresse du widget dans Grist. Aucune compilation.
- **Modifier le code** :

| Dossier ou fichier | Rôle |
| --- | --- |
| `v1/` | Version stable figée, servie à l'adresse `…/v1/`. Ne pas modifier à la main. |
| `outils/figer-version.sh` | Copie la version en cours dans `vN/`. |
| `index.html`, `js/app.js`, `css/app.css` | L'application : construction du graphe, vues, fiche, chemin, réglages |
| `exemples/demo.json` | Document fictif utilisé par la démonstration (tables et réglages) |
| `tests/` | Tests automatisés de l'interface : `python3 tests/test_graphe.py` (Playwright), et fonctionnement dans Grist avec une API simulée : `python3 tests/test_dans_grist.py` |
| `vendor/` | DSFR et Apache ECharts, embarqués pour ne dépendre d'aucun service externe |

## Fonctionnement et sécurité

- Le widget lit les tables avec les droits de la personne connectée et n'écrit que dans la table `Liens` et les colonnes `Influence` et `Interet`, à la demande.
- Aucune donnée ne quitte le document : le graphe est calculé dans le navigateur.
- **Données personnelles.** Qualifier l'influence ou l'intérêt de personnes nommées, ou leurs relations, constitue un traitement de données personnelles. Préférez des structures et des fonctions, limitez l'accès au document aux personnes qui en ont besoin, et informez les personnes concernées. Le dépôt ne contient que des exemples fictifs.

## Limites

- Les liens saisis désignent les acteurs **par leur nom** (ou par une référence si les colonnes `De` et `Vers` sont des références vers une table d'acteurs) : renommer un acteur coupe ses liens saisis par nom. Deux acteurs de même nom sont confondus.
- Au-delà de quelques centaines d'acteurs, le graphe devient difficile à lire : utilisez les filtres ou la vue *Liste*.
- Aucun audit RGAA n'a été mené. La vue *Liste* et les fiches sont l'alternative accessible au graphe.

## Version stable et version en cours

Dans Grist, utilisez l'adresse de la **version stable** : `https://lab17bis.github.io/grist-graphe/v1/`. Elle ne change que pour corriger un défaut, sans toucher aux tables ni aux réglages. Une évolution qui les modifie paraît sous une nouvelle adresse (`v2/`) : les documents déjà en service restent sur `v1/` tant que vous ne changez pas l'adresse du widget.

L'adresse sans numéro (`https://lab17bis.github.io/grist-graphe/`) suit la version en cours de développement. Elle sert à essayer les nouveautés ; ne l'utilisez pas pour un document en service.

Pour figer une nouvelle version stable après des tests réussis : `sh outils/figer-version.sh 1` (ou `2` pour une version qui change les tables), puis publiez le dépôt.

## Données partagées avec les autres outils

Plusieurs outils de la même famille peuvent travailler dans un même document Grist. Ils suivent une règle commune pour ne pas dupliquer les données :

- **Une seule table `Personnes`** par document. Colonne commune : `Nom`. Colonnes facultatives reconnues par tous : `Email` et `Structure` (référence à `Structures`). Un outil lit cette table si elle existe et la crée seulement si elle manque. Il n'y ajoute que ses propres colonnes.
- **Une seule table `Structures`** pour les équipes, services ou établissements : `Nom`, `Sigle`, `Type`, `Parent` (structure de rattachement).
- **Aucun outil ne supprime ni ne renomme** une table ou une colonne qu'il n'a pas créée.
- **Les autres tables portent des noms propres à chaque outil**, pour éviter les collisions (par exemple `Actions` pour grist-projet, `Actions_reunion` pour grist-graphe). Les réglages sont rangés dans la description d'une colonne technique propre à l'outil (`Config_…`).
- **Identifier la personne connectée** : un widget ne connaît pas l'adresse de la personne connectée. Les colonnes « créé par » utilisent une formule `user.Email` calculée à la création. Seul un outil qui doit relier la personne connectée à sa fiche crée la table `Comptes`.

Ce que fait cet outil : il lit `Personnes` et `Structures` (et toute autre table choisie) comme acteurs, sans les modifier, sauf pour ajouter à la demande ses deux colonnes `Influence` et `Interet`. Il crée à la demande sa table `Liens` (`De`, `Vers`, `Type`, `Force`, `Sens`, `Note`), qu'il partage avec [grist-carte](https://github.com/lab17bis/grist-carte).

## Espaces clés en main

Ce widget est assemblé dans [espace-reseau](https://github.com/lab17bis/espace-reseau) : les acteurs du réseau, leurs liens saisis, leurs rattachements et leur participation aux mêmes groupes, avec la carte des structures. Il s'ajoute aussi à tout document qui contient des personnes ou des structures, par exemple pour cartographier les parties prenantes d'un projet dans [espace-pilotage](https://github.com/lab17bis/espace-pilotage) ou [espace-accompagnement](https://github.com/lab17bis/espace-accompagnement).

## Autres outils de la même famille

- [grist-questionnaire](https://github.com/lab17bis/grist-questionnaire) : questionnaires au DSFR avec logique conditionnelle.
- [grist-catalogue](https://github.com/lab17bis/grist-catalogue) : catalogue public de fiches au DSFR.
- [grist-graphique](https://github.com/lab17bis/grist-graphique) : tableaux de bord et graphiques au DSFR.
- [grist-projet](https://github.com/lab17bis/grist-projet) : espace d'équipe pour gérer des projets.
- [grist-reunion](https://github.com/lab17bis/grist-reunion) : réunions : ordre du jour, séance, compte rendu et suivi des actions.
- [grist-management](https://github.com/lab17bis/grist-management) : écran de management visuel d'équipe.
- [grist-decision](https://github.com/lab17bis/grist-decision) : consultations : boîte à idées, valorisation des réalisations, votes et suites données.
- [grist-carte](https://github.com/lab17bis/grist-carte) : carte interactive des lignes d'une table, au fond de l'IGN.

Les widgets qui ont un en-tête et un pied de page partagent les mêmes réglages.

## Écosystème

- **[Grist](https://grist.numerique.gouv.fr)** : tableur-base de données libre ([gristlabs/grist-core](https://github.com/gristlabs/grist-core)), proposé aux agents publics par la [DINUM](https://www.numerique.gouv.fr/) dans [La Suite numérique](https://lasuite.numerique.gouv.fr/).
- **[Système de design de l'État (DSFR)](https://www.systeme-de-design.gouv.fr/)** ([GouvernementFR/dsfr](https://github.com/GouvernementFR/dsfr)). Son usage est réservé aux sites des services de l'État.
- **[Communauté Grist francophone](https://forum.grist.libre.sh/)**.

## Mots-clés

Grist, widget Grist, graphe, réseau, cartographie des acteurs, cartographie des parties prenantes, sociogramme, analyse de réseau, liens, influence, intérêt, matrice influence intérêt, partenaires, écosystème, DSFR, Système de design de l'État, La Suite numérique, DINUM, service public, logiciel libre.

## Licence

Code sous licence MIT (voir `LICENSE`). Le DSFR embarqué dans `vendor/dsfr/` et Apache ECharts dans `vendor/echarts/` (licence Apache 2.0) conservent leur propre licence. Réutilisation, adaptation et contributions bienvenues.

Conçu par le Lab 17 bis, laboratoire d'innovation publique de l'académie de Reims. Contact : <lab17bis@ac-reims.fr>
