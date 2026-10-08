/* MODULE: Comptes — connexion, inscription, confirmation par email (lien ou code), mot de passe
   oublié / réinitialisation, changement d'email et de mot de passe, export RGPD, suppression de
   compte, CAPTCHA Cloudflare Turnstile (via la protection CAPTCHA intégrée à Supabase Auth).
   Le modal #authMbk n'a qu'un conteneur (#authView) : chaque écran est rendu ici par une vue. */

var AUTH_PW_MIN=12,AUTH_PW_MAX_BYTES=72,AUTH_RESEND_COOLDOWN_S=60;
var _authView='login',_authCtx={},_authBusy=false,_authResendAt=0;

/* ---------- Configuration publique (/api/config) ---------- */
var _publicCfg=null,_publicCfgPromise=null;
function loadPublicConfig(){
  if(_publicCfg)return Promise.resolve(_publicCfg);
  if(_publicCfgPromise)return _publicCfgPromise;
  _publicCfgPromise=fetch('/api/config',{credentials:'omit'}).then(function(r){
    if(!r.ok)throw new Error('config '+r.status);return r.json();
  }).then(function(c){
    _publicCfg={turnstileSiteKey:(c&&typeof c.turnstileSiteKey==='string')?c.turnstileSiteKey:'',signupsOpen:!(c&&c.signupsOpen===false)};
    return _publicCfg;
  }).catch(function(){
    _publicCfgPromise=null;/* réessai au prochain affichage */
    return {turnstileSiteKey:'',signupsOpen:true};
  });
  return _publicCfgPromise;
}

/* ---------- CAPTCHA (Cloudflare Turnstile, chargé uniquement sur les formulaires) ---------- */
var _ts={loading:null,widgetId:null,token:null,waiters:[],failed:false};
function _loadTurnstile(){
  if(window.turnstile)return Promise.resolve(window.turnstile);
  if(_ts.loading)return _ts.loading;
  _ts.loading=new Promise(function(resolve,reject){
    var s=document.createElement('script');
    s.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async=true;
    s.onload=function(){window.turnstile?resolve(window.turnstile):reject(new Error('turnstile'));};
    s.onerror=function(){_ts.loading=null;reject(new Error('turnstile'));};
    document.head.appendChild(s);
  });
  return _ts.loading;
}
function _captchaFlush(err,token){var w=_ts.waiters;_ts.waiters=[];w.forEach(function(f){f(err,token);});}
function captchaMount(el){
  _ts.token=null;_ts.failed=false;
  return loadPublicConfig().then(function(cfg){
    if(!el)return;
    if(!cfg.turnstileSiteKey){el.style.display='none';return;}
    el.style.display='';
    return _loadTurnstile().then(function(ts){
      if(!document.body.contains(el))return;
      if(_ts.widgetId!=null){try{ts.remove(_ts.widgetId);}catch(e){}_ts.widgetId=null;}
      _ts.widgetId=ts.render(el,{
        sitekey:cfg.turnstileSiteKey,theme:'dark',language:LANG,size:'flexible',appearance:'interaction-only',
        action:'auth',
        callback:function(tt){_ts.token=tt;_ts.failed=false;_captchaFlush(null,tt);},
        'expired-callback':function(){_ts.token=null;},
        'error-callback':function(){_ts.token=null;_ts.failed=true;_captchaFlush(new Error('captcha_failed'));}
      });
    });
  }).catch(function(){
    _ts.failed=true;_captchaFlush(new Error('captcha_unavailable'));
    showAuthMsg(t('auth.captchaLoadFailed'),'err');
  });
}
/* Promesse du jeton CAPTCHA (undefined si le CAPTCHA n'est pas configuré) */
function captchaToken(){
  return loadPublicConfig().then(function(cfg){
    if(!cfg.turnstileSiteKey)return undefined;
    if(_ts.token)return _ts.token;
    if(_ts.failed){var e=new Error('captcha_failed');e.code='captcha_failed';throw e;}
    return new Promise(function(resolve,reject){
      var done=false;
      var tt=setTimeout(function(){if(done)return;done=true;var e=new Error('captcha_timeout');e.code='captcha_timeout';reject(e);},20000);
      _ts.waiters.push(function(err,tok){if(done)return;done=true;clearTimeout(tt);if(err){err.code='captcha_failed';reject(err);}else resolve(tok);});
    });
  });
}
/* Un jeton Turnstile ne sert qu'une fois : on en redemande un après chaque envoi */
function captchaReset(){
  _ts.token=null;_ts.failed=false;
  if(window.turnstile&&_ts.widgetId!=null){try{window.turnstile.reset(_ts.widgetId);}catch(e){}}
}

/* ---------- Messages d'erreur (traduits, voir js/i18n/) ---------- */
var AUTH_ERRORS={
  invalid_credentials:t('autherr.invalid_credentials'),
  email_not_confirmed:t('autherr.email_not_confirmed'),
  user_already_exists:t('autherr.user_already_exists'),
  email_exists:t('autherr.email_exists'),
  signup_disabled:t('autherr.signup_disabled'),
  email_provider_disabled:t('autherr.email_provider_disabled'),
  over_email_send_rate_limit:t('autherr.over_email_send_rate_limit'),
  over_request_rate_limit:t('autherr.over_request_rate_limit'),
  captcha_failed:t('autherr.captcha_failed'),
  captcha_timeout:t('autherr.captcha_timeout'),
  otp_expired:t('autherr.otp_expired'),
  email_address_invalid:t('autherr.email_address_invalid'),
  email_address_not_authorized:t('autherr.email_address_not_authorized'),
  same_password:t('autherr.same_password'),
  reauthentication_needed:t('autherr.reauthentication_needed'),
  reauthentication_not_valid:t('autherr.reauthentication_not_valid'),
  session_not_found:t('autherr.session_not_found'),
  session_expired:t('autherr.session_expired'),
  refresh_token_not_found:t('autherr.refresh_token_not_found'),
  user_banned:t('autherr.user_banned'),
  user_not_found:t('autherr.user_not_found'),
  otp_disabled:t('autherr.otp_disabled'),
  validation_failed:t('autherr.validation_failed'),
  invite_not_found:t('autherr.invite_not_found'),
  conflict:t('autherr.conflict')
};
function authErrorMessage(e){
  if(!e)return t('autherr.generic');
  var code=e.code||e.error_code||'',msg=String(e.message||'');
  if(code==='weak_password'||e.name==='AuthWeakPasswordError'){
    var rs=e.reasons||[];
    if(rs.indexOf('pwned')>=0)return t('autherr.pwned');
    if(rs.indexOf('length')>=0)return t('autherr.pwShort',{n:AUTH_PW_MIN});
    if(rs.indexOf('characters')>=0)return t('autherr.pwSimple');
    return t('autherr.pwWeak');
  }
  if(AUTH_ERRORS[code])return AUTH_ERRORS[code];
  if(/captcha/i.test(msg))return AUTH_ERRORS.captcha_failed;
  if(/signups? not allowed for otp/i.test(msg))return AUTH_ERRORS.user_not_found;
  if(/expired|invalid.*(token|otp)|token.*invalid/i.test(msg))return AUTH_ERRORS.otp_expired;
  if(e.status===429)return AUTH_ERRORS.over_request_rate_limit;
  if(e.name==='AuthRetryableFetchError'||/fetch|network|load failed/i.test(msg))return t('autherr.network');
  return t('autherr.generic');
}

