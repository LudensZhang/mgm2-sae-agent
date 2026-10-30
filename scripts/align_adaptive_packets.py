"""Prelaunch-only alignment to exact repaired five-stage inputs; preserve originals."""
import copy
from pathlib import Path
from repair_packets import read,save,sha

ROOT=Path(__file__).resolve().parents[1]
HERE=ROOT/'runs/adaptive_pilot_20261030'
if (HERE/'LAUNCH.json').exists():raise RuntimeError('Cannot alter a launched experiment')
prepared=read(HERE/'PREPARED.json')
for row in prepared['features']:
    new=read(ROOT/row['packet'])
    baseline=ROOT/'runs/evidence_repair_20261030/packets'/row['key']/'bundle.json'
    if baseline.exists():
        aligned=read(baseline)
        aligned['export_policy']=new['export_policy']
        aligned['provenance']['paired_input_source_sha256']=sha(baseline)
        row['input_alignment']='Exact prior repaired scientific evidence; host-side public-accession allowlist updated only'
    else:
        aligned=copy.deepcopy(new)
        # Keyword ties originated in a set; stabilize the already exported view.
        # No alteration of counts or population, and no claim of a paired baseline.
        for key,record in aligned['analysis_results'].items():
            if key.startswith('A.study_metadata.'):
                for field in ('environment_detail','technology','institution','keywords'):
                    record['value'][field]['rows'].sort(key=lambda r:(-r['count'],r['category']))
        row['input_alignment']='New repaired packet; existing selected metadata categories retained and ties sorted'
    folder=HERE/'aligned_packets'/row['key']
    save(folder/'bundle.json',aligned)
    save(folder/'private_identifiers.json',read((ROOT/row['packet']).with_name('private_identifiers.json')))
    row['packet']=str(folder/'bundle.json');row['packet_sha256']=sha(folder/'bundle.json')
prepared['alignment_note']='No model calls preceded this correction. Original packets and preflight plan retained.'
save(HERE/'PREPARED_ALIGNED.json',prepared)
for name in ('PLAN.json','AUTHORIZATION.json'):
    p=HERE/name
    if p.exists():p.rename(HERE/(name.removesuffix('.json')+'.preflight_only.json'))
print('Aligned packets saved; original preflight-only plan archived')
