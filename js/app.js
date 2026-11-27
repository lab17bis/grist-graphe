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
  var REGROUPEMENTS = [['', 'Sans regroupement'], ['communautes', 'Par proximité (communautés détectées)'], ['categorie', 'Selon la table'], ['type', 'Selon le type']];
  var TAILLES = [['liens', 'Selon le nombre de liens'], ['passerelle', 'Selon le rôle de passerelle'], ['influence', 'Selon l\'influence']];
  // Disposition en force : calcul hors écran (rapide) et mouvement visible (plus ample).
  // Avec un regroupement, les points de rassemblement repoussent plus fort (valeur de nœud plus haute) : les groupes s'écartent.
  function parametresForce(vivant) {
    return { repulsion: analyse.mode ? [260, 1000] : 260, edgeLength: [50, 150], gravity: 0.08, friction: vivant ? 0.3 : 0.2 };
  }
  // Longueur des liens : plus un lien est fort, plus il est court ; un lien entre deux groupes est long.
  function valeurLien(a) { var g1 = analyse.mode && analyse.groupeDe[a.source.id], g2 = analyse.mode && analyse.groupeDe[a.target.id]; return g1 && g2 && g1 !== g2 ? 0 : a.force; }
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
  var etat = { vue: 'graphe', panneau: 'liste', selection: null, chemin: null, masquesCat: {}, masquesLien: {}, alerte: null, brouillon: null, lienForm: {},
    mouvement: 'non',                // 'non' : figé ; 'oui' : en mouvement ; 'temporaire' : le temps de se réorganiser
    regrouper: null, taille: null,   // choix de la personne qui consulte (null : réglage du widget)
    exergue: null };                 // groupe mis en avant
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
    o.regrouperPar = o.regrouperPar || '';
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

  // Ce qui empêche de lire les données choisies (table ou colonne absente, liens dont
  // un acteur est introuvable) : signalé dans le panneau plutôt que passé sous silence.
  var liensIgnores = 0;
  function problemesSource() {
    if (DEMO || PUBLIC) return [];
    var p = [];
    options.acteurs.forEach(function (a) {
      if (meta.tables.indexOf(a.table) < 0) p.push('La table d\'acteurs <code>' + esc(a.table) + '</code> n\'existe pas dans ce document.');
      else if (!colonne(a.table, a.nom)) p.push('La table <code>' + esc(a.table) + '</code> n\'a pas de colonne <code>' + esc(a.nom) + '</code> pour le nom des acteurs : choisissez la bonne colonne dans les réglages.');
    });
    if (options.liens) {
      if (meta.tables.indexOf(options.liens) < 0) p.push('La table des liens <code>' + esc(options.liens) + '</code> n\'existe pas dans ce document.');
      else if (!colonne(options.liens, 'De') || !colonne(options.liens, 'Vers')) p.push('La table des liens <code>' + esc(options.liens) + '</code> n\'a pas les colonnes <code>De</code> et <code>Vers</code> : ses lignes ne sont pas lues. Renommez dans Grist vos colonnes d\'origine et de destination en <code>De</code> et <code>Vers</code> : leurs données seront reprises.');
      else if (liensIgnores) p.push(pluriel(liensIgnores, 'lien ignoré', 'liens ignorés') + ' : l\'acteur d\'origine ou de destination ne correspond à aucun acteur affiché (nom différent ou table d\'acteurs non choisie).');
    }
    return p;
  }
  function blocProblemes() {
    var p = problemesSource();
    return p.length ? '<div class="fr-alert fr-alert--warning fr-alert--sm fr-mt-2w">' + p.map(function (x) { return '<p>' + x + '</p>'; }).join('') + '</div>' : '';
  }

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
    liensIgnores = 0;
    if (options.liens && lignes[options.liens]) {
      lignes[options.liens].forEach(function (l) {
        var s = trouver(l.De, options.liens, 'De'), t = trouver(l.Vers, options.liens, 'Vers');
        if (!s || !t) { if (l.De || l.Vers) liensIgnores++; return; }
        if (s === t) return;
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
  // Analyse du réseau : communautés, rôle de passerelle
  // ---------------------------------------------------------------------------

  // Communautés : méthode de Louvain, pondérée par la force des liens, déterministe (ordre des acteurs).
  // Renvoie, pour chaque acteur de xs, le numéro de sa communauté.
  function louvain(xs, ar) {
    var idx = {}, g = [], m2 = 0, i, j;
    xs.forEach(function (x, n) { idx[x.id] = n; g.push({}); });
    ar.forEach(function (a) {
      var s = idx[a.source.id], t = idx[a.target.id];
      if (s === undefined || t === undefined || s === t) return;
      var w = a.force || 1;
      g[s][t] = (g[s][t] || 0) + w; g[t][s] = (g[t][s] || 0) + w; m2 += 2 * w;
    });
    var membre = xs.map(function (x, n) { return n; });
    if (!m2) return membre;
    for (var niveau = 0; niveau < 10; niveau++) {
      var N = g.length, com = [], k = [], tot = [], bouge = false;
      for (i = 0; i < N; i++) { com[i] = i; k[i] = 0; for (j in g[i]) k[i] += g[i][j]; tot[i] = k[i]; }
      for (var passe = 0; passe < 20; passe++) {
        var change = false;
        for (i = 0; i < N; i++) {
          var ci = com[i], vers = {};
          for (j in g[i]) { if (+j !== i) vers[com[j]] = (vers[com[j]] || 0) + g[i][j]; }
          tot[ci] -= k[i];
          var meilleur = ci, gain = (vers[ci] || 0) - tot[ci] * k[i] / m2;
          for (var c in vers) { var v = vers[c] - tot[c] * k[i] / m2; if (v > gain + 1e-9) { gain = v; meilleur = +c; } }
          tot[meilleur] += k[i];
          if (meilleur !== ci) { com[i] = meilleur; change = true; bouge = true; }
        }
        if (!change) break;
      }
      if (!bouge) break;
      // Agrégation : chaque communauté devient un nœud.
      var rang = {}, nb = 0, g2 = [];
      for (i = 0; i < N; i++) if (rang[com[i]] === undefined) { rang[com[i]] = nb++; g2.push({}); }
      for (i = 0; i < N; i++) for (j in g[i]) { var a2 = rang[com[i]], b2 = rang[com[j]]; g2[a2][b2] = (g2[a2][b2] || 0) + g[i][j]; }
      membre = membre.map(function (n) { return rang[com[n]]; });
      g = g2;
    }
    return membre;
  }

  // Rôle de passerelle : centralité d'intermédiarité (algorithme de Brandes), sur les liens visibles.
  function intermediarite(xs, ar) {
    var adj = {}, cb = {};
    xs.forEach(function (x) { adj[x.id] = {}; cb[x.id] = 0; });
    ar.forEach(function (a) { if (adj[a.source.id] && adj[a.target.id] && a.source !== a.target) { adj[a.source.id][a.target.id] = 1; adj[a.target.id][a.source.id] = 1; } });
    xs.forEach(function (s) {
      var pile = [], pred = {}, sigma = {}, dist = {}, delta = {}, file = [s.id];
      xs.forEach(function (x) { pred[x.id] = []; sigma[x.id] = 0; dist[x.id] = -1; delta[x.id] = 0; });
      sigma[s.id] = 1; dist[s.id] = 0;
      for (var q = 0; q < file.length; q++) {
        var v = file[q]; pile.push(v);
        Object.keys(adj[v]).forEach(function (w) {
          if (dist[w] < 0) { dist[w] = dist[v] + 1; file.push(w); }
          if (dist[w] === dist[v] + 1) { sigma[w] += sigma[v]; pred[w].push(v); }
        });
      }
      while (pile.length) {
        var w = pile.pop();
        pred[w].forEach(function (v) { delta[v] += sigma[v] / sigma[w] * (1 + delta[w]); });
        if (w !== s.id) cb[w] += delta[w];
      }
    });
    return cb;
  }

  function modeRegroupement() { return etat.regrouper !== null ? etat.regrouper : (options.regrouperPar || ''); }
  function modeTaille() { return etat.taille || options.taillePar; }
  var analyse = { cle: null, mode: '', groupes: [], groupeDe: {}, passerelle: {}, maxPasserelle: 0 };
  // Groupes (communautés, tables ou types) et centralités des acteurs visibles ; recalculés seulement si le réseau change.
  function analyser() {
    var ar = aretesVisibles(), xs = acteursVisibles(ar), mode = modeRegroupement(), d = degres(ar);
    var cleAnalyse = mode + '|' + xs.map(function (x) { return x.id + (mode === 'type' ? '=' + x.type : ''); }).join(',') + '|' + ar.map(function (a) { return a.id + ':' + a.force; }).join(',');
    if (cleAnalyse === analyse.cle) return analyse;
    var groupes = [];
    var parDegre = function (a, b) { return (d[b.id] || 0) - (d[a.id] || 0) || a.nom.localeCompare(b.nom, 'fr'); };
    if (mode === 'communautes') {
      var m = louvain(xs, ar), parCom = {}, ordre = [], isoles = [];
      xs.forEach(function (x, i) { if (!parCom[m[i]]) { parCom[m[i]] = []; ordre.push(m[i]); } parCom[m[i]].push(x); });
      ordre.forEach(function (c) { var l = parCom[c]; if (l.length === 1 && !d[l[0].id]) isoles.push(l[0]); else groupes.push({ membres: l }); });
      groupes.sort(function (a, b) { return b.membres.length - a.membres.length; });
      groupes.forEach(function (gr) { var c = gr.membres.slice().sort(parDegre)[0]; gr.cle = 'c:' + c.id; gr.nom = 'Autour de ' + c.nom; });
      if (isoles.length) groupes.push({ cle: 'isoles', nom: 'Sans lien', membres: isoles, isoles: true });
    } else if (mode === 'categorie' || mode === 'type') {
      var parCle = {}, cles = [];
      xs.forEach(function (x) { var k = mode === 'type' ? (x.type || 'Sans type') : x.categorie; if (!parCle[k]) { parCle[k] = []; cles.push(k); } parCle[k].push(x); });
      groupes = cles.map(function (k) { return { cle: 'k:' + k, nom: k, membres: parCle[k] }; });
    }
    var groupeDe = {}, n = 0;
    groupes.forEach(function (gr) { gr.couleur = gr.isoles ? '#929292' : PALETTE[n++ % PALETTE.length]; gr.membres.forEach(function (x) { groupeDe[x.id] = gr; }); });
    var cb = intermediarite(xs, ar), max = 0;
    Object.keys(cb).forEach(function (k) { if (cb[k] > max) max = cb[k]; });
    analyse = { cle: cleAnalyse, mode: mode, groupes: groupes, groupeDe: groupeDe, passerelle: cb, maxPasserelle: max };
    if (etat.exergue && !groupes.some(function (gr) { return gr.cle === etat.exergue; })) etat.exergue = null;
    return analyse;
  }
  function groupeExergue() { var c = etat.exergue; return c ? analyse.groupes.filter(function (gr) { return gr.cle === c; })[0] || null : null; }

  // ---------------------------------------------------------------------------
  // Couleurs et tailles
  // ---------------------------------------------------------------------------

  function groupesCouleur() {
    var g = [];
    acteurs.forEach(function (x) { var k = options.couleurPar === 'type' ? (x.type || 'Sans type') : x.categorie; if (g.indexOf(k) < 0) g.push(k); });
    return g;
  }
  function couleurDe(x, g) {
    if (modeRegroupement() && analyse.groupeDe[x.id]) return analyse.groupeDe[x.id].couleur;
    var k = options.couleurPar === 'type' ? (x.type || 'Sans type') : x.categorie; return PALETTE[g.indexOf(k) % PALETTE.length]; }
  function tailleDe(x, d) {
    var t = modeTaille();
    if (t === 'influence' && x.influence !== null) return 14 + Math.max(0, Math.min(5, x.influence)) * 6;
    if (t === 'passerelle') return 12 + Math.sqrt(analyse.maxPasserelle ? (analyse.passerelle[x.id] || 0) / analyse.maxPasserelle : 0) * 34;
    return Math.min(46, 12 + Math.sqrt(d[x.id] || 0) * 7);
  }

  // ---------------------------------------------------------------------------
  // Vues principales : graphe, positions, liste
  // ---------------------------------------------------------------------------

  function texteCss(nom) { return getComputedStyle(document.documentElement).getPropertyValue(nom).trim() || '#161616'; }

  // Un point invisible par groupe attire ses membres : la disposition rassemble les acteurs d'un même groupe.
  // Le groupe mis en avant est fixé au centre, plus resserré : les autres acteurs s'écartent.
  function idCentre(gr) { return '__g:' + gr.cle; }
  function centresDeGroupe(ids) {
    var noeuds = [], liens = [], ex = etat.exergue;
    if (!analyse.mode) return { noeuds: noeuds, liens: liens };
    var cx = 0, cy = 0, n = 0;
    Object.keys(positions).forEach(function (k) { if (k.indexOf('__g:') !== 0 && ids[k]) { cx += positions[k][0]; cy += positions[k][1]; n++; } });
    analyse.groupes.forEach(function (gr) {
      if (gr.isoles) return;
      var id = idCentre(gr), p = positions[id], fixe = gr.cle === ex && n > 0;
      noeuds.push({ id: id, name: '', centre: true, value: fixe ? 3 : 2, x: fixe ? cx / n : p ? p[0] : undefined, y: fixe ? cy / n : p ? p[1] : undefined, fixed: fixe });
      gr.membres.forEach(function (x) { if (ids[x.id]) liens.push({ source: x.id, target: id, value: gr.cle === ex ? 6 : 4, centre: true }); });
    });
    return { noeuds: noeuds, liens: liens };
  }

  function calculerPositions(depart) {
    // Disposition en force sur tous les acteurs et tous les liens, calculée une fois puis conservée :
    // filtrer ou sélectionner ne fait pas bouger le graphe. depart : partir des positions actuelles.
    analyser();
    var tmp = echarts.init(document.createElement('div'), null, { width: 1000, height: 700 });
    var d = degres(aretes), ids = {};
    acteurs.forEach(function (x) { ids[x.id] = 1; });
    var c = centresDeGroupe(ids);
    var data = acteurs.map(function (x) {
      var p = depart && positions[x.id];
      return { id: x.id, name: x.id, symbolSize: tailleDe(x, d), value: 1, x: p ? p[0] : undefined, y: p ? p[1] : undefined };
    }).concat(c.noeuds.map(function (n) { return { id: n.id, name: n.id, symbolSize: 0, value: n.value, x: depart || n.fixed ? n.x : undefined, y: depart || n.fixed ? n.y : undefined, fixed: n.fixed }; }));
    tmp.setOption({ animation: false, series: [{ type: 'graph', layout: 'force', layoutAnimation: false, force: parametresForce(false), data: data,
      links: aretes.map(function (a) { return { source: a.source.id, target: a.target.id, value: valeurLien(a) }; }).concat(c.liens.map(function (l) { return { source: l.source, target: l.target, value: l.value }; })) }] });
    var donnees = tmp.getModel().getSeriesByIndex(0).getData();
    positions = {};
    for (var i = 0; i < donnees.count(); i++) {
      var p = donnees.getItemLayout(i);
      if (p && isFinite(p[0])) positions[donnees.getId(i)] = [p[0], p[1]];
    }
    tmp.dispose();
  }

  // ---------------------------------------------------------------------------
  // Mouvement : les acteurs se placent sous les yeux, et réagissent quand on en déplace un
  // ---------------------------------------------------------------------------

  function mouvementReduit() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function lirePositions() {
    if (!graphe || etat.vue !== 'graphe') return null;
    var m = graphe.getModel(), s = m && m.getSeriesByIndex(0);
    if (!s || s.subType !== 'graph') return null;
    var dn = s.getData(), res = {};
    for (var i = 0; i < dn.count(); i++) { var p = dn.getItemLayout(i); if (p && isFinite(p[0]) && isFinite(p[1])) res[dn.getId(i)] = [p[0], p[1]]; }
    return res;
  }
  function capturer() { var p = lirePositions(); if (p) Object.keys(p).forEach(function (k) { positions[k] = p[k]; }); return p; }
  function statut(texte) { var e = document.getElementById('gg-statut'); if (e && e.textContent !== texte) e.textContent = texte; }
  var veille = null, sansCapture = false;
  function arreterVeille() { clearInterval(veille); veille = null; }
  // Surveille le mouvement : quand plus rien ne bouge, la disposition est stable.
  function veiller() {
    arreterVeille();
    var avant = null, calme = 0, debut = Date.now(), stable = false;
    statut(mouvementReduit() ? 'Animation réduite (réglage de votre appareil) : disposition calculée directement.' : 'Les acteurs se placent…');
    veille = setInterval(function () {
      if (etat.mouvement === 'non' || etat.vue !== 'graphe') { arreterVeille(); return; }
      var p = lirePositions();
      if (!p) return;
      var ecart = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      Object.keys(p).forEach(function (k) {
        var q = p[k];
        if (q[0] < minX) minX = q[0]; if (q[0] > maxX) maxX = q[0]; if (q[1] < minY) minY = q[1]; if (q[1] > maxY) maxY = q[1];
        if (avant && avant[k]) ecart = Math.max(ecart, Math.abs(q[0] - avant[k][0]) + Math.abs(q[1] - avant[k][1]));
      });
      var echelle = Math.max(1, maxX - minX, maxY - minY);
      calme = avant && ecart < echelle * 0.002 ? calme + 1 : 0;
      avant = p; Object.keys(p).forEach(function (k) { positions[k] = p[k]; });
      if (calme >= 2 || (!stable && Date.now() - debut > 15000)) {
        if (stable) return;
        stable = true;
        if (etat.mouvement === 'temporaire') { etat.mouvement = 'non'; arreterVeille(); statut('Disposition stable.'); rendreVue(true); return; }
        statut('Disposition stable. Déplacez un acteur : les autres s\'ajustent.');
        if (horsCadre(p)) rendreVue(true);   // des acteurs sont sortis du cadre : on recadre en douceur
      } else if (stable && calme === 0) { stable = false; statut('Les acteurs se placent…'); }
    }, 250);
  }
  function horsCadre(p) {
    var l = graphe.getWidth(), h = graphe.getHeight();
    return Object.keys(p).some(function (k) {
      if (k.indexOf('__g:') === 0) return false;
      var q = graphe.convertToPixel({ seriesIndex: 0 }, p[k]);
      return q && (q[0] < 0 || q[1] < 0 || q[0] > l || q[1] > h);
    });
  }
  // Réorganise en mouvement (ou d'un coup si l'appareil demande moins d'animations).
  function reorganiserEnMouvement() {
    if (etat.vue !== 'graphe' || mouvementReduit() || !graphe) { analyser(); calculerPositions(true); rendre(); statut('Disposition recalculée.'); return; }
    capturer();
    if (etat.mouvement === 'non') etat.mouvement = 'temporaire';
    rendre();
  }
  function basculerMouvement() {
    if (etat.mouvement === 'oui') { capturer(); etat.mouvement = 'non'; arreterVeille(); statut('Graphe figé.'); rendreVue(true); }
    else if (etat.mouvement === 'temporaire') { etat.mouvement = 'oui'; majBoutonMouvement(); }
    else { capturer(); etat.mouvement = 'oui'; rendreVue(); }
  }
  function majBoutonMouvement() {
    var b = document.getElementById('gg-animer');
    if (!b) return;
    var oui = etat.mouvement === 'oui';
    b.hidden = etat.vue !== 'graphe';
    b.setAttribute('aria-pressed', String(oui));
    b.classList.toggle('fr-icon-play-line', !oui); b.classList.toggle('fr-icon-pause-circle-line', oui);
    b.textContent = oui ? 'Figer' : 'Animer';
    b.title = oui ? 'Arrêter le mouvement et garder la disposition' : 'Laisser les acteurs se placer d\'eux-mêmes ; déplacer un acteur fait bouger les autres';
    var st = document.getElementById('gg-statut'); if (st) st.hidden = etat.vue !== 'graphe';
  }

  function optionGraphe() {
    analyser();
    var ar = aretesVisibles(), xs = acteursVisibles(ar), d = degres(ar), g = groupesCouleur();
    if (xs.some(function (x) { return !positions[x.id]; })) calculerPositions();
    var vivant = etat.mouvement !== 'non', gex = groupeExergue(), membresEx = null;
    var visibles = {}; xs.forEach(function (x) { visibles[x.id] = 1; });
    var centres = vivant ? centresDeGroupe(visibles) : { noeuds: [], liens: [] };
    if (gex) { membresEx = {}; gex.membres.forEach(function (x) { membresEx[x.id] = 1; }); }
    var ids = {}; xs.forEach(function (x) { ids[x.id] = 1; });
    var sel = etat.selection ? parId[etat.selection] : null, ch = etat.chemin;
    var dansChemin = {}, liensChemin = {};
    if (ch) { ch.noeuds.forEach(function (n) { dansChemin[n] = 1; }); ch.aretes.forEach(function (a) { liensChemin[a.id] = 1; }); }
    var proches = {};
    if (sel && !ch) { proches[sel.id] = 1; voisins(sel, ar).forEach(function (a) { proches[a.source.id] = 1; proches[a.target.id] = 1; }); }
    var focus = ch ? dansChemin : sel ? proches : membresEx;
    var couleurTexte = texteCss('--text-default-grey');
    return {
      animationDurationUpdate: 300,
      tooltip: { confine: true, formatter: function (p) {
        if (p.dataType === 'node') { var x = parId[p.data.id]; if (!x) return ''; return '<strong>' + esc(x.nom) + '</strong><br>' + esc([x.categorie, x.type].filter(Boolean).join(' · ')) + '<br>' + pluriel(d[x.id] || 0, 'lien'); }
        var a = p.data.arete; if (!a) return ''; return esc(a.source.nom) + ' – ' + esc(a.target.nom) + '<br><strong>' + esc(a.type) + '</strong>' + (a.note ? '<br>' + esc(a.note) : '');
      } },
      series: [{
        type: 'graph', layout: vivant ? 'force' : 'none', force: parametresForce(true), layoutAnimation: !mouvementReduit(),
        roam: true, draggable: true, scaleLimit: { min: 0.2, max: 6 },
        label: { show: true, position: 'right', fontFamily: 'Marianne, arial, sans-serif', fontSize: 11, color: couleurTexte },
        labelLayout: { hideOverlap: true },
        emphasis: { focus: 'adjacency', lineStyle: { width: 4 } },
        edgeSymbolSize: [0, 8],
        data: xs.map(function (x) {
          var actif = focus ? !!focus[x.id] : true, c = couleurDe(x, g);
          return { id: x.id, name: x.nom, value: 1, x: positions[x.id][0], y: positions[x.id][1], symbol: SYMBOLES[x.rangCat % SYMBOLES.length], symbolSize: tailleDe(x, d),
            itemStyle: { color: c, opacity: actif ? 1 : 0.15, borderColor: x.id === etat.selection ? couleurTexte : '#fff', borderWidth: x.id === etat.selection ? 3 : 1 },
            label: { show: options.etiquettes ? actif : (x.id === etat.selection || (focus && focus[x.id])), fontWeight: x.id === etat.selection ? 'bold' : 'normal', opacity: actif ? 1 : 0.3 } };
        }).concat(centres.noeuds.map(function (n) {
          return { id: n.id, name: '', value: n.value, x: n.x, y: n.y, fixed: n.fixed, symbolSize: 0, itemStyle: { opacity: 0 }, label: { show: false },
            emphasis: { disabled: true }, blur: { itemStyle: { opacity: 0 } }, tooltip: { show: false } };
        })),
        links: ar.filter(function (a) { return ids[a.source.id] && ids[a.target.id]; }).map(function (a) {
          var actif = ch ? !!liensChemin[a.id] : sel ? (a.source === sel || a.target === sel) : membresEx ? !!(membresEx[a.source.id] && membresEx[a.target.id]) : true;
          return { source: a.source.id, target: a.target.id, value: valeurLien(a), arete: a, symbol: a.sens === 'unique' ? ['none', 'arrow'] : ['none', 'none'],
            lineStyle: { width: a.force * 1.4 + (ch && actif ? 2 : 0), type: a.genre === 'participation' ? 'dashed' : a.genre === 'appartenance' ? 'dotted' : 'solid',
              color: actif && (sel || ch) ? '#000091' : '#929292', opacity: actif ? (sel || ch ? 0.9 : 0.55) : 0.08, curveness: 0.08 } };
        }).concat(centres.liens.map(function (l) {
          return { source: l.source, target: l.target, value: l.value, symbol: ['none', 'none'], lineStyle: { width: 0, opacity: 0 },
            emphasis: { disabled: true }, blur: { lineStyle: { opacity: 0 } }, tooltip: { show: false } };
        }))
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
    var an = analyser(), ar = aretesVisibles(), xs = acteursVisibles(ar), d = degres(ar);
    var groupe = function (x) { return an.mode ? '<td>' + esc((an.groupeDe[x.id] || {}).nom || '') + '</td>' : ''; };
    var tri = xs.slice().sort(function (a, b) { return (d[b.id] || 0) - (d[a.id] || 0) || a.nom.localeCompare(b.nom, 'fr'); });
    function tableau(titre, entetes, corps) {
      return '<div class="fr-table fr-table--sm fr-table--no-caption"><div class="fr-table__wrapper"><div class="fr-table__container"><div class="fr-table__content"><table><caption>' + esc(titre) + '</caption><thead><tr>' +
        entetes.map(function (e) { return '<th scope="col">' + e + '</th>'; }).join('') + '</tr></thead><tbody>' + corps + '</tbody></table></div></div></div></div>';
    }
    var bouton = function (x) { return '<button type="button" class="fr-link fr-text--sm" data-acteur="' + esc(x.id) + '">' + esc(x.nom) + '</button>'; };
    return '<div class="gg-liste-vue"><h2 class="fr-h6">Acteurs (' + xs.length + ')</h2>' +
      tableau('Acteurs, du plus connecté au moins connecté', ['Acteur', 'Catégorie', 'Type'].concat(an.mode ? ['Groupe'] : []).concat(['Liens', 'Influence', 'Intérêt']), tri.map(function (x) {
        return '<tr><td>' + bouton(x) + '</td><td>' + esc(x.categorie) + '</td><td>' + esc(x.type) + '</td>' + groupe(x) + '<td>' + (d[x.id] || 0) + '</td><td>' + (x.influence === null ? '' : x.influence) + '</td><td>' + (x.interet === null ? '' : x.interet) + '</td></tr>';
      }).join('')) +
      '<h2 class="fr-h6 fr-mt-3w">Liens (' + ar.length + ')</h2>' +
      tableau('Liens entre acteurs', ['De', 'Nature du lien', 'Vers', 'Force', 'Précision'], ar.map(function (a) {
        return '<tr><td>' + bouton(a.source) + '</td><td>' + esc(a.type) + (a.sens === 'unique' ? ' →' : '') + '</td><td>' + bouton(a.target) + '</td><td>' + a.force + '</td><td>' + esc(a.note) + '</td></tr>';
      }).join('')) + '</div>';
  }

  // douce : passer d'une disposition à l'autre en glissant, sans tout redessiner.
  function rendreVue(douce) {
    majBoutonMouvement();
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
      // Un acteur déplacé à la main garde sa place.
      graphe.getZr().on('mouseup', function () { if (etat.vue === 'graphe' && etat.mouvement === 'non') capturer(); });
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
    var vivant = etat.mouvement !== 'non';
    if (vivant && !sansCapture) capturer();
    sansCapture = false;
    graphe.setOption(optionGraphe(), douce === true ? { notMerge: false } : true);
    if (vivant) veiller(); else arreterVeille();
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

  function choix(liste, val) { return liste.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === val ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join(''); }
  function blocAnalyse() {
    var an = analyser(), mode = modeRegroupement();
    var h = '<fieldset class="fr-fieldset gg-filtre gg-analyse"><legend class="fr-fieldset__legend fr-text--md">Analyse du réseau</legend>' +
      '<div class="fr-fieldset__element"><div class="fr-select-group"><label class="fr-label" for="gg-regrouper">Regrouper les acteurs</label>' +
      '<select class="fr-select fr-select--sm" id="gg-regrouper" data-analyse="regrouper">' + choix(REGROUPEMENTS, mode) + '</select></div></div>' +
      '<div class="fr-fieldset__element"><div class="fr-select-group"><label class="fr-label" for="gg-taille">Taille des acteurs<span class="fr-hint-text">Passerelle : acteur par qui passent beaucoup de chemins entre les autres.</span></label>' +
      '<select class="fr-select fr-select--sm" id="gg-taille" data-analyse="taille">' + choix(TAILLES, modeTaille()) + '</select></div></div>';
    if (an.mode && an.groupes.length) {
      var nb = an.groupes.filter(function (gr) { return !gr.isoles; }).length;
      h += '<div class="fr-fieldset__element"><p class="fr-text--xs fr-mb-1w">' + (an.mode === 'communautes' ? pluriel(nb, 'communauté détectée', 'communautés détectées') + ' : les acteurs très liés entre eux sont rassemblés. ' : '') +
        'Choisissez un groupe pour le mettre en avant.</p><ul class="fr-tags-group gg-groupes">' + an.groupes.map(function (gr) {
          return '<li><button type="button" class="fr-tag fr-tag--sm" data-groupe="' + esc(gr.cle) + '" aria-pressed="' + (etat.exergue === gr.cle) + '">' +
            '<span class="gg-pastille gg-pastille--circle" style="background:' + gr.couleur + '" aria-hidden="true"></span>' + esc(gr.nom) + '&nbsp;<span class="gg-compte">(' + gr.membres.length + ')</span></button></li>';
        }).join('') + '</ul></div>';
    }
    return h + '</fieldset>';
  }

  function vueFiltres() {
    analyser();
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
        var couleur = options.couleurPar === 'type' || modeRegroupement() ? '#929292' : PALETTE[g.indexOf(c) % PALETTE.length];
        return '<div class="fr-fieldset__element"><div class="fr-checkbox-group fr-checkbox-group--sm"><input type="checkbox" id="gg-c' + i + '" data-cat="' + esc(c) + '"' + (etat.masquesCat[c] ? '' : ' checked') + '>' +
          '<label class="fr-label" for="gg-c' + i + '">' + pastille(couleur, c) + esc(c) + ' <span class="gg-compte">(' + n + ')</span></label></div></div>';
      }).join('') + '</fieldset>';
    if (options.couleurPar === 'type' && !modeRegroupement()) {
      h += '<ul class="gg-legende-types">' + g.map(function (t, i) { return '<li><span class="gg-pastille" style="background:' + PALETTE[i % PALETTE.length] + '" aria-hidden="true"></span>' + esc(t) + '</li>'; }).join('') + '</ul>';
    }
    if (liens.length) {
      h += '<fieldset class="fr-fieldset gg-filtre"><legend class="fr-fieldset__legend fr-text--md">Liens</legend>' + liens.map(function (k, i) {
        var n = aretes.filter(function (a) { return cleLien(a) === k; }).length, trait = k === 'appartenance' ? 'dotted' : k.indexOf('participation') === 0 ? 'dashed' : 'solid';
        return '<div class="fr-fieldset__element"><div class="fr-checkbox-group fr-checkbox-group--sm"><input type="checkbox" id="gg-l' + i + '" data-lien="' + esc(k) + '"' + (etat.masquesLien[k] ? '' : ' checked') + '>' +
          '<label class="fr-label" for="gg-l' + i + '"><span class="gg-trait gg-trait--' + trait + '" aria-hidden="true"></span>' + esc(libelleCleLien(k)) + ' <span class="gg-compte">(' + n + ')</span></label></div></div>';
      }).join('') + '</fieldset>';
    }
    h += blocAnalyse();
    h += '<p class="gg-compte" aria-live="polite">' + pluriel(xs.length, 'acteur') + ' · ' + pluriel(ar.length, 'lien') + (isoles ? ' · ' + pluriel(isoles, 'acteur isolé', 'acteurs isolés') : '') + '</p>';
    h += blocProblemes();
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
      '<div class="fr-select-group"><label class="fr-label" for="rg-taille">Taille des acteurs</label><select class="fr-select fr-select--sm" id="rg-taille" data-reglage="taillePar">' + choix(TAILLES, b.taillePar) + '</select></div>' +
      '<div class="fr-select-group"><label class="fr-label" for="rg-regrouper">Regroupement à l\'ouverture<span class="fr-hint-text">Chaque personne peut le changer dans le panneau Analyse du réseau.</span></label><select class="fr-select fr-select--sm" id="rg-regrouper" data-reglage="regrouperPar">' + choix(REGROUPEMENTS, b.regrouperPar || '') + '</select></div>' +
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
    if (window.BarreLab && window.BarreLab.modeEnregistre()) { brut.modeLab = window.BarreLab.modeEnregistre(); } // garde l'affichage choisi pour cette vue
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
    if (el.hasAttribute('data-groupe')) {
      var gcle = el.getAttribute('data-groupe');
      etat.exergue = etat.exergue === gcle ? null : gcle;
      reorganiserEnMouvement();
      var gb = panneau.querySelector('[data-groupe="' + gcle.replace(/["\\]/g, '\\$&') + '"]'); if (gb) gb.focus();
      return;
    }
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
        etat.regrouper = null; etat.taille = null; etat.exergue = null;
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
    if (el.hasAttribute('data-analyse')) {
      if (el.getAttribute('data-analyse') === 'regrouper') { etat.regrouper = el.value; etat.exergue = null; reorganiserEnMouvement(); }
      else { etat.taille = el.value; rendre(); }
      var z = document.getElementById(el.id); if (z) z.focus();
      return;
    }
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
  document.getElementById('gg-reorganiser').addEventListener('click', function () { positions = {}; sansCapture = true; rendreVue(); });
  document.getElementById('gg-animer').addEventListener('click', basculerMouvement);
  // Coque à onglets : la vue (graphe, positions, liste), les réglages, l'en-tête et le pied, l'aperçu, la publication.
  var configLab = null, zoneConfig = document.getElementById('gg-coque'), pageEditee = null, brutAvantApercu = null;
  function monterCoque() {
    if (configLab || !zoneConfig || !window.ConfigLab) return;
    pageEditee = JSON.parse(JSON.stringify(options.page || { marque: '', titre: 'Liens entre acteurs', pied: { accessibilite: '' } }));
    configLab = window.ConfigLab.monter(zoneConfig, {
      nom: 'Widget graphe',
      vue: { libelle: 'Graphe', element: document.querySelector('.gg-cadre') },
      page: pageEditee,
      onglets: [{ id: 'reglages', libelle: 'Réglages', rendre: function (zone) {
        zone.innerHTML = '<div class="cl-panneau"></div>'; zone.firstChild.appendChild(zoneReg); rendreReglages();
      } }],
      // Aperçu réel : le graphe lui-même s'affiche sous l'en-tête, avec les réglages en cours (même non enregistrés).
      surApercu: function (ouvert) {
        if (ouvert) {
          if (etat.brouillon && configLab && configLab.estModifie()) {
            brutAvantApercu = optionsBrutes;
            optionsBrutes = Object.assign({}, etat.brouillon, { page: pageEditee });
            charger().then(rendre);
          }
        } else if (brutAvantApercu) {
          optionsBrutes = brutAvantApercu; brutAvantApercu = null;
          charger().then(rendre);
        }
      },
      publication: { mode: 'connecte', adresseWidget: location.href.split('#')[0].split('?')[0],
        publier: { lienDoc: (optionsBrutes.publication && optionsBrutes.publication.lienDoc) || '', texte: 'Le graphe peut s\'afficher en page complète, sans compte Grist, en lecture seule : graphe, fiches, chemins et liste.',
          construire: function (l) {
            var o = JSON.parse(JSON.stringify((etat.brouillon || optionsBrutes) || {})); delete o.publication; o.page = pageEditee;
            return window.GristPublic ? window.GristPublic.lien(location.href.split('#')[0].split('?')[0], { doc: l, table: meta.tableCourante, options: o }) : null;
          },
          surChangement: function (l) { if (!etat.brouillon) rendreReglages(); if (etat.brouillon) etat.brouillon.publication = { lienDoc: l }; } } },
      // La vue est masquée hors de son onglet : on évite de dessiner dans un conteneur sans taille.
      surOnglet: function (id) { etat.configOuverte = id !== 'vue' && id !== 'apercu'; if (id === 'vue' || id === 'apercu') { setTimeout(function () { rendreVue(); if (graphe) graphe.resize(); }, 50); } },
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
    window.ggEtat = function () { return { acteurs: acteurs.length, aretes: aretes.length, visibles: aretesVisibles().length, options: options, selection: etat.selection, chemin: etat.chemin && etat.chemin.noeuds.length,
      mouvement: etat.mouvement, regroupement: analyse.mode, groupes: analyse.groupes.map(function (gr) { return gr.nom + ':' + gr.membres.length; }), exergue: etat.exergue, positions: positions }; };
    // Position à l'écran d'un acteur (tests).
    window.ggPixel = function (id) { var r = document.getElementById('gg-graphe').getBoundingClientRect(), p = graphe.convertToPixel({ seriesIndex: 0 }, positions[id]); return [r.left + p[0], r.top + p[1]]; };
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
