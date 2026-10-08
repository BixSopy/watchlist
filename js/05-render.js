/* MODULE: Rendu principal de la grille (cartes, sections par statut, bandeau hero). */
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
  var po=item.poster?'<img class="card-poster" src=\"'+IB+'w342'+esc(item.poster)+'\" loading="lazy" alt="" data-hide-broken>':'';
  var ph='<div class="card-ph" '+(item.poster?'style="display:none"':'')+'>'+icon(item.type)+'</div>';
  var ep=(item.type!='film'&&item.saison&&item.episode)?'<div class="cep">S'+pad(item.saison)+' E'+pad(item.episode)+'</div>':'';
  var sc=item.tmdbScore?'<div class="crating"><svg viewBox="0 0 24 24"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" fill="currentColor"/></svg>'+parseFloat(item.tmdbScore).toFixed(1)+'</div>':'';
  var mr=item.myRating?'<div class="cmyr">'+item.myRating+'/10</div>':'';
  var prog='';
  if(item.status=='encours'&&item.totalEp&&item.totalEp>0&&item.episode){var pct=Math.min(100,Math.round((item.episode/item.totalEp)*100));prog='<div class="cprog"><div class="cprog-bar"><div class="cprog-fill" style="width:'+pct+'%"></div></div><div class="cprog-lbl">'+item.episode+'/'+item.totalEp+' ep ('+pct+'%)</div></div>';}
  var newep=item.hasNewEp?'<div class="card-newep">'+esc(t('card.newEp'))+'</div>':'';
  var todof=(item.status==='todo'||item.needsConfig)?'<div class="card-todo-flag" title="'+esc(t('status.todo'))+'"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg></div>':'';
  var id=item.id;var delay=idx*0.02;
  var nextBtn=(item.status=='encours'&&item.type!='film')?'<div class="ibtn"'+uiAct('quickNextEp',[id])+' title="'+esc(t('card.nextEp'))+'"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12h14M13 6l6 6-6 6"/></svg></div>':'';
  return '<div class="card" '+(arguments[2]||'')+' style="animation-delay:'+delay+'s" data-sfx-hover'+uiAct('openPlex',[id])+'>'+newep+todof+po+ph+'<div class="cact">'+nextBtn+'<div class="ibtn"'+uiAct('editEntry',[id])+' title="'+esc(t('common.edit'))+'"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></div><div class="ibtn del"'+uiAct('delEntry',[id])+' title="'+esc(t('common.delete'))+'"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></div></div><div class="card-body"><div class="card-title">'+esc(item.title)+'</div><div class="card-meta">'+tbadge(item.type)+sbadge(item.status)+'</div><div style="display:flex;align-items:center;gap:4px">'+sc+mr+'</div>'+ep+'</div>'+prog+'</div>';
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
  else if(btn)btn.textContent=tn('sec.loadMore',left);
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
  if(rem>0)h+='<div class="load-more-wrap"><button class="load-more-btn"'+uiAct('loadMoreSec',[secId])+'>'+esc(tn('sec.loadMore',rem))+'</button><span class="load-more-count">'+esc(tn('sec.total',blocks.length))+'</span></div>';
  return h+'</div>';
}
/* Hero cinematique : met en avant les titres "en cours" de l'onglet actif (balayage
   automatique s'il y en a plusieurs, comme un carrousel). Masque s'il n'y en a aucun
   pour cet onglet. Le fond (backdrop TMDB) n'est refetch que si le titre en avant
   change — pas a chaque render(). */