/* ---------- Validation ---------- */
function _validEmail(s){return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)&&s.length<=254;}
function _utf8Len(s){try{return new TextEncoder().encode(s).length;}catch(e){return s.length;}}
var AUTH_WEAK_PW=['motdepasse','password','azerty','qwerty','123456','abcdef','watchlist','cinepisode',String(BRAND.name).toLowerCase().replace(/[^a-z0-9]/g,''),'netflix','soleil','bonjour','sunshine','letmein','iloveyou'];
/* Renvoie un message d'erreur, ou '' si le mot de passe est acceptable */
function passwordProblem(pw,email){
  if(!pw||pw.length<AUTH_PW_MIN)return t('pw.min',{n:AUTH_PW_MIN});
  if(_utf8Len(pw)>AUTH_PW_MAX_BYTES)return t('pw.max',{n:AUTH_PW_MAX_BYTES});
  if(/^(.)\1+$/.test(pw))return t('pw.repeated');
  var low=pw.toLowerCase(),local=String(email||'').split('@')[0].toLowerCase();
  if(local.length>=4&&low.indexOf(local)>=0)return t('pw.containsEmail');
  for(var i=0;i<AUTH_WEAK_PW.length;i++){if(low.replace(/[^a-z0-9]/g,'')===AUTH_WEAK_PW[i]||low.replace(/[^a-z0-9]/g,'').replace(/(.+)\1+/,'$1')===AUTH_WEAK_PW[i])return t('pw.common');}
  return '';
}
/* Score 0..4 indicatif (longueur + variété), affiché sous le champ */
function passwordScore(pw){
  if(!pw)return 0;
  var classes=[/[a-z]/,/[A-Z]/,/[0-9]/,/[^A-Za-z0-9]/].filter(function(r){return r.test(pw);}).length;
  var s=0;
  if(pw.length>=AUTH_PW_MIN)s++;
  if(pw.length>=16)s++;
  if(classes>=3)s++;
  if(pw.length>=20||(classes===4&&pw.length>=14))s++;
  if(pw.length<AUTH_PW_MIN)s=Math.min(s,1);
  return s;
}
var PW_LABELS=[t('pw.s0'),t('pw.s1'),t('pw.s2'),t('pw.s3'),t('pw.s4')];

/* ---------- Utilitaires d'interface ---------- */
function _authRedirect(){return location.origin+'/';}
function showAuthMsg(msg,kind){
  var m=document.getElementById('authMsg');if(!m)return;
  m.textContent=msg||'';m.className='auth-msg'+(msg?' on '+(kind||'err'):'');
  m.setAttribute('role',kind==='ok'?'status':'alert');
}
function _authBusyBtn(btn,busy,label){
  _authBusy=busy;if(!btn)return;btn.disabled=busy;
  if(busy){btn.dataset.label=btn.textContent;btn.innerHTML='<span class="auth-spin" aria-hidden="true"></span>'+esc(label||t('common.wait'));}
  else if(btn.dataset.label){btn.textContent=btn.dataset.label;}
}
/* Dernière action réelle (non simulée par un script ou une extension) visant l'envoi d'un formulaire du modal */
var _authIntentAt=0;
function _authUserIntent(){return Date.now()-_authIntentAt<1000;}
(function(){
  function inAuth(el){var r=document.getElementById('authView');return !!(r&&el&&r.contains(el));}
  document.addEventListener('click',function(e){
    if(!e.isTrusted)return;
    var b=e.target&&e.target.closest&&e.target.closest('button[type=submit]');
    if(b&&inAuth(b))_authIntentAt=Date.now();
  },true);
  document.addEventListener('keydown',function(e){
    if(!e.isTrusted||e.key!=='Enter'||e.isComposing)return;
    if(e.target&&e.target.tagName==='INPUT'&&inAuth(e.target))_authIntentAt=Date.now();
  },true);
})();
function _val(id){var el=document.getElementById(id);return el?String(el.value||''):'';}
function _pwField(id,label,autocomplete,withMeter){
  return '<div class="field"><label for="'+id+'">'+label+'</label><div class="pw-wrap">'+
    '<input type="password" id="'+id+'" autocomplete="'+autocomplete+'" maxlength="128" '+(withMeter?'aria-describedby="'+id+'Meter" ':'')+'spellcheck="false">'+
    '<button type="button" class="pw-eye" data-click="togglePw" data-args="'+esc(JSON.stringify([id]))+'" aria-label="'+esc(t('pw.show'))+'">'+
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button></div>'+
    (withMeter?'<div class="pw-meter" id="'+id+'Meter"><div class="pw-meter-bar"><span></span></div><div class="pw-meter-lbl">'+esc(t('pw.minShort',{n:AUTH_PW_MIN}))+'</div></div>':'')+
    '</div>';
}
function togglePwVisibility(id,btn){
  var el=document.getElementById(id);if(!el)return;
  var show=el.type==='password';el.type=show?'text':'password';
  btn.setAttribute('aria-label',show?t('pw.hide'):t('pw.show'));
  btn.classList.toggle('on',show);
}
function _bindPwMeter(id){
  var el=document.getElementById(id),m=document.getElementById(id+'Meter');if(!el||!m)return;
  el.addEventListener('input',function(){
    var s=el.value?passwordScore(el.value):0;
    m.className='pw-meter s'+s+(el.value?' on':'');
    m.querySelector('.pw-meter-lbl').textContent=el.value?(PW_LABELS[s]+(el.value.length<AUTH_PW_MIN?' · '+tn('pw.remaining',AUTH_PW_MIN-el.value.length):'')):t('pw.minShort',{n:AUTH_PW_MIN});
  });
}
function _codeField(){
  return '<div class="field"><label for="authCode">'+esc(t('auth.codeLabel'))+'</label>'+
    '<input type="text" id="authCode" class="auth-code-input" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="123456" pattern="[0-9]*"></div>';
}
function _link(view,label){return '<button type="button" class="auth-link" data-click="authGo" data-args="'+esc(JSON.stringify([view]))+'">'+label+'</button>';}
function _legalLinks(){
  return t('auth.consent',{terms:'<a href="'+esc(legalUrl('terms'))+'" target="_blank" rel="noopener">'+esc(t('auth.termsLink'))+'</a>',privacy:'<a href="'+esc(legalUrl('privacy'))+'" target="_blank" rel="noopener">'+esc(t('auth.privacyLink'))+'</a>'});
}
function _maskEmail(e){return esc(e||'');}

