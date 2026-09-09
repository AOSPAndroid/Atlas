// Mock GL verifies uploads/invalidation; this does not measure GPU FPS or pixels.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {JSDOM}=require(process.env.JSDOM_MODULE||'jsdom');
const root=path.resolve(__dirname,'..');
(async()=>{
 const dom=new JSDOM(fs.readFileSync(path.join(root,'atlas/index.html'),'utf8'),{url:'http://127.0.0.1:8770',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 let uploads=0,draws=0;const frames=new Map();let frame=0;
 w.requestAnimationFrame=f=>{frames.set(++frame,f);return frame};w.cancelAnimationFrame=id=>frames.delete(id);
 const gl=new Proxy({bufferData:()=>uploads++,drawArrays:()=>draws++,getShaderParameter:()=>true,getProgramParameter:()=>true},{get:(o,k)=>o[k]||(()=>({}))});
 w.HTMLCanvasElement.prototype.getContext=type=>type==='webgl'?gl:null;for(const [k,v] of [['clientWidth',900],['clientHeight',650]])Object.defineProperty(w.HTMLCanvasElement.prototype,k,{get:()=>v});
 w.ResizeObserver=class{observe(){}};w.matchMedia=()=>({matches:true});
 const data=JSON.parse(fs.readFileSync(path.join(root,'atlas/data.json'),'utf8'));
 w.fetch=async url=>({ok:true,json:async()=>url.includes('data.json')?data:{records:data.records,token:'test'}});
 w.eval(fs.readFileSync(path.join(root,'atlas/operations.js'),'utf8').replace('export function','function'));
 const source=fs.readFileSync(path.join(root,'atlas/app.js'),'utf8').replace(/^import[^\n]+\n/,'');
 await w.eval('(async()=>{'+source+`\nwindow.testRender={renderFrame,draw,move:()=>{cam.yaw+=.01;cam.cx+=.1},select:()=>{selected=records.find(r=>r.floor===floor)},edit:()=>{records=records.map(r=>({...r,angle:(r.angle||0)+90}))},floor:()=>{floor=4},plan:()=>{setView('plan')},filter:()=>{document.querySelector('#search').value='test';lastMatches=[]}};})()`);
 const t=w.testRender;t.renderFrame();assert.equal(uploads,2);const first=uploads;
 for(let i=0;i<60;i++){t.move();t.renderFrame()};assert.equal(uploads,first,'camera movement must not upload desk vertices');
 t.select();t.renderFrame();assert.equal(uploads,3,'selection invalidates desks');
 t.edit();t.renderFrame();assert.equal(uploads,4,'record changes invalidate desks');
 t.filter();t.renderFrame();assert.equal(uploads,5,'filter invalidates desks');
 t.floor();t.renderFrame();assert.equal(uploads,7,'new floor uploads architecture and desks');
 t.plan();t.renderFrame();assert.equal(uploads,7,'unavailable 2D mode falls back to existing 3D');
 const before=draws;for(let i=0;i<100;i++)t.draw();assert.equal(frames.size,1,'pointer draws coalesce');
 const queued=[...frames.values()];frames.clear();queued.forEach(f=>f(0));assert.equal(draws,before+2);
 console.log('PASS: 60 camera frames, zero geometry uploads; selection/edit/filter/floor/view invalidate; 100 draw requests coalesce to one frame');w.close();
})().catch(e=>{console.error(e);process.exit(1)});
