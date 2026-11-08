/* MODULE: Actualisation des titres/affiches déjà en liste dans la langue active (Réglages → Langue).
   js/07-add-edit.js (makeEntry) enregistre titre et affiche une fois pour toutes au moment de
   l'ajout, dans la langue active à cet instant — changer la langue de l'app ensuite ne les
   retraduit jamais tout seul (seules les nouvelles recherches/nouveaux ajouts suivent TMDB_LANG).
   Action manuelle plutôt qu'automatique à chaque changement de langue : pas d'appels TMDB
   surprise, l'utilisateur décide quand. Quota TMDB très large (8000/jour/compte, cache serveur
   6h partagé entre tous les comptes, voir api/tmdb.js) : même plusieurs centaines de titres ne
   posent pas de souci de quota, d'où le lot de TR_BATCH en parallèle plutôt qu'un seul à la fois. */
var TR_BUSY=false;
var TR_BATCH=6;
function trTmdbType(item){return item.tmdbType||(item.type==='film'?'movie':'tv');}
function trEligible(){return memDB.filter(function(i){return !i.deleted&&i.tmdbId;});}
/* Exporté séparément pour les tests : n'écrit que les champs qu'on sait meilleurs (poster_path
   peut être null côté TMDB — un titre sans affiche dans cette langue reste sans affiche plutôt
   que de garder une affiche d'une autre langue à tort, cohérent avec le reste de l'app). */
function trApply(item,d,type){
  var title=type==='movie'?d.title:d.name;
  if(title)item.title=title;
  item.poster=d.poster_path||null;
  if(typeof d.overview==='string')item.overview=d.overview;
  item.updatedAtLocal=Date.now();item.needsSync=true;
}
function _trOne(item){
  var type=trTmdbType(item);
  return tf(TB+'/'+type+'/'+item.tmdbId+'?language='+TMDB_LANG).then(function(d){
    trApply(item,d,type);
    return new Promise(function(res){dbPut(item,res);});
  },function(e){
    /* Session/quota/compte non confirmé : on arrête tout le lot, pas la peine d'insister
       titre par titre (apiFetch l'a déjà signalé à l'utilisateur). Une fiche introuvable ou
       une erreur réseau ponctuelle ne doit pas bloquer le reste de la liste. */
    if(e&&/^(FORBIDDEN|QUOTA|UNCONFIRMED|AUTH_REQUIRED)$/.test(e.code))throw e;
  });
}
/* onProgress(done,total) appelé après chaque titre ; callback(ok) à la fin (ok=false si
   interrompu par une erreur d'auth/quota — le message à l'utilisateur est déjà géré par apiFetch). */
function refreshListFromTmdb(onProgress,callback){
  if(TR_BUSY)return;
  var items=trEligible();
  if(!items.length){toast(t('set.refreshLangNone'),'nfo');callback&&callback(true);return;}
  TR_BUSY=true;
  var i=0,done=0,total=items.length;
  onProgress&&onProgress(done,total);
  function next(){
    if(i>=total)return Promise.resolve();
    var batch=items.slice(i,i+TR_BATCH);i+=TR_BATCH;
    return Promise.all(batch.map(function(it){return _trOne(it).then(function(){done++;onProgress&&onProgress(done,total);});})).then(next);
  }
  next().then(function(){
    TR_BUSY=false;render();if(typeof loadRecos==='function')loadRecos();
    toast(tn('set.refreshLangDone',total),'ok');callback&&callback(true);
  },function(){
    TR_BUSY=false;render();toast(t('set.refreshLangErr'),'err');callback&&callback(false);
  });
}
if(typeof module!=='undefined')module.exports={refreshListFromTmdb:refreshListFromTmdb,trEligible:trEligible,trApply:trApply,trTmdbType:trTmdbType};
