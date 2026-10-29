// Normalize API usage, not subscription quota. Reasoning is a subset of output.
export function canonicalUsage(u,format) {
  const number=(key)=>{const n=u[key]??0;if(!Number.isFinite(n)||n<0)throw new Error('Invalid usage: '+key);return n;};
  let uncached,cached,cacheWrite,output,reasoning;
  if(format==='pi') {
    uncached=number('input');cached=number('cacheRead');cacheWrite=number('cacheWrite');
    output=number('output');reasoning=u.reasoning_tokens??null;
  } else if(format==='codex') {
    cached=number('cached_input_tokens');cacheWrite=number('cache_write_input_tokens');
    if(cacheWrite)throw new Error('Nonzero legacy cache-write semantics require separate inspection');
    uncached=number('input_tokens')-cached;output=number('output_tokens');
    reasoning=u.reasoning_output_tokens??null;
  } else throw new Error('Unknown usage convention');
  if(uncached<0||reasoning!==null&&(!Number.isFinite(reasoning)||reasoning<0||reasoning>output))throw new Error('Inconsistent usage');
  const input=uncached+cached+cacheWrite,total=input+output;
  if(format==='pi'&&u.totalTokens!==undefined&&u.totalTokens!==total)throw new Error('Pi total differs from components');
  return {uncached_input:uncached,cached_input:cached,cache_write_input:cacheWrite,
    input_including_cache:input,output_including_reasoning:output,reasoning_subset:reasoning,
    total_tokens:total,subscription_quota_percent:null};
}

export function sumCanonical(rows) {
  const keys=['uncached_input','cached_input','cache_write_input','input_including_cache',
    'output_including_reasoning','total_tokens'];
  const result=Object.fromEntries(keys.map(k=>[k,rows.reduce((s,x)=>s+x[k],0)]));
  result.reasoning_subset=rows.length&&rows.every(x=>x.reasoning_subset!==null)?rows.reduce((s,x)=>s+x.reasoning_subset,0):null;
  return {...result,subscription_quota_percent:null};
}
