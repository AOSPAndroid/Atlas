const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)],api=async(u,o={})=>{let r=await fetch(u,o);if(!r.ok)throw Error(await r.text());return r.json()},esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));let S={users:[],machines:[],user:null,target:'',job:null,bulk:null,rows:[],processes:[]};const prefs=()=>JSON.parse(localStorage.getItem('wmiPrefs')||'{"favs":[],"recent":[]}'),save=p=>localStorage.setItem('wmiPrefs',JSON.stringify(p));function toast(m){let x=document.createElement('div');x.className='toast';x.textContent=m;$('#toast').append(x);setTimeout(()=>x.remove(),2500)}async function copy(v,n='Value'){if(!v)return toast(`${n} empty`);await navigator.clipboard.writeText(String(v));toast(`${n} copied`)}function page(id){$$('.page,nav button').forEach(x=>x.classList.remove('active'));$('#'+id).classList.add('active');$(`[data-page="${id}"]`).classList.add('active');$('#pageTitle').textContent=$(`[data-page="${id}"] .nav-label`).textContent;document.querySelectorAll('nav [data-page]').forEach(b=>{if(b.dataset.page===id)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});if(id==='history')history()}async function init(){let h=await api('/api/health');$('#identity').textContent=h.identity;$('#health').innerHTML=`Version ${h.version}<br>${h.database?'●':'○'} Database · ${h.users.toLocaleString()} users<br>${h.machines.toLocaleString()} machines<br>${h.repository?'●':'○'} Repository`;await packages();await bulkPackages();renderRecent();$('#search').focus()}function setTarget(pc,status=''){S.target=pc;$('#deployTarget').textContent=pc;$('#adminPc').value=pc;$('#barTarget').textContent=pc;$('#barState').textContent=status;$('#targetBar').classList.remove('hidden');$$('[data-machine]').forEach(x=>x.classList.toggle('selected',S.machines[+x.dataset.machine]?.name===pc))}let lookupSequence=0;
function clearLookup(){S.user=null;S.users=[];S.machines=[];S.target='';daasState.user=null;daasUserKey='';masterState.resolution=null;$('#kyc').innerHTML='';$('#users').innerHTML='';$('#machines').innerHTML='';$('#deployTarget').textContent='Select a machine';$('#adminPc').value='';$('#targetBar').classList.add('hidden');$('#healthLine').classList.add('hidden');$('#preflight').innerHTML='';$('#packagePresence').innerHTML='';}
async function search(){
 const term=$('#search').value.trim(),sequence=++lookupSequence;clearLookup();
 if(!term)return toast('Enter a search');
 let resolved=null;
 if(!term.includes(':'))resolved=await api('/api/master/resolve/'+encodeURIComponent(term));
 if(sequence!==lookupSequence)return;
 if(resolved?.matched){await loadUser(resolved.user_key,sequence);if(sequence===lookupSequence&&resolved.requested_machine)setTarget(resolved.requested_machine,'Database record');return;}
 const d=await api('/api/search?term='+encodeURIComponent(term));if(sequence!==lookupSequence)return;
 S.users=d.users;S.machines=d.machines;
 if(d.users.length===1&&!d.machines.length)return loadUser('id:'+d.users[0].id,sequence);
 renderUsers();renderMachines();if(!d.users.length&&!d.machines.length)toast('No matching users or machines');
}
function renderUsers(){if(!S.users.length)return $('#users').innerHTML='';$('#users').innerHTML=`<div class=panel><small>MATCHING USERS</small><div class=row>${S.users.map((u,i)=>`<button data-user="${i}">${esc(u.name)} · ${esc(u.user_name)} · ${esc(u.location)}</button><button data-email="${i}">Copy email</button>`).join('')}</div></div>`;$$('[data-user]').forEach(b=>b.onclick=()=>loadUser('id:'+S.users[+b.dataset.user].id).catch(e=>toast(e.message)));$$('[data-email]').forEach(b=>b.onclick=()=>copy(S.users[+b.dataset.email].email,'Email'))}async function loadUser(id,sequence){
 if(sequence===undefined){sequence=++lookupSequence;clearLookup();}
 const d=await api('/api/user/'+encodeURIComponent(id));if(sequence!==lookupSequence)return;
 S.user=d.user;S.machines=d.machines;$('#users').innerHTML='';renderKyc();renderMachines();
}
function renderKyc(){let u=S.user,initials=(u.name||'?').split(' ').slice(0,2).map(x=>x[0]).join('');let detail=[['Email',u.email],['Employee ID',u.employee_id],['Worker type',u.worker_type],['Department',u.department],['Business unit',u.business_unit],['Organisation',u.organisation],['Country',u.country],['Start date',u.start_date],['Last login',u.last_login],['Last login time',u.last_login_time]];$('#kyc').innerHTML=`<div class="card usercard"><div class=avatar>${esc(initials)}</div><div><div class=head><h2>${esc(u.name)}</h2><span class=pill>${esc(u.active)}</span></div><div class=facts><span>Username<b>${esc(u.user_name)}</b></span><span>Location<b>${esc(u.location)}</b></span><span>Job title<b>${esc(u.job_title)}</b></span><span>Manager<b>${esc(u.manager)}</b></span></div><div class=copybar><button data-copy="username">Copy username</button><button data-copy="email">Copy email</button><button data-copy="name">Copy name</button><button data-copy="summary">Copy summary</button></div><details class=details><summary>More KYC details</summary><div class=detailgrid>${detail.map(x=>`<span>${esc(x[0])}<b>${esc(x[1]||'—')}</b></span>`).join('')}</div></details></div></div>`;$$('[data-copy]').forEach(b=>b.onclick=()=>{let k=b.dataset.copy,v=k==='summary'?`Name: ${u.name}\nUsername: ${u.user_name}\nEmail: ${u.email}\nLocation: ${u.location}\nJob title: ${u.job_title}\nManager: ${u.manager}`:k==='name'?u.name:k==='username'?u.user_name:u[k];copy(v,k)})}function renderMachines(){if(!S.machines.length)return $('#machines').innerHTML='';$('#machines').innerHTML=`<small>LINKED MACHINES · ${S.machines.length}</small><div class=machinegrid>${S.machines.map((m,i)=>`<div class="card machine" data-machine="${i}"><button class=copyhost data-host="${i}">Copy</button><span class="state ${String(m.operational_status).toLowerCase()==='operational'?'':'bad'}">● ${esc(m.operational_status)}</span><h3>${esc(m.name)}</h3><div class=facts><span>Match<b>${esc(m.match_type||'Hostname')}</b></span><span>Model<b>${esc(m.model_id||'—')}</b></span><span>Inventory discovered<b>${esc(m.last_discovered||'Not supplied')}</b></span><span>Record updated<b>${esc(m.updated_on||'Not supplied')}</b></span></div></div>`).join('')}</div>`;$$('[data-machine]').forEach(x=>x.onclick=()=>setTarget(S.machines[+x.dataset.machine].name,S.machines[+x.dataset.machine].operational_status));$$('[data-host]').forEach(x=>x.onclick=e=>{e.stopPropagation();copy(S.machines[+x.dataset.host].name,'Hostname')});if(S.machines.length===1){let m=S.machines[0];setTarget(m.name,m.operational_status)}}async function packages(){let d=await api('/api/catalog?term='+encodeURIComponent($('#pkgSearch').value));$('#pkg').innerHTML=d.items.map(x=>`<option value="${esc(x.folder)}">${esc(x.display_name)}${x.version?' · '+esc(x.version):''}</option>`).join('');await scripts()}async function scripts(){if(!$('#pkg').value){$('#script').innerHTML='';return;}let d=await api(`/api/scripts?package=${encodeURIComponent($('#pkg').value)}&action=${$('#action').value}`);$('#script').innerHTML=d.scripts.map(x=>`<option>${esc(x)}</option>`).join('');renderFav()}function packageFolder(pkg){return pkg}
async function preflight(){if(!S.target)return;const pc=S.target;let d=await api('/api/preflight/'+pc);if(S.target!==pc)return;$('#preflight').innerHTML=`<div class=checks>${Object.entries(d).map(([k,v])=>`<span class="check ${v?'ok':''}">${v?'✓':'✕'} ${esc(k)}</span>`).join('')}</div>`}let deploySubmitting=false;
async function deploy(mode='full'){if(deploySubmitting)return;if(!S.target)return toast('Select a target');let pkg=$('#pkg').value,p=prefs();p.recent=[pkg,...p.recent.filter(x=>x!==pkg)].slice(0,5);save(p);renderRecent();deploySubmitting=true;let d;try{d=await api('/api/deploy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({computer:S.target,folder:packageFolder(pkg),script:$('#script').value,action:$('#action').value,fresh:$('#fresh').checked,threads:+$('#threads').value,mode})});}finally{deploySubmitting=false;}S.job=d.job;poll()}async function poll(){let j=await api('/api/job/'+S.job);$('#log').textContent=j.events.map(e=>`[${e.time}] ${e.message}${e.log?'\n'+e.log.join('\n'):''}`).join('\n');if(!['complete','failed'].includes(j.state))setTimeout(poll,1000);else toast(j.state)}function renderFav(){let p=prefs(),pkg=$('#pkg').value;$('#favBtn').textContent=p.favs.includes(pkg)?'★ Favourite':'☆ Favourite'}function toggleFav(){let p=prefs(),pkg=$('#pkg').value;p.favs=p.favs.includes(pkg)?p.favs.filter(x=>x!==pkg):[...p.favs,pkg];save(p);renderFav();renderRecent()}function renderRecent(){let p=prefs(),vals=[...p.favs,...p.recent].filter((x,i,a)=>a.indexOf(x)===i);$('#recent').innerHTML=vals.map(x=>`<button data-recent="${esc(x)}">${p.favs.includes(x)?'★ ':''}${esc(x)}</button>`).join('');$$('[data-recent]').forEach(b=>b.onclick=()=>{$('#pkg').value=b.dataset.recent;scripts()})}async function admin(kind){let pc=$('#adminPc').value.trim();if(!pc)return;let u=kind==='overview'?`/api/overview/${pc}`:kind==='ping'?`/api/ping/${pc}`:kind==='access'?`/api/access/${pc}`:kind==='disk'?`/api/disk/${pc}`:`/api/processes/${pc}?kind=${kind}`;let d=await api(u);if(kind==='cpu'||kind==='memory'){S.processes=d;renderProcesses()}else $('#adminOverview').innerHTML=`<pre>${esc(JSON.stringify(d,null,2))}</pre>`}function renderProcesses(){let q=$('#processFilter').value.toLowerCase(),d=S.processes.filter(x=>JSON.stringify(x).toLowerCase().includes(q));$('#adminOut').innerHTML=table(d)}function table(rows){if(!rows.length)return '';return `<table><thead><tr>${Object.keys(rows[0]).map(k=>`<th>${esc(k)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${Object.values(r).map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`}function bulkTargets(){return [...new Set($('#bulkTargets').value.split(/[,;\s]+/).map(x=>x.trim().toUpperCase()).filter(Boolean))]}async function bulkPackages(){let d=await api('/api/catalog?term='+encodeURIComponent($('#bulkSearch').value));$('#bulkPkg').innerHTML=d.items.map(x=>`<option value="${esc(x.folder)}">${esc(x.display_name)}${x.version?' · '+esc(x.version):''}</option>`).join('');bulkScripts()}async function bulkScripts(){if(!$('#bulkPkg').value){$('#bulkScript').innerHTML='';return;}let d=await api(`/api/scripts?package=${encodeURIComponent($('#bulkPkg').value)}&action=${$('#bulkAction').value}`);$('#bulkScript').innerHTML=d.scripts.map(x=>`<option>${esc(x)}</option>`).join('')}async function startBulk(){let pcs=bulkTargets();if(!pcs.length)return toast('Enter targets');let pkg=$('#bulkPkg').value,d=await api('/api/bulk/deploy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({computers:pcs,folder:packageFolder(pkg),script:$('#bulkScript').value,action:$('#bulkAction').value,fresh:$('#bulkFresh').checked,threads:+$('#bulkThreads').value,concurrency:+$('#concurrency').value})});S.bulk=d.job;bulkPoll()}async function bulkPoll(){let j=await api('/api/bulk/job/'+S.bulk);S.rows=j.results||[];renderBulk(j);if(j.state!=='complete')setTimeout(bulkPoll,1000);else toast('Bulk complete')}function renderBulk(j){let r=S.rows;$('#bulkSummary').innerHTML=`<div class=summary><div>Phase<b>${esc(j.phase)}</b></div><div>Total<b>${r.length}</b></div><div>Failed<b>${r.filter(x=>x.copy==='Failed'||x.completion==='Failed').length}</b></div><div>Complete<b>${r.filter(x=>String(x.completion).startsWith('Complete')).length}</b></div></div>`;$('#bulkBody').innerHTML=r.map(x=>`<tr><td><b>${esc(x.machine)}</b></td><td class="${x.copy==='Failed'?'bad':'good'}">${esc(x.copy)}</td><td>${esc(x.launch)}</td><td>${esc(x.pid)}</td><td>${esc(x.completion)}</td><td>${esc(x.exit_code)}</td><td>${esc(String(x.details||'').split('\n').slice(-1)[0])}</td></tr>`).join('')}async function history(){let d=await api('/api/history');$('#historyBody').innerHTML=d.map(x=>`<tr><td>${esc(x.started)}</td><td>${esc(x.target)}</td><td>${esc(x.package)}</td><td>${esc(x.action)}</td><td>${esc(x.mode)}</td><td>${esc(x.state)}</td><td>${esc(x.exit_code)}</td></tr>`).join('')}function exportCsv(){if(!S.rows.length)return;let k=['machine','copy','launch','pid','completion','exit_code','details'],csv=[k.join(','),...S.rows.map(r=>k.map(x=>'"'+String(r[x]??'').replace(/"/g,'""')+'"').join(','))].join('\n'),a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv]));a.download='bulk.csv';a.click()}function bind(){$('#pkgSearch').oninput=()=>{clearTimeout(window.pt);window.pt=setTimeout(packages,250)};$('#pkg').onchange=scripts;$('#action').onchange=scripts;$('#deploy').onclick=()=>deploy('full');$('#copyOnly').onclick=()=>deploy('copy');$('#execOnly').onclick=()=>deploy('execute');$('#favBtn').onclick=toggleFav;$('#bulkTargets').oninput=()=>$('#targetCount').textContent=`${bulkTargets().length} targets`;$('#bulkSearch').oninput=()=>{clearTimeout(window.bt);window.bt=setTimeout(bulkPackages,250)};$('#bulkPkg').onchange=bulkScripts;$('#bulkAction').onchange=bulkScripts;$('#bulkStart').onclick=startBulk;$('#copyFailed').onclick=()=>copy(S.rows.filter(x=>x.copy==='Failed'||x.completion==='Failed').map(x=>x.machine).join('\n'),'Failed machines');$('#exportCsv').onclick=exportCsv;$('#processFilter').oninput=renderProcesses;$('#refreshHistory').onclick=history;$('#killBtn').onclick=async()=>toast('Terminated '+(await api('/api/kill',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({computer:$('#adminPc').value,value:$('#kill').value})})).count);$$('[data-preflight]').forEach(x=>x.onclick=preflight);$$('[data-copy-target]').forEach(x=>x.onclick=()=>copy(S.target,'Hostname'));$$('[data-admin-target]').forEach(x=>x.onclick=()=>page('admin'));['overview','ping','access','disk','cpu','memory'].forEach(k=>$(`[data-${k}]`).onclick=()=>admin(k).catch(x=>toast(x.message)));$('[data-reboot]').onclick=async()=>{if(confirm('Reboot '+$('#adminPc').value+'?'))toast('Return '+(await api('/api/reboot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({computer:$('#adminPc').value})})).result)}}document.addEventListener('DOMContentLoaded',()=>{
  const searchInput=document.getElementById('search');
  searchInput.disabled=false;
  searchInput.readOnly=false;
  searchInput.removeAttribute('disabled');
  searchInput.removeAttribute('readonly');
  searchInput.setAttribute('tabindex','0');
  searchInput.value='';
  searchInput.addEventListener('pointerdown',()=>searchInput.focus());
  searchInput.addEventListener('click',()=>searchInput.focus());
  searchInput.addEventListener('keydown',event=>{
    if(event.key==='Enter'){
      event.preventDefault();
      event.stopPropagation();
      search().catch(error=>toast(error.message));
    }
  });
  document.querySelectorAll('nav button').forEach(button=>button.addEventListener('click',()=>page(button.dataset.page)));
  bind();
  setTimeout(()=>searchInput.focus(),50);
  init().catch(error=>toast(error.message));
});


/* REMOTE TOOLS AND CLEANUP V1 */
function targetPrefs(){return JSON.parse(localStorage.getItem('wmiTargetPrefs')||'{"recent":[]}')}
function saveTargetPrefs(p){localStorage.setItem('wmiTargetPrefs',JSON.stringify(p))}
function rememberTarget(pc){if(!pc)return;const p=targetPrefs();p.recent=[pc,...p.recent.filter(x=>x!==pc)].slice(0,10);saveTargetPrefs(p);renderRecentTargets()}
function renderRecentTargets(){const host=document.querySelector('#recentTargets');if(!host)return;const values=targetPrefs().recent;host.innerHTML=values.length?`<small>RECENT TARGETS</small><div class="recent-target-list">${values.map(x=>`<button data-recent-target="${esc(x)}">${esc(x)}</button>`).join('')}</div>`:'';document.querySelectorAll('[data-recent-target]').forEach(b=>b.onclick=()=>{setTarget(b.dataset.recentTarget,'Recent target');document.querySelector('#search').value=b.dataset.recentTarget})}
const baseSetTarget=setTarget;
setTarget=function(pc,status=''){baseSetTarget(pc,status);rememberTarget(pc)};
async function openTargetTool(tool){if(!S.target)return toast('Select a target');const d=await api(`/api/open-tool/${encodeURIComponent(tool)}/${encodeURIComponent(S.target)}`,{method:'POST'});toast(`${tool} opened for ${d.computer}`)}
function supportSummary(){const u=S.user||{},m=(S.machines||[]).find(x=>x.name===S.target)||{};return [`Timestamp: ${new Date().toLocaleString('en-GB')}`,`User: ${u.name||''}`,`Username: ${u.user_name||''}`,`Email: ${u.email||''}`,`Location: ${u.location||''}`,`Manager: ${u.manager||''}`,`Target: ${S.target||''}`,`Status: ${m.operational_status||''}`,`Model: ${m.model_id||''}`,`Serial: ${m.serial_number||''}`,`Last discovered: ${m.last_discovered||''}`].join('\n')}
async function cleanPackages(){if(!S.target)return toast('Select a target');let info=await api('/api/package-folder/'+encodeURIComponent(S.target));let size=(info.bytes/1024/1024).toFixed(1);let message=info.exists?`Delete ALL contents of \\${S.target}\\C$\\Temp\\Packages?\n\n${info.folders} folders, ${info.files} files, ${size} MB\n\nActive installations may fail if their package is removed.`:`The package folder does not exist on ${S.target}.`;if(!info.exists)return toast(message);if(!confirm(message))return;let d=await api('/api/cleanup-packages/'+encodeURIComponent(S.target),{method:'POST'});toast(`Deleted ${d.deleted}; failed ${d.failed}`)}
function bindRemoteTools(){document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>openTargetTool(b.dataset.tool).catch(e=>toast(e.message)));document.querySelector('#copySupport').onclick=()=>copy(supportSummary(),'Support summary');document.querySelector('#cleanupPackages').onclick=()=>cleanPackages().catch(e=>toast(e.message));renderRecentTargets()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bindRemoteTools);else bindRemoteTools();


