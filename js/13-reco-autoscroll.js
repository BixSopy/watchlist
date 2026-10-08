/* MODULE: Défilement automatique de la sidebar recommandations. */
/* AUTO SCROLL — RAF UNIQUE, ANNULABLE, SANS SMOOTH NATIF */
var autoRAF2=0,autoSeq2=0;
function easeInOutCubic(tt){return tt<0.5?4*tt*tt*tt:1-Math.pow(-2*tt+2,3)/2;}
function stopAutoScroll(){autoSeq2++;if(autoRAF2)cancelAnimationFrame(autoRAF2);autoRAF2=0;if(autoTimer){clearTimeout(autoTimer);autoTimer=null;}}
function _animScrollTo(el,to,dur){return new Promise(function(resolve){var seq=autoSeq2,from=el.scrollTop,start=performance.now();var max=Math.max(0,el.scrollHeight-el.clientHeight);to=Math.max(0,Math.min(to,max));var wasPaused=false;function frame(now){if(seq!==autoSeq2)return resolve(false);if(autoPaused){wasPaused=true;autoRAF2=requestAnimationFrame(frame);return;}if(wasPaused){/* recale : on repart avec la position actuelle comme nouveau point de départ */from=el.scrollTop;start=now;wasPaused=false;}var p=Math.min(1,(now-start)/dur);el.scrollTop=from+(to-from)*easeInOutCubic(p);if(p<1){autoRAF2=requestAnimationFrame(frame);}else{el.scrollTop=to;autoRAF2=0;resolve(true);}}autoRAF2=requestAnimationFrame(frame);});}

/* Session 11B : cibles de scroll alignées sur chaque carte de reco (jamais de carte coupée) */
function getRecoSnapTargets(wrap){
  var max=Math.max(0,wrap.scrollHeight-wrap.clientHeight);
  var targets=[0];
  var cards=wrap.querySelectorAll('.reco-card');
  cards.forEach(function(card){
    var top=card.offsetTop-wrap.offsetTop;
    top=Math.max(0,Math.min(top,max));
    if(targets.indexOf(top)<0)targets.push(top);
  });
  targets.sort(function(a,b){return a-b;});
  if(max>0&&targets[targets.length-1]<max)targets.push(max);
  return targets;
}
function getNextRecoSnap(wrap,currentTop){
  var targets=getRecoSnapTargets(wrap);
  var tol=4;
  for(var i=0;i<targets.length;i++){
    if(targets[i]>currentTop+tol)return targets[i];
  }
  return 0;
}
async function startAutoScroll(){
  stopAutoScroll();
  loadSettings();
  if(wlSettings.wl_reco_autoscroll==='0')return;
  var wrap=document.getElementById('sbScroll');if(!wrap)return;var seq=autoSeq2;
  while(seq===autoSeq2){
    if(autoPaused||wrap.scrollHeight<=wrap.clientHeight){await new Promise(function(r){autoTimer=setTimeout(r,300);});continue;}
    var speedKey=WL_RECO_SPEEDS[wlSettings.wl_reco_speed]?wlSettings.wl_reco_speed:'normal';
    var speed=WL_RECO_SPEEDS[speedKey];
    var targets=getRecoSnapTargets(wrap);
    if(targets.length<2)return; /* pas assez de cartes distinctes pour un snap pertinent */
    var target=getNextRecoSnap(wrap,wrap.scrollTop);
    var isReturnToStart=(target===0&&wrap.scrollTop>0);
    await _animScrollTo(wrap,target,speed.duration);if(seq!==autoSeq2)break;
    var pause=isReturnToStart?speed.pause+250:speed.pause;
    await new Promise(function(r){autoTimer=setTimeout(r,pause);});if(seq!==autoSeq2)break;
  }
}
(function(){
  var wrap=document.getElementById('sbScroll');
  if(!wrap)return;
  var resumeTimer=null;
  function pauseThenResume(){
    autoPaused=true;
    if(resumeTimer)clearTimeout(resumeTimer);
    resumeTimer=setTimeout(function(){
      loadSettings();
      if(wlSettings.wl_reco_pause_hover!=='0'){
        var hovering=wrap.matches(':hover');
        if(!hovering)autoPaused=false;
      }else{
        autoPaused=false;
      }
    },2500);
  }
  wrap.addEventListener('mouseenter',function(){loadSettings();if(wlSettings.wl_reco_pause_hover!=='0')autoPaused=true;});
  wrap.addEventListener('mouseleave',function(){loadSettings();if(wlSettings.wl_reco_pause_hover!=='0')autoPaused=false;});
  wrap.addEventListener('pointerdown',pauseThenResume);
  wrap.addEventListener('touchstart',pauseThenResume,{passive:true});
  wrap.addEventListener('wheel',pauseThenResume,{passive:true});
})();

