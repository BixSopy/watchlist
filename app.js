/* CONFIG */
/* Les appels TMDB/OMDb passent par les fonctions serverless /api (clés côté serveur uniquement) */
var TB='/api/tmdb',IB='https://image.tmdb.org/t/p/';
/* SUPABASE — sync multi-appareils (Session 10) */
var SUPA_URL='https://batfulcvvquffgfeppcx.supabase.co';
var SUPA_KEY='sb_publishable_AgSykBvnAW4cZmuMZJWnrA_lcFL5eT0';
var supa=(typeof supabase!=='undefined')?supabase.createClient(SUPA_URL,SUPA_KEY):null;
var authUser=null,authProfileId=null,syncInProgress=false,syncLoopTimer=null,lastSyncErrorToast=0;
/* STATE */
var idb=null,memDB=[],editId=null,selTmdb=null,myRate=0,stimer=null;
var activeTab='all',activeStat='all',fq='',sortBy='date';
var curTags=[],plexData=null,plexSeasons=[],soundOn=true,compactOn=false;
var dismissed=[],cache={},autoTimer=null,autoPaused=false;

/* ===== SESSION 13 : DESIGN SONORE PREMIUM =====
   100% synthèse Web Audio API — toujours aucun fichier audio, aucune requête réseau.
   Principe : chaque son est construit à partir de 3 briques, calculées en JS au moment
   de la lecture, jamais chargées depuis un fichier :
   1) plusieurs oscillateurs très légèrement désaccordés entre eux (quelques Hz d'écart)
      pour une texture "chœur" au lieu d'un bip électronique nu ;
   2) un filtre passe-bas dont la fréquence de coupure s'assombrit pendant le son —
      ça adoucit les aigus durs, comme si le son passait dans un tissu épais ;
   3) une réverbe procédurale (une seule fois calculée, mise en cache) — l'empreinte
      de la façon dont un bruit sec s'éteint dans une petite pièce feutrée, utilisée
      seulement sur les sons qui méritent un peu d'espace (add/done/toast/close). */
var actx=null,_reverbNode=null,_noiseBufCache={};
function getAC(){if(!actx)try{actx=new(window.AudioContext||window.webkitAudioContext)();}catch(e){}return actx;}

/* Une "impulse response" = l'empreinte acoustique d'un espace. On la fabrique nous-mêmes
   avec du bruit qui s'éteint en decrescendo exponentiel (pas de fichier .wav) et on la
   réutilise pour tous les sons — calculée une seule fois, jamais recalculée ensuite. */
function _makeImpulse(ac,dur,decay){
  var rate=ac.sampleRate,len=Math.max(1,Math.floor(rate*dur));
  var buf=ac.createBuffer(2,len,rate);
  for(var ch=0;ch<2;ch++){
    var d=buf.getChannelData(ch);
    for(var i=0;i<len;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/len,decay);
  }
  return buf;
}
function _getReverb(ac){
  if(_reverbNode)return _reverbNode;
  _reverbNode=ac.createConvolver();
  _reverbNode.buffer=_makeImpulse(ac,1.1,2.6);
  _reverbNode.connect(ac.destination);
  return _reverbNode;
}
/* Petit "souffle" de bruit blanc filtré (texture organique en attaque) — mis en cache par
   durée pour ne jamais régénérer le même buffer à chaque interaction. */
function _getNoiseBuffer(ac,dur){
  var key=Math.round(dur*1000);
  if(_noiseBufCache[key])return _noiseBufCache[key];
  var len=Math.max(1,Math.floor(ac.sampleRate*dur)),buf=ac.createBuffer(1,len,ac.sampleRate),d=buf.getChannelData(0);
  for(var i=0;i<len;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/len,3);
  _noiseBufCache[key]=buf;
  return buf;
}
function _noise(ac,t0,dur,vol,cutoff){
  var src=ac.createBufferSource();src.buffer=_getNoiseBuffer(ac,dur);
  var f=ac.createBiquadFilter();f.type='bandpass';f.frequency.value=cutoff||3000;f.Q.value=.7;
  var g=ac.createGain();g.gain.setValueAtTime(vol,t0);g.gain.exponentialRampToValueAtTime(.0001,t0+dur);
  src.connect(f);f.connect(g);g.connect(ac.destination);
  src.start(t0);src.stop(t0+dur);
}
/* Une "note" premium : f/d/t/v/dl gardent exactement le même sens qu'avant (fréquence, durée,
   type d'onde, volume, délai) — opts ajoute les réglages qui font la différence :
   - opts.layers/opts.spread : 2-3 oscillateurs légèrement désaccordés (chœur discret)
   - opts.cutoff:[début,fin] : le filtre s'assombrit pendant le son (sensation "feutrée")
   - opts.glide : la hauteur glisse vers cette fréquence (glissando organique, pas un bip figé)
   - opts.noise : un souffle de bruit filtré très bref en complément (texture, jamais sur hover/click)
   - opts.reverb : quantité envoyée dans la réverbe partagée (sensation d'espace léger)
   L'enveloppe elle-même est douce : attaque courte mais pas instantanée, puis relâchement
   exponentiel qui laisse le son s'éteindre naturellement au lieu d'être coupé sec. */
