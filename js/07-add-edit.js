/* MODULE: Formulaire d'ajout/édition d'un titre (recherche TMDB rapide, notes, tags). */
/* SEARCH */
var ti=document.getElementById('tinput'),tdd=document.getElementById('tdd'),spin=document.getElementById('spin');
ti.addEventListener('input',function(){clearTimeout(stimer);var q=ti.value.trim();if(q.length<2){tdd.classList.remove('on');return}spin.classList.add('on');stimer=setTimeout(function(){doSearch(q)},400);});
function doSearch(q){
  tf(TB+'/search/multi?query='+encodeURIComponent(q)+'&language='+TMDB_LANG).then(function(data){
    spin.classList.remove('on');
    var res=(data.results||[]).filter(function(r){return r.media_type=='movie'||r.media_type=='tv'}).slice(0,8);
    if(!res.length){tdd.innerHTML='<div class="ddi" style="color:var(--text3)">'+esc(t('empty.noResult'))+'</div>';tdd.classList.add('on');return}
    tdd.innerHTML=res.map(function(r,i){
      var isM=r.media_type=='movie';var title=isM?r.title:r.name;var year=isM?(r.release_date||'').slice(0,4):(r.first_air_date||'').slice(0,4);
      var th=r.poster_path?'<img class="ddth" src=\"'+IB+'w92'+esc(r.poster_path)+'\" alt="" loading="lazy">':'<div class="ddph">'+icon(isM?'film':'serie')+'</div>';
      return '<div class="ddi"><div class="ddi-main" data-idx="'+i+'">'+th+'<div><div class="ddn">'+esc(title)+'</div><div class="dds">'+(isM?t('type.film'):t('type.serieAnime'))+(year?' - '+year:'')+'</div></div></div><div class="dd-ibtn" data-idx="'+i+'" data-act="info"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg></div></div>';
    }).join('');
    tdd._res=res;tdd.classList.add('on');
  }).catch(function(){spin.classList.remove('on');});
}
tdd.addEventListener('click',function(e){
  var ib=e.target.closest('[data-act="info"]');
  if(ib){sfx('open');var r=tdd._res[parseInt(ib.dataset.idx)];if(r)openPlexTmdb(r);return;}
  var dm=e.target.closest('.ddi-main');if(!dm)return;
  var r=tdd._res[parseInt(dm.dataset.idx)];if(!r)return;
  var dup=memDB.find(function(i){return i.tmdbId==r.id});
  if(dup&&dup.id!=editId){sfx('err');tdd.classList.remove('on');ti.value='';toast(t('add.dup',{title:(r.media_type=='movie'?r.title:r.name)}),'err');return;}
  sfx('click');tdd.classList.remove('on');ti.value='';
  var isM=r.media_type=='movie';var title=isM?r.title:r.name;var year=isM?(r.release_date||'').slice(0,4):(r.first_air_date||'').slice(0,4);
  selTmdb={tmdbId:r.id,tmdbType:r.media_type,title:title,year:year,poster:r.poster_path||null,overview:r.overview||'',tmdbScore:r.vote_average?r.vote_average.toFixed(1):null};
  document.getElementById('sptitle').textContent=title;
  var im=document.getElementById('spimg');if(r.poster_path){im.src=IB+'w185'+r.poster_path;im.style.display='block';}else{im.style.display='none';}
  document.getElementById('ftmdb').value=selTmdb.tmdbScore||'';document.getElementById('fyear').value=year||'';
  document.getElementById('agField').classList.remove('on');setSelVal('fanimegenre','');
  if(isM){setSelVal('ftype','film');}else{setSelVal('ftype','serie');fetchTotEp(r.id);}
  var sp=document.getElementById('sprev');sp.classList.remove('on');sp.classList.add('on');document.getElementById('swrap').style.display='none';
  ficheMore(false);chkEpt();_ficheTouch();
});
function fetchTotEp(id){
  tf(TB+'/tv/'+id+'?language='+TMDB_LANG).then(function(d){
    document.getElementById('ftotep').value=d.number_of_episodes||0;_ficheTouch();
    /* Episodes de la saison 1 (saison par défaut à l'ajout) pour la barre de progression des
       cartes — total_ep ci-dessus est le total de la série entière, pas celui d'une saison. */
    if(selTmdb){
      var s1=(d.seasons||[]).filter(function(s){return s.season_number===1;})[0];
      selTmdb.seasonEpCount=(s1&&s1.episode_count)||null;
      selTmdb.seasonEpCountSeason=1;
    }
  }).catch(function(){});
}
function clearSel(){if(editId)ficheMore(false);selTmdb=null;document.getElementById('sprev').classList.remove('on');document.getElementById('swrap').style.display='';ti.value='';document.getElementById('ftmdb').value='';document.getElementById('fyear').value='';}
document.addEventListener('click',function(e){if(!e.target.closest('.swrap'))tdd.classList.remove('on');});

