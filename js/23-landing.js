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
  r.classList.remove('lp-guest','lp-anim','lp-ready');r.classList.add('lp-member');
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
  var els=document.querySelectorAll('#landing .lp-sec .lp-reveal:not(.in)');
  if(!document.documentElement.classList.contains('lp-anim')||typeof IntersectionObserver==='undefined'){
    els.forEach(function(el){el.classList.add('in');});return;
  }
  if(!_lp.io)_lp.io=new IntersectionObserver(function(entries){
    entries.forEach(function(en){if(en.isIntersecting){en.target.classList.add('in');_lp.io.unobserve(en.target);}});
  },{rootMargin:'0px 0px -8% 0px',threshold:0.08});
  els.forEach(function(el){_lp.io.observe(el);});
  document.documentElement.classList.add('lp-ready');
}
function _lpSetup(view){
  document.title=t('lp.meta.title',{name:BRAND.name});
  lpMountAuth(view);
  _lpReveal();
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
