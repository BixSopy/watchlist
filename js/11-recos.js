/* MODULE: Recommandations personnalisées (sidebar) — chargement et rendu des suggestions. */
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
    tf(TB+'/trending/all/week?language='+TMDB_LANG+'&page='+Math.ceil(Math.random()*3)).then(function(d){return{type:'trending',data:d}}).catch(function(){return{type:'trending',data:null}}),
    (function(){var best=null;memDB.forEach(function(i){if(i.myRating&&(!best||i.myRating>best.myRating))best=i;});if(!best)return Promise.resolve({type:'because',data:null});var tt=best.tmdbType||(best.type=='film'?'movie':'tv');return tf(TB+'/'+tt+'/'+best.tmdbId+'/recommendations?language='+TMDB_LANG).then(function(d){return{type:'because',data:{best:best,results:d}}}).catch(function(){return{type:'because',data:null}})})(),
    Promise.all([
      tf(TB+'/discover/movie?language='+TMDB_LANG+'&sort_by=popularity.desc&vote_count.gte=200&page='+rp1),
      tf(TB+'/discover/movie?language='+TMDB_LANG+'&sort_by=vote_average.desc&vote_count.gte=500&page='+rp2),
      tf(TB+'/discover/tv?language='+TMDB_LANG+'&sort_by=popularity.desc&vote_count.gte=100&page='+rp2),
      tf(TB+'/discover/tv?language='+TMDB_LANG+'&with_genres=16&sort_by=popularity.desc&page='+rp3)
    ]).then(function(res){return{type:'discover',data:res}}).catch(function(){return{type:'discover',data:null}})
  ]).then(function(res){
    var tHtml='',bHtml='',dJson={films:[],series:[],anime:[]};
    var profile=computeTasteProfile();
    res.forEach(function(r){
      if(r.type=='trending'&&r.data){
        var items=(r.data.results||[]).filter(function(x){return(x.media_type=='movie'||x.media_type=='tv')&&notExcl(x)});
        items=_sortByProfile(items,profile).slice(0,6);
        items.forEach(function(x){seenRecos.push(x.id);});
        var html='<div class="sb-section"><div class="sb-sec-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg> '+esc(t('disc.trending'))+'</div>';
        items.forEach(function(x){html+=recoCardHtml(x.media_type=='movie'?{tmdbId:x.id,type:'movie',title:x.title,year:(x.release_date||'').slice(0,4),poster:x.poster_path,score:x.vote_average?x.vote_average.toFixed(1):'',overview:x.overview}:{tmdbId:x.id,type:'tv',title:x.name,year:(x.first_air_date||'').slice(0,4),poster:x.poster_path,score:x.vote_average?x.vote_average.toFixed(1):'',overview:x.overview});});
        html+='</div>';tHtml=html;
      }
      else if(r.type=='because'&&r.data){
        var best=r.data.best;var d=r.data.results;
        var items2=(d.results||[]).filter(function(x){return notExcl(x)});
        items2=_sortByProfile(items2,profile).slice(0,5);
        items2.forEach(function(x){seenRecos.push(x.id);});
        if(items2.length){var html2='<div class="sb-section"><div class="sb-sec-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg> '+esc(t('reco.because',{title:best.title.slice(0,18)}))+'</div>';items2.forEach(function(x){var isM=!x.name;html2+=recoCardHtml({tmdbId:x.id,type:isM?'movie':'tv',title:isM?x.title:x.name,year:isM?(x.release_date||'').slice(0,4):(x.first_air_date||'').slice(0,4),poster:x.poster_path,score:x.vote_average?x.vote_average.toFixed(1):'',overview:x.overview});});html2+='</div>';bHtml=html2;}
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
  var ph=d.poster?'<img class="reco-img" src=\"'+IB+'w185'+esc(d.poster)+'\" alt="" loading="eager" width="110" height="165" data-hide-broken>':'<div class="reco-img-ph">'+icon(d.type=='movie'?'film':'serie')+'</div>';
  var sc=d.score?'<div class="reco-score">&#9733; '+parseFloat(d.score).toFixed(1)+'</div>':'';
  var num=typeof idx==='number'?'<div class="reco-num">'+(idx+1)+'</div>':'';
  var ds='data-tmdbid="'+(d.tmdbId||'')+'" data-type="'+esc(d.type)+'" data-title="'+esc(d.title)+'" data-year="'+esc(String(d.year||''))+'" data-poster="'+esc(d.poster||'')+'" data-score="'+esc(String(d.score||''))+'" data-overview="'+esc(d.overview||'')+'"';
  return '<div class="reco-card" '+ds+'><div class="reco-img-wrap" data-click="recoPreview" title="'+esc(t('plex.overview'))+'">'+num+ph+'</div><div class="reco-body"><div class="reco-title">'+esc(d.title)+'</div><div class="reco-year">'+esc(String(d.year||''))+'</div>'+sc+'<div class="reco-btns"><button class="rbtn add" data-sfx-hover data-click="recoAdd">'+esc(t('reco.add'))+'</button><button class="rbtn no" data-sfx-hover data-click="recoDismiss">'+esc(t('reco.no'))+'</button></div></div></div>';
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
  var secs=[{key:'films',label:esc(t('type.films')),ico:'<rect x="2" y="2" width="20" height="20" rx="2"/><path d="m7 2 0 20M17 2v20M2 12h20M2 7h5M17 7h5M2 17h5M17 17h5"/>',t:'film'},{key:'series',label:esc(t('type.series')),ico:'<rect x="2" y="7" width="20" height="15" rx="2"/><polyline points="17 2 12 7 7 2"/>',t:'serie'},{key:'anime',label:esc(t('type.anime')),ico:'<circle cx="12" cy="12" r="10"/><path d="m4.93 4.93 14.14 14.14"/>',t:'anime'}];
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
  document.getElementById('sbContent').innerHTML=html||'<div class="sb-loading">'+esc(t('reco.none'))+'</div>';
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
