// Pinned SDK integration test: synthetic messages only, no credentials or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {existsSync} from 'node:fs';
import {loadPi} from '../src/runtime.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createAdaptiveWorker} from '../src/adaptive_worker.mjs';
import {Budget,Archive} from '../src/core.mjs';
import {profileFor} from '../src/profiles.mjs';

test('pinned Pi stops after an accepted terminal tool, but not a rejected one',async()=>{
  const pi=await loadPi(),require=createRequire(join(pi.path,'package.json'));
  const coreRoot=require.resolve.paths('@earendil-works/pi-agent-core').map(p=>join(p,'@earendil-works/pi-agent-core'))
    .find(p=>existsSync(join(p,'dist/index.js')));
  assert.ok(coreRoot,'Pinned Pi core installed');
  const {runAgentLoop}=await import(pathToFileURL(join(coreRoot,'dist/index.js')));
  for(const rejectFirst of [false,true]){
    let calls=0,accepted=false;const events=[];
    const model={id:'synthetic-offline',provider:'synthetic-offline',api:'openai-completions'};
    const tools=[{name:'submit_report',label:'Submit',description:'Synthetic terminal tool',
      parameters:pi.Type.Object({}),execute:async()=>{
        if(rejectFirst&&calls===1)throw new Error('Synthetic validation rejection');
        accepted=true;return {content:[{type:'text',text:'accepted'}],details:{},terminate:true};
      }}];
    const stream=()=>{
      calls++;assert.ok(calls<=2,'Must not request a paid acknowledgement');
      const message={role:'assistant',api:model.api,provider:model.provider,model:model.id,
        content:[{type:'toolCall',id:'call-'+calls,name:'submit_report',arguments:{}}],
        usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},
        stopReason:'toolUse',timestamp:Date.now()};
      const output=pi.ai.createAssistantMessageEventStream();
      output.push({type:'done',reason:'toolUse',message});return output;
    };
    await runAgentLoop([{role:'user',content:'Synthetic test',timestamp:Date.now()}],
      {messages:[],tools},{model,convertToLlm:messages=>messages},async e=>events.push(e),undefined,stream);
    assert.equal(calls,rejectFirst?2:1);assert.equal(accepted,true);
    assert.equal(events.at(-1).type,'agent_end');
  }
});

test('adaptive interpreter resumes the same actual Pi session after terminal research request',async t=>{
  const root=await mkdtemp(join(tmpdir(),'sae-session-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const pi=await loadPi();
  const credentials=new pi.ai.InMemoryCredentialStore();
  await credentials.modify('openai',async()=>({type:'api_key',key:'synthetic-offline-not-a-real-key'}));
  const runtime=await pi.sdk.ModelRuntime.create({credentials,
    modelsPath:null,modelsStore:new pi.ai.InMemoryModelsStore(),allowModelNetwork:false});
  const profile=profileFor('gpt-6.1-sol'),model=runtime.getModel(profile.provider,profile.model);
  let calls=0,created=0,lastContext;
  const fake={...pi,sdk:{...pi.sdk,createAgentSession:async args=>{
    created++;const result=await pi.sdk.createAgentSession(args);
    result.session.agent.streamFunction=(_model,context)=>{
      calls++;lastContext=context;
      const tool=calls===1?{name:'evidence_brief',arguments:{}}:calls===2?
        {name:'request_research',arguments:{question:'Does this biological relationship have direct support?',
          claim_affected:'A subgroup interpretation',expected_impact:'Distinguish a biological relationship from a taxonomy list',evidence_ids:['E.population']}}:
        {name:'submit_report',arguments:{role:'interpret',short_name:'Local association',
          statement:'This feature has a reproducible local statistical association.',
          claims:[{claim_id:'C1',text:'A locally measured pattern.',level:'association',evidence_ids:['E.population'],source_ids:[]}],
          alternatives:[],limitations:[],changes:[]}};
      assert.ok(calls<=3,'No paid acknowledgement or fresh reconstruction');
      const message={role:'assistant',api:model.api,provider:model.provider,model:model.id,
        content:[{type:'toolCall',id:'test-'+calls,...tool}],
        usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},
        stopReason:'toolUse',timestamp:Date.now()};
      const stream=pi.ai.createAssistantMessageEventStream();stream.push({type:'done',reason:'toolUse',message});return stream;
    };return result;
  }}};
  const ledger=[],packet={feature_id:1,site:'otu_l4',k:16,codebook:{},scope:{partition:'discovery'},
    records:{'E.population':{value:{events:100,active_events:10}}}};
  const worker=await createAdaptiveWorker(fake,{packet,archive:new Archive(join(root,'sources')),
    budget:new Budget({roleRequests:16}),out:root,skills:'',model,runtime,redact:s=>s,
    forbidden:[],profile,ledger},'interpret');
  try{
    assert.equal((await worker.invoke({initial:true})).kind,'research_request');
    assert.equal((await worker.invoke({research_result:{answer:'No material external addition is needed.'}})).kind,'candidate');
    assert.equal(created,1);assert.equal(calls,3);assert.equal(ledger.length,2);
    assert.ok(JSON.stringify(lastContext).includes('Does this biological relationship'));
    assert.ok(JSON.stringify(lastContext).includes('No material external addition'));
  }finally{worker.close();}
});
