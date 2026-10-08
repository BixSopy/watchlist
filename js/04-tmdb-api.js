/* MODULE: Proxy API TMDB/OMDb (auth, cache 24h), détection de genre anime, bande-annonce. */
/* API PROXY — TMDB/OMDb via /api (session Supabase obligatoire, clés jamais côté client) */
var _apiAuthState=null;/* null | 'login' | 'forbidden' | 'unconfirmed' | 'quota' */
var _apiAuthToastAt=0;
/* /api/tmdb/movie/1?language=fr-FR → /api/tmdb?path=%2Fmovie%2F1&language=fr-FR */
function _toProxyUrl(url){
  if(url.indexOf(TB+'/')!==0)return url;
  var rest=url.slice(TB.length),qi=rest.indexOf('?');
  var path=qi<0?rest:rest.slice(0,qi),qs=qi<0?'':rest.slice(qi+1);
  return TB+'?path='+encodeURIComponent(path)+(qs?'&'+qs:'');
}
function _getAccessToken(){
  if(!supa)return Promise.resolve(null);
  return supa.auth.getSession().then(function(r){
    var s=r&&r.data&&r.data.session;return s&&s.access_token?s.access_token:null;
  }).catch(function(){return null;});
}
function _authError(state){var e=new Error(state.toUpperCase());e.code=({forbidden:'FORBIDDEN',quota:'QUOTA',unconfirmed:'UNCONFIRMED'})[state]||'AUTH_REQUIRED';return e;}
/* Lit le code d'erreur JSON du proxy sans consommer la réponse d'origine */
function _proxyErrorCode(r){return r.clone().json().then(function(d){return (d&&d.error)||'';}).catch(function(){return '';});}
function apiFetch(url){
  /* Kitsu/TVmaze (sans clé) : appel direct, jamais de jeton Supabase envoyé à un tiers */
  if(url.indexOf('/api/')!==0)return fetch(url,{credentials:'omit'});
  return _getAccessToken().then(function(tok){
    if(!tok){_notifyLoginRequired('login');throw _authError('login');}
    return fetch(_toProxyUrl(url),{headers:{Authorization:'Bearer '+tok},credentials:'omit'}).then(function(r){
      if(r.status===401){_notifyLoginRequired('login');throw _authError('login');}
      if(r.status===403||r.status===429){
        return _proxyErrorCode(r).then(function(code){
          if(r.status===403){var st=code==='email_unconfirmed'?'unconfirmed':'forbidden';_notifyLoginRequired(st);throw _authError(st);}
          if(code==='quota_exceeded'){_notifyLoginRequired('quota');throw _authError('quota');}
          return r;/* rafale (rate_limited) : erreur ordinaire, gérée par l'appelant */
        });
      }
      return r;
    });
  });
}
var _API_STATE_MSG={
  login:t('api.msg.login'),
  forbidden:t('api.msg.forbidden'),
  unconfirmed:t('api.msg.unconfirmed'),
  quota:t('api.msg.quota')
};
function _loginMsgHtml(){
  var st=_apiAuthState||'login';
  var cta=st==='login'?'<div class="sb-cta"><button class="btn btn-primary" onclick="openAuthModal(\'signup\')">'+esc(t('auth.createAccount'))+'</button><button class="btn btn-ghost" onclick="openAuthModal(\'login\')">'+esc(t('auth.signIn'))+'</button></div>'
    :st==='unconfirmed'?'<div class="sb-cta"><button class="btn btn-ghost" onclick="openAuthModal(\'account\')">'+esc(t('auth.myAccount'))+'</button></div>':'';
  return '<div class="sb-loading sb-auth-msg">'+esc(_API_STATE_MSG[st]||_API_STATE_MSG.login)+cta+'</div>';
}
function _paintLoginRequired(){
  if(!_apiAuthState)return;
  var sb=document.getElementById('sbContent');if(sb)sb.innerHTML=_loginMsgHtml();
  var ds=document.getElementById('discoverSection');if(ds)ds.innerHTML=_loginMsgHtml();
}
var _API_STATE_TOAST={
  login:t('api.toast.login'),
  forbidden:t('api.toast.forbidden'),
  unconfirmed:t('api.toast.unconfirmed'),
  quota:t('api.toast.quota')
};
function _notifyLoginRequired(state){
  _apiAuthState=state||'login';
  setTimeout(_paintLoginRequired,0);
  if(Date.now()-_apiAuthToastAt>60000){
    _apiAuthToastAt=Date.now();
    toast(_API_STATE_TOAST[_apiAuthState]||_API_STATE_TOAST.login,'nfo');
  }
}
/* Après connexion : on relance ce qui avait échoué faute de session */
function _onApiAuthRestored(){
  if(!_apiAuthState)return;
  _apiAuthState=null;cache={};_drCache={};
  loadRecos();loadDiscovery(activeTab);
}

