// Pinned SDK integration test: synthetic messages only, no credentials or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {existsSync} from 'node:fs';
import {loadPi} from '../src/runtime.mjs';

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
