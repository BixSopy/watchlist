/* MODULE: Import semi-assisté de l'historique Disney+ et Apple TV via l'export RGPD des données.
   Ces plateformes ne laissent pas lire l'historique en direct : l'utilisateur demande une copie de
   ses données (lien officiel), on retient la date de la demande DANS CE NAVIGATEUR (localStorage,
   aucune table, aucune migration), on rappelle quand l'export devrait être prêt, puis le fichier
   déposé est lu ICI, dans le navigateur (zip, CSV, JSON, texte, PDF simple) : rien n'est envoyé,
   ni à Cinepisode ni à un tiers. Les titres trouvés rejoignent l'onglet « Détectés » (groupes locaux,
   non enregistrés en base) et passent par la correspondance habituelle (liste + recherche TMDB par
   le proxy /api/tmdb), puis « Ajouter la sélection ».
   On ne peut pas savoir côté serveur si la demande a été faite : c'est l'utilisateur qui le confirme.
   Formats : Apple « Video Play Activity.csv » (dans « Apple Media Services information », zip
   imbriqué) — colonnes détectées de façon souple ; Disney+ : section « Titles Watched » (profil,
   titre, date) d'après des exports publiés, format non documenté → lecture « au mieux ».
   Le cœur (GDPR_CORE) est pur, sans DOM : testé par tests/gdpr-import.test.js. */
