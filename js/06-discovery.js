/* MODULE: Onglets de contenu et rangées de découverte façon Netflix (TMDB discover/trending). */
/* TABS */
/* ============================================================
   DISCOVERY ROWS — NETFLIX STYLE
   ============================================================ */
var DISCOVER_CONFIG={
  all:[
    {id:'tr-all',title:t('disc.trending'),url:'/trending/all/week',mixed:true},
    {id:'bc-all',title:t('disc.because'),type:'because',filter:'all'},
    {id:'pop-film',title:t('disc.popMovies'),url:'/discover/movie?sort_by=popularity.desc&vote_count.gte=200',mtype:'movie'},
    {id:'pop-serie',title:t('disc.popSeries'),url:'/discover/tv?sort_by=popularity.desc&vote_count.gte=100&without_genres=16',mtype:'tv'},
    {id:'top-film',title:t('disc.topMovies'),url:'/discover/movie?sort_by=vote_average.desc&vote_count.gte=2000',mtype:'movie'},
  ],
  film:[
    {id:'tr-film',title:t('disc.trendingMovies'),url:'/trending/movie/week',mtype:'movie'},
    {id:'bc-film',title:t('disc.because'),type:'because',filter:'film'},
    {id:'pop-film2',title:t('disc.popMovies'),url:'/discover/movie?sort_by=popularity.desc&vote_count.gte=200',mtype:'movie'},
    {id:'top-film2',title:t('disc.topRated'),url:'/discover/movie?sort_by=vote_average.desc&vote_count.gte=2000',mtype:'movie'},
    {id:'new-film',title:t('disc.recent'),url:'/discover/movie?sort_by=primary_release_date.desc&vote_count.gte=100',mtype:'movie'},
  ],
  serie:[
    {id:'tr-serie',title:t('disc.trendingSeries'),url:'/trending/tv/week',mtype:'tv'},
    {id:'bc-serie',title:t('disc.because'),type:'because',filter:'serie'},
    {id:'pop-serie2',title:t('disc.popSeries'),url:'/discover/tv?sort_by=popularity.desc&vote_count.gte=100&without_genres=16',mtype:'tv'},
    {id:'top-serie',title:t('disc.topRated'),url:'/discover/tv?sort_by=vote_average.desc&vote_count.gte=300&without_genres=16',mtype:'tv'},
    {id:'kr-serie',title:t('disc.kdramas'),url:'/discover/tv?sort_by=popularity.desc&with_origin_country=KR&without_genres=16',mtype:'tv'},
  ],
  anime:[
    {id:'tr-anime',title:t('disc.trendingAnime'),url:'/discover/tv?with_genres=16&sort_by=popularity.desc',mtype:'tv'},
    {id:'bc-anime',title:t('disc.because'),type:'because',filter:'anime'},
    {id:'an-action',title:t('genre.action'),url:'/discover/tv?with_genres=16,10759&sort_by=popularity.desc',mtype:'tv'},
    {id:'an-comedy',title:t('genre.comedy'),url:'/discover/tv?with_genres=16,35&sort_by=popularity.desc',mtype:'tv'},
    {id:'an-drama',title:t('disc.drama'),url:'/discover/tv?with_genres=16,18&sort_by=popularity.desc',mtype:'tv'},
    {id:'an-fantasy',title:t('genre.fantasy'),url:'/discover/tv?with_genres=16,14&sort_by=popularity.desc',mtype:'tv'},
    {id:'an-romance',title:t('genre.romance'),url:'/discover/tv?with_genres=16,10749&sort_by=popularity.desc',mtype:'tv'},
    {id:'an-scifi',title:t('genre.scifi'),url:'/discover/tv?with_genres=16,10765&sort_by=popularity.desc',mtype:'tv'},
    {id:'an-mystery',title:t('disc.mystery'),url:'/discover/tv?with_genres=16,9648&sort_by=popularity.desc',mtype:'tv'},
    {id:'an-isekai',title:t('disc.isekai'),url:'/discover/tv?with_genres=16&with_keywords=210024&sort_by=popularity.desc',mtype:'tv'},
    {id:'an-mecha',title:t('disc.mecha'),url:'/discover/tv?with_genres=16&with_keywords=3944&sort_by=popularity.desc',mtype:'tv'},
    {id:'an-shonen',title:t('disc.shonen'),url:'/discover/tv?with_genres=16&with_keywords=157015&sort_by=popularity.desc',mtype:'tv'},
    {id:'an-seinen',title:t('disc.seinen'),url:'/discover/tv?with_genres=16&with_keywords=162246&sort_by=popularity.desc',mtype:'tv'},
    {id:'an-slice',title:t('disc.slice'),url:'/discover/tv?with_genres=16,18&sort_by=vote_average.desc&vote_count.gte=80',mtype:'tv'},
    {id:'an-kids',title:t('disc.kodomo'),url:'/discover/tv?with_genres=16,10762&sort_by=popularity.desc',mtype:'tv'},
    {id:'an-ecchi',title:t('disc.ecchi'),url:'/discover/tv?with_genres=16&with_keywords=5095&sort_by=popularity.desc',mtype:'tv'},
    {id:'an-harem',title:t('disc.harem'),url:'/discover/tv?with_genres=16&with_keywords=158645&sort_by=popularity.desc',mtype:'tv'},
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
  var tt=best.tmdbType||(best.type==='film'?'movie':'tv');
  var inL=new Set(memDB.map(function(i){return i.tmdbId;}));
  function get(u){return apiFetch(u).then(function(r){return r.ok?r.json():{results:[]};}).catch(function(){return{results:[]};});}
  var base=TB+'/'+tt+'/'+best.tmdbId,q='?language='+TMDB_LANG+'&page=';
  /* recommendations p1+p2 puis similar p1+p2 en fallback → pool large garanti */
  return Promise.all([get(base+'/recommendations'+q+'1'),get(base+'/recommendations'+q+'2'),get(base+'/similar'+q+'1'),get(base+'/similar'+q+'2')]).then(function(pages){
    var seen={},items=[];
    pages.forEach(function(d){
      (d.results||[]).forEach(function(x){
        if(seen[x.id])return;seen[x.id]=1;
        if(inL.has(x.id)||dismissed.indexOf(x.id)>=0||!x.poster_path)return;
        items.push(_drNormItem(x,tt));
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
    return apiFetch(TB+cfg.url+sep+'language='+TMDB_LANG+'&page='+p)
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
  var p=d.poster?'<img class="dr-poster" src="'+IB+'w185'+esc(d.poster)+'" alt="" loading="lazy" data-hide-broken>':'<div class="dr-poster-ph">'+icon(d.type==='movie'?'film':d.type==='tv'?'serie':'anime')+'</div>';
  var sc=d.score?'<div class="dr-score">&#9733; '+d.score+'</div>':'';
  var ds='data-tmdbid="'+esc(String(d.tmdbId||''))+'" data-type="'+esc(d.type||'')+'" data-title="'+esc(d.title||'')+'" data-year="'+esc(d.year||'')+'" data-poster="'+esc(d.poster||'')+'" data-score="'+esc(String(d.score||''))+'" data-overview="'+esc(d.overview||'')+'"';
  return '<div class="dr-card" '+ds+' data-click="openPlexRecoCard" data-sfx-hover><div class="dr-poster-wrap">'+p+'</div><div class="dr-title">'+esc(d.title)+'</div><div style="display:flex;gap:5px;align-items:center">'+sc+'<div class="dr-year">'+esc(d.year||'')+'</div></div></div>';
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
  var label=esc(cfg.title)+(cfg.type==='because'&&data.title?' <em>'+esc(data.title.slice(0,20))+'</em>':'');
  row.innerHTML=
    '<div class="dr-row-head">'+
      '<div class="dr-row-title">'+label+'</div>'+
    '</div>'+
    '<div class="dr-row-wrap">'+
      '<button class="dr-arrow left" '+uiAct('drScrollRow',[innerId,-1])+' aria-label="'+esc(t('common.prev'))+'">'+
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>'+
      '</button>'+
      '<div class="dr-row-inner" id="'+innerId+'">'+items.map(_drCardHtml).join('')+'</div>'+
      '<button class="dr-arrow right" '+uiAct('drScrollRow',[innerId,1])+' aria-label="'+esc(t('common.next'))+'">'+
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
var discoverCat='all';
function switchTab(btn){
  sfx('click');
  document.querySelectorAll('.ntab').forEach(function(b){b.classList.remove('on')});
  btn.classList.add('on');
  activeTab=btn.dataset.tab;
  document.body.classList.toggle('view-discover',activeTab==='discover');
  _heroIdx=0;
  render();
  if(activeTab==='discover')loadDiscovery(discoverCat);
}
function switchDiscoverCat(btn){
  sfx('click');
  document.querySelectorAll('#discoverCatPills .stab').forEach(function(b){b.classList.remove('on')});
  btn.classList.add('on');
  discoverCat=btn.dataset.dc;
  loadDiscovery(discoverCat);
}

/* Session 11B : actions Réglages > Recommandations */
function resetDismissedRecos(){
  if(!confirm(t('disc.resetDismissedConfirm')))return;
  dismissed=[];
  localStorage.setItem('wl_dis','[]');
  _preserveContentScroll(function(){cache={};seenRecos=[];loadRecos();});
  toast(t('disc.resetDismissedDone'));
}
function clearDiscoveryCache(){
  if(!confirm(t('disc.clearCacheConfirm')))return;
  _drCache={};
  cache={};
  seenRecos=[];
  _preserveContentScroll(function(){
    loadDiscovery(activeTab);
    loadRecos();
  });
  toast(t('disc.clearCacheDone'));
}

document.getElementById('stabs').addEventListener('click',function(e){var b=e.target.closest('.stab');if(!b)return;sfx('click');document.querySelectorAll('.stab').forEach(function(x){x.classList.remove('on')});b.classList.add('on');activeStat=b.dataset.s;var m=document.getElementById('statSelMobile');if(m)m.value=activeStat;render();});
document.getElementById('sortSel').addEventListener('change',render);
document.getElementById('qinput').addEventListener('input',function(e){fq=e.target.value;render();});

/* COMPACT */
function toggleCompact(){compactOn=!compactOn;sfx('click');localStorage.setItem('wl_cpt',compactOn?'1':'0');render();}

