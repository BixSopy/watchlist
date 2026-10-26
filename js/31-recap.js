/* MODULE: Récap à partager (image story 1080×1920, mois ou année), dessiné dans le navigateur.
   - Uniquement les données de l'utilisateur déjà chargées (memDB) : rien n'est envoyé, aucune API ajoutée.
   - Chiffres honnêtes : la base ne garde pas d'historique épisode par épisode, seulement la date de la
     DERNIÈRE séance d'un titre (last_watched_at, depuis le 14/10/2026) et sa date d'ajout. Le récap compte donc
     des titres (regardés / terminés / ajoutés sur la période), jamais des épisodes ni des heures.
   - Téléchargement (PNG) et partage natif (Web Share API avec fichier) quand le navigateur le permet. */
var RECAP={period:'month',url:null,blob:null,busy:false};
var RECAP_W=1080,RECAP_H=1920;

/* Bornes [début, fin) de la période, en heure locale. kind : 'month' | 'lastMonth' | 'year' */
function recapRange(kind,now){
  var d=new Date(now);
  if(kind==='year')return {kind:kind,start:new Date(d.getFullYear(),0,1).getTime(),end:new Date(d.getFullYear()+1,0,1).getTime(),date:new Date(d.getFullYear(),0,1)};
  var m=d.getMonth()-(kind==='lastMonth'?1:0),y=d.getFullYear();
  var s=new Date(y,m,1);
  return {kind:'month',start:s.getTime(),end:new Date(s.getFullYear(),s.getMonth()+1,1).getTime(),date:s};
}

/* Statistiques de la période, à partir des titres (fonction pure, testée dans tests/recap.test.js) */
function recapStats(items,range){
  var inR=function(ts){return typeof ts==='number'&&isFinite(ts)&&ts>=range.start&&ts<range.end;};
  var live=(items||[]).filter(function(i){return i&&!i.deleted;});
  var watched=live.filter(function(i){return inR(i.lastWatchedAt);}).sort(function(a,b){return b.lastWatchedAt-a.lastWatchedAt;});
  var byT={film:0,serie:0,anime:0};
  watched.forEach(function(i){if(byT[i.type]!==undefined)byT[i.type]++;});
  var finished=watched.filter(function(i){return i.status==='termine';}).length;
  var added=live.filter(function(i){return inR(i.addedAt);}).length;
  var rated=watched.filter(function(i){return typeof i.myRating==='number'&&i.myRating>0;});
  var avg=rated.length?rated.reduce(function(a,i){return a+i.myRating;},0)/rated.length:null;
  var top=null;rated.forEach(function(i){if(!top||i.myRating>top.myRating)top=i;});
  return {watched:watched.length,byType:byT,finished:finished,added:added,avgRating:rated.length>=2?avg:null,
    topRated:top&&rated.length>=2?{title:top.title,rating:top.myRating}:null,
    posters:watched.filter(function(i){return i.poster;}).slice(0,3).map(function(i){return {title:i.title,poster:i.poster};}),
    empty:!watched.length&&!added};
}

function recapTitle(range){
  try{
    if(range.kind==='year')return t('recap.titleYear',{y:String(range.date.getFullYear())});
    return t('recap.titleMonth',{m:new Intl.DateTimeFormat(LOCALE,{month:'long',year:'numeric'}).format(range.date)});
  }catch(e){return '';}
}
function _rcColor(k,fb){try{var v=getComputedStyle(document.documentElement).getPropertyValue(k).trim();return v||fb;}catch(e){return fb;}}
function _rcImg(src){
  return new Promise(function(res){
    var img=new Image();img.crossOrigin='anonymous';/* image.tmdb.org : Access-Control-Allow-Origin:* */
    var done=false,end=function(v){if(!done){done=true;res(v);}};
    img.onload=function(){end(img);};img.onerror=function(){end(null);};setTimeout(function(){end(null);},6000);
    img.src=src;
  });
}
function _rcRound(c,x,y,w,h,r){c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath();}
function _rcFit(c,txt,max){var s=String(txt||'');if(c.measureText(s).width<=max)return s;while(s.length>1&&c.measureText(s+'…').width>max)s=s.slice(0,-1);return s+'…';}

