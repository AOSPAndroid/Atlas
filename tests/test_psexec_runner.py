"""Real pipes with harmless local Python fixtures; never invoke PsExec."""
import base64
import json
from pathlib import Path
import subprocess
import sys
import time
import unittest
from unittest.mock import patch
from uuid import uuid4
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
import psexec_runner as px


def payload(**kw):
    return px.RunRequest(**dict(dict(id=uuid4(), template='identity', target='TESTPC', path=r'C:\Data\PsExec.exe'), **kw))


class PsExecTests(unittest.TestCase):
    def runner(self, script, **kw):
        calls = []
        def start(args, **options):
            calls.append(args)
            return subprocess.Popen([sys.executable, '-u', '-c', script], **options)
        runner = px.Runner(popen=start, preflight=lambda p:dict(exists=True,eula_accepted=True,account='TEST\\Operator',elevated=True), **kw)
        self.addCleanup(runner.close)
        return runner, calls

    def wait(self, runner, key, predicate=lambda j:j['state'] in px.TERMINAL):
        for _ in range(200):
            j = runner.snapshot(key)
            if predicate(j): return j
            time.sleep(.02)
        self.fail('Session did not reach expected state')

    def test_server_validation_and_shared_catalogue(self):
        self.assertEqual(len(px.CATALOGUE),30)
        js=(px.ROOT/'frontend/assets/psexec-catalogue.js').read_text()
        self.assertEqual(json.loads(js.split(' = ',1)[1].removesuffix(';\n')),list(px.CATALOGUE.values()))
        for target in ['*','HOST1,HOST2','@file','-s','HOST&calc','HOST\nCMD']:
            with self.assertRaises(HTTPException):px.prepare(payload(target=target))
        for values in [{'service':"x'; calc; #"},{'service':'Spooler','other':'x'}]:
            with self.assertRaises(HTTPException):px.prepare(payload(template='service',values=values))
        with self.assertRaises(HTTPException):px.prepare(payload(template='restart-service',values={'service':'Spooler'}))
        with self.assertRaises(HTTPException):px.prepare(payload(template='tcp',values={'destination':'SERVER01','port':'65536'}))
        item, target, args, text=px.prepare(payload(template='service',values={'service':'MSSQL$INSTANCE'}))
        self.assertIn("'Name=''MSSQL$INSTANCE'''",text)
        self.assertEqual(base64.b64decode(args[-1]).decode('utf-16le'),text)
        self.assertNotIn('-s',args);self.assertNotIn('-accepteula',args)

    def test_output_is_live_and_duplicate_start_is_idempotent(self):
        r,calls=self.runner("import time; print('FIRST',flush=True); time.sleep(.5); print('LAST',flush=True)")
        p=payload();j=r.start(p);key=j['id']
        self.wait(r,key,lambda j:'FIRST' in j['output'])
        self.assertNotIn('LAST',r.snapshot(key)['output'])
        r.start(p);self.assertEqual(len(calls),1)
        with self.assertRaises(HTTPException):r.start(payload())
        with self.assertRaises(HTTPException):r.start(payload(id=p.id,target='OTHERPC'))
        j=self.wait(r,key);self.assertEqual(j['state'],'complete');self.assertEqual(j['exit_code'],0)
        self.assertIn('LAST',j['output']);self.assertEqual(j['target'],'TESTPC')
        self.assertNotIn('_process',j)

    def test_interactive_input_and_normal_exit(self):
        r,_=self.runner("import sys\nprint('READY',flush=True)\nfor line in sys.stdin:\n print('ECHO:'+line.strip(),flush=True)\n if line.strip()=='exit':break")
        key=r.start(payload(template='shell',values={'session':'1'}))['id'];self.wait(r,key,lambda j:'READY' in j['output'])
        with self.assertRaises(HTTPException):r.send(key,'one\ntwo')
        r.send(key,'hostname');self.wait(r,key,lambda j:'ECHO:hostname' in j['output'])
        r.send(key,'exit');self.assertEqual(self.wait(r,key)['state'],'complete')
        with self.assertRaises(HTTPException):r.send(key,'later')

    def test_stop_timeout_and_bounded_transcript(self):
        r,_=self.runner("import time; print('x'*4000,flush=True); time.sleep(30)",limit=1024)
        key=r.start(payload())['id'];self.wait(r,key,lambda j:j['truncated']);r.stop(key)
        j=self.wait(r,key);self.assertEqual(j['state'],'stopped');self.assertLessEqual(len(j['output']),1024)
        self.assertIn('may still be running',j['output'])
        r,_=self.runner('import time; time.sleep(30)',timeout=.15)
        key=r.start(payload())['id'];self.assertEqual(self.wait(r,key)['state'],'timed_out')

    def test_nonzero_exit_and_no_input_for_templates(self):
        r,_=self.runner("import sys,time;print('failure');time.sleep(.3);sys.exit(7)")
        key=r.start(payload())['id']
        with self.assertRaises(HTTPException):r.send(key,'hostname')
        j=self.wait(r,key);self.assertEqual(j['state'],'failed');self.assertEqual(j['exit_code'],7)

    def test_preflight_never_accepts_eula_or_starts_missing_executable(self):
        for exists,accepted in [(False,True),(True,False)]:
            r,calls=self.runner('print(1)');r.preflight=lambda p:dict(exists=exists,eula_accepted=accepted)
            with self.assertRaises(HTTPException):r.start(payload())
            self.assertFalse(calls)

    def test_routes_require_token_and_reject_client_scripts(self):
        from atlas_api import TOKEN
        r,calls=self.runner('print("TEST")')
        app=FastAPI();px.register(app)
        with patch.object(px,'runner',r), TestClient(app) as client:
            p=payload().model_dump(mode='json')
            self.assertEqual(client.post('/api/psexec/run',json=p).status_code,403)
            bad=dict(p,script='calc.exe')
            self.assertEqual(client.post('/api/psexec/run',json=bad,headers={'X-Atlas-Token':TOKEN}).status_code,422)
            self.assertFalse(calls)
            response=client.post('/api/psexec/run',json=p,headers={'X-Atlas-Token':TOKEN})
            self.assertEqual(response.status_code,200)
            self.wait(r,p['id'])
            self.assertEqual(client.post(f"/api/psexec/runs/{p['id']}/stop",json={}).status_code,403)


if __name__=='__main__':unittest.main()
