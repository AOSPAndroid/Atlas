import json
import subprocess
import unittest
from unittest.mock import Mock
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
import active_directory as ad

class ADTests(unittest.TestCase):
 def test_literal_validation_and_domain(self):
  script=ad.script_for(ad.Lookup(kind='user',identity=r'DOMAIN\user'))
  self.assertIn("$identity='user';$server='DOMAIN'",script)
  for identity in ["x';whoami", '*', '@file', 'a,b', 'a b', 'user\nexit', '-admin']:
   with self.assertRaises(HTTPException):ad.script_for(ad.Lookup(kind='user',identity=identity))
  with self.assertRaises(HTTPException):ad.script_for(ad.Lookup(kind='computer',identity='PC',server='dc;exit'))
 def test_result_and_errors(self):
  payload=ad.Lookup(kind='computer',identity='PC01')
  ps=Mock(return_value=json.dumps({'details':{'Enabled':False},'groups':[]}))
  self.assertFalse(ad.lookup(payload,ps)['details']['Enabled']);self.assertEqual(ps.call_args.kwargs['timeout'],35)
  for response in ['not json','[]','{"details": {}, "groups": null}']:
   with self.assertRaises(HTTPException):ad.lookup(payload,Mock(return_value=response))
  with self.assertRaises(HTTPException) as e:ad.lookup(payload,Mock(side_effect=subprocess.TimeoutExpired('powershell',35)))
  self.assertEqual(e.exception.status_code,504)
 def test_token_before_any_query(self):
  from atlas_api import TOKEN
  app=FastAPI();ps=Mock(return_value='{"details": {}, "groups": []}');ad.register(app,ps)
  with TestClient(app) as client:
   body={'kind':'user','identity':'testuser'}
   self.assertEqual(client.post('/api/active-directory/lookup',json=body).status_code,403);ps.assert_not_called()
   self.assertEqual(client.post('/api/active-directory/lookup',json=body,headers={'x-atlas-token':TOKEN}).status_code,200)
   self.assertEqual(client.post('/api/active-directory/lookup',json={**body,'password':'secret'},headers={'x-atlas-token':TOKEN}).status_code,422)
if __name__=='__main__':unittest.main()