function tone(f,d,t,v,dl,opts){
  if(!soundOn)return;var ac=getAC();if(!ac)return;
  opts=opts||{};
  var t0=ac.currentTime+(dl||0);
  var peak=v||.06;
  var attack=opts.attack!=null?opts.attack:.004;
  var release=Math.max(d-attack,.02);
  var glide=opts.glide;
  var spread=opts.spread!=null?opts.spread:5;
  var layers=opts.layers||2;
  var cutoffStart=opts.cutoff?opts.cutoff[0]:Math.max(f*2.4,1200);
  var cutoffEnd=opts.cutoff?opts.cutoff[1]:Math.max(f*0.9,300);

  var filt=ac.createBiquadFilter();filt.type='lowpass';filt.Q.value=opts.q!=null?opts.q:0.6;
  filt.frequency.setValueAtTime(cutoffStart,t0);
  filt.frequency.exponentialRampToValueAtTime(Math.max(80,cutoffEnd),t0+attack+release);

  var g=ac.createGain();
  g.gain.setValueAtTime(0,t0);
  g.gain.linearRampToValueAtTime(peak,t0+attack);
  g.gain.exponentialRampToValueAtTime(.0001,t0+attack+release);

  filt.connect(g);g.connect(ac.destination);
  if(opts.reverb){
    var send=ac.createGain();send.gain.value=opts.reverb;
    g.connect(send);send.connect(_getReverb(ac));
  }

  for(var i=0;i<layers;i++){
    var o=ac.createOscillator();o.type=t||'sine';
    var df=(i-((layers-1)/2))*spread;
    o.frequency.setValueAtTime(f+df,t0);
    if(glide!=null)o.frequency.exponentialRampToValueAtTime(Math.max(20,glide+df),t0+attack+release);
    o.connect(filt);o.start(t0);o.stop(t0+attack+release+.05);
  }
  if(opts.noise)_noise(ac,t0,opts.noise.dur,opts.noise.vol,opts.noise.cutoff);
}
function sfx(x){
  if(!soundOn)return;
  if(x=='hover')tone(3200,.022,'sine',.009,0,{layers:1,attack:.002,cutoff:[4200,2000]});
  else if(x=='click')tone(430,.09,'triangle',.045,0,{layers:2,spread:4,glide:390,cutoff:[2400,700]});
  else if(x=='add'){
    tone(523,.1,'triangle',.05,0,{layers:2,spread:5,cutoff:[2600,1400],noise:{dur:.03,vol:.02,cutoff:4000}});
    tone(659,.11,'sine',.045,.07,{layers:2,spread:5,cutoff:[2400,1300]});
    tone(784,.22,'sine',.05,.14,{layers:3,spread:6,cutoff:[3000,900],reverb:.14});
  }
  else if(x=='next')tone(660,.16,'triangle',.05,0,{layers:2,spread:4,glide:880,cutoff:[2200,1600]});
  else if(x=='done'){
    tone(523,.11,'triangle',.055,0,{layers:2,spread:5,cutoff:[2600,1400],noise:{dur:.035,vol:.025,cutoff:4500}});
    tone(659,.12,'sine',.05,.09,{layers:2,spread:5,cutoff:[2600,1400]});
    tone(784,.3,'sine',.055,.18,{layers:3,spread:7,cutoff:[3200,800],reverb:.22});
  }
  else if(x=='del')tone(360,.13,'sawtooth',.035,0,{layers:2,spread:4,glide:190,cutoff:[1800,500]});
  else if(x=='err')tone(190,.16,'triangle',.04,0,{layers:2,spread:6,glide:150,cutoff:[900,300],q:1.1});
  else if(x=='toast'){
    tone(1050,.05,'sine',.022,0,{layers:1,attack:.003,cutoff:[3800,2200]});
    tone(1400,.06,'sine',.018,.045,{layers:1,attack:.003,cutoff:[4200,2400],reverb:.06});
  }
  else if(x=='close')tone(500,.18,'sine',.032,0,{layers:2,spread:4,glide:280,cutoff:[2000,700],reverb:.08});
}
function toggleSound(){
  soundOn=!soundOn;localStorage.setItem('wl_snd',soundOn?'1':'0');
  if(soundOn)sfx('click');
}

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
function tbadge(t){var c={film:'bf',serie:'bs',anime:'ba'}[t]||'bf';var l={film:'Film',serie:'Serie',anime:'Anime'}[t]||t;return '<span class="badge '+c+'">'+l+'</span>';}
function sbadge(s){var c={avoir:'bav',encours:'bec',termine:'bte',todo:'btd'}[s]||'bav';var l={avoir:'A voir',encours:'En cours',termine:'Terminé',todo:'À qualifier'}[s]||s;return '<span class="badge '+c+'">'+l+'</span>';}
function starsvg(f){if(f)return '<svg viewBox="0 0 24 24"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" fill="currentColor"/></svg>';return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>';}

/* Journalisation minimale : code et message seulement (jamais d'objet complet, de jeton ni de donnée perso) */
function _logErr(tag,e){try{console.error(tag,(e&&e.code)||'',(e&&e.message)||String(e||''));}catch(_){}}

/* API PROXY — TMDB/OMDb via /api (session Supabase obligatoire, clés jamais côté client) */
var _apiAuthState=null;/* null | 'login' | 'forbidden' */
var _apiAuthToastAt=0;
/* /api/tmdb/movie/1?language=fr-FR → /api/tmdb?path=%2Fmovie%2F1&language=fr-FR */
function _toProxyUrl(url){
  if(url.indexOf(TB+'/')!==0)return url;
  var rest=url.slice(TB.length),qi=rest.indexOf('?');
  var path=qi<0?rest:rest.slice(0,qi),qs=qi<0?'':rest.slice(qi+1);
  return TB+'?path='+encodeURIComponent(path)+(qs?'&'+qs:'');
}
function _getAccessToken(){
  if(!supa)return Promise.resolve(null);
  return supa.auth.getSession().then(function(r){
    var s=r&&r.data&&r.data.session;return s&&s.access_token?s.access_token:null;
  }).catch(function(){return null;});
}
function _authError(state){var e=new Error(state==='forbidden'?'FORBIDDEN':'AUTH_REQUIRED');e.code=state==='forbidden'?'FORBIDDEN':'AUTH_REQUIRED';return e;}
function apiFetch(url){
  /* Kitsu/TVmaze (sans clé) : appel direct, jamais de jeton Supabase envoyé à un tiers */
  if(url.indexOf('/api/')!==0)return fetch(url,{credentials:'omit'});
  return _getAccessToken().then(function(tok){
    if(!tok){_notifyLoginRequired('login');throw _authError('login');}
    return fetch(_toProxyUrl(url),{headers:{Authorization:'Bearer '+tok},credentials:'omit'}).then(function(r){
      if(r.status===401){_notifyLoginRequired('login');throw _authError('login');}
      if(r.status===403){_notifyLoginRequired('forbidden');throw _authError('forbidden');}
      return r;
    });
  });
}
function _loginMsgHtml(){
  var m=_apiAuthState==='forbidden'
    ?'Ce compte n\'est pas autorisé à charger le catalogue TMDB.'
    :'Connecte-toi (menu Compte) pour charger le catalogue TMDB.';
  return '<div class="sb-loading">'+esc(m)+'</div>';
}
function _paintLoginRequired(){
  if(!_apiAuthState)return;
  var sb=document.getElementById('sbContent');if(sb)sb.innerHTML=_loginMsgHtml();
  var ds=document.getElementById('discoverSection');if(ds)ds.innerHTML=_loginMsgHtml();
}
function _notifyLoginRequired(state){
  _apiAuthState=state||'login';
  setTimeout(_paintLoginRequired,0);
  if(Date.now()-_apiAuthToastAt>60000){
    _apiAuthToastAt=Date.now();
    toast(_apiAuthState==='forbidden'?'Compte non autorisé pour le catalogue':'Connecte-toi pour charger le catalogue TMDB','nfo');
  }
}
/* Après connexion : on relance ce qui avait échoué faute de session */
function _onApiAuthRestored(){
  if(!_apiAuthState)return;
  _apiAuthState=null;cache={};_drCache={};
  loadRecos();loadDiscovery(activeTab);
}

/* CACHE FETCH — TTL 24h pour que le throttle Suivi (lastEpisodeCheck) redevienne effectif en session longue */
var TF_CACHE_TTL=86400000;
function tf(url){
  var c=cache[url];
  if(c&&(Date.now()-c.t)<TF_CACHE_TTL)return Promise.resolve(c.d);
  return apiFetch(url).then(function(r){
    /* Une réponse d'erreur (401, 429, 5xx...) n'est jamais mise en cache */
    if(!r.ok){var e=new Error('HTTP '+r.status);e.status=r.status;throw e;}
    return r.json();
  }).then(function(d){
    if(!_isApiErrorBody(d))cache[url]={d:d,t:Date.now()};
    return d;
  });
}
/* Corps d'erreur renvoyés avec un statut 200 : TMDB (success:false), OMDb (quota/clé) */
function _isApiErrorBody(d){
  if(!d||typeof d!=='object')return true;
  if(d.success===false)return true;
  if(d.Response==='False'&&/limit|key/i.test(d.Error||''))return true;
  return false;
}

/* ANIME GENRE DETECT */
var KW_SHONEN=['shonen','shounen','superpower','martial arts','ninja','pirate','demon slayer','dragon ball'];
var KW_SEINEN=['seinen','psychological','thriller','berserk','vinland','mature','gore'];
var KW_SHOJO=['shojo','shoujo','romance','magical girl','fruits basket'];
var KW_ISEKAI=['isekai','another world','reincarnation','transported','summoned to'];
var KW_SLICE=['slice of life','daily life','school life','coming of age','moe','everyday'];
function detectAnimeGenre(tmdbId,cb){
  tf(TB+'/tv/'+tmdbId+'?language=en-US&append_to_response=keywords').then(function(d){
    var g=(d.genres||[]).map(function(x){return x.name.toLowerCase()});
    var k=((d.keywords&&d.keywords.results)||[]).map(function(x){return x.name.toLowerCase()});
    var all=g.concat(k).join(' ');var genre='autre';
    if(KW_ISEKAI.some(function(w){return all.indexOf(w)>-1}))genre='isekai';
    else if(KW_SLICE.some(function(w){return all.indexOf(w)>-1}))genre='slice';
    else if(KW_SHOJO.some(function(w){return all.indexOf(w)>-1}))genre='shojo';
    else if(KW_SEINEN.some(function(w){return all.indexOf(w)>-1}))genre='seinen';
    else if(KW_SHONEN.some(function(w){return all.indexOf(w)>-1}))genre='shonen';
    else if(all.indexOf('action')>-1||all.indexOf('adventure')>-1)genre='shonen';
    cb(genre);
  }).catch(function(){cb('autre');});
}

/* TRAILER */
function getTrailer(type,id,sn,cb){
  var u=sn?TB+'/tv/'+id+'/season/'+sn+'/videos?language=fr-FR':TB+'/'+type+'/'+id+'/videos?language=fr-FR';
  tf(u).then(function(d){
    var v=(d.results||[]).filter(function(x){return x.site=='YouTube'&&(x.type=='Trailer'||x.type=='Teaser')});
    if(!v.length){
      var u2=sn?TB+'/tv/'+id+'/season/'+sn+'/videos?language=en-US':TB+'/'+type+'/'+id+'/videos?language=en-US';
      tf(u2).then(function(d2){var v2=(d2.results||[]).filter(function(x){return x.site=='YouTube'&&(x.type=='Trailer'||x.type=='Teaser')});cb(v2.length?v2[0].key:null);}).catch(function(){cb(null)});
    }else{cb(v[0].key);}
  }).catch(function(){cb(null)});
}
function openYT(key){if(key)window.open('https://www.youtube.com/watch?v='+key,'_blank');}

/* RENDER */
function getItems(tab,stat,q){
  var items=memDB.slice().filter(function(i){return !i.deleted});
  if(tab&&tab!='all')items=items.filter(function(i){return i.type==tab});
  if(stat&&stat!='all')items=items.filter(function(i){if(stat=='avoir')return i.status=='avoir'||i.status=='todo';return i.status==stat});
  if(q){var ql=q.toLowerCase();items=items.filter(function(i){return(i.title&&i.title.toLowerCase().indexOf(ql)>-1)||(i.tags&&i.tags.join(' ').toLowerCase().indexOf(ql)>-1)});}
  var so=document.getElementById('sortSel').value;
  items.sort(function(a,b){
    if(so=='title')return(a.title||'').localeCompare(b.title||'');
    if(so=='tmdb')return(parseFloat(b.tmdbScore)||0)-(parseFloat(a.tmdbScore)||0);
    if(so=='myrate')return(b.myRating||0)-(a.myRating||0);
    return(b.addedAt||0)-(a.addedAt||0);
  });
  return items;
}

function cardHtml(item,idx){
  var po=item.poster?'<img class="card-poster" src=\"'+IB+'w342'+esc(item.poster)+'\" loading="lazy" alt="" onerror="this.style.display=\'none\'">':'';
  var ph='<div class="card-ph" '+(item.poster?'style="display:none"':'')+'>'+icon(item.type)+'</div>';
  var ep=(item.type!='film'&&item.saison&&item.episode)?'<div class="cep">S'+pad(item.saison)+' E'+pad(item.episode)+'</div>':'';
  var sc=item.tmdbScore?'<div class="crating"><svg viewBox="0 0 24 24"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" fill="currentColor"/></svg>'+parseFloat(item.tmdbScore).toFixed(1)+'</div>':'';
  var mr=item.myRating?'<div class="cmyr">'+item.myRating+'/10</div>':'';
  var prog='';
  if(item.status=='encours'&&item.totalEp&&item.totalEp>0&&item.episode){var pct=Math.min(100,Math.round((item.episode/item.totalEp)*100));prog='<div class="cprog"><div class="cprog-bar"><div class="cprog-fill" style="width:'+pct+'%"></div></div><div class="cprog-lbl">'+item.episode+'/'+item.totalEp+' ep ('+pct+'%)</div></div>';}
  var newep=item.hasNewEp?'<div class="card-newep">Nouvel ep</div>':'';
  var todof=(item.status==='todo'||item.needsConfig)?'<div class="card-todo-flag" title="À qualifier"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg></div>':'';
  var id=item.id;var delay=idx*0.02;
  return '<div class="card" '+(arguments[2]||'')+' style="animation-delay:'+delay+'s" onmouseenter="sfx(\'hover\')" onclick="sfx(\'click\');openPlex('+jsArg(id)+')">'+newep+todof+po+ph+'<div class="cact"><div class="ibtn" onclick="event.stopPropagation();sfx(\'click\');openEdit('+jsArg(id)+')" title="Modifier"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></div><div class="ibtn del" onclick="event.stopPropagation();delEntry('+jsArg(id)+')" title="Supprimer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></div></div><div class="card-body"><div class="card-title">'+esc(item.title)+'</div><div class="card-meta">'+tbadge(item.type)+sbadge(item.status)+'</div><div style="display:flex;align-items:center;gap:4px">'+sc+mr+'</div>'+ep+'</div>'+prog+'</div>';
}

/* Session 11B : estimation du nombre de colonnes réelles de la grille principale,
   avant injection DOM (getComputedStyle indisponible tant que l'élément n'existe pas). */
function _estimateGridCols(){
  var w=document.getElementById('content');
  var containerW=w?w.clientWidth:window.innerWidth;
  if(window.innerWidth<=400)return 2;
  loadSettings();
  if(wlSettings.wl_grid_cols&&wlSettings.wl_grid_cols!=='auto'){
    return parseInt(wlSettings.wl_grid_cols,10)||4;
  }
  var minCard=compactOn?120:160;
  var gap=compactOn?10:18;
  var cols=Math.max(1,Math.floor((containerW+gap)/(minCard+gap)));
  return cols;
}
function _initVisibleRows(){
  var cols=_estimateGridCols();
  var rows=compactOn?11:8;
  return cols*rows;
}
/* Sidebar mobile (drawer) */
function toggleSidebar(force){
  var sb=document.querySelector('.sidebar'),bk=document.getElementById('sbBackdrop');
  var open=typeof force==='boolean'?force:!sb.classList.contains('open');
  sfx('click');
  sb.classList.toggle('open',open);
  if(bk)bk.classList.toggle('on',open);
}
/* Nb de colonnes réelles de la grille au moment du clic */
function _gridCols(grid){
  var tc=getComputedStyle(grid).getPropertyValue('grid-template-columns');
  var n=tc.split(' ').filter(function(s){return s&&s!=='0px';}).length;
  return Math.max(1,n);
}
function loadMoreSec(secId,btn){
  var grid=document.querySelector('#'+secId+' .grid');if(!grid)return;
  var hidden=Array.from(grid.querySelectorAll('[data-more="1"]:not(.revealed)'));
  if(!hidden.length)return;
  var cols=_gridCols(grid);
  var visible=grid.children.length-hidden.length;
  /* Compléter la ligne en cours, sinon charger une ligne entière */
  var n=cols-(visible%cols);
  if(n<=0||n>cols)n=cols;
  /* Si le reliquat après ce batch est < 1 ligne, tout charger */
  if(hidden.length-n<cols)n=hidden.length;
  var toShow=hidden.slice(0,n);
  toShow.forEach(function(el,i){el.style.animationDelay=(i*0.035)+'s';el.classList.add('revealed');});
  var left=hidden.length-n;
  if(left<=0){if(btn&&btn.parentElement)btn.parentElement.style.display='none';}
  else if(btn)btn.textContent='Charger plus · '+left+' autre'+(left>1?'s':'');
}
var STATUS_SEC_CLASS={encours:'sec-status-encours',avoir:'sec-status-avoir',termine:'sec-status-termine'};
function secHtml(label,items,statusClass){
  if(!items.length)return'';
  var colGroups={},singles=[];
  items.forEach(function(item){if(item.collectionId){if(!colGroups[item.collectionId])colGroups[item.collectionId]=[];colGroups[item.collectionId].push(item);}else{singles.push(item);}});
  Object.keys(colGroups).forEach(function(cid){if(colGroups[cid].length<2){singles.push(colGroups[cid][0]);delete colGroups[cid];}});
  var blocks=[];
  Object.keys(colGroups).forEach(function(cid){var g=colGroups[cid];var minAt=Math.min.apply(null,g.map(function(i){return i.addedAt||0;}));blocks.push({type:'folder',cid:cid,items:g,at:minAt});});
  singles.forEach(function(item){blocks.push({type:'card',item:item,at:item.addedAt||0});});
  blocks.sort(function(a,b){return b.at-a.at;});
  var secId='s'+Math.random().toString(36).slice(2,8);
  var gridClass='grid'+(compactOn?' cpt':'');
  var initVisible=_initVisibleRows();
  var h='<div class="sec'+(statusClass?' '+statusClass:'')+'" id="'+secId+'"><div class="sec-hd"><div class="sec-title">'+label+'</div><div class="sec-count">'+blocks.length+'</div></div><div class="'+gridClass+'">';
  blocks.forEach(function(b,i){
    var more=i>=initVisible?'data-more="1"':'';
    if(b.type==='folder')h+=folderCardHtml(b.cid,b.items,more);
    else h+=cardHtml(b.item,i,more);
  });
  h+='</div>';
  var rem=blocks.length-initVisible;
  if(rem>0)h+='<div class="load-more-wrap"><button class="load-more-btn" onclick="loadMoreSec(\''+secId+'\',this)">Charger plus \xb7 '+rem+' autre'+(rem>1?'s':'')+'</button><span class="load-more-count">'+blocks.length+' au total</span></div>';
  return h+'</div>';
}
function animeLabel(g){return{shonen:'Shonen',seinen:'Seinen',shojo:'Shojo',slice:'Slice of Life',isekai:'Isekai',autre:'Autres'}[g]||'Autres';}

function render(){
  sortBy=document.getElementById('sortSel').value;
  var tab=activeTab,stat=activeStat,q=fq;
  var items=getItems(tab,stat,q);
  var html='';

  if(tab=='all'){
    var ec=items.filter(function(i){return i.status=='encours'});
    if(ec.length){
      html+='<div class="sec sec-status-encours"><div class="sec-hd"><div class="sec-title">En cours</div><div class="sec-count">'+ec.length+'</div></div><div class="ec-strip">';
      ec.forEach(function(item){
        var po=item.poster?'<img class="ec-poster" src=\"'+IB+'w185'+esc(item.poster)+'\" alt="" loading="lazy" onerror="this.style.display=\'none\'">':'';
        var ph='<div class="ec-poster-ph" '+(item.poster?'style="display:none"':'')+'>'+icon(item.type)+'</div>';
        var epT=(item.saison&&item.episode)?'S'+pad(item.saison)+' E'+pad(item.episode):'En cours';
        var pct=0;if(item.totalEp&&item.totalEp>0&&item.episode)pct=Math.min(100,Math.round((item.episode/item.totalEp)*100));
        var pb=item.totalEp?'<div class="pbar"><div class="pbar-fill" style="width:'+pct+'%"></div></div>':'';
        html+='<div class="ec-card" onmouseenter="sfx(\'hover\')" onclick="sfx(\'click\');openPlex('+jsArg(item.id)+')">'+po+ph+'<div class="ec-body"><div class="ec-title">'+esc(item.title)+'</div><div class="ec-ep">'+epT+'</div>'+pb+'</div></div>';
      });
      html+='</div></div>';
    }
    if(stat=='all'){
      /* "En cours" a déjà sa bande dédiée ci-dessus : on évite de le répéter en grille complète */
      html+=secHtml('A voir',items.filter(function(i){return i.status=='avoir'||i.status=='todo'}),'sec-status-avoir');
      html+=secHtml('Termines',items.filter(function(i){return i.status=='termine'}),'sec-status-termine');
    }
    else{html+=secHtml(stat=='avoir'?'A voir':stat=='encours'?'En cours':'Termines',items,STATUS_SEC_CLASS[stat]);}
  } else if(tab=='anime'){
    var genres=['shonen','seinen','shojo','slice','isekai','autre'];
    genres.forEach(function(g){
      var gi=items.filter(function(i){return(i.animeGenre||'autre')==g});
      if(gi.length)html+=secHtml(animeLabel(g),gi);
    });
  } else {
    var secs=[{s:'encours',l:'En cours',c:'sec-status-encours'},{s:'avoir',l:'A voir',c:'sec-status-avoir'},{s:'termine',l:'Termines',c:'sec-status-termine'}];
    secs.forEach(function(sec){
      var si=stat=='all'?items.filter(function(i){return i.status==sec.s}):(sec.s==stat?items:[]);
      if(si.length)html+=secHtml(sec.l,si,sec.c);
    });
  }

  if(!html)html=memDB.length==0?'<div class="empty-state"><div class="empty-state-icon">🎬</div><p>Ta watchlist est vide</p><small>Appuie sur <strong style="color:var(--accent)">N</strong> ou clique sur Ajouter pour commencer</small></div>':'<div class="empty-state"><div class="empty-state-icon">🔍</div><p>Aucun résultat</p><small>Essaie un autre filtre ou terme de recherche</small></div>';
  document.getElementById('mc').innerHTML=html;
  var total=memDB.filter(function(i){return !i.deleted}).length,ec2=memDB.filter(function(i){return i.status=='encours'&&!i.deleted}).length,te=memDB.filter(function(i){return i.status=='termine'&&!i.deleted}).length;
  document.getElementById('hstats').innerHTML='<div class="pill"><b>'+total+'</b> titres</div><div class="pill">En cours <b>'+ec2+'</b></div><div class="pill">Termines <b>'+te+'</b></div>';
  if(typeof updateStatsFooter==='function')updateStatsFooter();
}

/* TABS */
/* ============================================================
   DISCOVERY ROWS — NETFLIX STYLE
   ============================================================ */
var DISCOVER_CONFIG={
  all:[
    {id:'tr-all',title:'Tendances',url:'/trending/all/week',mixed:true},
    {id:'bc-all',title:'Parce que tu as aimé',type:'because',filter:'all'},
    {id:'pop-film',title:'Films populaires',url:'/discover/movie?sort_by=popularity.desc&vote_count.gte=200',mtype:'movie'},
    {id:'pop-serie',title:'Séries populaires',url:'/discover/tv?sort_by=popularity.desc&vote_count.gte=100&without_genres=16',mtype:'tv'},
    {id:'top-film',title:'Films les mieux notés',url:'/discover/movie?sort_by=vote_average.desc&vote_count.gte=2000',mtype:'movie'},
  ],
  film:[
    {id:'tr-film',title:'Tendances Films',url:'/trending/movie/week',mtype:'movie'},
    {id:'bc-film',title:'Parce que tu as aimé',type:'because',filter:'film'},
    {id:'pop-film2',title:'Films populaires',url:'/discover/movie?sort_by=popularity.desc&vote_count.gte=200',mtype:'movie'},
    {id:'top-film2',title:'Meilleures notes',url:'/discover/movie?sort_by=vote_average.desc&vote_count.gte=2000',mtype:'movie'},
    {id:'new-film',title:'Sorties récentes',url:'/discover/movie?sort_by=primary_release_date.desc&vote_count.gte=100',mtype:'movie'},
  ],
  serie:[
    {id:'tr-serie',title:'Tendances Séries',url:'/trending/tv/week',mtype:'tv'},
    {id:'bc-serie',title:'Parce que tu as aimé',type:'because',filter:'serie'},
    {id:'pop-serie2',title:'Séries populaires',url:'/discover/tv?sort_by=popularity.desc&vote_count.gte=100&without_genres=16',mtype:'tv'},
    {id:'top-serie',title:'Meilleures notes',url:'/discover/tv?sort_by=vote_average.desc&vote_count.gte=300&without_genres=16',mtype:'tv'},
    {id:'kr-serie',title:'K-Dramas',url:'/discover/tv?sort_by=popularity.desc&with_origin_country=KR&without_genres=16',mtype:'tv'},
  ],
  anime:[
    {id:'tr-anime',title:'Tendances Anime',url:'/trending/tv/week?with_genres=16',mtype:'tv'},
    {id:'bc-anime',title:'Parce que tu as aimé',type:'because',filter:'anime'},
    {id:'an-action',title:'Action',url:'/discover/tv?with_genres=16,10759&sort_by=popularity.desc',mtype:'tv'},
    {id:'an-comedy',title:'Comédie',url:'/discover/tv?with_genres=16,35&sort_by=popularity.desc',mtype:'tv'},
    {id:'an-drama',title:'Drama',url:'/discover/tv?with_genres=16,18&sort_by=popularity.desc',mtype:'tv'},
    {id:'an-fantasy',title:'Fantastique',url:'/discover/tv?with_genres=16,14&sort_by=popularity.desc',mtype:'tv'},
    {id:'an-romance',title:'Romance',url:'/discover/tv?with_genres=16,10749&sort_by=popularity.desc',mtype:'tv'},
    {id:'an-scifi',title:'Science-Fiction',url:'/discover/tv?with_genres=16,10765&sort_by=popularity.desc',mtype:'tv'},
    {id:'an-mystery',title:'Surnaturel / Mystère',url:'/discover/tv?with_genres=16,9648&sort_by=popularity.desc',mtype:'tv'},
    {id:'an-isekai',title:'Isekai',url:'/discover/tv?with_genres=16&with_keywords=210024&sort_by=popularity.desc',mtype:'tv'},
    {id:'an-mecha',title:'Mecha',url:'/discover/tv?with_genres=16&with_keywords=3944&sort_by=popularity.desc',mtype:'tv'},
    {id:'an-shonen',title:'Shōnen',url:'/discover/tv?with_genres=16&with_keywords=157015&sort_by=popularity.desc',mtype:'tv'},
    {id:'an-seinen',title:'Seinen',url:'/discover/tv?with_genres=16&with_keywords=162246&sort_by=popularity.desc',mtype:'tv'},
    {id:'an-slice',title:'Slice of Life',url:'/discover/tv?with_genres=16,18&sort_by=vote_average.desc&vote_count.gte=80',mtype:'tv'},
    {id:'an-kids',title:'Kodomo',url:'/discover/tv?with_genres=16,10762&sort_by=popularity.desc',mtype:'tv'},
    {id:'an-ecchi',title:'Ecchi',url:'/discover/tv?with_genres=16&with_keywords=5095&sort_by=popularity.desc',mtype:'tv'},
    {id:'an-harem',title:'Harem',url:'/discover/tv?with_genres=16&with_keywords=158645&sort_by=popularity.desc',mtype:'tv'},
  ]
};

var _drCache={};/* cache rows fetched, tab:id → items[] */

function _drNormItem(x,mtype){
  var isM=(mtype==='movie')||(x.media_type==='movie');
  return{tmdbId:x.id,type:isM?'movie':'tv',title:isM?x.title:x.name,year:(isM?(x.release_date||''):(x.first_air_date||'')).slice(0,4),poster:x.poster_path||null,score:x.vote_average?x.vote_average.toFixed(1):null,overview:x.overview||'',genreIds:x.genre_ids||[]};
}
function _drFetchBecause(filter){
  var pool=memDB.slice();
  if(filter==='film')pool=pool.filter(function(i){return i.type==='film';});
  else if(filter==='serie')pool=pool.filter(function(i){return i.type==='serie';});
  else if(filter==='anime')pool=pool.filter(function(i){return i.type==='anime';});
  var best=null;
  pool.forEach(function(i){if(i.myRating&&(!best||i.myRating>best.myRating))best=i;});
  if(!best)pool.forEach(function(i){if(i.tmdbScore&&(!best||parseFloat(i.tmdbScore)>parseFloat(best.tmdbScore||0)))best=i;});
  if(!best)return Promise.resolve({title:'',items:[]});
  var t=best.tmdbType||(best.type==='film'?'movie':'tv');
  var inL=new Set(memDB.map(function(i){return i.tmdbId;}));
  function get(u){return apiFetch(u).then(function(r){return r.ok?r.json():{results:[]};}).catch(function(){return{results:[]};});}
  var base=TB+'/'+t+'/'+best.tmdbId,q='?language=fr-FR&page=';
  /* recommendations p1+p2 puis similar p1+p2 en fallback → pool large garanti */
  return Promise.all([get(base+'/recommendations'+q+'1'),get(base+'/recommendations'+q+'2'),get(base+'/similar'+q+'1'),get(base+'/similar'+q+'2')]).then(function(pages){
    var seen={},items=[];
    pages.forEach(function(d){
      (d.results||[]).forEach(function(x){
        if(seen[x.id])return;seen[x.id]=1;
        if(inL.has(x.id)||dismissed.indexOf(x.id)>=0||!x.poster_path)return;
        items.push(_drNormItem(x,t));
      });
    });
    items=_sortByProfile(items,computeTasteProfile());
    return{title:best.title,items:items.slice(0,30)};
  }).catch(function(){return{title:'',items:[]};});
}
function _drFetchRow(cfg){
  var inL=new Set(memDB.map(function(i){return i.tmdbId;}));
  if(cfg.type==='because')return _drFetchBecause(cfg.filter);
  var sep=cfg.url.indexOf('?')>-1?'&':'?';
  var TARGET=30,seen={},out=[];
  function keep(x){
    if(seen[x.id])return;seen[x.id]=1;
    if(inL.has(x.id)||dismissed.indexOf(x.id)>=0||!x.poster_path)return;
    if(!cfg.mixed&&x.media_type&&x.media_type!==(cfg.mtype||'movie'))return;
    if(cfg.mixed&&x.media_type&&x.media_type!=='movie'&&x.media_type!=='tv')return;
    out.push(_drNormItem(x,cfg.mtype||null));
  }
  function get(p){
    return apiFetch(TB+cfg.url+sep+'language=fr-FR&page='+p)
      .then(function(r){return r.ok?r.json():{results:[]};}).catch(function(){return{results:[]};});
  }
  /* Burst initial : 3 pages en parallèle depuis un offset aléatoire (renouvellement) */
  var start=Math.ceil(Math.random()*4);
  return Promise.all([get(start),get(start+1),get(start+2)]).then(function(batch){
    var totalP=1;
    batch.forEach(function(d){
      if(d.total_pages)totalP=Math.max(totalP,Math.min(d.total_pages,500));
      (d.results||[]).forEach(keep);
    });
    /* Top-up séquentiel si <30 après filtres : pages suivantes, puis pages avant l'offset */
    var queue=[];
    for(var p=start+3;p<=Math.min(totalP,start+8);p++)queue.push(p);
    for(var q=1;q<start;q++)queue.push(q);
    function next(){
      if(out.length>=TARGET||!queue.length)return Promise.resolve();
      return get(queue.shift()).then(function(d){(d.results||[]).forEach(keep);return next();});
    }
    return next();
  }).then(function(){
    return{title:null,items:_sortByProfile(out,computeTasteProfile()).slice(0,TARGET)};
  });
}
function _drCardHtml(d){
  var p=d.poster?'<img class="dr-poster" src="'+IB+'w185'+esc(d.poster)+'" alt="" loading="lazy" onerror="this.style.display=\'none\'">':'<div class="dr-poster-ph">'+icon(d.type==='movie'?'film':d.type==='tv'?'serie':'anime')+'</div>';
  var sc=d.score?'<div class="dr-score">&#9733; '+d.score+'</div>':'';
  var ds='data-tmdbid="'+esc(String(d.tmdbId||''))+'" data-type="'+esc(d.type||'')+'" data-title="'+esc(d.title||'')+'" data-year="'+esc(d.year||'')+'" data-poster="'+esc(d.poster||'')+'" data-score="'+esc(String(d.score||''))+'" data-overview="'+esc(d.overview||'')+'"';
  return '<div class="dr-card" '+ds+' onclick="sfx(\'click\');openPlexReco(getCardData(this))" onmouseenter="sfx(\'hover\')"><div class="dr-poster-wrap">'+p+'</div><div class="dr-title">'+esc(d.title)+'</div><div style="display:flex;gap:5px;align-items:center">'+sc+'<div class="dr-year">'+esc(d.year||'')+'</div></div></div>';
}
function _drSkeletonHtml(){var h='';for(var i=0;i<10;i++)h+='<div class="dr-skel"><div class="dr-skel-img"></div><div class="dr-skel-txt"></div></div>';return h;}
/* CARD SIZE DYNAMIQUE — nb de cards visibles adapté au viewport */
var _drVisible=10;
function _drVisCount(){var w=window.innerWidth;return w<480?3:w<700?4:w<950?5:w<1200?7:10;}
function _calcDrCardSize(){
  var sec=document.getElementById('discoverSection');
  if(!sec)return;
  var w=sec.offsetWidth||window.innerWidth;
  _drVisible=_drVisCount();
  var pad=window.innerWidth<768?16:48;/* flèches masquées en mobile → padding réduit */
  var available=w-(pad*2)-((_drVisible-1)*10);
  var cw=Math.max(80,Math.floor(available/_drVisible));
  var ch=Math.floor(cw*1.5);
  document.documentElement.style.setProperty('--dr-card-w',cw+'px');
  document.documentElement.style.setProperty('--dr-card-h',ch+'px');
  document.documentElement.style.setProperty('--dr-pad',pad+'px');
}
function _animHScroll(el,to,dur){
  var from=el.scrollLeft,start=performance.now();
  var max=el.scrollWidth-el.clientWidth;
  to=Math.max(0,Math.min(to,max));
  function frame(now){
    var p=Math.min(1,(now-start)/dur);
    el.scrollLeft=from+(to-from)*easeInOutCubic(p);
    if(p<1)requestAnimationFrame(frame);else el.scrollLeft=to;
  }
  requestAnimationFrame(frame);
}
function drScrollRow(innerId,dir){
  var el=document.getElementById(innerId);if(!el)return;
  var cw=parseInt(getComputedStyle(document.documentElement).getPropertyValue('--dr-card-w'))||126;
  var step=(cw+10)*_drVisible;/* une page de cards visibles exactement */
  _animHScroll(el,el.scrollLeft+dir*step,560);
}
function _renderDrRow(cfg,data,tab){
  var rowId='dr-'+tab+'-'+cfg.id;
  var innerId='dr-inner-'+tab+'-'+cfg.id;
  var row=document.getElementById(rowId);if(!row)return;
  var items=data.items||[];
  if(!items.length){row.style.display='none';return;}
  var label=cfg.title+(cfg.type==='because'&&data.title?' <em>'+esc(data.title.slice(0,20))+'</em>':'');
  row.innerHTML=
    '<div class="dr-row-head">'+
      '<div class="dr-row-title">'+label+'</div>'+
    '</div>'+
    '<div class="dr-row-wrap">'+
      '<button class="dr-arrow left" onclick="drScrollRow(\''+innerId+'\',-1)" aria-label="Précédent">'+
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>'+
      '</button>'+
      '<div class="dr-row-inner" id="'+innerId+'">'+items.map(_drCardHtml).join('')+'</div>'+
      '<button class="dr-arrow right" onclick="drScrollRow(\''+innerId+'\',1)" aria-label="Suivant">'+
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>'+
      '</button>'+
    '</div>';
}
function loadDiscovery(tab){
  var sec=document.getElementById('discoverSection');if(!sec)return;
  _calcDrCardSize();/* Calculer la taille des cards avant de render */
  var cfgs=DISCOVER_CONFIG[tab]||DISCOVER_CONFIG.all;
  /* Construire les rows skeleton */
  sec.innerHTML=cfgs.map(function(cfg){
    var rowId='dr-'+tab+'-'+cfg.id;
    return '<div class="dr-row" id="'+rowId+'">'+
      '<div class="dr-row-head"><div class="dr-row-title">'+esc(cfg.title)+'</div></div>'+
      '<div class="dr-skeleton-row">'+_drSkeletonHtml()+'</div>'+
    '</div>';
  }).join('');
  /* Fetch toutes les rows en parallèle */
  cfgs.forEach(function(cfg){
    var cacheKey=tab+':'+cfg.id;
    if(_drCache[cacheKey]){_renderDrRow(cfg,_drCache[cacheKey],tab);return;}
    _drFetchRow(cfg).then(function(data){
      _drCache[cacheKey]=data;
      _renderDrRow(cfg,data,tab);
    });
  });
}
function switchTab(btn){sfx('click');document.querySelectorAll('.ntab').forEach(function(b){b.classList.remove('on')});btn.classList.add('on');activeTab=btn.dataset.tab;render();loadDiscovery(activeTab);}

/* Session 11B : actions Réglages > Recommandations */
function resetDismissedRecos(){
  if(!confirm('Réafficher tous les titres ignorés dans les recommandations ?'))return;
  dismissed=[];
  localStorage.setItem('wl_dis','[]');
  _preserveContentScroll(function(){cache={};seenRecos=[];loadRecos();});
  toast('Titres ignorés réaffichés');
}
function clearDiscoveryCache(){
  if(!confirm('Vider le cache Discovery et forcer un nouveau chargement ?'))return;
  _drCache={};
  cache={};
  seenRecos=[];
  _preserveContentScroll(function(){
    loadDiscovery(activeTab);
    loadRecos();
  });
  toast('Catalogue actualisé.');
}

document.getElementById('stabs').addEventListener('click',function(e){var b=e.target.closest('.stab');if(!b)return;sfx('click');document.querySelectorAll('.stab').forEach(function(x){x.classList.remove('on')});b.classList.add('on');activeStat=b.dataset.s;render();});
document.getElementById('sortSel').addEventListener('change',render);
document.getElementById('qinput').addEventListener('input',function(e){fq=e.target.value;render();});

/* COMPACT */
function toggleCompact(){compactOn=!compactOn;sfx('click');localStorage.setItem('wl_cpt',compactOn?'1':'0');render();}

/* SEARCH */
var ti=document.getElementById('tinput'),tdd=document.getElementById('tdd'),spin=document.getElementById('spin');
ti.addEventListener('input',function(){clearTimeout(stimer);var q=ti.value.trim();if(q.length<2){tdd.classList.remove('on');return}spin.classList.add('on');stimer=setTimeout(function(){doSearch(q)},400);});
function doSearch(q){
  tf(TB+'/search/multi?query='+encodeURIComponent(q)+'&language=fr-FR').then(function(data){
    spin.classList.remove('on');
    var res=(data.results||[]).filter(function(r){return r.media_type=='movie'||r.media_type=='tv'}).slice(0,8);
    if(!res.length){tdd.innerHTML='<div class="ddi" style="color:var(--text3)">Aucun resultat</div>';tdd.classList.add('on');return}
    tdd.innerHTML=res.map(function(r,i){
      var isM=r.media_type=='movie';var title=isM?r.title:r.name;var year=isM?(r.release_date||'').slice(0,4):(r.first_air_date||'').slice(0,4);
      var th=r.poster_path?'<img class="ddth" src=\"'+IB+'w92'+esc(r.poster_path)+'\" alt="" loading="lazy">':'<div class="ddph">'+icon(isM?'film':'serie')+'</div>';
      return '<div class="ddi"><div class="ddi-main" data-idx="'+i+'">'+th+'<div><div class="ddn">'+esc(title)+'</div><div class="dds">'+(isM?'Film':'Serie/Anime')+(year?' - '+year:'')+'</div></div></div><div class="dd-ibtn" data-idx="'+i+'" data-act="info"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg></div></div>';
    }).join('');
    tdd._res=res;tdd.classList.add('on');
  }).catch(function(){spin.classList.remove('on');});
}
tdd.addEventListener('click',function(e){
  var ib=e.target.closest('[data-act="info"]');
  if(ib){sfx('click');var r=tdd._res[parseInt(ib.dataset.idx)];if(r)openPlexTmdb(r);return;}
  var dm=e.target.closest('.ddi-main');if(!dm)return;
  var r=tdd._res[parseInt(dm.dataset.idx)];if(!r)return;
  var dup=memDB.find(function(i){return i.tmdbId==r.id});
  if(dup&&dup.id!=editId){sfx('err');tdd.classList.remove('on');ti.value='';toast('"'+(r.media_type=='movie'?r.title:r.name)+'" est deja dans ta liste','err');return;}
  sfx('click');tdd.classList.remove('on');ti.value='';
  var isM=r.media_type=='movie';var title=isM?r.title:r.name;var year=isM?(r.release_date||'').slice(0,4):(r.first_air_date||'').slice(0,4);
  selTmdb={tmdbId:r.id,tmdbType:r.media_type,title:title,year:year,poster:r.poster_path||null,overview:r.overview||'',tmdbScore:r.vote_average?r.vote_average.toFixed(1):null};
  document.getElementById('sptitle').textContent=title;
  document.getElementById('spmeta').textContent=(isM?'Film':'Serie/Anime')+(year?' - '+year:'')+(r.vote_average?' - '+r.vote_average.toFixed(1):'');
  var im=document.getElementById('spimg');if(r.poster_path){im.src=IB+'w92'+r.poster_path;im.style.display='block';}else{im.style.display='none';}
  document.getElementById('sprev').classList.add('on');document.getElementById('swrap').style.display='none';
  document.getElementById('ftmdb').value=selTmdb.tmdbScore||'';document.getElementById('fyear').value=year||'';
  document.getElementById('agField').style.display='none';
  if(isM){document.getElementById('ftype').value='film';}else{document.getElementById('ftype').value='serie';fetchTotEp(r.id);}
  chkEpt();
});
function fetchTotEp(id){tf(TB+'/tv/'+id+'?language=fr-FR').then(function(d){document.getElementById('ftotep').value=d.number_of_episodes||0;}).catch(function(){});}
function clearSel(){selTmdb=null;document.getElementById('sprev').classList.remove('on');document.getElementById('swrap').style.display='';ti.value='';document.getElementById('ftmdb').value='';document.getElementById('fyear').value='';}
document.addEventListener('click',function(e){if(!e.target.closest('.swrap'))tdd.classList.remove('on');});

/* STARS/TAGS/EPT */
function _updateStarsLock(){
  var s=document.getElementById('fstat');
  var st=document.getElementById('stars');
  if(!s||!st)return;
  if(s.value==='avoir'){st.classList.add('locked');}
  else{st.classList.remove('locked');}
}
function buildStars(c){myRate=c||0;document.getElementById('stars').innerHTML=Array.from({length:10},function(_,i){var v=i+1;return '<div class="star'+(v<=myRate?' on':'')+'" onmouseenter="sfx(\'hover\')" onclick="setRate('+v+')">'+starsvg(v<=myRate)+'</div>';}).join('');}
function setRate(v){sfx('click');myRate=v;buildStars(v);}
function buildTags(t){curTags=t?t.slice():[];renderTags();}
function renderTags(){
  var w=document.getElementById('tagsWrap');
  w.innerHTML=curTags.map(function(t,i){return '<span class="tag">'+esc(t)+'<span class="tag-rm" onclick="rmTag('+i+')">x</span></span>';}).join('')+'<input type="text" class="tag-inp" id="tagInput" placeholder="+ tag">';
  document.getElementById('tagInput').addEventListener('keydown',function(e){if(e.key=='Enter'||e.key==','){e.preventDefault();var v=this.value.trim().replace(/,/g,'');if(v&&curTags.indexOf(v)<0){curTags.push(v);sfx('click');renderTags();}else{this.value='';}}});
}
function rmTag(i){curTags=curTags.filter(function(x,k){return k!==i});renderTags();}
function chkEpt(){
  var s=document.getElementById('fstat').value,t=document.getElementById('ftype').value;
  document.getElementById('ept').classList.toggle('on',s=='encours'&&t!='film');
  document.getElementById('agField').style.display=t=='anime'?'block':'none';
}
document.getElementById('ftype').addEventListener('change',chkEpt);
document.getElementById('fstat').addEventListener('change',chkEpt);

/* ADD/EDIT */
function _buildSagaSuggest(){var names={};memDB.forEach(function(i){if(i.collectionName)names[i.collectionName]=1;});var dl=document.getElementById('sagaSuggest');if(dl)dl.innerHTML=Object.keys(names).map(function(n){return'<option value="'+esc(n)+'">';}).join('');}
function openAdd(){
  editId=null;selTmdb=null;myRate=0;
  document.getElementById('mtitle').textContent='Ajouter un titre';document.getElementById('sbtn').textContent='Ajouter';
  document.getElementById('sprev').classList.remove('on');document.getElementById('swrap').style.display='';ti.value='';
  document.getElementById('ftype').value='film';document.getElementById('fstat').value='avoir';
  document.getElementById('ftmdb').value='';document.getElementById('fyear').value='';
  document.getElementById('fsai').value=1;document.getElementById('fepi').value=1;document.getElementById('ftotep').value=0;
  document.getElementById('ept').classList.remove('on');document.getElementById('agField').style.display='none';
  document.getElementById('fsaga').value='';_buildSagaSuggest();
  buildStars(0);buildTags([]);_updateStarsLock();document.getElementById('addMbk').classList.add('on');
}
function openEdit(id){
  var item=memDB.find(function(i){return i.id==id});if(!item)return;
  editId=id;
  document.getElementById('mtitle').textContent='Modifier';document.getElementById('sbtn').textContent='Enregistrer';
  selTmdb={tmdbId:item.tmdbId,tmdbType:item.tmdbType,title:item.title,year:item.year,poster:item.poster,overview:item.overview,tmdbScore:item.tmdbScore};
  document.getElementById('sptitle').textContent=item.title;
  document.getElementById('spmeta').textContent=(item.type=='film'?'Film':'Serie/Anime')+(item.year?' - '+item.year:'');
  var im=document.getElementById('spimg');if(item.poster){im.src=IB+'w92'+item.poster;im.style.display='block';}else{im.style.display='none';}
  document.getElementById('sprev').classList.add('on');document.getElementById('swrap').style.display='none';
  document.getElementById('ftype').value=item.type;document.getElementById('fstat').value=item.status;
  document.getElementById('ftmdb').value=item.tmdbScore||'';document.getElementById('fyear').value=item.year||'';
  document.getElementById('fsai').value=item.saison||1;document.getElementById('fepi').value=item.episode||1;document.getElementById('ftotep').value=item.totalEp||0;
  if(item.animeGenre)document.getElementById('fanimegenre').value=item.animeGenre;
  document.getElementById('fsaga').value=item.collectionName||'';_buildSagaSuggest();
  buildStars(item.myRating||0);buildTags(item.tags||[]);chkEpt();_updateStarsLock();document.getElementById('addMbk').classList.add('on');
}
document.getElementById('fstat').addEventListener('change',_updateStarsLock);
function closeAdd(){document.getElementById('addMbk').classList.remove('on');tdd.classList.remove('on');}
document.getElementById('addMbk').addEventListener('click',function(e){if(e.target===this){sfx('close');closeAdd();}});

/* SAVE/DELETE */
function saveEntry(){
  if(!selTmdb){sfx('err');toast('Selectionne un titre','err');return;}
  if(!editId){
    var dup=memDB.find(function(i){return i.tmdbId==selTmdb.tmdbId;});
    if(dup){sfx('err');toast('"'+selTmdb.title+'" est deja dans ta liste','err');return;}
  }
  var type=document.getElementById('ftype').value,status=document.getElementById('fstat').value;
  var sai=parseInt(document.getElementById('fsai').value)||1,epi=parseInt(document.getElementById('fepi').value)||1,totep=parseInt(document.getElementById('ftotep').value)||0;
  var ag=type=='anime'?document.getElementById('fanimegenre').value:'';
  var showEp=(type!='film'&&status=='encours');
  var ex=memDB.find(function(i){return i.id==editId});
  var wasDone=ex&&ex.status=='termine';
  var sagaRaw=(document.getElementById('fsaga').value||'').trim();
  var collName=sagaRaw||null;
  var collId=collName?collName.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''):null;
  var entry={id:editId||uid(),type:type,status:status,myRating:myRate,animeGenre:ag,
    saison:showEp?sai:null,episode:showEp?epi:null,totalEp:showEp?totep:(ex?ex.totalEp:null),
    tags:curTags.slice(),addedAt:ex?ex.addedAt:Date.now(),
    tmdbId:selTmdb.tmdbId,tmdbType:selTmdb.tmdbType,title:selTmdb.title,year:selTmdb.year,
    poster:selTmdb.poster,overview:selTmdb.overview,tmdbScore:selTmdb.tmdbScore,
    hasNewEp:ex?ex.hasNewEp:false,nextAir:ex?ex.nextAir:null,
    collectionId:collId,collectionName:collName,
    supaId:ex?ex.supaId:null,deleted:false,updatedAtLocal:Date.now(),needsSync:true,
    reminderEnabled:ex?ex.reminderEnabled:false,nextAirDate:ex?ex.nextAirDate:null,
    lastEpisodeCheck:ex?ex.lastEpisodeCheck:null,tvmazeId:ex?ex.tvmazeId:null,
    streamingProviders:ex?ex.streamingProviders:null,genreIds:ex?ex.genreIds:null,
    omdbRatings:ex?ex.omdbRatings:null,kitsuRating:ex?ex.kitsuRating:null};
  if(editId){for(var j=0;j<memDB.length;j++){if(memDB[j].id==editId){memDB[j]=entry;break}}}else{memDB.unshift(entry);}
  if(type=='anime'&&!ag&&selTmdb.tmdbId){detectAnimeGenre(selTmdb.tmdbId,function(g){entry.animeGenre=g;for(var k=0;k<memDB.length;k++){if(memDB[k].id==entry.id){memDB[k]=entry;break}}dbPut(entry,function(){});});}
  dbPut(entry,function(){render();loadRecos();if(status=='termine'&&!wasDone){sfx('done');}else{sfx('add');}toast((editId?'Modifie':'Ajoute')+' : '+entry.title);closeAdd();if(type!='film'&&selTmdb.tmdbId)checkAir(entry);if(entry.myRating)buildTasteProfileCache();});
}
function delEntry(id){
  if(!confirm('Supprimer ?'))return;
  var item=memDB.find(function(i){return i.id==id});
  if(!item){return;}
  if(item.supaId||authUser){
    /* Item potentiellement connu de Supabase (ou compte actif) : tombstone pour propager la suppression, purge physique locale seulement apres confirmation de sync */
    item.deleted=true;item.updatedAtLocal=Date.now();item.needsSync=true;
    dbPut(item,function(){sfx('del');render();loadRecos();toast('Supprime'+(item?' : '+item.title:''),'nfo');});
  }else{
    /* Jamais connecte / jamais synchronise : suppression physique immediate (comportement historique) */
    memDB=memDB.filter(function(i){return i.id!=id});
    dbDel(id,function(){sfx('del');render();loadRecos();toast('Supprime'+(item?' : '+item.title:''),'nfo');});
  }
}

