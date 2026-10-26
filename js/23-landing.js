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
  setTimeout(function(){
    var i=document.getElementById('authEmail');
    if(i&&_lpHost().contains(i))try{i.focus({preventScroll:true});}catch(e){i.focus();}
  },reduced?0:500);
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
/* Défilement façon Apple : compteurs, et repli des effets liés au défilement (--lp-t) quand le
   navigateur ne connaît pas animation-timeline. Lecture des positions puis écriture, une fois par image. */
function _lpSD(){try{return !!(window.CSS&&CSS.supports('animation-timeline: view()'));}catch(e){return false;}}
function _lpCount(el){
  var to=+el.getAttribute('data-count')||0;if(!to)return;
  var t0=0,d=1400;el.textContent='0';
  function step(ts){if(!t0)t0=ts;var k=Math.min(1,(ts-t0)/d);k=1-Math.pow(1-k,3);el.textContent=String(Math.round(to*k));if(k<1)requestAnimationFrame(step);}
  requestAnimationFrame(step);
}
function _lpMotion(){
  var r=document.documentElement;if(!r.classList.contains('lp-anim')||_lp.motion)return;_lp.motion=true;
  var nums=document.querySelectorAll('#landing [data-count]');
  if(typeof IntersectionObserver!=='undefined'){
    var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){io.unobserve(e.target);_lpCount(e.target);}});},{threshold:.6});
    nums.forEach(function(n){io.observe(n);});
  }
  _lpScenes();
  _lpShow();
  if(_lpSD())return;
  r.classList.add('lp-nosd');
  var stage=document.querySelector('#landing .lp-stage-3d'),hero=document.querySelector('#landing .lp-hero-in'),
      vis=[].slice.call(document.querySelectorAll('#landing .lp-spot-vis')),tick=false;
  function frame(){
    tick=false;if(!lpIsGuest())return;
    var vh=innerHeight,y=scrollY||0,out=[];
    if(stage){out.push([stage,Math.max(0,Math.min(1,y/600))]);}
    if(hero)out.push([hero,Math.max(0,Math.min(1,y/640))]);
    vis.forEach(function(v){var b=v.parentNode.getBoundingClientRect();out.push([v,Math.max(0,Math.min(1,(vh-b.top)/(vh+b.height)))]);});
    out.forEach(function(o){o[0].style.setProperty('--lp-t',o[1].toFixed(4));});
  }
  function req(){if(!tick){tick=true;requestAnimationFrame(frame);}}
  addEventListener('scroll',req,{passive:true});addEventListener('resize',req);frame();
}
/* Scènes V3 : progression --p (0 → 1) des sections [data-lp-p] et [data-lp-pin], étape de la section
   épinglée, sous-navigation givrée. Lecture des positions puis écriture, une fois par image. */
function _lpScenes(){
  var L=document.getElementById('landing');if(!L)return;
  var pin=L.querySelector('[data-lp-pin]'),scenes=[].slice.call(L.querySelectorAll('[data-lp-p]')),
      sub=document.getElementById('lpSubnav'),hero=L.querySelector('.lp-hero'),tick=false,last=-1;
  var steps=pin?[].slice.call(pin.querySelectorAll('.lp-pin-step')):[],scr=pin?[].slice.call(pin.querySelectorAll('.lp-scr')):[],
      dots=pin?[].slice.call(pin.querySelectorAll('.lp-pin-dots i')):[];
  function clamp(x){return x<0?0:x>1?1:x;}
  function frame(){
    tick=false;if(!lpIsGuest())return;
    var vh=innerHeight,w=[];
    if(hero&&sub)w.push(function(b){return function(){sub.classList.toggle('on',b);};}(hero.getBoundingClientRect().bottom<80));
    scenes.forEach(function(el){var b=el.getBoundingClientRect(),
      p=el.classList.contains('lp-huge')?clamp(-b.top/Math.max(1,b.height-vh)):clamp((vh-b.top)/(vh+b.height));
      w.push(function(){el.style.setProperty('--p',p.toFixed(4));});});
    if(pin){var b=pin.getBoundingClientRect(),stick=pin.querySelector('.lp-pin-stick'),
      hd=stick&&stick.previousElementSibling,top=hd?hd.offsetTop+hd.offsetHeight:0,/* pas stick.offsetTop : il bouge une fois épinglé */p=clamp((-b.top-top)/Math.max(1,b.height-top-vh)),k=Math.min(steps.length-1,Math.floor(p*steps.length*.999));
      w.push(function(){pin.style.setProperty('--p',p.toFixed(4));
        if(k!==last){last=k;steps.forEach(function(s,i){s.classList.toggle('on',i===k);s.classList.toggle('past',i<k);s.setAttribute('aria-hidden',i===k?'false':'true');});
          scr.forEach(function(s,i){s.classList.toggle('on',i===k);});dots.forEach(function(d,i){d.classList.toggle('on',i<=k);});}});}
    w.forEach(function(f){f();});
  }
  function req(){if(!tick){tick=true;requestAnimationFrame(frame);}}
  addEventListener('scroll',req,{passive:true});addEventListener('resize',req);frame();
}
/* Vitrine #lp-show : affiches TMDB chargées à l'approche (src posé ici : aucune ressource tierce dans le
   HTML), puis scène épinglée pilotée par le défilement. La progression cible vient du scroll ; la valeur
   affichée la rejoint en douceur (lerp) à chaque image, et les affiches dérivent lentement dans le temps.
   Boucle active seulement quand la section est à l'écran ; uniquement transform / opacity / variables CSS. */
