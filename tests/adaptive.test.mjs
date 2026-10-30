import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {adaptiveFlow} from '../src/adaptive_flow.mjs';
import {adaptiveMessage} from '../src/adaptive_prompts.mjs';
import {validateReview} from '../src/adaptive_tools.mjs';
import {SourceCache} from '../src/source_cache.mjs';
import {Archive,hash} from '../src/core.mjs';

const candidate={role:'interpret',short_name:'Test',statement:'Local pattern',claims:[{evidence_ids:['E.a'],source_ids:[]}]};
const action={kind:'candidate',report:candidate};
const supported={kind:'review',report:{verdict:'supported',checks:[],issues:[]}};
const request={kind:'research_request',request:{question:'A concrete question',evidence_ids:['E.a']}};
const answer={kind:'research_result',report:{answer:'Bounded answer',findings:[]}};
const revise={kind:'review',report:{verdict:'revise',issues:[{problem:'A material error'}]}};

test('local-only interpretation uses exactly two roles, no research or final summarizer',async()=>{
  const calls=[];const r=await adaptiveFlow({invoke:async(role)=>{calls.push(role);return role==='interpret'?action:supported;}});
  assert.equal(r.status,'complete');assert.equal(r.researchCount,0);assert.deepEqual(calls,['interpret','review']);
});
test('research answer returns to interpreter; independent reviewer gets only candidate',async()=>{
  const calls=[];let count=0;
  const r=await adaptiveFlow({invoke:async(role,input)=>{
    calls.push(role);
    if(role==='interpret')return count++===0?request:action;
    if(role==='research'){assert.deepEqual(input,{request:request.request});return answer;}
    assert.deepEqual(input,{candidate});return supported;
  }});
  assert.deepEqual(calls,['interpret','research','interpret','review']);assert.equal(r.researchCount,1);
});
test('material revision returns to interpreter then reviewer, not all roles',async()=>{
  const calls=[];let reviews=0;
  const r=await adaptiveFlow({invoke:async(role,input)=>{calls.push(role);
    return role==='interpret'?action:reviews++===0?revise:supported;}});
  assert.equal(r.revisions,1);assert.deepEqual(calls,['interpret','review','interpret','review']);
});
test('unresolved revision and insufficient evidence never become accepted',async()=>{
  for(const verdict of ['revise','insufficient']){
    let calls=0;const r=await adaptiveFlow({invoke:async role=>{calls++;return role==='interpret'?action:{kind:'review',report:{verdict,issues:[{}]}};}});
    assert.equal(r.status,'needs_review');assert.equal(calls,verdict==='revise'?4:2);
  }
});
test('research bounds stop transparently without extra provider invocations',async()=>{
  let n=0;const r=await adaptiveFlow({invoke:async role=>{n++;return role==='interpret'?request:answer;}});
  assert.equal(r.status,'needs_review');assert.equal(r.researchCount,2);assert.equal(n,5);
});
test('provider failures propagate; no hidden retry',async()=>{
  let n=0;await assert.rejects(()=>adaptiveFlow({invoke:async()=>{n++;throw new Error('quota exhausted');}}),/quota/);assert.equal(n,1);
});
test('review handoff omits investigator response and interpreter deliberation',()=>{
  const text=adaptiveMessage('review',{candidate,research_result:{secret:'DO NOT INCLUDE'},review:{secret:'DO NOT INCLUDE'}},'Context');
  assert.ok(!text.includes('DO NOT INCLUDE'));assert.ok(text.includes('Local pattern'));
});
test('review must read candidate sources, even when it disputes them',()=>{
  const packet={records:{'E.a':{}}},archive={records:new Map([['S1',{is_error:false}]])};
  const report={verdict:'supported',checks:[{evidence_ids:['E.a'],source_ids:[]}],issues:[]};
  const env={packet,archive,readEvidenceIds:new Set(['E.a']),readSources:new Set(),candidate:{claims:[{source_ids:['S1']}]}};
  assert.throws(()=>validateReview(report,env),/every candidate source/);
  env.readSources.add('S1');validateReview(report,env);
  assert.throws(()=>validateReview({...report,issues:[{}]},env),/material issues/);
  assert.throws(()=>validateReview({...report,verdict:'revise'},env),/material unresolved/);
});
test('shared cache preserves original text and provenance; no reports or failed sources',async t=>{
  const root=await mkdtemp(join(tmpdir(),'sae-cache-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const a=new Archive(join(root,'source')),cache=new SourceCache(join(root,'cache'));
  const record=await a.add('fetch',{url:'https://example.org/paper',mode:'readable'},
    {content:[{type:'text',text:'Primary experiment on microbial predation.'}]});
  await cache.put(record);await cache.put({...record,kind:'search'});await cache.put({...record,is_error:true});
  const hits=await cache.find('microbial predation');assert.equal(hits.length,1);
  const b=new Archive(join(root,'target'));const reused=await cache.importInto(record.id,b);
  assert.equal(reused.text,record.text);assert.equal(reused.sha256,hash(record.text));
  assert.equal(reused.created_at,record.created_at);assert.equal(reused.shared_cache_reused,true);
  assert.deepEqual(await cache.importInto(record.id,b),reused);
  await assert.rejects(()=>cache.get('../secret'),/Invalid/);
});
