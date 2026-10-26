/* MODULE: Social (étape 1) : pseudo @handle. Choix du pseudo (onboarding obligatoire pour un nouveau compte,
   fenêtre au premier passage sur Amis pour un compte existant, ligne dans « Mon compte »). Base :
   supabase/migrations/20261026120000_social_pseudo_amis.sql (RPC check_handle, set_handle, get_my_social).
   Tant que la migration n'est pas appliquée, la RPC répond PGRST202 : toute l'interface sociale reste masquée. */
var SOCIAL={ready:false,available:null,me:null,loading:null,listeners:[]};
var HANDLE_RE=/^[a-z0-9._]{3,20}$/;
/* Normalise une saisie : minuscules, sans @, sans accents, caractères interdits retirés */
function handleNormalize(s){
  s=String(s==null?'':s).trim().toLowerCase().replace(/^@+/,'');
  try{s=s.normalize('NFD').replace(/[\u0300-\u036f]/g,'');}catch(_){}
  return s.replace(/[\s-]+/g,'_').replace(/[^a-z0-9._]/g,'').slice(0,20);
}
/* Format valide : 3–20 caractères [a-z0-9._], pas de point au début ni à la fin, pas deux points de suite */
function handleValid(s){return HANDLE_RE.test(s)&&s[0]!=='.'&&s[s.length-1]!=='.'&&s.indexOf('..')<0;}
/* Raison lisible d'un format invalide (clé i18n) ou null */
function handleFormatError(s){
  if(!s)return null;
  if(s.length<3)return 'handle.err.short';
  if(s[0]==='.'||s[s.length-1]==='.'||s.indexOf('..')>=0)return 'handle.err.dot';
  return handleValid(s)?null:'handle.err.chars';
}
/* Proposition de départ : partie locale de l'email, nettoyée */
function handleSuggestFrom(email){
  var s=handleNormalize(String(email||'').split('@')[0]).replace(/^\.+|\.+$/g,'').replace(/\.{2,}/g,'.');
  if(s.length<3)s=(s+'cine').slice(0,20);
  return s;
}
function socialUnavailable(err){return !!(err&&(err.code==='PGRST202'||err.code==='42883'||/Could not find the function/i.test(err.message||'')));}
/* Charge l'état social (pseudo, code, amis, demandes). cb(me|null) */
function socialLoad(force){
  if(typeof supa==='undefined'||!supa||!authProfileId)return Promise.resolve(null);
  if(SOCIAL.loading&&!force)return SOCIAL.loading;
  SOCIAL.loading=supa.rpc('get_my_social',{p_profile_id:authProfileId}).then(function(r){
    SOCIAL.loading=null;
    if(r.error){if(socialUnavailable(r.error))SOCIAL.available=false;return null;}
    SOCIAL.available=true;SOCIAL.me=r.data||null;SOCIAL.ready=true;
    SOCIAL.listeners.forEach(function(fn){try{fn(SOCIAL.me);}catch(_){}});
    return SOCIAL.me;
  },function(){SOCIAL.loading=null;return null;});
  return SOCIAL.loading;
}
function socialOnChange(fn){SOCIAL.listeners.push(fn);}

/* Fenêtre générique du module social (même langage que le partage : verre, ressort, feuille en bas sur téléphone) */
function socModal(html,opts){
  opts=opts||{};socClose(true);
  var m=document.createElement('div');m.className='soc-mbk';m.id='socMbk';
  m.innerHTML='<div class="soc-wrap'+(opts.cls?' '+opts.cls:'')+'" role="dialog" aria-modal="true"'+(opts.label?' aria-label="'+esc(opts.label)+'"':'')+'>'+
    (opts.locked?'':'<button type="button" class="soc-x" aria-label="'+esc(t('common.close'))+'"'+uiAct('socClose')+'>×</button>')+html+'</div>';
  if(!opts.locked)m.addEventListener('click',function(e){if(e.target===m)socClose();});
  document.body.appendChild(m);requestAnimationFrame(function(){m.classList.add('on');});
  SOCIAL.locked=!!opts.locked;
  var f=m.querySelector('[autofocus],input,button:not(.soc-x)');if(f)setTimeout(function(){try{f.focus();}catch(_){}},60);
  return m;
}
function socClose(force){
  var m=document.getElementById('socMbk');if(!m)return;
  if(SOCIAL.locked&&!force)return;
  SOCIAL.locked=false;m.id='';m.classList.remove('on');m.classList.add('off');
  setTimeout(function(){m.remove();},260);
}
document.addEventListener('keydown',function(e){if(e.key==='Escape')socClose();});

