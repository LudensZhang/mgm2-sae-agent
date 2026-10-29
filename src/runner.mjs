import {mkdir, readFile} from 'node:fs/promises';
import {join, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Budget, Archive, ROLES, VERSION, json, save, log, hash, normalizePacket, overview,
  readEvidence, validateReport, checkPrivacy, summarizeUsage,privateIdentifiers} from './core.mjs';
import {loadPi,selectedRuntime,resourceLoader,skillText} from './runtime.mjs';
import {profileFor,verifyWire} from './profiles.mjs';
import {openWeb,webTools} from './web.mjs';
import {SYSTEM,TASKS,handoff} from './prompts.mjs';
import {readMany,selectBrief} from './evidence_views.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const txt=value=>({content:[{type:'text',text:JSON.stringify(value)}],details:{}});

export function localTools(Type, {packet,archive,role,readEvidenceIds,readSources,setReport,candidate}) {
  const Claim=Type.Object({claim_id:Type.String(),text:Type.String(),
    level:Type.Union(['observation','association','biological_hypothesis'].map(x=>Type.Literal(x))),
    evidence_ids:Type.Array(Type.String(),{minItems:1}),source_ids:Type.Array(Type.String())});
  return [
    {name:'evidence_brief',label:'Read feature summary',description:'Read all exported E.* summary records together as lossless tables. Includes taxonomy, environment, abundance, community and controls; excludes selected case records. No values rounded or recomputed. Follow remaining_ids if present.',
      parameters:Type.Object({}),execute:async()=>{
        const ids=Object.keys(selectBrief(packet));
        const value=ids.length?readMany(packet,ids.slice(0,64)):{read_ids:[],remaining_ids:[]};
        value.remaining_ids.push(...ids.slice(64));
        value.read_ids.forEach(id=>readEvidenceIds.add(id));return txt(value);
      }},
    {name:'evidence_read_many',label:'Read selected evidence',description:'Read 1–64 selected exact records in one lossless table bundle (18,000 character cap). remaining_ids are NOT read. Prefer this to dozens of individual calls; use evidence_read for a large record or JSON Pointer.',
      parameters:Type.Object({ids:Type.Array(Type.String(),{minItems:1,maxItems:64})}),
      execute:async(_id,{ids})=>{const value=readMany(packet,ids);value.read_ids.forEach(id=>readEvidenceIds.add(id));return txt(value);}},
    {name:'evidence_list',label:'Evidence index',description:'List exact evidence IDs by prefix (E.taxonomy, E.abundance, E.community, X.case, X.control, etc.).',
      parameters:Type.Object({prefix:Type.Optional(Type.String()),offset:Type.Optional(Type.Integer({minimum:0}))}),
      execute:async(_id,{prefix='',offset=0})=>{
        const ids=Object.keys(packet.records).filter(x=>x.startsWith(prefix));
        return txt({ids:ids.slice(offset,offset+60),total:ids.length,next_offset:offset+60<ids.length?offset+60:null});
      }},
    {name:'evidence_read',label:'Read evidence',description:'Read one immutable evidence record with optional JSON Pointer and pagination. No new statistics are computed.',
      parameters:Type.Object({id:Type.String(),pointer:Type.Optional(Type.String()),offset:Type.Optional(Type.Integer({minimum:0})),limit:Type.Optional(Type.Integer({minimum:1,maximum:7000}))}),
      execute:async(_id,p)=>{const value=readEvidence(packet,p);readEvidenceIds.add(p.id);return txt(value);}},
    {name:'submit_report',label:'Submit role report',description:'Submit a structured report. Validation checks citations and shape, not biological truth. After success, stop.',
      parameters:Type.Object({role:Type.Literal(role),short_name:Type.String({minLength:1,maxLength:180}),
        statement:Type.String({minLength:20,maxLength:2500}),claims:Type.Array(Claim,{minItems:1,maxItems:6}),
        alternatives:Type.Array(Type.String(),{maxItems:4}),limitations:Type.Array(Type.String(),{maxItems:4}),
        changes:Type.Array(Type.String(),{maxItems:6}),
        ...(role==='audit'?{verdict:Type.Union(['supported','revise','insufficient'].map(x=>Type.Literal(x)))}:{})}),
      execute:async(_id,p)=>{
        validateReport(p,packet,archive,role);
        // Each role must inspect evidence itself, not just copy a preceding report.
        if(!readEvidenceIds.size)throw new Error('Read local evidence before submission');
        if(role==='audit')for(const c of p.claims)for(const id of c.source_ids)
          if(!readSources.has(id))throw new Error('Audit must independently read every source it cites');
        if(role==='audit')for(const c of candidate?.claims??[])for(const id of c.source_ids)
          if(!readSources.has(id))throw new Error('Audit must read the candidate source citations, including disputed claims');
        setReport(p);return {...txt({accepted:true,note:'Structural validation only; role complete.'}),terminate:true};
      }},
  ];
}

