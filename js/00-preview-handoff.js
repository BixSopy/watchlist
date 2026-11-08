/* MODULE: Passerelle de session vers les prévisualisations Vercel.
   Chargé de façon synchrone dans <head>, AVANT js/00-landing-gate.js (fichier externe : la CSP interdit les scripts en ligne).

   Problème : une prévisualisation (adresse propre à chaque branche) est une autre
   origine que la production : pas de session partagée, et la connexion y échoue (CAPTCHA Turnstile absent côté
   « preview », que Supabase exige : erreur captcha_failed). Cette passerelle ouvre la session de production sur
   la prévisualisation, sans CAPTCHA :
     1. prévisualisation sans session  → redirection vers la production (…/#wl_preview=<origine>) ;
     2. production (déjà connectée)    → redirection vers <origine>/#wl_handoff=<jeton d'accès> ;
     3. prévisualisation               → session ouverte avec ce jeton (supabase.auth.setSession), adresse nettoyée.
   Sécurité :
     - seules les origines https qui correspondent à brand.config.json › previewHostPattern (équipe Vercel de Pierre)
       reçoivent un jeton ; la production et ses anciens domaines ne correspondent pas (vérifié par le générateur et par les tests) ;
     - le jeton passe dans le fragment d'adresse (jamais envoyé à un serveur), retiré de l'adresse aussitôt ;
     - SEUL le jeton d'accès (1 h) est transmis, avec un jeton de rafraîchissement factice : la session de la
       prévisualisation expire d'elle-même sans pouvoir toucher à la session de production (un vrai jeton partagé
       serait « tourné » par l'un des deux côtés et déconnecterait l'autre) ;
     - en cas d'échec ou de session expirée, un nouvel essai a lieu au plus une fois par minute (pas de boucle) ;
     - ?wl_nohandoff=1 dans l'adresse de la prévisualisation désactive l'aller-retour (utile tant que la production
       n'a pas déployé cette passerelle : elle ne saurait pas répondre).
   Rien ne se passe en production sans paramètre wl_preview, ni pour une origine non autorisée. */
(function(root){
  /* Constantes générées depuis brand.config.json (js/00-brand.js, chargé juste avant) */
  var B=root.BRAND||{};
  var PROD=B.baseUrl||'';
  var PREVIEW_RE=B.previewHostRe?new RegExp(B.previewHostRe):/(?!)/;/* motif absent : aucune prévisualisation reconnue */
  var TRY_KEY='wl_handoff_try',TRY_GAP=60000;

  function b64e(s){return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
  function b64d(s){s=String(s).replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';return atob(s);}
  function isPreviewHost(h){return PREVIEW_RE.test(String(h||''));}
  /* Origine exacte d'une prévisualisation : https, sans port, sans chemin */
  function okOrigin(o){
    try{var u=new URL(o);return u.protocol==='https:'&&!u.port&&u.origin===o&&PREVIEW_RE.test(u.hostname);}catch(e){return false;}
  }
  function okToken(tok){return typeof tok==='string'&&tok.length<4096&&/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(tok);}
  function param(name){var m=new RegExp('(?:^|[#&])'+name+'=([^&]*)').exec(root.location.hash||'');return m?m[1]:null;}
  function stripHash(){try{root.history.replaceState(null,'',root.location.pathname+root.location.search);}catch(e){}}
  function hasStoredSession(){
    try{
      var ls=root.localStorage;
      for(var i=0;i<ls.length;i++){
        var k=ls.key(i);
        if(!/^sb-[a-z0-9]+-auth-token$/.test(k||''))continue;
        var s=JSON.parse(ls.getItem(k)||'null');
        if(s&&(s.refresh_token||s.access_token||(s.currentSession&&s.currentSession.refresh_token)))return true;
      }
    }catch(e){}
    return false;
  }

  /* Étape 1 et lecture des retours : exécuté tout de suite (avant la page d'accueil des visiteurs et avant supabase-js) */
  function boot(){
    var host=root.location.hostname;
    if(isPreviewHost(host)){
      var h=param('wl_handoff');
      if(h!==null){
        stripHash();
        if(h!=='none'){try{var d=JSON.parse(b64d(h));if(d&&okToken(d.at))root.__wlHandoff={at:d.at};}catch(e){}}
        return;
      }
      if(hasStoredSession())return;
      if(/[?&]wl_nohandoff(=|&|$)/.test(root.location.search||''))return;/* ?wl_nohandoff=1 : ouvrir la prévisualisation telle quelle, sans aller-retour */
      try{
        var last=+root.sessionStorage.getItem(TRY_KEY)||0;
        if(Date.now()-last<TRY_GAP)return;
        root.sessionStorage.setItem(TRY_KEY,String(Date.now()));
      }catch(e){return;}
      if(!PROD)return;
      root.location.replace(PROD+'/#wl_preview='+encodeURIComponent(root.location.origin));
      return;
    }
    var p=param('wl_preview');
    if(p!==null){
      var o='';try{o=decodeURIComponent(p);}catch(e){}
      stripHash();
      root.__wlPreviewReq=okOrigin(o)?o:null;
    }
  }

  /* Étape 2 (production) et 3 (prévisualisation) : appelé par js/01-config.js juste après createClient */
  function serve(supa){
    var o=root.__wlPreviewReq;
    if(!o||!supa||!supa.auth)return;
    root.__wlPreviewReq=null;
    var back=function(tok){root.location.replace(o+'/#wl_handoff='+tok);};
    supa.auth.getSession().then(function(r){
      var s=r&&r.data&&r.data.session;
      back(s&&okToken(s.access_token)?b64e(JSON.stringify({at:s.access_token})):'none');
    }).catch(function(){back('none');});
  }
  function apply(supa){
    serve(supa);
    var hd=root.__wlHandoff;
    if(hd&&supa&&supa.auth){
      root.__wlHandoff=null;
      /* Jeton de rafraîchissement factice : voir l'en-tête (la session expire seule, sans toucher à la production) */
      supa.auth.setSession({access_token:hd.at,refresh_token:'handoff'}).catch(function(){});
    }
  }

  root.PreviewHandoff={apply:apply,serve:serve,boot:boot,isPreviewHost:isPreviewHost,okOrigin:okOrigin,okToken:okToken,PROD:PROD,_b64e:b64e,_b64d:b64d};
  boot();
})(typeof window!=='undefined'?window:globalThis);
