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
  var col=/^#[0-9a-fA-F]{6}$/.test(p.avatar_color||'')?p.avatar_color:'#2f8fd1';
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
  if(typeof wtEntryHtml==='function')h+=wtEntryHtml();
  h+=friendsTopTabsHtml();
  if(FRIENDS_TOP==='activity'){if(typeof recoMarkSeen==='function')setTimeout(recoMarkSeen,0);return h+(typeof recoInboxHtml==='function'?recoInboxHtml():'')+(typeof activityFeedHtml==='function'?activityFeedHtml():'');}
  if(!fr.length&&!out.length&&!inc.length){
    h+='<div class="fr-empty"><div class="fr-ghosts" aria-hidden="true"><i></i><i></i><i></i><i class="fr-spark"></i></div><h3>'+esc(t('friends.empty'))+'</h3><p class="soc-sub">'+esc(t('friends.emptySub'))+'</p>'+
      '<button type="button" class="soc-cta"'+uiAct('openInvite')+'>'+esc(t('friends.invite'))+'</button></div>';
    return h;
  }
  if(fr.length){
    h+='<ul class="fr-list">'+fr.map(function(f,i){
      var c=f.current,sub=c?((typeof bidiIso==='function'?bidiIso:String)(c.title)+(c.season&&c.episode?' · S'+c.season+' E'+c.episode:'')):(typeof bidiIso==='function'?bidiIso:String)('@'+f.handle);
      return '<li style="--i:'+i+'"><button type="button" class="fr-row"'+uiAct('openFriend',[f.profile_id])+'>'+friendAvatar(f)+
        '<span class="fr-meta"><b>'+esc((typeof bidiIso==='function'?bidiIso:String)(friendName(f)))+'</b><span>'+(c?'<i class="fr-live" aria-hidden="true"></i>':'')+esc(sub)+'</span></span>'+
        (c&&c.poster_path&&/^\/[A-Za-z0-9_.-]{1,80}$/.test(c.poster_path)?'<img class="fr-post" alt="" loading="lazy" src="'+IMG_W92+esc(c.poster_path)+'">':'')+'</button></li>';
    }).join('')+'</ul>';
  }
  if(out.length){
    h+='<h4 class="fr-h">'+esc(t('friends.sent'))+'</h4><ul class="fr-list fr-out">'+out.map(function(o){
      return '<li><div class="fr-row">'+friendAvatar(o)+'<span class="fr-meta"><b>'+esc((typeof bidiIso==='function'?bidiIso:String)(friendName(o)))+'</b><span>'+esc((typeof bidiIso==='function'?bidiIso:String)('@'+(o.handle)))+'</span></span><span class="fr-pend">'+esc(t('friends.pending'))+'</span></div></li>';
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
  /* H2 Spine Halo v2 : QR rond (EC H), capsules, couronne + halo. Scannable par caméra téléphone. */
  if(typeof qrcode!=='function')return '';
  var q=qrcode(0,'H');q.addData(String(text||''));q.make();
  var N=q.getModuleCount(),GAP=1;
  var VB=440,c=VB/2,Rd=VB*0.335,u=(VB*0.56)/(N+6),o=c-N*u/2;
  var TILE='#e4f0fa',NAVY0='#08101e',NAVY1='#0a3a60',BG='#000000';
  var G1='#7c7c87',G2='#888888',ACC='#5cc8ff',HOV='#7ad4ff';
  var alt=esc(typeof t==='function'?t('friends.qrAlt'):'QR');
  function isFinder(r,cc){return (r<7&&cc<7)||(r<7&&cc>=N-7)||(r>=N-7&&cc<7);}
  /* Centre en coordonnées continues (N/2), pas l'index de module arrondi : sinon le logo
     était décalé d'un demi-module à chaque fois que N (qui dépend de la longueur de l'URL)
     tombait pair (signalé par Pierre le 06/11 — logo visiblement pas centré dans le QR). */
  function centerClear(r,cc){var h=N/2;return Math.abs(r+0.5-h)<=4.5&&Math.abs(cc+0.5-h)<=4.5;}
  function lerpHex(a,b,k){
    function p(h){return [parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];}
    var A=p(a),B=p(b),i,out='#';
    for(i=0;i<3;i++)out+=('0'+Math.round(A[i]+(B[i]-A[i])*k).toString(16)).slice(-2);
    return out;
  }
  /* seed stable → hauteurs de barres (décoratif, pas de payload) */
  var seed=2166136261>>>0,i,ch;
  for(i=0;i<(text||'').length;i++){seed^=(text||'').charCodeAt(i);seed=Math.imul(seed,16777619);}
  function rnd(){seed=Math.imul(seed^seed>>>15,0x85ebca6b)^Math.imul(seed^seed>>>13,0xc2b2ae35);return ((seed>>>0)/4294967296);}
  var L=[VB*0.03,VB*0.055,VB*0.08,VB*0.105],bw=VB*0.015,r0=Rd+VB*0.018;
  var bars='',nb=72;
  for(i=0;i<nb;i++){
    if(i>=3&&i<8)continue; /* gap d'orientation visuelle */
    var v,col,ln;
    if(i<3){v=i;ln=L[1+v];col=[G1,G2,ACC][v];}
    else{v=(rnd()*4)|0;ln=L[v];col=v<3?lerpHex(G1,ACC,v/3):HOV;}
    var a=2*Math.PI*(i-1)/nb-Math.PI/2,deg=a*180/Math.PI;
    bars+='<g class="qr-bar" style="--i:'+i+'" transform="translate('+c.toFixed(2)+' '+c.toFixed(2)+') rotate('+deg.toFixed(2)+')"><rect class="qr-bar-stem" x="'+(-bw/2).toFixed(2)+'" y="'+Rd.toFixed(2)+'" width="'+bw.toFixed(2)+'" height="'+ln.toFixed(2)+'" rx="'+(bw/2).toFixed(2)+'" fill="'+col+'"/></g>';
  }
  /* grille étendue : QR réel + bande quiet + fillers décoratifs dans le disque */
  var ext=Math.ceil(Rd/u)+2,G={},r,cc,kind,on,x,y,inside;
  for(r=-ext;r<N+ext;r++)for(cc=-ext;cc<N+ext;cc++){
    if(r>=0&&r<N&&cc>=0&&cc<N){
      on=q.isDark(r,cc)&&!isFinder(r,cc)&&!centerClear(r,cc);
      G[r+','+cc]=['q',on];
    }else if(r>=-GAP&&r<N+GAP&&cc>=-GAP&&cc<N+GAP){
      G[r+','+cc]=['z',false];
    }else{
      x=o+(cc+.5)*u;y=o+(r+.5)*u;
      inside=Math.hypot(x-c,y-c)<Rd-u*0.9;
      G[r+','+cc]=['f',inside&&rnd()<0.5];
    }
  }
  var mods='',key,e,dist,base,pad=u*0.12,rad=u*0.38;
  for(key in G){
    kind=G[key][0];on=G[key][1];if(!on)continue;
    r=+key.split(',')[0];cc=+key.split(',')[1];
    if(G[(r-1)+','+cc]&&G[(r-1)+','+cc][0]===kind&&G[(r-1)+','+cc][1])continue;
    e=r;while(G[(e+1)+','+cc]&&G[(e+1)+','+cc][0]===kind&&G[(e+1)+','+cc][1])e++;
    dist=Math.hypot((r+e)/2-N/2+.5,cc-N/2+.5)*u/Rd;
    base=lerpHex(NAVY0,NAVY1,Math.min(1,Math.max(0,((r+e)/2+cc)/(2*N))));
    if(kind==='f')base=lerpHex(TILE,base,0.72);
    mods+='<rect class="qr-mod" x="'+(o+cc*u+pad).toFixed(2)+'" y="'+(o+r*u+pad).toFixed(2)+'" width="'+(u-2*pad).toFixed(2)+'" height="'+((e-r+1)*u-2*pad).toFixed(2)+'" rx="'+rad.toFixed(2)+'" fill="'+base+'" style="--d:'+Math.min(1,dist).toFixed(2)+'"/>';
  }
  /* finders = 3 capsules Episode Spine */
  var finders='',fi,fx,fy,b,cl;
  [[0,0],[0,N-7],[N-7,0]].forEach(function(p){
    r=p[0];cc=p[1];fx=o+cc*u;fy=o+r*u;
    finders+='<rect x="'+fx.toFixed(2)+'" y="'+fy.toFixed(2)+'" width="'+(7*u).toFixed(2)+'" height="'+(7*u).toFixed(2)+'" rx="'+(2.2*u).toFixed(2)+'" fill="'+NAVY0+'"/>';
    finders+='<rect x="'+(fx+u).toFixed(2)+'" y="'+(fy+u).toFixed(2)+'" width="'+(5*u).toFixed(2)+'" height="'+(5*u).toFixed(2)+'" rx="'+(1.4*u).toFixed(2)+'" fill="'+TILE+'"/>';
    for(b=0;b<3;b++){
      cl=b===2?'#06568c':NAVY0;
      finders+='<rect x="'+(fx+(2+b)*u+u*0.06).toFixed(2)+'" y="'+(fy+2*u).toFixed(2)+'" width="'+(u-u*0.12).toFixed(2)+'" height="'+(3*u).toFixed(2)+'" rx="'+(u*0.45).toFixed(2)+'" fill="'+cl+'"/>';
    }
  });
  /* logo central Episode Spine : plaque centrée en coordonnées continues (voir centerClear),
     pas sur l'index de module arrondi — même correction, même raison. À l'intérieur, les 3
     barres (coordonnées 0-24 du tracé d'origine) ont leur propre boîte englobante — x:3.5→20.5,
     y:4→19, pas 0→24 — donc un simple décalage arbitraire (l'ancien +1.4u sur x et y) les
     désaxait dans la plaque (jusqu'à 8× plus de marge en haut qu'en bas, et la 3e barre
     dépassait même le bord droit). Signalé par Pierre le 06/11 (« je veux que les barres
     dans le cadre noir soient centrées ») : translation recalculée pour centrer cette boîte
     englobante, pas le repère 0-24. Barres animées comme au démarrage (.brand-startup
     .logo-bar/@keyframes sbBounce, css/app.css), rebond décalé. */
  var h=N/2,lx=o+(h-4.5)*u+u*0.3,ly=lx,ls=(9*u-u*0.6),k=ls/24,
    barTx=lx+(ls/2-12*k),barTy=ly+(ls/2-11.5*k),logo=
    '<rect x="'+lx.toFixed(2)+'" y="'+ly.toFixed(2)+'" width="'+ls.toFixed(2)+'" height="'+ls.toFixed(2)+'" rx="'+(u*1.8).toFixed(2)+'" fill="'+BG+'"/>'+
    '<g transform="translate('+barTx.toFixed(2)+' '+barTy.toFixed(2)+')">'+
    '<rect class="qr-logo-bar qr-logo-bar-1" x="'+(3.5*k).toFixed(2)+'" y="'+(12*k).toFixed(2)+'" width="'+(4*k).toFixed(2)+'" height="'+(7*k).toFixed(2)+'" rx="'+(2*k).toFixed(2)+'" fill="'+G1+'"/>'+
    '<rect class="qr-logo-bar qr-logo-bar-2" x="'+(10*k).toFixed(2)+'" y="'+(8.5*k).toFixed(2)+'" width="'+(4*k).toFixed(2)+'" height="'+(10.5*k).toFixed(2)+'" rx="'+(2*k).toFixed(2)+'" fill="'+G2+'"/>'+
    '<rect class="qr-logo-bar qr-logo-bar-3" x="'+(16.5*k).toFixed(2)+'" y="'+(4*k).toFixed(2)+'" width="'+(4*k).toFixed(2)+'" height="'+(14*k).toFixed(2)+'" rx="'+(2*k).toFixed(2)+'" fill="'+ACC+'"/>'+
    '</g>';
  return '<svg class="qr-svg qr-h2" viewBox="0 0 '+VB+' '+VB+'" role="img" aria-label="'+alt+'">'+
    '<defs><radialGradient id="qrHalo" cx="50%" cy="50%" r="50%"><stop offset="55%" stop-color="'+ACC+'" stop-opacity="0"/><stop offset="100%" stop-color="'+ACC+'" stop-opacity=".55"/></radialGradient></defs>'+
    '<circle class="qr-halo" cx="'+c+'" cy="'+c+'" r="'+(Rd+VB*0.12).toFixed(2)+'" fill="url(#qrHalo)"/>'+
    '<g class="qr-crown" aria-hidden="true">'+bars+'</g>'+
    '<circle class="qr-disc" cx="'+c+'" cy="'+c+'" r="'+Rd.toFixed(2)+'" fill="'+TILE+'"/>'+
    '<g class="qr-mods">'+mods+'</g>'+
    '<g class="qr-finders">'+finders+'</g>'+
    '<g class="qr-center">'+logo+'</g>'+
    '</svg>';
}

function inviteHtml(){
  var me=SOCIAL.me||{},url=friendInviteUrl(me.handle,me.invite_code);
  return '<div class="iv-head"><h2>'+esc(t('friends.invite'))+'</h2><p class="soc-sub">'+esc(t('friends.inviteSub'))+'</p></div>'+
    '<div class="qr-box qr-box-h2">'+friendQrSvg(url)+'</div>'+
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
if(typeof module!=='undefined')module.exports={friendInviteUrl:friendInviteUrl,friendPendingParse:friendPendingParse,friendAvatar:friendAvatar,friendQrSvg:friendQrSvg};
