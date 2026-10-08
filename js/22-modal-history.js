/* MODULE: Bouton / geste « retour » (Android, navigateur) : ferme la fenêtre ouverte au lieu de quitter le site.
   Chaque fenêtre (fiche, ajout/édition, compte, avis, statistiques, saga, catalogue, menu, panneau Recommandations)
   ajoute une entrée d'historique à son ouverture (history.pushState, même URL). « Retour » retire cette entrée
   et on ferme la fenêtre du dessus. Une fermeture par ×, le fond ou Échap retire l'entrée (history.back()).
   Les fenêtres sont suivies par leurs classes (MutationObserver) : aucune fonction d'ouverture n'est modifiée. */
(function(){
  if(typeof window==='undefined'||!window.history||typeof history.pushState!=='function'||typeof MutationObserver==='undefined')return;
  function byId(id){return document.getElementById(id);}
  var DEFS=[
    {id:'searchModal',cls:'on',close:function(){closeSearchModal();}},
    {id:'plexMbk',cls:'on',close:function(){closePlex();}},
    {id:'addMbk',cls:'on',close:function(){closeAdd();}},
    {id:'authMbk',cls:'on',close:function(){closeAuthModal();}},
    {id:'fbMbk',cls:'on',close:function(){if(typeof closeFeedback==='function')closeFeedback();}},
    {id:'statsMbk',cls:'on',close:function(){byId('statsMbk').classList.remove('on');}},
    {id:'folderMbk',cls:'on',close:function(){closeFolder();}},
    {id:'optMenu',cls:'on',close:function(){byId('optMenu').classList.remove('on');closeSettingsView();}},
    {sel:'.sidebar',key:'sidebar',cls:'open',close:function(){toggleSidebar(false);}}
  ];
  var stack=[];     /* fenêtres ouvertes qui ont leur entrée d'historique (la dernière est au-dessus) */
  var expectPop=0;  /* retours lancés par le code (fermeture par ×, fond, Échap) : popstate à ignorer */
  var queued=[];    /* ouvertures survenues pendant un retour en cours : entrée ajoutée après son popstate */
  var state={};
  function el(d){return d.id?byId(d.id):document.querySelector(d.sel);}
  function key(d){return d.id||d.key;}
  function isOpen(d){var e=el(d);return !!(e&&e.classList.contains(d.cls));}
  function def(k){for(var i=0;i<DEFS.length;i++)if(key(DEFS[i])===k)return DEFS[i];return null;}
  function push(k){stack.push(k);try{history.pushState({wlModal:k},'');}catch(e){}}
  function onOpen(k){if(stack.indexOf(k)>=0||queued.indexOf(k)>=0)return;if(expectPop){queued.push(k);return;}push(k);}
  function onClose(k){
    var q=queued.indexOf(k);if(q>=0){queued.splice(q,1);return;}
    var i=stack.indexOf(k);if(i<0)return;/* déjà retirée par « retour » */
    if(i===stack.length-1){stack.pop();expectPop++;try{history.back();}catch(e){expectPop--;}}
    else stack.splice(i,1);/* fenêtre du dessous fermée en premier : son entrée reste, sans effet visible */
  }
  function scan(){
    var closes=[],opens=[];
    DEFS.forEach(function(d){
      var k=key(d),now=isOpen(d);
      if(now===!!state[k])return;
      state[k]=now;(now?opens:closes).push(k);
    });
    /* Fermetures d'abord : « Modifier » depuis la fiche ferme la fiche puis ouvre l'édition */
    closes.forEach(onClose);opens.forEach(onOpen);
  }
  window.addEventListener('popstate',function(){
    if(expectPop>0){
      expectPop--;
      if(!expectPop&&queued.length){var q=queued;queued=[];q.forEach(function(k){var d=def(k);if(d&&isOpen(d))push(k);});}
      return;
    }
    var k=stack.pop();if(!k)return;
    var d=def(k);
    if(d&&isOpen(d)){state[k]=false;try{if(k!=='sidebar'&&typeof sfx==='function')sfx('close');d.close();}catch(e){if(typeof _logErr==='function')_logErr('[retour]',e);}}
  });
  /* Rechargement alors qu'une fenêtre était ouverte : l'entrée n'a plus de fenêtre associée */
  try{if(history.state&&history.state.wlModal)history.replaceState(null,'');}catch(e){}
  var mo=new MutationObserver(scan);
  DEFS.forEach(function(d){var e=el(d);if(e){state[key(d)]=isOpen(d);mo.observe(e,{attributes:true,attributeFilter:['class']});}});
  /* Accès pour les tests */
  window._modalHistory={stack:function(){return stack.slice();}};
})();
