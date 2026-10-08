/* MODULE: Menu « Réglages » (UI) et export JSON de la watchlist. */
/* MENU */
function toggleMenu(){
  var menu=document.getElementById('optMenu');
  var opening=!menu.classList.contains('on');
  menu.classList.toggle('on');
  if(!opening)closeSettingsView();
}
document.addEventListener('click',function(e){
  var menu=document.getElementById('optMenu');
  if(!e.target.closest('.hbtn')&&!e.target.closest('.opt-menu')){menu.classList.remove('on');closeSettingsView();}
});
document.addEventListener('keydown',function(e){
  if(e.key==='Escape'){
    var menu=document.getElementById('optMenu');
    if(menu.classList.contains('on')){menu.classList.remove('on');closeSettingsView();}
  }
});

/* Session 11B : panneau Réglages */
function openSettingsView(){
  loadSettings();
  document.getElementById('optMenuMain').style.display='none';
  document.getElementById('optMenuSettings').style.display='flex';
  renderSettingsMenu();
  sfx('click');
}
function closeSettingsView(){
  var mv=document.getElementById('optMenuMain'),sv=document.getElementById('optMenuSettings');
  if(mv)mv.style.display='flex';
  if(sv)sv.style.display='none';
}
function _toggleRow(label,hint,key,checked){
  return '<div class="setting-row"><div class="setting-copy"><div class="setting-label">'+label+'</div>'+(hint?'<div class="setting-hint">'+hint+'</div>':'')+'</div><div class="setting-control"><div class="toggle-switch'+(checked?' on':'')+'" onclick="_onSettingToggle(\''+key+'\',this)"><div class="knob"></div></div></div></div>';
}
function _delegatedToggleRow(label,hint,fnName,checked){
  return '<div class="setting-row"><div class="setting-copy"><div class="setting-label">'+label+'</div>'+(hint?'<div class="setting-hint">'+hint+'</div>':'')+'</div><div class="setting-control"><div class="toggle-switch'+(checked?' on':'')+'" onclick="'+fnName+'();renderSettingsMenu()"><div class="knob"></div></div></div></div>';
}
function _selectRow(label,key,options,current){
  var opts=options.map(function(o){return '<option value="'+o.v+'"'+(o.v===current?' selected':'')+'>'+o.l+'</option>';}).join('');
  return '<div class="setting-row"><div class="setting-copy"><div class="setting-label">'+label+'</div></div><div class="setting-control"><select class="settings-select" onchange="_onSettingSelect(\''+key+'\',this.value)">'+opts+'</select></div></div>';
}
function _rangeRow(label,hint,key,value){
  return '<div class="setting-row setting-row-col"><div class="setting-copy" style="display:flex;justify-content:space-between;align-items:baseline"><div class="setting-label">'+label+'</div><div class="setting-hint" id="_rangeVal_'+key+'" style="margin:0">'+value+'%</div></div>'+(hint?'<div class="setting-hint">'+hint+'</div>':'')+'<input type="range" class="settings-range" min="0" max="100" step="5" value="'+value+'" oninput="_onSettingRange(\''+key+'\',this.value)"></div>';
}
/* Raccourcis clavier (voir js/18-bootstrap.js) — informatif, aucune action au clic. */
function _kbdRow(key,label){
  return '<div class="kbd-row"><div class="setting-label">'+label+'</div><div class="kbd-key">'+key+'</div></div>';
}
/* Bloc copiable (URL/en-têtes/gabarit JSON à coller dans Tautulli) */
function _webhookCodeField(id,label,text){
  return '<div class="webhook-field"><div class="webhook-field-lbl">'+label+'</div><div class="webhook-code-row">'+
    '<div class="webhook-code" id="'+id+'">'+esc(text)+'</div>'+
    '<button type="button" class="webhook-copy-btn" onclick="copyWebhookText(\''+id+'\')">'+esc(t('common.copy'))+'</button>'+
    '</div></div>';
}
function copyWebhookText(id){
  var el=document.getElementById(id);if(!el)return;
  var text=el.textContent;
  (navigator.clipboard?navigator.clipboard.writeText(text):Promise.reject()).then(function(){
    sfx('click');toast(t('common.copied'));
  }).catch(function(){toast(t('common.copyFailed'),'err');});
}
/* Section "Suivi auto" (Session 19) : un seul jeton, utilisé par l'extension navigateur
 * ET par Tautulli (Plex) -> mark_watched_by_token()/mark_watched_by_title(). Le détail
 * technique Tautulli (URL/en-têtes/gabarits) est replié par défaut : la plupart des gens
 * n'utilisent que l'extension, qui n'a besoin que du jeton tout seul. */
