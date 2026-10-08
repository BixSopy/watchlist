/* MODULE: Modale de recherche/catalogue TMDB (recherche, filtres, parseur de requêtes en langage naturel). */
var searchState={open:false,query:'',page:1,totalPages:1,results:[],selected:{},loading:false,token:0,lastFocus:null,ignoreFocus:false};

function debounce(fn,delay){var tt=null;return function(){var ctx=this,a=arguments;clearTimeout(tt);tt=setTimeout(function(){fn.apply(ctx,a);},delay||300);};}

function _mediaAppType(mt,item){
  if(mt==='movie')return'film';
  if(mt==='tv'){var txt=((item.name||'')+' '+(item.original_name||'')+' '+(item.overview||'')).toLowerCase();if(txt.indexOf('anime')>-1)return'anime';}
  return'serie';
}
function _normSR(r){
  var isM=r.media_type==='movie';
  return{key:r.media_type+'-'+r.id,tmdbId:r.id,tmdbType:r.media_type,type:_mediaAppType(r.media_type,r),
    title:(isM?r.title:r.name)||t('search.untitled'),year:(isM?(r.release_date||''):(r.first_air_date||'')).slice(0,4),
    poster:r.poster_path||null,overview:r.overview||'',score:r.vote_average?r.vote_average.toFixed(1):null,
    popularity:r.popularity||0,genreIds:r.genre_ids||[]};
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
  if(c)c.textContent=tn('search.selected',n);
  if(b){b.disabled=n===0;b.textContent=tn('search.addSelected',n);}
}
function _updatePager(){
  document.getElementById('searchPageInd').textContent=t('search.page',{n:searchState.page});
  document.getElementById('searchPrevBtn').disabled=searchState.page<=1||searchState.loading;
  document.getElementById('searchNextBtn').disabled=searchState.page>=searchState.totalPages||searchState.loading||!searchState.results.length;
}
function _stateText(tt){var el=document.getElementById('searchState');if(el)el.textContent=tt;}

