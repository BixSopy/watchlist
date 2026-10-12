/* MODULE: Config & état global — clés API, client Supabase, variables d'état partagées par tous les autres modules. */
/* CONFIG */
/* Les appels TMDB/OMDb passent par les fonctions serverless /api (clés côté serveur uniquement) */
var TB='/api/tmdb',IB='https://image.tmdb.org/t/p/';
/* SUPABASE — sync multi-appareils (Session 10) */
var SUPA_URL='https://batfulcvvquffgfeppcx.supabase.co';
var SUPA_KEY='sb_publishable_AgSykBvnAW4cZmuMZJWnrA_lcFL5eT0';
/* Retour depuis un email d'authentification, lu AVANT createClient (qui consomme le
   fragment #access_token=…). Deux formats :
   - ?action=signup&type=email&token_hash=… (gabarits de supabase/templates/) : le jeton est
     retiré de l'URL tout de suite, puis vérifié après un clic (js/20-account.js) ;
   - #access_token=…&type=recovery (ancien format {{ .ConfirmationURL }}) ou #error_code=… */
var AUTH_LANDING=(function(){
  try{
    var q=new URLSearchParams(location.search),h=new URLSearchParams(String(location.hash||'').replace(/^#/,''));
    var TYPES=['email','signup','recovery','invite','magiclink','email_change'];
    var ACTIONS=['signup','recovery','invite','magiclink','email_change'];
    var out=null,th=q.get('token_hash'),ty=q.get('type'),ac=q.get('action');
    if(th&&/^[A-Za-z0-9_-]{8,200}$/.test(th)&&TYPES.indexOf(ty)>=0){
      out={kind:'token_hash',tokenHash:th,type:ty,action:ACTIONS.indexOf(ac)>=0?ac:(ty==='email'?'signup':ty)};
    }else if(h.get('error_code')||q.get('error_code')||h.get('error')){
      out={kind:'error',code:String(h.get('error_code')||q.get('error_code')||h.get('error')).slice(0,60),description:String(h.get('error_description')||q.get('error_description')||'').slice(0,200)};
    }else if(h.get('access_token')&&TYPES.indexOf(h.get('type'))>=0){
      out={kind:'session',type:h.get('type')};
    }
    /* ?lang= (liens des emails) est lu par js/00-i18n.js puis retiré de l'adresse */
    var strip=(out&&out.kind!=='session')?['token_hash','type','action','error','error_code','error_description']:[];
    if(q.has('lang'))strip.push('lang');
    if(strip.length){
      strip.forEach(function(k){q.delete(k);});
      var qs=q.toString();
      history.replaceState(null,'',location.pathname+(qs?'?'+qs:''));
    }
    return out;
  }catch(e){return null;}
})();
var supa=(typeof supabase!=='undefined')?supabase.createClient(SUPA_URL,SUPA_KEY,{auth:{flowType:'implicit',detectSessionInUrl:true,persistSession:true,autoRefreshToken:true}}):null;
var authUser=null,authProfileId=null,syncInProgress=false,syncLoopTimer=null,lastSyncErrorToast=0;
/* STATE */
var idb=null,memDB=[],editId=null,selTmdb=null,myRate=0,stimer=null;
var activeTab='all',activeStat='all',fq='',sortBy='date';
var curTags=[],plexData=null,plexSeasons=[],soundOn=true,compactOn=false;
var dismissed=[],cache={},autoTimer=null,autoPaused=false;
/* Signal négatif pour le profil de goût (js/09-taste-profile.js) : {id:{genreIds,decade,
   originCountry,ts}} pour chaque reco explicitement refusée (bouton "Non"). Séparé de
   `dismissed` (liste brute d'ids, utilisée partout pour l'exclusion) pour ne rien changer
   à son format existant. */
var dismissedMeta={};
