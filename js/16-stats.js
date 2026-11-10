/* MODULE: Statistiques de la watchlist et couleur ambiante de la fiche détail. */
/* STATS */
function openStats(){
  /* Les titres supprimés (tombstones en attente de synchro) ne comptent pas */
  var live=memDB.filter(function(i){return !i.deleted;});
  sfx('open');var total=live.length;
  var byT={film:0,serie:0,anime:0},byS={avoir:0,encours:0,termine:0},ratings=[],compat=[];
  live.forEach(function(i){byT[i.type]=(byT[i.type]||0)+1;byS[i.status]=(byS[i.status]||0)+1;if(i.myRating)ratings.push(i.myRating);if(i.myRating&&i.tmdbScore)compat.push({mine:i.myRating,tmdb:parseFloat(i.tmdbScore)});});
  var avgM=ratings.length?(ratings.reduce(function(a,b){return a+b},0)/ratings.length):0;
  var estH=Math.round(live.reduce(function(acc,i){return acc+(i.type=='film'?120:(i.totalEp||i.episode||12)*24);},0)/60);
  var avoirH=Math.round(live.filter(function(i){return i.status=='avoir'}).reduce(function(acc,i){return acc+(i.type=='film'?120:(i.totalEp||12)*24);},0)/60);
  var cHtml='';
  if(compat.length>=3){var d=compat.map(function(p){return p.mine-p.tmdb;});var avg=d.reduce(function(a,b){return a+b},0)/d.length;var r=Math.abs(avg).toFixed(1);var rr=fmtNum(Math.abs(avg),{minimumFractionDigits:1,maximumFractionDigits:1});cHtml=avg>0.5?t('stats.generous',{n:'<b>+'+rr+'</b>'}):avg<-0.5?t('stats.severe',{n:'<b>-'+rr+'</b>'}):t('stats.aligned',{n:'<b>'+rr+'</b>'});}else{cHtml=esc(t('stats.needMore'));}
  function bar(l,v,m){var p=m?Math.round((v/m)*100):0;return '<div class="bar-row"><div class="bar-lbl">'+l+'</div><div class="bar-track"><div class="bar-fill" style="width:'+p+'%"></div></div><div class="bar-val">'+v+'</div></div>';}
  var mT=Math.max(byT.film,byT.serie,byT.anime,1),mS=Math.max(byS.avoir,byS.encours,byS.termine,1);
  var html='<div class="bento-stats">'
    +'<div class="bento-tile big accent"><div class="bt-lbl">'+esc(t('stats.total'))+'</div><div class="bt-val a">'+fmtNum(total)+'</div><div class="bt-sub">'+esc(t('stats.breakdown',{films:fmtNum(byT.film),series:fmtNum(byT.serie),anime:fmtNum(byT.anime)}))+'</div></div>'
    +'<div class="bento-tile"><div class="bt-lbl">'+esc(t('stats.avgRating'))+'</div><div class="bt-val">'+(avgM?fmtNum(avgM,{minimumFractionDigits:1,maximumFractionDigits:1}):'-')+'</div></div>'
    +'<div class="bento-tile"><div class="bt-lbl">'+esc(t('stats.totalTime'))+'</div><div class="bt-val">'+esc(t('stats.hours',{n:fmtNum(estH)}))+'</div></div>'
    +'<div class="bento-tile"><div class="bt-lbl">'+esc(t('stats.leftToWatch'))+'</div><div class="bt-val">'+esc(t('stats.hours',{n:fmtNum(avoirH)}))+'</div></div>'
    +'<div class="bento-tile"><div class="bt-lbl">'+esc(t('status.encours'))+'</div><div class="bt-val">'+byS.encours+'</div></div>'
    +'</div>';
  html+='<div class="stat-sec"><div class="stat-sec-title">'+esc(t('stats.byType'))+'</div>'+bar(esc(t('type.films')),byT.film,mT)+bar(esc(t('type.series')),byT.serie,mT)+bar(esc(t('type.anime')),byT.anime,mT)+'</div>';
  html+='<div class="stat-sec"><div class="stat-sec-title">'+esc(t('stats.byStatus'))+'</div>'+bar(esc(t('status.avoir')),byS.avoir,mS)+bar(esc(t('status.encours')),byS.encours,mS)+bar(esc(t('status.termine')),byS.termine,mS)+'</div>';
  html+=statsMoreHtml(statsMore(live,Date.now()));
  html+='<div class="stat-sec"><div class="stat-sec-title">'+esc(t('stats.compat'))+'</div><div class="compat-box">'+cHtml+'</div></div>';
  document.getElementById('statsContent').innerHTML=html;document.getElementById('statsMbk').classList.add('on');
}