/* PLEX MODAL */
function openPlex(id){
  var item=memDB.find(function(i){return i.id==id});if(!item)return;
  plexData={tmdbId:item.tmdbId,type:item.tmdbType||(item.type=='film'?'movie':'tv'),title:item.title,year:item.year,poster:item.poster,score:item.tmdbScore,overview:item.overview,item:item};
  fillPlex();
}
function openPlexTmdb(r){
  var isM=r.media_type=='movie';
  plexData={tmdbId:r.id,type:r.media_type,title:isM?r.title:r.name,year:isM?(r.release_date||'').slice(0,4):(r.first_air_date||'').slice(0,4),poster:r.poster_path,score:r.vote_average?r.vote_average.toFixed(1):null,overview:r.overview,item:null};
  fillPlex();
}
function openPlexReco(d){plexData=d;fillPlex();}

function fillPlex(){
  var d=plexData;plexSeasons=[];
  /* Reset */
  var bg=document.getElementById('plexBg'),bgb=document.getElementById('plexBgBlur');
  bg.style.display='none';bgb.style.display='none';
  document.getElementById('sSelWrap').innerHTML='';
  document.getElementById('plexNep').classList.remove('on');
  document.getElementById('plexProg').style.display='none';
  document.getElementById('plexCastWrap').style.display='none';
  document.getElementById('plexProviders').innerHTML='';
  document.getElementById('plexStats').innerHTML='';
  document.getElementById('plexActs').innerHTML='';
  document.getElementById('plexCrossRatings').innerHTML='';
  /* Poster */
  var pw=document.getElementById('plexPosterWrap');
  if(d.poster){
    pw.innerHTML='<img class="plex-poster" src=\"'+IB+'w342'+esc(d.poster)+'\" alt="">';
    bgb.src=IB+'w780'+d.poster;bgb.style.display='block';
    /* Ambient sur le hero via proxy — canvas safe */
    applyAmbient(IB+'w342'+d.poster, document.getElementById('plexHero'), 0.22);
  }
  else{pw.innerHTML='<div class="plex-poster-ph">'+icon(d.type=='movie'?'film':'serie')+'</div>';}
  document.getElementById('plexTitle').textContent=d.title||'';
  document.getElementById('plexMeta').textContent=d.year||'';
  document.getElementById('plexBadges').innerHTML='';
  document.getElementById('plexScore').innerHTML=d.score?'<svg viewBox="0 0 24 24" width="16" height="16"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" fill="#5cc8ff"/></svg> '+parseFloat(d.score).toFixed(1):'';
  document.getElementById('plexOverview').textContent=d.overview||'Chargement...';
  /* Actions */
  buildPlexActions();
  /* Fetch details */
  if(d.tmdbId){
    tf(TB+'/'+d.type+'/'+d.tmdbId+'?language=fr-FR&append_to_response=credits,images,keywords,watch%2Fproviders,external_ids').then(function(det){fillPlexDetails(det);}).catch(function(){});
  }
  document.getElementById('plexMbk').classList.add('on');
}

