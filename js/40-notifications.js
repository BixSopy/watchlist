/* MODULE: Notifications par e-mail (rappels de sorties + newsletter), demande de Pierre (07/11).
   Deux bascules indépendantes dans Réglages, DÉSACTIVÉES PAR DÉFAUT (opt-in, jamais opt-out).
   RPC : set_notification_prefs, get_my_notification_prefs
   (migration 20261107100000_notification_prefs.sql). Sans la migration : section cachée, comme
   le reste du social (socialUnavailable, js/32-handle.js).
   - « releases » : digest hebdomadaire automatique des prochaines sorties (séries/anime suivis),
     envoyé par le job cron api/notifications-digest.js — rien à faire ici au-delà de la préférence.
   - « newsletter » : en plus de la préférence, synchronise l'abonnement au Topic Resend
     correspondant via /api/newsletter-sync (jamais de clé Resend côté client). */
var NOTIF={available:null,releases:false,newsletter:false,loading:null};

function notifLoad(force){
  if(typeof supa==='undefined'||!supa||!authProfileId||NOTIF.available===false)return Promise.resolve(null);
  if(NOTIF.loading&&!force)return NOTIF.loading;
  NOTIF.loading=supa.rpc('get_my_notification_prefs',{p_profile_id:authProfileId}).then(function(r){
    NOTIF.loading=null;
    if(r.error){if(typeof socialUnavailable==='function'&&socialUnavailable(r.error))NOTIF.available=false;else NOTIF.failedAt=Date.now();return null;}
    if(!r.data||r.data.status!=='ok'){NOTIF.failedAt=Date.now();return null;}
    NOTIF.available=true;
    var p=r.data.prefs||{};
    NOTIF.releases=!!p.releases;NOTIF.newsletter=!!p.newsletter;
    return NOTIF;
  },function(){NOTIF.loading=null;NOTIF.failedAt=Date.now();return null;});
  return NOTIF.loading;
}
if(typeof socialOnChange==='function')socialOnChange(function(){NOTIF.available=null;notifLoad();});

/* Synchro de l'abonnement Resend (Topic « newsletter »), en tâche de fond : ne bloque jamais la
   bascule locale, échec silencieux (le toggle lui-même aura déjà réussi ou été annulé). */
function _newsletterSync(enabled){
  if(typeof _getAccessToken!=='function')return;
  _getAccessToken().then(function(tok){
    if(!tok)return;
    return fetch('/api/newsletter-sync',{method:'POST',headers:{Authorization:'Bearer '+tok,'Content-Type':'application/json'},
      body:JSON.stringify({enabled:enabled}),credentials:'omit',cache:'no-store'});
  }).catch(function(){});
}

/* Bascule optimiste (comme reactTap/recoPrivToggle) : état local + rendu immédiats, RPC en tâche
   de fond, retour arrière silencieux + toast d'erreur en cas d'échec. */
function _notifToggle(field){
  if(!NOTIF.available||!authProfileId)return;
  var prevReleases=NOTIF.releases,prevNewsletter=NOTIF.newsletter;
  var val=!NOTIF[field];
  NOTIF[field]=val;
  var args={p_profile_id:authProfileId};
  args[field==='releases'?'p_releases':'p_newsletter']=val;
  supa.rpc('set_notification_prefs',args).then(function(r){
    if(r.error||!r.data||r.data.status!=='ok'){
      NOTIF.releases=prevReleases;NOTIF.newsletter=prevNewsletter;renderSettingsMenu();
      if(typeof toast==='function')toast(t('notif.err'),'err');
      return;
    }
    if(field==='newsletter')_newsletterSync(val);
  },function(){
    NOTIF.releases=prevReleases;NOTIF.newsletter=prevNewsletter;renderSettingsMenu();
    if(typeof toast==='function')toast(t('notif.err'),'err');
  });
}
function toggleNotifReleases(){_notifToggle('releases');}
function toggleNotifNewsletter(){_notifToggle('newsletter');}

/* Section Réglages : rendue seulement une fois la disponibilité connue (évite un flash
   affiché-puis-caché si la migration n'est pas en place), même esprit que _trackTokenSection. */
function _notifSection(idx){
  if(!authProfileId)return '';
  /* Redessiné seulement si le chargement réussit : après un échec (hors connexion, erreur passagère),
     redessiner relançait aussitôt le chargement, donc une boucle de rendu du panneau entier. Nouvel
     essai au plus une fois par minute, à la prochaine ouverture ou au prochain rendu. */
  if(NOTIF.available===null){
    if(!(NOTIF.failedAt&&Date.now()-NOTIF.failedAt<60000))notifLoad().then(function(r){if(r&&typeof renderSettingsMenu==='function')renderSettingsMenu();});
    return '';
  }
  if(NOTIF.available===false)return '';
  var html=_secOpen(idx)+_secTitle('bell',esc(t('set.notifSection')));
  html+=_delegatedToggleRow(esc(t('set.notifReleases')),esc(t('set.notifReleasesHint')),'toggleNotifReleases',NOTIF.releases);
  html+=_delegatedToggleRow(esc(t('set.notifNewsletter')),esc(t('set.notifNewsletterHint')),'toggleNotifNewsletter',NOTIF.newsletter);
  html+='</div>';
  return html;
}
if(typeof module!=='undefined')module.exports={NOTIF:NOTIF,notifLoad:notifLoad,toggleNotifReleases:toggleNotifReleases,
  toggleNotifNewsletter:toggleNotifNewsletter,_notifSection:_notifSection};
