import {mkdir,readdir,link,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {hash,json,save} from './core.mjs';
import {publicUrl,sourceForModel} from './web.mjs';

// Shared original source snapshots only: never feature labels or model reports.
export class SourceCache {
  constructor(root){this.root=root;}
  async put(record){
    if(record.kind!=='fetch'||record.is_error)return;
    publicUrl(record.request.url);
    if(hash(record.text)!==record.sha256)throw new Error('Invalid source snapshot');
    await mkdir(this.root,{recursive:true});
    const temporary=join(this.root,'.pending-'+randomUUID());
    await save(temporary,record);
    try{await link(temporary,join(this.root,record.id+'.json'));}catch(e){if(e.code!=='EEXIST')throw e;}
    finally{await rm(temporary,{force:true});}
  }
  async get(id){
    if(!/^S[a-f0-9]{16}$/.test(id))throw new Error('Invalid cached source ID');
    const r=await json(join(this.root,id+'.json'));
    if(r.id!==id||r.kind!=='fetch'||r.is_error||hash(r.text)!==r.sha256)
      throw new Error('Cached source integrity failure');
    publicUrl(r.request.url);return r;
  }
  async find(query){
    const terms=query.toLowerCase().split(/\s+/).filter(x=>x.length>=3);
    if(!terms.length)return [];
    let names;try{names=await readdir(this.root);}catch(e){if(e.code==='ENOENT')return [];throw e;}
    const hits=[];
    for(const name of names.filter(x=>/^S[a-f0-9]{16}\.json$/.test(x))){
      const r=await this.get(name.slice(0,-5));
      const body=(r.request.url+' '+r.text).toLowerCase();
      const score=terms.filter(t=>body.includes(t)).length;
      if(score)hits.push({id:r.id,url:r.request.url,created_at:r.created_at,sha256:r.sha256,
        preview:sourceForModel({...r,text:r.text.slice(0,250)}).text,matched_terms:score,
        coverage:r.coverage});
    }
    return hits.sort((a,b)=>b.matched_terms-a.matched_terms).slice(0,8);
  }
  async importInto(id,archive){
    if(archive.records.has(id))return archive.records.get(id);
    const original=await this.get(id);
    // Plugin responseIds belong to their originating process. The cached extract
    // is usable; request a fresh source_fetch if additional web text is needed.
    const record={...original,shared_cache_reused:true,
      cache_scope:'Exact prior fetch extract. For more than this archived text, fetch the URL afresh; prior plugin responseIds are not live.'};
    await mkdir(archive.root,{recursive:true});await save(join(archive.root,id+'.json'),record);
    archive.records.set(id,record);return record;
  }
}
