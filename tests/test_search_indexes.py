import hashlib,sqlite3,tempfile,unittest
from pathlib import Path
import atlas_store
class IndexTests(unittest.TestCase):
 def test_upgrade_preserves_rows_and_search(self):
  original=atlas_store.DB
  with tempfile.TemporaryDirectory() as tmp:
   target=Path(tmp)/'test.db'
   source=sqlite3.connect(original.resolve().as_uri()+'?mode=ro',uri=True);c=sqlite3.connect(target);source.backup(c);source.close()
   tables=[r[0] for r in c.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%'")]
   def snapshot():return {t:hashlib.sha256(repr(c.execute('select * from "'+t+'"').fetchall()).encode()).hexdigest() for t in tables}
   query="select distinct * from users where user_id_norm=? or lower(email)=? or lower(employee_number)=? or full_name_norm=? or id in (select user_id_ref from user_aliases where alias_norm=?) order by full_name,id limit 100"
   terms=['missing-review-value','']+[str(v or '').lower() for row in c.execute('select user_id_norm,email,employee_number,full_name_norm from users limit 30') for v in row]
   before=snapshot();results=[c.execute(query,(v,)*5).fetchall() for v in terms]
   try:
    atlas_store.DB=target;atlas_store.initialize();atlas_store.initialize()
    self.assertEqual(before,snapshot())
    self.assertEqual(results,[c.execute(query,(v,)*5).fetchall() for v in terms])
    plan=str(c.execute('explain query plan '+query,('missing',)*5).fetchall())
    self.assertIn('MULTI-INDEX OR',plan);self.assertNotIn('SCAN users',plan)
   finally:atlas_store.DB=original;c.close()
if __name__=='__main__':unittest.main()