/* MATERIAL YOU V2.2 */
function applyMaterialTheme(theme){
  document.body.classList.toggle('material-light',theme==='light');
  localStorage.setItem('wmiMaterialTheme',theme);
  const toggle=document.querySelector('#themeToggle');
  if(toggle)toggle.textContent=theme==='light'?'◑':'◐';
}
function bindMaterialUI(){
  applyMaterialTheme(localStorage.getItem('wmiMaterialTheme')||'dark');
  const toggle=document.querySelector('#themeToggle');
  if(toggle)toggle.addEventListener('click',()=>applyMaterialTheme(document.body.classList.contains('material-light')?'dark':'light'));

}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bindMaterialUI);else bindMaterialUI();


/* MINIMAL UI V2.3 */
function applyMinimalUI(){
  document.body.classList.remove('material-you','material-light');
  document.body.classList.add('minimal-ui');
  const theme=document.querySelector('#themeToggle');if(theme)theme.style.display='none';
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',applyMinimalUI);else applyMinimalUI();


/* V2.4 PRODUCTIVITY */
let queueRunning=false;let deploymentQueue=[];let activeQueueId=null;let lastHealth=null;
function currentPackagePayload(mode='full'){const pkg=document.querySelector('#pkg').value;return{computer:S.target,folder:packageFolder(pkg),script:document.querySelector('#script').value,action:document.querySelector('#action').value,fresh:document.querySelector('#fresh').checked,threads:Number(document.querySelector('#threads').value),mode}}
async function loadFreshness(){const d=await api('/api/database-freshness');const el=document.querySelector('#dbFreshness');if(!el)return;el.innerHTML=`<b>${d.excel_newer?'NEWER EXCEL AVAILABLE':'DATABASE CURRENT'}</b><span>DB: ${esc(d.database_modified||'missing')}</span><span>Excel: ${esc(d.excel_modified||'missing')}</span>`;el.classList.toggle('stale',d.excel_newer)}
async function refreshTargetHealth(){if(!S.target)return;const line=document.querySelector('#healthLine');line.classList.remove('hidden');line.textContent=`${S.target} | CHECKING...`;try{lastHealth=await api('/api/target-health/'+encodeURIComponent(S.target));line.innerHTML=`<b>${esc(S.target)}</b><span>PING ${lastHealth.ping?'OK':'NO'}</span><span>C$ ${lastHealth.c_share?'OK':'NO'}</span><span>WMI ${lastHealth.wmi?'OK':'NO'}</span><span>${lastHealth.free_gb??'—'} GB FREE</span><span>${esc(lastHealth.logged_on||'NO LOGGED-ON USER')}</span><button id="refreshHealth">Refresh</button>`;document.querySelector('#refreshHealth').onclick=refreshTargetHealth}catch(e){line.textContent=`${S.target} | HEALTH CHECK FAILED`}}
const originalSetTargetV24=setTarget;setTarget=function(pc,status=''){originalSetTargetV24(pc,status);refreshTargetHealth()};
function renderQueue(){document.querySelector('#queueCount').textContent=deploymentQueue.length;document.querySelector('#queueItems').innerHTML=deploymentQueue.length?deploymentQueue.map((x,i)=>`<div class="queue-row"><b>${i+1}. ${esc(x.computer)}</b><span>${esc(PathName(x.folder))} · ${esc(x.action)} · ${esc(x.state||'waiting')}</span><button data-remove-queue="${i}">Remove</button></div>`).join(''):'<p class="empty">Queue is empty</p>';document.querySelectorAll('[data-remove-queue]').forEach(b=>b.onclick=()=>{if(queueRunning)return toast('Running item cannot be removed');deploymentQueue.splice(+b.dataset.removeQueue,1);renderQueue()})}
function PathName(path){return String(path||'').split(/[\\/]/).filter(Boolean).pop()||''}
function addQueue(){if(queueRunning)return toast('Queue is running');if(!S.target)return toast('Select a target');deploymentQueue.push({...currentPackagePayload('full'),state:'waiting'});renderQueue();toast('Added to queue')}
async function startDeploymentQueue(){if(queueRunning)return toast('Queue is already running');if(!deploymentQueue.length)return toast('Queue is empty');queueRunning=true;let d;try{d=await api('/api/queue',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:deploymentQueue})});}catch(e){queueRunning=false;throw e;}activeQueueId=d.queue;pollQueue()}
async function pollQueue(){if(!activeQueueId)return;const q=await api('/api/queue/'+activeQueueId);q.items.forEach((x,i)=>{if(deploymentQueue[i])deploymentQueue[i].state=x.state});renderQueue();if(!['complete','paused','failed'].includes(q.state))setTimeout(pollQueue,1000);else {queueRunning=false;deploymentQueue=deploymentQueue.filter(x=>x.state==='waiting');renderQueue();toast(`Queue ${q.state}`)}}
async function pauseDeploymentQueue(){if(activeQueueId)await api('/api/queue/'+activeQueueId+'/pause',{method:'POST'})}
function machineContext(event,index){event.preventDefault();event.stopPropagation();const m=S.machines[index],menu=document.querySelector('#machineMenu');menu.innerHTML=`<button data-cmd="target">Set as target</button><button data-cmd="copy">Copy hostname</button><button data-cmd="details">Copy machine details</button><button data-cmd="msra">Open MSRA</button><button data-cmd="cshare">Open C$</button><button data-cmd="temp">Open C:\\Temp</button><button data-cmd="packages">Open Packages</button><button data-cmd="admin">Remote Admin</button><button data-cmd="queue">Add deployment to queue</button><button data-cmd="clean">Clean package folder</button>`;menu.style.left=Math.min(event.clientX,window.innerWidth-210)+'px';menu.style.top=Math.min(event.clientY,window.innerHeight-360)+'px';menu.classList.remove('hidden');menu.querySelectorAll('[data-cmd]').forEach(b=>b.onclick=()=>{const cmd=b.dataset.cmd;setTarget(m.name,m.operational_status);if(cmd==='copy')copy(m.name,'Hostname');if(cmd==='details')copy(JSON.stringify(m,null,2),'Machine details');if(['msra','cshare','temp','packages'].includes(cmd))openTargetTool(cmd);if(cmd==='admin')page('admin');if(cmd==='queue')addQueue();if(cmd==='clean')cleanPackages();menu.classList.add('hidden')})}
function bindMachineContext(){document.querySelectorAll('[data-machine]').forEach(card=>card.oncontextmenu=e=>machineContext(e,Number(card.dataset.machine)))}
const machineObserverV24=new MutationObserver(bindMachineContext);const machineHostV24=document.querySelector('#machines');if(machineHostV24)machineObserverV24.observe(machineHostV24,{childList:true,subtree:true});
const commands=[
 ['Focus search','/ ',()=>document.querySelector('#search').focus()],['Deploy package','Ctrl+D',()=>deploy('full')],['Copy package only','Ctrl+Shift+D',()=>deploy('copy')],['Add deployment to queue','',addQueue],['Open deployment queue','',()=>document.querySelector('#queueDrawer').classList.add('open')],['Open MSRA','Ctrl+M',()=>openTargetTool('msra')],['Open C$','Ctrl+Shift+C',()=>openTargetTool('cshare')],['Open Remote Admin','Ctrl+R',()=>page('admin')],['Check target health','',refreshTargetHealth],['Clean package folder','',cleanPackages],['Copy support summary','',()=>copy(supportSummary(),'Support summary')],['Open Bulk Deploy','',()=>page('bulk')],['Open History','',()=>page('history')]
];
let paletteFocus=null,paletteIndex=0;
function openPalette(){const o=document.querySelector('#commandOverlay');if(o.classList.contains('hidden'))paletteFocus=document.activeElement;o.classList.remove('hidden');document.querySelector('#commandSearch').value='';renderCommands('');document.querySelector('#commandSearch').focus()}
function closePalette(){const o=document.querySelector('#commandOverlay');if(o.classList.contains('hidden'))return;o.classList.add('hidden');if(paletteFocus?.isConnected)paletteFocus.focus();paletteFocus=null}
function selectCommand(index){const rows=[...document.querySelectorAll('#commandList button')];paletteIndex=rows.length?(index+rows.length)%rows.length:0;rows.forEach((r,i)=>r.classList.toggle('command-selected',i===paletteIndex));}
function renderCommands(q){
 const words=q.toLowerCase().trim().split(/\s+/);const seen=new Set();
 const list=commands.filter(x=>{const key=x[0].toLowerCase();if(seen.has(key))return false;seen.add(key);return words.every(w=>(key+' '+x[1].toLowerCase()).includes(w))});
 document.querySelector('#commandList').innerHTML=list.length?list.map(x=>`<button data-command="${commands.indexOf(x)}"><span>${esc(x[0])}</span>${x[1]?`<kbd>${esc(x[1])}</kbd>`:''}</button>`).join(''):'<p class="empty command-empty">No matching commands. Try “queue”, “search” or “history”.</p>';
 document.querySelectorAll('[data-command]').forEach(b=>b.onclick=()=>{closePalette();Promise.resolve().then(()=>commands[+b.dataset.command][2]()).catch(e=>toast(e.message))});selectCommand(0);
}
function typing(){const a=document.activeElement;return a&&['INPUT','TEXTAREA','SELECT'].includes(a.tagName)}
function bindV24(){loadFreshness();renderQueue();bindMachineContext();document.querySelector('#queueToggle').onclick=()=>document.querySelector('#queueDrawer').classList.toggle('open');document.querySelector('#closeQueue').onclick=()=>document.querySelector('#queueDrawer').classList.remove('open');document.querySelector('#startQueue').onclick=()=>startDeploymentQueue().catch(e=>toast(e.message));document.querySelector('#pauseQueue').onclick=()=>pauseDeploymentQueue().catch(e=>toast(e.message));document.querySelector('#clearQueue').onclick=()=>{if(queueRunning)return toast('Queue is running');deploymentQueue=deploymentQueue.filter(x=>x.state==='running');renderQueue()};document.querySelector('#commandSearch').oninput=e=>renderCommands(e.target.value);document.querySelector('#commandOverlay').onclick=e=>{if(e.target.id==='commandOverlay')closePalette()};document.addEventListener('click',()=>document.querySelector('#machineMenu').classList.add('hidden'));document.addEventListener('keydown',e=>{if(e.ctrlKey&&e.key.toLowerCase()==='k'){e.preventDefault();openPalette();return}if(e.key==='Escape'){closePalette();document.querySelector('#machineMenu').classList.add('hidden');return}if(typing())return;if(e.key==='/'){e.preventDefault();document.querySelector('#search').focus()}if(e.ctrlKey&&!e.shiftKey&&e.key.toLowerCase()==='d'){e.preventDefault();deploy('full')}if(e.ctrlKey&&e.shiftKey&&e.key.toLowerCase()==='d'){e.preventDefault();deploy('copy')}if(e.ctrlKey&&e.key.toLowerCase()==='m'){e.preventDefault();openTargetTool('msra')}if(e.ctrlKey&&e.shiftKey&&e.key.toLowerCase()==='c'){e.preventDefault();openTargetTool('cshare')}if(e.ctrlKey&&e.key.toLowerCase()==='r'){e.preventDefault();page('admin')}})}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bindV24);else bindV24();


