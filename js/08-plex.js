/* MODULE: Fiche détail d'un titre (modal « Plex »), notes croisées OMDb + Kitsu. */
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
  document.getElementById('plexKind').textContent=plexKindLabel(d,null);
  /* Poster */
  var pw=document.getElementById('plexPosterWrap');
  if(d.poster){
    pw.innerHTML='<img class="plex-poster" src=\"'+IB+'w500'+esc(d.poster)+'\" alt="">';
    bgb.src=IB+'w780'+d.poster;bgb.style.display='block';
    /* Ambient sur le hero via proxy — canvas safe */
    applyAmbient(IB+'w342'+d.poster, document.getElementById('plexHero'), 0.22);
  }
  else{pw.innerHTML='<div class="plex-poster-ph">'+icon(d.type=='movie'?'film':'serie')+'</div>';}
  document.getElementById('plexTitle').textContent=d.title||'';
  document.getElementById('plexMeta').innerHTML=d.year?'<span>'+esc(d.year)+'</span>':'';
  document.getElementById('plexBadges').innerHTML='';
  document.getElementById('plexScore').innerHTML=d.score?'<span class="plex-rt-l">TMDB</span><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" style="fill:var(--accent)"/></svg> '+parseFloat(d.score).toFixed(1):'';
  document.getElementById('plexOverview').textContent=d.overview||t('common.loading');
  /* Actions */
  buildPlexActions();
  /* Fetch details */
  if(d.tmdbId){
    tf(TB+'/'+d.type+'/'+d.tmdbId+'?language='+TMDB_LANG+'&append_to_response=credits,images,keywords,watch%2Fproviders,external_ids').then(function(det){fillPlexDetails(det);}).catch(function(){});
  }
  document.getElementById('plexMbk').classList.add('on');
}

var PLEX_ICON_PLAY='<span class="plex-pl" aria-hidden="true"><svg viewBox="0 0 24 24" fill="#fff"><path d="M6 4l14 8-14 8z"/></svg></span>';
var PLEX_ICON_ADD='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
var PLEX_ICON_SHARE='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7M16 6l-4-4-4 4M12 2v13"/></svg>';
function buildPlexActions(){
  var d=plexData;var acts=document.getElementById('plexActs');acts.innerHTML='';
  var inList=d.item||memDB.find(function(i){return i.tmdbId==d.tmdbId});
  if(!(inList&&d.item)){
    var ab=document.createElement('button');ab.type='button';ab.className='btn btn-add-plex';ab.innerHTML=PLEX_ICON_ADD+esc(t('plex.addToListShort'));
    ab.onclick=function(){sfx('click');closePlex();recoAddDirect(d);};acts.appendChild(ab);
  }
  /* Trailer */
  if(d.tmdbId){var tb=document.createElement('button');tb.type='button';tb.className='btn btn-trailer';tb.innerHTML=PLEX_ICON_PLAY+esc(t('plex.trailer'));tb.onclick=function(){sfx('click');getTrailer(d.type,d.tmdbId,null,openYT);};acts.appendChild(tb);}
  if(inList&&d.item){
    var eb=document.createElement('button');eb.type='button';eb.className='btn btn-ghost';eb.textContent=t('common.edit');eb.onclick=function(){sfx('open');closePlex();openEdit(d.item.id);};acts.appendChild(eb);
    /* Supprimer depuis la fiche : sur écran tactile, c'est le seul accès (boutons de carte masqués) */
    var db=document.createElement('button');db.type='button';db.className='btn btn-ghost btn-del-plex';db.textContent=t('common.delete');db.setAttribute('data-click','plexDelete');db.setAttribute('data-args',JSON.stringify([String(d.item.id)]));acts.appendChild(db);
    if(d.item.type!='film'&&d.item.saison&&d.item.episode){
      var pg=document.getElementById('plexProg');pg.style.display='block';
      document.getElementById('plexProgVal').textContent='S'+pad(d.item.saison)+' E'+pad(d.item.episode);
      var pct=0,plbl='';if(d.item.totalEp&&d.item.totalEp>0){pct=Math.min(100,Math.round((d.item.episode/d.item.totalEp)*100));plbl=d.item.episode+'/'+d.item.totalEp+' ep ('+pct+'%)';}
      document.getElementById('plexProgFill').style.width=pct+'%';document.getElementById('plexProgLbl').textContent=plbl;
      document.getElementById('plexNextBtn').style.display=d.item.status=='encours'?'inline-block':'none';
      document.getElementById('plexNextBtn').onclick=nextEpPlex;
    }
  }
  /* Partager : feuille de partage du système, sinon copie du lien */
  if(d.tmdbId){var sb=document.createElement('button');sb.type='button';sb.className='btn btn-ghost btn-icon';sb.innerHTML=PLEX_ICON_SHARE;sb.title=t('plex.share');sb.setAttribute('aria-label',t('plex.share'));sb.onclick=function(){sfx('click');plexShare(d);};acts.appendChild(sb);}
}
/* Lien public TMDB du titre (l'app n'a pas d'URL par titre ; aucun identifiant d'utilisateur dans le lien) */
function plexShareUrl(d){return 'https://www.themoviedb.org/'+(d.type=='movie'?'movie':'tv')+'/'+encodeURIComponent(d.tmdbId);}
function plexShare(d){
  var url=plexShareUrl(d),title=d.title||'';
  function copy(){
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(url).then(function(){toast(t('plex.linkCopied'),'nfo');},function(){toast(t('common.copyFailed'));});}
    else toast(t('common.copyFailed'));
  }
  if(navigator.share){navigator.share({title:title,text:title,url:url}).catch(function(e){if(!e||e.name!=='AbortError')copy();});}
  else copy();
}
/* « Série · Nouveau » : type du titre + « Nouveau » si sorti il y a moins de 12 mois */
function plexIsNew(dateStr,now){
  if(!dateStr)return false;var dt=new Date(String(dateStr).slice(0,10)+'T12:00:00');if(isNaN(dt))return false;
  var n=now||new Date();var lim=new Date(n.getTime());lim.setFullYear(lim.getFullYear()-1);
  return dt<=n&&dt>=lim;
}
function plexKindLabel(d,det){
  var it=d.item;var k=it&&it.type==='anime'?t('type.anime'):(d.type=='movie'?t('type.film'):t('type.serie'));
  var rel=det?(det.release_date||det.first_air_date):null;
  return plexIsNew(rel)?k+' · '+t('plex.new'):k;
}
/* Plateformes : abonnement, avec pub, gratuit (type TMDB), sans doublon */
function plexProviderList(fr){
  var out=[],seen={};
  [['flatrate','plex.prov.flatrate'],['ads','plex.prov.ads'],['free','plex.prov.free']].forEach(function(k){
    (fr[k[0]]||[]).forEach(function(p){if(seen[p.provider_id])return;seen[p.provider_id]=1;out.push({p:p,sub:t(k[1])});});
  });
  return out;
}