/* ---------- Ouverture / navigation ---------- */
function openAuthModal(view,ctx){
  if(typeof sfx==='function')sfx('open');
  document.getElementById('authMbk').classList.add('on');
  authGo(view||(authUser?'account':'login'),ctx);
}
function closeAuthModal(){
  document.getElementById('authMbk').classList.remove('on');
  if(window.turnstile&&_ts.widgetId!=null){try{window.turnstile.remove(_ts.widgetId);}catch(e){}_ts.widgetId=null;}
}
function refreshAuthModalView(){
  var mbk=document.getElementById('authMbk');
  if(!mbk||!mbk.classList.contains('on'))return;
  if(_authView==='account')authGo('account');
  else if(authUser&&(_authView==='login'||_authView==='signup'))authGo('account');
}
function authGo(view,ctx){
  _authView=view;_authIntentAt=0;if(ctx)_authCtx=Object.assign({},_authCtx,ctx);
  var v=AUTH_VIEWS[view]||AUTH_VIEWS.login;
  var root=document.getElementById('authView');if(!root)return;
  root.innerHTML='<div class="mtitle auth-title" id="authViewTitle">'+v.title(_authCtx)+'</div><div class="auth-msg" id="authMsg"></div>'+v.html(_authCtx);
  var tabs=root.querySelector('.auth-tabs');if(tabs)tabs.after(document.getElementById('authMsg'));
  var form=root.querySelector('form');
  /* Formulaires de nouveau mot de passe : envoi uniquement sur action réelle de l'utilisateur
     (clic sur le bouton ou touche Entrée). Un gestionnaire de mots de passe qui remplit les deux
     champs ne doit pas valider à sa place, sinon il n'a pas le temps de proposer l'enregistrement. */
  var manualOnly=!!(form&&form.querySelector('input[autocomplete="new-password"]'));
  if(form)form.addEventListener('submit',function(e){
    e.preventDefault();
    if(manualOnly){if(!_authUserIntent())return;_authIntentAt=0;}
    if(!_authBusy&&v.submit)v.submit(form.querySelector('[type=submit]'));
  });
  if(v.after)v.after(_authCtx);
  var cap=root.querySelector('.auth-captcha');if(cap)captchaMount(cap);
  var first=root.querySelector('input:not([type=checkbox]):not([readonly])');
  /* Focus auto (souris uniquement), sauf si l'utilisateur a déjà cliqué dans un champ */
  if(first&&window.matchMedia&&window.matchMedia('(pointer:fine)').matches)setTimeout(function(){
    var a=document.activeElement;
    if(a&&a!==document.body&&root.contains(a)&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))return;
    try{first.focus();}catch(e){}
  },30);
}
/* Fermeture « implicite » (clic à côté, Échap) : jamais quand un champ du formulaire est rempli,
   pour ne pas perdre un mot de passe en cours de saisie. Un clic à côté ne compte que s'il commence
   ET se termine sur le fond (un clic qui démarre dans un champ ou dans le menu d'un gestionnaire de
   mots de passe et se termine ailleurs ne ferme rien). Le bouton × et « Annuler » ferment toujours. */
function _authDirty(){
  var r=document.getElementById('authView');if(!r)return false;
  return Array.prototype.some.call(r.querySelectorAll('input'),function(i){
    return !i.hidden&&!i.readOnly&&i.type!=='checkbox'&&i.type!=='hidden'&&String(i.value||'')!=='';
  });
}
var _authDownOnBackdrop=false;
(function(){
  var mbk=document.getElementById('authMbk');
  mbk.addEventListener('pointerdown',function(e){_authDownOnBackdrop=(e.target===mbk);});
  mbk.addEventListener('click',function(e){
    var ok=_authDownOnBackdrop&&e.target===mbk;_authDownOnBackdrop=false;
    if(!ok||_authDirty())return;
    if(typeof sfx==='function')sfx('close');closeAuthModal();
  });
})();
document.addEventListener('keydown',function(e){
  if(e.key!=='Escape'||!document.getElementById('authMbk').classList.contains('on'))return;
  if(_authDirty()){if(e.target&&e.target.blur)e.target.blur();return;}
  closeAuthModal();
});

