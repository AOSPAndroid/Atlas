"""No remote Windows commands are executed by this suite."""
import base64,importlib.util,json,sqlite3,sys,tempfile,unittest,uuid
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from backend import main as app
from fastapi.testclient import TestClient
from identity_links import build_index,candidates,rebuild_links

class Regression(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.tmp=tempfile.TemporaryDirectory();cls.base=Path(cls.tmp.name)
  cls.original_history=app.HISTORY_DB;cls.original_repo=app.REPO
  app.HISTORY_DB=cls.base/'history.db';app.REPO=cls.base/'repo';app.REPO.mkdir()
  cls.pkg=app.REPO/'Example';cls.pkg.mkdir();(cls.pkg/'setup_i.ps1').write_text('exit 0')
  cls.identity=patch.object(app,'identity',return_value='TEST OPERATOR');cls.identity.start()
  cls.client=TestClient(app.app,base_url='http://127.0.0.1',client=('127.0.0.1',12345))
  with app.master_db() as c:
   cls.user=dict(c.execute("select * from users where user_id<>'' and email<>'' and id in (select user_id_ref from assignments) limit 1").fetchone())
   cls.machine=c.execute('select machine_name from machines where id in (select machine_id from assignments) limit 1').fetchone()[0]
 @classmethod
 def tearDownClass(cls):
  cls.client.close();cls.identity.stop();app.HISTORY_DB=cls.original_history;app.REPO=cls.original_repo;cls.tmp.cleanup()
 def test_repository_listing_and_unavailable(self):
  response=self.client.get('/api/packages',params={'term':'example'}).json()
  self.assertEqual(response['packages'],['Example']);self.assertTrue(response['available'])
  for name,action in [('remove_u.vbs','Uninstall'),('fix_r.ps1','Repair')]:
   path=self.pkg/name;path.write_text('test')
   try:self.assertIn(name,self.client.get('/api/scripts',params={'package':'Example','action':action}).json()['scripts'])
   finally:path.unlink()
  with patch.object(app,'REPO',self.base/'missing'):
   response=self.client.get('/api/packages').json();self.assertFalse(response['available']);self.assertIn('error',response)
  with patch.object(Path,'iterdir',side_effect=PermissionError('denied')):
   response=self.client.get('/api/packages').json();self.assertFalse(response['available']);self.assertEqual(response['packages'],[])
 def test_lookup_id_email_name_employee_domain(self):
  for term in [self.user['user_id'],self.user['email'],self.user['full_name'],self.user['employee_number'],'TEST\\'+self.user['user_id']]:
   with self.subTest(kind='identity'):
    r=self.client.get('/api/search',params={'term':term});self.assertEqual(r.status_code,200)
    self.assertIn(self.user['id'],[u['id'] for u in r.json()['users']])
 def test_user_machine_links(self):
  r=self.client.get('/api/user/id:'+str(self.user['id']));self.assertEqual(r.status_code,200);self.assertTrue(r.json()['machines'])
 def test_partial_and_literal_search(self):
  self.assertTrue(self.client.get('/api/search',params={'term':self.user['full_name'][:4]}).json()['users'])
  for q in ['','%','not-present-unique-938291']:
   r=self.client.get('/api/search',params={'term':q});self.assertEqual(r.status_code,200);self.assertFalse(r.json()['users'])
 def test_daas_reverse_master_routes(self):
  from urllib.parse import quote
  paths=['/api/health','/api/master/status','/api/daas/status','/api/database-freshness','/api/master/resolve/'+quote(self.user['user_id']),'/api/master/resolve/'+quote(self.machine),'/api/daas/user/'+quote(self.user['email']),'/api/daas/machine/'+quote(self.machine),'/api/v2814/reverse/'+quote(self.machine)]
  for path in paths:
   r=self.client.get(path);self.assertEqual(r.status_code,200);self.assertNotIn('error',r.json())
  r=self.client.post('/api/daas/machines',json={'computers':[self.machine]});self.assertEqual(r.status_code,200)
 def test_identity_ambiguity_never_guessed(self):
  c=sqlite3.connect(':memory:')
  c.executescript('create table users(id,user_id,email,employee_number,full_name);create table user_aliases(user_id_ref,alias_norm,alias_type);')
  c.executemany('insert into users values(?,?,?,?,?)',[(1,'one','one@test','E1','Same Name'),(2,'two','two@test','E2','Same Name')])
  index=build_index(c);self.assertEqual(candidates(index,'Same Name'),{1,2});self.assertEqual(candidates(index,'DOMAIN\\one'),{1});self.assertEqual(candidates(index,'one@test'),{1});self.assertFalse(candidates(index,'one@other'))
  c.close()
 def test_history_round_trip(self):
  j=uuid.uuid4().hex;app.history_create(j,'TESTPC','Example','Install','setup_i.ps1','full');app.history_update(j,state='failed',exit_code='1603')
  rows=app.history();self.assertTrue(any(x['id']==j and x['exit_code']=='1603' for x in rows))
 def test_deployment_validation(self):
  for folder,script in [('../outside','setup_i.ps1'),('Example','../setup_i.ps1'),('Example','setup_u.ps1'),('Example','missing_i.ps1')]:
   r=self.client.post('/api/deploy',json={'computer':'TESTPC','folder':folder,'script':script});self.assertEqual(r.status_code,400)
  self.assertEqual(self.client.post('/api/bulk/deploy',json={'computers':[],'folder':'Example','script':'setup_i.ps1'}).status_code,422)
  self.assertEqual(self.client.get('/api/job/not-found').status_code,404)
 def test_local_origin_boundaries(self):
  self.assertEqual(self.client.post('/api/deploy',headers={'Origin':'https://other.example'},json={}).status_code,403)
  self.assertEqual(self.client.get('/api/history',headers={'Host':'other.example'}).status_code,403)
 def test_browser_revalidates_pages_and_scripts(self):
  for path in ['/installer','/','/assets/console-directory.js','/assets/shared-ui.js','/assets/ui-tokens.css','/command-palette.js','/map-cursor.js']:
   with self.subTest(path=path):
    response=self.client.get(path);self.assertEqual(response.status_code,200)
    self.assertEqual(response.headers.get('cache-control'),'no-cache')
  script=self.client.get('/assets/console-directory.js')
  cached=self.client.get('/assets/console-directory.js',headers={'If-None-Match':script.headers['etag']})
  self.assertEqual(cached.status_code,304);self.assertEqual(cached.headers.get('cache-control'),'no-cache')
  self.assertNotIn('renderDaaSUser',script.text)
  response=self.client.get('/api/user/id:'+str(self.user['id']))
  self.assertEqual(response.status_code,200);self.assertEqual(response.headers.get('cache-control'),'no-store')
  # A new URL escapes previously cached scripts; an unchanged file keeps its URL.
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);(root/'assets').mkdir();script=root/'assets'/'test.js';script.write_text('old script')
   (root/'index.html').write_text('<script src="/assets/test.js"></script>')
   with patch.object(app,'WEB',root):
    old=self.client.get('/installer').text
    self.assertIn('/assets/test.js?v=',old);self.assertEqual(self.client.get('/installer').text,old)
    script.write_text('new script');stat=script.stat()
    app.os.utime(script,ns=(stat.st_atime_ns,stat.st_mtime_ns+1000000))
    self.assertNotEqual(self.client.get('/installer').text,old)
 def test_outcomes_and_remote_failure(self):
  for code,expected in [('0','complete'),('3010','complete'),('1641','complete'),('1603','failed'),('not written','failed')]:
   j=uuid.uuid4().hex;app.jobs[j]={'state':'queued','events':[]};app.history_create(j,'TESTPC','Example','Install','setup_i.ps1','full')
   p=app.Deploy(computer='TESTPC',folder='Example',script='setup_i.ps1')
   with patch.object(app.os.path,'isdir',return_value=True),patch.object(app,'copy_pkg',return_value=1),patch.object(app,'launch',return_value=(123,'log','exit')),patch.object(app,'monitor',return_value=(code,[])):
    app.deploy_worker(j,p)
   self.assertEqual(app.jobs[j]['state'],expected)
 def test_wmi_error_not_process_exit(self):
  with patch.object(app,'ps',side_effect=RuntimeError('WMI unreachable')):
   with self.assertRaises(RuntimeError):app.wmi_running('TESTPC',123)
 def test_unique_encoded_remote_commands(self):
  commands=[]
  with patch.object(app,'wmi_create',side_effect=lambda pc,cmd:commands.append(cmd) or 12):
   a=app.launch('TESTPC',r'C:\Temp\Packages\Example\setup_i.ps1','Example');b=app.launch('TESTPC',r'C:\Temp\Packages\Example\setup_i.ps1','Example')
  self.assertNotEqual(a[1:],b[1:]);text=base64.b64decode(commands[0].split()[-1]).decode('utf-16le');self.assertIn('finally',text);self.assertIn('$LASTEXITCODE',text)
 def test_busy_target_blocks_deployment(self):
  guard=app.target_lock('TESTPC');guard.acquire();j=uuid.uuid4().hex;app.jobs[j]={'state':'queued','events':[]}
  try:
   with patch.object(app,'copy_pkg') as copy:app.deploy_worker(j,app.Deploy(computer='TESTPC',folder='Example',script='setup_i.ps1'));copy.assert_not_called()
   self.assertEqual(app.jobs[j]['state'],'failed')
  finally:guard.release()
 def test_bulk_and_queue_terminal_states(self):
  with patch.object(app.os.path,'isdir',return_value=True),patch.object(app,'copy_pkg',return_value=1),patch.object(app,'launch',return_value=(123,'log','exit')),patch.object(app,'monitor',return_value=('1603',[])):
   j=uuid.uuid4().hex;app.jobs[j]={'state':'queued','events':[]};app.bulk_worker(j,app.Bulk(computers=['TESTPC'],folder='Example',script='setup_i.ps1'))
   self.assertEqual(app.jobs[j]['state'],'complete');self.assertEqual(app.jobs[j]['results'][0]['completion'],'Failed')
   q=uuid.uuid4().hex;app.queue_jobs[q]={'items':[{'state':'waiting'}]};app._queue_worker(q,[app.QueueItem(computer='TESTPC',folder='Example',script='setup_i.ps1')]);self.assertEqual(app.queue_jobs[q]['state'],'complete');self.assertEqual(app.queue_jobs[q]['items'][0]['state'],'failed')
 def test_databases_integrity(self):
  for path in [app.MASTER_DB,self.original_history]:
   c=sqlite3.connect(path.resolve().as_uri()+'?mode=ro',uri=True)
   try:self.assertEqual(c.execute('pragma integrity_check').fetchall(),[('ok',)])
   finally:c.close()

if __name__=='__main__':unittest.main()
