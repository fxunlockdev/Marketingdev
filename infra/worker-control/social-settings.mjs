const project='5427d9ae-d5d0-4e6f-8dcb-52fc8de67e12',environment='6a760b10-9ed8-4f01-9c4a-77a25919755a';
export function devSocialSettings(state,apiOAuthKey){
 if(state.social_enabled!==true)return {};
 if(state.project_id!==project||state.environment_id!==environment||state.postiz_service_id!=='12fba8b8-e4f0-45c4-900f-fa4cb05f5c83'||typeof state.publishing_enabled!=='boolean')throw Error('SOCIAL_CONFIGURATION_INVALID');
 if(!/^[a-f0-9]{64}$/i.test(state.encryption_key??'')||!/^[a-f0-9]{64}$/i.test(state.oauth_encryption_key??'')||state.encryption_key===state.oauth_encryption_key||state.oauth_encryption_key!==apiOAuthKey)throw Error('SOCIAL_ENCRYPTION_CONFIGURATION_INVALID');
 const origin='https://desvio-dev-web-dev.up.railway.app';
 return {POSTIZ_ENABLED:'true',POSTIZ_PUBLISHING_ENABLED:String(state.publishing_enabled),POSTIZ_BASE_URL:'http://desvio-dev-postiz.railway.internal:5000/api',POSTIZ_MEDIA_ORIGINS:origin,POSTIZ_CALLBACK_ORIGIN:origin,POSTIZ_ENCRYPTION_KEY:state.encryption_key,OAUTH_ENCRYPTION_KEY:state.oauth_encryption_key};
}
