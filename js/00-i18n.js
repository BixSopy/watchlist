/* MODULE: Langues (i18n) — dictionnaires js/i18n/<code>.js, langue active, t() / tn(), formats Intl.
   Ajouter une langue : copier js/i18n/en.js en js/i18n/<code>.js, le traduire, puis lancer
   `node scripts/build-brand.mjs` (qui l'ajoute à la liste des langues de js/00-i18n-load.js). */
var I18N_DICTS=window.I18N_DICTS||{};
/* LANG, I18N_LANGS, i18nLanguages(), i18nNormalize() : définis par js/00-i18n-load.js, qui choisit
   la langue avant de charger son dictionnaire. */
var I18N_META=(I18N_DICTS[LANG]&&I18N_DICTS[LANG].$meta)||{locale:'fr-FR',tmdb:'fr-FR',region:'FR'};
var LOCALE=I18N_META.locale;
/* Sens de lecture : $meta.dir = 'rtl' (arabe, ourdou) → <html dir="rtl"> ; le CSS suit (propriétés logiques). */
var IS_RTL=I18N_META.dir==='rtl',DIR=IS_RTL?'rtl':'ltr';
/* Langue et pays des requêtes TMDB (titres, résumés, plateformes de streaming) */
var TMDB_LANG=I18N_META.tmdb||LOCALE,TMDB_REGION=I18N_META.region||'FR';
/* Texte inséré dans une phrase de droite à gauche (titre latin, adresse e-mail, pseudo…) : isolé
   (FSI…PDI) pour que la ponctuation voisine et l'ordre des mots ne s'inversent pas. Inutile en LTR. */
var I18N_ISOLATE={title:1,name:1,email:1,handle:1,device:1,q:1,kw:1,word:1};
function i18nIso(k,v){return(IS_RTL&&I18N_ISOLATE[k]&&v&&/[A-Za-z0-9]/.test(v))?'\u2068'+v+'\u2069':v;}
/* Traduction : t('cle',{n:3}) remplace {n}. Repli : langue active > anglais > français > clé. */
function t(key,vars){
  var s=null,chain=[LANG,I18N_FALLBACK,'fr'];
  for(var i=0;i<chain.length&&s==null;i++){var d=I18N_DICTS[chain[i]];if(d&&Object.prototype.hasOwnProperty.call(d,key))s=d[key];}
  if(s==null){s=key;try{console.warn('[i18n] clé manquante',key);}catch(e){}}
  if(vars)s=String(s).replace(/\{(\w+)\}/g,function(m,k){return Object.prototype.hasOwnProperty.call(vars,k)?i18nIso(k,String(vars[k])):m;});
  return s;
}
/* Pluriels : tn('cle',n) cherche 'cle.<catégorie>' (zero|one|two|few|many|other, règles
   Intl.PluralRules de la langue : 2 formes en français/anglais, 4 en russe, 6 en arabe, 1 en chinois),
   puis 'cle.other'. */