function fillPlexDetails(det){
  var d=plexData;if(!det)return;
  /* Backdrop */
  var imgs=(det.images&&det.images.backdrops)||[];
  if(imgs.length){
    var bg=document.getElementById('plexBg');
    bg.src=IB+'w1280'+imgs[0].file_path;
    bg.style.display='block';
    document.getElementById('plexBgBlur').style.display='none';
    /* Ambient depuis backdrop — plus précis que le poster */
    applyAmbient(IB+'w780'+imgs[0].file_path, document.getElementById('plexHero'), 0.18);
  }
  /* Meta */
  document.getElementById('plexKind').textContent=plexKindLabel(d,det);
  var m=[];if(d.year)m.push(d.year);if(det.runtime)m.push(det.runtime+' min');if(det.number_of_seasons)m.push(tn('plex.seasons',det.number_of_seasons));if(det.genres&&det.genres.length)det.genres.slice(0,2).forEach(function(g){m.push(g.name);});
  document.getElementById('plexMeta').innerHTML=m.map(function(x){return '<span>'+esc(x)+'</span>';}).join('');
  document.getElementById('plexOverview').textContent=det.overview||d.overview||t('plex.noOverview');
  /* Stats */
  var st='';
  if(det.vote_average)st+='<div class="p-stat"><div class="p-stat-l">'+esc(t('plex.tmdbScore'))+'</div><div class="p-stat-v gold">'+det.vote_average.toFixed(1)+'</div></div>';
  if(d.item&&d.item.myRating)st+='<div class="p-stat"><div class="p-stat-l">'+esc(t('plex.myRating'))+'</div><div class="p-stat-v">'+d.item.myRating+'<span style="font-size:12px;color:var(--text3)">/10</span></div></div>';
  if(det.number_of_episodes)st+='<div class="p-stat"><div class="p-stat-l">'+esc(t('plex.episodes'))+'</div><div class="p-stat-v">'+det.number_of_episodes+'</div></div>';
  if(det.number_of_seasons)st+='<div class="p-stat"><div class="p-stat-l">'+esc(t('plex.seasonsLbl'))+'</div><div class="p-stat-v">'+det.number_of_seasons+'</div></div>';
  if(d.item&&d.item.addedAt)st+='<div class="p-stat"><div class="p-stat-l">'+esc(t('plex.addedOn'))+'</div><div class="p-stat-v" style="font-size:13px">'+esc(fmtDate(d.item.addedAt))+'</div></div>';
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
  if(wp&&wp.results&&wp.results[TMDB_REGION]){
    var fr=wp.results[TMDB_REGION];var prov=plexProviderList(fr);
    if(prov.length){
      var ph='<div><div class="sec-lbl">'+esc(t('plex.availableOn'))+'</div><div class="plex-provs">';
      prov.forEach(function(o){var p=o.p;var logo=p.logo_path?'<img class="prov-logo" src=\"'+IB+'w92'+esc(p.logo_path)+'\" alt="">':'';var url=(I18N_META.justwatch||'https://www.justwatch.com/fr/recherche?q=')+encodeURIComponent(d.title||'');ph+='<a class="plex-prov" href="'+url+'" target="_blank" rel="noopener">'+logo+'<div>'+esc(p.provider_name)+'<small>'+esc(o.sub)+'</small></div></a>';});
      ph+='</div></div>';document.getElementById('plexProviders').innerHTML=ph;
    }
  }
  /* Saisons */
  if(d.type!='movie'&&det.seasons){
    var seasons=det.seasons.filter(function(s){return s.season_number>0});plexSeasons=seasons;
    if(seasons.length>1){
      var sel=document.getElementById('sSelWrap');
      sel.innerHTML='<button class="s-btn on" data-s="0" data-sfx-hover'+uiAct('plexSeason',[0])+'>'+esc(t('plex.overview'))+'</button>'+seasons.map(function(s){return '<button class="s-btn" data-s="'+s.season_number+'" data-sfx-hover'+uiAct('plexSeason',[s.season_number])+'>S'+s.season_number+'</button>';}).join('');
    }
    /* Episodes de la saison en cours (cache local, pas item.totalEp = total de la série) :
       recalcul exact ici (on a déjà det.seasons), mis à jour aussi pour les cartes/grille. */
    if(d.item&&d.item.saison){
      var curS=seasons.filter(function(s){return s.season_number===d.item.saison;})[0];
      if(curS&&curS.episode_count){
        d.item.seasonEpCount=curS.episode_count;d.item.seasonEpCountSeason=d.item.saison;
        if(d.item.episode){
          var ppct=Math.min(100,Math.round((d.item.episode/curS.episode_count)*100));
          var pf=document.getElementById('plexProgFill'),pl=document.getElementById('plexProgLbl');
          if(pf)pf.style.width=ppct+'%';
          if(pl)pl.textContent=d.item.episode+'/'+curS.episode_count+' ep ('+ppct+'%)';
        }
        dbPut(d.item,function(){});
      }
    }
  }
  /* Next air */
  if(det.next_episode_to_air&&det.next_episode_to_air.air_date&&d.item){var ne=document.getElementById('plexNep');ne.innerHTML=esc(t('plex.nextEp'))+' <b>S'+pad(det.next_episode_to_air.season_number)+' E'+pad(det.next_episode_to_air.episode_number)+'</b> &bull; '+esc(fmtDate(det.next_episode_to_air.air_date+'T12:00:00'));ne.classList.add('on');}
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
    if(omdb.imdb)parts.push('<span class="plex-imdb">IMDb</span>'+esc(omdb.imdb.split('/')[0]));
    if(omdb.rottenTomatoes)parts.push('<span class="plex-rt-l">RT</span>'+esc(omdb.rottenTomatoes));
    if(omdb.metacritic)parts.push('<span class="plex-rt-l">Metacritic</span>'+esc(omdb.metacritic.split('/')[0]));
  }
  if(kitsu&&kitsu.score)parts.push('<span class="plex-rt-l">Kitsu</span>&#9733; '+esc(kitsu.score));
  el.innerHTML=parts.map(function(p){return '<div class="plex-rt">'+p+'</div>';}).join('');
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
  tf(TB+'/tv/'+d.tmdbId+'/season/'+num+'?language='+TMDB_LANG).then(function(s){
    document.getElementById('plexOverview').textContent=s.overview||d.overview||'';
    if(s.poster_path)document.getElementById('plexPosterWrap').innerHTML='<img class="plex-poster" src=\"'+IB+'w500'+esc(s.poster_path)+'\" alt="">';
    var st='';if(s.vote_average)st+='<div class="p-stat"><div class="p-stat-l">'+esc(t('plex.seasonScore'))+'</div><div class="p-stat-v gold">'+s.vote_average.toFixed(1)+'</div></div>';if(s.episodes)st+='<div class="p-stat"><div class="p-stat-l">'+esc(t('plex.episodes'))+'</div><div class="p-stat-v">'+s.episodes.length+'</div></div>';document.getElementById('plexStats').innerHTML=st;
    getTrailer('tv',d.tmdbId,num,function(key){var tb=document.querySelector('#plexActs .btn-trailer');if(tb&&key)tb.onclick=function(){sfx('click');openYT(key);};});
  }).catch(function(){});
}

