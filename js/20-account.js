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
        sitekey:cfg.turnstileSiteKey,theme:'dark',language:'fr',size:'flexible',appearance:'interaction-only',
        action:'auth',
        callback:function(t){_ts.token=t;_ts.failed=false;_captchaFlush(null,t);},
        'expired-callback':function(){_ts.token=null;},
        'error-callback':function(){_ts.token=null;_ts.failed=true;_captchaFlush(new Error('captcha_failed'));}
      });
    });
  }).catch(function(){
    _ts.failed=true;_captchaFlush(new Error('captcha_unavailable'));
    showAuthMsg('Impossible de charger la vérification anti-robot (bloqueur de contenu ?). Désactive-le pour ce site puis recharge la page.','err');
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
      var t=setTimeout(function(){if(done)return;done=true;var e=new Error('captcha_timeout');e.code='captcha_timeout';reject(e);},20000);
      _ts.waiters.push(function(err,tok){if(done)return;done=true;clearTimeout(t);if(err){err.code='captcha_failed';reject(err);}else resolve(tok);});
    });
  });
}
/* Un jeton Turnstile ne sert qu'une fois : on en redemande un après chaque envoi */
function captchaReset(){
  _ts.token=null;_ts.failed=false;
  if(window.turnstile&&_ts.widgetId!=null){try{window.turnstile.reset(_ts.widgetId);}catch(e){}}
}

/* ---------- Messages d'erreur en français ---------- */
var AUTH_ERRORS={
  invalid_credentials:'Email ou mot de passe incorrect.',
  email_not_confirmed:'Ton adresse email n\'est pas encore confirmée. Clique sur le lien reçu par email, ou demande un nouvel envoi.',
  user_already_exists:'Un compte existe déjà avec cette adresse. Connecte-toi ou réinitialise ton mot de passe.',
  email_exists:'Un compte existe déjà avec cette adresse.',
  signup_disabled:'Les inscriptions sont fermées pour le moment.',
  email_provider_disabled:'Les inscriptions sont fermées pour le moment.',
  over_email_send_rate_limit:'Trop d\'emails envoyés à cette adresse. Patiente quelques minutes avant de réessayer.',
  over_request_rate_limit:'Trop de tentatives. Patiente quelques minutes avant de réessayer.',
  captcha_failed:'La vérification anti-robot a échoué. Réessaie.',
  captcha_timeout:'La vérification anti-robot prend trop de temps. Réessaie ou recharge la page.',
  otp_expired:'Ce lien ou ce code a expiré ou a déjà été utilisé. Demandes-en un nouveau.',
  email_address_invalid:'Cette adresse email n\'est pas acceptée. Utilise une autre adresse.',
  email_address_not_authorized:'L\'envoi d\'emails vers cette adresse n\'est pas encore configuré. Réessaie plus tard.',
  same_password:'Le nouveau mot de passe doit être différent de l\'actuel.',
  reauthentication_needed:'Pour ta sécurité, confirme avec le code envoyé par email.',
  reauthentication_not_valid:'Code de vérification incorrect ou expiré.',
  session_not_found:'Ta session a expiré. Reconnecte-toi.',
  session_expired:'Ta session a expiré. Reconnecte-toi.',
  refresh_token_not_found:'Ta session a expiré. Reconnecte-toi.',
  user_banned:'Ce compte est suspendu.',
  user_not_found:'Aucun compte n\'est associé à cette adresse.',
  otp_disabled:'Aucun compte n\'est associé à cette adresse.',
  validation_failed:'Vérifie l\'adresse email saisie.',
  invite_not_found:'Cette invitation a expiré ou a déjà été utilisée.',
  conflict:'Opération déjà en cours, réessaie dans un instant.'
};
function authErrorMessage(e){
  if(!e)return 'Une erreur est survenue. Réessaie dans un instant.';
  var code=e.code||e.error_code||'',msg=String(e.message||'');
  if(code==='weak_password'||e.name==='AuthWeakPasswordError'){
    var rs=e.reasons||[];
    if(rs.indexOf('pwned')>=0)return 'Ce mot de passe figure dans des fuites de données connues. Choisis-en un autre.';
    if(rs.indexOf('length')>=0)return 'Mot de passe trop court : '+AUTH_PW_MIN+' caractères minimum.';
    if(rs.indexOf('characters')>=0)return 'Mot de passe trop simple : mélange minuscules, majuscules, chiffres et symboles.';
    return 'Mot de passe trop faible. Choisis-en un plus long et plus varié.';
  }
  if(AUTH_ERRORS[code])return AUTH_ERRORS[code];
  if(/captcha/i.test(msg))return AUTH_ERRORS.captcha_failed;
  if(/signups? not allowed for otp/i.test(msg))return AUTH_ERRORS.user_not_found;
  if(/expired|invalid.*(token|otp)|token.*invalid/i.test(msg))return AUTH_ERRORS.otp_expired;
  if(e.status===429)return AUTH_ERRORS.over_request_rate_limit;
  if(e.name==='AuthRetryableFetchError'||/fetch|network|load failed/i.test(msg))return 'Connexion au serveur impossible. Vérifie ta connexion internet.';
  return 'Une erreur est survenue. Réessaie dans un instant.';
}