function _lpShow(){
  var S=document.querySelector('#landing [data-lp-show]');if(!S||S._lp)return;S._lp=1;
  var imgs=[].slice.call(S.querySelectorAll('img[data-tmdb]'));
  function load(){imgs.forEach(function(i){if(!i.getAttribute('src'))i.src=(typeof IB!=='undefined'?IB:'https://image.tmdb.org/t/p/')+(i.closest('.lp-sh-rp')?'w92':'w342')+i.getAttribute('data-tmdb');});}
  if(typeof IntersectionObserver==='undefined')load();
  else{var lio=new IntersectionObserver(function(es){if(es.some(function(e){return e.isIntersecting;})){lio.disconnect();load();}},{rootMargin:'800px 0px'});lio.observe(S);}
  if(!document.documentElement.classList.contains('lp-anim'))return;
  var fl=[].slice.call(S.querySelectorAll('.lp-fl')).map(function(el,i){return {el:el,d:+el.getAttribute('data-d')||1,ph:i*1.7};}),
      caps=[].slice.call(S.querySelectorAll('.lp-sh-cap')),rows=[].slice.call(S.querySelectorAll('.lp-sh-row')),
      plat=[].slice.call(S.querySelectorAll('.lp-sh-plat span')),cur=0,tgt=0,run=false,vis=false,lastCap=-1,lastK='';
  function clamp(x){return x<0?0:x>1?1:x;}
  function seg(p,a,b){return clamp((p-a)/(b-a));}
  function ease(x){return x<.5?2*x*x:1-Math.pow(-2*x+2,2)/2;}
  function bell(p,a,b,f){return Math.min(seg(p,a,a+f),1-seg(p,b-f,b));}
  function measure(){var b=S.getBoundingClientRect();tgt=clamp(-b.top/Math.max(1,b.height-innerHeight*1.25));}
  function frame(ts){
    run=false;if(!lpIsGuest())return;
    cur+=(tgt-cur)*.12;if(Math.abs(tgt-cur)<.0004)cur=tgt;
    var p=cur,a=seg(p,.1,.42),ck=ease(seg(p,.355,.39)),l=ease(seg(p,.46,.52)),r=ease(seg(p,.8,.92)),
        tn=bell(p,.46,.62,.05),tp=bell(p,.57,.73,.05),tc=bell(p,.68,.86,.05),st=S.style;
    st.setProperty('--p',p.toFixed(4));st.setProperty('--in',ease(seg(p,0,.1)).toFixed(4));st.setProperty('--a',a.toFixed(4));st.setProperty('--ck',(ck*(1-l)).toFixed(4));
    st.setProperty('--l',l.toFixed(4));st.setProperty('--r',r.toFixed(4));st.setProperty('--tn',tn.toFixed(3));st.setProperty('--tp',tp.toFixed(3));st.setProperty('--tc',tc.toFixed(3));
    var sec=(ts||0)/1000;
    fl.forEach(function(f){var y=(.5-p)*f.d*55,dx=Math.sin(sec*.35+f.ph)*6*f.d,dy=Math.cos(sec*.3+f.ph)*8*f.d;
      f.el.style.transform='translate3d('+dx.toFixed(1)+'px,calc('+y.toFixed(2)+'vh + '+dy.toFixed(1)+'px),0) rotate(calc(var(--r) + '+(Math.sin(sec*.25+f.ph)*2).toFixed(2)+'deg))';});
    var c=p<.3?0:p<.46?1:p<.8?2:3;
    if(c!==lastCap){lastCap=c;caps.forEach(function(e,i){e.classList.toggle('on',i===c);});}
    var k=tc>.5?'c':tp>.5?'p':tn>.5?'n':'';
    if(k!==lastK){lastK=k;plat.forEach(function(e){e.classList.toggle('on',e.getAttribute('data-k')===k);});}
    rows.forEach(function(e,i){e.classList.toggle('on',p>.53+i*.1);});
    if(vis)req();
  }
  function req(){if(!run){run=true;requestAnimationFrame(frame);}}
  addEventListener('scroll',function(){if(vis)measure();},{passive:true});
  addEventListener('resize',function(){measure();req();});
  if(typeof IntersectionObserver!=='undefined')new IntersectionObserver(function(es){vis=es[0].isIntersecting;if(vis){measure();req();}}).observe(S);
  else{vis=true;measure();req();}
  measure();cur=tgt;req();
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
/* Curseur de cartes : boutons ‹ › (le glissement et l'aimantation sont natifs) */
function _lpSlider(){
  document.querySelectorAll('#landing [data-sl]').forEach(function(b){
    if(b._lp)return;b._lp=1;
    b.addEventListener('click',function(){var s=document.getElementById('lpSlider');if(!s)return;
      var c=s.querySelector('.lp-card'),w=c?c.getBoundingClientRect().width+18:320;
      s.scrollBy({left:(+b.getAttribute('data-sl'))*w,behavior:_lpReduced()?'auto':'smooth'});});
  });
}
function _lpSetup(view){
  document.title=t('lp.meta.title',{name:BRAND.name});
  lpMountAuth(view);
  _lpReveal();
  _lpMotion();
  _lpShow();
  _lpFaq();
  _lpSlider();
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