/* ---------- Vues ---------- */
var CAPTCHA_SLOT='<div class="auth-captcha" style="display:none"></div>';
var AUTH_VIEWS={
  login:{
    title:function(){return esc(t('auth.login'));},
    html:function(c){
      return '<div class="auth-tabs" role="tablist"><button type="button" class="auth-tab on" role="tab" aria-selected="true">'+esc(t('auth.login'))+'</button>'+
        '<button type="button" class="auth-tab" role="tab" aria-selected="false" id="authTabSignup" data-click="authGo" data-args="[&quot;signup&quot;]">'+esc(t('auth.createAccount'))+'</button></div>'+
        '<form novalidate autocomplete="on">'+
        '<div class="field"><label for="authEmail">'+esc(t('auth.email'))+'</label><input type="email" id="authEmail" autocomplete="username" placeholder="'+esc(t('auth.emailPh'))+'" value="'+esc(c.email||'')+'" maxlength="254"></div>'+
        _pwField('authPassword',esc(t('auth.password')),'current-password',false)+
        '<div class="auth-row-right">'+_link('forgot',esc(t('auth.forgotLink')))+'</div>'+CAPTCHA_SLOT+
        '<button type="submit" class="btn btn-primary auth-submit">'+esc(t('auth.signIn'))+'</button></form>'+
        '<div class="auth-alt">'+_link('magic',esc(t('auth.magicLink')))+' · '+_link('code',esc(t('auth.haveCode')))+'</div>'+
        '<div class="auth-local-note">'+esc(t('auth.localNote'))+'</div>'+
        '<div class="mact"><button type="button" class="btn btn-ghost" style="flex:1" data-click="closeAuth">'+esc(t('auth.continueWithout'))+'</button></div>'+
        langSwitcherHtml('lang-switch-auth',{reopen:{auth:'login'}});
    },
    after:function(){loadPublicConfig().then(function(cfg){var tt=document.getElementById('authTabSignup');if(tt&&!cfg.signupsOpen)tt.style.display='none';});},
    submit:function(btn){
      var email=_val('authEmail').trim(),pass=_val('authPassword');
      if(!_validEmail(email))return showAuthMsg(t('auth.err.email'));
      if(!pass)return showAuthMsg(t('auth.err.password'));
      _authCtx.email=email;
      _authBusyBtn(btn,true,t('auth.busy.signingIn'));
      captchaToken().then(function(captcha){
        return supa.auth.signInWithPassword({email:email,password:pass,options:{captchaToken:captcha}});
      }).then(function(res){
        captchaReset();_authBusyBtn(btn,false);
        if(res.error){
          if(res.error.code==='email_not_confirmed')return authGo('check',{email:email,kind:'signup',notice:AUTH_ERRORS.email_not_confirmed});
          return showAuthMsg(authErrorMessage(res.error));
        }
        toast(t('auth.toast.signedIn'),'ok');authGo('account');
      }).catch(function(e){captchaReset();_authBusyBtn(btn,false);showAuthMsg(authErrorMessage(e));});
    }
  },
  signup:{
    title:function(){return esc(t('auth.createAccount'));},
    html:function(c){
      return '<div class="auth-tabs" role="tablist"><button type="button" class="auth-tab" role="tab" aria-selected="false" data-click="authGo" data-args="[&quot;login&quot;]">'+esc(t('auth.login'))+'</button>'+
        '<button type="button" class="auth-tab on" role="tab" aria-selected="true">'+esc(t('auth.createAccount'))+'</button></div>'+
        '<form novalidate autocomplete="on">'+
        '<div class="field"><label for="authEmail">'+esc(t('auth.email'))+'</label><input type="email" id="authEmail" autocomplete="username" placeholder="'+esc(t('auth.emailPh'))+'" value="'+esc(c.email||'')+'" maxlength="254"></div>'+
        _pwField('authPassword',esc(t('auth.password')),'new-password',true)+
        _pwField('authPasswordConfirm',esc(t('auth.confirmPassword')),'new-password',false)+
        '<label class="auth-check"><input type="checkbox" id="authConsent"><span>'+_legalLinks()+'</span></label>'+CAPTCHA_SLOT+
        '<button type="submit" class="btn btn-primary auth-submit">'+esc(t('auth.createMine'))+'</button></form>'+
        '<div class="auth-local-note">'+esc(t('auth.signupNote'))+'</div>'+
        langSwitcherHtml('lang-switch-auth',{reopen:{auth:'signup'}});
    },
    after:function(){_bindPwMeter('authPassword');},
    submit:function(btn){
      var email=_val('authEmail').trim(),pass=_val('authPassword'),conf=_val('authPasswordConfirm');
      if(!_validEmail(email))return showAuthMsg(t('auth.err.email'));
      var pb=passwordProblem(pass,email);if(pb)return showAuthMsg(pb);
      if(pass!==conf)return showAuthMsg(t('auth.err.pwMismatch'));
      if(!document.getElementById('authConsent').checked)return showAuthMsg(t('auth.err.consent'));
      _authCtx.email=email;
      _authBusyBtn(btn,true,t('auth.busy.creating'));
      captchaToken().then(function(captcha){
        return supa.auth.signUp({email:email,password:pass,options:{captchaToken:captcha,emailRedirectTo:_authRedirect(),data:{lang:LANG}}});
      }).then(function(res){
        captchaReset();_authBusyBtn(btn,false);
        if(res.error)return showAuthMsg(authErrorMessage(res.error));
        if(res.data&&res.data.session){toast(t('auth.toast.created'),'ok');return authGo('account');}
        _authResendAt=Date.now();
        authGo('check',{email:email,kind:'signup',notice:''});
      }).catch(function(e){captchaReset();_authBusyBtn(btn,false);showAuthMsg(authErrorMessage(e));});
    }
  },
  /* Après inscription (ou connexion d'un compte non confirmé) : lien OU code */
  check:{
    title:function(){return esc(t('auth.checkInbox'));},
    html:function(c){
      return '<div class="auth-hero"><div class="auth-hero-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="4" width="20" height="16" rx="3"/><path d="m3 7 9 6 9-6"/></svg></div>'+
        '<p>'+t('auth.check.sent',{email:'<b>'+_maskEmail(c.email)+'</b>'})+'</p>'+
        '<p class="auth-sub">'+t('auth.check.help',{login:_link('login',esc(t('auth.check.loginLink'))),forgot:_link('forgot',esc(t('auth.check.forgotLink')))})+'</p></div>'+
        '<form novalidate>'+_codeField()+CAPTCHA_SLOT+'<button type="submit" class="btn btn-primary auth-submit">'+esc(t('auth.submitCode'))+'</button></form>'+
        '<div class="auth-alt"><button type="button" class="auth-link" id="authResendBtn" data-click="authResend">'+esc(t('auth.resend'))+'</button></div>'+
        '<div class="mact"><button type="button" class="btn btn-ghost" style="flex:1" data-click="authGo" data-args="[&quot;login&quot;]">'+esc(t('auth.backToLogin'))+'</button></div>';
    },
    after:function(c){if(c.notice)showAuthMsg(c.notice,'nfo');_tickResend();},
    submit:function(btn){_verifyCode(btn,'email',_authCtx.email,function(){toast(t('auth.toast.confirmed'),'ok');authGo('account');});}
  },
  forgot:{
    title:function(){return esc(t('auth.forgot.title'));},
    html:function(c){
      return '<p class="auth-p">'+esc(t('auth.forgot.intro'))+'</p>'+
        '<form novalidate><div class="field"><label for="authEmail">'+esc(t('auth.email'))+'</label><input type="email" id="authEmail" autocomplete="username" placeholder="'+esc(t('auth.emailPh'))+'" value="'+esc(c.email||'')+'" maxlength="254"></div>'+
        CAPTCHA_SLOT+'<button type="submit" class="btn btn-primary auth-submit">'+esc(t('auth.sendLink'))+'</button></form>'+
        '<div class="auth-alt">'+_link('code',esc(t('auth.haveCodeAlready')))+'</div>'+
        '<div class="mact"><button type="button" class="btn btn-ghost" style="flex:1" data-click="authGo" data-args="[&quot;login&quot;]">'+esc(t('auth.backToLogin'))+'</button></div>';
    },
    submit:function(btn){
      var email=_val('authEmail').trim();
      if(!_validEmail(email))return showAuthMsg(t('auth.err.email'));
      _authCtx.email=email;_authBusyBtn(btn,true,t('auth.busy.sending'));
      captchaToken().then(function(captcha){
        return supa.auth.resetPasswordForEmail(email,{redirectTo:_authRedirect(),captchaToken:captcha});
      }).then(function(res){
        captchaReset();_authBusyBtn(btn,false);
        if(res&&res.error)return showAuthMsg(authErrorMessage(res.error));
        authGo('forgotSent',{email:email});
      }).catch(function(e){captchaReset();_authBusyBtn(btn,false);showAuthMsg(authErrorMessage(e));});
    }
  },
  forgotSent:{
    title:function(){return esc(t('auth.forgotSent.title'));},
    html:function(c){
      return '<p class="auth-p">'+t('auth.forgotSent.text',{email:'<b>'+_maskEmail(c.email)+'</b>'})+'</p>'+
        '<form novalidate>'+_codeField()+'<button type="submit" class="btn btn-primary auth-submit">'+esc(t('auth.submitCode'))+'</button></form>'+
        '<div class="mact"><button type="button" class="btn btn-ghost" style="flex:1" data-click="authGo" data-args="[&quot;login&quot;]">'+esc(t('auth.backToLogin'))+'</button></div>';
    },
    submit:function(btn){_verifyCode(btn,'recovery',_authCtx.email,function(){authGo('reset',{mode:'recovery'});});}
  },
  magic:{
    title:function(){return esc(t('auth.magic.title'));},
    html:function(c){
      return '<p class="auth-p">'+esc(t('auth.magic.intro'))+'</p>'+
        '<form novalidate><div class="field"><label for="authEmail">'+esc(t('auth.email'))+'</label><input type="email" id="authEmail" autocomplete="username" placeholder="'+esc(t('auth.emailPh'))+'" value="'+esc(c.email||'')+'" maxlength="254"></div>'+
        CAPTCHA_SLOT+'<button type="submit" class="btn btn-primary auth-submit">'+esc(t('auth.sendLink'))+'</button></form>'+
        '<div class="auth-alt">'+_link('code',esc(t('auth.haveCodeAlready')))+'</div>'+
        '<div class="mact"><button type="button" class="btn btn-ghost" style="flex:1" data-click="authGo" data-args="[&quot;login&quot;]">'+esc(t('auth.backToLogin'))+'</button></div>';
    },
    submit:function(btn){
      var email=_val('authEmail').trim();
      if(!_validEmail(email))return showAuthMsg(t('auth.err.email'));
      _authCtx.email=email;_authBusyBtn(btn,true,t('auth.busy.sending'));
      captchaToken().then(function(captcha){
        return supa.auth.signInWithOtp({email:email,options:{shouldCreateUser:false,emailRedirectTo:_authRedirect(),captchaToken:captcha}});
      }).then(function(res){
        captchaReset();_authBusyBtn(btn,false);
        if(res.error)return showAuthMsg(authErrorMessage(res.error));
        authGo('magicSent',{email:email});
      }).catch(function(e){captchaReset();_authBusyBtn(btn,false);showAuthMsg(authErrorMessage(e));});
    }
  },
  magicSent:{
    title:function(){return esc(t('auth.checkInbox'));},
    html:function(c){
      return '<p class="auth-p">'+t('auth.magicSent.text',{email:'<b>'+_maskEmail(c.email)+'</b>'})+'</p>'+
        '<form novalidate>'+_codeField()+'<button type="submit" class="btn btn-primary auth-submit">'+esc(t('auth.signIn'))+'</button></form>'+
        '<div class="mact"><button type="button" class="btn btn-ghost" style="flex:1" data-click="authGo" data-args="[&quot;login&quot;]">'+esc(t('auth.backToLogin'))+'</button></div>';
    },
    submit:function(btn){_verifyCode(btn,'email',_authCtx.email,function(){toast(t('auth.toast.signedIn'),'ok');authGo('account');});}
  },
  /* Code à 6 chiffres reçu par email (inscription, lien de connexion, mot de passe oublié),
     saisi plus tard ou sur un autre appareil que celui de la demande */
  code:{
    title:function(){return esc(t('auth.haveCode'));},
    html:function(c){
      return '<p class="auth-p">'+esc(t('auth.code.intro'))+'</p>'+
        '<form novalidate><div class="field"><label for="authEmail">'+esc(t('auth.email'))+'</label><input type="email" id="authEmail" autocomplete="username" placeholder="'+esc(t('auth.emailPh'))+'" value="'+esc(c.email||'')+'" maxlength="254"></div>'+
        _codeField()+'<button type="submit" class="btn btn-primary auth-submit">'+esc(t('auth.submitCode'))+'</button></form>'+
        '<div class="mact"><button type="button" class="btn btn-ghost" style="flex:1" data-click="authGo" data-args="[&quot;login&quot;]">'+esc(t('auth.backToLogin'))+'</button></div>';
    },
    submit:function(btn){
      var email=_val('authEmail').trim(),code=_val('authCode').replace(/\s/g,'');
      if(!_validEmail(email))return showAuthMsg(t('auth.err.email'));
      if(!/^\d{6,10}$/.test(code))return showAuthMsg(t('auth.err.codeFormat'));
      _authCtx.email=email;_authBusyBtn(btn,true,t('auth.busy.verifying'));
      /* Le type du code n'est pas connu : inscription/connexion d'abord, puis mot de passe oublié */
      supa.auth.verifyOtp({email:email,token:code,type:'email'}).then(function(res){
        if(!res.error)return {res:res,action:'signup'};
        return supa.auth.verifyOtp({email:email,token:code,type:'recovery'}).then(function(r2){return {res:r2,action:'recovery',first:res.error};});
      }).then(function(o){
        _authBusyBtn(btn,false);
        if(o.res.error)return showAuthMsg(authErrorMessage(o.first&&o.first.code!=='otp_expired'?o.first:o.res.error));
        _afterEmailVerified(o.action,o.res.data);
      }).catch(function(e){_authBusyBtn(btn,false);showAuthMsg(authErrorMessage(e));});
    }
  },
  /* Lien reçu par email (?token_hash=…) : un clic de confirmation, pour que les antivirus
     de messagerie qui « visitent » les liens ne consomment pas le jeton à ta place. */
  verify:{
    title:function(c){return esc(({signup:t('auth.verify.t.signup'),recovery:t('auth.newPassword'),magiclink:t('auth.login'),invite:t('auth.verify.t.invite'),email_change:t('auth.verify.t.emailChange')})[c.action]||t('auth.verify.t.default'));},
    html:function(c){
      var label=esc(({signup:t('auth.verify.b.signup'),recovery:t('auth.verify.b.recovery'),magiclink:t('auth.verify.b.magiclink'),invite:t('auth.verify.b.invite'),email_change:t('auth.verify.b.emailChange')})[c.action]||t('auth.confirm'));
      var txt=esc(({signup:t('auth.verify.x.signup'),recovery:t('auth.verify.x.recovery'),magiclink:t('auth.verify.x.magiclink'),invite:t('auth.verify.x.invite'),email_change:t('auth.verify.x.emailChange')})[c.action]||'');
      return '<p class="auth-p">'+txt+'</p><form novalidate><button type="submit" class="btn btn-primary auth-submit">'+label+'</button></form>';
    },
    submit:function(btn){
      var c=_authCtx;_authBusyBtn(btn,true,t('auth.busy.verifying'));
      supa.auth.verifyOtp({token_hash:c.tokenHash,type:c.type}).then(function(res){
        _authBusyBtn(btn,false);
        if(res.error){_authCtx.tokenHash=null;return authGo('linkError',{code:res.error.code||'otp_expired',action:c.action});}
        _authCtx.tokenHash=null;
        _afterEmailVerified(c.action,res.data);
      }).catch(function(e){_authBusyBtn(btn,false);showAuthMsg(authErrorMessage(e));});
    }
  },
  linkError:{
    title:function(){return esc(t('auth.linkError.title'));},
    html:function(c){
      var next=c.action==='recovery'?_link('forgot',esc(t('auth.linkError.newLink'))):c.action==='magiclink'?_link('magic',esc(t('auth.linkError.newLink'))):_link('login',esc(t('auth.linkError.login')));
      /* Code d'erreur venu de l'adresse : seuls nos messages traduits s'affichent, jamais le texte
         error_description de l'URL (un lien piégé pourrait sinon faire afficher n'importe quel
         message dans la fenêtre officielle, ex. une fausse consigne de sécurité). */
      var known=Object.prototype.hasOwnProperty.call(AUTH_ERRORS,c.code)?AUTH_ERRORS[c.code]:AUTH_ERRORS.otp_expired;
      return '<p class="auth-p">'+esc(known)+'</p><div class="auth-alt">'+next+'</div>'+
        '<div class="mact"><button type="button" class="btn btn-ghost" style="flex:1" data-click="closeAuth">'+esc(t('common.close'))+'</button></div>';
    }
  },
  /* Choix d'un nouveau mot de passe (après « mot de passe oublié » ou invitation) */
  reset:{
    title:function(c){return esc(c.mode==='invite'?t('auth.reset.invite'):t('auth.reset.title'));},
    html:function(){
      return '<form novalidate autocomplete="on"><input type="email" autocomplete="username" value="'+esc(authUser&&authUser.email||'')+'" hidden readonly>'+
        _pwField('authPassword',esc(t('auth.newPassword')),'new-password',true)+_pwField('authPasswordConfirm',esc(t('auth.confirm')),'new-password',false)+
        '<button type="submit" class="btn btn-primary auth-submit">'+esc(t('common.save'))+'</button></form>';
    },
    after:function(){_bindPwMeter('authPassword');},
    submit:function(btn){_submitNewPassword(btn,function(){toast(t('auth.toast.pwSaved'),'ok');_pwSavedState(btn,t('auth.toast.pwSaved'));});}
  },
  account:{
    title:function(){return esc(t('auth.myAccount'));},
    html:function(){
      if(!authUser)return '<p class="auth-p">'+esc(t('auth.account.notSignedIn'))+'</p><div class="mact"><button type="button" class="btn btn-primary" style="flex:1" data-click="authGo" data-args="[&quot;login&quot;]">'+esc(t('auth.signIn'))+'</button></div>';
      var pending=memDB.filter(function(i){return i.needsSync;}).length;
      var online=navigator.onLine;
      return '<div class="auth-account-row"><span class="sync-dot '+(online?'synced':'offline')+'" id="authAccountDot"></span><span class="auth-account-email" id="authAccountEmail">'+esc(authUser.email||'')+'</span></div>'+
        '<div class="auth-sync-info" id="authSyncInfo">'+esc(pending?tn('auth.account.pending',pending):t('auth.account.allSynced'))+'</div>'+
        '<div class="auth-menu">'+
        _accBtn('syncNow',esc(t('auth.account.syncNow')),'<path d="M1 4v6h6"/><path d="M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4-4.64 4.36A9 9 0 0 1 3.51 15"/>')+
        _accBtn(['authGo','changePassword'],esc(t('auth.account.changePw')),'<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>')+
        _accBtn(['authGo','changeEmail'],esc(t('auth.account.changeEmail')),'<rect x="2" y="4" width="20" height="16" rx="3"/><path d="m3 7 9 6 9-6"/>')+
        _accBtn('exportAccount',esc(t('auth.account.export')),'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>')+
        _accBtn('signOut',esc(t('auth.account.signOut')),'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>')+
        '</div>'+
        '<div class="auth-danger"><button type="button" class="auth-link danger" data-click="authGo" data-args="[&quot;deleteAccount&quot;]">'+esc(t('auth.account.delete'))+'</button></div>'+
        '<div class="auth-legal"><a href="'+esc(legalUrl('privacy'))+'" target="_blank" rel="noopener">'+esc(t('legal.privacy'))+'</a> · <a href="'+esc(legalUrl('terms'))+'" target="_blank" rel="noopener">'+esc(t('legal.termsShort'))+'</a></div>'+
        '<div class="mact"><button type="button" class="btn btn-ghost" style="flex:1" data-click="closeAuth">'+esc(t('common.close'))+'</button></div>';
    }
  },
  changePassword:{
    title:function(){return esc(t('auth.changePw.title'));},
    html:function(c){
      return '<form novalidate autocomplete="on"><input type="email" autocomplete="username" value="'+esc(authUser&&authUser.email||'')+'" hidden readonly>'+
        _pwField('authPassword',esc(t('auth.newPassword')),'new-password',true)+_pwField('authPasswordConfirm',esc(t('auth.confirm')),'new-password',false)+
        (c.needNonce?'<p class="auth-sub">'+esc(t('auth.changePw.nonce',{email:authUser&&authUser.email||''}))+'</p>'+_codeField():'')+
        '<button type="submit" class="btn btn-primary auth-submit">'+esc(t('common.save'))+'</button></form>'+
        '<div class="mact"><button type="button" class="btn btn-ghost" style="flex:1" data-click="authGo" data-args="[&quot;account&quot;,{&quot;needNonce&quot;:false}]">'+esc(t('common.cancel'))+'</button></div>';
    },
    after:function(){_bindPwMeter('authPassword');},
    submit:function(btn){_submitNewPassword(btn,function(){_authCtx.needNonce=false;toast(t('auth.toast.pwChanged'),'ok');_pwSavedState(btn,t('auth.toast.pwChanged'));},true);}
  },
  changeEmail:{
    title:function(){return esc(t('auth.account.changeEmail'));},
    html:function(){
      return '<p class="auth-p">'+t('auth.changeEmail.intro',{email:'<b>'+esc(authUser&&authUser.email||'')+'</b>'})+'</p>'+
        '<form novalidate><div class="field"><label for="authNewEmail">'+esc(t('auth.newEmail'))+'</label><input type="email" id="authNewEmail" autocomplete="email" maxlength="254"></div>'+
        '<button type="submit" class="btn btn-primary auth-submit">'+esc(t('auth.changeEmail.send'))+'</button></form>'+
        '<div class="auth-alt"><button type="button" class="auth-link" data-click="authHaveCodeEmail">'+esc(t('auth.haveCode'))+'</button></div>'+
        '<div class="mact"><button type="button" class="btn btn-ghost" style="flex:1" data-click="authGo" data-args="[&quot;account&quot;]">'+esc(t('common.cancel'))+'</button></div>';
    },
    submit:function(btn){
      var email=_val('authNewEmail').trim();
      if(!_validEmail(email))return showAuthMsg(t('auth.err.email'));
      if(authUser&&email.toLowerCase()===String(authUser.email||'').toLowerCase())return showAuthMsg(t('auth.err.sameEmail'));
      _authBusyBtn(btn,true,t('auth.busy.sending'));
      supa.auth.updateUser({email:email},{emailRedirectTo:_authRedirect()}).then(function(res){
        _authBusyBtn(btn,false);
        if(res.error)return showAuthMsg(authErrorMessage(res.error));
        authGo('emailSent',{newEmail:email});
      }).catch(function(e){_authBusyBtn(btn,false);showAuthMsg(authErrorMessage(e));});
    }
  },
  emailSent:{
    title:function(){return esc(t('auth.emailSent.title'));},
    html:function(c){
      var known=_validEmail(c.newEmail||'');
      return (known?'<p class="auth-p">'+t('auth.emailSent.known',{email:'<b>'+esc(c.newEmail)+'</b>'})+'</p>':'<p class="auth-p">'+esc(t('auth.emailSent.unknown'))+'</p>')+
        '<form novalidate>'+(known?'':'<div class="field"><label for="authNewEmail">'+esc(t('auth.newEmail'))+'</label><input type="email" id="authNewEmail" autocomplete="email" maxlength="254"></div>')+_codeField()+'<button type="submit" class="btn btn-primary auth-submit">'+esc(t('auth.submitCode'))+'</button></form>'+
        '<div class="mact"><button type="button" class="btn btn-ghost" style="flex:1" data-click="authGo" data-args="[&quot;account&quot;]">'+esc(t('common.later'))+'</button></div>';
    },
    submit:function(btn){
      var c=_authCtx,code=_val('authCode').replace(/\s/g,'');
      if(!_validEmail(c.newEmail||'')){var ne=_val('authNewEmail').trim();if(!_validEmail(ne))return showAuthMsg(t('auth.err.newEmail'));c.newEmail=ne;}
      if(!/^\d{6,10}$/.test(code))return showAuthMsg(t('auth.err.codeFormat'));
      _authBusyBtn(btn,true,t('auth.busy.verifying'));
      supa.auth.verifyOtp({email:c.newEmail,token:code,type:'email_change'}).then(function(res){
        if(res.error&&authUser&&authUser.email)return supa.auth.verifyOtp({email:authUser.email,token:code,type:'email_change'});
        return res;
      }).then(function(res){
        _authBusyBtn(btn,false);
        if(res.error)return showAuthMsg(authErrorMessage(res.error));
        _afterEmailVerified('email_change',res.data);
      }).catch(function(e){_authBusyBtn(btn,false);showAuthMsg(authErrorMessage(e));});
    }
  },
  deleteAccount:{
    title:function(){return esc(t('auth.delete.title'));},
    html:function(){
      return '<div class="auth-warn">'+t('auth.delete.warn',{email:esc(authUser&&authUser.email||''),export:'<button type="button" class="auth-link" data-click="exportAccount">'+esc(t('auth.delete.exportLink'))+'</button>'})+'</div>'+
        '<form novalidate autocomplete="on"><input type="email" autocomplete="username" value="'+esc(authUser&&authUser.email||'')+'" hidden readonly>'+
        _pwField('authPassword',esc(t('auth.currentPassword')),'current-password',false)+
        '<div class="field"><label for="authDeleteConfirm">'+esc(t('auth.delete.typeWord',{word:t('auth.delete.word')}))+'</label><input type="text" id="authDeleteConfirm" autocomplete="off" autocapitalize="characters" spellcheck="false"></div>'+
        '<label class="auth-check"><input type="checkbox" id="authDeleteLocal" checked><span>'+esc(t('auth.delete.wipeLocal'))+'</span></label>'+
        CAPTCHA_SLOT+'<button type="submit" class="btn auth-submit btn-danger" id="authDeleteBtn" disabled>'+esc(t('auth.delete.submit'))+'</button></form>'+
        '<div class="mact"><button type="button" class="btn btn-ghost" style="flex:1" data-click="authGo" data-args="[&quot;account&quot;]">'+esc(t('common.cancel'))+'</button></div>';
    },
    after:function(){
      var i=document.getElementById('authDeleteConfirm'),b=document.getElementById('authDeleteBtn');
      i.addEventListener('input',function(){b.disabled=i.value.trim().toUpperCase()!==t('auth.delete.word');});
    },
    submit:function(btn){
      if(!authUser)return authGo('login');
      var pass=_val('authPassword'),wipe=document.getElementById('authDeleteLocal').checked;
      if(_val('authDeleteConfirm').trim().toUpperCase()!==t('auth.delete.word'))return showAuthMsg(t('auth.delete.typeWord',{word:t('auth.delete.word')})+'.');
      if(!pass)return showAuthMsg(t('auth.err.currentPassword'));
      var email=authUser.email;
      _authBusyBtn(btn,true,t('auth.busy.deleting'));
      /* Reconnexion immédiate : la fonction SQL exige une authentification de moins de 15 min */
      captchaToken().then(function(captcha){
        return supa.auth.signInWithPassword({email:email,password:pass,options:{captchaToken:captcha}});
      }).then(function(res){
        captchaReset();
        if(res.error){var e=res.error;if(e.code==='invalid_credentials')e={code:'x',message:'wrong_password'};throw e;}
        return supa.rpc('delete_my_account');
      }).then(function(res){
        if(res.error)throw res.error;
        stopSyncLoop();
        if(wipe)clearLocalData();else detachLocalData();
        return supa.auth.signOut({scope:'local'}).catch(function(){});
      }).then(function(){
        _authBusyBtn(btn,false);
        authUser=null;authProfileId=null;updateSyncStatusUI('anon');
        if(wipe){render();if(typeof updateStatsFooter==='function')updateStatsFooter();if(typeof renderSuivi==='function')renderSuivi();}
        toast(t('auth.toast.deleted',{name:BRAND.name}),'nfo');
        authGo('login');
      }).catch(function(e){
        captchaReset();_authBusyBtn(btn,false);
        var msg=e&&e.message==='wrong_password'?t('auth.err.wrongPassword'):(e&&(e.code==='42501'||/reauthentication/i.test(e.message||''))?t('auth.err.reauthOld'):authErrorMessage(e));
        showAuthMsg(msg);
      });
    }
  }
};
/* action : nom d'action (js/00-actions.js), ou [nom, ...arguments] */
function _accBtn(action,label,svgPath){
  var a=Array.isArray(action)?action:[action];
  return '<button type="button" class="auth-menu-btn"'+uiAct(a[0],a.slice(1))+'><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">'+svgPath+'</svg><span>'+label+'</span></button>';
}

