"""Local UI fixture; never executes WMI or deploys software."""
import sys,tempfile,sqlite3,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from backend import main as m
import atlas_store as store
import uvicorn
with tempfile.TemporaryDirectory() as tmp:
 base=Path(tmp);db=base/'fixture.db';a=sqlite3.connect(m.MASTER_DB);b=sqlite3.connect(db);a.backup(b);a.close();b.close()
 m.MASTER_DB=m.DB=m.DAAS_DB=m.HISTORY_DB=store.DB=db
 m.REPO=base/'repo';m.REPO.mkdir();(m.REPO/'Example App').mkdir();(m.REPO/'Example App'/'setup_i.ps1').write_text('exit 0')
 m.identity=lambda:'LOCAL UI TEST'
 m.run=lambda *a,**k:type('Result',(),{'stdout':'TEST','stderr':'','returncode':0})()
 m.ps=lambda *a,**k:'True'
 def fake_worker(j,p):
  m.emit(j,'Simulated installer reported exit code 0','complete',exit_code='0');m.history_update(j,state='complete',exit_code='0')
 m.deploy_worker=fake_worker
 uvicorn.run(m.app,host='127.0.0.1',port=8892,log_level='error')