/* ---- Fenêtre « Choisis ton pseudo » ---- */
var HANDLE_UI={timer:0,seq:0,value:'',state:'',done:null,mode:'edit'};
function handleSheetHtml(initial,mode){
  var me=SOCIAL.me||{};
  var soon=me.next_handle_change_at&&Date.parse(me.next_handle_change_at)>Date.now();
  return '<div class="hd-head"><div class="hd-at" aria-hidden="true">@</div><h2>'+esc(t('handle.title'))+'</h2>'+
    '<p class="soc-sub">'+esc(t(mode==='onboarding'?'handle.subNew':mode==='first'?'handle.subExisting':'handle.sub'))+'</p></div>'+
    '<label class="hd-field" id="hdField"><span class="hd-pre">@</span>'+
      '<input id="hdInput" type="text" inputmode="text" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="20" value="'+esc(initial)+'" aria-describedby="hdMsg"'+(soon?' disabled':'')+uiAct('handleInput',null,'input')+'>'+
      '<span class="hd-ok" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span><span class="hd-spin" aria-hidden="true"></span></label>'+
    '<p class="hd-msg" id="hdMsg" aria-live="polite">'+(soon?esc(t('handle.tooSoon',{date:new Date(me.next_handle_change_at).toLocaleDateString(typeof LOCALE!=='undefined'?LOCALE:undefined)})):esc(t('handle.rules')))+'</p>'+
    '<div class="hd-sugg" id="hdSugg"></div>'+
    '<button type="button" class="soc-cta" id="hdSave" disabled'+uiAct('handleSave')+'>'+esc(t(mode==='edit'?'handle.save':'handle.continue'))+'</button>'+
    (mode==='edit'?'<p class="soc-note">'+esc(t('handle.note30'))+'</p>':'');
}
function openHandleSheet(mode,done){
  mode=mode||'edit';HANDLE_UI.mode=mode;HANDLE_UI.done=done||null;
  var me=SOCIAL.me||{};
  var init=me.handle||handleSuggestFrom(authUser&&authUser.email);
  socModal(handleSheetHtml(init,mode),{cls:'hd-wrap',locked:mode==='onboarding',label:t('handle.title')});
  handleCheck(init);
}
function _hdSet(state,msg,sugg){
  var f=document.getElementById('hdField'),m=document.getElementById('hdMsg'),b=document.getElementById('hdSave'),s=document.getElementById('hdSugg');
  if(!f)return;HANDLE_UI.state=state;
  f.className='hd-field is-'+state;
  if(state==='taken'){f.classList.remove('shake');void f.offsetWidth;f.classList.add('shake');}
  if(m)m.textContent=msg||'';
  if(b)b.disabled=!(state==='free'||state==='mine');
  if(s)s.innerHTML=(sugg||[]).slice(0,3).map(function(x,i){return '<button type="button" class="hd-pill" style="--i:'+i+'"'+uiAct('handlePick',[x])+'>@'+esc(x)+'</button>';}).join('');
}
/* Réponse de check_handle -> état de l'interface. Le serveur renvoie available | taken | reserved | invalid | not_authenticated.
   Seuls taken/reserved affichent « déjà pris » ; une erreur ou un statut inconnu affiche « impossible de vérifier ». */
