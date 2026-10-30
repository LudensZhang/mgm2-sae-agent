#!/usr/bin/env node
// Read-only retrospective: evidence of retrieval activity is NOT retrieval necessity.
import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {parseArgs} from 'node:util';
import {json,save,hash} from '../src/core.mjs';
const {values}=parseArgs({options:{plan:{type:'string'},out:{type:'string'},reviews:{type:'string'}}});
if(!values.plan||!values.out)throw new Error('Usage: --plan FROZEN_PLAN --out NEW_JSON [--reviews PRIOR_REVIEW_JSON]');
const plan=await json(resolve(values.plan));
// Keep scientific decisions/results in ignored local artifacts, not source code.
// Manual annotations are not inferred gold feature labels.
const planHash=hash(await readFile(resolve(values.plan),'utf8'));
let reviews={};
if(values.reviews){
  const prior=await json(resolve(values.reviews));
  if(prior.plan_sha256!==planHash)throw new Error('Manual review annotations belong to a different frozen plan');
  reviews=Object.fromEntries(prior.rows.filter(r=>r.reviewed_decision).map(r=>[r.key,r.reviewed_decision]));
}
const fields=['input','cacheRead','output','totalTokens','seconds','messages'];
const totals={};const rows=[];
for(const r of plan.features){
  let c;try{c=await json(join(r.run,'completion.json'));}catch(e){if(e.code==='ENOENT')continue;throw e;}
  if(c.status!=='complete')continue;
  const p=await json(join(r.run,'interpretation.json'));
  const hypotheses=p.claims.filter(x=>x.level==='biological_hypothesis');
  for(const u of c.usage_by_role){const t=totals[u.role]??=Object.fromEntries(fields.map(k=>[k,0]));for(const k of fields)t[k]+=u[k]??0;}
  rows.push({key:r.key,run:r.run,name:p.short_name,statement:p.statement,
    hypothesis_claims:hypotheses,source_citing_claims:p.claims.filter(x=>x.source_ids.length),
    hypothesis_contains_subgroup_minority_or_subset:hypotheses.some(x=>/subgroup|minority|subset/i.test(x.text)),
    reviewed_decision:reviews[r.key]??null,
    review_status:reviews[r.key]?'manual_claim_review':'title_inventory_only_not_a_necessity_decision',
    usage:c.usage_total,literature_usage:c.usage_by_role.find(x=>x.role==='literature')});
}
const totalTokens=Object.values(totals).reduce((s,x)=>s+x.totalTokens,0);
const result={plan_sha256:planHash,
  scope:'Stopped original panel only. Excludes new repaired pilots, failed attempts and unstarted features.',
  summary:{completed:rows.length,features_with_hypothesis_claims:rows.filter(r=>r.hypothesis_claims.length).length,
    hypothesis_claim_count:rows.reduce((s,r)=>s+r.hypothesis_claims.length,0),
    features_citing_sources:rows.filter(r=>r.source_citing_claims.length).length,
    hypothesis_subgroup_word_screen:rows.filter(r=>r.hypothesis_contains_subgroup_minority_or_subset).length,
    manual_claim_reviews:rows.filter(r=>r.reviewed_decision).length,
    total_tokens:totalTokens,literature_tokens:totals.literature.totalTokens,
    literature_token_share:totals.literature.totalTokens/totalTokens},
  role_usage:totals,rows,
  interpretation:[
    'Citation and hypothesis counts measure behavior, not scientific necessity. The keyword screen is not a quality score.',
    'Most feature names are descriptive; preserve numeric/denominator, control and study checks even when skipping external retrieval.',
    'Route on whether an external answer can change a material claim, not a fixed feature class, source quota or minority-taxon percentage threshold.',
    'Study metadata lookup, taxonomy-name resolution and mechanistic literature review are different tasks.',
    'Recommended experiment: interpreter plus an independent reviewer, with retrieval conditional on a concrete unresolved question. Revise only on substantive review findings.',
    'Compare on identical repaired packets and exact model/reasoning. Measure accuracy, material errors caught, retrieval impact, tokens and runtime; do not reward citations or cautious prose.',
    'Historical role-token share is not a measured saving or a Pro quota percentage. Cached tokens, output and uncached input have different accounting.'
  ]};
await save(resolve(values.out),result);
console.log(JSON.stringify({summary:result.summary,role_usage:totals,reviewed:rows.filter(r=>r.reviewed_decision).map(r=>({key:r.key,...r.reviewed_decision}))},null,2));
