/* MODULE: Accueil — carrousel 3D « En cours » (Cover Flow) et onglets en pilule.
   Le carrousel affiche les titres « en cours » du bandeau (_heroItems, js/05-render.js) ; l'affiche
   active est au centre, de face, les autres inclinées en perspective. Seules les affiches à ±CF_WIN
   de l'active existent dans le DOM (une liste de 200 titres ne crée pas 200 calques 3D).
   Navigation : molette (verticale ou horizontale, un pas toutes les CF_WHEEL_MS), glisser à la souris
   ou au doigt, flèches du clavier, boutons ‹ ›, clic sur une affiche. Toute action manuelle arrête le
   balayage automatique (_heroManual). Mouvement réduit : rangée à plat, sans rotation. */
var CF_WIN=5,CF_WHEEL_MS=180;
function _cfReduced(){try{return window.matchMedia('(prefers-reduced-motion: reduce)').matches;}catch(e){return false;}}
function _cfSmall(){return window.innerWidth<=768;}
function _cfEpLabel(item){return(item.type!=='film'&&item.saison&&item.episode)?('S'+pad(item.saison)+' · E'+pad(item.episode)):'';}
function _cfPct(item){var p=(typeof _seasonProgressPct==='function')?_seasonProgressPct(item):null;return p==null?0:p;}
function _cfCard(item,i){
  var b=document.createElement('button');
  b.type='button';b.className='cf-card';b.setAttribute('data-i',i);b.setAttribute('data-id',item.id);
  b.setAttribute('aria-label',item.title);b.tabIndex=-1;
  var ep=_cfEpLabel(item);
  b.innerHTML=(item.poster?'<img src="'+esc(IB+'w342'+item.poster)+'" alt="" loading="lazy" decoding="async">':'<span class="cf-ph">'+icon(item.type)+'</span>')+
    (ep?'<span class="cf-ep">'+esc(ep)+'</span>':'')+'<span class="cf-pg"><i style="width:'+_cfPct(item)+'%"></i></span>';
  b.style.opacity='0';
  return b;
}
var _cfIdx=0;
function renderContinue(items,idx){
  var band=document.getElementById('heroBand'),ring=document.getElementById('cfRing');
  if(!band||!ring)return;
  items=items||[];
  if(!items.length){ring.innerHTML='';return;}
  _cfIdx=idx;
  band.classList.toggle('single',items.length<2);
  var keep=Object.create(null);
  for(var i=Math.max(0,idx-CF_WIN);i<=Math.min(items.length-1,idx+CF_WIN);i++)keep[items[i].id]=i;
  /* retire les affiches sorties de la fenêtre, ajoute les nouvelles */
  Array.prototype.slice.call(ring.children).forEach(function(c){var id=c.getAttribute('data-id');if(!(id in keep))c.remove();});
  var have=Object.create(null);Array.prototype.forEach.call(ring.children,function(c){have[c.getAttribute('data-id')]=c;});
  var fresh=[];
  Object.keys(keep).forEach(function(id){
    var i=keep[id],c=have[id];
    if(!c){c=_cfCard(items[i],i);ring.appendChild(c);fresh.push(c);}
    else c.setAttribute('data-i',i);
  });
  if(fresh.length)void ring.offsetWidth;/* les nouvelles partent d'opacité 0 */
  var small=_cfSmall(),flat=_cfReduced();
  Array.prototype.forEach.call(ring.children,function(c){
    var d=+c.getAttribute('data-i')-idx,a=Math.abs(d),s=d>0?1:d<0?-1:0,tr,o=1;
    if(flat){var fg=small?120:170;tr='translateX('+(d*fg)+'px) scale('+(d?.86:1)+')';if(a>(small?2:3))o=0;}
    else{
      var gap=small?52:96,base=small?78:150;
      tr=d===0?'translateZ(60px)':'translateX('+(s*base+d*gap)+'px) translateZ(-140px) rotateY('+(-s*48)+'deg)';
      if(a>(small?3:CF_WIN))o=0;
    }
    c.style.transform=tr;c.style.opacity=String(o);c.style.zIndex=String(100-a);
    c.style.filter=d?'brightness('+(1-.12*a).toFixed(2)+')':'none';
    c.classList.toggle('on',d===0);
    c.setAttribute('aria-hidden',d?'true':'false');
    c.style.pointerEvents=o?'':'none';
  });
  var ctr=document.getElementById('contCtr');if(ctr)ctr.textContent=(idx+1)+' / '+items.length;
  var bar=document.getElementById('cfBar');if(bar)bar.style.width=_cfPct(items[idx])+'%';
  var pv=band.querySelector('.cf-nav.prev'),nx=band.querySelector('.cf-nav.next');
  if(pv)pv.disabled=idx<=0;if(nx)nx.disabled=idx>=items.length-1;
  _cfInit(document.getElementById('cfStage'));
}
/* Va au titre i (borné), arrête le balayage automatique */
function cfGo(i){
  if(!_heroItems.length)return;
  i=Math.max(0,Math.min(_heroItems.length-1,i));
  _heroManual=true;
  if(i===_heroIdx){clearTimeout(_heroTimer);return;}
  if(typeof sfx==='function')sfx('click');
  var info=document.getElementById('cfInfo');
  if(info&&!_cfReduced()){info.classList.add('sw');setTimeout(function(){info.classList.remove('sw');},160);}
  _heroGoTo(i);
}
function contScroll(dir){cfGo(_heroIdx+dir);}
function _cfInit(st){
  if(!st||st._init)return;st._init=1;
  /* Molette : un pas par CF_WHEEL_MS. Le défilement de la page n'est bloqué que pendant que le
     pointeur est sur le carrousel, et pas aux extrémités (la page reprend la main). */
  var last=0;
  st.addEventListener('wheel',function(e){
    if(e.ctrlKey)return;/* zoom au pavé tactile */
    var horiz=Math.abs(e.deltaX)>Math.abs(e.deltaY),v=horiz?e.deltaX:e.deltaY;
    if(Math.abs(v)<4)return;
    var dir=v>0?1:-1,n=_heroItems.length;
    if(!horiz&&((dir<0&&_heroIdx<=0)||(dir>0&&_heroIdx>=n-1)))return;
    e.preventDefault();
    var now=Date.now();if(now-last<CF_WHEEL_MS)return;last=now;
    cfGo(_heroIdx+dir);
  },{passive:false});
  st.addEventListener('keydown',function(e){
    var k=e.key;
    if(k==='ArrowRight'){cfGo(_heroIdx+1);e.preventDefault();}
    else if(k==='ArrowLeft'){cfGo(_heroIdx-1);e.preventDefault();}
    else if(k==='Home'){cfGo(0);e.preventDefault();}
    else if(k==='End'){cfGo(_heroItems.length-1);e.preventDefault();}
    else if(k==='Enter'&&e.target===st){var it=_heroItems[_heroIdx];if(it){sfx('open');openPlex(it.id);}e.preventDefault();}
  });
  /* Glisser (souris, doigt, stylet) : un pas tous les 80 px (50 px sur téléphone) */
  var x0=null,moved=false;
  st.addEventListener('pointerdown',function(e){if(e.target.closest('.cf-nav')||(e.pointerType==='mouse'&&e.button!==0))return;x0=e.clientX;moved=false;});
  window.addEventListener('pointermove',function(e){
    if(x0===null)return;var dx=e.clientX-x0,step=_cfSmall()?50:80;
    if(Math.abs(dx)>step){moved=true;st.classList.add('drag');cfGo(_heroIdx-(dx>0?1:-1));x0=e.clientX;}
  });
  function up(){if(x0===null)return;x0=null;st.classList.remove('drag');if(moved)setTimeout(function(){moved=false;},0);}
  window.addEventListener('pointerup',up);window.addEventListener('pointercancel',up);
  /* Clic sur une affiche : la met au centre (ou ouvre la fiche si c'est déjà l'active) */
  st.addEventListener('click',function(e){
    var c=e.target.closest('.cf-card');if(!c)return;
    if(moved){e.preventDefault();e.stopPropagation();return;}
    var i=+c.getAttribute('data-i');
    if(i===_heroIdx){_heroManual=true;clearTimeout(_heroTimer);var it=_heroItems[i];if(it){sfx('open');openPlex(it.id);}}
    else cfGo(i);
  });
}
/* Surlignage glissant de la pilule d'onglets */
function segMove(){
  var seg=document.getElementById('tabSeg'),hl=document.getElementById('segHl');if(!seg||!hl)return;
  var on=seg.querySelector('.ntab.on');
  if(!on||!on.offsetWidth){hl.classList.remove('on');return;}
  hl.style.width=on.offsetWidth+'px';hl.style.transform='translateX('+on.offsetLeft+'px)';hl.classList.add('on');
}
(function(){
  var seg=document.getElementById('tabSeg');if(!seg)return;
  if(typeof ResizeObserver==='function')new ResizeObserver(segMove).observe(seg);
  window.addEventListener('resize',segMove);
  if(document.fonts&&document.fonts.ready)document.fonts.ready.then(segMove);
})();
/* « Tout voir » : filtre « En cours » de la liste, puis descend jusqu'à la grille */
function contSeeAll(){
  var b=document.querySelector('#stabs .stab[data-s="encours"]');if(b)b.click();
  var c=document.getElementById('content');if(c&&c.scrollIntoView)c.scrollIntoView({behavior:'smooth',block:'start'});
}
/* Compteurs des onglets Tout / Films / Séries / Anime, calculés sur la vraie liste */
function updateTabCounts(){
  if(typeof memDB==='undefined')return;
  var c={all:0,film:0,serie:0,anime:0};
  memDB.forEach(function(i){if(i.deleted)return;c.all++;if(c[i.type]!=null)c[i.type]++;});
  Object.keys(c).forEach(function(k){
    var b=document.querySelector('.ntab[data-tab="'+k+'"]');if(!b)return;
    var em=b.querySelector('.ntab-cnt');
    if(!em){em=document.createElement('em');em.className='ntab-cnt';b.appendChild(em);}
    em.textContent=fmtNum(c[k]);
  });
  segMove();
}
if(typeof module!=='undefined')module.exports={renderContinue:renderContinue,updateTabCounts:updateTabCounts};
/* Tiroir Suivi : Entrée / Espace l'ouvrent aussi au clavier */
(function(){var h=document.querySelector('#suiviWrap .suivi-hdr');if(!h)return;h.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();h.click();}});})();
