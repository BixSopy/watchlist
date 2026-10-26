/* MODULE: Social (étape 1) : demandes reçues (accepter / refuser), fiche d'un ami (sa liste selon ses réglages),
   retirer et bloquer (en silence : l'autre n'est pas prévenu), débloquer. RPC : respond_friend_request,
   get_friend_view, remove_friend, block_profile, unblock_profile. */
var FRIEND_VIEW={id:null,data:null,tab:'encours'};
/* Cartes des demandes reçues, en tête de l'écran Amis (appelé par js/33-friends.js) */
function friendsIncomingHtml(inc){
  var me=SOCIAL.me||{};
  return '<h4 class="fr-h">'+esc(tn('friends.requests',inc.length))+'</h4><ul class="rq-list">'+inc.map(function(r,i){
    return '<li class="rq" id="rq-'+esc(r.id)+'" style="--i:'+i+'"><div class="rq-avs">'+friendAvatar(r,'rq-them')+friendAvatar(me,'rq-me')+'<span class="rq-check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span></div>'+
      '<div class="rq-txt"><b>'+esc(friendName(r))+'</b><span>'+esc(t('friends.request',{handle:r.handle}))+'</span></div>'+
      '<div class="rq-acts"><button type="button" class="rq-no"'+uiAct('friendRespond',[r.id,false])+' aria-label="'+esc(t('friends.decline'))+'">'+esc(t('friends.decline'))+'</button>'+
      '<button type="button" class="rq-yes"'+uiAct('friendRespond',[r.id,true])+'>'+esc(t('friends.accept'))+'</button></div></li>';
  }).join('')+'</ul>';
}
function friendRespond(el,id,accept){
  var li=document.getElementById('rq-'+id);if(!li)return;
  li.querySelectorAll('button').forEach(function(b){b.disabled=true;});
  supa.rpc('respond_friend_request',{p_id:id,p_accept:!!accept}).then(function(r){
    var st=r.data&&r.data.status;
    if(r.error||!st||st==='not_found'||st==='friend_limit'){li.querySelectorAll('button').forEach(function(b){b.disabled=false;});toast(t(st==='friend_limit'?'friends.err.limit':'friends.err.generic'),'err');return;}
    var reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if(accept){li.classList.add('joined');if(typeof sfx==='function')sfx('done');var src=((SOCIAL.me&&SOCIAL.me.incoming)||[]).filter(function(x){return x.id===id;})[0]||{};toast(t('friends.nowFriends',{handle:(r.data.friend&&r.data.friend.handle)||src.handle||''}));}
    else li.classList.add('gone');
    setTimeout(function(){socialLoad(true);},reduce?0:accept?900:320);
  });
}

