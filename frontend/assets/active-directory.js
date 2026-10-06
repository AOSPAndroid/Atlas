// Group actions keep the exact DN and server captured from the displayed result.
window.AtlasADRows = (() => {
 let menu;
 const close=()=>{menu?.remove();menu=null;};
 function button(label,fn){const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=fn;return b;}
 function attach(row,nameCell,actions,object,server,open){
  const isGroup=object.kind==='group';
  const caption=isGroup?'See members':'See groups';
  const invoke=()=>{if(!window.AtlasReadOnly)return open();};
  const link=button(object.name,invoke);link.className='ad-object-link';link.disabled=!!window.AtlasReadOnly;
  link.title=caption+' · '+object.name;nameCell.replaceChildren(link);
  const copy=button('Copy',async()=>{
   const text=object.name;
   try{await navigator.clipboard.writeText(text);copy.textContent='Copied';setTimeout(()=>copy.textContent='Copy',1500);}
   catch{actions.querySelector('input')?.remove();const input=document.createElement('input');input.readOnly=true;input.value=text;input.setAttribute('aria-label','Copy group name manually');actions.append(input);input.focus();input.select();}
  });
  copy.setAttribute('aria-label','Copy '+object.name);
  if(isGroup)actions.append(copy);
  const view=button(caption,invoke);view.disabled=!!window.AtlasReadOnly;actions.append(view);
  row.addEventListener('contextmenu',event=>{
   event.preventDefault();event.stopPropagation();close();
   menu=document.createElement('div');menu.className='atlas-ad-context';menu.setAttribute('role','menu');
   if(isGroup){const c=button('Copy group name',()=>{close();copy.click();});c.setAttribute('role','menuitem');menu.append(c);}
   const v=button(caption,()=>{close();invoke();});v.disabled=!!window.AtlasReadOnly;v.setAttribute('role','menuitem');menu.append(v);
   document.body.append(menu);const box=menu.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(event.clientX,innerWidth-box.width-8))+'px';menu.style.top=Math.max(8,Math.min(event.clientY,innerHeight-box.height-8))+'px';menu.querySelector('button:not(:disabled)')?.focus();
  });
 }
 document.addEventListener('pointerdown',e=>{if(menu&&!menu.contains(e.target))close();});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'||e.key==='Tab')close();});
 window.addEventListener('hashchange',close);window.addEventListener('resize',close);
 return {attach};
})();
(() => {
  const by = (id) => document.getElementById("ad" + id);
  if (!by("Form")) return;
  let busy = false, revision = 0, pending = null, selectionKey = "", selectionPromise = null;
  const el = (tag, text) => {
    const n = document.createElement(tag);
    if (text != null) n.textContent = String(text);
    return n;
  };
  function controls() {
    by("Lookup").disabled = busy || !!window.AtlasReadOnly;
    by("Results").querySelectorAll('[data-ad-compare]').forEach(n => n.disabled = busy || !!window.AtlasReadOnly);
  }
  function render(data) {
    const result = by("Results");
    result.replaceChildren();
    if (window.AtlasAD) window.AtlasAD.groupActions = null;
    const overview=el('details');overview.className='workspace-ad-details';
    overview.append(el('summary','Account health & properties'));
    const content=el('div');content.id='adOverview';overview.append(content);result.append(overview);
    const evidence=el('details');evidence.className='workspace-ad-evidence';evidence.append(el('summary','Membership scope & lookup evidence'));
    evidence.append(el('p',`Queried ${data.queried_at || 'Time unavailable'} · ${data.server || 'Server unavailable'} · ${data.operator || 'Operator unavailable'}`),el('p',data.membership_note));
    for (const warning of data.warnings || []) evidence.append(el('p', warning));
    result.append(evidence);
    renderGroups(data, result);
  }
  const valueText = value => value == null || value === '' ? 'Unavailable' : String(value);
  function healthItems(data) {
    const d=data.details, user=data.kind==='user';
    const yes=(key,good,bad)=>[d[key]===true?good:d[key]===false?bad:'Unknown',d[key]===true?'good':d[key]===false?'bad':'unknown'];
    const enabled=yes('Enabled','Enabled','Disabled');
    const items=[['AD object','Found','good'],['Account',...enabled]];
    if(user){
      items.push(['Lockout',d['Locked out']===true?'Locked':d['Locked out']===false?'Not locked':'Unknown',d['Locked out']===true?'bad':d['Locked out']===false?'good':'unknown']);
      const expiration=d['Account expiration'];
      const now=Date.parse(data.queried_at)||Date.now(),date=Date.parse(expiration);
      items.push(['Account expiry',!Object.hasOwn(d,'Account expiration')?'Unknown':expiration==null?'No expiry recorded':Number.isFinite(date)?date<=now?'Expired':new Date(date).toLocaleDateString():'Unknown',Number.isFinite(date)&&date<=now?'bad':'unknown']);
      const expiry=Date.parse(d['Password expires']);
      items.push(['Password',d['Password expired']===true?'Expired':Number.isFinite(expiry)?'Expires '+new Date(expiry).toLocaleDateString():d['Password never expires']===true?'Never expires':d['Password expiry status']||'Unknown',d['Password expired']===true||(Number.isFinite(expiry)&&expiry<=now)?'bad':Number.isFinite(expiry)&&expiry-now<7*86400000?'warn':'unknown']);
    }
    items.push([user?'Password changed':'Machine password changed',valueText(d['Password last set']),'unknown']);
    items.push(['Nested groups',data.nested_complete===true?'Resolved in queried scope':data.nested_complete===false?'Partial':'Not checked',data.nested_complete===true?'good':'warn']);
    return items;
  }
  function renderOverview() {
    const root=by('Overview');if(!root)return;root.replaceChildren();
    const actions=el('div');actions.className='ad-group-tools';const copy=el('button','Copy support summary');copy.type='button';copy.id='adCopySummary';const status=el('span');status.setAttribute('role','status');
    copy.onclick=async()=>{try{await navigator.clipboard.writeText(supportSummary());status.textContent='Summary copied.';}catch{status.textContent='Clipboard unavailable. Select the summary below.';const text=el('textarea');text.value=supportSummary();text.readOnly=true;text.setAttribute('aria-label','Support summary');root.append(text);text.select();}};
    actions.append(copy,status);root.append(actions);
    const cards=el('div');cards.className='ad-health-comparison';
    for(const data of [primary,secondary].filter(Boolean)){
      const card=el('section');card.className='ad-health-card';card.append(el('h3',data.details.Account||data.details.Name),el('small',`${data.kind} · ${data.server||'Server unavailable'} · ${data.queried_at||'Time unavailable'}`));
      const strip=el('div');strip.className='ad-health-strip';
      for(const [label,value,tone] of healthItems(data)){const badge=el('span');badge.className='ad-health-'+tone;badge.append(el('strong',label+': '),el('span',value));strip.append(badge);}
      card.append(strip,el('p','OU: '+valueText(data.details['OU / parent container'])));
      if(data.kind==='computer')card.append(el('p',valueText(data.details['DNS hostname'])+' · '+valueText(data.details['Operating system'])));
      card.append(el('small','Last logon (replicated, approximate): '+valueText(data.details['Last logon (replicated, approximate)'])));
      for(const warning of data.warnings||[])card.append(el('small',warning));cards.append(card);
    }
    root.append(cards);
    const detail=el('details');detail.className='ad-object-details';detail.open=!!secondary;detail.append(el('summary',secondary?'Side-by-side properties · differences highlighted':'All AD properties'));
    const table=el('table');table.className='ad-details';const head=el('tr');head.append(el('th','Property'),el('th',primary.details.Account||primary.details.Name));if(secondary)head.append(el('th',secondary.details.Account||secondary.details.Name));table.append(head);
    for(const name of new Set([...Object.keys(primary.details),...Object.keys(secondary?.details||{})])){
      const row=el('tr'),a=valueText(primary.details[name]),b=valueText(secondary?.details[name]);
      if(secondary&&a!==b)row.className='ad-property-different';row.append(el('th',name),el('td',a));if(secondary)row.append(el('td',b));table.append(row);
    }
    detail.append(table);root.append(detail);
  }
  function supportSummary() {
    const lines=['Atlas · AD support summary'];
    for(const data of [primary,secondary].filter(Boolean)){
      lines.push('',`${data.kind}: ${data.details.Account||data.details.Name}`,`Queried: ${data.queried_at||'Unavailable'} | Server: ${data.server||'Unavailable'}`);
      for(const [key,value] of Object.entries(data.details))lines.push(key+': '+valueText(value));
      lines.push('Membership scope: '+(data.membership_note||'Not supplied'));
      for(const warning of data.warnings||[])lines.push('Warning: '+warning);
      for(const group of data.groups)lines.push(`[${group.membership||'Unknown'}] ${group.name} | ${group.description??'Description unavailable'} | ${group.dn||''}`);
    }
    if(secondary){const key=g=>String(g.dn||g.name).toLowerCase(),a=new Set(primary.groups.map(key)),b=new Set(secondary.groups.map(key));lines.push('','Only first object: '+primary.groups.filter(g=>!b.has(key(g))).map(g=>g.name).join(', '),'Only second object: '+secondary.groups.filter(g=>!a.has(key(g))).map(g=>g.name).join(', '));}
    const access=document.querySelector('.ad-access-check');if(access)lines.push('','Access reference: '+(document.querySelector('[aria-label="DaaS or VDI access profile"]')?.selectedOptions[0]?.textContent||''),access.querySelector('.ad-access-results')?.textContent||'Not checked');
    lines.push('','Read-only evidence. Replicated logon is approximate; group membership is not proof of effective access.');return lines.join('\n');
  }
  let primary = null,
    secondary = null;
  function csvCell(value) {
    let s = String(value ?? "");
    if (/^[\s]*[=+@-]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }
  function renderGroups(data, result) {
    primary = data;
    secondary = null;
    renderOverview();
    const accessDetails = el('details');accessDetails.className='workspace-ad-access';accessDetails.append(el('summary','Access reference'));
    const access = el('div');accessDetails.append(access);
    result.append(accessDetails);
    let refreshAccess = () => {};
    import('/site-info.js?v=3').then(({mountAccessCheck})=>{
      if(access.isConnected) refreshAccess=mountAccessCheck(access,()=>[primary,secondary]);
    }).catch(()=>{access.textContent='Access reference unavailable.';});
    const bar = el("div");
    bar.className = "ad-group-tools ad-group-filter";
    const search = el("input");
    search.type = "search";
    search.placeholder = "Group name";
    search.setAttribute("aria-label", "Filter AD groups");
    const mode = el("select");
    mode.setAttribute("aria-label", "Group name match");
    for (const [v, t] of [
      ["contains", "Contains"],
      ["starts", "Starts with"],
      ["ends", "Ends with"],
      ["exact", "Equals"],
      ["excludes", "Does not contain"],
    ]) {
      const o = el("option", t);
      o.value = v;
      mode.append(o);
    }
    const view = el("select");
    view.setAttribute("aria-label", "Membership comparison");
    for (const [v, t] of [
      ["all", "All groups"],
      ["both", "In both"],
      ["first", "Only first object"],
      ["second", "Only second object"],
    ]) {
      const o = el("option", t);
      o.value = v;
      view.append(o);
    }
    view.disabled = true;
    const download = el("button", "Export CSV");
    download.type = "button";
    bar.append(search, mode, view);
    result.prepend(bar);
    const secondaryTools=el('div');secondaryTools.className='ad-group-tools';secondaryTools.append(download);result.append(secondaryTools);
    const compare = el("form");
    compare.className = "ad-group-tools ad-group-compare";
    const kind = el("select");
    kind.setAttribute("aria-label", "Compare object type");
    for (const v of ["user", "computer"]) {
      const o = el("option", v);
      o.value = v;
      kind.append(o);
    }
    kind.value = data.kind || by("Kind").value;
    const identity = el("input");
    identity.required = true;
    identity.maxLength = 128;
    identity.placeholder = "Compare with account / machine";
    identity.setAttribute("aria-label", "Compare AD object");
    const server = el("input");
    server.maxLength = 128;
    server.placeholder = "Domain / controller (optional)";
    server.value = by("Server").value;
    server.setAttribute("aria-label", "Comparison domain or controller");
    const go = el("button", "Compare groups");
    go.dataset.adCompare = "";go.disabled = !!window.AtlasReadOnly;
    const status = el("p");
    status.setAttribute("role", "status");
    compare.append(kind, identity, server, go);
    result.append(compare, status);
    const count = el("p");count.className='ad-group-count';count.setAttribute('role','status');
    const list = el("div");
    list.className = "ad-groups ad-group-list";
    list.tabIndex=0;list.setAttribute('aria-label','Scrollable AD group list');
    bar.after(count,list);
    compare.before(el('h3','Compare with another user or machine'));
    result.append(by('Overview').parentElement, result.querySelector('.workspace-ad-evidence'), accessDetails);
    let rows = [];
    const key = (g) => String(g.dn || g.name).toLowerCase();
    const filter = () => {
      const a = new Map(primary.groups.map((g) => [key(g), g]));
      const b = new Map((secondary?.groups || []).map((g) => [key(g), g]));
      rows = [...new Set([...a.keys(), ...b.keys()])].map((k) => ({
        ...(a.get(k) || b.get(k)),
        sourceServer: a.has(k) ? by("Server").value.trim() : server.value.trim(),
        firstMembership: a.get(k)?.membership || "",
        secondMembership: b.get(k)?.membership || "",
        presence: secondary
          ? a.has(k) && b.has(k)
            ? "both"
            : a.has(k)
              ? "first"
              : "second"
          : "first",
      }));
      const term = search.value.trim().toLowerCase();
      rows = rows
        .filter((g) => {
          const n = String(g.name || "").toLowerCase();
          return (
            (!term ||
              {
                contains: () => n.includes(term),
                starts: () => n.startsWith(term),
                ends: () => n.endsWith(term),
                exact: () => n === term,
                excludes: () => !n.includes(term),
              }[mode.value]()) &&
            (view.value === "all" || g.presence === view.value)
          );
        })
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
      list.replaceChildren();
      count.textContent =
        rows.length +
        " matching groups" +
        (secondary
          ? " · Comparing " +
            (primary.details.Account || primary.details.Name) +
            " with " +
            (secondary.details.Account || secondary.details.Name)
          : "");
      const table = el('table');
      table.setAttribute('aria-label','AD group memberships');
      const head=el('thead'), header=el('tr');
      for(const text of ['Group','Membership', ...(secondary?['Comparison']:[]),'Description','Actions']){const th=el('th',text);th.scope='col';header.append(th);}
      head.append(header);table.append(head);const body=el('tbody');table.append(body);
      for (const g of rows) {
        const row=el('tr'),name=el('td'),description=el('td');
        const actions=el('td');actions.className='ad-row-actions';
        AtlasADRows.attach(row,name,actions,{...g,kind:'group'},g.sourceServer,()=>AtlasAD.browseMembers(g.dn,g.sourceServer));
        const detail=el('details');detail.className='ad-group-record';
        const summary=el('summary');summary.append(el('strong','Group details'));detail.append(summary);
        const properties=el('dl');
        for(const [label,value] of [['Description',g.description==null?'Description unavailable':g.description||'No description recorded'],['Directory path',g.dn],['Scope',g.scope],['Category',g.category]])properties.append(el('dt',label),el('dd',value||'Unavailable'));
        detail.append(properties);name.append(detail);
        description.className='ad-group-description';
        description.textContent=g.description==null?'Description unavailable':g.description||'No description recorded';description.title=description.textContent;
        row.append(name,el('td',secondary?`${g.firstMembership||'—'} / ${g.secondMembership||'—'}`:g.membership));
        if(secondary)row.append(el('td',{both:'In both',first:'Only first object',second:'Only second object'}[g.presence]));
        row.append(description,actions);body.append(row);
      }
      if(rows.length)list.append(table);else list.append(el('p','No matching groups.'));
      download.disabled = !rows.length;
    };
    search.oninput = filter;
    mode.onchange = filter;
    view.onchange = filter;
    download.onclick = () => {
      const columns = [
        "First object",
        "Second object",
        "Comparison",
        "Group name",
        "Description",
        "Distinguished name",
        "Scope",
        "Category",
        "First membership",
        "Second membership",
      ];
      const records = rows.map((g) => [
        primary.details.Account || primary.details.Name,
        secondary?.details.Account || secondary?.details.Name || "",
        secondary ? g.presence : "Not compared",
        g.name,
        g.description,
        g.dn,
        g.scope,
        g.category,
        g.firstMembership,
        g.secondMembership,
      ]);
      const csv =
        "\uFEFF" +
        [columns, ...records]
          .map((row) => row.map(csvCell).join(","))
          .join("\r\n");
      const url = URL.createObjectURL(
        new Blob([csv], { type: "text/csv;charset=utf-8" }),
      );
      const link = el("a");
      link.href = url;
      link.download = "atlas-ad-groups.csv";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    compare.onsubmit = async (e) => {
      e.preventDefault();
      if (busy || window.AtlasReadOnly) return;
      const current = ++revision;
      pending?.abort();pending = new AbortController();
      busy = true;
      controls();
      secondary = null;
      view.value = "all";
      view.disabled = true;
      filter();renderOverview();refreshAccess();
      const inputs = [
        kind,
        identity,
        server,
        go,
        by("Kind"),
        by("Identity"),
        by("Server"),
        by("Selected"),
      ];
      inputs.forEach((n) => (n.disabled = true));
      status.textContent = "Comparing memberships…";
      try {
        const compared = await AtlasClient.request("/api/active-directory/lookup", {
          method: "POST",
          signal: pending.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: kind.value,
            identity: identity.value.trim(),
            server: server.value.trim(),
          }),
        });
        if (current !== revision || !compare.isConnected) return;
        secondary = {...compared,kind:kind.value};
        view.disabled = false;
        status.textContent =
          "Comparison complete. " + (secondary.warnings || []).join(" ");
        filter();renderOverview();refreshAccess();
      } catch (error) {
        if (current === revision) status.textContent = error.message;
      } finally {
        if (current !== revision) return;
        pending = null;busy = false;
        inputs.forEach((n) => (n.disabled = false));
        controls();
      }
    };
    for (const n of [kind, identity, server])
      n.oninput = () => {
        secondary = null;
        view.value = "all";
        view.disabled = true;
        status.textContent =
          "Comparison changed. Click Compare groups to refresh.";
        filter();renderOverview();refreshAccess();
      };
    window.AtlasAD.groupActions = {
      filter: () => search.focus(),
      compare: () => identity.focus(),
      export: () => download.click(),
      summary: () => by("CopySummary")?.click(),
      properties: () => {
        const details = by("Results").querySelector(".workspace-ad-details");
        details.open = true;
        details.querySelector("summary").focus();
        details.scrollIntoView({block: "nearest"});
      },
    };
    filter();controls();
  }

  const fields = ['Kind','Identity','Server','Selected'];
  function reset() {
    revision++;pending?.abort();pending=null;busy=false;
    primary=secondary=null;selectionKey='';selectionPromise=null;
    by('Results').replaceChildren();
    by('Results').setAttribute('aria-busy','false');
    if(window.AtlasAD) window.AtlasAD.groupActions=null;
    fields.forEach(id=>by(id).disabled=false);controls();
  }
  function selectedTitle(kind,identity) {
    const title=document.getElementById('adSelection');
    if(title)title.textContent=identity ? `${kind==='user'?'User':'Machine'} · ${identity}` : 'Select a user or machine';
  }
  async function lookup() {
    if(window.AtlasReadOnly) return;
    const payload={kind:by('Kind').value,identity:by('Identity').value.trim(),server:by('Server').value.trim()};
    reset();selectionKey=JSON.stringify(payload);
    const current=++revision;pending=new AbortController();busy=true;controls();
    fields.forEach(id=>by(id).disabled=true);
    selectedTitle(payload.kind,payload.identity);
    by('Status').textContent='Loading groups for '+payload.identity+'…';
    by('Results').setAttribute('aria-busy','true');
    try {
      const result=await AtlasClient.request('/api/active-directory/lookup',{method:'POST',signal:pending.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      if(current!==revision)return;
      render({...result,kind:payload.kind});
      by('Status').textContent=(result.warnings || []).join(' ');
    } catch(error) {
      if(current===revision) by('Status').textContent='Groups unavailable for '+payload.identity+'. '+error.message;
    } finally {
      if(current!==revision)return;
      pending=null;busy=false;fields.forEach(id=>by(id).disabled=false);controls();
      by('Results').setAttribute('aria-busy','false');
    }
  }
  by('Selected').onclick=()=>{
    reset();by('Kind').value='computer';by('Identity').value=S.target||'';
    selectedTitle('computer',S.target);
    by('Status').textContent=S.target?'Selected machine copied. Click Look up AD.':'Select a machine in Workspace first.';
  };
  for(const id of ['Kind','Identity','Server'])by(id).addEventListener('input',()=>{
    reset();selectedTitle(by('Kind').value,by('Identity').value.trim());
    by('Status').textContent='Selection changed. Click Look up AD to refresh.';
  });
  by('Form').onsubmit=event=>{event.preventDefault();if(busy||window.AtlasReadOnly)return;return selectionPromise=lookup();};
  window.AtlasAD = {
    select(kind,identity,run=true) {
      identity=String(identity||'').trim();
      const payload={kind,identity,server:by('Server').value.trim()};
      if(selectionKey===JSON.stringify(payload) && (primary || busy))return selectionPromise;
      reset();by('Kind').value=kind;by('Identity').value=identity;
      selectedTitle(kind,identity);
      if(!identity){by('Status').textContent='No AD account supplied for this selection.';return;}
      selectionKey=JSON.stringify(payload);
      if(window.AtlasReadOnly){this.open();return;}
      if(run)return selectionPromise=lookup();
      by('Status').textContent='Selected '+identity+'. Click Look up AD to load groups.';
    },
    clear() {
      reset();by('Results').setAttribute('aria-busy','false');
      by('Identity').value='';selectedTitle('', '');
      by('Status').textContent='Select a user or machine to load its groups. Use AD lookup for another account or controller.';
      if(window.AtlasReadOnly)this.open();
    },
    async show(kind, identity, run = true, action = "groups") {
      page('active-directory');
      const result=this.select(kind,identity,run);
      if(!run||!identity){by('Identity').focus();}
      const selectedRevision = revision;
      await result;
      // A delayed shortcut must never act on a different selection's results.
      if (run && selectedRevision === revision && !window.AtlasReadOnly && ["compare", "properties", "export", "summary", "filter"].includes(action))
        this.groupActions?.[action]?.();
    },
    command(id) {
      if(id === "ad-browser"){page("active-directory");const browser=document.getElementById("adBrowser");browser.open=true;browser.scrollIntoView({block:"start"});const input=document.querySelector(".ad-browser-tools input");input?.focus();return;}
      if (id === "ad-user-groups")
        return this.show("user", S.user?.user_name || S.user?.email || "");
      if (id === "ad-machine-groups")
        return this.show("computer", S.target || "");
      page("active-directory");
      const action = {
        "ad-compare": "compare",
        "ad-support-summary": "summary",
        "ad-filter-groups": "filter",
        "ad-export-groups": "export",
      }[id];
      if (this.groupActions?.[action]) {
        this.groupActions[action]();
      }
      else {
        by("Status").textContent =
          "Look up an AD object first to " +
          (action || "view") +
          " its groups.";
        by("Identity").focus();
      }
    },
    open() {
      controls();
      if (window.AtlasReadOnly)
        by("Status").textContent =
          "Live AD lookup is available only in local Admin. Demo and Preview do not query the directory.";
    },
  };
  controls();
})();
// Read-only directory navigation shares the same authenticated AD transport.
(() => {
 const form=document.getElementById('adForm'); if(!form)return;
 const host=document.createElement('details');host.className='ad-browser';host.id='adBrowser';
 host.innerHTML='<summary>Directory browser · OUs, users, computers and groups</summary><form class="ad-browser-tools"><label>Domain / controller<input name="server" placeholder="Default domain discovery" maxlength="128"></label><label>Search within current OU<input name="query" placeholder="Name, account or employee ID" maxlength="128"></label><label>Type<select name="kind"><option value="all">All objects</option><option value="user">Users</option><option value="computer">Computers</option><option value="group">Groups</option><option value="ou">OUs / containers</option></select></label><button type="submit">Search</button><button type="button" data-root>Domain root</button><button type="button" data-back disabled>Back</button><button type="button" data-up disabled>Parent OU</button></form><p role="status">Click Domain root to browse, or search. Live AD requires Atlas Admin.</p><div class="ad-browser-path"></div><div class="ad-browser-results"></div><button type="button" data-more hidden>Load more</button>';
 document.getElementById('adResults').after(host);
 const tools=host.querySelector('form'),status=host.querySelector('[role="status"]'),results=host.querySelector('.ad-browser-results'),path=host.querySelector('.ad-browser-path');
 const more=host.querySelector('[data-more]'),back=host.querySelector('[data-back]'),up=host.querySelector('[data-up]');
 let current=null,parent='',history=[],busy=false;
 const make=(tag,text)=>{const n=document.createElement(tag);if(text!=null)n.textContent=String(text);return n;};
 const control=(label,fn)=>{const b=make('button',label);b.type='button';b.onclick=fn;return b;};
 async function load(request,remember=true){
  if(busy||window.AtlasReadOnly)return;
  busy=true;status.textContent='Reading directory…';host.setAttribute('aria-busy','true');
  const old=current;results.replaceChildren();more.hidden=true;
  const payload={operation:'children',kind:tools.elements.kind.value,query:tools.elements.query.value.trim(),server:tools.elements.server.value.trim(),base:'',limit:200,...request};
  for(const n of tools.elements)n.disabled=true;
  try{
   const data=await AtlasClient.request('/api/active-directory/browse',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
   if(remember&&old)history.push(old);
   current={...payload,base:data.base};parent=data.parent||'';path.textContent=data.base;
   if(data.details){const dl=make('dl');dl.className='ad-browser-properties';for(const [k,v] of Object.entries(data.details)){dl.append(make('dt',k),make('dd',v||'—'));}results.append(dl);}
   const table=make('table');table.innerHTML='<thead><tr><th>Name / account</th><th>Type</th><th>Description</th><th>Directory path</th><th>Actions</th></tr></thead>';const body=make('tbody');table.append(body);
   for(const item of data.items){
    const row=make('tr'),name=make('td',item.name+(item.account?' · '+item.account:'')),kind=make('td',item.kind),dn=make('td',item.dn),actions=make('td');
    if(['organizationalUnit','container','domainDNS'].includes(item.kind))actions.append(control('Open',()=>load({base:item.dn,operation:'children',server:payload.server})));
    if(['user','computer','group'].includes(item.kind)){
     actions.className='ad-row-actions';
     AtlasADRows.attach(row,name,actions,item,payload.server,()=>{
      if(item.kind==='group')return AtlasAD.browseMembers(item.dn,payload.server);
      document.getElementById('adServer').value=payload.server;AtlasAD.show(item.kind,item.guid||item.account||item.name);document.getElementById('adForm').scrollIntoView({block:'start'});
     });
    }
    actions.append(control('Properties',()=>load({operation:'details',base:item.dn,server:payload.server})));
    row.append(name,kind,make('td',item.description||'—'),dn,actions);body.append(row);
   }
   const wrap=make('div');wrap.className='tablewrap';wrap.append(table);results.append(wrap);
   status.textContent=`${data.items.length} ${payload.operation==='details'?'parent groups':'objects'}${data.more?' · More available; load more or narrow the search.': ''} · ${data.note||''}`;
   more.hidden=!data.more;more.disabled=payload.limit>=5000;more.textContent=more.disabled?'Narrow the search to see additional objects':'Load more';
  }catch(error){status.textContent=error.message;current=null;parent='';}
  finally{busy=false;host.removeAttribute('aria-busy');for(const n of tools.elements)n.disabled=!!window.AtlasReadOnly;back.disabled=!history.length||!!window.AtlasReadOnly;up.disabled=!parent||!!window.AtlasReadOnly;}
 }
 window.AtlasAD.browseMembers=(dn,server='')=>{if(window.AtlasReadOnly)return;page('active-directory');host.open=true;tools.elements.server.value=server;host.scrollIntoView({block:'start'});return load({operation:'members',base:dn,server});};
 tools.onsubmit=e=>{e.preventDefault();load({operation:'search',base:current?.server===tools.elements.server.value.trim()?(['members','details'].includes(current?.operation)?parent:current?.base)||'':''});};
 host.querySelector('[data-root]').onclick=()=>load({operation:'children',base:''});
 back.onclick=()=>{const previous=history.pop();if(previous)return load(previous,false);};
 up.onclick=()=>load({operation:'children',base:parent,server:current?.server||''});
 more.onclick=()=>{if(current)return load({...current,limit:Math.min(5000,current.limit+200)},false);};
 if(window.AtlasReadOnly)for(const n of tools.elements)n.disabled=true;
})();
