const fs=require('fs'),assert=require('assert/strict'),{JSDOM}=require('jsdom');
(async()=>{
const w=new JSDOM('<body><div class="atlas-primary-nav"></div><div class="atlas-header-actions"></div></body>',{url:'http://localhost/',runScripts:'outside-only'}).window;
w.eval(fs.readFileSync('frontend/assets/desktop-mode.js','utf8'));
await new Promise(resolve=>w.document.addEventListener('DOMContentLoaded',resolve));
let opened=false;w.AtlasDesktop.open=()=>opened=true;
w.AtlasUI={dialog:()=>{const body=w.document.createElement('div');w.document.body.append(body);return {element:{close(){}},body}}};
assert.equal(w.document.querySelector('.atlas-desktop-launch'),null);
w.document.querySelector('#atlasAppearanceSettings').click();const toggle=w.document.querySelector('[role=switch]');assert.equal(toggle.checked,false);toggle.checked=true;toggle.dispatchEvent(new w.Event('change'));assert(opened);w.close();console.log('PASS: layout switch lives in Settings, navigation launch removed, toggle opens Desktop');
})().catch(e=>{console.error(e);process.exit(1)});
