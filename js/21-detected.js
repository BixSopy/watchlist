/* MODULE: Onglet « Détectés » — titres détectés par l'extension (historique Netflix, fichier CSV
   Netflix, détection en direct ; plus tard Crunchyroll et Prime), table public.detected_media.
   L'extension envoie ce qu'elle a vu (titre, film/série, dernier épisode, date) ; ici, avec la
   session de l'utilisateur (RLS) : correspondance avec la liste (même normalisation que le serveur),
   recherche TMDB des titres absents (proxy habituel, quota du compte), puis ajout ou mise à jour
   des titres choisis avec le code d'ajout normal (makeEntry, js/07-add-edit.js). Rien n'est modifié
   dans la liste sans un clic sur « Ajouter la sélection » ou « Tout ajouter ».
   Le cœur (DET_CORE) est pur, sans DOM : testé par tests/detected.test.js. */

var DET_CORE=(function(){
  /* ---------- Normalisation (identique à public.normalize_title_for_match) ---------- */
  var FROM='ÀÁÂÃÄÅĀĂĄÇĆĈĊČĎĐÈÉÊËĒĔĖĘĚĜĞĠĢĤĦÌÍÎÏĨĪĬĮİĴĶĹĻĽĿŁÑŃŅŇÒÓÔÕÖØŌŎŐŔŖŘŚŜŞŠŢŤŦÙÚÛÜŨŪŬŮŰŲŴÝŸŶŹŻŽ'
    +'àáâãäåāăąçćĉċčďđèéêëēĕėęěĝğġģĥħìíîïĩīĭįıĵķĺļľŀłñńņňòóôõöøōŏőŕŗřśŝşšţťŧùúûüũūŭůűųŵýÿŷźżž';
  var TO='AAAAAAAAACCCCCDDEEEEEEEEEGGGGHHIIIIIIIIIJKLLLLLNNNNOOOOOOOOORRRSSSSTTTUUUUUUUUUUWYYYZZZ'
    +'aaaaaaaaacccccddeeeeeeeeegggghhiiiiiiiiijklllllnnnnooooooooorrrsssstttuuuuuuuuuuwyyyzzz';
  function normalizeTitle(title){
    if(typeof title!=='string')return null;
    var v=title.replace(/Œ/g,'oe').replace(/œ/g,'oe').replace(/Æ/g,'ae').replace(/æ/g,'ae').replace(/ß/g,'ss');
    v=v.replace(/./g,function(ch){var i=FROM.indexOf(ch);return i<0?ch:TO.charAt(i);});
    v=v.toLowerCase();
    v=v.replace(/\s*[([]\s*(18|19|20)\d{2}\s*[)\]]\s*$/,'');
    v=v.replace(/[[\]\s!"#$%&'()*+,./:;<=>?@\\^_`{|}~’‘‛`´“”„«»‹›¡¿…–—―·•°-]+/g,' ');
    v=v.trim();
    if(/^(the|le|la|les|l) ./.test(v))v=v.replace(/^(the|le|la|les|l) /,'');
    return v===''?null:v;
  }

  /* ---------- Regroupement des détections par titre ---------- */
  var DONE_PCT=80;/* épisode commencé (pourcentage connu < 80 %) : pas compté comme vu */
  function counted(r){return r.progress_pct===null||r.progress_pct===undefined||r.progress_pct>=DONE_PCT;}
  function furthest(a,b){
    if(!a)return b||null;if(!b)return a;
    if(b.season>a.season||(b.season===a.season&&b.episode>a.episode))return b;
    if(b.season===a.season&&b.episode===a.episode&&a.approx&&!b.approx)return b;
    return a;
  }
  function ms(v){var n=v?Date.parse(v):NaN;return isNaN(n)?null:n;}
  /* Lignes en attente -> un groupe par (film/série, titre normalisé) */
  function groupRows(rows){
    var by={},order=[];
    (rows||[]).forEach(function(r){
      if(!r||r.state!=='pending'||!r.normalized_title)return;
      var kind=r.media_type==='movie'?'movie':'show';
      var key=kind+':'+r.normalized_title;
      var g=by[key];
      if(!g){g=by[key]={key:key,kind:kind,norm:r.normalized_title,title:r.raw_title,ids:[],sources:[],progress:null,lastMs:null,unknownProgress:false};order.push(key);}
      g.ids.push(r.id);
      if(g.sources.indexOf(r.source)<0)g.sources.push(r.source);
      var w=ms(r.watched_at);
      if(w!==null&&(g.lastMs===null||w>g.lastMs)){g.lastMs=w;g.title=r.raw_title;}
      if(kind==='show'){
        if(Number.isInteger(r.season)&&Number.isInteger(r.episode)){
          if(counted(r))g.progress=furthest(g.progress,{season:r.season,episode:r.episode,approx:r.source==='netflix_csv',src:r.source});
        }else g.unknownProgress=true;
      }
    });
    return order.map(function(k){var g=by[k];if(g.progress)g.unknownProgress=false;return g;})
      .sort(function(a,b){return(b.lastMs||0)-(a.lastMs||0);});
  }

  /* ---------- Correspondance avec la liste ---------- */
  function typeOk(kind,item){return kind==='movie'?item.type==='film':(item.type==='serie'||item.type==='anime');}
  function listMatches(group,items){
    return(items||[]).filter(function(it){return it&&!it.deleted&&typeOk(group.kind,it)&&normalizeTitle(it.title||'')===group.norm;});
  }
  /* La détection fait-elle avancer ce titre ? Un titre terminé reste terminé (revisionnage). */
  function movesForward(item,group){
    if(item.status==='termine')return false;
    if(group.kind==='movie')return true;
    var p=group.progress;
    if(!p)return false;
    if(item.saison===null||item.saison===undefined||item.episode===null||item.episode===undefined)return true;
    if(p.season>item.saison)return true;
    if(p.season===item.saison&&p.episode>item.episode)return true;
    return p.season===item.saison&&p.episode===item.episode&&(item.status==='avoir'||item.status==='todo');
  }
  /* Même fiche TMDB déjà dans la liste (titre traduit différemment) */
  function itemByTmdb(items,cand,kind){
    if(!cand)return null;
    for(var i=0;i<(items||[]).length;i++){
      var it=items[i];
      if(it&&!it.deleted&&it.tmdbId==cand.tmdbId&&(!it.tmdbType||it.tmdbType===cand.tmdbType)&&typeOk(kind,it))return it;
    }
    return null;
  }

  /* ---------- Choix de la fiche TMDB ---------- */
  /* MATCH_MIN : ressemblance pour une fiche retenue d'office ; MATCH_LOW : fiche seulement proposée
     dans la liste de choix ; MATCH_GOOD : assez bon pour arrêter de chercher (requêtes suivantes évitées) */
  var MATCH_MIN=0.86,MATCH_GAP=0.06,MATCH_LOW=0.55,MATCH_GOOD=0.92;
  function levenshtein(a,b){
    if(a===b)return 0;if(!a.length||!b.length)return Math.max(a.length,b.length);
    var prev=[],cur=[],i,j;
    for(j=0;j<=b.length;j++)prev[j]=j;
    for(i=1;i<=a.length;i++){
      cur[0]=i;
      for(j=1;j<=b.length;j++)cur[j]=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+(a.charAt(i-1)===b.charAt(j-1)?0:1));
      var tmp=prev;prev=cur;cur=tmp;
    }
    return prev[b.length];
  }
  /* Titres « Netflix » -> requêtes TMDB, de la plus précise à la plus large :
     « Stranger Things : Saison 4 » -> « Stranger Things » ; « La Casa de Papel : Partie 5 » ->
     « La Casa de Papel » ; « The Witcher : Le sang des origines : Série limitée » ->
     « The Witcher : Le sang des origines », puis « The Witcher » ; « Glass Onion (2022) » -> « Glass Onion ». */
  var SUFFIX_RES=[
    /\s*[:\-–—]\s*(?:saison|season|partie|part|volume|vol\.?|livre|book|chapitre|chapter|[ée]pisode|episode|s[ée]rie limit[ée]e|mini[- ]?s[ée]rie|limited series)\b(?:\s*\d{1,3})?\s*[:\-–—]\s+.*$/i,
    /\s*[:\-–—,]?\s*\(?(?:saison|season|staffel|temporada|stagione|partie|part|parte|volume|vol\.?|livre|book|chapitre|chapter|collection|cours|cour)\s*\d{1,3}\)?\s*$/i,
    /\s*[:\-–—,]?\s*\(?(?:s[ée]rie limit[ée]e|mini[- ]?s[ée]rie|limited series|miniseries|mini-series|the movie|le film|la s[ée]rie|the series)\)?\s*$/i,
    /\s*[:\-–—,]?\s*\(?(?:saison|season|partie|part)\s+(?:un|une|deux|trois|quatre|cinq|one|two|three|four|five|finale?|final)\)?\s*$/i,
    /\s*[([]\s*(?:18|19|20)\d{2}\s*[)\]]\s*$/,
    /\s*[:\-–—]\s*$/,
  ];
  function cleanSearchTitle(title){
    var v=String(title||'').replace(/\s+/g,' ').trim(),prev;
    do{prev=v;for(var i=0;i<SUFFIX_RES.length;i++)v=v.replace(SUFFIX_RES[i],'').trim();}while(v!==prev&&v);
    return v||String(title||'').trim();
  }
  function searchQueries(title){
    var out=[];
    function add(q){q=String(q||'').trim();if(q.length>=2&&out.indexOf(q)<0)out.push(q);}
    var full=cleanSearchTitle(title);
    add(full);
    var colon=full.search(/\s*[:：]\s+|\s+[-–—]\s+/);
    if(colon>1)add(cleanSearchTitle(full.slice(0,colon)));
    add(String(title||'').trim());
    return out.slice(0,3);
  }
  /* Ressemblance : meilleure paire (variantes du titre détecté) × (titre, titre original, autres
     titres). Variante pondérée : le nom avant les deux-points (« The Witcher » pour « The Witcher :
     Le sang des origines ») plafonne sous MATCH_MIN, la fiche est proposée mais jamais retenue d'office. */
  var PREFIX_WEIGHT=0.85;
  function similarity(norm,cand,alts){
    var as=[{n:norm,w:1}].concat((alts||[]).map(function(a){return typeof a==='string'?{n:a,w:1}:a;})).filter(function(a){return a&&a.n;});
    var bs=[normalizeTitle(cand.title||''),normalizeTitle(cand.originalTitle||'')].concat((cand.altTitles||[]).map(normalizeTitle)).filter(Boolean),score=0;
    as.forEach(function(a){bs.forEach(function(b){var sc=(a.n===b?1:1-levenshtein(a.n,b)/Math.max(a.n.length,b.length))*a.w;if(sc>score)score=sc;});});
    return score;
  }
  function queryNorms(group){
    var title=String(group.title||''),full=cleanSearchTitle(title),out=[];
    searchQueries(title).forEach(function(q){
      var n=normalizeTitle(q);if(!n||n===group.norm)return;
      var prefix=q.length<full.length&&full.indexOf(q)===0;
      out.push({n:n,w:prefix?PREFIX_WEIGHT:1});
    });
    return out;
  }
  /* Un résultat TMDB (search/tv, search/movie ou search/multi) -> candidat, ou null */
  function toCandidate(group,r){
    if(!r||!r.id)return null;
    var mt=r.media_type||(group.kind==='movie'?'movie':'tv');
    if(mt!=='movie'&&mt!=='tv')return null;
    var isMovie=mt==='movie';
    return{tmdbId:r.id,tmdbType:isMovie?'movie':'tv',title:(isMovie?r.title:r.name)||'',originalTitle:(isMovie?r.original_title:r.original_name)||'',altTitles:[],
      year:String((isMovie?r.release_date:r.first_air_date)||'').slice(0,4),poster:r.poster_path||null,overview:r.overview||'',
      score:typeof r.vote_average==='number'&&r.vote_average>0?r.vote_average.toFixed(1):null,popularity:r.popularity||0,
      genreIds:r.genre_ids||[],originCountry:r.origin_country||[]};
  }
  /* Résultats TMDB -> candidats classés (5 au plus). opts.previous : candidats déjà trouvés (autre
     langue, autre requête) fusionnés par fiche ; opts.manual : recherche tapée par l'utilisateur
     (aucun seuil, type de la fiche libre). Un film/une série de l'autre type est un peu pénalisé. */
  function rankCandidates(group,results,opts){
    opts=opts||{};
    var by={},order=[],alts=queryNorms(group);
    function put(c){
      var k=c.tmdbType+':'+c.tmdbId,e=by[k];
      if(!e){by[k]=c;order.push(k);return;}
      [c.title,c.originalTitle].concat(c.altTitles||[]).forEach(function(x){if(x&&x!==e.title&&x!==e.originalTitle&&e.altTitles.indexOf(x)<0)e.altTitles.push(x);});
      if(!e.poster&&c.poster)e.poster=c.poster;
      if(!e.overview&&c.overview)e.overview=c.overview;
    }
    (opts.previous||[]).forEach(function(c){put(Object.assign({},c,{altTitles:(c.altTitles||[]).slice()}));});
    (results||[]).forEach(function(r){var c=toCandidate(group,r);if(c)put(c);});
    var wanted=group.kind==='movie'?'movie':'tv',out=[];
    order.forEach(function(k){
      var c=by[k];
      if(!c.title)return;
      c.match=similarity(group.norm,c,opts.manual?alts.concat([{n:normalizeTitle(opts.query||''),w:1}]):alts);
      if(c.tmdbType!==wanted)c.match=Math.max(0,c.match-0.04);
      c.manual=!!opts.manual;
      if(opts.manual||c.match>=MATCH_LOW)out.push(c);
    });
    out.sort(function(x,y){return y.match-x.match||y.popularity-x.popularity;});
    return out.slice(0,opts.manual?8:5);
  }
  /* Sans ambiguïté : bien ressemblant ET (seul, nettement plus ressemblant, ou titre identique bien
     plus connu) */
  function isUnambiguous(ranked){
    if(!ranked.length||ranked[0].match<MATCH_MIN)return false;
    if(ranked.length===1||ranked[1].match<MATCH_MIN)return true;
    if(ranked[0].match-ranked[1].match>=MATCH_GAP)return true;
    return ranked[0].match>=0.99&&ranked[0].popularity>=5*Math.max(ranked[1].popularity,0.5);
  }
  /* Ordre des recherches pour un titre (proxy du site, quota du compte) : type attendu en
     français puis en anglais pour chaque variante du titre, enfin /search/multi (série classée
     film par Netflix, ou l'inverse). On s'arrête dès qu'une fiche ressemble assez (goodEnough). */
  function lookupPlan(group,lang){
    var type=group.kind==='movie'?'movie':'tv',l1=lang||'fr-FR',l2=/^en/i.test(l1)?'fr-FR':'en-US',plan=[];
    var qs=searchQueries(group.title||'');
    qs.slice(0,2).forEach(function(q){plan.push({path:'/search/'+type,query:q,lang:l1});plan.push({path:'/search/'+type,query:q,lang:l2});});
    plan.push({path:'/search/multi',query:qs[0],lang:l1});
    var seen={};
    return plan.filter(function(p){var k=p.path+'|'+p.query+'|'+p.lang;if(seen[k])return false;seen[k]=true;return true;});
  }
  function goodEnough(ranked){return !!ranked.length&&ranked[0].match>=MATCH_GOOD;}
  /* Anime : même règle que la recherche du site (« anime » dans le titre ou le résumé), plus
     animation (16) d'origine japonaise */
  function isAnime(cand){
    var txt=((cand.title||'')+' '+(cand.originalTitle||'')+' '+(cand.overview||'')).toLowerCase();
    if(txt.indexOf('anime')>-1)return true;
    return(cand.genreIds||[]).indexOf(16)>-1&&(cand.originCountry||[]).indexOf('JP')>-1;
  }
  /* Dernier épisode vu = dernier épisode d'une série finie (TMDB /tv/{id}) */
  function isSeriesFinished(progress,det){
    if(!progress||!det)return false;
    if(det.in_production===true)return false;
    if(det.status!=='Ended'&&det.status!=='Canceled')return false;
    var seasons=(det.seasons||[]).filter(function(s){return s&&s.season_number>0;}).sort(function(a,b){return a.season_number-b.season_number;});
    if(!seasons.length)return false;
    var last=seasons[seasons.length-1];
    return !!last.episode_count&&progress.season===last.season_number&&progress.episode>=last.episode_count;
  }

  /* ---------- État d'un groupe ----------
     tmdb : {state:'pending'|'done'|'error', candidates:[...]} ; sel : {cand, target}
     -> {kind:'update'|'uptodate'|'ambiguous'|'new', item, items, cand, reason} */
  function classify(group,items,tmdb,sel){
    sel=sel||{};
    var m=listMatches(group,items);
    if(m.length>1){
      var target=null;
      for(var i=0;i<m.length;i++)if(m[i].id===sel.target)target=m[i];
      return{kind:'ambiguous',reason:'list',items:m,item:target};
    }
    if(m.length===1)return{kind:movesForward(m[0],group)?'update':'uptodate',item:m[0]};
    if(!tmdb||tmdb.state==='pending')return{kind:'new',reason:'pending'};
    if(tmdb.state==='error')return{kind:'new',reason:'error'};
    if(tmdb.state==='skipped')return{kind:'new',reason:'skipped'};
    if(tmdb.state==='manualNone')return{kind:'new',reason:'manualNone'};
    var cands=tmdb.candidates||[];
    if(!cands.length)return{kind:'new',reason:'none'};
    var unamb=isUnambiguous(cands);
    var idx=typeof sel.cand==='number'?sel.cand:(unamb?0:-1);
    var cand=idx>=0?cands[idx]||null:null;
    var linked=itemByTmdb(items,cand,group.kind);
    if(linked)return{kind:movesForward(linked,group)?'update':'uptodate',item:linked,cand:cand,viaTmdb:true};
    if(!cand)return{kind:'ambiguous',reason:'tmdb',cands:cands};
    return{kind:'new',reason:unamb||typeof sel.cand==='number'?'ready':'choose',cand:cand,cands:cands,unambiguous:unamb};
  }
  /* Peut-on l'ajouter / le mettre à jour tel quel ? */
  function actionable(group,c){
    if(c.kind==='update')return true;
    if(c.kind==='ambiguous')return c.reason==='list'&&!!c.item&&movesForward(c.item,group);
    return c.kind==='new'&&!!c.cand;
  }
  /* Coché par défaut : seulement quand il n'y a aucun choix à faire */
  function defaultChecked(group,c){
    /* Saison numérotée par Crunchyroll (saisons « cours », numérotation absolue) : souvent différente
       de TMDB, l'utilisateur vérifie avant d'ajouter ou de mettre à jour */
    if(group.kind==='show'&&group.progress&&group.progress.src==='crunchyroll')return false;
    if(c.kind==='update')return group.kind==='movie'||!!group.progress;
    return c.kind==='new'&&!!c.cand&&c.unambiguous===true&&(group.kind==='movie'||!!group.progress);
  }
  function filterOf(c){return c.kind==='update'?'updates':c.kind==='uptodate'?'uptodate':c.kind==='ambiguous'?'ambiguous':'new';}

  /* Champs d'un nouveau titre, comme un ajout manuel (série « en cours » au dernier épisode vu,
     « terminé » si c'est le dernier épisode d'une série finie ; film « terminé ») */
  function newEntryFields(group,cand,details){
    if(cand.tmdbType==='movie')return{type:'film',status:'termine',saison:null,episode:null,totalEp:null,animeGenre:''};
    var anime=isAnime(cand),p=group.progress;
    var finished=!!p&&isSeriesFinished(p,details);
    var showEp=!finished;
    return{type:anime?'anime':'serie',status:finished?'termine':'encours',
      saison:showEp&&p?p.season:null,episode:showEp&&p?p.episode:null,
      totalEp:showEp?((details&&details.number_of_episodes)||0):null,animeGenre:''};
  }
  /* Nouvelle progression d'un titre existant (null : rien à changer) */
  function updateFields(item,group,details){
    if(!movesForward(item,group))return null;
    if(group.kind==='movie')return{status:'termine',saison:null,episode:null};
    var p=group.progress;
    if(isSeriesFinished(p,details))return{status:'termine',saison:null,episode:null};
    return{status:'encours',saison:p.season,episode:p.episode};
  }

  return{normalizeTitle:normalizeTitle,groupRows:groupRows,furthest:furthest,listMatches:listMatches,movesForward:movesForward,
    itemByTmdb:itemByTmdb,levenshtein:levenshtein,similarity:similarity,rankCandidates:rankCandidates,isUnambiguous:isUnambiguous,
    cleanSearchTitle:cleanSearchTitle,searchQueries:searchQueries,lookupPlan:lookupPlan,goodEnough:goodEnough,
    isAnime:isAnime,isSeriesFinished:isSeriesFinished,classify:classify,actionable:actionable,defaultChecked:defaultChecked,
    filterOf:filterOf,newEntryFields:newEntryFields,updateFields:updateFields};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=DET_CORE;

/* ======================= Interface (navigateur) ======================= */
var DET={rows:[],groups:[],loadedAt:0,loading:null,filter:'all',sel:{},tmdb:{},busy:false,lookups:0,requests:0,stopped:false,queue:[],active:0,renderTimer:null};
/* Quota TMDB du compte (proxy, 4 000 appels par jour) : 400 titres et 1 200 requêtes automatiques
   au plus par chargement de la page, 3 en parallèle ; résultats gardés par titre normalisé (mémoire
   + sessionStorage) pour ne jamais refaire la même recherche. Au-delà : recherche à la main. */
var DET_PAGE=1000,DET_MAX_ROWS=20000,DET_LOOKUP_MAX=400,DET_REQ_MAX=1200,DET_LOOKUP_PARALLEL=3,DET_CACHE_PREFIX='cp.detTmdb.v2:';

function _detItems(){return(typeof memDB!=='undefined'?memDB:[]).filter(function(i){return !i.deleted;});}
function _detSel(key){return DET.sel[key]||(DET.sel[key]={checked:false,touched:false});}
function _detClass(g){return DET_CORE.classify(g,_detItems(),DET.tmdb[g.key],DET.sel[g.key]);}

/* Lecture des détections en attente (RLS : uniquement celles du compte connecté), par pages */
function loadDetected(force){
  if(typeof supa==='undefined'||!supa||!authUser)return Promise.resolve();
  if(DET.loading)return DET.loading;
  if(!force&&Date.now()-DET.loadedAt<120000){_detAfterLoad();return Promise.resolve();}
  var rows=[];
  function page(from){
    return supa.from('detected_media').select('id,source,raw_title,normalized_title,media_type,season,episode,watched_at,progress_pct,state')
      .eq('state','pending').order('id',{ascending:true}).range(from,from+DET_PAGE-1).then(function(res){
        if(res.error)throw res.error;
        rows=rows.concat(res.data||[]);
        if((res.data||[]).length===DET_PAGE&&rows.length<DET_MAX_ROWS)return page(from+DET_PAGE);
      });
  }
  DET.loading=page(0).then(function(){
    DET.rows=rows;DET.groups=DET_CORE.groupRows(rows);DET.loadedAt=Date.now();
    _detAfterLoad();
  }).catch(function(e){if(typeof _logErr==='function')_logErr('[détectés]',e);})
    .then(function(){DET.loading=null;});
  return DET.loading;
}
function _detAfterLoad(){
  _detAutoResolve();
  updateDetectedBadge();
  if(activeTab==='detectes'){_detQueueLookups();renderDetected();}
  if(location.hash==='#detectes'&&activeTab!=='detectes')openDetectedTab();
}
/* Déjà à jour dans la liste (progression égale ou plus avancée, titre terminé) : la détection
   est simplement classée (state = added) ; la liste n'est pas modifiée. */
function _detAutoResolve(){
  var ids=[],keep=[];
  DET.groups.forEach(function(g){
    var c=DET_CORE.classify(g,_detItems(),null,null);
    if(c.kind==='uptodate')ids=ids.concat(g.ids);else keep.push(g);
  });
  if(!ids.length)return;
  DET.groups=keep;
  _detSetState(ids,'added');
}
function _detSetState(ids,state){
  var chunks=[];for(var i=0;i<ids.length;i+=200)chunks.push(ids.slice(i,i+200));
  return chunks.reduce(function(p,ch){
    return p.then(function(){return supa.from('detected_media').update({state:state}).in('id',ch).then(function(res){if(res.error)throw res.error;});});
  },Promise.resolve());
}
function _detActionableGroups(){return DET.groups.filter(function(g){return _detClass(g).kind!=='uptodate';});}
function updateDetectedBadge(){
  var tab=document.getElementById('detTab'),badge=document.getElementById('detBadge');
  if(!tab||!badge)return;
  tab.hidden=!authUser;
  var n=authUser?_detActionableGroups().length:0;
  badge.hidden=n===0;
  badge.textContent=n>999?'999+':String(n);
  tab.setAttribute('aria-label',t('det.tab')+(n?' ('+tn('det.badge',n)+')':''));
}

/* ---------- Recherche TMDB des titres absents (proxy du site, quota du compte) ---------- */
function _detCacheKey(g){return DET_CACHE_PREFIX+TMDB_LANG+':'+g.kind+':'+g.norm;}
function _detCacheGet(g){
  try{var v=sessionStorage.getItem(_detCacheKey(g));return v?JSON.parse(v):null;}catch(e){return null;}
}
function _detCacheSet(g,cands){
  try{
    var slim=cands.map(function(c){return Object.assign({},c,{overview:String(c.overview||'').slice(0,400)});});
    sessionStorage.setItem(_detCacheKey(g),JSON.stringify(slim));
  }catch(e){/* stockage plein ou refusé : le cache mémoire suffit */}
}
function _detSearchUrl(step){
  return TB+step.path+'?query='+encodeURIComponent(step.query)+'&language='+encodeURIComponent(step.lang)+'&include_adult=false';
}
function _detQueueLookups(){
  DET.groups.forEach(function(g){
    if(DET.tmdb[g.key])return;/* déjà cherché ou en cours */
    if(DET_CORE.listMatches(g,_detItems()).length)return;
    var cached=_detCacheGet(g);
    if(cached){DET.tmdb[g.key]={state:'done',candidates:cached,cached:true};return;}
    if(DET.stopped||DET.lookups>=DET_LOOKUP_MAX){DET.tmdb[g.key]={state:'skipped',candidates:[]};return;}
    DET.lookups++;DET.tmdb[g.key]={state:'pending',candidates:[]};DET.queue.push(g.key);
  });
  _detPump();
}
/* Recherches successives d'un titre (DET_CORE.lookupPlan) jusqu'à une fiche assez ressemblante */
function _detLookup(g){
  var plan=DET_CORE.lookupPlan(g,TMDB_LANG),ranked=[],i=0;
  function next(){
    if(i>=plan.length||DET_CORE.goodEnough(ranked))return Promise.resolve(ranked);
    if(DET.requests>=DET_REQ_MAX||DET.stopped){var e=new Error('budget');e.budget=true;return ranked.length?Promise.resolve(ranked):Promise.reject(e);}
    var step=plan[i++];DET.requests++;
    return tf(_detSearchUrl(step)).then(function(d){
      ranked=DET_CORE.rankCandidates(g,(d&&d.results)||[],{previous:ranked});
      return next();
    });
  }
  return next();
}
function _detPump(){
  while(DET.active<DET_LOOKUP_PARALLEL&&DET.queue.length){
    var key=DET.queue.shift();
    var g=DET.groups.find(function(x){return x.key===key;});
    if(!g)continue;
    if(DET.stopped){DET.tmdb[g.key]={state:'skipped',candidates:[]};continue;}
    DET.active++;
    (function(g){
      _detLookup(g).then(function(cands){
        DET.tmdb[g.key]={state:'done',candidates:cands};
        _detCacheSet(g,cands);
      }).catch(function(err){
        /* Quota du jour atteint (429) : on arrête les recherches automatiques, la saisie manuelle reste */
        if(err&&(err.status===429||err.budget)){DET.stopped=DET.stopped||err.status===429;DET.tmdb[g.key]={state:'skipped',candidates:[]};}
        else DET.tmdb[g.key]={state:'error',candidates:[]};
      }).then(function(){DET.active--;_detScheduleRender();_detPump();});
    })(g);
  }
}
/* Recherche tapée dans la ligne d'un titre sans fiche : /search/multi, aucun seuil de ressemblance */
function detSearchInput(key,value){_detSel(key).q=String(value||'').slice(0,120);}
function detSearch(key,value){
  var g=DET.groups.find(function(x){return x.key===key;});if(!g)return;
  var s=_detSel(key),q=String(value==null?s.q||'':value).trim().slice(0,120);
  if(q.length<2)return;
  var cur=DET.tmdb[key];
  if(cur&&cur.manual&&cur.state==='pending'&&s.q===q)return;/* même recherche déjà en cours */
  s.q=q;
  delete s.cand;
  DET.tmdb[key]={state:'pending',candidates:[],manual:true};
  renderDetected();
  tf(_detSearchUrl({path:'/search/multi',query:q,lang:TMDB_LANG})).then(function(d){
    var cands=DET_CORE.rankCandidates(g,(d&&d.results)||[],{manual:true,query:q});
    DET.tmdb[key]={state:cands.length?'done':'manualNone',candidates:cands,manual:true};
  }).catch(function(){DET.tmdb[key]={state:'error',candidates:[],manual:true};})
    .then(function(){_detScheduleRender();});
}
function detSearchBtn(key){
  var row=null;
  document.querySelectorAll('.det-row').forEach(function(r){if(r.getAttribute('data-key')===key)row=r;});
  var inp=row&&row.querySelector('.det-q');
  detSearch(key,inp?inp.value:null);
}
function _detScheduleRender(){
  clearTimeout(DET.renderTimer);
  DET.renderTimer=setTimeout(function(){updateDetectedBadge();if(activeTab==='detectes')renderDetected();},120);
}

/* ---------- Onglet ---------- */
function openDetectedTab(){
  var btn=document.getElementById('detTab');
  if(btn&&!btn.hidden)switchTab(btn);
}
function onDetectedTabShown(){
  try{if(location.hash!=='#detectes')history.replaceState(null,'',location.pathname+location.search+'#detectes');}catch(e){}
  renderDetected();
  loadDetected(true).then(function(){_detQueueLookups();renderDetected();});
}
function onDetectedTabHidden(){
  try{if(location.hash==='#detectes')history.replaceState(null,'',location.pathname+location.search);}catch(e){}
}
if(typeof window!=='undefined')window.addEventListener('hashchange',function(){if(location.hash==='#detectes')openDetectedTab();});

var DET_SOURCE_KEY={netflix:'det.src.netflix',netflix_csv:'det.src.netflixCsv',live:'det.src.live',crunchyroll:'det.src.crunchyroll',prime:'det.src.prime'};
/* Pastille par plateforme (couleurs dans index.html : .det-src-*) */
var DET_SOURCE_CLS={netflix:'netflix',netflix_csv:'netflix',live:'live',crunchyroll:'crunchyroll',prime:'prime'};
function _detEp(p){return p?(p.approx?'≈ ':'')+'S'+pad(p.season)+' E'+pad(p.episode):'';}
function _detListProgress(it){
  if(it.status==='termine')return t('status.termine');
  if(it.type==='film')return t('status.'+(it.status==='todo'?'avoir':it.status));
  return(it.saison&&it.episode)?'S'+pad(it.saison)+' E'+pad(it.episode):t('status.'+(it.status==='todo'?'avoir':it.status));
}
function _detRowHtml(g,c){
  var s=_detSel(g.key);
  var act=DET_CORE.actionable(g,c);
  if(!s.touched)s.checked=act&&DET_CORE.defaultChecked(g,c);
  if(!act)s.checked=false;
  var cand=c.cand||null,poster=cand&&cand.poster?cand.poster:(c.item&&c.item.poster)||null;
  var typ=g.kind==='movie'?'film':(cand&&DET_CORE.isAnime(cand))||(c.item&&c.item.type==='anime')?'anime':'serie';
  var img=poster?'<img class="det-poster" src="'+IB+'w92'+esc(poster)+'" alt="" loading="lazy" data-hide-broken>':'<div class="det-poster det-poster-ph">'+icon(typ)+'</div>';
  var tagCls={update:'upd',uptodate:'ok',ambiguous:'amb',new:'new'}[c.kind];
  var tagTxt=t({update:'det.tag.update',uptodate:'det.tag.uptodate',ambiguous:'det.tag.ambiguous',new:'det.tag.new'}[c.kind]);
  var badges=g.sources.map(function(x){return '<span class="det-src det-src-'+(DET_SOURCE_CLS[x]||'other')+'">'+esc(t(DET_SOURCE_KEY[x]||'det.src.netflix'))+'</span>';}).join('');
  var meta=[];
  if(g.kind==='movie')meta.push(t('det.movieSeen'));
  else if(g.progress)meta.push(t('det.seenUpTo',{ep:_detEp(g.progress)}));
  else meta.push(t('det.progressUnknown'));
  if(g.kind==='show'&&g.progress&&g.progress.src==='crunchyroll')meta.push(t('det.crNumbering'));
  if(g.lastMs)meta.push(fmtDate(g.lastMs));
  var detail='';
  if(c.kind==='update'||c.kind==='uptodate'){
    var to=g.kind==='movie'?t('status.termine'):_detEp(g.progress);
    detail=esc(t(c.kind==='update'?'det.inList':'det.inListSame',{title:c.item.title,from:_detListProgress(c.item),to:to}));
  }else if(c.kind==='ambiguous'&&c.reason==='list'){
    detail=esc(t('det.chooseList'))+' <select class="det-select" aria-label="'+esc(t('det.chooseList'))+'"'+uiAct('detTarget',[g.key],'change')+'><option value="">'+esc(t('det.choose'))+'</option>'
      +c.items.map(function(it){return '<option value="'+esc(it.id)+'"'+(c.item&&c.item.id===it.id?' selected':'')+'>'+esc(it.title+(it.year?' ('+it.year+')':'')+' — '+_detListProgress(it))+'</option>';}).join('')+'</select>';
  }else if(c.reason==='pending'){
    detail=esc(t('det.searching'));
  }else if(c.reason==='error'){
    detail=esc(t('det.searchError'))+_detSearchHtml(g,s);
  }else if(c.reason==='none'||c.reason==='skipped'||c.reason==='manualNone'){
    detail=esc(t({none:'det.noMatch',skipped:'det.skipped',manualNone:'det.manualNone'}[c.reason]))+_detSearchHtml(g,s);
  }else{
    var cands=(c.cands||[]),sel=typeof s.cand==='number'?s.cand:(cand?cands.indexOf(cand):-1);
    var addTxt=cand?t(g.kind==='movie'?'det.addMovie':g.progress?'det.addShow':'det.addShowNoEp',{title:cand.title+(cand.year?' ('+cand.year+')':''),ep:_detEp(g.progress)}):'';
    detail=(cand?esc(addTxt):esc(t('det.chooseTmdb')));
    if(cands.length>1||!cand){
      detail+=' <select class="det-select" aria-label="'+esc(t('det.chooseTmdb'))+'"'+uiAct('detCand',[g.key],'change')+'>'+(cand?'':'<option value="">'+esc(t('det.choose'))+'</option>')
        +cands.map(function(x,i){return '<option value="'+i+'"'+(i===sel?' selected':'')+'>'+esc(x.title+(x.year?' ('+x.year+')':'')+(x.originalTitle&&x.originalTitle!==x.title?' — '+x.originalTitle:'')+(x.tmdbType!==(g.kind==='movie'?'movie':'tv')?' · '+t(x.tmdbType==='movie'?'det.kindMovie':'det.kindShow'):''))+'</option>';}).join('')+'</select>';
    }
    /* Pas la bonne fiche parmi celles proposées : recherche à la main */
    if(!cand||c.cands&&c.cands[0]&&c.cands[0].manual)detail+=_detSearchHtml(g,s);
  }
  return '<div class="det-row'+(s.checked?' on':'')+'" data-key="'+esc(g.key)+'">'
    +'<input type="checkbox" class="det-cb" aria-label="'+esc(t('det.select',{title:g.title}))+'"'+(s.checked?' checked':'')+(act?'':' disabled')+uiAct('detToggle',[g.key],'change')+'>'
    +img+'<div class="det-body"><div class="det-name">'+esc(g.title)+'</div>'
    +'<div class="det-meta"><span class="det-tag '+tagCls+'">'+esc(tagTxt)+'</span>'+badges+'<span>'+esc(meta.join(' · '))+'</span></div>'
    +'<div class="det-detail">'+detail+'</div></div>'
    +'<button type="button" class="btn btn-ghost det-ign"'+uiAct('detIgnore',[g.key])+'>'+esc(t('det.ignore'))+'</button></div>';
}
function _detSearchHtml(g,s){
  return '<span class="det-search"><input type="search" class="det-q" maxlength="120" value="'+esc(s.q!=null?s.q:DET_CORE.searchQueries(g.title)[0]||g.title)+'"'
    +' placeholder="'+esc(t('det.searchPh'))+'" aria-label="'+esc(t('det.searchLabel',{title:g.title}))+'" data-key="'+esc(g.key)+'"'
    +uiAct('detSearchInput',[g.key],'input')+uiAct('detSearch',[g.key],'change')+'>'
    +'<button type="button" class="btn btn-ghost det-qbtn"'+uiAct('detSearchBtn',[g.key])+'>'+esc(t('det.searchBtn'))+'</button></span>';
}
function _detVisible(){
  var out=[];
  DET.groups.forEach(function(g){
    var c=_detClass(g);
    if(c.kind==='uptodate')return;
    if(DET.filter!=='all'&&DET_CORE.filterOf(c)!==DET.filter)return;
    out.push({g:g,c:c});
  });
  return out;
}
function _detSelected(){
  return DET.groups.filter(function(g){var s=DET.sel[g.key];return s&&s.checked&&DET_CORE.actionable(g,_detClass(g));});
}
function renderDetected(){
  var box=document.getElementById('detectedSection');if(!box)return;
  if(!authUser){box.innerHTML='<div class="det-empty">'+esc(t('det.login'))+'</div>';return;}
  var counts={all:0,new:0,updates:0,ambiguous:0};
  DET.groups.forEach(function(g){var f=DET_CORE.filterOf(_detClass(g));if(f==='uptodate')return;counts.all++;counts[f]++;});
  var vis=_detVisible();
  var rows=vis.map(function(x){return _detRowHtml(x.g,x.c);}).join('');
  var nSel=_detSelected().length;
  var selectable=vis.filter(function(x){return DET_CORE.actionable(x.g,x.c);});
  var allOn=selectable.length>0&&selectable.every(function(x){return _detSel(x.g.key).checked;});
  var filters=['all','new','updates','ambiguous'].map(function(f){
    return '<button type="button" class="stab'+(DET.filter===f?' on':'')+'" data-sfx-hover'+uiAct('detFilter',[f])+'>'+esc(t('det.filter.'+f))+' <span class="det-n">'+fmtNum(counts[f])+'</span></button>';
  }).join('');
  var busy=DET.busy?' disabled':'';
  var ae=document.activeElement,focusKey=ae&&ae.classList&&ae.classList.contains('det-q')?ae.getAttribute('data-key'):null;
  var caret=focusKey!=null?[ae.selectionStart,ae.selectionEnd]:null;
  box.innerHTML='<div class="det-wrap">'
    +'<div class="det-head"><div><div class="det-title">'+esc(t('det.title'))+'</div><div class="det-sub">'+esc(t('det.intro',{name:BRAND.name}))+'</div></div>'
    +'<button type="button" class="btn btn-ghost"'+busy+uiAct('detReload')+'>'+esc(t('det.reload'))+'</button></div>'
    +(counts.all?'<div class="det-filters">'+filters+'</div>'
      +'<div class="det-toolbar"><label class="det-all"><input type="checkbox"'+(allOn?' checked':'')+(selectable.length?'':' disabled')+uiAct('detSelectAll',null,'change')+'> '+esc(t('det.selectAll'))+'</label>'
      +'<div class="det-actions"><button type="button" class="btn btn-ghost"'+(nSel&&!DET.busy?'':' disabled')+uiAct('detIgnoreSel')+'>'+esc(t('det.ignore'))+'</button>'
      +'<button type="button" class="btn btn-ghost"'+busy+uiAct('detClearAll')+'>'+esc(t('det.clearAll'))+'</button>'
      +'<button type="button" class="btn btn-ghost"'+busy+uiAct('detAddAll')+'>'+esc(t('det.addAll'))+'</button>'
      +'<button type="button" class="btn btn-primary" id="detAddSelBtn"'+(nSel&&!DET.busy?'':' disabled')+uiAct('detAddSel')+'>'+esc(tn('det.addSel',nSel))+'</button></div></div>'
      +'<div class="det-list">'+(rows||'<div class="det-empty">'+esc(t('det.emptyFilter'))+'</div>')+'</div>'
      :'<div class="det-empty">'+esc(DET.loading&&!DET.loadedAt?t('det.loading'):t('det.empty'))+'</div>')
    +'<div class="det-foot">'+esc(t('det.privacy'))+'</div></div>';
  if(focusKey!=null){
    box.querySelectorAll('.det-q').forEach(function(inp){
      if(inp.getAttribute('data-key')!==focusKey)return;
      inp.focus();try{inp.setSelectionRange(caret[0],caret[1]);}catch(e){}
    });
  }
}

/* ---------- Actions ---------- */
function detToggle(key,on){var s=_detSel(key);s.touched=true;s.checked=!!on;renderDetected();}
function detSelectAll(on){
  _detVisible().forEach(function(x){if(DET_CORE.actionable(x.g,x.c)){var s=_detSel(x.g.key);s.touched=true;s.checked=!!on;}});
  renderDetected();
}
function detFilter(f){DET.filter=['all','new','updates','ambiguous'].indexOf(f)>-1?f:'all';renderDetected();}
function detCand(key,value){
  var s=_detSel(key);var i=parseInt(value,10);
  if(isNaN(i)){delete s.cand;}else{s.cand=i;s.touched=true;s.checked=true;}
  renderDetected();
}
function detTarget(key,value){var s=_detSel(key);s.target=value||null;s.touched=true;s.checked=!!value;renderDetected();}
function _detRemoveGroups(keys){
  DET.groups=DET.groups.filter(function(g){return keys.indexOf(g.key)<0;});
  keys.forEach(function(k){delete DET.sel[k];});
  updateDetectedBadge();renderDetected();
}
function detIgnore(keys){
  if(!Array.isArray(keys))keys=[keys];
  var gs=DET.groups.filter(function(g){return keys.indexOf(g.key)>-1;});
  if(!gs.length)return;
  var ids=[].concat.apply([],gs.map(function(g){return g.ids;}));
  _detSetState(ids,'ignored').then(function(){
    _detRemoveGroups(gs.map(function(g){return g.key;}));
    sfx('del');toast(tn('det.ignored',gs.length),'nfo');
  }).catch(function(){toast(t('det.saveError'),'err');});
}
function detIgnoreSel(){detIgnore(_detSelected().map(function(g){return g.key;}));}
function detClearAll(){
  if(!DET.groups.length||!confirm(t('det.clearConfirm')))return;
  supa.from('detected_media').delete().eq('state','pending').then(function(res){
    if(res.error)throw res.error;
    DET.groups=[];DET.rows=[];DET.sel={};
    updateDetectedBadge();renderDetected();sfx('del');toast(t('det.cleared'),'nfo');
  }).catch(function(){toast(t('det.saveError'),'err');});
}
function detAddAll(){
  DET.groups.forEach(function(g){var c=_detClass(g);if(DET_CORE.actionable(g,c)){var s=_detSel(g.key);s.touched=true;s.checked=true;}});
  detAddSel();
}
/* Détails TMDB d'une série (saisons, statut, nombre d'épisodes) : même adresse que fetchTotEp */
function _detTvDetails(id){return tf(TB+'/tv/'+id+'?language='+TMDB_LANG).catch(function(){return null;});}
function detAddSel(){
  if(DET.busy)return;
  var gs=_detSelected();
  if(!gs.length)return;
  DET.busy=true;renderDetected();
  var added=0,updated=0,failed=0,doneKeys=[],doneIds=[],seenTmdb={},seenItem={};
  var chain=Promise.resolve();
  gs.forEach(function(g){
    chain=chain.then(function(){
      var c=_detClass(g);
      if(!DET_CORE.actionable(g,c))return;
      if(c.kind==='new'){
        var cand=c.cand,k=cand.tmdbType+':'+cand.tmdbId;
        if(seenTmdb[k]||DET_CORE.itemByTmdb(_detItems(),cand,g.kind)){doneKeys.push(g.key);doneIds=doneIds.concat(g.ids);return;}
        seenTmdb[k]=true;
        return(cand.tmdbType==='tv'?_detTvDetails(cand.tmdbId):Promise.resolve(null)).then(function(det){
          var f=DET_CORE.newEntryFields(g,cand,det);
          addEntryFromTmdb({tmdbId:cand.tmdbId,tmdbType:cand.tmdbType,title:cand.title,year:cand.year,poster:cand.poster,overview:cand.overview,tmdbScore:cand.score},f);
          added++;doneKeys.push(g.key);doneIds=doneIds.concat(g.ids);
        });
      }
      var item=c.item;
      if(!item||seenItem[item.id]){doneKeys.push(g.key);doneIds=doneIds.concat(g.ids);return;}
      seenItem[item.id]=true;
      var needDet=g.kind==='show'&&item.tmdbId&&(item.tmdbType||'tv')==='tv';
      return(needDet?_detTvDetails(item.tmdbId):Promise.resolve(null)).then(function(det){
        var f=DET_CORE.updateFields(item,g,det);
        if(f){updateEntryProgress(item.id,f);updated++;}
        doneKeys.push(g.key);doneIds=doneIds.concat(g.ids);
      });
    }).catch(function(e){failed++;if(typeof _logErr==='function')_logErr('[détectés] ajout',e);});
  });
  chain.then(function(){
    return doneIds.length?_detSetState(doneIds,'added').catch(function(){failed++;}):null;
  }).then(function(){
    DET.busy=false;
    _detRemoveGroups(doneKeys);
    render();if(typeof loadRecos==='function')loadRecos();
    if(added||updated){sfx('add');toast(t('det.done',{added:fmtNum(added),updated:fmtNum(updated)}));}
    if(failed)toast(t('det.saveError'),'err');
  });
}
function detReload(){DET.loadedAt=0;Object.keys(DET.tmdb).forEach(function(k){var st=DET.tmdb[k].state;if(st==='error'||st==='skipped'){if(st==='error'&&!DET.tmdb[k].manual)DET.lookups--;delete DET.tmdb[k];}});loadDetected(true).then(function(){_detQueueLookups();renderDetected();});}

/* Appelé par updateSyncStatusUI (js/15-sync.js) : 'anon' à la déconnexion, 'synced' après une synchro */
function onDetectedAuthState(state){
  if(state==='anon'||!authUser){
    DET.rows=[];DET.groups=[];DET.sel={};DET.tmdb={};DET.loadedAt=0;DET.lookups=0;DET.requests=0;DET.stopped=false;DET.queue=[];
    updateDetectedBadge();
    if(activeTab==='detectes'){var all=document.querySelector('.ntab[data-tab="all"]');if(all)switchTab(all);}
    return;
  }
  updateDetectedBadge();
  if(state==='synced')loadDetected(false);
}
