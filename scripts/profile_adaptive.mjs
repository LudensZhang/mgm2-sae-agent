#!/usr/bin/env node
// Offline model/usage/source/trajectory audit, never a feature-label quality score.
import {readFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {parseArgs} from 'node:util';
import assert from 'node:assert/strict';
import {json,save} from '../src/core.mjs';
const {values}=parseArgs({options:{root:{type:'string'},out:{type:'string'}}});
const root=resolve(values.root??'runs/adaptive_pilot_20261030');
const plan=await json(join(root,'PLAN.json'));
async function optional(path){try{return await json(path);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
const rows=[];
for(const row of plan.features){
  const dir=join(root,'pilot_runs',row.key),completion=await optional(join(dir,'completion.json'));
  const report=await optional(join(dir,'interpretation.json'));
  const baseline=await json(join(row.baseline_run,'completion.json'));
  const baselineReport=await json(join(row.baseline_run,'interpretation.json'));
  const phases=[];let wireRequests=0;
  for(const role of ['interpret','research','review']){
    let dirs;try{dirs=await readdir(join(dir,role));}catch(e){if(e.code==='ENOENT')continue;throw e;}
    for(const phase of dirs.filter(x=>/^\d+$/.test(x)).sort()){
      const folder=join(dir,role,phase),c=await optional(join(folder,'completion.json'));
      if(!c)continue;
      const events=(await readFile(join(folder,'events.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
      const requests=events.filter(e=>e.type==='wire_request');
      assert.ok(requests.every(e=>e.model==='gpt-6.1-sol'&&e.thinking==='high'));
      wireRequests+=requests.length;
      const tools={};for(const e of events.filter(e=>e.type==='tool_execution_start'))tools[e.toolName]=(tools[e.toolName]??0)+1;
      const action=await optional(join(folder,'action.json'));
      phases.push({...c,action:action?.kind,tools,requests:requests.length,
        research_request:action?.request??null,
        tool_errors:events.filter(e=>e.type==='tool_execution_end'&&e.isError).map(e=>({tool:e.toolName,result:e.result}))});
    }
  }
  const lastReview=phases.filter(x=>x.role==='review').at(-1);
  const unread=[...new Set((report?.claims??[]).flatMap(x=>x.source_ids))].filter(id=>!lastReview?.read_sources.includes(id));
  if(completion?.status==='complete')assert.equal(unread.length,0);
  let sameEvidence=null;
  if(completion&&row.baseline==='repaired_five_stage'){
    const {source_packet_hash:a,...current}=await json(join(dir,'packet.json'));
    const {source_packet_hash:b,...prior}=await json(join(row.baseline_run,'packet.json'));
    assert.deepEqual(current,prior);sameEvidence=true;
  }
  rows.push({key:row.key,status:completion?.status??'running_or_pending',error:completion?.error,
    audit:completion?.internal_audit_verdict,sessions:completion?.sessions,research_requests:completion?.research_requests,
    revisions:completion?.revisions,seconds:completion?.seconds,usage:completion?.usage_total,
    wire_requests:wireRequests,phases,name:report?.short_name,statement:report?.statement,
    candidate_sources_not_read_by_reviewer:unread,source_cache_reuse:completion?.sources?.filter(x=>x.shared_cache_reused).length,
    baseline:{kind:row.baseline,exact_scientific_evidence_match:sameEvidence,run:row.baseline_run,
      seconds:baseline.seconds,usage:baseline.usage_total,name:baselineReport.short_name,statement:baselineReport.statement},
    total_token_change_fraction:completion?.status==='complete'?completion.usage_total.totalTokens/baseline.usage_total.totalTokens-1:null,
    runtime_change_fraction:completion?.status==='complete'?completion.seconds/baseline.seconds-1:null});
}
const result={rows,notes:[
  'Same evidence does not imply a randomized causal comparison: prompts, roles, time, retrieval and cache state differ.',
  'The two historical-unrepaired baselines do not have matched evidence and cannot isolate a workflow effect.',
  'Wire model/high and source-reading checks are integrity checks, not biological validation.',
  'Cached input is included in totalTokens; reasoning is within output. These are not Pro quota percentages.',
  'Assess whether retrieval resolved a material question, not whether a preset feature category was found.'
]};
if(values.out)await save(resolve(values.out),result);
console.log(JSON.stringify(result,null,2));