/* STARS/TAGS/EPT — fiche « A » : statut en 3 positions, note, tags, options repliées */
var _fx={loading:false,dirty:false,snap:null,timer:null,wasDone:false,hintT:null};
function _fxEl(id){return document.getElementById(id);}
/* Compat : la note n'est plus verrouillée sur « À voir » (toucher une étoile passe en « Terminé ») */
function _updateStarsLock(){var st=_fxEl('stars');if(st)st.classList.remove('locked');}
function _fxRateLabel(){var rv=_fxEl('fxRv');if(rv)rv.innerHTML=myRate?esc(String(myRate))+'<small>/10</small>':'–';}
function buildStars(c){myRate=c||0;_fxEl('stars').innerHTML=Array.from({length:10},function(_,i){var v=i+1;return '<div class="star'+(v<=myRate?' on':'')+'" role="button" aria-label="'+v+'/10" data-sfx-hover'+uiAct('setRate',[v])+'>'+starsvg(v<=myRate)+'</div>';}).join('');_fxRateLabel();}
function _fxHint(msg,hl){var h=_fxEl('fxHint');if(!h)return;h.textContent=msg||'';h.classList.toggle('hl',!!hl);clearTimeout(_fx.hintT);if(hl)_fx.hintT=setTimeout(function(){h.classList.remove('hl');h.textContent=t('add.rateHint2');},2600);}
function setRate(v){
  sfx('click');
  /* Toucher la note déjà choisie l'efface */
  if(v===myRate)v=0;
  myRate=v;buildStars(v);
  var b=_fxEl('stars').children[v-1];if(b){b.classList.add('bump');setTimeout(function(){b.classList.remove('bump');},220);}
  if(v&&_fxEl('fstat').value==='avoir'){setSelVal('fstat','termine');_fxHint(t('add.autoDone'),true);}
  _ficheTouch();
}
function buildTags(tt){curTags=tt?tt.slice():[];renderTags();}
function _fxAddTag(v){v=String(v||'').trim().replace(/,/g,'');if(v&&curTags.indexOf(v)<0){curTags.push(v);sfx('click');renderTags();_ficheTouch();var i=_fxEl('tagInput');if(i)i.focus();return true;}return false;}
function renderTags(){
  var w=_fxEl('tagsWrap');
  w.innerHTML=curTags.map(function(tt,i){return '<span class="tag">'+esc(tt)+'<span class="tag-rm" role="button" aria-label="×"'+uiAct('rmTag',[i])+'>×</span></span>';}).join('')+'<input type="text" class="tag-inp" id="tagInput" placeholder="'+esc(t('add.tagPh'))+'" autocomplete="off">';
  var inp=_fxEl('tagInput');
  inp.addEventListener('keydown',function(e){
    if(e.key=='Enter'||e.key==','){e.preventDefault();if(!_fxAddTag(this.value))this.value='';}
    else if(e.key=='Backspace'&&!this.value&&curTags.length){rmTag(curTags.length-1);}
  });
  _fxRenderSugg();
}
/* Suggestions : tags les plus utilisés dans la liste, absents du titre */
function _fxRenderSugg(){
  var box=_fxEl('tagSugg');if(!box)return;var cnt={};
  (memDB||[]).forEach(function(i){if(i.deleted)return;(i.tags||[]).forEach(function(g){cnt[g]=(cnt[g]||0)+1;});});
  var top=Object.keys(cnt).filter(function(g){return curTags.indexOf(g)<0;}).sort(function(a,b){return cnt[b]-cnt[a]||a.localeCompare(b);}).slice(0,6);
  box.innerHTML=top.map(function(g){return '<button type="button" data-tag="'+esc(g)+'">+ '+esc(g)+'</button>';}).join('');
}
_fxEl('tagSugg').addEventListener('click',function(e){var b=e.target.closest('[data-tag]');if(b)_fxAddTag(b.getAttribute('data-tag'));});
function rmTag(i){curTags=curTags.filter(function(x,k){return k!==i});renderTags();_ficheTouch();}
/* Pastilles, curseur glissant, puces type/genre et ligne meta, d'après les champs cachés */
function _ficheSync(){
  var s=_fxEl('fstat').value,tt=_fxEl('ftype').value,ag=_fxEl('fanimegenre').value;
  var order=['avoir','encours','termine'],k=Math.max(0,order.indexOf(s));
  _fxEl('fxPills').querySelectorAll('[data-st]').forEach(function(b){var on=b.getAttribute('data-st')===s;b.classList.toggle('on',on);b.setAttribute('aria-checked',on?'true':'false');});
  var th=_fxEl('fxPills').querySelector('.fx-th');if(th)th.style.transform='translateX('+(k*100)+'%)';
  _fxEl('fxType').querySelectorAll('[data-type]').forEach(function(b){b.classList.toggle('on',b.getAttribute('data-type')===tt);});
  _fxEl('fxGenre').querySelectorAll('[data-genre]').forEach(function(b){b.classList.toggle('on',b.getAttribute('data-genre')===ag);});
  if(selTmdb){
    var sc=selTmdb.tmdbScore;
    _fxEl('spmeta').innerHTML=esc(t('type.'+(tt||'film')))+(selTmdb.year?' · '+esc(String(selTmdb.year)):'')+(sc?' <span class="fx-badge">TMDB '+esc(String(sc))+'</span>':'');
  }
}
function chkEpt(){
  var s=_fxEl('fstat').value,tt=_fxEl('ftype').value;
  _fxEl('ept').classList.toggle('on',s=='encours'&&tt!='film');
  _fxEl('agField').classList.toggle('on',tt=='anime');
  _ficheSync();
}
_fxEl('ftype').addEventListener('change',chkEpt);
_fxEl('fstat').addEventListener('change',chkEpt);
['ftype','fstat','fanimegenre'].forEach(function(id){_fxEl(id).addEventListener('change',function(){_ficheTouch();});});
['fsai','fepi','ftotep','fsaga'].forEach(function(id){_fxEl(id).addEventListener('input',function(){_ficheTouch();});});
_fxEl('fxPills').addEventListener('click',function(e){var b=e.target.closest('[data-st]');if(!b)return;var v=b.getAttribute('data-st');if(v===_fxEl('fstat').value)return;sfx('click');setSelVal('fstat',v);if(v!=='termine')_fxHint(t('add.rateHint2'));});
_fxEl('fxType').addEventListener('click',function(e){var b=e.target.closest('[data-type]');if(!b)return;sfx('click');setSelVal('ftype',b.getAttribute('data-type'));});
_fxEl('fxGenre').addEventListener('click',function(e){var b=e.target.closest('[data-genre]');if(!b)return;sfx('click');var g=b.getAttribute('data-genre');setSelVal('fanimegenre',_fxEl('fanimegenre').value===g?'':g);});
function ficheStep(id,d){var i=_fxEl(id);if(!i)return;var min=parseInt(i.min)||0;var v=Math.max(min,(parseInt(i.value)||0)+d);sfx('click');i.value=v;i.dispatchEvent(new Event('input',{bubbles:true}));}
function ficheMore(force){
  var m=_fxEl('fxMore'),b=_fxEl('fxMoreBtn');var open=typeof force==='boolean'?force:!m.classList.contains('open');
  m.classList.toggle('open',open);b.setAttribute('aria-expanded',open?'true':'false');
  _fxEl('fxMoreLbl').textContent=t(open?'add.lessOpts':'add.moreOpts');
}
/* Fiche affichée dès qu'un titre est choisi (classe .on de #sprev, posée ici et par d'autres modules) */
var _fxBdReq=0;
function _ficheHero(){
  var modal=_fxEl('ficheModal'),on=_fxEl('sprev').classList.contains('on');
  modal.classList.toggle('has-sel',on);
  var bd=_fxEl('fxBd');if(!on||!selTmdb){bd.style.backgroundImage='';bd.classList.remove('sharp');return;}
  var req=++_fxBdReq,sel=selTmdb;
  bd.classList.remove('sharp');bd.style.backgroundImage=sel.poster?'url("'+IB+'w342'+sel.poster+'")':'';
  _ficheSync();
  if(!sel.tmdbId||!sel.tmdbType)return;
  tf(TB+'/'+(sel.tmdbType==='movie'?'movie':'tv')+'/'+sel.tmdbId+'/images?include_image_language=null,en,fr').then(function(d){
    var b=d&&d.backdrops&&d.backdrops[0];if(!b||req!==_fxBdReq)return;
    var im=new Image();im.addEventListener('load',function(){if(req!==_fxBdReq)return;bd.style.backgroundImage='url("'+im.src+'")';bd.classList.add('sharp');});im.src=IB+'w780'+b.file_path;
  }).catch(function(){});
}
new MutationObserver(_ficheHero).observe(_fxEl('sprev'),{attributes:true,attributeFilter:['class']});

