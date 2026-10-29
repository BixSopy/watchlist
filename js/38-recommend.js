/* MODULE: Social (étape 3) : « Recommander à un ami ». Bouton dans la fiche détail (js/08-plex.js),
   choix des amis + message facultatif (140 caractères), encart « Recommandé par tes amis » en tête
   de l'onglet Activité de l'écran Amis (js/33-friends.js) et pastille de l'en-tête.
   RPC : send_recommendation, get_my_recommendations, respond_recommendation,
   mark_recommendations_seen, set_reco_pref, export_my_recommendations
   (migration 20261029120000_social_recommandations.sql). Sans la migration, tout reste caché. */
var RECO={available:null,items:null,unread:0,thanks:[],accept:true,loading:null,pick:null};
var RECO_MAX_MSG=140,RECO_MAX_TO=10;
var RECO_POSTER_RE=/^\/[A-Za-z0-9_.-]{1,100}$/;

function recoEnabled(){return SOCIAL.available===true&&RECO.available!==false;}
function recoUnread(){return recoEnabled()?(RECO.unread||0):0;}
function recoLoad(force){
  if(typeof supa==='undefined'||!supa||!authProfileId||RECO.available===false)return Promise.resolve(null);
  if(RECO.loading&&!force)return RECO.loading;
  RECO.loading=supa.rpc('get_my_recommendations',{p_profile_id:authProfileId}).then(function(r){
    RECO.loading=null;
    if(r.error){if(socialUnavailable(r.error))RECO.available=false;return null;}
    if(!r.data||r.data.status!=='ok')return null;
    RECO.available=true;RECO.items=r.data.items||[];RECO.unread=r.data.unread||0;RECO.thanks=r.data.thanks||[];
    RECO.accept=r.data.accept_recos!==false;
    if(typeof friendsHeaderBtn==='function')friendsHeaderBtn();
    return RECO.items;
  },function(){RECO.loading=null;return null;});
  return RECO.loading;
}
if(typeof socialOnChange==='function')socialOnChange(function(){recoLoad();});

/* ---------- Fiche détail : bouton « Recommander » ---------- */
var RECO_ICON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg>';
function recoPlexButton(d){
  if(!recoEnabled()||!d||!d.tmdbId||typeof _plexBtn!=='function')return null;
  return _plexBtn('btn-pill rc-plex',RECO_ICON+'<span>'+esc(t('reco.cta'))+'</span>',function(){sfx('click');openRecommend(recoFromPlex(d));});
}
function recoFromPlex(d){
  var it=d.item||{};
  return {tmdb_id:Number(d.tmdbId),tmdb_type:d.type==='movie'?'movie':'tv',type:it.type||(d.type==='movie'?'film':'serie'),
    title:d.title||it.title||'',year:d.year?String(d.year):'',poster_path:d.poster&&RECO_POSTER_RE.test(d.poster)?d.poster:null};
}

