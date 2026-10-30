import {localTools} from './runner.mjs';
import {checkPrivacy} from './core.mjs';
import {webTools,sourceForModel} from './web.mjs';
const txt=value=>({content:[{type:'text',text:JSON.stringify(value)}],details:{}});

export function remainingToolBudget(budget,role){
  return {role_requests_remaining:Math.max(0,budget.limits.roleRequests-(budget.roles[role]??0)),
    feature_requests_remaining:Math.max(0,budget.limits.requests-budget.used.requests),
    search_calls_remaining:Math.max(0,budget.limits.searches-budget.used.searches),
    fetch_calls_remaining:Math.max(0,budget.limits.fetches-budget.used.fetches),
    source_slice_calls_remaining:Math.max(0,budget.limits.slices-budget.used.slices)};
}

export function assertReferences(value,packet,archive){
  if(!Array.isArray(value.evidence_ids)||!value.evidence_ids.length||
    value.evidence_ids.some(id=>!Object.hasOwn(packet.records,id)))throw new Error('Missing/unknown local evidence');
  if(!Array.isArray(value.source_ids)||value.source_ids.some(id=>!archive.records.has(id)||archive.records.get(id).is_error))
    throw new Error('Unknown/failed external source');
}

export function validateReview(report,{packet,archive,readEvidenceIds,readSources,candidate}){
  if(!['supported','revise','insufficient'].includes(report.verdict)||!Array.isArray(report.checks)||!report.checks.length||!Array.isArray(report.issues))
    throw new Error('Invalid independent review');
  if(report.verdict==='supported'&&report.issues.length)throw new Error('Supported review cannot retain material issues');
  if(report.verdict!=='supported'&&!report.issues.length)throw new Error('Specify the material unresolved issue');
  if(!readEvidenceIds.size)throw new Error('Review must inspect local evidence');
  for(const item of [...report.checks,...report.issues]){
    assertReferences(item,packet,archive);
    for(const id of item.evidence_ids)if(!readEvidenceIds.has(id))throw new Error('Read the local evidence cited in the review');
    for(const id of item.source_ids)if(!readSources.has(id))throw new Error('Read the original source cited in the review');
  }
  for(const claim of candidate.claims)for(const id of claim.source_ids)
    if(!readSources.has(id))throw new Error('Review must inspect every candidate source citation');
  checkPrivacy(report);
}

export function adaptiveTools(Type,env){
  const {packet,archive,role,readEvidenceIds,readSources,setAction,candidate,bridge,budget,sourceCache}=env;
  const Ref={evidence_ids:Type.Array(Type.String(),{minItems:1}),source_ids:Type.Array(Type.String())};
  const terminal=value=>{setAction(value);return {...txt({accepted:true}),terminate:true};};
  const base=localTools(Type,{packet,archive,role,readEvidenceIds,readSources,
    setReport:report=>setAction({kind:'candidate',report})});
  const tools=role==='interpret'?base:base.filter(t=>t.name!=='submit_report');
  // Only the research role has live retrieval tools. Reuse the existing plugin unchanged.
  tools.push(...webTools(Type,{bridge,archive,budget,role:role==='research'?'literature':role,readSources}));
  if(role==='interpret')tools.push({name:'request_research',label:'Ask researcher',
    description:'Pause interpretation for a specific external-knowledge question that can change a material claim. Not required for local statistical descriptions.',
    parameters:Type.Object({question:Type.String({minLength:10}),claim_affected:Type.String({minLength:5}),
      expected_impact:Type.String({minLength:5}),evidence_ids:Ref.evidence_ids}),
    execute:async(_id,p)=>{
      assertReferences({...p,source_ids:[]},packet,archive);
      if(!readEvidenceIds.size)throw new Error('Inspect local evidence before requesting research');
      checkPrivacy(p);return terminal({kind:'research_request',request:p});
    }});
  if(role==='research')tools.push({name:'submit_research',label:'Return research findings',
    description:'Answer the requested question with source-grounded findings and the consequence for the feature interpretation, not another complete feature report.',
    parameters:Type.Object({answer:Type.String({minLength:10}),
      outcome:Type.Union(['resolved','partly_resolved','unresolved'].map(x=>Type.Literal(x))),
      findings:Type.Array(Type.Object({finding:Type.String({minLength:5}),scope:Type.String(),...Ref}),{maxItems:6}),
      interpretation_impact:Type.String({minLength:5}),remaining_gaps:Type.Array(Type.String())}),
    execute:async(_id,p)=>{
      if(!readEvidenceIds.size)throw new Error('Read relevant local evidence');
      for(const f of p.findings){assertReferences(f,packet,archive);for(const id of f.source_ids)
        if(!readSources.has(id))throw new Error('Read the source before citing it');}
      if(p.outcome==='resolved'&&!p.findings.length)throw new Error('Resolved answer needs evidence');
      checkPrivacy(p);return terminal({kind:'research_result',report:p});
    }});
  if(role==='review')tools.push({name:'submit_review',label:'Submit independent review',
    description:'Return concise evidence checks and material issues. Do not rewrite the candidate.',
    parameters:Type.Object({verdict:Type.Union(['supported','revise','insufficient'].map(x=>Type.Literal(x))),
      summary:Type.String({minLength:10}),checks:Type.Array(Type.Object({finding:Type.String(),...Ref}),{minItems:1,maxItems:8}),
      issues:Type.Array(Type.Object({claim:Type.String(),problem:Type.String(),required_change:Type.String(),...Ref}),{maxItems:6})}),
    execute:async(_id,p)=>{validateReview(p,{packet,archive,readEvidenceIds,readSources,candidate:candidate()});return terminal({kind:'review',report:p});}});
  if(role==='research'&&sourceCache)tools.push(
    {name:'source_cache_find',label:'Find reusable sources',description:'Search exact cached originals from this development panel, not earlier feature interpretations. No network request.',
      parameters:Type.Object({query:Type.String({minLength:3,maxLength:200})}),
      execute:async(_id,p)=>txt({sources:await sourceCache.find(p.query)})},
    {name:'source_cache_read',label:'Read cached original',description:'Import and read a cached original source. Scope and timestamp preserved. Use source_read for more archived text; source_fetch for a fresh web request.',
      parameters:Type.Object({id:Type.String()}),execute:async(_id,p)=>{
        await sourceCache.importInto(p.id,archive);readSources.add(p.id);return txt(sourceForModel(archive.read(p.id)));
      }});
  return tools.map(tool=>({...tool,execute:async(...args)=>{
    const result=await tool.execute(...args);
    if(sourceCache&&role==='research'&&tool.name==='source_fetch')
      for(const r of archive.records.values())if(!r.shared_cache_reused)await sourceCache.put(r);
    return result;
  }}));
}