/* Autosave (édition) : chaque changement est écrit ~0,4 s plus tard, sans son ; « Annuler » rétablit */
function _fxSaved(busy){var s=_fxEl('fxSaved');if(!s)return;s.classList.toggle('busy',!!busy);_fxEl('fxSavedTxt').textContent=t(busy?'add.saving':'add.saved');}
function _ficheTouch(){
  if(_fx.loading||!editId)return;
  _fx.dirty=true;_fxSaved(true);clearTimeout(_fx.timer);_fx.timer=setTimeout(_ficheAutosave,400);
}
function _ficheAutosave(){
  clearTimeout(_fx.timer);_fx.timer=null;
  if(!editId||!selTmdb)return null;
  var entry=_buildEntryFromForm();if(!entry)return null;
  for(var j=0;j<memDB.length;j++){if(memDB[j].id==editId){memDB[j]=entry;break}}
  dbPut(entry,null);_fxSaved(false);
  return entry;
}
function _ficheUndo(snap){
  if(!snap)return;var back=JSON.parse(JSON.stringify(snap));back.updatedAtLocal=Date.now();back.needsSync=true;
  var found=false;for(var j=0;j<memDB.length;j++){if(memDB[j].id==back.id){memDB[j]=back;found=true;break}}
  if(!found)return;
  dbPut(back,null);render();loadRecos();if(back.myRating)buildTasteProfileCache();
  sfx('click');toast(t('add.undone',{title:back.title}),'nfo');
}
/* Fin d'une édition (Terminé, croix, fond, Échap, retour arrière) : une seule notification */
function _ficheFinish(){
  if(!editId||!_fx.dirty)return;
  var entry=_ficheAutosave();_fx.dirty=false;var snap=_fx.snap;_fx.snap=null;
  if(!entry)return;
  render();loadRecos();
  if(entry.status=='termine'&&!_fx.wasDone){sfx('done');}else{sfx('add');}
  toast(t('add.updated',{title:entry.title}),'ok',{label:t('common.cancel'),fn:function(){_ficheUndo(snap);}});
  if(entry.type=='anime'&&!entry.animeGenre&&entry.tmdbId){detectAnimeGenre(entry.tmdbId,function(g){entry.animeGenre=g;dbPut(entry,function(){});});}
  if(entry.type!='film'&&entry.tmdbId)checkAir(entry);if(entry.myRating)buildTasteProfileCache();
}
function ficheRemove(){
  if(!editId)return;var id=editId;
  if(_fx.dirty)_ficheAutosave();
  delEntry(id);
  var it=memDB.find(function(i){return i.id==id;});
  if(!it||it.deleted){_fx.dirty=false;_fx.snap=null;closeAdd();}
}

