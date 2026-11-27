# Journal des modifications

Les adresses `/v1/` ne changent pas : chaque version ajoute ou corrige, sans retirer ce qui existe.

## 2026-11-27 (accès au document)
- Dans Grist, quand le widget ne peut pas lire le document (accès complet non accordé, ou compte sans droit de lecture), un message le dit et indique quoi faire, au lieu d'un outil vide ou d'un écran d'installation. Contrôle commun, dans `commun/barre.js`.

## 2026-11-27 (barre commune de l'éditeur)
- Barre commune à tous les widgets (fichier partagé `commun/barre.js` et `commun/barre.css`) : nom du widget et statut à gauche, onglets Réglages, En-tête et pied, Aperçu, Publication au centre, Enregistrer à droite ; barre collante en haut de l'écran.
- L'outil n'a plus d'onglet à son nom : il s'utilise dans l'Aperçu, ouvert par défaut, avec l'en-tête et le pied de page (affichés une seule fois). Les rubriques propres à l'outil sont des sous-onglets de Réglages quand il y en a plusieurs.
- Liens et boutons « Réglages » ou « Configurer » de l'outil masqués : la barre suffit.
- Même lien, deux affichages : chaque vue Grist choisit, dans Publication, l'éditeur du widget ou la page d'usage (l'outil avec son en-tête et son pied, sans barre, avec un lien « Éditer le widget »). Le choix est une option de la vue Grist ; par défaut, l'éditeur s'affiche comme avant.
- Affichage de la vue : après « Appliquer à cette vue », un texte rappelle de cliquer sur Enregistrer en haut de la vue Grist pour garder le choix (vérifié dans Grist).

## 2026-11-27 (adresse refusée)
- Publication : une adresse de page contenant l'identifiant long du document est refusée avec un message qui explique quoi copier (Grist ignore la page dans ce cas).

## 2026-11-27 (barre stable)
- Barre de réglages : la place du bouton Enregistrer est réservée sur l'onglet de la vue, la barre ne saute plus d'un onglet à l'autre.

## 2026-11-27 (publication réservée)

### Ajouté

- Onglet Publication : section « Lien réservé aux personnes invitées » (collez l'adresse de la page Grist, le lien plein écran se construit, au choix en consultation seule ou avec saisie) et rappel de la différence entre page publique et lien réservé.

## 2026-11-27 (cohérence de la barre de réglages)

### Corrigé

- Le bouton Enregistrer est aligné sur la barre d'onglets, les onglets sont centrés et la pastille « Enregistré / Non enregistré » reste visible sur toutes les pages.

## 2026-11-26 (tables déjà présentes dans le document)

### Ajouté
- Le panneau signale ce qui empêche de lire les données : table d'acteurs absente, colonne du nom introuvable, table des liens sans colonnes `De` et `Vers`, liens ignorés parce que leur acteur ne correspond à aucun acteur affiché.

## 2026-11-26 (style commun de configuration)

### Corrigé
- Configuration : sur l'onglet de l'outil, le style commun masquait par erreur tout champ dont l'identifiant finit par « -etat » (dans grist-projet : le filtre « État » de la banque et la liste « État » du formulaire de projet). Seul le badge « Enregistré » de la barre est maintenant masqué. Rien à refaire : rechargez la page.

## 2026-11-25 (mention de conception)

### Ajouté
- Mention discrète en pied de page, sur l'outil comme sur ses pages publiques : « Widget conçu par le Lab 17 bis, le laboratoire d'innovation publique de l'académie de Reims ».

## 2026-11-25 (graphe en mouvement et analyse du réseau)

### Ajouté
- Bouton « Animer » au-dessus du graphe : les acteurs se placent sous vos yeux, les liens se tendent puis se stabilisent ; le mouvement s'arrête seul quand plus rien ne bouge. En mouvement, déplacer un acteur fait réagir les autres. « Figer » garde la disposition obtenue.
- Panneau « Analyse du réseau » :
  - « Regrouper les acteurs » : par proximité (communautés détectées automatiquement, méthode de Louvain pondérée par la force des liens), selon la table ou selon le type. Les acteurs d'un même groupe se rassemblent et prennent la couleur du groupe ; les liens entre groupes s'allongent.
  - Chaque groupe peut être mis en avant d'un clic : il vient au centre, se resserre, et les autres acteurs s'écartent et s'estompent.
  - « Taille des acteurs » : selon le nombre de liens, le rôle de passerelle (acteurs par qui passent beaucoup de chemins entre les autres) ou l'influence.
- Vue Liste : colonne « Groupe » quand un regroupement est choisi.
- Réglages : « Regroupement à l'ouverture » et taille « selon le rôle de passerelle ». Chaque personne peut changer ces choix pour elle-même dans le panneau, sans toucher aux réglages enregistrés.

### Amélioré
- Un acteur déplacé à la main garde sa place.
- La disposition tient compte de la force des liens : un lien fort rapproche davantage.

### Accessibilité
- Si l'appareil demande moins d'animations (réglage « réduire les animations »), la disposition est calculée d'un coup, sans mouvement. L'état du mouvement est annoncé aux lecteurs d'écran.

## 2026-11-25 (aperçu réel)

### Amélioré
- Onglet « Aperçu » de la configuration : il montre maintenant le graphe elle-même, entre l'en-tête et le pied de page, au lieu d'un exemple fixe. Les réglages en cours de saisie, même non enregistrés, s'appliquent le temps de l'aperçu ; en quittant l'onglet, l'outil revient à ses réglages enregistrés.
- Dans l'aperçu, l'outil est réellement actif : ce que vous y faites s'applique au document. Un message le rappelle.

## 2026-11-25 (audit de sécurité)

### Sécurité
- Les liens venant des données ou des réglages sont vérifiés par le navigateur lui-même : une adresse déguisée (« java⇥script: » avec tabulation, retour à la ligne ou caractère de contrôle) n'est plus acceptée. Elle permettait, sur le portail, d'exécuter du script au clic depuis une adresse fabriquée.
- Politique de sécurité de contenu stricte : seuls les scripts du site, l'API Grist et les scripts de la page connus par leur empreinte peuvent s'exécuter. L'évaluation de texte (« unsafe-eval ») reste permise : l'API officielle de Grist en a besoin (sans elle, les widgets restaient bloqués sur « Chargement… » dans Grist le 25/11 au matin). Un script injecté (lien javascript:, attribut onerror…) est bloqué même si un filtre le laissait passer.
- Page publique : message clair si le document Grist est injoignable (au lieu de « Failed to fetch »).

## 2026-11-24 (durcissement)

### Sécurité
- Les pages ajoutent une politique de sécurité de contenu minimale (pas d'objets embarqués, pas de balise base).
- Les pages publiques n'acceptent plus qu'un lien de document Grist en https (http seulement pour localhost, en développement).

## 2026-11-24 (message de lecture publique)

### Corrigé
- Page publique : quand une table est masquée par les règles d'accès du document, le message nomme la table et explique la cause (erreur 403), au lieu de demander si le document est partagé. Comportement vérifié sur un vrai document Grist : une table refusée au public répond 403, une colonne refusée disparaît des lignes, les personnes connectées gardent leurs droits.

## 2026-11-24 (règles d'accès)

### Corrigé
- Page publique : une table ou une colonne masquée par les règles d'accès du document (par exemple les adresses de courriel) n'empêche plus d'afficher le reste de la page.

### Ajouté
- Documentation de la page publique (README) : réglages, ce qui est lu, ce qui reste caché, règles d'accès à poser.

## 2026-11-24 (page publique)

### Ajouté
- Page publique en lecture seule : le graphe, les fiches, les chemins et la liste. L'adresse `index.html?public=1&doc=<lien du document Grist>&table=<table>` affiche l'outil en pleine page, sans compte Grist, avec l'en-tête et le pied de page DSFR configurés ; aucune commande d'écriture n'est proposée.
- Onglet Publication : saisissez le lien du document Grist partagé en lecture publique, l'outil construit le lien de la page publique (réglages et association des colonnes compris), à copier ou à ouvrir. Le lien du document est enregistré avec les réglages.
- Option `integre=1` : la page s'affiche sans en-tête ni pied propres, pour être intégrée dans un autre site.
- Module commun `commun/grist-public.js` (et `.css`) : lit le document par l'API REST de Grist, en lecture seule.

## 2026-11-24 (documentation)

### Modifié
- Documentation : l'outil de consultation s'appelle désormais `grist-consultation` (ancien nom `grist-decision`).

## 2026-11-24 (barre d'onglets permanente)

### Modifié
- Le widget s'ouvre désormais sur une barre d'onglets, comme le catalogue et le questionnaire : *Graphe*, puis les onglets de réglages, En-tête et pied, Aperçu, Publication. L'outil lui-même est le premier onglet.
- Le bouton « Configurer » laisse la place à la barre d'onglets ; les anciens liens et boutons « Réglages » restent actifs et ouvrent l'onglet Réglages.
- L'enregistrement des réglages reste dans la colonne de configuration existante : rien à migrer.

## 2026-11-24

### Ajouté
- Bouton « Configurer » en bas du panneau : ouvre une page de configuration pleine largeur, en quatre onglets (Réglages, En-tête et pied, Aperçu, Publication). Le bouton « Réglages » du panneau et « Ouvrir la configuration » de Grist restent actifs.
- Prise en charge de l'en-tête et du pied de page (bloc-marque, titre, liens, mention d'accessibilité) autour du graphe.
- Module commun `commun/configuration.js` et `commun/configuration.css`, partagé avec les autres widgets de la famille.
- Onglet Aperçu : l'en-tête et le pied de page tels qu'ils seront affichés, avec les réglages en cours, même non enregistrés.
- Onglet Publication : explique comment inviter l'équipe ou partager le document par lien public, et donne l'adresse du widget à copier.

### Modifié
- Les réglages existants (tables d'acteurs, liens, participations, affichage) sont conservés tels quels, dans les options du widget.
- Sans en-tête ni pied de page réglés, l'affichage est identique à avant.

## Versions antérieures

Voir l'historique des commits.
