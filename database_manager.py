"""Local GUI for staged directory refreshes. Never edits deployment workers."""
import asyncio,json,sqlite3,tempfile,time,uuid,hashlib,zipfile,shutil
from pathlib import Path
from fastapi import Request,HTTPException
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool
from refresh_directory import prepare,apply_refresh,counts
from atlas_store import ClosingConnection

def fingerprint(path):
 with sqlite3.connect(path,factory=ClosingConnection) as c:
  h=hashlib.sha256()
  for t in ('users','machines','assignments','desk_user_links'):
   for row in c.execute('select * from '+t+' order by 1'):h.update(repr(row).encode())
  return h.hexdigest()

def compare(target,candidate):
 with sqlite3.connect(target,factory=ClosingConnection) as a,sqlite3.connect(candidate,factory=ClosingConnection) as b:
  result={}
  for table,key in [('users','canonical_key'),('machines','machine_name_norm')]:
   def read(c):
    cols=[x[1] for x in c.execute('pragma table_info('+table+')')];ki=cols.index(key)
    return {r[ki]:tuple(v for i,v in enumerate(r) if cols[i]!='id') for r in c.execute('select * from '+table)}
   old,new=read(a),read(b);added=sorted(new.keys()-old.keys());removed=sorted(old.keys()-new.keys());changed=sorted(k for k in old.keys()&new.keys() if old[k]!=new[k])
   result[table]={'before':len(old),'after':len(new),'added':len(added),'removed':len(removed),'changed':len(changed),'added_examples':added[:20],'removed_examples':removed[:20]}
  def links(c):return set(c.execute('select u.canonical_key,m.machine_name_norm,a.relationship_type from assignments a join users u on u.id=a.user_id_ref join machines m on m.id=a.machine_id'))
  old,new=links(a),links(b);result['relationships']={'before':len(old),'after':len(new),'added':len(new-old),'removed':len(old-new)}
  keys={r[0] for r in b.execute('select canonical_key from users')}
  result['missing_desk_accounts']=[{'desk':d,'account':k} for d,k in a.execute('select desk_id,user_key from desk_user_links') if k not in keys]
  result['warnings']=[f'{t}: more than 10% of existing records disappear.' for t in ('users','machines') if result[t]['removed']>result[t]['before']*.1]
  result['unlinked_machine_references']=b.execute("select count(*) from machines m where (trim(coalesce(assigned_to,''))<>'' or trim(coalesce(last_logon_user,''))<>'') and not exists(select 1 from assignments a where a.machine_id=m.id)").fetchone()[0]
  return result

