/* MODULE: Appairage site -> extension (extension 0.8.0) et fenêtre d'accueil après inscription.
   - Page d'appairage (/?pair=1) : ouverte par l'extension (bouton « Se connecter avec
     Cinepisode ») avec ?ext=<identifiant de l'extension>&v=<version>. L'utilisateur connecté clique
     sur « Autoriser cet appareil » : pair_extension_device() (Supabase, session de l'utilisateur)
     crée un jeton propre à cet appareil (seule son empreinte SHA-256 est gardée en base) et le site
     le remet aussitôt à l'extension par chrome.runtime.sendMessage (externally_connectable limité à
     le domaine du site dans le manifeste ; l'extension revérifie l'origine). Le jeton ne passe
     jamais par une URL, le presse-papier, /api ou le stockage du site.
   - Identifiant d'extension : ceux de OFFICIAL_EXT_IDS sont reconnus ; un autre (extension chargée
     en mode développeur) demande une confirmation explicite, pour qu'une extension tierce ne puisse
     pas obtenir un jeton à l'insu de l'utilisateur.
   - renderDevicesPanel(container) : liste « Appareils connectés » + retrait (revoke_extension_device),
     composant autonome. Affiché sur la page d'appairage ; à intégrer dans Réglages par la refonte en cours.
   - maybeShowOnboarding(user) : fenêtre d'accueil (3 étapes) une seule fois, juste après la
     création du compte (appelée par js/15-sync.js). Aucun traceur, aucune requête vers un tiers. */
var OFFICIAL_EXT_IDS=['hmoafofdaajkenkodmgbdjejbmkdjicc'];/* identifiant Chrome Web Store (publiée le 16/10/2026) ; une version chargée en mode développeur reste acceptée après confirmation */
var EXT_STORE_URL='https://chromewebstore.google.com/detail/hmoafofdaajkenkodmgbdjejbmkdjicc';
var PAIR_TOKEN_RE=/^cpd_[0-9a-f]{64}$/,EXT_ID_RE=/^[a-p]{32}$/;
var _pair={ext:null,v:null,state:'idle',err:'',ack:false,devices:null};

