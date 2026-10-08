/* MODULE: « Donner mon avis » — fenêtre d'avis (idée, bug, autre), avec ou sans compte.
   - Ouverte depuis le menu de l'app (menuFeedback) et le pied de la page d'accueil (openFeedback).
   - Envoi à /api/feedback uniquement (même site) : enregistrement en base et email à l'équipe côté
     serveur ; aucune requête vers un tiers depuis le navigateur.
   - Session envoyée si elle existe (avis rattaché au compte), sinon envoi anonyme.
   - Champ piège (#fbWebsite, invisible) et délai minimum : les robots reçoivent « ok » sans effet.
   - Le brouillon reste en mémoire (pas dans le stockage du navigateur) jusqu'à l'envoi réussi.
   - Bouton « retour » du téléphone : la fenêtre est suivie par js/22-modal-history.js (fbMbk).
   Le formulaire est rendu ici (pas dans index.html) : la page d'accueil ne contient aucun <form>. */
var FB_MAX=2000,FB_MIN=3,FB_KINDS=['idea','bug','other'];
var _fb={kind:'idea',message:'',email:'',emailTouched:false,openedAt:0,busy:false,ctx:'app',opener:null};

function _fbMbk(){return document.getElementById('fbMbk');}
function _fbIsOpen(){var m=_fbMbk();return !!(m&&m.classList.contains('on'));}
function _fbCoarse(){try{return window.matchMedia('(pointer: coarse)').matches;}catch(e){return false;}}

function openFeedback(ctx){
  var m=_fbMbk();if(!m)return;
  _fb.ctx=ctx==='landing'?'landing':'app';
  _fb.opener=document.activeElement&&document.activeElement!==document.body?document.activeElement:null;
  /* Compte connecté : adresse proposée pour la réponse (modifiable, effaçable) */
  if(!_fb.emailTouched)_fb.email=(typeof authUser!=='undefined'&&authUser&&authUser.email)||'';
  _fb.openedAt=Date.now();
  if(typeof sfx==='function')sfx('open');
  m.classList.add('on');
  _fbRenderForm();
  var target=_fbCoarse()?document.getElementById('fbTitle'):document.getElementById('fbText');
  if(target)try{target.focus({preventScroll:true});}catch(e){target.focus();}
}
function closeFeedback(){
  var m=_fbMbk();if(!m||!m.classList.contains('on'))return;
  m.classList.remove('on');
  var o=_fb.opener;_fb.opener=null;
  if(o&&document.contains(o)&&o.offsetParent!==null)try{o.focus({preventScroll:true});}catch(e){}
}