/* STATUS ACCENTS V2.4.1 */
function statusAccent(value){
  const text=String(value??'').trim().toLowerCase();
  if(!text)return 'status-neutral';
  if(/failed|failure|error|not started|unavailable|offline/.test(text))return 'status-bad';
  if(/warning|reboot|unknown|not written/.test(text))return 'status-warn';
  if(['ok','online','available','operational','complete','completed','success','successful','ready','started','running','current','true','0'].some(x=>text===x||text.startsWith(x+' ')||text.includes(' '+x)))return 'status-ok';
  if(['warning','warn','pending','waiting','queued','checking','monitoring','paused','not written','completed with warning','unknown'].some(x=>text===x||text.includes(x)))return 'status-warn';
  if(['no','offline','unavailable','failed','failure','error','not started','monitor failed','missing','false'].some(x=>text===x||text.startsWith(x+' ')||text.includes(x)))return 'status-bad';
  return 'status-neutral';
}
function accentNode(node){if(!node||node.dataset.statusAccented)return;const value=node.textContent.trim();node.classList.add('status-word',statusAccent(value));node.dataset.statusAccented='1'}
function accentPageStatuses(){
  document.querySelectorAll('.healthline span,.state,.check,.pill,.summary b,.queue-row span,.db-freshness b,#bulkBody td:nth-child(2),#bulkBody td:nth-child(3),#bulkBody td:nth-child(5),#historyBody td:nth-child(6),#historyBody td:nth-child(7)').forEach(accentNode);
  document.querySelectorAll('.healthline span').forEach(node=>{
    const text=node.textContent.trim();
    if(/\bOK\b/i.test(text))node.classList.add('status-ok');
    else if(/\b(NO|FAILED|OFFLINE|UNAVAILABLE)\b/i.test(text))node.classList.add('status-bad');
    else if(/CHECKING|UNKNOWN|—/i.test(text))node.classList.add('status-warn');
  });
}
const statusObserver=new MutationObserver(()=>accentPageStatuses());
['healthLine','machines','preflight','bulkSummary','bulkBody','historyBody','queueItems','dbFreshness'].forEach(id=>{const n=document.getElementById(id);if(n)statusObserver.observe(n,{childList:true,subtree:true,characterData:true})});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',accentPageStatuses);else accentPageStatuses();


