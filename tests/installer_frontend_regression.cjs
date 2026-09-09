const assert=require('node:assert/strict');const {fixture}=require('./ui_fixture.cjs');const sleep=()=>new Promise(r=>setImmediate(r));
(async()=>{
 const pending=[],calls=[];let hold=false;
 const f=await fixture({fetch:async(url,options={})=>{calls.push(String(url));const reply=data=>({ok:true,status:200,json:async()=>data});if(hold&&(/api\/master\/resolve|api\/package-folder|api\/scripts|api\/job\//.test(url)))return new Promise(resolve=>pending.push({url:String(url),resolve:data=>resolve(reply(data))}));if(url==='/api/health')return reply({identity:'FIXTURE',version:'test',users:0,machines:0});if(url.includes('/catalog'))return reply({items:[]});if(url.includes('/session'))return reply({token:'test'});if(url.includes('/palette/desks'))return {...reply({records:[]}),headers:{get:()=>null}};if(url.includes('/deployments/'))return reply({deployments:[]});return reply({users:[],machines:[],available:false})}});
 await f.console();await sleep();await sleep();const {w,run}=f;hold=true;
 // Old lookup must not replace a newer selection.
 w.document.querySelector('#search').value='first';const first=run('search()');w.document.querySelector('#search').value='second';const second=run('search()');pending[1].resolve({matched:false});await second;pending[0].resolve({matched:true,user_key:'id:1'});await first;assert.equal(run('S.target'),'');
 // Cleanup's preview is invalid after changing target.
 run("S.target='PC-A'");let confirmations=0;w.confirm=()=>{confirmations++;return true};const clean=run('cleanPackages()');run("S.target='PC-B'");pending[2].resolve({exists:true,folders:3,files:7,bytes:1});await clean;assert.equal(confirmations,0);assert(!calls.some(url=>url.includes('/api/cleanup-packages/')));
 // Script responses may resolve out of order; the newest package owns the control.
 const pkg=w.document.querySelector('#pkg');pkg.innerHTML='<option>A</option><option>B</option>';pkg.value='A';const a=run('scripts()');pkg.value='B';const b=run('scripts()');pending[4].resolve({scripts:['B_i.ps1']});await b;pending[3].resolve({scripts:['A_i.ps1']});await a;assert.equal(w.document.querySelector('#script').value,'B_i.ps1');
 // Replacing a monitor cancels its timer and cannot render an old response.
 const timers=[];w.setTimeout=fn=>{timers.push(fn);return timers.length};run("poll('A');poll('B')");pending[5].resolve({state:'running',events:[{message:'OLD'}]});pending[6].resolve({state:'running',events:[{message:'NEW'}]});await sleep();await sleep();assert(w.document.querySelector('#log').textContent.includes('NEW'));assert.equal(timers.length,1);timers[0]();pending[7].resolve({state:'complete',events:[]});await sleep();
 assert.equal(f.errors.length,0,f.errors.join('\n'));w.close();console.log('PASS: current console modules, stale lookup rejection, immutable cleanup target, ordered scripts, single job monitor');
})().catch(error=>{console.error(error);process.exitCode=1});
