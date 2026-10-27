/* MODULE: Page d'accueil des visiteurs sans compte (#landing).
   - L'affichage initial est décidé avant le premier rendu par js/00-landing-gate.js (lp-guest /
     lp-member sur <html>) ; ici on gère la suite : connexion → l'app, déconnexion → l'accueil.
   - Le panneau « Créer un compte » N'EST PAS un second système de compte : le conteneur #authView
     de la fenêtre de compte (js/20-account.js) est déplacé dans le panneau, et les mêmes vues
     (inscription, connexion, mot de passe oublié, code…) y sont rendues par authGo(). Il revient
     dans la fenêtre dès qu'elle s'ouvre (_authViewHome dans openAuthModal).
   - Le CAPTCHA Turnstile (seul tiers) n'est chargé qu'au premier geste dans le formulaire. */
var LP_GUEST_KEY='wl_app_guest';
var _lp={view:'signup',ph:null,io:null};
function lpIsGuest(){return document.documentElement.classList.contains('lp-guest');}
function _lpReduced(){try{return window.matchMedia('(prefers-reduced-motion: reduce)').matches;}catch(e){return false;}}
function _lpHost(){return document.getElementById('lpAuthHost');}
function _lpModalOpen(){var m=document.getElementById('authMbk');return !!(m&&m.classList.contains('on'));}
/* Une session supabase-js est-elle encore enregistrée sur l'appareil ? (même test que js/00-landing-gate.js) */
function _lpStoredSession(){
  try{for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(/^sb-[a-z0-9]+-auth-token$/.test(k||'')&&localStorage.getItem(k))return true;}}catch(e){}
  return false;
}

/* Rend une vue de compte dans le panneau de l'accueil (sauf si la fenêtre de compte est ouverte) */
function lpMountAuth(view){
  var host=_lpHost(),v=document.getElementById('authView');
  if(!host||!v||typeof authGo!=='function')return;
  if(view)_lp.view=view;
  if(_lpModalOpen())return;
  if(v.parentNode!==host){if(_lp.ph===null)_lp.ph=host.innerHTML;host.innerHTML='';host.appendChild(v);}
  authGo(_lp.view);
}
/* CTA « Créer mon compte » / « Se connecter » : panneau d'inscription, défilement et focus */
function lpShowAuth(view){
  if(!lpIsGuest()){if(typeof openAuthModal==='function')openAuthModal(view==='signup'&&typeof authUser!=='undefined'&&authUser?'account':view);return;}
  lpMountAuth(view||'signup');
  var sec=document.getElementById('lp-join');if(!sec)return;
  var reduced=_lpReduced();
  sec.scrollIntoView({behavior:reduced?'auto':'smooth',block:'start'});
  /* Le champ email vit dans l'appareil (chapitre 8) : tant que le défilement animé (lerp) n'a pas
     rattrapé le scroll, sa scène reste invisibility:hidden (comme les autres), et .focus() dessus
     ne fait rien — sans erreur, sans retenter. On retente donc par intervalles le temps qu'il faille. */
  var tries=0;
  (function tryFocus(){
    var i=document.getElementById('authEmail'),host=_lpHost();
    if(i&&host&&host.contains(i)&&getComputedStyle(i).visibility!=='hidden'){
      try{i.focus({preventScroll:true});}catch(e){i.focus();}
      return;
    }
    if(++tries<50)setTimeout(tryFocus,150);
  })();
}
/* Accueil → app (connexion réussie, ou liste locale ouverte sans compte) */
function lpLeave(){
  var r=document.documentElement;if(!r.classList.contains('lp-guest'))return;
  r.classList.remove('lp-guest','lp-anim','lp-ready','lp-nosd');r.classList.add('lp-member');
  if(typeof _authViewHome==='function')_authViewHome();
  var host=_lpHost();if(host&&_lp.ph!==null&&!host.firstElementChild)host.innerHTML=_lp.ph;
  document.title=BRAND.name;
  try{window.scrollTo(0,0);}catch(e){}
  if(typeof render==='function')try{render();}catch(e){}
  try{window.dispatchEvent(new Event('resize'));}catch(e){}
}
/* App → accueil (déconnexion, session expirée) */
function lpEnter(view){
  try{localStorage.removeItem(LP_GUEST_KEY);}catch(e){}
  var r=document.documentElement;if(r.classList.contains('lp-guest'))return;
  r.classList.remove('lp-member');r.classList.add('lp-guest');
  _lpSetup(view||'login');
  try{window.scrollTo(0,0);}catch(e){}
}
/* « Ma liste sur cet appareil » : ancienne liste locale, ouverte sans compte */
function lpOpenApp(){
  try{localStorage.setItem(LP_GUEST_KEY,'1');}catch(e){}
  lpLeave();
}
function _lpCheckLocal(tries){
  var b=document.getElementById('lpLocalBtn');if(!b)return;
  if(typeof idb!=='undefined'&&!idb&&tries<20)return setTimeout(function(){_lpCheckLocal(tries+1);},250);
  var n=(typeof memDB!=='undefined'?memDB:[]).filter(function(i){return !i.deleted;}).length;
  b.hidden=!n;
  if(n)b.title=t('lp.local.title');
}
/* Apparition au défilement (sections sous le héros ; le héros s'anime en CSS) */
function _lpReveal(){
  var els=document.querySelectorAll('#landing .lp-reveal:not(.in)');
  /* Cascade : rang parmi les éléments qui apparaissent dans le même parent (0,1 s chacun, plafonné) */
  els.forEach(function(el){var p=el.parentNode,k=0;if(!p)return;[].forEach.call(p.children,function(c,j){if(c===el)k=[].slice.call(p.children,0,j).filter(function(x){return x.classList.contains('lp-reveal');}).length;});el.style.setProperty('--i',Math.min(k,6));});
  if(!document.documentElement.classList.contains('lp-anim')||typeof IntersectionObserver==='undefined'){
    els.forEach(function(el){el.classList.add('in');});return;
  }
  if(!_lp.io)_lp.io=new IntersectionObserver(function(entries){
    entries.forEach(function(en){if(en.isIntersecting){en.target.classList.add('in');_lp.io.unobserve(en.target);}});
  },{rootMargin:'0px 0px -10% 0px',threshold:0.01});
  els.forEach(function(el){_lp.io.observe(el);});
  document.documentElement.classList.add('lp-ready');
}
/* Visite guidée (#lp-j) : un seul appareil épinglé qui se transforme au fil du défilement
   (ordinateur → tablette → téléphone). La cible g (numéro de chapitre décimal) vient du scroll ; la
   valeur affichée la rejoint en douceur (lerp) à chaque image. Boucle active seulement quand la
   section est à l'écran (IntersectionObserver). Écritures : transform, opacity et variables CSS
   (la taille de l'appareil ne change que pendant la mue). Mouvement réduit : une scène fixe par
   chapitre, sans interpolation ni éléments volants. */
