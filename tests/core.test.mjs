import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {normalizePacket,overview,readEvidence,checkPrivacy,privateIdentifiers,Budget,
  Archive,validateReport,summarizeUsage,save} from '../src/core.mjs';
import {publicUrl,webTools,sourceForModel} from '../src/web.mjs';
import {handoff} from '../src/prompts.mjs';
import {run,localTools} from '../src/runner.mjs';
import {profileFor,verifyWire,scopedOAuthStore} from '../src/profiles.mjs';
import {canonicalUsage,sumCanonical} from '../src/accounting.mjs';
import {skillText} from '../src/runtime.mjs';
import {fileURLToPath} from 'node:url';

const bundle=()=>({core:{feature_id:7,site:'otu_l4',k:16,
  scope:{partition:'discovery',tuning_exposed:false},codebook:{abundance_bins:5},
  facts:{'E.population':{value:{events:1000,active:200}},
    'E.environment.0':{value:{active_fraction:0.2,group_given_active:0.8,background:0.1}},
    'E.abundance_bins.0':{value:{label:'lowest nonzero abundance'}}}},
  annex:{cases:{EVENT_1:{sample_id:'SAMPLE_1',study:'STUDY_1'}},
    controls:{joint:{matched:2}}},provenance:{previous_label:'DO NOT SEND'},
  source_registry:{old_model_report:'DO NOT SEND'}});
const report=(role='observe')=>({role,short_name:'Synthetic association',
  statement:'A synthetic environment-associated activation pattern.',
  claims:[{claim_id:'C1',text:'The two conditional fractions differ.',level:'association',
    evidence_ids:['E.environment.0'],source_ids:[]}],alternatives:[],limitations:[],changes:[]});
async function temporary(t){const path=await mkdtemp(join(tmpdir(),'sae-test-'));t.after(()=>rm(path,{recursive:true,force:true}));return path;}

