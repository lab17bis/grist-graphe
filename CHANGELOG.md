# Journal des modifications

Les adresses `/v1/` ne changent pas : chaque version ajoute ou corrige, sans retirer ce qui existe.

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
