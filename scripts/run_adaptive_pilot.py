"""Explicitly authorized four-feature adaptive pilot, two workers, no retries."""
import argparse
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import signal
import subprocess
import sys
import time
import os

ROOT=Path(__file__).resolve().parents[1]
HERE=ROOT/'runs/adaptive_pilot_20261030'
NODE=Path('/home/zhanghaohong/anaconda3/envs/claude-code/bin/node')
KEYS={'l8_f4081','l7_f3705','l4_f3457','l4_f3723'}
CODE=['package.json',*sorted(str(p.relative_to(ROOT)) for p in (ROOT/'src').glob('*.mjs')),
      'skills/sae-interpretation/SKILL.md','skills/source-grounding/SKILL.md']

def read(p):return json.loads(p.read_text())
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def now():return datetime.now(timezone.utc).isoformat()
def save(p,x):
    tmp=p.with_suffix('.tmp');tmp.write_text(json.dumps(x,indent=2)+'\n');tmp.replace(p)

def prepare():
    if (HERE/'PLAN.json').exists():raise RuntimeError('Already frozen')
    prepared=read(HERE/'PREPARED_ALIGNED.json');rows=prepared['features']
    assert {r['key'] for r in rows}==KEYS and len(rows)==4
    for r in rows:
        r['packet']=str((ROOT/r['packet']).resolve())
        r['private_manifest_sha256']=sha(Path(r['packet']).with_name('private_identifiers.json'))
        old=ROOT/'runs/evidence_repair_20261030/pilot_runs'/r['key']
        if (old/'interpretation.json').exists():r['baseline_run']=str(old);r['baseline']='repaired_five_stage'
        else:r['baseline_run']=r['previous_run'];r['baseline']='historical_unrepaired_not_matched_evidence'
    save(HERE/'PLAN.json',dict(features=rows,created_utc=now(),model='gpt-6.1-sol',thinking='high',
        workflow='adaptive',concurrency=2,max_requests=160,automatic_retries=0,
        source_cache='Empty at launch; only originals fetched in this panel are shared. No prior feature reports or labels.',
        code_hashes={f:sha(ROOT/f) for f in CODE},driver_sha256=sha(Path(__file__)),
        full_panel_launched=False))
    save(HERE/'AUTHORIZATION.json',dict(approved=True,answer='授权这 4 个新版案例',recorded_utc=now(),
        scope='Four listed features only, Pi gpt-6.1-sol/high via OpenAI, two concurrent workers, at most 160 requests, public-source research as needed, repaired discovery statistics and verified public metadata, no private sample IDs, no other models, no full panel, no automatic failed-run retries'))
    validate();print('Four-case adaptive pilot frozen; zero model calls')

def validate():
    p=read(HERE/'PLAN.json')
    assert {r['key'] for r in p['features']}==KEYS and len(p['features'])==4
    assert p['code_hashes']=={f:sha(ROOT/f) for f in CODE}
    assert p['driver_sha256']==sha(Path(__file__))
    assert p['model']=='gpt-6.1-sol' and p['thinking']=='high' and p['max_requests']==160
    assert read(HERE/'AUTHORIZATION.json')['approved']
    for r in p['features']:
        assert sha(Path(r['packet']))==r['packet_sha256']
        assert sha(Path(r['packet']).with_name('private_identifiers.json'))==r['private_manifest_sha256']
    return p

def execute(row):
    validate();folder=HERE/'pilot_runs'/row['key'];log=HERE/'logs'/f"{row['key']}.log"
    log.parent.mkdir(exist_ok=True)
    args=[str(NODE),str(ROOT/'src/cli.mjs'),'--workflow','adaptive','--model','gpt-6.1-sol',
          '--packet',row['packet'],'--out',str(folder),'--source-cache',str(HERE/'source_cache'),'--live','--web']
    start=time.monotonic()
    with log.open('x') as f:
        process=subprocess.Popen(args,cwd=ROOT,stdout=f,stderr=subprocess.STDOUT,start_new_session=True)
        try:code=process.wait(timeout=1020)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid,signal.SIGTERM)
            try:process.wait(timeout=10)
            except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL);process.wait()
            code=-signal.SIGTERM
    result=dict(key=row['key'],exit_code=code,seconds=time.monotonic()-start,run=str(folder))
    if (folder/'completion.json').exists():
        c=read(folder/'completion.json');result.update(status=c['status'],error=c.get('error'),
            usage=c.get('usage_total'),audit=c.get('internal_audit_verdict'),sessions=c.get('sessions'),
            research_requests=c.get('research_requests'),revisions=c.get('revisions'))
    else:result.update(status='failed_before_completion',error='Missing completion record')
    return result

def run():
    plan=validate()
    with (HERE/'STARTED.json').open('x') as f:json.dump(dict(started_utc=now()),f)
    results=[];pending=list(plan['features']);active={};stop_reason=None
    def snapshot():save(HERE/'status.json',dict(planned=4,terminal=len(results),updated_utc=now(),
        active=sorted(r['key'] for r in active.values()),pending=[r['key'] for r in pending],results=results,stop_reason=stop_reason))
    with ThreadPoolExecutor(max_workers=2) as pool:
        while pending or active:
            while pending and len(active)<2 and not stop_reason:
                row=pending.pop(0);active[pool.submit(execute,row)]=row
            snapshot()
            if not active:break
            done,_=wait(active,return_when=FIRST_COMPLETED)
            for future in done:
                row=active.pop(future)
                try:r=future.result()
                except Exception as e:r=dict(key=row['key'],status='driver_error',error=str(e))
                results.append(r);error=(r.get('error') or '').lower()
                if any(s in error for s in ('quota','usage limit','rate limit','429','401','403','authentication','credential','connection','fetch failed','econn')):
                    stop_reason='Provider/quota/authentication/network failure; no further dispatch'
                print(json.dumps({k:v for k,v in r.items() if k!='usage'}),flush=True)
            snapshot()
    save(HERE/'TERMINAL.json',dict(finished_utc=now(),results=results,pending=[r['key'] for r in pending],
        stop_reason=stop_reason,full_panel_launched=False,all_complete=len(results)==4 and all(r['status']=='complete' for r in results)))

def launch():
    validate()
    if (HERE/'LAUNCH.json').exists() or (HERE/'STARTED.json').exists():raise RuntimeError('Already launched')
    cache=HERE/'source_cache'
    if cache.exists() and any(cache.iterdir()):raise RuntimeError('Pilot cache must start empty')
    with (HERE/'coordinator.log').open('x') as f:
        p=subprocess.Popen([sys.executable,'-u','-B',str(Path(__file__).resolve()),'run'],cwd=ROOT,
            stdout=f,stderr=subprocess.STDOUT,stdin=subprocess.DEVNULL,start_new_session=True)
    save(HERE/'LAUNCH.json',dict(pid=p.pid,created_utc=now()))
    for _ in range(100):
        if (HERE/'STARTED.json').exists():print(json.dumps(dict(pid=p.pid,started=True,pilots=4,concurrency=2)));return
        if p.poll() is not None:raise RuntimeError('Coordinator exited; inspect logs')
        time.sleep(.1)
    raise RuntimeError('Inspect startup receipt before retry')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('action',choices=['prepare','launch','run'])
    {'prepare':prepare,'launch':launch,'run':run}[parser.parse_args().action]()