/* CACHE FETCH — TTL 24h pour que le throttle Suivi (lastEpisodeCheck) redevienne effectif en session longue */
var TF_CACHE_TTL=86400000;
function tf(url){
  var c=cache[url];
  if(c&&(Date.now()-c.t)<TF_CACHE_TTL)return Promise.resolve(c.d);
  return apiFetch(url).then(function(r){
    /* Une réponse d'erreur (401, 429, 5xx...) n'est jamais mise en cache */
    if(!r.ok){var e=new Error('HTTP '+r.status);e.status=r.status;throw e;}
    return r.json();
  }).then(function(d){
    if(!_isApiErrorBody(d))cache[url]={d:d,t:Date.now()};
    return d;
  });
}
/* Corps d'erreur renvoyés avec un statut 200 : TMDB (success:false), OMDb (quota/clé) */
function _isApiErrorBody(d){
  if(!d||typeof d!=='object')return true;
  if(d.success===false)return true;
  if(d.Response==='False'&&/limit|key/i.test(d.Error||''))return true;
  return false;
}

/* ANIME GENRE DETECT */
var KW_SHONEN=['shonen','shounen','superpower','martial arts','ninja','pirate','demon slayer','dragon ball'];
var KW_SEINEN=['seinen','psychological','thriller','berserk','vinland','mature','gore'];
var KW_SHOJO=['shojo','shoujo','romance','magical girl','fruits basket'];
var KW_ISEKAI=['isekai','another world','reincarnation','transported','summoned to'];
var KW_SLICE=['slice of life','daily life','school life','coming of age','moe','everyday'];
function detectAnimeGenre(tmdbId,cb){
  tf(TB+'/tv/'+tmdbId+'?language=en-US&append_to_response=keywords').then(function(d){
    var g=(d.genres||[]).map(function(x){return x.name.toLowerCase()});
    var k=((d.keywords&&d.keywords.results)||[]).map(function(x){return x.name.toLowerCase()});
    var all=g.concat(k).join(' ');var genre='autre';
    if(KW_ISEKAI.some(function(w){return all.indexOf(w)>-1}))genre='isekai';
    else if(KW_SLICE.some(function(w){return all.indexOf(w)>-1}))genre='slice';
    else if(KW_SHOJO.some(function(w){return all.indexOf(w)>-1}))genre='shojo';
    else if(KW_SEINEN.some(function(w){return all.indexOf(w)>-1}))genre='seinen';
    else if(KW_SHONEN.some(function(w){return all.indexOf(w)>-1}))genre='shonen';
    else if(all.indexOf('action')>-1||all.indexOf('adventure')>-1)genre='shonen';
    cb(genre);
  }).catch(function(){cb('autre');});
}

/* TRAILER */
function getTrailer(type,id,sn,cb){
  var u=sn?TB+'/tv/'+id+'/season/'+sn+'/videos?language='+TMDB_LANG:TB+'/'+type+'/'+id+'/videos?language='+TMDB_LANG;
  tf(u).then(function(d){
    var v=(d.results||[]).filter(function(x){return x.site=='YouTube'&&(x.type=='Trailer'||x.type=='Teaser')});
    if(!v.length){
      var u2=sn?TB+'/tv/'+id+'/season/'+sn+'/videos?language=en-US':TB+'/'+type+'/'+id+'/videos?language=en-US';
      tf(u2).then(function(d2){var v2=(d2.results||[]).filter(function(x){return x.site=='YouTube'&&(x.type=='Trailer'||x.type=='Teaser')});cb(v2.length?v2[0].key:null);}).catch(function(){cb(null)});
    }else{cb(v[0].key);}
  }).catch(function(){cb(null)});
}
function openYT(key){if(key)window.open('https://www.youtube.com/watch?v='+encodeURIComponent(key),'_blank','noopener');}