/* DAAS GUI INTEGRATION V2.5 */
let daasState={status:null,user:null,machines:{}};
function daasValue(value){return value===null||value===undefined||String(value).trim()===''?'—':String(value)}
function daasClass(value){const text=String(value||'').toLowerCase();if(/online|registered|provisioned|complete|yes/.test(text))return 'status-ok';if(/offline|unreachable|unregistered|remove|failed|no$/.test(text))return 'status-bad';if(/unknown|maintenance|not in cloud|not provisioned/.test(text))return 'status-warn';return 'status-neutral'}
function daasField(label,value,status=false){return `<span><em>${esc(label)}</em><b class="${status?daasClass(value):''}">${esc(daasValue(value))}</b></span>`}
async function loadDaaSStatus(){try{const d=await api('/api/daas/status');daasState.status=d;const el=document.querySelector('#daasStatus');if(!el)return;el.innerHTML=d.available?`<b class="status-ok">DAAS DB ONLINE</b><span>${d.devices.toLocaleString()} devices</span><span>${d.users.toLocaleString()} users</span><span>${d.assignments.toLocaleString()} assignments</span>`:`<b class="status-warn">DAAS DB UNAVAILABLE</b>`}catch(e){const el=document.querySelector('#daasStatus');if(el)el.innerHTML='<b class="status-bad">DAAS DB ERROR</b>'}}
let daasUserKey='';
async function loadDaaSUser(){
 if(!S.user)return;const userId=S.user.id,key='id:'+S.user.id;
 if(!key||daasUserKey===String(userId))return;daasUserKey=String(userId);
 try{const d=await api('/api/daas/user/'+encodeURIComponent(key));if(S.user?.id!==userId)return;daasState.user=d;renderDaaSUser()}
 catch(e){daasUserKey='';console.warn('DaaS user lookup failed',e)}
}
function renderDaaSUser(){const host=document.querySelector('#kyc .usercard>div:last-child');const old=document.querySelector('#daasUserDetails');if(old)old.remove();const d=daasState.user;if(!host||!d||!d.matched)return;const u=d.users[0]||{};const block=document.createElement('details');block.id='daasUserDetails';block.className='details daas-details';block.innerHTML=`<summary>DaaS user details <i>${d.devices.length} device${d.devices.length===1?'':'s'}</i></summary><div class="daas-grid">${daasField('BRID',u.brid)}${daasField('DaaS login',u.login_id)}${daasField('Team',u.team)}${daasField('Persona',u.persona)}${daasField('Organisation unit',u.organisation_unit)}${daasField('Corporate grade',u.corporate_grade)}${daasField('Job description',u.employee_job_description)}${daasField('BA2',u.ba2)}${daasField('BA3',u.ba3)}${daasField('BA4',u.ba4)}${daasField('BA5',u.ba5)}${daasField('BA6',u.ba6)}${daasField('Leaver',u.leaver,true)}${daasField('Out of office',u.out_of_office,true)}</div><div class="daas-device-list">${d.devices.map(x=>`<button data-daas-device="${esc(x.machine_name)}"><b>${esc(x.machine_name)}</b><span class="${daasClass(x.device_online)}">${esc(daasValue(x.device_online))}</span><span>${esc(daasValue(x.data_centre))}</span></button>`).join('')}</div>`;host.appendChild(block);block.querySelectorAll('[data-daas-device]').forEach(b=>b.onclick=e=>{e.preventDefault();setTarget(b.dataset.daasDevice,'DaaS device')})}
async function loadDaaSMachine(machine){if(!machine)return;try{daasState.machines[machine]=await api('/api/daas/machine/'+encodeURIComponent(machine));renderDaaSMachines()}catch(e){console.warn('DaaS machine lookup failed',e)}}
function renderDaaSMachines(){document.querySelectorAll('#machines [data-machine]').forEach(card=>{const m=S.machines[Number(card.dataset.machine)];if(!m)return;const old=card.querySelector('.daas-machine-details');if(old)old.remove();const d=daasState.machines[m.name];if(!d||!d.matched||!d.device)return;const x=d.device;const details=document.createElement('details');details.className='daas-machine-details';details.innerHTML=`<summary>DaaS details</summary><div class="daas-grid machine-daas-grid">${daasField('Location',[x.data_centre,x.hall,x.cabinet,x.shelf,x.slot].filter(Boolean).join(' / '))}${daasField('Asset',x.asset_tag)}${daasField('Serial',x.serial)}${daasField('Device type',x.device_type)}${daasField('Scope',x.scope_allocation)}${daasField('Online',x.device_online,true)}${daasField('Citrix',x.registered_status,true)}${daasField('Last connected',x.last_connected)}${daasField('Last user',x.last_user)}${daasField('Maintenance',x.maintenance_mode,true)}${daasField('Storage',x.hard_drive_capacity)}${daasField('Free disk',x.free_disk_space)}${daasField('CPU',x.cpu)}${daasField('CPU temp',x.cpu_temp)}${daasField('OS',x.os_version)}${daasField('BIOS',x.bios)}${daasField('EMA',x.ema_provisioning,true)}${daasField('Power outlet',x.power_outlet)}${daasField('Switch',x.switch_name)}${daasField('Removal flag',x.device_to_remove,true)}${daasField('Comments',x.comments)}</div>`;details.onclick=e=>e.stopPropagation();card.appendChild(details)})}
function queueDaaSMachineLookups(){(S.machines||[]).forEach(m=>{if(m.name&&!daasState.machines[m.name])loadDaaSMachine(m.name)})}
const daasKycObserver=new MutationObserver(()=>{if(S.user)loadDaaSUser()});const daasMachineObserver=new MutationObserver(()=>queueDaaSMachineLookups());
function bindDaaSIntegration(){loadDaaSStatus();const k=document.querySelector('#kyc'),m=document.querySelector('#machines');if(k)daasKycObserver.observe(k,{childList:true,subtree:true});if(m)daasMachineObserver.observe(m,{childList:true,subtree:true});if(S.user)loadDaaSUser();queueDaaSMachineLookups()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bindDaaSIntegration);else bindDaaSIntegration();


/* V2.6 QOL OPTIMISER */
let daasBatchTimer=null,daasBatchSignature='';
async function loadDaaSMachinesBatch(){
  const names=[...new Set((S.machines||[]).map(x=>x.name).filter(Boolean))];
  const signature=names.slice().sort().join('|');
  if(!names.length||signature===daasBatchSignature)return;
  daasBatchSignature=signature;
  try{
    const response=await api('/api/daas/machines',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({computers:names})});
    Object.entries(response.machines||{}).forEach(([name,value])=>{
      const actual=names.find(x=>x.toLowerCase()===name.toLowerCase())||name;
      daasState.machines[actual]={available:response.available,...value};
    });
    renderDaaSMachines();
  }catch(error){console.warn('DaaS batch lookup failed',error)}
}
queueDaaSMachineLookups=function(){clearTimeout(daasBatchTimer);daasBatchTimer=setTimeout(loadDaaSMachinesBatch,40)};
function bindQoLActions(){
  const menu=document.querySelector('#targetActions');if(!menu)return;
  menu.addEventListener('click',event=>{
    const button=event.target.closest('[data-qol-action]');if(!button)return;
    event.preventDefault();event.stopPropagation();
    const action=button.dataset.qolAction;
    if(action==='copy-host')copy(S.target,'Hostname');
    else if(action==='copy-summary')copy(supportSummary(),'Support summary');
    else if(action==='admin')page('admin');
    else if(action==='queue')addQueue();
    else if(action==='health')refreshTargetHealth();
    else if(action==='cleanup')cleanPackages();
  });
}
function mergeUserDetailPanels(){
  const directory=document.querySelector('#kyc details.details:not(.daas-details)');
  const daas=document.querySelector('#daasUserDetails');
  if(!directory||!daas||directory.dataset.mergedDaas)return;
  const daasGrid=daas.querySelector('.daas-grid'),deviceList=daas.querySelector('.daas-device-list');
  if(daasGrid){
    const section=document.createElement('div');section.className='combined-detail-section';section.innerHTML='<h4>DAAS</h4>';
    section.appendChild(daasGrid);if(deviceList)section.appendChild(deviceList);directory.appendChild(section);
    directory.querySelector('summary').childNodes[0].textContent='User details ';
    directory.dataset.mergedDaas='1';daas.remove();
  }
}
const qolMergeObserver=new MutationObserver(()=>mergeUserDetailPanels());
function initQoL(){bindQoLActions();const kyc=document.querySelector('#kyc');if(kyc)qolMergeObserver.observe(kyc,{childList:true,subtree:true});mergeUserDetailPanels();queueDaaSMachineLookups()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initQoL);else initQoL();