function _pairEl(){return document.getElementById('pairPage');}
function _pairDeviceLabel(){
  var ua=navigator.userAgent||'',b='Chrome',o='';
  if(/Edg\//.test(ua))b='Edge';else if(/OPR\//.test(ua))b='Opera';else if(/Brave/.test(ua))b='Brave';
  if(/Windows/.test(ua))o='Windows';else if(/Mac OS X/.test(ua))o='macOS';else if(/CrOS/.test(ua))o='ChromeOS';else if(/Android/.test(ua))o='Android';else if(/Linux/.test(ua))o='Linux';
  return {browser:b,os:o,label:o?b+' · '+o:b};
}
function _extSend(id,msg){
  return new Promise(function(resolve){
    try{
      if(!(window.chrome&&chrome.runtime&&chrome.runtime.sendMessage))return resolve(null);
      chrome.runtime.sendMessage(id,msg,function(r){void(chrome.runtime.lastError);resolve(r||null);});
    }catch(e){resolve(null);}
  });
}
function _pairIcon(n){
  var I={
    link:'<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    laptop:'<rect x="4" y="5" width="16" height="11" rx="2"/><path d="M2 19h20"/>',
    puzzle:'<path d="M9 4h6v3a2 2 0 1 0 4 0V4h1v16H4V4h1v3a2 2 0 1 0 4 0z"/>',
    check:'<path d="m5 12.5 4.5 4.5L19 7.5"/>',lock:'<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    warn:'<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>'};
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+I[n]+'</svg>';
}

/* ---------- Page /pair ---------- */
function initPairPage(){
  var q=new URLSearchParams(location.search);
  if(q.get('pair')!=='1')return;
  var ext=q.get('ext')||'',v=q.get('v')||'';
  _pair.ext=EXT_ID_RE.test(ext)?ext:null;
  _pair.v=/^[0-9]+(\.[0-9]+){1,3}$/.test(v)?v:null;
  document.documentElement.classList.add('pair-open');
  var el=document.createElement('div');el.id='pairPage';el.className='pair-page';el.setAttribute('role','main');
  document.body.appendChild(el);
  _pairRender();
  /* La session arrive après le chargement (js/15-sync.js) : on rafraîchit jusqu'au profil prêt */
  var tries=0,iv=setInterval(function(){
    tries++;
    if((_pair.state==='idle'||_pair.state==='login')&&_pairMode()!==_pair.mode)_pairRender();
    if((typeof authProfileId!=='undefined'&&authProfileId)||tries>200)clearInterval(iv);
  },300);
}
function _pairCard(inner){return '<div class="pair-card glass-pop">'+inner+'</div>';}
function _pairLinkVisual(ok){
  return '<div class="pair-link'+(ok?' ok':'')+'"><div class="pair-app"><img src="icons/icon-192.png" alt=""></div>'+
    '<div class="pair-dots" aria-hidden="true"><i></i><i></i><i></i></div><div class="pair-app pair-ext">'+_pairIcon('puzzle')+'</div></div>';
}
function _pairMode(){
  var logged=typeof authUser!=='undefined'&&authUser;
  return logged?((typeof authProfileId!=='undefined'&&authProfileId)?'ready':'wait'):'login';
}
function _pairRender(){
  var el=_pairEl();if(!el)return;
  _pair.mode=_pairMode();
  var d=_pairDeviceLabel(),html='';
  var logged=typeof authUser!=='undefined'&&authUser,ready=logged&&typeof authProfileId!=='undefined'&&authProfileId;
  if(!_pair.ext){
    html=_pairCard('<div class="pair-ring warn">'+_pairIcon('warn')+'</div><h1>'+esc(t('pair.noExtTitle'))+'</h1><p>'+esc(t('pair.noExtText'))+'</p>'+
      (EXT_STORE_URL?'<a class="pair-btn" href="'+esc(EXT_STORE_URL)+'" target="_blank" rel="noopener">'+esc(t('onb.install'))+'</a>':'')+
      '<button type="button" class="pair-btn'+(EXT_STORE_URL?' ghost':'')+'"'+uiAct('pairClose')+'>'+esc(t('pair.backToList'))+'</button>');
  }else if(_pair.state==='done'){
    html=_pairCard('<div class="pair-ring ok">'+_pairIcon('check')+'</div><h1>'+esc(t('pair.doneTitle'))+'</h1><p>'+esc(t('pair.doneText',{device:d.label}))+'</p>'+
      '<button type="button" class="pair-btn"'+uiAct('pairClose')+'>'+esc(t('pair.backToList'))+'</button>'+
      '<div class="pair-sec">'+_pairIcon('lock')+esc(t('pair.revocable'))+'</div>')+
      '<div class="pair-devices" id="pairDevices"></div>';
  }else if(!logged){
    html=_pairCard(_pairLinkVisual()+'<h1>'+esc(t('pair.loginTitle'))+'</h1><p>'+esc(t('pair.loginText'))+'</p>'+
      '<button type="button" class="pair-btn"'+uiAct('pairLogin')+'>'+esc(t('pair.loginBtn'))+'</button>');
  }else{
    var official=OFFICIAL_EXT_IDS.indexOf(_pair.ext)>=0,busy=_pair.state==='busy';
    html=_pairCard(_pairLinkVisual()+'<h1>'+esc(t('pair.title'))+'</h1><p>'+esc(t('pair.text'))+'</p>'+
      '<div class="pair-device"><div class="pair-ic">'+_pairIcon('laptop')+'</div><div><b>'+esc(d.label)+'</b><small>'+
        esc(t('pair.extVersion',{v:_pair.v||'?'}))+'</small></div></div>'+
      '<ul class="pair-perm"><li>'+esc(t('pair.perm1'))+'</li><li>'+esc(t('pair.perm2'))+'</li><li class="no">'+esc(t('pair.perm3'))+'</li></ul>'+
      (official?'':'<label class="pair-warn"><input type="checkbox" id="pairAck"'+(_pair.ack?' checked':'')+uiAct('pairAck',[],'change')+'><span>'+esc(t('pair.unknownExt',{id:_pair.ext}))+'</span></label>')+
      (_pair.err?'<div class="pair-err" role="alert">'+esc(_pair.err)+'</div>':'')+
      '<button type="button" class="pair-btn" id="pairGo"'+(busy||!ready||(!official&&!_pair.ack)?' disabled':'')+uiAct('pairAuthorize')+'>'+esc(busy?t('pair.busy'):t('pair.authorize'))+'</button>'+
      '<button type="button" class="pair-btn ghost"'+uiAct('pairClose')+'>'+esc(t('pair.cancel'))+'</button>'+
      '<div class="pair-sec">'+_pairIcon('lock')+esc(t('pair.secure'))+'</div>');
  }
  el.innerHTML='<div class="pair-glow" aria-hidden="true"></div>'+html;
  if(_pair.state==='done'){var box=document.getElementById('pairDevices');if(box)renderDevicesPanel(box);}
}
function pairAck(el){_pair.ack=!!el.checked;var b=document.getElementById('pairGo');if(b)b.disabled=!_pair.ack;}
function pairLogin(){if(typeof openAuthModal==='function')openAuthModal('login');}
function pairClose(){
  document.documentElement.classList.remove('pair-open');
  var el=_pairEl();if(el)el.remove();
  try{history.replaceState(null,'','/');}catch(e){}
}
function pairAuthorize(){
  if(_pair.state==='busy'||!_pair.ext||!authProfileId)return;
  var d=_pairDeviceLabel();
  _pair.state='busy';_pair.err='';_pairRender();
  supa.rpc('pair_extension_device',{p_profile_id:authProfileId,p_label:d.label,p_browser:d.browser,p_os:d.os||null,p_ext_version:_pair.v})
    .then(function(res){
      var r=res&&res.data;
      if(res.error||!r||r.status!=='ok'||!PAIR_TOKEN_RE.test(r.token||''))throw new Error((r&&r.status)||'server');
      return _extSend(_pair.ext,{type:'cp_pair',token:r.token,deviceId:r.device_id}).then(function(ack){
        if(!ack||!ack.ok){
          /* L'extension n'a pas reçu le jeton : on le retire tout de suite, il ne servira à personne */
          supa.rpc('revoke_extension_device',{p_device_id:r.device_id});
          throw new Error(ack&&ack.reason==='network'?'network':'ext');
        }
        try{localStorage.setItem('cp_device_id',r.device_id);}catch(e){}
        _pair.state='done';if(typeof sfx==='function')sfx('done');_pairRender();
      });
    })
    .catch(function(e){
      var k={too_many_devices:'pair.errTooMany',rate_limited:'pair.errRate',ext:'pair.errExt',network:'pair.errNetwork'}[e&&e.message]||'pair.errServer';
      _pair.state='idle';_pair.err=t(k);_pairRender();
    });
}

/* ---------- Appareils connectés (composant autonome) ---------- */
function renderDevicesPanel(container){
  if(!container)return;
  container.classList.add('dev-panel');
  container.innerHTML='<h2>'+esc(t('dev.title'))+'</h2><p class="dev-intro">'+esc(t('dev.intro'))+'</p><div class="dev-list" aria-busy="true"><div class="dev-skel"></div><div class="dev-skel"></div></div>';
  if(typeof supa==='undefined'||!supa||typeof authUser==='undefined'||!authUser){container.querySelector('.dev-list').innerHTML='<p class="dev-empty">'+esc(t('dev.login'))+'</p>';return;}
  supa.from('extension_devices').select('id,label,ext_version,created_at,last_seen_at,revoked_at').order('created_at',{ascending:false}).limit(30)
    .then(function(res){
      if(res.error)throw res.error;
      _pair.devices=res.data||[];_devRenderList(container);
    }).catch(function(){var l=container.querySelector('.dev-list');if(l)l.innerHTML='<p class="dev-empty">'+esc(t('dev.error'))+'</p>';});
}
function _devDate(s){try{return new Date(s).toLocaleDateString(I18N_META.locale,{day:'numeric',month:'short'});}catch(e){return '';}}
function _devAgo(s){
  if(!s)return t('dev.neverSeen');
  var h=Math.max(0,Math.round((Date.now()-new Date(s).getTime())/3600000));
  return h<2?t('dev.seenNow'):h<48?t('dev.seenHours',{n:h}):t('dev.seenDays',{n:Math.round(h/24)});
}
function _devRenderList(container){
  var list=container.querySelector('.dev-list');if(!list)return;
  list.removeAttribute('aria-busy');
  var me=null;try{me=localStorage.getItem('cp_device_id');}catch(e){}
  var rows=(_pair.devices||[]);
  if(!rows.length){list.innerHTML='<p class="dev-empty">'+esc(t('dev.empty'))+'</p>';return;}
  list.innerHTML=rows.map(function(d,i){
    var rev=!!d.revoked_at;
    var sub=rev?t('dev.revokedOn',{date:_devDate(d.revoked_at)}):
      t('dev.linkedOn',{date:_devDate(d.created_at)})+' · '+_devAgo(d.last_seen_at)+(d.ext_version?' · v'+d.ext_version:'');
    return '<div class="dev-row'+(rev?' revoked':'')+'" style="--i:'+i+'" data-dev="'+esc(d.id)+'"><div class="pair-ic">'+_pairIcon('laptop')+'</div>'+
      '<div class="dev-meta"><b>'+esc(d.label)+'</b>'+(d.id===me&&!rev?'<span class="dev-tag">'+esc(t('dev.thisDevice'))+'</span>':'')+'<small>'+esc(sub)+'</small></div>'+
      (rev?'<span class="dev-gone">'+esc(t('dev.revoked'))+'</span>':'<button type="button" class="dev-btn"'+uiAct('devAsk',[d.id])+'>'+esc(t('dev.remove'))+'</button>')+'</div>';
  }).join('');
}
function devAsk(el,e,id){
  var row=el.closest('.dev-row');if(!row||row.nextElementSibling&&row.nextElementSibling.classList.contains('dev-confirm'))return;
  var d=(_pair.devices||[]).filter(function(x){return x.id===id;})[0];if(!d)return;
  var c=document.createElement('div');c.className='dev-confirm';c.setAttribute('role','alertdialog');
  c.innerHTML='<span>'+esc(t('dev.confirm',{device:d.label}))+'</span><button type="button" class="dev-btn"'+uiAct('devRevoke',[id])+'>'+esc(t('dev.confirmYes'))+'</button>'+
    '<button type="button" class="dev-cancel"'+uiAct('devCancel')+'>'+esc(t('pair.cancel'))+'</button>';
  row.after(c);
}
function devCancel(el){var c=el.closest('.dev-confirm');if(c)c.remove();}
function devRevoke(el,e,id){
  el.disabled=true;
  supa.rpc('revoke_extension_device',{p_device_id:id}).then(function(res){
    if(res.error||!res.data||res.data.status!=='revoked')throw new Error('revoke');
    (_pair.devices||[]).forEach(function(d){if(d.id===id)d.revoked_at=new Date().toISOString();});
    var panel=el.closest('.dev-panel');if(panel)_devRenderList(panel);
    if(typeof toast==='function')toast(t('dev.removed'));
  }).catch(function(){el.disabled=false;if(typeof toast==='function')toast(t('dev.error'),'err');});
}

/* ---------- Fenêtre d'accueil après inscription ---------- */
var ONB_FRESH_MS=15*60*1000;
function maybeShowOnboarding(user){
  if(!user||!user.id||document.getElementById('pairPage'))return;
  var key='cp_onb_'+user.id;
  try{if(localStorage.getItem(key))return;}catch(e){return;}
  var created=Date.parse(user.created_at||'');
  if(!(created>0)||Date.now()-created>ONB_FRESH_MS)return;
  try{localStorage.setItem(key,'1');}catch(e){}
  showOnboarding();
}
/* Fenêtre d'accueil. Tant que l'extension n'est pas publiée (EXT_STORE_URL vide), les étapes et le bouton
   de l'extension sont masqués ; dès que l'URL est renseignée, elles reviennent et le bouton ouvre la fiche
   du Chrome Web Store dans un nouvel onglet. */
function onbHtml(storeUrl){
  var plats=['Netflix','Prime Video','Crunchyroll','Disney+','Apple TV'],ext=!!storeUrl;
  return '<div class="onb-modal glass-pop" role="dialog" aria-modal="true" aria-labelledby="onbTitle">'+
    '<div class="onb-hero"><div class="onb-chips">'+plats.map(function(p,i){return '<span style="--i:'+i+'">'+esc(p)+'</span>';}).join('')+'</div>'+
    '<button type="button" class="onb-x"'+uiAct('onbClose')+' aria-label="'+esc(t('onb.close'))+'">✕</button></div>'+
    '<div class="onb-body"><h1 id="onbTitle">'+esc(t('onb.title',{name:(typeof BRAND!=='undefined'&&BRAND.name)||'Cinepisode'}))+'</h1><p>'+esc(t(ext?'onb.text':'onb.textNoExt'))+'</p>'+
    '<div class="onb-steps"><div class="onb-step done" style="--i:0"><em>'+_pairIcon('check')+'</em><div><b>'+esc(t('onb.s1'))+'</b>'+esc(t('onb.s1d'))+'</div></div>'+
    (ext?'<div class="onb-step" style="--i:1"><em>2</em><div><b>'+esc(t('onb.s2'))+'</b>'+esc(t('onb.s2d'))+'</div></div>'+
    '<div class="onb-step" style="--i:2"><em>3</em><div><b>'+esc(t('onb.s3'))+'</b>'+esc(t('onb.s3d'))+'</div></div>':'')+'</div>'+
    (ext?'<a class="pair-btn" href="'+esc(storeUrl)+'" target="_blank" rel="noopener">'+esc(t('onb.install'))+'</a>'+
      '<button type="button" class="pair-btn ghost"'+uiAct('onbClose')+'>'+esc(t('onb.later'))+'</button>':
      '<button type="button" class="pair-btn"'+uiAct('onbClose')+'>'+esc(t('onb.start'))+'</button>')+'</div></div>';
}
function showOnboarding(){
  if(document.getElementById('onbMbk'))return;
  var m=document.createElement('div');m.id='onbMbk';m.className='onb-mbk';
  m.innerHTML=onbHtml(EXT_STORE_URL);
  document.body.appendChild(m);
  requestAnimationFrame(function(){m.classList.add('on');});
}
function onbClose(){var m=document.getElementById('onbMbk');if(!m)return;m.classList.remove('on');setTimeout(function(){m.remove();},260);}
document.addEventListener('keydown',function(e){if(e.key==='Escape'&&document.getElementById('onbMbk'))onbClose();});

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initPairPage);else initPairPage();
