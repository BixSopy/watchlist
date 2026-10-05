/* MODULE: Config & état global — clés API, client Supabase, variables d'état partagées par tous les autres modules. */
/* CONFIG */
/* Les appels TMDB/OMDb passent par les fonctions serverless /api (clés côté serveur uniquement) */
var TB='/api/tmdb',IB='https://image.tmdb.org/t/p/';
/* SUPABASE — sync multi-appareils (Session 10) */
var SUPA_URL='https://batfulcvvquffgfeppcx.supabase.co';
var SUPA_KEY='sb_publishable_AgSykBvnAW4cZmuMZJWnrA_lcFL5eT0';
var supa=(typeof supabase!=='undefined')?supabase.createClient(SUPA_URL,SUPA_KEY):null;
var authUser=null,authProfileId=null,syncInProgress=false,syncLoopTimer=null,lastSyncErrorToast=0;
/* STATE */
var idb=null,memDB=[],editId=null,selTmdb=null,myRate=0,stimer=null;
var activeTab='all',activeStat='all',fq='',sortBy='date';
var curTags=[],plexData=null,plexSeasons=[],soundOn=true,compactOn=false;
var dismissed=[],cache={},autoTimer=null,autoPaused=false;
