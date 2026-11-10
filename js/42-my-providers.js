/* MODULE: Mes plateformes — je coche mes abonnements (Réglages → Suivi) ; le filtre « Sur mes
   plateformes » de Ma liste ne garde que les titres disponibles en streaming inclus dans l'abonnement
   (TMDB watch/providers, offres « flatrate », pays TMDB_REGION). 100 % local : choix dans
   localStorage, plateformes de chaque titre dans IndexedDB (comme streamingProviders, js/14-suivi.js).
   Les plateformes des titres « À voir » et « En cours » sont rafraîchies au plus une fois par semaine,
   par lots, seulement si au moins une plateforme est cochée. */
var MP_KEY='wl_my_providers',MP_FILTER_KEY='wl_my_prov_filter',MP_TTL=7*86400000,MP_BATCH=6,MP_CATALOG_MAX=24;
var _mpCatalog=null,_mpRefreshing=false;

function myProviders(){
  try{var a=JSON.parse(localStorage.getItem(MP_KEY)||'[]');return Array.isArray(a)?a.map(Number).filter(function(n){return n>0;}):[];}catch(e){return [];}
}
function _mpSave(ids){try{localStorage.setItem(MP_KEY,JSON.stringify(ids));}catch(e){}}
function mpFilterOn(){
  var on=false;try{on=localStorage.getItem(MP_FILTER_KEY)==='1';}catch(e){}
  return on&&myProviders().length>0;
}
/* Disponible sur une de mes plateformes : par id TMDB ; les anciens enregistrements (sans id) par nom */
function itemOnMyProviders(item,mine,names){
  var ps=item.streamingProviders;if(!ps||!ps.length)return false;
  for(var i=0;i<ps.length;i++){
    if(ps[i].id!=null){if(mine.indexOf(Number(ps[i].id))>-1)return true;}
    else if(names&&names[String(ps[i].name||'').toLowerCase()])return true;
  }
  return false;
}
function mpFilterItems(items){
  if(!mpFilterOn())return items;
  var mine=myProviders(),names={};
  (_mpCatalog||[]).forEach(function(p){if(mine.indexOf(p.id)>-1)names[p.name.toLowerCase()]=1;});
  return items.filter(function(i){return itemOnMyProviders(i,mine,names);});
}

/* Catalogue des plateformes du pays (films + séries fusionnés), dans l'ordre de mise en avant TMDB */
function mpCatalog(){
  if(_mpCatalog)return Promise.resolve(_mpCatalog);
  var q='?language='+TMDB_LANG+'&watch_region='+TMDB_REGION;
  return Promise.all([tf(TB+'/watch/providers/movie'+q),tf(TB+'/watch/providers/tv'+q)]).then(function(rs){
    var byId={};
    rs.forEach(function(r){((r&&r.results)||[]).forEach(function(p){
      if(!p||!p.provider_id)return;
      var prio=(p.display_priorities&&p.display_priorities[TMDB_REGION]);if(prio==null)prio=p.display_priority!=null?p.display_priority:999;
      var cur=byId[p.provider_id];
      if(!cur||prio<cur.prio)byId[p.provider_id]={id:p.provider_id,name:p.provider_name,logo:p.logo_path?IB+'w92'+p.logo_path:null,prio:prio};
    });});
    _mpCatalog=Object.keys(byId).map(function(k){return byId[k];}).sort(function(a,b){return a.prio-b.prio||textCompare(a.name,b.name);}).slice(0,MP_CATALOG_MAX);
    return _mpCatalog;
  });
}

