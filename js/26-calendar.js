/* MODULE: Onglet « Calendrier » — prochaines sorties (épisodes, films) des titres de la liste.
   Tout est calculé dans le navigateur depuis la liste existante (aucune table, aucune migration) :
   séries / anime via /tv/{id} puis /tv/{id}/season/{n} (dates de chaque épisode de la saison en cours),
   films via /movie/{id}/release_dates (sorties de la région : ciné 3, numérique 4, physique 5),
   repli sur release_date. Appels par le proxy /api/tmdb habituel (clés côté serveur), cache tf()
   + localStorage 12 h. L'export .ics est généré localement (Blob text/calendar), rien n'est envoyé.
   Le cœur (CAL_CORE) est pur, sans DOM : testé par tests/calendar.test.js. */
var CAL_CORE=(function(){
  function pad(n){return (n<10?'0':'')+n;}
  function ymd(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}
  function parse(s){var p=String(s).split('-');return new Date(+p[0],(+p[1]||1)-1,+p[2]||1);}
  function addDays(s,n){var d=parse(s);d.setDate(d.getDate()+n);return ymd(d);}
  /* Grille du mois : semaines du lundi au dimanche, 5 ou 6 lignes, jours hors mois marqués out */
  function monthGrid(year,month){
    var first=new Date(year,month,1),off=(first.getDay()+6)%7,start=new Date(year,month,1-off);
    var last=new Date(year,month+1,0),cells=off+last.getDate(),rows=Math.ceil(cells/7),out=[];
    for(var i=0;i<rows*7;i++){var d=new Date(start.getFullYear(),start.getMonth(),start.getDate()+i);out.push({date:ymd(d),day:d.getDate(),out:d.getMonth()!==month});}
    return out;
  }
  function kindOf(item){return item.type==='film'?'film':(item.type==='anime'?'anime':'serie');}
  /* Épisodes d'une saison → événements (épisodes déjà vus masqués si demandé) */
  function episodeEvents(item,season,opts){
    var res=[],u=opts||{};
    ((season&&season.episodes)||[]).forEach(function(ep){
      if(!ep.air_date)return;
      var s=ep.season_number!=null?ep.season_number:season.season_number,e=ep.episode_number;
      if(u.hideWatched&&item.saison!=null&&(s<item.saison||(s===item.saison&&e<=(item.episode||0))))return;
      res.push({date:ep.air_date,itemId:item.id,title:item.title,poster:item.poster||null,kind:kindOf(item),s:s,e:e,name:ep.name||''});
    });
    return res;
  }
  /* Sorties d'un film : une par type (ciné 3, numérique 4, physique 5) pour la région, sinon release_date */
  var REL={3:'cinema',4:'digital',5:'physical'};
  function filmEvents(item,rd,movie,region){
    var res=[],seen={};
    var r=((rd&&rd.results)||[]).filter(function(x){return x.iso_3166_1===region;})[0];
    ((r&&r.release_dates)||[]).forEach(function(x){
      var k=REL[x.type];if(!k||!x.release_date)return;var d=String(x.release_date).slice(0,10);
      if(seen[k]&&seen[k]<=d)return;seen[k]=d;
    });
    Object.keys(seen).forEach(function(k){res.push({date:seen[k],itemId:item.id,title:item.title,poster:item.poster||null,kind:'film',rel:k});});
    if(!res.length&&movie&&movie.release_date)res.push({date:movie.release_date,itemId:item.id,title:item.title,poster:item.poster||null,kind:'film',rel:'release'});
    return res;
  }
  function filter(evs,kind){return kind&&kind!=='all'?evs.filter(function(e){return e.kind===kind;}):evs.slice();}
  function sortEvs(evs){return evs.slice().sort(function(a,b){return a.date<b.date?-1:a.date>b.date?1:(a.title<b.title?-1:a.title>b.title?1:(a.s||0)-(b.s||0)||(a.e||0)-(b.e||0));});}
  function groupByDay(evs){var m={};sortEvs(evs).forEach(function(e){(m[e.date]=m[e.date]||[]).push(e);});return m;}
  function upcoming(evs,from,days){var to=addDays(from,days);return sortEvs(evs.filter(function(e){return e.date>=from&&e.date<to;}));}
  function code(e){return e.e==null?'':(e.s!=null?'S'+pad(e.s)+' · ':'')+'E'+pad(e.e);}
  /* .ics (RFC 5545) : événements sur la journée, texte échappé, lignes repliées à 75 octets */
  function icsEsc(s){return String(s==null?'':s).replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\r?\n/g,'\\n');}
  function fold(line){var out='',b=0;for(var i=0;i<line.length;i++){var ch=line[i],n=unescape(encodeURIComponent(ch)).length;if(b+n>75){out+='\r\n ';b=1;}out+=ch;b+=n;}return out;}
  function buildIcs(evs,o){
    o=o||{};var stamp=(o.now||new Date()).toISOString().replace(/[-:]/g,'').replace(/\.\d+/,'');
    var L=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Cinepisode//Calendrier//FR','CALSCALE:GREGORIAN','METHOD:PUBLISH','X-WR-CALNAME:'+icsEsc(o.name||'Cinepisode')];
    sortEvs(evs).forEach(function(e){
      var d=e.date.replace(/-/g,''),nd=addDays(e.date,1).replace(/-/g,'');
      var sum=e.title+(code(e)?' — '+code(e).replace(' · ',''):'')+(e.label?' ('+e.label+')':'');
      L.push('BEGIN:VEVENT','UID:'+icsEsc(e.itemId+'-'+(e.rel||code(e).replace(/\W/g,'')||'x')+'-'+d)+'@cinepisode','DTSTAMP:'+stamp,
        'DTSTART;VALUE=DATE:'+d,'DTEND;VALUE=DATE:'+nd,'SUMMARY:'+icsEsc(sum),'TRANSP:TRANSPARENT');
      if(e.name)L.push('DESCRIPTION:'+icsEsc(e.name));
      L.push('END:VEVENT');
    });
    L.push('END:VCALENDAR');
    return L.map(fold).join('\r\n')+'\r\n';
  }
  return {ymd:ymd,parse:parse,addDays:addDays,monthGrid:monthGrid,episodeEvents:episodeEvents,filmEvents:filmEvents,filter:filter,sortEvs:sortEvs,groupByDay:groupByDay,upcoming:upcoming,code:code,buildIcs:buildIcs,kindOf:kindOf};
})();
if(typeof module!=='undefined')module.exports=CAL_CORE;