function buildPlexActions(){
  var d=plexData;var acts=document.getElementById('plexActs');acts.innerHTML='';
  /* Trailer */
  if(d.tmdbId){var tb=document.createElement('button');tb.className='btn btn-trailer';tb.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>Bande annonce';tb.onclick=function(){sfx('click');getTrailer(d.type,d.tmdbId,null,openYT);};acts.appendChild(tb);}
  var inList=d.item||memDB.find(function(i){return i.tmdbId==d.tmdbId});
  if(inList&&d.item){
    var eb=document.createElement('button');eb.className='btn btn-ghost';eb.textContent='Modifier';eb.onclick=function(){sfx('click');closePlex();openEdit(d.item.id);};acts.appendChild(eb);
    if(d.item.type!='film'&&d.item.saison&&d.item.episode){
      var pg=document.getElementById('plexProg');pg.style.display='block';
      document.getElementById('plexProgVal').textContent='S'+pad(d.item.saison)+' E'+pad(d.item.episode);
      var pct=0,plbl='';if(d.item.totalEp&&d.item.totalEp>0){pct=Math.min(100,Math.round((d.item.episode/d.item.totalEp)*100));plbl=d.item.episode+'/'+d.item.totalEp+' ep ('+pct+'%)';}
      document.getElementById('plexProgFill').style.width=pct+'%';document.getElementById('plexProgLbl').textContent=plbl;
      document.getElementById('plexNextBtn').style.display=d.item.status=='encours'?'inline-block':'none';
      document.getElementById('plexNextBtn').onclick=nextEpPlex;
    }
  }else{
    var ab=document.createElement('button');ab.className='btn btn-primary';ab.textContent='+ Ajouter a ma liste';
    ab.onclick=function(){sfx('click');closePlex();recoAddDirect(d);};acts.appendChild(ab);
  }
}

function fillPlexDetails(det){
  var d=plexData;if(!det)return;
  /* Backdrop */
  var imgs=(det.images&&det.images.backdrops)||[];
  if(imgs.length){
    var bg=document.getElementById('plexBg');
    bg.src=IB+'original'+imgs[0].file_path;
    bg.style.display='block';
    document.getElementById('plexBgBlur').style.display='none';
    /* Ambient depuis backdrop — plus précis que le poster */
    applyAmbient(IB+'w780'+imgs[0].file_path, document.getElementById('plexHero'), 0.18);
  }
  /* Meta */
  var m=[];if(d.year)m.push(d.year);if(det.runtime)m.push(det.runtime+' min');if(det.number_of_seasons)m.push(det.number_of_seasons+' saison'+(det.number_of_seasons>1?'s':''));if(det.genres&&det.genres.length)m.push(det.genres.slice(0,2).map(function(g){return g.name}).join(', '));
  document.getElementById('plexMeta').innerHTML=m.map(esc).join('<span class="plex-sep"> &bull; </span>');
  document.getElementById('plexOverview').textContent=det.overview||d.overview||'Aucune description.';
  /* Stats */
  var st='';
  if(det.vote_average)st+='<div><div class="p-stat-l">Note TMDB</div><div class="p-stat-v gold">'+det.vote_average.toFixed(1)+'</div></div>';
  if(d.item&&d.item.myRating)st+='<div><div class="p-stat-l">Ma note</div><div class="p-stat-v">'+d.item.myRating+'<span style="font-size:12px;color:var(--text3)">/10</span></div></div>';
  if(det.number_of_episodes)st+='<div><div class="p-stat-l">Episodes</div><div class="p-stat-v">'+det.number_of_episodes+'</div></div>';
  if(d.item&&d.item.addedAt)st+='<div><div class="p-stat-l">Ajoute le</div><div class="p-stat-v" style="font-size:13px">'+new Date(d.item.addedAt).toLocaleDateString('fr-FR')+'</div></div>';
  document.getElementById('plexStats').innerHTML=st;
  /* Cast */
  if(det.credits&&det.credits.cast&&det.credits.cast.length){
    document.getElementById('plexCastWrap').style.display='block';
    document.getElementById('plexCast').innerHTML=det.credits.cast.slice(0,12).map(function(c){
      var ph=c.profile_path?'<img class="cast-photo" src=\"'+IB+'w185'+esc(c.profile_path)+'\" alt="" loading="lazy">':'<div class="cast-ph">'+esc((c.name||'?').charAt(0))+'</div>';
      return '<a class="cast-item" href="https://www.themoviedb.org/person/'+c.id+'" target="_blank" rel="noopener">'+ph+'<div class="cast-name">'+esc(c.name||'')+'</div><div class="cast-role">'+esc(c.character||'')+'</div></a>';
    }).join('');
  }
  /* Providers FR */
  var wp=det['watch/providers'];
  if(wp&&wp.results&&wp.results.FR){
    var fr=wp.results.FR;var prov=(fr.flatrate||fr.free||fr.ads||[]);
    if(prov.length){
      var ph='<div style="margin-bottom:14px"><div class="sec-lbl">Disponible sur</div><div class="providers">';
      prov.forEach(function(p){var logo=p.logo_path?'<img class="prov-logo" src=\"'+IB+'original'+esc(p.logo_path)+'\" alt="">':'';var url='https://www.justwatch.com/fr/'+encodeURIComponent(d.title||'');ph+='<a class="prov-btn" href="'+url+'" target="_blank" rel="noopener">'+logo+esc(p.provider_name)+'</a>';});
      ph+='</div></div>';document.getElementById('plexProviders').innerHTML=ph;
    }
  }
  /* Saisons */
  if(d.type!='movie'&&det.seasons){
    var seasons=det.seasons.filter(function(s){return s.season_number>0});plexSeasons=seasons;
    if(seasons.length>1){
      var sel=document.getElementById('sSelWrap');
      sel.innerHTML='<button class="s-btn on" data-s="0" onmouseenter="sfx(\'hover\')" onclick="plexSeason(0)">Apercu</button>'+seasons.map(function(s){return '<button class="s-btn" data-s="'+s.season_number+'" onmouseenter="sfx(\'hover\')" onclick="plexSeason('+s.season_number+')">S'+s.season_number+'</button>';}).join('');
    }
  }
  /* Next air */
  if(det.next_episode_to_air&&det.next_episode_to_air.air_date&&d.item){var ne=document.getElementById('plexNep');ne.innerHTML='Prochain ep : <b>S'+pad(det.next_episode_to_air.season_number)+' E'+pad(det.next_episode_to_air.episode_number)+'</b> &bull; '+esc(det.next_episode_to_air.air_date);ne.classList.add('on');}
  /* Notes croisées OMDb + Kitsu — jamais bloquant, se rendent quelques centaines de ms après le reste */
  loadCrossRatings(det);
}

/* ===== SESSION 12 : NOTES CROISÉES OMDb + Kitsu (modal Plex uniquement, fetch à la demande) =====
   Fetch déclenché uniquement à l'ouverture d'un item dans la modal Plex — jamais en masse au
   chargement de l'app ou de la sidebar. Cache permanent : si l'item est dans memDB, le résultat
   est stocké sur l'item (IndexedDB) et plus jamais refetché ; si l'item n'est pas encore ajouté
   (aperçu depuis recherche/discovery), le cache mémoire tf() existant sert de cache (comme
   demandé). Erreurs API silencieuses : une source absente ou en échec ne s'affiche simplement
   pas, aucun toast. */
function fetchOMDbRatings(imdbId){
  if(!imdbId)return Promise.resolve(null);
  return tf('/api/omdb?i='+encodeURIComponent(imdbId)).then(function(d){
    if(!d||d.Response==='False')return null;
    var out={imdb:null,rottenTomatoes:null,metacritic:null,fetchedAt:Date.now()};
    (d.Ratings||[]).forEach(function(r){
      if(r.Source==='Internet Movie Database')out.imdb=r.Value;
      else if(r.Source==='Rotten Tomatoes')out.rottenTomatoes=r.Value;
      else if(r.Source==='Metacritic')out.metacritic=r.Value;
    });
    if(!out.imdb&&!out.rottenTomatoes&&!out.metacritic)return null;
    return out;
  }).catch(function(){return null;});
}
function fetchKitsuRating(title){
  if(!title)return Promise.resolve(null);
  return tf('https://kitsu.io/api/edge/anime?filter[text]='+encodeURIComponent(title)+'&page[limit]=1').then(function(d){
    var item=d&&d.data&&d.data[0];
    var raw=item&&item.attributes&&item.attributes.averageRating;
    var pct=raw?parseFloat(raw):NaN;
    if(isNaN(pct))return null;
    return{score:(pct/10).toFixed(1),fetchedAt:Date.now()};
  }).catch(function(){return null;});
}
/* Affiche "IMDb ★8.2 · RT 87% · Metacritic 74 · Kitsu ★8.5" — une source absente n'apparaît pas */
function renderCrossRatings(omdb,kitsu){
  var el=document.getElementById('plexCrossRatings');if(!el)return;
  var parts=[];
  if(omdb){
    if(omdb.imdb)parts.push('IMDb <b>&#9733; '+esc(omdb.imdb.split('/')[0])+'</b>');
    if(omdb.rottenTomatoes)parts.push('RT <b>'+esc(omdb.rottenTomatoes)+'</b>');
    if(omdb.metacritic)parts.push('Metacritic <b>'+esc(omdb.metacritic.split('/')[0])+'</b>');
  }
  if(kitsu&&kitsu.score)parts.push('Kitsu <b>&#9733; '+esc(kitsu.score)+'</b>');
  el.innerHTML=parts.length?parts.join('<span class="plex-sep"> &middot; </span>'):'';
}
/* Orchestration : lit le cache si présent, sinon fetch, jamais bloquant pour le reste de la modal */
function loadCrossRatings(det){
  var d=plexData;if(!d)return;
  var reqKey=d.tmdbId+':'+d.type;
  var item=d.item;
  var isAnimeLike=(item&&item.type==='anime')||(det.genres||[]).some(function(g){return g.id===16;});
  var imdbId=det.external_ids&&det.external_ids.imdb_id;

  var omdbPromise=item&&item.omdbRatings?Promise.resolve(item.omdbRatings):
    fetchOMDbRatings(imdbId).then(function(r){if(item&&r){item.omdbRatings=r;persistSuiviItem(item);}return r;});

  var kitsuPromise=!isAnimeLike?Promise.resolve(null):
    (item&&item.kitsuRating?Promise.resolve(item.kitsuRating):
      fetchKitsuRating(d.title).then(function(r){if(item&&r){item.kitsuRating=r;persistSuiviItem(item);}return r;}));

  Promise.all([omdbPromise,kitsuPromise]).then(function(res){
    /* La modal a pu changer (fermée/réouverte sur un autre titre) pendant l'attente réseau */
    if(!plexData||(plexData.tmdbId+':'+plexData.type)!==reqKey)return;
    renderCrossRatings(res[0],res[1]);
  });
}

function plexSeason(num){
  sfx('click');document.querySelectorAll('#sSelWrap .s-btn').forEach(function(b){b.classList.toggle('on',b.dataset.s==num);});
  if(num==0){if(plexData)fillPlex();return;}
  var d=plexData;if(!d||!d.tmdbId)return;
  tf(TB+'/tv/'+d.tmdbId+'/season/'+num+'?language=fr-FR').then(function(s){
    document.getElementById('plexOverview').textContent=s.overview||d.overview||'';
    if(s.poster_path)document.getElementById('plexPosterWrap').innerHTML='<img class="plex-poster" src=\"'+IB+'w342'+esc(s.poster_path)+'\" alt="">';
    var st='';if(s.vote_average)st+='<div><div class="p-stat-l">Note saison</div><div class="p-stat-v gold">'+s.vote_average.toFixed(1)+'</div></div>';if(s.episodes)st+='<div><div class="p-stat-l">Episodes</div><div class="p-stat-v">'+s.episodes.length+'</div></div>';document.getElementById('plexStats').innerHTML=st;
    getTrailer('tv',d.tmdbId,num,function(key){var tb=document.querySelector('#plexActs .btn-trailer');if(tb&&key)tb.onclick=function(){sfx('click');openYT(key);};});
  }).catch(function(){});
}

function nextEpPlex(){
  var d=plexData;if(!d||!d.item)return;
  var item=d.item;var ep=(item.episode||1)+1;var sai=item.saison||1;
  if(plexSeasons.length){var cur=plexSeasons.find(function(s){return s.season_number==sai});if(cur&&cur.episode_count&&ep>cur.episode_count){var nx=plexSeasons.find(function(s){return s.season_number==sai+1});if(nx){sai++;ep=1;}else{ep=cur.episode_count;}}}
  item.episode=ep;item.saison=sai;item.updatedAtLocal=Date.now();item.needsSync=true;
  for(var j=0;j<memDB.length;j++){if(memDB[j].id==item.id){memDB[j]=item;break}}
  dbPut(item,function(){sfx('next');render();document.getElementById('plexProgVal').textContent='S'+pad(sai)+' E'+pad(ep);toast('S'+pad(sai)+' E'+pad(ep)+' - '+item.title,'nfo');});
}
function closePlex(){document.getElementById('plexMbk').classList.remove('on');plexData=null;}
document.getElementById('plexMbk').addEventListener('click',function(e){if(e.target===this){sfx('close');closePlex();}});

/* ===== SESSION 11 : PROFIL DE GOÛT LOCAL (scoring recommandations) =====
   Le profil est recalculé à la volée depuis memDB (pas de store IndexedDB dédié :
   toutes les données sources — myRating, status, type, genreIds — sont déjà dans
   les entries, donc un recalcul est aussi fiable qu'un cache et évite une migration
   de schéma IndexedDB. genreIds est un champ 100% local (jamais envoyé à Supabase,
   même logique que streamingProviders/tvmazeId du module Suivi), rempli en tâche de
   fond uniquement pour les titres notés (myRating), un par un et espacé pour ne pas
   déclencher de rate-limit TMDB. */
var _profileBuildRunning=false;
function buildTasteProfileCache(){
  if(_profileBuildRunning)return;
  var pending=memDB.filter(function(i){return i.myRating&&i.tmdbId&&!i.deleted&&(i.genreIds===undefined||i.genreIds===null);});
  if(!pending.length)return;
  _profileBuildRunning=true;
  function next(idx){
    if(idx>=pending.length){_profileBuildRunning=false;return;}
    var item=pending[idx];
    var kind=item.tmdbType||(item.type==='film'?'movie':'tv');
    tf(TB+'/'+kind+'/'+item.tmdbId+'?language=fr-FR').then(function(d){
      item.genreIds=(d.genres||[]).map(function(g){return g.id;});
    }).catch(function(){item.genreIds=[];}).finally(function(){persistSuiviItem(item);setTimeout(function(){next(idx+1);},150);});
  }
  next(0);
}
/* Poids par statut (termine compte plus qu'avoir) x boost/malus selon la note perso (1-10, 5.5=neutre) */
function computeTasteProfile(){
  var STATUS_W={termine:1,encours:0.6,avoir:0.25,todo:0.1};
  var genreW={},typeW={film:0,serie:0,anime:0};
  memDB.forEach(function(i){
    if(i.deleted)return;
    var sw=STATUS_W[i.status]||0.1;
    var rb=i.myRating?((i.myRating-5.5)/4.5):0;
    var w=sw*(1+rb);
    typeW[i.type]=(typeW[i.type]||0)+w;
    (i.genreIds||[]).forEach(function(g){genreW[g]=(genreW[g]||0)+w;});
  });
  return{genreW:genreW,typeW:typeW};
}
function _isAnimeGenreIds(gids){return(gids||[]).indexOf(16)>-1;}
/* Accepte aussi bien un objet TMDB brut (media_type/genre_ids) qu'un objet normalisé (type/genreIds) */
function scoreCandidate(d,profile){
  var mtype=d.type||d.media_type;
  var gids=d.genreIds||d.genre_ids||[];
  var appType=mtype==='movie'?'film':(_isAnimeGenreIds(gids)?'anime':'serie');
  var typeScore=profile.typeW[appType]||0;
  var genreScore=0;
  gids.forEach(function(g){genreScore+=profile.genreW[g]||0;});
  return typeScore*0.4+genreScore;
}
/* Tri stable décroissant par score de personnalisation (tie-break sur l'ordre d'origine) */
function _sortByProfile(arr,profile){
  return arr.map(function(d,i){return{d:d,s:scoreCandidate(d,profile),i:i};})
    .sort(function(a,b){return b.s-a.s||a.i-b.i;})
    .map(function(x){return x.d;});
}

/* RECOS */
function skeletonHTML(){
  var html='<div class="sb-loading">';
  for(var i=0;i<4;i++){html+='<div class="sb-skeleton-card"><div class="sk-img"></div><div class="sk-body"><div class="sk-title"></div><div class="sk-meta"></div><div class="sk-meta" style="width:50%"></div></div></div>';}
  html+='</div>';return html;
}
/* ===== SESSION 11B : SYSTÈME DE RÉGLAGES (100% local, jamais synchronisé) ===== */
var wlSettings={};
var WL_SETTINGS_DEFAULTS={
  wl_grid_cols:'auto',
  wl_card_ratings:'both',
  wl_card_badges:'full',
  wl_reco_autoscroll:'1',
  wl_reco_speed:'normal',
  wl_reco_pause_hover:'1',
  wl_reco_limit:'15',
  wl_suivi_providers:'1',
  wl_reminders_global:'1',
  wl_glass:'40'
};
var WL_RECO_SPEEDS={
  slow:{duration:2100,pause:700},
  normal:{duration:1600,pause:450},
  fast:{duration:950,pause:260}
};
function loadSettings(){
  wlSettings={};
  Object.keys(WL_SETTINGS_DEFAULTS).forEach(function(key){
    var v=localStorage.getItem(key);
    wlSettings[key]=(v===null||v===undefined||v==='')?WL_SETTINGS_DEFAULTS[key]:v;
  });
  return wlSettings;
}
function saveSetting(key,value){
  wlSettings[key]=value;
  localStorage.setItem(key,value);
}
function applySettings(){
  var root=document.documentElement;
  /* Grille */
  root.classList.remove('grid-cols-4','grid-cols-5','grid-cols-6','grid-cols-7');
  if(wlSettings.wl_grid_cols&&wlSettings.wl_grid_cols!=='auto')root.classList.add('grid-cols-'+wlSettings.wl_grid_cols);
  /* Notes cartes */
  document.body.classList.remove('ratings-both','ratings-my','ratings-tmdb','ratings-off');
  document.body.classList.add('ratings-'+(wlSettings.wl_card_ratings==='my'?'my':wlSettings.wl_card_ratings==='tmdb'?'tmdb':wlSettings.wl_card_ratings==='off'?'off':'both'));
  /* Badges cartes */
  document.body.classList.remove('badges-full','badges-off');
  document.body.classList.add('badges-'+(wlSettings.wl_card_badges==='off'?'off':'full'));
  /* Suivi providers */
  document.body.classList.toggle('suivi-providers-off',wlSettings.wl_suivi_providers==='0');
  /* Transparence du verre (0-100%) sur les pop-up */
  applyGlass(parseInt(wlSettings.wl_glass,10));
}
/* 0% = panneaux pleins (pas de flou) ; 100% = très translucide. Les 4 variables sont
   lues par le CSS des pop-up (modales, menu, fiche détail, recherche, dossiers). */
function applyGlass(pct){
  var t=Math.max(0,Math.min(100,pct||0))/100;
  var root=document.documentElement.style;
  root.setProperty('--glass-panel-bg','rgba(16,16,19,'+(1-t*0.55).toFixed(2)+')');
  root.setProperty('--glass-panel-blur',Math.round(t*44)+'px');
  root.setProperty('--glass-backdrop-bg','rgba(8,9,11,'+(0.90-t*0.52).toFixed(2)+')');
  root.setProperty('--glass-backdrop-blur',Math.round(t*18)+'px');
}



var seenRecos=[];/* IDs vus dans la sidebar cette session — reset à l'actualisation */
var _loadRecosTimer=null;
/* Debounce : plusieurs appels rapprochés (ajout+suppression, etc.) ne déclenchent
   qu'un seul lot de requêtes TMDB, 400ms après le dernier appel. */
function loadRecos(){
  clearTimeout(_loadRecosTimer);
  _loadRecosTimer=setTimeout(_loadRecosNow,400);
}
function _loadRecosNow(){
  var sb=document.getElementById('sbContent');sb.innerHTML=skeletonHTML();
  stopAutoScroll();var inList=memDB.map(function(i){return i.tmdbId});
  var excl=inList.concat(dismissed).concat(seenRecos);
  function notExcl(x){return excl.indexOf(x.id)<0;}
  /* Pages aléatoires dans un range plus large pour diversifier */
  var rp1=Math.ceil(Math.random()*8),rp2=Math.ceil(Math.random()*8),rp3=Math.ceil(Math.random()*8);
  /* Fetch tout en parallèle */
  Promise.all([
    tf(TB+'/trending/all/week?language=fr-FR&page='+Math.ceil(Math.random()*3)).then(function(d){return{type:'trending',data:d}}).catch(function(){return{type:'trending',data:null}}),
    (function(){var best=null;memDB.forEach(function(i){if(i.myRating&&(!best||i.myRating>best.myRating))best=i;});if(!best)return Promise.resolve({type:'because',data:null});var t=best.tmdbType||(best.type=='film'?'movie':'tv');return tf(TB+'/'+t+'/'+best.tmdbId+'/recommendations?language=fr-FR').then(function(d){return{type:'because',data:{best:best,results:d}}}).catch(function(){return{type:'because',data:null}})})(),
    Promise.all([
      tf(TB+'/discover/movie?language=fr-FR&sort_by=popularity.desc&vote_count.gte=200&page='+rp1),
      tf(TB+'/discover/movie?language=fr-FR&sort_by=vote_average.desc&vote_count.gte=500&page='+rp2),
      tf(TB+'/discover/tv?language=fr-FR&sort_by=popularity.desc&vote_count.gte=100&page='+rp2),
      tf(TB+'/discover/tv?language=fr-FR&with_genres=16&sort_by=popularity.desc&page='+rp3)
    ]).then(function(res){return{type:'discover',data:res}}).catch(function(){return{type:'discover',data:null}})
  ]).then(function(res){
    var tHtml='',bHtml='',dJson={films:[],series:[],anime:[]};
    var profile=computeTasteProfile();
    res.forEach(function(r){
      if(r.type=='trending'&&r.data){
        var items=(r.data.results||[]).filter(function(x){return(x.media_type=='movie'||x.media_type=='tv')&&notExcl(x)});
        items=_sortByProfile(items,profile).slice(0,6);
        items.forEach(function(x){seenRecos.push(x.id);});
        var html='<div class="sb-section"><div class="sb-sec-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg> Tendances</div>';
        items.forEach(function(x){html+=recoCardHtml(x.media_type=='movie'?{tmdbId:x.id,type:'movie',title:x.title,year:(x.release_date||'').slice(0,4),poster:x.poster_path,score:x.vote_average?x.vote_average.toFixed(1):'',overview:x.overview}:{tmdbId:x.id,type:'tv',title:x.name,year:(x.first_air_date||'').slice(0,4),poster:x.poster_path,score:x.vote_average?x.vote_average.toFixed(1):'',overview:x.overview});});
        html+='</div>';tHtml=html;
      }
      else if(r.type=='because'&&r.data){
        var best=r.data.best;var d=r.data.results;
        var items2=(d.results||[]).filter(function(x){return notExcl(x)});
        items2=_sortByProfile(items2,profile).slice(0,5);
        items2.forEach(function(x){seenRecos.push(x.id);});
        if(items2.length){var html2='<div class="sb-section"><div class="sb-sec-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg> Car tu as aimé '+esc(best.title.slice(0,18))+'</div>';items2.forEach(function(x){var isM=!x.name;html2+=recoCardHtml({tmdbId:x.id,type:isM?'movie':'tv',title:isM?x.title:x.name,year:isM?(x.release_date||'').slice(0,4):(x.first_air_date||'').slice(0,4),poster:x.poster_path,score:x.vote_average?x.vote_average.toFixed(1):'',overview:x.overview});});html2+='</div>';bHtml=html2;}
      }
      else if(r.type=='discover'&&r.data){
        var res2=r.data;
        function pick(data,n){return _sortByProfile((data.results||[]).filter(function(x){return notExcl(x)}),profile).slice(0,n);}
        function toR(x,type){var isM=type=='movie';return{tmdbId:x.id,type:type,title:isM?x.title:x.name,year:isM?(x.release_date||'').slice(0,4):(x.first_air_date||'').slice(0,4),poster:x.poster_path,score:x.vote_average?x.vote_average.toFixed(1):'',overview:x.overview};}
        /* Mélanger pop + top_rated pour films */
        var filmsPop=pick(res2[0],4),filmsTop=pick(res2[1],3);
        var allFilms=filmsPop.concat(filmsTop.filter(function(x){return filmsPop.every(function(y){return y.id!==x.id;})})).slice(0,6);
        allFilms.forEach(function(x){seenRecos.push(x.id);});
        var serieItems=pick(res2[2],5);serieItems.forEach(function(x){seenRecos.push(x.id);});
        var animeItems=pick(res2[3],5);animeItems.forEach(function(x){seenRecos.push(x.id);});
        dJson={films:allFilms.map(function(x){return toR(x,'movie')}),series:serieItems.map(function(x){return toR(x,'tv')}),anime:animeItems.map(function(x){return toR(x,'tv')})};
      }
    });
    renderRecos(tHtml,bHtml,dJson,inList);
  });
}
function recoCardHtml(d,idx){
  var ph=d.poster?'<img class="reco-img" src=\"'+IB+'w185'+esc(d.poster)+'\" alt="" loading="eager" width="110" height="165" onerror="this.style.display=\'none\'">':'<div class="reco-img-ph">'+icon(d.type=='movie'?'film':'serie')+'</div>';
  var sc=d.score?'<div class="reco-score">&#9733; '+parseFloat(d.score).toFixed(1)+'</div>':'';
  var num=typeof idx==='number'?'<div class="reco-num">'+(idx+1)+'</div>':'';
  var ds='data-tmdbid="'+(d.tmdbId||'')+'" data-type="'+esc(d.type)+'" data-title="'+esc(d.title)+'" data-year="'+esc(String(d.year||''))+'" data-poster="'+esc(d.poster||'')+'" data-score="'+esc(String(d.score||''))+'" data-overview="'+esc(d.overview||'')+'"';
  return '<div class="reco-card" '+ds+'><div class="reco-img-wrap" onclick="recoPreview(this.closest(\'.reco-card\'))" title="Apercu">'+num+ph+'</div><div class="reco-body"><div class="reco-title">'+esc(d.title)+'</div><div class="reco-year">'+esc(String(d.year||''))+'</div>'+sc+'<div class="reco-btns"><button class="rbtn add" onmouseenter="sfx(\'hover\')" onclick="recoAdd(this.closest(\'.reco-card\'))">+ Ajouter</button><button class="rbtn no" onmouseenter="sfx(\'hover\')" onclick="recoDismiss(this.closest(\'.reco-card\'))">x Non</button></div></div></div>';
}
function renderRecos(tHtml,bHtml,json,inList){
  if(_apiAuthState){_paintLoginRequired();return;}
  /* Flux continu numéroté — sections fusionnées avec séparateur discret */
  var allItems=[];
  var counter=0;
  function recoSection(svgPath,titleTxt,items){
    if(!items.length)return'';
    var h='<div class="sb-section"><div class="sb-sec-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'+svgPath+'</svg> '+titleTxt+'</div>';
    items.forEach(function(d){h+=recoCardHtml(d,counter++);});
    return h+'</div>';
  }
  var html='';
  /* Tendances */
  if(tHtml)html+=tHtml.replace(/class="reco-card"/g,function(){return 'class="reco-card" data-idx="'+(counter++)+'\"';});
  /* Because */
  if(bHtml)html+=bHtml.replace(/class="reco-card"/g,function(){return 'class="reco-card" data-idx="'+(counter++)+'\"';});
  /* Discover : flux continu par type sans header répété */
  var secs=[{key:'films',label:'Films',ico:'<rect x="2" y="2" width="20" height="20" rx="2"/><path d="m7 2 0 20M17 2v20M2 12h20M2 7h5M17 7h5M2 17h5M17 17h5"/>',t:'film'},{key:'series',label:'Séries',ico:'<rect x="2" y="7" width="20" height="15" rx="2"/><polyline points="17 2 12 7 7 2"/>',t:'serie'},{key:'anime',label:'Anime',ico:'<circle cx="12" cy="12" r="10"/><path d="m4.93 4.93 14.14 14.14"/>',t:'anime'}];
  secs.forEach(function(s){
    var items=json[s.key]||[];if(!items.length)return;
    html+=recoSection(s.ico,s.label,items);
  });
  /* Réinjecter les numéros dans tHtml/bHtml qui ont été copiés raw */
  var ctr=0;
  html=html.replace(/<div class="reco-num">[\d]+<\/div>/g,'');/* nettoyer anciens */
  /* Limite d'affichage (Réglages > Recommandations > Suggestions affichées) */
  var recoLimit=parseInt(wlSettings.wl_reco_limit,10)||15;
  var tmpWrap=document.createElement('div');tmpWrap.innerHTML=html;
  var allCards=tmpWrap.querySelectorAll('.reco-card');
  if(allCards.length>recoLimit){
    for(var ri=recoLimit;ri<allCards.length;ri++)allCards[ri].remove();
  }
  html=tmpWrap.innerHTML;
  /* Réinjecter proprement via DOM serait idéal mais on injecte innerHTML direct */
  document.getElementById('sbContent').innerHTML=html||'<div class="sb-loading">Aucune recommandation</div>';
  /* Numéroter après injection */
  var cards=document.getElementById('sbContent').querySelectorAll('.reco-card');
  cards.forEach(function(card,i){
    var wrap=card.querySelector('.reco-img-wrap');
    if(wrap&&!wrap.querySelector('.reco-num')){var n=document.createElement('div');n.className='reco-num';n.textContent=i+1;wrap.insertBefore(n,wrap.firstChild);}
  });
  startAutoScroll();
}
function _preserveContentScroll(fn){
  var el=document.getElementById('content');var y=el?el.scrollTop:0;fn();requestAnimationFrame(function(){if(el)el.scrollTop=y;});
}
/* DOSSIERS / SAGAS */
var currentFolder=null;
function _slugify(s){return(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');}
function folderCardHtml(collId,items){
  var name=items[0].collectionName||collId;
  var sorted=items.slice().sort(function(a,b){return(parseInt(a.year)||9999)-(parseInt(b.year)||9999);});
  var top3=sorted.slice(0,3);
  /* 3 posters du plus récent au plus ancien pour l'effet de stack */
  var stacks=top3.reverse().map(function(it,i){
    return '<div class="fs-img">'+(it.poster?'<img src="'+IB+'w185'+esc(it.poster)+'" alt="" loading="lazy">':'<div class="fs-ph">'+icon(it.type)+'</div>')+'</div>';
  }).join('');
  var n=items.length;
  return '<div class="folder-card" '+(arguments[2]||'')+' onclick="sfx(\'click\');openFolder('+jsArg(collId)+')">'+
    '<div class="folder-stack">'+stacks+
    '<div class="folder-badge">'+n+'</div>'+
    '<div class="folder-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></div>'+
    '</div>'+
    '<div class="folder-lbl"><div class="folder-name">'+esc(name)+'</div><div class="folder-count">'+n+' titre'+(n>1?'s':'')+'</div></div>'+
  '</div>';
}
function openFolder(collId){
  var items=memDB.filter(function(i){return i.collectionId===collId;});
  if(!items.length)return;
  currentFolder=collId;
  var name=items[0].collectionName||collId;
  var sorted=items.slice().sort(function(a,b){return(parseInt(a.year)||9999)-(parseInt(b.year)||9999);});
  /* Hero backdrop = poster du premier item */
  var hero=sorted[0];
  var heroPost=hero.poster?IB+'w500'+hero.poster:'';
  var heroBack=hero.poster?IB+'w1280'+hero.poster:'';/* fallback backdrop sur poster si pas de backdrop */
  document.getElementById('folderTitle').textContent=name;
  document.getElementById('folderMeta').textContent=sorted.length+' titre'+(sorted.length>1?'s':"")+(hero.year?' · '+sorted[0].year+' – '+(sorted[sorted.length-1].year||''):'');
  var bg=document.getElementById('folderHeroBg');
  var pi=document.getElementById('folderHeroPosterImg');
  if(heroPost){bg.src=heroBack;bg.style.display='block';pi.src=heroPost;document.getElementById('folderHeroPoster').style.display='block';}
  else{bg.style.display='none';document.getElementById('folderHeroPoster').style.display='none';}
  /* Fetch collection TMDB si on a un tmdbCollectionId */
  var collTmdb=items[0].tmdbCollectionId;
  if(collTmdb){
    tf(TB+'/collection/'+collTmdb+'?language=fr-FR').then(function(d){
      if(d.backdrop_path){bg.src=IB+'w1280'+d.backdrop_path;}
      if(d.poster_path){pi.src=IB+'w500'+d.poster_path;}
    }).catch(function(){});
  }
  document.getElementById('folderGrid').innerHTML=sorted.map(function(item,i){
    return '<div class="folder-item" style="animation-delay:'+(i*0.04)+'s" onclick="sfx(\'click\');closeFolder();setTimeout(function(){openPlex('+jsArg(item.id)+');},80)">'+
      '<div class="folder-item-poster">'+(item.poster?'<img src="'+IB+'w185'+esc(item.poster)+'" alt="" loading="lazy">':'<div class="fi-ph">'+icon(item.type)+'</div>')+'</div>'+
      '<div class="folder-item-title">'+esc(item.title)+'</div>'+
      '<div class="folder-item-year">'+esc(String(item.year||''))+(item.status?' · '+sbadge(item.status):'')+'</div>'+
    '</div>';
  }).join('');
  var mbk=document.getElementById('folderMbk');mbk.classList.add('on');document.body.style.overflow='hidden';
}
function closeFolder(){
  document.getElementById('folderMbk').classList.remove('on');document.body.style.overflow='';currentFolder=null;
}
document.getElementById('folderMbk').addEventListener('click',function(e){if(e.target===this){sfx('close');closeFolder();}});

/* AUTO-DÉTECTION COLLECTIONS TMDB */
var _detectRunning=false;
function detectCollections(){
  if(_detectRunning)return;
  var films=memDB.filter(function(i){return(i.type==='film'||i.tmdbType==='movie')&&i.tmdbId&&!i.collectionId;});
  if(!films.length){toast('Tous les films ont déjà une saga ou pas de collection.','nfo');return;}
  _detectRunning=true;
  toast('Détection des sagas en cours ('+films.length+' films)…','nfo');
  var updated=0,done=0,rateLimited=0;
  function next(idx){
    if(idx>=films.length){_detectRunning=false;if(updated>0){render();toast(updated+' saga'+(updated>1?'s':'')+' détectée'+(updated>1?'s':'')+'.');} else if(rateLimited>0){toast('TMDB a limité les requêtes ('+rateLimited+' échecs) — réessaie dans quelques minutes.','err');} else{toast('Aucune nouvelle saga détectée.','nfo');}return;}
    var item=films[idx];
    apiFetch(TB+'/movie/'+item.tmdbId+'?language=fr-FR').then(function(r){
      if(r.status===429){rateLimited++;throw new Error('429');}
      if(!r.ok)throw new Error('HTTP '+r.status);
      return r.json();
    }).then(function(d){
      if(d.belongs_to_collection&&d.belongs_to_collection.name){
        var cname=d.belongs_to_collection.name.replace(/\s*collection$/i,'').replace(/\s*saga$/i,'').trim();
        var cid=_slugify(cname);
        item.collectionId=cid;item.collectionName=cname;item.tmdbCollectionId=d.belongs_to_collection.id;
        item.updatedAtLocal=Date.now();item.needsSync=true;
        for(var k=0;k<memDB.length;k++){if(memDB[k].id===item.id){memDB[k]=item;break;}}
        dbPut(item,null);updated++;
      }
    }).catch(function(){}).finally(function(){done++;setTimeout(function(){next(idx+1);},120);});/* 120ms entre chaque pour éviter rate limit */
  }
  next(0);
}
function recoPreview(card){sfx('click');var d=getCardData(card);openPlexReco(d);}
function recoAdd(card){sfx('click');var d=getCardData(card);var dup=memDB.find(function(i){return i.tmdbId==d.tmdbId});if(dup){toast('"'+d.title+'" est deja dans ta liste','err');return;}recoAddDirect(d);}
function recoDismiss(card){sfx('click');var id=parseInt(card.dataset.tmdbid);if(id)dismissed.push(id);localStorage.setItem('wl_dis',JSON.stringify(dismissed));card.style.transition='opacity .3s,transform .3s';card.style.opacity='0';card.style.transform='translateX(-16px)';setTimeout(function(){card.remove();},300);}
function getCardData(card){return{tmdbId:card.dataset.tmdbid?parseInt(card.dataset.tmdbid):null,type:card.dataset.type,title:card.dataset.title,year:card.dataset.year,poster:card.dataset.poster||null,score:card.dataset.score||null,overview:card.dataset.overview||''};}
function recoAddDirect(d){
  selTmdb={tmdbId:d.tmdbId,tmdbType:d.type,title:d.title,year:d.year,poster:d.poster||null,overview:d.overview||'',tmdbScore:d.score||null};
  editId=null;myRate=0;
  document.getElementById('mtitle').textContent='Ajouter un titre';document.getElementById('sbtn').textContent='Ajouter';
  document.getElementById('sptitle').textContent=d.title;
  document.getElementById('spmeta').textContent=(d.type=='movie'?'Film':'Serie/Anime')+(d.year?' - '+d.year:'');
  var im=document.getElementById('spimg');if(d.poster){im.src=IB+'w92'+d.poster;im.style.display='block';}else{im.style.display='none';}
  document.getElementById('sprev').classList.add('on');document.getElementById('swrap').style.display='none';
  document.getElementById('ftmdb').value=d.score||'';document.getElementById('fyear').value=d.year||'';
  document.getElementById('ftype').value=d.type=='movie'?'film':'serie';document.getElementById('fstat').value='avoir';
  document.getElementById('fsai').value=1;document.getElementById('fepi').value=1;document.getElementById('ftotep').value=0;
  document.getElementById('ept').classList.remove('on');document.getElementById('agField').style.display='none';
  buildStars(0);buildTags([]);
  if(d.type!='movie'&&d.tmdbId)fetchTotEp(d.tmdbId);
  document.getElementById('addMbk').classList.add('on');
}

/* AUTO SCROLL — RAF UNIQUE, ANNULABLE, SANS SMOOTH NATIF */
var autoRAF2=0,autoSeq2=0;
function easeInOutCubic(t){return t<0.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;}
function stopAutoScroll(){autoSeq2++;if(autoRAF2)cancelAnimationFrame(autoRAF2);autoRAF2=0;if(autoTimer){clearTimeout(autoTimer);autoTimer=null;}}
function _animScrollTo(el,to,dur){return new Promise(function(resolve){var seq=autoSeq2,from=el.scrollTop,start=performance.now();var max=Math.max(0,el.scrollHeight-el.clientHeight);to=Math.max(0,Math.min(to,max));var wasPaused=false;function frame(now){if(seq!==autoSeq2)return resolve(false);if(autoPaused){wasPaused=true;autoRAF2=requestAnimationFrame(frame);return;}if(wasPaused){/* recale : on repart avec la position actuelle comme nouveau point de départ */from=el.scrollTop;start=now;wasPaused=false;}var p=Math.min(1,(now-start)/dur);el.scrollTop=from+(to-from)*easeInOutCubic(p);if(p<1){autoRAF2=requestAnimationFrame(frame);}else{el.scrollTop=to;autoRAF2=0;resolve(true);}}autoRAF2=requestAnimationFrame(frame);});}

/* Session 11B : cibles de scroll alignées sur chaque carte de reco (jamais de carte coupée) */
function getRecoSnapTargets(wrap){
  var max=Math.max(0,wrap.scrollHeight-wrap.clientHeight);
  var targets=[0];
  var cards=wrap.querySelectorAll('.reco-card');
  cards.forEach(function(card){
    var top=card.offsetTop-wrap.offsetTop;
    top=Math.max(0,Math.min(top,max));
    if(targets.indexOf(top)<0)targets.push(top);
  });
  targets.sort(function(a,b){return a-b;});
  if(max>0&&targets[targets.length-1]<max)targets.push(max);
  return targets;
}
function getNextRecoSnap(wrap,currentTop){
  var targets=getRecoSnapTargets(wrap);
  var tol=4;
  for(var i=0;i<targets.length;i++){
    if(targets[i]>currentTop+tol)return targets[i];
  }
  return 0;
}
async function startAutoScroll(){
  stopAutoScroll();
  loadSettings();
  if(wlSettings.wl_reco_autoscroll==='0')return;
  var wrap=document.getElementById('sbScroll');if(!wrap)return;var seq=autoSeq2;
  while(seq===autoSeq2){
    if(autoPaused||wrap.scrollHeight<=wrap.clientHeight){await new Promise(function(r){autoTimer=setTimeout(r,300);});continue;}
    var speedKey=WL_RECO_SPEEDS[wlSettings.wl_reco_speed]?wlSettings.wl_reco_speed:'normal';
    var speed=WL_RECO_SPEEDS[speedKey];
    var targets=getRecoSnapTargets(wrap);
    if(targets.length<2)return; /* pas assez de cartes distinctes pour un snap pertinent */
    var target=getNextRecoSnap(wrap,wrap.scrollTop);
    var isReturnToStart=(target===0&&wrap.scrollTop>0);
    await _animScrollTo(wrap,target,speed.duration);if(seq!==autoSeq2)break;
    var pause=isReturnToStart?speed.pause+250:speed.pause;
    await new Promise(function(r){autoTimer=setTimeout(r,pause);});if(seq!==autoSeq2)break;
  }
}
(function(){
  var wrap=document.getElementById('sbScroll');
  if(!wrap)return;
  var resumeTimer=null;
  function pauseThenResume(){
    autoPaused=true;
    if(resumeTimer)clearTimeout(resumeTimer);
    resumeTimer=setTimeout(function(){
      loadSettings();
      if(wlSettings.wl_reco_pause_hover!=='0'){
        var hovering=wrap.matches(':hover');
        if(!hovering)autoPaused=false;
      }else{
        autoPaused=false;
      }
    },2500);
  }
  wrap.addEventListener('mouseenter',function(){loadSettings();if(wlSettings.wl_reco_pause_hover!=='0')autoPaused=true;});
  wrap.addEventListener('mouseleave',function(){loadSettings();if(wlSettings.wl_reco_pause_hover!=='0')autoPaused=false;});
  wrap.addEventListener('pointerdown',pauseThenResume);
  wrap.addEventListener('touchstart',pauseThenResume,{passive:true});
  wrap.addEventListener('wheel',pauseThenResume,{passive:true});
})();

/* AIR ALERTS */
function checkAir(item){
  if(!item.tmdbId||item.type=='film')return;
  tf(TB+'/tv/'+item.tmdbId+'?language=fr-FR').then(function(d){
    var changed=false;
    if(d.next_episode_to_air&&d.next_episode_to_air.air_date){item.nextAir=d.next_episode_to_air.air_date;changed=true;}
    if(d.last_episode_to_air&&item.status=='encours'&&d.last_episode_to_air.episode_number>(item.episode||0)){item.hasNewEp=true;changed=true;}
    if(changed){for(var j=0;j<memDB.length;j++){if(memDB[j].id==item.id){memDB[j]=item;break}}dbPut(item,function(){});}
  }).catch(function(){});
}
function checkAllAir(){
  var following=memDB.filter(function(i){return i.status=='encours'&&i.type!='film'&&i.tmdbId});var pending=following.length;if(!pending)return;
  following.forEach(function(item){checkAir(item);});
  setTimeout(function(){
    var newEps=memDB.filter(function(i){return i.hasNewEp});
    if(newEps.length){
      var ab=document.getElementById('alertWrap');
      var namesHtml=newEps.slice(0,3).map(function(i){
        return '<span class="alert-link" onclick="openPlex('+jsArg(i.id)+')" style="cursor:pointer;text-decoration:underline">'+esc(i.title)+'</span>';
      }).join(', ');
      document.getElementById('alertText').innerHTML='<b>'+newEps.length+' nouvel episode'+(newEps.length>1?'s':'')+' disponible'+(newEps.length>1?'s':'')+'</b> : '+namesHtml;
      ab.classList.add('on');sfx('toast');render();
    }
    renderSuivi();
  },3000);
}

/* ===== MODULE SUIVI ===== */
var suiviCollapsed=(localStorage.getItem('wl_suivi_collapsed')=='1');
var SUIVI_MAX=9;

function toggleSuiviSection(){
  suiviCollapsed=!suiviCollapsed;
  localStorage.setItem('wl_suivi_collapsed',suiviCollapsed?'1':'0');
  document.getElementById('suiviWrap').classList.toggle('collapsed',suiviCollapsed);
  sfx('click');
}

/* Migration non-destructive : ajoute les champs manquants sans écraser l'existant */
function migrateSuiviFields(item){
  var changed=false;
  if(item.reminderEnabled===undefined){item.reminderEnabled=false;changed=true;}
  if(item.nextAirDate===undefined){item.nextAirDate=null;changed=true;}
  if(item.lastEpisodeCheck===undefined){item.lastEpisodeCheck=null;changed=true;}
  if(item.tvmazeId===undefined){item.tvmazeId=null;changed=true;}
  if(item.streamingProviders===undefined){item.streamingProviders=null;changed=true;}
  return changed;
}

function initSuivi(){
  var toFix=[];
  memDB.forEach(function(item){if(migrateSuiviFields(item))toFix.push(item);});
  if(toFix.length){toFix.forEach(function(item){dbPut(item,function(){});});}
  refreshSuiviData();
  checkReminders();
  renderSuivi();
}

/* Rafraîchit nextAirDate / streamingProviders pour les items pertinents, avec cache 24h */
function refreshSuiviData(){
  var now=Date.now();
  var candidates=memDB.filter(function(i){
    if(i.type=='film'&&i.status!='avoir')return false;
    if(i.type!='film'&&i.status!='encours')return false;
    if(!i.tmdbId)return false;
    if(i.lastEpisodeCheck&&(now-i.lastEpisodeCheck)<86400000)return false;
    return true;
  });
  candidates.forEach(function(item){
    if(item.type=='film'){fetchFilmRelease(item);}
    else{fetchNextAirDate(item);}
  });
}

function fetchFilmRelease(item){
  tf(TB+'/movie/'+item.tmdbId+'?language=fr-FR').then(function(d){
    var changed=false;
    if(d.release_date){item.nextAirDate=d.release_date;changed=true;}
    item.lastEpisodeCheck=Date.now();
    fetchWatchProviders(item,function(){
      persistSuiviItem(item);
      renderSuivi();
    });
  }).catch(function(){item.lastEpisodeCheck=Date.now();persistSuiviItem(item);});
}

function fetchNextAirDate(item){
  var afterTvmaze=function(){
    tf(TB+'/tv/'+item.tmdbId+'?language=fr-FR').then(function(d){
      if(d.next_episode_to_air&&d.next_episode_to_air.air_date){
        item.nextAirDate=d.next_episode_to_air.air_date;
        item.nextAir=d.next_episode_to_air.air_date;
      }
      item.lastEpisodeCheck=Date.now();
      persistSuiviItem(item);
      renderSuivi();
    }).catch(function(){item.lastEpisodeCheck=Date.now();persistSuiviItem(item);});
  };
  /* Mapping TVMaze best-effort — n'affecte pas nextAirDate si échec, TMDB reste la source */
  if(!item.tvmazeId){
    fetch('https://api.tvmaze.com/singlesearch/shows?q='+encodeURIComponent(item.title))
      .then(function(r){return r.ok?r.json():null;})
      .then(function(d){if(d&&d.id)item.tvmazeId=d.id;afterTvmaze();})
      .catch(function(){afterTvmaze();});
  }else{afterTvmaze();}
}

/* TMDB watch/providers en priorité, JustWatch en best-effort seulement */
function fetchWatchProviders(item,cb){
  var kind=item.type=='film'?'movie':'tv';
  tf(TB+'/'+kind+'/'+item.tmdbId+'/watch/providers').then(function(d){
    var fr=d&&d.results&&d.results.FR;
    if(fr&&fr.flatrate&&fr.flatrate.length){
      item.streamingProviders=fr.flatrate.slice(0,4).map(function(p){return{name:p.provider_name,logo:p.logo_path?IB+'w45'+p.logo_path:null,url:fr.link||null};});
    }
    cb&&cb();
  }).catch(function(){cb&&cb();});
}

function persistSuiviItem(item){
  for(var j=0;j<memDB.length;j++){if(memDB[j].id==item.id){memDB[j]=item;break;}}
  dbPut(item,function(){});
}

/* Calcule le statut d'affichage pour un item suivi */
function suiviStatusFor(item){
  if(!item.nextAirDate)return null;
  if(item.type=='film'&&item.status!='avoir')return null;
  if(item.type!='film'&&item.status!='encours')return null;
  var today=new Date();today.setHours(0,0,0,0);
  var d=new Date(item.nextAirDate+'T00:00:00');
  if(isNaN(d.getTime()))return null;
  var diffDays=Math.round((d-today)/86400000);
  if(diffDays>7)return null;
  if(item.type=='film'){
    /* Film déjà sorti : rien à signaler (avant, tout film « À voir » sorti depuis des années
       apparaissait comme « Nouvel episode sorti ») */
    if(diffDays<0)return null;
    if(diffDays===0)return{cls:'new',text:'&#10003; Sortie aujourd\'hui',tomorrow:false};
  }else if(diffDays<=0){
    return{cls:'new',text:'&#10003; Nouvel episode sorti',tomorrow:false};
  }
  var dd=pad(d.getDate()),mm=pad(d.getMonth()+1),yyyy=d.getFullYear();
  return{cls:'soon',text:'&#9200; Sortie prevue le '+dd+'/'+mm+'/'+yyyy,tomorrow:diffDays===1};
}

function renderSuivi(){
  var body=document.getElementById('suiviBody');
  if(!body)return;
  var tracked=memDB.map(function(i){var st=suiviStatusFor(i);return st?{item:i,status:st}:null;}).filter(Boolean);
  tracked.sort(function(a,b){return new Date(a.item.nextAirDate)-new Date(b.item.nextAirDate);});
  if(!tracked.length){body.innerHTML='<div class="suivi-empty">Rien de prevu dans les 7 prochains jours.</div>';return;}
  var shown=tracked.slice(0,SUIVI_MAX);
  var html=shown.map(function(t){
    var item=t.item,st=t.status;
    var poster=item.poster?'<img class="suivi-poster" src=\"'+IB+'w92'+esc(item.poster)+'\" alt="">':'<div class="suivi-poster-ph">'+icon(item.type)+'</div>';
    var provHtml='';
    if(item.streamingProviders&&item.streamingProviders.length){
      provHtml='<div class="suivi-providers">'+item.streamingProviders.map(function(p){return p.logo?'<img class="suivi-provider-logo" src="'+p.logo+'" title="'+esc(p.name)+'" alt="'+esc(p.name)+'">':'';}).join('')+'</div>';
    }
    var tomorrowBadge=st.tomorrow?'<span class="suivi-badge tomorrow">&#9200; Demain !</span>':'';
    return '<div class="suivi-item" data-id="'+esc(item.id)+'" onclick="sfx(\'click\');openPlex('+jsArg(item.id)+')" style="cursor:pointer">'+poster+
      '<div class="suivi-info"><span class="suivi-title">'+esc(item.title)+'</span>'+
      '<span class="suivi-badge '+st.cls+'">'+st.text+'</span>'+tomorrowBadge+provHtml+'</div>'+
      '<button class="suivi-reminder-toggle" data-active="'+(item.reminderEnabled?'true':'false')+'" onclick="event.stopPropagation();toggleReminder('+jsArg(item.id)+')" title="Rappel">&#128276;</button>'+
      '</div>';
  }).join('');
  if(tracked.length>SUIVI_MAX){
    html+='<button class="suivi-more" onclick="sfx(\'click\')">Voir tout ('+tracked.length+')</button>';
  }
  body.innerHTML=html;
}

/* Toggle reminder — stockage IndexedDB uniquement (jamais localStorage) */
function toggleReminder(itemId){
  var item=null;
  for(var j=0;j<memDB.length;j++){if(memDB[j].id==itemId){item=memDB[j];break;}}
  if(!item)return;
  item.reminderEnabled=!item.reminderEnabled;
  item.updatedAtLocal=Date.now();item.needsSync=true;
  var enabling=item.reminderEnabled;
  var finish=function(){persistSuiviItem(item);renderSuivi();sfx(enabling?'add':'click');};
  if(enabling&&typeof Notification!=='undefined'&&Notification.permission==='default'){
    Notification.requestPermission().then(function(perm){
      if(perm!=='granted'){item.reminderEnabled=false;toast('Notifications refusees — rappel desactive','nfo');}
      finish();
    }).catch(function(){item.reminderEnabled=false;finish();});
  }else{
    if(enabling&&typeof Notification!=='undefined'&&Notification.permission==='denied'){
      item.reminderEnabled=false;toast('Notifications bloquees dans le navigateur','nfo');
    }
    finish();
  }
}

/* Notifications le jour J — appelee une fois au chargement, pas en boucle */
function checkReminders(){
  loadSettings();
  if(wlSettings.wl_reminders_global==='0')return;
  if(typeof Notification==='undefined'||Notification.permission!=='granted')return;
  var today=new Date();today.setHours(0,0,0,0);
  memDB.forEach(function(item){
    if(!item.reminderEnabled||!item.nextAirDate)return;
    var d=new Date(item.nextAirDate+'T00:00:00');
    if(isNaN(d.getTime()))return;
    if(d.getTime()===today.getTime()){
      try{
        new Notification(item.title,{
          body:item.type=='film'?'Sortie aujourd\'hui':'Nouvel episode disponible aujourd\'hui',
          icon:item.poster?(IB+'w92'+item.poster):undefined
        });
      }catch(e){}
    }
  });
}

/* ===== MODULE SYNC MULTI-APPAREILS (Session 10) ===== */

/* --- Mapping IndexedDB (camelCase) <-> Supabase (snake_case) --- */
function localToSupabase(item,profileId){
  return{
    id:item.supaId||undefined,
    local_id:item.id,
    profile_id:profileId,
    tmdb_id:item.tmdbId,
    tmdb_type:item.tmdbType,
    type:item.type,
    status:item.status,
    title:item.title,
    year:item.year,
    poster_path:item.poster,
    tmdb_score:item.tmdbScore?parseFloat(item.tmdbScore):null,
    my_rating:item.myRating,
    overview:item.overview,
    tags:item.tags||[],
    saison:item.saison,
    episode:item.episode,
    total_ep:item.totalEp,
    anime_genre:item.animeGenre,
    collection_id:item.collectionId,
    collection_name:item.collectionName,
    tmdb_collection_id:item.tmdbCollectionId,
    has_new_ep:item.hasNewEp,
    next_air:item.nextAir,
    deleted:!!item.deleted,
    updated_at:new Date(item.updatedAtLocal||Date.now()).toISOString()
  };
}
function supabaseToLocal(row){
  return{
    id:row.local_id,
    supaId:row.id,
    tmdbId:row.tmdb_id,
    tmdbType:row.tmdb_type,
    type:row.type,
    status:row.status,
    title:row.title,
    year:row.year,
    poster:row.poster_path,
    tmdbScore:row.tmdb_score,
    myRating:row.my_rating,
    overview:row.overview,
    tags:row.tags||[],
    saison:row.saison,
    episode:row.episode,
    totalEp:row.total_ep,
    animeGenre:row.anime_genre,
    collectionId:row.collection_id,
    collectionName:row.collection_name,
    tmdbCollectionId:row.tmdb_collection_id,
    hasNewEp:row.has_new_ep,
    nextAir:row.next_air,
    deleted:row.deleted,
    updatedAtLocal:new Date(row.updated_at).getTime(),
    addedAt:row.added_at?new Date(row.added_at).getTime():Date.now(),
    needsSync:false
  };
}

/* --- Auth UI --- */
function openAuthModal(){
  sfx('click');
  document.getElementById('authMbk').classList.add('on');
  refreshAuthModalView();
}
function closeAuthModal(){document.getElementById('authMbk').classList.remove('on');}
document.getElementById('authMbk').addEventListener('click',function(e){if(e.target===this){sfx('close');closeAuthModal();}});

/* Inscription retirée de l'interface : compte unique, créé depuis le tableau de bord Supabase
   (et inscriptions désactivées côté Supabase). */

function refreshAuthModalView(){
  var out=document.getElementById('authLoggedOutView'),inn=document.getElementById('authLoggedInView');
  if(authUser){
    out.style.display='none';inn.style.display='block';
    document.getElementById('authAccountEmail').textContent=authUser.email||'';
    var dot=document.getElementById('authAccountDot');
    dot.className='sync-dot '+(navigator.onLine?'synced':'offline');
    var pending=memDB.filter(function(i){return i.needsSync}).length;
    document.getElementById('authSyncInfo').textContent=pending?(pending+' element'+(pending>1?'s':'')+' en attente de synchronisation.'):'Tout est synchronise.';
  }else{
    out.style.display='block';inn.style.display='none';
  }
}

function showAuthMsg(msg,kind){
  var m=document.getElementById('authMsg');
  m.textContent=msg;m.className='auth-msg on '+(kind||'err');
}

function submitAuth(){
  if(!supa){showAuthMsg('Client Supabase indisponible');return;}
  var email=(document.getElementById('authEmail').value||'').trim();
  var pass=document.getElementById('authPassword').value||'';
  if(!email||!pass){showAuthMsg('Email et mot de passe requis');return;}
  sfx('click');
  var btn=document.getElementById('authSubmitBtn');btn.disabled=true;
  var after=function(){btn.disabled=false;};
  supa.auth.signInWithPassword({email:email,password:pass}).then(function(res){
    after();
    if(res.error){showAuthMsg(res.error.message);return;}
    toast('Connecte','ok');
    refreshAuthModalView();
  }).catch(function(e){after();showAuthMsg(e.message||'Erreur');});
}

function signOutUser(){
  if(!supa)return;
  supa.auth.signOut().then(function(){
    toast('Deconnecte','nfo');
    closeAuthModal();
  });
}

/* Cree/verifie la ligne profiles correspondante */
/* Un seul appel à la fois par utilisateur : getSession() et onAuthStateChange('SIGNED_IN')
   déclenchent tous deux onAuthResolved() au chargement ; sans ce verrou, deux profils
   étaient créés en parallèle. S'il existe déjà plusieurs profils, on prend le plus ancien. */
var _ensureProfilePromise=null,_ensureProfileUserId=null;
function _selectOldestProfile(userId){
  return supa.from('profiles').select('id').eq('account_id',userId)
    .order('created_at',{ascending:true}).order('id',{ascending:true}).limit(1);
}
function ensureProfile(user){
  if(_ensureProfilePromise&&_ensureProfileUserId===user.id)return _ensureProfilePromise;
  _ensureProfileUserId=user.id;
  _ensureProfilePromise=_selectOldestProfile(user.id).then(function(res){
    if(res.error)throw res.error;/* erreur réseau/RLS : surtout ne pas créer un profil de plus */
    if(res.data&&res.data.length)return res.data[0].id;
    return supa.from('profiles').insert({account_id:user.id,name:'Moi'}).select('id').single().then(function(ins){
      if(!ins.error)return ins.data.id;
      /* Course possible avec un autre onglet (contrainte UNIQUE account_id) : on relit */
      return _selectOldestProfile(user.id).then(function(r2){
        if(!r2.error&&r2.data&&r2.data.length)return r2.data[0].id;
        throw ins.error;
      });
    });
  });
  _ensureProfilePromise.catch(function(){_ensureProfilePromise=null;_ensureProfileUserId=null;});
  return _ensureProfilePromise;
}

/* Une seule fois par compte et par appareil : les titres créés avant la synchro (Session 10)
   ou ajoutés sans drapeau n'ont jamais été envoyés. On les marque à synchroniser. */
function markLegacyItemsDirtyOnce(userId){
  var key='wl_legacy_dirty_'+userId;
  if(localStorage.getItem(key)==='1')return 0;
  var n=0;
  memDB.forEach(function(item){
    if(!item.supaId&&!item.needsSync&&!item.deleted){
      item.needsSync=true;
      if(!item.updatedAtLocal)item.updatedAtLocal=item.addedAt||Date.now();
      dbPut(item,null);n++;
    }
  });
  localStorage.setItem(key,'1');
  return n;
}

function initAuth(){
  if(!supa){updateSyncStatusUI('anon');return;}
  supa.auth.getSession().then(function(res){
    var session=res.data&&res.data.session;
    if(session&&session.user)onAuthResolved(session.user);
    else updateSyncStatusUI('anon');
  }).catch(function(){updateSyncStatusUI('anon');});

  supa.auth.onAuthStateChange(function(event,session){
    if(event=='SIGNED_IN'&&session&&session.user){
      onAuthResolved(session.user);
    }else if(event=='SIGNED_OUT'){
      authUser=null;authProfileId=null;
      stopSyncLoop();
      updateSyncStatusUI('anon');
      refreshAuthModalView();
    }
  });
}

function onAuthResolved(user){
  /* Déjà initialisé pour ce compte (SIGNED_IN peut être réémis) : rien à refaire */
  if(authUser&&authUser.id===user.id&&authProfileId)return;
  authUser=user;
  ensureProfile(user).then(function(profileId){
    authProfileId=profileId;
    markLegacyItemsDirtyOnce(user.id);
    _onApiAuthRestored();
    refreshAuthModalView();
    updateSyncStatusUI('syncing');
    syncNow();
    startSyncLoop();
  }).catch(function(e){
    _logErr('[sync] ensureProfile',e);
    updateSyncStatusUI('offline');
  });
}

/* --- Sync pull/push --- */
/* Reporte les champs 100% locaux (jamais envoyés à Supabase) sur l'objet qui va remplacer
   memDB[j] lors d'une résolution de conflit — sinon ils seraient silencieusement perdus
   puisque supabaseToLocal() reconstruit un objet neuf sans eux (cf. Session 9 : Suivi,
   Session 11 : genreIds du profil de goût). */
function preserveSuiviFields(local,remote){
  remote.reminderEnabled=local.reminderEnabled;
  remote.nextAirDate=local.nextAirDate;
  remote.lastEpisodeCheck=local.lastEpisodeCheck;
  remote.tvmazeId=local.tvmazeId;
  remote.streamingProviders=local.streamingProviders;
  remote.genreIds=local.genreIds;
  remote.omdbRatings=local.omdbRatings;
  remote.kitsuRating=local.kitsuRating;
  return remote;
}
function syncPull(){
  if(!supa||!authProfileId)return Promise.resolve();
  return supa.from('watchlist_items').select('*').eq('profile_id',authProfileId).then(function(res){
    if(res.error){throw res.error;}
    var rows=res.data||[];
    rows.forEach(function(row){
      var localItem=memDB.find(function(i){return i.id===row.local_id;});
      var remoteTime=new Date(row.updated_at).getTime();
      if(!localItem){
        var mapped=supabaseToLocal(row);
        if(!mapped.deleted){memDB.push(mapped);dbPut(mapped,function(){});}
        else{dbPut(mapped,function(){});} /* tombstone distant jamais vu localement : on le stocke marque supprime, filtré du rendu */
      }else if(remoteTime>(localItem.updatedAtLocal||0)){
        var updated=supabaseToLocal(row);
        for(var j=0;j<memDB.length;j++){if(memDB[j].id===updated.id){
          /* Préserve les champs Suivi (Session 9) non gérés par Supabase */
          updated=preserveSuiviFields(memDB[j],updated);
          memDB[j]=updated;break;
        }}
        dbPut(updated,function(){});
      }
    });
    render();
    if(typeof renderSuivi==='function')renderSuivi();
  });
}

function syncPush(){
  if(!supa||!authProfileId)return Promise.resolve();
  var toPush=memDB.filter(function(i){return i.needsSync;});
  if(!toPush.length)return Promise.resolve();
  var chain=Promise.resolve();
  toPush.forEach(function(item){
    chain=chain.then(function(){
      var sentAt=item.updatedAtLocal;
      var payload=localToSupabase(item,authProfileId);
      return supa.from('watchlist_items').upsert(payload,{onConflict:'local_id,profile_id'}).select().then(function(res){
        if(res.error){_logErr('[sync push]',res.error);return;}
        if(res.data&&res.data[0]){
          item.supaId=res.data[0].id;
          /* Ne marque "synchronisé" que si rien n'a modifié l'item depuis l'envoi du payload —
             sinon on écraserait le besoin de push d'une modification plus récente (course avec le polling 30s). */
          if(item.updatedAtLocal===sentAt)item.needsSync=false;
          dbPut(item,function(){});
        }
      }).catch(function(e){_logErr('[sync push]',e);});
    });
  });
  return chain;
}

function syncNow(){
  if(!supa||!authProfileId||syncInProgress)return;
  if(!navigator.onLine){updateSyncStatusUI('offline');return;}
  syncInProgress=true;updateSyncStatusUI('syncing');
  syncPull().then(function(){return syncPush();}).then(function(){return syncPull();}).then(function(){
    syncInProgress=false;updateSyncStatusUI('synced');refreshAuthModalView();
  }).catch(function(e){
    syncInProgress=false;
    _logErr('[sync]',e);
    updateSyncStatusUI(navigator.onLine?'synced':'offline');
    var now=Date.now();
    if(now-lastSyncErrorToast>60000){lastSyncErrorToast=now;toast('Synchronisation impossible pour le moment','nfo');}
  });
}

function startSyncLoop(){
  stopSyncLoop();
  syncLoopTimer=setInterval(function(){
    if(authProfileId&&navigator.onLine)syncNow();
  },30000);
}
function stopSyncLoop(){if(syncLoopTimer){clearInterval(syncLoopTimer);syncLoopTimer=null;}}

/* --- Indicateur visuel --- */
function updateSyncStatusUI(state){
  var dot=document.getElementById('syncDot'),txt=document.getElementById('syncStatusText');
  if(!dot||!txt)return;
  if(state=='anon'){dot.className='sync-dot anon';txt.textContent='Non connecte';}
  else if(state=='syncing'){dot.className='sync-dot syncing';txt.textContent='Synchronisation...';}
  else if(state=='offline'){dot.className='sync-dot offline';txt.textContent='Hors ligne';}
  else{dot.className='sync-dot synced';txt.textContent='Synchronise';}
}

/* STATS */
function openStats(){
  /* Les titres supprimés (tombstones en attente de synchro) ne comptent pas */
  var live=memDB.filter(function(i){return !i.deleted;});
  sfx('click');var total=live.length;
  var byT={film:0,serie:0,anime:0},byS={avoir:0,encours:0,termine:0},ratings=[],compat=[];
  live.forEach(function(i){byT[i.type]=(byT[i.type]||0)+1;byS[i.status]=(byS[i.status]||0)+1;if(i.myRating)ratings.push(i.myRating);if(i.myRating&&i.tmdbScore)compat.push({mine:i.myRating,tmdb:parseFloat(i.tmdbScore)});});
  var avgM=ratings.length?(ratings.reduce(function(a,b){return a+b},0)/ratings.length):0;
  var estH=Math.round(live.reduce(function(acc,i){return acc+(i.type=='film'?120:(i.totalEp||i.episode||12)*24);},0)/60);
  var avoirH=Math.round(live.filter(function(i){return i.status=='avoir'}).reduce(function(acc,i){return acc+(i.type=='film'?120:(i.totalEp||12)*24);},0)/60);
  var cHtml='';
  if(compat.length>=3){var d=compat.map(function(p){return p.mine-p.tmdb;});var avg=d.reduce(function(a,b){return a+b},0)/d.length;var r=Math.abs(avg).toFixed(1);cHtml=avg>0.5?'Tu notes en moyenne <b>+'+r+' points</b> au-dessus de TMDB. Tu es genereux.':avg<-0.5?'Tu notes en moyenne <b>-'+r+' points</b> en dessous de TMDB. Tu es severe.':'Tes notes sont alignees avec TMDB (ecart <b>'+r+' pt</b>).';}else{cHtml='Note au moins 3 titres pour voir ton profil.';}
  function bar(l,v,m){var p=m?Math.round((v/m)*100):0;return '<div class="bar-row"><div class="bar-lbl">'+l+'</div><div class="bar-track"><div class="bar-fill" style="width:'+p+'%"></div></div><div class="bar-val">'+v+'</div></div>';}
  var mT=Math.max(byT.film,byT.serie,byT.anime,1),mS=Math.max(byS.avoir,byS.encours,byS.termine,1);
  var html='<div class="stats-grid"><div class="stat-card"><div class="stat-lbl">Total</div><div class="stat-val a">'+total+'</div></div><div class="stat-card"><div class="stat-lbl">Ma note moy.</div><div class="stat-val">'+(avgM?avgM.toFixed(1):'-')+'</div></div><div class="stat-card"><div class="stat-lbl">Temps total</div><div class="stat-val">'+estH+'h</div></div><div class="stat-card"><div class="stat-lbl">Reste a voir</div><div class="stat-val">'+avoirH+'h</div></div></div>';
  html+='<div class="stat-sec"><div class="stat-sec-title">Par type</div>'+bar('Films',byT.film,mT)+bar('Series',byT.serie,mT)+bar('Anime',byT.anime,mT)+'</div>';
  html+='<div class="stat-sec"><div class="stat-sec-title">Par statut</div>'+bar('A voir',byS.avoir,mS)+bar('En cours',byS.encours,mS)+bar('Termine',byS.termine,mS)+'</div>';
  html+='<div class="stat-sec"><div class="stat-sec-title">Compatibilite TMDB</div><div class="compat-box">'+cHtml+'</div></div>';
  document.getElementById('statsContent').innerHTML=html;document.getElementById('statsMbk').classList.add('on');
}

/* AMBIENT COLOR — canvas same-origin via proxy */
function applyAmbient(imgUrl, targetEl, opacity){
  if(!imgUrl||!targetEl)return;
  opacity=opacity||0.10;
  var img=new Image();
  img.crossOrigin='anonymous';
  img.onload=function(){
    try{
      var c=document.createElement('canvas');
      c.width=8;c.height=8;
      var ctx=c.getContext('2d');
      ctx.drawImage(img,0,0,8,8);
      var d=ctx.getImageData(0,0,8,8).data;
      var r=0,g=0,b=0,n=0;
      for(var i=0;i<d.length;i+=4){if(d[i+3]>10){r+=d[i];g+=d[i+1];b+=d[i+2];n++;}}
      if(!n)return;
      r=Math.round(r/n);g=Math.round(g/n);b=Math.round(b/n);
      var col='rgba('+r+','+g+','+b+','+opacity+')';
      targetEl.style.setProperty('--ambient-color',col);
      targetEl.style.background='radial-gradient(ellipse at top center, var(--ambient-color) 0%, transparent 70%)';
    }catch(e){
      /* Canvas tainted ou autre erreur — dégradation silencieuse */
      targetEl.style.background='';
    }
  };
  img.onerror=function(){targetEl.style.background='';};
  /* image.tmdb.org renvoie Access-Control-Allow-Origin:* → canvas lisible sans proxy */
  img.src=imgUrl;
}

/* MENU */
function toggleMenu(){
  var menu=document.getElementById('optMenu');
  var opening=!menu.classList.contains('on');
  menu.classList.toggle('on');
  if(!opening)closeSettingsView();
}
document.addEventListener('click',function(e){
  var menu=document.getElementById('optMenu');
  if(!e.target.closest('.hbtn')&&!e.target.closest('.opt-menu')){menu.classList.remove('on');closeSettingsView();}
});
document.addEventListener('keydown',function(e){
  if(e.key==='Escape'){
    var menu=document.getElementById('optMenu');
    if(menu.classList.contains('on')){menu.classList.remove('on');closeSettingsView();}
  }
});

/* Session 11B : panneau Réglages */
function openSettingsView(){
  loadSettings();
  document.getElementById('optMenuMain').style.display='none';
  document.getElementById('optMenuSettings').style.display='flex';
  renderSettingsMenu();
  sfx('click');
}
function closeSettingsView(){
  var mv=document.getElementById('optMenuMain'),sv=document.getElementById('optMenuSettings');
  if(mv)mv.style.display='flex';
  if(sv)sv.style.display='none';
}
function _toggleRow(label,hint,key,checked){
  return '<div class="setting-row"><div class="setting-copy"><div class="setting-label">'+label+'</div>'+(hint?'<div class="setting-hint">'+hint+'</div>':'')+'</div><div class="setting-control"><div class="toggle-switch'+(checked?' on':'')+'" onclick="_onSettingToggle(\''+key+'\',this)"><div class="knob"></div></div></div></div>';
}
function _delegatedToggleRow(label,hint,fnName,checked){
  return '<div class="setting-row"><div class="setting-copy"><div class="setting-label">'+label+'</div>'+(hint?'<div class="setting-hint">'+hint+'</div>':'')+'</div><div class="setting-control"><div class="toggle-switch'+(checked?' on':'')+'" onclick="'+fnName+'();renderSettingsMenu()"><div class="knob"></div></div></div></div>';
}
function _selectRow(label,key,options,current){
  var opts=options.map(function(o){return '<option value="'+o.v+'"'+(o.v===current?' selected':'')+'>'+o.l+'</option>';}).join('');
  return '<div class="setting-row"><div class="setting-copy"><div class="setting-label">'+label+'</div></div><div class="setting-control"><select class="settings-select" onchange="_onSettingSelect(\''+key+'\',this.value)">'+opts+'</select></div></div>';
}
function _rangeRow(label,hint,key,value){
  return '<div class="setting-row setting-row-col"><div class="setting-copy" style="display:flex;justify-content:space-between;align-items:baseline"><div class="setting-label">'+label+'</div><div class="setting-hint" id="_rangeVal_'+key+'" style="margin:0">'+value+'%</div></div>'+(hint?'<div class="setting-hint">'+hint+'</div>':'')+'<input type="range" class="settings-range" min="0" max="100" step="5" value="'+value+'" oninput="_onSettingRange(\''+key+'\',this.value)"></div>';
}
function _onSettingToggle(key,el){
  var newVal=(wlSettings[key]==='1')?'0':'1';
  saveSetting(key,newVal);
  el.classList.toggle('on',newVal==='1');
  _onSettingChanged(key,newVal);
}
function _onSettingSelect(key,val){
  saveSetting(key,val);
  _onSettingChanged(key,val);
}
function _onSettingRange(key,val){
  /* Pas de sfx ici : oninput se déclenche en continu pendant qu'on glisse le curseur */
  saveSetting(key,val);
  var lbl=document.getElementById('_rangeVal_'+key);if(lbl)lbl.textContent=val+'%';
  if(key==='wl_glass')applyGlass(parseInt(val,10));
}
function _onSettingChanged(key,val){
  if(key==='wl_grid_cols'||key==='wl_card_ratings'||key==='wl_card_badges'||key==='wl_suivi_providers'){
    applySettings();
  }
  if(key==='wl_reco_autoscroll'){
    if(val==='0')stopAutoScroll();else startAutoScroll();
  }
  if(key==='wl_reco_limit'){
    loadRecos();
  }
  sfx('click');
}
function renderSettingsMenu(){
  var body=document.getElementById('settingsBody');
  if(!body)return;
  var pending=memDB.filter(function(i){return i.needsSync;}).length;
  var syncLabel=!supa?'Indisponible':(authUser?(pending?(pending+' élément'+(pending>1?'s':'')+' en attente'):'Synchronisé'):'Non connecté');
  var html='';
  html+='<div class="settings-section"><div class="settings-section-title">Apparence</div>';
  html+=_delegatedToggleRow('Mode compact','','toggleCompact',compactOn);
  html+=_delegatedToggleRow('Sons d\'interface','','toggleSound',soundOn);
  html+=_selectRow('Grille watchlist','wl_grid_cols',[{v:'auto',l:'Automatique'},{v:'4',l:'4 colonnes'},{v:'5',l:'5 colonnes'},{v:'6',l:'6 colonnes'},{v:'7',l:'7 colonnes'}],wlSettings.wl_grid_cols);
  html+=_selectRow('Notes sur les cartes','wl_card_ratings',[{v:'both',l:'Les deux'},{v:'my',l:'Ma note seulement'},{v:'tmdb',l:'TMDB seulement'},{v:'off',l:'Masquer'}],wlSettings.wl_card_ratings);
  html+=_selectRow('Badges de cartes','wl_card_badges',[{v:'full',l:'Complets'},{v:'off',l:'Masquer'}],wlSettings.wl_card_badges);
  html+=_rangeRow('Transparence des pop-up','0% = panneaux pleins, 100% = très translucide','wl_glass',wlSettings.wl_glass);
  html+='</div><div class="opt-sep"></div>';
  html+='<div class="settings-section"><div class="settings-section-title">Recommandations</div>';
  html+=_toggleRow('Défilement automatique','','wl_reco_autoscroll',wlSettings.wl_reco_autoscroll==='1');
  html+=_selectRow('Vitesse de défilement','wl_reco_speed',[{v:'slow',l:'Lent'},{v:'normal',l:'Normal'},{v:'fast',l:'Rapide'}],wlSettings.wl_reco_speed);
  html+=_toggleRow('Pause au survol','','wl_reco_pause_hover',wlSettings.wl_reco_pause_hover==='1');
  html+=_selectRow('Suggestions affichées','wl_reco_limit',[{v:'10',l:'10'},{v:'15',l:'15'},{v:'20',l:'20'}],wlSettings.wl_reco_limit);
  html+='<div class="settings-action-row" onclick="resetDismissedRecos()"><div class="setting-label">Réinitialiser les titres ignorés</div><div class="setting-hint">Réaffiche les recommandations masquées avec « Non ».</div></div>';
  html+='<div class="settings-action-row" onclick="clearDiscoveryCache()"><div class="setting-label">Vider le cache Discovery</div><div class="setting-hint">Force un nouveau chargement des rangées et suggestions TMDB.</div></div>';
  html+='</div><div class="opt-sep"></div>';
  html+='<div class="settings-section"><div class="settings-section-title">Suivi</div>';
  html+=_delegatedToggleRow('Replier Suivi au démarrage','','toggleSuiviSection',suiviCollapsed);
  html+=_toggleRow('Afficher les plateformes','','wl_suivi_providers',wlSettings.wl_suivi_providers==='1');
  html+=_toggleRow('Rappels navigateur','Les rappels individuels restent conservés.','wl_reminders_global',wlSettings.wl_reminders_global==='1');
  html+='</div><div class="opt-sep"></div>';
  html+='<div class="settings-section"><div class="settings-section-title">Données</div>';
  html+='<div class="settings-action-row" onclick="openAuthModal();toggleMenu()"><div class="setting-row" style="padding:0"><div class="setting-label">Compte &amp; synchronisation</div><div class="settings-sync-badge">'+syncLabel+'</div></div></div>';
  html+='</div>';
  body.innerHTML=html;
}

/* EXPORT */
function exportJSON(){
  if(!memDB.length){toast('Watchlist vide — rien à exporter','err');return;}
  var payload={version:2,exportedAt:new Date().toISOString(),count:memDB.length,entries:memDB};
  var blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  var a=document.createElement('a');
  var d=new Date();
  var ds=d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
  a.href=URL.createObjectURL(blob);
  a.download='watchlist_'+ds+'.json';
  a.click();
  URL.revokeObjectURL(a.href);
  sfx('done');
  toast('Export OK — '+memDB.length+' titres');
}


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
  if(e.key==='n'||e.key==='N'){e.preventDefault();openAdd();}
  else if(e.key==='f'||e.key==='F'){e.preventDefault();document.getElementById('qinput').focus();}
  else if(e.key==='s'||e.key==='S'){e.preventDefault();openStats();}
  else if(e.key==='c'||e.key==='C'){e.preventDefault();toggleCompact();}
  else if(e.key==='m'||e.key==='M'){e.preventDefault();toggleSound();}
});

/* INIT */
soundOn=localStorage.getItem('wl_snd')!='0';
compactOn=localStorage.getItem('wl_cpt')=='1';
try{dismissed=JSON.parse(localStorage.getItem('wl_dis')||'[]');}catch(e){dismissed=[];}
loadSettings();applySettings();
document.addEventListener('click',function u(){getAC();document.removeEventListener('click',u);},{once:true});
openDB(function(){render();loadRecos();loadDiscovery(activeTab);setTimeout(checkAllAir,2000);bindSearchModalEvents();updateStatsFooter();var sw=document.getElementById('suiviWrap');if(sw&&suiviCollapsed)sw.classList.add('collapsed');initSuivi();initAuth();setTimeout(buildTasteProfileCache,4000);});
/* ResizeObserver : recalcul card size si fenêtre redimensionnée */
if(typeof ResizeObserver!=='undefined'){
  var _drRO=new ResizeObserver(function(){_calcDrCardSize();});
  var _drSec=document.getElementById('discoverSection');
  if(_drSec)_drRO.observe(_drSec);
}

/* ============================================================
   SEARCH CATALOG MODAL
   ============================================================ */
var searchState={open:false,query:'',page:1,totalPages:1,results:[],selected:{},loading:false,token:0,lastFocus:null,ignoreFocus:false};

function debounce(fn,delay){var t=null;return function(){var ctx=this,a=arguments;clearTimeout(t);t=setTimeout(function(){fn.apply(ctx,a);},delay||300);};}

function _mediaAppType(mt,item){
  if(mt==='movie')return'film';
  if(mt==='tv'){var txt=((item.name||'')+' '+(item.original_name||'')+' '+(item.overview||'')).toLowerCase();if(txt.indexOf('anime')>-1)return'anime';}
  return'serie';
}
function _normSR(r){
  var isM=r.media_type==='movie';
  return{key:r.media_type+'-'+r.id,tmdbId:r.id,tmdbType:r.media_type,type:_mediaAppType(r.media_type,r),
    title:(isM?r.title:r.name)||'Sans titre',year:(isM?(r.release_date||''):(r.first_air_date||'')).slice(0,4),
    poster:r.poster_path||null,overview:r.overview||'',score:r.vote_average?r.vote_average.toFixed(1):null,
    genreIds:r.genre_ids||[]};
}
function _inList(id){return !!memDB.find(function(i){return i.tmdbId==id;});}
function _inDismissed(id){return dismissed.indexOf(id)>-1;}

function addSearchEntryDirect(d){
  if(!d||!d.tmdbId)return{ok:false,reason:'invalid'};
  if(_inList(d.tmdbId))return{ok:false,reason:'duplicate'};
  var isFilm=d.tmdbType==='movie'||d.type==='film';
  var entry={id:uid(),type:d.type||(isFilm?'film':'serie'),status:'todo',myRating:null,animeGenre:null,
    saison:null,episode:null,totalEp:null,tags:[],addedAt:Date.now(),
    tmdbId:d.tmdbId,tmdbType:d.tmdbType||(isFilm?'movie':'tv'),title:d.title,year:d.year||'',
    poster:d.poster||null,overview:d.overview||'',tmdbScore:d.score||null,
    hasNewEp:false,nextAir:null,needsConfig:true,source:'search-modal',
    deleted:false,updatedAtLocal:Date.now(),needsSync:true};
  memDB.unshift(entry);
  dbPut(entry,null);
  if(entry.type==='anime'&&entry.tmdbId){
    detectAnimeGenre(entry.tmdbId,function(g){
      entry.animeGenre=g;
      for(var k=0;k<memDB.length;k++){if(memDB[k].id===entry.id){memDB[k]=entry;break;}}
      dbPut(entry,null);render();
    });
  }
  return{ok:true,entry:entry};
}

function _setSearchLoad(on){searchState.loading=!!on;}
function _updateCounter(){
  var n=Object.keys(searchState.selected).filter(function(k){return !!searchState.selected[k];}).length;
  var c=document.getElementById('searchCounter'),b=document.getElementById('searchAddBtn');
  if(c)c.textContent=n+' sélectionné'+(n>1?'s':'');
  if(b){b.disabled=n===0;b.textContent='Ajouter '+n+' sélectionné'+(n>1?'s':'');}
}
function _updatePager(){
  document.getElementById('searchPageInd').textContent='Page '+searchState.page;
  document.getElementById('searchPrevBtn').disabled=searchState.page<=1||searchState.loading;
  document.getElementById('searchNextBtn').disabled=searchState.page>=searchState.totalPages||searchState.loading||!searchState.results.length;
}
function _stateText(t){var el=document.getElementById('searchState');if(el)el.textContent=t;}

function openSearchModal(prefill){
  searchState.open=true;searchState.lastFocus=document.activeElement;
  var m=document.getElementById('searchModal');m.classList.add('on');m.setAttribute('aria-hidden','false');
  document.body.style.overflow='hidden';
  var q=typeof prefill==='string'?prefill:(document.getElementById('tmdbSearchInput').value||'').trim();
  document.getElementById('searchModalInput').value=q;
  searchState.query=q;_updateCounter();_updatePager();
  _stateText(q.length>=2?'Recherche en cours...':'Tape au moins 2 caractères');
  /* Focus immédiat : sur iOS le clavier ne s'ouvre que si focus() est appelé pendant le geste (tap) */
  var mi=document.getElementById('searchModalInput');
  try{mi.focus({preventScroll:true});}catch(_){}
  setTimeout(function(){if(document.activeElement!==mi)mi.focus();},40);
  if(q.length>=2)_runSearch(q,1);else _renderSR([]);
}
function closeSearchModal(){
  searchState.open=false;searchState.token++;_setSearchLoad(false);
  var m=document.getElementById('searchModal');m.classList.remove('on');m.setAttribute('aria-hidden','true');
  document.body.style.overflow='';
  searchState.ignoreFocus=true;
  if(searchState.lastFocus&&typeof searchState.lastFocus.focus==='function'){
    setTimeout(function(){searchState.lastFocus.focus();setTimeout(function(){searchState.ignoreFocus=false;},120);},20);
  }else{setTimeout(function(){searchState.ignoreFocus=false;},120);}
}

/* ===== SESSION 11 : REQUÊTES STRUCTURÉES (langage naturel simplifié) =====
   Exemple : "Action 2020 ★4+" → genre=Action, année≥2020, note TMDB≥4, puis résultats
   classés par le profil de goût (section scoring ci-dessus). Reste 100% côté client :
   aucune modif de _runSearch()/_renderSR() qui consomment _searchTMDB() sans savoir
   d'où viennent les résultats — si aucun mot-clé structuré n'est reconnu, on retombe
   sur la recherche TMDB standard (search/multi), donc une recherche texte classique
   ("Inception") n'est jamais affectée. */
var GENRE_MAP={
  action:{movie:28,tv:10759},aventure:{movie:12,tv:10759},animation:{movie:16,tv:16},
  comedie:{movie:35,tv:35},crime:{movie:80,tv:80},policier:{movie:80,tv:80},
  documentaire:{movie:99,tv:99},drame:{movie:18,tv:18},famille:{movie:10751,tv:10751},
  familial:{movie:10751,tv:10751},fantastique:{movie:14,tv:10765},histoire:{movie:36,tv:null},
  horreur:{movie:27,tv:null},musique:{movie:10402,tv:null},musical:{movie:10402,tv:null},
  mystere:{movie:9648,tv:9648},romance:{movie:10749,tv:null},scifi:{movie:878,tv:10765},
  sciencefiction:{movie:878,tv:10765},sf:{movie:878,tv:10765},thriller:{movie:53,tv:null},
  guerre:{movie:10752,tv:10768},western:{movie:37,tv:37},kids:{movie:null,tv:10762},
  enfant:{movie:null,tv:10762}
};
function _normTok(s){return(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9+>]/g,'');}
/* Retourne null si rien de structuré n'est reconnu (→ fallback recherche classique) */
function _parseStructuredQuery(q){
  var tokens=(q||'').trim().split(/\s+/).filter(Boolean);
  if(!tokens.length)return null;
  var genreIds={movie:[],tv:[]},year=null,minScore=null,forcedType=null,forceAnime=false,textParts=[],matchedSomething=false,explicit=false;
  tokens.forEach(function(raw){
    var t=_normTok(raw);
    if(!t){textParts.push(raw);return;}
    if(/^(19|20)\d{2}$/.test(t)){year=t;matchedSomething=true;return;}
    var rm=t.match(/^(?:note)?([1-9])\+$/)||t.match(/^>([1-9])$/);
    if(rm){minScore=parseInt(rm[1],10);matchedSomething=explicit=true;return;}
    if(t==='film'||t==='films'){forcedType='movie';matchedSomething=explicit=true;return;}
    if(t==='serie'||t==='series'||t==='tv'){forcedType='tv';matchedSomething=explicit=true;return;}
    if(t==='anime'){forceAnime=true;forcedType='tv';matchedSomething=explicit=true;return;}
    if(GENRE_MAP[t]){
      var g=GENRE_MAP[t];
      if(g.movie)genreIds.movie.push(g.movie);
      if(g.tv)genreIds.tv.push(g.tv);
      matchedSomething=explicit=true;return;
    }
    textParts.push(raw);
  });
  /* TMDB /discover ne sait pas filtrer par texte : dès qu'il reste du texte libre
     (« Blade Runner 2049 ») ou qu'il n'y a qu'une année (« 1917 »), recherche classique. */
  if(!matchedSomething||!explicit||textParts.length)return null;
  if(forceAnime&&genreIds.tv.indexOf(16)<0)genreIds.tv.unshift(16);
  var mtypes;
  if(forcedType){mtypes=[forcedType];}
  else{
    var hasGenreAsked=genreIds.movie.length>0||genreIds.tv.length>0;
    if(!hasGenreAsked)mtypes=['movie','tv'];
    else{mtypes=[];if(genreIds.movie.length>0)mtypes.push('movie');if(genreIds.tv.length>0)mtypes.push('tv');}
  }
  return{genreIds:genreIds,year:year,minScore:minScore,mtypes:mtypes,textQuery:textParts.join(' ').trim()};
}
/* Discover TMDB filtré à partir d'une requête structurée, résultats classés par profil de goût */
function _discoverStructured(parsed,page){
  var calls=[];
  parsed.mtypes.forEach(function(mt){
    var gids=parsed.genreIds[mt]||[];
    var params='?language=fr-FR&page='+page+'&sort_by=popularity.desc';
    if(gids.length)params+='&with_genres='+gids.join(',');
    if(parsed.year)params+=(mt==='movie'?'&primary_release_date.gte=':'&first_air_date.gte=')+parsed.year+'-01-01';
    if(parsed.minScore)params+='&vote_average.gte='+parsed.minScore;
    var ep=mt==='movie'?'/discover/movie':'/discover/tv';
    calls.push(tf(TB+ep+params).then(function(d){return{mt:mt,data:d};}).catch(function(){return{mt:mt,data:null};}));
  });
  return Promise.all(calls).then(function(res){
    var merged=[],totalPages=1,totalResults=0;
    res.forEach(function(r){
      if(!r.data)return;
      totalPages=Math.max(totalPages,Math.min(r.data.total_pages||1,50));
      totalResults+=r.data.total_results||0;
      (r.data.results||[]).filter(function(x){return(x.title||x.name)&&!_inDismissed(x.id);}).forEach(function(x){
        merged.push(_normSR(Object.assign({},x,{media_type:r.mt})));
      });
    });
    merged=_sortByProfile(merged,computeTasteProfile()).slice(0,20);
    return{results:merged,page:page,total_pages:totalPages,total_results:totalResults||merged.length};
  });
}
function _searchTMDB(q,page){
  q=(q||'').trim();page=page||1;
  if(q.length<2)return Promise.resolve({results:[],page:1,total_pages:1,total_results:0});
  var sfType=document.getElementById('sfType');
  var sfSort=document.getElementById('sfSort');
  var sfYear=document.getElementById('sfYear');
  var typeFilter=sfType?sfType.value:'';
  var sortFilter=sfSort?sfSort.value:'';
  var yearFilter=sfYear?sfYear.value:'';
  /* Requête structurée ("Action 2020 ★4+") : uniquement si aucun filtre manuel n'est déjà
     actif, pour ne jamais entrer en conflit avec les sélecteurs existants du modal. */
  if(!typeFilter&&!sortFilter&&!yearFilter){
    var parsed=_parseStructuredQuery(q);
    if(parsed)return _discoverStructured(parsed,page);
  }
  /* Type + tri : recherche texte sur /search/{type} (TMDB /discover n'a pas de filtre texte),
     filtre d'année et tri appliqués côté client sur la page de résultats */
  if(typeFilter&&sortFilter){
    var ep=typeFilter==='movie'?'/search/movie':'/search/tv';
    var params='?language=fr-FR&page='+page+'&include_adult=false&query='+encodeURIComponent(q);
    var url2=TB+ep+params;
    return tf(url2).then(function(data){
      var mtype=typeFilter;
      var dateOf=function(r){return(mtype==='movie'?r.release_date:r.first_air_date)||'';};
      var rows=(data.results||[]).filter(function(r){
        if(!(r.title||r.name)||_inDismissed(r.id))return false;
        if(yearFilter){var yr=parseInt(dateOf(r).slice(0,4));if(!(yr>=parseInt(yearFilter)))return false;}
        return true;
      });
      rows.sort(function(a,b){
        if(sortFilter==='vote_average.desc')return(b.vote_average||0)-(a.vote_average||0);
        if(sortFilter==='primary_release_date.desc')return dateOf(b).localeCompare(dateOf(a));
        return(b.popularity||0)-(a.popularity||0);
      });
      var list=rows.slice(0,20).map(function(r){
        return _normSR(Object.assign({},r,{media_type:mtype}));
      });
      return{results:list,page:data.page||1,total_pages:Math.max(1,Math.min(data.total_pages||1,50)),total_results:data.total_results||list.length};
    });
  }
  /* Sinon search/multi standard + filtre type côté client si demandé */
  var url=TB+'/search/multi?language=fr-FR&query='+encodeURIComponent(q)+'&page='+page+'&include_adult=false';
  return tf(url).then(function(data){
    var list=(data.results||[]).filter(function(r){
      if(!(r.media_type==='movie'||r.media_type==='tv'))return false;
      if(!(r.title||r.name))return false;
      if(_inDismissed(r.id))return false;
      if(typeFilter&&r.media_type!==typeFilter)return false;
      if(yearFilter){var yr=(r.media_type==='movie'?(r.release_date||''):(r.first_air_date||'')).slice(0,4);if(parseInt(yr)<parseInt(yearFilter))return false;}
      return true;
    }).slice(0,20).map(_normSR);
    return{results:list,page:data.page||1,total_pages:Math.max(1,Math.min(data.total_pages||1,50)),total_results:data.total_results||list.length};
  });
}