function nextEpPlex(){
  var d=plexData;if(!d||!d.item)return;
  var item=d.item;var ep=(item.episode||1)+1;var sai=item.saison||1;
  if(plexSeasons.length){
    var cur=plexSeasons.find(function(s){return s.season_number==sai});
    if(cur&&cur.episode_count&&ep>cur.episode_count){var nx=plexSeasons.find(function(s){return s.season_number==sai+1});if(nx){sai++;ep=1;}else{ep=cur.episode_count;}}
    var now=plexSeasons.find(function(s){return s.season_number==sai});
    if(now&&now.episode_count){item.seasonEpCount=now.episode_count;item.seasonEpCountSeason=sai;}
  }
  item.episode=ep;item.saison=sai;item.hasNewEp=false;item.updatedAtLocal=Date.now();item.needsSync=true;
  for(var j=0;j<memDB.length;j++){if(memDB[j].id==item.id){memDB[j]=item;break}}
  dbPut(item,function(){sfx('next');render();document.getElementById('plexProgVal').textContent='S'+pad(sai)+' E'+pad(ep);toast('S'+pad(sai)+' E'+pad(ep)+' - '+item.title,'nfo');});
}
function closePlex(){document.getElementById('plexMbk').classList.remove('on');plexData=null;}
/* Suppression depuis la fiche : même confirmation que le bouton de la carte, puis fermeture */
function plexDelete(id){
  var before=memDB.filter(function(i){return i.id==id&&!i.deleted;}).length;
  delEntry(id);
  var after=memDB.filter(function(i){return i.id==id&&!i.deleted;}).length;
  if(before&&!after)closePlex();
}
document.getElementById('plexMbk').addEventListener('click',function(e){if(e.target===this){sfx('close');closePlex();}});

