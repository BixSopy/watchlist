/* MODULE: Actions de l'interface, sans gestionnaire d'événement écrit dans le HTML.
   La CSP n'autorise plus les attributs onclick=, onchange=… (pas de script-src-attr 'unsafe-inline') :
   un attribut injecté dans la page ne peut donc plus exécuter de code. À la place, le HTML porte
   des attributs de données et ce module appelle la fonction correspondante, prise dans une liste fermée :
     data-click="nom"   data-change="nom"   data-input="nom"   data-args='[…]' (JSON, facultatif)
     data-sfx-hover     son de survol (équivalent de onmouseenter="sfx('hover')")
     data-hide-broken   image masquée si elle ne charge pas (équivalent de onerror="this.style.display='none'")
   La fonction reçoit (élément, événement, ...arguments), avec this = l'élément, comme l'ancien attribut.
   Les écouteurs sont posés en phase de capture sur window : ils passent avant ceux des conteneurs, et
   event.stopPropagation() dans une action empêche, comme avant, les clics « parents » de se déclencher. */
var UI_ACTIONS=Object.create(null);
function uiOn(name,fn){UI_ACTIONS[name]=fn;}
function _uiEsc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
/* Attributs HTML d'une action : ' data-click="nom" data-args="[…]"' (type : click, change ou input) */
function uiAct(name,args,type){
  return ' data-'+(type||'click')+'="'+_uiEsc(name)+'"'+(args&&args.length?' data-args="'+_uiEsc(JSON.stringify(args))+'"':'');
}
(function(){
  function report(err){if(typeof window.reportError==='function')window.reportError(err);else setTimeout(function(){throw err;});}
  function run(type,e){
    var attr='data-'+type,tg=e.target;
    if(!tg||!tg.closest)return;
    /* Chaîne des éléments concernés, calculée avant d'appeler quoi que ce soit (comme le chemin d'un
       événement) : une action qui reconstruit le HTML ne fait pas sauter celles des éléments parents. */
    var chain=[];
    for(var el=tg.closest('['+attr+']');el;el=el.parentElement&&el.parentElement.closest('['+attr+']'))chain.push(el);
    for(var i=0;i<chain.length;i++){
      el=chain[i];
      if(el.matches(':disabled'))continue;
      var fn=UI_ACTIONS[el.getAttribute(attr)];
      if(typeof fn==='function'){
        var args=[];
        var raw=el.getAttribute('data-args');
        if(raw){try{args=JSON.parse(raw);}catch(_){args=[];}if(!Array.isArray(args))args=[];}
        try{fn.apply(el,[el,e].concat(args));}catch(err){report(err);}
      }
      if(e.cancelBubble)break;
    }
  }
  window.addEventListener('click',function(e){run('click',e);},true);
  window.addEventListener('change',function(e){run('change',e);},true);
  window.addEventListener('input',function(e){run('input',e);},true);
  /* Survol : un son par élément « entré », comme mouseenter (pas en passant d'un enfant à l'autre) */
  window.addEventListener('mouseover',function(e){
    var tg=e.target;if(!tg||!tg.closest)return;
    for(var el=tg.closest('[data-sfx-hover]');el;el=el.parentElement&&el.parentElement.closest('[data-sfx-hover]')){
      if(e.relatedTarget&&el.contains(e.relatedTarget))continue;
      if(typeof sfx==='function')sfx('hover');
    }
  },true);
  /* Les erreurs de chargement d'image ne remontent pas : on les attrape en phase de capture */
  document.addEventListener('error',function(e){
    var img=e.target;
    if(img&&img.tagName==='IMG'&&img.hasAttribute('data-hide-broken'))img.style.display='none';
  },true);
})();

/* Identifiants toujours passés en texte (comme l'ancien jsArg) */
function _uiId(v){return String(v==null?'':v);}

