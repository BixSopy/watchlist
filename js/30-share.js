/* MODULE: Partage en lecture seule (liens /s/<jeton>, migration 20261013150000_partage_lecture_seule.sql)
   - Opt-in : un lien n'existe que si l'utilisateur le crée ; il peut le désactiver à tout moment.
   - Les titres détectés ne sont jamais partagés (aucune option) ; les notes sont masquées par défaut.
   - Écriture uniquement via les RPC create_share / revoke_share ; la page publique est rendue par /api/share. */
var SHARE={kind:'filtered',st:['encours'],ty:[],hideRatings:true,hideProgress:false,links:null,last:null,busy:false};
function shareUrl(tok){return location.origin+'/s/'+tok;}
/* Titres visibles avec les choix en cours (même règle que get_public_share) */
function shareCount(){
  if(typeof memDB==='undefined')return 0;
  return memDB.filter(function(i){if(i.deleted)return false;if(SHARE.kind!=='filtered')return true;
    var s=i.status==='todo'?'avoir':i.status;return (!SHARE.st.length||SHARE.st.indexOf(s)>=0)&&(!SHARE.ty.length||SHARE.ty.indexOf(i.type)>=0);}).length;
}
function _shSw(on,key){return '<button type="button" class="sh-sw'+(on?' on':'')+'" role="switch" aria-checked="'+(on?'true':'false')+'"'+uiAct('shareTog',[key])+'><span></span></button>';}
function shareHtml(){
  var K=[['list','share.kList','share.kListD'],['filtered','share.kFilt','share.kFiltD'],['profile','share.kProf','share.kProfD']];
  var ST=[['avoir','status.avoir'],['encours','status.encours'],['termine','status.termine']],TY=[['film','type.films'],['serie','type.series'],['anime','type.anime']];
  var h='<div class="sh-wrap" role="dialog" aria-modal="true" aria-labelledby="shTitle"><span class="sh-grab" aria-hidden="true"></span>'+
    '<button type="button" class="sh-x" aria-label="'+esc(t('common.close'))+'"'+uiAct('shareClose')+'>×</button>'+
    '<h2 id="shTitle">'+esc(t('share.title'))+'</h2><p class="sh-sub">'+esc(t('share.sub'))+'</p>'+
    '<div class="sh-kinds">'+K.map(function(k){return '<button type="button" class="sh-kind'+(SHARE.kind===k[0]?' on':'')+'" aria-pressed="'+(SHARE.kind===k[0])+'"'+uiAct('shareKind',[k[0]])+'><b>'+esc(t(k[1]))+'</b><span>'+esc(t(k[2]))+'</span></button>';}).join('')+'</div>';
  if(SHARE.kind==='filtered')h+='<div class="sh-lbl">'+esc(t('share.filter'))+'</div><div class="sh-chips">'+
    ST.map(function(s){var on=SHARE.st.indexOf(s[0])>=0;return '<button type="button" class="'+(on?'on':'')+'" aria-pressed="'+on+'"'+uiAct('shareChip',['st',s[0]])+'>'+esc(t(s[1]))+'</button>';}).join('')+'<i></i>'+
    TY.map(function(s){var on=SHARE.ty.indexOf(s[0])>=0;return '<button type="button" class="'+(on?'on':'')+'" aria-pressed="'+on+'"'+uiAct('shareChip',['ty',s[0]])+'>'+esc(t(s[1]))+'</button>';}).join('')+'</div>';
  h+='<div class="sh-lbl">'+esc(t('share.privacy'))+'</div>'+
    '<div class="sh-row"><div>'+esc(t('share.hideRatings'))+'<small>'+esc(t('share.hideRatingsD'))+'</small></div>'+_shSw(SHARE.hideRatings,'hideRatings')+'</div>'+
    '<div class="sh-row"><div>'+esc(t('share.hideProgress'))+'<small>'+esc(t('share.hideProgressD'))+'</small></div>'+_shSw(SHARE.hideProgress,'hideProgress')+'</div>'+
    '<div class="sh-row"><div>'+esc(t('share.detected'))+'<small>'+esc(t('share.detectedD'))+'</small></div><span class="sh-lock">'+esc(t('share.never'))+'</span></div>';
  if(SHARE.last){
    h+='<div class="sh-link"><span id="shLinkTxt">'+esc(shareUrl(SHARE.last.token))+'</span><button type="button" class="btn btn-p3"'+uiAct('shareCopy')+'>'+esc(t('share.copy'))+'</button>'+
      (navigator.share?'<button type="button" class="sh-ghost"'+uiAct('shareNative')+'>'+esc(t('share.send'))+'</button>':'')+'</div>'+
      '<div class="sh-foot"><span>'+esc(t('share.ro'))+'</span><button type="button" class="sh-rev"'+uiAct('shareRevoke',[SHARE.last.id])+'>'+esc(t('share.revoke'))+'</button></div>';
  }else{
    var n=shareCount();
    h+='<button type="button" class="btn btn-p3 sh-create"'+(SHARE.busy||(SHARE.kind==='filtered'&&!SHARE.st.length&&!SHARE.ty.length)?' disabled':'')+uiAct('shareCreate')+'>'+esc(t('share.create'))+'</button>'+
      '<div class="sh-foot"><span>'+esc(tn('share.count',n))+' · '+esc(t('share.noTrack'))+'</span></div>';
  }
  var act=(SHARE.links||[]).filter(function(l){return !SHARE.last||l.id!==SHARE.last.id;});
  if(act.length)h+='<div class="sh-lbl">'+esc(t('share.active'))+'</div><div class="sh-links">'+act.map(function(l){
    return '<div class="sh-li"><div><b>'+esc(shareLabel(l))+'</b><small>'+esc(tn('share.views',l.view_count||0))+' · /s/'+esc(String(l.token).slice(0,6))+'…</small></div>'+
      '<button type="button" class="sh-ghost"'+uiAct('shareCopyTok',[l.token])+'>'+esc(t('share.copy'))+'</button><button type="button" class="sh-rev"'+uiAct('shareRevoke',[l.id])+'>'+esc(t('share.revokeShort'))+'</button></div>';}).join('')+'</div>';
  return h+'</div>';
}
function shareLabel(l){
  if(l.kind==='profile')return t('share.kProf');if(l.kind==='list')return t('share.kList');
  var p=[];(l.filter_status||[]).forEach(function(s){p.push(t('status.'+s));});(l.filter_types||[]).forEach(function(s){p.push(t(s==='film'?'type.films':s==='serie'?'type.series':'type.anime'));});
  return p.join(' · ')||t('share.kFilt');
}
function shareRender(){var m=document.getElementById('shareMbk');if(m&&m.classList.contains('on'))m.innerHTML=shareHtml();}
function openShare(){
  if(typeof supa==='undefined'||!supa||typeof authUser==='undefined'||!authUser||!authProfileId){
    toast(t('share.needAccount'),'nfo');if(typeof openAuthModal==='function')openAuthModal(supa?'login':null);return;
  }
  var m=document.getElementById('shareMbk');
  if(!m){m=document.createElement('div');m.id='shareMbk';m.className='sh-mbk';document.body.appendChild(m);
    m.addEventListener('click',function(e){if(e.target===m)closeShare();});
    document.addEventListener('keydown',function(e){if(e.key==='Escape'&&m.classList.contains('on'))closeShare();});}
  SHARE.last=null;m.classList.add('on');if(typeof sfx==='function')sfx('open');shareRender();shareLoad();
  var x=m.querySelector('.sh-kind.on');if(x)x.focus();
}
function shareSet(k,v){SHARE[k]=v;SHARE.last=null;shareRender();}
function shareToggleIn(dim,v){var a=SHARE[dim],i=a.indexOf(v);if(i>=0)a.splice(i,1);else a.push(v);SHARE.last=null;shareRender();}
function closeShare(){var m=document.getElementById('shareMbk');if(m)m.classList.remove('on');}
function shareLoad(){
  supa.from('shares').select('id,token,kind,filter_status,filter_types,view_count,created_at').is('revoked_at',null).order('created_at',{ascending:false}).limit(10)
    .then(function(r){if(!r.error){SHARE.links=r.data||[];shareRender();}});
}
function shareCreate(){
  if(SHARE.busy)return;SHARE.busy=true;shareRender();
  supa.rpc('create_share',{p_profile_id:authProfileId,p_kind:SHARE.kind,
    p_filter_status:SHARE.kind==='filtered'&&SHARE.st.length?SHARE.st:null,p_filter_types:SHARE.kind==='filtered'&&SHARE.ty.length?SHARE.ty:null,
    p_hide_ratings:SHARE.hideRatings,p_hide_progress:SHARE.hideProgress,p_display_name:(authUser.user_metadata&&authUser.user_metadata.display_name)||null})
  .then(function(r){
    SHARE.busy=false;var d=r.data||{};
    if(r.error||d.status!=='ok'){toast(t(d.status==='too_many_shares'?'share.errMax':d.status==='rate_limited'?'share.errRate':'share.err'),'err');shareRender();return;}
    SHARE.last={id:d.id,token:d.token};if(typeof sfx==='function')sfx('success');shareRender();shareLoad();
  },function(){SHARE.busy=false;toast(t('share.err'),'err');shareRender();});
}
function shareCopyText(txt){
  var done=function(){toast(t('share.copied'),'ok');};
  if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(txt).then(done,function(){prompt(t('share.copy'),txt);});else prompt(t('share.copy'),txt);
}
function shareRevoke(id){
  if(!confirm(t('share.revokeConfirm')))return;
  supa.rpc('revoke_share',{p_id:id}).then(function(r){
    if(r.error||!r.data||r.data.status!=='ok'){toast(t('share.err'),'err');return;}
    if(SHARE.last&&SHARE.last.id===id)SHARE.last=null;
    SHARE.links=(SHARE.links||[]).filter(function(l){return l.id!==id;});toast(t('share.revoked'),'ok');shareRender();
  });
}

