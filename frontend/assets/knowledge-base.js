/* Atlas document library around bundled Draw.io. No external diagram/AI service. */
(() => {
  'use strict';
  const EMPTY='<mxGraphModel grid="1" page="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';
  const uid=()=>crypto.randomUUID(),clone=v=>JSON.parse(JSON.stringify(v));
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const blank=()=>({id:uid(),title:'Untitled diagram',notes:'',xml:EMPTY,revision:0});
  let root,frame,doc=blank(),initialized=false,loaded=false,ready=false,dirty=false,saving=false,serial=0,timer,loadTimer,library=[];
  const pending=new Map(),q=s=>root.querySelector(s),viewer=()=>!!window.AtlasReadOnly;
  const status=s=>{if(root)q('#kbStatus').textContent=s;};
  function validateXML(xml){
    if(typeof xml!=='string'||xml.length>5000000||/<!\s*(DOCTYPE|ENTITY)/i.test(xml))throw Error('Use a Draw.io XML file smaller than 5 MB without XML entities.');
    const parsed=new DOMParser().parseFromString(xml,'application/xml');
    if(parsed.querySelector('parsererror')||!['mxfile','mxGraphModel'].includes(parsed.documentElement.tagName))throw Error('This is not a valid Draw.io diagram.');
    return xml;
  }
  function validate(value){
    if(!value||typeof value.title!=='string'||!value.title.trim()||value.title.length>180||typeof value.notes!=='string'||value.notes.length>100000)throw Error('Invalid Atlas document title or notes.');
    return {...blank(),title:value.title,notes:value.notes,xml:validateXML(value.xml)};
  }
  function post(message){frame.contentWindow.postMessage(JSON.stringify(message),location.origin);}
  function editorRequest(action,extra={}){
    if(!ready)return Promise.reject(Error('Draw.io is still loading. Wait a moment, or use Reload editor.'));
    return new Promise((resolve,reject)=>{const id=uid(),timeout=setTimeout(()=>{pending.delete(id);reject(Error('Draw.io did not respond. Your draft is still open.'));},15000);pending.set(id,{resolve,reject,timeout});post({action,...extra,atlasRequest:id});});
  }
  function changed(){dirty=true;serial++;clearTimeout(timer);status(viewer()?'Draft · download to keep your work':'Unsaved changes');if(!viewer())timer=setTimeout(()=>save(false),900);}
  function adopt(xml){validateXML(xml);if(doc.xml!==xml){doc.xml=xml;changed();}}
  async function capture(){if(!ready)throw Error('Draw.io is still loading.');const data=await editorRequest('export',{format:'xml'});adopt(data.xml);}
  function loadEditor(){
    clearTimeout(loadTimer);ready=false;
    for(const p of pending.values()){clearTimeout(p.timeout);p.reject(Error('Document changed.'));}pending.clear();
    const next=document.createElement('iframe');next.id='kbDrawio';next.title='Draw.io diagram editor';next.setAttribute('referrerpolicy','no-referrer');next.setAttribute('sandbox','allow-scripts allow-same-origin allow-downloads allow-modals');
    next.src='/drawio/index.html?embed=1&proto=json&configure=1&libraries=1&noExitBtn=1&noSaveBtn=1&saveAndExit=0&spin=1&ui=kennedy&lang=en&format=0&v=31.5.3-atlas1';
    frame=next;q('#kbEditorHost').replaceChildren(frame);q('#kbEditorStatus').textContent='Loading bundled Draw.io…';q('#kbEditorStatus').classList.add('atlas-loading-inline');q('#kbEditorHost').setAttribute('aria-busy','true');
    loadTimer=setTimeout(()=>{if(!ready){q('#kbEditorStatus').classList.remove('atlas-loading-inline');q('#kbEditorHost').setAttribute('aria-busy','false');q('#kbEditorStatus').textContent='Editor is taking longer to load. Reload editor, or download your existing draft from File.';}},20000);
  }
  async function receive(event){
    if(!frame||event.source!==frame.contentWindow||event.origin!==location.origin||typeof event.data!=='string')return;
    let message;try{message=JSON.parse(event.data);}catch{return;}
    if(!message||typeof message!=='object')return;
    if(message.event==='configure'){
      post({action:'configure',config:{enableAi:false,defaultFonts:['Arial','Helvetica','Verdana','Times New Roman'],passThroughKeys:[{key:'k',ctrl:true,command:'atlas-palette'}],suppressNewWindows:true}});return;
    }
    if(message.event==='init'){post({action:'load',xml:doc.xml,title:doc.title,autosave:1,fit:1});return;}
    if(message.event==='load'){clearTimeout(loadTimer);ready=true;q('#kbEditorStatus').classList.remove('atlas-loading-inline');q('#kbEditorHost').setAttribute('aria-busy','false');q('#kbEditorStatus').textContent='Draw.io 31.5.3 · bundled locally';return;}
    if(message.event==='shortcut'&&message.command==='atlas-palette'){window.openPalette?.();return;}
    const id=message.message?.atlasRequest;
    if(id&&pending.has(id)){const p=pending.get(id);clearTimeout(p.timeout);pending.delete(id);if(message.error)p.reject(Error(message.error));else p.resolve(message);return;}
    if(message.event==='autosave'||message.event==='save'){
      if(!ready)return;
      try{adopt(message.xml);if(message.event==='save')await save(false);}catch(e){status('Cannot save diagram · '+e.message);}
    }
  }
  async function save(withCapture=true){
    clearTimeout(timer);
    try{
      if(withCapture)await capture();
      if(viewer()){downloadJSON();return;}
      if(saving){timer=setTimeout(()=>save(false),500);return;}
      if(!dirty)return;
      const payload=clone(doc),version=serial;saving=true;status('Saving…');
      try{
        const data=await AtlasClient.request('/api/knowledge/'+payload.id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
        if(doc.id===payload.id){doc.revision=data.revision;dirty=serial!==version;status(dirty?'Unsaved changes':'Saved · '+new Date(data.updated).toLocaleTimeString());}
        await refreshLibrary();
      }finally{saving=false;}
    }catch(e){status('Not saved · '+e.message+' Your draft is still open.');}
  }
  async function leaveDraft(){
    if(saving){status('Wait for saving to finish before switching documents.');return false;}
    if(ready)await capture();
    if(!dirty)return true;
    if(!viewer()){await save(false);if(!dirty)return true;}
    return confirm('This draft has not been saved. Download it first to keep your work. Discard this draft and continue?');
  }
  function setDocument(data){clearTimeout(timer);doc=data;dirty=false;serial++;q('#kbTitle').value=doc.title;q('#kbNotes').value=doc.notes;loadEditor();renderLibrary();status(viewer()?'Draft · download to keep your work':doc.revision?'Saved in local Admin database':'New document');}
  async function refreshLibrary(){if(viewer()){library=[];renderLibrary();return;}try{library=(await AtlasClient.request('/api/knowledge')).documents;renderLibrary();}catch(e){status('Library unavailable · '+e.message);}}
  function renderLibrary(){const term=q('#kbSearch').value.toLowerCase();q('#kbDocuments').innerHTML=library.filter(d=>d.title.toLowerCase().includes(term)).map(d=>`<button data-doc="${esc(d.id)}" class="${doc.id===d.id?'current':''}"><strong>${esc(d.title)}</strong><small>${new Date(d.updated).toLocaleDateString()}</small></button>`).join('')||`<p>${viewer()?'Open a file or start a draft. Download your work before closing.':'No saved documents yet.'}</p>`;}
  function download(value,mime,extension){const link=document.createElement('a'),url=URL.createObjectURL(new Blob([value],{type:mime}));link.href=url;link.download=(doc.title.replace(/[^\p{L}\p{N} _-]/gu,'').trim()||'Atlas diagram').slice(0,100)+extension;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function downloadJSON(){download(JSON.stringify({format:'atlas-knowledge-v2',...doc},null,2),'application/json','.atlas.json');if(viewer())dirty=false;status('Downloaded · keep the Atlas file to reopen notes and diagram');}
  async function imageExport(format){const response=await editorRequest('export',{format,embedImages:false,embedFonts:false});const pattern=format==='png'?/^data:image\/png[;,]/:/^data:image\/svg\+xml[;,]/;if(!pattern.test(response.data||''))throw Error('Unexpected image format.');const comma=response.data.indexOf(','),meta=response.data.slice(0,comma),body=response.data.slice(comma+1);const value=meta.includes(';base64')?Uint8Array.from(atob(body),c=>c.charCodeAt(0)):decodeURIComponent(body);download(value,format==='png'?'image/png':'image/svg+xml','.'+format);}
  const editorActions={process:'atlasProcess',decision:'atlasDecision',terminal:'atlasTerminal',database:'atlasDatabase',note:'atlasNote',connect:'atlasConnect',undo:'undo',redo:'redo',duplicate:'duplicate',delete:'delete',layers:'layers',format:'format',grid:'grid','zoom-in':'zoomIn','zoom-out':'zoomOut'};
  async function action(name){
    if(editorActions[name]){if(!ready)throw Error('Draw.io is still loading.');post({action:'invokeAction',actionName:editorActions[name]});frame.focus();return;}
    if(name==='fit'){if(ready)post({action:'fit',border:24,maxScale:1});return;}
    if(name==='notes'){q('#kbNotes').focus();return;}
    if(name==='focus'){root.classList.toggle('kb-focused');return;}
    if(name==='reload'){if(ready)await capture();loadEditor();return;}
    if(name==='save'){await save();return;}
    if(name==='export'){if(ready)await capture();downloadJSON();return;}
    if(name==='drawio'){if(ready)await capture();download(doc.xml,'application/xml','.drawio');return;}
    if(name==='svg'||name==='png'){await imageExport(name);return;}
    if(name==='import'){q('#kbImport').click();return;}
    if(name==='copy-document'){if(saving)throw Error('Wait for saving to finish.');if(ready)await capture();const copy={...clone(doc),id:uid(),revision:0,title:(doc.title+' — copy').slice(0,180)};setDocument(copy);changed();return;}
    if(name==='new'||name.startsWith('template-')){
      if(!await leaveDraft())return;const next=blank();
      if(name==='template-flow'){next.title='Incident triage';next.notes='Report received → Check connectivity?\nCheck connectivity? → [Yes] Check application\nCheck connectivity? → [No] Check cable / Wi-Fi\nCheck application → Record resolution\nCheck cable / Wi-Fi → Record resolution';}
      if(name==='template-network'){next.title='Office network';next.notes='Internet → Firewall\nFirewall → Core switch\nCore switch → User VLAN\nCore switch → Printer VLAN\nCore switch → Wireless access points';}
      if(next.notes)next.xml=AtlasKnowledgeConverter.toXml(AtlasKnowledgeConverter.fromNotes(next.notes));setDocument(next);changed();return;
    }
    if(name==='convert'){
      const notes=q('#kbNotes').value,graph=AtlasKnowledgeConverter.fromNotes(notes),xml=AtlasKnowledgeConverter.toXml(graph);
      if(ready)await capture();
      if(!new DOMParser().parseFromString(doc.xml,'application/xml').querySelector('mxCell[vertex], mxCell[edge], diagram:not(:has(mxGraphModel))')){doc.xml=xml;loadEditor();changed();return;}
      if(!await leaveDraft())return;const next={...blank(),title:(doc.title+' — from notes').slice(0,180),notes,xml};setDocument(next);changed();return;
    }
    if(name==='delete-document'){
      if(saving)throw Error('Wait for saving to finish.');
      if(!confirm('Delete this document? Export a copy first if you need to keep it.'))return;
      if(!viewer()&&doc.revision)await AtlasClient.request('/api/knowledge/'+doc.id+'?revision='+doc.revision,{method:'DELETE'});
      setDocument(blank());await refreshLibrary();return;
    }
  }
  async function open(){if(!initialized)init();if(!loaded){loaded=true;await refreshLibrary();}}
  function init(){
    root=document.querySelector('#knowledge');if(!root)return;initialized=true;
    root.innerHTML=`<div class="kb-heading"><div><small>KNOWLEDGE BASE · POWERED BY DRAW.IO</small><h2>Diagrams & notes</h2><p>The full diagram editor, alongside your runbooks and notes.</p></div><div><button data-kb="focus">Focus editor</button> <button data-kb="new" class="primary">＋ New document</button></div></div>
    <div class="kb-layout"><aside class="kb-library"><h3>Your documents</h3><input id="kbSearch" type="search" placeholder="Find a document…" aria-label="Search knowledge documents"><div id="kbDocuments"></div><div class="kb-templates"><h3>Templates</h3><button data-kb="template-flow">Incident triage</button><button data-kb="template-network">Office network</button><button data-kb="import">Open file…</button></div><p class="kb-storage">${viewer()?'Demo / Preview: edit drafts and download Atlas files to keep notes and diagrams. Nothing is uploaded.':'Auto-saved in this Admin installation’s local knowledge database. Export files to back up or share.'}</p></aside>
    <div class="kb-work"><div class="kb-document-bar"><input id="kbTitle" maxlength="180" aria-label="Document title" value="Untitled diagram"><button data-kb="save">${viewer()?'Download':'Save'}</button><details class="kb-file-menu"><summary>File ▾</summary><div><button data-kb="copy-document">Save a copy</button><button data-kb="export">Download Atlas JSON</button><button data-kb="drawio">Download .drawio</button><button data-kb="svg">Export SVG image</button><button data-kb="png">Export PNG image</button><button data-kb="import">Open Atlas / Draw.io…</button><button data-kb="delete-document">Delete document</button></div></details></div>
    <div class="kb-editor-bar"><span id="kbEditorStatus" role="status">Loading bundled Draw.io…</span><button data-kb="fit">Fit diagram</button><button data-kb="reload">Reload editor</button></div><div id="kbEditorHost"></div><div class="kb-status"><span>Draw.io runs locally · no external diagram service</span><span id="kbStatus" role="status"></span></div></div>
    <aside class="kb-details"><section class="kb-notes"><h3>Notes & runbook</h3><textarea id="kbNotes" aria-label="Knowledge notes" maxlength="100000" placeholder="Write your notes here…&#10;&#10;User reports issue → Check ping?&#10;Check ping? → [Yes] Check application&#10;Check ping? → [No] Check network"></textarea><button data-kb="convert" class="primary">Notes → diagram</button><small>Local conversion: steps, indented bullets, or A → B connections. End a decision with ?. Add → [Yes] for connector labels. Creates editable Draw.io shapes; existing diagrams are kept separate.</small></section><section><h3>Quick actions</h3><button data-kb="layers">Layers</button> <button data-kb="format">Format panel</button><p>Use Ctrl K for Draw.io commands, including adding shapes, connecting two selected shapes, undo, redo and export.</p><p>Files stay in Atlas. Open existing .drawio files here; use Atlas JSON to include your notes.</p></section></aside></div><input id="kbImport" type="file" accept=".json,.drawio,.xml" hidden>`;
    window.addEventListener('message',event=>receive(event).catch(e=>status(e.message)));
    root.addEventListener('click',e=>{const button=e.target.closest('[data-kb]');if(button){action(button.dataset.kb).catch(e=>status(e.message));button.closest('details')?.removeAttribute('open');}const row=e.target.closest('[data-doc]');if(row)(async()=>{if(!await leaveDraft())return;const data=await AtlasClient.request('/api/knowledge/'+row.dataset.doc);setDocument({...validate(data),id:data.id,revision:data.revision});})().catch(e=>status(e.message));});
    const paths={new:'M12 4v16M4 12h16',save:'M4 3h13l3 3v15H4zM7 3v6h9V3M7 21v-8h10v8',import:'M12 16V3m-4 4 4-4 4 4M4 14v7h16v-7',fit:'M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6',reload:'M20 8a8 8 0 1 0 0 8M20 2v6h-6',focus:'M3 9V3h6m6 0h6v6M3 15v6h6m6 0h6v-6',export:'M12 3v13m-4-4 4 4 4-4M4 17v4h16v-4',notes:'M5 3h14v18H5zM8 8h8M8 12h8M8 16h5'};
    root.querySelectorAll('button[data-kb]').forEach(button=>{const name=button.dataset.kb;const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.classList.add('kb-icon');const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',paths[name] || (name.includes('export')||name==='drawio'||name==='svg'||name==='png'?paths.export:paths.notes));svg.append(path);button.prepend(svg);});
    q('#kbSearch').oninput=renderLibrary;
    for(const [id,key] of [['kbTitle','title'],['kbNotes','notes']])q('#'+id).oninput=()=>{doc[key]=q('#'+id).value||(key==='title'?'Untitled diagram':'');changed();};
    q('#kbImport').onchange=async()=>{try{const file=q('#kbImport').files[0];if(!file)return;if(file.size>6500000)throw Error('Maximum file size: 6.5 MB.');const text=await file.text(),next=file.name.toLowerCase().endsWith('.json')?validate(JSON.parse(text)):{...blank(),title:file.name.replace(/\.(drawio|xml)$/i,'').slice(0,180)||'Imported diagram',xml:validateXML(text)};if(!await leaveDraft())return;setDocument(next);changed();}catch(e){status('Cannot open file · '+e.message);}finally{q('#kbImport').value='';}};
    window.addEventListener('beforeunload',e=>{if(dirty||saving){e.preventDefault();e.returnValue='';}});
    renderLibrary();loadEditor();status(viewer()?'Draft · download to keep your work':'New document');
  }
  window.AtlasKnowledge={open,async command(id){await open();return action(id.replace(/^kb-/,''));},validate,validateXML,getDocument:()=>clone(doc)};
})();
