"""Versioned discovery-only packet repair; stream events, never load the raw pickle.

Preserve frozen feature selection and all previous packets. Enrich with public
MicrobeAtlas metadata and exact activation summaries; no model or network calls.
"""
import argparse
from collections import Counter
import copy
import csv
import hashlib
import json
from pathlib import Path
import re

import numpy as np
import pandas as pd

SAE = Path(__file__).resolve().parents[3]
SOURCE = SAE/'experiments/layer_interpretation_20261028'
METADATA = Path('/data6/zhanghaohong/databases/microbeatals/samples.env.info.tsv')
PUBLIC_STUDY = re.compile(r'^(?:PRJ[END][AB]\d+|[SED]RP\d+)$')
DEFAULT_KEYS = ['l7_f3705','l8_f4081','l9_f3883','l4_f1506']


def read(path):
    with Path(path).open() as f: return json.load(f)


def sha(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for chunk in iter(lambda:f.read(2**20),b''): h.update(chunk)
    return h.hexdigest()


def save(path,obj):
    path.parent.mkdir(parents=True,exist_ok=True)
    with path.open('x') as f: json.dump(obj,f,indent=2,allow_nan=False)


def normalize_id(value):
    value=str(value)
    while len(value)>3 and value[:2] in ("b'",'b"') and value[-1]==value[1]: value=value[2:-1]
    return value.strip()


def replace_aliases(value,mapping):
    if isinstance(value,str): return mapping.get(value,value)
    if isinstance(value,list): return [replace_aliases(x,mapping) for x in value]
    if isinstance(value,dict): return {k:replace_aliases(v,mapping) for k,v in value.items()}
    return value


def strings(value):
    if isinstance(value,str): yield value
    elif isinstance(value,list):
        for v in value: yield from strings(v)
    elif isinstance(value,dict):
        for v in value.values(): yield from strings(v)


def distribution(counter,denominator,limit=12):
    ranked=sorted(counter.items(),key=lambda kv:(-kv[1],kv[0]))
    return dict(denominator=int(denominator),distinct_categories=len(counter),
        selection=f'Top {limit} by count; non-displayed count retained',
        rows=[dict(category=k,count=int(v),share=v/denominator if denominator else None)
              for k,v in ranked[:limit]],
        remaining_count=int(sum(v for _,v in ranked[limit:])))


def public_study_allowlist(private,verified_public_studies,used_studies):
    # A fetched paper may mention another study in the discovery population.
    # Public provenance, not presence in this feature's selected rows, determines
    # whether an accession belongs in the private-identifier exclusion list.
    allowed=sorted(s for s in set(private['studies']) & set(verified_public_studies)
                   if PUBLIC_STUDY.fullmatch(s))
    if not set(used_studies)<=set(allowed):
        raise ValueError('Exported study accession absent from verified public metadata')
    return allowed


def strict_controls(bundle):
    result={}
    for group,item in bundle['diagnostics']['analyses']['matched_contrasts'].items():
        pairs=item['pairs']
        strict=[p for p in pairs if p['same_study'] and p['same_bin']]
        result[group]=dict(total_selected_pairs=len(pairs),same_study_and_bin=len(strict),
            strict_positive_event_ids=[p['positive'] for p in strict],
            relaxed_pairs=len(pairs)-len(strict),
            interpretation='Subset labels within the original matching rule; same-community controls still change OTU identity. Selected pairs, not population prevalence.')
    return result


def build(plan_path,out,keys):
    if (out/'PREPARED.json').exists(): raise RuntimeError('Packets already frozen')
    plan=read(plan_path); lookup={r['key']:r for r in plan['features']}
    assert len(keys)==len(set(keys)) and set(keys)<=set(lookup)
    complete=read(SOURCE/'data/COMPLETE.json')
    for name in ('communities.csv.gz','discovery_events.csv.gz','taxonomy.json'):
        assert sha(SOURCE/'data'/name)==complete['files'][name],name
    assert sha(METADATA)==complete['metadata_sha256'],'Public metadata changed'
    community=pd.read_csv(SOURCE/'data/communities.csv.gz')
    discovery=community[community.split=='discovery']
    wanted=set(discovery.sample_id.astype(str))
    public_meta={};verified_public_studies=set()
    csv.field_size_limit(10**7)
    with METADATA.open() as stream:
        for r in csv.DictReader(stream,delimiter='\t'):
            project=r.get('Project','')
            if PUBLIC_STUDY.fullmatch(project):verified_public_studies.add(project)
            sid=normalize_id(r['MAP_SID'])
            if sid in wanted:
                public_meta[sid]={k:r.get(k,'') or 'unknown' for k in ('Environments','Technology','Keywords','Institution','Project')}
    assert public_meta,'No public sample metadata joined'
    # Metadata is sample-level; study profiles summarize only discovery communities.
    study_meta={}
    for r in discovery.itertuples():
        m=public_meta.get(str(r.sample_id),{})
        item=study_meta.setdefault(str(r.project),dict(samples=0,available=0,
            environment_detail=Counter(),technology=Counter(),institution=Counter(),keywords=Counter()))
        item['samples']+=1;item['available']+=bool(m)
        item['environment_detail'][str(r.environment_detail)]+=1
        item['technology'][str(r.technology)]+=1
        item['institution'][m.get('Institution','unknown')]+=1
        for term in set(m.get('Keywords','unknown').split(';')): item['keywords'][term.strip() or 'unknown']+=1
    taxonomy=read(SOURCE/'data/taxonomy.json')
    kingdom={otu:t.get('taxonomy_source','unknown')+'::'+t.get('kingdom','unknown') for otu,t in taxonomy.items()}
    states=[]
    for key in keys:
        row=lookup[key];assert sha(row['packet'])==row['packet_sha256']
        b=copy.deepcopy(read(row['packet']));private=read(Path(row['packet']).with_name('private_identifiers.json'))
        assert sha(Path(row['packet']).with_name('private_identifiers.json'))==row['private_identifiers_sha256']
        aliases={f'STUDY_{i:05d}':s for i,s in enumerate(private['studies']) if PUBLIC_STUDY.fullmatch(s)}
        b=replace_aliases(b,aliases)
        for case in b['annex']['cases'].values():
            ci=int(case['sample_id'].removeprefix('SAMPLE_'));c=community.iloc[ci]
            assert c.split=='discovery'
            assert case['study']==str(c.project) or case['study'] not in aliases.values()
            m=public_meta.get(str(c.sample_id),{})
            case['public_metadata']=dict(environment_detail=str(c.environment_detail),
                keywords=m.get('Keywords','unknown'),institution=m.get('Institution','unknown'),
                source='Public MicrobeAtlas samples.env.info.tsv; exact sample join',
                scope='Metadata of this sample; no inferred host, disease or protocol')
            case['selection_groups']=[name for name,ids in b['core']['annex_available']['case_groups'].items() if case['event_id'] in ids]
            case['community'].update(at_input_cap=bool(c.at_input_cap),floor_fraction=float(c.floor_fraction))
        b['core']['codebook'].update(
            taxonomy='One selected source per OTU: choose the more specific GTDB or legacy lineage (GTDB on ties). Source-prefixed categories at each rank count disjoint events; biological name equivalence requires separate mapping.',
            public_metadata='Public study accessions retained; detailed environments and metadata come from exact public sample joins. Missing fields stay unknown; study-level keyword frequencies are not universal sample properties.',
            shared_scope='Discovery sampled positive OTU positions, up to 64 per community; diversity uses retained positive input OTUs capped at 768. Shared methods scope, not a feature-specific limitation to repeat automatically.')
        b['core']['version']='pi-evidence-repair-v1'
        b['analysis_results']={}
        b['analysis_results']['A.controls.strict_subsets']={ 'value':strict_controls(b),
            'interpretation':'Same-study and same-bin coverage is explicit; no new controls or causal adjustment.'}
        used_studies=sorted(set(strings(b))&set(aliases.values()))
        for accession in used_studies:
            if accession not in study_meta: continue
            m=study_meta[accession];n=m['samples']
            b['analysis_results'][f'A.study_metadata.{accession}']=dict(value=dict(study=accession,
                discovery_communities=n,metadata_available_communities=m['available'],
                **{k:distribution(m[k],n) for k in ('environment_detail','technology','institution','keywords')}),
                interpretation='Public sample metadata aggregated within the study over discovery communities; keywords are multi-label sample frequencies, not activation-event fractions. Top categories only; not an inferred experimental protocol.')
        layer=SOURCE/f"l{row['layer']}";receipt=read(layer/'COMPLETE.json')
        selection=read(layer/'SELECTION.json')
        for name in ('SELECTION.json','discovery.npy'): assert sha(layer/name)==receipt['files'][name]
        col=[r['feature_id'] for r in selection['features']].index(row['feature_id'])
        matrix=np.load(layer/'discovery.npy',mmap_mode='r')
        a=np.array(matrix[:,col]);del matrix
        pop=b['core']['facts']['E.population']['value']
        assert len(a)==pop['events'] and int((a>0).sum())==pop['active_events']
        positive=a[a>0]
        thresholds={f'p{q}':float(np.quantile(positive,q/100)) for q in (90,99)}
        b['analysis_results']['A.activation.magnitude']={ 'value':dict(all_events=len(a),active_events=len(positive),
            active_mean=float(positive.mean(dtype=np.float64)),active_median=float(np.median(positive)),
            active_p90=thresholds['p90'],active_p99=thresholds['p99'],maximum=float(a.max()),
            activation_sum=float(a.sum(dtype=np.float64))),
            'interpretation':'Magnitude in original feature units, conditional on activation where labeled. Do not compare scales across SAE dictionaries as biological effect sizes.'}
        states.append(dict(row=row,bundle=b,private=private,a=a,thresholds=thresholds,
            samples=np.zeros(len(community),np.int64),mass=np.zeros(len(community)),
            bg=Counter(),act=Counter(),detail_bg=Counter(),detail_active=Counter(),
            tails={q:dict(events=0,mass=0.,environment=Counter(),kingdom=Counter(),study=Counter()) for q in thresholds}))
        print('Loaded',key,flush=True)
    del taxonomy
    offset=0;sample_bg=np.zeros(len(community),np.int64)
    for frame in pd.read_csv(SOURCE/'data/discovery_events.csv.gz',usecols=['community_index','otu_id'],chunksize=200000):
        ci=frame.community_index.to_numpy();end=offset+len(frame)
        assert community.iloc[ci].split.eq('discovery').all()
        sample_bg+=np.bincount(ci,minlength=len(community))
        domains=frame.otu_id.astype(str).map(kingdom).fillna('unknown::unknown').to_numpy()
        env=community.environment.to_numpy()[ci];study=community.project.astype(str).to_numpy()[ci]
        detail=community.environment_detail.fillna('unknown').astype(str).to_numpy()[ci]
        for s in states:
            a=s['a'][offset:end];active=a>0
            s['bg'].update(domains);s['act'].update(domains[active])
            s['detail_bg'].update(detail);s['detail_active'].update(detail[active])
            s['samples']+=np.bincount(ci[active],minlength=len(community))
            s['mass']+=np.bincount(ci,weights=a,minlength=len(community))
            for q,t in s['thresholds'].items():
                mask=active&(a>=t);tail=s['tails'][q]
                tail['events']+=int(mask.sum());tail['mass']+=float(a[mask].sum(dtype=np.float64))
                for name,values in [('environment',env),('kingdom',domains),('study',study)]:tail[name].update(values[mask])
        offset=end
    exported=[]
    for s in states:
        b=s['bundle'];r=s['row'];pop=b['core']['facts']['E.population']['value']
        assert offset==pop['events']
        for i,(category,events) in enumerate(s['bg'].most_common()):
            active=s['act'][category]
            b['core']['facts'][f'E.taxonomy.kingdom.{i}']=dict(value=dict(category=category,
                background_events=events,active_events=active,firing_rate=active/events,
                background_share=events/offset,active_share=active/pop['active_events'],
                enrichment=(active/pop['active_events'])/(events/offset)),
                interpretation='All source-prefixed domain/kingdom categories; same event population as other taxonomy records.')
        detailed=[]
        for category,active in s['detail_active'].most_common(20):
            bg=s['detail_bg'][category]
            detailed.append(dict(category=category,background_events=bg,active_events=active,
                background_share=bg/offset,active_share=active/pop['active_events'],firing_rate=active/bg,
                enrichment=(active/pop['active_events'])/(bg/offset)))
        b['analysis_results']['A.environment.detailed']=dict(value=dict(rows=detailed,
            population_events=offset,active_events=pop['active_events'],
            remaining_active_events=pop['active_events']-sum(x['active_events'] for x in detailed)),
            interpretation='Top 20 detailed public environment strings by active count, with full-population denominators. Multi-label strings remain exact categories, not independently inferred host labels.')
        for q,tail in s['tails'].items():
            n=tail['events'];b['analysis_results'][f'A.activation.tail_{q}']=dict(value=dict(
                threshold=s['thresholds'][q],rule='active and activation >= threshold; include ties',events=n,
                share_of_active_events=n/pop['active_events'],activation_mass=tail['mass'],
                **{name:distribution(tail[name],n) for name in ('environment','kingdom','study')}),
                interpretation='Descriptive strong-activation tail defined within this feature. Not the composition of all active events.')
        counts=s['samples'];mass=s['mass'];order=np.argsort(-counts,kind='stable')[:10]
        b['analysis_results']['A.sample.concentration']=dict(value=dict(
            background_communities=int((sample_bg>0).sum()),active_communities=int((counts>0).sum()),
            maximum_sample_active_share=float(counts.max()/counts.sum()),
            top10_sample_active_share=float(counts[order].sum()/counts.sum()),
            rows=[dict(sample_id=f'SAMPLE_{i:06d}',study=str(community.iloc[i].project),
                background_events=int(sample_bg[i]),active_events=int(counts[i]),firing_rate=float(counts[i]/sample_bg[i]),
                activation_mass=float(mass[i])) for i in order if counts[i]>0]),
            interpretation='Top 10 samples by active sampled-event count; sample IDs remain local aliases. Denominators are sampled OTUs, not the full input richness.')
        used=sorted({v for v in strings(b) if PUBLIC_STUDY.fullmatch(v)})
        assert set(used)<=set(s['private']['studies'])
        allowed=public_study_allowlist(s['private'],verified_public_studies,used)
        b['export_policy']=dict(public_study_accessions=allowed,
            source='Verified public MicrobeAtlas study accessions; host-side allowance covers public studies encountered in literature, not only selected feature rows',
            private_sample_identifiers_exposed=False)
        b['provenance'].update(repair_source_packet_sha256=r['packet_sha256'],
            repair_builder_sha256=sha(Path(__file__)),public_metadata_sha256=complete['metadata_sha256'],
            repair_scope='Discovery only. Existing statistics retained; no old model labels or reports imported.')
        folder=out/'packets'/r['key']
        save(folder/'bundle.json',b);save(folder/'private_identifiers.json',s['private'])
        exported.append(dict(key=r['key'],packet=str(folder/'bundle.json'),packet_sha256=sha(folder/'bundle.json'),
            previous_run=r['run'],public_studies=len(used),allowed_public_studies=len(allowed),feature_id=r['feature_id'],layer=r['layer']))
    save(out/'PREPARED.json',dict(features=exported,model_calls=0,events=offset,
        source_plan=str(plan_path),source_plan_sha256=sha(plan_path),builder_sha256=sha(Path(__file__)),
        full_panel_launched=False))
    print(json.dumps(dict(prepared=len(exported),events=offset,output=str(out))))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan',type=Path,required=True);parser.add_argument('--out',type=Path,required=True)
    parser.add_argument('--keys',nargs='+',default=DEFAULT_KEYS)
    args=parser.parse_args();build(args.plan,args.out,args.keys)