/* ---- Fiche d'un ami ---- */
function openFriend(id){
  FRIEND_VIEW.id=id;FRIEND_VIEW.data=null;FRIEND_VIEW.tab='encours';
  var f=((SOCIAL.me&&SOCIAL.me.friends)||[]).filter(function(x){return x.profile_id===id;})[0]||{};
  socModal(friendViewHtml(f,null),{cls:'fv-wrap',label:friendName(f)});
  supa.rpc('get_friend_view',{p_profile_id:authProfileId,p_friend:id}).then(function(r){
    if(FRIEND_VIEW.id!==id)return;
    if(r.error||!r.data||r.data.status!=='ok'){toast(t('friends.err.generic'),'err');return;}
    FRIEND_VIEW.data=r.data;friendViewRender();
  });
}
function friendViewRender(){var w=document.querySelector('#socMbk .fv-wrap');if(!w)return;var x=w.querySelector('.soc-x');w.innerHTML='';if(x)w.appendChild(x);w.insertAdjacentHTML('beforeend',friendViewHtml(FRIEND_VIEW.data.friend,FRIEND_VIEW.data));}
var FV_TABS=['encours','avoir','termine'];
function friendViewHtml(f,d){
  var h='<div class="fv-head">'+friendAvatar(f,'fv-av')+'<div><h2>'+esc(friendName(f))+'</h2><p class="soc-sub">@'+esc(f.handle||'')+'</p></div>'+
    '<button type="button" class="fv-more" aria-haspopup="true" aria-label="'+esc(t('friends.more'))+'"'+uiAct('friendMore')+'>⋯</button>'+
    '<div class="fv-menu" id="fvMenu" hidden><button type="button"'+uiAct('friendRemove')+'>'+esc(t('friends.remove'))+'</button><button type="button" class="dng"'+uiAct('friendBlock')+'>'+esc(t('friends.block'))+'</button></div></div>';
  if(!d)return h+'<div class="fv-skel">'+'<i></i>'.repeat(6)+'</div>';
  if(!d.show_list)return h+'<p class="fv-priv">🔒 '+esc(t('friends.private'))+'</p>';
  var items=d.items||[],cur=items.filter(function(i){return i.status===FRIEND_VIEW.tab;});
  h+='<div class="fv-tabs" role="tablist">'+FV_TABS.map(function(s){var n=items.filter(function(i){return i.status===s;}).length;
    return '<button type="button" role="tab" aria-selected="'+(s===FRIEND_VIEW.tab)+'" class="'+(s===FRIEND_VIEW.tab?'on':'')+'"'+uiAct('friendTab',[s])+'>'+esc(t('friends.tab.'+s))+' <em>'+n+'</em></button>';}).join('')+'</div>';
  if(!cur.length)return h+'<p class="fv-priv">'+esc(t('friends.tabEmpty'))+'</p>';
  return h+'<ul class="fv-grid">'+cur.slice(0,120).map(function(it,i){
    var ok=it.poster_path&&/^\/[A-Za-z0-9_.-]{1,80}$/.test(it.poster_path);
    var meta=(it.season&&it.episode?'S'+it.season+' E'+it.episode:it.year||'')+(it.rating?' · ★ '+it.rating:'');
    return '<li style="--i:'+Math.min(i,20)+'"><div class="fv-p">'+(ok?'<img alt="" loading="lazy" src="https://image.tmdb.org/t/p/w185'+esc(it.poster_path)+'">':'<span>'+esc((it.title||'?').charAt(0))+'</span>')+'</div><b>'+esc(it.title)+'</b><span>'+esc(meta)+'</span></li>';
  }).join('')+'</ul>';
}
function friendConfirm(kind){
  var f=(FRIEND_VIEW.data&&FRIEND_VIEW.data.friend)||{};
  var m=document.getElementById('fvMenu');if(m)m.hidden=true;
  var w=document.querySelector('#socMbk .fv-wrap');if(!w)return;
  var c=document.createElement('div');c.className='fv-confirm';
  c.innerHTML='<p><b>'+esc(t('friends.'+kind+'Q',{name:friendName(f)}))+'</b><br>'+esc(t('friends.'+kind+'Note'))+'</p><div class="iv-acts"><button type="button" class="soc-ghost"'+uiAct('friendConfirmNo')+'>'+esc(t('common.cancel'))+'</button><button type="button" class="soc-cta dng"'+uiAct('friendConfirmYes',[kind])+'>'+esc(t('friends.'+kind))+'</button></div>';
  w.appendChild(c);
}
function friendDo(kind){
  var id=FRIEND_VIEW.id;
  supa.rpc(kind==='block'?'block_profile':'remove_friend',kind==='block'?{p_profile_id:authProfileId,p_target:id}:{p_profile_id:authProfileId,p_friend:id}).then(function(r){
    if(r.error||!r.data||r.data.status!=='ok'){toast(t('friends.err.generic'),'err');return;}
    toast(t(kind==='block'?'friends.blocked':'friends.removed'));socClose();socialLoad(true);
  });
}
function friendUnblock(id){
  supa.rpc('unblock_profile',{p_profile_id:authProfileId,p_target:id}).then(function(r){
    if(r.error||!r.data||r.data.status!=='ok'){toast(t('friends.err.generic'),'err');return;}
    toast(t('friends.unblocked'));socialLoad(true);
  });
}
/* Liste des profils bloqués (bas de l'écran Amis, repliée) */
function friendsBlockedHtml(){
  var b=(SOCIAL.me&&SOCIAL.me.blocked)||[];if(!b.length)return '';
  return '<details class="fr-blk"><summary>'+esc(tn('friends.blockedList',b.length))+'</summary><ul class="fr-list">'+b.map(function(p){
    return '<li><div class="fr-row">'+friendAvatar(p)+'<span class="fr-meta"><b>'+esc(friendName(p))+'</b><span>@'+esc(p.handle||'')+'</span></span><button type="button" class="soc-ghost fr-ub"'+uiAct('friendUnblock',[p.profile_id])+'>'+esc(t('friends.unblock'))+'</button></div></li>';
  }).join('')+'</ul></details>';
}
if(typeof module!=='undefined')module.exports={friendViewHtml:friendViewHtml,friendsIncomingHtml:friendsIncomingHtml,FRIEND_VIEW:FRIEND_VIEW};
