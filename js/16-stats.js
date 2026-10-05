/* MODULE: Statistiques de la watchlist et couleur ambiante de la fiche détail. */
/* STATS */
function openStats(){
  /* Les titres supprimés (tombstones en attente de synchro) ne comptent pas */
  var live=memDB.filter(function(i){return !i.deleted;});
  sfx('click');var total=live.length;
  var byT={film:0,serie:0,anime:0},byS={avoir:0,encours:0,termine:0},ratings=[],compat=[];
  live.forEach(function(i){byT[i.type]=(byT[i.type]||0)+1;byS[i.status]=(byS[i.status]||0)+1;if(i.myRating)ratings.push(i.myRating);if(i.myRating&&i.tmdbScore)compat.push({mine:i.myRating,tmdb:parseFloat(i.tmdbScore)});});
  var avgM=ratings.length?(ratings.reduce(function(a,b){return a+b},0)/ratings.length):0;
  var estH=Math.round(live.reduce(function(acc,i){return acc+(i.type=='film'?120:(i.totalEp||i.episode||12)*24);},0)/60);
  var avoirH=Math.round(live.filter(function(i){return i.status=='avoir'}).reduce(function(acc,i){return acc+(i.type=='film'?120:(i.totalEp||12)*24);},0)/60);
  var cHtml='';
  if(compat.length>=3){var d=compat.map(function(p){return p.mine-p.tmdb;});var avg=d.reduce(function(a,b){return a+b},0)/d.length;var r=Math.abs(avg).toFixed(1);cHtml=avg>0.5?'Tu notes en moyenne <b>+'+r+' points</b> au-dessus de TMDB. Tu es genereux.':avg<-0.5?'Tu notes en moyenne <b>-'+r+' points</b> en dessous de TMDB. Tu es severe.':'Tes notes sont alignees avec TMDB (ecart <b>'+r+' pt</b>).';}else{cHtml='Note au moins 3 titres pour voir ton profil.';}
  function bar(l,v,m){var p=m?Math.round((v/m)*100):0;return '<div class="bar-row"><div class="bar-lbl">'+l+'</div><div class="bar-track"><div class="bar-fill" style="width:'+p+'%"></div></div><div class="bar-val">'+v+'</div></div>';}
  var mT=Math.max(byT.film,byT.serie,byT.anime,1),mS=Math.max(byS.avoir,byS.encours,byS.termine,1);
  var html='<div class="bento-stats">'
    +'<div class="bento-tile big accent"><div class="bt-lbl">Total titres</div><div class="bt-val a">'+total+'</div><div class="bt-sub">'+byT.film+' films &bull; '+byT.serie+' séries &bull; '+byT.anime+' anime</div></div>'
    +'<div class="bento-tile"><div class="bt-lbl">Ma note moy.</div><div class="bt-val">'+(avgM?avgM.toFixed(1):'-')+'</div></div>'
    +'<div class="bento-tile"><div class="bt-lbl">Temps total</div><div class="bt-val">'+estH+'h</div></div>'
    +'<div class="bento-tile"><div class="bt-lbl">Reste a voir</div><div class="bt-val">'+avoirH+'h</div></div>'
    +'<div class="bento-tile"><div class="bt-lbl">En cours</div><div class="bt-val">'+byS.encours+'</div></div>'
    +'</div>';
  html+='<div class="stat-sec"><div class="stat-sec-title">Par type</div>'+bar('Films',byT.film,mT)+bar('Séries',byT.serie,mT)+bar('Anime',byT.anime,mT)+'</div>';
  html+='<div class="stat-sec"><div class="stat-sec-title">Par statut</div>'+bar('À voir',byS.avoir,mS)+bar('En cours',byS.encours,mS)+bar('Terminé',byS.termine,mS)+'</div>';
  html+='<div class="stat-sec"><div class="stat-sec-title">Compatibilite TMDB</div><div class="compat-box">'+cHtml+'</div></div>';
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

