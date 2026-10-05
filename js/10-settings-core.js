/* MODULE: Réglages — stockage localStorage et application des préférences visuelles. */
/* ===== SESSION 11B : SYSTÈME DE RÉGLAGES (100% local, jamais synchronisé) ===== */
var wlSettings={};
var WL_SETTINGS_DEFAULTS={
  wl_grid_cols:'auto',
  wl_card_ratings:'both',
  wl_card_badges:'full',
  wl_reco_autoscroll:'1',
  wl_reco_speed:'normal',
  wl_reco_pause_hover:'1',
  wl_reco_limit:'15',
  wl_suivi_providers:'1',
  wl_reminders_global:'1',
  wl_glass:'40',
  wl_grain:'50',
  wl_aurora:'100',
  wl_glow_border:'1'
};
var WL_RECO_SPEEDS={
  slow:{duration:2100,pause:700},
  normal:{duration:1600,pause:450},
  fast:{duration:950,pause:260}
};
function loadSettings(){
  wlSettings={};
  Object.keys(WL_SETTINGS_DEFAULTS).forEach(function(key){
    var v=localStorage.getItem(key);
    wlSettings[key]=(v===null||v===undefined||v==='')?WL_SETTINGS_DEFAULTS[key]:v;
  });
  return wlSettings;
}
function saveSetting(key,value){
  wlSettings[key]=value;
  localStorage.setItem(key,value);
}
function applySettings(){
  var root=document.documentElement;
  /* Grille */
  root.classList.remove('grid-cols-4','grid-cols-5','grid-cols-6','grid-cols-7');
  if(wlSettings.wl_grid_cols&&wlSettings.wl_grid_cols!=='auto')root.classList.add('grid-cols-'+wlSettings.wl_grid_cols);
  /* Notes cartes */
  document.body.classList.remove('ratings-both','ratings-my','ratings-tmdb','ratings-off');
  document.body.classList.add('ratings-'+(wlSettings.wl_card_ratings==='my'?'my':wlSettings.wl_card_ratings==='tmdb'?'tmdb':wlSettings.wl_card_ratings==='off'?'off':'both'));
  /* Badges cartes */
  document.body.classList.remove('badges-full','badges-off');
  document.body.classList.add('badges-'+(wlSettings.wl_card_badges==='off'?'off':'full'));
  /* Suivi providers */
  document.body.classList.toggle('suivi-providers-off',wlSettings.wl_suivi_providers==='0');
  /* Transparence du verre (0-100%) sur les pop-up */
  applyGlass(parseInt(wlSettings.wl_glass,10));
  /* Grain filmique + aurora (0-100%) */
  applyGrain(parseInt(wlSettings.wl_grain,10));
  applyAurora(parseInt(wlSettings.wl_aurora,10));
  /* Lueur animee au survol des cartes */
  document.body.classList.toggle('glow-off',wlSettings.wl_glow_border==='0');
}
/* 0% = panneaux pleins (pas de flou) ; 100% = très translucide. Les 4 variables sont
   lues par le CSS des pop-up (modales, menu, fiche détail, recherche, dossiers). */
function applyGlass(pct){
  var t=Math.max(0,Math.min(100,pct||0))/100;
  var root=document.documentElement.style;
  root.setProperty('--glass-panel-bg','rgba(16,16,19,'+(1-t*0.55).toFixed(2)+')');
  root.setProperty('--glass-panel-blur',Math.round(t*44)+'px');
  root.setProperty('--glass-backdrop-bg','rgba(8,9,11,'+(0.90-t*0.52).toFixed(2)+')');
  root.setProperty('--glass-backdrop-blur',Math.round(t*18)+'px');
}
/* 0% = pas de grain ; 100% = grain marque (deux fois l'intensite par defaut).
   Lu par body::after (overlay SVG plein ecran, voir index.html). */
function applyGrain(pct){
  var t=Math.max(0,Math.min(100,pct||0))/100;
  document.documentElement.style.setProperty('--grain-opacity',(t*0.07).toFixed(3));
}
/* 0% = aurora invisible ; 100% = intensite de reference des taches de couleur.
   Multiplicateur applique a chaque .aurora-blob (voir index.html). */
function applyAurora(pct){
  var t=Math.max(0,Math.min(100,pct||0))/100;
  document.documentElement.style.setProperty('--aurora-opacity',t.toFixed(2));
}