/* ADD/EDIT */
function _buildSagaSuggest(){var names={};memDB.forEach(function(i){if(i.collectionName)names[i.collectionName]=1;});var dl=document.getElementById('sagaSuggest');if(dl)dl.innerHTML=Object.keys(names).map(function(n){return'<option value="'+esc(n)+'">';}).join('');}
function _ficheMode(edit){
  var m=_fxEl('ficheModal');m.classList.toggle('is-edit',!!edit);
  ficheMore(false);_fxSaved(false);_fxHint(t('add.rateHint2'));
}
function openAdd(){
  _fx.loading=true;
  editId=null;selTmdb=null;myRate=0;_fx.dirty=false;_fx.snap=null;
  document.getElementById('mtitle').textContent=t('add.title');document.getElementById('sbtn').textContent=t('common.add');
  document.getElementById('sprev').classList.remove('on');document.getElementById('swrap').style.display='';ti.value='';
  setSelVal('ftype','film');setSelVal('fstat','avoir');setSelVal('fanimegenre','');
  document.getElementById('ftmdb').value='';document.getElementById('fyear').value='';
  document.getElementById('fsai').value=1;document.getElementById('fepi').value=1;document.getElementById('ftotep').value=0;
  document.getElementById('ept').classList.remove('on');document.getElementById('agField').classList.remove('on');
  document.getElementById('fsaga').value='';_buildSagaSuggest();
  buildStars(0);buildTags([]);_updateStarsLock();_ficheMode(false);_ficheHero();document.getElementById('addMbk').classList.add('on');
  _fx.loading=false;
  setTimeout(function(){if(!selTmdb)try{ti.focus();}catch(_){}},60);
}
function openEdit(id){
  var item=memDB.find(function(i){return i.id==id});if(!item)return;
  _fx.loading=true;
  editId=id;_fx.dirty=false;_fx.snap=JSON.parse(JSON.stringify(item));_fx.wasDone=item.status=='termine';
  document.getElementById('mtitle').textContent=t('common.edit');document.getElementById('sbtn').textContent=t('add.done');
  selTmdb={tmdbId:item.tmdbId,tmdbType:item.tmdbType,title:item.title,year:item.year,poster:item.poster,overview:item.overview,tmdbScore:item.tmdbScore};
  document.getElementById('sptitle').textContent=item.title;
  var im=document.getElementById('spimg');if(item.poster){im.src=IB+'w185'+item.poster;im.style.display='block';}else{im.style.display='none';}
  setSelVal('ftype',item.type);setSelVal('fstat',item.status);setSelVal('fanimegenre',item.animeGenre||'');
  document.getElementById('ftmdb').value=item.tmdbScore||'';document.getElementById('fyear').value=item.year||'';
  document.getElementById('fsai').value=item.saison||1;document.getElementById('fepi').value=item.episode||1;document.getElementById('ftotep').value=item.totalEp||0;
  document.getElementById('fsaga').value=item.collectionName||'';_buildSagaSuggest();
  buildStars(item.myRating||0);buildTags(item.tags||[]);_ficheMode(true);
  var sp=document.getElementById('sprev');sp.classList.remove('on');sp.classList.add('on');document.getElementById('swrap').style.display='none';
  chkEpt();_updateStarsLock();document.getElementById('addMbk').classList.add('on');
  _fx.loading=false;
}
function closeAdd(){_ficheFinish();document.getElementById('addMbk').classList.remove('on');tdd.classList.remove('on');}
document.getElementById('addMbk').addEventListener('click',function(e){if(e.target===this){sfx('close');closeAdd();}});