test('normalize preserves evidence and distinct denominators; removes old labels',()=>{
  const p=normalizePacket(bundle());
  assert.equal(p.records['E.environment.0'].value.group_given_active,0.8);
  assert.equal(p.records['E.environment.0'].value.active_fraction,0.2);
  assert.ok(p.records['X.case.EVENT_1']);assert.ok(p.records['X.control.joint']);
  assert.ok(!JSON.stringify(p).includes('DO NOT SEND'));
  assert.ok(!JSON.stringify(overview(p)).includes('group_given_active'));
});
test('confirmation and tuning evidence rejected',()=>{
  let b=bundle();b.core.scope.partition='confirmation';assert.throws(()=>normalizePacket(b));
  b=bundle();b.core.scope.tuning_exposed=true;assert.throws(()=>normalizePacket(b));
});
test('privacy guard checks raw IDs and credentials, not generic manifest keys',()=>{
  const ids=privateIdentifiers({samples:['private-sample-abcdef'],studies:['private-study-abcdef']});
  checkPrivacy('100 samples in 5 studies',ids);
  for(const value of ['PRJNA123456','SRR123456','/home/alice/key','private-sample-abcdef','{"api_key":"secret"}'])
    assert.throws(()=>checkPrivacy(value,ids));
  assert.throws(()=>privateIdentifiers({samples:'bad'}));
});
test('JSON pointer, exact pagination, unknown and prototype paths',()=>{
  const p=normalizePacket(bundle());
  assert.equal(readEvidence(p,{id:'E.environment.0',pointer:'/value/group_given_active'}).text,'0.8');
  assert.equal(readEvidence(p,{id:'E.population',limit:5}).next_offset,5);
  for(const params of [{id:'missing'},{id:'E.population',pointer:'/__proto__'},
    {id:'E.population',pointer:'value'},{id:'E.population',offset:-1},{id:'E.population',limit:8000}])
    assert.throws(()=>readEvidence(p,params));
});
test('budgets fail before excess calls and cannot evade per-role cap',()=>{
  const b=new Budget({requests:3,roleRequests:1,searches:0});b.take('requests','observe');
  assert.throws(()=>b.take('requests','observe'));assert.equal(b.used.requests,1);
  assert.throws(()=>b.take('searches','literature'));assert.equal(b.used.searches,0);
  b.start-=1000000;assert.throws(()=>b.check());
});
test('archive deduplicates exact snapshots and report citations are validated',async t=>{
  const a=new Archive(await temporary(t));const p=normalizePacket(bundle());
  const result={content:[{type:'text',text:'Synthetic article text'}]};
  const s=await a.add('search',{query:'synthetic'},result);
  assert.equal(a.cached('search',{query:'synthetic'}).id,s.id);
  assert.equal((await a.add('search',{query:'synthetic'},result)).id,s.id);
  const r=report();validateReport(r,p,a,'observe');
  r.claims[0].level='biological_hypothesis';r.claims[0].source_ids=[s.id];
  assert.throws(()=>validateReport(r,p,a,'observe'),/opened source/);
  const slice=await a.add('search_slice',{parent:s.id},result);r.claims[0].source_ids=[slice.id];
  assert.throws(()=>validateReport(r,p,a,'observe'),/opened source/);
  const f=await a.add('fetch',{url:'https://example.org/paper'},result);r.claims[0].source_ids=[f.id];
  validateReport(r,p,a,'observe');
  assert.equal(a.read(f.id,0,5).text,'Synth');assert.equal(a.read(f.id,0,5).next_offset,5);
  r.claims[0].evidence_ids=['E.missing'];assert.throws(()=>validateReport(r,p,a,'observe'));
});
test('public URL constraints reject local and credential URLs',()=>{
  assert.equal(publicUrl('https://example.org/paper'),'https://example.org/paper');
  for(const u of ['http://example.org','https://127.0.0.1','https://localhost','https://a.local',
    'https://user:secret@example.org','https://example.org:8080'])assert.throws(()=>publicUrl(u));
});
test('source view redacts navigation paths and accessions without changing the archive',()=>{
  const raw={text:'Anaerobic growth. href="/home/journal" PRJNA123456 https://example.org/paper',
    sha256:'original-hash',offset:0,next_offset:7000};
  const view=sourceForModel(raw);checkPrivacy(view);
  assert.equal(view.model_text_redactions,2);assert.ok(view.text.includes('Anaerobic growth.'));
  assert.equal(view.sha256,raw.sha256);assert.equal(view.next_offset,7000);
  assert.ok(raw.text.includes('PRJNA123456'));assert.ok(raw.text.includes('/home/journal'));
  assert.equal(sourceForModel([]).length,0);
});
test('audit receives candidate only, not an expected label or prior critic',()=>{
  assert.deepEqual(handoff('audit',{synthesis:{x:1},critic:{gold:'bad'}}),{synthesis:{x:1}});
});
test('usage distinguishes observed API tokens from subscription quota',()=>{
  const u=summarizeUsage([{usage:{input:10,output:4,cacheRead:6,totalTokens:20,reasoning:2,cost:{total:0.1}}}]);
  assert.equal(u.totalTokens,20);assert.equal(u.cost_usd,0.1);assert.equal(u.subscription_quota_percent,null);
  assert.equal(u.reasoning_tokens,2);assert.equal(summarizeUsage([]).reasoning_tokens,null);
});
test('Pi and Codex usage normalize to identical non-double-counted totals',()=>{
  const pi=canonicalUsage({input:10,cacheRead:20,output:8,reasoning_tokens:5,totalTokens:38},'pi');
  const codex=canonicalUsage({input_tokens:30,cached_input_tokens:20,output_tokens:8,reasoning_output_tokens:5},'codex');
  assert.deepEqual(pi,codex);assert.equal(sumCanonical([pi,codex]).total_tokens,76);
  assert.equal(sumCanonical([pi,codex]).reasoning_subset,10);
  assert.throws(()=>canonicalUsage({input_tokens:1,cached_input_tokens:2},'codex'));
  assert.throws(()=>canonicalUsage({input:1,totalTokens:4},'pi'));
  assert.equal(sumCanonical([pi,canonicalUsage({input:1},'pi')]).reasoning_subset,null);
});
test('only both selected project skills are loaded, with their full bodies',async()=>{
  const root=fileURLToPath(new URL('..',import.meta.url));
  const names=['sae-interpretation','source-grounding'];
  const expected=(await Promise.all(names.map(n=>readFile(join(root,'skills',n,'SKILL.md'),'utf8')))).join('\n\n');
  assert.equal(await skillText(root),expected);
});

