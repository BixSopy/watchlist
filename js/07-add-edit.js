/* MODULE: Formulaire d'ajout/édition d'un titre (recherche TMDB rapide, notes, tags). */
/* SEARCH */
var ti=document.getElementById('tinput'),tdd=document.getElementById('tdd'),spin=document.getElementById('spin');
ti.addEventListener('input',function(){clearTimeout(stimer);var q=ti.value.trim();if(q.length<2){tdd.classList.remove('on');return}spin.classList.add('on');stimer=setTimeout(function(){doSearch(q)},400);});
function doSearch(q){
  tf(TB+'/search/multi?query='+encodeURIComponent(q)+'&language=fr-FR').then(function(data){
    spin.classList.remove('on');
    var res=(data.results||[]).filter(function(r){return r.media_type=='movie'||r.media_type=='tv'}).slice(0,8);
    if(!res.length){tdd.innerHTML='<div class="ddi" style="color:var(--text3)">Aucun resultat</div>';tdd.classList.add('on');return}
    tdd.innerHTML=res.map(function(r,i){
      var isM=r.media_type=='movie';var title=isM?r.title:r.name;var year=isM?(r.release_date||'').slice(0,4):(r.first_air_date||'').slice(0,4);
      var th=r.poster_path?'<img class="ddth" src=\"'+IB+'w92'+esc(r.poster_path)+'\" alt="" loading="lazy">':'<div class="ddph">'+icon(isM?'film':'serie')+'</div>';
      return '<div class="ddi"><div class="ddi-main" data-idx="'+i+'">'+th+'<div><div class="ddn">'+esc(title)+'</div><div class="dds">'+(isM?'Film':'Série/Anime')+(year?' - '+year:'')+'</div></div></div><div class="dd-ibtn" data-idx="'+i+'" data-act="info"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg></div></div>';
    }).join('');
    tdd._res=res;tdd.classList.add('on');
  }).catch(function(){spin.classList.remove('on');});
}
tdd.addEventListener('click',function(e){
  var ib=e.target.closest('[data-act="info"]');
  if(ib){sfx('click');var r=tdd._res[parseInt(ib.dataset.idx)];if(r)openPlexTmdb(r);return;}
  var dm=e.target.closest('.ddi-main');if(!dm)return;
  var r=tdd._res[parseInt(dm.dataset.idx)];if(!r)return;
  var dup=memDB.find(function(i){return i.tmdbId==r.id});
  if(dup&&dup.id!=editId){sfx('err');tdd.classList.remove('on');ti.value='';toast('"'+(r.media_type=='movie'?r.title:r.name)+'" est deja dans ta liste','err');return;}
  sfx('click');tdd.classList.remove('on');ti.value='';
  var isM=r.media_type=='movie';var title=isM?r.title:r.name;var year=isM?(r.release_date||'').slice(0,4):(r.first_air_date||'').slice(0,4);
  selTmdb={tmdbId:r.id,tmdbType:r.media_type,title:title,year:year,poster:r.poster_path||null,overview:r.overview||'',tmdbScore:r.vote_average?r.vote_average.toFixed(1):null};
  document.getElementById('sptitle').textContent=title;
  document.getElementById('spmeta').textContent=(isM?'Film':'Série/Anime')+(year?' - '+year:'')+(r.vote_average?' - '+r.vote_average.toFixed(1):'');
  var im=document.getElementById('spimg');if(r.poster_path){im.src=IB+'w92'+r.poster_path;im.style.display='block';}else{im.style.display='none';}
  document.getElementById('sprev').classList.add('on');document.getElementById('swrap').style.display='none';
  document.getElementById('ftmdb').value=selTmdb.tmdbScore||'';document.getElementById('fyear').value=year||'';
  document.getElementById('agField').style.display='none';
  if(isM){document.getElementById('ftype').value='film';}else{document.getElementById('ftype').value='serie';fetchTotEp(r.id);}
  chkEpt();
});
function fetchTotEp(id){tf(TB+'/tv/'+id+'?language=fr-FR').then(function(d){document.getElementById('ftotep').value=d.number_of_episodes||0;}).catch(function(){});}
function clearSel(){selTmdb=null;document.getElementById('sprev').classList.remove('on');document.getElementById('swrap').style.display='';ti.value='';document.getElementById('ftmdb').value='';document.getElementById('fyear').value='';}
document.addEventListener('click',function(e){if(!e.target.closest('.swrap'))tdd.classList.remove('on');});

