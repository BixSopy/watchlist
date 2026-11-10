/* MODULE: Audio — sons d'interface, uniquement des fichiers courts de /sounds/ (aucune synthèse). */

/* ===== SONS D'INTERFACE =====
   Une seule API : sfx(nom). Chaque son est un petit MP3 de /sounds/, choisi à l'écoute sur un banc
   comparatif (tous normalisés au même niveau par rôle, voir README « Crédits sons ») :
   - click, open, close, next, toast : SND, kit 01 « Sine » (Yasuhiro Tsuchiya, snd.dev) ;
   - done, err, del : kit maison créé pour Cinepisode (scripts/sounds-maison.py) ;
   - add : Kenney Interface Sounds (CC0), inchangé.
   Pas de son de survol (ni iOS ni Android n'en ont), ni de son sur chaque bandeau d'information :
   « toast » est réservé aux vraies notifications (nouveaux épisodes).
   Les fichiers sont téléchargés et décodés une seule fois, au premier geste de l'utilisateur
   (fetch en connect-src 'self', aucun lecteur <audio>), puis joués depuis la mémoire. Un son dont le
   fichier ne charge pas reste silencieux : mieux vaut rien qu'un bip de remplacement.
   Énergie : le contexte audio est mis en veille après SFX_IDLE_MS sans son (sinon le fil audio du
   navigateur tourne en permanence, même app au repos) et réveillé au son suivant.
   Tout passe par un volume général (réglage « Volume des sons », wl_snd_vol, 0-100 %). */
var actx=null;
/* Volume général : 0..1 (0,5 par défaut). SFX_FILE_TRIM : les fichiers sont normalisés bas (pic le plus
   fort à -12 dBFS) ; ce gain ramène ce pic au même niveau que les anciens sons, sans saturer à 100 %. */
var SFX_DEFAULT_VOLUME=0.5,SFX_FILE_TRIM=1.4,SFX_IDLE_MS=15000;
var _sfxVolume=SFX_DEFAULT_VOLUME,_master=null,_fileBus=null,_idleTimer=null;
function getAC(){
  if(!actx){
    try{actx=new(window.AudioContext||window.webkitAudioContext)();}catch(e){actx=null;}
    if(actx){
      _master=actx.createGain();_master.gain.value=_sfxVolume;_master.connect(actx.destination);
      _fileBus=actx.createGain();_fileBus.gain.value=SFX_FILE_TRIM;_fileBus.connect(_master);
    }
  }
  /* Politique d'autoplay, ou mise en veille après inactivité : on le relance à chaque son */
  if(actx&&actx.state==='suspended'&&actx.resume){try{var p=actx.resume();if(p&&p.catch)p.catch(function(){});}catch(e){}}
  return actx;
}
function _sleepLater(){
  clearTimeout(_idleTimer);
  _idleTimer=setTimeout(function(){
    if(actx&&actx.state==='running'&&actx.suspend){try{var p=actx.suspend();if(p&&p.catch)p.catch(function(){});}catch(e){}}
  },SFX_IDLE_MS);
}
function setSfxVolume(v){
  v=Number(v);if(!isFinite(v))v=SFX_DEFAULT_VOLUME;
  _sfxVolume=Math.max(0,Math.min(1,v));
  if(_master&&actx){try{_master.gain.setValueAtTime(_sfxVolume,actx.currentTime);}catch(e){_master.gain.value=_sfxVolume;}}
}
function loadSfxVolume(){
  var raw=null;try{raw=localStorage.getItem('wl_snd_vol');}catch(e){}
  var n=raw===null||raw===''?NaN:parseInt(raw,10);
  setSfxVolume(isFinite(n)?n/100:SFX_DEFAULT_VOLUME);
  return Math.round(_sfxVolume*100);
}

var SFX_FILES={click:'/sounds/click.mp3',open:'/sounds/open.mp3',close:'/sounds/close.mp3',next:'/sounds/next.mp3',toast:'/sounds/toast.mp3',
  add:'/sounds/add.mp3',done:'/sounds/done.mp3',del:'/sounds/del.mp3',err:'/sounds/err.mp3'};
/* Un son demandé pendant le chargement est joué s'il arrive à temps (sinon il tomberait à contretemps) */
var SFX_LATE_MS=250;
var _sfxBuf={},_sfxState={},_sfxWait={},_sfxLoading=null;
function _decode(ac,ab){
  return new Promise(function(res,rej){
    try{var p=ac.decodeAudioData(ab,res,rej);if(p&&p.then)p.then(res,rej);}catch(e){rej(e);}
  });
}
/* Télécharge et décode les fichiers une seule fois (appelé au premier geste de l'utilisateur) */
function loadSfxFiles(){
  if(_sfxLoading)return _sfxLoading;
  var ac=getAC();
  if(!ac||typeof fetch!=='function'){Object.keys(SFX_FILES).forEach(function(k){_sfxState[k]='failed';});return (_sfxLoading=Promise.resolve(_sfxState));}
  _sfxLoading=Promise.all(Object.keys(SFX_FILES).map(function(k){
    _sfxState[k]='loading';
    _sfxWait[k]=fetch(SFX_FILES[k]).then(function(r){
      if(!r.ok)throw new Error('HTTP '+r.status);
      return r.arrayBuffer();
    }).then(function(ab){return _decode(ac,ab);}).then(function(buf){
      _sfxBuf[k]=buf;_sfxState[k]='ready';
    }).catch(function(){_sfxState[k]='failed';});
    return _sfxWait[k];
  })).then(function(){return _sfxState;});
  return _sfxLoading;
}
function _playFile(ac,name){
  var buf=_sfxBuf[name];if(!buf)return false;
  try{
    var src=ac.createBufferSource();src.buffer=buf;src.connect(_fileBus||ac.destination);src.start(0);
    _sleepLater();
    return true;
  }catch(e){return false;}
}
/* Premier geste (clic, touche, toucher) : crée le contexte audio et lance le chargement */
function audioUnlock(){getAC();if(soundOn)loadSfxFiles();}
(function(){
  if(typeof document==='undefined'||!document.addEventListener)return;
  var evs=['pointerdown','keydown','touchstart','click'];
  function once(){evs.forEach(function(ev){document.removeEventListener(ev,once,true);});audioUnlock();}
  evs.forEach(function(ev){document.addEventListener(ev,once,true);});
})();

function sfx(x){
  if(!soundOn||!SFX_FILES[x])return;
  var ac=getAC();if(!ac)return;
  if(_sfxState[x]==='ready'){_playFile(ac,x);return;}
  if(!_sfxLoading)loadSfxFiles();
  if(_sfxState[x]==='loading'){
    var asked=Date.now();
    _sfxWait[x].then(function(){if(Date.now()-asked<SFX_LATE_MS)_playFile(ac,x);});
  }
}
function toggleSound(){
  soundOn=!soundOn;localStorage.setItem('wl_snd',soundOn?'1':'0');
  if(soundOn)sfx('click');
}
