const fs=require('fs'),assert=require('assert/strict'),{JSDOM}=require('jsdom');
(async()=>{
 const w=new JSDOM('<body><div class="atlas-header-actions"></div></body>',{url:'http://localhost/',runScripts:'outside-only'}).window;
 w.eval(fs.readFileSync('frontend/assets/desktop-mode.js','utf8'));
 await new Promise(r=>w.document.addEventListener('DOMContentLoaded',r));
 assert.equal(w.document.querySelector('#atlasAppearanceSettings'),null);
 assert.equal(typeof w.AtlasDesktop.open,'function');
 const registry=await import('../atlas/command-registry.js');
 const c=registry.COMMANDS.find(c=>c.id==='desktop-mode');
 assert(c && c.viewer);assert.equal(c.title || c.label,'DESKTOP MODE (beta)');
 w.close();console.log('PASS: layout toggle is available through the shared palette, including read-only modes');
})().catch(e=>{console.error(e);process.exit(1)});
