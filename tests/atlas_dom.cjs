// Requires jsdom. Exercises real DOM events with source-scan fallback, not WebGL rendering.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {JSDOM,VirtualConsole}=require(process.env.JSDOM_MODULE||'jsdom');
const root=path.resolve(__dirname,'..'),base=process.env.TEST_URL||'http://127.0.0.1:8892/';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<100;i++){if(fn())return;await sleep(30)}throw Error('UI condition timed out')}
(async()=>{
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM(fs.readFileSync(path.join(root,'atlas/index.html'),'utf8'),{url:base,runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc});const w=dom.window;
 w.ResizeObserver=class{observe(){}};w.HTMLCanvasElement.prototype.getContext=()=>null;Object.defineProperty(w.HTMLCanvasElement.prototype,'clientWidth',{get:()=>900});Object.defineProperty(w.HTMLCanvasElement.prototype,'clientHeight',{get:()=>650});w.confirm=()=>true;w.matchMedia=()=>({matches:true});
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'))};
 w.fetch=(url,options)=>fetch(new URL(url,base),options);w.eval(fs.readFileSync(path.join(root,'atlas/operations.js'),'utf8').replace('export function','function'));
 let script=fs.readFileSync(path.join(root,'atlas/app.js'),'utf8').replace(/^import[^\n]+\n/,'');
 await w.eval('(async()=>{'+script+'\nwindow.selectDeskForTest=selectRecord;})()');
 const state=await (await fetch(base+'api/state')).json();let chosen;
 for(const record of state.records.filter(x=>x.kind==='desk'&&x.occupancy==='assigned')){
  const ctx=await (await fetch(base+'api/desks/'+record.id+'/context')).json();if(ctx.user&&ctx.machines.length){chosen=record;break}
 }
 assert(chosen);w.document.querySelector(`[data-record="${chosen.id}"]`).click();
 await until(()=>w.document.querySelectorAll('.ops-machine').length>0);await until(()=>w.document.querySelector('#ops-script')?.value==='setup_i.ps1');
 assert(w.document.querySelector('#ops-deploy').disabled);w.document.querySelector('[name="ops-machine"]').click();assert(!w.document.querySelector('#ops-deploy').disabled);
 w.document.querySelector('#ops-preview').click();await until(()=>!w.document.querySelector('#ops-script-content').hidden);assert.equal(w.document.querySelector('#ops-script-content').textContent,'exit 0');
 w.document.querySelector('#ops-deploy').click();await until(()=>w.document.querySelector('#ops-job').textContent.includes('complete'));await until(()=>w.document.querySelector('#ops-desk-history').textContent.includes('Example App'));
 const target=w.document.querySelector('#ops-target-label').textContent;
 const other=state.records.find(x=>x.kind==='desk'&&x.occupancy==='vacant');w.selectDeskForTest(other.id);await until(()=>w.document.querySelector('#ops-user-search')!==null&&w.document.querySelector('.ops-chip')?.textContent.includes('no assigned'));assert(w.document.querySelector('#ops-deploy').disabled);assert(!w.document.querySelector('#ops-target-label').textContent.includes(target));
 w.document.querySelector('#name-tags').checked=false;w.document.querySelector('#name-tags').dispatchEvent(new w.Event('change'));assert(w.document.querySelector('#map-labels').hidden);
 assert.equal(errors.length,0,errors.join('\n'));console.log('PASS: full Atlas DOM load, desk click, linked user/machines, explicit target, package/script preview, simulated deployment, desk history, switching clears target, name toggle');w.document.querySelector('#close-detail').click();await sleep(150);w.close();
})().catch(e=>{console.error(e);process.exit(1)});
