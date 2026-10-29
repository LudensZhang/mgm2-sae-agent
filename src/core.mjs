import {createHash} from 'node:crypto';
import {readFile, mkdir, writeFile, appendFile} from 'node:fs/promises';
import {join} from 'node:path';

export const VERSION = '0.1.0';
export const ROLES = ['observe', 'literature', 'critic', 'synthesis', 'audit'];
export const hash = x => createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex');
export const json = async path => JSON.parse(await readFile(path, 'utf8'));
export async function save(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', {flag:'wx', mode:0o600});
}
export const log = (path, value) => appendFile(path, JSON.stringify(value) + '\n', {mode:0o600});

// Not an anonymizer: inputs must already be exported/anonymized by the data owner.
export function checkPrivacy(value, forbidden = []) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (/\b(?:PRJ[END][AB]\d+|[SED]R[RSXP]\d+|SAM[END][AG]?\d+)\b/i.test(text)
      || /\/(?:home|data\d+|Users)\//.test(text)
      || /"(?:api_key|access_token|refresh_token|private_identifiers)"\s*:/i.test(text)
      || forbidden.some(s => s.length >= 6 && text.includes(s))) {
    throw new Error('Privacy gate: export contains a raw identifier, local path, or credential field');
  }
}

export function normalizePacket(input) {
  const core = input.core ?? input.evidence;
  if (!core || !core.facts || !Number.isInteger(core.feature_id)) throw new Error('Expected a bundle.core or evidence export with feature_id and facts');
  if (core.scope?.partition && core.scope.partition !== 'discovery') throw new Error('Only discovery evidence is available to interpretation agents');
  if (core.scope?.tuning_exposed === true) throw new Error('Do not expose tuning/confirmation labels to the interpreter');
  const records = {...core.facts};
  for (const [key, value] of Object.entries(input.annex?.cases ?? {})) records[`X.case.${key}`] = value;
  for (const [key, value] of Object.entries(input.annex?.controls ?? {})) records[`X.control.${key}`] = value;
  // Exclude previous labels, previous LLM reports, source claims, and selection strata.
  // Existing deterministic analysis is available only when explicitly exported as such.
  for (const [key, value] of Object.entries(input.analysis_results ?? {})) records[key] = value;
  const packet = {feature_id:core.feature_id, site:core.site, k:core.k, codebook:core.codebook,
    scope:core.scope, records, unavailable:core.unavailable ?? [],
    source_packet_hash:hash(input)};
  checkPrivacy(packet);
  return packet;
}

export function overview(packet) {
  const groups = {};
  for (const key of Object.keys(packet.records)) {
    const prefix = key.startsWith('E.taxonomy.') ? key.split('.').slice(0,3).join('.') : key.split('.').slice(0,2).join('.');
    groups[prefix] = (groups[prefix] ?? 0) + 1;
  }
  return {feature_id:packet.feature_id, site:packet.site, k:packet.k, codebook:packet.codebook,
    scope:packet.scope, population:packet.records['E.population'], groups,
    evidence_index:Object.keys(packet.records).filter(id=>!id.startsWith('X.case.')),
    unavailable:packet.unavailable, note:'Use evidence_list/evidence_read for details. Source packet is not a population census unless explicitly stated.'};
}

export function readEvidence(packet, {id, pointer='', offset=0, limit=7000}) {
  checkPage(offset,limit);
  if (!Object.hasOwn(packet.records,id)) throw new Error('Unknown evidence id');
  let value = packet.records[id];
  if (pointer) {
    if (!pointer.startsWith('/')) throw new Error('pointer must use JSON Pointer syntax');
    for (const segment of pointer.slice(1).split('/')) {
      const key = segment.replace(/~1/g,'/').replace(/~0/g,'~');
      if (['__proto__','constructor','prototype'].includes(key) || value === null || typeof value !== 'object' || !Object.hasOwn(value,key)) throw new Error('Unknown pointer');
      value = value[key];
    }
  }
  const text = JSON.stringify(value);
  return {id, pointer, offset, total_chars:text.length, next_offset:offset+limit<text.length?offset+limit:null,
    text:text.slice(offset,offset+limit), interpretation:'Exact JSON slice; do not infer omitted fields. Use pointer or pagination for more.'};
}

function checkPage(offset,limit) {
  if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>7000)
    throw new Error('Invalid page bounds');
}

export function privateIdentifiers(mapping) {
  // The export contains arrays of raw IDs, not a list of field names.
  if(!mapping || Object.values(mapping).some(v=>!Array.isArray(v)||v.some(x=>typeof x!=='string')))
    throw new Error('Unsupported private identifier manifest');
  return Object.values(mapping).flat().filter(x=>!/^(?:SAMPLE_|STUDY_|EVENT_)/.test(x));
}