var _plural=null;
function tn(key,n,vars){
  var v=Object.assign({n:fmtNum(n)},vars||{}),rule='other';
  try{_plural=_plural||new Intl.PluralRules(LOCALE);rule=_plural.select(n);}catch(e){rule=n===1?'one':'other';}
  var d=I18N_DICTS[LANG]||{};
  return t(Object.prototype.hasOwnProperty.call(d,key+'.'+rule)?key+'.'+rule:key+'.other',v);
}
function fmtNum(n,opts){try{return new Intl.NumberFormat(LOCALE,opts).format(n);}catch(e){return String(n);}}
function fmtDate(d,opts){
  var dt=d instanceof Date?d:new Date(d);if(isNaN(dt))return '';
  try{return new Intl.DateTimeFormat(LOCALE,opts||{day:'numeric',month:'short',year:'numeric'}).format(dt);}catch(e){return dt.toISOString().slice(0,10);}
}
/* Textes statiques d'index.html : data-i18n="cle" (texte) et data-i18n-attr="placeholder:cle;title:cle2" */
function applyI18n(root){
  root=root||document;
  root.querySelectorAll('[data-i18n]').forEach(function(el){el.textContent=t(el.getAttribute('data-i18n'));});
  root.querySelectorAll('[data-i18n-attr]').forEach(function(el){
    el.getAttribute('data-i18n-attr').split(';').forEach(function(pair){
      var i=pair.indexOf(':');if(i>0)el.setAttribute(pair.slice(0,i).trim(),t(pair.slice(i+1).trim()));
    });
  });
  /* Liens vers les pages légales de la langue active */
  root.querySelectorAll('a[data-legal]').forEach(function(a){
    var l=legalUrl(a.getAttribute('data-legal'));if(l)a.setAttribute('href',l);
  });
}
/* Adresse d'une page légale ('privacy' | 'terms') dans la langue active (repli : français) */
function legalUrl(kind){
  var l=(BRAND.legal&&(BRAND.legal[LANG]||BRAND.legal[BRAND.defaultLang]||BRAND.legal.fr))||{};
  return l[kind]||'';
}
/* Change la langue : enregistrée sur l'appareil et dans le compte (langue des emails), puis
   rechargement pour que tout l'affichage (et le catalogue TMDB) passe dans la nouvelle langue. */
function setLang(code,opts){
  code=i18nNormalize(code);if(!code)return;
  try{localStorage.setItem(I18N_STORAGE_KEY,code);}catch(e){}
  if(opts&&opts.reopen){try{sessionStorage.setItem('wl_reopen',JSON.stringify(opts.reopen));}catch(e){}}
  var done=function(){
    var u=new URL(location.href);u.searchParams.delete('lang');
    if(/^\/[a-z]{2}\/?$/.test(u.pathname))u.pathname='/'+code;
    location.replace(u.pathname+u.search+u.hash);
  };
  if(code===LANG)return done();
  var p=(typeof saveLangToAccount==='function')?saveLangToAccount(code):null;
  if(p&&p.then)p.then(done,done);else done();
}
/* Sélecteur de langue réutilisable (réglages, écran de connexion, pied de page) : liste déroulante
   (csel-done-marker : reste un <select> natif, que enhanceAllSelects de js/18-bootstrap.js ne remplace pas), chaque langue dans son
   écriture et avec son attribut lang. */
function langSwitcherHtml(cls,opts){
  var args=opts?JSON.stringify([opts]):'';
  return '<div class="lang-switch '+(cls||'')+'"><select class="lang-pick csel-done-marker" aria-label="'+esc(t('lang.label'))+'" data-change="setLangSelect"'+(args?' data-args="'+esc(args)+'"':'')+'>'+i18nLanguages().map(function(c){
    var m=I18N_LANGS[c]||{};
    return '<option value="'+c+'" lang="'+c+'" dir="'+(m.dir==='rtl'?'rtl':'ltr')+'"'+(c===LANG?' selected':'')+'>'+esc(m.name||c)+'</option>';
  }).join('')+'</select></div>';
}
/* Balises de la page dans la langue active (description, Open Graph, adresse canonique de /fr, /en) */
function applyI18nHead(){
  var set=function(sel,val){var el=document.querySelector(sel);if(el&&val)el.setAttribute('content',val);};
  set('meta[name="description"]',I18N_META.description);
  set('meta[property="og:description"]',I18N_META.description);
  set('meta[property="og:title"]',I18N_META.tagline?BRAND.name+' · '+I18N_META.tagline:'');
  set('meta[property="og:locale"]',I18N_META.og);
  var c=document.querySelector('link[rel="canonical"]');
  if(c&&/^\/[a-z]{2}\/?$/.test(location.pathname))c.setAttribute('href',BRAND.baseUrl+'/'+LANG);
}
document.documentElement.lang=LANG;
document.documentElement.dir=DIR;
applyI18nHead();
applyI18n();