var _heroItemId=null,_heroItems=[],_heroIdx=0,_heroTimer=null;
function _heroCandidates(){
  var tab=activeTab;
  return memDB.filter(function(i){
    if(i.deleted||i.status!=='encours'||!i.tmdbId)return false;
    if(tab==='film'||tab==='serie'||tab==='anime')return i.type===tab;
    return true;/* 'all', 'discover' et 'detectes' : toutes les series/anime/films en cours */
  }).sort(function(a,b){return(b.updatedAtLocal||b.addedAt||0)-(a.updatedAtLocal||a.addedAt||0);});
}
function renderHero(){
  var band=document.getElementById('heroBand');
  if(!band)return;
  _heroItems=_heroCandidates();
  clearTimeout(_heroTimer);
  if(!_heroItems.length){band.classList.remove('on');_heroItemId=null;document.getElementById('heroDots').innerHTML='';return;}
  if(_heroIdx>=_heroItems.length)_heroIdx=0;
  band.classList.add('on');
  _showHeroItem(_heroIdx);
  _scheduleHeroRotate();
}
/* Pause au survol vérifiée en temps réel via :hover à chaque tick, plutôt qu'un flag
   figé par mouseenter/mouseleave : un mouseleave qui ne se déclenche jamais (curseur
   immobile pendant qu'une modale recouvre le bandeau, ex. clic sur "Reprendre") bloquait
   sinon le balayage indéfiniment même une fois le curseur réellement sorti.
   Zone de pause volontairement restreinte au bloc titre/boutons (.hero-band-content),
   pas tout le bandeau (320px de haut sur toute la largeur) : sinon un curseur simplement
   posé dans cette grande zone — très probable juste sous la barre de recherche/les onglets —
   suspendait le balayage en permanence sans qu'on ait l'impression de "survoler" quoi que ce soit. */
function _scheduleHeroRotate(){
  clearTimeout(_heroTimer);
  if(_heroItems.length<2)return;
  _heroTimer=setTimeout(function tick(){
    var content=document.querySelector('#heroBand .hero-band-content');
    if(content&&content.matches(':hover')){_heroTimer=setTimeout(tick,1000);return;}
    _heroIdx=(_heroIdx+1)%_heroItems.length;
    _showHeroItem(_heroIdx);
    _scheduleHeroRotate();
  },7000);
}
function _heroGoTo(i){_heroIdx=i;_showHeroItem(i);_scheduleHeroRotate();}
function _showHeroItem(idx){
  var item=_heroItems[idx];if(!item)return;
  document.getElementById('heroTitle').textContent=item.title;
  var typeLbl=t('type.'+(item.type==='film'||item.type==='anime'?item.type:'serie'));
  var epT=(item.saison&&item.episode)?('S'+pad(item.saison)+' E'+pad(item.episode)):'';
  document.getElementById('heroMeta').innerHTML=esc(typeLbl)+(epT?' &bull; '+esc(epT):'')+(item.tmdbScore?' &bull; <span class="hero-score">&#9733; '+esc(String(item.tmdbScore))+'</span>':'');
  document.getElementById('heroBtnPlay').onclick=function(){sfx('open');openPlex(item.id);};
  document.getElementById('heroBtnInfo').onclick=function(){sfx('open');openPlex(item.id);};
  var dots=document.getElementById('heroDots');
  dots.innerHTML=_heroItems.length>1?_heroItems.map(function(_,i){return '<button class="hero-dot'+(i===idx?' on':'')+'" '+uiAct('heroGoTo',[i])+' aria-label="'+esc(t('hero.dot',{n:i+1}))+'"></button>';}).join(''):'';
  if(_heroItemId===item.id)return;
  _heroItemId=item.id;
  var bg=document.getElementById('heroBg');
  bg.classList.remove('loaded');
  var kind=item.tmdbType||(item.type==='film'?'movie':'tv');
  tf(TB+'/'+kind+'/'+item.tmdbId+'?language='+TMDB_LANG+'&append_to_response=images').then(function(det){
    if(_heroItemId!==item.id)return;
    var imgs=(det.images&&det.images.backdrops)||[];
    var path=imgs.length?imgs[0].file_path:(det.backdrop_path||null);
    if(path){bg.style.backgroundImage='url("'+IB+'w1280'+path+'")';bg.classList.add('loaded');}
  }).catch(function(){});
}

