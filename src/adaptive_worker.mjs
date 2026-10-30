import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {save,log,hash,checkPrivacy,summarizeUsage,overview} from './core.mjs';
import {resourceLoader} from './runtime.mjs';
import {verifyWire} from './profiles.mjs';
import {adaptiveTools,remainingToolBudget} from './adaptive_tools.mjs';
import {ADAPTIVE_SYSTEM,ADAPTIVE_TASKS,adaptiveMessage} from './adaptive_prompts.mjs';

// One real Pi session per logical role. Pausing for research or review does not
// discard the interpreter's context or create a fourth synthesizer agent.
export async function createAdaptiveWorker(pi,env,role){
  const {packet,archive,budget,out,skills,model,runtime,redact,forbidden,profile,ledger}=env;
  let action,phaseFolder,phaseMessages=[],candidateValue,pending=Promise.resolve(),phase=0;
  const readEvidenceIds=new Set(),readSources=new Set();
  const tools=adaptiveTools(pi.Type,{...env,role,readEvidenceIds,readSources,
    candidate:()=>candidateValue,setAction:value=>{if(action)throw new Error('Phase already submitted');action=value;}})
    .map(tool=>({...tool,execute:async(...args)=>{
      const result=await tool.execute(...args);
      return {...result,content:[...result.content,{type:'text',text:JSON.stringify(remainingToolBudget(budget,role))}]};
    }}));
  const folder=join(out,role);await mkdir(folder);
  const {session}=await pi.sdk.createAgentSession({cwd:'/sae-workspace',agentDir:join(out,'runtime'),modelRuntime:runtime,
    model,thinkingLevel:profile.thinking,tools:tools.map(x=>x.name),customTools:tools,
    resourceLoader:resourceLoader(pi,ADAPTIVE_SYSTEM+'\n\n'+ADAPTIVE_TASKS[role]+'\n\n'+skills),
    sessionManager:pi.sdk.SessionManager.inMemory(folder),
    settingsManager:pi.sdk.SettingsManager.inMemory({compaction:{enabled:false},retry:{enabled:false},
      provider:{maxRetries:0},cacheWarming:'off',telemetry:false})});
  if(session.thinkingLevel!==profile.thinking){session.dispose();throw new Error('Thinking level changed');}
  await save(join(folder,'session.json'),{role,provider:model.provider,model:model.id,thinking:session.thinkingLevel,
    tools:session.getActiveToolNames(),system_sha256:hash(session.systemPrompt),persistent_across_phases:true});
  await save(join(folder,'system.json'),{system:session.systemPrompt});
  const eventLog=value=>{const target=join(phaseFolder,'events.jsonl');
    pending=pending.then(()=>log(target,JSON.parse(redact(JSON.stringify(value)))));};
  session.subscribe(event=>{
    if(event.type==='message_end'&&event.message.role==='assistant'){
      phaseMessages.push(event.message);eventLog({type:'assistant_end',message:event.message});
    }else if(['tool_execution_start','tool_execution_end'].includes(event.type))eventLog(event);
  });
  const stream=session.agent.streamFunction;
  session.agent.streamFunction=async(m,context,options)=>{
    budget.take('requests',role);
    if(m.id!==profile.model||m.provider!==profile.provider||m.baseUrl!==profile.baseUrl)throw new Error('Model/provider drift refused');
    checkPrivacy(context,forbidden);
    return stream(m,context,{...options,maxTokens:16384,maxRetries:0,timeoutMs:120000,
      onPayload:async payload=>{
        const verified=verifyWire(payload,profile);checkPrivacy(payload,forbidden);
        eventLog({type:'wire_request',...verified,payload_sha256:hash(payload),payload_chars:JSON.stringify(payload).length});
        return payload;
      }});
  };
  return {close:()=>session.dispose(),invoke:async input=>{
    budget.check();phase++;action=undefined;phaseMessages=[];
    candidateValue=input.candidate??candidateValue;
    phaseFolder=join(folder,String(phase).padStart(2,'0'));await mkdir(phaseFolder);
    const context=phase===1?`FEATURE OVERVIEW:\n${JSON.stringify(overview(packet))}\nUse exact evidence tools for details. Terminal submission ends this phase without an acknowledgement request.\nPilot bounds: up to two purposeful research requests and one material revision. These are execution bounds, not scientific confidence criteria.`:null;
    const prompt=adaptiveMessage(role,input,context);checkPrivacy(prompt,forbidden);
    await save(join(phaseFolder,'prompt.json'),{prompt,continued_session:phase>1});
    const start=Date.now();let error;
    const timer=setTimeout(()=>void session.abort(),Math.min(300000,Math.max(1,budget.limits.seconds*1000-(Date.now()-budget.start))));
    try{
      await session.prompt(prompt);
      const errors=phaseMessages.filter(m=>['error','aborted','length'].includes(m.stopReason));
      if(errors.length)throw new Error('Provider failure: '+redact(errors.map(m=>m.errorMessage??m.stopReason).join('; ')));
      if(!action)throw new Error('Phase ended without a valid terminal action');
      await save(join(phaseFolder,'action.json'),action);return action;
    }catch(e){error=redact(e.message);throw new Error(`${role}/${phase}: ${error}`);}
    finally{
      clearTimeout(timer);await pending;
      const receipt={role,phase,valid:!error&&Boolean(action),error:error??null,
        seconds:(Date.now()-start)/1000,usage:summarizeUsage(phaseMessages),
        read_evidence:[...readEvidenceIds],read_sources:[...readSources]};
      ledger.push(receipt);await save(join(phaseFolder,'completion.json'),receipt);
    }
  }};
}
