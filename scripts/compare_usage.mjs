#!/usr/bin/env node
// Read-only historical comparison; creates only the explicitly selected output.
import {parseArgs} from 'node:util';
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {json,save,hash} from '../src/core.mjs';
import {canonicalUsage,sumCanonical} from '../src/accounting.mjs';

const {values}=parseArgs({options:{pi:{type:'string',multiple:true},codex:{type:'string'},out:{type:'string'}}});
if(!values.pi?.length||!values.codex)throw new Error('Usage: --pi /run [--pi /other-run] --codex /historical-run [--out /new.json]');
const rows=[];
for(const dir of values.pi) {
  const m=await json(join(dir,'manifest.json')),c=await json(join(dir,'completion.json'));
  const roleRows=c.usage_by_role.map(x=>({role:x.role,seconds:x.seconds,provider_messages:x.messages,
    ...canonicalUsage(x,'pi')}));
  const usage=canonicalUsage(c.usage_total,'pi');
  if(usage.total_tokens!==sumCanonical(roleRows).total_tokens)throw new Error('Pi role usage mismatch');
  rows.push({harness:'pi',path:resolve(dir),status:c.status,model:m.requested_model,thinking:m.requested_thinking,
    source_packet_sha256:m.source_packet_sha256,code_hashes:m.code_hashes,roles:roleRows,
    usage,role_seconds:roleRows.reduce((s,x)=>s+x.seconds,0),wall_seconds:c.seconds,
    request_attempts:c.budget_used.requests,tools_used:c.budget_used,
    internal_verdict:c.internal_audit_verdict,catalog_cost_estimate_usd:c.usage_total.cost_usd,
    billing_mode:c.billing_mode,error:c.error});
}
const root=values.codex,m=await json(join(root,'manifest.json')),finished=await json(join(root,'FINISHED.json'));
const roles=[],seen=new Set();
for(const role of ['observe','literature','critic','synthesis','judge']) {
  const d=join(root,'jobs',role),inv=await json(join(d,'invocation.json')),c=await json(join(d,'completion.json'));
  const id=hash(inv);if(seen.has(id))throw new Error('Duplicate legacy invocation');seen.add(id);
  const text=JSON.stringify(inv);
  if(!text.includes('gpt-6-sol')||!text.includes('high'))throw new Error('Historical model/effort mismatch');
  const events=(await readFile(join(d,'events.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  const turns=events.filter(x=>x.type==='turn.completed');
  if(turns.length!==1)throw new Error('Inspect legacy turn aggregation before using this baseline');
  const u=canonicalUsage(turns[0].usage,'codex');
  if(u.total_tokens!==canonicalUsage(c.usage,'codex').total_tokens)throw new Error('Legacy completion/event mismatch');
  roles.push({role,seconds:c.seconds,invocation_sha256:id,...u});
}
rows.push({harness:'historical_codex',path:resolve(root),model:m.model,thinking:m.reasoning_effort,
  status:finished.status,internal_verdict:finished.verdict,roles,usage:sumCanonical(roles),
  role_seconds:roles.reduce((s,x)=>s+x.seconds,0),wall_seconds:finished.seconds,
  provider_requests:null,request_count_note:'One completed Codex turn can contain multiple provider requests; not comparable to Pi request count.'});
const result={generated_at:new Date().toISOString(),formal_benchmark:false,rows,
  notes:[
    'Pi input excludes cache; Codex input includes cache. Reasoning is not added a second time.',
    'Historical baseline includes five interpretation roles only, excludes rule compiler and other attempts.',
    'Compare role-seconds for latency: historical wall time may include replay/queue overhead.',
    'New skills, tool affordances, deterministic-analysis access and web backend differ from historical Codex.',
    'A single feature is not a quality benchmark or proof of harness-only efficiency.',
    'Catalogue dollar estimates are not subscription billing; Pro quota percent is unobservable here.'
  ]};
if(values.out)await save(resolve(values.out),result);
console.log(JSON.stringify(result,null,2));