/* ---------- Sélecteur d'amis ---------- */
function recoPickHtml(){
  var p=RECO.pick,fr=(SOCIAL.me&&SOCIAL.me.friends)||[],n=p.to.length;
  var poster=p.title.poster_path?'<img class="rc-hpost" alt="" src="'+IB+'w185'+esc(p.title.poster_path)+'">':'<span class="rc-hpost rc-noimg" aria-hidden="true"></span>';
  var h='<div class="rc-head">'+poster+'<div><p class="rc-kick">'+esc(t('reco.kicker'))+'</p><h2>'+esc(p.title.title)+'</h2>'+(p.title.year?'<p class="soc-sub">'+esc(p.title.year)+'</p>':'')+'</div></div>';
  if(!fr.length){
    return h+'<div class="fr-empty rc-empty"><div class="fr-ghosts" aria-hidden="true"><i></i><i></i><i></i></div><h3>'+esc(t('reco.noFriends'))+'</h3><p class="soc-sub">'+esc(t('reco.noFriendsSub'))+'</p>'+
      '<button type="button" class="soc-cta"'+uiAct('openInvite')+'>'+esc(t('friends.invite'))+'</button></div>';
  }
  h+='<p class="rc-lbl" id="rcLbl">'+esc(t('reco.pickFriends'))+'</p><ul class="rc-chips" role="group" aria-labelledby="rcLbl">'+fr.map(function(f,i){
    var on=p.to.indexOf(f.profile_id)>=0;
    return '<li style="--i:'+i+'"><button type="button" class="rc-chip'+(on?' on':'')+'" aria-pressed="'+on+'"'+uiAct('recoToggle',[f.profile_id])+'>'+
      friendAvatar(f)+'<span>'+esc(friendName(f))+'</span><i class="rc-tick" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7"/></svg></i></button></li>';
  }).join('')+'</ul>';
  h+='<label class="rc-msg"><span class="rc-lbl">'+esc(t('reco.message'))+'</span><textarea id="rcMsg" rows="2" maxlength="'+RECO_MAX_MSG+'" placeholder="'+esc(t('reco.messagePh'))+'"'+uiAct('recoMsg',[],'input')+'>'+esc(p.msg)+'</textarea>'+
    '<em class="rc-count" id="rcCount">'+(RECO_MAX_MSG-p.msg.length)+'</em></label>';
  h+='<button type="button" class="soc-cta rc-send" id="rcSend"'+(n?'':' disabled')+uiAct('recoSend')+'>'+RECO_ICON+'<span>'+esc(n?tn('reco.sendTo',n):t('reco.sendPick'))+'</span></button>';
  return h+'<p class="rc-attr">'+esc(t('reco.tmdb'))+'</p>';
}
function openRecommend(title){
  if(!recoEnabled()||!title||!title.tmdb_id)return;
  RECO.pick={title:title,to:[],msg:'',busy:false};
  var go=function(){socModal(recoPickHtml(),{cls:'rc-wrap',label:t('reco.cta')});};
  if(SOCIAL.me)go();else socialLoad(true).then(go);
}
function recoPickRefresh(keepFocus){
  var w=document.querySelector('#socMbk .rc-wrap');if(!w||!RECO.pick)return;
  var p=RECO.pick,n=p.to.length;
  w.querySelectorAll('.rc-chip').forEach(function(b){
    var id=JSON.parse(b.getAttribute('data-args')||'[]')[0],on=p.to.indexOf(id)>=0;
    b.classList.toggle('on',on);b.setAttribute('aria-pressed',String(on));
  });
  var s=document.getElementById('rcSend');
  if(s){s.disabled=!n||p.busy;s.querySelector('span').textContent=n?tn('reco.sendTo',n):t('reco.sendPick');}
}
function recoToggle(el,e,id){
  var p=RECO.pick;if(!p||p.busy)return;
  var i=p.to.indexOf(id);
  if(i>=0)p.to.splice(i,1);
  else{if(p.to.length>=RECO_MAX_TO)return toast(tn('reco.err.tooMany',RECO_MAX_TO),'nfo');p.to.push(id);}
  sfx('click');recoPickRefresh();
}
function recoMsg(el){
  var p=RECO.pick;if(!p)return;
  p.msg=String(el.value||'').slice(0,RECO_MAX_MSG);
  var c=document.getElementById('rcCount');if(c){var left=RECO_MAX_MSG-p.msg.length;c.textContent=String(left);c.classList.toggle('low',left<=20);}
}
function recoSendResult(st){
  if(st==='sent')return {ok:true};
  if(st==='rate_limited')return {ok:false,msg:'reco.err.rate'};
  if(st==='message_too_long')return {ok:false,msg:'reco.err.long'};
  if(st==='too_many')return {ok:false,msg:'reco.err.tooManyGeneric'};
  return {ok:false,msg:'reco.err.generic'};
}
function recoSend(){
  var p=RECO.pick;if(!p||p.busy||!p.to.length)return;
  p.busy=true;recoPickRefresh();
  var w=document.querySelector('#socMbk .rc-wrap'),n=p.to.length;
  if(w)w.classList.add('sending');
  supa.rpc('send_recommendation',{p_profile_id:authProfileId,p_to:p.to,p_tmdb_id:p.title.tmdb_id,p_tmdb_type:p.title.tmdb_type,
    p_media_type:p.title.type,p_title:p.title.title,p_year:p.title.year||null,p_poster_path:p.title.poster_path,p_message:p.msg.trim()||null}).then(function(r){
    p.busy=false;
    if(r.error){
      if(socialUnavailable(r.error)){RECO.available=false;socClose();return toast(t('reco.unavailable'),'nfo');}
      if(w)w.classList.remove('sending');recoPickRefresh();return toast(t('reco.err.generic'),'err');
    }
    var res=recoSendResult(r.data&&r.data.status);
    if(!res.ok){if(w)w.classList.remove('sending');recoPickRefresh();return toast(t(res.msg),'err');}
    if(w){w.classList.remove('sending');w.classList.add('sent');}
    sfx('done');
    setTimeout(function(){socClose();toast(tn('reco.sent',n));RECO.pick=null;},prefersReducedMotion()?0:900);
  },function(){p.busy=false;if(w)w.classList.remove('sending');recoPickRefresh();toast(t('reco.err.generic'),'err');});
}
function prefersReducedMotion(){try{return !!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);}catch(_){return false;}}

