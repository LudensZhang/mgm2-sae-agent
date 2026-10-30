"""One separately authorized retry of L9/f3883 after a public-study false block.

Scientific evidence and runtime stay identical. Expand only the host-side public
study allowlist using the hashed public metadata, without exporting that list to
the model. No automatic retry or full-panel dispatch.
"""
import argparse
import copy
import csv
import json
from pathlib import Path
import subprocess
import sys
import time

from repair_packets import METADATA, PUBLIC_STUDY, read, save, sha
from run_repair_pilot import ROOT, HERE, NODE, CODE, now

DEST=HERE/'public_study_retry_01'


def prepare():
    source=HERE/'packets/l9_f3883/bundle.json'
    b=read(source);private=read(source.with_name('private_identifiers.json'))
    assert sha(METADATA)==b['provenance']['public_metadata_sha256']
    csv.field_size_limit(10**7)
    with METADATA.open() as stream:
        public={r['Project'] for r in csv.DictReader(stream,delimiter='\t') if PUBLIC_STUDY.fullmatch(r.get('Project',''))}
    allowed=sorted(set(private['studies']) & public)
    assert set(b['export_policy']['public_study_accessions'])<=set(allowed)
    assert 'ERP022166' in allowed
    repaired=copy.deepcopy(b)
    repaired['export_policy']['public_study_accessions']=allowed
    repaired['export_policy']['source']='Verified public metadata accessions; host-side allowlist includes studies that may recur in literature, not only this feature packet'
    unchanged=lambda x:{k:v for k,v in x.items() if k!='export_policy'}
    assert unchanged(b)==unchanged(repaired)
    save(DEST/'packet/bundle.json',repaired)
    save(DEST/'packet/private_identifiers.json',private)
    save(DEST/'PLAN.json',dict(key='l9_f3883',created_utc=now(),model='gpt-6.1-sol',thinking='high',
        max_attempts=1,full_panel_launched=False,scientific_evidence_unchanged=True,
        source_packet_sha256=sha(source),packet_sha256=sha(DEST/'packet/bundle.json'),
        private_manifest_sha256=sha(DEST/'packet/private_identifiers.json'),
        driver_sha256=sha(Path(__file__)),code_hashes={f:sha(ROOT/f) for f in CODE},
        verified_public_accessions=len(allowed),metadata_sha256=sha(METADATA)))
    save(DEST/'AUTHORIZATION.json',dict(approved=True,answer='允许重试这 1 个',
        scope='One additional L9/f3883 full five-role run using Pi gpt-6.1-sol/high via OpenAI; unchanged scientific evidence; public-study allowance repair; preserve failed run; no other features',
        recorded_utc=now()))
    print(json.dumps(dict(prepared=True,public_studies=len(allowed),model_calls=0)))


def validate():
    p=read(DEST/'PLAN.json')
    assert p['code_hashes']=={f:sha(ROOT/f) for f in CODE}
    assert p['driver_sha256']==sha(Path(__file__))
    assert p['packet_sha256']==sha(DEST/'packet/bundle.json')
    assert p['private_manifest_sha256']==sha(DEST/'packet/private_identifiers.json')
    assert read(DEST/'AUTHORIZATION.json')['approved']


def run():
    validate();save(DEST/'STARTED.json',dict(started_utc=now()))
    start=time.monotonic()
    # GNU timeout also bounds a stalled plugin after the feature's own time limit.
    result=subprocess.run(['timeout','--signal=TERM','--kill-after=10','1020',str(NODE),
        str(ROOT/'src/cli.mjs'),'--model','gpt-6.1-sol','--packet',str(DEST/'packet/bundle.json'),
        '--out',str(DEST/'run'),'--live','--web'],cwd=ROOT)
    save(DEST/'TERMINAL.json',dict(exit_code=result.returncode,seconds=time.monotonic()-start,
        finished_utc=now(),full_panel_launched=False))


def launch():
    validate()
    if (DEST/'LAUNCH.json').exists() or (DEST/'STARTED.json').exists():raise RuntimeError('Already launched')
    with (DEST/'coordinator.log').open('x') as f:
        p=subprocess.Popen([sys.executable,'-u','-B',str(Path(__file__).resolve()),'run'],
            cwd=ROOT,stdout=f,stderr=subprocess.STDOUT,stdin=subprocess.DEVNULL,start_new_session=True)
    save(DEST/'LAUNCH.json',dict(pid=p.pid,created_utc=now()))
    for _ in range(100):
        if (DEST/'STARTED.json').exists():print(json.dumps(dict(pid=p.pid,started=True)));return
        if p.poll() is not None:raise RuntimeError('Coordinator exited')
        time.sleep(.1)
    raise RuntimeError('Inspect startup receipt before retry')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['prepare','launch','run'])
    {'prepare':prepare,'launch':launch,'run':run}[parser.parse_args().action]()
