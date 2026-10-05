/* MODULE: Audio — design sonore synthétisé (Web Audio API), zéro fichier audio. */

/* ===== SESSION 13 : DESIGN SONORE PREMIUM =====
   100% synthèse Web Audio API — toujours aucun fichier audio, aucune requête réseau.
   Principe : chaque son est construit à partir de 3 briques, calculées en JS au moment
   de la lecture, jamais chargées depuis un fichier :
   1) plusieurs oscillateurs très légèrement désaccordés entre eux (quelques Hz d'écart)
      pour une texture "chœur" au lieu d'un bip électronique nu ;
   2) un filtre passe-bas dont la fréquence de coupure s'assombrit pendant le son —
      ça adoucit les aigus durs, comme si le son passait dans un tissu épais ;
   3) une réverbe procédurale (une seule fois calculée, mise en cache) — l'empreinte
      de la façon dont un bruit sec s'éteint dans une petite pièce feutrée, utilisée
      seulement sur les sons qui méritent un peu d'espace (add/done/toast/close). */
var actx=null,_reverbNode=null,_noiseBufCache={};
function getAC(){if(!actx)try{actx=new(window.AudioContext||window.webkitAudioContext)();}catch(e){}return actx;}

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
  _reverbNode.connect(ac.destination);
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
  src.connect(f);f.connect(g);g.connect(ac.destination);
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
function tone(f,d,t,v,dl,opts){
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

  filt.connect(g);g.connect(ac.destination);
  if(opts.reverb){
    var send=ac.createGain();send.gain.value=opts.reverb;
    g.connect(send);send.connect(_getReverb(ac));
  }

  for(var i=0;i<layers;i++){
    var o=ac.createOscillator();o.type=t||'sine';
    var df=(i-((layers-1)/2))*spread;
    o.frequency.setValueAtTime(f+df,t0);
    if(glide!=null)o.frequency.exponentialRampToValueAtTime(Math.max(20,glide+df),t0+attack+release);
    o.connect(filt);o.start(t0);o.stop(t0+attack+release+.05);
  }
  if(opts.noise)_noise(ac,t0,opts.noise.dur,opts.noise.vol,opts.noise.cutoff);
}
function sfx(x){
  if(!soundOn)return;
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
function toggleSound(){
  soundOn=!soundOn;localStorage.setItem('wl_snd',soundOn?'1':'0');
  if(soundOn)sfx('click');
}

