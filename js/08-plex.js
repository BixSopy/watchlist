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
  plexEpsReset();plexSimilar(d);
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
var PLEX_ICON_MORE='<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';
/* Actions de la fiche « Cinéma » : bouton principal (Marquer SxxExx / Marquer comme vu / Ajouter),
   statut, ma note, où regarder, puis ⋯ (bande-annonce, modifier, supprimer, partager). */
function plexNextCode(item){
  if(!item||item.type==='film')return '';
  var ep=(item.episode||0)+1,sai=item.saison||1;
  if(plexSeasons.length){var cur=plexSeasons.find(function(s){return s.season_number==sai});
    if(cur&&cur.episode_count&&ep>cur.episode_count){var nx=plexSeasons.find(function(s){return s.season_number==sai+1});if(nx){sai++;ep=1;}else return '';}}
  return 'S'+pad(sai)+' E'+pad(ep);
}
function _plexBtn(cls,html,fn){var b=document.createElement('button');b.type='button';b.className='btn '+cls;b.innerHTML=html;if(fn)b.onclick=fn;return b;}
function buildPlexActions(){
  var d=plexData;var acts=document.getElementById('plexActs');acts.innerHTML='';
  var inList=d.item||memDB.find(function(i){return i.tmdbId==d.tmdbId});
  var it=inList&&d.item?d.item:null;
  if(!it){
    acts.appendChild(_plexBtn('btn-add-plex btn-p3',PLEX_ICON_ADD+esc(t('plex.addToListShort')),function(){sfx('click');closePlex();recoAddDirect(d);}));
  }else{
    var nc=plexNextCode(it);
    if(it.type!=='film'&&it.status!=='termine'&&nc)acts.appendChild(_plexBtn('btn-p3 plex-mark','<span class="play" aria-hidden="true"></span>'+esc(t('plex.markEp',{ep:nc})),function(){nextEpPlex();}));
    else if(it.status!=='termine')acts.appendChild(_plexBtn('btn-p3 plex-mark','<span class="play" aria-hidden="true"></span>'+esc(t('plex.markSeen')),function(){plexSetItem({status:'termine'});}));
    /* Statut */
    var sw=document.createElement('label');sw.className='btn btn-pill plex-st';
    sw.innerHTML='<span class="sr-only">'+esc(t('plex.status'))+'</span><select aria-label="'+esc(t('plex.status'))+'">'+['avoir','encours','termine'].map(function(k){return '<option value="'+k+'"'+(it.status===k?' selected':'')+'>'+esc(t('status.'+k))+'</option>';}).join('')+'</select><span class="plex-caret" aria-hidden="true">⌄</span>';
    sw.querySelector('select').onchange=function(){plexSetItem({status:this.value});};acts.appendChild(sw);
    /* Ma note */
    var rw=document.createElement('label');rw.className='btn btn-pill plex-rt';
    rw.innerHTML='<span aria-hidden="true">★</span><select aria-label="'+esc(t('plex.myRating'))+'"><option value="0">'+esc(t('plex.myRating'))+'</option>'+[10,9,8,7,6,5,4,3,2,1].map(function(n){return '<option value="'+n+'"'+(it.myRating==n?' selected':'')+'>'+n+'/10</option>';}).join('')+'</select>';
    rw.querySelector('select').onchange=function(){plexSetItem({myRating:parseInt(this.value,10)||0});};acts.appendChild(rw);
  }
  acts.appendChild(_plexBtn('btn-pill plex-where',esc(t('plex.where')),function(){sfx('click');var x=document.getElementById('plexInfos');if(x&&x.scrollIntoView)x.scrollIntoView({behavior:'smooth',block:'center'});x&&x.classList.add('flash');setTimeout(function(){x&&x.classList.remove('flash');},1200);}));
  /* ⋯ : actions secondaires (inchangées) */
  var mw=document.createElement('div');mw.className='plex-morew';
  var mb=_plexBtn('btn-pill btn-icon plex-more-b',PLEX_ICON_MORE,null);mb.setAttribute('aria-label',t('plex.more'));mb.setAttribute('aria-haspopup','true');mb.setAttribute('aria-expanded','false');mb.title=t('plex.more');
  var menu=document.createElement('div');menu.className='plex-more';menu.hidden=true;menu.setAttribute('role','menu');
  mb.onclick=function(e){e.stopPropagation();sfx('click');menu.hidden=!menu.hidden;mb.setAttribute('aria-expanded',String(!menu.hidden));};
  if(d.tmdbId)menu.appendChild(_plexBtn('btn-trailer',PLEX_ICON_PLAY+esc(t('plex.trailer')),function(){sfx('click');getTrailer(d.type,d.tmdbId,null,openYT);}));
  if(it){
    menu.appendChild(_plexBtn('btn-ghost',esc(t('common.edit')),function(){sfx('open');closePlex();openEdit(it.id);}));
    var db=_plexBtn('btn-ghost btn-del-plex',esc(t('common.delete')),null);db.setAttribute('data-click','plexDelete');db.setAttribute('data-args',JSON.stringify([String(it.id)]));menu.appendChild(db);
  }
  if(d.tmdbId)menu.appendChild(_plexBtn('btn-ghost',PLEX_ICON_SHARE+esc(t('plex.share')),function(){sfx('click');plexShare(d);}));
  mw.appendChild(mb);mw.appendChild(menu);acts.appendChild(mw);
  Array.prototype.forEach.call(menu.children,function(b){b.setAttribute('role','menuitem');});
  /* Progression (en-tête) + ancien bloc détaillé */
  plexHeaderProg();
  if(it&&it.type!='film'&&it.saison&&it.episode){
    var pg=document.getElementById('plexProg');pg.style.display='block';
    document.getElementById('plexProgVal').textContent='S'+pad(it.saison)+' E'+pad(it.episode);
    var pct=0,plbl='';if(it.totalEp&&it.totalEp>0){pct=Math.min(100,Math.round((it.episode/it.totalEp)*100));plbl=it.episode+'/'+it.totalEp+' ep ('+pct+'%)';}
    document.getElementById('plexProgFill').style.width=pct+'%';document.getElementById('plexProgLbl').textContent=plbl;
    document.getElementById('plexNextBtn').style.display=it.status=='encours'?'inline-block':'none';
    document.getElementById('plexNextBtn').onclick=nextEpPlex;
  }
}
document.addEventListener('click',function(e){var m=document.querySelector('#plexActs .plex-more');if(m&&!m.hidden&&!e.target.closest('.plex-morew')){m.hidden=true;var b=document.querySelector('#plexActs .plex-more-b');if(b)b.setAttribute('aria-expanded','false');}});
/* Épisodes vus sur l'ensemble de la série, d'après le pointeur (saisons précédentes complètes) */
function seriesSeen(item,seasons){
  if(!item||!item.saison)return null;
  var tot=0,seen=0,ok=false;
  (seasons||[]).forEach(function(s){if(!s.episode_count)return;ok=true;tot+=s.episode_count;
    if(item.status==='termine'||s.season_number<item.saison)seen+=s.episode_count;else if(s.season_number===item.saison)seen+=Math.min(item.episode||0,s.episode_count);});
  return ok?{seen:seen,total:tot}:null;
}
function plexHeaderProg(){
  var d=plexData,w=document.getElementById('plexHProg');if(!w)return;
  var it=d&&d.item;if(!it||it.type==='film'||!it.saison||!it.episode||it.status==='avoir'){w.hidden=true;return;}
  var ss=seriesSeen(it,plexSeasons),code='S'+pad(it.saison)+' · E'+pad(it.episode);
  document.getElementById('plexHProgL').textContent=ss?t('plex.seenOf',{code:code,n:ss.seen,total:ss.total}):code;
  var pct=ss&&ss.total?Math.round(ss.seen/ss.total*100):(it.seasonEpCount?Math.round(it.episode/it.seasonEpCount*100):0);
  document.getElementById('plexHProgF').style.width=Math.min(100,pct)+'%';w.hidden=false;
}
function plexSetItem(patch){
  var d=plexData;if(!d||!d.item)return;var item=d.item;
  Object.keys(patch).forEach(function(k){item[k]=patch[k];});
  if(patch.status==='encours'&&!item.saison&&item.type!=='film'){item.saison=1;item.episode=item.episode||0;}
  if(patch.status)item.lastWatchedAt=Date.now();
  item.updatedAtLocal=Date.now();item.needsSync=true;
  for(var j=0;j<memDB.length;j++){if(memDB[j].id==item.id){memDB[j]=item;break}}
  dbPut(item,function(){sfx('click');render();buildPlexActions();plexEpisodesRefresh();toast(item.title+' · '+(patch.status?t('status.'+patch.status):patch.myRating?patch.myRating+'/10':''),'nfo');});
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
/* Lien direct vers la recherche sur le domaine de la plateforme elle-même
   plutôt que via un tiers (JustWatch/TMDB) — patterns vérifiés pour les
   plateformes les plus courantes. Repli sur la page officielle TMDB/JustWatch
   (fr.link) pour toute plateforme non reconnue, afin de rester fiable plutôt
   que de deviner une URL susceptible de mener à une page morte. */
var PLEX_PROV_DOMAIN=[
  [/netflix/i,'https://www.netflix.com/search?q=%s'],
  [/amazon|prime ?video/i,'https://www.amazon.fr/s?k=%s&i=instant-video'],
  [/apple ?tv/i,'https://tv.apple.com/search?term=%s'],
  [/crunchyroll/i,'https://www.crunchyroll.com/search?q=%s'],
  [/youtube/i,'https://www.youtube.com/results?search_query=%s'],
];
function plexProviderDirectUrl(p,fallback){
  for(var i=0;i<PLEX_PROV_DOMAIN.length;i++){
    if(PLEX_PROV_DOMAIN[i][0].test(p.provider_name||''))return PLEX_PROV_DOMAIN[i][1].replace('%s',encodeURIComponent(plexData.title||''));
  }
  return fallback||(I18N_META.justwatch||'https://www.justwatch.com/fr/recherche?q=')+encodeURIComponent(plexData.title||'');
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
      prov.forEach(function(o){var p=o.p;var logo=p.logo_path?'<img class="prov-logo" src=\"'+IB+'w92'+esc(p.logo_path)+'\" alt="">':'';var url=plexProviderDirectUrl(p,fr.link);ph+='<a class="plex-prov" href="'+url+'" target="_blank" rel="noopener">'+logo+'<div>'+esc(p.provider_name)+'<small>'+esc(o.sub)+'</small></div></a>';});
      ph+='</div><div class="plex-prov-credit">'+esc(t('plex.provCredit'))+'</div></div>';document.getElementById('plexProviders').innerHTML=ph;
    }
  }
  /* Saisons */
  if(d.type!='movie'&&det.seasons){
    var seasons=det.seasons.filter(function(s){return s.season_number>0});plexSeasons=seasons;
    if(seasons.length>1){
      var sel=document.getElementById('sSelWrap');
      var curSn=d.item&&d.item.saison&&d.item.status!=='avoir'?d.item.saison:seasons[0].season_number;
      sel.innerHTML='<div class="s-seg" role="group" aria-label="'+esc(t('plex.seasonsLbl'))+'">'+seasons.map(function(s){return '<button type="button" class="s-btn'+(s.season_number===curSn?' on':'')+'" data-s="'+s.season_number+'" data-sfx-hover'+uiAct('plexSeason',[s.season_number])+'>'+esc(t('plex.seasonN',{n:s.season_number}))+'</button>';}).join('')+'</div>';
    }
    /* Episodes de la saison en cours (cache local, pas item.totalEp = total de la série) :
       recalcul exact ici (on a déjà det.seasons), mis à jour aussi pour les cartes/grille. */
    plexHeaderProg();buildPlexActions();
    if(d.item&&d.item.saison&&d.item.status!=='avoir')plexEpisodes(d.item.saison);else if(seasons.length)plexEpisodes(seasons[0].season_number);
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
  plexEpisodes(num);
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
  item.episode=ep;item.saison=sai;item.hasNewEp=false;item.lastWatchedAt=Date.now();item.updatedAtLocal=Date.now();item.needsSync=true;
  for(var j=0;j<memDB.length;j++){if(memDB[j].id==item.id){memDB[j]=item;break}}
  dbPut(item,function(){sfx('next');render();document.getElementById('plexProgVal').textContent='S'+pad(sai)+' E'+pad(ep);buildPlexActions();plexEpisodesRefresh();toast('S'+pad(sai)+' E'+pad(ep)+' - '+item.title,'nfo');});
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
    item.episode=ep;item.saison=sai;item.hasNewEp=false;item.lastWatchedAt=Date.now();item.updatedAtLocal=Date.now();item.needsSync=true;
    for(var j=0;j<memDB.length;j++){if(memDB[j].id==item.id){memDB[j]=item;break}}
    dbPut(item,function(){sfx('next');render();toast('S'+pad(sai)+' E'+pad(ep)+' - '+item.title,'nfo');});
  }
  if(item.tmdbId&&(item.tmdbType||'tv')==='tv'){
    tf(TB+'/tv/'+item.tmdbId+'?language='+TMDB_LANG).then(function(d){apply((d&&d.seasons)||null);}).catch(function(){apply(null);});
  }else apply(null);
}


