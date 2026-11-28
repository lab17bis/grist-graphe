"""Mode Organigramme du graphe, en démonstration (données fictives) : arbre construit depuis les références
(personne sous sa structure, structure sous sa structure mère), colonnes de personnes, sélection, réglages
(sens, autres liens en pointillé, vue à l'ouverture). Serveur attendu : racine du dépôt sur PORT (par défaut 8783)."""
import os, sys
from playwright.sync_api import sync_playwright
PORT = os.environ.get('PORT', '8783')
ok = ko = 0
def verifier(nom, cond):
    global ok, ko
    print(('OK   ' if cond else 'ÉCHEC ') + nom); ok += bool(cond); ko += (not cond)
OPT = "echarts.getInstanceByDom(document.getElementById('gg-graphe')).getOption().series[0]"
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROME') or None, args=['--no-sandbox'])
    pg = b.new_page(viewport={'width': 1300, 'height': 950}); erreurs = []
    pg.on('pageerror', lambda e: erreurs.append(str(e)))
    pg.goto(f'http://localhost:{PORT}/'); pg.wait_for_timeout(2500)
    verifier('ouverture sur le graphe (par défaut)', pg.locator('[data-vue=graphe]').get_attribute('aria-pressed') == 'true')
    pg.locator('[data-vue=organigramme]').click(); pg.wait_for_timeout(1200)
    info = pg.locator('#gg-info').inner_text()
    verifier('organigramme : acteurs placés et niveaux annoncés', 'acteurs placés' in info and 'niveaux' in info)
    s = pg.evaluate(OPT)
    noeuds = {n['id']: n for n in s['data']}
    verifier('organigramme : disposition fixe (pas de force)', s['layout'] == 'none' and len(noeuds) >= 20)
    # Chaque lien de l'arbre descend : la cible est plus bas que la source.
    arbre = [l for l in s['links'] if l.get('lineStyle', {}).get('type') == 'solid']
    verifier('organigramme : chaque trait descend vers le niveau inférieur', arbre and all(noeuds[l['target']]['y'] > noeuds[l['source']]['y'] for l in arbre))
    verifier('organigramme : autres liens masqués par défaut', not [l for l in s['links'] if l.get('lineStyle', {}).get('type') == 'dotted'])
    verifier('organigramme : boutons Animer et Réorganiser masqués', not pg.locator('#gg-animer').is_visible() and not pg.locator('#gg-reorganiser').is_visible())
    # Personnes d'une même structure empilées en colonne (même abscisse), étiquette à droite.
    xs = {}
    for n in s['data']:
        if (n.get('label') or {}).get('position') == 'right': xs.setdefault(n['x'], []).append(n)
    verifier('organigramme : personnes empilées en colonne', any(len(v) > 1 for v in xs.values()))
    # Clic sur un acteur : sa fiche s'ouvre.
    cible = s['data'][0]
    px = pg.evaluate("(c) => echarts.getInstanceByDom(document.getElementById('gg-graphe')).convertToPixel({seriesIndex: 0}, c)", [cible['x'], cible['y']])
    bb = pg.locator('#gg-graphe').bounding_box()
    pg.mouse.click(bb['x'] + px[0], bb['y'] + px[1]); pg.wait_for_timeout(700)
    verifier('organigramme : clic sur un acteur ouvre sa fiche', pg.locator('#gg-panneau [data-action=retour]').count() == 1 and cible['name'] in pg.locator('#gg-panneau').inner_text())
    pg.locator('#gg-panneau [data-action=retour]').click()
    # Réglages : sens horizontal, autres liens, vue à l'ouverture.
    pg.locator('.cl-barre .cl-onglets label', has_text='Réglages').click(); pg.wait_for_selector('#rg-sens', state='attached')
    verifier('réglages : rubrique Organigramme', pg.locator('#rg-vue option').count() == 2 and pg.locator('#rg-sens option').count() == 2)
    pg.select_option('#rg-sens', 'horizontal'); pg.select_option('#rg-vue', 'organigramme'); pg.locator('label[for=rg-orgl]').click()
    pg.get_by_role('button', name='Enregistrer').click(); pg.wait_for_timeout(600)
    pg.locator('.cl-barre .cl-onglets label', has_text='Aperçu').click(); pg.wait_for_timeout(1200)
    if pg.locator('#gg-panneau [data-action=retour]').count(): pg.locator('#gg-panneau [data-action=retour]').click()
    pg.locator('[data-vue=organigramme]').click(); pg.wait_for_timeout(1200)
    s = pg.evaluate(OPT); noeuds = {n['id']: n for n in s['data']}
    arbre = [l for l in s['links'] if l.get('lineStyle', {}).get('type') == 'solid']
    verifier('sens horizontal : chaque trait va vers la droite', arbre and all(noeuds[l['target']]['x'] > noeuds[l['source']]['x'] for l in arbre))
    verifier('autres liens affichés en pointillé', len([l for l in s['links'] if l.get('lineStyle', {}).get('type') == 'dotted']) > 0)
    pg.locator('#gg-graphe').screenshot(path='/tmp/organigramme-horizontal.png')
    # Dans Grist (API simulée) : structure mère par la colonne Parent, personne sous sa structure,
    # et un doublon fusionné (Fusionne_dans, annuaire) reste sous sa structure, pas sous l'autre personne.
    import json
    mockjs = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'grist-mock.js')).read()
    pg2 = b.new_page(viewport={'width': 1280, 'height': 860}); pg2.on('pageerror', lambda e: erreurs.append(str(e)))
    pg2.route('https://docs.getgrist.com/grist-plugin-api.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=mockjs))
    pg2.goto(f'http://localhost:{PORT}/tests/hote.html')
    m = {'tables': {
        'Structures': {'colonnes': {'Nom': {'type': 'Text'}, 'Parent': {'type': 'Ref:Structures'}}, 'lignes': [{'id': 1, 'Nom': 'Rectorat', 'Parent': 0}, {'id': 2, 'Nom': 'Service RH', 'Parent': 1}]},
        'Personnes': {'colonnes': {'Nom': {'type': 'Text'}, 'Structure': {'type': 'Ref:Structures'}, 'Fusionne_dans': {'type': 'Ref:Personnes'}},
          'lignes': [{'id': 1, 'Nom': 'MARTIN Camille', 'Structure': 2, 'Fusionne_dans': 0}, {'id': 2, 'Nom': 'Camille MARTIN', 'Structure': 2, 'Fusionne_dans': 1}, {'id': 3, 'Nom': 'GARCIA Maxime', 'Structure': 1, 'Fusionne_dans': 0}]}},
        'table': 'Personnes', 'utilisateur': {'email': 'a@b.fr', 'nom': 'A'}}
    pg2.evaluate('m => { window.MOCK = m; charger(); }', m)
    f2 = pg2.frame_locator('#w'); f2.locator('.gg-filtre').first.wait_for(); pg2.wait_for_timeout(500); f2.locator('[data-vue=organigramme]').click(); pg2.wait_for_timeout(1200)
    s2 = pg2.evaluate("() => { var w = document.getElementById('w').contentWindow; return w.echarts.getInstanceByDom(w.document.getElementById('gg-graphe')).getOption().series[0]; }")
    nom = {n['id']: n['name'] for n in s2['data']}
    paires = sorted((nom[l['source']], nom[l['target']]) for l in s2['links'] if l.get('lineStyle', {}).get('type') == 'solid')
    verifier('dans Grist : Parent, structure de la personne, doublon fusionné ignoré', ('Rectorat', 'Service RH') in paires and ('Rectorat', 'GARCIA Maxime') in paires
             and not any(a == 'MARTIN Camille' and c == 'Camille MARTIN' for a, c in paires) and any(c == 'Camille MARTIN' and a in ('Service RH', 'MARTIN Camille', 'Camille MARTIN') for a, c in paires))
    print('  traits :', paires)
    verifier('aucune erreur JavaScript', not erreurs)
    if erreurs: print(erreurs)
    b.close()
print(f'{ok} réussis, {ko} échoués'); sys.exit(1 if ko else 0)
