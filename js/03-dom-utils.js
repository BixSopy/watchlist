/* MODULE: Toast, IndexedDB (ouverture/lecture/écriture) et utilitaires d'échappement/formatage. */
/* TOAST */
/* Muet : seules les vraies notifications (nouveaux épisodes, js/14-suivi.js) jouent sfx('toast') */
/* act (facultatif) : {label,fn} ajoute un bouton d'action (ex. « Annuler ») et garde le toast plus longtemps */
function toast(msg,kind){
  var act=arguments[2];var w=document.getElementById('toastWrap');
  var tt=document.createElement('div');tt.className='toast '+(kind||'ok');
  var ic=kind=='err'?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>':kind=='nfo'?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/></svg>':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
  /* Icône statique en HTML, message en texte brut : un titre TMDB ne peut plus injecter de HTML */
  tt.innerHTML=ic;var sp=document.createElement('span');sp.textContent=String(msg==null?'':msg);tt.appendChild(sp);if(act&&act.label&&typeof act.fn==='function'){var ab=document.createElement('button');ab.type='button';ab.className='toast-act';ab.textContent=act.label;ab.addEventListener('click',function(ev){ev.stopPropagation();if(ab._done)return;ab._done=1;tt.remove();act.fn();});tt.appendChild(ab);tt.style.pointerEvents='auto';}
  w.appendChild(tt);
  /* Téléphone : 2 toasts au plus (le plus ancien part), pour ne pas masquer le bas de la liste */
  try{if(window.matchMedia('(max-width:768px)').matches){while(w.children.length>2)w.removeChild(w.firstChild);}}catch(_){}
  setTimeout(function(){tt.style.transition='opacity .3s,transform .3s';tt.style.opacity='0';tt.style.transform='translateX('+(40*hScrollSign())+'px)';setTimeout(function(){tt.remove();},300);},act?6000:2800);
}