var GDPR_CORE=(function(){
  var DAY=86400000;
  var PLATFORMS={
    apple:{id:'apple',name:'Apple TV',source:'apple_gdpr',url:'https://privacy.apple.com/',delayDays:7,steps:5},
    disney:{id:'disney',name:'Disney+',source:'disney_gdpr',url:'https://privacy.thewaltdisneycompany.com/en/current-privacy-policy/data-subject-rights-portal/',delayDays:30,steps:5},
    /* Service fermé : plus de demande possible, on importe l'export déjà gardé (closed) */
    tvtime:{id:'tvtime',name:'TV Time',source:'tvtime_gdpr',url:null,delayDays:0,steps:0,closed:true}
  };

  /* ---------- CSV (guillemets, BOM, séparateur , ; ou tabulation) ---------- */
  function parseCsv(text){
    text=String(text||'').replace(/^\uFEFF/,'');
    var first=text.split(/\r?\n/,1)[0]||'';
    var cnt=function(c){return first.split(c).length-1;};
    var sep=[',',';','\t'].sort(function(a,b){return cnt(b)-cnt(a);})[0];
    var rows=[],row=[],cur='',q=false;
    for(var i=0;i<text.length;i++){
      var ch=text[i];
      if(q){if(ch==='"'){if(text[i+1]==='"'){cur+='"';i++;}else q=false;}else cur+=ch;continue;}
      if(ch==='"')q=true;
      else if(ch===sep){row.push(cur);cur='';}
      else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cur);rows.push(row);row=[];cur='';}
      else cur+=ch;
    }
    if(cur!==''||row.length){row.push(cur);rows.push(row);}
    rows=rows.filter(function(r){return r.some(function(c){return String(c).trim()!=='';});});
    if(!rows.length)return [];
    var head=rows[0].map(function(h){return String(h).trim();});
    return rows.slice(1).map(function(r){var o={};head.forEach(function(h,j){o[h]=r[j]!=null?String(r[j]).trim():'';});return o;});
  }
  function low(s){return String(s||'').toLowerCase().replace(/[_\s]+/g,' ').trim();}
  function pick(obj,names){
    var keys=Object.keys(obj||{}),i,j;
    for(i=0;i<names.length;i++)for(j=0;j<keys.length;j++)if(low(keys[j])===names[i]&&String(obj[keys[j]]).trim()!=='')return String(obj[keys[j]]).trim();
    return null;
  }
  function num(v){if(v==null||v==='')return null;var n=parseFloat(String(v).replace(',','.'));return isFinite(n)?n:null;}
  function toMs(v){
    if(v==null||v==='')return null;
    var s=String(v).trim();
    if(/^\d{10,13}$/.test(s)){var n=+s;return n<1e12?n*1000:n;}
    var m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);/* JJ/MM/AAAA (exports européens) */
    if(m)return Date.UTC(+m[3],+m[2]-1,+m[1]);
    var d=Date.parse(s.replace(/ UTC$/,'Z').replace(/^(\d{4}-\d{2}-\d{2}) (\d)/,'$1T$2'));
    return isNaN(d)?null:d;
  }
  /* « Ted Lasso S1 E3 », « Ted Lasso - Saison 2, épisode 4 », « Show: Season 1: Episode 2 » */
  var EP_RES=[
    /^(.*?)[\s:,.\-–—|]+s(?:aison|eason)?\s*0*(\d{1,3})[\s:,.\-–—|]*(?:e|ep|épisode|episode)\.?\s*0*(\d{1,4})\b/i,
    /^(.*?)[\s:,.\-–—|]+s0*(\d{1,3})\s*e0*(\d{1,4})\b/i
  ];
  function splitEpisode(title){
    var s=String(title||'').trim();
    for(var i=0;i<EP_RES.length;i++){var m=s.match(EP_RES[i]);if(m&&m[1].trim())return{show:m[1].replace(/[\s:,.\-–—|]+$/,'').trim(),season:+m[2],episode:+m[3]};}
    var m2=s.match(/^(.*?)[\s:,.\-–—|]+s(?:aison|eason)\s*0*(\d{1,3})\s*$/i);
    if(m2&&m2[1].trim())return{show:m2[1].replace(/[\s:,.\-–—|]+$/,'').trim(),season:+m2[2],episode:null};
    return null;
  }

  /* ---------- Apple : Video Play Activity.csv ---------- */
  var A_TITLE=['content name','item name','title','content title','video title','display name'];
  var A_SHOW=['show name','series name','series title','show title','tv show name'];
  var A_DATE=['event start timestamp','event end timestamp','event received timestamp','play start timestamp','date','play date','start time','timestamp'];
  var A_TYPE=['item type','content type','media type','video type','kind','type'];
  var A_SEASON=['season number','season'];
  var A_EP=['episode number','episode'];
  var A_PLAY=['play duration milliseconds','play duration in milliseconds','playback duration milliseconds','play duration ms','duration played milliseconds'];
  var A_MEDIA=['media duration in milliseconds','media duration milliseconds','content duration milliseconds','duration milliseconds'];
  var A_END=['end reason type','end reason','playback end reason'];
  function parseApple(objs){
    var out=[];
    (objs||[]).forEach(function(o){
      var title=pick(o,A_TITLE),show=pick(o,A_SHOW);
      if(!title&&!show)return;
      var typ=low(pick(o,A_TYPE)),season=num(pick(o,A_SEASON)),ep=num(pick(o,A_EP));
      if(/trailer|bande|preview|extra|bonus/.test(typ)||/^(trailer|bande-annonce)\b/i.test(title||''))return;
      var play=num(pick(o,A_PLAY)),media=num(pick(o,A_MEDIA));
      if(play!==null&&play<20000)return;/* moins de 20 s : ouverture, pas un visionnage */
      var pct=play!==null&&media?Math.max(0,Math.min(100,Math.round(play/media*100))):null;
      if(pct!==null&&/natural|end of|completed|credits/.test(low(pick(o,A_END))))pct=100;
      var ev={title:null,type:'movie',season:null,episode:null,watchedAt:toMs(pick(o,A_DATE)),pct:pct};
      var split=splitEpisode(title);
      if(show){ev.title=show;ev.type='show';}
      else if(split){ev.title=split.show;ev.type='show';season=season!==null?season:split.season;ep=ep!==null?ep:split.episode;}
      else ev.title=title;
      if(/episode|épisode|tv|show|series|série/.test(typ)||season!==null)ev.type='show';
      if(/movie|film/.test(typ)&&!show&&!split)ev.type='movie';
      if(ev.type==='show'&&Number.isInteger(season)&&Number.isInteger(ep)){ev.season=season;ev.episode=ep;}
      out.push(ev);
    });
    return out;
  }

  /* ---------- Disney+ : « Titles Watched » (profil, titre, date) ---------- */
  function disneyEvent(rawTitle,date){
    var title=String(rawTitle||'').trim();if(!title)return null;
    var parts=title.split('|').map(function(x){return x.trim();}).filter(Boolean);
    if(parts.length&&/^(trailer|bande-annonce|extra|extras|bonus)$/i.test(parts[0]))return null;
    var ev={title:parts[0]||title,type:'movie',season:null,episode:null,watchedAt:toMs(date),pct:null};
    if(parts.length>1){
      ev.type='show';
      parts.slice(1).forEach(function(p){
        var s=p.match(/^(?:season|saison|s)\s*0*(\d{1,3})$/i),e=p.match(/^(?:episode|épisode|ep|e)\.?\s*0*(\d{1,4})/i);
        if(s)ev.season=+s[1];else if(e)ev.episode=+e[1];
      });
    }else{
      var sp=splitEpisode(title);
      if(sp){ev.title=sp.show;ev.type='show';ev.season=sp.season;ev.episode=sp.episode;}
    }
    if(ev.episode===null)ev.season=ev.type==='show'?ev.season:null;
    return ev;
  }
  var D_TITLE=['title','content title','program title','programme title','title name','titre','series title'];
  var D_DATE=['date watched','watched date','date','last watched','view date','date de visionnage'];
  function parseDisneyObjs(objs){
    var out=[];
    (objs||[]).forEach(function(o){
      var ti=pick(o,D_TITLE);if(!ti)return;
      var ev=disneyEvent(ti,pick(o,D_DATE));
      var se=num(pick(o,['season','season number','saison'])),ep=num(pick(o,['episode','episode number','épisode']));
      if(ev&&Number.isInteger(se)&&Number.isInteger(ep)){ev.type='show';ev.season=se;ev.episode=ep;}
      if(ev)out.push(ev);
    });
    return out;
  }
  /* Texte (copié du PDF ou extrait) : lignes « Profil Titre 2023-12-11 » sous « Titles Watched » */
  var SECTIONS=/^(watchlist|customer service|billing ?information|legal assertions|subscriptions?|devices?|profiles?|ratings?|liste de favoris|service client)\b/i;
  function parseDisneyText(text){
    var lines=String(text||'').split(/\r?\n/).map(function(l){return l.replace(/\s+/g,' ').trim();}).filter(Boolean);
    var start=-1;
    for(var i=0;i<lines.length;i++)if(/^(titles watched|titres regardés|titres visionnés|historique de visionnage)$/i.test(lines[i])){start=i+1;break;}
    var body=start>=0?lines.slice(start):lines,items=[],pending='';
    for(var j=0;j<body.length;j++){
      var l=body[j];
      if(/^profile ?name\b/i.test(l))continue;
      if(start>=0&&SECTIONS.test(l))break;
      var m=l.match(/^(.*?)\s*(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})$/);
      if(m){var ti=(pending+' '+m[1]).trim();pending='';if(ti)items.push({t:ti,d:m[2]});}
      else pending=(pending+' '+l).trim();
    }
    /* Nom de profil en tête de ligne : premier mot commun à la majorité des lignes */
    var firsts={};items.forEach(function(x){var w=x.t.split(' ')[0];firsts[w]=(firsts[w]||0)+1;});
    var prof=Object.keys(firsts).sort(function(a,b){return firsts[b]-firsts[a];})[0];
    var strip=items.length>=2&&prof&&firsts[prof]/items.length>=0.6;
    return items.map(function(x){
      var ti=strip&&x.t.indexOf(prof+' ')===0?x.t.slice(prof.length+1):x.t;
      return disneyEvent(ti,x.d);
    }).filter(Boolean);
  }
  function walkJson(v,out){
    if(Array.isArray(v)){
      if(v.length&&v.every(function(x){return x&&typeof x==='object'&&!Array.isArray(x);})&&v.some(function(x){return pick(x,D_TITLE.concat(A_TITLE));}))out.push(v);
      else v.forEach(function(x){walkJson(x,out);});
    }else if(v&&typeof v==='object')Object.keys(v).forEach(function(k){walkJson(v[k],out);});
    return out;
  }

  /* ---------- TV Time (service fermé le 15/07/2026) ----------
     Deux exports existent (sources : watchd.pro/articles/tv-time-export-files, parseur TV Time de
     trakt-web, SeriesGuide#1174, theopentv.com) :
     - export RGPD officiel « tv-time-personal-data.zip » : tracking-prod-records-v2.csv (épisodes :
       key « watch-episode-… » / « rewatch-episode-… », s_id = id TVDB de la série, series_name,
       season_number|s_no, episode_number|ep_no, created_at), tracking-prod-records.csv (films :
       entity_type=movie, type=watch, movie_name localisé, release_date, alpha_range_key
       « watch-alpha-<slug anglais> », watch_date_range_key « watch-date-<unix> » ; plus une partie
       des épisodes : entity_type=episode, series_name, series_id), seen_episode.csv (archives
       anciennes). Le zip contient aussi des fichiers sensibles (access_token.csv…) : jamais lus.
     - extension « TV Time Out » : tvtime-series-episodes.csv (seules les lignes is_watched=true
       sont vues ; tvdb_id y est l'id de l'ÉPISODE, pas de la série), tvtime-movies.csv, et les
       mêmes données en JSON (série → saisons → épisodes).
     Variantes gérées : noms de colonnes changeants, dates dans la clé, revisionnages en doublon,
     date « 0001-01-01 » (date inconnue). Événements : {title,type,season,episode,watchedAt,pct,tvdb}
     où tvdb = id TVDB de la SÉRIE (sert à /find sur TMDB), jamais celui d'un épisode. */
  var TT_SHOW=['series name','tv show name','show name','series title','show title','series','show','serie'];
  var TT_SHOWID=['s id','series id','tv show id','show id','series tvdb id','show tvdb id','tvdb show id','tvdb series id'];
  var TT_SEASON=['season number','s no','episode season number','season'];
  var TT_EP=['episode number','ep no','episode'];
  var TT_DATE=['watched at','watch date','seen at','seen date','created at','date'];
  var TT_MOVIE=['movie name','title','name','movie title','movie'];
  function ttInt(v){if(v==null||v==='')return null;var s=String(v).trim();if(!/^\d{1,9}$/.test(s))return null;return +s;}
  function ttDate(o){
    var k=String(pick(o,['watch date range key','key','type uuid n'])||'').match(/watch-date-(\d{9,11})/);
    if(k)return +k[1]*1000;
    var v=pick(o,TT_DATE);if(!v||/^0001-/.test(v))return null;
    var ms=toMs(v);return ms!=null&&ms>0?ms:null;
  }
  function ttTrue(v){return /^(true|1|yes|oui)$/i.test(String(v==null?'':v).trim());}
  function ttFalse(v){return /^(false|0|no|non)$/i.test(String(v==null?'':v).trim());}
  function ttEpisode(o,show,tvdb){
    var title=show||pick(o,TT_SHOW);
    if(!title&&tvdb==null)return null;
    var se=ttInt(pick(o,TT_SEASON)),ep=ttInt(pick(o,TT_EP));
    return{title:title||null,type:'show',season:se,episode:ep,watchedAt:ttDate(o),pct:null,tvdb:tvdb};
  }
  function ttYear(v){var y=ttInt(String(v||'').slice(0,4));return y!=null&&y>=1888?y:null;}
  function ttMovie(o){
    var slug=String(pick(o,['alpha range key'])||'').replace(/^(re)?(watch|towatch)-alpha-/,'').replace(/-/g,' ').trim();
    var title=pick(o,['movie name','movie title'])||pick(o,['title','name'])||slug;
    if(!title)return null;
    return{title:title,type:'movie',season:null,episode:null,watchedAt:ttDate(o),pct:null,tvdb:null,year:ttYear(pick(o,['release date','year']))};
  }
  /* Une ligne CSV/objet TV Time → événement, ou null (pas un visionnage) */
  function ttRow(o,file){
    var f=String(file||'').toLowerCase(),key=String(pick(o,['key'])||''),type=low(pick(o,['type'])||''),ent=low(pick(o,['entity type'])||'');
    if(/tvtime-movies/.test(f)){if(ttFalse(pick(o,['is watched','watched'])))return null;return ttMovie(o);}
    if(/tvtime-series-episodes|tvtime-episodes/.test(f)){
      if(!ttTrue(pick(o,['is watched','watched'])))return null;
      return ttEpisode(o,null,ttInt(pick(o,['series tvdb id','show tvdb id','tvdb show id','series id','show id'])));
    }
    if(/seen_episode/.test(f))return ttEpisode(o,null,ttInt(pick(o,TT_SHOWID)));
    if(key){
      if(/^(re)?watch-episode-/.test(key))return ttEpisode(o,null,ttInt(pick(o,TT_SHOWID)));
      if(!/^(re)?watch-/.test(key))return null;/* user-series-, follow-, towatch-… : pas un visionnage */
    }
    if(type&&type!=='watch'&&type!=='rewatch')return null;
    if(ent==='movie')return ttMovie(o);
    if(ent==='episode')return ttEpisode(o,null,ttInt(pick(o,TT_SHOWID)));
    if(!type&&!key)return null;
    return pick(o,TT_SEASON)!=null||pick(o,TT_SHOW)?ttEpisode(o,null,ttInt(pick(o,TT_SHOWID))):(pick(o,['movie name'])?ttMovie(o):null);
  }
  function parseTvTimeObjs(objs,file){var out=[];(objs||[]).forEach(function(o){var e=ttRow(o,file);if(e)out.push(e);});return out;}
  /* JSON de TV Time Out : série → saisons → épisodes (is_watched), ou liste de films */
  function parseTvTimeJson(v,file){
    var out=[],movies=/movie/.test(String(file||'').toLowerCase());
    function walk(x,show,tvdb,season){
      if(Array.isArray(x)){x.forEach(function(y){walk(y,show,tvdb,season);});return;}
      if(!x||typeof x!=='object')return;
      if(Array.isArray(x.seasons)){
        var name=pick(x,['name','title'].concat(TT_SHOW))||show,id=ttInt(pick(x,['tvdb id','tvdb','id tvdb']))||(x.id&&typeof x.id==='object'?ttInt(x.id.tvdb):null);
        x.seasons.forEach(function(s){walk(s,name,id!=null?id:tvdb,s&&s.number!=null?ttInt(s.number):ttInt(pick(s||{},TT_SEASON)));});return;
      }
      if(Array.isArray(x.episodes)){var sn=season!=null?season:ttInt(pick(x,['number'].concat(TT_SEASON)));x.episodes.forEach(function(e){walk(e,show||pick(x,TT_SHOW),tvdb,sn);});return;}
      if(show&&(x.is_watched!==undefined||x.watched!==undefined)){
        if(!(x.is_watched===true||x.watched===true||ttTrue(x.is_watched)||ttTrue(x.watched)))return;
        var ev=ttEpisode(x,show,tvdb);if(!ev)return;
        if(ev.season==null)ev.season=season;if(ev.episode==null)ev.episode=ttInt(x.number);
        out.push(ev);return;
      }
      if(movies||pick(x,['movie name'])){if(x.is_watched===false||ttFalse(x.is_watched))return;var m=ttMovie(x);if(m)out.push(m);return;}
      Object.keys(x).forEach(function(k){if(x[k]&&typeof x[k]==='object')walk(x[k],show,tvdb,season);});
    }
    walk(v,null,null,null);
    return out;
  }
  /* Après lecture de tous les fichiers : nom de série retrouvé par son id TVDB (fichiers qui ne
     donnent que s_id), revisionnages fusionnés (premier visionnage gardé) */
  function tvtimeFinalize(events){
    var names={};
    (events||[]).forEach(function(e){if(e&&e.tvdb!=null&&e.title&&!names[e.tvdb])names[e.tvdb]=e.title;});
    var by={},out=[];
    (events||[]).forEach(function(e){
      if(!e)return;
      if(!e.title&&e.tvdb!=null)e.title=names[e.tvdb]||null;
      if(!e.title)return;
      var k=e.type+'|'+(e.tvdb!=null?'#'+e.tvdb:low(e.title))+'|'+e.season+'|'+e.episode;
      if(e.type==='show'&&(e.season==null||e.episode==null))k+='|'+out.length;
      var prev=by[k];
      if(prev){if(e.watchedAt!=null&&(prev.watchedAt==null||e.watchedAt<prev.watchedAt))prev.watchedAt=e.watchedAt;return;}
      by[k]=e;out.push(e);
    });
    return out;
  }

  /* ---------- Fichier texte → événements ---------- */
  function looksCsv(text){var f=String(text).replace(/^\uFEFF/,'').split(/\r?\n/,1)[0]||'';return /[,;\t]/.test(f)&&/(name|title|titre|date)/i.test(f);}
  function parseText(platform,name,text){
    var n=String(name||'').toLowerCase();
    if(platform==='tvtime'){
      if(/\.json$/.test(n)||/^\s*[[{]/.test(text)){try{return parseTvTimeJson(JSON.parse(text),n);}catch(e){return [];}}
      return parseTvTimeObjs(parseCsv(text),n);
    }
    if(/\.json$/.test(n)||/^\s*[[{]/.test(text)){
      try{var arrs=walkJson(JSON.parse(text),[]);var ev=[];arrs.forEach(function(a){ev=ev.concat(platform==='apple'?parseApple(a):parseDisneyObjs(a));});return ev;}catch(e){}
    }
    if(looksCsv(text)){var objs=parseCsv(text);return platform==='apple'?parseApple(objs):parseDisneyObjs(objs);}
    return platform==='disney'?parseDisneyText(text):[];
  }
  /* Quels fichiers d'un zip lire */
  function wanted(platform,name){
    var b=String(name).split('/').pop().toLowerCase();
    if(/\.zip$/.test(b))return 'zip';
    if(platform==='tvtime')return /^(tracking-prod-records(-v2)?|seen_episode|tvtime-(series-episodes|episodes|movies|series))\.(csv|json)$/.test(b)?'text':null;
    if(platform==='apple')return /video play activity|tv app.*(play|activity)|playback activity/.test(b)&&/\.(csv|json)$/.test(b)?'text':null;
    return /(watch|view|titles|histor|playback|visionn)/.test(b)&&/\.(csv|json|txt)$/.test(b)?'text':(/\.pdf$/.test(b)?'pdf':null);
  }

  /* ---------- Événements → lignes « Détectés » → groupes ---------- */
  function toRows(events,source,normalize){
    var seen={},rows=[];
    (events||[]).forEach(function(ev,i){
      if(!ev||!ev.title)return;
      var norm=normalize(ev.title);if(!norm)return;
      var k=ev.type+'|'+norm+'|'+ev.season+'|'+ev.episode+'|'+ev.watchedAt+'|'+(ev.tvdb||'');if(seen[k])return;seen[k]=1;
      rows.push({id:null,source:source,raw_title:ev.title,normalized_title:norm,media_type:ev.type==='movie'?'movie':'show',
        season:ev.season,episode:ev.episode,tvdb_id:ev.tvdb!=null?ev.tvdb:null,watched_at:ev.watchedAt?new Date(ev.watchedAt).toISOString():null,progress_pct:ev.pct,state:'pending'});
    });
    return rows;
  }
  function summarize(groups){
    var s={total:groups.length,movies:0,shows:0};
    groups.forEach(function(g){if(g.kind==='movie')s.movies++;else s.shows++;});
    return s;
  }

  /* ---------- Suivi de la demande (local) ---------- */
  function readyAt(st,p){return st&&st.requestedAt?st.requestedAt+PLATFORMS[p].delayDays*DAY:null;}
  function status(st,p,now){
    st=st||{};
    if(st.importedAt)return{kind:'imported',at:st.importedAt,count:st.count||0};
    if(PLATFORMS[p]&&PLATFORMS[p].closed)return{kind:'none'};
    if(!st.requestedAt)return{kind:'none'};
    var r=readyAt(st,p);
    return{kind:now>=r?'due':'waiting',at:st.requestedAt,readyAt:r,daysLeft:Math.max(0,Math.ceil((r-now)/DAY))};
  }
  function dueReminders(state,now){
    return Object.keys(PLATFORMS).filter(function(p){if(PLATFORMS[p].closed)return false;var s=status(state&&state[p],p,now);return s.kind==='due'&&!((state[p]||{}).remindedDay===dayKey(now));});
  }
  function dayKey(ms){return new Date(ms).toISOString().slice(0,10);}

  return{PLATFORMS:PLATFORMS,parseCsv:parseCsv,parseApple:parseApple,parseDisneyObjs:parseDisneyObjs,parseDisneyText:parseDisneyText,
    parseText:parseText,parseTvTimeObjs:parseTvTimeObjs,parseTvTimeJson:parseTvTimeJson,tvtimeFinalize:tvtimeFinalize,splitEpisode:splitEpisode,toMs:toMs,wanted:wanted,toRows:toRows,summarize:summarize,status:status,readyAt:readyAt,dueReminders:dueReminders,dayKey:dayKey};
})();

/* ---------- Lecture de zip (y compris imbriqués) et de PDF simples, sans bibliothèque ---------- */
var GDPR_FILES=(function(){
  function inflate(bytes,fmt){
    if(typeof DecompressionStream==='undefined')return Promise.reject(new Error('no-decompress'));
    var ds=new DecompressionStream(fmt||'deflate-raw');
    var out=new Blob([bytes]).stream().pipeThrough(ds);
    return new Response(out).arrayBuffer().then(function(b){return new Uint8Array(b);});
  }
  function u16(b,o){return b[o]|(b[o+1]<<8);}
  function u32(b,o){return(b[o]|(b[o+1]<<8)|(b[o+2]<<16)|(b[o+3]<<24))>>>0;}
  function readZip(bytes){
    var eocd=-1;
    for(var i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(u32(bytes,i)===0x06054b50){eocd=i;break;}
    if(eocd<0)throw new Error('bad-zip');
    var n=u16(bytes,eocd+10),off=u32(bytes,eocd+16),entries=[];
    for(var k=0;k<n;k++){
      if(u32(bytes,off)!==0x02014b50)break;
      var method=u16(bytes,off+10),csize=u32(bytes,off+20),nlen=u16(bytes,off+28),elen=u16(bytes,off+30),clen=u16(bytes,off+32),loc=u32(bytes,off+42);
      var name=new TextDecoder().decode(bytes.subarray(off+46,off+46+nlen));
      entries.push({name:name,method:method,csize:csize,loc:loc});
      off+=46+nlen+elen+clen;
    }
    return entries.map(function(e){
      return{name:e.name,read:function(){
        var ln=u16(bytes,e.loc+26),le=u16(bytes,e.loc+28),start=e.loc+30+ln+le,raw=bytes.subarray(start,start+e.csize);
        if(e.method===0)return Promise.resolve(raw);
        if(e.method===8)return inflate(raw,'deflate-raw');
        return Promise.reject(new Error('zip-method'));
      }};
    });
  }
  function pdfText(bytes){
    var s=new TextDecoder('latin1').decode(bytes),re=/stream\r?\n/g,m,jobs=[];
    while((m=re.exec(s))){
      var st=m.index+m[0].length,en=s.indexOf('endstream',st);if(en<0)break;
      var dict=s.slice(Math.max(0,m.index-300),m.index);
      var chunk=bytes.subarray(st,en);
      jobs.push(/FlateDecode/.test(dict)?inflate(chunk,'deflate').catch(function(){return new Uint8Array();}):Promise.resolve(chunk));
      re.lastIndex=en;
    }
    return Promise.all(jobs).then(function(parts){
      var lines=[];
      parts.forEach(function(p){
        var c=new TextDecoder('latin1').decode(p);if(!/(Tj|TJ)/.test(c))return;
        var line='';
        c.replace(/\[((?:[^\]\\]|\\.)*)\]\s*TJ|\(((?:[^)\\]|\\.)*)\)\s*Tj|(T\*|Td|TD|ET|')/g,function(all,arr,str,op){
          if(op){if(line.trim())lines.push(line.trim());line='';return all;}
          if(str!=null)line+=unesc(str);
          else arr.replace(/\(((?:[^)\\]|\\.)*)\)|(-?\d+(?:\.\d+)?)/g,function(a,x,kern){if(x!=null)line+=unesc(x);else if(+kern<-200)line+=' ';return a;});
          return all;
        });
        if(line.trim())lines.push(line.trim());
      });
      return lines.join('\n');
    });
    function unesc(x){return x.replace(/\\([nrtbf()\\]|\d{1,3})/g,function(a,c){return /\d/.test(c)?String.fromCharCode(parseInt(c,8)):({n:'\n',r:'',t:' ',b:'',f:''}[c]!=null?{n:'\n',r:'',t:' ',b:'',f:''}[c]:c);});}
  }
  /* Fichier → événements (zip parcouru en profondeur, 3 niveaux max) */
  function collect(platform,name,bytes,depth,acc){
    var kind=/\.zip$/i.test(name)||(bytes[0]===0x50&&bytes[1]===0x4b)?'zip':/\.pdf$/i.test(name)||(bytes[0]===0x25&&bytes[1]===0x50)?'pdf':'text';
    if(kind==='zip'){
      if(depth>3)return Promise.resolve(acc);
      var ents;try{ents=readZip(bytes);}catch(e){return Promise.reject(e);}
      return ents.reduce(function(p,e){
        var w=GDPR_CORE.wanted(platform,e.name);if(!w)return p;
        return p.then(function(){return e.read().then(function(b){acc.files.push(e.name.split('/').pop());return collect(platform,e.name,b,depth+1,acc);});});
      },Promise.resolve()).then(function(){return acc;});
    }
    if(kind==='pdf')return pdfText(bytes).then(function(txt){acc.events=acc.events.concat(GDPR_CORE.parseText(platform,name+'.txt',txt));return acc;});
    acc.events=acc.events.concat(GDPR_CORE.parseText(platform,name,new TextDecoder('utf-8').decode(bytes)));
    return Promise.resolve(acc);
  }
  function fromFiles(platform,files){
    var acc={events:[],files:[]};
    return Array.prototype.reduce.call(files,function(p,f){
      return p.then(function(){return f.arrayBuffer();}).then(function(b){acc.files.push(f.name);return collect(platform,f.name,new Uint8Array(b),0,acc);});
    },Promise.resolve()).then(function(){return acc;});
  }
  return{readZip:readZip,pdfText:pdfText,collect:collect,fromFiles:fromFiles};
})();
if(typeof module!=='undefined'&&module.exports)module.exports={GDPR_CORE:GDPR_CORE,GDPR_FILES:GDPR_FILES};