function openSearchModal(prefill){
  searchState.open=true;searchState.lastFocus=document.activeElement;
  var m=document.getElementById('searchModal');m.classList.add('on');m.setAttribute('aria-hidden','false');
  document.body.style.overflow='hidden';
  var q=typeof prefill==='string'?prefill:(document.getElementById('tmdbSearchInput').value||'').trim();
  document.getElementById('searchModalInput').value=q;
  searchState.query=q;_updateCounter();_updatePager();
  _stateText(q.length>=2?t('search.searching'):t('search.min2'));
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
  enfant:{movie:null,tv:10762},
  /* Mots-clés anglais (interface en anglais) */
  adventure:{movie:12,tv:10759},comedy:{movie:35,tv:35},documentary:{movie:99,tv:99},
  drama:{movie:18,tv:18},family:{movie:10751,tv:10751},fantasy:{movie:14,tv:10765},
  history:{movie:36,tv:null},horror:{movie:27,tv:null},music:{movie:10402,tv:null},
  mystery:{movie:9648,tv:9648},war:{movie:10752,tv:10768}
};
function _normTok(s){return(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9+>]/g,'');}
/* Retourne null si rien de structuré n'est reconnu (→ fallback recherche classique) */
function _parseStructuredQuery(q){
  var tokens=(q||'').trim().split(/\s+/).filter(Boolean);
  if(!tokens.length)return null;
  var genreIds={movie:[],tv:[]},year=null,minScore=null,forcedType=null,forceAnime=false,textParts=[],matchedSomething=false,explicit=false;
  tokens.forEach(function(raw){
    var tt=_normTok(raw);
    if(!tt){textParts.push(raw);return;}
    if(/^(19|20)\d{2}$/.test(tt)){year=tt;matchedSomething=true;return;}
    var rm=tt.match(/^(?:note)?([1-9])\+$/)||tt.match(/^>([1-9])$/);
    if(rm){minScore=parseInt(rm[1],10);matchedSomething=explicit=true;return;}
    if(tt==='film'||tt==='films'||tt==='movie'||tt==='movies'){forcedType='movie';matchedSomething=explicit=true;return;}
    if(tt==='serie'||tt==='series'||tt==='tv'||tt==='show'||tt==='shows'){forcedType='tv';matchedSomething=explicit=true;return;}
    if(tt==='anime'){forceAnime=true;forcedType='tv';matchedSomething=explicit=true;return;}
    if(GENRE_MAP[tt]){
      var g=GENRE_MAP[tt];
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
/* Discover TMDB filtré à partir d'une requête structurée. Sans tri explicite (sortBy omis,
   cas de l'astuce texte « Action 2020 ★4+ ») : classé par profil de goût. Avec tri explicite
   (menu Tri du modal) : on respecte ce choix et on ne ré-ordonne pas par profil. */
function _discoverStructured(parsed,page,sortBy){
  var calls=[];
  parsed.mtypes.forEach(function(mt){
    var gids=parsed.genreIds[mt]||[];
    var params='?language='+TMDB_LANG+'&page='+page+'&sort_by='+(sortBy||'popularity.desc');
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
    if(sortBy){
      merged.sort(function(a,b){
        if(sortBy==='vote_average.desc')return(parseFloat(b.score)||0)-(parseFloat(a.score)||0);
        if(sortBy==='primary_release_date.desc')return(b.year||'').localeCompare(a.year||'');
        return(b.popularity||0)-(a.popularity||0);
      });
    }else{
      merged=_sortByProfile(merged,computeTasteProfile());
    }
    merged=merged.slice(0,20);
    return{results:merged,page:page,total_pages:totalPages,total_results:totalResults||merged.length};
  });
}
/* Parcours par genre explicite (menu Genre du modal), sans texte libre : types sans
   correspondance TMDB pour ce genre (ex. Horreur n'existe pas côté séries) sont ignorés. */
function _discoverByGenre(genreKey,typeFilter,sortFilter,yearFilter,page){
  var g=GENRE_MAP[genreKey];
  if(!g)return Promise.resolve({results:[],page:1,total_pages:1,total_results:0});
  var mtypes=(typeFilter?[typeFilter]:['movie','tv']).filter(function(mt){return g[mt];});
  if(!mtypes.length)return Promise.resolve({results:[],page:1,total_pages:1,total_results:0});
  var parsed={genreIds:{movie:g.movie?[g.movie]:[],tv:g.tv?[g.tv]:[]},year:yearFilter||null,minScore:null,mtypes:mtypes,textQuery:''};
  return _discoverStructured(parsed,page,sortFilter||null);
}
/* Un résultat correspond au genre choisi si son genre_ids contient l'id TMDB du genre pour
   SON type (movie/tv ont des ids différents, et certains genres n'existent que pour l'un
   des deux — ex. Horreur n'a pas d'équivalent séries sur TMDB, auquel cas aucun résultat
   tv ne peut jamais correspondre, ce qui est la réalité du catalogue, pas un bug). */
function _matchesGenre(genreKey,mediaType,genreIds){
  if(!genreKey)return true;
  var g=GENRE_MAP[genreKey];if(!g)return true;
  var gid=mediaType==='movie'?g.movie:g.tv;
  if(!gid)return false;
  return(genreIds||[]).indexOf(gid)>=0;
}
function _searchTMDB(q,page){
  q=(q||'').trim();page=page||1;
  var sfType=document.getElementById('sfType');
  var sfGenre=document.getElementById('sfGenre');
  var sfSort=document.getElementById('sfSort');
  var sfYear=document.getElementById('sfYear');
  var typeFilter=sfType?sfType.value:'';
  var genreFilter=sfGenre?sfGenre.value:'';
  var sortFilter=sfSort?sfSort.value:'';
  var yearFilter=sfYear?sfYear.value:'';
  /* Pas de texte : uniquement exploitable si un genre est choisi (parcours /discover) */
  if(q.length<2){
    if(!genreFilter)return Promise.resolve({results:[],page:1,total_pages:1,total_results:0});
    return _discoverByGenre(genreFilter,typeFilter,sortFilter,yearFilter,page);
  }
  /* Requête structurée ("Action 2020 ★4+") : uniquement si aucun filtre manuel n'est déjà
     actif, pour ne jamais entrer en conflit avec les sélecteurs existants du modal. */
  if(!typeFilter&&!genreFilter&&!sortFilter&&!yearFilter){
    var parsed=_parseStructuredQuery(q);
    if(parsed)return _discoverStructured(parsed,page);
  }
  /* Type + tri : recherche texte sur /search/{type} (TMDB /discover n'a pas de filtre texte),
     filtre d'année, de genre et tri appliqués côté client sur la page de résultats */
  if(typeFilter&&sortFilter){
    var ep=typeFilter==='movie'?'/search/movie':'/search/tv';
    var params='?language='+TMDB_LANG+'&page='+page+'&include_adult=false&query='+encodeURIComponent(q);
    var url2=TB+ep+params;
    return tf(url2).then(function(data){
      var mtype=typeFilter;
      var dateOf=function(r){return(mtype==='movie'?r.release_date:r.first_air_date)||'';};
      var rows=(data.results||[]).filter(function(r){
        if(!(r.title||r.name)||_inDismissed(r.id))return false;
        if(yearFilter){var yr=parseInt(dateOf(r).slice(0,4));if(!(yr>=parseInt(yearFilter)))return false;}
        if(!_matchesGenre(genreFilter,mtype,r.genre_ids))return false;
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
  /* Sinon search/multi standard + filtres type/genre/année/tri appliqués côté client */
  var url=TB+'/search/multi?language='+TMDB_LANG+'&query='+encodeURIComponent(q)+'&page='+page+'&include_adult=false';
  return tf(url).then(function(data){
    var rows=(data.results||[]).filter(function(r){
      if(!(r.media_type==='movie'||r.media_type==='tv'))return false;
      if(!(r.title||r.name))return false;
      if(_inDismissed(r.id))return false;
      if(typeFilter&&r.media_type!==typeFilter)return false;
      if(yearFilter){var yr=(r.media_type==='movie'?(r.release_date||''):(r.first_air_date||'')).slice(0,4);if(parseInt(yr)<parseInt(yearFilter))return false;}
      if(!_matchesGenre(genreFilter,r.media_type,r.genre_ids))return false;
      return true;
    });
    if(sortFilter){
      rows.sort(function(a,b){
        var dateOf=function(r){return(r.media_type==='movie'?r.release_date:r.first_air_date)||'';};
        if(sortFilter==='vote_average.desc')return(b.vote_average||0)-(a.vote_average||0);
        if(sortFilter==='primary_release_date.desc')return dateOf(b).localeCompare(dateOf(a));
        return(b.popularity||0)-(a.popularity||0);
      });
    }
    var list=rows.slice(0,20).map(_normSR);
    return{results:list,page:data.page||1,total_pages:Math.max(1,Math.min(data.total_pages||1,50)),total_results:data.total_results||list.length};
  });
}

function _renderSR(results){
  var wrap=document.getElementById('searchResults');
  if(!results||!results.length){wrap.innerHTML='<div class="search-empty">'+esc(t('search.noResult'))+'</div>';_updateCounter();_updatePager();return;}
  wrap.innerHTML=results.map(function(d){
    var inList=_inList(d.tmdbId);var sel=!!searchState.selected[d.key];
    var poster=d.poster?'<img class="search-poster" src=\"'+IB+'w185'+esc(d.poster)+'\" alt="" loading="lazy" data-hide-broken>':'<div class="search-poster-ph">'+icon(d.type)+'</div>';
    var chk='<button class="search-check'+(sel?' on':'')+'" type="button" aria-label="'+esc(t('search.select',{title:d.title}))+'" aria-pressed="'+(sel?'true':'false')+'" '+(inList?'disabled':'')+' '+uiAct('toggleSCard',[d.key])+'><span class="search-check-box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg></span></button>';
    var stag=inList?'<div class="search-status-tag off">'+esc(t('search.inList'))+'</div>':'<div class="search-status-tag ok">'+esc(t('search.addable'))+'</div>';
    return '<article class="search-card'+(sel?' selected':'')+(inList?' disabled':'')+'" data-key="'+esc(d.key)+'" tabindex="0">'+chk+'<div class="search-poster-wrap">'+poster+'</div><div class="search-body"><div class="search-title">'+esc(d.title)+'</div><div class="search-meta">'+tbadge(d.type)+'<span class="search-year">'+esc(d.year)+'</span>'+(d.score?'<span class="badge bec">★ '+esc(String(d.score))+'</span>':'')+'</div><div class="search-overview">'+esc(d.overview||t('plex.noOverview'))+'</div>'+stag+'</div></article>';
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
  if(added){render();loadRecos();sfx('add');toast(tn('search.added',added));}
  else{toast(t('search.noneAddable'),'nfo');}
  _renderSR(searchState.results);
}

function _runSearch(query,page){
  var q=(query||'').trim();searchState.query=q;searchState.page=page||1;searchState.token++;var tok=searchState.token;
  var sfGenre=document.getElementById('sfGenre');
  var genreOnly=q.length<2&&sfGenre&&sfGenre.value;
  if(q.length<2&&!genreOnly){searchState.results=[];searchState.totalPages=1;_stateText(t('search.min2'));_renderSR([]);return;}
  _setSearchLoad(true);_stateText(genreOnly?t('search.browsing'):t('search.searchingFor',{q:q}));
  _searchTMDB(q,searchState.page).then(function(res){
    if(tok!==searchState.token)return;
    searchState.results=res.results||[];searchState.page=res.page||1;searchState.totalPages=res.total_pages||1;
    _stateText(tn('search.results',(res.total_results||searchState.results.length),{page:searchState.page}));
    _renderSR(searchState.results);
  }).catch(function(e){
    if(tok!==searchState.token)return;
    searchState.results=[];_renderSR([]);
    if(e&&e.code==='AUTH_REQUIRED'){_stateText(t('search.err.login'));return;}
    if(e&&e.code==='FORBIDDEN'){_stateText(t('api.msg.forbidden'));return;}
    if(e&&e.code==='UNCONFIRMED'){_stateText(t('search.err.unconfirmed'));return;}
    if(e&&e.code==='QUOTA'){_stateText(t('search.err.quota'));return;}
    _stateText(t('search.err.network'));sfx('err');toast(t('search.err.tmdb'),'err');
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
  if(hBar)hBar.addEventListener('click',function(e){if(e.target===hIn||searchState.open)return;sfx('open');openSearchModal(hIn.value.trim());});
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
    /* « / » tapé dans un champ (ex. un mot de passe) reste un caractère ; rien sur la page d'accueil */
    if(!open&&e.key==='/'&&e.target&&/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName||''))return;
    if(!open&&document.documentElement.classList.contains('lp-guest'))return;
    if(!open&&(e.key==='/'||(e.key==='k'&&(e.ctrlKey||e.metaKey)))){e.preventDefault();sfx('open');openSearchModal(document.getElementById('tmdbSearchInput').value.trim());}
  });
}

// ===== DÉTECTION OFFLINE / ONLINE =====
window.addEventListener('online', function() {
  console.log('[' + new Date().toLocaleTimeString(LOCALE) + '] ✓ App en ligne');
  if (typeof loadRecos === 'function') loadRecos();
  if (authProfileId) syncNow();
  else updateSyncStatusUI(authUser?'synced':'anon');
});
window.addEventListener('offline', function() {
  console.warn('[' + new Date().toLocaleTimeString(LOCALE) + '] ⚠ App HORS LIGNE — TMDB inaccessible');
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
  el.textContent = t('footer.stats', {n: fmtNum(items.length), done: fmtNum(termine), watching: fmtNum(encours), towatch: fmtNum(avoir)});
}

