/* MODULE: Audio — sons de fichiers (Kenney CC0, Mixkit) + design sonore synthétisé (Web Audio API). */

/* ===== SONS D'INTERFACE =====
   Deux sources, une seule API : sfx(nom).
   - Fichiers courts dans /sounds/ (open, close, add, done, del, err), choisis à l'écoute :
     Kenney Interface Sounds (CC0) et Mixkit (licence gratuite Mixkit, sans attribution).
     Ils sont téléchargés et décodés une seule fois, au premier geste de l'utilisateur
     (fetch en connect-src 'self', aucun lecteur <audio>), puis joués depuis la mémoire.
     Si un fichier ne charge pas ou ne se décode pas, ce son retombe sur sa synthèse.
   - Synthèse (click, hover, next, et l'alerte « nouveaux épisodes » = toast) : construite
     en JS au moment de la lecture, à partir de 3 briques :
   1) plusieurs oscillateurs très légèrement désaccordés entre eux (quelques Hz d'écart)
      pour une texture "chœur" au lieu d'un bip électronique nu ;
   2) un filtre passe-bas dont la fréquence de coupure s'assombrit pendant le son —
      ça adoucit les aigus durs, comme si le son passait dans un tissu épais ;
   3) une réverbe procédurale (une seule fois calculée, mise en cache) — l'empreinte
      de la façon dont un bruit sec s'éteint dans une petite pièce feutrée, utilisée
      seulement sur les sons qui méritent un peu d'espace (add/done/toast/close).
   Tout passe par un volume général (réglage « Volume des sons », wl_snd_vol, 0-100 %). */
var actx=null,_reverbNode=null,_noiseBufCache={};
/* Volume général : 0..1 (0,5 par défaut = niveau historique de la synthèse). La synthèse et les
   fichiers ont chacun un niveau de base, pour rester équilibrés entre eux. */
var SFX_DEFAULT_VOLUME=0.5,SFX_SYNTH_TRIM=2,SFX_FILE_TRIM=0.5;
var _sfxVolume=SFX_DEFAULT_VOLUME,_master=null,_synthBus=null,_fileBus=null;
function getAC(){
  if(!actx){
    try{actx=new(window.AudioContext||window.webkitAudioContext)();}catch(e){actx=null;}
    if(actx){
      _master=actx.createGain();_master.gain.value=_sfxVolume;_master.connect(actx.destination);
      _synthBus=actx.createGain();_synthBus.gain.value=SFX_SYNTH_TRIM;_synthBus.connect(_master);
      _fileBus=actx.createGain();_fileBus.gain.value=SFX_FILE_TRIM;_fileBus.connect(_master);
    }
  }
  /* Politique d'autoplay : le contexte peut naître « suspendu », on le relance à chaque son */
  if(actx&&actx.state==='suspended'&&actx.resume){try{var p=actx.resume();if(p&&p.catch)p.catch(function(){});}catch(e){}}
  return actx;
}
/* Sortie de la synthèse (passe par le volume général) */
function _synthOut(ac){return _synthBus||ac.destination;}
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

