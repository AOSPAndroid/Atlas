"""Local UI fixture; never executes WMI, PsTools or deploys software."""
import sys,tempfile,sqlite3,json,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from backend import main as m
import atlas_store as store
import uvicorn
with tempfile.TemporaryDirectory() as tmp:
 base=Path(tmp);db=base/'fixture.db';a=sqlite3.connect(m.MASTER_DB);b=sqlite3.connect(db);a.backup(b);a.close();b.close()
 m.MASTER_DB=m.DB=m.HISTORY_DB=store.DB=db
 m.REPO=base/'repo';m.REPO.mkdir();(m.REPO/'Example App').mkdir();(m.REPO/'Example App'/'setup_i.ps1').write_text('exit 0')
 m.identity=lambda:'LOCAL UI TEST'
 m.run=lambda *a,**k:type('Result',(),{'stdout':'TEST','stderr':'','returncode':0})()
 m.ps=lambda *a,**k:'True'
 import psexec_runner as px
 def fake_pstools(args,**options):
  assert args.count('-accepteula')==1,'The selected tool must receive EULA acceptance'
  script='import json; print("SIMULATED PSTOOLS LAUNCH"); print('+repr(json.dumps(args))+')'
  return subprocess.Popen([sys.executable,'-u','-c',script],**options)
 px.runner=px.Runner(popen=fake_pstools,preflight=lambda path:dict(exists=True,elevated=True,account='TEST\\Operator'))
 def fake_worker(j,p):
  m.emit(j,'Simulated installer reported exit code 0','complete',exit_code='0');m.history_update(j,state='complete',exit_code='0')
 m.deploy_worker=fake_worker
 uvicorn.run(m.app,host='127.0.0.1',port=8892,log_level='error')
