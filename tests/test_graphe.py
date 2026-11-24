"""Tests de bout en bout du mode démonstration : python3 tests/test_graphe.py
Variables : CHROME (chemin du navigateur), URL (par défaut http://localhost:8783/)."""
import os, sys
from playwright.sync_api import sync_playwright
URL = os.environ.get('URL', 'http://localhost:8783/')
ok = ko = 0
def verifier(nom, cond):
    global ok, ko
    print(('OK   ' if cond else 'ÉCHEC ') + nom); ok += cond; ko += (not cond)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROME') or None, args=['--no-sandbox'])
    pg = b.new_page(viewport={'width': 1280, 'height': 860}); erreurs = []
    pg.on('pageerror', lambda e: erreurs.append(str(e)))
    etat = lambda: pg.evaluate('ggEtat()')
    pg.goto(URL); pg.wait_for_selector('.gg-filtre'); pg.wait_for_timeout(300)
    e = etat()
    verifier('28 acteurs (10 structures, 18 personnes)', e['acteurs'] == 28)
    verifier('liens : 13 saisis, 20 rattachements, 45 participations communes', e['aretes'] == 78 and pg.locator('.gg-filtre').nth(1).locator('input').count() == 8)
    verifier('graphe dessiné', pg.locator('#gg-graphe canvas').count() >= 1)
    pg.locator('.gg-filtre label', has_text='Membres du même groupe').click()
    verifier('filtre par nature de lien', etat()['visibles'] == 33)
    pg.locator('.gg-filtre label', has_text='Personnes').click()
    verifier('filtre par catégorie d\'acteurs', etat()['visibles'] == 7)
    pg.locator('.gg-filtre label', has_text='Personnes').click()
    pg.locator('.gg-filtre label', has_text='Membres du même groupe').click()
    pg.fill('#gg-q', 'SIMON Lou'); pg.locator('form[data-form=trouver] button').click()
    verifier('trouver un acteur : fiche', pg.locator('#gg-fiche-titre').inner_text() == 'SIMON Lou' and 'Chargée de mission' in pg.locator('.gg-infos').inner_text())
    verifier('fiche : liens par nature', pg.locator('.gg-type-lien').count() >= 3)
    pg.locator('.gg-voisins button[data-acteur]', has_text='MOREAU Charlie').first.click()
    verifier('navigation vers un voisin', pg.locator('#gg-fiche-titre').inner_text() == 'MOREAU Charlie')
    # Ajouter un lien
    pg.locator('summary', has_text='Ajouter un lien').click()
    pg.fill('#gg-vers', 'Médiathèque K'); pg.select_option('#gg-type', 'Conseille'); pg.locator('form[data-form=lien] button').click()
    verifier('ajouter un lien', etat()['aretes'] == 79 and pg.locator('.gg-voisins li', has_text='Médiathèque K').count() == 1)
    pg.locator('.gg-voisins li', has_text='Médiathèque K').locator('.gg-suppr').click()
    verifier('supprimer un lien', etat()['aretes'] == 78)
    # Chemin
    pg.locator('summary', has_text='Trouver un chemin').click()
    pg.fill('#gg-vers-chemin', 'Tiers-lieu L'); pg.locator('form[data-form=chemin] button').click()
    n = etat()['chemin']
    verifier('chemin le plus court trouvé', n is not None and n >= 3 and pg.locator('.gg-chemin li').count() == n)
    # Positions
    pg.locator('[data-vue=positions]').click(); pg.wait_for_timeout(300)
    verifier('vue positions', '19 acteurs positionnés' in pg.locator('#gg-info').inner_text())
    pg.locator('#gg-panneau [data-action=retour]').click(); pg.fill('#gg-q', 'ROUX Inès'); pg.locator('form[data-form=trouver] button').click()
    pg.select_option('#gg-n-Influence', '4'); pg.select_option('#gg-n-Interet', '2')
    verifier('positionner un acteur', '20 acteurs positionnés' in pg.locator('#gg-info').inner_text())
    # Liste
    pg.locator('[data-vue=liste]').click()
    verifier('vue liste : tableaux des acteurs et des liens', pg.locator('#gg-liste table').count() == 2 and pg.locator('#gg-liste tbody tr').count() == 28 + 78)
    pg.locator('[data-vue=graphe]').click()
    # Réglages
    pg.locator('#gg-reglages').click(); pg.wait_for_selector('#gg-reglages-titre', state='attached')
    pg.select_option('#rg-couleur', 'type'); pg.select_option('#rg-taille', 'influence')
    pg.get_by_role('button', name='Retirer').click()
    pg.get_by_role('button', name='Enregistrer').click(); pg.wait_for_timeout(500)
    pg.locator('.cl-barre label').first.click(); pg.wait_for_timeout(900)
    if pg.locator('#gg-panneau [data-action=retour]').count(): pg.locator('#gg-panneau [data-action=retour]').click()
    verifier('réglages : couleur par type, sans participation', etat()['options']['couleurPar'] == 'type' and etat()['aretes'] == 33 and pg.locator('.gg-legende-types li').count() >= 5)
    pg.screenshot(path='/tmp/graphe-type.png')
    pg.set_viewport_size({'width': 400, 'height': 800}); pg.wait_for_timeout(300); pg.screenshot(path='/tmp/graphe-mobile.png', full_page=True)
    verifier('aucune erreur JavaScript', not erreurs)
    if erreurs: print(erreurs)
    b.close()
print(f'{ok} réussis, {ko} échoués'); sys.exit(1 if ko else 0)