/* Marquer l'episode suivant vu en un clic, directement depuis une carte (sans ouvrir la
   fiche détail). Même règle de fin de saison que nextEpPlex (passage à la saison suivante) :
   un petit fetch TMDB (mis en cache côté serveur, pas de coût de quota au clic suivant) donne
   les saisons de la série ; sans réponse, on avance sans dépasser comme avant ce correctif. */
function quickNextEp(id,ev){
  if(ev){ev.stopPropagation();ev.preventDefault();}
  var item=memDB.find(function(i){return i.id==id;});
  if(!item||item.type=='film')return;
  function apply(seasons){
    var ep=(item.episode||0)+1,sai=item.saison||1;
    if(seasons&&seasons.length){
      var cur=seasons.find(function(s){return s.season_number==sai;});
      if(cur&&cur.episode_count&&ep>cur.episode_count){
        var nx=seasons.find(function(s){return s.season_number==sai+1;});
        if(nx){sai++;ep=1;}else{ep=cur.episode_count;}
      }
      var now=seasons.find(function(s){return s.season_number==sai;});
      if(now&&now.episode_count){item.seasonEpCount=now.episode_count;item.seasonEpCountSeason=sai;}
    }
    item.episode=ep;item.saison=sai;item.hasNewEp=false;item.updatedAtLocal=Date.now();item.needsSync=true;
    for(var j=0;j<memDB.length;j++){if(memDB[j].id==item.id){memDB[j]=item;break}}
    dbPut(item,function(){sfx('next');render();toast('S'+pad(sai)+' E'+pad(ep)+' - '+item.title,'nfo');});
  }
  if(item.tmdbId&&(item.tmdbType||'tv')==='tv'){
    tf(TB+'/tv/'+item.tmdbId+'?language='+TMDB_LANG).then(function(d){apply((d&&d.seasons)||null);}).catch(function(){apply(null);});
  }else apply(null);
}

