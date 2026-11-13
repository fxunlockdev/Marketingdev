// Agent Reach research on the worker. AGENT_REACH_ENABLED in the worker-settings service is the
// operator switch; the sandbox image comes only from the reviewed image inventory.
// Nothing is set when neither the switch nor an agent_reach image exists, so dev is unchanged.
export function agentReachRuntimeSettings(settings,images){
 const flag=settings?.AGENT_REACH_ENABLED;
 if(flag!==undefined&&flag!==''&&!['true','false'].includes(flag))throw Error('INVALID_AGENT_REACH_SETTINGS');
 const image=images.find(i=>i.role==='agent_reach')?.image_id;
 if(image!==undefined&&!/^sha256:[a-f0-9]{64}$/.test(image))throw Error('INVALID_AGENT_REACH_SETTINGS');
 if(flag==='true'&&!image)throw Error('INVALID_AGENT_REACH_SETTINGS');
 const output={};
 if(image)output.AGENT_REACH_IMAGE=image;
 if(flag==='true'||flag==='false')output.AGENT_REACH_ENABLED=flag;
 return output;
}