/* « Ajouter à ma liste » depuis une page publique : /?ajouter=tv.123 (+ titre, année, affiche).
   Conservé le temps de l'inscription/connexion, puis la fenêtre d'ajout s'ouvre pré-remplie. */
function sharePendingParse(search){
  var q=new URLSearchParams(search||''),a=q.get('ajouter');if(!a)return null;
  var m=/^(tv|movie)\.(\d{1,9})$/.exec(a);if(!m)return null;
  var p=q.get('p')||'';if(p&&!/^\/[A-Za-z0-9_.-]{1,80}$/.test(p))p='';
  return {tmdbId:+m[2],type:m[1],title:String(q.get('t')||'').slice(0,200),year:String(q.get('y')||'').replace(/[^0-9]/g,'').slice(0,4),poster:p||null};
}
(function(){
  try{
    var d=sharePendingParse(location.search);
    if(d){sessionStorage.setItem('wl_share_add',JSON.stringify(d));history.replaceState(null,'',location.pathname+location.hash);
      if(!/(^| )lp-member( |$)/.test(document.documentElement.className)&&typeof openAuthModal==='function')setTimeout(function(){openAuthModal('signup');},400);}
  }catch(e){}
  var tries=0,iv=setInterval(function(){
    var raw;try{raw=sessionStorage.getItem('wl_share_add');}catch(e){}
    if(!raw||++tries>600){clearInterval(iv);return;}
    if(typeof authUser==='undefined'||!authUser||typeof memDB==='undefined'||typeof recoAddDirect!=='function')return;
    clearInterval(iv);try{sessionStorage.removeItem('wl_share_add');}catch(e){}
    var it=JSON.parse(raw);if(memDB.some(function(i){return i.tmdbId==it.tmdbId&&!i.deleted;})){toast(t('add.dup',{title:it.title}),'nfo');return;}
    recoAddDirect(it);
  },500);
})();
if(typeof module!=='undefined')module.exports={sharePendingParse:sharePendingParse};
