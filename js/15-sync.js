/* MODULE: Authentification et synchronisation multi-appareils avec Supabase. */
/* ===== MODULE SYNC MULTI-APPAREILS (Session 10) ===== */

/* --- Mapping IndexedDB (camelCase) <-> Supabase (snake_case) --- */
function localToSupabase(item,profileId){
  return{
    id:item.supaId||undefined,
    local_id:item.id,
    profile_id:profileId,
    tmdb_id:item.tmdbId,
    tmdb_type:item.tmdbType,
    type:item.type,
    status:item.status,
    title:item.title,
    year:item.year,
    poster_path:item.poster,
    tmdb_score:item.tmdbScore?parseFloat(item.tmdbScore):null,
    my_rating:item.myRating,
    overview:item.overview,
    tags:item.tags||[],
    saison:item.saison,
    episode:item.episode,
    total_ep:item.totalEp,
    anime_genre:item.animeGenre,
    collection_id:item.collectionId,
    collection_name:item.collectionName,
    tmdb_collection_id:item.tmdbCollectionId,
    has_new_ep:item.hasNewEp,
    next_air:item.nextAir,
    deleted:!!item.deleted,
    updated_at:new Date(item.updatedAtLocal||Date.now()).toISOString()
  };
}
function supabaseToLocal(row){
  return{
    id:row.local_id,
    supaId:row.id,
    tmdbId:row.tmdb_id,
    tmdbType:row.tmdb_type,
    type:row.type,
    status:row.status,
    title:row.title,
    year:row.year,
    poster:row.poster_path,
    tmdbScore:row.tmdb_score,
    myRating:row.my_rating,
    overview:row.overview,
    tags:row.tags||[],
    saison:row.saison,
    episode:row.episode,
    totalEp:row.total_ep,
    animeGenre:row.anime_genre,
    collectionId:row.collection_id,
    collectionName:row.collection_name,
    tmdbCollectionId:row.tmdb_collection_id,
    hasNewEp:row.has_new_ep,
    nextAir:row.next_air,
    deleted:row.deleted,
    updatedAtLocal:new Date(row.updated_at).getTime(),
    addedAt:row.added_at?new Date(row.added_at).getTime():Date.now(),
    needsSync:false
  };
}

/* --- Auth UI --- */
var authMode='login';
function openAuthModal(){
  sfx('click');
  authMode='login';
  document.getElementById('authMbk').classList.add('on');
  refreshAuthModalView();
}
function closeAuthModal(){document.getElementById('authMbk').classList.remove('on');}
document.getElementById('authMbk').addEventListener('click',function(e){if(e.target===this){sfx('close');closeAuthModal();}});

function switchAuthTab(mode){
  if(authMode===mode)return;
  sfx('click');
  authMode=mode;
  document.getElementById('authTabLogin').classList.toggle('on',mode==='login');
  document.getElementById('authTabSignup').classList.toggle('on',mode==='signup');
  document.getElementById('authPasswordConfirmField').style.display=mode==='signup'?'block':'none';
  document.getElementById('authPassword').setAttribute('autocomplete',mode==='signup'?'new-password':'current-password');
  document.getElementById('authSubmitBtn').textContent=mode==='signup'?'Creer mon compte':'Se connecter';
  document.getElementById('authLocalNote').innerHTML=mode==='signup'
    ?'La creation de compte est libre et gratuite : email + mot de passe suffisent.<br>Tes donnees sont isolees des autres comptes.'
    :'Sans connexion, ta liste reste locale et le catalogue TMDB (recherche, recommandations) est desactive.<br>Se connecter active le catalogue et la synchronisation multi-appareils.';
  showAuthMsg('');
}

function refreshAuthModalView(){
  var out=document.getElementById('authLoggedOutView'),inn=document.getElementById('authLoggedInView');
  if(authUser){
    out.style.display='none';inn.style.display='block';
    document.getElementById('authAccountEmail').textContent=authUser.email||'';
    var dot=document.getElementById('authAccountDot');
    dot.className='sync-dot '+(navigator.onLine?'synced':'offline');
    var pending=memDB.filter(function(i){return i.needsSync}).length;
    document.getElementById('authSyncInfo').textContent=pending?(pending+' element'+(pending>1?'s':'')+' en attente de synchronisation.'):'Tout est synchronise.';
  }else{
    out.style.display='block';inn.style.display='none';
  }
}

function showAuthMsg(msg,kind){
  var m=document.getElementById('authMsg');
  m.textContent=msg;m.className='auth-msg'+(msg?' on '+(kind||'err'):'');
}