/* ======================= Interface (navigateur) ======================= */
if(typeof window!=='undefined'&&typeof document!=='undefined'){(function(){
var C=GDPR_CORE,P=C.PLATFORMS,ui={p:'apple',step:0,busy:false,result:null,error:null,opener:null,paste:''};
function key(){return 'wl_gdpr_'+((typeof authUser!=='undefined'&&authUser&&authUser.id)||'anon');}
function load(){try{return JSON.parse(localStorage.getItem(key())||'{}')||{};}catch(e){return {};}}
function save(s){try{localStorage.setItem(key(),JSON.stringify(s));}catch(e){}}
function setP(p,patch){var s=load();s[p]=Object.assign({},s[p]||{},patch);Object.keys(s[p]).forEach(function(k){if(s[p][k]==null)delete s[p][k];});save(s);return s;}
function mbk(){return document.getElementById('gdprMbk');}
function d(ms){return fmtDate(ms,{day:'numeric',month:'long'});}
var LOGO={apple:'<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.4 12.6c0-2.5 2-3.6 2.1-3.7-1.2-1.7-3-1.9-3.6-2-1.5-.2-3 .9-3.8.9s-2-.9-3.3-.9c-1.7 0-3.3 1-4.2 2.5-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8s2 .8 3.3.8c1.4 0 2.3-1.2 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9-.1 0-2.8-1-2.8-4.2zM14 5.1c.7-.9 1.2-2 1-3.2-1 0-2.3.7-3 1.6-.7.8-1.3 2-1.1 3.1 1.2.1 2.3-.6 3.1-1.5z"/></svg>',
  tvtime:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="13" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M8 2.5l4 3.5 4-3.5"/></svg>',
  disney:'<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M3 15c3-6 12-9 18-4"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M17 6v6M14 9h6"/></svg>'};

function statusLine(p){
  var s=C.status(load()[p],p,Date.now());
  if(s.kind==='imported')return{cls:'ok',txt:tn('gd.st.imported',s.count,{date:d(s.at)})};
  if(P[p].closed)return{cls:'none',txt:t('gd.'+p+'.st')};
  if(s.kind==='due')return{cls:'due',txt:t('gd.st.due',{date:d(s.at)})};
  if(s.kind==='waiting')return{cls:'wait',txt:t('gd.st.waiting',{date:d(s.at),ready:d(s.readyAt)}),pct:Math.round(100*(1-s.daysLeft/P[p].delayDays))};
  return{cls:'none',txt:t('gd.st.none')};
}
/* Carte dans l'onglet « Détectés » (appelée par renderDetected) */
window.gdprCardHtml=function(){
  return '<div class="gd-card">'
    +'<div class="gd-card-h"><div><div class="gd-card-t">'+esc(t('gd.card.title'))+'</div><div class="gd-card-s">'+esc(t('gd.card.sub'))+'</div></div></div>'
    +'<div class="gd-plats">'+['disney','apple','tvtime'].map(function(p){
      var s=statusLine(p);
      return '<button type="button" class="gd-plat gd-'+p+' gd-'+s.cls+'" data-sfx-hover'+uiAct('gdprOpen',[p])+'>'
        +'<span class="gd-logo">'+LOGO[p]+'</span><span class="gd-pb"><span class="gd-pn">'+esc(P[p].name)+'</span><span class="gd-ps">'+esc(s.txt)+'</span>'
        +(s.pct!=null?'<span class="gd-bar"><i style="--p:'+s.pct+'%"></i></span>':'')+'</span>'
        +'<span class="gd-go">'+esc(t(P[p].closed&&s.cls==='none'?'gd.card.import':s.cls==='none'?'gd.card.start':s.cls==='ok'?'gd.card.again':s.cls==='due'?'gd.card.import':'gd.card.continue'))+'</span></button>';
    }).join('')+'</div></div>';
};

function stepsHtml(p){
  var out='';for(var i=1;i<=P[p].steps;i++)out+='<li style="--i:'+i+'"><span class="gd-n">'+i+'</span><span>'+t('gd.'+p+'.s'+i)+'</span></li>';
  return '<ol class="gd-steps">'+out+'</ol>';
}
function render(){
  var v=document.getElementById('gdprView');if(!v)return;
  var p=ui.p,st=load()[p]||{},s=C.status(st,p,Date.now());
  var TABS=['disney','apple','tvtime'],closed=!!P[p].closed;
  var tabs='<div class="gd-seg" role="tablist" style="--n:'+TABS.length+'">'+TABS.map(function(x){return '<button type="button" role="tab" aria-selected="'+(x===p)+'" class="'+(x===p?'on':'')+'"'+uiAct('gdprPlat',[x])+'>'+LOGO[x]+esc(P[x].name)+'</button>';}).join('')+'<i class="gd-seg-hl" style="--x:'+Math.max(0,TABS.indexOf(p))+'"></i></div>';
  var prog=closed?'':'<div class="gd-prog">'+[0,1,2].map(function(i){return '<span class="'+(i<ui.step?'done':i===ui.step?'on':'')+'"><b>'+(i+1)+'</b>'+esc(t('gd.step'+i))+'</span>';}).join('<i></i>')+'</div>';
  var body='';
  if(closed)ui.step=2;
  if(ui.step===0){
    body='<p class="gd-lead">'+esc(t('gd.'+p+'.lead'))+'</p>'+stepsHtml(p)
      +'<div class="gd-note">'+esc(t('gd.'+p+'.delay'))+'</div>'
      +'<div class="gd-act"><a class="btn btn-primary gd-link" href="'+esc(P[p].url)+'" target="_blank" rel="noopener noreferrer"'+uiAct('gdprLink',[p])+'>'+esc(t('gd.open',{site:p==='apple'?'privacy.apple.com':t('gd.disney.portal')}))+' ↗</a>'
      +'<button type="button" class="btn btn-ghost"'+uiAct('gdprDone',[p])+'>'+esc(t(st.requestedAt?'gd.alreadyDone':'gd.done'))+'</button></div>';
  }else if(ui.step===1){
    var pct=s.kind==='waiting'?Math.round(100*(1-s.daysLeft/P[p].delayDays)):100;
    body='<div class="gd-wait"><div class="gd-ring" style="--p:'+pct+'"><span>'+(s.kind==='waiting'?tn('gd.days',s.daysLeft):'✓')+'</span></div>'
      +'<div><div class="gd-wt">'+esc(s.kind==='waiting'?t('gd.wait.t',{date:d(s.at)}):t('gd.ready.t'))+'</div>'
      +'<div class="gd-ws">'+esc(s.kind==='waiting'?t('gd.wait.s',{ready:d(s.readyAt)}):t('gd.ready.s'))+'</div>'
      +'<div class="gd-ws">'+esc(t('gd.'+p+'.mail'))+'</div></div></div>'
      +'<div class="gd-act"><button type="button" class="btn btn-primary"'+uiAct('gdprStep',[2])+'>'+esc(t('gd.haveFile'))+'</button>'
      +'<button type="button" class="btn btn-ghost"'+uiAct('gdprStep',[0])+'>'+esc(t('gd.seeSteps'))+'</button>'
      +'<button type="button" class="btn btn-ghost gd-reset"'+uiAct('gdprReset',[p])+'>'+esc(t('gd.reset'))+'</button></div>';
  }else{
    var r=ui.result;
    body=(closed?'<p class="gd-lead">'+esc(t('gd.'+p+'.lead'))+'</p><div class="gd-note">'+esc(t('gd.'+p+'.note'))+'</div>':'')+'<label class="gd-drop'+(ui.busy?' busy':'')+'" id="gdprDrop"><input type="file" id="gdprFile" multiple accept=".zip,.csv,.json,.txt,.pdf">'
      +'<span class="gd-drop-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/></svg></span>'
      +'<span class="gd-drop-t">'+esc(ui.busy?t('gd.reading'):t('gd.drop'))+'</span><span class="gd-drop-s">'+esc(t('gd.'+p+'.files'))+'</span></label>'
      +(p==='disney'?'<details class="gd-paste"><summary>'+esc(t('gd.paste'))+'</summary><textarea id="gdprPaste" rows="4" placeholder="Titles Watched&#10;Profil  Titre  2024-01-31">'+esc(ui.paste)+'</textarea><button type="button" class="btn btn-ghost"'+uiAct('gdprPasteGo')+'>'+esc(t('gd.pasteGo'))+'</button></details>':'')
      +(ui.error?'<div class="gd-err" role="alert">'+esc(ui.error)+'</div>':'')
      +(r?'<div class="gd-res"><div class="gd-res-n">'+fmtNum(r.sum.total)+'</div><div><div class="gd-wt">'+esc(tn('gd.found',r.sum.total))+'</div><div class="gd-ws">'+esc(t('gd.foundSplit',{movies:tn('gd.movies',r.sum.movies),shows:tn('gd.shows',r.sum.shows)}))+'</div></div></div>'
        +'<div class="gd-chips">'+r.groups.slice(0,12).map(function(g,i){return '<span style="--i:'+i+'">'+esc(g.title)+'</span>';}).join('')+(r.groups.length>12?'<span>+'+fmtNum(r.groups.length-12)+'</span>':'')+'</div>'
        +'<div class="gd-act"><button type="button" class="btn btn-primary" id="gdprSendBtn"'+(r.sum.total?'':' disabled')+uiAct('gdprSend')+'>'+esc(t('gd.send'))+'</button></div>':'')
      +'<div class="gd-priv">'+esc(t('gd.privacy'))+'</div>';
  }
  v.innerHTML='<div class="mtitle gd-title" id="gdprTitle" tabindex="-1">'+esc(t('gd.title'))+'</div>'+tabs+prog+'<div class="gd-body" key="'+p+ui.step+'">'+body+'</div>';
  var drop=document.getElementById('gdprDrop'),inp=document.getElementById('gdprFile');
  if(inp)inp.addEventListener('change',function(){if(inp.files&&inp.files.length)readFiles(inp.files);});
  if(drop){
    ['dragenter','dragover'].forEach(function(n){drop.addEventListener(n,function(e){e.preventDefault();drop.classList.add('over');});});
    ['dragleave','drop'].forEach(function(n){drop.addEventListener(n,function(e){e.preventDefault();drop.classList.remove('over');});});
    drop.addEventListener('drop',function(e){if(e.dataTransfer&&e.dataTransfer.files.length)readFiles(e.dataTransfer.files);});
  }
}
function finish(p,events){
  if(p==='tvtime')events=C.tvtimeFinalize(events);
  var rows=C.toRows(events,P[p].source,DET_CORE.normalizeTitle);
  var groups=DET_CORE.groupRows(rows).map(function(g){g.ids=[];g.key=g.key+':'+P[p].source;g.local=true;return g;});
  ui.result={groups:groups,sum:C.summarize(groups)};
  ui.error=groups.length?null:t('gd.none');
}
function readFiles(files){
  var p=ui.p;ui.busy=true;ui.error=null;ui.result=null;render();
  GDPR_FILES.fromFiles(p,files).then(function(acc){finish(p,acc.events);})
    .catch(function(){ui.error=t('gd.bad');})
    .then(function(){ui.busy=false;render();if(ui.result&&ui.result.sum.total&&typeof sfx==='function')sfx('add');});
}
function openGdpr(p){
  var m=mbk();if(!m)return;
  ui.p=P[p]?p:'disney';ui.result=null;ui.error=null;
  var s=C.status(load()[ui.p],ui.p,Date.now());
  ui.step=s.kind==='none'||s.kind==='imported'?0:s.kind==='due'?2:1;
  ui.opener=document.activeElement;
  if(typeof sfx==='function')sfx('open');
  m.classList.add('on');render();
  var tt=document.getElementById('gdprTitle');if(tt)try{tt.focus({preventScroll:true});}catch(e){}
}
function closeGdpr(){var m=mbk();if(!m||!m.classList.contains('on'))return;m.classList.remove('on');if(ui.opener&&document.contains(ui.opener))try{ui.opener.focus({preventScroll:true});}catch(e){}}
var GA=window.GDPR_ACTIONS={};window.openGdpr=openGdpr;window.closeGdpr=closeGdpr;window._gdprUi=ui;
GA.gdprOpen=(function(el,e,p){openGdpr(p);});
GA.closeGdpr=(function(){closeGdpr();});
GA.gdprPlat=(function(el,e,p){if(typeof sfx==='function')sfx('click');ui.p=p;ui.result=null;ui.error=null;var s=C.status(load()[p],p,Date.now());ui.step=s.kind==='none'||s.kind==='imported'?0:s.kind==='due'?2:1;render();});
GA.gdprStep=(function(el,e,n){ui.step=n;ui.error=null;render();});
GA.gdprLink=(function(){/* lien ouvert normalement (target=_blank) */});
GA.gdprDone=(function(el,e,p){var st=load()[p]||{};if(!st.requestedAt||st.importedAt)setP(p,{requestedAt:Date.now(),importedAt:null,count:null,remindedDay:null});if(typeof sfx==='function')sfx('add');ui.step=1;render();_refresh();});
GA.gdprReset=(function(el,e,p){setP(p,{requestedAt:null,importedAt:null,count:null,remindedDay:null});ui.step=0;render();_refresh();});
GA.gdprPasteGo=(function(){var ta=document.getElementById('gdprPaste');ui.paste=ta?ta.value:'';finish(ui.p,C.parseText(ui.p,'paste.txt',ui.paste));render();});
GA.gdprSend=(function(){
  var r=ui.result;if(!r||!r.groups.length||typeof DET==='undefined')return;
  DET.local=(DET.local||[]).filter(function(g){return !r.groups.some(function(x){return x.key===g.key;});}).concat(r.groups);
  _mergeLocal();
  setP(ui.p,{importedAt:Date.now(),count:r.groups.length});
  if(typeof toast==='function')toast(tn('gd.sent',r.groups.length));
  closeGdpr();
  if(typeof updateDetectedBadge==='function')updateDetectedBadge();
  if(typeof activeTab!=='undefined'&&activeTab==='detectes'){if(typeof _detQueueLookups==='function')_detQueueLookups();renderDetected();}
  else if(typeof openDetectedTab==='function')openDetectedTab();
});
function _mergeLocal(){
  if(typeof DET==='undefined')return;
  var have={};DET.groups.forEach(function(g){have[g.key]=1;});
  (DET.local||[]).forEach(function(g){if(!have[g.key])DET.groups.push(g);});
}
window.gdprMergeLocal=_mergeLocal;
function _refresh(){if(typeof activeTab!=='undefined'&&activeTab==='detectes'&&typeof renderDetected==='function')renderDetected();}
document.addEventListener('keydown',function(e){if(e.key==='Escape'&&mbk()&&mbk().classList.contains('on'))closeGdpr();});
document.addEventListener('click',function(e){var m=mbk();if(m&&e.target===m)closeGdpr();});
/* Rappel : une fois par jour quand l'export devrait être prêt */
function remind(){
  if(typeof authUser==='undefined'||!authUser)return;
  var s=load(),due=C.dueReminders(s,Date.now());
  due.forEach(function(p){setP(p,{remindedDay:C.dayKey(Date.now())});if(typeof toast==='function')toast(t('gd.remind',{name:P[p].name}),'nfo');});
}
setTimeout(remind,4000);
})();}