function handleCheckView(r,v,myHandle){
  var st=r&&!r.error&&r.data&&r.data.status;
  if(st==='available'||st==='free')return v&&v===myHandle?{state:'mine',key:'handle.mine'}:{state:'free',key:'handle.free'};
  if(st==='mine')return {state:'mine',key:'handle.mine'};
  if(st==='taken')return {state:'taken',key:'handle.taken'};
  if(st==='reserved')return {state:'taken',key:'handle.err.reserved'};
  if(st==='invalid')return {state:'bad',key:handleFormatError(v)||'handle.err.reserved'};
  return {state:'bad',key:'handle.err.check'};
}
function handleCheck(raw){
  var v=handleNormalize(raw),inp=document.getElementById('hdInput');
  if(inp&&inp.value!==v){var pos=inp.selectionStart;inp.value=v;try{inp.setSelectionRange(pos,pos);}catch(_){}}
  HANDLE_UI.value=v;clearTimeout(HANDLE_UI.timer);var seq=++HANDLE_UI.seq;
  var fe=handleFormatError(v);
  if(!v){_hdSet('idle',t('handle.rules'));return;}
  if(fe){_hdSet('bad',t(fe));return;}
  _hdSet('checking',t('handle.checking'));
  HANDLE_UI.timer=setTimeout(function(){
    supa.rpc('check_handle',{p_profile_id:authProfileId,p_handle:v}).then(function(r){
      if(seq!==HANDLE_UI.seq)return;
      var d=r.data||{},view=handleCheckView(r,v,SOCIAL.me&&SOCIAL.me.handle);
      _hdSet(view.state,t(view.key,{handle:v}),view.state==='taken'?d.suggestions:undefined);
    },function(){if(seq===HANDLE_UI.seq)_hdSet('bad',t('handle.err.check'));});
  },320);
}
function handleSave(el){
  var v=HANDLE_UI.value;if(!handleValid(v))return;
  if(HANDLE_UI.state==='mine'){_handleDone();return;}
  el.disabled=true;el.classList.add('busy');
  supa.rpc('set_handle',{p_profile_id:authProfileId,p_handle:v}).then(function(r){
    el.classList.remove('busy');
    var st=r.data&&r.data.status;
    if(!r.error&&st==='ok'){if(typeof sfx==='function')sfx('done');socialLoad(true).then(_handleDone);return;}
    el.disabled=false;
    if(st==='too_soon')_hdSet('bad',t('handle.tooSoon',{date:new Date(r.data.next_change_at).toLocaleDateString(typeof LOCALE!=='undefined'?LOCALE:undefined)}));
    else if(st==='taken')_hdSet('taken',t('handle.taken'),r.data.suggestions);
    else if(st==='reserved')_hdSet('taken',t('handle.err.reserved'));
    else _hdSet('bad',t('handle.err.check'));
  });
}
function _handleDone(){
  var cb=HANDLE_UI.done;HANDLE_UI.done=null;socClose(true);
  if(HANDLE_UI.mode==='edit')toast(t('handle.saved',{handle:(SOCIAL.me&&SOCIAL.me.handle)||HANDLE_UI.value}));
  if(cb)cb();
}

/* Onboarding : pseudo obligatoire avant la fenêtre d'accueil (js/28-pairing.js), si la migration est en place */
function handleOnboardFirst(next){
  socialLoad().then(function(me){
    if(!SOCIAL.available||!me||me.handle){next();return;}
    openHandleSheet('onboarding',next);
  });
}
/* Compte existant sans pseudo : demandé au premier passage sur Amis (js/33-friends.js) */
function ensureHandle(next){
  if(SOCIAL.me&&SOCIAL.me.handle){next();return;}
  openHandleSheet('first',next);
}
/* Ligne « Pseudo » dans Mon compte (js/20-account.js) */
function handleAccountRow(){
  if(!SOCIAL.available)return '';
  var h=SOCIAL.me&&SOCIAL.me.handle;
  return _accBtn('openHandle',esc(h?t('handle.row',{handle:h}):t('handle.rowNone')),'<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>');
}
if(typeof module!=='undefined')module.exports={handleNormalize:handleNormalize,handleValid:handleValid,handleFormatError:handleFormatError,handleSuggestFrom:handleSuggestFrom,socialUnavailable:socialUnavailable,handleCheckView:handleCheckView};
socialOnChange(function(){if(typeof refreshAuthModalView==='function')try{refreshAuthModalView();}catch(_){}});