function submitAuth(){
  if(!supa){showAuthMsg('Client Supabase indisponible');return;}
  var email=(document.getElementById('authEmail').value||'').trim();
  var pass=document.getElementById('authPassword').value||'';
  if(!email||!pass){showAuthMsg('Email et mot de passe requis');return;}
  sfx('click');
  var btn=document.getElementById('authSubmitBtn');btn.disabled=true;
  var after=function(){btn.disabled=false;};
  if(authMode==='signup'){
    var confirm=document.getElementById('authPasswordConfirm').value||'';
    if(pass.length<6){after();showAuthMsg('Mot de passe trop court (6 caracteres minimum)');return;}
    if(pass!==confirm){after();showAuthMsg('Les mots de passe ne correspondent pas');return;}
    supa.auth.signUp({email:email,password:pass}).then(function(res){
      after();
      if(res.error){showAuthMsg(res.error.message);return;}
      if(res.data&&res.data.session){
        toast('Compte créé','ok');
        refreshAuthModalView();
      }else{
        showAuthMsg('Compte cree. Verifie ta boite mail pour confirmer avant de te connecter.','ok');
      }
    }).catch(function(e){after();showAuthMsg(e.message||'Erreur');});
  }else{
    supa.auth.signInWithPassword({email:email,password:pass}).then(function(res){
      after();
      if(res.error){showAuthMsg(res.error.message);return;}
      toast('Connecté','ok');
      refreshAuthModalView();
    }).catch(function(e){after();showAuthMsg(e.message||'Erreur');});
  }
}

function signOutUser(){
  if(!supa)return;
  supa.auth.signOut().then(function(){
    toast('Déconnecté','nfo');
    closeAuthModal();
  });
}

/* Cree/verifie la ligne profiles correspondante */
/* Un seul appel à la fois par utilisateur : getSession() et onAuthStateChange('SIGNED_IN')
   déclenchent tous deux onAuthResolved() au chargement ; sans ce verrou, deux profils
   étaient créés en parallèle. S'il existe déjà plusieurs profils, on prend le plus ancien. */
var _ensureProfilePromise=null,_ensureProfileUserId=null;
function _selectOldestProfile(userId){
  return supa.from('profiles').select('id').eq('account_id',userId)
    .order('created_at',{ascending:true}).order('id',{ascending:true}).limit(1);
}
function ensureProfile(user){
  if(_ensureProfilePromise&&_ensureProfileUserId===user.id)return _ensureProfilePromise;
  _ensureProfileUserId=user.id;
  _ensureProfilePromise=_selectOldestProfile(user.id).then(function(res){
    if(res.error)throw res.error;/* erreur réseau/RLS : surtout ne pas créer un profil de plus */
    if(res.data&&res.data.length)return res.data[0].id;
    return supa.from('profiles').insert({account_id:user.id,name:'Moi'}).select('id').single().then(function(ins){
      if(!ins.error)return ins.data.id;
      /* Course possible avec un autre onglet (contrainte UNIQUE account_id) : on relit */
      return _selectOldestProfile(user.id).then(function(r2){
        if(!r2.error&&r2.data&&r2.data.length)return r2.data[0].id;
        throw ins.error;
      });
    });
  });
  _ensureProfilePromise.catch(function(){_ensureProfilePromise=null;_ensureProfileUserId=null;});
  return _ensureProfilePromise;
}

/* Une seule fois par compte et par appareil : les titres créés avant la synchro (Session 10)
   ou ajoutés sans drapeau n'ont jamais été envoyés. On les marque à synchroniser. */
function markLegacyItemsDirtyOnce(userId){
  var key='wl_legacy_dirty_'+userId;
  if(localStorage.getItem(key)==='1')return 0;
  var n=0;
  memDB.forEach(function(item){
    if(!item.supaId&&!item.needsSync&&!item.deleted){
      item.needsSync=true;
      if(!item.updatedAtLocal)item.updatedAtLocal=item.addedAt||Date.now();
      dbPut(item,null);n++;
    }
  });
  localStorage.setItem(key,'1');
  return n;
}

function initAuth(){
  if(!supa){updateSyncStatusUI('anon');return;}
  supa.auth.getSession().then(function(res){
    var session=res.data&&res.data.session;
    if(session&&session.user)onAuthResolved(session.user);
    else updateSyncStatusUI('anon');
  }).catch(function(){updateSyncStatusUI('anon');});

  supa.auth.onAuthStateChange(function(event,session){
    if(event=='SIGNED_IN'&&session&&session.user){
      onAuthResolved(session.user);
    }else if(event=='SIGNED_OUT'){
      authUser=null;authProfileId=null;
      stopSyncLoop();
      updateSyncStatusUI('anon');
      refreshAuthModalView();
    }
  });
}

function onAuthResolved(user){
  /* Déjà initialisé pour ce compte (SIGNED_IN peut être réémis) : rien à refaire */
  if(authUser&&authUser.id===user.id&&authProfileId)return;
  authUser=user;
  ensureProfile(user).then(function(profileId){
    authProfileId=profileId;
    markLegacyItemsDirtyOnce(user.id);
    _onApiAuthRestored();
    refreshAuthModalView();
    updateSyncStatusUI('syncing');
    syncNow();
    startSyncLoop();
  }).catch(function(e){
    _logErr('[sync] ensureProfile',e);
    updateSyncStatusUI('offline');
  });
}

