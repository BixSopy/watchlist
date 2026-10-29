/* MODULE: Social (étape 1) : écran Amis, invitation par lien ou QR code, page /u/<pseudo> (api/invite.js).
   Le QR code est dessiné sur l'appareil (vendor/qrcode-generator-1.4.4.js, MIT) : aucun service tiers.
   Lien d'invitation : <origine>/u/<pseudo>?i=<code>. Le bouton « Ajouter » de la page publique
   ramène ici avec ?ami=<pseudo>&i=<code> : la demande part après connexion et choix du pseudo. */
var FRIENDS={pending:null};
var IMG_W92='https://image.tmdb.org/t/p/w92';
function friendInviteUrl(handle,code,base){
  return (base||location.origin)+'/u/'+encodeURIComponent(handle)+'?i='+encodeURIComponent(code);
}
/* Paramètres ?ami=&i= de l'URL (après clic sur « Ajouter X » de la page publique) */
function friendPendingParse(search){
  var q;try{q=new URLSearchParams(search||'');}catch(_){return null;}
  var h=String(q.get('ami')||'').toLowerCase(),c=String(q.get('i')||'');
  if(!/^[a-z0-9._]{3,20}$/.test(h)||!/^[A-Za-z0-9]{12}$/.test(c))return null;
  return {handle:h,code:c};
}
/* Avatar : emoji ou initiale sur la couleur du profil */
function friendAvatar(p,cls){
  p=p||{};var name=(p.name&&p.name!=='Moi')?p.name:(p.handle||'?');
  var col=/^#[0-9a-fA-F]{6}$/.test(p.avatar_color||'')?p.avatar_color:'#5cc8ff';
  var em=p.avatar&&String(p.avatar).length<=8?p.avatar:'';
  return '<span class="fr-av'+(cls?' '+cls:'')+'" style="background:'+col+'" aria-hidden="true">'+esc(em||name.charAt(0).toUpperCase())+'</span>';
}
function friendName(p){return (p&&p.name&&p.name!=='Moi')?p.name:'@'+((p&&p.handle)||'');}

/* ---- Bouton Amis dans l'en-tête (à côté de Partager), avec pastille des demandes reçues ---- */
function friendsHeaderBtn(){
  if(!SOCIAL.available)return;
  var mi=document.getElementById('menuAddFriend');if(mi)mi.hidden=false;
  var b=document.getElementById('p3FriendsBtn');
  if(!b){
    var tools=document.querySelector('.p3-tools');if(!tools)return;
    b=document.createElement('button');b.type='button';b.id='p3FriendsBtn';b.className='p3-ib fr-hb';b.setAttribute('data-click','openFriends');
    b.title=t('friends.title');b.setAttribute('aria-label',t('friends.title'));
    b.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.6"/><path d="M16.5 14.2A5 5 0 0 1 21.5 19"/></svg><i class="fr-badge" id="frBadge" hidden></i>';
    var bell=document.getElementById('p3Bell');tools.insertBefore(b,bell||null);
  }
  var n=(SOCIAL.me&&SOCIAL.me.incoming||[]).length+(typeof recoUnread==='function'?recoUnread():0),bd=document.getElementById('frBadge');
  if(bd){var was=bd.textContent;bd.hidden=!n;bd.textContent=n>9?'9+':String(n||'');if(n&&was!==bd.textContent){bd.classList.remove('pop');void bd.offsetWidth;bd.classList.add('pop');}}
  b.setAttribute('aria-label',n?tn('friends.badge',n):t('friends.title'));
}