/* ---------- Sons de fichiers ---------- */
var SFX_FILES={open:'/sounds/open.mp3',close:'/sounds/close.mp3',add:'/sounds/add.mp3',done:'/sounds/done.mp3',del:'/sounds/del.mp3',err:'/sounds/err.mp3'};
/* Synthèse de secours si le fichier manque (open n'a pas de synthèse propre : c'était « click ») */
var SFX_FALLBACK={open:'click'};
var _sfxBuf={},_sfxState={},_sfxLoading=null;
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
    return fetch(SFX_FILES[k]).then(function(r){
      if(!r.ok)throw new Error('HTTP '+r.status);
      return r.arrayBuffer();
    }).then(function(ab){return _decode(ac,ab);}).then(function(buf){
      _sfxBuf[k]=buf;_sfxState[k]='ready';
    }).catch(function(){_sfxState[k]='failed';});
  })).then(function(){return _sfxState;});
  return _sfxLoading;
}
function _playFile(ac,name){
  var buf=_sfxBuf[name];if(!buf)return false;
  try{
    var src=ac.createBufferSource();src.buffer=buf;src.connect(_fileBus||ac.destination);src.start(0);
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

/* Une "impulse response" = l'empreinte acoustique d'un espace. On la fabrique nous-mêmes
   avec du bruit qui s'éteint en decrescendo exponentiel (pas de fichier .wav) et on la
   réutilise pour tous les sons — calculée une seule fois, jamais recalculée ensuite. */
function _makeImpulse(ac,dur,decay){
  var rate=ac.sampleRate,len=Math.max(1,Math.floor(rate*dur));
  var buf=ac.createBuffer(2,len,rate);
  for(var ch=0;ch<2;ch++){
    var d=buf.getChannelData(ch);
    for(var i=0;i<len;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/len,decay);
  }
  return buf;
}
function _getReverb(ac){
  if(_reverbNode)return _reverbNode;
  _reverbNode=ac.createConvolver();
  _reverbNode.buffer=_makeImpulse(ac,1.1,2.6);
  _reverbNode.connect(_synthOut(ac));
  return _reverbNode;
}
/* Petit "souffle" de bruit blanc filtré (texture organique en attaque) — mis en cache par
   durée pour ne jamais régénérer le même buffer à chaque interaction. */
function _getNoiseBuffer(ac,dur){
  var key=Math.round(dur*1000);
  if(_noiseBufCache[key])return _noiseBufCache[key];
  var len=Math.max(1,Math.floor(ac.sampleRate*dur)),buf=ac.createBuffer(1,len,ac.sampleRate),d=buf.getChannelData(0);
  for(var i=0;i<len;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/len,3);
  _noiseBufCache[key]=buf;
  return buf;
}
function _noise(ac,t0,dur,vol,cutoff){
  var src=ac.createBufferSource();src.buffer=_getNoiseBuffer(ac,dur);
  var f=ac.createBiquadFilter();f.type='bandpass';f.frequency.value=cutoff||3000;f.Q.value=.7;
  var g=ac.createGain();g.gain.setValueAtTime(vol,t0);g.gain.exponentialRampToValueAtTime(.0001,t0+dur);
  src.connect(f);f.connect(g);g.connect(_synthOut(ac));
  src.start(t0);src.stop(t0+dur);
}
/* Une "note" premium : f/d/t/v/dl gardent exactement le même sens qu'avant (fréquence, durée,
   type d'onde, volume, délai) — opts ajoute les réglages qui font la différence :
   - opts.layers/opts.spread : 2-3 oscillateurs légèrement désaccordés (chœur discret)
   - opts.cutoff:[début,fin] : le filtre s'assombrit pendant le son (sensation "feutrée")
   - opts.glide : la hauteur glisse vers cette fréquence (glissando organique, pas un bip figé)
   - opts.noise : un souffle de bruit filtré très bref en complément (texture, jamais sur hover/click)
   - opts.reverb : quantité envoyée dans la réverbe partagée (sensation d'espace léger)
   L'enveloppe elle-même est douce : attaque courte mais pas instantanée, puis relâchement
   exponentiel qui laisse le son s'éteindre naturellement au lieu d'être coupé sec. */
function tone(f,d,tt,v,dl,opts){
  if(!soundOn)return;var ac=getAC();if(!ac)return;
  opts=opts||{};
  var t0=ac.currentTime+(dl||0);
  var peak=v||.06;
  var attack=opts.attack!=null?opts.attack:.004;
  var release=Math.max(d-attack,.02);
  var glide=opts.glide;
  var spread=opts.spread!=null?opts.spread:5;
  var layers=opts.layers||2;
  var cutoffStart=opts.cutoff?opts.cutoff[0]:Math.max(f*2.4,1200);
  var cutoffEnd=opts.cutoff?opts.cutoff[1]:Math.max(f*0.9,300);

  var filt=ac.createBiquadFilter();filt.type='lowpass';filt.Q.value=opts.q!=null?opts.q:0.6;
  filt.frequency.setValueAtTime(cutoffStart,t0);
  filt.frequency.exponentialRampToValueAtTime(Math.max(80,cutoffEnd),t0+attack+release);

  var g=ac.createGain();
  g.gain.setValueAtTime(0,t0);
  g.gain.linearRampToValueAtTime(peak,t0+attack);
  g.gain.exponentialRampToValueAtTime(.0001,t0+attack+release);

  filt.connect(g);g.connect(_synthOut(ac));
  if(opts.reverb){
    var send=ac.createGain();send.gain.value=opts.reverb;
    g.connect(send);send.connect(_getReverb(ac));
  }

  for(var i=0;i<layers;i++){
    var o=ac.createOscillator();o.type=tt||'sine';
    var df=(i-((layers-1)/2))*spread;
    o.frequency.setValueAtTime(f+df,t0);
    if(glide!=null)o.frequency.exponentialRampToValueAtTime(Math.max(20,glide+df),t0+attack+release);
    o.connect(filt);o.start(t0);o.stop(t0+attack+release+.05);
  }
  if(opts.noise)_noise(ac,t0,opts.noise.dur,opts.noise.vol,opts.noise.cutoff);
}
function _synth(x){
  if(x=='hover')tone(3200,.022,'sine',.009,0,{layers:1,attack:.002,cutoff:[4200,2000]});
  else if(x=='click')tone(430,.09,'triangle',.045,0,{layers:2,spread:4,glide:390,cutoff:[2400,700]});
  else if(x=='add'){
    tone(523,.1,'triangle',.05,0,{layers:2,spread:5,cutoff:[2600,1400],noise:{dur:.03,vol:.02,cutoff:4000}});
    tone(659,.11,'sine',.045,.07,{layers:2,spread:5,cutoff:[2400,1300]});
    tone(784,.22,'sine',.05,.14,{layers:3,spread:6,cutoff:[3000,900],reverb:.14});
  }
  else if(x=='next')tone(660,.16,'triangle',.05,0,{layers:2,spread:4,glide:880,cutoff:[2200,1600]});
  else if(x=='done'){
    tone(523,.11,'triangle',.055,0,{layers:2,spread:5,cutoff:[2600,1400],noise:{dur:.035,vol:.025,cutoff:4500}});
    tone(659,.12,'sine',.05,.09,{layers:2,spread:5,cutoff:[2600,1400]});
    tone(784,.3,'sine',.055,.18,{layers:3,spread:7,cutoff:[3200,800],reverb:.22});
  }
  else if(x=='del')tone(360,.13,'sawtooth',.035,0,{layers:2,spread:4,glide:190,cutoff:[1800,500]});
  else if(x=='err')tone(190,.16,'triangle',.04,0,{layers:2,spread:6,glide:150,cutoff:[900,300],q:1.1});
  else if(x=='toast'){
    tone(1050,.05,'sine',.022,0,{layers:1,attack:.003,cutoff:[3800,2200]});
    tone(1400,.06,'sine',.018,.045,{layers:1,attack:.003,cutoff:[4200,2400],reverb:.06});
  }
  else if(x=='close')tone(500,.18,'sine',.032,0,{layers:2,spread:4,glide:280,cutoff:[2000,700],reverb:.08});
}
/* Survol : seulement avec une vraie souris (pas au toucher), et au plus un son toutes les 80 ms */
var _hoverMq=null,_lastHoverAt=0,_lastSfxAt=0;
function _hoverAllowed(){
  if(_hoverMq===null){try{_hoverMq=window.matchMedia?window.matchMedia('(hover: hover) and (pointer: fine)'):false;}catch(e){_hoverMq=false;}}
  if(!_hoverMq||!_hoverMq.matches)return false;
  var now=Date.now();if(now-_lastHoverAt<80)return false;
  _lastHoverAt=now;return true;
}
/* Un son d'action a-t-il été joué il y a moins de ms millisecondes ? (évite d'empiler le
   carillon d'un toast sur le son d'ajout, de suppression, d'erreur…) */
function sfxRecent(ms){return Date.now()-_lastSfxAt<(ms||300);}
function sfx(x){
  if(!soundOn)return;
  if(x=='hover'&&!_hoverAllowed())return;
  if(x!='hover'&&x!='toast')_lastSfxAt=Date.now();
  var ac=getAC();if(!ac)return;
  if(SFX_FILES[x]){
    if(_sfxState[x]==='ready'&&_playFile(ac,x))return;
    if(!_sfxLoading)loadSfxFiles();
    x=SFX_FALLBACK[x]||x;
  }
  _synth(x);
}
function toggleSound(){
  soundOn=!soundOn;localStorage.setItem('wl_snd',soundOn?'1':'0');
  if(soundOn)sfx('click');
}