function render(){
  renderHero();
  var total0=memDB.filter(function(i){return !i.deleted}).length,ec0=memDB.filter(function(i){return i.status=='encours'&&!i.deleted}).length,te0=memDB.filter(function(i){return i.status=='termine'&&!i.deleted}).length;
  document.getElementById('hstats').innerHTML='<div class="pill">'+tn('pill.titles',total0,{n:'<b>'+fmtNum(total0)+'</b>'})+'</div><div class="pill">'+esc(t('status.encours'))+' <b>'+fmtNum(ec0)+'</b></div><div class="pill">'+esc(t('sec.termines'))+' <b>'+fmtNum(te0)+'</b></div>';
  if(activeTab==='discover'||activeTab==='detectes'){
    document.getElementById('mc').innerHTML='';
    if(typeof updateStatsFooter==='function')updateStatsFooter();
    return;
  }
  sortBy=document.getElementById('sortSel').value;
  var tab=activeTab,stat=activeStat,q=fq;
  var items=getItems(tab,stat,q);
  var html='';

  if(tab=='all'){
    var ec=items.filter(function(i){return i.status=='encours'});
    if(ec.length){
      html+='<div class="sec sec-status-encours"><div class="sec-hd"><div class="sec-title">'+esc(t('status.encours'))+'</div><div class="sec-count">'+ec.length+'</div></div><div class="ec-strip">';
      ec.forEach(function(item){
        var po=item.poster?'<img class="ec-poster" src=\"'+IB+'w185'+esc(item.poster)+'\" alt="" loading="lazy" data-hide-broken>':'';
        var ph='<div class="ec-poster-ph" '+(item.poster?'style="display:none"':'')+'>'+icon(item.type)+'</div>';
        var epT=(item.saison&&item.episode)?'S'+pad(item.saison)+' E'+pad(item.episode):t('status.encours');
        var pct=0;if(item.totalEp&&item.totalEp>0&&item.episode)pct=Math.min(100,Math.round((item.episode/item.totalEp)*100));
        var pb=item.totalEp?'<div class="pbar"><div class="pbar-fill" style="width:'+pct+'%"></div></div>':'';
        var nextBtn=item.type!='film'?'<button class="ec-next" title="'+esc(t('card.nextEp'))+'" '+uiAct('quickNextEp',[item.id])+'><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>':'';
        html+='<div class="ec-card" data-sfx-hover'+uiAct('openPlex',[item.id])+'>'+po+ph+nextBtn+'<div class="ec-body"><div class="ec-title">'+esc(item.title)+'</div><div class="ec-ep">'+epT+'</div>'+pb+'</div></div>';
      });
      html+='</div></div>';
    }
    if(stat=='all'){
      /* "En cours" a déjà sa bande dédiée ci-dessus : on évite de le répéter en grille complète */
      html+=secHtml(esc(t('status.avoir')),items.filter(function(i){return i.status=='avoir'||i.status=='todo'}),'sec-status-avoir');
      html+=secHtml(esc(t('sec.termines')),items.filter(function(i){return i.status=='termine'}),'sec-status-termine');
    }
    else{html+=secHtml(esc(stat=='avoir'?t('status.avoir'):stat=='encours'?t('status.encours'):t('sec.termines')),items,STATUS_SEC_CLASS[stat]);}
  } else {
    var secs=[{s:'encours',l:esc(t('status.encours')),c:'sec-status-encours'},{s:'avoir',l:esc(t('status.avoir')),c:'sec-status-avoir'},{s:'termine',l:esc(t('sec.termines')),c:'sec-status-termine'}];
    secs.forEach(function(sec){
      var si=stat=='all'?items.filter(function(i){return i.status==sec.s}):(sec.s==stat?items:[]);
      if(si.length)html+=secHtml(sec.l,si,sec.c);
    });
  }

  if(!html)html=memDB.length==0?'<div class="empty-state"><div class="empty-state-icon">🎬</div><p>'+esc(t('empty.title'))+'</p><small>'+t('empty.hint',{key:'<strong style="color:var(--accent)">N</strong>'})+'</small></div>':'<div class="empty-state"><div class="empty-state-icon">🔍</div><p>'+esc(t('empty.noResult'))+'</p><small>'+esc(t('empty.noResultHint'))+'</small></div>';
  document.getElementById('mc').innerHTML=html;
  if(typeof updateStatsFooter==='function')updateStatsFooter();
}