async function runRole(pi, env, role) {
  const {packet,archive,budget,bridge,reports,out,skills,model,runtime,redact,forbidden,profile}=env;
  const folder=join(out,role);await mkdir(folder);
  let report; const readEvidenceIds=new Set(),readSources=new Set(),messages=[];
  const setReport=p=>{if(report)throw new Error('Report already submitted');report=p;};
  const tools=[...localTools(pi.Type,{packet,archive,role,readEvidenceIds,readSources,setReport,candidate:reports.synthesis}),
    ...webTools(pi.Type,{bridge,archive,budget,role,readSources})].map(tool=>({...tool,execute:async(...args)=>{
      const result=await tool.execute(...args);
      return {...result,content:[...result.content,{type:'text',text:JSON.stringify({
        role_provider_turns_remaining:budget.limits.roleRequests-(budget.roles[role]??0),
        feature_provider_turns_remaining:budget.limits.requests-budget.used.requests,
        reminder:'Reserve a turn for submit_report. Stop exploring when sufficient evidence exists.'})}]};
    }}));
  const prompt=`${TASKS[role]}\n\nBUDGET: At most ${budget.limits.roleRequests} provider turns for this role. Submit alone in its final tool batch; successful submission ends the role without an acknowledgement request. Group independent reads with evidence_read_many. The observer should start with evidence_brief; other roles should read the exact records needed for their own checks, not reconstruct the entire inventory. The full skills and exact source evidence remain authoritative.\n\nFEATURE OVERVIEW:\n${JSON.stringify(overview(packet))}\n\nPRIOR ROLE REPORTS (fallible):\n${JSON.stringify(handoff(role,reports))}\n\nSOURCE INDEX:\n${JSON.stringify(archive.list())}`;
  checkPrivacy(prompt,forbidden);
  // Pi appends cwd to the system prompt. No filesystem tools are exposed, so use
  // a virtual public label; keep the real session/output directories host-side.
  const {session}=await pi.sdk.createAgentSession({cwd:'/sae-workspace',agentDir:join(out,'runtime'),modelRuntime:runtime,
    model,thinkingLevel:profile.thinking,tools:tools.map(x=>x.name),customTools:tools,
    resourceLoader:resourceLoader(pi,SYSTEM+'\n\n'+skills),sessionManager:pi.sdk.SessionManager.inMemory(folder),
    settingsManager:pi.sdk.SettingsManager.inMemory({compaction:{enabled:false},retry:{enabled:false},
      provider:{maxRetries:0},cacheWarming:'off',telemetry:false})});
  if(session.thinkingLevel!==profile.thinking){session.dispose();throw new Error('Pi silently changed thinking level');}
  await save(join(folder,'invocation.json'),{role,provider:model.provider,model:model.id,thinking:session.thinkingLevel,
    tools:session.getActiveToolNames(),prompt_sha256:hash(prompt),system_sha256:hash(session.systemPrompt)});
  await save(join(folder,'prompt.json'),{system:session.systemPrompt,prompt});
  let pending=Promise.resolve();
  const eventLog=value=>{pending=pending.then(()=>log(join(folder,'events.jsonl'),JSON.parse(redact(JSON.stringify(value)))));};
  session.subscribe(event=>{
    if(event.type==='message_end'&&event.message.role==='assistant'){
      messages.push(event.message);eventLog({type:'assistant_end',message:event.message});
    } else if(['tool_execution_start','tool_execution_end'].includes(event.type)) eventLog(event);
  });
  // A Pi extension payload hook swallows thrown errors; enforce limits outside it.
  const stream=session.agent.streamFunction;
  session.agent.streamFunction=async(m,context,options)=>{
    budget.take('requests',role);
    if(m.id!==profile.model||m.provider!==profile.provider||m.baseUrl!==profile.baseUrl)throw new Error('Model/provider drift refused');
    checkPrivacy(context,forbidden);
    return stream(m,context,{...options,maxTokens:16384,maxRetries:0,timeoutMs:120000,
      onPayload:async payload=>{
        const verified=verifyWire(payload,profile);
        checkPrivacy(payload,forbidden);
        eventLog({type:'wire_request',...verified,
          payload_sha256:hash(payload),payload_chars:JSON.stringify(payload).length});
        return payload;
      }});
  };
  const start=Date.now();
  const timer=setTimeout(()=>void session.abort(),Math.min(300000,Math.max(1,budget.limits.seconds*1000-(Date.now()-budget.start))));
  let error;
  try {
    await session.prompt(prompt);
    const errors=messages.filter(m=>['error','aborted','length'].includes(m.stopReason));
    if(errors.length)throw new Error('Provider failure: '+redact(errors.map(m=>m.errorMessage??m.stopReason).join('; ')));
    if(!report)throw new Error('Role ended without a valid submitted report');
    await save(join(folder,'report.json'),report);
    return report;
  } catch(e){error=redact(e.message);throw new Error(`${role}: ${error}`);}
  finally {
    clearTimeout(timer);session.dispose();await pending;
    await save(join(folder,'completion.json'),{role,valid:!error&&Boolean(report),error:error??null,
      seconds:(Date.now()-start)/1000,usage:summarizeUsage(messages),
      read_evidence:[...readEvidenceIds],read_sources:[...readSources]});
  }
}

