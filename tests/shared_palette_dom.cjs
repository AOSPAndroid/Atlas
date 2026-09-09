// Real shared component in a browser-like DOM; all requests/actions are fixtures.
const {JSDOM}=require('jsdom');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function loadModule(file,context,cache=new Map()){
 if(cache.has(file))return cache.get(file);
 const mod=new vm.SourceTextModule(fs.readFileSync(file,'utf8'),{context,identifier:file});cache.set(file,mod);
 await mod.link(spec=>loadModule(path.resolve(path.dirname(file),spec),context,cache));await mod.evaluate();return mod;
}
(async()=>{
 const results=[];
 for(const mode of ['map','console']){
  const dom=new JSDOM('<header><button id="old">Commands</button></header>',{url:'http://127.0.0.1:8770/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
  w.HTMLElement.prototype.scrollIntoView=function(){};
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'))};
  const calls=[];let requests=[];
  w.fetch=async(url)=>{
   requests.push(url);
   if(url.includes('/api/palette/person/'))return {ok:true,json:async()=>({desks:[{id:'04R024065',floor:4,match:'confirmed account link'}]})};
   const term=new URL(url,w.location.href).searchParams.get('term');
   // Deliberately return an obsolete query last, even if its signal was aborted.
   if(term==='slow')await sleep(350);
   return {ok:true,json:async()=>({users:term?.startsWith('user:')?[{id:7,full_name:'Alice Example',user_name:'alice',email:'alice@example.test'}]:[],machines:term==='slow'?[{name:'OBSOLETE'}]:term?.startsWith('machine:')?[{name:'PC-1',model_id:'Fixture'}]:[]})};
  };
  const {namespace}=await loadModule(path.join(root,'atlas/command-palette.js'),dom.getInternalVMContext());
  const registry=await loadModule(path.join(root,'atlas/command-registry.js'),dom.getInternalVMContext());
  const records=[{id:'04R024065',name:'Alice Example',floor:4,team:'Fixture'}];
  const palette=namespace.installCommandPalette({getRecords:()=>records,onSelect:id=>calls.push(['desk',id]),toast:s=>calls.push(['toast',s]),runCommand:id=>calls.push(['command',id]),openPerson:id=>calls.push(['person',id]),openMachine:id=>calls.push(['machine',id]),...(mode==='map'?{triggerParent:w.document.querySelector('header')}:{replaceTrigger:w.document.querySelector('#old'),prepare:async()=>{}})});
  const input=palette.root.querySelector('input'),options=()=>[...palette.root.querySelectorAll('[role=option]')],type=s=>{input.value=s;input.dispatchEvent(new w.Event('input',{bubbles:true,composed:true}))},key=k=>input.dispatchEvent(new w.KeyboardEvent('keydown',{key:k,bubbles:true,composed:true}));
  const trigger=palette.root.querySelector('button');trigger.focus();await palette.open();
  results.push(options().map(o=>o.textContent));assert.equal(options().length,25);assert.equal(palette.root.querySelector('link').getAttribute('href'),'/command-palette.css');
  type('> history');assert.equal(options().length,1);key('Enter');await sleep(0);assert.deepEqual(calls.pop(),['command','history']);assert(!palette.dialog.open);assert.equal(palette.root.activeElement,trigger);
  await palette.open();type('desk:04R024065');key('Enter');await sleep(0);assert.deepEqual(calls.pop(),['desk','04R024065']);
  await palette.open();type('person:Alice');await sleep(220);key('Enter');await sleep(10);assert.deepEqual(calls.pop(),['desk','04R024065']);
  await palette.open();type('slow');await sleep(210);type('machine:PC');await sleep(550);assert.equal(options().length,1);assert(options()[0].textContent.includes('PC-1'));assert(!options()[0].textContent.includes('OBSOLETE'));key('Enter');await sleep(0);assert.deepEqual(calls.pop(),['machine','PC-1']);
  await palette.open();key('ArrowDown');assert.equal(input.getAttribute('aria-activedescendant'),'atlas-command-1');
  let leaked=0;w.document.addEventListener('keydown',()=>leaked++);key('d');assert.equal(leaked,0,'palette typing must not reach console shortcuts');
  type('<script>');await sleep(220);assert.equal(options().length,0);assert(!palette.root.querySelector('script'));palette.close();
  assert.throws(()=>registry.namespace.commandUrl('reboot-now'));
  for(const command of registry.namespace.COMMANDS){const url=registry.namespace.commandUrl(command.id,'PC & 1');assert.equal(new URL(url,w.location.href).searchParams.get('machine'),'PC & 1');}
  w.close();
 }
 assert.deepEqual(results[0],results[1]);console.log('PASS: identical commands/styles, keyboard selection, focus, desk/person/machine routing, stale response protection, shortcut isolation and URL allowlist.');
})().catch(error=>{console.error(error);process.exitCode=1});
