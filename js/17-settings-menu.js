/* MODULE: Menu « Réglages » (UI) et export JSON de la watchlist. */
/* MENU */
function toggleMenu(){
  var menu=document.getElementById('optMenu');
  var opening=!menu.classList.contains('on');
  menu.classList.toggle('on');
  if(!opening)closeSettingsView();
}
/* Clic en dehors du menu : on le ferme. Le chemin de l'événement (composedPath) est figé au moment du clic :
   un interrupteur qui redessine le panneau pendant le clic (Mode compact, Sons, Section Suivi repliée)
   est détaché du document quand cet écouteur passe, et e.target.closest('.opt-menu')
   renvoyait null, ce qui fermait le menu. */
document.addEventListener('click',function(e){
  var menu=document.getElementById('optMenu');
  var path=e.composedPath?e.composedPath():[];
  if(path.indexOf(menu)>=0)return;
  if(!document.contains(e.target))return;
  if(e.target.closest('.hbtn')||e.target.closest('.opt-menu'))return;
  menu.classList.remove('on');closeSettingsView();
});
document.addEventListener('keydown',function(e){
  if(e.key==='Escape'){
    var menu=document.getElementById('optMenu');
    if(menu.classList.contains('on')){menu.classList.remove('on');closeSettingsView();}
  }
});

