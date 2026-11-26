"""Table déjà présente aux colonnes différentes : le widget le signale et propose de compléter.
Serveur attendu : la racine du dépôt sur PORT (par défaut 8783). Utilise l'API Grist simulée de test/grist-mock.js."""
import os, sys
from playwright.sync_api import sync_playwright
PORT = os.environ.get('PORT', '8783')
ok = ko = 0
def verifier(nom, cond):
    global ok, ko
    print(('OK   ' if cond else 'ÉCHEC ') + nom); ok += bool(cond); ko += (not cond)
MOCK = open(os.environ.get('MOCK', '/home/claude/test/grist-mock.js')).read()
HOTE = '<!DOCTYPE html><html><body style="margin:0"><iframe id="w" style="width:100%;height:100vh;border:0"></iframe><script>window.charger=function(u){document.getElementById("w").src=u;};</script></body></html>'
def ouvrir(b, tables, table):
    pg = b.new_page(viewport={'width': 1280, 'height': 900}); err = []
    pg.on('pageerror', lambda e: err.append(str(e)))
    pg.route('**/grist-plugin-api.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=MOCK))
    pg.route('https://data.geopf.fr/**', lambda r: r.fulfill(status=204))
    pg.route(f'http://localhost:{PORT}/__hote.html', lambda r: r.fulfill(status=200, content_type='text/html', body=HOTE))
    pg.goto(f'http://localhost:{PORT}/__hote.html')
    pg.evaluate('([m,u]) => { window.MOCK = m; charger(u); }', [{'tables': tables, 'table': table, 'utilisateur': {'email': 'test@exemple.fr', 'nom': 'Test'}}, '/index.html'])
    pg.wait_for_timeout(1500)
    return pg, pg.frame_locator('#w'), err
def texte(f): return f.locator('body').inner_text()
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROME') or None, args=['--no-sandbox'])
    st = {'colonnes': {'Nom': {'type': 'Text'}}, 'lignes': [{'id': 1, 'Nom': 'Rectorat'}, {'id': 2, 'Nom': 'Canopé'}]}
    pg, f, err = ouvrir(b, {'Structures': st, 'Liens': {'colonnes': {'Source': {'type': 'Text'}, 'Cible': {'type': 'Text'}}, 'lignes': [{'id': 1, 'Source': 'Rectorat', 'Cible': 'Canopé'}]}}, 'Structures')
    pg.wait_for_timeout(1000)
    verifier('table des liens sans De/Vers signalée', 'n\'a pas les colonnes De et Vers' in texte(f)); pg.close()
    pg, f, err = ouvrir(b, {'Structures': st, 'Liens': {'colonnes': {'De': {'type': 'Text'}, 'Vers': {'type': 'Text'}}, 'lignes': [{'id': 1, 'De': 'Rectorat', 'Vers': 'Inconnu'}]}}, 'Structures')
    pg.wait_for_timeout(1000)
    verifier('lien vers un acteur inconnu signalé', '1 lien ignoré' in texte(f))
    verifier('aucune erreur', not err); pg.close()
    b.close()
print(f'{ok} OK, {ko} échec(s)'); sys.exit(1 if ko else 0)