export async function run({packetPath,out,live=false,web=false,authPath,modelName='deepseek-flash'}) {
  const profile=profileFor(modelName);
  out=resolve(out);
  const input=await json(resolve(packetPath)),packet=normalizePacket(input);
  let forbidden=[];
  try {forbidden=privateIdentifiers(await json(join(dirname(resolve(packetPath)),'private_identifiers.json')));}
  catch(e){if(e.code!=='ENOENT')throw e;}
  checkPrivacy(packet,forbidden);
  // Exclusive directory: failed attempts are never overwritten or silently retried.
  await mkdir(dirname(out),{recursive:true});await mkdir(out);
  const skills=await skillText(ROOT);
  await save(join(out,'packet.json'),packet);
  await save(join(out,'overview.json'),overview(packet));
  const files=['package.json','src/cli.mjs','src/core.mjs','src/runtime.mjs','src/web.mjs','src/runner.mjs','src/prompts.mjs','src/profiles.mjs','src/evidence_views.mjs',
    'skills/sae-interpretation/SKILL.md','skills/source-grounding/SKILL.md'];
  const code_hashes=Object.fromEntries(await Promise.all(files.map(async f=>[f,hash(await readFile(join(ROOT,f),'utf8'))])));
  const budget=new Budget();
  await save(join(out,'manifest.json'),{version:VERSION,started_at:new Date().toISOString(),
    source_packet_sha256:packet.source_packet_hash,feature_id:packet.feature_id,site:packet.site,
    requested_provider:profile.provider,requested_model:profile.model,requested_thinking:profile.thinking,
    documented_service:profile.service,billing_mode:profile.billing,routing_source:profile.source,
    roles:ROLES,budget:budget.limits,requested_max_output_tokens:16384,
    max_output_tokens_per_request:profile.wireOutputCap,web,
    status:live?'live_debug_not_formal_benchmark':'dry_run',code_hashes});
  if(!live)return {status:'dry_run',out,feature_id:packet.feature_id,records:Object.keys(packet.records).length};
  // Pi imports configuration at module load. Set the isolated directory first.
  process.env.PI_CODING_AGENT_DIR=join(out,'runtime');
  for(const k of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'])delete process.env[k];
  if(profile.provider==='openai')delete process.env.OPENAI_API_KEY;
  const archive=new Archive(join(out,'sources')),reports={};let bridge;
  let redact=s=>String(s),failure;
  try {
    const pi=await loadPi();const modelEnv=await selectedRuntime(pi,{authPath,profile});redact=modelEnv.redact;
    if(web)bridge=await openWeb(join(out,'runtime','web'));
    const env={packet,archive,budget,bridge,reports,out,skills,forbidden,profile,...modelEnv};
    for(const role of ROLES){
      console.log(JSON.stringify({role,status:'started'}));
      reports[role]=await runRole(pi,env,role);
      console.log(JSON.stringify({role,status:'complete'}));
    }
    await save(join(out,'interpretation.json'),reports.synthesis);
    await save(join(out,'audit.json'),reports.audit);
  } catch(e){failure=redact(e.message);}
  finally {if(bridge)try{await bridge.close();}catch(e){failure??=redact(e.message);}}
  const completions=[];
  for(const role of ROLES){try{completions.push(await json(join(out,role,'completion.json')));}catch(e){if(e.code!=='ENOENT')throw e;}}
  const result={status:failure?'failed':'complete',error:failure??null,
    seconds:(Date.now()-budget.start)/1000,usage_by_role:completions.map(x=>({role:x.role,...x.usage,seconds:x.seconds})),
    usage_total:{...summarizeUsage(completions.map(x=>({usage:{...x.usage,reasoning:x.usage.reasoning_tokens,cost:{total:x.usage.cost_usd}}}))),
      messages:completions.reduce((s,x)=>s+x.usage.messages,0),
      reasoning_usage_messages:completions.reduce((s,x)=>s+x.usage.reasoning_usage_messages,0)},
    budget_used:budget.used,internal_audit_verdict:reports.audit?.verdict??null,
    sources:archive.list(),billing_mode:profile.billing,formal_benchmark:false};
  await save(join(out,'completion.json'),result);
  if(failure)throw new Error(failure);
  return {status:result.status,out,seconds:result.seconds,audit:result.internal_audit_verdict};
}
