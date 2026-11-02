/* Episode Spine: charte Claude, 02/11/2026. Aucune requête tierce. */
(function(){
  'use strict';
  var mark='<svg class="logo-mark" viewBox="0 0 24 24" aria-hidden="true"><rect class="logo-bar logo-bar-1" x="3.5" y="12" width="4" height="7" rx="2" fill="#5c5c66"/><rect class="logo-bar logo-bar-2" x="10" y="8.5" width="4" height="10.5" rx="2" fill="#9a9aa3"/><rect class="logo-bar logo-bar-3" x="16.5" y="4" width="4" height="14" rx="2" fill="#5cc8ff"/></svg>';
  var css='.sb-spin{width:24px;height:24px;border:0;border-radius:0;animation:none;margin:0 auto 10px}.sb-spin .logo-mark{width:24px;height:24px}.sb-spin .logo-bar,.brand-startup .logo-bar{transform-box:fill-box;transform-origin:center bottom;animation:sbBounce .9s ease-in-out infinite}.sb-spin .logo-bar-2,.brand-startup .logo-bar-2{animation-delay:.15s}.sb-spin .logo-bar-3,.brand-startup .logo-bar-3{animation-delay:.3s}@keyframes sbBounce{0%,55%,100%{transform:translateY(0)}25%{transform:translateY(-3px)}}.brand-startup{position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;background:#0a0a0c;color:#f0f0f0;font:600 14px sans-serif;transition:opacity .2s ease,visibility .2s ease}.brand-startup .logo-mark{width:60px;height:60px}.brand-startup.is-done{opacity:0;visibility:hidden;pointer-events:none}@media(prefers-reduced-motion:reduce){.sb-spin .logo-bar,.brand-startup .logo-bar{animation:none!important}.brand-startup{transition:none}}';
  var style=document.createElement('style');style.textContent=css;document.head.appendChild(style);
  function replace(root){
    if(!root||!root.querySelectorAll)return;
    root.querySelectorAll('svg.logo-mark').forEach(function(el){if(!el.querySelector('.logo-bar'))el.outerHTML=mark;});
    root.querySelectorAll('.sb-spin').forEach(function(el){if(!el.querySelector('.logo-mark')){el.innerHTML=mark;el.setAttribute('role','status');el.setAttribute('aria-label','Chargement');}});
  }
  function start(){
    if(!document.body)return;
    replace(document);
    var splash=document.createElement('div');
    splash.className='brand-startup';splash.id='brandStartup';splash.setAttribute('role','status');splash.setAttribute('aria-live','polite');
    splash.innerHTML=mark+'<span>Chargement...</span>';
    document.body.appendChild(splash);
    var done=false;
    function dismiss(){if(done)return;done=true;splash.classList.add('is-done');setTimeout(function(){splash.remove();},250);}
    if(document.readyState==='complete')setTimeout(dismiss,450);
    else window.addEventListener('load',function(){setTimeout(dismiss,300);},{once:true});
    setTimeout(dismiss,2500);
    var side=document.getElementById('sbContent');
    if(side&&window.MutationObserver)new MutationObserver(function(){replace(side);}).observe(side,{childList:true,subtree:false});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
