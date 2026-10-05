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
  var syncLabel=!supa?'Indisponible':(authUser?(pending?(pending+' élément'+(pending>1?'s':'')+' en attente'):'Synchronisé'):'Non connecté');
  var html='';
  html+='<div class="settings-section"><div class="settings-section-title">Apparence</div>';
  html+=_delegatedToggleRow('Mode compact','','toggleCompact',compactOn);
  html+=_delegatedToggleRow('Sons d\'interface','','toggleSound',soundOn);
  html+=_selectRow('Grille watchlist','wl_grid_cols',[{v:'auto',l:'Automatique'},{v:'4',l:'4 colonnes'},{v:'5',l:'5 colonnes'},{v:'6',l:'6 colonnes'},{v:'7',l:'7 colonnes'}],wlSettings.wl_grid_cols);
  html+=_selectRow('Notes sur les cartes','wl_card_ratings',[{v:'both',l:'Les deux'},{v:'my',l:'Ma note seulement'},{v:'tmdb',l:'TMDB seulement'},{v:'off',l:'Masquer'}],wlSettings.wl_card_ratings);
  html+=_selectRow('Badges de cartes','wl_card_badges',[{v:'full',l:'Complets'},{v:'off',l:'Masquer'}],wlSettings.wl_card_badges);
  html+=_rangeRow('Transparence des pop-up','0% = panneaux pleins, 100% = très translucide','wl_glass',wlSettings.wl_glass);
  html+=_rangeRow('Grain filmique','Texture subtile sur le fond. 0% = désactivé.','wl_grain',wlSettings.wl_grain);
  html+=_rangeRow('Aurora','Taches de couleur animées en arrière-plan. 0% = désactivé.','wl_aurora',wlSettings.wl_aurora);
  html+=_toggleRow('Lueur au survol','Anneau dégradé animé sur les cartes et affiches.','wl_glow_border',wlSettings.wl_glow_border==='1');
  html+='</div><div class="opt-sep"></div>';
  html+='<div class="settings-section"><div class="settings-section-title">Recommandations</div>';
  html+=_toggleRow('Défilement automatique','','wl_reco_autoscroll',wlSettings.wl_reco_autoscroll==='1');
  html+=_selectRow('Vitesse de défilement','wl_reco_speed',[{v:'slow',l:'Lent'},{v:'normal',l:'Normal'},{v:'fast',l:'Rapide'}],wlSettings.wl_reco_speed);
  html+=_toggleRow('Pause au survol','','wl_reco_pause_hover',wlSettings.wl_reco_pause_hover==='1');
  html+=_selectRow('Suggestions affichées','wl_reco_limit',[{v:'10',l:'10'},{v:'15',l:'15'},{v:'20',l:'20'}],wlSettings.wl_reco_limit);
  html+='<div class="settings-action-row" onclick="resetDismissedRecos()"><div class="setting-label">Réinitialiser les titres ignorés</div><div class="setting-hint">Réaffiche les recommandations masquées avec « Non ».</div></div>';
  html+='<div class="settings-action-row" onclick="clearDiscoveryCache()"><div class="setting-label">Vider le cache Discovery</div><div class="setting-hint">Force un nouveau chargement des rangées et suggestions TMDB.</div></div>';
  html+='</div><div class="opt-sep"></div>';
  html+='<div class="settings-section"><div class="settings-section-title">Suivi</div>';
  html+=_delegatedToggleRow('Replier Suivi au démarrage','','toggleSuiviSection',suiviCollapsed);
  html+=_toggleRow('Afficher les plateformes','','wl_suivi_providers',wlSettings.wl_suivi_providers==='1');
  html+=_toggleRow('Rappels navigateur','Les rappels individuels restent conservés.','wl_reminders_global',wlSettings.wl_reminders_global==='1');
  html+='</div><div class="opt-sep"></div>';
  html+='<div class="settings-section"><div class="settings-section-title">Données</div>';
  html+='<div class="settings-action-row" onclick="openAuthModal();toggleMenu()"><div class="setting-row" style="padding:0"><div class="setting-label">Compte &amp; synchronisation</div><div class="settings-sync-badge">'+syncLabel+'</div></div></div>';
  html+='</div><div class="opt-sep"></div>';
  html+='<div class="settings-section"><div class="settings-section-title">Raccourcis clavier</div>';
  html+=_kbdRow('N','Ajouter un titre');
  html+=_kbdRow('F','Rechercher dans la liste');
  html+=_kbdRow('S','Statistiques');
  html+=_kbdRow('C','Mode compact');
  html+=_kbdRow('M','Sons d\'interface');
  html+=_kbdRow('Échap','Fermer la fenêtre ouverte');
  html+='<div class="setting-hint" style="margin-top:4px">Inactifs pendant la saisie dans un champ.</div>';
  html+='</div>';
  body.innerHTML=html;
  enhanceAllSelects(body);
}

/* EXPORT */
function exportJSON(){
  if(!memDB.length){toast('Watchlist vide — rien à exporter','err');return;}
  var payload={version:2,exportedAt:new Date().toISOString(),count:memDB.length,entries:memDB};
  var blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  var a=document.createElement('a');
  var d=new Date();
  var ds=d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
  a.href=URL.createObjectURL(blob);
  a.download='watchlist_'+ds+'.json';
  a.click();
  URL.revokeObjectURL(a.href);
  sfx('done');
  toast('Export OK — '+memDB.length+' titres');
}


