"""Four explicitly authorized repaired-packet pilots; no full-panel dispatch."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

ROOT=Path(__file__).resolve().parents[1]
HERE=ROOT/'runs/evidence_repair_20261030'
NODE=Path('/home/zhanghaohong/anaconda3/envs/claude-code/bin/node')
KEYS={'l7_f3705','l8_f4081','l9_f3883','l4_f1506'}
CODE=['package.json',*[f'src/{x}.mjs' for x in ('core','runner','cli','runtime','profiles','prompts','evidence_views','web')],
      'skills/sae-interpretation/SKILL.md','skills/source-grounding/SKILL.md']

def read(path):
    with path.open() as f:return json.load(f)

def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def now():return datetime.now(timezone.utc).isoformat()
def save(path,value):
    tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(value,indent=2)+'\n');tmp.replace(path)

def validate():
    p=read(HERE/'PILOT_PLAN.json')
    assert {r['key'] for r in p['features']}==KEYS and len(p['features'])==4
    assert p['model']=='gpt-6.1-sol' and p['thinking']=='high'
    assert p['code_hashes']=={f:sha(ROOT/f) for f in CODE}
    assert p['driver_sha256']==sha(Path(__file__))
    for r in p['features']:assert sha(Path(r['packet']))==r['packet_sha256']
    assert read(HERE/'AUTHORIZATION.json')['approved']
    return p

def prepare():
    if (HERE/'PILOT_PLAN.json').exists():raise RuntimeError('Plan already frozen')
    p=read(HERE/'PREPARED.json')
    save(HERE/'PILOT_PLAN.json',dict(features=p['features'],created_utc=now(),
        model='gpt-6.1-sol',thinking='high',concurrency=4,max_requests=160,
        automatic_retries=0,full_panel_launched=False,
        code_hashes={f:sha(ROOT/f) for f in CODE},driver_sha256=sha(Path(__file__))))
    validate();print('Four-case repaired pilot frozen; no provider calls')

def execute(row):
    validate()
    folder=HERE/'pilot_runs'/row['key'];log=HERE/'logs'/f"{row['key']}.log"
    log.parent.mkdir(exist_ok=True)
    args=[str(NODE),str(ROOT/'src/cli.mjs'),'--model','gpt-6.1-sol',
          '--packet',row['packet'],'--out',str(folder),'--live','--web']
    start=time.monotonic()
    with log.open('x') as f:
        process=subprocess.Popen(args,cwd=ROOT,stdout=f,stderr=subprocess.STDOUT,start_new_session=True)
        try:code=process.wait(timeout=1020)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid,signal.SIGTERM)
            try:process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid,signal.SIGKILL);process.wait()
            code=-signal.SIGTERM
    result=dict(key=row['key'],exit_code=code,seconds=time.monotonic()-start,run=str(folder))
    if (folder/'completion.json').exists():
        c=read(folder/'completion.json');result.update(status=c['status'],error=c.get('error'),
            usage=c.get('usage_total'),audit=c.get('internal_audit_verdict'))
    else:result.update(status='failed_before_completion',error='Missing completion record')
    return result

def run():
    plan=validate()
    with (HERE/'STARTED.json').open('x') as f:json.dump(dict(started_utc=now()),f)
    results=[]
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures={pool.submit(execute,row):row for row in plan['features']}
        save(HERE/'status.json',dict(planned=4,terminal=0,active=sorted(KEYS),results=[]))
        for future in as_completed(futures):
            row=futures[future]
            try:result=future.result()
            except Exception as e:result=dict(key=row['key'],status='driver_error',error=str(e))
            results.append(result)
            save(HERE/'status.json',dict(planned=4,terminal=len(results),updated_utc=now(),
                active=sorted(KEYS-{r['key'] for r in results}),results=results))
            print(json.dumps({k:v for k,v in result.items() if k!='usage'}),flush=True)
    save(HERE/'PILOT_TERMINAL.json',dict(finished_utc=now(),results=results,
        full_panel_launched=False,all_complete=all(r['status']=='complete' for r in results)))

def launch():
    validate()
    if (HERE/'LAUNCH.json').exists() or (HERE/'STARTED.json').exists():raise RuntimeError('Already launched')
    with (HERE/'coordinator.log').open('x') as f:
        p=subprocess.Popen([sys.executable,'-u','-B',str(Path(__file__).resolve()),'run'],
            stdout=f,stderr=subprocess.STDOUT,stdin=subprocess.DEVNULL,start_new_session=True)
    save(HERE/'LAUNCH.json',dict(pid=p.pid,created_utc=now(),plan_sha256=sha(HERE/'PILOT_PLAN.json')))
    for _ in range(200):
        if (HERE/'STARTED.json').exists():print(json.dumps(dict(pid=p.pid,started=True,pilots=4)));return
        if p.poll() is not None:raise RuntimeError('Coordinator exited; inspect log')
        time.sleep(.1)
    raise RuntimeError('Check startup receipt before retry')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['prepare','launch','run'])
    {'prepare':prepare,'launch':launch,'run':run}[parser.parse_args().action]()
