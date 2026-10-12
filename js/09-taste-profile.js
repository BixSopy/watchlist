/* MODULE: Profil de goût local — calcul des poids genre/mot-clé/casting/décennie/origine
   utilisés pour scorer les recos, enrichi d'un signal implicite (binge détecté par
   l'extension) et d'un signal négatif (recos explicitement refusées), avec exploration
   pour éviter la chambre d'écho. */
/* ===== MOTEUR DE RECOMMANDATION — CŒUR PUR (testé par tests/taste-profile.test.js) =====
   Aucune donnée TMDB (keywords/cast/crew) n'est jamais demandée pour les CANDIDATS d'un
   lot de recos (ça reviendrait à refaire l'erreur de quota corrigée ailleurs) : seuls les
   champs déjà gratuits sur les résultats discover/trending (genre_ids, date, origin_country
   pour les séries) servent au reclassement. Les mots-clés/casting/réalisateur, eux, ne sont
   connus QUE pour les titres de la propre liste de l'utilisateur (un seul appel
   TMDB par titre, append_to_response) et servent à FORMULER de nouvelles requêtes ciblées
   ("parce que tu aimes [mot-clé/réalisateur]"), pas à renoter des candidats au hasard. */
var TASTE_CORE=(function(){
  var STATUS_W={termine:1,encours:0.6,avoir:0.25,todo:0.1};
  var HALF_LIFE_MS=240*86400000;/* goût récent compte plus ; un coup de cœur d'il y a 2 ans pèse ~15% */
  function decay(ts,now){
    if(!ts)return 0.6;
    var age=Math.max(0,(now==null?Date.now():now)-ts);
    return Math.pow(0.5,age/HALF_LIFE_MS);
  }
  function ratingBias(myRating){return myRating?((myRating-5.5)/4.5):0;}
  function decadeOf(year){var y=parseInt(year,10);return y?Math.floor(y/10)*10:null;}
  /* Momentum de visionnage détecté (extension, lignes detected_media state='added') :
     récence + volume, plafonné — un énorme binge ne doit pas écraser le reste du profil. */
  function bingeMomentum(rows,now){
    var m=0;
    (rows||[]).forEach(function(r){
      var ts=r&&r.watched_at?Date.parse(r.watched_at):NaN;
      if(!isNaN(ts))m+=decay(ts,now);
    });
    return Math.min(3,m);
  }
  /* x1 (rien détecté) à x1.5 (gros binge récent) — signal implicite, toujours plus faible
     qu'une note explicite (voir le rapport souhaité par Pierre : note > comportement). */
  function bingeBoost(momentum){return 1+Math.min(0.5,momentum*0.15);}
  function add(bucket,key,w){if(key==null||key===''||!bucket)return;bucket[key]=(bucket[key]||0)+w;}
  /* items : memDB (actifs) ; opts.now ; opts.bingeFor(item)->rows[] ; opts.dismissedMeta
     {id:{genreIds,decade,originCountry,ts}} — recos explicitement refusées, signal négatif. */
  function computeProfileCore(items,opts){
    opts=opts||{};
    var now=opts.now==null?Date.now():opts.now;
    var bingeFor=opts.bingeFor||function(){return[];};
    var W={genreW:{},typeW:{film:0,serie:0,anime:0},keywordW:{},castW:{},crewW:{},decadeW:{},originW:{}};
    (items||[]).forEach(function(i){
      if(!i||i.deleted)return;
      var sw=STATUS_W[i.status]||0.1;
      var rb=ratingBias(i.myRating);
      var dk=decay(i.updatedAtLocal,now);
      var rows=bingeFor(i);
      var boost=rows&&rows.length?bingeBoost(bingeMomentum(rows,now)):1;
      var w=sw*(1+rb)*dk*boost;
      add(W.typeW,i.type,w);
      (i.genreIds||[]).forEach(function(g){add(W.genreW,g,w);});
      (i.keywordIds||[]).forEach(function(k){add(W.keywordW,k,w*0.8);});
      (i.castIds||[]).forEach(function(c){add(W.castW,c,w*0.6);});
      if(i.crewId)add(W.crewW,i.crewId,w*0.9);
      add(W.decadeW,decadeOf(i.year),w*0.3);
      if(i.originCountry)add(W.originW,i.originCountry,w*0.3);
    });
    var dismissedMeta=opts.dismissedMeta||{};
    Object.keys(dismissedMeta).forEach(function(id){
      var d=dismissedMeta[id];if(!d)return;
      var w=-0.5*decay(d.ts,now);/* malus — jamais aussi fort qu'un coup de cœur (poids max ~1) */
      (d.genreIds||[]).forEach(function(g){add(W.genreW,g,w);});
      if(d.decade!=null)add(W.decadeW,d.decade,w*0.5);
      if(d.originCountry)add(W.originW,d.originCountry,w*0.5);
    });
    return W;
  }
  /* cand : {appType,genreIds,year,originCountry} — champs gratuits sur discover/trending */
  function scoreCore(cand,profile){
    if(!cand||!profile)return 0;
    var genreScore=0;
    (cand.genreIds||[]).forEach(function(g){genreScore+=profile.genreW[g]||0;});
    var decadeScore=0,dec=decadeOf(cand.year);if(dec!=null)decadeScore=profile.decadeW[dec]||0;
    var originScore=cand.originCountry?(profile.originW[cand.originCountry]||0):0;
    var typeScore=profile.typeW[cand.appType]||0;
    return typeScore*0.4+genreScore+decadeScore*0.5+originScore*0.5;
  }
  /* Classement pondéré décroissant des clés d'un bucket (genreW/keywordW/castW/crewW),
     pour formuler des requêtes TMDB ciblées ("parce que tu aimes X") — jamais pour
     renoter des candidats (voir en-tête du module). */
  function topKeys(bucket,n,minW){
    return Object.keys(bucket||{}).filter(function(k){return bucket[k]>(minW==null?0:minW);})
      .sort(function(a,b){return bucket[b]-bucket[a];}).slice(0,n==null?3:n);
  }
  /* Explore/exploit façon "Pour toi" : garde les meilleurs, réserve une part de tirage
     PONDÉRÉ (pas pur hasard) dans le reste, pour éviter que les recos tournent toujours
     sur le même genre dominant. rng injectable (tests déterministes). */
  function pickWithExploration(scored,n,exploreRatio,rng){
    rng=rng||Math.random;
    var sorted=(scored||[]).slice().sort(function(a,b){return b.s-a.s;});
    if(!exploreRatio||n>=sorted.length)return sorted.slice(0,n).map(function(x){return x.d;});
    var nExplore=Math.min(sorted.length-Math.ceil(n*(1-exploreRatio)),Math.round(n*exploreRatio));
    nExplore=Math.max(0,nExplore);
    var nTop=n-nExplore;
    var top=sorted.slice(0,nTop),pool=sorted.slice(nTop).slice();
    var picks=[];
    var weight=function(x){return Math.max(0.01,x.s+10);};/* décalage : un score négatif reste tirable */
    var total=pool.reduce(function(s,x){return s+weight(x);},0);
    for(var k=0;k<nExplore&&pool.length;k++){
      var r=rng()*total,acc=0,idx=pool.length-1;
      for(var j=0;j<pool.length;j++){acc+=weight(pool[j]);if(acc>=r){idx=j;break;}}
      picks.push(pool[idx]);total-=weight(pool[idx]);pool.splice(idx,1);
    }
    return top.concat(picks).map(function(x){return x.d;});
  }
  return{STATUS_W:STATUS_W,decay:decay,ratingBias:ratingBias,decadeOf:decadeOf,bingeMomentum:bingeMomentum,
    bingeBoost:bingeBoost,computeProfileCore:computeProfileCore,scoreCore:scoreCore,topKeys:topKeys,
    pickWithExploration:pickWithExploration};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=TASTE_CORE;

/* ======================= Intégration (navigateur) ======================= */
/* genreIds/keywordIds/castIds/crewId/decade (année)/originCountry : champs 100% locaux
   (jamais envoyés à Supabase, même logique que streamingProviders/tvmazeId — voir
   preserveSuiviFields dans js/15-sync.js), remplis en tâche de fond un par un, espacés pour
   ne pas déclencher de rate-limit TMDB. Un seul appel par titre (append_to_response) : pas
   de coût de quota supplémentaire par rapport à l'ancienne version (genres seuls). Plafonné
   par session (TASTE_ENRICH_MAX) : une très grosse liste se complète sur plusieurs visites,
   jamais tout d'un coup. */
var _profileBuildRunning=false;
var TASTE_ENRICH_MAX=150;
var _keywordNames={};/* {id:name}, rempli au fil de l'enrichissement — pour l'intitulé des recos ciblées */
function buildTasteProfileCache(){
  if(_profileBuildRunning)return;
  /* Les titres notés ET les titres suivis (encours/terminé) méritent des traits de goût :
     le statut seul pèse déjà dans le profil, pas seulement la note. */
  var pending=memDB.filter(function(i){
    return i.tmdbId&&!i.deleted&&(i.genreIds===undefined||i.genreIds===null)
      &&(i.myRating||i.status==='encours'||i.status==='termine');
  }).slice(0,TASTE_ENRICH_MAX);
  if(!pending.length)return;
  _profileBuildRunning=true;
  function next(idx){
    if(idx>=pending.length){_profileBuildRunning=false;return;}
    var item=pending[idx];
    var kind=item.tmdbType||(item.type==='film'?'movie':'tv');
    tf(TB+'/'+kind+'/'+item.tmdbId+'?language='+TMDB_LANG+'&append_to_response=keywords,credits').then(function(d){
      item.genreIds=(d.genres||[]).map(function(g){return g.id;});
      var kw=(d.keywords&&(d.keywords.keywords||d.keywords.results))||[];
      item.keywordIds=kw.slice(0,8).map(function(k){return k.id;});
      kw.forEach(function(k){if(k&&k.id!=null)_keywordNames[k.id]=k.name;});
      var cast=(d.credits&&d.credits.cast)||[];
      item.castIds=cast.slice(0,5).map(function(c){return c.id;});
      var crew=(d.credits&&d.credits.crew)||[];
      var lead=crew.find(function(c){return c.job==='Director';})||crew.find(function(c){return c.job==='Creator'||c.department==='Writing';});
      item.crewId=lead?lead.id:null;
      item.originCountry=(d.origin_country&&d.origin_country[0])||(d.production_countries&&d.production_countries[0]&&d.production_countries[0].iso_3166_1)||null;
    }).catch(function(){item.genreIds=item.genreIds||[];}).finally(function(){persistSuiviItem(item);setTimeout(function(){next(idx+1);},150);});
  }
  next(0);
}

/* ----- Signal implicite : visionnages détectés par l'extension (Netflix/Crunchyroll/Prime) -----
   Lignes detected_media déjà validées (state='added', donc déjà dans la liste) : récence et
   volume de visionnage par titre, sans aucune requête TMDB supplémentaire (l'item correspondant
   dans memDB a déjà son tmdbId et ses traits). Rafraîchi au plus toutes les 15 min. */
var _bingeByTitle={},_bingeLoadedAt=0;
function loadBingeSignal(force){
  if(typeof supa==='undefined'||!supa||!authUser)return Promise.resolve();
  if(!force&&Date.now()-_bingeLoadedAt<900000)return Promise.resolve();
  return supa.from('detected_media').select('normalized_title,watched_at').eq('state','added')
    .order('watched_at',{ascending:false}).limit(3000).then(function(res){
      if(res.error)throw res.error;
      var by={};
      (res.data||[]).forEach(function(r){if(r&&r.normalized_title)(by[r.normalized_title]=by[r.normalized_title]||[]).push(r);});
      _bingeByTitle=by;_bingeLoadedAt=Date.now();
    }).catch(function(e){if(typeof _logErr==='function')_logErr('[profil de goût] binge',e);});
}
function _bingeForItem(item){
  if(typeof DET_CORE==='undefined'||!item||!item.title)return[];
  var norm=DET_CORE.normalizeTitle(item.title);
  return norm?(_bingeByTitle[norm]||[]):[];
}

/* Profil de goût courant, calculé à la volée (pas de store dédié : tout est déjà dans memDB,
   un recalcul est aussi fiable qu'un cache et évite une migration IndexedDB). */
function computeTasteProfile(){
  return TASTE_CORE.computeProfileCore(memDB,{bingeFor:_bingeForItem,dismissedMeta:dismissedMeta});
}
function _isAnimeGenreIds(gids){return(gids||[]).indexOf(16)>-1;}
/* Accepte aussi bien un objet TMDB brut (media_type/genre_ids/origin_country) qu'un objet
   normalisé (type/genreIds/originCountry). */
function scoreCandidate(d,profile){
  var mtype=d.type||d.media_type;
  var gids=d.genreIds||d.genre_ids||[];
  var isM=mtype==='movie'||mtype==='film';
  var year=d.year||(isM?(d.release_date||'').slice(0,4):(d.first_air_date||'').slice(0,4));
  var origin=d.originCountry||(d.origin_country&&d.origin_country[0])||null;
  var appType=isM?'film':(_isAnimeGenreIds(gids)?'anime':'serie');
  return TASTE_CORE.scoreCore({appType:appType,genreIds:gids,year:year,originCountry:origin},profile);
}
/* Tri stable décroissant par score de personnalisation (tie-break sur l'ordre d'origine) */
function _sortByProfile(arr,profile){
  return arr.map(function(d,i){return{d:d,s:scoreCandidate(d,profile),i:i};})
    .sort(function(a,b){return b.s-a.s||a.i-b.i;})
    .map(function(x){return x.d;});
}
/* Comme _sortByProfile, mais réserve exploreRatio du résultat à un tirage pondéré hors du
   strict top-score (évite la chambre d'écho, façon "Pour toi" des plateformes vidéo). */
function _pickByProfile(arr,profile,n,exploreRatio){
  var scored=arr.map(function(d,i){return{d:d,s:scoreCandidate(d,profile),i:i};});
  return TASTE_CORE.pickWithExploration(scored,n,exploreRatio);
}
var RECO_EXPLORE_RATIO=0.2;/* ~1 suggestion sur 5 vient d'un tirage pondéré, pas du pur score */

/* RECOS */
function skeletonHTML(){
  var html='<div class="sb-loading">';
  for(var i=0;i<4;i++){html+='<div class="sb-skeleton-card"><div class="sk-img"></div><div class="sk-body"><div class="sk-title"></div><div class="sk-meta"></div><div class="sk-meta" style="width:50%"></div></div></div>';}
  html+='</div>';return html;
}
