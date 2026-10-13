/* MODULE: Navigation « Cinéma » (maquettes P3 validées le 13/10/2026).
   Ordinateur : pilule centrée en haut (Ce soir / Ma liste / Calendrier / Découvrir / Détectés),
   à droite Compact, recherche, cloche des nouveautés, compte et menu. Téléphone : barre d'onglets
   flottante en bas. Les vues réutilisent les onglets existants (switchTab) : rien n'est dupliqué,
   on change seulement ce qui est affiché (classe p3-v-<vue> sur <body>). */
var P3_VIEWS=['tonight','list','calendar','discover','detectes'];
var p3View='tonight';
var P3_IC={
  tonight:'<path d="M12 3a9 9 0 109 9 7 7 0 01-9-9z"/>',
  list:'<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  discover:'<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  detectes:'<path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"/>'
};
var P3_LBL={tonight:'nav.tonight',list:'nav.myList',calendar:'cal.tab',discover:'tab.discover',detectes:'det.tab'};
function _p3Svg(p){return '<svg class="p3-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+p+'</svg>';}
function _p3Btns(cls){
  return P3_VIEWS.map(function(v){
    return '<button type="button" class="'+cls+(v===p3View?' on':'')+'" data-v="'+v+'"'+uiAct('p3Go',[v])+(cls==='p3-tb'?'>'+_p3Svg(P3_IC[v]):'>')+
      '<span>'+esc(t(P3_LBL[v]))+'</span><em class="p3-cnt" data-cnt="'+v+'"></em></button>';
  }).join('');
}
function p3Build(){
  var hdr=document.querySelector('.hdr');if(!hdr||document.getElementById('p3Nav'))return;
  var nav=document.createElement('nav');nav.className='p3-nav';nav.id='p3Nav';nav.setAttribute('aria-label',t('nav.aria'));
  nav.innerHTML='<span class="p3-hl" aria-hidden="true"></span>'+_p3Btns('p3-pill');
  hdr.insertBefore(nav,hdr.querySelector('.search-bar'));
  var right=hdr.querySelector('.hdr-right');
  var tools=document.createElement('div');tools.className='p3-tools';
  tools.innerHTML='<button type="button" class="p3-cpt" id="p3Cpt" role="switch" aria-checked="false"'+uiAct('p3Compact')+'><span class="p3-sw" aria-hidden="true"></span><span class="p3-cpt-l">'+esc(t('nav.compact'))+'</span></button>'+
    '<button type="button" class="p3-ib" id="p3Search" title="'+esc(t('nav.search'))+'" aria-label="'+esc(t('nav.search'))+'"'+uiAct('p3Search')+'>'+_p3Svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>')+'</button>'+
    '<button type="button" class="p3-ib" id="p3Bell" aria-haspopup="true" aria-expanded="false" title="'+esc(t('nav.notifs'))+'" aria-label="'+esc(t('nav.notifs'))+'"'+uiAct('p3Bell')+'>'+_p3Svg('<path d="M6 16v-5a6 6 0 1112 0v5l2 2H4zM10 21h4"/>')+'<i class="p3-dot" id="p3Dot" hidden></i></button>'+
    '<div class="p3-pop" id="p3Pop" role="menu" hidden></div>';
  right.insertBefore(tools,right.firstChild);
  var tb=document.createElement('nav');tb.className='p3-tabbar';tb.id='p3Tabbar';tb.setAttribute('aria-label',t('nav.aria'));
  tb.innerHTML=_p3Btns('p3-tb');document.body.appendChild(tb);
  /* En-tête de page (titre + sous-titre) au-dessus de la barre d'outils de la liste */
  var main=document.querySelector('.main'),ph=document.createElement('div');ph.className='p3-ph';ph.id='p3Ph';
  main.insertBefore(ph,main.querySelector('.nav.floating'));
  /* Recommandations : la colonne latérale devient la section « Pour toi » de Découvrir */
  var sb=document.querySelector('.sidebar'),ds=document.getElementById('discoverSection');
  if(sb&&ds){sb.classList.add('p3-recos');ds.parentNode.insertBefore(sb,ds);
    var dseg=document.createElement('div');dseg.className='p3-dseg';dseg.id='p3DiscSeg';ds.parentNode.insertBefore(dseg,sb);
    var fy=document.createElement('div');fy.className='p3-foryou';fy.id='p3ForYou';fy.setAttribute('aria-live','polite');ds.parentNode.insertBefore(fy,sb);
    p3DiscSeg();
    var sbc=document.getElementById('sbContent');
    if(sbc&&typeof MutationObserver==='function'){var t0=null;new MutationObserver(function(){clearTimeout(t0);t0=setTimeout(p3ForYou,60);}).observe(sbc,{childList:true,subtree:true});}
    p3ForYou();}
  var dtb=document.getElementById('detTab'),dbg=document.getElementById('detBadge');
  if(typeof MutationObserver==='function'){var mo=new MutationObserver(function(){p3Header();p3Hl();});
    [dtb,dbg].forEach(function(el){if(el)mo.observe(el,{attributes:true,attributeFilter:['hidden'],childList:true,characterData:true,subtree:true});});}
  window.addEventListener('resize',p3Hl);
  if(document.fonts&&document.fonts.ready)document.fonts.ready.then(p3Hl);
  document.addEventListener('click',function(e){var pop=document.getElementById('p3Pop');if(pop&&!pop.hidden&&!e.target.closest('#p3Pop,#p3Bell'))p3BellClose();});
  document.addEventListener('keydown',function(e){if(e.key==='Escape')p3BellClose();});
}
/* ===== Découvrir : Pour toi / Tendances / Films / Séries / Anime =====
   « Pour toi » est rendu à partir des recommandations existantes (js/11-recos.js, #sbContent reste la
   source et garde ses actions) : une grande carte « Car tu as aimé… » puis une rangée d'affiches par
   section, chaque affiche avec sa raison. Les autres filtres affichent les rangées existantes. */
var p3Disc='foryou';
var P3_DISC=[['foryou','nav.forYou'],['all','disc.trending'],['film','type.films'],['serie','type.series'],['anime','type.anime']];
function p3DiscSeg(){
  var el=document.getElementById('p3DiscSeg');if(!el)return;
  el.innerHTML='<div class="p3-seg" role="group"><span class="p3-seg-hl" aria-hidden="true"></span>'+P3_DISC.map(function(x){return '<button type="button" class="'+(x[0]===p3Disc?'on':'')+'" aria-pressed="'+(x[0]===p3Disc)+'"'+uiAct('p3Disc',[x[0]])+'>'+esc(t(x[1]))+'</button>';}).join('')+'</div>';
  document.body.classList.toggle('p3-foryou-on',p3Disc==='foryou');
  requestAnimationFrame(function(){p3SegHl(el);});
}
function p3SegHl(root){
  (root||document).querySelectorAll('.p3-seg').forEach(function(sg){var hl=sg.querySelector('.p3-seg-hl'),on=sg.querySelector('button.on');if(!hl||!on||!on.offsetWidth)return;hl.style.width=on.offsetWidth+'px';hl.style.transform='translateX('+(on.offsetLeft-4)+'px)';hl.style.opacity=1;});
}
function p3SetDisc(v){
  p3Disc=v;p3DiscSeg();
  if(v!=='foryou'){var b=document.querySelector('#discoverCatPills .stab[data-dc="'+v+'"]');if(b&&typeof switchDiscoverCat==='function')switchDiscoverCat(b);}
  else p3ForYou();
}
function _p3Attrs(card){
  var out='';Array.prototype.forEach.call(card.attributes,function(a){if(/^data-(tmdbid|type|title|year|poster|score|overview|genres|origin)$/.test(a.name))out+=' '+a.name+'="'+esc(a.value)+'"';});return out;
}
function p3ForYou(){
  var box=document.getElementById('p3ForYou'),src=document.getElementById('sbContent');if(!box||!src)return;
  var secs=[];
  src.querySelectorAll('.sb-section').forEach(function(sec){
    var cards=sec.querySelectorAll('.reco-card');if(!cards.length)return;
    var bt=sec.querySelector('.reco-because-title'),tt=sec.querySelector('.sb-sec-title');
    var why=bt?t('reco.because',{title:bt.textContent.trim()}):(tt?tt.textContent.trim():t('nav.forYou'));
    secs.push({why:why,because:!!bt,cards:Array.prototype.slice.call(cards)});
  });
  if(!secs.length){box.innerHTML=src.querySelector('.sb-loading,.skel,.sb-skel')?'<div class="p3-fy-skel"><i></i><i></i><i></i><i></i><i></i><i></i></div>':'';return;}
  var fs=secs.filter(function(x){return x.because;})[0]||secs[0],fc=fs.cards[0];
  var IMG=function(c,sz){var p=c.getAttribute('data-poster');return p?esc(IB+sz+p):'';};
  var feat='<section class="p3-feat reco-card"'+_p3Attrs(fc)+'><span class="p3-feat-bg" style="background-image:url(\''+IMG(fc,'w780')+'\')" aria-hidden="true"></span><span class="p3-feat-po" style="background-image:url(\''+IMG(fc,'w342')+'\')" aria-hidden="true"></span>'+
    '<div class="p3-feat-tx"><div class="p3-k">'+esc(fs.why)+'</div><h3>'+esc(fc.getAttribute('data-title')||'')+'</h3><p>'+esc((fc.getAttribute('data-overview')||'').slice(0,220))+'</p>'+
    '<div class="p3-feat-b"><button type="button" class="btn btn-p3" data-click="recoAdd">＋ '+esc(t('nav.addToList'))+'</button><button type="button" class="btn btn-pill" data-click="recoPreview">'+esc(t('hero.sheet'))+'</button><button type="button" class="btn btn-pill" data-click="recoDismiss">'+esc(t('nav.notForMe'))+'</button></div></div></section>';
  var rows=secs.map(function(sx){
    var cs=sx.cards.filter(function(c){return c!==fc;});if(!cs.length)return '';
    return '<h2 class="p3-h2">'+esc(sx.why)+'</h2><div class="p3-rail">'+cs.map(function(c,i){
      var sc=c.getAttribute('data-score'),y=c.getAttribute('data-year');
      return '<div class="reco-card p3-pc" style="--i:'+i+'"'+_p3Attrs(c)+'><button type="button" class="p3-pc-im" data-click="recoPreview" aria-label="'+esc(c.getAttribute('data-title')||'')+'" style="background-image:url(\''+IMG(c,'w342')+'\')"></button>'+
        '<button type="button" class="p3-pc-add" data-click="recoAdd" aria-label="'+esc(t('nav.addToList'))+'">＋</button><b>'+esc(c.getAttribute('data-title')||'')+'</b><i class="p3-why">'+esc(sx.why)+'</i><span class="p3-pc-m">'+esc(y||'')+(sc?' · ★ '+esc(sc):'')+'</span></div>';
    }).join('')+'</div>';
  }).join('');
  box.innerHTML=feat+rows;
}
function p3Hl(){
  var nav=document.getElementById('p3Nav');if(!nav)return;var hl=nav.querySelector('.p3-hl'),on=nav.querySelector('.p3-pill.on');
  if(!on||!on.offsetWidth){hl.style.opacity=0;return;}
  hl.style.opacity=1;hl.style.width=on.offsetWidth+'px';hl.style.transform='translateX('+on.offsetLeft+'px)';
}
function _p3Tab(name){return document.querySelector('.ntab[data-tab="'+name+'"]');}
/* Animations d'entrée : seulement pendant ~1,2 s après un changement de page (pas à chaque rendu/synchro) */
var _p3EnterT=0;
function p3Enter(){var b=document.body;b.classList.remove('p3-enter');void b.offsetWidth;b.classList.add('p3-enter');clearTimeout(_p3EnterT);_p3EnterT=setTimeout(function(){b.classList.remove('p3-enter');},1200);}
function p3Go(v,silent){
  if(P3_VIEWS.indexOf(v)<0)v='tonight';
  var prev=p3View;p3View=v;if(prev!==v||!silent)p3Enter();
  P3_VIEWS.forEach(function(x){document.body.classList.toggle('p3-v-'+x,x===v);});
  document.querySelectorAll('.p3-pill,.p3-tb').forEach(function(b){var on=b.dataset.v===v;b.classList.toggle('on',on);if(on)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  var want=v==='calendar'?'calendar':v==='discover'?'discover':v==='detectes'?'detectes':null;
  if(v==='tonight')want='all';
  if(v==='list'&&prev!=='list'&&typeof activeStat!=='undefined'&&activeStat==='all'){var sa=document.querySelector('#stabs .stab[data-s="avoir"]');if(sa)sa.click();}
  if(v==='list'){var cur=typeof activeTab!=='undefined'?activeTab:'all';want=['all','film','serie','anime'].indexOf(cur)>=0?cur:'all';}
  var btn=_p3Tab(want);
  if(btn&&(typeof activeTab==='undefined'||activeTab!==want||prev!==v)){
    if(silent&&typeof sfx==='function'){var s=sfx;sfx=function(){};try{switchTab(btn);}finally{sfx=s;}}else switchTab(btn);
  }
  p3Header();p3Hl();
  try{localStorage.setItem('wl_p3_view',v);}catch(e){}
  if(!silent)window.scrollTo({top:0,behavior:'smooth'});
}
function _p3Live(){return (typeof memDB!=='undefined'?memDB:[]).filter(function(i){return !i.deleted;});}
function p3Header(){
  var ph=document.getElementById('p3Ph');if(!ph)return;
  var L=_p3Live(),c={avoir:0,encours:0,termine:0};L.forEach(function(i){if(c[i.status]!=null)c[i.status]++;});
  var title='',sub='';
  if(p3View==='list'){title=t('nav.myList');sub=t('nav.listSub',{n:fmtNum(L.length),a:fmtNum(c.avoir),e:fmtNum(c.encours),f:fmtNum(c.termine)});}
  else if(p3View==='calendar'){title=t('cal.tab');sub=t('nav.calSub');}
  else if(p3View==='discover'){title=t('tab.discover');sub=t('nav.discSub');}
  else if(p3View==='detectes'){title=t('det.tab');sub=t('nav.detSub');}
  var act=document.getElementById('p3PhAct');
  if(!act||!ph.contains(act)){ph.innerHTML='<div class="p3-ph-t"></div><div class="p3-ph-act" id="p3PhAct"></div>';act=document.getElementById('p3PhAct');}
  /* En-tête statique : construit une fois par page, puis seul le texte change (pas de reconstruction à la synchro) */
  var pt=ph.querySelector('.p3-ph-t');
  if(!title)pt.innerHTML='';
  else{var h=pt.querySelector('h1'),pp=pt.querySelector('p');if(!h||!pp){pt.innerHTML='<h1></h1><p></p>';h=pt.querySelector('h1');pp=pt.querySelector('p');}
    if(h.textContent!==title)h.textContent=title;if(pp.textContent!==sub)pp.textContent=sub;}
  ph.classList.toggle('on',!!title);
  /* Ma liste : recherche dans la liste et « Ajouter » à droite du titre ; ailleurs, retour dans la barre d'outils */
  var nr=document.querySelector('.nav.floating .nav-right'),sr=document.querySelector('.srch'),ad=document.querySelector('.add-btn[data-click="openAdd"]');
  if(nr&&sr&&ad){if(p3View==='list'){if(sr.parentNode!==act){act.appendChild(sr);act.appendChild(ad);}
    var shb=document.getElementById('p3ShareBtn');if(!shb){shb=document.createElement('button');shb.type='button';shb.id='p3ShareBtn';shb.className='p3-share-b';shb.setAttribute('data-click','openShare');
      shb.innerHTML=_p3Svg('<path d="M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7M16 6l-4-4-4 4M12 2v13"/>')+'<span></span>';}
    shb.querySelector('span').textContent=t('share.title');if(shb.parentNode!==act||shb.nextSibling!==ad)act.insertBefore(shb,ad);}else if(sr.parentNode===act){nr.insertBefore(ad,nr.firstChild);nr.appendChild(sr);}}
  var lc=document.querySelector('[data-cnt="list"]');if(lc)lc.textContent=L.length?fmtNum(L.length):'';
  var db=document.getElementById('detBadge'),dc=document.querySelectorAll('[data-cnt="detectes"]'),n=db&&!db.hidden?(db.textContent||'').trim():'';
  dc.forEach(function(e){e.textContent=n;});
  /* Détectés n'existe qu'avec un compte : mêmes règles que l'ancien onglet */
  var dt=document.getElementById('detTab'),dh=!dt||dt.hidden;
  document.querySelectorAll('[data-v="detectes"]').forEach(function(b){b.hidden=dh;});
  if(dh&&p3View==='detectes'){p3Go('tonight',true);return;}
  var cp=document.getElementById('p3Cpt');if(cp){cp.setAttribute('aria-checked',compactOn?'true':'false');cp.classList.toggle('on',!!compactOn);}
  document.body.classList.toggle('p3-compact',!!compactOn);
  var dot=document.getElementById('p3Dot');if(dot)dot.hidden=!L.some(function(i){return i.hasNewEp;});
}
function p3BellClose(){var pop=document.getElementById('p3Pop'),b=document.getElementById('p3Bell');if(pop)pop.hidden=true;if(b)b.setAttribute('aria-expanded','false');}
function p3Bell(){
  var pop=document.getElementById('p3Pop'),b=document.getElementById('p3Bell');if(!pop)return;
  if(!pop.hidden){p3BellClose();return;}
  var news=_p3Live().filter(function(i){return i.hasNewEp;});
  pop.innerHTML='<div class="p3-pop-h">'+esc(t('nav.notifs'))+'</div>'+(news.length?news.slice(0,8).map(function(i){
    return '<button type="button" class="p3-pop-r" role="menuitem"'+uiAct('p3OpenNew',[i.id])+'><span class="p3-pop-im"'+(i.poster?' style="background-image:url(\''+esc(IB+'w92'+i.poster)+'\')"':'')+'></span><span><b>'+esc(i.title)+'</b><i>'+esc(t('nav.newEp'))+'</i></span></button>';
  }).join(''):'<div class="p3-pop-e">'+esc(t('nav.notifsEmpty'))+'</div>');
  pop.hidden=false;b.setAttribute('aria-expanded','true');if(typeof sfx==='function')sfx('open');
}
/* Après chaque rendu : compteurs, en-tête et cloche à jour */
(function(){
  if(typeof render!=='function')return;
  var r0=render;render=function(){var out=r0.apply(this,arguments);try{p3Header();}catch(e){}return out;};
})();
/* Un onglet ouvert autrement (lien /#detectes, raccourci, « Tout voir »…) met la navigation à jour */
(function(){
  if(typeof switchTab!=='function')return;
  var s0=switchTab;switchTab=function(btn){
    var out=s0.apply(this,arguments),tab=btn&&btn.dataset&&btn.dataset.tab;
    var v=tab==='calendar'||tab==='discover'||tab==='detectes'?tab:(p3View==='tonight'||p3View==='list'?p3View:'list');
    if(v!==p3View){p3View=v;p3Enter();P3_VIEWS.forEach(function(x){document.body.classList.toggle('p3-v-'+x,x===v);});
      document.querySelectorAll('.p3-pill,.p3-tb').forEach(function(b){b.classList.toggle('on',b.dataset.v===v);});p3Header();p3Hl();}
    return out;
  };
})();
p3Build();
(function(){var v='tonight';try{v=localStorage.getItem('wl_p3_view')||'tonight';}catch(e){}p3Go(v,true);})();
if(typeof module!=='undefined')module.exports={P3_VIEWS:P3_VIEWS};
