/* MODULE: Raccourcis clavier, sélecteurs personnalisés, démarrage de l'app (bootstrap). */
/* KEYBOARD */
document.addEventListener('keydown',function(e){
  var searchOpen=document.getElementById('searchModal')&&document.getElementById('searchModal').classList.contains('on');
  var folderOpen=document.getElementById('folderMbk')&&document.getElementById('folderMbk').classList.contains('on');
  if(e.key==='Escape'){
    if(searchOpen){e.preventDefault();sfx('close');closeSearchModal();return;}
    if(folderOpen){e.preventDefault();sfx('close');closeFolder();return;}
    if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.tagName==='SELECT'){e.target.blur();return;}
    sfx('close');closeAdd();closePlex();document.getElementById('statsMbk').classList.remove('on');return;
  }
  if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.tagName==='SELECT')return;
  /* Page d'accueil affichée : pas de raccourcis de l'app (elle est masquée) */
  if(document.documentElement.classList.contains('lp-guest'))return;
  if(e.key==='n'||e.key==='N'){e.preventDefault();openAdd();}
  else if(e.key==='f'||e.key==='F'){e.preventDefault();document.getElementById('qinput').focus();}
  else if(e.key==='s'||e.key==='S'){e.preventDefault();openStats();}
  else if(e.key==='c'||e.key==='C'){e.preventDefault();toggleCompact();}
  else if(e.key==='m'||e.key==='M'){e.preventDefault();toggleSound();}
});

/* ===== Session 18 : selects personnalises (Liquid Glass + ressort) =====
   Le popup d'un <select> natif est dessine par l'OS : impossible a styler en CSS
   (c'est exactement ce qu'on voit sur un select ouvert — menu plat, surbrillance
   bleue systeme). On masque le <select> (il reste dans le DOM, sa valeur et ses
   evenements 'change' continuent de piloter tout le code existant sans aucune
   modif ailleurs) et on construit un bouton + menu entierement stylables par-dessus. */
function enhanceSelect(sel){
  if(!sel||sel._cselDone)return;sel._cselDone=true;
  var wrap=document.createElement('div');
  wrap.className='csel'+(sel.className?' '+sel.className:'');
  sel.parentNode.insertBefore(wrap,sel);
  wrap.appendChild(sel);
  var btn=document.createElement('button');
  btn.type='button';btn.className='csel-btn '+sel.className;
  var lbl=document.createElement('span');lbl.className='csel-lbl';
  var chev=document.createElementNS('http://www.w3.org/2000/svg','svg');
  chev.setAttribute('class','csel-chev');chev.setAttribute('viewBox','0 0 24 24');chev.setAttribute('fill','none');chev.setAttribute('stroke','currentColor');chev.setAttribute('stroke-width','2.4');
  chev.innerHTML='<polyline points="6 9 12 15 18 9"/>';
  btn.appendChild(lbl);btn.appendChild(chev);
  var menu=document.createElement('div');menu.className='csel-menu';menu.setAttribute('role','listbox');
  function curLabel(){var o=sel.options[sel.selectedIndex];return o?o.text:'';}
  function renderMenu(){
    menu.innerHTML='';
    Array.prototype.forEach.call(sel.options,function(o,i){
      var opt=document.createElement('div');
      opt.className='csel-opt'+(i===sel.selectedIndex?' on':'');
      opt.setAttribute('role','option');opt.textContent=o.text;
      opt.onclick=function(e){
        e.stopPropagation();
        if(sel.selectedIndex!==i){sel.selectedIndex=i;sel.dispatchEvent(new Event('change',{bubbles:true}));}
        lbl.textContent=curLabel();
        close();sfx('click');
      };
      menu.appendChild(opt);
    });
  }
  function isOpen(){return wrap.classList.contains('open');}
  function open(){if(isOpen())return;renderMenu();wrap.classList.add('open');document.addEventListener('click',onDocClick);sfx('click');}
  function close(){wrap.classList.remove('open');document.removeEventListener('click',onDocClick);}
  function onDocClick(e){if(!wrap.contains(e.target))close();}
  btn.onclick=function(e){e.stopPropagation();isOpen()?close():open();};
  btn.onkeydown=function(e){
    if(e.key==='Escape'){if(isOpen()){e.stopPropagation();close();}return;}
    if(e.key==='Enter'||e.key===' '){e.preventDefault();isOpen()?close():open();return;}
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){
      e.preventDefault();
      var n=sel.options.length;if(!n)return;
      var d=e.key==='ArrowDown'?1:-1;
      sel.selectedIndex=(sel.selectedIndex+d+n)%n;
      sel.dispatchEvent(new Event('change',{bubbles:true}));
      lbl.textContent=curLabel();
      if(isOpen())renderMenu();
    }
  };
  sel.addEventListener('change',function(){lbl.textContent=curLabel();});
  lbl.textContent=curLabel();
  wrap.appendChild(btn);wrap.appendChild(menu);
}
function enhanceAllSelects(root){
  (root||document).querySelectorAll('select:not(.csel-done-marker)').forEach(function(s){
    if(!s._cselDone)enhanceSelect(s);
  });
}
/* Poser la valeur d'un <select> depuis le code (pas un choix de l'utilisateur dans le menu) :
   affecter .value ne déclenche pas 'change', or c'est le seul événement écouté par le menu
   personnalisé (enhanceSelect ci-dessus) pour rafraîchir son libellé affiché — sans ce
   déclenchement manuel, le menu continue d'afficher l'ancienne valeur même si .value est à jour. */
function setSelVal(id,value){
  var el=document.getElementById(id);
  if(!el)return;
  el.value=value;
  el.dispatchEvent(new Event('change',{bubbles:true}));
}

/* INIT */
soundOn=localStorage.getItem('wl_snd')!='0';
loadSfxVolume();
compactOn=localStorage.getItem('wl_cpt')=='1';
try{dismissed=JSON.parse(localStorage.getItem('wl_dis')||'[]');}catch(e){dismissed=[];}
loadSettings();applySettings();
/* IndexedDB peut s'ouvrir pendant que le navigateur télécharge encore les scripts suivants
   (réseau lent) : on attend qu'ils soient tous exécutés (DOMContentLoaded) avant de démarrer. */
function _whenScriptsReady(fn){if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',fn,{once:true});else fn();}
openDB(function(){_whenScriptsReady(_bootApp);});
function _bootApp(){render();loadRecos();setTimeout(checkAllAir,2000);bindSearchModalEvents();updateStatsFooter();var sw=document.getElementById('suiviWrap');if(sw&&suiviCollapsed)sw.classList.add('collapsed');initSuivi();initAuth();setTimeout(buildTasteProfileCache,4000);enhanceAllSelects(document);setTimeout(function(){detectCollections(true);},6000);}

/* PWA : enregistre un service worker volontairement sans cache (voir sw.js), uniquement
   pour satisfaire le critère d'installabilité de Chrome/Android ("Ajouter à l'écran
   d'accueil"). N'affecte jamais la fraîcheur des requêtes. */
if('serviceWorker' in navigator){
  window.addEventListener('load',function(){
    navigator.serviceWorker.register('/sw.js').catch(function(){});
  });
}
/* ResizeObserver : recalcul card size si fenêtre redimensionnée */
if(typeof ResizeObserver!=='undefined'){
  var _drRO=new ResizeObserver(function(){_calcDrCardSize();});
  var _drSec=document.getElementById('discoverSection');
  if(_drSec)_drRO.observe(_drSec);
}

/* ============================================================
   SEARCH CATALOG MODAL
   ============================================================ */
