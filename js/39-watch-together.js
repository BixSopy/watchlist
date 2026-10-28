/* MODULE: Social (étape 3) : « On regarde quoi ? ». Je choisis des amis, la RPC watch_together renvoie
   les titres en commun dans nos listes « à voir » que personne n'a vus ni commencés (amis à liste masquée
   écartés). Filtres : type (film/série/anime, côté serveur) et durée (runtime TMDB, côté client).
   Révélation façon pile de cartes : glisser ou « Suivant », « Mélanger ». « On prend ça » ajoute le titre à
   MA liste seulement, avec une recommandation facultative au groupe (js/38-recommend.js).
   Sans la migration 20261029120000_social_recommandations.sql, l'entrée reste cachée. */
var WT={available:null,step:'pick',to:[],kind:'',dur:'',items:null,hidden:[],deck:[],idx:0,busy:false,runtime:{},chosen:null,grouped:false};
var WT_MAX=8,WT_KINDS=['','film','serie','anime'],WT_DURS=['','short','long'],WT_SHORT=100;

function wtEnabled(){return SOCIAL.available===true&&WT.available!==false;}
function wtEntryHtml(){
  if(!wtEnabled()||!SOCIAL.me||!(SOCIAL.me.friends||[]).length)return '';
  return '<button type="button" class="wt-entry"'+uiAct('openWatchTogether')+'><span class="wt-entry-ic" aria-hidden="true"><i></i><i></i><i></i></span>'+
    '<span><b>'+esc(t('wt.title'))+'</b><em>'+esc(t('wt.entrySub'))+'</em></span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>';
}
function openWatchTogether(){
  if(!wtEnabled())return;
  WT.step='pick';WT.items=null;WT.deck=[];WT.idx=0;WT.chosen=null;WT.grouped=false;WT.busy=false;
  socModal(wtHtml(),{cls:'wt-wrap',label:t('wt.title')});
}
function wtRender(){var w=document.querySelector('#socMbk .wt-wrap');if(!w)return;var x=w.querySelector('.soc-x');w.innerHTML='';if(x)w.appendChild(x);w.insertAdjacentHTML('beforeend',wtHtml());wtBindSwipe();}
function wtSegHtml(name,vals,cur){
  return '<div class="wt-seg" role="radiogroup" aria-label="'+esc(t('wt.'+name))+'">'+vals.map(function(v){
    return '<button type="button" role="radio" aria-checked="'+(v===cur)+'" class="'+(v===cur?'on':'')+'"'+uiAct('wtFilter',[name,v])+'>'+esc(v==='anime'?t('type.anime'):t('wt.'+name+'.'+(v||'all')))+'</button>';
  }).join('')+'</div>';
}
function wtHtml(){
  var h='<p class="rc-kick">'+esc(t('wt.kicker'))+'</p><h2 class="wt-h">'+esc(t('wt.title'))+'</h2>';
  if(WT.step==='pick'){
    var fr=(SOCIAL.me&&SOCIAL.me.friends)||[],n=WT.to.length;
    h+='<p class="soc-sub">'+esc(t('wt.pickSub'))+'</p><ul class="rc-chips" role="group" aria-label="'+esc(t('wt.pickFriends'))+'">'+fr.map(function(f,i){
      var on=WT.to.indexOf(f.profile_id)>=0;
      return '<li style="--i:'+i+'"><button type="button" class="rc-chip'+(on?' on':'')+'" aria-pressed="'+on+'"'+uiAct('wtToggle',[f.profile_id])+'>'+friendAvatar(f)+'<span>'+esc(friendName(f))+'</span><i class="rc-tick" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7"/></svg></i></button></li>';
    }).join('')+'</ul>';
    h+='<div class="wt-filters">'+wtSegHtml('kind',WT_KINDS,WT.kind)+wtSegHtml('dur',WT_DURS,WT.dur)+'</div>';
    return h+'<button type="button" class="soc-cta" id="wtGo"'+(n&&!WT.busy?'':' disabled')+uiAct('wtGo')+'>'+esc(WT.busy?t('wt.searching'):(n?tn('wt.goWith',n):t('wt.pickFirst')))+'</button>';
  }
  var hid=WT.hidden.length?'<p class="soc-note wt-hidden">'+esc(tn('wt.hidden',WT.hidden.length))+'</p>':'';
  if(WT.step==='chosen'&&WT.chosen){
    var c=WT.chosen;
    return h+'<div class="wt-chosen">'+wtPosterHtml(c,'w342')+'<div><p class="wt-ok">'+esc(t('wt.chosenKick'))+'</p><b class="wt-ct">'+esc(c.title)+'</b>'+
      '<p class="soc-sub">'+esc(c.mine?t('wt.alreadyMine'):t('wt.addedMine'))+'</p></div></div>'+
      (typeof recoEnabled==='function'&&recoEnabled()?'<button type="button" class="soc-cta"'+(WT.grouped?' disabled':'')+uiAct('wtTellGroup')+'>'+esc(WT.grouped?t('wt.toldGroup'):t('wt.tellGroup'))+'</button>':'')+
      '<button type="button" class="wt-link"'+uiAct('wtBack')+'>'+esc(t('wt.again'))+'</button><p class="rc-attr">'+esc(t('reco.tmdb'))+'</p>';
  }
  if(!WT.deck.length){
    return h+'<div class="fr-empty wt-empty"><div class="wt-empty-ic" aria-hidden="true">🍿</div><h3>'+esc(t('wt.empty'))+'</h3><p class="soc-sub">'+esc(t(WT.dur?'wt.emptyDur':'wt.emptySub'))+'</p>'+hid+
      '<button type="button" class="soc-cta"'+uiAct('wtBack')+'>'+esc(t('wt.changeFilters'))+'</button></div>';
  }
  var cur=WT.deck[WT.idx%WT.deck.length],nx=WT.deck.length;
  h+='<p class="soc-sub wt-count">'+esc(tn('wt.found',nx))+' · '+(WT.idx%nx+1)+'/'+nx+'</p>';
  h+='<div class="wt-stage"><div class="wt-under" aria-hidden="true"></div><div class="wt-under u2" aria-hidden="true"></div>'+
    '<article class="wt-card" id="wtCard" aria-live="polite">'+wtPosterHtml(cur,'w500')+
    '<div class="wt-meta"><b>'+esc(cur.title)+'</b><span>'+esc([cur.year,(cur.type==='anime'?t('type.anime'):t('wt.kind.'+(cur.type||'film'))),wtRuntimeLabel(cur)].filter(Boolean).join(' · '))+'</span>'+
    '<em class="wt-n">'+esc(tn('wt.wantN',cur.n))+'</em></div></article></div>';
  h+='<div class="wt-acts"><button type="button" class="wt-ic" aria-label="'+esc(t('wt.shuffle'))+'" title="'+esc(t('wt.shuffle'))+'"'+uiAct('wtShuffle')+'>⤨</button>'+
    '<button type="button" class="soc-cta wt-take"'+uiAct('wtTake')+'>'+esc(t('wt.take'))+'</button>'+
    '<button type="button" class="wt-ic" aria-label="'+esc(t('wt.next'))+'" title="'+esc(t('wt.next'))+'"'+uiAct('wtNext')+'>→</button></div>';
  return h+hid+'<button type="button" class="wt-link"'+uiAct('wtBack')+'>'+esc(t('wt.changeFilters'))+'</button><p class="rc-attr">'+esc(t('reco.tmdb'))+'</p>';
}
function wtPosterHtml(x,size){
  return x.poster_path&&/^\/[A-Za-z0-9_.-]{1,100}$/.test(x.poster_path)?'<img class="wt-post" alt="" src="'+IB+size+esc(x.poster_path)+'">':'<span class="wt-post rc-noimg" aria-hidden="true">'+esc((x.title||'?').charAt(0))+'</span>';
}
function wtRuntimeLabel(x){var m=WT.runtime[x.tmdb_type+':'+x.tmdb_id];return m?(m>=60?Math.floor(m/60)+' h '+String(m%60).padStart(2,'0'):m+' min'):'';}
/* Filtre de durée : court < 100 min (épisode de série toujours « court »), long ≥ 100 min. Sans durée connue : gardé. */
function wtMatchDur(x,dur,runtime){
  if(!dur)return true;var m=runtime[x.tmdb_type+':'+x.tmdb_id];
  if(!m)return true;
  return dur==='short'?m<WT_SHORT:m>=WT_SHORT;
}
function wtShuffled(a,rnd){a=a.slice();rnd=rnd||Math.random;for(var i=a.length-1;i>0;i--){var j=Math.floor(rnd()*(i+1)),x=a[i];a[i]=a[j];a[j]=x;}return a;}
function wtFetchRuntimes(items){
  if(typeof tf!=='function'||typeof TB==='undefined')return Promise.resolve();
  var todo=items.filter(function(x){return WT.runtime[x.tmdb_type+':'+x.tmdb_id]===undefined;}).slice(0,40);
  return Promise.all(todo.map(function(x){
    return tf(TB+'/'+x.tmdb_type+'/'+x.tmdb_id+'?language='+(typeof TMDB_LANG!=='undefined'?TMDB_LANG:'fr-FR')).then(function(d){
      var m=d&&(d.runtime||(d.episode_run_time&&d.episode_run_time[0]))||0;WT.runtime[x.tmdb_type+':'+x.tmdb_id]=m;
    },function(){WT.runtime[x.tmdb_type+':'+x.tmdb_id]=0;});
  }));
}
function wtGo(){
  if(!WT.to.length||WT.busy)return;
  WT.busy=true;wtRender();
  supa.rpc('watch_together',{p_profile_id:authProfileId,p_friends:WT.to,p_kind:WT.kind||null}).then(function(r){
    if(r.error){WT.busy=false;if(socialUnavailable(r.error)){WT.available=false;socClose();return toast(t('wt.unavailable'),'nfo');}wtRender();return toast(t('wt.err'),'err');}
    if(!r.data||r.data.status!=='ok'){WT.busy=false;wtRender();return toast(t(r.data&&r.data.status==='too_many'?'wt.tooMany':'wt.err'),'err');}
    WT.items=r.data.items||[];WT.hidden=r.data.hidden||[];
    return wtFetchRuntimes(WT.items).then(function(){
      WT.busy=false;WT.deck=wtShuffled(WT.items.filter(function(x){return wtMatchDur(x,WT.dur,WT.runtime);}));WT.idx=0;WT.step='deck';wtRender();sfx('open');
    });
  },function(){WT.busy=false;wtRender();toast(t('wt.err'),'err');});
}
function wtToggle(el,e,id){
  var i=WT.to.indexOf(id);
  if(i>=0)WT.to.splice(i,1);else{if(WT.to.length>=WT_MAX)return toast(tn('wt.max',WT_MAX),'nfo');WT.to.push(id);}
  sfx('click');wtRender();
}
function wtFilter(el,e,name,v){if(name==='kind'&&WT_KINDS.indexOf(v)>=0)WT.kind=v;else if(name==='dur'&&WT_DURS.indexOf(v)>=0)WT.dur=v;sfx('click');wtRender();}
function wtAnimate(cls,then){
  var c=document.getElementById('wtCard');
  if(!c||(typeof prefersReducedMotion==='function'&&prefersReducedMotion()))return then();
  c.classList.add(cls);setTimeout(then,260);
}
function wtNext(){if(!WT.deck.length)return;sfx('click');wtAnimate('out',function(){WT.idx=(WT.idx+1)%WT.deck.length;wtRender();});}
function wtShuffle(){if(!WT.deck.length)return;sfx('click');wtAnimate('spin',function(){WT.deck=wtShuffled(WT.deck);WT.idx=0;wtRender();});}
function wtBack(){WT.step='pick';WT.chosen=null;wtRender();}
function wtTake(){
  var x=WT.deck[WT.idx%WT.deck.length];if(!x)return;
  var had=typeof recoInMyList==='function'?recoInMyList(x):!!x.mine;
  if(!had&&typeof recoAddToMyList==='function')recoAddToMyList(x);
  WT.chosen=Object.assign({},x,{mine:had});WT.grouped=false;WT.step='chosen';sfx('done');wtRender();
}
function wtTellGroup(){
  var c=WT.chosen;if(!c||WT.grouped||WT.busy)return;
  var to=WT.to.filter(function(id){return WT.hidden.indexOf(id)<0;});if(!to.length)return;
  WT.busy=true;
  supa.rpc('send_recommendation',{p_profile_id:authProfileId,p_to:to,p_tmdb_id:c.tmdb_id,p_tmdb_type:c.tmdb_type,p_media_type:c.type||'film',
    p_title:c.title,p_year:c.year||null,p_poster_path:c.poster_path||null,p_message:t('wt.groupMsg')}).then(function(r){
    WT.busy=false;
    if(r.error||!r.data||r.data.status!=='sent')return toast(t(r.data&&r.data.status==='rate_limited'?'reco.err.rate':'reco.err.generic'),'err');
    WT.grouped=true;toast(tn('reco.sent',to.length));wtRender();
  },function(){WT.busy=false;toast(t('reco.err.generic'),'err');});
}
/* Glisser la carte (souris ou doigt) : au-delà de 80 px, carte suivante */
function wtBindSwipe(){
  var c=document.getElementById('wtCard');if(!c||!c.addEventListener)return;
  var x0=null,dx=0;
  c.addEventListener('pointerdown',function(e){x0=e.clientX;dx=0;c.classList.add('drag');try{c.setPointerCapture(e.pointerId);}catch(_){}});
  c.addEventListener('pointermove',function(e){if(x0===null)return;dx=e.clientX-x0;c.style.transform='translateX('+dx+'px) rotate('+(dx/18)+'deg)';});
  var end=function(){if(x0===null)return;x0=null;c.classList.remove('drag');if(Math.abs(dx)>80){c.style.transform='';wtNext();}else c.style.transform='';};
  c.addEventListener('pointerup',end);c.addEventListener('pointercancel',end);
}
if(typeof module!=='undefined')module.exports={WT:WT,wtEnabled:wtEnabled,wtEntryHtml:wtEntryHtml,wtHtml:wtHtml,wtMatchDur:wtMatchDur,wtShuffled:wtShuffled,
  wtGo:wtGo,wtToggle:wtToggle,wtFilter:wtFilter,wtTake:wtTake,wtTellGroup:wtTellGroup,wtRuntimeLabel:wtRuntimeLabel,wtFetchRuntimes:wtFetchRuntimes};