/* DB */
function openDB(cb){
  var r=indexedDB.open('wl_db',1);
  r.onupgradeneeded=function(e){e.target.result.createObjectStore('entries',{keyPath:'id'})};
  r.onsuccess=function(e){idb=e.target.result;idb.transaction('entries','readonly').objectStore('entries').getAll().onsuccess=function(ev){memDB=ev.target.result||[];cb();};};
  r.onerror=function(){cb()};
}
function dbPut(e,cb){if(!idb){cb&&cb();return}var tx=idb.transaction('entries','readwrite');tx.objectStore('entries').put(e);tx.oncomplete=function(){cb&&cb()};}
function dbDel(id,cb){if(!idb){cb&&cb();return}var tx=idb.transaction('entries','readwrite');tx.objectStore('entries').delete(id);tx.oncomplete=function(){cb&&cb()};}
function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2)}
function pad(n){return String(n).padStart(2,'0')}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
function icon(tt){return tt=='film'?'&#127916;':tt=='serie'?'&#128250;':'&#127884;';}
function tbadge(tt){var c={film:'bf',serie:'bs',anime:'ba'}[tt]||'bf';var l={film:t('type.film'),serie:t('type.serie'),anime:t('type.anime')}[tt]||tt;return '<span class="badge '+c+'">'+l+'</span>';}
function sbadge(s){var c={avoir:'bav',encours:'bec',termine:'bte',todo:'btd'}[s]||'bav';var l={avoir:t('status.avoir'),encours:t('status.encours'),termine:t('status.termine'),todo:t('status.todo')}[s]||s;return '<span class="badge '+c+'">'+l+'</span>';}
function starsvg(f){if(f)return '<svg viewBox="0 0 24 24"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" fill="currentColor"/></svg>';return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>';}

/* Journalisation minimale : code et message seulement (jamais d'objet complet, de jeton ni de donnée perso) */
function _logErr(tag,e){try{console.error(tag,(e&&e.code)||'',(e&&e.message)||String(e||''));}catch(_){}}


/* ===== Sens de lecture (arabe, ourdou : js/00-i18n.js pose IS_RTL et <html dir="rtl">) =====
   En LTR, chaque utilitaire rend exactement la valeur d'avant (signe 1, flèches →/›, texte inchangé). */
function isRtl(){return typeof IS_RTL!=='undefined'&&!!IS_RTL;}
/* +1 en LTR, −1 en RTL : « vers la fin du sens de lecture » en x physique (gestes, translateX, flèches du clavier) */
function hScrollSign(){return isRtl()?-1:1;}
/* Défilement horizontal d'un élément : en RTL (navigateurs actuels) scrollLeft va de 0 (début, à droite)
   à −max (fin, à gauche). Bornes physiques de scrollLeft selon le sens réel de l'élément. */
function hScrollRtlEl(el){try{return getComputedStyle(el).direction==='rtl';}catch(_){return isRtl();}}
function hScrollBounds(el){var max=Math.max(0,el.scrollWidth-el.clientWidth);return hScrollRtlEl(el)?[-max,0]:[0,max];}
/* Position logique (0 = début du sens de lecture), utile pour savoir si l'on est au bout */
function hScrollPos(el){return Math.abs(el.scrollLeft||0);}
/* Flèches de navigation écrites dans les gabarits : inversées en RTL */
function arrowFwd(){return isRtl()?'←':'→';}
function arrowBack(){return isRtl()?'→':'←';}
/* ‹ › sont retournés automatiquement par l'algorithme bidi en RTL (Bidi_Mirrored) : pas d'échange manuel, contrairement à ← → */
function chevFwd(){return '›';}
function chevBack(){return '‹';}
/* Titre, pseudo, nom d'appareil… inséré dans une interface RTL : isolé (FSI…PDI) pour que la
   ponctuation finale (« What If...? ») et les mots voisins (« · S1 E4 ») gardent leur place. Inchangé en LTR. */
function bidiIso(s){s=s==null?'':String(s);return isRtl()&&s?'\u2068'+s+'\u2069':s;}
/* Coupe un texte affiché à n caractères visibles sans casser un emoji ni une syllabe (devanagari, bengali…) */
function strCut(s,n){
  s=String(s==null?'':s);if(s.length<=n)return s;
  try{if(typeof Intl!=='undefined'&&Intl.Segmenter){var out='',k=0,it=new Intl.Segmenter(typeof LOCALE!=='undefined'?LOCALE:undefined,{granularity:'grapheme'}).segment(s)[Symbol.iterator](),r;while(k<n&&!(r=it.next()).done){out+=r.value.segment;k++;}return out;}}catch(_){}
  return Array.from(s).slice(0,n).join('');
}
/* Tri alphabétique des titres/noms affichés selon la langue de l'interface (pas celle du navigateur) */
var _wlCollator=null;
function textCompare(a,b){
  a=a==null?'':String(a);b=b==null?'':String(b);
  if(!_wlCollator){try{_wlCollator=new Intl.Collator(typeof LOCALE!=='undefined'?LOCALE:undefined);}catch(_){_wlCollator={compare:function(x,y){return x.localeCompare(y);}};}}
  return _wlCollator.compare(a,b);
}
/* Identifiant de saga/dossier : même résultat qu'avant pour les écritures latines ([a-z0-9], accents
   retirés sans translittération : « Astérix » → « ast-rix »), mais les lettres et chiffres des autres
   écritures (cyrillique, arabe, CJK, devanagari…) sont gardés : sinon « Гарри Поттер » donnait une clé vide. */
var _slugKeep=null;
/* Lettre/chiffre d'une écriture non latine (cyrillique, arabe, CJK, devanagari…) ; « ー » (katakana,
   écriture « commune ») gardé ; symboles communs (², ʹ), accents combinants et lettres latines non. */
function isOtherScriptChar(ch){
  if(_slugKeep===null){try{_slugKeep={ok:new RegExp('[\\p{L}\\p{M}\\p{Nd}]','u'),lat:new RegExp('[\\p{Script=Latin}\\p{Script=Inherited}]','u'),com:new RegExp('\\p{Script=Common}','u'),L:new RegExp('\\p{L}','u')};}catch(_){_slugKeep=false;}}
  var k=_slugKeep;if(!k||!ch)return false;
  return k.ok.test(ch)&&!k.lat.test(ch)&&!(k.com.test(ch)&&(ch.codePointAt(0)<0x3000||!k.L.test(ch)));
}
/* Garde [a-z0-9] (+ extra, ex. « +> ») et les caractères des autres écritures ; le reste devient rep */
function keepScriptChars(s,rep,extra){
  var out='',re=extra?new RegExp('[a-z0-9'+extra+']'):/[a-z0-9]/;
  for(var it=String(s)[Symbol.iterator](),r;!(r=it.next()).done;){var ch=r.value;out+=(re.test(ch)||isOtherScriptChar(ch))?ch:rep;}
  return out;
}
function slugKey(s){
  return keepScriptChars(String(s==null?'':s).toLowerCase(),' ').replace(/ +/g,'-').replace(/^-|-$/g,'');
}
