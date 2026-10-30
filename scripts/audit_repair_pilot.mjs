#!/usr/bin/env node
// Offline integrity and paired-run diagnostics. No model calls or expected labels.
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {json,hash,save,normalizePacket,checkPrivacy,privateIdentifiers,ROLES} from '../src/core.mjs';
import {selectBrief,packRecords,unpackRecords} from '../src/evidence_views.mjs';

const {values}=parseArgs({options:{root:{type:'string'},out:{type:'string'}}});
const root=resolve(values.root??'runs/evidence_repair_20261030');
const prepared=await json(join(root,'PREPARED.json'));
async function optional(path){try{return await json(path);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
function close(a,b){assert.ok(Math.abs(a-b)<=1e-7*Math.max(1,Math.abs(b)),`${a} != ${b}`);}
async function runSummary(dir){
  const completion=await optional(join(dir,'completion.json'));
  const interpretation=await optional(join(dir,'interpretation.json'));
  const roles=[];
  for(const role of ROLES){
    const c=await optional(join(dir,role,'completion.json'));
    if(!c)continue;
    const events=(await readFile(join(dir,role,'events.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
    const wire=events.filter(e=>e.type==='wire_request');
    assert.ok(wire.every(e=>e.model==='gpt-6.1-sol'&&e.thinking==='high'));
    roles.push({role,valid:c.valid,seconds:c.seconds,usage:c.usage,
      wire_requests:wire.length,analysis_read:c.read_evidence.filter(id=>id.startsWith('A.')),
      source_reads:c.read_sources.length,
      tool_errors:events.filter(e=>e.type==='tool_execution_end'&&e.isError).map(e=>e.toolName)});
  }
  return {status:completion?.status??'running',error:completion?.error??null,
    seconds:completion?.seconds??null,usage:completion?.usage_total??null,
    audit:completion?.internal_audit_verdict??null,
    short_name:interpretation?.short_name??null,statement:interpretation?.statement??null,
    statement_words:interpretation?.statement?.trim().split(/\s+/).length??null,
    limitations:interpretation?.limitations??null,roles};
}
const results=[];
for(const row of prepared.features){
  const raw=await readFile(row.packet,'utf8');assert.equal(hash(raw),row.packet_sha256);
  const b=JSON.parse(raw),p=normalizePacket(b);
  const privateManifest=await json(join(dirname(row.packet),'private_identifiers.json'));
  checkPrivacy(p,privateIdentifiers(privateManifest,b.export_policy.public_study_accessions));
  assert.deepEqual(unpackRecords(packRecords(selectBrief(p))),selectBrief(p));
  const pop=p.records['E.population'].value;
  const kingdom=Object.entries(p.records).filter(([id])=>id.startsWith('E.taxonomy.kingdom.')).map(([,r])=>r.value);
  assert.equal(kingdom.reduce((s,x)=>s+x.active_events,0),pop.active_events);
  assert.equal(kingdom.reduce((s,x)=>s+x.background_events,0),pop.events);
  const d=p.records['A.environment.detailed'].value;
  assert.equal(d.rows.reduce((s,x)=>s+x.active_events,0)+d.remaining_active_events,pop.active_events);
  for(const x of [...kingdom,...d.rows]){
    close(x.active_share,x.active_events/pop.active_events);
    close(x.background_share,x.background_events/pop.events);
    close(x.firing_rate,x.active_events/x.background_events);
    close(x.enrichment,x.active_share/x.background_share);
  }
  const magnitude=p.records['A.activation.magnitude'].value;
  const tails=['p90','p99'].map(q=>p.records[`A.activation.tail_${q}`].value);
  assert.ok(tails[0].events>=tails[1].events&&tails[0].events<=pop.active_events);
  assert.ok(tails[0].activation_mass>=tails[1].activation_mass&&tails[0].activation_mass<=magnitude.activation_sum);
  for(const t of tails){
    close(t.share_of_active_events,t.events/pop.active_events);
    for(const field of ['environment','kingdom','study']){
      assert.equal(t[field].rows.reduce((s,x)=>s+x.count,0)+t[field].remaining_count,t.events);
      for(const x of t[field].rows)close(x.share,x.count/t.events);
    }
  }
  const samples=p.records['A.sample.concentration'].value;
  assert.equal(samples.active_communities,pop.active_samples);
  close(samples.top10_sample_active_share,samples.rows.reduce((s,x)=>s+x.active_events,0)/pop.active_events);
  for(const name of ['study_rates','continuous_abundance','within_otu','matched_contrasts']){
    for(const [section,value] of Object.entries(b.diagnostics.analyses[name])){
      assert.deepEqual(p.records[`A.${name}.${section}`].value,value);
    }
  }
  results.push({key:row.key,packet_integrity:'passed',records:Object.keys(p.records).length,
    current:await runSummary(join(root,'pilot_runs',row.key)),previous:await runSummary(row.previous_run)});
}
const report={results,notes:[
  'Offline checks verify arithmetic, transport, explicit denominators, source hashes and recorded wire model; not biological correctness.',
  'Historical comparisons change both evidence and instructions; they do not isolate a causal prompt effect.',
  'Input, cacheRead and output are separate. Reasoning is part of output. Weekly subscription percentage is not observable.',
  'Internal supported verdicts are not independent validation. Read claims and original evidence before accepting a feature interpretation.'
]};
if(values.out)await save(resolve(values.out),report);
console.log(JSON.stringify(report,null,2));
