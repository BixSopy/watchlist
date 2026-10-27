/* MODULE: Accueil — carrousel 3D « En cours » (Cover Flow) et onglets en pilule.
   Le carrousel affiche les titres « en cours » du bandeau (_heroItems, js/05-render.js) ; l'affiche
   active est au centre, de face, les autres inclinées en perspective. Seules les affiches à ±CF_WIN
   de l'active existent dans le DOM (une liste de 200 titres ne crée pas 200 calques 3D).
   Navigation : molette (verticale ou horizontale, un pas toutes les CF_WHEEL_MS), glisser à la souris
   ou au doigt, flèches du clavier, boutons ‹ ›, clic sur une affiche. Toute action manuelle arrête le
   balayage automatique (_heroManual). Mouvement réduit : rangée à plat, sans rotation, glissé court (~250 ms) au lieu d'une coupure.
   Les affiches sont gardées par data-id et seules leurs transformations changent (transitions CSS). */
var CF_WIN=5,CF_WHEEL_MS=180;
function _cfReduced(){try{return window.matchMedia('(prefers-reduced-motion: reduce)').matches;}catch(e){return false;}}
function _cfSmall(){return window.innerWidth<=768;}
function _cfEpLabel(item){return(item.type!=='film'&&item.saison&&item.episode)?('S'+pad(item.saison)+' · E'+pad(item.episode)):'';}
function _cfPct(item){var p=(typeof _seasonProgressPct==='function')?_seasonProgressPct(item):null;return p==null?0:p;}
/* Progression inconnue tant que le nombre d'épisodes de la saison n'est pas connu : on le demande au
   proxy TMDB (même URL que le fond du bandeau, donc même cache), on le garde sur le titre (IndexedDB,
   champ local déjà existant, aucune migration) et, en attendant, la barre est « indéterminée ». */
