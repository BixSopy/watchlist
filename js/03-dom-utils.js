/* MODULE: Toast, IndexedDB (ouverture/lecture/écriture) et utilitaires d'échappement/formatage. */
/* TOAST */
function toast(msg,kind){
  sfx('toast');var w=document.getElementById('toastWrap');
  var t=document.createElement('div');t.className='toast '+(kind||'ok');
  var ic=kind=='err'?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>':kind=='nfo'?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/></svg>':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
  /* Icône statique en HTML, message en texte brut : un titre TMDB ne peut plus injecter de HTML */
  t.innerHTML=ic;var sp=document.createElement('span');sp.textContent=String(msg==null?'':msg);t.appendChild(sp);w.appendChild(t);
  setTimeout(function(){t.style.transition='opacity .3s,transform .3s';t.style.opacity='0';t.style.transform='translateX(40px)';setTimeout(function(){t.remove();},300);},2800);
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
/* Argument de chaîne sûr dans un attribut onclick="f(...)" : littéral JS (JSON) puis échappement HTML */
function jsArg(s){return esc(JSON.stringify(String(s==null?'':s)));}
function icon(t){return t=='film'?'&#127916;':t=='serie'?'&#128250;':'&#127884;';}
function tbadge(t){var c={film:'bf',serie:'bs',anime:'ba'}[t]||'bf';var l={film:'Film',serie:'Série',anime:'Anime'}[t]||t;return '<span class="badge '+c+'">'+l+'</span>';}
function sbadge(s){var c={avoir:'bav',encours:'bec',termine:'bte',todo:'btd'}[s]||'bav';var l={avoir:'À voir',encours:'En cours',termine:'Terminé',todo:'À qualifier'}[s]||s;return '<span class="badge '+c+'">'+l+'</span>';}
function starsvg(f){if(f)return '<svg viewBox="0 0 24 24"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" fill="currentColor"/></svg>';return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>';}

/* Journalisation minimale : code et message seulement (jamais d'objet complet, de jeton ni de donnée perso) */
function _logErr(tag,e){try{console.error(tag,(e&&e.code)||'',(e&&e.message)||String(e||''));}catch(_){}}

