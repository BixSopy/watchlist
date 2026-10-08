/* MODULE: Page d'accueil des visiteurs — décision AVANT le premier affichage.
   Chargé de façon synchrone dans <head> (fichier externe : la CSP interdit les scripts en ligne).
   Par défaut (et sans JavaScript, ex. robots d'indexation), la page d'accueil (#landing) est
   affichée et l'app est masquée. Ce script ajoute la classe « lp-member » sur <html> quand :
   - une session Supabase est enregistrée sur l'appareil (clé sb-<projet>-auth-token, écrite par
     supabase-js), ou un retour de lien email porte une session (#access_token=…) ;
   - ou l'appareil a choisi d'ouvrir l'app sans compte (wl_app_guest, liste locale existante).
   Une session expirée mais rafraîchissable compte comme connectée : si le rafraîchissement échoue,
   supabase-js émet SIGNED_OUT et js/23-landing.js réaffiche l'accueil. Aucune requête réseau ici. */
(function(){
  var root=document.documentElement,member=false;
  try{
    if(/(^|[#&])access_token=/.test(location.hash||''))member=true;
    if(!member&&localStorage.getItem('wl_app_guest')==='1')member=true;
    for(var i=0;!member&&i<localStorage.length;i++){
      var k=localStorage.key(i);
      if(!/^sb-[a-z0-9]+-auth-token$/.test(k||''))continue;
      var s=JSON.parse(localStorage.getItem(k)||'null');
      if(s&&(s.refresh_token||s.access_token||(s.currentSession&&s.currentSession.refresh_token)))member=true;
    }
  }catch(e){}
  root.classList.add(member?'lp-member':'lp-guest');
  /* Membres : titre court dans l'onglet (le <title> descriptif sert à la page d'accueil) */
  if(member)try{document.title=String(document.title).split(' · ')[0];}catch(e){}
  /* Animations d'apparition seulement si JavaScript tourne et que l'utilisateur ne les refuse pas */
  try{if(!member&&!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches))root.classList.add('lp-anim');}catch(e){}
})();
