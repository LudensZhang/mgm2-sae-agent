import {mkdir,readFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {json,save,hash,normalizePacket,overview,checkPrivacy,privateIdentifiers,Budget,Archive,summarizeUsage} from './core.mjs';
import {profileFor} from './profiles.mjs';
import {skillText,loadPi,selectedRuntime} from './runtime.mjs';
import {openWeb} from './web.mjs';
import {SourceCache} from './source_cache.mjs';
import {adaptiveFlow} from './adaptive_flow.mjs';
import {createAdaptiveWorker} from './adaptive_worker.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const ADAPTIVE_FILES=['package.json',...['cli','core','runner','runtime','profiles','evidence_views','web',
  'adaptive','adaptive_flow','adaptive_worker','adaptive_tools','adaptive_prompts','source_cache'].map(x=>'src/'+x+'.mjs'),
  'skills/sae-interpretation/SKILL.md','skills/source-grounding/SKILL.md'];

export async function runAdaptive({packetPath,out,live=false,web=false,authPath,modelName='gpt-6.1-sol',sourceCachePath}){
  out=resolve(out);const profile=profileFor(modelName),input=await json(resolve(packetPath)),packet=normalizePacket(input);
  let forbidden=[];
  try{forbidden=privateIdentifiers(await json(join(dirname(resolve(packetPath)),'private_identifiers.json')),
    input.export_policy?.public_study_accessions??[]);}catch(e){if(e.code!=='ENOENT')throw e;}
  checkPrivacy(packet,forbidden);
  await mkdir(dirname(out),{recursive:true});await mkdir(out);
  const skills=await skillText(ROOT),budget=new Budget({requests:40,roleRequests:16,seconds:900});
  await save(join(out,'packet.json'),packet);await save(join(out,'overview.json'),overview(packet));
  const code_hashes=Object.fromEntries(await Promise.all(ADAPTIVE_FILES.map(async f=>[f,hash(await readFile(join(ROOT,f),'utf8'))])));
  await save(join(out,'manifest.json'),{version:'0.3.0',workflow:'adaptive_three_role',started_at:new Date().toISOString(),
    source_packet_sha256:packet.source_packet_hash,feature_id:packet.feature_id,site:packet.site,
    requested_provider:profile.provider,requested_model:profile.model,requested_thinking:profile.thinking,
    roles:['interpret','research','review'],research_optional:true,persistent_role_sessions:true,
    budget:budget.limits,max_research_requests:2,max_material_revisions:1,code_hashes,web,
    shared_source_cache:Boolean(sourceCachePath),billing_mode:profile.billing,formal_benchmark:false,
    status:live?'live_pilot':'dry_run'});
  if(!live)return {status:'dry_run',workflow:'adaptive_three_role',out,feature_id:packet.feature_id};
  process.env.PI_CODING_AGENT_DIR=join(out,'runtime');
  for(const k of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'])delete process.env[k];
  if(profile.provider==='openai')delete process.env.OPENAI_API_KEY;
  const ledger=[],workers=new Map(),archive=new Archive(join(out,'sources'));
  const sourceCache=sourceCachePath?new SourceCache(resolve(sourceCachePath)):null;
  let bridge,failure,flow,redact=s=>String(s);
  try{
    const pi=await loadPi(),runtime=await selectedRuntime(pi,{authPath,profile});redact=runtime.redact;
    const env={packet,archive,budget,out,skills,forbidden,profile,ledger,sourceCache,...runtime};
    flow=await adaptiveFlow({record:async(name,value)=>save(join(out,name+'.json'),value),
      invoke:async(role,input)=>{
        if(role==='research'&&!web)throw new Error('Research requested but live web access is disabled');
        if(role==='research'&&!bridge){bridge=await openWeb(join(out,'runtime','web'));env.bridge=bridge;}
        if(!workers.has(role))workers.set(role,await createAdaptiveWorker(pi,env,role));
        console.log(JSON.stringify({role,status:'phase_started'}));
        const result=await workers.get(role).invoke(input);
        console.log(JSON.stringify({role,status:'phase_complete',action:result.kind}));return result;
      }});
    if(flow.candidate)await save(join(out,'interpretation.json'),flow.candidate);
    if(flow.review)await save(join(out,'audit.json'),flow.review);
    await save(join(out,'flow.json'),flow);
  }catch(e){failure=redact(e.message);}
  finally{
    for(const worker of workers.values())worker.close();
    if(bridge)try{await bridge.close();}catch(e){failure??=redact(e.message);}
  }
  const usage=summarizeUsage(ledger.map(x=>({usage:{...x.usage,reasoning:x.usage.reasoning_tokens,cost:{total:x.usage.cost_usd}}})));
  usage.messages=ledger.reduce((s,x)=>s+x.usage.messages,0);
  usage.reasoning_usage_messages=ledger.reduce((s,x)=>s+x.usage.reasoning_usage_messages,0);
  const result={status:failure?'failed':flow.status,error:failure??null,reason:flow?.reason??null,
    seconds:(Date.now()-budget.start)/1000,workflow:'adaptive_three_role',
    sessions:[...workers.keys()],usage_by_phase:ledger,usage_total:usage,budget_used:budget.used,
    research_requests:flow?.researchCount??null,revisions:flow?.revisions??null,
    internal_audit_verdict:flow?.review?.verdict??null,sources:archive.list(),
    billing_mode:profile.billing,formal_benchmark:false};
  await save(join(out,'completion.json'),result);
  if(failure)throw new Error(failure);
  return {status:result.status,out,seconds:result.seconds,audit:result.internal_audit_verdict};
}