// Schema construction is irrelevant to these tool behavior tests. The real SDK
// schema/serialization is tested by the separate, explicitly authorized live run.
const Type=new Proxy({}, {get:()=>()=>({})});
test('exact model profiles and wire reasoning cannot silently drift',()=>{
  const p=profileFor('gpt-6-sol');assert.equal(p.thinking,'high');assert.equal(p.billing,'chatgpt_subscription_oauth');
  verifyWire({model:'gpt-6-sol',reasoning:{effort:'high'},store:false,stream:true},p);
  assert.throws(()=>verifyWire({model:'gpt-6.1-sol',reasoning:{effort:'high'},store:false,stream:true},p));
  assert.throws(()=>verifyWire({model:'gpt-6-sol',reasoning:{effort:'max'},store:false,stream:true},p));
  assert.throws(()=>profileFor('gpt6sol'));assert.throws(()=>profileFor('qwen'));
  verifyWire({model:'deepseek-flash',reasoning_effort:'max',max_tokens:16384},profileFor());
});
test('OAuth store limits visibility and rotation to the selected provider',async()=>{
  let c={type:'oauth',access:'old',refresh:'refresh',scopes:['chatgpt.tokens.use.direct']};
  let seen=[];const backend={read:async()=>c,list:async()=>[{providerId:'openai'},{providerId:'deepseek'}],
    modify:async(id,fn)=>{assert.equal(id,'openai');c=await fn(c);return c;}};
  const s=scopedOAuthStore(backend,x=>seen.push(x.access));
  assert.equal(await s.read('deepseek'),undefined);assert.equal((await s.list()).length,1);
  await s.modify('openai',async old=>({...old,access:'new'}));assert.equal(c.access,'new');assert.ok(seen.includes('new'));
  await assert.rejects(s.modify('deepseek',async x=>x));await assert.rejects(s.delete('openai'));
  await assert.rejects(s.modify('openai',async()=>({type:'api_key',key:'fake'})));
});
test('search cache avoids duplicate calls; other roles cannot search',async t=>{
  const archive=new Archive(await temporary(t)),budget=new Budget();let calls=0;
  const bridge={call:async()=>{calls++;return {content:[{type:'text',text:'result response-abc'}]};}};
  const args={bridge,archive,budget,role:'literature',readSources:new Set()};
  const tools=webTools(Type,args),search=tools.find(x=>x.name==='literature_search');
  await search.execute('1',{query:'synthetic ecology'});await search.execute('2',{query:'synthetic ecology'});
  assert.equal(calls,1);assert.equal(budget.used.searches,1);
  assert.ok(!webTools(Type,{...args,role:'audit'}).some(x=>x.name==='literature_search'));
});
test('extra source slices must originate in a cached parent and retain search provenance',async t=>{
  const archive=new Archive(await temporary(t)),budget=new Budget();
  const bridge={call:async()=>({content:[{type:'text',text:'synthetic slice'}]})};
  const more=webTools(Type,{bridge,archive,budget,role:'literature',readSources:new Set()}).find(x=>x.name==='source_more');
  await assert.rejects(more.execute('1',{parent_source_id:'missing',responseId:'made-up'}));
  const p=await archive.add('search',{query:'synthetic'},{content:[{type:'text',text:'response-abc'}]});
  await more.execute('2',{parent_source_id:p.id,responseId:'response-abc'});
  assert.ok(archive.list().some(x=>x.kind==='search_slice'));
  assert.ok(!archive.list().some(x=>x.kind==='fetch_slice'));assert.equal(budget.used.slices,1);
});
test('audit must read candidate sources, not only its own narrower claim citations',async t=>{
  const archive=new Archive(await temporary(t)),packet=normalizePacket(bundle());
  const source=await archive.add('fetch',{url:'https://example.org'},{content:[{type:'text',text:'synthetic'}]});
  const candidate=report('synthesis');candidate.claims[0].source_ids=[source.id];
  const readSources=new Set(),r={...report('audit'),verdict:'supported'};let submitted;
  const submit=localTools(Type,{packet,archive,role:'audit',readEvidenceIds:new Set(['E.population']),
    readSources,candidate,setReport:p=>{submitted=p;}}).find(x=>x.name==='submit_report');
  await assert.rejects(submit.execute('1',r),/candidate source/);assert.equal(submitted,undefined);
  readSources.add(source.id);await submit.execute('2',r);assert.equal(submitted,r);
});
test('dry run requires no Pi, network or credential and cannot overwrite',async t=>{
  const root=await temporary(t),path=join(root,'packet.json'),out=join(root,'run');await save(path,bundle());
  const r=await run({packetPath:path,out});assert.equal(r.status,'dry_run');
  const manifest=JSON.parse(await readFile(join(out,'manifest.json'),'utf8'));
  assert.equal(manifest.requested_provider,'deepseek');assert.equal(manifest.requested_thinking,'max');
  await assert.rejects(run({packetPath:path,out}),{code:'EEXIST'});
});
