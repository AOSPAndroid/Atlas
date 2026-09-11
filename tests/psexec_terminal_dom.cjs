const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture,root}=require('./ui_fixture.cjs');
(async()=>{
 let job=null, pending=null, posts=[], watches=0;
 const response=data=>({ok:true,json:async()=>data});
 const f=await fixture({fetch:async(url,options={})=>{
   if(url==='/api/session')return response({token:'fixture'});
   if(url==='/api/psexec/runs')return response(job?[job]:[]);
   if(url==='/api/psexec/run'){
     const body=JSON.parse(options.body);posts.push(body);
     job={id:body.id,target:body.target,title:'Fixture',state:'running',interactive:body.template==='shell',output:'LIVE OUTPUT',account:'TEST\\Operator',host_elevated:true};
     return new Promise(resolve=>pending=()=>resolve(response({...job})));
   }
   if(url.endsWith('/input')){posts.push(JSON.parse(options.body));return response({sent:true});}
   if(url.endsWith('/stop')){job.state='stopped';return response(job);}
   if(url==='/api/psexec/runs/'+job?.id){watches++;return response({...job});}
   throw Error('Unexpected request '+url);
 }});
 const {w,run}=f,get=id=>w.document.getElementById('px'+id),settle=()=>new Promise(r=>setTimeout(r,10));
 for(const name of ['app.js','psexec-catalogue.js','psexec-commands.js','console-psexec.js','psexec-terminal.js'])run(fs.readFileSync(path.join(root,'frontend/assets',name),'utf8'));
 run('function toast(){}; S.target="TESTPC"; AtlasPsExec.open()');await settle();assert.equal(posts.length,0);
 const click=w.document.querySelector('[data-template="shell"]');click.click();const session=w.document.getElementById('pxArg-session');session.value='1';session.dispatchEvent(new w.Event('input'));
 const start=get('Run').onclick();await settle();assert(get('Run').disabled);assert.equal(posts.length,1);
 await get('Run').onclick();assert.equal(posts.length,1);
 run('S.target="OTHERPC";AtlasPsExec.syncTarget(S.target)');pending();await start;await settle();
 assert.equal(posts[0].target,'TESTPC');assert(get('RunStatus').textContent.includes('TESTPC'));assert(get('Output').textContent.includes('LIVE OUTPUT'));
 assert(!get('InputForm').hidden);get('Input').value='hostname';await get('InputForm').onsubmit({preventDefault(){}});assert.equal(posts[1].line,'hostname');
 await get('Stop').onclick();await new Promise(r=>setTimeout(r,1100));assert(get('RunStatus').textContent.includes('stopped'));assert(get('InputForm').hidden);
 w.document.querySelector('[data-template="restart-service"]').click();const input=w.document.getElementById('pxArg-service');input.value='Spooler';input.dispatchEvent(new w.Event('input'));
 w.prompt=()=> 'WRONGPC';await get('Run').onclick();assert.equal(posts.length,2);
 w.prompt=()=> 'OTHERPC';const changing=get('Run').onclick();await settle();assert.equal(posts[2].confirmation,'OTHERPC');assert.equal(posts[2].values.service,'Spooler');
 job.state='complete';job.exit_code=0;pending();await changing;await settle();
 assert(get('RunStatus').textContent.includes('exit 0'));
 const previous=watches;await new Promise(r=>setTimeout(r,1100));assert.equal(watches,previous,'No polling after completion');
 assert.equal(f.errors.length,0,f.errors.join('\n'));w.close();console.log('PASS: manual start, immutable run target, duplicate protection, output, stdin, stop and change confirmation.');
})().catch(e=>{console.error(e);process.exit(1)});