/* ---- Écran Amis ---- */
var FRIENDS_TOP='activity';   /* onglet par défaut : « qu'est-ce qu'il y a de neuf » avant la liste statique */
function friendsTopTabsHtml(){
  return '<div class="fv-tabs fr-toptabs" role="tablist">'+
    '<button type="button" role="tab" aria-selected="'+(FRIENDS_TOP==='activity')+'" class="'+(FRIENDS_TOP==='activity'?'on':'')+'"'+uiAct('friendsTopTab',['activity'])+'>'+esc(t('friends.tabActivity'))+'</button>'+
    '<button type="button" role="tab" aria-selected="'+(FRIENDS_TOP==='list')+'" class="'+(FRIENDS_TOP==='list'?'on':'')+'"'+uiAct('friendsTopTab',['list'])+'>'+esc(t('friends.tabFriends'))+'</button>'+
  '</div>';
}
function friendsHtml(){
  var me=SOCIAL.me||{},fr=me.friends||[],inc=me.incoming||[],out=me.outgoing||[];
  var h='<div class="fr-top"><div><h2>'+esc(t('friends.title'))+'</h2><p class="soc-sub">@'+esc(me.handle||'')+(fr.length?' · '+esc(tn('friends.count',fr.length)):'')+'</p></div>'+
    '<button type="button" class="fr-add"'+uiAct('openInvite')+'><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>'+esc(t('friends.add'))+'</button></div>';
  if(inc.length&&typeof friendsIncomingHtml==='function')h+=friendsIncomingHtml(inc);
  h+=friendsTopTabsHtml();
  if(FRIENDS_TOP==='activity'){if(typeof recoMarkSeen==='function')setTimeout(recoMarkSeen,0);return h+(typeof recoInboxHtml==='function'?recoInboxHtml():'')+(typeof activityFeedHtml==='function'?activityFeedHtml():'');}
  if(!fr.length&&!out.length&&!inc.length){
    h+='<div class="fr-empty"><div class="fr-ghosts" aria-hidden="true"><i></i><i></i><i></i></div><h3>'+esc(t('friends.empty'))+'</h3><p class="soc-sub">'+esc(t('friends.emptySub'))+'</p>'+
      '<button type="button" class="soc-cta"'+uiAct('openInvite')+'>'+esc(t('friends.invite'))+'</button></div>';
    return h;
  }
  if(fr.length){
    h+='<ul class="fr-list">'+fr.map(function(f,i){
      var c=f.current,sub=c?(c.title+(c.season&&c.episode?' · S'+c.season+' E'+c.episode:'')):'@'+f.handle;
      return '<li style="--i:'+i+'"><button type="button" class="fr-row"'+uiAct('openFriend',[f.profile_id])+'>'+friendAvatar(f)+
        '<span class="fr-meta"><b>'+esc(friendName(f))+'</b><span>'+(c?'<i class="fr-live" aria-hidden="true"></i>':'')+esc(sub)+'</span></span>'+
        (c&&c.poster_path&&/^\/[A-Za-z0-9_.-]{1,80}$/.test(c.poster_path)?'<img class="fr-post" alt="" loading="lazy" src="'+IMG_W92+esc(c.poster_path)+'">':'')+'</button></li>';
    }).join('')+'</ul>';
  }
  if(out.length){
    h+='<h4 class="fr-h">'+esc(t('friends.sent'))+'</h4><ul class="fr-list fr-out">'+out.map(function(o){
      return '<li><div class="fr-row">'+friendAvatar(o)+'<span class="fr-meta"><b>'+esc(friendName(o))+'</b><span>@'+esc(o.handle)+'</span></span><span class="fr-pend">'+esc(t('friends.pending'))+'</span></div></li>';
    }).join('')+'</ul>';
  }
  if(typeof friendsBlockedHtml==='function')h+=friendsBlockedHtml();
  if(typeof socialPrivacyHtml==='function')h+=socialPrivacyHtml();
  return h;
}
function friendsTopTab(el,e,tab){
  if(tab!==FRIENDS_TOP){FRIENDS_TOP=tab;friendsRefresh();}
  if(tab==='activity'&&typeof activityLoad==='function')activityLoad().then(friendsRefresh);
}
function openFriends(){
  if(!authUser){if(typeof openAuthModal==='function')openAuthModal();return;}
  socialLoad(true).then(function(me){
    if(!SOCIAL.available||!me)return toast(t('friends.unavailable'),'nfo');
    ensureHandle(function(){
      socModal(friendsHtml(),{cls:'fr-wrap',label:t('friends.title')});
      if(FRIENDS_TOP==='activity'&&typeof activityLoad==='function')activityLoad(true).then(friendsRefresh);
    });
  });
}
function friendsRefresh(){var w=document.querySelector('#socMbk .fr-wrap');if(!w)return;var x=w.querySelector('.soc-x');w.innerHTML='';if(x)w.appendChild(x);w.insertAdjacentHTML('beforeend',friendsHtml());}

