"""Test « dans Grist » de grist-graphe, avec une API Grist simulée (tests/grist-mock.js) chargée dans tests/hote.html.
Lancer un serveur à la racine du dépôt (python3 -m http.server PORT), puis : PORT=… python3 tests/test_dans_grist.py"""
import os, sys, json
from playwright.sync_api import sync_playwright
ok = ko = 0
def verifier(nom, cond):
    global ok, ko
    print(('OK   ' if cond else 'ÉCHEC ') + nom); ok += cond; ko += (not cond)
def ouvrir(b, port, mock, erreurs):
    pg = b.new_page(viewport={'width': 1280, 'height': 860})
    pg.on('pageerror', lambda e: erreurs.append(str(e)))
    mockjs = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'grist-mock.js')).read()
    pg.route('https://docs.getgrist.com/grist-plugin-api.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=mockjs))
    pg.route('https://data.geopf.fr/wmts**', lambda r: r.fulfill(status=204))
    pg.route('https://data.geopf.fr/geocodage/**', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps({'features': [{'geometry': {'coordinates': [3.72, 48.72]}, 'properties': {'score': 0.9}}]})))
    pg.goto(f'http://localhost:{os.environ.get("PORT", port)}/tests/hote.html')
    pg.evaluate('m => { window.MOCK = m; charger(); }', mock)
    return pg, pg.frame_locator('#w')
mock = lambda pg: pg.evaluate('window.MOCK')
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROME') or None, args=['--no-sandbox'])
    erreurs = []
    # --- grist-graphe : détection des tables, rattachements, création de Liens, ajout d'un lien
    m = {'tables': {
        'Structures': {'colonnes': {'Nom': {'type': 'Text'}, 'Type': {'type': 'Choice'}}, 'lignes': [{'id': 1, 'Nom': 'Lycée B', 'Type': 'Établissement'}, {'id': 2, 'Nom': 'Association F', 'Type': 'Partenaire'}]},
        'Personnes': {'colonnes': {'Nom': {'type': 'Text'}, 'Structure': {'type': 'Ref:Structures'}, 'Fonction': {'type': 'Text'}}, 'lignes': [{'id': 1, 'Nom': 'MARTIN Camille', 'Structure': 1, 'Fonction': 'CPE'}, {'id': 2, 'Nom': 'GARCIA Maxime', 'Structure': 2, 'Fonction': 'Chef de projet'}]}},
        'table': 'Personnes', 'utilisateur': {'email': 'a@b.fr', 'nom': 'A'}}
    pg, f = ouvrir(b, 8783, m, erreurs)
    f.locator('.gg-filtre').first.wait_for(); pg.wait_for_timeout(300)
    verifier('graphe : acteurs détectés et rattachements', f.locator('.gg-filtre').first.locator('input').count() == 2 and 'Rattachements' in f.locator('.gg-filtre').nth(1).inner_text())
    f.get_by_role('button', name='Créer la table Liens').click()
    pg.wait_for_function("!!window.MOCK.tables.Liens", timeout=10000); f.locator('.gg-encart').wait_for(state='detached')
    verifier('graphe : table Liens créée et reconnue', f.locator('.gg-encart').count() == 0)
    f.locator('.gg-top button', has_text='MARTIN Camille').click()
    verifier('graphe : sélection transmise à Grist', mock(pg).get('curseur') == {'rowId': 1})
    f.locator('summary', has_text='Ajouter un lien').click()
    f.locator('#gg-vers').fill('Association F'); f.locator('form[data-form=lien] button').click()
    f.locator('.gg-voisins li', has_text='Association F').wait_for()
    l = mock(pg)['tables']['Liens']['lignes']
    verifier('graphe : lien écrit dans la table Liens', len(l) == 1 and l[0]['De'] == 'MARTIN Camille' and l[0]['Vers'] == 'Association F')
    pg.close()
    verifier('aucune erreur JavaScript', not erreurs)
    if erreurs: print(erreurs)
    b.close()
print(f'{ok} réussis, {ko} échoués'); sys.exit(1 if ko else 0)
