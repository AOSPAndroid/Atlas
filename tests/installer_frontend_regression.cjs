// State/race regression checks in Node. This does not replace browser visual testing.
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const nodes=new Map();const node=()=>({value:'',innerHTML:'',textContent:'',classList:{add(){},remove(){},toggle(){}}});
const context={document:{readyState:'loading',addEventListener(){},getElementById(id){return this.querySelector('#'+id)},querySelector(s){if(!nodes.has(s))nodes.set(s,node());return nodes.get(s)},querySelectorAll(){return []}},MutationObserver:class{observe(){}},localStorage:{getItem(){return null},setItem(){}},window:{},console,setTimeout,clearTimeout,setInterval,clearInterval,fetch:async()=>({ok:true,json:async()=>({})})};vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../frontend/assets/app.js'),'utf8'),context);
vm.runInContext('renderUsers=()=>{};renderMachines=()=>{};renderKyc=()=>{};toast=()=>{};',context);
(async()=>{
 const pending=[];context.fetch=(url)=>new Promise(resolve=>pending.push({url,resolve}));
 const resolve=(i,data)=>pending[i].resolve({ok:true,json:async()=>data});
 nodes.get('#search')||context.document.querySelector('#search');nodes.get('#search').value='first';const first=vm.runInContext('search()',context);
 nodes.get('#search').value='second';const second=vm.runInContext('search()',context);
 resolve(1,{matched:false});await new Promise(r=>setImmediate(r));resolve(2,{users:[],machines:[{name:'SECOND'}]});await second;
 resolve(0,{matched:true,user_key:'id:1'});await first;
 assert.equal(vm.runInContext('S.machines[0].name',context),'SECOND');assert.equal(pending.length,3);
 vm.runInContext("S.target='OLD';S.user={id:1};",context);nodes.get('#search').value='missing';const missing=vm.runInContext('search()',context);
 assert.equal(vm.runInContext('S.target',context),'');assert.equal(vm.runInContext('S.user',context),null);
 resolve(3,{matched:false});await new Promise(r=>setImmediate(r));resolve(4,{users:[],machines:[]});await missing;
 assert.equal(vm.runInContext('S.machines.length',context),0);
 assert.equal(vm.runInContext("packageFolder('Example')",context),'Example');
 console.log('PASS: full script evaluation, stale search rejection, target clearing, empty results, portable package reference');
})().catch(e=>{console.error(e);process.exitCode=1});