/* Statistiques enrichies (fonction pure, testée dans tests/stats.test.js) — uniquement memDB, rien
   n'est envoyé. Chiffres honnêtes, comme le récap (js/31-recap.js) : la base ne garde que la date de
   la DERNIÈRE séance d'un titre (lastWatchedAt), donc l'activité compte des titres par mois, jamais
   des épisodes. Genres : ids TMDB déjà enregistrés sur les titres (profil de goût, js/09) ; les
   genres doubles des séries (Action & Aventure, SF & Fantastique, Guerre & Politique) comptent une
   fois, sous le premier nom. */
var STATS_GENRE_KEY={28:'action',10759:'action',12:'adventure',16:'animation',35:'comedy',80:'crime',99:'documentary',18:'drama',
  10751:'family',10762:'family',14:'fantasy',878:'scifi',10765:'scifi',27:'horror',9648:'mystery',10749:'romance',53:'thriller',
  10752:'war',10768:'war',37:'western'};
function statsMore(items,now){
  var live=(items||[]).filter(function(i){return i&&!i.deleted;});
  var d=new Date(now),months=[];
  for(var k=11;k>=0;k--){var s=new Date(d.getFullYear(),d.getMonth()-k,1);months.push({start:s.getTime(),end:new Date(s.getFullYear(),s.getMonth()+1,1).getTime(),date:s,n:0});}
  live.forEach(function(i){
    var ts=i.lastWatchedAt;if(typeof ts!=='number'||!isFinite(ts))return;
    for(var m=0;m<months.length;m++)if(ts>=months[m].start&&ts<months[m].end){months[m].n++;break;}
  });
  var ratings=[0,0,0,0,0,0,0,0,0,0],rated=0;
  live.forEach(function(i){var r=Math.round(+i.myRating);if(r>=1&&r<=10){ratings[r-1]++;rated++;}});
  var genres={},withGenre=0;
  live.forEach(function(i){
    if(!Array.isArray(i.genreIds)||!i.genreIds.length)return;
    var seen={};i.genreIds.forEach(function(g){var key=STATS_GENRE_KEY[g];if(key)seen[key]=1;});
    var ks=Object.keys(seen);if(!ks.length)return;
    withGenre++;ks.forEach(function(key){genres[key]=(genres[key]||0)+1;});
  });
  var topGenres=Object.keys(genres).map(function(key){return{key:key,n:genres[key]};})
    .sort(function(a,b){return b.n-a.n||(a.key<b.key?-1:1);}).slice(0,6);
  var decades={};
  live.forEach(function(i){var y=parseInt(String(i.year||'').slice(0,4),10);if(y>=1880&&y<=2100){var dd=Math.floor(y/10)*10;decades[dd]=(decades[dd]||0)+1;}});
  var decList=Object.keys(decades).map(function(x){return{decade:+x,n:decades[x]};}).sort(function(a,b){return b.decade-a.decade;});
  var shows=live.filter(function(i){return(i.type==='serie'||i.type==='anime')&&(i.status==='encours'||i.status==='termine');});
  var done=shows.filter(function(i){return i.status==='termine';}).length;
  return{months:months,ratings:ratings,rated:rated,topGenres:topGenres,withGenre:withGenre,decades:decList,
    showsStarted:shows.length,showsDone:done,completion:shows.length?Math.round(100*done/shows.length):null};
}
/* Colonnes : une seule série (une teinte), barres ancrées en bas, valeur au survol / au focus,
   seule la plus haute porte son chiffre. Libellé complet lu par les lecteurs d'écran. */