/* STARS/TAGS/EPT */
function _updateStarsLock(){
  var s=document.getElementById('fstat');
  var st=document.getElementById('stars');
  if(!s||!st)return;
  if(s.value==='avoir'){st.classList.add('locked');}
  else{st.classList.remove('locked');}
}
function buildStars(c){myRate=c||0;document.getElementById('stars').innerHTML=Array.from({length:10},function(_,i){var v=i+1;return '<div class="star'+(v<=myRate?' on':'')+'" onmouseenter="sfx(\'hover\')" onclick="setRate('+v+')">'+starsvg(v<=myRate)+'</div>';}).join('');}
function setRate(v){sfx('click');myRate=v;buildStars(v);}
function buildTags(t){curTags=t?t.slice():[];renderTags();}
function renderTags(){
  var w=document.getElementById('tagsWrap');
  w.innerHTML=curTags.map(function(t,i){return '<span class="tag">'+esc(t)+'<span class="tag-rm" onclick="rmTag('+i+')">x</span></span>';}).join('')+'<input type="text" class="tag-inp" id="tagInput" placeholder="+ tag">';
  document.getElementById('tagInput').addEventListener('keydown',function(e){if(e.key=='Enter'||e.key==','){e.preventDefault();var v=this.value.trim().replace(/,/g,'');if(v&&curTags.indexOf(v)<0){curTags.push(v);sfx('click');renderTags();}else{this.value='';}}});
}
function rmTag(i){curTags=curTags.filter(function(x,k){return k!==i});renderTags();}
function chkEpt(){
  var s=document.getElementById('fstat').value,t=document.getElementById('ftype').value;
  document.getElementById('ept').classList.toggle('on',s=='encours'&&t!='film');
  document.getElementById('agField').style.display=t=='anime'?'block':'none';
}
document.getElementById('ftype').addEventListener('change',chkEpt);
document.getElementById('fstat').addEventListener('change',chkEpt);

/* ADD/EDIT */
function _buildSagaSuggest(){var names={};memDB.forEach(function(i){if(i.collectionName)names[i.collectionName]=1;});var dl=document.getElementById('sagaSuggest');if(dl)dl.innerHTML=Object.keys(names).map(function(n){return'<option value="'+esc(n)+'">';}).join('');}
function openAdd(){
  editId=null;selTmdb=null;myRate=0;
  document.getElementById('mtitle').textContent='Ajouter un titre';document.getElementById('sbtn').textContent='Ajouter';
  document.getElementById('sprev').classList.remove('on');document.getElementById('swrap').style.display='';ti.value='';
  document.getElementById('ftype').value='film';document.getElementById('fstat').value='avoir';
  document.getElementById('ftmdb').value='';document.getElementById('fyear').value='';
  document.getElementById('fsai').value=1;document.getElementById('fepi').value=1;document.getElementById('ftotep').value=0;
  document.getElementById('ept').classList.remove('on');document.getElementById('agField').style.display='none';
  document.getElementById('fsaga').value='';_buildSagaSuggest();
  buildStars(0);buildTags([]);_updateStarsLock();document.getElementById('addMbk').classList.add('on');
}
function openEdit(id){
  var item=memDB.find(function(i){return i.id==id});if(!item)return;
  editId=id;
  document.getElementById('mtitle').textContent='Modifier';document.getElementById('sbtn').textContent='Enregistrer';
  selTmdb={tmdbId:item.tmdbId,tmdbType:item.tmdbType,title:item.title,year:item.year,poster:item.poster,overview:item.overview,tmdbScore:item.tmdbScore};
  document.getElementById('sptitle').textContent=item.title;
  document.getElementById('spmeta').textContent=(item.type=='film'?'Film':'Série/Anime')+(item.year?' - '+item.year:'');
  var im=document.getElementById('spimg');if(item.poster){im.src=IB+'w92'+item.poster;im.style.display='block';}else{im.style.display='none';}
  document.getElementById('sprev').classList.add('on');document.getElementById('swrap').style.display='none';
  document.getElementById('ftype').value=item.type;document.getElementById('fstat').value=item.status;
  document.getElementById('ftmdb').value=item.tmdbScore||'';document.getElementById('fyear').value=item.year||'';
  document.getElementById('fsai').value=item.saison||1;document.getElementById('fepi').value=item.episode||1;document.getElementById('ftotep').value=item.totalEp||0;
  if(item.animeGenre)document.getElementById('fanimegenre').value=item.animeGenre;
  document.getElementById('fsaga').value=item.collectionName||'';_buildSagaSuggest();
  buildStars(item.myRating||0);buildTags(item.tags||[]);chkEpt();_updateStarsLock();document.getElementById('addMbk').classList.add('on');
}
document.getElementById('fstat').addEventListener('change',_updateStarsLock);
function closeAdd(){document.getElementById('addMbk').classList.remove('on');tdd.classList.remove('on');}
document.getElementById('addMbk').addEventListener('click',function(e){if(e.target===this){sfx('close');closeAdd();}});