/* Plateformes d'un titre (flatrate du pays), avec leur id pour le filtre */
function mpProvidersOf(d){
  var fr=d&&d.results&&d.results[TMDB_REGION];
  if(!fr||!fr.flatrate||!fr.flatrate.length)return [];
  return fr.flatrate.slice(0,6).map(function(p){return{id:p.provider_id,name:p.provider_name,logo:p.logo_path?IB+'w45'+p.logo_path:null,url:fr.link||null};});
}
function mpRefresh(){
  if(_mpRefreshing||!myProviders().length)return Promise.resolve(0);
  var now=Date.now();
  var todo=memDB.filter(function(i){
    return !i.deleted&&i.tmdbId&&(i.status==='avoir'||i.status==='todo'||i.status==='encours')&&!(i.providersAt&&now-i.providersAt<MP_TTL);
  });
  if(!todo.length)return Promise.resolve(0);
  _mpRefreshing=true;
  var k=0,changed=0;
  function one(item){
    var kind=item.tmdbType||(item.type==='film'?'movie':'tv');
    return tf(TB+'/'+kind+'/'+item.tmdbId+'/watch/providers').then(function(d){
      item.streamingProviders=mpProvidersOf(d);item.providersAt=Date.now();changed++;
      return new Promise(function(res){dbPut(item,res);});
    },function(e){
      if(e&&/^(FORBIDDEN|QUOTA|UNCONFIRMED|AUTH_REQUIRED)$/.test(e.code))throw e;
    });
  }
  function next(){
    if(k>=todo.length)return Promise.resolve();
    var batch=todo.slice(k,k+MP_BATCH);k+=MP_BATCH;
    return Promise.all(batch.map(one)).then(next);
  }
  return next().then(function(){_mpRefreshing=false;if(changed&&mpFilterOn())render();return changed;},function(){_mpRefreshing=false;return changed;});
}

/* Pastille « Sur mes plateformes » de Ma liste : visible dès qu'une plateforme est cochée */
function mpChipUpdate(){
  var b=document.getElementById('myProvChip');if(!b)return;
  var has=myProviders().length>0;
  b.hidden=!has;
  b.classList.toggle('on',has&&mpFilterOn());
  b.setAttribute('aria-pressed',has&&mpFilterOn()?'true':'false');
}
function toggleMyProvFilter(){
  try{localStorage.setItem(MP_FILTER_KEY,mpFilterOn()?'0':'1');}catch(e){}
  mpChipUpdate();render();
  if(mpFilterOn())mpRefresh();
}
function toggleMyProvider(id){
  id=Number(id);var ids=myProviders(),i=ids.indexOf(id);
  if(i>-1)ids.splice(i,1);else ids.push(id);
  _mpSave(ids);mpChipUpdate();
  var el=document.querySelector('.mp-chip[data-args="['+id+']"]');if(el){el.classList.toggle('on',i<0);el.setAttribute('aria-pressed',i<0?'true':'false');}
  if(ids.length)mpRefresh();
  if(mpFilterOn())render();
}

/* Section des réglages : grille de logos cochables, chargée à l'ouverture */
function mpSettingsHtml(){
  return '<div class="setting-label">'+esc(t('set.myProviders'))+'</div><div class="setting-hint">'+esc(t('set.myProvidersHint'))+'</div>'+
    '<div class="mp-grid" id="mpGrid"><span class="setting-hint">'+esc(t('common.loading'))+'</span></div>';
}
function mpSettingsFill(){
  var g=document.getElementById('mpGrid');if(!g)return;
  mpCatalog().then(function(list){
    g=document.getElementById('mpGrid');if(!g)return;
    var mine=myProviders();
    g.innerHTML=list.map(function(p){
      var on=mine.indexOf(p.id)>-1;
      return '<button type="button" class="mp-chip'+(on?' on':'')+'" aria-pressed="'+(on?'true':'false')+'" title="'+esc(p.name)+'"'+uiAct('toggleMyProvider',[p.id])+'>'+
        (p.logo?'<img src="'+esc(p.logo)+'" alt="" loading="lazy" decoding="async" data-hide-broken>':'')+'<span>'+esc(p.name)+'</span></button>';
    }).join('');
  }).catch(function(){g.innerHTML='';});
}
if(typeof module!=='undefined')module.exports={myProviders:myProviders,itemOnMyProviders:itemOnMyProviders,mpProvidersOf:mpProvidersOf,mpFilterItems:mpFilterItems,mpFilterOn:mpFilterOn,mpRefresh:mpRefresh,mpCatalog:mpCatalog};
