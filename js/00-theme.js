/* MODULE: Thème clair/sombre — décision avant le premier rendu (même principe/emplacement
   que js/00-landing-gate.js : chargé de façon synchrone en <head>, pour éviter un flash du
   mauvais thème). wl_theme dans localStorage : 'system' (par défaut, suit l'OS) | 'dark' | 'light'.
   Demande explicite de Pierre (06/11) : un vrai sélecteur, pas une simple recoloration — voir
   le bloc :root[data-theme="light"] de css/app.css et le menu Réglages (js/17-settings-menu.js). */
(function(){
  var MQ=window.matchMedia?window.matchMedia('(prefers-color-scheme: light)'):null;
  function resolve(pref){
    if(pref==='dark'||pref==='light')return pref;
    return (MQ&&MQ.matches)?'light':'dark';
  }
  function metaColor(theme){return theme==='light'?'#f5f6f8':'#06070a';}
  function apply(theme){
    document.documentElement.setAttribute('data-theme',theme);
    var m=document.querySelector('meta[name="theme-color"]');
    if(m)m.setAttribute('content',metaColor(theme));
  }
  function refreshGlass(){
    if(typeof applyGlass==='function'&&typeof wlSettings!=='undefined'&&wlSettings.wl_glass!==undefined){
      applyGlass(parseInt(wlSettings.wl_glass,10));
    }
  }
  /* Appelé par le menu Réglages au changement (Système/Sombre/Clair) */
  window.applyThemePref=function(pref){
    try{localStorage.setItem('wl_theme',pref);}catch(e){}
    apply(resolve(pref));
    refreshGlass();
  };
  var pref;
  try{pref=localStorage.getItem('wl_theme')||'system';}catch(e){pref='system';}
  apply(resolve(pref));
  if(MQ&&MQ.addEventListener){
    MQ.addEventListener('change',function(){
      var cur;
      try{cur=localStorage.getItem('wl_theme')||'system';}catch(e){cur='system';}
      if(cur==='system'){apply(resolve('system'));refreshGlass();}
    });
  }
})();
