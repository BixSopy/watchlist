/* MODULE: Social (étape 2) : fil d'activité automatique (progressions détectées par l'extension
   uniquement, jamais une correction manuelle) + réactions emoji en un tap. RPC : get_activity_feed,
   react_to_activity. Rendu dans l'onglet « Activité » de l'écran Amis (js/33-friends.js).
   Fenêtre de 30 jours, plafonnée à 25 entrées par le serveur : pas de pagination côté client. */
var ACT_FEED={data:null,loading:null};
var ACT_EMOJI=['👍','❤️','🔥','😮','😂','🍿'];

function activityLoad(force){
  if(typeof supa==='undefined'||!supa||!authProfileId)return Promise.resolve(null);
  if(ACT_FEED.loading&&!force)return ACT_FEED.loading;
  ACT_FEED.loading=supa.rpc('get_activity_feed',{p_profile_id:authProfileId}).then(function(r){
    ACT_FEED.loading=null;
    if(r.error||!r.data||r.data.status!=='ok')return null;
    ACT_FEED.data=r.data.items||[];
    return ACT_FEED.data;
  },function(){ACT_FEED.loading=null;return null;});
  return ACT_FEED.loading;
}
/* « à l'instant » / « il y a 2 h » / « il y a 3 j » */
function activityAgo(iso){
  var ts=iso?new Date(iso).getTime():NaN;if(isNaN(ts))return '';
  var mn=Math.round((Date.now()-ts)/60000);if(mn<1)return t('act.justNow');
  try{
    var rtf=new Intl.RelativeTimeFormat(LOCALE,{numeric:'auto'});
    if(mn<60)return rtf.format(-mn,'minute');
    var h=Math.round(mn/60);if(h<24)return rtf.format(-h,'hour');
    return rtf.format(-Math.round(h/24),'day');
  }catch(e){return '';}
}
function activityItemMeta(it){
  return it.kind==='film'?(it.title+' · '+t('status.termine')):(it.title+' · S'+it.season+' E'+it.episode);
}
function activityReactsHtml(it){
  var mine=it.my_reaction,counts=it.reactions||{};
  return '<div class="act-reacts" role="group" aria-label="'+esc(t('act.reactAria'))+'" data-event="'+esc(it.event_id)+'">'+ACT_EMOJI.map(function(em){
    var n=counts[em]||0,on=em===mine;
    return '<button type="button" class="act-react'+(on?' on':'')+'" data-emoji="'+esc(em)+'"'+uiAct('reactTap',[it.event_id,em])+' aria-pressed="'+on+'">'+em+(n?'<em>'+n+'</em>':'')+'</button>';
  }).join('')+'</div>';
}
function activityItemHtml(it,i){
  var ok=it.poster_path&&/^\/[A-Za-z0-9_.-]{1,80}$/.test(it.poster_path);
  return '<li class="act-item" style="--i:'+i+'">'+
    '<button type="button" class="fr-row act-row"'+uiAct('openFriend',[it.friend&&it.friend.profile_id])+'>'+
      friendAvatar(it.friend)+
      '<span class="fr-meta"><b>'+esc(friendName(it.friend))+'</b><span>'+esc(activityItemMeta(it))+'</span></span>'+
      (ok?'<img class="fr-post" alt="" loading="lazy" src="'+IMG_W92+esc(it.poster_path)+'">':'')+
      '<time class="act-time">'+esc(activityAgo(it.updated_at))+'</time>'+
    '</button>'+
    activityReactsHtml(it)+
  '</li>';
}
function activityFeedHtml(){
  var items=ACT_FEED.data;
  if(items===null)return '<div class="act-skel">'+'<i></i>'.repeat(4)+'</div>';
  if(!items.length)return '<div class="fr-empty act-empty"><div class="fr-ghosts" aria-hidden="true"><i></i><i></i><i></i></div><h3>'+esc(t('act.empty'))+'</h3><p class="soc-sub">'+esc(t('act.emptySub'))+'</p></div>';
  return '<ul class="act-list">'+items.map(activityItemHtml).join('')+'</ul>';
}
function activityFeedRefresh(){
  var w=document.querySelector('#socMbk .fr-wrap');if(!w||typeof friendsRefresh!=='function')return;
  friendsRefresh();
}
/* Un tap = pose/remplace ma réaction ; retaper le même la retire. Optimiste, avec reprise sur erreur. */
function reactTap(el,e,eventId,emoji){
  var items=ACT_FEED.data||[],it=items.filter(function(x){return x.event_id===eventId;})[0];
  if(!it)return;
  var prevReaction=it.my_reaction,prevCounts=Object.assign({},it.reactions);
  var removing=prevReaction===emoji,nextCounts=Object.assign({},prevCounts);
  if(prevReaction)nextCounts[prevReaction]=Math.max(0,(nextCounts[prevReaction]||0)-1)||undefined;
  if(!removing)nextCounts[emoji]=(nextCounts[emoji]||0)+1;
  Object.keys(nextCounts).forEach(function(k){if(!nextCounts[k])delete nextCounts[k];});
  it.my_reaction=removing?null:emoji;it.reactions=nextCounts;
  activityFeedRefresh();
  var row=document.querySelector('.act-reacts[data-event="'+eventId+'"]');
  var pop=row&&row.querySelector('.act-react[data-emoji="'+emoji+'"]');
  if(pop){pop.classList.remove('pop');void pop.offsetWidth;pop.classList.add('pop');}
  supa.rpc('react_to_activity',{p_profile_id:authProfileId,p_event_id:eventId,p_emoji:emoji}).then(function(r){
    if(r.error||!r.data||(r.data.status!=='ok'&&r.data.status!=='removed')){
      it.my_reaction=prevReaction;it.reactions=prevCounts;activityFeedRefresh();toast(t('act.err.generic'),'err');return;
    }
    it.my_reaction=r.data.my_reaction||null;it.reactions=r.data.counts||{};
    activityFeedRefresh();
  },function(){it.my_reaction=prevReaction;it.reactions=prevCounts;activityFeedRefresh();toast(t('act.err.generic'),'err');});
}
if(typeof module!=='undefined')module.exports={activityFeedHtml:activityFeedHtml,activityLoad:activityLoad,activityAgo:activityAgo,
  activityItemMeta:activityItemMeta,reactTap:reactTap,ACT_FEED:ACT_FEED,ACT_EMOJI:ACT_EMOJI};