var _plexWebhookAdvancedOpen=false;
function togglePlexWebhookAdvanced(){_plexWebhookAdvancedOpen=!_plexWebhookAdvancedOpen;sfx('click');renderSettingsMenu();}
function _plexWebhookSection(){
  var html='<div class="settings-section"><div class="settings-section-title">'+esc(t('set.autoTrack'))+'</div>';
  if(!supa||!authProfileId){
    html+='<div class="setting-hint">'+esc(t('set.autoTrackLogin'))+'</div>';
    html+='</div>';
    return html;
  }
  if(!_plexWebhookTokenLoaded){
    html+='<div class="setting-hint">'+esc(t('common.loading'))+'</div></div>';
    loadPlexWebhookToken(function(){renderSettingsMenu();});
    return html;
  }
  if(!plexWebhookToken){
    html+='<div class="setting-hint">'+esc(t('set.tokenIntro'))+'</div>';
    html+='<div class="settings-action-row" onclick="generatePlexWebhookToken()"><div class="setting-label">'+esc(t('set.tokenGenerate'))+'</div></div>';
    html+='</div>';
    return html;
  }
  html+=_webhookCodeField('whToken',esc(t('set.yourToken')),plexWebhookToken);
  html+='<div class="setting-hint">'+esc(t('set.tokenHelp'))+'</div>';
  html+='<div class="settings-action-row" onclick="togglePlexWebhookAdvanced()"><div class="setting-label">'+esc(_plexWebhookAdvancedOpen?t('set.hide'):t('set.tautulliAdvanced'))+'</div></div>';
  if(_plexWebhookAdvancedOpen){
    var rpcUrl=SUPA_URL+'/rest/v1/rpc/mark_watched_by_token';
    var headers=JSON.stringify({apikey:SUPA_KEY},null,0);
    var bodyEp=JSON.stringify({p_token:plexWebhookToken,p_tmdb_id:'{themoviedb_id}',p_season:'{season_num}',p_episode:'{episode_num}'},null,0).replace(/"\{/g,'{').replace(/\}"/g,'}');
    var bodyFilm=JSON.stringify({p_token:plexWebhookToken,p_tmdb_id:'{themoviedb_id}',p_season:null,p_episode:null},null,0).replace(/"\{/g,'{').replace(/\}"/g,'}');
    html+='<div class="setting-hint">'+t('set.tautulliHelp')+'</div>';
    html+=_webhookCodeField('whUrl','URL',rpcUrl);
    html+=_webhookCodeField('whHeaders',esc(t('set.headers')),headers);
    html+=_webhookCodeField('whBodyEp',esc(t('set.bodyEp')),bodyEp);
    html+=_webhookCodeField('whBodyFilm',esc(t('set.bodyFilm')),bodyFilm);
  }
  html+='<div class="settings-action-row" onclick="generatePlexWebhookToken()"><div class="setting-label">'+esc(t('set.tokenRegenerate'))+'</div></div>';
  html+='</div>';
  return html;
}
function _onSettingToggle(key,el){
  var newVal=(wlSettings[key]==='1')?'0':'1';
  saveSetting(key,newVal);
  el.classList.toggle('on',newVal==='1');
  _onSettingChanged(key,newVal);
}
function _onSettingSelect(key,val){
  saveSetting(key,val);
  _onSettingChanged(key,val);
}
function _onSettingRange(key,val){
  /* Pas de sfx ici : oninput se déclenche en continu pendant qu'on glisse le curseur */
  saveSetting(key,val);
  var lbl=document.getElementById('_rangeVal_'+key);if(lbl)lbl.textContent=val+'%';
  if(key==='wl_glass')applyGlass(parseInt(val,10));
  if(key==='wl_grain')applyGrain(parseInt(val,10));
  if(key==='wl_aurora')applyAurora(parseInt(val,10));
}
function _onSettingChanged(key,val){
  if(key==='wl_grid_cols'||key==='wl_card_ratings'||key==='wl_card_badges'||key==='wl_suivi_providers'||key==='wl_glow_border'){
    applySettings();
  }
  if(key==='wl_reco_autoscroll'){
    if(val==='0')stopAutoScroll();else startAutoScroll();
  }
  if(key==='wl_reco_limit'){
    loadRecos();
  }
  sfx('click');
}
function renderSettingsMenu(){
  var body=document.getElementById('settingsBody');
  if(!body)return;
  var pending=memDB.filter(function(i){return i.needsSync;}).length;
  var syncLabel=esc(!supa?t('set.unavailable'):(authUser?(pending?tn('set.pending',pending):t('sync.synced')):t('set.notSignedIn')));
  var html='';
  html+='<div class="settings-section"><div class="settings-section-title">'+esc(t('lang.label'))+'</div>'+langSwitcherHtml('lang-switch-settings',"{reopen:'settings'}")+'</div><div class="opt-sep"></div>';
  html+='<div class="settings-section"><div class="settings-section-title">'+esc(t('set.appearance'))+'</div>';
  html+=_delegatedToggleRow(esc(t('set.compact')),'','toggleCompact',compactOn);
  html+=_delegatedToggleRow(esc(t('set.sounds')),'','toggleSound',soundOn);
  html+=_selectRow(esc(t('set.grid')),'wl_grid_cols',[{v:'auto',l:esc(t('set.auto'))},{v:'4',l:esc(t('set.cols4'))},{v:'5',l:esc(t('set.cols5'))},{v:'6',l:esc(t('set.cols6'))},{v:'7',l:esc(t('set.cols7'))}],wlSettings.wl_grid_cols);
  html+=_selectRow(esc(t('set.cardRatings')),'wl_card_ratings',[{v:'both',l:esc(t('set.both'))},{v:'my',l:esc(t('set.myOnly'))},{v:'tmdb',l:esc(t('set.tmdbOnly'))},{v:'off',l:esc(t('set.hide'))}],wlSettings.wl_card_ratings);
  html+=_selectRow(esc(t('set.cardBadges')),'wl_card_badges',[{v:'full',l:esc(t('set.full'))},{v:'off',l:esc(t('set.hide'))}],wlSettings.wl_card_badges);
  html+=_rangeRow(esc(t('set.glass')),esc(t('set.glassHint')),'wl_glass',wlSettings.wl_glass);
  html+=_rangeRow(esc(t('set.grain')),esc(t('set.grainHint')),'wl_grain',wlSettings.wl_grain);
  html+=_rangeRow(esc(t('set.aurora')),esc(t('set.auroraHint')),'wl_aurora',wlSettings.wl_aurora);
  html+=_toggleRow(esc(t('set.glow')),esc(t('set.glowHint')),'wl_glow_border',wlSettings.wl_glow_border==='1');
  html+='</div><div class="opt-sep"></div>';
  html+='<div class="settings-section"><div class="settings-section-title">'+esc(t('set.recos'))+'</div>';
  html+=_toggleRow(esc(t('set.autoscroll')),'','wl_reco_autoscroll',wlSettings.wl_reco_autoscroll==='1');
  html+=_selectRow(esc(t('set.speed')),'wl_reco_speed',[{v:'slow',l:esc(t('set.slow'))},{v:'normal',l:esc(t('set.normal'))},{v:'fast',l:esc(t('set.fast'))}],wlSettings.wl_reco_speed);
  html+=_toggleRow(esc(t('set.pauseHover')),'','wl_reco_pause_hover',wlSettings.wl_reco_pause_hover==='1');
  html+=_selectRow(esc(t('set.recoLimit')),'wl_reco_limit',[{v:'10',l:'10'},{v:'15',l:'15'},{v:'20',l:'20'}],wlSettings.wl_reco_limit);
  html+='<div class="settings-action-row" onclick="resetDismissedRecos()"><div class="setting-label">'+esc(t('set.resetDismissed'))+'</div><div class="setting-hint">'+esc(t('set.resetDismissedHint'))+'</div></div>';
  html+='<div class="settings-action-row" onclick="clearDiscoveryCache()"><div class="setting-label">'+esc(t('set.clearCache'))+'</div><div class="setting-hint">'+esc(t('set.clearCacheHint'))+'</div></div>';
  html+='</div><div class="opt-sep"></div>';
  html+='<div class="settings-section"><div class="settings-section-title">'+esc(t('set.suivi'))+'</div>';
  html+=_delegatedToggleRow(esc(t('set.suiviCollapsed')),'','toggleSuiviSection',suiviCollapsed);
  html+=_toggleRow(esc(t('set.providers')),'','wl_suivi_providers',wlSettings.wl_suivi_providers==='1');
  html+=_toggleRow(esc(t('set.reminders')),esc(t('set.remindersHint')),'wl_reminders_global',wlSettings.wl_reminders_global==='1');
  html+='</div><div class="opt-sep"></div>';
  html+=_plexWebhookSection()+'<div class="opt-sep"></div>';
  html+='<div class="settings-section"><div class="settings-section-title">'+esc(t('set.data'))+'</div>';
  html+='<div class="settings-action-row" onclick="openAuthModal();toggleMenu()"><div class="setting-row" style="padding:0"><div class="setting-label">'+esc(t('set.accountSync'))+'</div><div class="settings-sync-badge">'+syncLabel+'</div></div></div>';
  if(authUser)html+='<div class="settings-action-row" onclick="exportAccountData();toggleMenu()"><div class="setting-row" style="padding:0"><div class="setting-label">'+esc(t('set.exportGdpr'))+'</div></div></div>';
  html+='<div class="setting-hint"><a href="'+esc(legalUrl('privacy'))+'" style="color:var(--text2)">'+esc(t('legal.privacy'))+'</a> · <a href="'+esc(legalUrl('terms'))+'" style="color:var(--text2)">'+esc(t('legal.terms'))+'</a></div>';
  html+='</div><div class="opt-sep"></div>';
  html+='<div class="settings-section"><div class="settings-section-title">'+esc(t('set.shortcuts'))+'</div>';
  html+=_kbdRow('N',esc(t('add.title')));
  html+=_kbdRow('F',esc(t('set.kbdSearch')));
  html+=_kbdRow('S',esc(t('set.kbdStats')));
  html+=_kbdRow('C',esc(t('set.compact')));
  html+=_kbdRow('M',esc(t('set.sounds')));
  html+=_kbdRow(esc(t('set.kbdEsc')),esc(t('set.kbdClose')));
  html+='<div class="setting-hint" style="margin-top:4px">'+esc(t('set.shortcutsHint'))+'</div>';
  html+='</div>';
  body.innerHTML=html;
  enhanceAllSelects(body);
}

/* EXPORT */
function exportJSON(){
  if(!memDB.length){toast(t('export.empty'),'err');return;}
  var payload={version:2,exportedAt:new Date().toISOString(),count:memDB.length,entries:memDB};
  var blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  var a=document.createElement('a');
  var d=new Date();
  var ds=d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
  a.href=URL.createObjectURL(blob);
  a.download=String(BRAND.shortName).toLowerCase().replace(/[^a-z0-9]+/g,'-')+'_'+ds+'.json';
  a.click();
  URL.revokeObjectURL(a.href);
  sfx('done');
  toast(tn('export.done',memDB.length));
}