function needsSeasonCount(item){
  return !!(item&&item.type!=='film'&&item.status==='encours'&&item.tmdbId&&item.saison&&item.episode&&
    !(item.seasonEpCount>0&&item.seasonEpCountSeason===item.saison));
}
function seasonCountFrom(det,saison){
  var ss=(det&&det.seasons)||[];
  for(var i=0;i<ss.length;i++)if(ss[i].season_number===saison&&ss[i].episode_count>0)return ss[i].episode_count;
  return 0;
}
var _scPending=Object.create(null),_scFailed=Object.create(null);
function ensureSeasonCount(item){
  if(!needsSeasonCount(item)||_scPending[item.id]||_scFailed[item.id+':'+item.saison]||typeof tf!=='function')return;
  _scPending[item.id]=1;
  var kind=item.tmdbType||'tv';
  tf(TB+'/'+kind+'/'+item.tmdbId+'?language='+TMDB_LANG+'&append_to_response=images').then(function(det){
    delete _scPending[item.id];
    var n=seasonCountFrom(det,item.saison);
    if(!n){_scFailed[item.id+':'+item.saison]=1;_cfRefreshProgress(item);return;}
    item.seasonEpCount=n;item.seasonEpCountSeason=item.saison;
    if(typeof persistSuiviItem==='function')persistSuiviItem(item);
    _cfRefreshProgress(item);
  }).catch(function(){delete _scPending[item.id];_scFailed[item.id+':'+item.saison]=1;_cfRefreshProgress(item);});
}
function _cfProgUnknown(item){return item&&item.type!=='film'&&_seasonProgressPct(item)==null;}
/* 'ok' (vrai %), 'wait' (demande en cours ou à venir : barre indéterminée), 'none' (introuvable, ou film : barre masquée) */
function _cfProgState(item){
  if(!item||item.type==='film')return 'none';
  if(!_cfProgUnknown(item))return 'ok';
  return needsSeasonCount(item)&&!_scFailed[item.id+':'+item.saison]&&typeof tf==='function'?'wait':'none';
}
function _cfPgCls(item){var st=_cfProgState(item);return st==='ok'?'':' '+(st==='wait'?'unk':'none');}
function _cfRefreshProgress(item){
  var c=document.querySelector('#cfRing .cf-card[data-id="'+(window.CSS&&CSS.escape?CSS.escape(String(item.id)):item.id)+'"]');
  if(c){var pg=c.querySelector('.cf-pg');if(pg){var st=_cfProgState(item);pg.classList.toggle('unk',st==='wait');pg.classList.toggle('none',st==='none');pg.firstChild.style.width=_cfPct(item)+'%';}}
  var cur=_heroItems[_heroIdx];if(cur&&cur.id===item.id)_cfBarSet(item);
}
function _cfBarSet(item){
  var bar=document.getElementById('cfBar');if(!bar)return;
  var st=_cfProgState(item),wrap=bar.parentNode;
  if(wrap){wrap.classList.toggle('unk',st==='wait');wrap.classList.toggle('none',st==='none');}
  bar.style.width=st==='ok'?_cfPct(item)+'%':'';
}
function _cfCard(item,i){
  var b=document.createElement('button');
  b.type='button';b.className='cf-card';b.setAttribute('data-i',i);b.setAttribute('data-id',item.id);
  b.setAttribute('aria-label',item.title);b.tabIndex=-1;
  var ep=_cfEpLabel(item);
  b.innerHTML=(item.poster?'<img src="'+esc(IB+'w342'+item.poster)+'" alt="" loading="lazy" decoding="async">':'<span class="cf-ph">'+icon(item.type)+'</span>')+
    (ep?'<span class="cf-ep">'+esc(ep)+'</span>':'')+'<span class="cf-pg'+_cfPgCls(item)+'"><i style="width:'+_cfPct(item)+'%"></i></span>'+
    /* reflet : élément créé une fois avec l'affiche, il suit la transformation (pas de -webkit-box-reflect recalculé à chaque pas) */
    (item.poster?'<span class="cf-refl" aria-hidden="true"><img src="'+esc(IB+'w342'+item.poster)+'" alt="" loading="lazy" decoding="async"></span>':'');
  b.style.opacity='0';
  return b;
}
var _cfIdx=0;
/* Repère de position sous le carrousel : point bleu (gauche = plus récent, droite = plus ancien).  Aucun texte. */
function cfPosPct(idx,n){return n>1?Math.round(idx/(n-1)*1000)/10:0;}
function _cfPosSet(idx,n){
  var dot=document.getElementById('cfPosDot');if(!dot)return;
  dot.style.left=cfPosPct(idx,n)+'%';
}
function renderContinue(items,idx){
  var band=document.getElementById('heroBand'),ring=document.getElementById('cfRing');
  if(!band||!ring)return;
  items=items||[];
  if(!items.length){ring.innerHTML='';return;}
  _cfIdx=idx;
  band.classList.toggle('single',items.length<2);
  var keep=Object.create(null);
  for(var i=Math.max(0,idx-CF_WIN);i<=Math.min(items.length-1,idx+CF_WIN);i++)keep[items[i].id]=i;
  /* retire les affiches sorties de la fenêtre, ajoute les nouvelles */
  Array.prototype.slice.call(ring.children).forEach(function(c){var id=c.getAttribute('data-id');if(!(id in keep))c.remove();});
  var have=Object.create(null);Array.prototype.forEach.call(ring.children,function(c){have[c.getAttribute('data-id')]=c;});
  var fresh=[];
  Object.keys(keep).forEach(function(id){
    var i=keep[id],c=have[id];
    if(!c){c=_cfCard(items[i],i);ring.appendChild(c);fresh.push(c);}
    else c.setAttribute('data-i',i);
  });
  if(fresh.length)void ring.offsetWidth;/* les nouvelles partent d'opacité 0 */
  var small=_cfSmall(),flat=_cfReduced();
  Array.prototype.forEach.call(ring.children,function(c){
    var d=+c.getAttribute('data-i')-idx,a=Math.abs(d),s=d>0?1:d<0?-1:0,tr,o=1;
    if(flat){var fg=small?120:170;tr='translateX('+(d*fg)+'px) scale('+(d?.86:1)+')';if(a>(small?2:3))o=0;}
    else{
      var gap=small?52:96,base=small?78:150;
      tr=d===0?'translateZ(60px)':'translateX('+(s*base+d*gap)+'px) translateZ(-140px) rotateY('+(-s*48)+'deg)';
      if(a>(small?3:CF_WIN))o=0;
    }
    c.style.transform=tr;c.style.opacity=String(o);c.style.zIndex=String(100-a);
    c.style.filter=d?'brightness('+(1-.12*a).toFixed(2)+')':'none';
    c.classList.toggle('on',d===0);
    c.setAttribute('aria-hidden',d?'true':'false');
    c.style.pointerEvents=o?'':'none';
  });
  _cfPosSet(idx,items.length);
  var ctr=document.getElementById('contCtr');if(ctr)ctr.textContent=(idx+1)+' / '+items.length;
  /* nombres d'épisodes manquants : titre actif d'abord, puis ses voisins visibles */
  for(var k=0;k<=CF_WIN;k++){ensureSeasonCount(items[idx+k]);if(k)ensureSeasonCount(items[idx-k]);}
  _cfBarSet(items[idx]);
  _cfAmbient(items[idx]);
  var pv=band.querySelector('.cf-nav.prev'),nx=band.querySelector('.cf-nav.next');
  if(pv)pv.disabled=idx<=0;if(nx)nx.disabled=idx>=items.length-1;
  _cfInit(document.getElementById('cfStage'));
}
/* Va au titre i (borné), arrête le balayage automatique */
/* Repère visible seulement pendant la navigation manuelle, masqué ~1,2 s après */
var _cfPosT=null;
function cfPosShow(){var p=document.getElementById('cfPos');if(!p)return;p.classList.add('on');clearTimeout(_cfPosT);_cfPosT=setTimeout(function(){p.classList.remove('on');},1200);}
function cfGo(i){cfPosShow();
  if(!_heroItems.length)return;
  i=Math.max(0,Math.min(_heroItems.length-1,i));
  _heroManual=true;
  if(i===_heroIdx){clearTimeout(_heroTimer);return;}
  if(typeof sfx==='function')sfx('click');
  var info=document.getElementById('cfInfo');
  if(info&&!_cfReduced()){info.classList.add('sw');setTimeout(function(){info.classList.remove('sw');},160);}
  _heroGoTo(i);
}
function contScroll(dir){cfGo(_heroIdx+dir);}
function _cfInit(st){
  if(!st||st._init)return;st._init=1;
  /* Molette : un pas par CF_WHEEL_MS. Le défilement de la page n'est bloqué que pendant que le
     pointeur est sur le carrousel, et pas aux extrémités (la page reprend la main). */
  var last=0;
  st.addEventListener('wheel',function(e){
    if(e.ctrlKey)return;/* zoom au pavé tactile */
    var horiz=Math.abs(e.deltaX)>Math.abs(e.deltaY),v=horiz?e.deltaX:e.deltaY;
    if(Math.abs(v)<4)return;
    var dir=v>0?1:-1,n=_heroItems.length;
    if(!horiz&&((dir<0&&_heroIdx<=0)||(dir>0&&_heroIdx>=n-1)))return;
    e.preventDefault();
    var now=Date.now();if(now-last<CF_WHEEL_MS)return;last=now;
    cfGo(_heroIdx+dir);
  },{passive:false});
  st.addEventListener('keydown',function(e){
    var k=e.key;
    if(k==='ArrowRight'){cfGo(_heroIdx+1);e.preventDefault();}
    else if(k==='ArrowLeft'){cfGo(_heroIdx-1);e.preventDefault();}
    else if(k==='Home'){cfGo(0);e.preventDefault();}
    else if(k==='End'){cfGo(_heroItems.length-1);e.preventDefault();}
    else if(k==='Enter'&&e.target===st){var it=_heroItems[_heroIdx];if(it){sfx('open');openPlex(it.id);}e.preventDefault();}
  });
  /* Glisser (souris, doigt, stylet) : un pas tous les 80 px (50 px sur téléphone) */
  var x0=null,moved=false,ring=document.getElementById('cfRing');
  st.addEventListener('pointerdown',function(e){if(e.target.closest('.cf-nav')||(e.pointerType==='mouse'&&e.button!==0))return;x0=e.clientX;moved=false;});
  window.addEventListener('pointermove',function(e){
    if(x0===null)return;var dx=e.clientX-x0,step=_cfSmall()?50:80;
    if(Math.abs(dx)>6){moved=true;st.classList.add('drag');}
    if(Math.abs(dx)>step){var j=_heroIdx-(dx>0?1:-1);if(j>=0&&j<_heroItems.length){cfGo(j);x0+=dx>0?step:-step;dx=e.clientX-x0;}}
    /* la rangée suit le pointeur en temps réel (amortie aux extrémités), puis se recale au relâchement */
    if(moved&&ring)ring.style.transform='translateX('+(dx*.6).toFixed(1)+'px)';
  });
  function up(){if(x0===null)return;x0=null;st.classList.remove('drag');if(ring)ring.style.transform='';if(moved)setTimeout(function(){moved=false;},0);}
  window.addEventListener('pointerup',up);window.addEventListener('pointercancel',up);
  /* Clic sur une affiche : la met au centre (ou ouvre la fiche si c'est déjà l'active) */
  st.addEventListener('click',function(e){
    var c=e.target.closest('.cf-card');if(!c)return;
    if(moved){e.preventDefault();e.stopPropagation();return;}
    var i=+c.getAttribute('data-i');
    if(i===_heroIdx){_heroManual=true;clearTimeout(_heroTimer);var it=_heroItems[i];if(it){sfx('open');openPlex(it.id);}}
    else cfGo(i);
  });
}
/* Surlignage glissant de la pilule d'onglets */
function segMove(){
  var seg=document.getElementById('tabSeg'),hl=document.getElementById('segHl');if(!seg||!hl)return;
  var on=seg.querySelector('.ntab.on');
  if(!on||!on.offsetWidth){hl.classList.remove('on');return;}
  hl.style.width=on.offsetWidth+'px';hl.style.transform='translateX('+on.offsetLeft+'px)';hl.classList.add('on');
}
(function(){
  var seg=document.getElementById('tabSeg');if(!seg)return;
  if(typeof ResizeObserver==='function')new ResizeObserver(segMove).observe(seg);
  window.addEventListener('resize',segMove);
  if(document.fonts&&document.fonts.ready)document.fonts.ready.then(segMove);
})();
/* « Tout voir » : filtre « En cours » de la liste, puis descend jusqu'à la grille */
function contSeeAll(){
  var b=document.querySelector('#stabs .stab[data-s="encours"]');if(b)b.click();
  var c=document.getElementById('content');if(c&&c.scrollIntoView)c.scrollIntoView({behavior:'smooth',block:'start'});
}
/* Compteurs des onglets Tout / Films / Séries / Anime, calculés sur la vraie liste et sur le filtre de
   statut choisi (Tous / À voir / En cours / Terminé) : mis à jour à chaque render() */
