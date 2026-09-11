"""Refresh the Europe-wide directory; preserve Paris seating and operational state."""
import argparse,sqlite3,tempfile,sys
from datetime import datetime
from pathlib import Path
from directory_workbook import build,workbook_parts,iter_rows,canonical_header,rowdict,norm,workbook_scope
from merge_data import merge_directory
from atlas_store import ClosingConnection
ROOT=Path(__file__).resolve().parent

def counts(path):
 with sqlite3.connect(Path(path).resolve().as_uri()+'?mode=ro',uri=True,factory=ClosingConnection) as c:
  return {t:c.execute('select count(*) from '+t).fetchone()[0] for t in ('users','machines','assignments')}

@workbook_scope
def prepare(source,candidate):
 source=Path(source)
 if not source.is_file():raise ValueError('Extract file not found: '+str(source))
 parts={('Users' if n.casefold()=='users' else 'computers' if n.casefold()=='computers' else n):v for n,v in workbook_parts(source)}
 if not {'Users','computers'}<=parts.keys():raise ValueError('Keep the Users and computers worksheet names from the existing export.')
 _,header=next(iter_rows(source,parts['computers']))
 if 'name' not in {canonical_header(h) for h in header}:raise ValueError('computers worksheet must contain the name column.')
 # Reject duplicate primary identities instead of silently overwriting them.
 for sheet,identity in [('Users','user_name'),('computers','name')]:
  it=iter_rows(source,parts[sheet]);_,header=next(it);headers=[canonical_header(h) for h in header];seen=set()
  for _,row in it:
   d=rowdict(headers,row)
   value=norm(d.get(identity) or d.get('user_id') or d.get('email') or d.get('full_name') or (d.get('name') if sheet=='Users' else ''))
   if value and value in seen:raise ValueError(f'{sheet}: duplicate identity {value}. Remove duplicate rows and validate again.')
   if value:seen.add(value)
 build(source,candidate);result=counts(candidate)
 if not result['users'] or not result['machines']:raise ValueError('Empty user or machine extract refused. The live database was not changed.')
 return result

def apply_refresh(target,candidate,backup_folder):
 target=Path(target);backup_folder=Path(backup_folder);backup_folder.mkdir(parents=True,exist_ok=True)
 backup=backup_folder/('office_atlas_before_directory_'+datetime.now().strftime('%Y%m%d_%H%M%S_%f')+'.db')
 src=sqlite3.connect(target.resolve().as_uri()+'?mode=ro',uri=True,factory=ClosingConnection);dst=sqlite3.connect(backup,factory=ClosingConnection)
 try:src.backup(dst)
 finally:src.close();dst.close()
 merge_directory(target,candidate);return backup

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source',type=Path,default=ROOT/'database040926.xlsx');p.add_argument('--check-only',action='store_true');args=p.parse_args()
 from runtime_paths import database_path
 target=database_path()
 with tempfile.TemporaryDirectory() as tmp:
  candidate=Path(tmp)/'directory.db';new=prepare(args.source,candidate);old=counts(target)
  print('\nEUROPE DIRECTORY REFRESH — full snapshot replacement, not an incremental import')
  print('Source:',args.source.resolve())
  for k in old:print(f'{k}: {old[k]:,} -> {new[k]:,} ({new[k]-old[k]:+,})')
  print('Paris desks, equipment, confirmed links, seating history, package catalogue and deployment history are preserved.')
  print('Accounts absent from this extract disappear from directory search; their desk links are retained for review.')
  if args.check_only:return
  if input('Have all active jobs finished, and is this the complete Europe extract? Type APPLY to continue: ').strip()!='APPLY':
   print('Cancelled. The shared database was not changed.');return
  backup=apply_refresh(target,candidate,ROOT/'backups')
  print('Directory refreshed. Backup:',backup);print('Run Start-Office-Atlas.bat, then Review mappings to check missing links.')
if __name__=='__main__':
 try:main()
 except (ValueError,OSError,sqlite3.Error,KeyError,StopIteration) as error:
  print('Refresh failed:',error or 'Required worksheet data is missing');sys.exit(1)
