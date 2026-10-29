/* MODULE: Social (étape 1) : visibilité de ma liste pour mes amis (liste, progression, notes, activité ; notes perso
   jamais partagées) et export RGPD de la partie sociale. RPC : set_social_settings, get_my_social.
   Par défaut : liste et progression visibles, notes masquées. La suppression du compte efface tout (cascade). */
var SOC_PRIV=['show_list','show_progress','show_ratings','show_activity'];
function socialPrivacyHtml(){
  var s=(SOCIAL.me&&SOCIAL.me.settings)||{show_list:true,show_progress:true,show_ratings:false,show_activity:true};
  return '<details class="sp"><summary><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>'+esc(t('privacy.title'))+'</summary>'+
    '<p class="soc-sub">'+esc(t('privacy.sub'))+'</p><div class="sp-rows">'+SOC_PRIV.map(function(k){
      var on=!!s[k],dis=k!=='show_list'&&!s.show_list;
      return '<button type="button" class="sp-row" role="switch" aria-checked="'+on+'"'+(dis?' disabled':'')+uiAct('socialPrivToggle',[k])+'><span><b>'+esc(t('privacy.'+k.replace('show_','')))+'</b><em>'+esc(t('privacy.'+k.replace('show_','')+'Sub'))+'</em></span><span class="p3-sw" aria-hidden="true"></span></button>';
    }).join('')+(typeof recoPrivRowHtml==='function'?recoPrivRowHtml():'')+'</div><p class="soc-note">'+esc(t('privacy.notes'))+'</p></details>';
}
function socialPrivToggle(el,key){
  if(SOC_PRIV.indexOf(key)<0||!SOCIAL.me)return;
  var s=SOCIAL.me.settings=SOCIAL.me.settings||{},v=!s[key],args={p_profile_id:authProfileId};
  args['p_'+key]=v;s[key]=v;el.setAttribute('aria-checked',String(v));
  var d=el.closest('details');if(key==='show_list'&&d)d.querySelectorAll('.sp-row').forEach(function(b,i){if(i>0)b.disabled=!v;});
  supa.rpc('set_social_settings',args).then(function(r){
    if(r.error||!r.data||r.data.status!=='ok'){s[key]=!v;el.setAttribute('aria-checked',String(!v));toast(t('friends.err.generic'),'err');return;}
    toast(t('privacy.saved'));
  });
}
/* Export RGPD : état social de chaque profil du compte (null si la migration n'est pas en place) */
function socialExportData(ids){
  if(typeof supa==='undefined'||!supa||!ids||!ids.length)return Promise.resolve(null);
  return Promise.all(ids.map(function(id){
    return supa.rpc('get_my_social',{p_profile_id:id}).then(function(r){
      if(r.error||!r.data||r.data.status!=='ok')return null;
      var d=Object.assign({profile_id:id},r.data);delete d.status;
      if(typeof recoExportData!=='function')return d;
      return recoExportData(id).then(function(rc){if(rc)d.recommendations=rc;return d;});
    },function(){return null;});
  })).then(function(all){all=all.filter(Boolean);return all.length?all:null;});
}
if(typeof module!=='undefined')module.exports={socialPrivacyHtml:socialPrivacyHtml,socialExportData:socialExportData};