/* Fiche d'un titre, même forme pour l'ajout manuel, l'édition et l'onglet « Détectés »
   sel : fiche TMDB choisie ; f : champs saisis ; ex : titre existant (édition) ou rien */
function makeEntry(sel,f,ex,id){
  return{id:id||uid(),type:f.type,status:f.status,myRating:f.myRating||0,animeGenre:f.animeGenre||'',
    saison:f.saison,episode:f.episode,totalEp:f.totalEp,
    tags:f.tags||[],addedAt:ex?ex.addedAt:(f.watchedAt||Date.now()),
    lastWatchedAt:ex?ex.lastWatchedAt:(f.watchedAt||null),
    tmdbId:sel.tmdbId,tmdbType:sel.tmdbType,title:sel.title,year:sel.year,
    poster:sel.poster,overview:sel.overview,tmdbScore:sel.tmdbScore,
    hasNewEp:ex?ex.hasNewEp:false,nextAir:ex?ex.nextAir:null,
    collectionId:f.collectionId||null,collectionName:f.collectionName||null,
    supaId:ex?ex.supaId:null,deleted:false,updatedAtLocal:Date.now(),needsSync:true,
    reminderEnabled:ex?ex.reminderEnabled:false,nextAirDate:ex?ex.nextAirDate:null,
    /* Episodes de la saison en cours (pas le total de la série, voir totalEp) : sert uniquement
       à la barre de progression des cartes, local, jamais synchronisé. Valide seulement pour la
       saison seasonEpCountSeason — sinon fausse la barre comme avant ce correctif. */
    seasonEpCount:f.seasonEpCount!=null?f.seasonEpCount:(ex?ex.seasonEpCount:null),
    seasonEpCountSeason:f.seasonEpCount!=null?f.seasonEpCountSeason:(ex?ex.seasonEpCountSeason:null),
    lastEpisodeCheck:ex?ex.lastEpisodeCheck:null,tvmazeId:ex?ex.tvmazeId:null,
    streamingProviders:ex?ex.streamingProviders:null,genreIds:ex?ex.genreIds:null,
    omdbRatings:ex?ex.omdbRatings:null,kitsuRating:ex?ex.kitsuRating:null,
    collectionChecked:ex?ex.collectionChecked:false,tmdbCollectionId:ex?ex.tmdbCollectionId:null};
}
/* Ajout sans formulaire (onglet « Détectés ») : mêmes suites qu'un ajout manuel
   (genre d'anime, recommandations, Discovery, prochains épisodes) */