/* --- Sync pull/push --- */
/* Reporte les champs 100% locaux (jamais envoyés à Supabase) sur l'objet qui va remplacer
   memDB[j] lors d'une résolution de conflit — sinon ils seraient silencieusement perdus
   puisque supabaseToLocal() reconstruit un objet neuf sans eux (cf. Session 9 : Suivi,
   Session 11 : genreIds du profil de goût). */
function preserveSuiviFields(local,remote){
  remote.reminderEnabled=local.reminderEnabled;
  remote.nextAirDate=local.nextAirDate;
  remote.lastEpisodeCheck=local.lastEpisodeCheck;
  remote.tvmazeId=local.tvmazeId;
  remote.streamingProviders=local.streamingProviders;
  remote.genreIds=local.genreIds;
  remote.omdbRatings=local.omdbRatings;
  remote.kitsuRating=local.kitsuRating;
  remote.collectionChecked=local.collectionChecked;
  remote.tmdbCollectionId=local.tmdbCollectionId;
  return remote;
}
function syncPull(){
  if(!supa||!authProfileId)return Promise.resolve();
  return supa.from('watchlist_items').select('*').eq('profile_id',authProfileId).then(function(res){
    if(res.error){throw res.error;}
    var rows=res.data||[];
    rows.forEach(function(row){
      var localItem=memDB.find(function(i){return i.id===row.local_id;});
      var remoteTime=new Date(row.updated_at).getTime();
      if(!localItem){
        var mapped=supabaseToLocal(row);
        if(!mapped.deleted){memDB.push(mapped);dbPut(mapped,function(){});}
        else{dbPut(mapped,function(){});} /* tombstone distant jamais vu localement : on le stocke marque supprime, filtré du rendu */
      }else if(remoteTime>(localItem.updatedAtLocal||0)){
        var updated=supabaseToLocal(row);
        for(var j=0;j<memDB.length;j++){if(memDB[j].id===updated.id){
          /* Préserve les champs Suivi (Session 9) non gérés par Supabase */
          updated=preserveSuiviFields(memDB[j],updated);
          memDB[j]=updated;break;
        }}
        dbPut(updated,function(){});
      }
    });
    render();
    if(typeof renderSuivi==='function')renderSuivi();
  });
}

function syncPush(){
  if(!supa||!authProfileId)return Promise.resolve();
  var toPush=memDB.filter(function(i){return i.needsSync;});
  if(!toPush.length)return Promise.resolve();
  var chain=Promise.resolve();
  toPush.forEach(function(item){
    chain=chain.then(function(){
      var sentAt=item.updatedAtLocal;
      var payload=localToSupabase(item,authProfileId);
      return supa.from('watchlist_items').upsert(payload,{onConflict:'local_id,profile_id'}).select().then(function(res){
        if(res.error){_logErr('[sync push]',res.error);return;}
        if(res.data&&res.data[0]){
          item.supaId=res.data[0].id;
          /* Ne marque "synchronisé" que si rien n'a modifié l'item depuis l'envoi du payload —
             sinon on écraserait le besoin de push d'une modification plus récente (course avec le polling 30s). */
          if(item.updatedAtLocal===sentAt)item.needsSync=false;
          dbPut(item,function(){});
        }
      }).catch(function(e){_logErr('[sync push]',e);});
    });
  });
  return chain;
}

function syncNow(){
  if(!supa||!authProfileId||syncInProgress)return;
  if(!navigator.onLine){updateSyncStatusUI('offline');return;}
  syncInProgress=true;updateSyncStatusUI('syncing');
  syncPull().then(function(){return syncPush();}).then(function(){return syncPull();}).then(function(){
    syncInProgress=false;updateSyncStatusUI('synced');refreshAuthModalView();
  }).catch(function(e){
    syncInProgress=false;
    _logErr('[sync]',e);
    updateSyncStatusUI(navigator.onLine?'synced':'offline');
    var now=Date.now();
    if(now-lastSyncErrorToast>60000){lastSyncErrorToast=now;toast('Synchronisation impossible pour le moment','nfo');}
  });
}

function startSyncLoop(){
  stopSyncLoop();
  syncLoopTimer=setInterval(function(){
    if(authProfileId&&navigator.onLine)syncNow();
  },30000);
}
function stopSyncLoop(){if(syncLoopTimer){clearInterval(syncLoopTimer);syncLoopTimer=null;}}

/* --- Indicateur visuel --- */
function updateSyncStatusUI(state){
  var dot=document.getElementById('syncDot'),txt=document.getElementById('syncStatusText');
  if(!dot||!txt)return;
  if(state=='anon'){dot.className='sync-dot anon';txt.textContent='Non connecte';}
  else if(state=='syncing'){dot.className='sync-dot syncing';txt.textContent='Synchronisation...';}
  else if(state=='offline'){dot.className='sync-dot offline';txt.textContent='Hors ligne';}
  else{dot.className='sync-dot synced';txt.textContent='Synchronise';}
}