function _fbKindBtn(k){
  return '<label class="fb-kind"><input type="radio" name="fbKind" value="'+k+'"'+(_fb.kind===k?' checked':'')+uiAct('fbKind',[k],'change')+'>'+
    '<span>'+esc(t('fb.kind_'+k))+'</span></label>';
}
function _fbRenderForm(){
  var v=document.getElementById('fbView');if(!v)return;
  v.innerHTML='<div class="mtitle auth-title" id="fbTitle" tabindex="-1">'+esc(t('fb.title'))+'</div>'+
    '<p class="auth-p fb-intro">'+esc(t('fb.intro',{name:BRAND.name}))+'</p>'+
    '<div class="auth-msg" id="fbMsg"></div>'+
    '<form novalidate autocomplete="on" id="fbForm">'+
      '<div class="field"><div class="fb-lbl" id="fbKindLbl">'+esc(t('fb.kind'))+'</div>'+
        '<div class="fb-kinds" role="radiogroup" aria-labelledby="fbKindLbl">'+FB_KINDS.map(_fbKindBtn).join('')+'</div></div>'+
      '<div class="field"><label for="fbText">'+esc(t('fb.message'))+'</label>'+
        '<textarea id="fbText" rows="6" maxlength="'+FB_MAX+'" required aria-required="true" aria-describedby="fbCount" placeholder="'+esc(t('fb.ph_'+_fb.kind))+'"'+uiAct('fbInput',[],'input')+'>'+esc(_fb.message)+'</textarea>'+
        '<div class="fb-count" id="fbCount" aria-live="polite"></div></div>'+
      '<div class="field"><label for="fbEmail">'+esc(t('fb.email'))+' <span class="fb-opt">'+esc(t('add.optional'))+'</span></label>'+
        '<input type="email" id="fbEmail" autocomplete="email" inputmode="email" maxlength="254" spellcheck="false" value="'+esc(_fb.email)+'" aria-describedby="fbEmailHint"'+uiAct('fbEmail',[],'input')+'>'+
        '<div class="fb-hint" id="fbEmailHint">'+esc(t('fb.emailHint'))+'</div></div>'+
      '<div class="fb-hp" aria-hidden="true"><label for="fbWebsite">Website</label><input type="text" id="fbWebsite" name="website" tabindex="-1" autocomplete="off"></div>'+
      '<p class="auth-sub fb-privacy">'+t('fb.privacy',{link:'<a href="'+esc(legalUrl('privacy'))+'" target="_blank" rel="noopener">'+esc(t('fb.privacyLink'))+'</a>'})+'</p>'+
      '<button type="submit" class="btn btn-primary auth-submit" id="fbSend">'+esc(t('fb.send'))+'</button>'+
    '</form>';
  document.getElementById('fbForm').addEventListener('submit',function(e){e.preventDefault();submitFeedback();});
  _fbCount();
}
function _fbCount(){
  var ta=document.getElementById('fbText'),c=document.getElementById('fbCount');if(!ta||!c)return;
  var n=ta.value.length;
  c.textContent=t('fb.count',{n:fmtNum(n),max:fmtNum(FB_MAX)});
  c.classList.toggle('warn',n>FB_MAX-100);
}
function fbSetKind(k){
  if(FB_KINDS.indexOf(k)<0)return;
  _fb.kind=k;
  var ta=document.getElementById('fbText');if(ta)ta.placeholder=t('fb.ph_'+k);
}
function fbOnInput(){var ta=document.getElementById('fbText');if(!ta)return;_fb.message=ta.value;_fbCount();_fbMsg('');}
function fbOnEmail(){var i=document.getElementById('fbEmail');if(!i)return;_fb.email=i.value;_fb.emailTouched=true;_fbMsg('');}
function _fbMsg(msg,kind,html){
  var m=document.getElementById('fbMsg');if(!m)return;
  if(html)m.innerHTML=msg;else m.textContent=msg||'';
  m.className='auth-msg'+(msg?' on '+(kind||'err'):'');
  m.setAttribute('role',kind==='ok'?'status':'alert');
}
function _fbBusy(busy){
  _fb.busy=busy;var b=document.getElementById('fbSend');if(!b)return;
  b.disabled=busy;
  b.innerHTML=busy?'<span class="auth-spin" aria-hidden="true"></span>'+esc(t('fb.sending')):esc(t('fb.send'));
}
function _fbPage(){
  var p=String(location.pathname||'/');
  return /^\/[A-Za-z0-9/_.-]{0,99}$/.test(p)?p:'/';
}
function _fbStandalone(){
  try{return window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;}catch(e){return false;}
}
function _fbMailLink(){var e=BRAND.contactEmail;return '<a href="mailto:'+esc(e)+'">'+esc(e)+'</a>';}
function submitFeedback(){
  if(_fb.busy)return;
  var ta=document.getElementById('fbText'),em=document.getElementById('fbEmail'),hp=document.getElementById('fbWebsite');
  var msg=String(ta&&ta.value||'').trim(),email=String(em&&em.value||'').trim();
  if(msg.length<FB_MIN){_fbMsg(t('fb.err.message'));if(ta)ta.focus();return;}
  if(msg.length>FB_MAX){_fbMsg(t('fb.err.tooLong',{max:fmtNum(FB_MAX)}));if(ta)ta.focus();return;}
  if(email&&(email.length>254||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))){_fbMsg(t('fb.err.email'));if(em)em.focus();return;}
  var body={kind:_fb.kind,message:msg,reply_email:email||null,locale:typeof LANG==='string'?LANG:null,
    page:_fbPage(),context:_fb.ctx,standalone:_fbStandalone(),website:hp?hp.value:'',elapsed:Date.now()-_fb.openedAt};
  _fbBusy(true);_fbMsg('');
  var tokP=typeof _getAccessToken==='function'?_getAccessToken():Promise.resolve(null);
  tokP.catch(function(){return null;}).then(function(tok){
    var h={'Content-Type':'application/json'};if(tok)h.Authorization='Bearer '+tok;
    return fetch('/api/feedback',{method:'POST',headers:h,body:JSON.stringify(body),credentials:'omit',cache:'no-store'});
  }).then(function(r){
    if(r.ok)return _fbDone(email);
    return r.json().catch(function(){return {};}).then(function(d){
      var code=d&&d.error;
      if(r.status===429||code==='rate_limited')_fbMsg(t('fb.err.rate'));
      else if(code==='invalid'&&/reply_email/.test(d.message||''))_fbMsg(t('fb.err.email'));
      else if(code==='invalid'||code==='too_large')_fbMsg(t('fb.err.message'));
      else _fbMsg(t('fb.err.network',{email:_fbMailLink()}),'err',true);
    });
  }).catch(function(){
    _fbMsg(t('fb.err.network',{email:_fbMailLink()}),'err',true);
  }).then(function(){_fbBusy(false);});
}
function _fbDone(email){
  _fb.message='';_fb.kind='idea';
  if(typeof sfx==='function')sfx('done');
  var v=document.getElementById('fbView');if(!v)return;
  v.innerHTML='<div class="auth-hero fb-done" role="status">'+
    '<div class="auth-hero-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg></div>'+
    '<div class="mtitle auth-title" id="fbTitle" tabindex="-1">'+esc(t('fb.done.title'))+'</div>'+
    '<p>'+esc(t('fb.done.text'))+'</p>'+
    '<p>'+(email?t('fb.done.reply',{email:'<b>'+esc(email)+'</b>'}):esc(t('fb.done.noReply')))+'</p>'+
    '</div><div class="mact"><button type="button" class="btn btn-primary" style="flex:1" data-click="closeFeedback" id="fbDoneClose">'+esc(t('common.close'))+'</button></div>';
  var b=document.getElementById('fbDoneClose');if(b)try{b.focus({preventScroll:true});}catch(e){}
}
/* Fond, Échap, Tab gardé dans la fenêtre */
(function(){
  var m=_fbMbk();if(!m)return;
  var downOnBackdrop=false;
  m.addEventListener('pointerdown',function(e){downOnBackdrop=(e.target===m);});
  m.addEventListener('click',function(e){var ok=downOnBackdrop&&e.target===m;downOnBackdrop=false;if(ok){if(typeof sfx==='function')sfx('close');closeFeedback();}});
  document.addEventListener('keydown',function(e){
    if(!_fbIsOpen())return;
    if(e.key==='Escape'){e.stopPropagation();closeFeedback();return;}
    if(e.key!=='Tab')return;
    var f=Array.prototype.filter.call(m.querySelectorAll('button,a[href],input,textarea,[tabindex]:not([tabindex="-1"])'),function(el){
      return !el.disabled&&el.tabIndex>=0&&el.offsetParent!==null&&!el.closest('.fb-hp');
    });
    if(!f.length)return;
    var first=f[0],last=f[f.length-1];
    if(e.shiftKey&&(document.activeElement===first||!m.contains(document.activeElement))){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&(document.activeElement===last||!m.contains(document.activeElement))){e.preventDefault();first.focus();}
  },true);
})();