/* ---- Invitation : lien + QR code ---- */
function friendQrSvg(text){
  if(typeof qrcode!=='function')return '';
  var q=qrcode(0,'H');q.addData(text);q.make();
  var n=q.getModuleCount(),c=(n-1)/2,hole=Math.round(n*0.13),out='',max=Math.sqrt(2)*c;
  for(var r=0;r<n;r++)for(var k=0;k<n;k++){
    if(!q.isDark(r,k))continue;
    if(Math.abs(r-c)<=hole&&Math.abs(k-c)<=hole)continue;/* place du logo (correction H) */
    var d=Math.sqrt((r-c)*(r-c)+(k-c)*(k-c))/max;
    out+='<rect x="'+k+'" y="'+r+'" width="1.02" height="1.02" rx=".28" style="--d:'+d.toFixed(2)+'"/>';
  }
  return '<svg class="qr-svg" viewBox="-2 -2 '+(n+4)+' '+(n+4)+'" role="img" aria-label="'+esc(t('friends.qrAlt'))+'"><rect x="-2" y="-2" width="'+(n+4)+'" height="'+(n+4)+'" rx="3" fill="#f0f0f0"/><g fill="#0a0a0c">'+out+'</g></svg>';
}
function inviteHtml(){
  var me=SOCIAL.me||{},url=friendInviteUrl(me.handle,me.invite_code);
  return '<div class="iv-head"><h2>'+esc(t('friends.invite'))+'</h2><p class="soc-sub">'+esc(t('friends.inviteSub'))+'</p></div>'+
    '<div class="qr-box"><div class="qr-ring" aria-hidden="true"></div>'+friendQrSvg(url)+'<span class="qr-logo" aria-hidden="true">'+friendAvatar(me)+'</span></div>'+
    '<p class="iv-scan">'+esc(t('friends.scan'))+'</p>'+
    '<div class="iv-link"><span id="ivUrl">'+esc(url.replace(/^https?:\/\//,''))+'</span><button type="button" class="iv-copy"'+uiAct('inviteCopy')+'>'+esc(t('friends.copy'))+'</button></div>'+
    '<div class="iv-acts"><button type="button" class="soc-ghost"'+uiAct('inviteNewLink')+'>'+esc(t('friends.newLink'))+'</button>'+
    (navigator.share?'<button type="button" class="soc-cta iv-share"'+uiAct('inviteShare')+'>'+esc(t('friends.shareLink'))+'</button>':'')+'</div>'+
    '<p class="soc-note">'+esc(t('friends.newLinkNote'))+'</p>';
}
function openInvite(){socModal(inviteHtml(),{cls:'iv-wrap',label:t('friends.invite')});}
function inviteCopy(el){
  var me=SOCIAL.me||{},url=friendInviteUrl(me.handle,me.invite_code);
  (navigator.clipboard?navigator.clipboard.writeText(url):Promise.reject()).then(function(){
    el.textContent=t('friends.copied');el.classList.add('ok');setTimeout(function(){el.textContent=t('friends.copy');el.classList.remove('ok');},1600);
  },function(){toast(url,'nfo');});
}
function inviteShare(){
  var me=SOCIAL.me||{};
  navigator.share({title:'Cinepisode',text:t('friends.shareText',{handle:me.handle}),url:friendInviteUrl(me.handle,me.invite_code)}).catch(function(){});
}
function inviteNewLink(el){
  el.disabled=true;
  supa.rpc('rotate_invite_code',{p_profile_id:authProfileId}).then(function(r){
    el.disabled=false;var st=r.data&&r.data.status;
    if(st==='ok'){SOCIAL.me.invite_code=r.data.invite_code;openInvite();toast(t('friends.newLinkDone'));}
    else toast(t(st==='rate_limited'?'friends.err.rotateLimit':'friends.err.generic'),'err');
  });
}

/* ---- Demande envoyée depuis un lien d'invitation ---- */
function friendPendingSend(){
  var p=FRIENDS.pending;if(!p||!authProfileId||!SOCIAL.available)return;
  ensureHandle(function(){
    FRIENDS.pending=null;try{sessionStorage.removeItem('cp_ami');}catch(_){}
    supa.rpc('send_friend_request',{p_profile_id:authProfileId,p_handle:p.handle,p_code:p.code}).then(function(r){
      var st=(r.data&&r.data.status)||'error',M={sent:['friends.sentOk','ok'],friends:['friends.nowFriends','ok'],already_friends:['friends.already','nfo'],self:['friends.self','nfo'],
        invalid:['friends.err.invalid','err'],friend_limit:['friends.err.limit','err'],rate_limited:['friends.err.rate','err']}[st]||['friends.err.generic','err'];
      toast(t(M[0],{handle:p.handle}),M[1]);if(st==='sent'||st==='friends')socialLoad(true);
    });
  });
}
(function(){
  var p=null;try{p=friendPendingParse(location.search);}catch(_){}
  if(p){try{sessionStorage.setItem('cp_ami',JSON.stringify(p));history.replaceState(null,'',location.pathname+location.hash);}catch(_){}}
  else{try{p=JSON.parse(sessionStorage.getItem('cp_ami')||'null');}catch(_){p=null;}}
  FRIENDS.pending=p&&p.handle?p:null;
  if(FRIENDS.pending&&typeof setTimeout==='function')setTimeout(function(){if(typeof authUser!=='undefined'&&!authUser&&typeof openAuthModal==='function'){openAuthModal();toast(t('friends.signInToAdd',{handle:FRIENDS.pending.handle}),'nfo');}},1200);
})();
if(typeof socialOnChange==='function')socialOnChange(function(){friendsHeaderBtn();friendsRefresh();friendPendingSend();});
if(typeof module!=='undefined')module.exports={friendInviteUrl:friendInviteUrl,friendPendingParse:friendPendingParse,friendAvatar:friendAvatar};