function addEntryFromTmdb(sel,f){
  var entry=makeEntry(sel,f,null,null);
  memDB.unshift(entry);
  if(entry.type=='anime'&&!entry.animeGenre&&sel.tmdbId){detectAnimeGenre(sel.tmdbId,function(g){entry.animeGenre=g;dbPut(entry,function(){});});}
  dbPut(entry,function(){_removeFromDiscoverUI(entry.tmdbId);if(entry.type!='film'&&sel.tmdbId)checkAir(entry);});
  return entry;
}
/* Nouvelle progression d'un titre existant (statut, saison, épisode), comme un passage d'épisode */
function updateEntryProgress(id,f){
  var item=memDB.find(function(i){return i.id==id;});if(!item)return null;
  item.status=f.status;item.saison=f.saison;item.episode=f.episode;
  if(f.seasonEpCount!=null){item.seasonEpCount=f.seasonEpCount;item.seasonEpCountSeason=f.seasonEpCountSeason;}
  /* date de l'historique importé ; sans date connue on garde l'ancienne (pas « aujourd'hui » inventé) */
  if(f.watchedAt&&!(item.lastWatchedAt>f.watchedAt))item.lastWatchedAt=f.watchedAt;
  item.hasNewEp=false;item.updatedAtLocal=Date.now();item.needsSync=true;
  dbPut(item,function(){});
  return item;
}

