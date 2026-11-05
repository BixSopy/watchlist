/* MODULE: Attribution d'inscription première partie (?r=code).
   Sans cookie ni tiers : le code court (a-z0-9, 2–12) est gardé dans localStorage
   jusqu'à 30 jours, puis passé dans user_metadata à l'inscription (js/20-account.js).
   Chargé tôt (head) pour capturer aussi /fr, /en et /u/<pseudo>. */
(function (g) {
  var KEY = 'cp_signup_ref';
  var TTL_MS = 30 * 24 * 60 * 60 * 1000;
  var RE = /^[a-z0-9]{2,12}$/;

  function normalize(v) {
    if (typeof v !== 'string') return null;
    var s = v.trim().toLowerCase();
    return RE.test(s) ? s : null;
  }

  function readStored() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || typeof o !== 'object') return null;
      var c = normalize(o.c);
      var at = Number(o.t) || 0;
      if (!c || !at || Date.now() - at > TTL_MS) {
        localStorage.removeItem(KEY);
        return null;
      }
      return c;
    } catch (e) {
      try { localStorage.removeItem(KEY); } catch (_) {}
      return null;
    }
  }

  function writeStored(code) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ c: code, t: Date.now() }));
    } catch (e) {}
  }

  function captureFromUrl() {
    try {
      var q = new URLSearchParams(location.search);
      if (!q.has('r')) return;
      var code = normalize(q.get('r'));
      q.delete('r');
      var qs = q.toString();
      history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + (location.hash || ''));
      if (code) writeStored(code);
    } catch (e) {}
  }

  function getSignupRef() {
    return readStored();
  }

  function clearSignupRef() {
    try { localStorage.removeItem(KEY); } catch (e) {}
  }

  captureFromUrl();
  g.getSignupRef = getSignupRef;
  g.clearSignupRef = clearSignupRef;
  g._signupRefNormalize = normalize; /* exporté pour les tests unitaires */
})(typeof window !== 'undefined' ? window : globalThis);
