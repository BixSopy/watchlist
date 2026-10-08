/* MODULE: Profil de goût local — calcul des poids genre/type utilisés pour scorer les recos. */
/* ===== SESSION 11 : PROFIL DE GOÛT LOCAL (scoring recommandations) =====
   Le profil est recalculé à la volée depuis memDB (pas de store IndexedDB dédié :
   toutes les données sources — myRating, status, type, genreIds — sont déjà dans
   les entries, donc un recalcul est aussi fiable qu'un cache et évite une migration
   de schéma IndexedDB. genreIds est un champ 100% local (jamais envoyé à Supabase,
   même logique que streamingProviders/tvmazeId du module Suivi), rempli en tâche de
   fond uniquement pour les titres notés (myRating), un par un et espacé pour ne pas
   déclencher de rate-limit TMDB. */
var _profileBuildRunning=false;
function buildTasteProfileCache(){
  if(_profileBuildRunning)return;
  var pending=memDB.filter(function(i){return i.myRating&&i.tmdbId&&!i.deleted&&(i.genreIds===undefined||i.genreIds===null);});
  if(!pending.length)return;
  _profileBuildRunning=true;
  function next(idx){
    if(idx>=pending.length){_profileBuildRunning=false;return;}
    var item=pending[idx];
    var kind=item.tmdbType||(item.type==='film'?'movie':'tv');
    tf(TB+'/'+kind+'/'+item.tmdbId+'?language='+TMDB_LANG).then(function(d){
      item.genreIds=(d.genres||[]).map(function(g){return g.id;});
    }).catch(function(){item.genreIds=[];}).finally(function(){persistSuiviItem(item);setTimeout(function(){next(idx+1);},150);});
  }
  next(0);
}
/* Poids par statut (termine compte plus qu'avoir) x boost/malus selon la note perso (1-10, 5.5=neutre) */
function computeTasteProfile(){
  var STATUS_W={termine:1,encours:0.6,avoir:0.25,todo:0.1};
  var genreW={},typeW={film:0,serie:0,anime:0};
  memDB.forEach(function(i){
    if(i.deleted)return;
    var sw=STATUS_W[i.status]||0.1;
    var rb=i.myRating?((i.myRating-5.5)/4.5):0;
    var w=sw*(1+rb);
    typeW[i.type]=(typeW[i.type]||0)+w;
    (i.genreIds||[]).forEach(function(g){genreW[g]=(genreW[g]||0)+w;});
  });
  return{genreW:genreW,typeW:typeW};
}
function _isAnimeGenreIds(gids){return(gids||[]).indexOf(16)>-1;}
/* Accepte aussi bien un objet TMDB brut (media_type/genre_ids) qu'un objet normalisé (type/genreIds) */
function scoreCandidate(d,profile){
  var mtype=d.type||d.media_type;
  var gids=d.genreIds||d.genre_ids||[];
  var appType=mtype==='movie'?'film':(_isAnimeGenreIds(gids)?'anime':'serie');
  var typeScore=profile.typeW[appType]||0;
  var genreScore=0;
  gids.forEach(function(g){genreScore+=profile.genreW[g]||0;});
  return typeScore*0.4+genreScore;
}
/* Tri stable décroissant par score de personnalisation (tie-break sur l'ordre d'origine) */
function _sortByProfile(arr,profile){
  return arr.map(function(d,i){return{d:d,s:scoreCandidate(d,profile),i:i};})
    .sort(function(a,b){return b.s-a.s||a.i-b.i;})
    .map(function(x){return x.d;});
}

/* RECOS */
function skeletonHTML(){
  var html='<div class="sb-loading">';
  for(var i=0;i<4;i++){html+='<div class="sb-skeleton-card"><div class="sk-img"></div><div class="sk-body"><div class="sk-title"></div><div class="sk-meta"></div><div class="sk-meta" style="width:50%"></div></div></div>';}
  html+='</div>';return html;
}
