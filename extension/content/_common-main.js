'use strict';
/* Monde MAIN — helpers partagés par tous les scripts de plateforme. Chargé avant chaque
 * <plateforme>-main.js dans le même content_scripts (même scope global, pas de module). */
window.__wl = window.__wl || {};

window.__wl.send = function (title, season, episode) {
  console.log('[WL] envoi vers le relai :', title, season, episode);
  window.postMessage({ __wl: true, title: title, season: season, episode: episode }, '*');
};

/* Diagnostic : liste les éléments dont un attribut connu pour porter du texte de titre
 * (data-testid/data-uia/aria-label/etc.) contient "title"/"episode"/"series"/"show".
 * Logge tout avec le prefixe donné — sert à trouver le bon sélecteur une fois pour
 * une plateforme (comme [data-uia="video-title"] trouvé pour Netflix). */
window.__wl.scanTitleLike = function (prefix) {
  var attrs = ['data-testid', 'data-uia', 'data-qa', 'data-automation-id', 'data-test', 'aria-label'];
  var seen = new Set();
  var found = [];
  attrs.forEach(function (attr) {
    document.querySelectorAll('[' + attr + ']').forEach(function (el) {
      var v = el.getAttribute(attr) || '';
      if (!/title|episode|series|show.?name|video.?name/i.test(v)) return;
      var text = (el.textContent || '').trim();
      if (!text || seen.has(attr + '=' + v)) return;
      seen.add(attr + '=' + v);
      found.push({ attr: attr, value: v, text: text.slice(0, 150) });
    });
  });
  console.log('[' + prefix + '] scanTitleLike (' + found.length + ' resultats) =>');
  found.forEach(function (f, i) { console.log('[' + prefix + ']', i, f.attr + '=' + f.value, '| texte:', JSON.stringify(f.text)); });
  console.log('[' + prefix + '] document.title brut =', JSON.stringify(document.title));
  return found;
};