function tabCounts(list,stat){
  var c={all:0,film:0,serie:0,anime:0};
  (list||[]).forEach(function(i){if(i.deleted)return;if(stat&&stat!=='all'&&i.status!==stat)return;c.all++;if(c[i.type]!=null)c[i.type]++;});
  return c;
}
function updateTabCounts(){
  if(typeof memDB==='undefined')return;
  var c=tabCounts(memDB,typeof activeStat==='undefined'?'all':activeStat);
  Object.keys(c).forEach(function(k){
    var b=document.querySelector('.ntab[data-tab="'+k+'"]');if(!b)return;
    var em=b.querySelector('.ntab-cnt');
    if(!em){em=document.createElement('em');em.className='ntab-cnt';b.appendChild(em);}
    em.textContent=fmtNum(c[k]);
  });
  segMove();
}
/* ===== Accueil « Cinéma » (P3) : couleur d'ambiance, « À suivre » et « Cette semaine » =====
   Couleur d'ambiance : moyenne des pixels d'une miniature (w92) de l'affiche active, lue dans un canvas
   (image.tmdb.org répond avec Access-Control-Allow-Origin: *). Rien n'est envoyé nulle part ; en cas
   d'échec, on garde l'accent. Les couleurs sont gardées en mémoire par affiche. */
