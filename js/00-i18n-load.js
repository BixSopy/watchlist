/* MODULE: Chargement des langues — seulement les dictionnaires utiles.
   Avant : les 10 dictionnaires étaient chargés à chaque ouverture (≈ 220 Ko compressés, 42 % du poids
   de la page) alors qu'un seul sert. Script synchrone placé à l'endroit des anciennes balises : il
   détecte la langue puis écrit les balises <script defer> de la langue active et des deux langues de
   repli de t() (anglais, français) ; écrites pendant l'analyse de la page, elles s'exécutent dans
   l'ordre, avant js/00-i18n.js. Changer de langue recharge la page (setLang) : le nouveau dictionnaire
   arrive avec ce rechargement.
   Choix de la langue : ?lang= ou /en, /fr dans l'adresse > choix enregistré > langue du navigateur
   (première langue disponible) > anglais.
   I18N_LANGS (nom, ordre dans le sélecteur, sens de lecture de chaque langue) est généré par
   scripts/build-brand.mjs depuis les $meta de js/i18n/<code>.js — ne pas le modifier à la main. */
var I18N_LANGS=/*i18n:langs*/{"fr":{"name":"Français","rank":6,"dir":"ltr"},"ar":{"name":"العربية","rank":5,"dir":"rtl"},"bn":{"name":"বাংলা","rank":7,"dir":"ltr"},"en":{"name":"English","rank":1,"dir":"ltr"},"es":{"name":"Español","rank":4,"dir":"ltr"},"hi":{"name":"हिन्दी","rank":3,"dir":"ltr"},"pt":{"name":"Português","rank":8,"dir":"ltr"},"ru":{"name":"Русский","rank":9,"dir":"ltr"},"ur":{"name":"اردو","rank":10,"dir":"rtl"},"zh":{"name":"中文","rank":2,"dir":"ltr"}}/*/i18n:langs*/;
var I18N_STORAGE_KEY='wl_lang',I18N_FALLBACK='en';
/* Langues disponibles, dans l'ordre de rank (les plus parlées d'abord) */
function i18nLanguages(){
  return Object.keys(I18N_LANGS).sort(function(a,b){
    return (I18N_LANGS[a].rank||99)-(I18N_LANGS[b].rank||99)||(a<b?-1:1);
  });
}
function i18nNormalize(code){
  var base=String(code||'').toLowerCase().split(/[-_]/)[0];
  return Object.prototype.hasOwnProperty.call(I18N_LANGS,base)?base:'';
}
function i18nDetect(){
  try{
    var q=new URLSearchParams(location.search).get('lang');
    var p=(location.pathname.match(/^\/([a-z]{2})\/?$/)||[])[1];
    var forced=i18nNormalize(q)||i18nNormalize(p);
    if(forced){try{localStorage.setItem(I18N_STORAGE_KEY,forced);}catch(e){}return forced;}
  }catch(e){}
  try{var saved=i18nNormalize(localStorage.getItem(I18N_STORAGE_KEY));if(saved)return saved;}catch(e){}
  var navs=(navigator.languages&&navigator.languages.length)?navigator.languages:[navigator.language||''];
  for(var i=0;i<navs.length;i++){var l=i18nNormalize(navs[i]);if(l)return l;}
  return I18N_LANGS[I18N_FALLBACK]?I18N_FALLBACK:(i18nLanguages()[0]||'fr');
}
var LANG=i18nDetect();
/* Dictionnaires nécessaires : langue active + chaîne de repli de t() (js/00-i18n.js), sans doublon */
function i18nNeeded(lang){
  return [lang,I18N_FALLBACK,'fr'].filter(function(l,i,a){return I18N_LANGS[l]&&a.indexOf(l)===i;});
}
document.write(i18nNeeded(LANG).map(function(l){return '<script defer src="js/i18n/'+l+'.js"><\/script>';}).join(''));
