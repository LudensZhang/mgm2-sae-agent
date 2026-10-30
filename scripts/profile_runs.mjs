#!/usr/bin/env node
// Actual usage by role; character sizes are diagnostics, NOT token attribution.
import {parseArgs} from 'node:util';
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {json,save} from '../src/core.mjs';
const {values}=parseArgs({options:{run:{type:'string',multiple:true},out:{type:'string'}}});
if(!values.run?.length)throw new Error('Usage: --run DIR [--run DIR] [--out NEW_JSON]');
const runs=[];
for(const dir of values.run){
  const manifest=await json(join(dir,'manifest.json')), completion=await json(join(dir,'completion.json'));
  const roles=[];
  for(const usage of completion.usage_by_role){
    const root=join(dir,usage.role), prompt=await json(join(root,'prompt.json'));
    const events=(await readFile(join(root,'events.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
    const starts=events.filter(e=>e.type==='tool_execution_start');
    const ends=events.filter(e=>e.type==='tool_execution_end');
    const count={},chars={};
    for(const e of starts)count[e.toolName]=(count[e.toolName]??0)+1;
    for(const e of ends)chars[e.toolName]=(chars[e.toolName]??0)+JSON.stringify(e.result??{}).length;
    const accepted=events.findIndex(e=>e.type==='tool_execution_end'&&e.toolName==='submit_report'&&!e.isError&&JSON.stringify(e.result).includes('accepted'));
    const acknowledgements=accepted<0?[]:events.slice(accepted+1).filter(e=>e.type==='assistant_end').map(e=>e.message.usage);
    roles.push({...usage,system_chars:prompt.system.length,initial_prompt_chars:prompt.prompt.length,
      tool_calls:count,tool_result_chars:chars,
      payload_chars:events.filter(e=>e.type==='wire_request').map(e=>e.payload_chars),
      post_submission_usage:acknowledgements,
      tool_errors:ends.filter(e=>e.isError).map(e=>({name:e.toolName,result:e.result}))});
  }
  let candidate,auditCompletion;
  try{candidate=await json(join(dir,'interpretation.json'));}catch(e){if(e.code!=='ENOENT')throw e;}
  try{auditCompletion=await json(join(dir,'audit','completion.json'));}catch(e){if(e.code!=='ENOENT')throw e;}
  const citedSources=[...new Set((candidate?.claims??[]).flatMap(c=>c.source_ids))];
  runs.push({path:resolve(dir),model:manifest.requested_model,thinking:manifest.requested_thinking,
    source_packet_sha256:manifest.source_packet_sha256,code_hashes:manifest.code_hashes,status:completion.status,
    audit:completion.internal_audit_verdict,seconds:completion.seconds,
    usage:completion.usage_total,budget:completion.budget_used,roles,
    sources:{total:completion.sources?.length??0,failed:completion.sources?.filter(s=>s.is_error).length??0},
    candidate_report_chars:candidate?JSON.stringify(candidate).length:null,
    candidate_cited_sources:citedSources,
    candidate_sources_not_read_by_auditor:citedSources.filter(id=>!auditCompletion?.read_sources.includes(id))});
}
const result={runs,notes:['Input excludes cacheRead; reasoning is a subset of output.',
  'Character lengths are not exact token attribution. Tool results contribute to later requests.',
  'Historical comparisons are not randomized paired trials. Internal audit is not a gold quality score.',
  'Provider-reported usage may omit interrupted requests. Pro quota percentage is unobservable.']};
if(values.out)await save(resolve(values.out),result);
console.log(JSON.stringify(result,null,2));