/* ---------- Encart « Recommandé par tes amis » (onglet Activité) ---------- */
function recoInboxHtml(){
  if(!recoEnabled())return '';
  var items=RECO.items,th=RECO.thanks||[],h='';
  if(th.length){
    h+='<ul class="rc-thanks">'+th.slice(0,3).map(function(x,i){
      return '<li style="--i:'+i+'">'+friendAvatar(x.by,'sm')+'<span>'+esc(t('reco.thanked',{name:friendName(x.by),title:x.title}))+'</span><b aria-hidden="true">🙏</b></li>';
    }).join('')+'</ul>';
  }
  if(!items||!items.length)return h;
  return h+'<section class="rc-inbox" aria-labelledby="rcInboxH"><h3 class="rc-h" id="rcInboxH">'+esc(t('reco.inbox'))+'<em>'+items.length+'</em></h3>'+
    '<ul class="rc-rail">'+items.map(recoCardHtml).join('')+'</ul><p class="rc-attr">'+esc(t('reco.tmdb'))+'</p></section>';
}
function recoCardHtml(x,i){
  var poster=x.poster_path&&RECO_POSTER_RE.test(x.poster_path)?'<img alt="" loading="lazy" src="'+IB+'w342'+esc(x.poster_path)+'">':'<span class="rc-noimg" aria-hidden="true">'+esc((x.title||'?').charAt(0))+'</span>';
  var mine=recoInMyList(x);
  return '<li class="rc-card'+(x.status==='new'?' new':'')+'" style="--i:'+i+'" data-reco="'+esc(x.id)+'">'+
    '<div class="rc-post">'+poster+'<span class="rc-from">'+friendAvatar(x.from,'sm')+'<b>'+esc(friendName(x.from))+'</b></span>'+(x.status==='new'?'<i class="rc-new">'+esc(t('reco.new'))+'</i>':'')+'</div>'+
    '<div class="rc-body"><b class="rc-t">'+esc(x.title)+'</b>'+(x.year?'<span class="rc-y">'+esc(x.year)+'</span>':'')+
    (x.message?'<p class="rc-bubble">'+esc(x.message)+'</p>':'')+
    '<div class="rc-acts">'+
      (mine?'<span class="rc-in">'+esc(t('reco.inList'))+'</span>':'<button type="button" class="rc-add"'+uiAct('recoRespond',[x.id,'added'])+'>'+esc(t('reco.add'))+'</button>')+
      '<button type="button" class="rc-ty'+(x.thanked?' on':'')+'" aria-pressed="'+!!x.thanked+'"'+(x.thanked?' disabled':'')+uiAct('recoRespond',[x.id,'thanks'])+' title="'+esc(t('reco.thanks'))+'" aria-label="'+esc(t('reco.thanks'))+'">🙏</button>'+
      '<button type="button" class="rc-no"'+uiAct('recoRespond',[x.id,'dismissed'])+' title="'+esc(t('reco.dismiss'))+'" aria-label="'+esc(t('reco.dismiss'))+'">×</button>'+
    '</div></div></li>';
}
function recoInMyList(x){
  if(typeof memDB==='undefined'||!x)return false;
  return memDB.some(function(e){return !e.deleted&&Number(e.tmdbId)===Number(x.tmdb_id)&&(e.tmdbType||'')===x.tmdb_type;});
}
function recoAddToMyList(x){
  if(recoInMyList(x)||typeof addEntryFromTmdb!=='function')return false;
  addEntryFromTmdb({tmdbId:x.tmdb_id,tmdbType:x.tmdb_type,title:x.title,year:x.year||'',poster:x.poster_path||null,overview:'',tmdbScore:null},
    {type:x.type||(x.tmdb_type==='movie'?'film':'serie'),status:'avoir',myRating:0,saison:1,episode:1,totalEp:0,tags:[]});
  if(typeof render==='function')try{render();}catch(_){}
  return true;
}
function recoRespond(el,e,id,action){
  var items=RECO.items||[],x=items.filter(function(y){return y.id===id;})[0];if(!x)return;
  var card=el&&el.closest?el.closest('.rc-card'):null;
  if(action==='thanks'){x.thanked=true;if(el){el.classList.add('on','pop');el.disabled=true;}sfx('click');}
  else{
    if(action==='added'){if(recoAddToMyList(x))toast(t('reco.added',{title:x.title}));else toast(t('reco.inList'),'nfo');}
    else sfx('click');
    var drop=function(){RECO.items=(RECO.items||[]).filter(function(y){return y.id!==id;});if(typeof friendsRefresh==='function')friendsRefresh();};
    if(card&&!prefersReducedMotion()){card.classList.add(action==='added'?'out-ok':'out-no');setTimeout(drop,320);}else drop();
  }
  supa.rpc('respond_recommendation',{p_profile_id:authProfileId,p_id:id,p_action:action}).then(function(r){
    if(r.error||!r.data||r.data.status!=='ok')toast(t('reco.err.generic'),'err');
  });
}
/* Ouverture de l'onglet Activité : les recos affichées passent en « vues » (la pastille s'efface) */
function recoMarkSeen(){
  if(!recoEnabled()||!RECO.unread)return;
  RECO.unread=0;if(typeof friendsHeaderBtn==='function')friendsHeaderBtn();
  setTimeout(function(){(RECO.items||[]).forEach(function(x){if(x.status==='new')x.status='seen';});},2500);
  supa.rpc('mark_recommendations_seen',{p_profile_id:authProfileId}).then(function(){},function(){});
}