var LP_TINT=[[10,30,56],[6,44,66],[30,14,30],[10,36,72],[6,40,54],[14,30,70],[4,48,60],[12,26,60],[8,44,70]];
var LP_PLAT=[[90,14,22],[10,52,96],[96,46,10]];
var LP_DEV=[{w:880,h:550,r:22,bz:12},{w:600,h:800,r:36,bz:14},{w:340,h:700,r:52,bz:11}];
/* Type d'appareil du visiteur (pour le formulaire final dans le bon appareil). ?device=phone|tablet|pc force. */
function lpDevice(){
  try{var q=(location.search.match(/[?&]device=(phone|tablet|pc)\b/)||[])[1];if(q)return q;}catch(e){}
  var n=navigator,w=Math.min(screen.width||innerWidth,innerWidth||9999),W=Math.max(screen.width||0,screen.height||0),coarse=false;
  try{coarse=matchMedia('(pointer:coarse)').matches;}catch(e){}
  var ipad=n.platform==='MacIntel'&&n.maxTouchPoints>1,ua=n.userAgent||'';
  if(n.userAgentData&&n.userAgentData.mobile)return 'phone';
  if(/iPad|Tablet/i.test(ua)||ipad||(/Android/i.test(ua)&&!/Mobile/i.test(ua)))return 'tablet';
  if(/iPhone|iPod|Mobile/i.test(ua))return 'phone';
  if(coarse)return w<600?'phone':W<=1366?'tablet':'pc';
  return 'pc';
}
function _lpImgs(){
  if(_lp.imgs)return;_lp.imgs=1;
  var base=(typeof IB!=='undefined'?IB:'https://image.tmdb.org/t/p/');
  document.querySelectorAll('#landing img[data-tmdb]').forEach(function(i){
    i.addEventListener('load',function(){i.classList.add('on');},{once:true});
    i.src=base+(i.getAttribute('data-w')||'w185')+i.getAttribute('data-tmdb');
  });
}
/* Affiches TMDB : aucune ressource tierce au chargement, seulement au premier geste de défilement.
   « wheel »/« touchmove » seulement (pas « scroll ») : un scroll peut être déclenché par le
   navigateur lui-même (ex. focus automatique d'un champ qui scrolle pour le mettre en vue à
   l'ouverture du panneau d'inscription), ce qui chargeait toutes les affiches à tort sur un simple
   clic « Créer mon compte ». wheel/touchmove sont, eux, toujours un vrai geste de l'utilisateur. */