/* ACTIVE DEPLOYMENTS V2.6.1 */
let deploymentMonitorTimer=null;
let deploymentMonitorMode='active';
function terminalLines(events){
  return (events||[]).map(event=>`[${event.time||'--:--:--'}] ${event.message||''}${event.log?'\n'+event.log.join('\n'):''}`).join('\n')||'Waiting for terminal output...';
}
function deploymentCard(item){
  if(item.kind==='queue'){
    const rows=(item.items||[]).map(row=>`<div class="deployment-queue-item"><b>${esc(row.target||'Unknown target')}</b><span>${esc(row.package||'')} · ${esc(row.action||'')}</span><i class="${statusAccent(row.state)}">${esc(row.state||'waiting')}</i><details><summary>Terminal</summary><pre>${esc(terminalLines(row.events))}</pre></details></div>`).join('');
    return `<article class="deployment-monitor-card"><header><b>Queue</b><span class="${statusAccent(item.state)}">${esc(item.state)}</span></header>${rows||'<p class="empty">Queue has no items</p>'}</article>`;
  }
  return `<article class="deployment-monitor-card"><header><b>Deployment ${esc(item.id.slice(0,8))}</b><span class="${statusAccent(item.state)}">${esc(item.state)}</span></header><p>${esc(item.last_message||'')}</p><pre>${esc(terminalLines(item.events))}</pre></article>`;
}
function renderDeploymentMonitor(data){
  const list=document.querySelector('#deploymentsList');
  const count=data.count??(data.deployments||[]).filter(x=>['queued','running','launched','monitoring','paused'].includes(x.state)).length;
  document.querySelector('#deploymentsCount').textContent=count;
  document.querySelector('#deploymentsToggle').classList.toggle('has-active',count>0);
  list.innerHTML=(data.deployments||[]).length?(data.deployments||[]).map(deploymentCard).join(''):'<p class="empty">No ongoing deployments</p>';
  list.querySelectorAll('pre').forEach(pre=>pre.scrollTop=pre.scrollHeight);
}
async function refreshDeploymentMonitor(mode=deploymentMonitorMode){
  deploymentMonitorMode=mode;
  try{
    const data=await api(mode==='recent'?'/api/deployments/recent':'/api/deployments/active');
    renderDeploymentMonitor(data);
    document.querySelector('#deploymentsState').textContent=mode==='recent'?'Recent':'Live';
  }catch(error){document.querySelector('#deploymentsList').innerHTML=`<p class="status-bad">${esc(error.message)}</p>`}
  clearTimeout(deploymentMonitorTimer);
  if(document.querySelector('#autoDeployments').checked)deploymentMonitorTimer=setTimeout(()=>refreshDeploymentMonitor(deploymentMonitorMode),1500);
}
function openDeploymentMonitor(mode='active'){
  document.querySelector('#deploymentsDrawer').classList.add('open');
  refreshDeploymentMonitor(mode);
}
function closeDeploymentMonitor(){
  document.querySelector('#deploymentsDrawer').classList.remove('open');
  clearTimeout(deploymentMonitorTimer);
}
function bindDeploymentMonitor(){
  document.querySelector('#deploymentsToggle').onclick=()=>openDeploymentMonitor('active');
  document.querySelector('#closeDeployments').onclick=closeDeploymentMonitor;
  document.querySelector('#refreshDeployments').onclick=()=>refreshDeploymentMonitor('active');
  document.querySelector('#showRecentDeployments').onclick=()=>refreshDeploymentMonitor('recent');
  document.querySelector('#autoDeployments').onchange=()=>refreshDeploymentMonitor(deploymentMonitorMode);
  commands.push(
    ['Open ongoing deployments','Ctrl+Shift+L',()=>openDeploymentMonitor('active')],
    ['Open recent deployment logs','',()=>openDeploymentMonitor('recent')],
    ['Refresh deployment monitor','',()=>refreshDeploymentMonitor('active')],
    ['Open deployment queue','',()=>document.querySelector('#queueDrawer').classList.add('open')]
  );
  document.addEventListener('keydown',event=>{
    if(event.ctrlKey&&event.shiftKey&&event.key.toLowerCase()==='l'){
      event.preventDefault();openDeploymentMonitor('active');
    }
  });
  refreshDeploymentMonitor('active');
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bindDeploymentMonitor);else bindDeploymentMonitor();


/* BOTTOM DOCK V2.6.2 */
function bindBottomDock(){
  const nav=document.querySelector('aside nav');
  if(!nav)return;
  nav.setAttribute('aria-label','Primary navigation');
  document.querySelectorAll('nav [data-page]').forEach(button=>{
    button.title=button.querySelector('.nav-label')?.textContent||button.textContent.trim();
  });
  if(typeof commands!=='undefined'){
    const existing=new Set(commands.map(item=>item[0]));
    [
      ['Go to Workspace','Alt+1',()=>page('workspace')],
      ['Go to Remote Admin','Alt+2',()=>page('admin')],
      ['Go to Bulk Deploy','Alt+3',()=>page('bulk')],
      ['Go to History','Alt+4',()=>page('history')]
    ].forEach(command=>{if(!existing.has(command[0]))commands.push(command)});
  }
  document.addEventListener('keydown',event=>{
    if(!event.altKey||event.ctrlKey||event.shiftKey)return;
    const map={'1':'workspace','2':'admin','3':'bulk','4':'history'};
    if(map[event.key]){event.preventDefault();page(map[event.key])}
  });
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bindBottomDock);else bindBottomDock();


/* PALETTE SHORTCUTS V2.6.3 */
const shortcutRegistry=[
  {label:'Open command palette',keys:'Ctrl+K',run:()=>openPalette()},
  {label:'Focus search',keys:'/',run:()=>document.querySelector('#search').focus()},
  {label:'Workspace',keys:'Alt+1',run:()=>page('workspace')},
  {label:'Remote Admin',keys:'Alt+2',run:()=>page('admin')},
  {label:'Bulk Deploy',keys:'Alt+3',run:()=>page('bulk')},
  {label:'History',keys:'Alt+4',run:()=>page('history')},
  {label:'Deploy selected package',keys:'Ctrl+D',run:()=>deploy('full')},
  {label:'Copy package only',keys:'Ctrl+Shift+D',run:()=>deploy('copy')},
  {label:'Open MSRA',keys:'Ctrl+M',run:()=>openTargetTool('msra')},
  {label:'Open C$ share',keys:'Ctrl+Shift+C',run:()=>openTargetTool('cshare')},
  {label:'Open ongoing deployments',keys:'Ctrl+Shift+L',run:()=>openDeploymentMonitor('active')},
  {label:'Open deployment queue',keys:'Ctrl+Shift+Q',run:()=>document.querySelector('#queueDrawer').classList.add('open')},
  {label:'Refresh target health',keys:'Ctrl+Shift+H',run:()=>refreshTargetHealth()},
  {label:'Copy support summary',keys:'Ctrl+Shift+S',run:()=>copy(supportSummary(),'Support summary')},
  {label:'Close palette / menu / drawer',keys:'Esc',run:()=>closeAllOverlays()},
  {label:'Show keyboard shortcuts',keys:'?',run:()=>openShortcutHelp()}
];
function normaliseKeys(value){return String(value||'').replace(/\s+/g,'').toLowerCase()}
function ensurePaletteShortcuts(){
  if(typeof commands==='undefined')return;
  const byLabel=new Map(commands.map(item=>[String(item[0]).toLowerCase(),item]));
  shortcutRegistry.forEach(shortcut=>{
    const existing=byLabel.get(shortcut.label.toLowerCase());
    if(existing){existing[1]=shortcut.keys;existing[2]=shortcut.run}
    else commands.push([shortcut.label,shortcut.keys,shortcut.run]);
  });
}
function renderShortcutHelp(){
  const host=document.querySelector('#shortcutHelpList');if(!host)return;
  host.innerHTML=shortcutRegistry.map(item=>`<button data-shortcut-label="${esc(item.label)}"><span>${esc(item.label)}</span><kbd>${esc(item.keys)}</kbd></button>`).join('');
  host.querySelectorAll('[data-shortcut-label]').forEach(button=>button.onclick=()=>{
    const item=shortcutRegistry.find(x=>x.label===button.dataset.shortcutLabel);closeShortcutHelp();if(item)item.run();
  });
}
function openShortcutHelp(){renderShortcutHelp();document.querySelector('#shortcutHelp').classList.remove('hidden')}
function closeShortcutHelp(){document.querySelector('#shortcutHelp').classList.add('hidden')}
function closeAllOverlays(){
  closePalette();closeShortcutHelp();
  document.querySelector('#machineMenu')?.classList.add('hidden');
  document.querySelector('#queueDrawer')?.classList.remove('open');
  if(typeof closeDeploymentMonitor==='function')closeDeploymentMonitor();
}
function shortcutEventKey(event){
  const parts=[];if(event.ctrlKey)parts.push('ctrl');if(event.shiftKey)parts.push('shift');if(event.altKey)parts.push('alt');
  let key=event.key.toLowerCase();if(key===' ')key='space';if(key==='?'&&!event.ctrlKey&&!event.altKey&&!event.metaKey)return '?';parts.push(key);return parts.join('+');
}
function bindPaletteShortcuts(){
  ensurePaletteShortcuts();
  document.querySelector('#closeShortcutHelp').onclick=closeShortcutHelp;
  document.querySelector('#shortcutHelp').onclick=event=>{if(event.target.id==='shortcutHelp')closeShortcutHelp()};
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'){closeAllOverlays();return}
    const active=document.activeElement;const isTyping=active&&['INPUT','TEXTAREA','SELECT'].includes(active.tagName);
    if(isTyping&&normaliseKeys(shortcutEventKey(event))!=='ctrl+k')return;
    const pressed=normaliseKeys(shortcutEventKey(event));
    const item=shortcutRegistry.find(x=>normaliseKeys(x.keys)===pressed);
    if(item){event.preventDefault();event.stopImmediatePropagation();Promise.resolve(item.run()).catch(e=>toast(e.message))}
  },true);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bindPaletteShortcuts);else bindPaletteShortcuts();


/* GEEK TERMINAL UI V2.7 */
function terminalPageName(){const active=document.querySelector('nav [data-page].active');return (active?.dataset.page||'workspace').toUpperCase()}
function updateTerminalStatus(){
  const now=new Date();
  const clock=document.querySelector('#terminalClock');if(clock)clock.textContent=now.toLocaleTimeString('en-GB',{hour12:false});
  const target=document.querySelector('#terminalTarget');if(target)target.textContent='TARGET:'+(S.target||'NONE');
  const mode=document.querySelector('#terminalMode');if(mode)mode.textContent='MODE:'+terminalPageName();
}
function bindTerminalUI(){
  document.body.classList.add('terminal-ui');
  updateTerminalStatus();setInterval(updateTerminalStatus,1000);
  const title=document.querySelector('#pageTitle');if(title&&!title.dataset.terminalTitle){title.dataset.terminalTitle='1'}
  const observer=new MutationObserver(updateTerminalStatus);const nav=document.querySelector('nav');if(nav)observer.observe(nav,{attributes:true,subtree:true,attributeFilter:['class']});
  if(typeof commands!=='undefined'&&!commands.some(x=>x[0]==='Toggle terminal scanlines')){
    commands.push(['Toggle terminal scanlines','',()=>document.body.classList.toggle('no-scanlines')]);
  }
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bindTerminalUI);else bindTerminalUI();


