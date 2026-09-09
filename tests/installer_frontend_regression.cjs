const assert=require('node:assert/strict');const {fixture}=require('./ui_fixture.cjs');const sleep=()=>new Promise(r=>setImmediate(r));
(async()=>{
 const pending=[],calls=[];let hold=false;
 const f=await fixture({fetch:async(url,options={})=>{calls.push(String(url));const reply=data=>({ok:true,status:200,json:async()=>data});if(hold&&(/api\/master\/resolve|api\/package-folder|api\/scripts|api\/job\//.test(url)))return new Promise(resolve=>pending.push({url:String(url),resolve:data=>resolve(reply(data))}));if(url==='/api/health')return reply({identity:'FIXTURE',version:'test',users:0,machines:0});if(url.includes('/catalog'))return reply({items:[]});if(url.includes('/session'))return reply({token:'test'});if(url.includes('/palette/desks'))return {...reply({records:[]}),headers:{get:()=>null}};if(url.includes('/deployments/'))return reply({deployments:[]});return reply({users:[],machines:[],available:false})}});
 await f.console();await sleep();await sleep();const {w,run}=f;
 // Export fields use their real names; inspecting inventory must not select or contact a target.
 const machine={name:'PC-A',serial_number:'SERIAL<&>',manufacturer:'Fixture vendor',model_id:'Fixture model',correlation_id:'CI-123',infrastructure_itsi:'WINDOWS VIRTUAL DESKTOPS',sys_class_name:'Computer',discovery_source:'ServiceNow Discovery',operational_status:'Operational',assigned_to:'',last_logon_user:'Example User',last_discovered:'2026-09-04 00:28:48',updated_on:'2026-09-04 02:31:40'};
 run(`S.machines=${JSON.stringify([machine,{name:'PC-B'}])};renderMachines()`);
 const details=w.document.querySelector('#machines .atlas-machine-details'),requestCount=calls.length;
 assert.equal(details.querySelector('summary').textContent,'Machine details');details.querySelector('summary').click();
 assert.equal(run('S.target'),'');assert.equal(calls.length,requestCount);
 const fields=Object.fromEntries([...details.querySelectorAll('dl > div')].map(el=>[el.querySelector('dt').textContent,el.querySelector('dd').textContent]));
 assert.equal(fields['Serial number'],'SERIAL<&>');assert.equal(fields['Correlation ID'],'CI-123');assert.equal(fields.Infrastructure,'WINDOWS VIRTUAL DESKTOPS');assert.equal(fields['Assigned to'],'Not supplied');assert.equal(fields['Last logged-on user'],'Example User');assert.equal(fields['Inventory status'],'Operational');
 for(const absent of ['Online','Citrix','CPU','CPU temp','Free disk','Asset','Description'])assert(!(absent in fields),absent);
 assert(!details.querySelector('script'));run("S.target='PC-A'");assert(run('completeMachineReport()').includes('Serial number: SERIAL<&>'));run("S.target='PC-B'");assert(!run('completeMachineReport()').includes('CI-123'));
 // The entire menu is measured at screen edges, and every action remains keyboard reachable.
 const menu=w.document.querySelector('#machineMenu'),card=w.document.querySelector('[data-machine="0"]');
 menu.getBoundingClientRect=()=>({width:260,height:680});
 const openMenu=()=>card.dispatchEvent(new w.MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:1023,clientY:767}));
 const beforeMenu=calls.length;openMenu();assert.equal(calls.length,beforeMenu);assert.equal(run('S.target'),'PC-B');
 assert.equal(menu.style.left,'756px');assert.equal(menu.style.top,'80px');assert.equal(menu.querySelectorAll('[role="menuitem"]').length,17);
 for(const label of ['Refresh health','Remote Desktop','Computer Management','Event Viewer','Copy complete machine report'])assert([...menu.querySelectorAll('button')].some(b=>b.textContent===label));
 const key=value=>menu.dispatchEvent(new w.KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true}));
 key('End');assert.equal(w.document.activeElement.dataset.cmd,'report');key('Home');assert.equal(w.document.activeElement.dataset.cmd,'target');key('ArrowUp');assert.equal(w.document.activeElement.dataset.cmd,'report');key('Escape');assert(menu.classList.contains('hidden'));assert.equal(w.document.activeElement,card.querySelector('.copyhost'));
 const healthCount=()=>calls.filter(url=>url.startsWith('/api/machine-health/PC-A/')).length;
 for(let i=0;i<2;i++){openMenu();const count=healthCount();menu.querySelector('[data-cmd="health"]').click();await sleep();await sleep();assert.equal(run('S.target'),'PC-A');assert.equal(healthCount()-count,8,'exactly one health pass, including after target change');assert(menu.classList.contains('hidden'))}
 for(const tool of ['rdp','compmgmt','eventvwr']){run("S.target='PC-B'");openMenu();const count=calls.length;menu.querySelector(`[data-cmd="${tool}"]`).click();await sleep();await sleep();assert.equal(run('S.target'),'PC-A');assert.deepEqual(calls.slice(count).filter(url=>url.startsWith('/api/open-tool/')),[`/api/open-tool/${tool}/PC-A`]);assert(menu.classList.contains('hidden'))}
 const viewport={width:w.innerWidth,height:w.innerHeight};w.innerWidth=320;w.innerHeight=240;menu.getBoundingClientRect=()=>({width:304,height:224});openMenu();assert.equal(menu.style.left,'8px');assert.equal(menu.style.top,'8px');key('End');assert.equal(w.document.activeElement.dataset.cmd,'report');key('Escape');w.innerWidth=viewport.width;w.innerHeight=viewport.height;
 run('clearLookup()');hold=true;
 // Floating context follows scroll/selection without starting another health request.
 const settle=()=>new Promise(resolve=>setTimeout(resolve,35));
 run('installSupportDock()');
 const kyc=w.document.querySelector('#kyc'),health=w.document.querySelector('#healthLine'),dock=w.document.querySelector('#supportDock');
 let bottom=-20;kyc.getBoundingClientRect=health.getBoundingClientRect=()=>({bottom});
 w.document.querySelector('.lookup-column').getBoundingClientRect=()=>({left:240,width:500});
 run("S.user={name:'Alice <Example>',user_name:'alice',email:'alice@example.test'};renderKyc();S.target='PC-A'");
 await w.AtlasHealth.mount(health,'PC-A');const healthCalls=calls.length;
 w.dispatchEvent(new w.Event('scroll'));await settle();
 assert(!dock.hidden);assert(dock.textContent.includes('Alice <Example>'));assert(dock.textContent.includes('PC-A'));assert(dock.textContent.includes('Unavailable'));assert.equal(dock.querySelectorAll('.support-health-metrics > span').length,8);assert.equal(calls.length,healthCalls);
 bottom=300;w.dispatchEvent(new w.Event('scroll'));await settle();assert(dock.hidden);
 bottom=-20;run("S.target='PC-B'");w.dispatchEvent(new w.Event('scroll'));await settle();assert(dock.textContent.includes('PC-B'));assert(dock.querySelector('.support-health-metrics').textContent.includes('Checking'));assert(!dock.textContent.includes('PC-A'));
 run("page('admin')");await settle();assert(dock.hidden);run("page('workspace');clearLookup()");await settle();assert(dock.hidden);
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