/* SAVE/DELETE */
function saveEntry(){
  if(!selTmdb){sfx('err');toast('Selectionne un titre','err');return;}
  if(!editId){
    var dup=memDB.find(function(i){return i.tmdbId==selTmdb.tmdbId;});
    if(dup){sfx('err');toast('"'+selTmdb.title+'" est deja dans ta liste','err');return;}
  }
  var type=document.getElementById('ftype').value,status=document.getElementById('fstat').value;
  var sai=parseInt(document.getElementById('fsai').value)||1,epi=parseInt(document.getElementById('fepi').value)||1,totep=parseInt(document.getElementById('ftotep').value)||0;
  var ag=type=='anime'?document.getElementById('fanimegenre').value:'';
  var showEp=(type!='film'&&status=='encours');
  var ex=memDB.find(function(i){return i.id==editId});
  var wasDone=ex&&ex.status=='termine';
  var sagaRaw=(document.getElementById('fsaga').value||'').trim();
  var collName=sagaRaw||null;
  var collId=collName?collName.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''):null;
  var entry={id:editId||uid(),type:type,status:status,myRating:myRate,animeGenre:ag,
    saison:showEp?sai:null,episode:showEp?epi:null,totalEp:showEp?totep:(ex?ex.totalEp:null),
    tags:curTags.slice(),addedAt:ex?ex.addedAt:Date.now(),
    tmdbId:selTmdb.tmdbId,tmdbType:selTmdb.tmdbType,title:selTmdb.title,year:selTmdb.year,
    poster:selTmdb.poster,overview:selTmdb.overview,tmdbScore:selTmdb.tmdbScore,
    hasNewEp:ex?ex.hasNewEp:false,nextAir:ex?ex.nextAir:null,
    collectionId:collId,collectionName:collName,
    supaId:ex?ex.supaId:null,deleted:false,updatedAtLocal:Date.now(),needsSync:true,
    reminderEnabled:ex?ex.reminderEnabled:false,nextAirDate:ex?ex.nextAirDate:null,
    lastEpisodeCheck:ex?ex.lastEpisodeCheck:null,tvmazeId:ex?ex.tvmazeId:null,
    streamingProviders:ex?ex.streamingProviders:null,genreIds:ex?ex.genreIds:null,
    omdbRatings:ex?ex.omdbRatings:null,kitsuRating:ex?ex.kitsuRating:null,
    collectionChecked:ex?ex.collectionChecked:false,tmdbCollectionId:ex?ex.tmdbCollectionId:null};
  if(editId){for(var j=0;j<memDB.length;j++){if(memDB[j].id==editId){memDB[j]=entry;break}}}else{memDB.unshift(entry);}
  if(type=='anime'&&!ag&&selTmdb.tmdbId){detectAnimeGenre(selTmdb.tmdbId,function(g){entry.animeGenre=g;for(var k=0;k<memDB.length;k++){if(memDB[k].id==entry.id){memDB[k]=entry;break}}dbPut(entry,function(){});});}
  dbPut(entry,function(){render();loadRecos();if(!editId)_removeFromDiscoverUI(entry.tmdbId);if(status=='termine'&&!wasDone){sfx('done');}else{sfx('add');}toast((editId?'Modifie':'Ajoute')+' : '+entry.title);closeAdd();if(type!='film'&&selTmdb.tmdbId)checkAir(entry);if(entry.myRating)buildTasteProfileCache();});
}
function delEntry(id){
  if(!confirm('Supprimer ?'))return;
  var item=memDB.find(function(i){return i.id==id});
  if(!item){return;}
  if(item.supaId||authUser){
    /* Item potentiellement connu de Supabase (ou compte actif) : tombstone pour propager la suppression, purge physique locale seulement apres confirmation de sync */
    item.deleted=true;item.updatedAtLocal=Date.now();item.needsSync=true;
    dbPut(item,function(){sfx('del');render();loadRecos();toast('Supprime'+(item?' : '+item.title:''),'nfo');});
  }else{
    /* Jamais connecte / jamais synchronise : suppression physique immediate (comportement historique) */
    memDB=memDB.filter(function(i){return i.id!=id});
    dbDel(id,function(){sfx('del');render();loadRecos();toast('Supprime'+(item?' : '+item.title:''),'nfo');});
  }
}