def register_database_manager(app,wmi,check_token):
 from urllib.parse import unquote
 root=Path(__file__).parent;staged={};gate=asyncio.Lock()
 with sqlite3.connect(wmi.MASTER_DB,factory=ClosingConnection) as c:c.execute('create table if not exists directory_import_history(id text primary key,at text,source text,backup text,report text)')
 def busy():return any(j.get('state') not in ('complete','failed','cancelled') for pool in (wmi.jobs,wmi.queue_jobs) for j in list(pool.values()))
 def clean():
  for id,s in list(staged.items()):
   if time.time()-s['created']>3600:shutil.rmtree(s['folder'],ignore_errors=True);del staged[id]
 # Serialize mutations with imports so a new deployment cannot start between the job check and commit.
 @app.middleware('http')
 async def directory_mutation_gate(request,call_next):
  if request.method in ('POST','PUT','PATCH','DELETE'):
   async with gate:return await call_next(request)
  return await call_next(request)
 def stage(folder,source,candidate):
  clean()
  for s in staged.values():shutil.rmtree(s['folder'],ignore_errors=True)
  staged.clear();report=compare(wmi.MASTER_DB,candidate);id=uuid.uuid4().hex
  staged[id]={'folder':str(folder),'candidate':str(candidate),'source':source,'report':report,'fingerprint':fingerprint(wmi.MASTER_DB),'created':time.time()}
  return {'id':id,'source':source,'report':report,'expires_minutes':60}
 @app.get('/api/excel-templates/{kind}')
 def excel_template(kind:str):
  files={'seating-official':'users-and-desks-official-template.xlsx',
         'seating-previous':'users-and-desks-previous-template.xlsx',
         'directory':'users-and-computers-template.xlsx'}
  if kind not in files:raise HTTPException(404,'Choose a listed Excel template.')
  return FileResponse(root/'templates'/files[kind],filename=files[kind],media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
 @app.get('/manage-database')
 def manager_page():return FileResponse(root/'frontend/database.html')
 @app.get('/api/database/status')
 def status():
  with sqlite3.connect(wmi.MASTER_DB,factory=ClosingConnection) as c:
   c.row_factory=sqlite3.Row;history=[dict(r) for r in c.execute('select id,at,source,report from directory_import_history order by at desc limit 30')]
  return {'counts':counts(wmi.MASTER_DB),'busy':busy(),'history':history}
 @app.post('/api/database/preview')
 async def preview(request:Request):
  check_token(request)
  if busy():raise HTTPException(409,'Finish active jobs and queues before preparing an import.')
  folder=Path(tempfile.mkdtemp(prefix='atlas_directory_'));source=folder/'extract.xlsx';size=0
  try:
   with source.open('wb') as f:
    async for chunk in request.stream():
     size+=len(chunk)
     if size>50*1024*1024:raise ValueError('Excel file exceeds 50 MB.')
     f.write(chunk)
   with zipfile.ZipFile(source) as z:
    if sum(x.file_size for x in z.infolist())>512*1024*1024:raise ValueError('Expanded workbook exceeds 512 MB.')
   candidate=folder/'candidate.db'
   await run_in_threadpool(prepare,source,candidate)
   return await run_in_threadpool(stage,folder,Path(unquote(request.headers.get('x-file-name','extract.xlsx'))).name[:200],candidate)
  except Exception as e:
   shutil.rmtree(folder,ignore_errors=True)
   if isinstance(e,HTTPException):raise
   raise HTTPException(400,str(e) or 'Invalid workbook')
 @app.post('/api/database/restore-preview/{import_id}')
 def restore_preview(import_id:str,request:Request):
  check_token(request)
  if busy():raise HTTPException(409,'Finish active jobs and queues first.')
  with sqlite3.connect(wmi.MASTER_DB,factory=ClosingConnection) as c:r=c.execute('select backup from directory_import_history where id=?',(import_id,)).fetchone()
  if not r or not Path(r[0]).is_file():raise HTTPException(404,'Backup unavailable')
  folder=Path(tempfile.mkdtemp(prefix='atlas_restore_'));candidate=folder/'candidate.db'
  with sqlite3.connect(r[0],factory=ClosingConnection) as a,sqlite3.connect(candidate,factory=ClosingConnection) as b:a.backup(b)
  return stage(folder,'Restore directory from '+Path(r[0]).name,candidate)
 @app.delete('/api/database/preview/{stage_id}')
 def discard(stage_id:str,request:Request):
  check_token(request);s=staged.pop(stage_id,None)
  if s:shutil.rmtree(s['folder'],ignore_errors=True)
  return {'ok':True}
 @app.post('/api/database/apply/{stage_id}')
 def apply(stage_id:str,body:dict,request:Request):
  check_token(request);clean();s=staged.get(stage_id)
  if not s:raise HTTPException(409,'Preview expired or was replaced. Validate the file again.')
  if body.get('confirmation')!='APPLY' or body.get('full_snapshot') is not True:raise HTTPException(400,'Confirm a complete Europe snapshot and type APPLY.')
  if busy():raise HTTPException(409,'Active jobs or queues must finish first.')
  if fingerprint(wmi.MASTER_DB)!=s['fingerprint']:raise HTTPException(409,'Directory or account links changed. Prepare a fresh preview.')
  backup=apply_refresh(wmi.MASTER_DB,s['candidate'],root/'backups')
  from datetime import datetime,timezone
  at=datetime.now(timezone.utc).isoformat()
  with sqlite3.connect(wmi.MASTER_DB,factory=ClosingConnection) as c:
   c.execute('insert into directory_import_history values(?,?,?,?,?)',(uuid.uuid4().hex,at,s['source'],str(backup),json.dumps(s['report'])))
   c.execute('insert or replace into metadata values(?,?)',('directory.created_at',at))
  del staged[stage_id];shutil.rmtree(s['folder'],ignore_errors=True)
  return {'ok':True,'backup':backup.name,'counts':counts(wmi.MASTER_DB)}

 from desk_moves import register_desk_moves
 register_desk_moves(app,wmi,check_token,busy)

 from seating_excel import register_seating_excel
 register_seating_excel(app,wmi,check_token,busy)
