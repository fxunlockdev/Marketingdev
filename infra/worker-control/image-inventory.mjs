/** Optional website renderer and Agent Reach sandbox must still be explicit, unique and immutable. */
export function validateWorkerInventory(manifest){
 const required=['trusted_worker','documents','skills','static_renderer','video_renderer'];
 const allowed=[...required,'website_renderer','agent_reach'];
 if(!manifest||!Array.isArray(manifest.images)||manifest.images.length<required.length||manifest.images.length>allowed.length)throw new Error('BUNDLE_INVALID_INVENTORY');
 const roles=new Set(manifest.images.map(i=>i?.role));
 if(roles.size!==manifest.images.length||required.some(role=>!roles.has(role))||manifest.images.some(i=>!allowed.includes(i?.role)||!/^sha256:[a-f0-9]{64}$/.test(i?.image_id??'')))throw new Error('BUNDLE_INVALID_INVENTORY');
 return manifest.images;
}
