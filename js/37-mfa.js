/* MODULE: Double authentification (TOTP, code à 6 chiffres) + codes de secours. Écrans ajoutés
   au modal de compte (#authMbk, js/20-account.js : AUTH_VIEWS, _authCtx, authGo, _accBtn…).

   Enrôlement / vérification / retrait d'un facteur : API native supabase.auth.mfa.* — gratuite,
   active par défaut sur le projet, standard TOTP (RFC 6238) compatible avec n'importe quelle
   appli d'authentification (Google Authenticator, Authy, 1Password, Bitwarden…). Rien de tout ça
   n'est stocké ici : le secret du facteur vit uniquement côté Supabase Auth.

   Les codes de secours (absents de l'offre Supabase) sont gérés par ce module uniquement : générés
   et affichés UNE fois, leur empreinte SHA-256 (jamais le code en clair) est stockée via les RPC
   de supabase/migrations/20261027200000_mfa_recovery_codes.sql. Un code de secours valide ne fait
   pas passer la session en aal2 (ce n'est pas un vrai TOTP) : il débloque juste un nouvel
   enrôlement forcé, dont la vérification — elle — atteint aal2 normalement ; l'ancien facteur
   perdu est alors retiré avec supabase.auth.mfa.unenroll() (qui exige déjà aal2, donc en toute
   sécurité, aucune donnée du schéma auth n'est touchée directement par ce module). */

var MFA_STATE={checked:false,enabled:false,factorId:null,remaining:0};
/* 32 caractères (5 bits/caractère, aucun biais de modulo sur un octet 0-255) sans 0/1/l/o :
   seul risque de confusion restant, « i » tout seul, levé puisque rien d'autre ne lui ressemble. */
var MFA_RECOVERY_ALPHABET='abcdefghijkmnpqrstuvwxyz23456789';

function refreshMfaState(){
  if(!supa||!authUser||!(supa.auth.mfa&&supa.auth.mfa.listFactors))return Promise.resolve(MFA_STATE);
  return supa.auth.mfa.listFactors().then(function(res){
    if(res.error)throw res.error;
    var totp=(res.data.totp||[]).filter(function(f){return f.status==='verified';})[0];
    MFA_STATE.checked=true;MFA_STATE.enabled=!!totp;MFA_STATE.factorId=totp?totp.id:null;
    if(!totp){MFA_STATE.remaining=0;return MFA_STATE;}
    return supa.rpc('mfa_recovery_count').then(function(r){
      MFA_STATE.remaining=(r.data&&r.data.count)||0;return MFA_STATE;
    });
  }).catch(function(){MFA_STATE.checked=true;return MFA_STATE;});
}
/* Après connexion : si un facteur vérifié attend d'être confirmé (aal1 -> aal2 possible), on
   passe par l'écran de vérification au lieu d'entrer directement dans le compte. */
function _authEnterApp(){
  if(!supa||!supa.auth.mfa||!supa.auth.mfa.getAuthenticatorAssuranceLevel){authGo('account');return;}
  supa.auth.mfa.getAuthenticatorAssuranceLevel().then(function(res){
    var d=res&&res.data;
    if(d&&d.nextLevel==='aal2'&&d.nextLevel!==d.currentLevel)authGo('mfaChallenge',{mfaFactorId:null});
    else authGo('account');
  }).catch(function(){authGo('account');});
}
/* Même chose juste après la création du compte (inscription confirmée) : propose la double
   authentification au lieu d'entrer directement (sauf si, cas limite, un facteur est déjà là). */
function _authEnterAppAfterSignup(){
  if(!supa||!supa.auth.mfa||!supa.auth.mfa.getAuthenticatorAssuranceLevel){authGo('mfaOnboardOffer');return;}
  supa.auth.mfa.getAuthenticatorAssuranceLevel().then(function(res){
    var d=res&&res.data;
    if(d&&d.nextLevel==='aal2'&&d.nextLevel!==d.currentLevel)authGo('mfaChallenge',{mfaFactorId:null});
    else authGo('mfaOnboardOffer');
  }).catch(function(){authGo('mfaOnboardOffer');});
}

