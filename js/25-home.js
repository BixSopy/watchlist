/* MODULE: Accueil — rangée « Continuer » (remplace les points du bandeau) et compteurs des onglets.
   La rangée liste les titres « en cours » du bandeau (_heroItems, js/05-render.js). Vignette : image
   de fond TMDB (backdrop) si on la connaît déjà, sinon l'affiche. Les backdrops viennent de la même
   requête que le bandeau (même URL, donc même cache serveur), au plus CONT_BD_MAX par rendu. */
var _contBd=Object.create(null),_contBdAsked=Object.create(null),CONT_BD_MAX=10;
function _contKind(item){return item.tmdbType||(item.type==='film'?'movie':'tv');}
function _contBdKey(item){return _contKind(item)+':'+item.tmdbId;}
function contRememberBackdrop(item,path){if(item&&path)_contBd[_contBdKey(item)]=path;}
function _contThumbUrl(item){
  var bd=_contBd[_contBdKey(item)];
  if(bd)return IB+'w500'+bd;
  return item.poster?IB+'w342'+item.poster:'';
}
function _contEpLabel(item){return(item.type!=='film'&&item.saison&&item.episode)?('S'+pad(item.saison)+' · E'+pad(item.episode)):'';}
function _contCardHtml(item,i,idx){
  var url=_contThumbUrl(item),pct=(typeof _seasonProgressPct==='function')?_seasonProgressPct(item):null;
  var bdCls=_contBd[_contBdKey(item)]?' bd':'';
  var th=url?'<span class="cc-th'+bdCls+'" style="background-image:url(&quot;'+esc(url)+'&quot;)"></span>':'<span class="cc-th cc-ph">'+icon(item.type)+'</span>';
  var ep=_contEpLabel(item);
  return '<button type="button" class="cc'+(i===idx?' on':'')+'" data-i="'+i+'"'+uiAct('heroPick',[i])+' aria-label="'+esc(item.title)+'"'+(i===idx?' aria-current="true"':'')+'>'+th+
    (i===idx?'<span class="cc-now">'+esc(t('status.encours'))+'</span>':'')+
    (ep?'<span class="cc-ep">'+esc(ep)+'</span>':'')+
    '<span class="cc-pb"><i style="width:'+(pct==null?0:pct)+'%"></i></span><span class="cc-tt">'+esc(item.title)+'</span></button>';
}
/* Rendu complet seulement si la liste change ; sinon on déplace juste la vignette active. */
var _contSig='';
function renderContinue(items,idx){
  var box=document.getElementById('heroCont'),band=document.getElementById('heroBand');
  if(!box)return;
  if(!items||items.length<2){box.hidden=true;box._sig='';if(band)band.classList.remove('has-cont');return;}
  box.hidden=false;if(band)band.classList.add('has-cont');
  var strip=document.getElementById('contStrip'),ctr=document.getElementById('contCtr');
  var sig=items.map(function(x){return x.id+'|'+x.saison+'|'+x.episode+'|'+(_contBd[_contBdKey(x)]?1:0);}).join(',');
  if(sig!==_contSig){
    _contSig=sig;
    strip.innerHTML=items.map(function(it,i){return _contCardHtml(it,i,idx);}).join('');
    _contFetchBackdrops(items);
  }else{
    strip.querySelectorAll('.cc').forEach(function(b){
      var on=+b.getAttribute('data-i')===idx;
      if(on===b.classList.contains('on'))return;
      b.classList.toggle('on',on);
      if(on)b.setAttribute('aria-current','true');else b.removeAttribute('aria-current');
      var now=b.querySelector('.cc-now');
      if(on&&!now){var s=document.createElement('span');s.className='cc-now';s.textContent=t('status.encours');b.insertBefore(s,b.children[1]||null);}
      if(!on&&now)now.remove();
    });
  }
  ctr.textContent=(idx+1)+' / '+items.length;
  _contInit(strip);
  _contReveal(strip,idx);
}
/* Garde la vignette active visible sans faire défiler la page */
function _contReveal(strip,idx){
  var b=strip.querySelector('.cc[data-i="'+idx+'"]');if(!b)return;
  var l=b.offsetLeft-strip.offsetLeft,r=l+b.offsetWidth;
  if(l<strip.scrollLeft||r>strip.scrollLeft+strip.clientWidth)strip.scrollTo({left:Math.max(0,l-8),behavior:'smooth'});
}
function _contFetchBackdrops(items){
  var n=0;
  items.forEach(function(item){
    var k=_contBdKey(item);
    if(_contBd[k]||_contBdAsked[k]||n>=CONT_BD_MAX)return;
    _contBdAsked[k]=1;n++;
    tf(TB+'/'+_contKind(item)+'/'+item.tmdbId+'?language='+TMDB_LANG+'&append_to_response=images').then(function(det){
      var imgs=(det&&det.images&&det.images.backdrops)||[];
      var path=imgs.length?imgs[0].file_path:((det&&det.backdrop_path)||null);
      if(!path)return;
      _contBd[k]=path;
      var strip=document.getElementById('contStrip');if(!strip)return;
      strip.querySelectorAll('.cc').forEach(function(b){
        var it=_heroItems[+b.getAttribute('data-i')];
        if(it&&_contBdKey(it)===k){var th=b.querySelector('.cc-th');if(th){th.classList.remove('cc-ph');th.classList.add('bd');th.textContent='';th.style.backgroundImage='url("'+IB+'w500'+path+'")';}}
      });
    }).catch(function(){});
  });
}
/* Molette verticale -> défilement horizontal, glisser à la souris (le doigt utilise le défilement natif) */
function _contInit(strip){
  if(strip._init)return;strip._init=1;
  strip.addEventListener('wheel',function(e){
    if(Math.abs(e.deltaY)<=Math.abs(e.deltaX))return;
    var max=strip.scrollWidth-strip.clientWidth;if(max<=0)return;
    if((e.deltaY<0&&strip.scrollLeft<=0)||(e.deltaY>0&&strip.scrollLeft>=max-1))return;/* bord atteint : la page défile */
    strip.scrollLeft+=e.deltaY;e.preventDefault();
  },{passive:false});
  var d=null;
  strip.addEventListener('pointerdown',function(e){if(e.pointerType==='mouse'&&e.button===0)d={x:e.clientX,l:strip.scrollLeft,moved:false};});
  window.addEventListener('pointermove',function(e){if(!d)return;var dx=e.clientX-d.x;if(Math.abs(dx)>5){d.moved=true;strip.classList.add('drag');}if(d.moved)strip.scrollLeft=d.l-dx;});
  window.addEventListener('pointerup',function(){if(!d)return;var moved=d.moved;d=null;strip.classList.remove('drag');if(moved){strip._skipClick=1;setTimeout(function(){strip._skipClick=0;},0);}});
  strip.addEventListener('click',function(e){if(strip._skipClick){e.stopPropagation();e.preventDefault();}},true);
}
function contScroll(dir){var s=document.getElementById('contStrip');if(s)s.scrollBy({left:dir*s.clientWidth*.8,behavior:'smooth'});}
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
}
if(typeof module!=='undefined')module.exports={renderContinue:renderContinue,updateTabCounts:updateTabCounts};
/* Tiroir Suivi : Entrée / Espace l'ouvrent aussi au clavier */
(function(){var h=document.querySelector('#suiviWrap .suivi-hdr');if(!h)return;h.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();h.click();}});})();
