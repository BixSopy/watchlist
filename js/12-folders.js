/* MODULE: Dossiers/sagas (collections TMDB) et actions rapides sur les cartes de reco. */
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
  return '<div class="folder-card" '+(arguments[2]||'')+' '+uiAct('openFolder',[collId])+'>'+
    '<div class="folder-stack">'+stacks+
    '<div class="folder-badge">'+n+'</div>'+
    '<div class="folder-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></div>'+
    '</div>'+
    '<div class="folder-lbl"><div class="folder-name">'+esc(name)+'</div><div class="folder-count">'+esc(tn('pill.titles',n))+'</div></div>'+
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
  document.getElementById('folderMeta').textContent=tn('pill.titles',sorted.length)+(hero.year?' · '+sorted[0].year+' – '+(sorted[sorted.length-1].year||''):'');
  var bg=document.getElementById('folderHeroBg');
  var pi=document.getElementById('folderHeroPosterImg');
  if(heroPost){bg.src=heroBack;bg.style.display='block';pi.src=heroPost;document.getElementById('folderHeroPoster').style.display='block';}
  else{bg.style.display='none';document.getElementById('folderHeroPoster').style.display='none';}
  /* Fetch collection TMDB si on a un tmdbCollectionId */
  var collTmdb=items[0].tmdbCollectionId;
  if(collTmdb){
    tf(TB+'/collection/'+collTmdb+'?language='+TMDB_LANG).then(function(d){
      if(d.backdrop_path){bg.src=IB+'w1280'+d.backdrop_path;}
      if(d.poster_path){pi.src=IB+'w500'+d.poster_path;}
    }).catch(function(){});
  }
  document.getElementById('folderGrid').innerHTML=sorted.map(function(item,i){
    return '<div class="folder-item" style="animation-delay:'+(i*0.04)+'s" '+uiAct('folderItem',[item.id])+'>'+
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
/* Automatique et silencieuse au demarrage (plus dans le menu) : ne traite que les
   films jamais verifies (collectionChecked), qu'ils aient une saga ou non — sinon un
   film standalone (pas de collection TMDB) serait re-interroge a chaque lancement. */
function detectCollections(silent){
  if(_detectRunning)return;
  var films=memDB.filter(function(i){return(i.type==='film'||i.tmdbType==='movie')&&i.tmdbId&&!i.collectionChecked;});
  if(!films.length){if(!silent)toast(t('saga.allChecked'),'nfo');return;}
  _detectRunning=true;
  if(!silent)toast(tn('saga.detecting',films.length),'nfo');
  var updated=0,done=0,rateLimited=0;
  function next(idx){
    if(idx>=films.length){_detectRunning=false;if(updated>0){render();toast(tn('saga.detected',updated));} else if(!silent){if(rateLimited>0)toast(tn('saga.rateLimited',rateLimited),'err');else toast(t('saga.none'),'nfo');}return;}
    var item=films[idx];
    apiFetch(TB+'/movie/'+item.tmdbId+'?language='+TMDB_LANG).then(function(r){
      if(r.status===429){rateLimited++;throw new Error('429');}
      if(!r.ok)throw new Error('HTTP '+r.status);
      return r.json();
    }).then(function(d){
      item.collectionChecked=true;
      if(d.belongs_to_collection&&d.belongs_to_collection.name){
        var cname=d.belongs_to_collection.name.replace(/\s*collection$/i,'').replace(/\s*saga$/i,'').trim();
        var cid=_slugify(cname);
        item.collectionId=cid;item.collectionName=cname;item.tmdbCollectionId=d.belongs_to_collection.id;
        item.updatedAtLocal=Date.now();item.needsSync=true;
        for(var k=0;k<memDB.length;k++){if(memDB[k].id===item.id){memDB[k]=item;break;}}
        dbPut(item,null);updated++;
      }else{
        for(var k2=0;k2<memDB.length;k2++){if(memDB[k2].id===item.id){memDB[k2]=item;break;}}
        dbPut(item,null);
      }
    }).catch(function(e){if(String(e&&e.message)!=='429'){item.collectionChecked=true;for(var k3=0;k3<memDB.length;k3++){if(memDB[k3].id===item.id){memDB[k3]=item;break;}}dbPut(item,null);}}).finally(function(){done++;setTimeout(function(){next(idx+1);},120);});/* 120ms entre chaque pour éviter rate limit */
  }
  next(0);
}
/* Retire immediatement un titre tout juste ajoute des recommandations (sidebar) et des
   rangees Discover (Tendances, etc.), sans attendre le prochain refresh reseau. Purge
   aussi _drCache pour qu'il ne reapparaisse pas si une rangee se re-rend depuis le cache. */
function _removeFromDiscoverUI(tmdbId){
  if(!tmdbId)return;
  document.querySelectorAll('.reco-card[data-tmdbid="'+tmdbId+'"]').forEach(function(card){
    card.style.transition='opacity .25s,transform .25s';card.style.opacity='0';card.style.transform='scale(.92)';
    setTimeout(function(){card.remove();},250);
  });
  document.querySelectorAll('.dr-card[data-tmdbid="'+tmdbId+'"]').forEach(function(card){
    card.style.transition='opacity .2s';card.style.opacity='0';
    setTimeout(function(){card.remove();},200);
  });
  Object.keys(_drCache).forEach(function(key){
    var d=_drCache[key];
    if(d&&d.items)d.items=d.items.filter(function(x){return x.tmdbId!=tmdbId;});
  });
}
function recoPreview(card){sfx('open');var d=getCardData(card);openPlexReco(d);}
function recoAdd(card){sfx('click');var d=getCardData(card);var dup=memDB.find(function(i){return i.tmdbId==d.tmdbId});if(dup){toast(t('add.dup',{title:d.title}),'err');return;}recoAddDirect(d);}
/* Signal négatif pour le profil de goût (js/09-taste-profile.js) : genres/décennie/origine
   déjà dans le dataset de la carte (gratuits, aucun appel TMDB supplémentaire). Capé à 200
   entrées (les plus récentes) pour ne pas faire grossir localStorage indéfiniment. */
function recoDismiss(card){
  sfx('click');
  var id=parseInt(card.dataset.tmdbid);
  if(id){
    dismissed.push(id);
    var gids=(card.dataset.genres||'').split(',').filter(Boolean).map(function(s){return parseInt(s,10);});
    dismissedMeta[id]={genreIds:gids,decade:TASTE_CORE.decadeOf(card.dataset.year),originCountry:card.dataset.origin||null,ts:Date.now()};
    var keys=Object.keys(dismissedMeta);
    if(keys.length>200){
      keys.sort(function(a,b){return(dismissedMeta[a].ts||0)-(dismissedMeta[b].ts||0);});
      keys.slice(0,keys.length-200).forEach(function(k){delete dismissedMeta[k];});
    }
    localStorage.setItem('wl_dis',JSON.stringify(dismissed));
    localStorage.setItem('wl_dis_meta',JSON.stringify(dismissedMeta));
  }
  card.style.transition='opacity .3s,transform .3s';card.style.opacity='0';card.style.transform='translateX(-16px)';setTimeout(function(){card.remove();},300);
}
function getCardData(card){return{tmdbId:card.dataset.tmdbid?parseInt(card.dataset.tmdbid):null,type:card.dataset.type,title:card.dataset.title,year:card.dataset.year,poster:card.dataset.poster||null,score:card.dataset.score||null,overview:card.dataset.overview||''};}
function recoAddDirect(d){
  selTmdb={tmdbId:d.tmdbId,tmdbType:d.type,title:d.title,year:d.year,poster:d.poster||null,overview:d.overview||'',tmdbScore:d.score||null};
  editId=null;myRate=0;
  document.getElementById('mtitle').textContent=t('add.title');document.getElementById('sbtn').textContent=t('common.add');
  document.getElementById('sptitle').textContent=d.title;
  document.getElementById('spmeta').textContent=(d.type=='movie'?t('type.film'):t('type.serieAnime'))+(d.year?' - '+d.year:'');
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