/* ---------- Codes de secours : génération, empreinte, copie/téléchargement ---------- */
function _mfaRandomCode(){
  var bytes=new Uint8Array(10);crypto.getRandomValues(bytes);
  var out='';for(var i=0;i<10;i++)out+=MFA_RECOVERY_ALPHABET[bytes[i]%32];
  return out;
}
function _mfaFormatCode(raw){return raw.slice(0,5)+'-'+raw.slice(5);}
function _mfaNormalizeCode(input){return String(input||'').toLowerCase().replace(/[^a-z0-9]/g,'');}
function _sha256Hex(str){
  return crypto.subtle.digest('SHA-256',new TextEncoder().encode(str)).then(function(buf){
    return Array.prototype.map.call(new Uint8Array(buf),function(b){return (b<16?'0':'')+b.toString(16);}).join('');
  });
}
function _mfaGenerateAndStoreRecoveryCodes(){
  var raws=[];for(var i=0;i<10;i++)raws.push(_mfaRandomCode());
  return Promise.all(raws.map(_sha256Hex)).then(function(hashes){
    return supa.rpc('mfa_recovery_store',{p_hashes:hashes}).then(function(res){
      if(res.error)throw res.error;
      MFA_STATE.remaining=10;
      return raws.map(_mfaFormatCode);
    });
  });
}
function mfaRegenerateCodes(btn){
  if(btn)btn.disabled=true;
  _mfaGenerateAndStoreRecoveryCodes().then(function(codes){
    if(btn)btn.disabled=false;
    authGo('mfaRecoveryCodes',{codes:codes});
  }).catch(function(e){if(btn)btn.disabled=false;toast(authErrorMessage(e),'err');});
}
function mfaCopyCodes(){
  var codes=(_authCtx.codes||[]).join('\n');
  (navigator.clipboard?navigator.clipboard.writeText(codes):Promise.reject()).then(function(){
    sfx('click');toast(t('common.copied'));
  }).catch(function(){toast(t('common.copyFailed'),'err');});
}
function mfaDownloadCodes(){
  var codes=(_authCtx.codes||[]).join('\n');
  var blob=new Blob([t('mfa.codes.fileHeader',{name:BRAND.name})+'\n\n'+codes+'\n'],{type:'text/plain'});
  var u=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=u;a.download=String(BRAND.shortName||'cinepisode').toLowerCase().replace(/[^a-z0-9]+/g,'-')+'-codes-secours.txt';
  document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(u);},4000);
}
function mfaCopySecret(){
  var el=document.getElementById('mfaSecret');if(!el)return;
  (navigator.clipboard?navigator.clipboard.writeText(el.textContent):Promise.reject()).then(function(){
    sfx('click');toast(t('common.copied'));
  }).catch(function(){toast(t('common.copyFailed'),'err');});
}
function mfaCodesDone(){authGo('account');}

/* Lien de navigation portant un contexte (objet), même principe que _link() dans js/20-account.js
   mais avec des arguments au-delà du simple nom de vue. */
function _mfaEnrollBtn(label,primary){
  var args=['mfaEnroll',{mfaFactorId:null,mfaQr:null,mfaSecret:null,mfaError:null,mfaForced:false,mfaOldFactorIds:[]}];
  return '<button type="button" class="btn '+(primary?'btn-primary':'btn-ghost')+' auth-submit" data-click="authGo" data-args="'+esc(JSON.stringify(args))+'">'+label+'</button>';
}

/* ---------- Entrée dans le menu « Mon compte » (js/20-account.js) ---------- */
function mfaAccountRow(){
  if(!MFA_STATE.checked)refreshMfaState().then(function(){if(_authView==='account')authGo('account');});
  var icon='<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>';
  var badge=MFA_STATE.enabled?'<span class="auth-badge on">'+esc(t('mfa.account.on'))+'</span>':'<span class="auth-badge">'+esc(t('mfa.account.recommended'))+'</span>';
  return '<button type="button" class="auth-menu-btn" data-click="authGo" data-args="[&quot;mfaSettings&quot;]"><span class="auth-menu-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">'+icon+'</svg></span>'+
    '<span class="auth-menu-label">'+esc(t('mfa.account.row'))+'</span>'+badge+'</button>';
}

