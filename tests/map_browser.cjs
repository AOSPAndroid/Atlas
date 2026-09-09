// Run against serve_ui_fixture.py. Never targets a real work machine.
const assert=require('assert/strict'),path=require('path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright-core');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];page.on('pageerror',e=>errors.push(e.message));const dialogs=[];page.on('dialog',d=>{dialogs.push(d.message());d.accept()});
 await page.addInitScript(()=>{window.webglRequests=0;const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(t,...a){if(t==='webgl'||t==='webgl2')window.webglRequests++;return get.call(this,t,...a)}});
 const base=process.env.TEST_URL||'http://127.0.0.1:8892';await page.goto(base);await page.locator('#plan-canvas').waitFor({state:'visible'});
 await page.waitForTimeout(400);assert(await page.locator('.map-name:visible').count()>0);assert.equal(await page.evaluate(()=>window.webglRequests),0,'Fast map must not initialize WebGL');
 await page.locator('#search').fill('Sabri El Jailani');await page.waitForFunction(()=>document.querySelectorAll('.ops-machine').length===8);
 assert((await page.locator('#ops-panel').innerText()).includes('imported as an area'));
 await page.locator('#ops-audit').click();await page.locator('#audit-search').fill('Sabri');await page.locator('#audit-type').selectOption('person-as-area');assert(await page.locator('#audit-results').innerText().then(t=>t.includes('Sabri El Jailani')));await page.locator('[data-audit-desk="L3-093"]').first().click();await page.waitForFunction(()=>document.querySelectorAll('.ops-machine').length===8);

 assert(await page.locator('#ops-deploy').isDisabled());
 await page.locator('[data-link-user="0"]').click();await page.waitForFunction(()=>document.querySelector('.ops-chip')?.textContent.includes('confirmed'));
 assert.equal(await page.locator('.ops-machine').count(),8);
 assert(await page.locator('.ops-machine-group').count()>=2);assert((await page.locator('.ops-machines').innerText()).includes('Inventory discovered'));
 await page.locator('#ops-catalog').click();await page.locator('[data-catalog-folder="Example App"]').click();await page.locator('#catalog-edit [name="display_name"]').fill('Example Friendly App');await page.locator('#catalog-edit [name="version"]').fill('1.2.3');await page.locator('#catalog-edit button').click();await page.waitForFunction(()=>document.querySelector('#catalog-detail h3')?.textContent==='Example Friendly App');await page.locator('.ops-dialog [aria-label="Close"]').click();await page.waitForFunction(()=>document.querySelector('#ops-package')?.selectedOptions[0]?.textContent.includes('1.2.3'));
 await page.locator('[name="ops-machine"]').first().check();await page.waitForFunction(()=>!document.querySelector('#ops-deploy').disabled);assert((await page.locator('#ops-deploy-summary').innerText()).includes('1.2.3'));await page.locator('#ops-deploy').click();await page.waitForFunction(()=>document.querySelector('#ops-job')?.textContent.includes('complete'));assert(dialogs.some(d=>d.includes('Example App')&&d.includes('Machine:')&&d.includes('Script:')));

 const point=await page.evaluate(()=>{const r=document.querySelector('#plan-canvas').getBoundingClientRect(),p=document.querySelector('#label-lines circle.chosen');return {x:r.left+Number(p.getAttribute('cx')),y:r.top+Number(p.getAttribute('cy'))}});
 await page.mouse.click(point.x,point.y,{button:'right'});await page.locator('.desk-menu').waitFor({state:'visible'});
 const before=(await (await page.request.get(base+'/api/desks/L3-093/context')).json()).desk.angle;
 await page.locator('.desk-menu [data-action="rotate"]').click();
 await page.waitForFunction(async({base,before})=>{const d=await(await fetch(base+'/api/desks/L3-093/context')).json();return d.desk.angle===(before+90)%360},{base,before});

 await page.locator('#search').fill('');await page.waitForTimeout(400);
 await page.evaluate(()=>{window.savedLabel=document.querySelector('.map-name.chosen')});
 // Repeated wheel events ensure a sustained moving phase. Observe it immediately.
 const moving=await page.evaluate(async()=>{const c=document.querySelector('#plan-canvas');for(let i=0;i<5;i++){c.dispatchEvent(new WheelEvent('wheel',{deltaY:60,bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,25))}return {visible:[...document.querySelectorAll('.map-name')].filter(n=>!n.hidden).map(n=>n.classList.contains('chosen')),same:window.savedLabel===document.querySelector('.map-name.chosen')}});
 assert(moving.visible.length===1&&moving.visible.every(Boolean));assert(moving.same);
 await page.waitForTimeout(300);assert(await page.evaluate(()=>window.savedLabel===document.querySelector('.map-name.chosen')));
 await page.mouse.move(900,430);await page.mouse.down();await page.mouse.move(940,470,{steps:8});await page.waitForTimeout(60);assert.equal(await page.locator('.map-name:visible').count(),1);await page.mouse.up();await page.waitForTimeout(300);
 await page.locator('#map-diagnostics').click();await page.waitForFunction(()=>document.querySelector('#map-metrics').textContent.includes('Canvas 2D'));
 await page.screenshot({path:process.env.SCREENSHOT_DIR+'/atlas-fast-map.png'});
 await page.locator('[data-view="3d"]').click();await page.locator('#canvas').waitFor({state:'visible'});await page.waitForTimeout(400);assert((await page.locator('#map-metrics').innerText()).includes('Simple WebGL'));
 await page.screenshot({path:process.env.SCREENSHOT_DIR+'/atlas-simple-3d.png'});
 await page.locator('.name-toggle').click();assert(await page.locator('#map-labels').isHidden());await page.locator('.name-toggle').click();
 await page.locator('[data-view="plan"]').click();await page.locator('#reset').click();await page.waitForTimeout(300);
 await page.locator('[data-floor="4"]').click();await page.waitForTimeout(300);assert((await page.locator('#floor-title').innerText()).includes('4'));
 await page.setViewportSize({width:800,height:700});await page.waitForTimeout(300);assert(await page.locator('#plan-canvas').isVisible());
 // No WebGL: Fast map and lookup still load.
 const fallback=await browser.newPage();await fallback.addInitScript(()=>{const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(t,...a){return t==='webgl'||t==='webgl2'?null:get.call(this,t,...a)}});await fallback.goto(base);await fallback.locator('#plan-canvas').waitFor({state:'visible'});await fallback.locator('[data-view="3d"]').click();assert(await fallback.locator('#plan-canvas').isVisible());
 assert.equal(errors.length,0,errors.join('\n'));console.log('PASS: real Chromium Canvas + WebGL render, Sabri eight machines, area confirmation, persistent selected label during wheel, name toggle, floors, resize, no-WebGL fallback');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