function _statsCols(cols,cls){
  var max=0,top=-1;cols.forEach(function(c,i){if(c.n>max){max=c.n;top=i;}});
  return '<div class="sc-cols '+(cls||'')+'" role="list">'+cols.map(function(c,i){
    var h=max?Math.max(c.n?4:0,Math.round(100*c.n/max)):0;
    return '<div class="sc-col'+(i===top?' top':'')+'" role="listitem" tabindex="0" aria-label="'+esc(c.tip)+'" data-tip="'+esc(c.tip)+'">'
      +'<div class="sc-bar" style="--h:'+h+'%"><i></i>'+(i===top?'<b>'+fmtNum(c.n)+'</b>':'')+'</div><span class="sc-x">'+esc(c.label)+'</span></div>';
  }).join('')+'</div>';
}
function statsMoreHtml(m){
  var fmtM;try{fmtM=new Intl.DateTimeFormat(typeof LOCALE!=='undefined'?LOCALE:undefined,{month:'short'});}catch(e){fmtM=null;}
  var fmtMY;try{fmtMY=new Intl.DateTimeFormat(typeof LOCALE!=='undefined'?LOCALE:undefined,{month:'long',year:'numeric'});}catch(e){fmtMY=null;}
  var any=m.months.some(function(x){return x.n>0;});
  var html='<div class="stat-sec"><div class="stat-sec-title">'+esc(t('stats.activity'))+'</div>'
    +(any?_statsCols(m.months.map(function(x){var lbl=fmtM?fmtM.format(x.date):String(x.date.getMonth()+1);return{n:x.n,label:lbl,tip:(fmtMY?fmtMY.format(x.date):lbl)+' : '+tn('stats.titlesN',x.n)};}),'sc-months')
      :'<div class="compat-box">'+esc(t('stats.noActivity'))+'</div>')
    +'<div class="sc-hint">'+esc(t('stats.activityHint'))+'</div></div>';
  html+='<div class="stat-sec"><div class="stat-sec-title">'+esc(t('stats.myRatings'))+(m.rated?' <span class="sc-n">'+esc(tn('stats.ratedN',m.rated))+'</span>':'')+'</div>'
    +(m.rated?_statsCols(m.ratings.map(function(n,i){return{n:n,label:String(i+1),tip:(i+1)+'/10 : '+tn('stats.titlesN',n)};}),'sc-ratings')
      :'<div class="compat-box">'+esc(t('stats.noRatings'))+'</div>')+'</div>';
  if(m.topGenres.length){
    var gMax=m.topGenres[0].n;
    html+='<div class="stat-sec"><div class="stat-sec-title">'+esc(t('stats.genres'))+'</div>'
      +'<div class="sc-rows">'+m.topGenres.map(function(g){return _statsBar(t('genre.'+g.key),g.n,gMax);}).join('')+'</div>'
      +'<div class="sc-hint">'+esc(t('stats.genresHint',{titles:tn('stats.titlesN',m.withGenre)}))+'</div></div>';
  }
  if(m.decades.length>1){
    var dMax=Math.max.apply(null,m.decades.map(function(x){return x.n;}));
    html+='<div class="stat-sec"><div class="stat-sec-title">'+esc(t('stats.decades'))+'</div>'
      +'<div class="sc-rows">'+m.decades.slice(0,8).map(function(x){return _statsBar(t('stats.decade',{y:String(x.decade)}),x.n,dMax);}).join('')+'</div></div>';
  }
  if(m.completion!=null){
    html+='<div class="stat-sec"><div class="stat-sec-title">'+esc(t('stats.completion'))+'</div>'
      +'<div class="sc-ring-row"><div class="sc-ring" style="--p:'+m.completion+'" role="img" aria-label="'+esc(m.completion+' %')+'"><span>'+fmtNum(m.completion)+' %</span></div>'
      +'<div class="sc-ring-tx">'+esc(t('stats.completionSub',{done:fmtNum(m.showsDone),n:fmtNum(m.showsStarted)}))+'</div></div></div>';
  }
  return html;
}
function _statsBar(l,v,m){var p=m?Math.round((v/m)*100):0;return '<div class="bar-row"><div class="bar-lbl">'+esc(l)+'</div><div class="bar-track"><div class="bar-fill" style="width:'+p+'%"></div></div><div class="bar-val">'+fmtNum(v)+'</div></div>';}
if(typeof module!=='undefined'&&module.exports)module.exports={statsMore:statsMore,STATS_GENRE_KEY:STATS_GENRE_KEY};

/* AMBIENT COLOR — canvas same-origin via proxy */
function applyAmbient(imgUrl, targetEl, opacity){
  if(!imgUrl||!targetEl)return;
  opacity=opacity||0.10;
  var img=new Image();
  img.crossOrigin='anonymous';
  img.onload=function(){
    try{
      var c=document.createElement('canvas');
      c.width=8;c.height=8;
      var ctx=c.getContext('2d');
      ctx.drawImage(img,0,0,8,8);
      var d=ctx.getImageData(0,0,8,8).data;
      var r=0,g=0,b=0,n=0;
      for(var i=0;i<d.length;i+=4){if(d[i+3]>10){r+=d[i];g+=d[i+1];b+=d[i+2];n++;}}
      if(!n)return;
      r=Math.round(r/n);g=Math.round(g/n);b=Math.round(b/n);
      var col='rgba('+r+','+g+','+b+','+opacity+')';
      targetEl.style.setProperty('--ambient-color',col);
      targetEl.style.background='radial-gradient(ellipse at top center, var(--ambient-color) 0%, transparent 70%)';
    }catch(e){
      /* Canvas tainted ou autre erreur — dégradation silencieuse */
      targetEl.style.background='';
    }
  };
  img.onerror=function(){targetEl.style.background='';};
  /* image.tmdb.org renvoie Access-Control-Allow-Origin:* → canvas lisible sans proxy */
  img.src=imgUrl;
}