/* Dessine le récap dans un canvas 1080×1920 ; résout le canvas */
function recapDraw(stats,range){
  var cv=document.createElement('canvas');cv.width=RECAP_W;cv.height=RECAP_H;
  var c=cv.getContext('2d');
  var accent=_rcColor('--accent','#5cc8ff'),bg='#0a0a0c',text='#f0f0f0',muted='#9a9aa3';
  var F="'Inter', system-ui, sans-serif";
  var fonts=(document.fonts&&document.fonts.load)?Promise.all([document.fonts.load('800 80px Inter'),document.fonts.load('600 40px Inter')]).catch(function(){}):Promise.resolve();
  return fonts.then(function(){return Promise.all(stats.posters.map(function(p){return _rcImg(IB+'w342'+p.poster);}));}).then(function(imgs){
    c.fillStyle=bg;c.fillRect(0,0,RECAP_W,RECAP_H);
    var g=c.createRadialGradient(RECAP_W*.5,-200,50,RECAP_W*.5,-200,1300);g.addColorStop(0,accent+'55');g.addColorStop(1,'rgba(10,10,12,0)');
    c.fillStyle=g;c.fillRect(0,0,RECAP_W,RECAP_H);
    c.textBaseline='alphabetic';c.textAlign='center';
    /* Logo : « cin » + « episode » en couleur d'accent */
    var wm=(typeof BRAND!=='undefined'&&BRAND.wordmark)||{main:'cin',accent:'episode'};
    c.font='800 64px '+F;var w1=c.measureText(wm.main).width,w2=c.measureText(wm.accent).width,x0=(RECAP_W-w1-w2)/2;
    c.textAlign='left';c.fillStyle=text;c.fillText(wm.main,x0,170);c.fillStyle=accent;c.fillText(wm.accent,x0+w1,170);
    c.textAlign='center';c.fillStyle=muted;c.font='600 44px '+F;c.fillText(_rcFit(c,recapTitle(range),960),RECAP_W/2,270);
    /* Affiches (jusqu'à 3, en éventail) */
    var ok=imgs.filter(Boolean),PW=300,PH=450,cy=360;
    if(ok.length){
      var xs=ok.length===1?[RECAP_W/2]:ok.length===2?[RECAP_W/2-170,RECAP_W/2+170]:[RECAP_W/2-320,RECAP_W/2,RECAP_W/2+320];
      var rot=ok.length===3?[-.07,0,.07]:ok.length===2?[-.05,.05]:[0];
      var order=ok.length===3?[0,2,1]:ok.map(function(_,i){return i;});
      order.forEach(function(i){
        c.save();c.translate(xs[i],cy+PH/2+(ok.length===3&&i!==1?30:0));c.rotate(rot[i]);
        c.shadowColor='rgba(0,0,0,.6)';c.shadowBlur=50;c.shadowOffsetY=20;
        _rcRound(c,-PW/2,-PH/2,PW,PH,28);c.fillStyle='#17171b';c.fill();c.shadowColor='transparent';
        c.save();_rcRound(c,-PW/2,-PH/2,PW,PH,28);c.clip();c.drawImage(ok[i],-PW/2,-PH/2,PW,PH);c.restore();
        c.restore();
      });
    }
    var y=ok.length?cy+PH+110:520;
    /* Chiffre principal */
    c.fillStyle=text;c.font='800 220px '+F;c.fillText(fmtNum(stats.watched),RECAP_W/2,y+150);
    c.fillStyle=accent;c.font='700 52px '+F;c.fillText(tn('recap.watched',stats.watched),RECAP_W/2,y+230);
    var parts=[];if(stats.byType.film)parts.push(tn('recap.films',stats.byType.film));if(stats.byType.serie)parts.push(tn('recap.series',stats.byType.serie));if(stats.byType.anime)parts.push(tn('recap.anime',stats.byType.anime));
    c.fillStyle=muted;c.font='600 40px '+F;if(parts.length)c.fillText(_rcFit(c,parts.join(' · '),960),RECAP_W/2,y+300);
    /* Tuiles */
    var tiles=[[fmtNum(stats.finished),tn('recap.finished',stats.finished)],[fmtNum(stats.added),tn('recap.added',stats.added)]];
    if(stats.avgRating!==null)tiles.push([fmtNum(stats.avgRating,{minimumFractionDigits:1,maximumFractionDigits:1}),t('recap.avg')]);
    var TW=(960-(tiles.length-1)*30)/tiles.length,ty=y+380;
    tiles.forEach(function(tl,i){
      var tx=60+i*(TW+30);_rcRound(c,tx,ty,TW,230,36);c.fillStyle='rgba(255,255,255,.06)';c.fill();c.strokeStyle='rgba(255,255,255,.1)';c.lineWidth=2;c.stroke();
      c.fillStyle=text;c.font='800 96px '+F;c.fillText(tl[0],tx+TW/2,ty+125);
      c.fillStyle=muted;c.font='600 34px '+F;c.fillText(_rcFit(c,tl[1],TW-30),tx+TW/2,ty+185);
    });
    if(stats.topRated){c.fillStyle=muted;c.font='600 38px '+F;c.fillText(_rcFit(c,t('recap.top',{title:stats.topRated.title,n:String(stats.topRated.rating)}),960),RECAP_W/2,ty+320);}
    /* Pied : domaine */
    var host=((typeof BRAND!=='undefined'&&BRAND.baseUrl)||location.origin).replace(/^https?:\/\//,'');
    c.fillStyle=accent;c.fillRect(RECAP_W/2-60,RECAP_H-180,120,6);
    c.fillStyle=text;c.font='700 48px '+F;c.fillText(host,RECAP_W/2,RECAP_H-100);
    return cv;
  });
}

function recapHtml(){
  var P=[['month','recap.pMonth'],['lastMonth','recap.pLast'],['year','recap.pYear']];
  var canShare=!!(navigator.share&&navigator.canShare);
  return '<div class="sh-wrap rc-wrap" role="dialog" aria-modal="true" aria-labelledby="rcTitle"><span class="sh-grab" aria-hidden="true"></span>'+
    '<button type="button" class="sh-x" aria-label="'+esc(t('common.close'))+'"'+uiAct('recapClose')+'>×</button>'+
    '<h2 id="rcTitle">'+esc(t('recap.title'))+'</h2><p class="sh-sub">'+esc(t('recap.sub'))+'</p>'+
    '<div class="sh-chips">'+P.map(function(p){var on=RECAP.period===p[0];return '<button type="button" class="'+(on?'on':'')+'" aria-pressed="'+on+'"'+uiAct('recapPeriod',[p[0]])+'>'+esc(t(p[1]))+'</button>';}).join('')+'</div>'+
    '<div class="rc-prev" id="rcPrev">'+(RECAP.empty?'<p class="rc-empty">'+esc(t('recap.empty'))+'</p>':RECAP.url?'<img alt="'+esc(t('recap.title'))+'" src="'+esc(RECAP.url)+'">':'<span class="rc-load">…</span>')+'</div>'+
    '<div class="rc-acts"><button type="button" class="btn btn-p3"'+(RECAP.blob?'':' disabled')+uiAct('recapDownload')+'>'+esc(t('recap.download'))+'</button>'+
    (canShare?'<button type="button" class="sh-ghost"'+(RECAP.blob?'':' disabled')+uiAct('recapShare')+'>'+esc(t('recap.share'))+'</button>':'')+'</div>'+
    '<div class="sh-foot"><span>'+esc(t('recap.note'))+'</span></div></div>';
}
function recapRender(){var m=document.getElementById('recapMbk');if(m&&m.classList.contains('on'))m.innerHTML=recapHtml();}
function recapBuild(){
  var range=recapRange(RECAP.period,Date.now()),st=recapStats(typeof memDB!=='undefined'?memDB:[],range);
  RECAP.url=null;RECAP.blob=null;RECAP.empty=st.empty;recapRender();
  if(st.empty)return;
  var p=RECAP.period;
  recapDraw(st,range).then(function(cv){
    if(p!==RECAP.period)return;
    RECAP.url=cv.toDataURL('image/png');/* data: (autorisé par la CSP img-src) pour l'aperçu */
    cv.toBlob(function(b){if(p!==RECAP.period)return;RECAP.blob=b;recapRender();},'image/png');
    recapRender();
  }).catch(function(){toast(t('recap.err'),'err');});
}
function recapFileName(){var r=recapRange(RECAP.period,Date.now()),d=r.date;return 'cinepisode-recap-'+d.getFullYear()+(r.kind==='year'?'':'-'+String(d.getMonth()+1).padStart(2,'0'))+'.png';}
function recapDownload(){
  if(!RECAP.blob)return;var u=URL.createObjectURL(RECAP.blob),a=document.createElement('a');
  a.href=u;a.download=recapFileName();document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(u);},4000);
}
function recapShare(){
  if(!RECAP.blob)return;
  var f;try{f=new File([RECAP.blob],recapFileName(),{type:'image/png'});}catch(e){recapDownload();return;}
  var data={files:[f],text:t('recap.shareText',{url:(typeof BRAND!=='undefined'?BRAND.baseUrl:location.origin)})};
  if(!navigator.canShare||!navigator.canShare({files:[f]})){recapDownload();return;}
  navigator.share(data).catch(function(e){if(e&&e.name!=='AbortError')recapDownload();});
}
function openRecap(){
  var m=document.getElementById('recapMbk');
  if(!m){m=document.createElement('div');m.id='recapMbk';m.className='sh-mbk';document.body.appendChild(m);
    m.addEventListener('click',function(e){if(e.target===m)closeRecap();});
    document.addEventListener('keydown',function(e){if(e.key==='Escape'&&m.classList.contains('on'))closeRecap();});}
  m.classList.add('on');if(typeof sfx==='function')sfx('open');recapBuild();
}
function closeRecap(){var m=document.getElementById('recapMbk');if(m)m.classList.remove('on');}
if(typeof module!=='undefined')module.exports={recapRange:recapRange,recapStats:recapStats};