/* ---------- Validation ---------- */
function _validEmail(s){return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)&&s.length<=254;}
function _utf8Len(s){try{return new TextEncoder().encode(s).length;}catch(e){return s.length;}}
var AUTH_WEAK_PW=['motdepasse','password','azerty','qwerty','123456','abcdef','watchlist','cinepisode',String(BRAND.name).toLowerCase().replace(/[^a-z0-9]/g,''),'netflix','soleil','bonjour'];
/* Renvoie un message d'erreur, ou '' si le mot de passe est acceptable */
function passwordProblem(pw,email){
  if(!pw||pw.length<AUTH_PW_MIN)return 'Le mot de passe doit faire au moins '+AUTH_PW_MIN+' caractères.';
  if(_utf8Len(pw)>AUTH_PW_MAX_BYTES)return 'Le mot de passe est trop long ('+AUTH_PW_MAX_BYTES+' caractères maximum).';
  if(/^(.)\1+$/.test(pw))return 'Le mot de passe ne peut pas être un seul caractère répété.';
  var low=pw.toLowerCase(),local=String(email||'').split('@')[0].toLowerCase();
  if(local.length>=4&&low.indexOf(local)>=0)return 'Le mot de passe ne doit pas contenir ton adresse email.';
  for(var i=0;i<AUTH_WEAK_PW.length;i++){if(low.replace(/[^a-z0-9]/g,'')===AUTH_WEAK_PW[i]||low.replace(/[^a-z0-9]/g,'').replace(/(.+)\1+/,'$1')===AUTH_WEAK_PW[i])return 'Ce mot de passe est trop courant.';}
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
var PW_LABELS=['Trop court','Faible','Correct','Solide','Excellent'];

/* ---------- Utilitaires d'interface ---------- */
function _authRedirect(){return location.origin+'/';}
function showAuthMsg(msg,kind){
  var m=document.getElementById('authMsg');if(!m)return;
  m.textContent=msg||'';m.className='auth-msg'+(msg?' on '+(kind||'err'):'');
  m.setAttribute('role',kind==='ok'?'status':'alert');
}
function _authBusyBtn(btn,busy,label){
  _authBusy=busy;if(!btn)return;btn.disabled=busy;
  if(busy){btn.dataset.label=btn.textContent;btn.innerHTML='<span class="auth-spin" aria-hidden="true"></span>'+esc(label||'Patiente…');}
  else if(btn.dataset.label){btn.textContent=btn.dataset.label;}
}
function _val(id){var el=document.getElementById(id);return el?String(el.value||''):'';}
function _pwField(id,label,autocomplete,withMeter){
  return '<div class="field"><label for="'+id+'">'+label+'</label><div class="pw-wrap">'+
    '<input type="password" id="'+id+'" autocomplete="'+autocomplete+'" maxlength="128" '+(withMeter?'aria-describedby="'+id+'Meter" ':'')+'spellcheck="false">'+
    '<button type="button" class="pw-eye" onclick="togglePwVisibility(\''+id+'\',this)" aria-label="Afficher le mot de passe">'+
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button></div>'+
    (withMeter?'<div class="pw-meter" id="'+id+'Meter"><div class="pw-meter-bar"><span></span></div><div class="pw-meter-lbl">'+AUTH_PW_MIN+' caractères minimum</div></div>':'')+
    '</div>';
}
function togglePwVisibility(id,btn){
  var el=document.getElementById(id);if(!el)return;
  var show=el.type==='password';el.type=show?'text':'password';
  btn.setAttribute('aria-label',show?'Masquer le mot de passe':'Afficher le mot de passe');
  btn.classList.toggle('on',show);
}
function _bindPwMeter(id){
  var el=document.getElementById(id),m=document.getElementById(id+'Meter');if(!el||!m)return;
  el.addEventListener('input',function(){
    var s=el.value?passwordScore(el.value):0;
    m.className='pw-meter s'+s+(el.value?' on':'');
    m.querySelector('.pw-meter-lbl').textContent=el.value?(PW_LABELS[s]+(el.value.length<AUTH_PW_MIN?' · encore '+(AUTH_PW_MIN-el.value.length)+' caractère'+(AUTH_PW_MIN-el.value.length>1?'s':''):'')):AUTH_PW_MIN+' caractères minimum';
  });
}
function _codeField(){
  return '<div class="field"><label for="authCode">Code reçu par email</label>'+
    '<input type="text" id="authCode" class="auth-code-input" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="123456" pattern="[0-9]*"></div>';
}
function _link(view,label){return '<button type="button" class="auth-link" onclick="authGo(\''+view+'\')">'+label+'</button>';}
function _legalLinks(){
  return '<a href="'+BRAND.legal.terms+'" target="_blank" rel="noopener">conditions d\'utilisation</a> et la <a href="'+BRAND.legal.privacy+'" target="_blank" rel="noopener">politique de confidentialité</a>';
}
function _maskEmail(e){return esc(e||'');}

/* ---------- Ouverture / navigation ---------- */
function openAuthModal(view,ctx){
  if(typeof sfx==='function')sfx('click');
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
  _authView=view;if(ctx)_authCtx=Object.assign({},_authCtx,ctx);
  var v=AUTH_VIEWS[view]||AUTH_VIEWS.login;
  var root=document.getElementById('authView');if(!root)return;
  root.innerHTML='<div class="mtitle auth-title" id="authViewTitle">'+v.title(_authCtx)+'</div><div class="auth-msg" id="authMsg"></div>'+v.html(_authCtx);
  var tabs=root.querySelector('.auth-tabs');if(tabs)tabs.after(document.getElementById('authMsg'));
  var form=root.querySelector('form');
  if(form)form.addEventListener('submit',function(e){e.preventDefault();if(!_authBusy&&v.submit)v.submit(form.querySelector('[type=submit]'));});
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
document.getElementById('authMbk').addEventListener('click',function(e){if(e.target===this){if(typeof sfx==='function')sfx('close');closeAuthModal();}});
document.addEventListener('keydown',function(e){if(e.key==='Escape'&&document.getElementById('authMbk').classList.contains('on'))closeAuthModal();});

/* ---------- Vues ---------- */
var CAPTCHA_SLOT='<div class="auth-captcha" style="display:none"></div>';
var AUTH_VIEWS={
  login:{
    title:function(){return 'Connexion';},
    html:function(c){
      return '<div class="auth-tabs" role="tablist"><button type="button" class="auth-tab on" role="tab" aria-selected="true">Connexion</button>'+
        '<button type="button" class="auth-tab" role="tab" aria-selected="false" id="authTabSignup" onclick="authGo(\'signup\')">Créer un compte</button></div>'+
        '<form novalidate autocomplete="on">'+
        '<div class="field"><label for="authEmail">Email</label><input type="email" id="authEmail" autocomplete="username" placeholder="toi@exemple.com" value="'+esc(c.email||'')+'" maxlength="254"></div>'+
        _pwField('authPassword','Mot de passe','current-password',false)+
        '<div class="auth-row-right">'+_link('forgot','Mot de passe oublié&nbsp;?')+'</div>'+CAPTCHA_SLOT+
        '<button type="submit" class="btn btn-primary auth-submit">Se connecter</button></form>'+
        '<div class="auth-alt">'+_link('magic','Recevoir un lien de connexion par email')+' · '+_link('code','J\'ai un code')+'</div>'+
        '<div class="auth-local-note">Sans compte, ta liste reste sur cet appareil et le catalogue (recherche, recommandations) est désactivé.</div>'+
        '<div class="mact"><button type="button" class="btn btn-ghost" style="flex:1" onclick="closeAuthModal()">Continuer sans compte</button></div>';
    },
    after:function(){loadPublicConfig().then(function(cfg){var t=document.getElementById('authTabSignup');if(t&&!cfg.signupsOpen)t.style.display='none';});},
    submit:function(btn){
      var email=_val('authEmail').trim(),pass=_val('authPassword');
      if(!_validEmail(email))return showAuthMsg('Saisis une adresse email valide.');
      if(!pass)return showAuthMsg('Saisis ton mot de passe.');
      _authCtx.email=email;
      _authBusyBtn(btn,true,'Connexion…');
      captchaToken().then(function(captcha){
        return supa.auth.signInWithPassword({email:email,password:pass,options:{captchaToken:captcha}});
      }).then(function(res){
        captchaReset();_authBusyBtn(btn,false);
        if(res.error){
          if(res.error.code==='email_not_confirmed')return authGo('check',{email:email,kind:'signup',notice:AUTH_ERRORS.email_not_confirmed});
          return showAuthMsg(authErrorMessage(res.error));
        }
        toast('Connecté','ok');authGo('account');
      }).catch(function(e){captchaReset();_authBusyBtn(btn,false);showAuthMsg(authErrorMessage(e));});
    }
  },
  signup:{
    title:function(){return 'Créer un compte';},
    html:function(c){
      return '<div class="auth-tabs" role="tablist"><button type="button" class="auth-tab" role="tab" aria-selected="false" onclick="authGo(\'login\')">Connexion</button>'+
        '<button type="button" class="auth-tab on" role="tab" aria-selected="true">Créer un compte</button></div>'+
        '<form novalidate autocomplete="on">'+
        '<div class="field"><label for="authEmail">Email</label><input type="email" id="authEmail" autocomplete="username" placeholder="toi@exemple.com" value="'+esc(c.email||'')+'" maxlength="254"></div>'+
        _pwField('authPassword','Mot de passe','new-password',true)+
        _pwField('authPasswordConfirm','Confirmer le mot de passe','new-password',false)+
        '<label class="auth-check"><input type="checkbox" id="authConsent"><span>J\'accepte les '+_legalLinks()+'.</span></label>'+CAPTCHA_SLOT+
        '<button type="submit" class="btn btn-primary auth-submit">Créer mon compte</button></form>'+
        '<div class="auth-local-note">Gratuit, sans publicité. Ta liste actuelle sur cet appareil sera ajoutée à ton compte.</div>';
    },
    after:function(){_bindPwMeter('authPassword');},
    submit:function(btn){
      var email=_val('authEmail').trim(),pass=_val('authPassword'),conf=_val('authPasswordConfirm');
      if(!_validEmail(email))return showAuthMsg('Saisis une adresse email valide.');
      var pb=passwordProblem(pass,email);if(pb)return showAuthMsg(pb);
      if(pass!==conf)return showAuthMsg('Les deux mots de passe ne correspondent pas.');
      if(!document.getElementById('authConsent').checked)return showAuthMsg('Accepte les conditions d\'utilisation et la politique de confidentialité pour continuer.');
      _authCtx.email=email;
      _authBusyBtn(btn,true,'Création…');
      captchaToken().then(function(captcha){
        return supa.auth.signUp({email:email,password:pass,options:{captchaToken:captcha,emailRedirectTo:_authRedirect()}});
      }).then(function(res){
        captchaReset();_authBusyBtn(btn,false);
        if(res.error)return showAuthMsg(authErrorMessage(res.error));
        if(res.data&&res.data.session){toast('Compte créé, bienvenue !','ok');return authGo('account');}
        _authResendAt=Date.now();
        authGo('check',{email:email,kind:'signup',notice:''});
      }).catch(function(e){captchaReset();_authBusyBtn(btn,false);showAuthMsg(authErrorMessage(e));});
    }
  },
  /* Après inscription (ou connexion d'un compte non confirmé) : lien OU code */
  check:{
    title:function(){return 'Vérifie ta boîte mail';},
    html:function(c){
      return '<div class="auth-hero"><div class="auth-hero-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="4" width="20" height="16" rx="3"/><path d="m3 7 9 6 9-6"/></svg></div>'+
        '<p>Un email de confirmation part vers <b>'+_maskEmail(c.email)+'</b>. Clique sur le lien qu\'il contient pour activer ton compte.</p>'+
        '<p class="auth-sub">Rien reçu après quelques minutes&nbsp;? Regarde dans les spams. Si un compte existe déjà avec cette adresse, '+_link('login','connecte-toi')+' ou '+_link('forgot','réinitialise ton mot de passe')+'.</p></div>'+
        '<form novalidate>'+_codeField()+CAPTCHA_SLOT+'<button type="submit" class="btn btn-primary auth-submit">Valider le code</button></form>'+
        '<div class="auth-alt"><button type="button" class="auth-link" id="authResendBtn" onclick="authResend(this)">Renvoyer l\'email</button></div>'+
        '<div class="mact"><button type="button" class="btn btn-ghost" style="flex:1" onclick="authGo(\'login\')">Retour à la connexion</button></div>';
    },
    after:function(c){if(c.notice)showAuthMsg(c.notice,'nfo');_tickResend();},
    submit:function(btn){_verifyCode(btn,'email',_authCtx.email,function(){toast('Adresse confirmée, bienvenue !','ok');authGo('account');});}
  },
  forgot:{
    title:function(){return 'Mot de passe oublié';},
    html:function(c){
      return '<p class="auth-p">Saisis l\'adresse de ton compte&nbsp;: tu recevras un lien (et un code) pour choisir un nouveau mot de passe.</p>'+
        '<form novalidate><div class="field"><label for="authEmail">Email</label><input type="email" id="authEmail" autocomplete="username" placeholder="toi@exemple.com" value="'+esc(c.email||'')+'" maxlength="254"></div>'+
        CAPTCHA_SLOT+'<button type="submit" class="btn btn-primary auth-submit">Envoyer le lien</button></form>'+
        '<div class="auth-alt">'+_link('code','J\'ai déjà reçu un code')+'</div>'+
        '<div class="mact"><button type="button" class="btn btn-ghost" style="flex:1" onclick="authGo(\'login\')">Retour à la connexion</button></div>';
    },
    submit:function(btn){
      var email=_val('authEmail').trim();
      if(!_validEmail(email))return showAuthMsg('Saisis une adresse email valide.');
      _authCtx.email=email;_authBusyBtn(btn,true,'Envoi…');
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
    title:function(){return 'Email envoyé';},
    html:function(c){
      return '<p class="auth-p">Si un compte existe pour <b>'+_maskEmail(c.email)+'</b>, un email vient de partir avec un lien pour choisir un nouveau mot de passe. Tu peux aussi saisir le code qu\'il contient&nbsp;:</p>'+
        '<form novalidate>'+_codeField()+'<button type="submit" class="btn btn-primary auth-submit">Valider le code</button></form>'+
        '<div class="mact"><button type="button" class="btn btn-ghost" style="flex:1" onclick="authGo(\'login\')">Retour à la connexion</button></div>';
    },
    submit:function(btn){_verifyCode(btn,'recovery',_authCtx.email,function(){authGo('reset',{mode:'recovery'});});}
  },
  magic:{
    title:function(){return 'Lien de connexion';},
    html:function(c){
      return '<p class="auth-p">Reçois un lien (et un code) pour te connecter sans mot de passe. Fonctionne uniquement pour un compte existant.</p>'+
        '<form novalidate><div class="field"><label for="authEmail">Email</label><input type="email" id="authEmail" autocomplete="username" placeholder="toi@exemple.com" value="'+esc(c.email||'')+'" maxlength="254"></div>'+
        CAPTCHA_SLOT+'<button type="submit" class="btn btn-primary auth-submit">Envoyer le lien</button></form>'+
        '<div class="auth-alt">'+_link('code','J\'ai déjà reçu un code')+'</div>'+
        '<div class="mact"><button type="button" class="btn btn-ghost" style="flex:1" onclick="authGo(\'login\')">Retour à la connexion</button></div>';
    },
    submit:function(btn){
      var email=_val('authEmail').trim();
      if(!_validEmail(email))return showAuthMsg('Saisis une adresse email valide.');
      _authCtx.email=email;_authBusyBtn(btn,true,'Envoi…');
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
    title:function(){return 'Vérifie ta boîte mail';},
    html:function(c){
      return '<p class="auth-p">Un lien de connexion part vers <b>'+_maskEmail(c.email)+'</b>. Clique dessus, ou saisis le code qu\'il contient&nbsp;:</p>'+
        '<form novalidate>'+_codeField()+'<button type="submit" class="btn btn-primary auth-submit">Se connecter</button></form>'+
        '<div class="mact"><button type="button" class="btn btn-ghost" style="flex:1" onclick="authGo(\'login\')">Retour à la connexion</button></div>';
    },
    submit:function(btn){_verifyCode(btn,'email',_authCtx.email,function(){toast('Connecté','ok');authGo('account');});}
  },
  /* Code à 6 chiffres reçu par email (inscription, lien de connexion, mot de passe oublié),
     saisi plus tard ou sur un autre appareil que celui de la demande */
  code:{
    title:function(){return 'J\'ai un code';},
    html:function(c){
      return '<p class="auth-p">Saisis ton adresse et le code à 6 chiffres reçu par email (confirmation d\'inscription, lien de connexion ou mot de passe oublié).</p>'+
        '<form novalidate><div class="field"><label for="authEmail">Email</label><input type="email" id="authEmail" autocomplete="username" placeholder="toi@exemple.com" value="'+esc(c.email||'')+'" maxlength="254"></div>'+
        _codeField()+'<button type="submit" class="btn btn-primary auth-submit">Valider le code</button></form>'+
        '<div class="mact"><button type="button" class="btn btn-ghost" style="flex:1" onclick="authGo(\'login\')">Retour à la connexion</button></div>';
    },
    submit:function(btn){
      var email=_val('authEmail').trim(),code=_val('authCode').replace(/\s/g,'');
      if(!_validEmail(email))return showAuthMsg('Saisis une adresse email valide.');
      if(!/^\d{6,10}$/.test(code))return showAuthMsg('Le code fait 6 chiffres (ou plus), sans espace.');
      _authCtx.email=email;_authBusyBtn(btn,true,'Vérification…');
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
    title:function(c){return ({signup:'Confirme ton adresse',recovery:'Nouveau mot de passe',magiclink:'Connexion',invite:'Invitation',email_change:'Changement d\'adresse'})[c.action]||'Confirmation';},
    html:function(c){
      var label=({signup:'Confirmer mon adresse',recovery:'Continuer',magiclink:'Me connecter',invite:'Accepter l\'invitation',email_change:'Confirmer le changement'})[c.action]||'Confirmer';
      var txt=({signup:'Dernière étape&nbsp;: confirme ton adresse email pour activer ton compte.',recovery:'Confirme pour choisir un nouveau mot de passe.',magiclink:'Confirme pour te connecter.',invite:'Accepte l\'invitation, puis choisis ton mot de passe.',email_change:'Confirme le changement d\'adresse email de ton compte.'})[c.action]||'';
      return '<p class="auth-p">'+txt+'</p><form novalidate><button type="submit" class="btn btn-primary auth-submit">'+label+'</button></form>';
    },
    submit:function(btn){
      var c=_authCtx;_authBusyBtn(btn,true,'Vérification…');
      supa.auth.verifyOtp({token_hash:c.tokenHash,type:c.type}).then(function(res){
        _authBusyBtn(btn,false);
        if(res.error){_authCtx.tokenHash=null;return authGo('linkError',{code:res.error.code||'otp_expired',action:c.action});}
        _authCtx.tokenHash=null;
        _afterEmailVerified(c.action,res.data);
      }).catch(function(e){_authBusyBtn(btn,false);showAuthMsg(authErrorMessage(e));});
    }
  },
  linkError:{
    title:function(){return 'Lien invalide';},
    html:function(c){
      var next=c.action==='recovery'?_link('forgot','Demander un nouveau lien'):c.action==='magiclink'?_link('magic','Demander un nouveau lien'):_link('login','Se connecter (un nouvel email te sera proposé)');
      return '<p class="auth-p">'+esc(AUTH_ERRORS[c.code]||c.description||AUTH_ERRORS.otp_expired)+'</p><div class="auth-alt">'+next+'</div>'+
        '<div class="mact"><button type="button" class="btn btn-ghost" style="flex:1" onclick="closeAuthModal()">Fermer</button></div>';
    }
  },
  /* Choix d'un nouveau mot de passe (après « mot de passe oublié » ou invitation) */
  reset:{
    title:function(c){return c.mode==='invite'?'Bienvenue&nbsp;! Choisis ton mot de passe':'Choisis un nouveau mot de passe';},
    html:function(){
      return '<form novalidate autocomplete="on"><input type="email" autocomplete="username" value="'+esc(authUser&&authUser.email||'')+'" hidden readonly>'+
        _pwField('authPassword','Nouveau mot de passe','new-password',true)+_pwField('authPasswordConfirm','Confirmer','new-password',false)+
        '<button type="submit" class="btn btn-primary auth-submit">Enregistrer</button></form>';
    },
    after:function(){_bindPwMeter('authPassword');},
    submit:function(btn){_submitNewPassword(btn,function(){toast('Mot de passe enregistré','ok');authGo('account');});}
  },
  account:{
    title:function(){return 'Mon compte';},
    html:function(){
      if(!authUser)return '<p class="auth-p">Tu n\'es pas connecté.</p><div class="mact"><button type="button" class="btn btn-primary" style="flex:1" onclick="authGo(\'login\')">Se connecter</button></div>';
      var pending=memDB.filter(function(i){return i.needsSync;}).length;
      var online=navigator.onLine;
      return '<div class="auth-account-row"><span class="sync-dot '+(online?'synced':'offline')+'" id="authAccountDot"></span><span class="auth-account-email" id="authAccountEmail">'+esc(authUser.email||'')+'</span></div>'+
        '<div class="auth-sync-info" id="authSyncInfo">'+(pending?(pending+' élément'+(pending>1?'s':'')+' en attente de synchronisation.'):'Tout est synchronisé.')+'</div>'+
        '<div class="auth-menu">'+
        _accBtn('syncNow()','Synchroniser maintenant','<path d="M1 4v6h6"/><path d="M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4-4.64 4.36A9 9 0 0 1 3.51 15"/>')+
        _accBtn("authGo('changePassword')",'Changer mon mot de passe','<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>')+
        _accBtn("authGo('changeEmail')",'Changer d\'adresse email','<rect x="2" y="4" width="20" height="16" rx="3"/><path d="m3 7 9 6 9-6"/>')+
        _accBtn('exportAccountData(this)','Exporter mes données (JSON)','<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>')+
        _accBtn('signOutUser()','Se déconnecter','<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>')+
        '</div>'+
        '<div class="auth-danger"><button type="button" class="auth-link danger" onclick="authGo(\'deleteAccount\')">Supprimer mon compte…</button></div>'+
        '<div class="auth-legal"><a href="'+BRAND.legal.privacy+'" target="_blank" rel="noopener">Confidentialité</a> · <a href="'+BRAND.legal.terms+'" target="_blank" rel="noopener">Conditions</a></div>'+
        '<div class="mact"><button type="button" class="btn btn-ghost" style="flex:1" onclick="closeAuthModal()">Fermer</button></div>';
    }
  },
  changePassword:{
    title:function(){return 'Changer de mot de passe';},
    html:function(c){
      return '<form novalidate autocomplete="on"><input type="email" autocomplete="username" value="'+esc(authUser&&authUser.email||'')+'" hidden readonly>'+
        _pwField('authPassword','Nouveau mot de passe','new-password',true)+_pwField('authPasswordConfirm','Confirmer','new-password',false)+
        (c.needNonce?'<p class="auth-sub">Pour ta sécurité, un code vient d\'être envoyé à '+esc(authUser&&authUser.email||'')+'.</p>'+_codeField():'')+
        '<button type="submit" class="btn btn-primary auth-submit">Enregistrer</button></form>'+
        '<div class="mact"><button type="button" class="btn btn-ghost" style="flex:1" onclick="authGo(\'account\',{needNonce:false})">Annuler</button></div>';
    },
    after:function(){_bindPwMeter('authPassword');},
    submit:function(btn){_submitNewPassword(btn,function(){_authCtx.needNonce=false;toast('Mot de passe modifié','ok');authGo('account');},true);}
  },
  changeEmail:{
    title:function(){return 'Changer d\'adresse email';},
    html:function(){
      return '<p class="auth-p">Adresse actuelle&nbsp;: <b>'+esc(authUser&&authUser.email||'')+'</b>. Un lien de confirmation sera envoyé à la nouvelle adresse (et à l\'ancienne si la double confirmation est activée).</p>'+
        '<form novalidate><div class="field"><label for="authNewEmail">Nouvelle adresse</label><input type="email" id="authNewEmail" autocomplete="email" maxlength="254"></div>'+
        '<button type="submit" class="btn btn-primary auth-submit">Envoyer la confirmation</button></form>'+
        '<div class="auth-alt"><button type="button" class="auth-link" onclick="authGo(\'emailSent\',{newEmail:_val(\'authNewEmail\').trim()})">J\'ai un code</button></div>'+
        '<div class="mact"><button type="button" class="btn btn-ghost" style="flex:1" onclick="authGo(\'account\')">Annuler</button></div>';
    },
    submit:function(btn){
      var email=_val('authNewEmail').trim();
      if(!_validEmail(email))return showAuthMsg('Saisis une adresse email valide.');
      if(authUser&&email.toLowerCase()===String(authUser.email||'').toLowerCase())return showAuthMsg('C\'est déjà ton adresse actuelle.');
      _authBusyBtn(btn,true,'Envoi…');
      supa.auth.updateUser({email:email},{emailRedirectTo:_authRedirect()}).then(function(res){
        _authBusyBtn(btn,false);
        if(res.error)return showAuthMsg(authErrorMessage(res.error));
        authGo('emailSent',{newEmail:email});
      }).catch(function(e){_authBusyBtn(btn,false);showAuthMsg(authErrorMessage(e));});
    }
  },
  emailSent:{
    title:function(){return 'Confirme ta nouvelle adresse';},
    html:function(c){
      var known=_validEmail(c.newEmail||'');
      return (known?'<p class="auth-p">Clique sur le lien envoyé à <b>'+esc(c.newEmail)+'</b> (et à ton adresse actuelle si on te le demande), ou saisis le code reçu&nbsp;:</p>':'<p class="auth-p">Saisis ta nouvelle adresse et le code reçu par email&nbsp;:</p>')+
        '<form novalidate>'+(known?'':'<div class="field"><label for="authNewEmail">Nouvelle adresse</label><input type="email" id="authNewEmail" autocomplete="email" maxlength="254"></div>')+_codeField()+'<button type="submit" class="btn btn-primary auth-submit">Valider le code</button></form>'+
        '<div class="mact"><button type="button" class="btn btn-ghost" style="flex:1" onclick="authGo(\'account\')">Plus tard</button></div>';
    },
    submit:function(btn){
      var c=_authCtx,code=_val('authCode').replace(/\s/g,'');
      if(!_validEmail(c.newEmail||'')){var ne=_val('authNewEmail').trim();if(!_validEmail(ne))return showAuthMsg('Saisis ta nouvelle adresse email.');c.newEmail=ne;}
      if(!/^\d{6,10}$/.test(code))return showAuthMsg('Le code fait 6 chiffres (ou plus), sans espace.');
      _authBusyBtn(btn,true,'Vérification…');
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
    title:function(){return 'Supprimer mon compte';},
    html:function(){
      return '<div class="auth-warn"><b>Action définitive.</b> Seront effacés&nbsp;: ton compte ('+esc(authUser&&authUser.email||'')+'), ta liste synchronisée, ton jeton de suivi automatique et tes compteurs d\'utilisation. Pense à '+
        '<button type="button" class="auth-link" onclick="exportAccountData(this)">exporter tes données</button> avant.</div>'+
        '<form novalidate autocomplete="on"><input type="email" autocomplete="username" value="'+esc(authUser&&authUser.email||'')+'" hidden readonly>'+
        _pwField('authPassword','Mot de passe actuel','current-password',false)+
        '<div class="field"><label for="authDeleteConfirm">Tape SUPPRIMER pour confirmer</label><input type="text" id="authDeleteConfirm" autocomplete="off" autocapitalize="characters" spellcheck="false"></div>'+
        '<label class="auth-check"><input type="checkbox" id="authDeleteLocal" checked><span>Effacer aussi la liste enregistrée sur cet appareil</span></label>'+
        CAPTCHA_SLOT+'<button type="submit" class="btn auth-submit btn-danger" id="authDeleteBtn" disabled>Supprimer définitivement</button></form>'+
        '<div class="mact"><button type="button" class="btn btn-ghost" style="flex:1" onclick="authGo(\'account\')">Annuler</button></div>';
    },
    after:function(){
      var i=document.getElementById('authDeleteConfirm'),b=document.getElementById('authDeleteBtn');
      i.addEventListener('input',function(){b.disabled=i.value.trim().toUpperCase()!=='SUPPRIMER';});
    },
    submit:function(btn){
      if(!authUser)return authGo('login');
      var pass=_val('authPassword'),wipe=document.getElementById('authDeleteLocal').checked;
      if(_val('authDeleteConfirm').trim().toUpperCase()!=='SUPPRIMER')return showAuthMsg('Tape SUPPRIMER pour confirmer.');
      if(!pass)return showAuthMsg('Saisis ton mot de passe actuel.');
      var email=authUser.email;
      _authBusyBtn(btn,true,'Suppression…');
      /* Reconnexion immédiate : la fonction SQL exige une authentification de moins de 15 min */
      captchaToken().then(function(captcha){
        return supa.auth.signInWithPassword({email:email,password:pass,options:{captchaToken:captcha}});
      }).then(function(res){
        captchaReset();
        if(res.error){var e=res.error;if(e.code==='invalid_credentials')e={code:'x',message:'Mot de passe incorrect.'};throw e;}
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
        toast('Compte supprimé. Merci d\'avoir utilisé '+BRAND.name+'.','nfo');
        authGo('login');
      }).catch(function(e){
        captchaReset();_authBusyBtn(btn,false);
        var msg=e&&e.message==='Mot de passe incorrect.'?e.message:(e&&(e.code==='42501'||/reauthentication/i.test(e.message||''))?'Reconnexion trop ancienne : recommence.':authErrorMessage(e));
        showAuthMsg(msg);
      });
    }
  }
};
function _accBtn(onclick,label,svgPath){
  return '<button type="button" class="auth-menu-btn" onclick="'+onclick+'"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">'+svgPath+'</svg><span>'+label+'</span></button>';
}

/* ---------- Actions partagées ---------- */
function _verifyCode(btn,type,email,onOk){
  var code=_val('authCode').replace(/\s/g,'');
  if(!/^\d{6,10}$/.test(code))return showAuthMsg('Le code fait 6 chiffres (ou plus), sans espace.');
  if(!email)return showAuthMsg('Adresse email inconnue : recommence depuis l\'écran de connexion.');
  _authBusyBtn(btn,true,'Vérification…');
  supa.auth.verifyOtp({email:email,token:code,type:type}).then(function(res){
    _authBusyBtn(btn,false);
    if(res.error)return showAuthMsg(authErrorMessage(res.error));
    onOk(res.data);
  }).catch(function(e){_authBusyBtn(btn,false);showAuthMsg(authErrorMessage(e));});
}
function _submitNewPassword(btn,onOk,allowNonce){
  var pass=_val('authPassword'),conf=_val('authPasswordConfirm');
  var pb=passwordProblem(pass,authUser&&authUser.email);if(pb)return showAuthMsg(pb);
  if(pass!==conf)return showAuthMsg('Les deux mots de passe ne correspondent pas.');
  var attrs={password:pass};
  if(allowNonce&&_authCtx.needNonce){
    var code=_val('authCode').replace(/\s/g,'');
    if(!/^\d{6,10}$/.test(code))return showAuthMsg('Saisis le code reçu par email.');
    attrs.nonce=code;
  }
  _authBusyBtn(btn,true,'Enregistrement…');
  supa.auth.updateUser(attrs).then(function(res){
    _authBusyBtn(btn,false);
    if(res.error){
      if(allowNonce&&res.error.code==='reauthentication_needed'){
        return supa.auth.reauthenticate().then(function(r2){
          if(r2&&r2.error)return showAuthMsg(authErrorMessage(r2.error));
          authGo('changePassword',{needNonce:true});
          showAuthMsg('Un code de vérification vient d\'être envoyé par email. Ressaisis ton nouveau mot de passe et le code.','nfo');
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
  if(left>0){b.disabled=true;b.textContent='Renvoyer l\'email ('+left+' s)';setTimeout(_tickResend,1000);}
  else{b.disabled=false;b.textContent='Renvoyer l\'email';}
}
function authResend(btn){
  var email=_authCtx.email;if(!email||_authBusy)return;
  btn.disabled=true;
  captchaToken().then(function(captcha){
    return supa.auth.resend({type:'signup',email:email,options:{captchaToken:captcha,emailRedirectTo:_authRedirect()}});
  }).then(function(res){
    captchaReset();
    if(res.error){btn.disabled=false;return showAuthMsg(authErrorMessage(res.error));}
    _authResendAt=Date.now();_tickResend();showAuthMsg('Email renvoyé.','ok');
  }).catch(function(e){captchaReset();btn.disabled=false;showAuthMsg(authErrorMessage(e));});
}
function _afterEmailVerified(action,data){
  var hasSession=!!(data&&data.session);
  if(action==='recovery')return authGo('reset',{mode:'recovery'});
  if(action==='invite')return authGo('reset',{mode:'invite'});
  if(action==='email_change'){
    if(!hasSession&&!(data&&data.user)){authGo('account');return showAuthMsg('Confirmation enregistrée. Confirme aussi depuis le lien envoyé à ton autre adresse.','nfo');}
    toast('Adresse email mise à jour','ok');return authGo('account');
  }
  if(action==='signup')toast('Adresse confirmée, bienvenue !','ok');else toast('Connecté','ok');
  authGo('account');
}

function signOutUser(){
  if(!supa)return;
  supa.auth.signOut().then(function(res){
    if(res&&res.error)return supa.auth.signOut({scope:'local'});
  }).catch(function(){return supa.auth.signOut({scope:'local'});}).then(function(){
    toast('Déconnecté','nfo');closeAuthModal();
  });
}

/* ---------- Export RGPD : compte + liste synchronisée + copie locale ---------- */
function exportAccountData(btn){
  if(!supa||!authUser){toast('Connecte-toi pour exporter tes données','err');return;}
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
    out.local_device_copy={count:memDB.length,entries:memDB};
    var blob=new Blob([JSON.stringify(out,null,2)],{type:'application/json'});
    var a=document.createElement('a'),d=new Date();
    a.href=URL.createObjectURL(blob);
    a.download=String(BRAND.shortName||'watchlist').toLowerCase().replace(/[^a-z0-9]+/g,'-')+'-mes-donnees-'+d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'.json';
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(function(){URL.revokeObjectURL(a.href);},1000);
    if(btn)btn.disabled=false;
    toast('Export téléchargé ('+rows.length+' titre'+(rows.length>1?'s':'')+' synchronisé'+(rows.length>1?'s':'')+')','ok');
  }).catch(function(e){
    if(btn)btn.disabled=false;_logErr('[export]',e);toast('Export impossible pour le moment','err');
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
  if(pending&&memDB.length&&window.confirm('Cet appareil contient '+pending+' modification'+(pending>1?'s':'')+' non synchronisée'+(pending>1?'s':'')+' d\'un autre compte. Elles vont être retirées de cet appareil.\n\nOK : télécharger d\'abord une sauvegarde JSON.\nAnnuler : continuer sans sauvegarde.')){
    try{exportJSON();}catch(e){}
  }
  clearLocalData();
  try{localStorage.setItem(LOCAL_OWNER_KEY,user.id);}catch(e){}
  render();if(typeof updateStatsFooter==='function')updateStatsFooter();
  toast('Liste de cet appareil remplacée par celle de ton compte','nfo');
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
    else if(l.type==='signup'){toast('Adresse confirmée, bienvenue !','ok');}
    else if(l.type==='email_change'){toast('Adresse email mise à jour','ok');}
  }
}
if(supa){
  supa.auth.onAuthStateChange(function(event){
    if(event==='PASSWORD_RECOVERY'&&!(document.getElementById('authMbk').classList.contains('on')&&_authView==='reset'))openAuthModal('reset',{mode:'recovery'});
  });
}