function _renderSR(results){
  var wrap=document.getElementById('searchResults');
  if(!results||!results.length){wrap.innerHTML='<div class="search-empty">Aucun résultat.</div>';_updateCounter();_updatePager();return;}
  wrap.innerHTML=results.map(function(d){
    var inList=_inList(d.tmdbId);var sel=!!searchState.selected[d.key];
    var poster=d.poster?'<img class="search-poster" src=\"'+IB+'w185'+esc(d.poster)+'\" alt="" loading="lazy" onerror="this.style.display=\'none\'">':'<div class="search-poster-ph">'+icon(d.type)+'</div>';
    var chk='<button class="search-check'+(sel?' on':'')+'" type="button" aria-label="Sélectionner '+esc(d.title)+'" aria-pressed="'+(sel?'true':'false')+'" '+(inList?'disabled':'')+' onclick="event.stopPropagation();toggleSCard(\''+esc(d.key)+'\')"><span class="search-check-box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg></span></button>';
    var stag=inList?'<div class="search-status-tag off">Déjà dans ta liste</div>':'<div class="search-status-tag ok">Ajoutable</div>';
    return '<article class="search-card'+(sel?' selected':'')+(inList?' disabled':'')+'" data-key="'+esc(d.key)+'" tabindex="0">'+chk+'<div class="search-poster-wrap">'+poster+'</div><div class="search-body"><div class="search-title">'+esc(d.title)+'</div><div class="search-meta">'+tbadge(d.type)+'<span class="search-year">'+esc(d.year)+'</span>'+(d.score?'<span class="badge bec">★ '+esc(String(d.score))+'</span>':'')+'</div><div class="search-overview">'+esc(d.overview||'Aucune description.')+'</div>'+stag+'</div></article>';
  }).join('');
  _updateCounter();_updatePager();
}

