# Journal des modifications

Les adresses `/v1/` ne changent pas : chaque version ajoute ou corrige, sans retirer ce qui existe.

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
