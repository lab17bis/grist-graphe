/*
 * grist-graphe – cartographie des acteurs et de leurs liens, au DSFR.
 *
 * Les acteurs sont les lignes d'une ou plusieurs tables (par exemple Structures et Personnes).
 * Les liens viennent de trois sources :
 *   - une table de liens (par défaut `Liens` : De, Vers, Type, Force, Sens, Note), saisie à la main ;
 *   - les références entre acteurs (une personne rattachée à sa structure, une structure à sa structure mère) ;
 *   - la participation commune (deux membres d'un même groupe, deux personnes présentes à la même rencontre).
 * Trois vues : le graphe (réseau), les positions (influence et intérêt de chaque acteur) et la liste
 * (alternative accessible). Une fiche par acteur montre ses liens, permet d'en ajouter et de trouver
 * le chemin le plus court vers un autre acteur.
 *
 * Hors de Grist, le widget affiche des données fictives et simule les écritures.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Référentiels
  // ---------------------------------------------------------------------------

  var PALETTE = ['#000091', '#009081', '#a558a0', '#e4794a', '#465f9d', '#68a532', '#c3992a', '#ce614a', '#417dc4', '#009099', '#c08c65', '#e18b76'];
  var SYMBOLES = ['roundRect', 'circle', 'diamond', 'triangle'];
  var TYPES_LIENS = ['Coopère avec', 'Fait partie de', 'Accompagne', 'Finance', 'Conseille', 'Influence', 'Partenaire de'];
  var SENS = ['Réciproque', 'À sens unique'];
  var QUADRANTS = [['Associer étroitement', 'Influence forte, intérêt fort'], ['Satisfaire', 'Influence forte, intérêt faible'],
    ['Informer', 'Influence faible, intérêt fort'], ['Surveiller', 'Influence faible, intérêt faible']];
  var COLONNES_TECHNIQUES = /^(id|manualSort|gristHelper_.*|Config_.*|Influence|Interet|Latitude|Longitude)$/;

  var PUBLIC = !!(window.GristPublic && window.GristPublic.actif);
  var DEMO = window.self === window.top && !PUBLIC;
  var options = {};
  var optionsBrutes = {};            // réglages enregistrés avec le widget
  var source = null;                 // accès aux données : Grist ou démonstration
  var meta = { tables: [], colonnes: {}, tableCourante: null };
  var lignes = {};                   // contenu des tables lues
  var acteurs = [], aretes = [], parId = {};
  var positions = {};                // positions calculées par la disposition en force
  var etat = { vue: 'graphe', panneau: 'liste', selection: null, chemin: null, masquesCat: {}, masquesLien: {}, alerte: null, brouillon: null, lienForm: {} };
  var graphe = null;
  var panneau = document.getElementById('gg-panneau');

  // ---------------------------------------------------------------------------
  // Utilitaires
  // ---------------------------------------------------------------------------

  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function num(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }
  function nombre(v) { var n = typeof v === 'number' ? v : parseFloat(String(v === null || v === undefined ? '' : v).replace(',', '.')); return isFinite(n) ? n : null; }
  function cle(t) { return String(t || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function pluriel(n, s, p) { return n + ' ' + (n > 1 ? (p || s + 's') : s); }
  function lignesDepuisColonnes(cols) {
    var ids = cols.id || [], cles = Object.keys(cols), res = [];
    for (var i = 0; i < ids.length; i++) { var l = {}; cles.forEach(function (k) { l[k] = cols[k][i]; }); res.push(l); }
    return res;
  }
  function liste(v) {
    if (v === null || v === undefined || v === '') return [];
    if (Array.isArray(v)) return v[0] === 'L' ? v.slice(1) : v;
    if (typeof v === 'string') return v.split(/[,;\n]+/).map(function (x) { return x.trim(); }).filter(Boolean);
    return [v];
  }
  function colonne(t, c) { return (meta.colonnes[t] || []).filter(function (x) { return x.colId === c; })[0]; }
  function cibleRef(t, c) { var x = colonne(t, c); var m = x && String(x.type).match(/^Ref(?:List)?:(.+)$/); return m ? m[1] : null; }
  function choixColonne(t, c) {
    var x = colonne(t, c); if (!x) return [];
    try { return JSON.parse(x.widgetOptions || '{}').choices || []; } catch (e) { return []; }
  }
  function valeurTexte(t, c, v) {
    if (v === null || v === undefined || v === '') return '';
    var cible = cibleRef(t, c);
    if (cible) return liste(v).map(function (id) { var a = parId[cible + ':' + id]; if (a) return a.nom; var l = (lignes[cible] || []).filter(function (r) { return r.id === id; })[0]; return l ? (l.Nom || l.Titre || l.Libelle || '#' + id) : ''; }).filter(Boolean).join(', ');
    if (Array.isArray(v)) return liste(v).join(', ');
    var x = colonne(t, c);
    if (x && /^Date/.test(x.type) && typeof v === 'number') return new Date(v * 1000).toLocaleDateString('fr-FR', { timeZone: 'UTC' });
    if (typeof v === 'boolean') return v ? 'Oui' : 'Non';
    return String(v);
  }

  // ---------------------------------------------------------------------------
  // Sources de données
  // ---------------------------------------------------------------------------

  function sourceGrist() {
    return {
      meta: function () {
        return Promise.all([grist.docApi.fetchTable('_grist_Tables'), grist.docApi.fetchTable('_grist_Tables_column'),
          grist.selectedTable && grist.selectedTable.getTableId ? grist.selectedTable.getTableId().catch(function () { return null; }) : Promise.resolve(null)])
          .then(function (m) {
            var tables = lignesDepuisColonnes(m[0]), cols = lignesDepuisColonnes(m[1]), parRef = {};
            var res = { tables: [], colonnes: {}, tableCourante: m[2] };
            tables.forEach(function (t) { if (!/^_grist|^GristHidden/.test(t.tableId) && !t.summarySourceTable) { parRef[t.id] = t.tableId; res.tables.push(t.tableId); res.colonnes[t.tableId] = []; } });
            cols.forEach(function (c) { var t = parRef[c.parentId]; if (t && !/^gristHelper_/.test(c.colId)) res.colonnes[t].push({ colId: c.colId, type: c.type, label: c.label || c.colId, isFormula: c.isFormula, widgetOptions: c.widgetOptions }); });
            return res;
          });
      },
      table: function (t) { return grist.docApi.fetchTable(t).then(lignesDepuisColonnes); },
      ecrire: function (actions) { return grist.docApi.applyUserActions(actions); }
    };
  }
  function sourceDemo(json) {
    var doc = JSON.parse(JSON.stringify(json.tables));
    return {
      meta: function () {
        var res = { tables: Object.keys(doc), colonnes: {}, tableCourante: null };
        Object.keys(doc).forEach(function (t) {
          res.colonnes[t] = Object.keys(doc[t].colonnes).map(function (c) {
            var d = doc[t].colonnes[c]; d = typeof d === 'string' ? { type: d } : d;
            return { colId: c, type: d.type, label: d.label || c, widgetOptions: d.choices ? JSON.stringify({ choices: d.choices }) : '' };
          });
        });
        return Promise.resolve(res);
      },
      table: function (t) { return Promise.resolve(JSON.parse(JSON.stringify(doc[t].lignes))); },
      ecrire: function (actions) {
        var ret = [];
        actions.forEach(function (a) {
          if (a[0] === 'AddTable') { doc[a[1]] = { colonnes: {}, lignes: [] }; a[2].forEach(function (c) { doc[a[1]].colonnes[c.id] = { type: c.type, choices: c.widgetOptions ? JSON.parse(c.widgetOptions).choices : null }; }); ret.push(null); return; }
          if (a[0] === 'AddColumn') { doc[a[1]].colonnes[a[2]] = { type: a[3].type }; ret.push(null); return; }
          var t = doc[a[1]].lignes;
          if (a[0] === 'AddRecord') { var id = t.reduce(function (m, l) { return Math.max(m, l.id); }, 0) + 1; t.push(Object.assign({ id: id }, a[3])); ret.push(id); }
          else if (a[0] === 'UpdateRecord') { Object.assign(t.filter(function (l) { return l.id === a[2]; })[0], a[3]); ret.push(null); }
          else if (a[0] === 'BulkUpdateRecord') { a[2].forEach(function (id, i) { var l = t.filter(function (x) { return x.id === id; })[0]; Object.keys(a[3]).forEach(function (k) { l[k] = a[3][k][i]; }); }); ret.push(null); }
          else if (a[0] === 'RemoveRecord') { doc[a[1]].lignes = t.filter(function (l) { return l.id !== a[2]; }); ret.push(null); }
        });
        return Promise.resolve({ retValues: ret });
      }
    };
  }

  // Réglages par défaut : tables d'acteurs, table de liens et références détectées dans le document.
  function optionsCompletes(o) {
    o = JSON.parse(JSON.stringify(o || {}));
    if (!Array.isArray(o.acteurs) || !o.acteurs.length) {
      o.acteurs = ['Structures', 'Personnes', 'Acteurs', 'Partenaires'].filter(function (t) { return colonne(t, 'Nom'); }).map(function (t) {
        var type = ['Type', 'Fonction', 'Role', 'Categorie'].filter(function (c) { return colonne(t, c); })[0] || '';
        return { table: t, nom: 'Nom', type: type, libelle: t };
      });
    }
    if (o.liens === undefined) o.liens = meta.tables.indexOf('Liens') >= 0 ? 'Liens' : '';
    if (o.appartenance === undefined) o.appartenance = true;
    if (!Array.isArray(o.participations)) o.participations = [];
    o.couleurPar = o.couleurPar || 'categorie';
    o.taillePar = o.taillePar || 'liens';
    if (o.etiquettes === undefined) o.etiquettes = true;
    o.masquerIsoles = !!o.masquerIsoles;
    o.titre = o.titre || '';
    return o;
  }

  function charger() {
    return source.meta().then(function (m) {
      meta = m;
      options = optionsCompletes(optionsBrutes);
      var tables = {};
      options.acteurs.forEach(function (a) { tables[a.table] = 1; });
      if (options.liens) tables[options.liens] = 1;
      options.participations.forEach(function (p) { tables[p.table] = 1; });
      // Tables cibles des références (libellés)
      Object.keys(tables).forEach(function (t) { (meta.colonnes[t] || []).forEach(function (c) { var x = cibleRef(t, c.colId); if (x) tables[x] = 1; }); });
      return Promise.all(Object.keys(tables).filter(function (t) { return meta.tables.indexOf(t) >= 0; }).map(function (t) {
        return source.table(t).then(function (r) { lignes[t] = r; }).catch(function () { lignes[t] = []; });
      }));
    }).then(construire);
  }

  // ---------------------------------------------------------------------------
  // Construction du graphe
  // ---------------------------------------------------------------------------

  function construire() {
    acteurs = []; aretes = []; parId = {};
    var parNom = {};
    options.acteurs.forEach(function (a, i) {
      (lignes[a.table] || []).forEach(function (r) {
        var nom = String(r[a.nom] === null || r[a.nom] === undefined ? '' : r[a.nom]).trim();
        if (!nom) return;
        var x = { id: a.table + ':' + r.id, table: a.table, rowId: r.id, nom: nom, categorie: a.libelle || a.table, rangCat: i, ligne: r,
          type: a.type ? valeurTexte(a.table, a.type, r[a.type]) : '', influence: nombre(r.Influence), interet: nombre(r.Interet) };
        acteurs.push(x); parId[x.id] = x;
        if (!parNom[cle(nom)]) parNom[cle(nom)] = x;
      });
    });
    function trouver(v, t, c) {
      if (v === null || v === undefined || v === '') return null;
      var cible = cibleRef(t, c);
      if (cible && typeof v === 'number') return parId[cible + ':' + v] || null;
      return parNom[cle(v)] || null;
    }
    // 1. Table de liens
    if (options.liens && lignes[options.liens]) {
      lignes[options.liens].forEach(function (l) {
        var s = trouver(l.De, options.liens, 'De'), t = trouver(l.Vers, options.liens, 'Vers');
        if (!s || !t || s === t) return;
        aretes.push({ id: 'L' + l.id, rowId: l.id, source: s, target: t, genre: 'lien', type: String(l.Type || 'Lien'), force: Math.max(1, Math.min(3, nombre(l.Force) || 1)), sens: l.Sens === 'À sens unique' ? 'unique' : 'reciproque', note: l.Note || '' });
      });
    }
    // 2. Références entre acteurs (rattachement)
    if (options.appartenance) {
      options.acteurs.forEach(function (a) {
        (meta.colonnes[a.table] || []).forEach(function (c) {
          var cible = cibleRef(a.table, c.colId);
          if (!cible || !options.acteurs.some(function (b) { return b.table === cible; }) || c.colId === a.type) return;
          (lignes[a.table] || []).forEach(function (r) {
            var s = parId[a.table + ':' + r.id];
            liste(r[c.colId]).forEach(function (id) {
              var t = parId[cible + ':' + id];
              if (s && t && s !== t) aretes.push({ id: 'A' + a.table + r.id + c.colId + id, source: s, target: t, genre: 'appartenance', type: c.label || c.colId, force: 2, sens: 'unique', note: '' });
            });
          });
        });
      });
    }
    // 3. Participation commune : membres d'une même ligne, ou de lignes qui partagent la même valeur de regroupement.
    options.participations.forEach(function (p, k) {
      var groupes = {};
      (lignes[p.table] || []).forEach(function (r) {
        var g = p.groupe ? JSON.stringify(r[p.groupe]) : 'r' + r.id;
        // Condition facultative : { colonne, valeur, operateur: 'egal' (par défaut) ou 'different' }.
        if (p.condition && p.condition.colonne) {
          var egal = String(r[p.condition.colonne]) === String(p.condition.valeur);
          if (p.condition.operateur === 'different' ? egal : !egal) return;
        }
        var etiquette = p.groupe ? valeurTexte(p.table, p.groupe, r[p.groupe]) : String(r.Nom || r.Titre || r.Libelle || '#' + r.id);
        groupes[g] = groupes[g] || { etiquette: etiquette, membres: {} };
        liste(r[p.membres]).forEach(function (v) { var x = trouver(v, p.table, p.membres); if (x) groupes[g].membres[x.id] = x; });
      });
      var paires = {};
      Object.keys(groupes).forEach(function (g) {
        var m = Object.keys(groupes[g].membres).sort();
        for (var i = 0; i < m.length; i++) for (var j = i + 1; j < m.length; j++) {
          var c = m[i] + '|' + m[j];
          paires[c] = paires[c] || { source: parId[m[i]], target: parId[m[j]], via: [] };
          paires[c].via.push(groupes[g].etiquette);
        }
      });
      Object.keys(paires).forEach(function (c) {
        var x = paires[c];
        aretes.push({ id: 'P' + k + c, source: x.source, target: x.target, genre: 'participation', cleGenre: 'participation' + k, type: p.libelle || 'Participation commune',
          force: Math.min(3, x.via.length), sens: 'reciproque', note: x.via.join(', '), via: x.via });
      });
    });
    if (etat.selection && !parId[etat.selection]) { etat.selection = null; etat.panneau = 'liste'; }
  }

  function cleLien(a) { return a.genre === 'lien' ? 'lien:' + a.type : a.genre === 'appartenance' ? 'appartenance' : a.cleGenre; }
  function libelleCleLien(k) {
    if (k.indexOf('lien:') === 0) return k.slice(5);
    if (k === 'appartenance') return 'Rattachements';
    var p = options.participations[num(k.replace('participation', ''))];
    return p ? (p.libelle || 'Participation commune') : k;
  }
  function aretesVisibles() {
    return aretes.filter(function (a) {
      return !etat.masquesLien[cleLien(a)] && !etat.masquesCat[a.source.categorie] && !etat.masquesCat[a.target.categorie];
    });
  }
  function degres(ar) { var d = {}; ar.forEach(function (a) { d[a.source.id] = (d[a.source.id] || 0) + 1; d[a.target.id] = (d[a.target.id] || 0) + 1; }); return d; }
  function acteursVisibles(ar) {
    var d = degres(ar);
    return acteurs.filter(function (x) { return !etat.masquesCat[x.categorie] && (!options.masquerIsoles || d[x.id]); });
  }
  function voisins(x, ar) {
    return (ar || aretes).filter(function (a) { return a.source === x || a.target === x; });
  }
  // Chemin le plus court (en nombre de liens) parmi les liens visibles.
  function chemin(depart, arrivee) {
    var ar = aretesVisibles(), adj = {};
    ar.forEach(function (a) { (adj[a.source.id] = adj[a.source.id] || []).push([a.target.id, a]); (adj[a.target.id] = adj[a.target.id] || []).push([a.source.id, a]); });
    var prec = {}, file = [depart.id], vu = {}; vu[depart.id] = 1;
    while (file.length) {
      var c = file.shift();
      if (c === arrivee.id) break;
      (adj[c] || []).forEach(function (v) { if (!vu[v[0]]) { vu[v[0]] = 1; prec[v[0]] = [c, v[1]]; file.push(v[0]); } });
    }
    if (!vu[arrivee.id]) return null;
    var noeuds = [arrivee.id], liens = [], x = arrivee.id;
    while (x !== depart.id) { liens.unshift(prec[x][1]); x = prec[x][0]; noeuds.unshift(x); }
    return { noeuds: noeuds, aretes: liens };
  }

  // ---------------------------------------------------------------------------
  // Couleurs et tailles
  // ---------------------------------------------------------------------------

  function groupesCouleur() {
    var g = [];
    acteurs.forEach(function (x) { var k = options.couleurPar === 'type' ? (x.type || 'Sans type') : x.categorie; if (g.indexOf(k) < 0) g.push(k); });
    return g;
  }
  function couleurDe(x, g) { var k = options.couleurPar === 'type' ? (x.type || 'Sans type') : x.categorie; return PALETTE[g.indexOf(k) % PALETTE.length]; }
  function tailleDe(x, d) {
    if (options.taillePar === 'influence' && x.influence !== null) return 14 + Math.max(0, Math.min(5, x.influence)) * 6;
    return Math.min(46, 12 + Math.sqrt(d[x.id] || 0) * 7);
  }

  // ---------------------------------------------------------------------------
  // Vues principales : graphe, positions, liste
  // ---------------------------------------------------------------------------

  function texteCss(nom) { return getComputedStyle(document.documentElement).getPropertyValue(nom).trim() || '#161616'; }

  function calculerPositions() {
    // Disposition en force sur tous les acteurs et tous les liens, calculée une fois puis conservée :
    // filtrer ou sélectionner ne fait pas bouger le graphe.
    var tmp = echarts.init(document.createElement('div'), null, { width: 1000, height: 700 });
    var d = degres(aretes);
    tmp.setOption({ animation: false, series: [{ type: 'graph', layout: 'force', layoutAnimation: false, force: { repulsion: 260, edgeLength: [50, 150], gravity: 0.08, friction: 0.2 },
      data: acteurs.map(function (x) { return { id: x.id, name: x.id, symbolSize: tailleDe(x, d) }; }),
      links: aretes.map(function (a) { return { source: a.source.id, target: a.target.id }; }) }] });
    var donnees = tmp.getModel().getSeriesByIndex(0).getData();
    positions = {};
    for (var i = 0; i < donnees.count(); i++) {
      var p = donnees.getItemLayout(i);
      if (p && isFinite(p[0])) positions[donnees.getId(i)] = [p[0], p[1]];
    }
    tmp.dispose();
  }

  function optionGraphe() {
    var ar = aretesVisibles(), xs = acteursVisibles(ar), d = degres(ar), g = groupesCouleur();
    if (xs.some(function (x) { return !positions[x.id]; })) calculerPositions();
    var ids = {}; xs.forEach(function (x) { ids[x.id] = 1; });
    var sel = etat.selection ? parId[etat.selection] : null, ch = etat.chemin;
    var dansChemin = {}, liensChemin = {};
    if (ch) { ch.noeuds.forEach(function (n) { dansChemin[n] = 1; }); ch.aretes.forEach(function (a) { liensChemin[a.id] = 1; }); }
    var proches = {};
    if (sel && !ch) { proches[sel.id] = 1; voisins(sel, ar).forEach(function (a) { proches[a.source.id] = 1; proches[a.target.id] = 1; }); }
    var focus = ch ? dansChemin : sel ? proches : null;
    var couleurTexte = texteCss('--text-default-grey');
    return {
      animationDurationUpdate: 300,
      tooltip: { confine: true, formatter: function (p) {
        if (p.dataType === 'node') { var x = parId[p.data.id]; return '<strong>' + esc(x.nom) + '</strong><br>' + esc([x.categorie, x.type].filter(Boolean).join(' · ')) + '<br>' + pluriel(d[x.id] || 0, 'lien'); }
        var a = p.data.arete; return esc(a.source.nom) + ' – ' + esc(a.target.nom) + '<br><strong>' + esc(a.type) + '</strong>' + (a.note ? '<br>' + esc(a.note) : '');
      } },
      series: [{
        type: 'graph', layout: 'none', roam: true, draggable: true, scaleLimit: { min: 0.2, max: 6 },
        label: { show: true, position: 'right', fontFamily: 'Marianne, arial, sans-serif', fontSize: 11, color: couleurTexte },
        labelLayout: { hideOverlap: true },
        emphasis: { focus: 'adjacency', lineStyle: { width: 4 } },
        edgeSymbolSize: [0, 8],
        data: xs.map(function (x) {
          var actif = focus ? !!focus[x.id] : true, c = couleurDe(x, g);
          return { id: x.id, name: x.nom, x: positions[x.id][0], y: positions[x.id][1], symbol: SYMBOLES[x.rangCat % SYMBOLES.length], symbolSize: tailleDe(x, d),
            itemStyle: { color: c, opacity: actif ? 1 : 0.15, borderColor: x.id === etat.selection ? couleurTexte : '#fff', borderWidth: x.id === etat.selection ? 3 : 1 },
            label: { show: options.etiquettes ? actif : (x.id === etat.selection || (focus && focus[x.id])), fontWeight: x.id === etat.selection ? 'bold' : 'normal', opacity: actif ? 1 : 0.3 } };
        }),
        links: ar.filter(function (a) { return ids[a.source.id] && ids[a.target.id]; }).map(function (a) {
          var actif = ch ? !!liensChemin[a.id] : sel ? (a.source === sel || a.target === sel) : true;
          return { source: a.source.id, target: a.target.id, arete: a, symbol: a.sens === 'unique' ? ['none', 'arrow'] : ['none', 'none'],
            lineStyle: { width: a.force * 1.4 + (ch && actif ? 2 : 0), type: a.genre === 'participation' ? 'dashed' : a.genre === 'appartenance' ? 'dotted' : 'solid',
              color: actif && (sel || ch) ? '#000091' : '#929292', opacity: actif ? (sel || ch ? 0.9 : 0.55) : 0.08, curveness: 0.08 } };
        })
      }]
    };
  }

  function optionPositions() {
    var xs = acteursVisibles(aretesVisibles()).filter(function (x) { return x.influence !== null && x.interet !== null; }), g = groupesCouleur();
    var max = Math.max(5, xs.reduce(function (m, x) { return Math.max(m, x.influence, x.interet); }, 0)), mil = max / 2;
    var vus = {}, couleurTexte = texteCss('--text-default-grey'), mention = texteCss('--text-mention-grey');
    var data = xs.map(function (x) {
      var k = x.interet + ',' + x.influence, n = vus[k] = (vus[k] || 0) + 1;
      var dx = n > 1 ? Math.cos(n * 2.1) * 0.12 * Math.ceil(n / 3) : 0, dy = n > 1 ? Math.sin(n * 2.1) * 0.12 * Math.ceil(n / 3) : 0;
      return { value: [x.interet + dx, x.influence + dy], id: x.id, name: x.nom, symbol: SYMBOLES[x.rangCat % SYMBOLES.length],
        itemStyle: { color: couleurDe(x, g), borderColor: x.id === etat.selection ? couleurTexte : '#fff', borderWidth: x.id === etat.selection ? 3 : 1 } };
    });
    var zone = function (x1, y1, x2, y2, q) {
      return [{ xAxis: x1, yAxis: y1, name: q[0], itemStyle: { color: 'transparent', borderColor: mention, borderType: 'dashed', borderWidth: 1 },
        label: { position: 'insideTopLeft', color: mention, fontWeight: 'bold', fontSize: 12, fontFamily: 'Marianne, arial, sans-serif' } }, { xAxis: x2, yAxis: y2 }];
    };
    var axe = function (nom) { return { type: 'value', min: 0, max: max, interval: 1, name: nom, nameLocation: 'middle', nameGap: 30, nameTextStyle: { color: couleurTexte, fontWeight: 'bold', fontFamily: 'Marianne, arial, sans-serif' },
      splitLine: { show: false }, axisLine: { lineStyle: { color: mention } }, axisLabel: { color: mention } }; };
    return {
      grid: { left: 56, right: 140, top: 24, bottom: 56 },
      tooltip: { formatter: function (p) { var x = parId[p.data.id]; return x ? '<strong>' + esc(x.nom) + '</strong><br>Influence : ' + x.influence + ' · Intérêt : ' + x.interet : ''; } },
      xAxis: axe('Intérêt pour le projet'), yAxis: axe('Influence'),
      series: [{ type: 'scatter', symbolSize: 16, data: data, clip: false,
        label: { show: true, position: 'right', formatter: '{b}', fontSize: 11, color: couleurTexte, fontFamily: 'Marianne, arial, sans-serif' }, labelLayout: { hideOverlap: true },
        markArea: { silent: true, data: [zone(mil, max, max, mil, QUADRANTS[0]), zone(0, max, mil, mil, QUADRANTS[1]), zone(mil, mil, max, 0, QUADRANTS[2]), zone(0, mil, mil, 0, QUADRANTS[3])] } }]
    };
  }

  function vueListeHtml() {
    var ar = aretesVisibles(), xs = acteursVisibles(ar), d = degres(ar);
    var tri = xs.slice().sort(function (a, b) { return (d[b.id] || 0) - (d[a.id] || 0) || a.nom.localeCompare(b.nom, 'fr'); });
    function tableau(titre, entetes, corps) {
      return '<div class="fr-table fr-table--sm fr-table--no-caption"><div class="fr-table__wrapper"><div class="fr-table__container"><div class="fr-table__content"><table><caption>' + esc(titre) + '</caption><thead><tr>' +
        entetes.map(function (e) { return '<th scope="col">' + e + '</th>'; }).join('') + '</tr></thead><tbody>' + corps + '</tbody></table></div></div></div></div>';
    }
    var bouton = function (x) { return '<button type="button" class="fr-link fr-text--sm" data-acteur="' + esc(x.id) + '">' + esc(x.nom) + '</button>'; };
    return '<div class="gg-liste-vue"><h2 class="fr-h6">Acteurs (' + xs.length + ')</h2>' +
      tableau('Acteurs, du plus connecté au moins connecté', ['Acteur', 'Catégorie', 'Type', 'Liens', 'Influence', 'Intérêt'], tri.map(function (x) {
        return '<tr><td>' + bouton(x) + '</td><td>' + esc(x.categorie) + '</td><td>' + esc(x.type) + '</td><td>' + (d[x.id] || 0) + '</td><td>' + (x.influence === null ? '' : x.influence) + '</td><td>' + (x.interet === null ? '' : x.interet) + '</td></tr>';
      }).join('')) +
      '<h2 class="fr-h6 fr-mt-3w">Liens (' + ar.length + ')</h2>' +
      tableau('Liens entre acteurs', ['De', 'Nature du lien', 'Vers', 'Force', 'Précision'], ar.map(function (a) {
        return '<tr><td>' + bouton(a.source) + '</td><td>' + esc(a.type) + (a.sens === 'unique' ? ' →' : '') + '</td><td>' + bouton(a.target) + '</td><td>' + a.force + '</td><td>' + esc(a.note) + '</td></tr>';
      }).join('')) + '</div>';
  }

  function rendreVue() {
    if (etat.configOuverte) return;   // la vue est masquée pendant la configuration
    document.querySelectorAll('[data-vue]').forEach(function (b) { var actif = b.getAttribute('data-vue') === etat.vue; b.classList.toggle('fr-btn--secondary', !actif); b.setAttribute('aria-pressed', String(actif)); });
    var zone = document.getElementById('gg-graphe'), liste = document.getElementById('gg-liste'), info = document.getElementById('gg-info');
    info.innerHTML = '';
    if (etat.vue === 'liste') { zone.hidden = true; liste.hidden = false; liste.innerHTML = vueListeHtml(); return; }
    liste.hidden = true; zone.hidden = false;
    if (!graphe) {
      graphe = echarts.init(zone, null, { locale: 'FR', renderer: 'canvas' });
      graphe.on('click', function (p) {
        var id = p.data && p.data.id;
        if (id && parId[id]) selectionner(id, true);
      });
      window.addEventListener('resize', function () { if (!etat.configOuverte) graphe.resize(); });
    }
    if (etat.vue === 'positions') {
      var avec = acteurs.filter(function (x) { return x.influence !== null && x.interet !== null; }).length;
      if (!avec) {
        graphe.clear();
        var manque = options.acteurs.filter(function (a) { return !colonne(a.table, 'Influence') || !colonne(a.table, 'Interet'); });
        info.innerHTML = '<div class="fr-callout gg-callout"><h2 class="fr-callout__title fr-h6">Positionner les acteurs</h2><p class="fr-callout__text fr-text--sm">Cette vue place chaque acteur selon son <strong>influence</strong> et son <strong>intérêt</strong> pour votre projet (de 0 à 5), pour savoir qui associer, informer ou consulter. ' +
          (manque.length ? 'Ajoutez les colonnes <code>Influence</code> et <code>Interet</code> aux tables d\'acteurs, puis notez les acteurs dans leur fiche.' : 'Notez les acteurs dans leur fiche (colonnes Influence et Interet).') + '</p>' +
          (manque.length ? '<button type="button" class="fr-btn fr-btn--sm" data-action="ajouter-colonnes">Ajouter les colonnes à ' + manque.map(function (a) { return esc(a.table); }).join(' et ') + '</button>' : '') + '</div>';
        return;
      }
      graphe.resize();
      graphe.setOption(optionPositions(), true);
      info.innerHTML = '<p class="fr-text--xs gg-legende-positions">' + pluriel(avec, 'acteur positionné', 'acteurs positionnés') + ' sur ' + acteurs.length + '. Les acteurs sans influence ou intérêt renseignés n\'apparaissent pas.</p>';
      return;
    }
    if (!acteurs.length) { graphe.clear(); info.innerHTML = '<div class="fr-callout gg-callout"><p class="fr-callout__text fr-text--sm">Aucun acteur à afficher. Choisissez les tables d\'acteurs dans les réglages.</p></div>'; return; }
    graphe.resize();
    graphe.setOption(optionGraphe(), true);
  }

  // ---------------------------------------------------------------------------
  // Panneau : filtres, fiche, réglages
  // ---------------------------------------------------------------------------

  function blocAlerte() {
    if (!etat.alerte) return '';
    return '<div class="fr-alert fr-alert--sm fr-alert--' + etat.alerte.type + ' gg-alerte" role="' + (etat.alerte.type === 'error' ? 'alert' : 'status') + '"><p>' + esc(etat.alerte.texte) + '</p></div>';
  }
  function pastille(couleur, cat) {
    var i = options.acteurs.findIndex(function (a) { return (a.libelle || a.table) === cat; });
    return '<span class="gg-pastille gg-pastille--' + (SYMBOLES[(i < 0 ? 1 : i) % SYMBOLES.length]) + '" style="background:' + couleur + '" aria-hidden="true"></span>';
  }
  function champActeur(id, lib, val) {
    return '<div class="fr-input-group"><label class="fr-label" for="' + id + '">' + esc(lib) + '</label><input class="fr-input" id="' + id + '" list="gg-noms" value="' + esc(val || '') + '" autocomplete="off"></div>';
  }
  function datalist() {
    return '<datalist id="gg-noms">' + acteurs.slice().sort(function (a, b) { return a.nom.localeCompare(b.nom, 'fr'); }).map(function (x) { return '<option value="' + esc(x.nom) + '">' + esc(x.categorie) + '</option>'; }).join('') + '</datalist>';
  }
  function acteurParNom(n) { var k = cle(n); return acteurs.filter(function (x) { return cle(x.nom) === k; })[0]; }

  function vueFiltres() {
    var ar = aretesVisibles(), d = degres(ar), xs = acteursVisibles(ar), g = groupesCouleur();
    var cats = [], liens = [];
    acteurs.forEach(function (x) { if (cats.indexOf(x.categorie) < 0) cats.push(x.categorie); });
    aretes.forEach(function (a) { var k = cleLien(a); if (liens.indexOf(k) < 0) liens.push(k); });
    var isoles = xs.filter(function (x) { return !d[x.id]; }).length;
    var top = xs.filter(function (x) { return d[x.id]; }).sort(function (a, b) { return d[b.id] - d[a.id]; }).slice(0, 5);
    var h = (options.titre ? '<h1 class="fr-h5 gg-titre">' + esc(options.titre) + '</h1>' : '<h1 class="fr-sr-only">Liens entre acteurs</h1>') + blocAlerte() +
      '<form class="gg-trouver" data-form="trouver">' + champActeur('gg-q', 'Trouver un acteur', '') + '<button type="submit" class="fr-btn fr-btn--sm fr-btn--secondary">Afficher</button></form>' +
      '<fieldset class="fr-fieldset gg-filtre"><legend class="fr-fieldset__legend fr-text--md">Acteurs</legend>' + cats.map(function (c, i) {
        var n = acteurs.filter(function (x) { return x.categorie === c; }).length;
        var couleur = options.couleurPar === 'type' ? '#929292' : PALETTE[g.indexOf(c) % PALETTE.length];
        return '<div class="fr-fieldset__element"><div class="fr-checkbox-group fr-checkbox-group--sm"><input type="checkbox" id="gg-c' + i + '" data-cat="' + esc(c) + '"' + (etat.masquesCat[c] ? '' : ' checked') + '>' +
          '<label class="fr-label" for="gg-c' + i + '">' + pastille(couleur, c) + esc(c) + ' <span class="gg-compte">(' + n + ')</span></label></div></div>';
      }).join('') + '</fieldset>';
    if (options.couleurPar === 'type') {
      h += '<ul class="gg-legende-types">' + g.map(function (t, i) { return '<li><span class="gg-pastille" style="background:' + PALETTE[i % PALETTE.length] + '" aria-hidden="true"></span>' + esc(t) + '</li>'; }).join('') + '</ul>';
    }
    if (liens.length) {
      h += '<fieldset class="fr-fieldset gg-filtre"><legend class="fr-fieldset__legend fr-text--md">Liens</legend>' + liens.map(function (k, i) {
        var n = aretes.filter(function (a) { return cleLien(a) === k; }).length, trait = k === 'appartenance' ? 'dotted' : k.indexOf('participation') === 0 ? 'dashed' : 'solid';
        return '<div class="fr-fieldset__element"><div class="fr-checkbox-group fr-checkbox-group--sm"><input type="checkbox" id="gg-l' + i + '" data-lien="' + esc(k) + '"' + (etat.masquesLien[k] ? '' : ' checked') + '>' +
          '<label class="fr-label" for="gg-l' + i + '"><span class="gg-trait gg-trait--' + trait + '" aria-hidden="true"></span>' + esc(libelleCleLien(k)) + ' <span class="gg-compte">(' + n + ')</span></label></div></div>';
      }).join('') + '</fieldset>';
    }
    h += '<p class="gg-compte" aria-live="polite">' + pluriel(xs.length, 'acteur') + ' · ' + pluriel(ar.length, 'lien') + (isoles ? ' · ' + pluriel(isoles, 'acteur isolé', 'acteurs isolés') : '') + '</p>';
    if (top.length) h += '<h2 class="fr-h6 fr-mt-2w">Les plus connectés</h2><ol class="gg-top">' + top.map(function (x) { return '<li><button type="button" class="fr-link fr-text--sm" data-acteur="' + esc(x.id) + '">' + esc(x.nom) + '</button> <span class="gg-compte">' + d[x.id] + '</span></li>'; }).join('') + '</ol>';
    if (!options.liens) h += '<div class="gg-encart"><p class="fr-text--sm fr-mb-1w">Pas encore de table de liens : créez-la pour saisir les liens entre acteurs (coopère avec, finance, conseille…).</p><button type="button" class="fr-btn fr-btn--sm" data-action="creer-liens">Créer la table Liens</button></div>';
    return h + datalist();
  }

  function vueFiche(x) {
    var ar = aretesVisibles(), mes = voisins(x, ar), g = groupesCouleur();
    var cols = (meta.colonnes[x.table] || []).filter(function (c) {
      var a = options.acteurs.filter(function (b) { return b.table === x.table; })[0];
      return !COLONNES_TECHNIQUES.test(c.colId) && c.colId !== (a && a.nom) && !/^(Attachments|ManualSortPos)/.test(c.type);
    });
    var infos = cols.map(function (c) { return [c.label, valeurTexte(x.table, c.colId, x.ligne[c.colId])]; }).filter(function (i) { return i[1]; }).slice(0, 10);
    var parType = {};
    mes.forEach(function (a) { (parType[a.type] = parType[a.type] || []).push(a); });
    var types = choixColonne(options.liens, 'Type'); if (!types.length) types = TYPES_LIENS;
    var f = etat.lienForm;
    var h = '<p class="gg-retour"><button type="button" class="fr-btn fr-btn--sm fr-btn--tertiary-no-outline fr-icon-arrow-left-line fr-btn--icon-left" data-action="retour">Retour</button></p>' + blocAlerte() +
      '<p class="gg-fiche__cat">' + pastille(couleurDe(x, g), x.categorie) + esc(x.categorie) + (x.type ? ' · ' + esc(x.type) : '') + '</p>' +
      '<h2 class="fr-h5" id="gg-fiche-titre" tabindex="-1">' + esc(x.nom) + '</h2>' +
      (infos.length ? '<dl class="gg-infos">' + infos.map(function (i) { return '<dt>' + esc(i[0]) + '</dt><dd>' + esc(i[1]) + '</dd>'; }).join('') + '</dl>' : '');
    if (colonne(x.table, 'Influence') && colonne(x.table, 'Interet')) {
      h += '<div class="gg-notes">' + ['Influence', 'Interet'].map(function (c) {
        var v = x.ligne[c], lib = c === 'Interet' ? 'Intérêt' : c;
        return '<div class="fr-select-group"><label class="fr-label" for="gg-n-' + c + '">' + lib + '</label><select class="fr-select fr-select--sm" id="gg-n-' + c + '" data-note="' + c + '"><option value="">–</option>' +
          [0, 1, 2, 3, 4, 5].map(function (n) { return '<option' + (v === n ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></div>';
      }).join('') + '</div>';
    }
    h += '<h3 class="fr-h6 fr-mt-2w">Liens (' + mes.length + ')</h3>';
    if (!mes.length) h += '<p class="fr-text--sm">Aucun lien visible.</p>';
    Object.keys(parType).sort().forEach(function (t) {
      h += '<p class="gg-type-lien">' + esc(t) + '</p><ul class="gg-voisins">' + parType[t].map(function (a) {
        var autre = a.source === x ? a.target : a.source, fleche = a.sens === 'unique' ? (a.source === x ? '→ ' : '← ') : '';
        return '<li><span>' + fleche + '<button type="button" class="fr-link fr-text--sm" data-acteur="' + esc(autre.id) + '">' + esc(autre.nom) + '</button>' +
          (a.genre === 'participation' ? ' <span class="gg-compte">' + esc(a.note) + '</span>' : a.note ? ' <span class="gg-compte">' + esc(a.note) + '</span>' : '') + '</span>' +
          (a.genre === 'lien' ? '<button type="button" class="fr-btn fr-btn--sm fr-btn--tertiary-no-outline fr-icon-delete-line gg-suppr" title="Supprimer le lien avec ' + esc(autre.nom) + '" data-supprimer-lien="' + a.rowId + '">Supprimer le lien avec ' + esc(autre.nom) + '</button>' : '') + '</li>';
      }).join('') + '</ul>';
    });
    if (options.liens) {
      h += '<details class="gg-details"' + (f.ouvert ? ' open' : '') + '><summary>Ajouter un lien</summary><form data-form="lien" class="gg-form-lien">' +
        champActeur('gg-vers', 'Avec', f.vers) +
        '<div class="fr-select-group"><label class="fr-label" for="gg-type">Nature du lien</label><select class="fr-select fr-select--sm" id="gg-type">' + types.map(function (t) { return '<option' + (t === f.type ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') + '</select></div>' +
        '<div class="fr-select-group"><label class="fr-label" for="gg-force">Force</label><select class="fr-select fr-select--sm" id="gg-force"><option value="1">1 – faible</option><option value="2" selected>2 – moyenne</option><option value="3">3 – forte</option></select></div>' +
        '<div class="fr-select-group"><label class="fr-label" for="gg-sens">Sens</label><select class="fr-select fr-select--sm" id="gg-sens">' + SENS.map(function (s) { return '<option>' + s + '</option>'; }).join('') + '</select></div>' +
        '<div class="fr-input-group"><label class="fr-label" for="gg-note">Précision<span class="fr-hint-text">Facultatif</span></label><input class="fr-input" id="gg-note"></div>' +
        '<button type="submit" class="fr-btn fr-btn--sm">Ajouter le lien</button></form></details>';
    }
    h += '<details class="gg-details"' + (etat.chemin ? ' open' : '') + '><summary>Trouver un chemin</summary><form data-form="chemin" class="gg-form-lien">' + champActeur('gg-vers-chemin', 'Jusqu\'à', etat.cheminVers || '') +
      '<button type="submit" class="fr-btn fr-btn--sm fr-btn--secondary">Chercher</button></form>' +
      (etat.chemin ? '<ol class="gg-chemin" aria-live="polite">' + etat.chemin.noeuds.map(function (n, i) {
        var a = etat.chemin.aretes[i];
        return '<li>' + esc(parId[n].nom) + (a ? ' <span class="gg-compte">(' + esc(a.type) + ')</span>' : '') + '</li>';
      }).join('') + '</ol><button type="button" class="fr-btn fr-btn--sm fr-btn--tertiary-no-outline" data-action="effacer-chemin">Effacer le chemin</button>' : etat.cheminVide ? '<p class="fr-text--sm" aria-live="polite">Aucun chemin entre ces deux acteurs avec les liens affichés.</p>' : '') + '</details>';
    return h + datalist();
  }

  function vueReglages() {
    var b = etat.brouillon = etat.brouillon || JSON.parse(JSON.stringify(options));
    var tables = meta.tables.filter(function (t) { return colonne(t, 'Nom') || (meta.colonnes[t] || []).length; });
    function selCol(id, t, val, chemin, vide) {
      return '<select class="fr-select fr-select--sm" id="' + id + '" data-reglage="' + chemin + '">' + (vide ? '<option value="">' + vide + '</option>' : '') +
        (meta.colonnes[t] || []).map(function (c) { return '<option value="' + esc(c.colId) + '"' + (c.colId === val ? ' selected' : '') + '>' + esc(c.label) + '</option>'; }).join('') + '</select>';
    }
    var h = '<p class="gg-retour"><button type="button" class="fr-btn fr-btn--sm fr-btn--tertiary-no-outline fr-icon-arrow-left-line fr-btn--icon-left" data-action="retour">Retour</button></p>' +
      '<h2 class="fr-h5" id="gg-reglages-titre" tabindex="-1">Réglages</h2>' + blocAlerte() +
      '<p class="fr-text--xs">' + (DEMO ? 'Démonstration : essayez les réglages, ils ne sont pas enregistrés.' : 'Les réglages sont propres à cette vue et enregistrés avec le widget.') + '</p>' +
      '<div class="fr-input-group"><label class="fr-label" for="rg-titre">Titre</label><input class="fr-input" id="rg-titre" data-reglage="titre" value="' + esc(b.titre) + '"></div>' +
      '<h3 class="fr-h6">Tables d\'acteurs</h3><p class="fr-text--xs">Chaque ligne d\'une table cochée devient un acteur.</p>';
    tables.forEach(function (t, i) {
      var a = b.acteurs.filter(function (x) { return x.table === t; })[0];
      h += '<div class="gg-reglage-table"><div class="fr-checkbox-group fr-checkbox-group--sm"><input type="checkbox" id="rg-t' + i + '" data-table-acteur="' + esc(t) + '"' + (a ? ' checked' : '') + '><label class="fr-label" for="rg-t' + i + '">' + esc(t) + '</label></div>';
      if (a) {
        var k = b.acteurs.indexOf(a);
        h += '<div class="gg-reglage-cols"><div class="fr-select-group"><label class="fr-label" for="rg-n' + i + '">Nom</label>' + selCol('rg-n' + i, t, a.nom, 'acteurs.' + k + '.nom') + '</div>' +
          '<div class="fr-select-group"><label class="fr-label" for="rg-ty' + i + '">Type</label>' + selCol('rg-ty' + i, t, a.type, 'acteurs.' + k + '.type', 'Aucun') + '</div>' +
          '<div class="fr-input-group"><label class="fr-label" for="rg-l' + i + '">Libellé</label><input class="fr-input fr-input--sm" id="rg-l' + i + '" data-reglage="acteurs.' + k + '.libelle" value="' + esc(a.libelle || t) + '"></div></div>';
      }
      h += '</div>';
    });
    h += '<h3 class="fr-h6 fr-mt-2w">Liens</h3>' +
      '<div class="fr-select-group"><label class="fr-label" for="rg-liens">Table des liens<span class="fr-hint-text">Colonnes De, Vers, Type, Force, Sens, Note</span></label><select class="fr-select fr-select--sm" id="rg-liens" data-reglage="liens"><option value="">Aucune</option>' +
      meta.tables.map(function (t) { return '<option' + (t === b.liens ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') + '</select></div>' +
      '<div class="fr-checkbox-group fr-checkbox-group--sm"><input type="checkbox" id="rg-app" data-reglage="appartenance"' + (b.appartenance ? ' checked' : '') + '><label class="fr-label" for="rg-app">Rattachements<span class="fr-hint-text">Les références entre acteurs deviennent des liens (une personne et sa structure, par exemple).</span></label></div>' +
      '<p class="fr-text--sm fr-mt-2w fr-mb-1w"><strong>Participation commune</strong></p><p class="fr-text--xs">Deux acteurs cités dans la même ligne (les membres d\'un groupe) ou dans des lignes qui ont la même valeur de regroupement (les présents à une même rencontre) sont reliés.</p>';
    b.participations.forEach(function (p, k) {
      h += '<div class="gg-reglage-table"><div class="gg-reglage-cols">' +
        '<div class="fr-select-group"><label class="fr-label" for="rg-pt' + k + '">Table</label><select class="fr-select fr-select--sm" id="rg-pt' + k + '" data-reglage="participations.' + k + '.table">' + meta.tables.map(function (t) { return '<option' + (t === p.table ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') + '</select></div>' +
        '<div class="fr-select-group"><label class="fr-label" for="rg-pm' + k + '">Acteurs cités</label>' + selCol('rg-pm' + k, p.table, p.membres, 'participations.' + k + '.membres') + '</div>' +
        '<div class="fr-select-group"><label class="fr-label" for="rg-pg' + k + '">Regrouper par</label>' + selCol('rg-pg' + k, p.table, p.groupe, 'participations.' + k + '.groupe', 'Chaque ligne') + '</div>' +
        '<div class="fr-input-group"><label class="fr-label" for="rg-pl' + k + '">Libellé</label><input class="fr-input fr-input--sm" id="rg-pl' + k + '" data-reglage="participations.' + k + '.libelle" value="' + esc(p.libelle || '') + '"></div></div>' +
        '<button type="button" class="fr-btn fr-btn--sm fr-btn--tertiary-no-outline fr-icon-delete-line fr-btn--icon-left" data-retirer-participation="' + k + '">Retirer</button></div>';
    });
    h += '<button type="button" class="fr-btn fr-btn--sm fr-btn--secondary fr-icon-add-line fr-btn--icon-left" data-action="ajouter-participation">Ajouter une source</button>' +
      '<h3 class="fr-h6 fr-mt-3w">Affichage</h3>' +
      '<div class="fr-select-group"><label class="fr-label" for="rg-couleur">Couleur des acteurs</label><select class="fr-select fr-select--sm" id="rg-couleur" data-reglage="couleurPar"><option value="categorie"' + (b.couleurPar === 'categorie' ? ' selected' : '') + '>Selon la table</option><option value="type"' + (b.couleurPar === 'type' ? ' selected' : '') + '>Selon le type</option></select></div>' +
      '<div class="fr-select-group"><label class="fr-label" for="rg-taille">Taille des acteurs</label><select class="fr-select fr-select--sm" id="rg-taille" data-reglage="taillePar"><option value="liens"' + (b.taillePar === 'liens' ? ' selected' : '') + '>Selon le nombre de liens</option><option value="influence"' + (b.taillePar === 'influence' ? ' selected' : '') + '>Selon l\'influence</option></select></div>' +
      '<div class="fr-checkbox-group fr-checkbox-group--sm"><input type="checkbox" id="rg-etiq" data-reglage="etiquettes"' + (b.etiquettes ? ' checked' : '') + '><label class="fr-label" for="rg-etiq">Afficher tous les noms</label></div>' +
      '<div class="fr-checkbox-group fr-checkbox-group--sm"><input type="checkbox" id="rg-iso" data-reglage="masquerIsoles"' + (b.masquerIsoles ? ' checked' : '') + '><label class="fr-label" for="rg-iso">Masquer les acteurs sans lien</label></div>' +
      '<ul class="fr-btns-group fr-btns-group--inline-sm fr-btns-group--sm fr-mt-3w gg-actions-reglages"><li><button type="button" class="fr-btn" data-action="enregistrer">Enregistrer</button></li><li><button type="button" class="fr-btn fr-btn--secondary" data-action="annuler">Annuler</button></li></ul>';
    return h;
  }

  function rendrePanneau() {
    var x = etat.selection ? parId[etat.selection] : null;
    panneau.innerHTML = (etat.panneau === 'fiche' && x) ? vueFiche(x) : vueFiltres();
  }
  // Les réglages vivent dans l'onglet Réglages, hors du panneau.
  var zoneReg = document.createElement('div');
  zoneReg.id = 'gg-reglages-zone';
  function rendreReglages() { if (zoneReg) zoneReg.innerHTML = vueReglages(); }
  function rafraichirReglages() {
    if (configLab && configLab.estModifie()) return;
    etat.brouillon = null; rendreReglages();
  }
  var pageAppliquee = '';
  function appliquerPage() {
    var p = options && options.page, sig = JSON.stringify(p || null);
    if (sig === pageAppliquee) return;
    pageAppliquee = sig;
    if (window.PageDSFR && p && (p.titre || p.marque)) {
      var cible = window.PageDSFR.appliquer(p, { entete: document.getElementById('entete'), pied: document.getElementById('pied') });
      if (cible.entete) cible.entete.id = 'entete';
      if (cible.pied) cible.pied.id = 'pied';
    }
  }
  function rendre() { appliquerPage(); rendrePanneau(); monterCoque(); rafraichirReglages(); rendreVue(); }
  // Une mise à jour venue de Grist pendant une saisie dans le panneau attend la fin de la saisie.
  var rendreApres = false;
  function rendreSiLibre() {
    var a = document.activeElement;
    if (a && (panneau.contains(a) || zoneReg.contains(a)) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) { rendreApres = true; rendreVue(); return; }
    rendre();
  }
  panneau.addEventListener('focusout', function (e) {
    if (rendreApres && !(e.relatedTarget && panneau.contains(e.relatedTarget) && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.relatedTarget.tagName))) { rendreApres = false; setTimeout(rendrePanneau, 0); }
  });

  function selectionner(id, focaliser) {
    etat.selection = id; etat.chemin = null; etat.cheminVide = false; etat.cheminVers = ''; etat.lienForm = {};
    etat.panneau = id ? 'fiche' : 'liste'; etat.alerte = null;
    var x = parId[id];
    if (x && !DEMO && x.table === meta.tableCourante) { try { grist.setCursorPos({ rowId: x.rowId }); } catch (e) { /* liaison facultative */ } }
    rendre();
    if (focaliser) { var t = document.getElementById('gg-fiche-titre'); if (t) t.focus(); }
  }

  // ---------------------------------------------------------------------------
  // Écritures
  // ---------------------------------------------------------------------------

  function ecrire(actions, message) {
    return source.ecrire(actions).then(function () {
      etat.alerte = message ? { type: 'success', texte: message } : null;
      return charger();
    }).then(rendre).catch(function (err) {
      etat.alerte = { type: 'error', texte: 'Enregistrement refusé par Grist. Vérifiez vos droits sur le document. (' + ((err && err.message) || err) + ')' };
      rendrePanneau();
    });
  }
  function valeurPour(t, c, x) { return cibleRef(t, c) === x.table ? x.rowId : x.nom; }

  function enregistrerOptions(o) {
    var brut = JSON.parse(JSON.stringify(o));
    optionsBrutes = brut;
    if (DEMO) return Promise.resolve();
    return grist.setOptions(brut);
  }

  // ---------------------------------------------------------------------------
  // Événements
  // ---------------------------------------------------------------------------

  function cheminReglage(el) { return el.getAttribute('data-reglage').split('.'); }
  function majBrouillon(el) {
    var b = etat.brouillon, c = cheminReglage(el), v = el.type === 'checkbox' ? el.checked : el.value, o = b;
    for (var i = 0; i < c.length - 1; i++) o = o[/^\d+$/.test(c[i]) ? num(c[i]) : c[i]];
    o[c[c.length - 1]] = v;
  }

  function ecouter(ev, fn) { panneau.addEventListener(ev, fn); zoneReg.addEventListener(ev, fn); }
  ecouter('click', function (e) {
    var el = e.target.closest('button');
    if (!el || el.disabled) return;
    var a = el.getAttribute('data-action');
    if (el.hasAttribute('data-acteur')) { selectionner(el.getAttribute('data-acteur'), true); return; }
    if (a === 'retour') { var ancien = etat.selection; selectionner(null); var b = panneau.querySelector('[data-acteur="' + ancien + '"]'); if (b) b.focus(); return; }
    if (a === 'effacer-chemin') { etat.chemin = null; etat.cheminVers = ''; rendre(); return; }
    if (a === 'annuler') { etat.brouillon = null; etat.panneau = etat.selection ? 'fiche' : 'liste'; rendre(); return; }
    if (a === 'ajouter-participation') {
      var t = meta.tables.filter(function (x) { return x !== etat.brouillon.liens; })[0];
      etat.brouillon.participations.push({ table: t, membres: (meta.colonnes[t][0] || {}).colId, groupe: '', libelle: 'Participation commune' });
      rendreReglages(); if (configLab) configLab.modifie(true); return;
    }
    if (el.hasAttribute('data-retirer-participation')) { etat.brouillon.participations.splice(num(el.getAttribute('data-retirer-participation')), 1); rendreReglages(); if (configLab) configLab.modifie(true); return; }
    if (a === 'enregistrer') {
      var o = etat.brouillon;
      enregistrerOptions(o).then(function () {
        etat.brouillon = null; etat.panneau = etat.selection ? 'fiche' : 'liste'; positions = {};
        etat.alerte = { type: 'success', texte: DEMO ? 'Réglages appliqués (démonstration : non enregistrés).' : 'Réglages enregistrés.' };
        return charger();
      }).then(rendre).catch(function (err) { etat.alerte = { type: 'error', texte: 'Enregistrement impossible. (' + ((err && err.message) || err) + ')' }; rendrePanneau(); });
      return;
    }
    if (a === 'creer-liens') { creerTableLiens(); return; }
    if (el.hasAttribute('data-supprimer-lien')) { ecrire([['RemoveRecord', options.liens, num(el.getAttribute('data-supprimer-lien'))]], 'Lien supprimé.'); }
  });
  ecouter('change', function (e) {
    var el = e.target;
    if (el.hasAttribute('data-cat')) { etat.masquesCat[el.getAttribute('data-cat')] = !el.checked; rendre(); var x = document.getElementById(el.id); if (x) x.focus(); return; }
    if (el.hasAttribute('data-lien')) { etat.masquesLien[el.getAttribute('data-lien')] = !el.checked; rendre(); var y = document.getElementById(el.id); if (y) y.focus(); return; }
    if (el.hasAttribute('data-note')) {
      var act = parId[etat.selection], champs = {}; champs[el.getAttribute('data-note')] = el.value === '' ? null : num(el.value);
      ecrire([['UpdateRecord', act.table, act.rowId, champs]], 'Position enregistrée.').then(function () { var z = document.getElementById(el.id); if (z) z.focus(); });
      return;
    }
    if (el.hasAttribute('data-table-acteur')) {
      var t = el.getAttribute('data-table-acteur'), b = etat.brouillon;
      if (el.checked) b.acteurs.push({ table: t, nom: colonne(t, 'Nom') ? 'Nom' : ((meta.colonnes[t][0] || {}).colId || ''), type: colonne(t, 'Type') ? 'Type' : '', libelle: t });
      else b.acteurs = b.acteurs.filter(function (x) { return x.table !== t; });
      rendreReglages(); if (configLab) configLab.modifie(true); var w = document.getElementById(el.id); if (w) w.focus(); return;
    }
    if (el.hasAttribute('data-reglage')) {
      majBrouillon(el);
      if (/^participations\.\d+\.table$/.test(el.getAttribute('data-reglage'))) {
        var p = etat.brouillon.participations[num(cheminReglage(el)[1])];
        p.membres = ((meta.colonnes[p.table] || [])[0] || {}).colId; p.groupe = '';
        rendreReglages(); if (configLab) configLab.modifie(true);
      }
    }
  });
  ecouter('input', function (e) {
    if (e.target.hasAttribute('data-reglage') && e.target.type !== 'checkbox' && e.target.tagName === 'INPUT') majBrouillon(e.target);
  });
  panneau.addEventListener('toggle', function (e) {
    if (e.target.tagName === 'DETAILS' && e.target.querySelector('[data-form=lien]')) etat.lienForm.ouvert = e.target.open;
  }, true);
  panneau.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target.getAttribute('data-form');
    if (f === 'trouver') {
      var x = acteurParNom(document.getElementById('gg-q').value);
      if (x) { etat.masquesCat[x.categorie] = false; selectionner(x.id, true); }
      else { etat.alerte = { type: 'error', texte: 'Aucun acteur de ce nom. Choisissez un nom dans la liste proposée.' }; rendrePanneau(); var q = document.getElementById('gg-q'); if (q) q.focus(); }
      return;
    }
    var moi = parId[etat.selection];
    if (f === 'chemin') {
      var nom = document.getElementById('gg-vers-chemin').value, cible = acteurParNom(nom);
      etat.cheminVers = nom;
      if (!cible || cible === moi) { etat.alerte = { type: 'error', texte: 'Choisissez un autre acteur dans la liste proposée.' }; rendrePanneau(); return; }
      etat.chemin = chemin(moi, cible); etat.cheminVide = !etat.chemin; etat.alerte = null;
      rendre(); return;
    }
    if (f === 'lien') {
      var autre = acteurParNom(document.getElementById('gg-vers').value);
      etat.lienForm = { ouvert: true, vers: document.getElementById('gg-vers').value, type: document.getElementById('gg-type').value };
      if (!autre || autre === moi) { etat.alerte = { type: 'error', texte: 'Choisissez l\'autre acteur dans la liste proposée.' }; rendrePanneau(); return; }
      var t = options.liens, champs = { De: valeurPour(t, 'De', moi), Vers: valeurPour(t, 'Vers', autre), Type: document.getElementById('gg-type').value,
        Force: num(document.getElementById('gg-force').value), Sens: document.getElementById('gg-sens').value, Note: document.getElementById('gg-note').value.trim() };
      etat.lienForm = { ouvert: true };
      ecrire([['AddRecord', t, null, champs]], 'Lien ajouté avec ' + autre.nom + '.');
    }
  });

  function creerTableLiens() {
    ecrire([['AddTable', 'Liens', [{ id: 'De', type: 'Text' }, { id: 'Vers', type: 'Text' }, { id: 'Type', type: 'Choice', widgetOptions: JSON.stringify({ choices: TYPES_LIENS }) },
      { id: 'Force', type: 'Int' }, { id: 'Sens', type: 'Choice', widgetOptions: JSON.stringify({ choices: SENS }) }, { id: 'Note', type: 'Text' }]]], 'Table Liens créée. Ajoutez des liens depuis la fiche d\'un acteur.')
      .then(function () { if (!options.liens) { var o = JSON.parse(JSON.stringify(options)); o.liens = 'Liens'; return enregistrerOptions(o).then(charger).then(rendre); } return null; });
  }
  function ajouterColonnes() {
    var acts = [];
    options.acteurs.forEach(function (a) {
      if (!colonne(a.table, 'Influence')) acts.push(['AddColumn', a.table, 'Influence', { type: 'Int', label: 'Influence' }]);
      if (!colonne(a.table, 'Interet')) acts.push(['AddColumn', a.table, 'Interet', { type: 'Int', label: 'Intérêt' }]);
    });
    ecrire(acts, 'Colonnes ajoutées. Renseignez l\'influence et l\'intérêt dans la fiche de chaque acteur (0 à 5).');
  }

  document.getElementById('gg-info').addEventListener('click', function (e) {
    var b = e.target.closest('[data-action=ajouter-colonnes]');
    if (b) { b.disabled = true; ajouterColonnes(); }
  });
  document.getElementById('gg-liste').addEventListener('click', function (e) {
    var b = e.target.closest('[data-acteur]');
    if (b) selectionner(b.getAttribute('data-acteur'), true);
  });
  document.querySelectorAll('[data-vue]').forEach(function (b) {
    b.addEventListener('click', function () { etat.vue = b.getAttribute('data-vue'); rendreVue(); });
  });
  document.getElementById('gg-reorganiser').addEventListener('click', function () { positions = {}; rendreVue(); });
  // Coque à onglets : la vue (graphe, positions, liste), les réglages, l'en-tête et le pied, l'aperçu, la publication.
  var configLab = null, zoneConfig = document.getElementById('gg-coque'), pageEditee = null;
  function monterCoque() {
    if (configLab || !zoneConfig || !window.ConfigLab) return;
    pageEditee = JSON.parse(JSON.stringify(options.page || { marque: '', titre: 'Liens entre acteurs', pied: { accessibilite: '' } }));
    configLab = window.ConfigLab.monter(zoneConfig, {
      nom: 'Liens entre acteurs',
      vue: { libelle: 'Graphe', element: document.querySelector('.gg-cadre') },
      page: pageEditee,
      onglets: [{ id: 'reglages', libelle: 'Réglages', rendre: function (zone) {
        zone.innerHTML = '<div class="cl-panneau"></div>'; zone.firstChild.appendChild(zoneReg); rendreReglages();
      } }],
      apercu: function (zone) {
        zone.innerHTML = '<h1 class="fr-h3">' + esc((etat.brouillon && etat.brouillon.titre) || options.titre || 'Liens entre acteurs') + '</h1><p class="fr-text--sm">Le graphe, les positions et la liste s\'affichent entre l\'en-tête et le pied de page.</p>';
      },
      publication: { mode: 'connecte', adresseWidget: location.href.split('#')[0].split('?')[0],
        publier: { lienDoc: (optionsBrutes.publication && optionsBrutes.publication.lienDoc) || '', texte: 'Le graphe peut s\'afficher en page complète, sans compte Grist, en lecture seule : graphe, fiches, chemins et liste.',
          construire: function (l) {
            var o = JSON.parse(JSON.stringify((etat.brouillon || optionsBrutes) || {})); delete o.publication; o.page = pageEditee;
            return window.GristPublic ? window.GristPublic.lien(location.href.split('#')[0].split('?')[0], { doc: l, table: meta.tableCourante, options: o }) : null;
          },
          surChangement: function (l) { if (!etat.brouillon) rendreReglages(); if (etat.brouillon) etat.brouillon.publication = { lienDoc: l }; } } },
      // La vue est masquée hors de son onglet : on évite de dessiner dans un conteneur sans taille.
      surOnglet: function (id) { etat.configOuverte = id !== 'vue'; if (id === 'vue') { setTimeout(function () { rendreVue(); if (graphe) graphe.resize(); }, 50); } },
      surEnregistrer: function () {
        if (!etat.brouillon) rendreReglages();
        etat.brouillon.page = pageEditee;
        etat.brouillon.publication = etat.brouillon.publication || optionsBrutes.publication || { lienDoc: '' };
        var bouton = zoneReg.querySelector('[data-action="enregistrer"]');
        if (!bouton) return;
        etat.alerte = null;
        bouton.click();
        var essais = 0;
        (function attendre() {
          if (!configLab) return;
          if (etat.alerte && etat.alerte.type === 'success') { configLab.enregistre(); configLab.message('success', etat.alerte.texte); return; }
          if (etat.alerte && etat.alerte.type === 'error') { configLab.message('error', etat.alerte.texte); return; }
          if (++essais < 25) setTimeout(attendre, 400);
        })();
      }
    });
  }
  function ouvrirReglages() { monterCoque(); if (configLab) configLab.onglet('reglages'); }
  document.getElementById('gg-reglages').addEventListener('click', ouvrirReglages);
  document.getElementById('gg-actualiser').addEventListener('click', function () { charger().then(rendre); });

  // ---------------------------------------------------------------------------
  // Thème
  // ---------------------------------------------------------------------------

  var choixTheme = 'auto';
  try { choixTheme = localStorage.getItem('gg-theme') || 'auto'; } catch (e) { /* stockage indisponible */ }
  function themeGrist() {
    var st = getComputedStyle(document.documentElement);
    var m = (st.getPropertyValue('--grist-theme-page-bg') || st.getPropertyValue('--grist-theme-bg') || '').trim().match(/^#([0-9a-f]{6})$/i);
    if (!m) return null;
    var n = parseInt(m[1], 16);
    return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 < 0.5 ? 'dark' : 'light';
  }
  function appliquerTheme() {
    var t = choixTheme;
    if (t === 'auto') t = themeGrist() || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    var avant = document.documentElement.getAttribute('data-fr-theme');
    document.documentElement.setAttribute('data-fr-theme', t);
    if (avant !== t && graphe && acteurs.length) rendreVue();
  }
  var selectTheme = document.getElementById('gg-theme');
  selectTheme.value = choixTheme;
  selectTheme.addEventListener('change', function () {
    choixTheme = selectTheme.value;
    try { localStorage.setItem('gg-theme', choixTheme); } catch (e) { /* stockage indisponible */ }
    appliquerTheme();
  });
  new MutationObserver(appliquerTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });

  // ---------------------------------------------------------------------------
  // Démarrage
  // ---------------------------------------------------------------------------

  appliquerTheme();
  function erreur(err) { panneau.innerHTML = '<div class="fr-alert fr-alert--error fr-alert--sm"><p>Chargement impossible : ' + esc((err && err.message) || err) + '</p></div>'; }
  if (DEMO) {
    window.ggEtat = function () { return { acteurs: acteurs.length, aretes: aretes.length, visibles: aretesVisibles().length, options: options, selection: etat.selection, chemin: etat.chemin && etat.chemin.noeuds.length }; };
    document.getElementById('gg-demo').hidden = false;
    fetch('exemples/demo.json').then(function (r) { return r.json(); }).then(function (json) {
      source = sourceDemo(json); optionsBrutes = json.options || {};
      return charger();
    }).then(rendre).catch(erreur);
  } else {
    source = sourceGrist();
    var attente = null, pret = false;
    grist.ready({ requiredAccess: 'full', allowSelectBy: true, onEditOptions: function () { ouvrirReglages(); } });
    grist.onOptions(function (o) {
      optionsBrutes = o || {};
      clearTimeout(attente);
      attente = setTimeout(function () { charger().then(function () { pret = true; rendre(); }).catch(erreur); }, 100);
    });
    grist.onRecords(function () {
      if (!pret) return;
      clearTimeout(attente);
      attente = setTimeout(function () { charger().then(rendreSiLibre).catch(erreur); }, 200);
    });
    // Sans réglages enregistrés, Grist peut ne pas appeler onOptions : chargement par défaut.
    setTimeout(function () { if (!pret) charger().then(function () { pret = true; rendre(); }).catch(erreur); }, 1500);
    grist.onRecord(function (r) {
      if (!r || !meta.tableCourante) return;
      var id = meta.tableCourante + ':' + r.id;
      if (parId[id] && etat.selection !== id) selectionner(id, false);
    });
  }
})();
