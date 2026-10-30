const PROFILES={
  'gpt-6.1-sol':{provider:'openai',model:'gpt-6.1-sol',thinking:'high',
    baseUrl:'https://api.openai.com/v1',billing:'chatgpt_subscription_oauth',wireOutputCap:null,
    service:'GPT-6.1 Sol through Pi and Sign in with ChatGPT; not GPT-6 Sol or the Codex CLI',
    source:'https://developers.openai.com/api/docs/models/gpt-6.1-sol'},
  'deepseek-flash':{provider:'deepseek',model:'deepseek-flash',thinking:'max',
    baseUrl:'https://api.deepseek.com',billing:'api_key',wireOutputCap:16384,
    service:'DeepSeek-V4.1-Flash-1017; documented alias, not immutable snapshot',
    source:'https://api-docs.deepseek.com/quick_start/pricing'},
  'gpt-6-sol':{provider:'openai',model:'gpt-6-sol',thinking:'high',
    baseUrl:'https://api.openai.com/v1',billing:'chatgpt_subscription_oauth',wireOutputCap:null,
    service:'GPT-6 Sol through Pi and Sign in with ChatGPT; not the Codex CLI',
    source:'https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference'},
};
export function profileFor(name='deepseek-flash') {
  if(!Object.hasOwn(PROFILES,name))throw new Error('Unsupported exact model profile: '+name);
  return {...PROFILES[name]};
}
export function verifyWire(payload,profile) {
  const thinking=profile.provider==='openai'?payload.reasoning?.effort:payload.reasoning_effort;
  if(payload.model!==profile.model||thinking!==profile.thinking)throw new Error('Wire model/thinking mismatch');
  if(profile.provider==='openai'&&(payload.store!==false||payload.stream!==true))throw new Error('OAuth requires store:false and stream:true');
  const cap=payload.max_output_tokens??payload.max_tokens??null;
  if(cap!==profile.wireOutputCap)throw new Error('Unexpected wire output-cap behavior');
  return {model:payload.model,thinking,max_output_tokens:cap,service_tier:payload.service_tier??null};
}

// Expose only the selected OAuth provider; preserve other credentials on disk.
// The SDK owns locking and refresh-token rotation. Never copy rotating tokens
// into a disposable store and lose the replacement on process exit.
export function scopedOAuthStore(storage,remember) {
  function checked(c) {
    if(!c)return c;
    if(c.type!=='oauth'||!c.scopes?.includes('chatgpt.tokens.use.direct'))throw new Error('Authorized Pi OpenAI ChatGPT-plan sign-in required; no API-key fallback');
    remember(c);return c;
  }
  return {
    read:async(id,options)=>id==='openai'?checked(await storage.read(id,options)):undefined,
    list:async options=>(await storage.list(options)).filter(x=>x.providerId==='openai'),
    modify:async(id,fn,options)=>{
      if(id!=='openai')throw new Error('Other provider credential modification refused');
      return storage.modify(id,async current=>checked(await fn(checked(current))),options);
    },
    delete:async()=>{throw new Error('Credential deletion is not part of interpretation');},
  };
}