/* ---------- Liste fermée des actions (les fonctions appelées sont définies dans les autres modules) ---------- */
/* En-tête, menu, réglages */
uiOn('toggleSidebar',function(el,e,force){toggleSidebar(force);});
uiOn('toggleMenu',function(){toggleMenu();});
uiOn('openSettings',function(){openSettingsView();});
uiOn('closeSettings',function(){closeSettingsView();});
uiOn('menuStats',function(){openStats();toggleMenu();});
uiOn('menuExportJson',function(){exportJSON();toggleMenu();});
uiOn('menuAccount',function(){openAuthModal();toggleMenu();});
uiOn('menuExportAccount',function(){exportAccountData();toggleMenu();});
uiOn('settingToggle',function(el,e,key){_onSettingToggle(key,el);});
var _UI_SETTING_FNS={toggleCompact:function(){toggleCompact();},toggleSound:function(){toggleSound();},toggleSuiviSection:function(){toggleSuiviSection();}};
uiOn('settingFn',function(el,e,name){var f=_UI_SETTING_FNS[name];if(!f)return;f();renderSettingsMenu();});
uiOn('settingSelect',function(el,e,key){_onSettingSelect(key,el.value);});
uiOn('settingRange',function(el,e,key){_onSettingRange(key,el.value);});
uiOn('copyWebhook',function(el,e,id){copyWebhookText(id);});
uiOn('genWebhookToken',function(){generatePlexWebhookToken();});
uiOn('toggleWebhookAdvanced',function(){togglePlexWebhookAdvanced();});
uiOn('resetDismissed',function(){resetDismissedRecos();});
uiOn('clearDiscoveryCache',function(){clearDiscoveryCache();});
uiOn('setLang',function(el,e,code,opts){setLang(code,opts);});
/* Liste, onglets, cartes */
uiOn('sfxClick',function(){sfx('click');});
uiOn('switchTab',function(el){switchTab(el);});
/* Onglet « Détectés » (js/21-detected.js) */
uiOn('detFilter',function(el,e,f){sfx('click');detFilter(f);});
uiOn('detToggle',function(el,e,key){detToggle(key,el.checked);});
uiOn('detSelectAll',function(el){detSelectAll(el.checked);});
uiOn('detCand',function(el,e,key){detCand(key,el.value);});
uiOn('detTarget',function(el,e,key){detTarget(key,el.value);});
uiOn('detIgnore',function(el,e,key){detIgnore(key);});
uiOn('detSearchInput',function(el,e,key){detSearchInput(key,el.value);});
uiOn('detSearch',function(el,e,key){detSearch(key,el.value);});
uiOn('detSearchBtn',function(el,e,key){sfx('click');detSearchBtn(key);});
uiOn('detIgnoreSel',function(){detIgnoreSel();});
uiOn('detAddSel',function(){detAddSel();});
uiOn('detAddAll',function(){detAddAll();});
uiOn('detClearAll',function(){detClearAll();});
uiOn('detReload',function(){sfx('click');detReload();});
uiOn('statSelMobile',function(el){var b=document.querySelector('.stab[data-s="'+String(el.value).replace(/["\\]/g,'')+'"]');if(b)b.click();});
uiOn('closeAlert',function(){document.getElementById('alertWrap').classList.remove('on');});
uiOn('switchDiscoverCat',function(el){switchDiscoverCat(el);});
uiOn('openPlex',function(el,e,id){sfx('open');openPlex(_uiId(id));});
uiOn('openPlexQuiet',function(el,e,id){openPlex(_uiId(id));});
uiOn('quickNextEp',function(el,e,id){quickNextEp(_uiId(id),e);});
uiOn('editEntry',function(el,e,id){e.stopPropagation();sfx('open');openEdit(_uiId(id));});
uiOn('delEntry',function(el,e,id){e.stopPropagation();delEntry(_uiId(id));});
uiOn('loadMoreSec',function(el,e,secId){loadMoreSec(secId,el);});
uiOn('heroGoTo',function(el,e,i){sfx('click');_heroGoTo(i);});
uiOn('drScrollRow',function(el,e,id,dir){drScrollRow(id,dir);});
uiOn('openPlexRecoCard',function(el){sfx('open');openPlexReco(getCardData(el));});
uiOn('toggleSuivi',function(){toggleSuiviSection();});
uiOn('toggleReminder',function(el,e,id){e.stopPropagation();toggleReminder(_uiId(id));});
/* Recommandations */
uiOn('refreshRecos',function(){sfx('click');_preserveContentScroll(function(){cache={};seenRecos=[];loadRecos();});});
uiOn('recoPreview',function(el){recoPreview(el.closest('.reco-card'));});
uiOn('recoAdd',function(el){recoAdd(el.closest('.reco-card'));});
uiOn('recoDismiss',function(el){recoDismiss(el.closest('.reco-card'));});
/* Ajout / édition, fiche, dossiers, statistiques */
uiOn('openAdd',function(){sfx('open');openAdd();});
uiOn('closeAdd',function(){sfx('close');closeAdd();});
uiOn('saveEntry',function(){saveEntry();});
uiOn('clearSel',function(){clearSel();});
uiOn('setRate',function(el,e,v){setRate(v);});
uiOn('rmTag',function(el,e,i){rmTag(i);});
uiOn('plexSeason',function(el,e,n){plexSeason(n);});
uiOn('openFolder',function(el,e,id){sfx('open');openFolder(_uiId(id));});
uiOn('folderItem',function(el,e,id){id=_uiId(id);sfx('open');closeFolder();setTimeout(function(){openPlex(id);},80);});
uiOn('closeFolder',function(){sfx('close');closeFolder();});
uiOn('closeStats',function(){sfx('close');document.getElementById('statsMbk').classList.remove('on');});
/* Recherche */
uiOn('closeSearch',function(){sfx('close');closeSearchModal();});
uiOn('searchPage',function(el,e,d){searchPage(d);});
uiOn('searchFilters',function(){_runSearch(document.getElementById('searchModalInput').value,1);});
uiOn('toggleSCard',function(el,e,key){e.stopPropagation();toggleSCard(key);});
uiOn('addSelectedBatch',function(){addSelectedBatch();});
/* Compte */
uiOn('openAuth',function(el,e,view){openAuthModal(view);});
uiOn('closeAuth',function(){closeAuthModal();});
uiOn('authGo',function(el,e,view,ctx){authGo(view,ctx);});
uiOn('authHaveCodeEmail',function(){authGo('emailSent',{newEmail:_val('authNewEmail').trim()});});
uiOn('authResend',function(el){authResend(el);});
uiOn('togglePw',function(el,e,id){togglePwVisibility(id,el);});
uiOn('exportAccount',function(el){exportAccountData(el);});
uiOn('syncNow',function(){syncNow();});
uiOn('signOut',function(){signOutUser();});