/* Session 11B : panneau Réglages */
var _settingsAnimate=false;
function openSettingsView(){
  loadSettings();
  document.getElementById('optMenuMain').style.display='none';
  document.getElementById('optMenuSettings').style.display='flex';
  document.getElementById('optMenu').classList.add('settings-open');
  _settingsAnimate=true;
  renderSettingsMenu();
  sfx('click');
}
function closeSettingsView(){
  var mv=document.getElementById('optMenuMain'),sv=document.getElementById('optMenuSettings');
  if(mv)mv.style.display='flex';
  if(sv)sv.style.display='none';
  var menu=document.getElementById('optMenu');if(menu)menu.classList.remove('settings-open');
}
/* Icônes des sections (même trait que les onglets/la fiche titre : stroke 2, sans remplissage) */
var SET_ICONS={
  lang:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 4 5.8 4 9s-1.5 6.5-4 9c-2.5-2.5-4-5.8-4-9s1.5-6.5 4-9z"/>',
  appearance:'<line x1="4" y1="7" x2="20" y2="7"/><circle cx="9" cy="7" r="2.3"/><line x1="4" y1="17" x2="20" y2="17"/><circle cx="15" cy="17" r="2.3"/>',
  reco:'<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/>',
  suivi:'<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/>',
  token:'<path d="M10 14a5 5 0 0 0 7 0l2.5-2.5a5 5 0 0 0-7-7L11 6"/><path d="M14 10a5 5 0 0 0-7 0L4.5 12.5a5 5 0 0 0 7 7L13 18"/>',
  data:'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  kbd:'<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 10h.01M11 10h.01M15 10h.01M17 10h.01M7 14h10"/>'
};
function _secIcon(name){return '<span class="settings-section-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(SET_ICONS[name]||'')+'</svg></span>';}
/* labelHtml est déjà échappé par l'appelant (même convention que le reste du fichier) */
function _secTitle(iconName,labelHtml){return '<div class="settings-section-title">'+_secIcon(iconName)+labelHtml+'</div>';}
/* Carte de section animée en cascade à l'ouverture (délai croissant, négligeable au clavier/lecteur d'écran) */
function _secOpen(idx){return '<div class="settings-section" style="animation-delay:'+(idx*0.045).toFixed(3)+'s">';}
function _toggleRow(label,hint,key,checked){
  return '<div class="setting-row"><div class="setting-copy"><div class="setting-label">'+label+'</div>'+(hint?'<div class="setting-hint">'+hint+'</div>':'')+'</div><div class="setting-control"><div class="toggle-switch'+(checked?' on':'')+'" '+uiAct('settingToggle',[key])+'><div class="knob"></div></div></div></div>';
}
function _delegatedToggleRow(label,hint,fnName,checked){
  return '<div class="setting-row"><div class="setting-copy"><div class="setting-label">'+label+'</div>'+(hint?'<div class="setting-hint">'+hint+'</div>':'')+'</div><div class="setting-control"><div class="toggle-switch'+(checked?' on':'')+'" '+uiAct('settingFn',[fnName])+'><div class="knob"></div></div></div></div>';
}
function _selectRow(label,key,options,current){
  var opts=options.map(function(o){return '<option value="'+o.v+'"'+(o.v===current?' selected':'')+'>'+o.l+'</option>';}).join('');
  return '<div class="setting-row"><div class="setting-copy"><div class="setting-label">'+label+'</div></div><div class="setting-control"><select class="settings-select"'+uiAct('settingSelect',[key],'change')+'>'+opts+'</select></div></div>';
}
function _rangeRow(label,hint,key,value){
  return '<div class="setting-row setting-row-col"><div class="setting-copy" style="display:flex;justify-content:space-between;align-items:baseline"><div class="setting-label">'+label+'</div><div class="setting-hint" id="_rangeVal_'+key+'" style="margin:0">'+value+'%</div></div>'+(hint?'<div class="setting-hint">'+hint+'</div>':'')+'<input type="range" class="settings-range" min="0" max="100" step="5" value="'+value+'" '+uiAct('settingRange',[key],'input')+'></div>';
}
/* Raccourcis clavier (voir js/18-bootstrap.js) — informatif, aucune action au clic. */
function _kbdRow(key,label){
  return '<div class="kbd-row"><div class="setting-label">'+label+'</div><div class="kbd-key">'+key+'</div></div>';
}
/* Bloc copiable (ex. le jeton de suivi auto) */
function _tokenCodeField(id,label,text){
  return '<div class="webhook-field"><div class="webhook-field-lbl">'+label+'</div><div class="webhook-code-row">'+
    '<div class="webhook-code" id="'+id+'">'+esc(text)+'</div>'+
    '<button type="button" class="webhook-copy-btn" '+uiAct('copyToken',[id])+'>'+esc(t('common.copy'))+'</button>'+
    '</div></div>';
}
function copyTokenText(id){
  var el=document.getElementById(id);if(!el)return;
  var text=el.textContent;
  (navigator.clipboard?navigator.clipboard.writeText(text):Promise.reject()).then(function(){
    sfx('click');toast(t('common.copied'));
  }).catch(function(){toast(t('common.copyFailed'),'err');});
}
/* Section "Suivi auto" (Session 19) : un seul jeton, collé dans l'extension navigateur
 * (Netflix, Crunchyroll, Prime Video) pour authentifier mark_watched_by_title(). */
function _trackTokenSection(idx){
  var html=_secOpen(idx)+_secTitle('token',esc(t('set.autoTrack')));
  if(!supa||!authProfileId){
    html+='<div class="setting-hint">'+esc(t('set.autoTrackLogin'))+'</div>';
    html+='</div>';
    return html;
  }
  if(!_trackTokenLoaded){
    html+='<div class="setting-hint">'+esc(t('common.loading'))+'</div></div>';
    loadTrackToken(function(){renderSettingsMenu();});
    return html;
  }
  if(!trackToken){
    html+='<div class="setting-hint">'+esc(t('set.tokenIntro'))+'</div>';
    html+='<div class="settings-action-row" data-click="genTrackToken"><div class="setting-label">'+esc(t('set.tokenGenerate'))+'</div></div>';
    html+='</div>';
    return html;
  }
  html+=_tokenCodeField('whToken',esc(t('set.yourToken')),trackToken);
  html+='<div class="setting-hint">'+esc(t('set.tokenHelp'))+'</div>';
  html+='<div class="settings-action-row" data-click="genTrackToken"><div class="setting-label">'+esc(t('set.tokenRegenerate'))+'</div></div>';
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
  /* Pas de clic ici : oninput se déclenche en continu pendant qu'on glisse le curseur (sauf aperçu du volume) */
  saveSetting(key,val);
  var lbl=document.getElementById('_rangeVal_'+key);if(lbl)lbl.textContent=val+'%';
  if(key==='wl_glass')applyGlass(parseInt(val,10));
  if(key==='wl_grain')applyGrain(parseInt(val,10));
  if(key==='wl_aurora')applyAurora(parseInt(val,10));
  if(key==='wl_snd_vol'){
    setSfxVolume(parseInt(val,10)/100);
    /* Aperçu du volume pendant le glissement, au plus un son toutes les 200 ms */
    var now=Date.now();if(now-_sndVolPreviewAt>200){_sndVolPreviewAt=now;sfx('click');}
  }
}
var _sndVolPreviewAt=0;
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
  /* Position de défilement conservée quand le panneau est redessiné (interrupteurs, jeton…) */
  var menuEl=document.getElementById('optMenu'),scrollY=menuEl?menuEl.scrollTop:0;
  /* Écran tactile : pas de réglages « au survol » ni de raccourcis clavier ; grille fixe à 2 colonnes sous 400 px */
  var touch=typeof _isTouchUi==='function'&&_isTouchUi();
  var pending=memDB.filter(function(i){return i.needsSync;}).length;
  var syncLabel=esc(!supa?t('set.unavailable'):(authUser?(pending?tn('set.pending',pending):t('sync.synced')):t('set.notSignedIn')));
  var html='';
  var idx=0;
  html+=_secOpen(idx++)+_secTitle('lang',esc(t('lang.label')))+langSwitcherHtml('lang-switch-settings',{reopen:'settings'})+'</div>';
  html+=_secOpen(idx++)+_secTitle('appearance',esc(t('set.appearance')));
  html+=_delegatedToggleRow(esc(t('set.compact')),'','toggleCompact',compactOn);
  html+=_delegatedToggleRow(esc(t('set.sounds')),'','toggleSound',soundOn);
  html+=_rangeRow(esc(t('set.soundVolume')),'','wl_snd_vol',wlSettings.wl_snd_vol);
  if(window.innerWidth>400)html+=_selectRow(esc(t('set.grid')),'wl_grid_cols',[{v:'auto',l:esc(t('set.auto'))},{v:'4',l:esc(t('set.cols4'))},{v:'5',l:esc(t('set.cols5'))},{v:'6',l:esc(t('set.cols6'))},{v:'7',l:esc(t('set.cols7'))}],wlSettings.wl_grid_cols);
  html+=_selectRow(esc(t('set.cardRatings')),'wl_card_ratings',[{v:'both',l:esc(t('set.both'))},{v:'my',l:esc(t('set.myOnly'))},{v:'tmdb',l:esc(t('set.tmdbOnly'))},{v:'off',l:esc(t('set.hide'))}],wlSettings.wl_card_ratings);
  html+=_selectRow(esc(t('set.cardBadges')),'wl_card_badges',[{v:'full',l:esc(t('set.full'))},{v:'off',l:esc(t('set.hide'))}],wlSettings.wl_card_badges);
  html+=_rangeRow(esc(t('set.glass')),esc(t('set.glassHint')),'wl_glass',wlSettings.wl_glass);
  html+=_rangeRow(esc(t('set.grain')),esc(t('set.grainHint')),'wl_grain',wlSettings.wl_grain);
  html+=_rangeRow(esc(t('set.aurora')),esc(t('set.auroraHint')),'wl_aurora',wlSettings.wl_aurora);
  if(!touch)html+=_toggleRow(esc(t('set.glow')),esc(t('set.glowHint')),'wl_glow_border',wlSettings.wl_glow_border==='1');
  html+='</div>';
  html+=_secOpen(idx++)+_secTitle('reco',esc(t('set.recos')));
  html+=_toggleRow(esc(t('set.autoscroll')),'','wl_reco_autoscroll',wlSettings.wl_reco_autoscroll==='1');
  html+=_selectRow(esc(t('set.speed')),'wl_reco_speed',[{v:'slow',l:esc(t('set.slow'))},{v:'normal',l:esc(t('set.normal'))},{v:'fast',l:esc(t('set.fast'))}],wlSettings.wl_reco_speed);
  if(!touch)html+=_toggleRow(esc(t('set.pauseHover')),'','wl_reco_pause_hover',wlSettings.wl_reco_pause_hover==='1');
  html+=_selectRow(esc(t('set.recoLimit')),'wl_reco_limit',[{v:'10',l:'10'},{v:'15',l:'15'},{v:'20',l:'20'}],wlSettings.wl_reco_limit);
  html+='<div class="settings-action-row" data-click="resetDismissed"><div class="setting-label">'+esc(t('set.resetDismissed'))+'</div><div class="setting-hint">'+esc(t('set.resetDismissedHint'))+'</div></div>';
  html+='<div class="settings-action-row" data-click="clearDiscoveryCache"><div class="setting-label">'+esc(t('set.clearCache'))+'</div><div class="setting-hint">'+esc(t('set.clearCacheHint'))+'</div></div>';
  html+='</div>';
  html+=_secOpen(idx++)+_secTitle('suivi',esc(t('set.suivi')));
  html+=_delegatedToggleRow(esc(t('set.suiviCollapsed')),'','toggleSuiviSection',suiviCollapsed);
  html+=_toggleRow(esc(t('set.providers')),'','wl_suivi_providers',wlSettings.wl_suivi_providers==='1');
  html+=_toggleRow(esc(t('set.reminders')),esc(t('set.remindersHint')),'wl_reminders_global',wlSettings.wl_reminders_global==='1');
  html+='</div>';
  html+=_trackTokenSection(idx++);
  html+=_secOpen(idx++)+_secTitle('data',esc(t('set.data')));
  html+='<div class="settings-action-row" data-click="menuAccount"><div class="setting-row" style="padding:0"><div class="setting-label">'+esc(t('set.accountSync'))+'</div><div class="settings-sync-badge">'+syncLabel+'</div></div></div>';
  if(authUser)html+='<div class="settings-action-row" data-click="menuExportAccount"><div class="setting-row" style="padding:0"><div class="setting-label">'+esc(t('set.exportGdpr'))+'</div></div></div>';
  html+='<div class="setting-hint"><a href="'+esc(legalUrl('privacy'))+'" style="color:var(--text2)">'+esc(t('legal.privacy'))+'</a> · <a href="'+esc(legalUrl('terms'))+'" style="color:var(--text2)">'+esc(t('legal.terms'))+'</a></div>';
  html+='</div>';
  if(!touch){
  html+=_secOpen(idx++)+_secTitle('kbd',esc(t('set.shortcuts')));
  html+=_kbdRow('N',esc(t('add.title')));
  html+=_kbdRow('F',esc(t('set.kbdSearch')));
  html+=_kbdRow('S',esc(t('set.kbdStats')));
  html+=_kbdRow('C',esc(t('set.compact')));
  html+=_kbdRow('M',esc(t('set.sounds')));
  html+=_kbdRow(esc(t('set.kbdEsc')),esc(t('set.kbdClose')));
  html+='<div class="setting-hint" style="margin-top:4px">'+esc(t('set.shortcutsHint'))+'</div>';
  html+='</div>';
  }
  body.innerHTML=html;
  body.classList.toggle('settings-anim',_settingsAnimate);
  _settingsAnimate=false;
  enhanceAllSelects(body);
  if(menuEl&&scrollY)menuEl.scrollTop=scrollY;
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


