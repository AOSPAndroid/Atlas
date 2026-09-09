"""Build or refresh the shared database without replacing desk records/history."""
import argparse,json,sqlite3,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parent
TABLES=('users','user_aliases','machines','assignments')

def connect(path):
 c=sqlite3.connect(path,timeout=20,uri=True);c.row_factory=sqlite3.Row;return c

def merge_directory(target,source):
 src=connect(Path(source).resolve().as_uri()+'?mode=ro');dst=connect(target)
 try:
  dst.execute('begin immediate')
  for table in reversed(TABLES):dst.execute('delete from '+table)
  for table in TABLES:
   columns=[r[1] for r in src.execute('pragma table_info('+table+')')]
   known={r[1] for r in dst.execute('pragma table_info('+table+')')}
   if not set(columns)<=known:raise ValueError('Incompatible directory schema')
   sql='insert into '+table+'('+','.join(columns)+') values ('+','.join('?' for _ in columns)+')'
   dst.executemany(sql,[tuple(r) for r in src.execute('select * from '+table)])
  for k,v in src.execute('select key,value from metadata'):dst.execute('insert or replace into metadata values(?,?)',('directory.'+k,v))
  dst.commit()
 except:dst.rollback();raise
 finally:src.close();dst.close()

def atlas_schema(con):
 from package_catalog import SCHEMA
 con.execute(SCHEMA)
 con.execute('create table if not exists desk_user_links(desk_id text primary key,user_key text not null,method text not null,updated_at text not null)')
 con.execute('create table if not exists desk_deployments(job_id text primary key,desk_id text not null,user_key text,target text not null,desk_revision integer,created_at text not null)')
 con.execute('create index if not exists desk_deployments_desk on desk_deployments(desk_id)')
 con.execute('create table if not exists desk_link_history(seq integer primary key,desk_id text,at text,action text,before_key text,after_key text)')
 con.execute('create table if not exists atlas_imports(digest text primary key,at text not null)')

def build(target,master,history):
 import atlas_store
 target=Path(target)
 if target.exists():raise FileExistsError('Shared database already exists. Use --refresh-directory or --atlas-db.')
 src=sqlite3.connect(Path(master).resolve().as_uri()+'?mode=ro',uri=True);dest=sqlite3.connect(target)
 try:src.backup(dest)
 finally:src.close();dest.close()
 con=connect(target);old=connect(Path(history).resolve().as_uri()+'?mode=ro')
 try:
  schema=old.execute("select sql from sqlite_master where name='deployments'").fetchone()[0];con.execute(schema)
  rows=old.execute('select * from deployments').fetchall()
  if rows:con.executemany('insert into deployments values('+','.join('?' for _ in rows[0])+')',[tuple(r) for r in rows])
  atlas_schema(con);con.commit()
 finally:con.close();old.close()
 atlas_store.DB=target;atlas_store.initialize()

def import_atlas(target,source):
 import atlas_store,hashlib
 src=sqlite3.connect(Path(source).resolve().as_uri()+'?mode=ro',uri=True)
 try:
  if src.execute('pragma integrity_check').fetchone()[0]!='ok':raise ValueError('Atlas backup failed integrity check')
  rows=[json.loads(r[0]) for r in src.execute('select body from records')]
  if not rows or len(rows)>5000:raise ValueError('Invalid desk count')
  clean=[atlas_store.validate(r) for r in rows]
  if len({r['id'] for r in clean})!=len(clean):raise ValueError('Duplicate desk IDs')
  history=list(src.execute('select desk_id,at,action,before_json,after_json from history'))
  if len(history)>200000:raise ValueError('Atlas history too large')
  for row in history:
   if row[3]:json.loads(row[3])
   json.loads(row[4])
 finally:src.close()
 digest=hashlib.sha256(Path(source).read_bytes()).hexdigest()
 con=connect(target)
 try:
  con.execute('begin immediate');atlas_schema(con)
  if con.execute('select 1 from atlas_imports where digest=?',(digest,)).fetchone():return {'imported':0,'already_imported':True}
  for r in clean:
   old=atlas_store.get_record(con,r['id'])
   if old and (old['name']!=r['name'] or old['occupancy']!=r['occupancy'] or old['kind']!=r['kind']):
    link=con.execute('select user_key from desk_user_links where desk_id=?',(r['id'],)).fetchone()
    if link:
     from datetime import datetime,timezone
     con.execute('insert into desk_link_history(desk_id,at,action,before_key,after_key) values(?,?,?,?,?)',(r['id'],datetime.now(timezone.utc).isoformat(),'Atlas backup imported',link[0],None))
    con.execute('delete from desk_user_links where desk_id=?',(r['id'],))
   atlas_store.save_record(con,r,old,'import Atlas database')
  for row in history:
   exists=con.execute('select 1 from history where desk_id=? and at=? and action=? and before_json is ? and after_json=?',tuple(row)).fetchone()
   if not exists:con.execute('insert into history(desk_id,at,action,before_json,after_json) values(?,?,?,?,?)',tuple(row))
  from datetime import datetime,timezone
  con.execute('insert into atlas_imports values(?,?)',(digest,datetime.now(timezone.utc).isoformat()));con.commit()
  return {'imported':len(clean),'history_rows':len(history)}
 except:con.rollback();raise
 finally:con.close()

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--db',type=Path,default=ROOT/'office_atlas.db');p.add_argument('--master',type=Path);p.add_argument('--history',type=Path);p.add_argument('--atlas-db',type=Path);p.add_argument('--refresh-directory',type=Path);a=p.parse_args()
 if a.atlas_db:print(import_atlas(a.db,a.atlas_db))
 elif a.refresh_directory:merge_directory(a.db,a.refresh_directory);print('Directory refreshed; desks and deployment history preserved.')
 elif a.master and a.history:build(a.db,a.master,a.history);print('Shared database built.')
 else:p.error('Provide --master and --history, --atlas-db, or --refresh-directory')
