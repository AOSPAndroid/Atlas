const fs=require('fs'),assert=require('assert/strict'),{JSDOM}=require('jsdom');
const w=new JSDOM('<body></body>',{runScripts:'outside-only',url:'http://localhost'}).window;
w.matchMedia=()=>({matches:false,addEventListener(){}});w.eval(fs.readFileSync('frontend/assets/shared-ui.js','utf8'));let selected;
w.AtlasAD={show:(kind,identity)=>selected={kind,identity}};
w.document.body.innerHTML=w.AtlasUI.person({name:'Alice',user_name:'alice',email:'a@example.test'});
w.document.querySelector('.atlas-person').dispatchEvent(new w.MouseEvent('contextmenu',{bubbles:true,clientX:10,clientY:10}));
assert.equal(w.document.querySelector('[role=menuitem]').textContent,'See groups');w.document.querySelector('[role=menuitem]').click();assert.deepEqual(selected,{kind:'user',identity:'alice'});assert.equal(w.document.querySelector('[role=menu]'),null);
w.close();console.log('PASS: shared user context menu forwards exact account and closes');