/* ---------- Confidentialité : accepter ou non les recommandations ---------- */
function recoPrivRowHtml(){
  if(!recoEnabled())return '';
  return '<button type="button" class="sp-row" role="switch" aria-checked="'+RECO.accept+'"'+uiAct('recoPrivToggle')+'><span><b>'+esc(t('privacy.recos'))+'</b><em>'+esc(t('privacy.recosSub'))+'</em></span><span class="p3-sw" aria-hidden="true"></span></button>';
}
function recoPrivToggle(el){
  var v=!RECO.accept;RECO.accept=v;el.setAttribute('aria-checked',String(v));
  supa.rpc('set_reco_pref',{p_profile_id:authProfileId,p_accept:v}).then(function(r){
    if(r.error||!r.data||r.data.status!=='ok'){RECO.accept=!v;el.setAttribute('aria-checked',String(!v));toast(t('friends.err.generic'),'err');return;}
    toast(t('privacy.saved'));
  });
}
/* Export RGPD (null si la migration n'est pas en place) */
function recoExportData(id){
  if(typeof supa==='undefined'||!supa||!id)return Promise.resolve(null);
  return supa.rpc('export_my_recommendations',{p_profile_id:id}).then(function(r){
    if(r.error||!r.data||r.data.status!=='ok')return null;
    var d=Object.assign({},r.data);delete d.status;return d;
  },function(){return null;});
}
if(typeof module!=='undefined')module.exports={RECO:RECO,recoEnabled:recoEnabled,recoUnread:recoUnread,recoLoad:recoLoad,recoFromPlex:recoFromPlex,
  recoPickHtml:recoPickHtml,openRecommend:openRecommend,recoToggle:recoToggle,recoMsg:recoMsg,recoSend:recoSend,recoSendResult:recoSendResult,
  recoInboxHtml:recoInboxHtml,recoCardHtml:recoCardHtml,recoInMyList:recoInMyList,recoAddToMyList:recoAddToMyList,recoRespond:recoRespond,
  recoMarkSeen:recoMarkSeen,recoPrivRowHtml:recoPrivRowHtml,recoExportData:recoExportData,recoPlexButton:recoPlexButton};
