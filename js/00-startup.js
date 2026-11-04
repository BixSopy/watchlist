/* MODULE : écran de démarrage (logo animé, non bloquant). Masqué dès le chargement complet
   et au plus tard à 2,5s. Fichier externe requis par la CSP (script-src 'self', pas de inline). */
(function () {
  var el = document.getElementById('brandStartup');
  if (!el) return;
  var done = false;
  function dismiss() {
    if (done) return;
    done = true;
    el.classList.add('is-done');
    setTimeout(function () { el.remove(); }, 300);
  }
  if (document.readyState === 'complete') setTimeout(dismiss, 350);
  else window.addEventListener('load', function () { setTimeout(dismiss, 250); }, { once: true });
  setTimeout(dismiss, 2500);
})();