function _lpImgsOnGesture(){
  if(_lp.gest)return;_lp.gest=1;
  var ev=['wheel','touchmove'];
  function go(){var J=document.querySelector('#landing [data-lp-j]');if(J&&J.getBoundingClientRect().bottom<innerHeight*.5)return;ev.forEach(function(e){removeEventListener(e,go,true);});_lpImgs();}
  ev.forEach(function(e){addEventListener(e,go,{passive:true,capture:true});});
}
function _lpJourney(){
  var S=document.querySelector('#landing [data-lp-j]');if(!S||S._lp)return;S._lp=1;
  var Q=function(s){return S.querySelector(s);},QA=function(s){return [].slice.call(S.querySelectorAll(s));};
  var stick=Q('.lp-j-stick'),dv=Q('.lp-dv'),flash=Q('.lp-j-flash'),fly=Q('.lp-j-fly'),story=Q('.lp-j-story'),prog=Q('.lp-j-prog'),
      chs=QA('.lp-ch'),words=QA('.lp-j-w'),scr={},time=document.getElementById('lpTime'),detN=document.getElementById('lpDetN'),
      stepsLine=Q('.lp-j-steps-line i'),stepCount=Q('.lp-j-step-count'),mtext=Q('.lp-j-mtext'),
      mtextK=mtext&&mtext.querySelector('.lp-kicker'),mtextH=mtext&&mtext.querySelector('h2'),mtextP=mtext&&mtext.querySelector('.lp-p');
  /* Étape 2 (« mon historique arrive tout seul ») : compteur qui monte en boucle avec l'icône,
     sur la même horloge que l'animation CSS (document.timeline, pas de setInterval séparé). */
  if(stepCount&&!_lpReduced()){
    stepCount.textContent='0';
    (function tickCount(){
      if(!S.isConnected)return;
      var ph=((document.timeline&&document.timeline.currentTime)||0)%6000,v=0;
      if(ph>=2000&&ph<4000)v=Math.round(24*((ph-2000)/2000));else if(ph>=4000)v=24;
      if(stepCount._v!==v){stepCount._v=v;stepCount.textContent=String(v);}
      requestAnimationFrame(tickCount);
    })();
  }
  QA('.lp-s').forEach(function(e){scr[e.getAttribute('data-s')]=e;});
  var fl=QA('.lp-j-far .lp-fl').map(function(e,i,a){return {e:e,far:1,a0:i/a.length*6.283+.4,k:i};})
    .concat(QA('.lp-j-near .lp-fl').map(function(e,i,a){return {e:e,far:0,a0:i/a.length*6.283+1.1,k:i+8};}));
  var exRows=QA('.lp-ex-row'),exPl=QA('.lp-ex-pl'),rsRows=QA('.lp-rs-row'),stRes=QA('.lp-st-res .lp-po'),pvRows=QA('.lp-pv span'),
      tabs=QA('.lp-ls-tabs span'),pill=Q('.lp-ls-pill'),imp=QA('.lp-im'),exPo=exRows.map(function(r){return r.querySelector('.lp-po');}),DV={phone:2,tablet:1,pc:0}[lpDevice()],grid=QA('.lp-ls-grid .lp-po'),nums=QA('[data-to]'),qt=Q('.lp-st-qt');
  var TY={'Dune':1,'Oppenheimer':1,'Spider-Verse':1,'Frieren':3,'One Piece':3};
  grid.forEach(function(p,i){p._ty=TY[p.getAttribute('data-t')]||2;p.style.setProperty('--k',i);});
  if(scr[8])scr[8].setAttribute('data-dev',['pc','tablet','phone'][DV]);
  var reduced=_lpReduced(),anim=document.documentElement.classList.contains('lp-anim');
  var shadow=Q('.lp-j-shadow'),mx=0,my=0,tmx=0,tmy=0,fine=false;try{fine=matchMedia('(pointer:fine)').matches;}catch(e){}
  if(fine&&!reduced)addEventListener('mousemove',function(e){tmx=e.clientX/innerWidth*2-1;tmy=e.clientY/innerHeight*2-1;if(vis)req();},{passive:true});
  var tops=[],hs=[],vw=0,vh=0,tgt=0,cur=-1,vis=false,run=false,last={},T0=performance.now();
  function clamp(x){return x<0?0:x>1?1:x;}
  function seg(x,a,b){return clamp((x-a)/(b-a));}
  function ease(x){return x<.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2;}
  function back(x){var c=1.7;return 1+(c+1)*Math.pow(x-1,3)+c*Math.pow(x-1,2);}
  function bell(x,a,b,f){return Math.min(seg(x,a,a+f),1-seg(x,b-f,b));}
  function lerp(a,b,k){return a+(b-a)*k;}
  function set(el,k,v){var key=k;if(!el)return;var s=typeof v==='number'?v.toFixed(4):v;if(el['_'+key]===s)return;el['_'+key]=s;el.style.setProperty(k,s);}
  function measure(){
    vw=innerWidth;vh=innerHeight;var y=scrollY||0;
    chs.forEach(function(c,i){var b=c.getBoundingClientRect();tops[i]=b.top+y;hs[i]=b.height;});
    target();
  }
  function target(){
    var y=(scrollY||0)+vh*.38,g=0;
    for(var i=0;i<chs.length;i++){if(y>=tops[i])g=i+clamp((y-tops[i])/hs[i]);}
    if(y<tops[0])g=0;
    if(reduced)g=Math.min(chs.length-1,Math.floor(g))+.92;
    tgt=Math.min(g,chs.length-.001);
  }
  function frame(now){
    run=false;if(!lpIsGuest())return;
    if(cur<0||reduced)cur=tgt;else{cur+=(tgt-cur)*.09;if(Math.abs(tgt-cur)<.0005)cur=tgt;}
    var g=cur,tm=(now-T0)/1000,mob=vw<=860,f=[];
    for(var i=0;i<9;i++)f[i]=clamp(g-i);
    /* Teinte du chapitre (et des plateformes au chapitre 2) */
    var c0=Math.min(8,Math.floor(g)),c1=Math.min(8,c0+1),k=ease(seg(g-c0,.7,1)),tint=LP_TINT[c0].map(function(v,j){return lerp(v,LP_TINT[c1][j],k);});
    if(c0===2){var pk=f[2]*3-.2,a=Math.max(0,Math.min(2,Math.floor(pk))),b=Math.min(2,a+1),w=clamp(pk-a),pc=LP_PLAT[a].map(function(v,j){return lerp(v,LP_PLAT[b][j],w);}),ww=bell(f[2],.08,.8,.12);tint=tint.map(function(v,j){return lerp(v,pc[j],ww);});}
    set(S,'--tint',tint.map(Math.round).join(','));
    /* Mue de l'appareil */
    var m=ease(seg(g,2.72,3.22))+ease(seg(g,5.72,6.22)),a0=Math.min(1,Math.floor(m)),mt=m-a0,A=LP_DEV[a0],B=LP_DEV[Math.min(2,a0+1)];
    var W=lerp(A.w,B.w,mt),H=lerp(A.h,B.h,mt),R=lerp(A.r,B.r,mt),BZ=lerp(A.bz,B.bz,mt);
    /* Appel final : l'appareil prend la forme de celui du visiteur */
    var mf=ease(seg(g,7.82,8.18)),F=LP_DEV[DV];if(mf>0&&DV!==2){W=lerp(W,F.w,mf);H=lerp(H,F.h,mf);R=lerp(R,F.r,mf);BZ=lerp(BZ,F.bz,mf)}
    /* Mobile, chapitre 8 : les 3 étapes passent en haut, l'appareil (et son formulaire) descend
       pour leur laisser la place — « les 3 étapes s'empilent au-dessus de l'appareil ». */
    var ch8=mob?ease(seg(g,7.55,8.15)):0;
    var bw=mob?vw*.86:vw*.46,bh=mob?lerp(vh*.42,vh*.32,ch8):vh*.72,cx=mob?vw*.5:vw*.7,cy=mob?lerp(60+vh*.23,vh*.76,ch8):vh*.52;
    var big=mob?ease(seg(g,8.42,8.8)):0;/* fin du ch. 8 sur mobile : le téléphone d'inscription prend l'écran */
    if(big>0){bw=lerp(bw,Math.min(vw*.94,420),big);bh=lerp(bh,vh-112,big);cy=lerp(cy,28+vh*.5,big);}
    var s=Math.min(bw/W,bh/H),morphing=(mt>0&&mt<1);
    if(g<1.2&&!mob){s*=lerp(1.06,1,seg(g,.3,1.2));}
    if(g>8.05){s*=1+ease(seg(g,8.05,8.5))*.06;}
    var tilt=reduced?0:(1-ease(seg(g,.2,1.05)))*14,spin=reduced?0:Math.sin(Math.PI*(mt))*(a0?-1:1)*16,
        float=reduced?0:Math.sin(tm*.8)*4;
    if(dv._w!==W||dv._h!==H){dv._w=W;dv._h=H;dv.style.width=W.toFixed(1)+'px';dv.style.height=H.toFixed(1)+'px';dv.style.margin='0';}
    dv.style.left='0';dv.style.top='0';
    /* Relief 3D en CSS : inclinaison (défilement + souris sur ordinateur), tranche, reflet, ombre au sol */
    mx+=(tmx-mx)*.08;my+=(tmy-my)*.08;var mm=Math.abs(tmx-mx)+Math.abs(tmy-my)>.002;
    var rx=tilt+(reduced?0:(fine?-my*7:Math.sin(g*1.7)*2.5)),ry=spin-(mob?0:tilt*.6)+(reduced?0:(fine?mx*9:Math.cos(g*1.3)*3.5));
    if(mob){/* v6 : l'appareil est mis en page à sa taille affichée (zoom) au lieu d'être peint en 880 px puis réduit
   par scale() -> calque ~6x plus petit, net, et plus de re-peinture géante pendant les mues */
  var z=Math.max(.2,Math.round(s*50)/50);if(dv._z!==z){dv._z=z;dv.style.zoom=String(z);}
  dv.style.transform='translate3d('+((cx-W*z/2)/z).toFixed(2)+'px,'+((cy-H*z/2+float)/z).toFixed(2)+'px,0) perspective('+(1800/z).toFixed(0)+'px) rotateX('+rx.toFixed(2)+'deg) rotateY('+ry.toFixed(2)+'deg) scale('+(s/z).toFixed(4)+')';
}else{if(dv._z){dv._z=0;dv.style.zoom='';}dv.style.transform='translate3d('+(cx-W/2).toFixed(1)+'px,'+(cy-H/2+float).toFixed(1)+'px,0) perspective(1800px) rotateX('+rx.toFixed(2)+'deg) rotateY('+ry.toFixed(2)+'deg) scale('+s.toFixed(4)+')';}
    set(dv,'--sh',(50+ry*3).toFixed(1)+'%');
    if(shadow){shadow.style.transform='translate3d('+(cx-50+ry*3*s).toFixed(1)+'px,'+(cy+H*s/2+18+float*.3+rx*1.2).toFixed(1)+'px,0) scale('+(W*s/100*(1-Math.abs(ry)/90)).toFixed(3)+','+(1+Math.abs(rx)/12).toFixed(3)+')';shadow.style.opacity=String(.75-Math.min(.35,Math.abs(float)/40));}
    set(dv,'--r',R.toFixed(1)+'px');set(dv,'--bz',BZ.toFixed(1)+'px');
    var bo=1-clamp(m-1),po=clamp((m-1.4)/.6);if(DV===0){bo=lerp(bo,1,mf);po=lerp(po,0,mf);}else if(DV===1){po=lerp(po,0,mf);}
    set(dv,'--bo',bo);set(dv,'--po',po);
    set(dv,'--gl',(110-(morphing?mt*160:0)-bell(f[1],.62,.8,.06)*160)+'%');
    /* Scènes (fondu enchaîné) */
    var RG={0:[-1,2],2:[2,3],3:[3,4],4:[4,5],5:[5,6],6:[6,7],7:[7,8],8:[8,10]};
    Object.keys(RG).forEach(function(key){var e=scr[key];if(!e)return;var r=RG[key],o=Math.min(seg(g,r[0]-.08,r[0]+.08),1-seg(g,r[1]-.08,r[1]+.08));
      if(reduced)o=(g>=r[0]&&g<r[1])?1:0;set(e,'opacity',o);var v=o>.001;if(e._v!==v){e._v=v;e.classList.toggle('vis',v);}});
    /* Grands mots */
    words.forEach(function(w,i){var o=bell(g,i-.15,i+1.1,.3)*(mob?.7:1),x=(.5-clamp((g-i+.15)/1.25))*(reduced?0:24);
      set(w,'opacity',o);if(o>0)w.style.transform='translate3d('+x.toFixed(2)+'vw,'+(mob?'-14vh':'0')+',0) scale('+(1+.06*clamp(g-i)).toFixed(3)+')';});
    /* 1 · Lecteur : la barre suit le défilement ; à 80 % la coche */
    var pg=f[1]<.67?seg(f[1],.04,.67)*.8:.8+seg(f[1],.67,1)*.14;
    set(scr[0],'--pg',pg);
    var sec=Math.round(pg*2512);if(time){var tx=('0'+Math.floor(sec/60)).slice(-2)+':'+('0'+sec%60).slice(-2);if(time._t!==tx&&(!mob||sec%5===0||pg>=.79)){time._t=tx;time.textContent=tx;}}
    var okIn=seg(f[1],.67,.71),ok=Math.min(back(okIn),1.15)*(1-seg(f[1],.84,.9));
    set(scr[0],'--ok',okIn?Math.max(0,ok):0);set(scr[0],'--rp',seg(f[1],.67,.79));
    var dt=ease(seg(f[1],.74,.8));set(scr[0],'--dt',dt);
    var ft=seg(f[1],.78,.92);set(scr[0],'--cd',seg(ft,.8,1));
    set(flash,'opacity',reduced?0:bell(f[1],.66,.82,.05)*.9);flash.style.transform='scale('+(.3+seg(f[1],.66,.8)*1.2).toFixed(3)+')';
    if(!reduced&&ft>0&&ft<1){var sx=cx,sy=cy,ex=cx+(W/2-14-130)*s,ey=cy+(-H/2+34+14+62)*s,ff=ease(ft);
      fly.style.opacity=String(Math.min(1,ft*6)*(1-seg(ft,.82,1)));
      fly.style.transform='translate3d('+(lerp(sx,ex,ff)-110).toFixed(1)+'px,'+(lerp(sy,ey,ff)-30-Math.sin(Math.PI*ff)*90*s).toFixed(1)+'px,0) scale('+lerp(1.5,.8,ff).toFixed(3)+') rotate('+(Math.sin(Math.PI*ff)*-8).toFixed(2)+'deg)';
    }else if(fly.style.opacity!=='0')fly.style.opacity='0';
    /* 2 · Extension : import, titres qui arrivent dans Détectés, validation */
    set(scr[2],'--pp',ease(seg(f[2],.02,.14)));
    exPl.forEach(function(p,i){set(p,'--ip',ease(seg(f[2],.1+i*.1,.38+i*.1)));});
    var n=0;exRows.forEach(function(r,i){var v=ease(seg(f[2],.12+i*.07,.22+i*.07));if(v>.5)n++;set(r,'--ri',v);var okr=f[2]>.74+i*.03;if(r._ok!==okr){r._ok=okr;r.classList.toggle('ok',okr);}});
    /* Chaque affiche importée vole jusqu'à la vignette exacte de sa ligne puis s'y fond (FLIP) */
    var sb=stick.getBoundingClientRect();
    imp.forEach(function(c,i){
      var u=reduced?1:seg(f[2],.16+i*.07,.36+i*.07),ln=reduced?1:seg(u,.86,1),tp=exPo[i];
      if(tp)set(tp,'--ln',g>=3?1:ln);
      var o=(u>0&&u<1&&g<3)?Math.min(1,u*5)*(1-ln):0;set(c,'opacity',o);if(o<=0||!tp)return;
      var r=tp.getBoundingClientRect(),tx=r.left-sb.left,ty=r.top-sb.top,ts=r.width/120,e=ease(u),
          sx=vw*(mob?.5:.58)+((i*37)%5-2)*vw*.05,sy=-vh*.25-i*20,ss=mob?.7:1.15;
      var x=lerp(sx,tx,e),y=lerp(sy,ty,e)-Math.sin(Math.PI*e)*vh*.06,sc=lerp(ss,ts,e),rot=(1-e)*(i%2?14:-12);
      c.style.transform='translate3d('+x.toFixed(1)+'px,'+y.toFixed(1)+'px,0) scale('+sc.toFixed(4)+') rotate('+rot.toFixed(2)+'deg)';
    });
    if(detN&&detN._n!==n){detN._n=n;detN.textContent=String(n);}
    /* 3 · Ma liste : filtres, saga, fiche avec les notes */
    var tb=f[3]<.16?0:f[3]<.27?1:f[3]<.38?2:f[3]<.5?3:0;
    if(S._tb!==tb){S._tb=tb;tabs.forEach(function(e,i){e.classList.toggle('on',i===tb);});grid.forEach(function(p){p.classList.toggle('off',!!(tb&&p._ty!==tb));});S._pl=0;}
    if(pill&&!S._pl&&tabs[tb]&&tabs[tb].offsetWidth){S._pl=1;pill.style.setProperty('--px',tabs[tb].offsetLeft+'px');pill.style.setProperty('--pw',tabs[tb].offsetWidth+'px');}
    set(scr[3],'--gi',reduced?1:ease(seg(g,2.85,3.12)));set(scr[3],'--sg',seg(f[3],.52,.58)*(1-seg(f[3],.62,.66)));set(scr[3],'--fi',ease(seg(f[3],.58,.74)));
    /* 4 · Reprendre */
    set(scr[4],'--a1',ease(seg(f[4],0,.18)));set(scr[4],'--bp',1+bell(f[4],.24,.4,.07)*.1);
    rsRows.forEach(function(r,i){set(r,'--ri',ease(seg(f[4],.3+i*.12,.44+i*.12)));});
    /* 5 · Stats, recherche en langage naturel, recommandations */
    var ct=ease(seg(f[5],.02,.4));nums.forEach(function(e){var to=+e.getAttribute('data-to'),inStats=!!e.closest('.lp-s-st'),
      v=Math.round(to*(inStats?ct:ease(seg(f[7],.05,.35))));if(e._v!==v){e._v=v;e.textContent=v>=1000?String(v).replace(/\B(?=(\d{3})+(?!\d))/g,'\u202f'):String(v);}});
    set(scr[5],'--bv',ease(seg(f[5],.12,.42)));set(scr[5],'--q',seg(f[5],.44,.5));
    if(qt){if(!qt._full||qt._lang!==document.documentElement.lang){qt._full=t('lp.j.query');qt._lang=document.documentElement.lang;qt._c=-1;}
      var nc=Math.round(qt._full.length*seg(f[5],.5,.7));if(reduced)nc=qt._full.length;if(qt._c!==nc){qt._c=nc;qt.textContent=qt._full.slice(0,nc);}}
    stRes.forEach(function(r,i){set(r,'--ri',ease(seg(f[5],.72+i*.05,.84+i*.05)));});
    /* 6 · Synchronisé */
    set(scr[6],'--sy',back(seg(f[6],.28,.42))*(1-seg(f[6],.9,1)*0));set(scr[6],'--gi',1);
    /* 7 · Récap en story (la carte sort du téléphone), puis confidentialité */
    set(scr[7],'--fan',ease(seg(f[7],.02,.22)));set(scr[7],'--pv',ease(seg(f[7],.56,.68)));
    pvRows.forEach(function(r,i){set(r,'--ri',ease(seg(f[7],.6+i*.06,.7+i*.06)));});
    var so=seg(f[7],.24,.4)*(1-seg(f[7],.56,.64));
    if(!reduced&&so>0){var st=ease(seg(f[7],.24,.42)),pw=W*s,px=mob?cx:cx+pw/2+150,py=mob?cy+40:cy-20;
      story.style.opacity=String(so);
      story.style.transform='translate3d('+(lerp(cx,px,st)-110).toFixed(1)+'px,'+(lerp(cy,py,st)-190).toFixed(1)+'px,0) scale('+lerp(.4,mob?.8:1,st).toFixed(3)+') rotate('+lerp(0,7,st).toFixed(2)+'deg)';
    }else if(story.style.opacity!=='0')story.style.opacity='0';
    /* 8 · Appel final : formulaire réel dans l'appareil, ligne des 3 étapes qui se remplit au scroll */
    set(scr[8],'--ct',back(seg(f[8],0,.3)));
    if(stepsLine)stepsLine.style.height=(seg(f[8],.04,.5)*100).toFixed(1)+'%';
    /* Affiches en profondeur : orbite lente autour de l'appareil ; au chapitre 2 elles affluent vers la liste */
    var stream=0,lx=cx,ly=cy;
    fl.forEach(function(p,i){
      var ang=p.a0+g*(p.far?.35:-.5)+tm*(p.far?.03:.05),rx=(mob?vw*.55:vw*(p.far?.36:.3)),ry=(mob?vh*.3:vh*(p.far?.42:.38)),
          x=cx+Math.cos(ang)*rx,y=cy+Math.sin(ang)*ry,sc=p.far?.9:1,o=p.far?.45:.9,rot=Math.sin(ang*1.3)*10;
      o*=seg(g,.15,.6)*(1-seg(g,8.2,8.7)*.8);
      if(stream>0){var u=((f[2]*1.5+p.k/14)%1),sx=vw*(.75+((p.k*29)%30)/100),sy=-vh*.12;
        var zx=lerp(sx,lx,ease(u)),zy=lerp(sy,ly,ease(u));x=lerp(x,zx,stream);y=lerp(y,zy,stream);sc=lerp(sc,1.1-u*.8,stream);o=lerp(o,Math.sin(Math.PI*u)*(p.far?.6:1),stream);rot=lerp(rot,(1-u)*-14,stream);}
      if(!mob)o*=seg(x,vw*.5,vw*.6);
      /* jamais par-dessus l'interface : fondu près de l'appareil. La marge inclut la moitié de la
         plus grande dimension de l'affiche (largeur CSS clamp() + aspect-ratio 2/3, ± rotation) :
         une marge fixe (40px) ne suffisait pas pour les affiches « near » (jusqu'à 170px de large),
         qui frôlaient encore le bord de l'appareil à certaines largeurs d'écran (ex. 1280px). */
      var pw=p.far?Math.min(96,Math.max(56,vw*.06)):Math.min(170,Math.max(90,vw*.1)),half=pw*1.5/2+15,hw=W*s/2+half,hh=H*s/2+half;
      var dx=Math.abs(x-cx)/hw,dy=Math.abs(y-cy)/hh;o*=seg(Math.max(dx,dy),1,1.25);
      if(reduced)o=0;
      set(p.e,'opacity',o);if(o>.01)p.e.style.transform='translate3d('+x.toFixed(1)+'px,'+y.toFixed(1)+'px,0) translate(-50%,-50%) scale('+sc.toFixed(3)+') rotate('+rot.toFixed(2)+'deg)';
    });
    set(prog,'--gp',g/(chs.length));
    /* Texte du chapitre courant : fenêtres disjointes (pas de recouvrement entre chapitres voisins).
       Texte désormais sticky/fixe à l'écran (voir landing.css) : deux chapitres « on » en même temps
       s'afficheraient au même endroit, superposés et illisibles, au lieu de se croiser pendant le
       défilement comme avant. Le fondu CSS (transition .8-1.1s) fait la bascule visuelle. */
    chs.forEach(function(c,i){var last=i===chs.length-1,on=(last&&mob)?(g>=8.16&&g<8.3):(g>=i-.5&&(last||g<i+.5));/* mobile : la carte 3 étapes du ch. 8 n'apparaît qu'une fois l'appareil arrivé, puis s'efface avant que le téléphone d'inscription grandisse */if(c._on!==on){c._on=on;c.classList.toggle('on',on);}});
    /* Mobile (1-7) : un seul bandeau fixe dont le JS recopie le texte du chapitre actif, plutôt que
       7 bandeaux fixes indépendants empilés (voir landing.css, règle .lp-j-mtext). */
    if(mob&&mtext){
      var curCh=null;
      for(var mi=1;mi<=7;mi++){if(chs[mi]&&chs[mi].classList.contains('on')){curCh=mi;break;}}
      if(mtext._ch!==curCh){
        mtext._ch=curCh;
        if(curCh!=null){
          var mt=chs[curCh].querySelector('.lp-ch-t'),mk=mt&&mt.querySelector('.lp-kicker'),mh=mt&&mt.querySelector('h2'),mp=mt&&mt.querySelector('.lp-p');
          var _sw=function(){if(mtextK)mtextK.innerHTML=mk?mk.innerHTML:'';
          if(mtextH)mtextH.innerHTML=mh?mh.innerHTML:'';
          if(mtextP)mtextP.innerHTML=mp?mp.innerHTML:'';mtext.classList.remove('lp-sw');};if(mtext.classList.contains('on')){mtext.classList.add('lp-sw');clearTimeout(mtext._swt);mtext._swt=setTimeout(_sw,260);}else _sw();
          mtext.classList.add('on');
        }else mtext.classList.remove('on');
      }
    }
    if(vis&&!reduced)req();
  }
  function req(){if(!run){run=true;requestAnimationFrame(frame);}}
  addEventListener('scroll',function(){if(vis){target();req();}},{passive:true});
  addEventListener('resize',function(){measure();req();});
  if(document.fonts&&document.fonts.ready)document.fonts.ready.then(function(){measure();req();});
  addEventListener('load',function(){measure();req();});
  if(typeof IntersectionObserver!=='undefined')new IntersectionObserver(function(es){vis=es[0].isIntersecting;if(vis){measure();req();}}).observe(S);
  else vis=true;
  measure();req();
}
/* FAQ : ouverture et fermeture animées (sans JS, <details> natif) */
function _lpFaq(){
  document.querySelectorAll('#landing .lp-faq-item').forEach(function(d){
    var s=d.querySelector('summary');if(!s||d._lp)return;d._lp=1;
    if(d.open)d.classList.add('lp-open');
    s.addEventListener('click',function(e){
      if(!document.documentElement.classList.contains('lp-anim'))return;
      e.preventDefault();
      if(d.open&&d.classList.contains('lp-open')){d.classList.remove('lp-open');setTimeout(function(){if(!d.classList.contains('lp-open'))d.open=false;},450);}
      else{d.open=true;requestAnimationFrame(function(){requestAnimationFrame(function(){d.classList.add('lp-open');});});}
    });
  });
}
function _lpSetup(view){
  document.title=t('lp.meta.title',{name:BRAND.name});
  lpMountAuth(view);
  _lpReveal();
  _lpImgsOnGesture();
  _lpJourney();
  _lpFaq();
  _lpCheckLocal(0);
}
(function(){
  var landing=document.getElementById('landing');if(!landing)return;
  var lang=document.getElementById('lpLang');
  if(lang&&typeof langSwitcherHtml==='function')lang.innerHTML=langSwitcherHtml('lang-switch-foot');
  /* Barre de navigation : fond dès qu'on a défilé */
  var nav=landing.querySelector('.lp-nav'),tick=false;
  function onScroll(){tick=false;if(nav)nav.classList.toggle('lp-scrolled',(window.scrollY||0)>8);}
  window.addEventListener('scroll',function(){if(!tick&&lpIsGuest()){tick=true;requestAnimationFrame(onScroll);}},{passive:true});
  onScroll();
  /* Inscriptions fermées (/api/config) : le panneau propose la connexion */
  if(typeof loadPublicConfig==='function')loadPublicConfig().then(function(c){
    if(c&&c.signupsOpen===false){_lp.view='login';if(lpIsGuest()&&!_lpModalOpen())lpMountAuth('login');}
  });
  if(lpIsGuest())_lpSetup(_lp.view);
  /* La fenêtre de compte (ex. lien reçu par email) emprunte le formulaire ; il revient à sa fermeture */
  var mbk=document.getElementById('authMbk');
  if(mbk&&typeof MutationObserver!=='undefined')new MutationObserver(function(){
    var host=_lpHost();if(!host)return;
    if(_lpModalOpen()){if(!host.firstElementChild&&_lp.ph!==null)host.innerHTML=_lp.ph;}
    else if(lpIsGuest())lpMountAuth();
  }).observe(mbk,{attributes:true,attributeFilter:['class']});
  if(typeof supa!=='undefined'&&supa){
    supa.auth.onAuthStateChange(function(event,session){
      if(session&&session.user){if(lpIsGuest())lpLeave();}
      else if(event==='SIGNED_OUT')lpEnter('login');
    });
    /* Session enregistrée mais rejetée (supabase-js l'a effacée) : retour à l'accueil. Une session
       gardée faute de réseau (métro, avion) laisse l'app et la liste locale affichées. */
    var guestApp=false;try{guestApp=localStorage.getItem(LP_GUEST_KEY)==='1';}catch(e){}
    if(!lpIsGuest()&&!guestApp)supa.auth.getSession().then(function(r){
      if(!(r&&r.data&&r.data.session)&&!_lpStoredSession())lpEnter('login');
    }).catch(function(){});
  }
})();
/* mobile : images de la vitrine décodées d'avance (pas de saccade au premier affichage) */
addEventListener('load',function(){[].forEach.call(document.querySelectorAll('#landing img'),function(i){i.decode&&i.decode().catch(function(){});});});