/* SAVE/DELETE */
/* Valeurs du formulaire -> fiche complète (ajout ou autosave d'édition) */
function _buildEntryFromForm(){
  var type=document.getElementById('ftype').value,status=document.getElementById('fstat').value;
  var sai=parseInt(document.getElementById('fsai').value)||1,epi=parseInt(document.getElementById('fepi').value)||1,totep=parseInt(document.getElementById('ftotep').value)||0;
  var ag=type=='anime'?document.getElementById('fanimegenre').value:'';
  var showEp=(type!='film'&&status=='encours');
  var ex=memDB.find(function(i){return i.id==editId});
  var sagaRaw=(document.getElementById('fsaga').value||'').trim();
  var collName=sagaRaw||null;
  var collId=collName?collName.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''):null;
  var seasonMatch=showEp&&selTmdb&&selTmdb.seasonEpCountSeason===sai;
  var entry=makeEntry(selTmdb,{type:type,status:status,myRating:myRate,animeGenre:ag,
    saison:showEp?sai:null,episode:showEp?epi:null,totalEp:showEp?totep:(ex?ex.totalEp:null),
    seasonEpCount:seasonMatch?selTmdb.seasonEpCount:null,seasonEpCountSeason:seasonMatch?sai:null,
    tags:curTags.slice(),collectionId:collId,collectionName:collName},ex,editId);
  return entry;
}
function saveEntry(){
  if(!selTmdb){sfx('err');toast(t('add.selectTitle'),'err');return;}
  /* Édition : tout est déjà enregistré au fil de l'eau, « Terminé » ferme simplement */
  if(editId){sfx('close');closeAdd();return;}
  if(!editId){
    var dup=memDB.find(function(i){return i.tmdbId==selTmdb.tmdbId;});
    if(dup){sfx('err');toast(t('add.dup',{title:selTmdb.title}),'err');return;}
  }
  var ex=memDB.find(function(i){return i.id==editId});
  var wasDone=ex&&ex.status=='termine';
  var entry=_buildEntryFromForm();var type=entry.type,status=entry.status,ag=entry.animeGenre;
  if(editId){for(var j=0;j<memDB.length;j++){if(memDB[j].id==editId){memDB[j]=entry;break}}}else{memDB.unshift(entry);}
  if(type=='anime'&&!ag&&selTmdb.tmdbId){detectAnimeGenre(selTmdb.tmdbId,function(g){entry.animeGenre=g;for(var k=0;k<memDB.length;k++){if(memDB[k].id==entry.id){memDB[k]=entry;break}}dbPut(entry,function(){});});}
  /* Mise à jour optimiste : memDB est déjà à jour, l'interface n'attend pas l'écriture IndexedDB.
     Les transactions « readwrite » passent en file derrière celles de la synchro et des vérifications
     en arrière-plan (une par titre) : sur une grosse liste, attendre oncomplete prenait 10-15 s. */
  var wasEdit=editId,tmdbOk=selTmdb.tmdbId;
  dbPut(entry,null);
  render();loadRecos();if(!wasEdit)_removeFromDiscoverUI(entry.tmdbId);if(!wasEdit&&typeof p3ForYou==='function')p3ForYou();if(status=='termine'&&!wasDone){sfx('done');}else{sfx('add');}toast(t(wasEdit?'add.updated':'add.added',{title:entry.title}));closeAdd();if(type!='film'&&tmdbOk)checkAir(entry);if(entry.myRating)buildTasteProfileCache();
}
function delEntry(id){
  if(!confirm(t('add.deleteConfirm')))return;
  var item=memDB.find(function(i){return i.id==id});
  if(!item){return;}
  if(item.supaId||authUser){
    /* Item potentiellement connu de Supabase (ou compte actif) : tombstone pour propager la suppression, purge physique locale seulement apres confirmation de sync */
    item.deleted=true;item.updatedAtLocal=Date.now();item.needsSync=true;
    dbPut(item,function(){sfx('del');render();loadRecos();toast(t('add.deleted',{title:item.title}),'nfo');});
  }else{
    /* Jamais connecte / jamais synchronise : suppression physique immediate (comportement historique) */
    memDB=memDB.filter(function(i){return i.id!=id});
    dbDel(id,function(){sfx('del');render();loadRecos();toast(t('add.deleted',{title:item.title}),'nfo');});
  }
}