/* ---------- Actions partagées ---------- */
function _verifyCode(btn,type,email,onOk){
  var code=_val('authCode').replace(/\s/g,'');
  if(!/^\d{6,10}$/.test(code))return showAuthMsg(t('auth.err.codeFormat'));
  if(!email)return showAuthMsg(t('auth.err.unknownEmail'));
  _authBusyBtn(btn,true,t('auth.busy.verifying'));
  supa.auth.verifyOtp({email:email,token:code,type:type}).then(function(res){
    _authBusyBtn(btn,false);
    if(res.error)return showAuthMsg(authErrorMessage(res.error));
    onOk(res.data);
  }).catch(function(e){_authBusyBtn(btn,false);showAuthMsg(authErrorMessage(e));});
}
/* Après enregistrement : on laisse le formulaire affiché (champs verrouillés) au lieu de changer
   de vue tout de suite, pour que le gestionnaire de mots de passe puisse proposer de l'enregistrer. */
function _pwSavedState(btn,msg){
  var form=btn&&btn.form;
  if(form)Array.prototype.forEach.call(form.querySelectorAll('input'),function(i){i.readOnly=true;});
  showAuthMsg(msg,'ok');
  if(btn){
    var next=document.createElement('button');
    next.type='button';next.className='btn btn-primary auth-submit';next.textContent=t('common.continue');
    next.addEventListener('click',function(){authGo('account');});
    btn.replaceWith(next);
  }
  var cancel=document.querySelector('#authView .mact');if(cancel)cancel.remove();
}
function _submitNewPassword(btn,onOk,allowNonce){
  var pass=_val('authPassword'),conf=_val('authPasswordConfirm');
  var pb=passwordProblem(pass,authUser&&authUser.email);if(pb)return showAuthMsg(pb);
  if(pass!==conf)return showAuthMsg(t('auth.err.pwMismatch'));
  var attrs={password:pass};
  if(allowNonce&&_authCtx.needNonce){
    var code=_val('authCode').replace(/\s/g,'');
    if(!/^\d{6,10}$/.test(code))return showAuthMsg(t('auth.err.code'));
    attrs.nonce=code;
  }
  _authBusyBtn(btn,true,t('auth.busy.saving'));
  supa.auth.updateUser(attrs).then(function(res){
    _authBusyBtn(btn,false);
    if(res.error){
      if(allowNonce&&res.error.code==='reauthentication_needed'){
        return supa.auth.reauthenticate().then(function(r2){
          if(r2&&r2.error)return showAuthMsg(authErrorMessage(r2.error));
          authGo('changePassword',{needNonce:true});
          showAuthMsg(t('auth.changePw.codeSent'),'nfo');
        });
      }
      return showAuthMsg(authErrorMessage(res.error));
    }
    onOk();
  }).catch(function(e){_authBusyBtn(btn,false);showAuthMsg(authErrorMessage(e));});
}
function _tickResend(){
  var b=document.getElementById('authResendBtn');if(!b)return;
  var left=Math.ceil((_authResendAt+AUTH_RESEND_COOLDOWN_S*1000-Date.now())/1000);
  if(left>0){b.disabled=true;b.textContent=t('auth.resendIn',{n:left});setTimeout(_tickResend,1000);}
  else{b.disabled=false;b.textContent=t('auth.resend');}
}
function authResend(btn){
  var email=_authCtx.email;if(!email||_authBusy)return;
  btn.disabled=true;
  captchaToken().then(function(captcha){
    return supa.auth.resend({type:'signup',email:email,options:{captchaToken:captcha,emailRedirectTo:_authRedirect()}});
  }).then(function(res){
    captchaReset();
    if(res.error){btn.disabled=false;return showAuthMsg(authErrorMessage(res.error));}
    _authResendAt=Date.now();_tickResend();showAuthMsg(t('auth.resent'),'ok');
  }).catch(function(e){captchaReset();btn.disabled=false;showAuthMsg(authErrorMessage(e));});
}
function _afterEmailVerified(action,data){
  var hasSession=!!(data&&data.session);
  if(action==='recovery')return authGo('reset',{mode:'recovery'});
  if(action==='invite')return authGo('reset',{mode:'invite'});
  if(action==='email_change'){
    if(!hasSession&&!(data&&data.user)){authGo('account');return showAuthMsg(t('auth.emailChange.half'),'nfo');}
    toast(t('auth.toast.emailUpdated'),'ok');return authGo('account');
  }
  if(action==='signup')toast(t('auth.toast.confirmed'),'ok');else toast(t('auth.toast.signedIn'),'ok');
  authGo('account');
}

