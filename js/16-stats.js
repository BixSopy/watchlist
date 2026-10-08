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
  html+='<div class="stat-sec"><div class="stat-sec-title">'+esc(t('stats.compat'))+'</div><div class="compat-box">'+cHtml+'</div></div>';
  document.getElementById('statsContent').innerHTML=html;document.getElementById('statsMbk').classList.add('on');
}

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