var _ambCache=Object.create(null),_ambCur='';
function ambientFromPixels(data){
  /* teinte dominante : 12 secteurs de teinte pondérés par la saturation, puis moyenne du secteur gagnant
     (une simple moyenne mélange les couleurs et donne du gris) */
  var bins=[],best=-1,bw=0;
  for(var i=0;i<data.length;i+=4){
    var R=data[i],G=data[i+1],B=data[i+2],mx=Math.max(R,G,B),mn=Math.min(R,G,B),c=mx-mn;
    if(data[i+3]<128||mx<28||mn>235||c<18)continue;/* transparent, noir, blanc, gris */
    var h=mx===R?((G-B)/c+6)%6:mx===G?(B-R)/c+2:(R-G)/c+4,k=Math.floor(h*2)%12,w=c/255;
    var o=bins[k]||(bins[k]={r:0,g:0,b:0,w:0});o.r+=R*w;o.g+=G*w;o.b+=B*w;o.w+=w;
    if(o.w>bw){bw=o.w;best=k;}
  }
  if(best<0)return null;
  var o=bins[best],r=o.r/o.w,g=o.g/o.w,b=o.b/o.w;
  /* remonte la luminosité pour un halo visible sur fond noir, sans brûler */
  var m=Math.max(r,g,b,1),f=Math.min(2.6,200/m);
  return [Math.round(Math.min(255,r*f)),Math.round(Math.min(255,g*f)),Math.round(Math.min(255,b*f))];
}
function _ambSet(rgb){
  var band=document.getElementById('heroBand');if(!band)return;
  var v=rgb?rgb.join(','):'';
  if(v===_ambCur)return;_ambCur=v;
  if(v)band.style.setProperty('--amb',v);else band.style.removeProperty('--amb');
}
function _cfAmbient(item){
  if(!item||!item.poster){_ambSet(null);return;}
  var key=item.poster;
  if(key in _ambCache){_ambSet(_ambCache[key]);return;}
  var img=new Image();img.crossOrigin='anonymous';img.decoding='async';
  img.onload=function(){
    var rgb=null;
    try{var c=document.createElement('canvas');c.width=24;c.height=36;var x=c.getContext('2d');x.drawImage(img,0,0,24,36);rgb=ambientFromPixels(x.getImageData(0,0,24,36).data);}catch(e){rgb=null;}
    _ambCache[key]=rgb;
    var cur=_heroItems[_heroIdx];if(cur&&cur.poster===key)_ambSet(rgb);
  };
  img.onerror=function(){_ambCache[key]=null;};
  img.src=IB+'w92'+item.poster;
}
/* Épisode suivant affiché dans « À suivre » (le pointeur actuel = dernier épisode vu) */
function nextEpLabel(item){
  if(!item||item.type==='film')return '';
  var s=item.saison||1,e=(item.episode||0)+1;
  if(item.seasonEpCount&&item.seasonEpCountSeason===s&&e>item.seasonEpCount){s++;e=1;}
  return 'S'+pad(s)+' · E'+pad(e);
}
/* Sorties des 7 prochains jours, tirées du calendrier (js/26-calendar.js, cache local de 12 h) */
function weekEvents(evs,today,addDays){
  var end=addDays(today,7);
  return (evs||[]).filter(function(e){return e.date>=today&&e.date<end;})
    .sort(function(a,b){return a.date<b.date?-1:a.date>b.date?1:0;});
}
var HOME_NEXT_MAX=4,HOME_WEEK_MAX=4;
function _homeDay(date){
  try{var d=new Date(date+'T12:00:00');return{wd:new Intl.DateTimeFormat(LOCALE,{weekday:'short'}).format(d).replace('.',''),d:d.getDate()};}catch(e){return{wd:'',d:date.slice(8)};}
}
function _homeThumb(p,cls){return '<span class="'+cls+'"'+(p?' style="background-image:url(\''+esc(IB+'w185'+p)+'\')"':'')+' aria-hidden="true"></span>';}
function renderHomeNext(){
  var sec=document.getElementById('homeNext');if(!sec)return;
  var cpt=typeof compactOn!=='undefined'&&!!compactOn,band=document.getElementById('heroBand');
  if(band)band.classList.toggle('cpt',cpt);sec.classList.toggle('cpt',cpt);
  var items=(_heroItems||[]).slice(0,HOME_NEXT_MAX);
  if(!items.length){sec.hidden=true;return;}
  sec.hidden=false;
  var up=items.map(function(it,i){
    var nx=nextEpLabel(it),sub=nx?t('home.nextEp',{ep:nx}):t('home.filmInProgress');
    var btn=it.type!=='film'?'<button type="button" class="hn-ck" title="'+esc(t('card.nextEp'))+'" aria-label="'+esc(t('card.nextEp')+' : '+it.title)+'"'+uiAct('quickNextEp',[it.id])+'><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7"/></svg></button>':'';
    return '<div class="hn-row" style="--i:'+i+'" role="button" tabindex="0"'+uiAct('openPlexQuiet',[it.id])+'>'+_homeThumb(it.poster,'hn-th')+
      '<span class="hn-tx"><b>'+esc(it.title)+'</b><i>'+esc(sub)+'</i></span>'+btn+'</div>';
  }).join('');
  var wk=[],cal=window.calWeek?window.calWeek():null;
  if(cal&&cal.events)wk=cal.events.slice(0,HOME_WEEK_MAX);
  var week=wk.length?wk.map(function(e,i){var d=_homeDay(e.date),code=e.kind==='film'?(e.label||''):(e.s!=null?'S'+pad(e.s)+' · E'+pad(e.e):'');
      return '<div class="hn-day" style="--i:'+i+'" role="button" tabindex="0"'+uiAct('openPlexQuiet',[e.itemId])+'><span class="hn-dd"><em>'+esc(d.wd)+'</em><b>'+d.d+'</b></span>'+_homeThumb(e.poster,'hn-dp')+
        '<span class="hn-tx"><b>'+esc(e.title)+'</b><i>'+esc(code)+'</i></span></div>';}).join('')
    :'<div class="hn-empty">'+esc(cal&&cal.loading?t('common.loading'):t('home.weekEmpty'))+'</div>';
  sec.innerHTML='<section class="hn-col"><h2 class="hn-h">'+esc(t('home.upNext'))+'</h2><div class="hn-list">'+up+'</div></section>'+
    '<section class="hn-col"><h2 class="hn-h">'+esc(t('home.thisWeek'))+'<button type="button" class="hn-more"'+uiAct('homeOpenCal')+'>'+esc(t('cal.tab'))+' ›</button></h2><div class="hn-list">'+week+'</div></section>';
}
/* Entrée / Espace sur une ligne « À suivre » ou « Cette semaine » = clic */
document.addEventListener('keydown',function(e){
  if((e.key==='Enter'||e.key===' ')&&e.target&&e.target.matches&&e.target.matches('.hn-row,.hn-day')){e.preventDefault();e.target.click();}
});
if(typeof module!=='undefined')module.exports={renderContinue:renderContinue,updateTabCounts:updateTabCounts,tabCounts:tabCounts,ambientFromPixels:ambientFromPixels,needsSeasonCount:needsSeasonCount,seasonCountFrom:seasonCountFrom,nextEpLabel:nextEpLabel,weekEvents:weekEvents};
/* Tiroir Suivi : Entrée / Espace l'ouvrent aussi au clavier */
(function(){var h=document.querySelector('#suiviWrap .suivi-hdr');if(!h)return;h.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();h.click();}});})();