/* SIMPLE DARK UI V2.7.1 */
function applySimpleDarkUI(){
  document.body.classList.remove('terminal-ui','material-you','material-light');
  document.body.classList.add('minimal-ui','simple-dark-ui');
  const terminalBar=document.querySelector('#terminalStatusBar');if(terminalBar)terminalBar.remove();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',applySimpleDarkUI);else applySimpleDarkUI();


/* V2.8 OPERATIONS AND AESTHETICS */
const v28={software:new Map(),currentSoftware:[],softwareTarget:'',health:null};
const v28Icons={
 workspace:'<svg viewBox="0 0 24 24"><path d="M3 11.5 12 4l9 7.5v8a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
 admin:'<svg viewBox="0 0 24 24"><path d="M4 5h16v11H4zM8 20h8M12 16v4"/></svg>',
 bulk:'<svg viewBox="0 0 24 24"><path d="M5 4h14v4H5zM5 10h14v4H5zM5 16h14v4H5z"/></svg>',
 history:'<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6M4 4v4.6h4.6M12 7v5l3 2"/></svg>'
};
function applyV28Dock(){document.querySelectorAll('nav [data-page]').forEach(button=>{const pageName=button.dataset.page;const label=button.querySelector('.nav-label')?.textContent||button.title||pageName;button.title=label;button.setAttribute('aria-label',label);button.innerHTML=`<span class="nav-icon">${v28Icons[pageName]||''}</span><span class="nav-label">${esc(label)}</span>`})}
function formatUptime(seconds){if(seconds===null||seconds===undefined)return '—';const d=Math.floor(seconds/86400),h=Math.floor((seconds%86400)/3600),m=Math.floor((seconds%3600)/60);return `${d}d ${String(h).padStart(2,'0')}h ${String(m).padStart(2,'0')}m`}
refreshTargetHealth=async function(){if(!S.target)return;const pc=S.target;const line=document.querySelector('#healthLine');line.classList.remove('hidden');line.textContent=`${S.target} | CHECKING...`;try{const d=await api('/api/v28/health/'+encodeURIComponent(pc));if(S.target!==pc)return;lastHealth=d;v28.health=d;line.innerHTML=`<b>${esc(S.target)}</b><span class="${d.ping?'status-ok':'status-bad'}">PING ${d.ping?'OK':'NO'}</span><span class="${d.c_share?'status-ok':'status-bad'}">C$ ${d.c_share?'OK':'NO'}</span><span class="${d.wmi?'status-ok':'status-bad'}">WMI ${d.wmi?'OK':'NO'}</span><span>${d.free_gb??'—'} GB FREE</span><span class="boot-info">BOOT ${esc(d.last_boot||'—')}</span><span class="uptime-info">UP ${esc(formatUptime(d.uptime_seconds))}</span><span>${esc(d.logged_on||'NO LOGGED-ON USER')}</span><button id="refreshHealth">Refresh</button>`;document.querySelector('#refreshHealth').onclick=refreshTargetHealth}catch(error){if(S.target===pc)line.textContent=`${pc} | HEALTH CHECK FAILED`}}
function makeSwitch(input){if(!input||input.dataset.switchReady)return;input.dataset.switchReady='1';input.classList.add('switch-input');const visual=document.createElement('span');visual.className='switch-visual';visual.innerHTML='<i></i><b></b>';input.insertAdjacentElement('afterend',visual);const update=()=>{visual.classList.toggle('on',input.checked);visual.querySelector('b').textContent=input.checked?'ON':'OFF';input.setAttribute('aria-checked',String(input.checked))};input.addEventListener('change',update);update()}
function applySwitches(){document.querySelectorAll('input[type="checkbox"]').forEach(makeSwitch)}
const v28SwitchObserver=new MutationObserver(records=>{
  for(const record of records)for(const node of record.addedNodes){
    if(node.nodeType!==1)continue;
    if(node.matches('input[type="checkbox"]'))makeSwitch(node);
    node.querySelectorAll('input[type="checkbox"]').forEach(makeSwitch);
  }
});
function normaliseSoftwareName(value){return String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()}
function softwareRows(){const q=normaliseSoftwareName(document.querySelector('#softwareFilter').value);return v28.currentSoftware.filter(x=>!q||normaliseSoftwareName([x.Name,x.Version,x.Publisher].join(' ')).includes(q))}
function renderSoftware(){const rows=softwareRows();document.querySelector('#softwareSummary').textContent=`${rows.length} of ${v28.currentSoftware.length} applications · collected ${v28.softwareTarget&&v28.software.get(v28.softwareTarget)?.collected_at||'—'}`;document.querySelector('#softwareBody').innerHTML=rows.map(x=>`<tr><td>${esc(x.Name||'')}</td><td>${esc(x.Version||'')}</td><td>${esc(x.Publisher||'')}</td><td>${esc(x.InstallDate||'')}</td><td>${esc(x.Architecture||'')}</td></tr>`).join('');updatePackagePresence()}
async function loadSoftware(pc,force=false){if(!pc)return toast('Select a target');document.querySelector('#softwareDrawer').classList.add('open');document.querySelector('#softwareTarget').textContent=pc;document.querySelector('#softwareSummary').textContent='Collecting registry inventory...';v28.softwareTarget=pc;if(!force&&v28.software.has(pc)){const cached=v28.software.get(pc);v28.currentSoftware=cached.software||[];renderSoftware();return}try{const data=await api('/api/v28/software/'+encodeURIComponent(pc));v28.software.set(pc,data);if(v28.softwareTarget!==pc)return;v28.currentSoftware=data.software||[];renderSoftware()}catch(error){document.querySelector('#softwareSummary').innerHTML=`<span class="status-bad">${esc(error.message)}</span>`}}
function softwareReport(rows=softwareRows()){const data=v28.software.get(v28.softwareTarget)||{};return [`Target: ${v28.softwareTarget}`,`Collected: ${data.collected_at||''}`,`Applications: ${rows.length}`,'',...rows.map(x=>[x.Name,x.Version,x.Publisher,x.InstallDate,x.Architecture].filter(Boolean).join(' | '))].join('\n')}
function exportSoftwareCsv(){const rows=softwareRows(),headers=['Name','Version','Publisher','InstallDate','InstallLocation','Architecture'];const csv=[headers.join(','),...rows.map(row=>headers.map(h=>'"'+String(row[h]||'').replace(/"/g,'""')+'"').join(','))].join('\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download=`${v28.softwareTarget}_installed_software.csv`;a.click();URL.revokeObjectURL(a.href)}
function updatePackagePresence(){const host=document.querySelector('#packagePresence');if(!host)return;const packageName=document.querySelector('#pkg')?.value;if(!packageName||!S.target){host.innerHTML='';return}const cached=v28.software.get(S.target);if(!cached){host.innerHTML='<span class="status-neutral">Software status not collected</span><button id="checkPackagePresence">Check</button>';document.querySelector('#checkPackagePresence').onclick=()=>loadSoftware(S.target);return}const p=normaliseSoftwareName(packageName),matches=(cached.software||[]).filter(x=>{const n=normaliseSoftwareName(x.Name);return n&&p&&(n.includes(p)||p.includes(n))});host.innerHTML=matches.length?`<span class="status-ok">INSTALLED</span><b>${matches.slice(0,3).map(x=>esc(`${x.Name} ${x.Version||''}`)).join(' · ')}</b>`:'<span class="status-warn">NOT FOUND IN REGISTRY INVENTORY</span>'}
function completeMachineReport(){const machine=(S.machines||[]).find(x=>x.name===S.target)||{},user=S.user||{},d=daasState?.machines?.[S.target]?.device||{},health=v28.health||lastHealth||{},software=v28.software.get(S.target);return [`WMI Packager machine report`,`Generated: ${new Date().toLocaleString('en-GB')}`,`Target: ${S.target||''}`,`User: ${user.name||''}`,`Username: ${user.user_name||''}`,`Domain account: ${domainAccountFromDaaS()}`,`Email: ${user.email||''}`,`ServiceFirst status: ${machine.operational_status||''}`,`Ping: ${health.ping?'OK':'NO'}`,`C$: ${health.c_share?'OK':'NO'}`,`WMI: ${health.wmi?'OK':'NO'}`,`Free C: ${health.free_gb??''} GB`,`Last boot: ${health.last_boot||''}`,`Uptime: ${formatUptime(health.uptime_seconds)}`,`Logged on: ${health.logged_on||''}`,`DaaS location: ${[d.data_centre,d.hall,d.cabinet,d.shelf,d.slot].filter(Boolean).join(' / ')}`,`DaaS Citrix: ${d.registered_status||''}`,`DaaS online: ${d.device_online||''}`,`Software inventory: ${software?software.count+' applications':'not collected'}`].join('\n')}
function domainAccountFromDaaS(){const login=daasState?.user?.users?.[0]?.login_id||S.user?.user_name||'';if(!login)return '';return login.includes('\\')?login:`INTRANET\\${login}`}
function injectDomainAccount(){const card=document.querySelector('#kyc .usercard');if(!card||card.querySelector('.domain-account-fact'))return;const login=domainAccountFromDaaS();if(!login)return;const facts=card.querySelector('.facts');if(facts){const span=document.createElement('span');span.className='domain-account-fact';span.innerHTML=`Domain account<b>${esc(login)}</b>`;facts.appendChild(span)}const bar=card.querySelector('.copybar');if(bar){const b=document.createElement('button');b.textContent='Copy domain account';b.onclick=()=>copy(login,'Domain account');bar.appendChild(b)}}
const v28BaseRenderDaaSUser=renderDaaSUser;renderDaaSUser=function(){v28BaseRenderDaaSUser();injectDomainAccount()};
const v28BaseMachineContext=machineContext;machineContext=function(event,index){v28BaseMachineContext(event,index);const menu=document.querySelector('#machineMenu'),m=S.machines[index];if(!menu||!m)return;const software=document.createElement('button');software.textContent='Software inventory';software.onclick=()=>{setTarget(m.name,m.operational_status);menu.classList.add('hidden');loadSoftware(m.name)};const report=document.createElement('button');report.textContent='Copy complete machine report';report.onclick=()=>{setTarget(m.name,m.operational_status);menu.classList.add('hidden');copy(completeMachineReport(),'Machine report')};menu.append(software,report)};
function bindV28(){applyV28Dock();applySwitches();v28SwitchObserver.observe(document.body,{childList:true,subtree:true});document.querySelector('#closeSoftware').onclick=()=>document.querySelector('#softwareDrawer').classList.remove('open');document.querySelector('#refreshSoftware').onclick=()=>loadSoftware(v28.softwareTarget||S.target,true);document.querySelector('#copySoftware').onclick=()=>copy(softwareReport(),'Software report');document.querySelector('#exportSoftware').onclick=exportSoftwareCsv;document.querySelector('#softwareFilter').oninput=renderSoftware;document.querySelector('#pkg')?.addEventListener('change',updatePackagePresence);commands.push(['Open software inventory','Ctrl+Shift+I',()=>loadSoftware(S.target)],['Copy complete machine report','Ctrl+Shift+R',()=>copy(completeMachineReport(),'Machine report')]);document.addEventListener('keydown',event=>{if(event.ctrlKey&&event.shiftKey&&event.key.toLowerCase()==='i'){event.preventDefault();loadSoftware(S.target)}if(event.ctrlKey&&event.shiftKey&&event.key.toLowerCase()==='r'){event.preventDefault();copy(completeMachineReport(),'Machine report')}});if(S.target)refreshTargetHealth()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bindV28);else bindV28();


/* UPTIME 8 DAY ALERT V2.8.7 */
const UPTIME_RED_THRESHOLD_SECONDS = 8 * 24 * 60 * 60;

function uptimeSecondsFromText(value) {
  const match = String(value || '').match(/UP\s+(\d+)d\s+(\d+)h\s+(\d+)m/i);
  if (!match) return null;
  return (Number(match[1]) * 86400) + (Number(match[2]) * 3600) + (Number(match[3]) * 60);
}

function applyUptimeAlert() {
  const uptime = document.querySelector('#healthLine .uptime-info');
  if (!uptime) return;

  const seconds = uptimeSecondsFromText(uptime.textContent);
  uptime.classList.remove('uptime-overdue', 'status-bad');

  if (seconds !== null && seconds > UPTIME_RED_THRESHOLD_SECONDS) {
    uptime.classList.add('uptime-overdue', 'status-bad');
    uptime.title = 'Uptime exceeds 8 days. Weekend restart may have been missed.';
    uptime.setAttribute('aria-label', uptime.textContent.trim() + '. Restart overdue.');
  } else {
    uptime.title = 'Machine uptime';
    uptime.setAttribute('aria-label', uptime.textContent.trim());
  }
}

const uptimeAlertObserver = new MutationObserver(applyUptimeAlert);
function bindUptimeAlert() {
  const healthLine = document.querySelector('#healthLine');
  if (healthLine) {
    uptimeAlertObserver.observe(healthLine, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }
  applyUptimeAlert();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindUptimeAlert);
} else {
  bindUptimeAlert();
}


/* QUICK GLANCE COLOURS V2.8.8 */
const QUICK_COLOUR={diskRed:10,diskYellow:20,uptimeYellowDays:7,uptimeRedDays:8};
function normAccount(value){return String(value||'').trim().toLowerCase().replace(/^intranet\\/,'')}
function setQuickState(node,state,title=''){if(!node)return;node.classList.remove('status-ok','status-warn','status-bad','status-neutral');node.classList.add('quick-state',`status-${state}`);if(title)node.title=title}
function parseDiskGB(node){const m=String(node?.textContent||'').match(/([\d.]+)\s*GB\s*FREE/i);return m?Number(m[1]):null}
function parseUptimeDays(node){const m=String(node?.textContent||'').match(/UP\s+(\d+)d/i);return m?Number(m[1]):null}
function applyHealthQuickColours(){
 const line=document.querySelector('#healthLine');if(!line)return;
 const spans=[...line.querySelectorAll('span')];
 const disk=spans.find(x=>/GB\s*FREE/i.test(x.textContent));const gb=parseDiskGB(disk);
 if(gb!==null)setQuickState(disk,gb<QUICK_COLOUR.diskRed?'bad':gb<=QUICK_COLOUR.diskYellow?'warn':'ok',gb<10?'Critical free disk space':gb<=20?'Low free disk space':'Disk space healthy');
 const up=line.querySelector('.uptime-info');const days=parseUptimeDays(up);
 if(days!==null)setQuickState(up,days>QUICK_COLOUR.uptimeRedDays?'bad':days>=QUICK_COLOUR.uptimeYellowDays?'warn':'ok',days>8?'Restart overdue':days>=7?'Weekend restart due soon':'Uptime within policy');
 const logged=spans.find(x=>/NO LOGGED-ON USER|^[A-Z0-9_.-]+\\/i.test(x.textContent.trim()));
 if(logged){const actual=normAccount(logged.textContent);const expected=new Set([normAccount(S.user?.user_name),normAccount(daasState?.user?.users?.[0]?.login_id)].filter(Boolean));setQuickState(logged,!actual||/no logged/i.test(logged.textContent)?'bad':expected.size&&expected.has(actual)?'ok':'warn',expected.size&&actual&&!expected.has(actual)?'Logged-on user differs from expected user':'Logged-on user state')}
}
function applyDaaSQuickColours(){
 document.querySelectorAll('.daas-grid>span').forEach(cell=>{const label=cell.querySelector('em')?.textContent.trim().toLowerCase()||'';const value=cell.querySelector('b');if(!value)return;const text=value.textContent.trim().toLowerCase();
  if(label.includes('online'))setQuickState(value,/^online$/.test(text)?'ok':/offline|unreachable/.test(text)?'bad':'warn');
  else if(label.includes('citrix')||label.includes('registered'))setQuickState(value,/^registered$/.test(text)?'ok':/unregistered/.test(text)?'bad':'warn');
  else if(label.includes('ema'))setQuickState(value,/^provisioned$/.test(text)?'ok':/not provisioned/.test(text)?'warn':'neutral');
  else if(label.includes('maintenance'))setQuickState(value,/^no$|^false$|^off$/.test(text)?'ok':/^yes$|^true$|^on$/.test(text)?'warn':'neutral');
  else if(label.includes('removal'))setQuickState(value,/^no$|^0$|^false$|^—$/.test(text)?'ok':text?'bad':'neutral');
  else if(label.includes('leaver'))setQuickState(value,/^no$|^false$/.test(text)?'ok':/^yes$|^true$/.test(text)?'bad':'warn');
  else if(label.includes('out of office'))setQuickState(value,/^no$|^false$|^—$/.test(text)?'ok':text?'warn':'neutral');
 })
}
function applyDomainMismatch(){const fact=document.querySelector('.domain-account-fact b');if(!fact)return;const service=normAccount(S.user?.user_name),daas=normAccount(daasState?.user?.users?.[0]?.login_id);if(service&&daas)setQuickState(fact,service===daas?'ok':'warn',service===daas?'ServiceFirst and DaaS domain IDs agree':'ServiceFirst and DaaS domain IDs differ');else setQuickState(fact,'warn','Domain ID available from one source only')}
function applyDeploymentCounterPriority(){const button=document.querySelector('#deploymentsToggle');if(!button)return;const cards=[...document.querySelectorAll('#deploymentsList .deployment-monitor-card')],texts=cards.map(x=>x.textContent.toLowerCase());button.classList.remove('counter-ok','counter-warn','counter-bad');if(texts.some(x=>/failed|failure|error|timeout|monitor failed/.test(x)))button.classList.add('counter-bad');else if(texts.some(x=>/waiting|queued|paused|monitoring/.test(x)))button.classList.add('counter-warn');else if(texts.some(x=>/running|launched|copying/.test(x)))button.classList.add('counter-ok')}
function applyPackageQuickColour(){const host=document.querySelector('#packagePresence');if(!host)return;const text=host.textContent.toLowerCase();if(/not found/.test(text))host.classList.add('package-bad');else host.classList.remove('package-bad')}
function applyAllQuickColours(){applyHealthQuickColours();applyDaaSQuickColours();applyDomainMismatch();applyDeploymentCounterPriority();applyPackageQuickColour()}
const quickColourObserver=new MutationObserver(()=>applyAllQuickColours());
function bindQuickColours(){['healthLine','kyc','machines','deploymentsList','packagePresence','dbFreshness','daasStatus'].forEach(id=>{const n=document.getElementById(id);if(n)quickColourObserver.observe(n,{childList:true,subtree:true,characterData:true})});applyAllQuickColours()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bindQuickColours);else bindQuickColours();


/* STABLE HEALTH BAR V2.8.9 */
/* Avoid re-running target selection and health checks when an action is
   performed on the machine that is already selected. */
const v289SetTarget = setTarget;
setTarget = function(pc, status = '') {
  const requested = String(pc || '').trim().toUpperCase();
  const current = String(S.target || '').trim().toUpperCase();

  if (requested && requested === current) {
    return;
  }

  return v289SetTarget(pc, status);
};

/* Keep the current health result visible while a manual refresh runs. */
const v289RefreshTargetHealth = refreshTargetHealth;
refreshTargetHealth = async function() {
  const line = document.querySelector('#healthLine');
  const hadResult = line && line.querySelector('.uptime-info');

  if (hadResult) {
    line.classList.add('health-refreshing');
    const oldRefresh = line.querySelector('#refreshHealth');
    if (oldRefresh) {
      oldRefresh.disabled = true;
      oldRefresh.textContent = 'Checking...';
    }
  }

  try {
    return await v289RefreshTargetHealth();
  } finally {
    const currentLine = document.querySelector('#healthLine');
    if (currentLine) currentLine.classList.remove('health-refreshing');
  }
};


/* FAST CORE SOFTWARE FIELDS V2.8.10 */
renderSoftware=function(){
  const rows=softwareRows();
  const collected=v28.softwareTarget&&v28.software.get(v28.softwareTarget)?.collected_at||'—';
  document.querySelector('#softwareSummary').textContent=`${rows.length} of ${v28.currentSoftware.length} applications · core fields · collected ${collected}`;
  document.querySelector('#softwareBody').innerHTML=rows.map(x=>`<tr><td>${esc(x.Name||'')}</td><td>${esc(x.Version||'')}</td><td>${esc(x.Publisher||'')}</td></tr>`).join('');
  updatePackagePresence();
};
softwareReport=function(rows=softwareRows()){
  const data=v28.software.get(v28.softwareTarget)||{};
  return [`Target: ${v28.softwareTarget}`,`Collected: ${data.collected_at||''}`,`Method: ${data.method||'WMI StdRegProv Core'}`,`Applications: ${rows.length}`,'',...rows.map(x=>[x.Name,x.Version,x.Publisher].filter(Boolean).join(' | '))].join('\n');
};
exportSoftwareCsv=function(){
  const rows=softwareRows(),headers=['Name','Version','Publisher'];
  const csv=[headers.join(','),...rows.map(row=>headers.map(h=>'"'+String(row[h]||'').replace(/"/g,'""')+'"').join(','))].join('\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download=`${v28.softwareTarget}_installed_software_core.csv`;a.click();URL.revokeObjectURL(a.href);
};


/* PROMINENT SEARCH V2.8.11 */
function applyProminentSearch(){
 const box=document.querySelector('.searchbox'),input=document.querySelector('#search');if(!box||!input)return;
 box.classList.add('prominent-search');input.setAttribute('aria-label','Search users, email addresses or machines');input.placeholder='Search user, full name, email or machine...';
 if(!box.querySelector('.search-leading-icon')){const icon=document.createElement('span');icon.className='search-leading-icon';icon.setAttribute('aria-hidden','true');icon.innerHTML='<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"></circle><path d="m16.5 16.5 4 4"></path></svg>';box.prepend(icon)}
 const update=()=>box.classList.toggle('has-value',Boolean(input.value.trim()));input.addEventListener('input',update);input.addEventListener('focus',()=>box.classList.add('search-focused'));input.addEventListener('blur',()=>box.classList.remove('search-focused'));update();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',applyProminentSearch);else applyProminentSearch();


/* SEARCH TEXT ONLY V2.8.13 */
function removeSearchLeadingIcon(){
  document.querySelectorAll('.search-leading-icon').forEach(icon=>icon.remove());
  document.querySelector('.searchbox')?.classList.add('search-text-only');
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',removeSearchLeadingIcon);else removeSearchLeadingIcon();


/* FRONTEND SIMPLIFICATION V2.9 */
/* Disable the experimental reverse-lookup interception. Normal search remains active. */
if(typeof looksLikeComputer==='function')looksLikeComputer=function(){return false};

function simplifyFrontend(){
  document.body.classList.add('simple-v29');
  document.querySelectorAll('.daas-source-badge').forEach(node=>node.remove());
  document.querySelectorAll('.daas-only-machine').forEach(node=>node.classList.remove('daas-only-machine'));
  document.querySelectorAll('#machineMenu button').forEach(button=>{
    if(button.textContent.trim()==='Set as target')button.textContent='Select';
  });
}

const simpleV29Observer=new MutationObserver(simplifyFrontend);
function bindSimpleV29(){
  simplifyFrontend();
  ['kyc','machines','machineMenu'].forEach(id=>{
    const node=document.getElementById(id);if(node)simpleV29Observer.observe(node,{childList:true,subtree:true});
  });
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bindSimpleV29);else bindSimpleV29();


/* MASTERDB HYBRID MIGRATION V3.0 */
const masterState={status:null,resolution:null,running:false};
async function loadMasterStatus(){try{const d=await api('/api/master/status');masterState.status=d;const el=document.querySelector('#masterDbStatus');if(el)el.innerHTML=d.available?`<b class="status-ok">MASTER DB ONLINE</b><span>${d.users.toLocaleString()} users</span><span>${d.machines.toLocaleString()} machines</span><span>${d.assignments.toLocaleString()} links</span>`:'<b class="status-bad">MASTER DB ERROR</b>'}catch(e){console.warn('MasterDB status failed',e)}}
function bindMasterDB(){loadMasterStatus()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bindMasterDB);else bindMasterDB();

/* COMPACT MAIN WORKSPACE V3.0.1 */
function applyCompactWorkspace(){
  document.body.classList.add('compact-main-v301');

  const workspace=document.querySelector('[data-page-content="workspace"], #workspace');
  if(workspace)workspace.classList.add('compact-workspace');

  document.querySelectorAll('#kyc details, #machines details').forEach(details=>{
    if(!details.hasAttribute('data-user-opened')) details.open=false;
    if(details.dataset.compactBound)return;
    details.dataset.compactBound='1';
    details.addEventListener('toggle',()=>{
      if(details.open)details.setAttribute('data-user-opened','1');
    });
  });
}

const compactWorkspaceObserver=new MutationObserver(applyCompactWorkspace);
function bindCompactWorkspace(){
  applyCompactWorkspace();
  ['kyc','machines'].forEach(id=>{
    const node=document.getElementById(id);
    if(node)compactWorkspaceObserver.observe(node,{childList:true,subtree:true});
  });
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bindCompactWorkspace);else bindCompactWorkspace();



/* Catalogue evidence and explicit deployment summary. No automatic target choice added. */
let consoleCatalogueRequest=0;
async function refreshConsolePackage(){
 const folder=document.querySelector('#pkg')?.value,host=document.querySelector('#console-package-details'),v=++consoleCatalogueRequest;if(!host)return;host.textContent='';if(!folder)return;
 try{const d=await api('/api/catalog/details?folder='+encodeURIComponent(folder));if(v!==consoleCatalogueRequest||folder!==document.querySelector('#pkg').value)return;host.textContent=`${d.display_name||folder} · ${d.version||'Version not recorded'} · ${d.availability} · ${d.files_checked} files checked${d.complete?'':' · scan incomplete'}. External script dependencies are not checked.`}catch(e){if(v===consoleCatalogueRequest)host.textContent='Package inspection unavailable: '+e.message}
}
function refreshConsoleSummary(){const host=document.querySelector('#console-deploy-summary');if(host)host.textContent=`${S.user?.full_name||S.user?.name||'No directory user'} → ${S.target||'Choose a machine'} → ${document.querySelector('#pkg')?.selectedOptions[0]?.textContent||'Choose a package'} → ${document.querySelector('#action')?.value||''} → ${document.querySelector('#script')?.value||'Choose a script'}`}
document.addEventListener('DOMContentLoaded',()=>{
 document.querySelector('#pkg').addEventListener('change',()=>{refreshConsolePackage();refreshConsoleSummary()});document.querySelector('#action').addEventListener('change',refreshConsoleSummary);document.querySelector('#script').addEventListener('change',refreshConsoleSummary);
 new MutationObserver(()=>{refreshConsolePackage();refreshConsoleSummary()}).observe(document.querySelector('#pkg'),{childList:true});
 new MutationObserver(refreshConsoleSummary).observe(document.querySelector('#deployTarget'),{childList:true});
 new MutationObserver(refreshConsoleSummary).observe(document.querySelector('#script'),{childList:true});
 refreshConsoleSummary();
});

/* Console presentation: click disclosures and consistent panel focus. */
function bindConsolePolish(){
  document.querySelector('nav [data-page].active')?.setAttribute('aria-current','page');
  document.querySelectorAll('.nav-icon').forEach(el=>el.setAttribute('aria-hidden','true'));
  const menus=[...document.querySelectorAll('.toolmenu')];
  function closeMenus(){menus.forEach(m=>{m.classList.remove('menu-open');m.querySelector('.toolmenu-btn').setAttribute('aria-expanded','false')})}
  menus.forEach(m=>{
    const trigger=m.querySelector('.toolmenu-btn'),content=m.querySelector('.toolmenu-content');
    content.id=m.id+'-content';trigger.setAttribute('aria-controls',content.id);trigger.setAttribute('aria-expanded','false');
    trigger.addEventListener('click',()=>{const open=!m.classList.contains('menu-open');closeMenus();if(open){m.classList.add('menu-open');trigger.setAttribute('aria-expanded','true')}});
    trigger.addEventListener('keydown',e=>{if(e.key==='ArrowDown'){e.preventDefault();closeMenus();m.classList.add('menu-open');trigger.setAttribute('aria-expanded','true');content.querySelector('button')?.focus()}});
    content.addEventListener('click',e=>{if(e.target.closest('button'))closeMenus()});
    m.addEventListener('focusout',()=>queueMicrotask(()=>{if(!m.contains(document.activeElement)){m.classList.remove('menu-open');trigger.setAttribute('aria-expanded','false')}}));
  });
  document.addEventListener('click',e=>{if(!e.target.closest('.toolmenu'))closeMenus()});
  const panels=[...document.querySelectorAll('#queueDrawer,#deploymentsDrawer,#softwareDrawer')];
  let active=null,returnFocus=null;
  const toggles={queueDrawer:'queueToggle',deploymentsDrawer:'deploymentsToggle'};
  panels.forEach(p=>{
    p.setAttribute('role','dialog');p.setAttribute('aria-label',p.querySelector('b').textContent);p.setAttribute('tabindex','-1');
    const close=p.querySelector('[id^="close"]');close.setAttribute('aria-label','Close '+p.getAttribute('aria-label').toLowerCase());close.title=close.getAttribute('aria-label');
    const t=document.getElementById(toggles[p.id]);if(t){t.setAttribute('aria-controls',p.id);t.setAttribute('aria-expanded','false')}
    p.inert=!p.classList.contains('open');
  });
  function closePanel(p){if(p.id==='deploymentsDrawer')closeDeploymentMonitor();else p.classList.remove('open')}
  function syncPanels(){
    const opening=panels.find(p=>p!==active&&p.classList.contains('open'));
    if(opening){if(!active)returnFocus=document.activeElement;panels.filter(p=>p!==opening).forEach(closePanel);active=opening;opening.inert=false;opening.querySelector('[id^="close"]').focus()}
    else if(active&&!active.classList.contains('open')){active=null;if(returnFocus?.isConnected)returnFocus.focus();returnFocus=null}
    panels.forEach(p=>{const open=p.classList.contains('open');p.inert=!open;p.setAttribute('aria-hidden',String(!open));document.getElementById(toggles[p.id])?.setAttribute('aria-expanded',String(open))});
  }
  panels.forEach(p=>new MutationObserver(syncPanels).observe(p,{attributes:true,attributeFilter:['class']}));syncPanels();
  const live=document.querySelector('#deploymentsToggle');live.onclick=()=>{if(document.querySelector('#deploymentsDrawer').classList.contains('open'))closeDeploymentMonitor();else openDeploymentMonitor('active')};
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){const m=menus.find(m=>m.classList.contains('menu-open'));closeMenus();m?.querySelector('.toolmenu-btn').focus();panels.forEach(closePanel)}},true);
  document.querySelector('#toast').setAttribute('role','status');document.querySelector('#toast').setAttribute('aria-live','polite');
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bindConsolePolish);else bindConsolePolish();

function bindCommandDiscovery(){
 document.querySelector('#openCommands').onclick=openPalette;
 document.querySelector('#openShortcuts').onclick=openShortcutHelp;
 document.querySelector('#closeCommands').onclick=closePalette;
 document.querySelector('#closeShortcutHelp').setAttribute('aria-label','Close keyboard shortcuts');
 const overlay=document.querySelector('#commandOverlay');
 overlay.addEventListener('keydown',e=>{
  const buttons=[...document.querySelectorAll('#commandList button')];
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const focused=buttons.indexOf(document.activeElement);selectCommand((focused<0?paletteIndex:focused)+(e.key==='ArrowDown'?1:-1));if(focused>=0)buttons[paletteIndex]?.focus();buttons[paletteIndex]?.scrollIntoView?.({block:'nearest'})}
  if(e.key==='Enter'&&e.target.id==='commandSearch'){e.preventDefault();buttons[paletteIndex]?.click()}
  if(e.key==='Tab'){const focusable=[...overlay.querySelectorAll('button,input')];const first=focusable[0],last=focusable[focusable.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}
 });
 document.addEventListener('keydown',e=>{if(e.metaKey&&e.key.toLowerCase()==='k'){e.preventDefault();openPalette()}});
 // Retire duplicate navigation aliases and obsolete visual-only commands.
 const obsolete=new Set(['Toggle terminal scanlines','Go to Workspace','Go to Remote Admin','Go to Bulk Deploy','Go to History','Open Remote Admin','Open Bulk Deploy','Open History','Deploy package','Check target health']);
 for(let i=commands.length-1;i>=0;i--)if(obsolete.has(commands[i][0]))commands.splice(i,1);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bindCommandDiscovery);else bindCommandDiscovery();

/* Release 6.4: progressive health and explicit relationship evidence. */
refreshTargetHealth=function(){const pc=S.target;lastHealth=null;v28.health=null;return pc?AtlasHealth.mount(document.querySelector('#healthLine'),pc,()=>S.target===pc):Promise.resolve()};
const healthClearLookup=clearLookup;clearLookup=function(){AtlasHealth.cancel(document.querySelector('#healthLine'));return healthClearLookup()};
const healthRenderMachines=renderMachines;renderMachines=function(){healthRenderMachines();document.querySelectorAll('#machines [data-machine]').forEach(card=>{const m=S.machines[Number(card.dataset.machine)];if(m&&!card.querySelector('.atlas-relationships'))card.insertAdjacentHTML('beforeend',AtlasHealth.badges(m))})};
const healthMachineContext=machineContext;machineContext=function(e,index){healthMachineContext(e,index);const m=S.machines[index],menu=document.querySelector('#machineMenu');if(!m||!menu)return;const b=document.createElement('button');b.textContent='View specifications';b.onclick=()=>{menu.classList.add('hidden');AtlasHealth.specs(m.name)};menu.prepend(b)};

/* 6.5: report the current widget snapshot; pending/failed is never reported as NO. */
const reportBeforeProgressiveHealth=completeMachineReport;
completeMachineReport=function(){
 const lines=reportBeforeProgressiveHealth().split('\n').filter(line=>! /^(Ping:|C\$:|WMI:|Free C:|Last boot:|Uptime:|Logged on:)/.test(line));
 return lines.concat(AtlasHealth.report(document.querySelector('#healthLine'),S.target)).join('\n');
};