function toggleSCard(key){
  var item=searchState.results.find(function(x){return x.key===key;});
  if(!item||_inList(item.tmdbId))return;
  searchState.selected[key]=!searchState.selected[key];
  if(!searchState.selected[key])delete searchState.selected[key];
  _renderSR(searchState.results);
}

function addSelectedBatch(){
  var sel=searchState.results.filter(function(x){return !!searchState.selected[x.key]&&!_inList(x.tmdbId);});
  if(!sel.length)return;
  var added=0,skipped=0;
  sel.forEach(function(d){var r=addSearchEntryDirect(d);if(r.ok)added++;else skipped++;});
  searchState.selected={};_updateCounter();
  if(added){render();loadRecos();toast(added+' titre'+(added>1?'s':'')+' ajouté'+(added>1?'s':'')+' · à qualifier');sfx('add');}
  else{toast('Aucun titre ajoutable.','nfo');}
  _renderSR(searchState.results);
}

function _runSearch(query,page){
  var q=(query||'').trim();searchState.query=q;searchState.page=page||1;searchState.token++;var tok=searchState.token;
  if(q.length<2){searchState.results=[];searchState.totalPages=1;_stateText('Tape au moins 2 caractères');_renderSR([]);return;}
  _setSearchLoad(true);_stateText('Recherche de "'+q+'"…');
  _searchTMDB(q,searchState.page).then(function(res){
    if(tok!==searchState.token)return;
    searchState.results=res.results||[];searchState.page=res.page||1;searchState.totalPages=res.total_pages||1;
    _stateText((res.total_results||searchState.results.length)+' résultat'+(((res.total_results||searchState.results.length)>1)?'s':'')+' · page '+searchState.page);
    _renderSR(searchState.results);
  }).catch(function(e){
    if(tok!==searchState.token)return;
    searchState.results=[];_renderSR([]);
    if(e&&e.code==='AUTH_REQUIRED'){_stateText('Connecte-toi (menu Compte) pour rechercher dans TMDB.');return;}
    if(e&&e.code==='FORBIDDEN'){_stateText('Compte non autorisé pour le catalogue TMDB.');return;}
    _stateText('Erreur réseau / TMDB.');toast('Erreur TMDB','err');sfx('err');
  }).finally(function(){if(tok!==searchState.token)return;_setSearchLoad(false);_updatePager();});
}
function searchPage(delta){if(searchState.loading)return;var n=searchState.page+delta;if(n<1||n>searchState.totalPages)return;_runSearch(searchState.query,n);}