function signOutUser(){
  if(!supa)return;
  supa.auth.signOut().then(function(res){
    if(res&&res.error)return supa.auth.signOut({scope:'local'});
  }).catch(function(){return supa.auth.signOut({scope:'local'});}).then(function(){
    toast(t('auth.toast.signedOut'),'nfo');closeAuthModal();
  });
}

/* ---------- Langue du compte = langue des emails (user_metadata.lang, lu par les modèles
   d'emails Supabase via {{ .Data.lang }} ; sans valeur, les emails partent en français) ---------- */
function saveLangToAccount(code){
  if(!supa||!authUser)return null;
  if((authUser.user_metadata||{}).lang===code)return null;
  return supa.auth.updateUser({data:{lang:code}}).then(function(res){
    if(res&&res.data&&res.data.user)authUser=res.data.user;
  },function(){});
}
/* À la connexion : un compte sans langue enregistrée (comptes créés avant l'anglais) reçoit
   celle de l'interface ; une langue choisie explicitement sur cet appareil (sélecteur, /en,
   ?lang=) remplace celle du compte. La langue seulement déduite du navigateur ne l'écrase pas. */
function syncAccountLang(user){
  if(!supa||!user)return;
  var acc=(user.user_metadata||{}).lang,chosen=null;
  try{chosen=i18nNormalize(localStorage.getItem(I18N_STORAGE_KEY));}catch(e){}
  if(acc&&(!chosen||chosen===acc))return;
  setTimeout(function(){if(authUser&&authUser.id===user.id)saveLangToAccount(chosen||LANG);},0);
}
/* Après un changement de langue (rechargement de la page) : rouvre l'écran d'où il a été fait */
function reopenAfterLangChange(){
  var r=null;
  try{r=JSON.parse(sessionStorage.getItem('wl_reopen')||'null');sessionStorage.removeItem('wl_reopen');}catch(e){}
  if(!r)return;
  if(r==='settings'){
    var menu=document.getElementById('optMenu');
    if(menu&&!menu.classList.contains('on'))menu.classList.add('on');
    openSettingsView();
  }else if(r.auth&&AUTH_VIEWS[r.auth]){
    openAuthModal(authUser&&(r.auth==='login'||r.auth==='signup')?'account':r.auth);
  }
}