/* ---------- Vues ajoutées à AUTH_VIEWS (js/20-account.js) ---------- */
Object.assign(AUTH_VIEWS,{
  /* Étape 2 de connexion : code TOTP (aal1 -> aal2), avec échappatoire codes de secours */
  mfaChallenge:{
    title:function(){return esc(t('mfa.challenge.title'));},
    html:function(){
      return '<div class="auth-hero-ic" aria-hidden="true" style="margin-bottom:14px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>'+
        '<p class="auth-p">'+esc(t('mfa.challenge.intro'))+'</p>'+
        '<form novalidate><div class="field"><label for="mfaCode">'+esc(t('mfa.codeLabel'))+'</label>'+
        '<input type="text" id="mfaCode" class="auth-code-input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" pattern="[0-9]*"></div>'+
        '<button type="submit" class="btn btn-primary auth-submit">'+esc(t('common.continue'))+'</button></form>'+
        '<div class="auth-alt">'+_link('mfaRecover',esc(t('mfa.challenge.lost')))+'</div>'+
        '<div class="mact"><button type="button" class="btn btn-ghost" style="flex:1" data-click="signOut">'+esc(t('mfa.challenge.signOutInstead'))+'</button></div>';
    },
    after:function(c){
      if(c.mfaFactorId)return;
      supa.auth.mfa.listFactors().then(function(res){
        var f=((res.data&&res.data.totp)||[]).filter(function(x){return x.status==='verified';})[0];
        if(!f){authGo('account');return;}
        _authCtx.mfaFactorId=f.id;
      });
    },
    submit:function(btn){
      var code=_val('mfaCode').replace(/\s/g,'');
      if(!/^\d{6}$/.test(code))return showAuthMsg(t('mfa.err.codeFormat'));
      var factorId=_authCtx.mfaFactorId;
      if(!factorId)return showAuthMsg(t('mfa.err.noFactor'));
      _authBusyBtn(btn,true,t('auth.busy.verifying'));
      supa.auth.mfa.challenge({factorId:factorId}).then(function(ch){
        if(ch.error)throw ch.error;
        return supa.auth.mfa.verify({factorId:factorId,challengeId:ch.data.id,code:code});
      }).then(function(res){
        _authBusyBtn(btn,false);
        if(res.error)return showAuthMsg(authErrorMessage(res.error));
        toast(t('auth.toast.signedIn'),'ok');authGo('account');
      }).catch(function(e){_authBusyBtn(btn,false);showAuthMsg(authErrorMessage(e));});
    }
  },
  /* Plus accès à l'appli d'authentification : un code de secours, puis reconfiguration forcée */
  mfaRecover:{
    title:function(){return esc(t('mfa.recover.title'));},
    html:function(){
      return '<p class="auth-p">'+esc(t('mfa.recover.intro'))+'</p>'+
        '<form novalidate><div class="field"><label for="mfaRecoveryCode">'+esc(t('mfa.recover.label'))+'</label>'+
        '<input type="text" id="mfaRecoveryCode" class="auth-code-input" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="xxxxx-xxxxx" maxlength="20"></div>'+
        '<button type="submit" class="btn btn-primary auth-submit">'+esc(t('common.continue'))+'</button></form>'+
        '<div class="auth-alt">'+_link('mfaChallenge',esc(t('mfa.recover.back')))+'</div>';
    },
    submit:function(btn){
      var norm=_mfaNormalizeCode(_val('mfaRecoveryCode'));
      if(norm.length<8)return showAuthMsg(t('mfa.err.codeFormat'));
      _authBusyBtn(btn,true,t('auth.busy.verifying'));
      _sha256Hex(norm).then(function(hash){return supa.rpc('mfa_recovery_consume_check',{p_hash:hash});}).then(function(res){
        if(res.error||!res.data||res.data.status!=='ok'){_authBusyBtn(btn,false);return showAuthMsg(t('mfa.err.recoveryInvalid'));}
        return supa.auth.mfa.listFactors().then(function(lf){
          var ids=((lf.data&&lf.data.totp)||[]).map(function(f){return f.id;});
          _authBusyBtn(btn,false);
          toast(t('mfa.toast.recoveryAccepted'),'nfo');
          authGo('mfaEnroll',{mfaFactorId:null,mfaQr:null,mfaSecret:null,mfaError:null,mfaForced:true,mfaOldFactorIds:ids});
        });
      }).catch(function(e){_authBusyBtn(btn,false);showAuthMsg(authErrorMessage(e));});
    }
  },
  /* Enrôlement : QR + secret manuel, puis vérification du premier code */
  mfaEnroll:{
    title:function(){return esc(t('mfa.enroll.title'));},
    html:function(c){
      if(c.mfaError){
        return '<p class="auth-p">'+esc(c.mfaError)+'</p><div class="mact"><button type="button" class="btn btn-ghost" style="flex:1" data-click="authGo" data-args="[&quot;account&quot;]">'+esc(t('common.close'))+'</button></div>';
      }
      if(!c.mfaFactorId){
        return '<p class="auth-p">'+esc(t('common.loading'))+'</p>';
      }
      return '<div class="mfa-qr-wrap"><img class="mfa-qr" alt="" src="'+esc(c.mfaQr||'')+'"></div>'+
        '<p class="auth-sub">'+esc(t('mfa.enroll.scan'))+'</p>'+
        (c.mfaSecret?'<div class="mfa-secret-row"><code id="mfaSecret">'+esc(c.mfaSecret)+'</code><button type="button" class="auth-link" data-click="mfaCopySecret">'+esc(t('common.copy'))+'</button></div>':'')+
        '<form novalidate><div class="field"><label for="mfaCode">'+esc(t('mfa.codeLabel'))+'</label>'+
        '<input type="text" id="mfaCode" class="auth-code-input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" pattern="[0-9]*"></div>'+
        '<button type="submit" class="btn btn-primary auth-submit">'+esc(t('mfa.enroll.activate'))+'</button></form>'+
        (c.mfaForced?'':'<div class="mact"><button type="button" class="btn btn-ghost" style="flex:1" data-click="authGo" data-args="[&quot;account&quot;]">'+esc(t('common.cancel'))+'</button></div>');
    },
    after:function(c){
      if(c.mfaFactorId||c.mfaError)return;
      supa.auth.mfa.enroll({factorType:'totp'}).then(function(res){
        if(res.error){_authCtx.mfaError=authErrorMessage(res.error);authGo('mfaEnroll',_authCtx);return;}
        _authCtx.mfaFactorId=res.data.id;_authCtx.mfaQr=res.data.totp.qr_code;_authCtx.mfaSecret=res.data.totp.secret||'';
        authGo('mfaEnroll',_authCtx);
      });
    },
    submit:function(btn){
      var code=_val('mfaCode').replace(/\s/g,'');
      if(!/^\d{6}$/.test(code))return showAuthMsg(t('mfa.err.codeFormat'));
      var factorId=_authCtx.mfaFactorId;if(!factorId)return;
      _authBusyBtn(btn,true,t('auth.busy.verifying'));
      supa.auth.mfa.challenge({factorId:factorId}).then(function(ch){
        if(ch.error)throw ch.error;
        return supa.auth.mfa.verify({factorId:factorId,challengeId:ch.data.id,code:code});
      }).then(function(res){
        if(res.error)throw res.error;
        return _mfaGenerateAndStoreRecoveryCodes();
      }).then(function(codes){
        var oldIds=_authCtx.mfaOldFactorIds||[];
        return Promise.all(oldIds.map(function(id){return supa.auth.mfa.unenroll({factorId:id}).catch(function(){});})).then(function(){return codes;});
      }).then(function(codes){
        _authBusyBtn(btn,false);
        MFA_STATE.checked=true;MFA_STATE.enabled=true;MFA_STATE.factorId=factorId;MFA_STATE.remaining=10;
        toast(t('mfa.toast.enabled'),'ok');
        authGo('mfaRecoveryCodes',{codes:codes});
      }).catch(function(e){_authBusyBtn(btn,false);showAuthMsg(authErrorMessage(e));});
    }
  },
  /* Codes de secours : affichés UNE fois, à noter avant de continuer */
  mfaRecoveryCodes:{
    title:function(){return esc(t('mfa.codes.title'));},
    html:function(c){
      var codes=c.codes||[];
      return '<p class="auth-p">'+esc(t('mfa.codes.intro'))+'</p>'+
        '<div class="mfa-codes-grid">'+codes.map(function(x){return '<code>'+esc(x)+'</code>';}).join('')+'</div>'+
        '<div class="mfa-codes-actions"><button type="button" class="auth-link" data-click="mfaCopyCodes">'+esc(t('common.copy'))+'</button>'+
        '<button type="button" class="auth-link" data-click="mfaDownloadCodes">'+esc(t('mfa.codes.download'))+'</button></div>'+
        '<label class="auth-check"><input type="checkbox" id="mfaCodesAck"><span>'+esc(t('mfa.codes.ack'))+'</span></label>'+
        '<button type="button" class="btn btn-primary auth-submit" id="mfaCodesContinue" disabled data-click="mfaCodesDone">'+esc(t('common.continue'))+'</button>';
    },
    after:function(){
      var i=document.getElementById('mfaCodesAck'),b=document.getElementById('mfaCodesContinue');
      if(i&&b)i.addEventListener('change',function(){b.disabled=!i.checked;});
    }
  },
  /* Offre à l'inscription, juste après la vérification d'email (facultatif) */
  mfaOnboardOffer:{
    title:function(){return esc(t('mfa.onboard.title'));},
    html:function(){
      return '<div class="auth-hero"><div class="auth-hero-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>'+
        '<p>'+esc(t('mfa.onboard.intro'))+'</p></div>'+
        _mfaEnrollBtn(esc(t('mfa.onboard.cta')),true)+
        '<div class="mact"><button type="button" class="btn btn-ghost" style="flex:1" data-click="authGo" data-args="[&quot;account&quot;]">'+esc(t('common.later'))+'</button></div>';
    }
  },
  /* Réglages : état actuel, régénération des codes, désactivation */
  mfaSettings:{
    title:function(){return esc(t('mfa.settings.title'));},
    html:function(){
      var cancel='<div class="mact"><button type="button" class="btn btn-ghost" style="flex:1" data-click="authGo" data-args="[&quot;account&quot;]">'+esc(t('common.cancel'))+'</button></div>';
      if(!MFA_STATE.checked)return '<p class="auth-p">'+esc(t('common.loading'))+'</p>'+cancel;
      if(!MFA_STATE.enabled){
        return '<p class="auth-p">'+esc(t('mfa.settings.offIntro'))+'</p>'+_mfaEnrollBtn(esc(t('mfa.settings.enable')),true)+cancel;
      }
      return '<p class="auth-p">'+esc(t('mfa.settings.onIntro'))+'</p>'+
        '<div class="mfa-codes-remaining">'+esc(tn('mfa.settings.codesLeft',MFA_STATE.remaining))+'</div>'+
        '<button type="button" class="btn btn-ghost auth-submit" data-click="mfaRegenerateCodes">'+esc(t('mfa.settings.regenerate'))+'</button>'+
        '<div class="auth-danger"><button type="button" class="auth-link danger" data-click="authGo" data-args="[&quot;mfaDisable&quot;]">'+esc(t('mfa.settings.disable'))+'</button></div>'+
        cancel;
    }
  },
  /* Désactivation : mot de passe requis (même idiome que la suppression de compte) */
  mfaDisable:{
    title:function(){return esc(t('mfa.disable.title'));},
    html:function(){
      return '<div class="auth-warn">'+esc(t('mfa.disable.warn'))+'</div>'+
        '<form novalidate autocomplete="on"><input type="email" autocomplete="username" value="'+esc(authUser&&authUser.email||'')+'" hidden readonly>'+
        _pwField('mfaDisablePassword',esc(t('auth.currentPassword')),'current-password',false)+CAPTCHA_SLOT+
        '<button type="submit" class="btn auth-submit btn-danger">'+esc(t('mfa.disable.submit'))+'</button></form>'+
        '<div class="mact"><button type="button" class="btn btn-ghost" style="flex:1" data-click="authGo" data-args="[&quot;mfaSettings&quot;]">'+esc(t('common.cancel'))+'</button></div>';
    },
    submit:function(btn){
      var pass=_val('mfaDisablePassword');
      if(!pass)return showAuthMsg(t('auth.err.currentPassword'));
      var email=authUser.email;
      _authBusyBtn(btn,true,t('auth.busy.saving'));
      captchaToken().then(function(captcha){
        return supa.auth.signInWithPassword({email:email,password:pass,options:{captchaToken:captcha}});
      }).then(function(res){
        captchaReset();
        if(res.error){var e=res.error;if(e.code==='invalid_credentials')e={code:'x',message:'wrong_password'};throw e;}
        return supa.auth.mfa.listFactors();
      }).then(function(lf){
        var ids=((lf.data&&lf.data.totp)||[]).map(function(f){return f.id;});
        return Promise.all(ids.map(function(id){return supa.auth.mfa.unenroll({factorId:id});}));
      }).then(function(){
        return supa.rpc('mfa_recovery_clear');
      }).then(function(){
        _authBusyBtn(btn,false);
        MFA_STATE={checked:true,enabled:false,factorId:null,remaining:0};
        toast(t('mfa.toast.disabled'),'nfo');
        authGo('account');
      }).catch(function(e){
        captchaReset();_authBusyBtn(btn,false);
        var msg=e&&e.message==='wrong_password'?t('auth.err.wrongPassword'):authErrorMessage(e);
        showAuthMsg(msg);
      });
    }
  }
});
