/* Diagnostic round 3 — trouver le titre affiche (season/episode deja confirmes via falcorCache). */
(function () {
  var els = Array.prototype.filter.call(document.querySelectorAll('[data-uia]'), function (el) {
    return /title/i.test(el.getAttribute('data-uia') || '');
  });
  console.log('[DIAG3] elements data-uia contenant "title" =>', els.length);
  els.forEach(function (el, i) {
    console.log('[DIAG3]', i, '| data-uia=', el.getAttribute('data-uia'), '| texte=', JSON.stringify(el.textContent.trim()));
  });
  if (!els.length) {
    console.log('[DIAG3] rien trouve via data-uia — essai via les balises h1-h4 visibles');
    Array.prototype.forEach.call(document.querySelectorAll('h1,h2,h3,h4'), function (el, i) {
      if (el.textContent.trim()) console.log('[DIAG3-fallback]', i, el.tagName, JSON.stringify(el.textContent.trim()), '| class=', el.className);
    });
  }
})();