export class Budget {
  constructor({requests=40, roleRequests=10, searches=6, fetches=6, slices=12, seconds=900}={}) {
    this.limits={requests,roleRequests,searches,fetches,slices,seconds};
    this.used={requests:0,searches:0,fetches:0,slices:0}; this.roles={}; this.start=Date.now();
  }
  check() { if ((Date.now()-this.start)/1000 > this.limits.seconds) throw new Error('Wall-time budget exceeded'); }
  take(kind, role) {
    this.check();
    if (!(kind in this.used)) throw new Error('Unknown budget counter');
    if (this.used[kind] >= this.limits[kind]) throw new Error(`${kind} budget exceeded`);
    if (kind==='requests' && (this.roles[role]??0)>=this.limits.roleRequests) throw new Error('Role request budget exceeded');
    this.used[kind]++;
    if(kind==='requests') this.roles[role]=(this.roles[role]??0)+1;
  }
}

export class Archive {
  constructor(root) {this.root=root; this.records=new Map(); this.byRequest=new Map();}
  async add(kind, request, result) {
    const key=hash({kind,request}), id='S'+hash({kind,request,result}).slice(0,16);
    if (this.records.has(id)) return this.records.get(id);
    const text=(result.content??[]).filter(x=>x.type==='text').map(x=>x.text).join('\n');
    const record={id,kind,request,created_at:new Date().toISOString(),sha256:hash(text),text,
      is_error:Boolean(result.isError), coverage:kind==='search'?'search_results':'plugin_returned_extract_not_guaranteed_full_article'};
    await mkdir(this.root,{recursive:true});
    await save(join(this.root,id+'.json'),record);
    this.records.set(id,record); this.byRequest.set(key,id); return record;
  }
  cached(kind, request) {return this.records.get(this.byRequest.get(hash({kind,request})));}
  list() {return [...this.records.values()].map(({text,...r})=>({...r,total_chars:text.length}));}
  read(id, offset=0, limit=7000) {
    checkPage(offset,limit);
    const r=this.records.get(id); if(!r) throw new Error('Unknown source id');
    return {...r,text:r.text.slice(offset,offset+limit),offset,total_chars:r.text.length,
      next_offset:offset+limit<r.text.length?offset+limit:null};
  }
}

export function validateReport(report, packet, archive, role) {
  if (!report || report.role!==role || typeof report.short_name!=='string' || !report.short_name.trim()
      || typeof report.statement!=='string' || !report.statement.trim()) throw new Error('Invalid report identity/text');
  if(!Array.isArray(report.claims)||report.claims.length<1||report.claims.length>6) throw new Error('Require 1–6 substantive claims');
  const ids=new Set();
  for(const c of report.claims) {
    if(!c.claim_id||ids.has(c.claim_id)) throw new Error('Duplicate/missing claim id'); ids.add(c.claim_id);
    if(typeof c.text!=='string'||!c.text.trim()||!['observation','association','biological_hypothesis'].includes(c.level)) throw new Error('Invalid claim');
    if(!Array.isArray(c.evidence_ids)||!c.evidence_ids.length||c.evidence_ids.some(id=>!Object.hasOwn(packet.records,id))) throw new Error('Unknown/missing evidence citation');
    if(!Array.isArray(c.source_ids)||c.source_ids.some(id=>!archive.records.has(id)||archive.records.get(id).is_error)) throw new Error('Unknown/failed source citation');
    if(c.level==='biological_hypothesis' && !c.source_ids.some(id=>['fetch','fetch_slice'].includes(archive.records.get(id).kind))) throw new Error('Biological hypotheses require an opened source, not only search results');
  }
  for(const field of ['alternatives','limitations','changes']) if(!Array.isArray(report[field])||report[field].some(x=>typeof x!=='string')) throw new Error('Expected string array: '+field);
  if(role==='audit' && !['supported','revise','insufficient'].includes(report.verdict)) throw new Error('Audit requires a verdict');
  checkPrivacy(report);
  return report;
}

export function summarizeUsage(messages) {
  const result={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost_usd:0,messages:0};
  let reasoning=0,reasoningReported=0;
  for(const m of messages) {
    result.messages++;
    for(const k of ['input','output','cacheRead','cacheWrite','totalTokens']) result[k]+=m.usage?.[k]??0;
    result.cost_usd+=m.usage?.cost?.total??0;
    if(Number.isFinite(m.usage?.reasoning)){reasoning+=m.usage.reasoning;reasoningReported++;}
  }
  return {...result,cost_basis:'Pi model catalog estimate, not a billing statement',reasoning_tokens:reasoningReported?reasoning:null,
    reasoning_usage_messages:reasoningReported,
    subscription_quota_percent:null};
}