var _dbSearch=debounce(function(){_runSearch(document.getElementById('searchModalInput').value,1);},300);

function bindSearchModalEvents(){
  var hIn=document.getElementById('tmdbSearchInput');
  var mIn=document.getElementById('searchModalInput');
  var modal=document.getElementById('searchModal');
  var res=document.getElementById('searchResults');
  hIn.addEventListener('focus',function(){if(searchState.ignoreFocus)return;openSearchModal(this.value.trim());});
  /* Sur mobile le champ du header est écrasé à 0 px : seule la loupe (pointer-events:none) reste visible.
     Toute la barre ouvre donc la recherche, sinon le tap sur la loupe ne fait rien. */
  var hBar=hIn.closest('.search-bar');
  if(hBar)hBar.addEventListener('click',function(e){if(e.target===hIn||searchState.open)return;sfx('click');openSearchModal(hIn.value.trim());});
  hIn.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();openSearchModal(this.value.trim());}});
  hIn.addEventListener('input',debounce(function(){if(this.value.trim().length>=2)openSearchModal(this.value.trim());},320));
  mIn.addEventListener('input',function(){_dbSearch();});
  mIn.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();_runSearch(this.value,1);}});
  modal.addEventListener('click',function(e){if(e.target===this)closeSearchModal();});
  res.addEventListener('click',function(e){
    var card=e.target.closest('.search-card');if(!card)return;
    var item=searchState.results.find(function(x){return x.key===card.dataset.key;});
    if(!item||_inList(item.tmdbId))return;toggleSCard(card.dataset.key);
  });
  res.addEventListener('keydown',function(e){
    var card=e.target.closest('.search-card');if(!card)return;
    if(e.key==='Enter'||e.key===' '){e.preventDefault();toggleSCard(card.dataset.key);}
  });
  document.addEventListener('keydown',function(e){
    var open=document.getElementById('searchModal').classList.contains('on');
    if(open&&e.key==='Escape'){e.preventDefault();sfx('close');closeSearchModal();return;}
    if(!open&&(e.key==='/'||(e.key==='k'&&(e.ctrlKey||e.metaKey)))){e.preventDefault();sfx('click');openSearchModal(document.getElementById('tmdbSearchInput').value.trim());}
  });
}

// ===== DÉTECTION OFFLINE / ONLINE =====
window.addEventListener('online', function() {
  console.log('[' + new Date().toLocaleTimeString() + '] ✓ App en ligne');
  if (typeof loadRecos === 'function') loadRecos();
  if (authProfileId) syncNow();
  else updateSyncStatusUI(authUser?'synced':'anon');
});
window.addEventListener('offline', function() {
  console.warn('[' + new Date().toLocaleTimeString() + '] ⚠ App HORS LIGNE — TMDB inaccessible');
  if (authUser) updateSyncStatusUI('offline');
});

// ===== STATS FOOTER =====
function updateStatsFooter() {
  var el = document.getElementById('statsFooter');
  if (!el) return;
  // Lit memDB (synchronisé avec IndexedDB) — statuts réels : termine/encours/avoir/todo
  var items = (memDB || []).filter(function(w) { return !w.deleted; });
  var termine = items.filter(function(w) { return w.status === 'termine'; }).length;
  var encours = items.filter(function(w) { return w.status === 'encours'; }).length;
  var avoir   = items.filter(function(w) { return w.status === 'avoir'; }).length;
  el.textContent = items.length + ' titres — ' + termine + ' terminés · ' + encours + ' en cours · ' + avoir + ' à voir';
}