/* ===== Fiche « Cinéma » : liste des épisodes et titres similaires =====
   Les coches viennent du pointeur existant (saison/épisode du titre) : un épisode est « vu » s'il est
   avant ou égal au dernier épisode vu. Pas de suivi épisode par épisode, donc pas de migration :
   les coches sont en lecture seule ; « Épisode suivant » reste le bouton qui avance. */
function epWatched(item,s,e){
  if(!item||item.status==='avoir')return false;
  if(item.status==='termine')return true;
  var cs=item.saison||0,ce=item.episode||0;
  return s<cs||(s===cs&&e<=ce);
}
function plexEpsReset(){_plexEpsNum=0;var w=document.getElementById('plexEpsWrap');if(w)w.hidden=true;var l=document.getElementById('plexEps');if(l)l.innerHTML='';}
var _plexEpsReq=0;
var _plexEpsNum=0;
function plexEpisodesRefresh(){if(_plexEpsNum)plexEpisodes(_plexEpsNum);}
function plexEpisodes(num){
  var d=plexData;_plexEpsNum=num;if(!d||!d.tmdbId||d.type==='movie')return;
  var req=++_plexEpsReq;
  tf(TB+'/tv/'+d.tmdbId+'/season/'+num+'?language='+TMDB_LANG).then(function(s){
    if(req!==_plexEpsReq||plexData!==d||!s||!s.episodes||!s.episodes.length)return;
    var html=s.episodes.slice(0,40).map(function(ep,i){
      var dt=ep.air_date?new Date(ep.air_date+'T12:00:00'):null,fut=dt&&dt>new Date(),v=!fut&&epWatched(d.item,num,ep.episode_number);
      var when=fut?t('plex.epAirs',{date:dt.toLocaleDateString(LOCALE,{day:'numeric',month:'long'})}):(ep.runtime?ep.runtime+' min':'');
      return '<div class="pe-row" style="--i:'+Math.min(i,12)+'"><span class="pe-im"'+(ep.still_path?' style="background-image:url(\''+esc(IB+'w300'+ep.still_path)+'\')"':'')+'></span>'+
        '<span class="pe-tx"><b>E'+ep.episode_number+(ep.name?' · '+esc(ep.name):'')+'</b><i>'+esc(when)+(v?' · '+esc(t('plex.epSeen')):'')+'</i></span>'+
        '<span class="pe-ck'+(v?' on':'')+'" role="img" aria-label="'+esc(v?t('plex.epSeen'):t('plex.epNotSeen'))+'">'+(v?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M5 12.5l4.2 4.2L19 7"/></svg>':'')+'</span></div>';
    }).join('');
    document.getElementById('plexEps').innerHTML=html;document.getElementById('plexEpsWrap').hidden=false;
  }).catch(function(){});
}
var _plexSimReq=0,_plexSimRes=[];
function plexSimilar(d){
  var w=document.getElementById('plexSimWrap'),box=document.getElementById('plexSim');if(!w||!box)return;
  w.hidden=true;box.innerHTML='';if(!d||!d.tmdbId)return;
  var req=++_plexSimReq,tt=d.type==='movie'?'movie':'tv';
  tf(TB+'/'+tt+'/'+d.tmdbId+'/recommendations?language='+TMDB_LANG+'&page=1').then(function(r){
    if(req!==_plexSimReq)return;
    var res=((r&&r.results)||[]).filter(function(x){return x.poster_path;}).slice(0,6);
    if(!res.length)return;
    _plexSimRes=res.map(function(x){x.media_type=x.media_type||tt;return x;});
    box.innerHTML=_plexSimRes.map(function(x,i){var ti=x.title||x.name||'',y=(x.release_date||x.first_air_date||'').slice(0,4);
      return '<button type="button" class="ps-c" style="--i:'+i+'"'+uiAct('plexSimOpen',[i])+'><span class="ps-im" style="background-image:url(\''+esc(IB+'w342'+x.poster_path)+'\')"></span><b>'+esc(ti)+'</b><i>'+esc(y)+(x.vote_average?' · ★ '+x.vote_average.toFixed(1):'')+'</i></button>';}).join('');
    w.hidden=false;
  }).catch(function(){});
}