if(typeof document!=='undefined'){(function(){
var CAL_ACTIONS=window.CAL_ACTIONS={};
var C=CAL_CORE,CACHE_KEY='wl_cal_cache',TTL=43200000,CONC=4;
var st={y:0,m:0,view:null,kind:'all',sel:null,loading:false,events:[],loaded:false,gen:0};
var opts=(function(){try{return Object.assign({onlyList:true,hideWatched:true,avoirFilms:false},JSON.parse(localStorage.getItem('wl_cal_opts')||'{}'));}catch(e){return {onlyList:true,hideWatched:true,avoirFilms:false};}})();
var COL={film:'#5cc8ff',serie:'#a78bfa',anime:'#ff7aa8'};
function today(){return C.ymd(new Date());}
function isMobile(){try{return window.matchMedia('(max-width:700px)').matches;}catch(e){return false;}}
function readCache(){try{return JSON.parse(localStorage.getItem(CACHE_KEY)||'{}')||{};}catch(e){return {};}}
function writeCache(c){try{localStorage.setItem(CACHE_KEY,JSON.stringify(c));}catch(e){}}
function candidates(){
  return memDB.filter(function(i){
    if(i.deleted||!i.tmdbId)return false;
    if(i.type==='film')return i.status==='encours'||(opts.avoirFilms&&i.status==='avoir');
    return i.status==='encours'||i.status==='avoir'||(!opts.onlyList&&i.status==='termine');
  });
}
function isMovie(i){return i.type==='film'||i.tmdbType==='movie';}
function fetchItem(item){
  var lang='?language='+TMDB_LANG;
  if(isMovie(item)){
    return Promise.all([tf(TB+'/movie/'+item.tmdbId+'/release_dates').catch(function(){return null;}),tf(TB+'/movie/'+item.tmdbId+lang).catch(function(){return null;})])
      .then(function(r){return C.filmEvents(item,r[0],r[1],TMDB_REGION||'FR');});
  }
  return tf(TB+'/tv/'+item.tmdbId+lang).then(function(d){
    var seasons={},nx=d&&d.next_episode_to_air,la=d&&d.last_episode_to_air,lim=C.addDays(today(),-62);
    if(nx&&nx.season_number!=null)seasons[nx.season_number]=1;
    if(la&&la.season_number!=null&&la.air_date&&la.air_date>=lim)seasons[la.season_number]=1;
    var ns=Object.keys(seasons);
    if(!ns.length)return [];
    return Promise.all(ns.map(function(n){return tf(TB+'/tv/'+item.tmdbId+'/season/'+n+lang).catch(function(){return null;});})).then(function(ss){
      var evs=[];ss.forEach(function(s){evs=evs.concat(C.episodeEvents(item,s,{hideWatched:false}));});
      if(!evs.length&&nx&&nx.air_date)evs=C.episodeEvents(item,{season_number:nx.season_number,episodes:[nx]},{});
      return evs;
    });
  });
}
function load(force){
  var gen=++st.gen,list=candidates(),cache=readCache(),now=Date.now(),out=[],todo=[];
  list.forEach(function(i){var c=cache[i.id];if(!force&&c&&now-c.t<TTL&&c.k===i.tmdbId)out.push.apply(out,c.e.map(function(e){e.title=i.title;e.poster=i.poster||e.poster;return e;}));else todo.push(i);});
  st.events=out;st.loaded=!todo.length;st.loading=!!todo.length;paint();
  if(!todo.length)return;
  var idx=0,active=0,dirty=false;
  function next(){
    if(gen!==st.gen)return;
    if(idx>=todo.length&&!active){st.loading=false;st.loaded=true;writeCache(cache);paint();return;}
    while(active<CONC&&idx<todo.length){(function(it){active++;fetchItem(it).then(function(evs){
      cache[it.id]={t:Date.now(),k:it.tmdbId,e:evs};if(gen===st.gen){st.events=st.events.concat(evs);dirty=true;}
    }).catch(function(){}).then(function(){active--;if(dirty&&gen===st.gen){dirty=false;paint();}next();});})(todo[idx++]);}
  }
  next();
}
/* Événements visibles : filtre de type + épisodes déjà vus masqués (selon la position dans la liste) */
function visible(){
  var by={};memDB.forEach(function(i){by[i.id]=i;});
  var evs=C.filter(st.events,st.kind).filter(function(e){
    var i=by[e.itemId];if(!i||i.deleted)return false;
    if(opts.hideWatched&&e.e!=null&&i.saison!=null&&(e.s<i.saison||(e.s===i.saison&&e.e<=(i.episode||0))))return false;
    return true;
  });
  return evs.map(function(e){e.label=e.kind==='film'?t('cal.rel.'+(e.rel||'release')):'';return e;});
}
function cap(s){return s.charAt(0).toUpperCase()+s.slice(1);}
function monthTitle(){return cap(new Intl.DateTimeFormat(LOCALE,{month:'long',year:'numeric'}).format(new Date(st.y,st.m,1)));}
function wd(date,len){return new Intl.DateTimeFormat(LOCALE,{weekday:len||'short'}).format(C.parse(date)).replace('.','');}
function poster(e,cls){return '<span class="'+cls+'"'+(e.poster?' style="background-image:url(\''+IB+'w154'+esc(e.poster)+'\')"':'')+'></span>';}
function sub(e){return e.kind==='film'?esc(e.label):esc(C.code(e));}
function typeLbl(k){return t(k==='film'?'cal.kind.film':k==='anime'?'type.anime':'cal.kind.serie');}
function evCell(e){return '<div class="cal-ev" style="--c:'+COL[e.kind]+'"'+uiAct('openPlexQuiet',[e.itemId])+' title="'+esc(e.title+(C.code(e)?' '+C.code(e):''))+'">'+poster(e,'cal-po')+'<span class="cal-et"><b>'+esc(e.title)+'</b><i>'+sub(e)+'</i></span></div>';}
function dots(list){var k={};list.forEach(function(e){k[e.kind]=1;});return '<span class="cal-dots">'+Object.keys(k).map(function(x){return '<i style="background:'+COL[x]+'"></i>';}).join('')+'</span>';}
function hour(e,td){return e.date<=td?t('cal.avail'):t(e.kind==='film'?'cal.release':'cal.soon');}
function agendaHtml(evs,from,days){
  var td=today(),list=days?C.upcoming(evs,from,days):C.sortEvs(evs),g=C.groupByDay(list),keys=Object.keys(g).sort();
  if(!keys.length)return '<div class="cal-empty">'+esc(st.loading?t('common.loading'):t('cal.empty'))+'</div>';
  return keys.map(function(d){
    var now=d===td;
    return '<div class="cal-ag'+(now?' now':'')+'"><div class="cal-agd"><b>'+C.parse(d).getDate()+'</b><span>'+esc(wd(d))+(LANG==='fr'?'.':'')+'</span>'+(now?'<em>'+esc(t('cal.today'))+'</em>':'')+'</div><div class="cal-agl">'+
      g[d].map(function(e){return '<div class="cal-ai" style="--c:'+COL[e.kind]+'"'+uiAct('openPlexQuiet',[e.itemId])+'>'+poster(e,'cal-ap')+'<span class="cal-at"><b>'+esc(e.title)+'</b><i><em class="cal-ty">'+esc(typeLbl(e.kind))+'</em> '+sub(e)+'</i></span><span class="cal-ah">'+esc(hour(e,td))+'</span></div>';}).join('')+'</div></div>';
  }).join('');
}
function paint(){
  var sec=document.getElementById('calendarSection');if(!sec)return;
  updateBadge();
  if(typeof renderHomeNext==='function')renderHomeNext();
  if(activeTab!=='calendar')return;
  var td=today(),evs=visible(),mobile=isMobile(),view=st.view||(mobile?'agenda':'month');
  var mStart=C.ymd(new Date(st.y,st.m,1)),mEnd=C.ymd(new Date(st.y,st.m+1,1));
  var inMonth=evs.filter(function(e){return e.date>=mStart&&e.date<mEnd;});
  var g=C.groupByDay(evs),grid=C.monthGrid(st.y,st.m);
  var curMonth=td>=mStart&&td<mEnd,sel=st.sel&&st.sel>=mStart&&st.sel<mEnd?st.sel:(curMonth?td:mStart);
  var ic={prev:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M15 5l-7 7 7 7"/></svg>',next:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M9 5l7 7-7 7"/></svg>'};
  var seg=function(cls,items,cur,act){return '<div class="cal-seg '+cls+'" role="group">'+items.map(function(x){return '<button type="button" class="'+(x[0]===cur?'on':'')+'" aria-pressed="'+(x[0]===cur)+'"'+uiAct(act,[x[0]])+'>'+x[1]+'</button>';}).join('')+'</div>';};
  var dot=function(k){return '<i style="background:'+COL[k]+'"></i>';};
  var h='<div class="cal-bar"><h2 class="cal-h1">'+esc(monthTitle())+'</h2><div class="cal-nv"><button type="button" class="cal-ar" aria-label="'+esc(t('cal.prev'))+'"'+uiAct('calNav',[-1])+'>'+ic.prev+'</button><button type="button" class="cal-ar" aria-label="'+esc(t('cal.next'))+'"'+uiAct('calNav',[1])+'>'+ic.next+'</button></div>'+
    '<button type="button" class="cal-td"'+uiAct('calNav',[0])+'>'+esc(t('cal.todayBtn'))+'</button><span class="cal-sp"></span>'+
    seg('cal-vw',[['month','▦ '+esc(t('cal.month'))],['agenda','☰ '+esc(t('cal.agenda'))]],view,'calView')+
    seg('cal-flt',[['all',esc(t('tab.all'))],['film',dot('film')+esc(t('type.films'))],['serie',dot('serie')+esc(t('type.series'))],['anime',dot('anime')+esc(t('type.anime'))]],st.kind,'calKind')+
    '<button type="button" class="cal-ics"'+uiAct('calIcs')+'><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>'+'<span class="cal-ics-l">'+esc(t('cal.ics'))+'</span><span class="cal-ics-s">'+esc(t('cal.icsShort'))+'</span></button></div>';
  /* Bande de la semaine (mobile) */
  var wkStart=C.addDays(sel,-((C.parse(sel).getDay()+6)%7)),wk='';
  for(var i=0;i<7;i++){var d=C.addDays(wkStart,i),l=g[d]||[];wk+='<button type="button" class="cal-wk'+(d===sel?' on':'')+(d===td?' today':'')+'"'+(l.length?' style="--c:'+COL[l[0].kind]+'"':'')+uiAct('calSel',[d])+'><span>'+esc(wd(d))+'</span><b>'+C.parse(d).getDate()+'</b><i></i></button>';}
  h+='<div class="cal-week">'+wk+'</div>';
  var main;
  if(view==='month'){
    var cells=grid.map(function(c){
      var l=g[c.date]||[],cls='cal-d'+(c.out?' out':'')+(c.date<td?' past':'')+(c.date===td?' today':'')+(c.date===sel&&c.date!==td?' sel':'');
      return '<div class="'+cls+'"'+uiAct('calSel',[c.date])+'><span class="cal-n">'+c.day+'</span>'+(c.date===td?'<span class="cal-tag">'+esc(t('cal.today'))+'</span>':'')+
        (l.length&&!c.out?evCell(l[0])+(l.length>1?'<span class="cal-more">'+esc(tn('cal.more',l.length-1))+'</span>':'')+dots(l):'')+'</div>';
    }).join('');
    var wds=[];for(var j=0;j<7;j++)wds.push('<span>'+esc(wd(grid[j].date))+'</span>');
    main='<section class="cal-grid-wrap"><div class="cal-wd">'+wds.join('')+'</div><div class="cal-g">'+cells+'</div></section>';
  }else{
    main='<section class="cal-grid-wrap cal-agenda-full"><h3 class="cal-card-h">'+esc(monthTitle())+' <em>'+esc(tn('cal.count',inMonth.length))+'</em></h3>'+agendaHtml(inMonth,null,0)+'</section>';
  }
  var from=curMonth&&sel<td?td:sel;
  var sw=function(k,lbl){return '<label class="cal-opt-l"><input type="checkbox" class="cal-sw"'+(opts[k]?' checked':'')+uiAct('calOpt',[k],'change')+'><span>'+esc(t(lbl))+'</span></label>';};
  var side='<aside class="cal-side"><div class="cal-card"><h3 class="cal-card-h">'+esc(t('cal.upcoming'))+' <em>'+esc(tn('cal.days',7))+'</em>'+(st.loading?'<span class="cal-spin" aria-hidden="true"></span>':'')+'</h3>'+agendaHtml(evs,from,7)+'</div>'+
    '<div class="cal-card cal-optc"><h3 class="cal-card-h">'+esc(t('cal.options'))+'</h3><div class="cal-opt">'+sw('onlyList','cal.optList')+sw('hideWatched','cal.optWatched')+sw('avoirFilms','cal.optAvoir')+'<p class="cal-note">'+esc(t('cal.note'))+'</p></div></div></aside>';
  sec.innerHTML=h+'<div class="cal-main cal-'+view+'">'+main+side+'</div>';
}
function updateBadge(){
  var b=document.querySelector('.ntab[data-tab="calendar"]');if(!b)return;
  var em=b.querySelector('.ntab-cnt');
  if(!st.loaded&&!st.events.length){if(em)em.remove();return;}
  var td=today(),n=visible().filter(function(e){return e.date>=td&&e.date<C.addDays(td,30);}).length;
  if(!em){em=document.createElement('em');em.className='ntab-cnt';b.appendChild(em);}
  em.textContent=fmtNum(n);
}
function setMonth(y,m){st.y=y;st.m=m;}
CAL_ACTIONS.calNav=(function(el,e,d){sfx('click');if(!d){var n=new Date();setMonth(n.getFullYear(),n.getMonth());st.sel=today();}else{var x=new Date(st.y,st.m+d,1);setMonth(x.getFullYear(),x.getMonth());st.sel=null;}paint();});
CAL_ACTIONS.calView=(function(el,e,v){sfx('click');st.view=v;paint();});
CAL_ACTIONS.calKind=(function(el,e,k){sfx('click');st.kind=k;paint();});
CAL_ACTIONS.calSel=(function(el,e,d){st.sel=d;paint();});
CAL_ACTIONS.calOpt=(function(el,e,k){opts[k]=!!el.checked;try{localStorage.setItem('wl_cal_opts',JSON.stringify(opts));}catch(x){}if(k==='hideWatched')paint();else load(false);});
CAL_ACTIONS.calIcs=(function(){
  sfx('click');var td=today(),evs=visible().filter(function(e){return e.date>=td;});
  if(!evs.length){toast(t('cal.icsEmpty'));return;}
  var blob=new Blob([C.buildIcs(evs,{name:t('cal.icsName')})],{type:'text/calendar;charset=utf-8'}),a=document.createElement('a');
  a.href=URL.createObjectURL(blob);a.download='cinepisode-calendrier.ics';document.body.appendChild(a);a.click();
  setTimeout(function(){URL.revokeObjectURL(a.href);a.remove();},1000);toast(tn('cal.icsDone',evs.length));
});
window.onCalendarTabShown=function(){
  if(!st.y){var n=new Date();setMonth(n.getFullYear(),n.getMonth());}
  try{if(location.hash!=='#calendrier')history.replaceState(null,'',location.pathname+location.search+'#calendrier');}catch(e){}
  var s2=sig();if(s2!==_sig||(!st.loaded&&!st.loading)){_sig=s2;load(false);}else paint();
};
window.onCalendarTabHidden=function(){try{if(location.hash==='#calendrier')history.replaceState(null,'',location.pathname+location.search);}catch(e){}};
var _sig='';
function sig(){return candidates().map(function(i){return i.id+':'+i.tmdbId;}).join(',');}
window.calendarRefresh=function(){if(activeTab!=='calendar')return;var s2=sig();if(s2!==_sig){_sig=s2;load(false);}else paint();};
window._calState=st;
/* Accueil « Cette semaine » (js/25-home.js) : sorties des 7 prochains jours ; lance le chargement
   (cache local de 12 h, mêmes requêtes que l'onglet Calendrier) au premier appel. */
window.calWeek=function(){
  /* chargement différé : ne concurrence pas le démarrage de l'app ni l'ouverture d'une fiche */
  if(!st.loaded&&!st.loading&&!st._sched)st._sched=setTimeout(function(){st._sched=0;if(!st.loaded&&!st.loading){_sig=sig();load(false);}},2500);
  var td=today();
  return {loading:st.loading||!st.loaded,events:(typeof weekEvents==='function'?weekEvents(visible(),td,C.addDays):[])};
};
function openFromHash(){if(location.hash==='#calendrier'&&activeTab!=='calendar'){var b=document.querySelector('.ntab[data-tab="calendar"]');if(b)switchTab(b);}}
window.addEventListener('hashchange',openFromHash);
window.addEventListener('resize',function(){if(activeTab==='calendar'&&!st.view)paint();});
setTimeout(openFromHash,0);
})();}