/* ---------- Export RGPD : compte + liste synchronisée + copie locale ---------- */
function exportAccountData(btn){
  if(!supa||!authUser){toast(t('export.loginFirst'),'err');return;}
  if(btn)btn.disabled=true;
  var out={app:BRAND.name,exportedAt:new Date().toISOString(),format:'watchlist-export-compte/1'};
  supa.auth.getUser().then(function(r){
    var u=(r&&r.data&&r.data.user)||authUser;
    out.account={id:u.id,email:u.email,created_at:u.created_at,email_confirmed_at:u.email_confirmed_at||u.confirmed_at||null,last_sign_in_at:u.last_sign_in_at||null};
    return supa.from('profiles').select('id,name,avatar,avatar_color,created_at,updated_at,plex_webhook_token').eq('account_id',u.id);
  }).then(function(r){
    if(r.error)throw r.error;
    out.profiles=(r.data||[]).map(function(p){var o=Object.assign({},p);o.has_tracking_token=!!o.plex_webhook_token;delete o.plex_webhook_token;return o;});
    var ids=out.profiles.map(function(p){return p.id;});
    if(!ids.length)return [];
    var rows=[],page=0,size=1000;
    function next(){
      return supa.from('watchlist_items').select('*').in('profile_id',ids).order('added_at',{ascending:true}).range(page*size,page*size+size-1).then(function(r2){
        if(r2.error)throw r2.error;rows=rows.concat(r2.data||[]);
        if((r2.data||[]).length===size&&page<50){page++;return next();}
        return rows;
      });
    }
    return next();
  }).then(function(rows){
    out.watchlist_items=rows;
    /* Titres détectés par l'extension (onglet « Détectés »), tous états confondus ; RLS : ceux du compte */
    var det=[],dp=0,dsize=1000;
    function nextDet(){
      return supa.from('detected_media').select('id,source,raw_title,normalized_title,media_type,season,episode,watched_at,progress_pct,state,created_at,updated_at')
        .order('id',{ascending:true}).range(dp*dsize,dp*dsize+dsize-1).then(function(r3){
          if(r3.error)throw r3.error;det=det.concat(r3.data||[]);
          if((r3.data||[]).length===dsize&&dp<30){dp++;return nextDet();}
          return det;
        });
    }
    return nextDet().then(function(d){out.detected_media=d;return rows;});
  }).then(function(rows){
    out.local_device_copy={count:memDB.length,entries:memDB};
    var blob=new Blob([JSON.stringify(out,null,2)],{type:'application/json'});
    var a=document.createElement('a'),d=new Date();
    a.href=URL.createObjectURL(blob);
    a.download=String(BRAND.shortName||'watchlist').toLowerCase().replace(/[^a-z0-9]+/g,'-')+'-'+t('export.fileSuffix')+'-'+d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'.json';
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(function(){URL.revokeObjectURL(a.href);},1000);
    if(btn)btn.disabled=false;
    toast(tn('export.account',rows.length),'ok');
  }).catch(function(e){
    if(btn)btn.disabled=false;_logErr('[export]',e);toast(t('export.failed'),'err');
  });
}

