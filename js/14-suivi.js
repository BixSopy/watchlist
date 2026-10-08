/* MODULE: Suivi des sorties (prochains épisodes/films, rappels, plateformes de streaming). */
/* AIR ALERTS */
function checkAir(item){
  if(!item.tmdbId||item.type=='film')return;
  tf(TB+'/tv/'+item.tmdbId+'?language='+TMDB_LANG).then(function(d){
    var changed=false;
    if(d.next_episode_to_air&&d.next_episode_to_air.air_date){item.nextAir=d.next_episode_to_air.air_date;changed=true;}
    var last=d.last_episode_to_air,isNew=false;
    if(last&&item.status=='encours'){
      var userSeason=item.saison||1,userEp=item.episode||0;
      var lastSeason=last.season_number||1;
      /* Comparer saison+episode, pas juste le numero d'episode dans sa saison :
         S02E10 n'est pas "plus loin" que S01E05 juste parce que 10>5. */
      var isAhead=lastSeason>userSeason||(lastSeason===userSeason&&last.episode_number>userEp);
      var daysSinceAir=last.air_date?Math.floor((Date.now()-new Date(last.air_date+'T00:00:00').getTime())/86400000):Infinity;
      /* "Nouvel episode" seulement si recent (<=45 jours) : au-dela, c'est du retard
         de visionnage sur un episode deja ancien (serie terminee depuis des annees
         par ex.), pas une sortie a signaler. */
      isNew=isAhead&&daysSinceAir<=45;
    }
    if(item.hasNewEp!==isNew){item.hasNewEp=isNew;changed=true;}
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
        return '<span class="alert-link"'+uiAct('openPlexQuiet',[i.id])+' style="cursor:pointer;text-decoration:underline">'+esc(i.title)+'</span>';
      }).join(', ');
      document.getElementById('alertText').innerHTML='<b>'+esc(tn('suivi.newEps',newEps.length))+'</b> : '+namesHtml;
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
  tf(TB+'/movie/'+item.tmdbId+'?language='+TMDB_LANG).then(function(d){
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
    tf(TB+'/tv/'+item.tmdbId+'?language='+TMDB_LANG).then(function(d){
      /* Pas de prochain episode programme (serie terminee/annulee, ou pause entre saisons) :
         on efface une eventuelle ancienne date, sinon elle reste figee pour toujours et
         remonte comme "nouvel episode sorti" (ex. une serie finie depuis des annees). */
      item.nextAirDate=(d.next_episode_to_air&&d.next_episode_to_air.air_date)||null;
      item.nextAir=item.nextAirDate;
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
    var fr=d&&d.results&&d.results[TMDB_REGION];
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
  /* Date déjà passée (hier ou avant) : rien à signaler, que ce soit un film ou une série —
     sinon une date figée (ex. serie terminee des annees plus tot) reste affichee indefiniment
     comme "nouveaute" a chaque chargement. */
  if(diffDays<0)return null;
  if(diffDays===0){
    return item.type=='film'
      ?{cls:'new',text:'&#10003; '+esc(t('suivi.outToday')),tomorrow:false}
      :{cls:'new',text:'&#10003; '+esc(t('suivi.newEpOut')),tomorrow:false};
  }
  return{cls:'soon',text:'&#9200; '+esc(t('suivi.expected',{date:fmtDate(d)})),tomorrow:diffDays===1};
}

function renderSuivi(){
  var body=document.getElementById('suiviBody');
  if(!body)return;
  var tracked=memDB.map(function(i){var st=suiviStatusFor(i);return st?{item:i,status:st}:null;}).filter(Boolean);
  tracked.sort(function(a,b){return new Date(a.item.nextAirDate)-new Date(b.item.nextAirDate);});
  if(!tracked.length){body.innerHTML='<div class="suivi-empty">'+esc(t('suivi.empty'))+'</div>';return;}
  var shown=tracked.slice(0,SUIVI_MAX);
  var html=shown.map(function(tt){
    var item=tt.item,st=tt.status;
    var poster=item.poster?'<img class="suivi-poster" src=\"'+IB+'w92'+esc(item.poster)+'\" alt="">':'<div class="suivi-poster-ph">'+icon(item.type)+'</div>';
    var provHtml='';
    if(item.streamingProviders&&item.streamingProviders.length){
      provHtml='<div class="suivi-providers">'+item.streamingProviders.map(function(p){return p.logo?'<img class="suivi-provider-logo" src="'+esc(p.logo)+'" title="'+esc(p.name)+'" alt="'+esc(p.name)+'">':'';}).join('')+'</div>';
    }
    var tomorrowBadge=st.tomorrow?'<span class="suivi-badge tomorrow">&#9200; '+esc(t('suivi.tomorrow'))+'</span>':'';
    return '<div class="suivi-item" data-id="'+esc(item.id)+'" '+uiAct('openPlex',[item.id])+' style="cursor:pointer">'+poster+
      '<div class="suivi-info"><span class="suivi-title">'+esc(item.title)+'</span>'+
      '<span class="suivi-badge '+st.cls+'">'+st.text+'</span>'+tomorrowBadge+provHtml+'</div>'+
      '<button class="suivi-reminder-toggle" data-active="'+(item.reminderEnabled?'true':'false')+'" '+uiAct('toggleReminder',[item.id])+' title="'+esc(t('suivi.reminder'))+'">&#128276;</button>'+
      '</div>';
  }).join('');
  if(tracked.length>SUIVI_MAX){
    html+='<button class="suivi-more" data-click="sfxClick">'+esc(t('suivi.seeAll',{n:tracked.length}))+'</button>';
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
      if(perm!=='granted'){item.reminderEnabled=false;toast(t('suivi.notifDenied'),'nfo');}
      finish();
    }).catch(function(){item.reminderEnabled=false;finish();});
  }else{
    if(enabling&&typeof Notification!=='undefined'&&Notification.permission==='denied'){
      item.reminderEnabled=false;toast(t('suivi.notifBlocked'),'nfo');
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
          body:item.type=='film'?t('suivi.outToday'):t('suivi.newEpToday'),
          icon:item.poster?(IB+'w92'+item.poster):undefined
        });
      }catch(e){}
    }
  });
}