/* ---------- Données locales de l'appareil ---------- */
var LOCAL_OWNER_KEY='wl_local_owner';
/* Efface la liste de cet appareil (IndexedDB + mémoire + marqueurs de synchro) */
function clearLocalData(){
  memDB=[];
  if(idb){try{idb.transaction('entries','readwrite').objectStore('entries').clear();}catch(e){}}
  try{
    Object.keys(localStorage).forEach(function(k){if(k===LOCAL_OWNER_KEY||k.indexOf('wl_legacy_dirty_')===0)localStorage.removeItem(k);});
  }catch(e){}
}
/* Garde la liste locale mais la détache du compte (elle pourra rejoindre un autre compte) */
function detachLocalData(){
  memDB.forEach(function(item){delete item.supaId;item.needsSync=true;item.updatedAtLocal=Date.now();dbPut(item,null);});
  try{
    Object.keys(localStorage).forEach(function(k){if(k===LOCAL_OWNER_KEY||k.indexOf('wl_legacy_dirty_')===0)localStorage.removeItem(k);});
  }catch(e){}
}
/*
 * Appelée à chaque connexion. La liste locale appartient au dernier compte connecté sur cet
 * appareil (wl_local_owner). Si c'est un autre compte, sa liste locale est remplacée par celle
 * du compte qui se connecte (sinon les titres de l'un partiraient dans le compte de l'autre).
 * Sans propriétaire connu (liste créée hors connexion, ou appareil d'avant cette version),
 * la liste locale est rattachée au compte qui se connecte, comme avant.
 */
function claimLocalDataFor(user){
  var owner=null;try{owner=localStorage.getItem(LOCAL_OWNER_KEY);}catch(e){}
  if(!owner||owner===user.id){try{localStorage.setItem(LOCAL_OWNER_KEY,user.id);}catch(e){}return false;}
  var pending=memDB.filter(function(i){return i.needsSync;}).length;
  if(pending&&memDB.length&&window.confirm(tn('auth.otherAccountPending',pending))){
    try{exportJSON();}catch(e){}
  }
  clearLocalData();
  try{localStorage.setItem(LOCAL_OWNER_KEY,user.id);}catch(e){}
  render();if(typeof updateStatsFooter==='function')updateStatsFooter();
  toast(t('auth.listReplaced'),'nfo');
  return true;
}

/* ---------- Retour depuis un email (voir AUTH_LANDING dans js/01-config.js) ---------- */
function handleAuthLanding(){
  var l=window.AUTH_LANDING;if(!l||!supa)return;
  window.AUTH_LANDING=null;
  if(l.kind==='token_hash'){openAuthModal('verify',{tokenHash:l.tokenHash,type:l.type,action:l.action});return;}
  if(l.kind==='error'){openAuthModal('linkError',{code:l.code,description:l.description,action:l.action||''});return;}
  if(l.kind==='session'){
    /* Ancien format de lien (#access_token=…) : supabase-js ouvre la session tout seul */
    if(l.type==='recovery')openAuthModal('reset',{mode:'recovery'});
    else if(l.type==='invite')openAuthModal('reset',{mode:'invite'});
    else if(l.type==='signup'){toast(t('auth.toast.confirmed'),'ok');}
    else if(l.type==='email_change'){toast(t('auth.toast.emailUpdated'),'ok');}
  }
}
if(supa){
  supa.auth.onAuthStateChange(function(event){
    if(event==='PASSWORD_RECOVERY'&&!(document.getElementById('authMbk').classList.contains('on')&&_authView==='reset'))openAuthModal('reset',{mode:'recovery'});
  });
}
setTimeout(reopenAfterLangChange,0);
/* Sélecteur de langue du pied de page (visible aussi sans compte) */
(function(){var f=document.getElementById('footLang');if(f)f.innerHTML=langSwitcherHtml('lang-switch-foot');})();
